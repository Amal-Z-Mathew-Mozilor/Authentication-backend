import ApiError from '../utils/api-error.js'
import ApiResponse from '../utils/api-response.js'
import * as websiteRepository from '../repositories/website.repository.js'
import * as cookiePolicyRepository from '../repositories/cookiePolicy.repository.js'
import * as policyImageRepository from '../repositories/policyImage.repository.js'
import { asyncHandler } from '../utils/async-handler.js'
import { v4 as uuidv4 } from 'uuid'
import { uploadObject, presignGetUrl } from '../utils/s3.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Confirm real image content from the file's magic bytes (defence beyond mimetype).
/**
 * Detect PNG or JPEG from a buffer's magic bytes (defence beyond the declared mimetype).
 * @param {Buffer} buf - The uploaded file bytes.
 * @returns {string|null} "image/png", "image/jpeg", or null if neither.
 */
function sniffMime(buf) {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
    return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return 'image/jpeg'
  return null
}

// The website must be owned by the user; ensure its cookie_policy row exists (the
// image FK target) even before the first Save. Returns the cookie_policy id.
/**
 * Assert the website is owned by the user and return its cookie_policy id, creating the row if it doesn't exist yet.
 * @param {string} websiteId - Website id from the route.
 * @param {string} userId - Authenticated req.user.id.
 * @returns {Promise<string>} The owning cookie_policy row id.
 * @throws {ApiError} 404 - Website not found or not owned by the user.
 */
async function ensureOwnedPolicy(websiteId, userId) {
  const [site] = await websiteRepository.findIdByIdForUser(websiteId, userId)
  if (!site) throw new ApiError(404, 'website not found')

  let [policy] = await cookiePolicyRepository.findIdByWebsiteId(websiteId)
  if (!policy) {
    ;[policy] = await cookiePolicyRepository.create({ websiteId, content: {} })
  }
  return policy.id
}

/**
 * Upload a policy image to S3 and store its key, returning the stable /pulse/images/:id URL.
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.params.websiteId - Owning website id.
 * @param {Express.Multer.File} req.file - Uploaded file (multer memory storage: .buffer, .size).
 * @param {string} req.user.id - Authenticated user id (set by jwtValidation).
 * @param {import('express').Response} res - Sends 201 with { url }.
 * @returns {Promise<void>}
 * @throws {ApiError} 400 - No file provided.
 * @throws {ApiError} 415 - File is not a PNG or JPG.
 * @throws {ApiError} 404 - Website not found or not owned by the user.
 */
export const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'file is required')
  const mime = sniffMime(req.file.buffer)
  if (!mime) throw new ApiError(415, 'Only PNG and JPG images are allowed')

  const cookiePolicyId = await ensureOwnedPolicy(
    req.params.websiteId,
    req.user.id,
  )
  // Upload the bytes to S3 under a unique key, then store the KEY (not the bytes).
  const ext = mime === 'image/png' ? 'png' : 'jpg'
  const key = `policy-images/${uuidv4()}.${ext}`
  await uploadObject(key, req.file.buffer, mime)
  const [img] = await policyImageRepository.create({
    cookiePolicyId,
    key,
    mime,
    byteSize: req.file.size,
  })

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        { url: `/pulse/images/${img.id}` },
        'image uploaded sucessfully',
      ),
    )
})

// Owner-scoped read: the image must belong to one of the caller's cookie policies
// (policy_images → cookie_policy → websites → userId). A non-existent id OR another
// user's image both return 404 (don't leak which ids exist). jwtValidation sets req.user.
// The bytes live in a private S3 bucket, so we mint a fresh short-lived presigned GET URL
// for the row's key and 302-redirect to it — the browser then fetches directly from S3.
// The stored /pulse/images/:id URL never changes and no presigned URL is persisted.
/**
 * Serve an owner-scoped policy image by 302-redirecting to a fresh short-lived presigned S3 GET URL.
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.params.id - Image id (UUID) to serve.
 * @param {string} req.user.id - Authenticated user id (set by jwtValidation).
 * @param {import('express').Response} res - Sets Cache-Control: no-store and 302-redirects to the presigned URL.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 - Malformed id, or image not found / not owned by the user.
 */
export const getImage = asyncHandler(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) throw new ApiError(404, 'image not found')
  const [img] = await policyImageRepository.findKeyByIdForUser(
    req.params.id,
    req.user.id,
  )
  if (!img) throw new ApiError(404, 'image not found')

  const url = await presignGetUrl(img.key)
  // Don't let the browser cache the redirect — each load should mint a fresh (unexpired) URL.
  res.set('Cache-Control', 'no-store')
  return res.redirect(302, url)
})
