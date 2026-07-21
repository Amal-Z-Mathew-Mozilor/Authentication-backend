import { ApiError, ApiResponse } from '../utils/response/index.js'
import * as websiteRepository from '../repositories/website.repository.js'
import * as cookiePolicyRepository from '../repositories/cookiePolicy.repository.js'
import * as policyImageRepository from '../repositories/policyImage.repository.js'
import { asyncHandler } from '../utils/async-handler.js'
import { v4 as uuidv4 } from 'uuid'
import { uploadObject, getObjectBuffer } from '../utils/aws/index.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

/**
 * Serve an owner-scoped policy image by streaming its bytes from S3 with the row's content type.
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.params.id - Image id (UUID) to serve.
 * @param {string} req.user.id - Authenticated user id (set by jwtValidation).
 * @param {import('express').Response} res - Sends the image bytes with Content-Type + immutable Cache-Control.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 - Malformed id, image not found / not owned, or its S3 object is unreadable.
 */
export const getImage = asyncHandler(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) throw new ApiError(404, 'image not found')
  const [img] = await policyImageRepository.findKeyByIdForUser(
    req.params.id,
    req.user.id,
  )
  if (!img) throw new ApiError(404, 'image not found')

  let buf
  try {
    buf = await getObjectBuffer(img.key)
  } catch {
    throw new ApiError(404, 'image not found')
  }
  res.set('Content-Type', img.mime)
  res.set('Cache-Control', 'private, max-age=31536000, immutable')
  return res.send(buf)
})

/**
 * Serve a policy image PUBLICLY (no auth, no ownership) by streaming its bytes from the private S3 bucket.
 * Backs the absolute ${PUBLIC_BASE_URL}/pulse/public/images/<id> references in the exported/emailed policy so it renders on any host; the bucket stays private (bytes are read server-side). Anyone with the UUID link can fetch — cookie-policy images are public-by-intent (embedded on a public policy page).
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.params.id - Image id (UUID) to serve.
 * @param {import('express').Response} res - Sends the image bytes with Content-Type + public immutable Cache-Control.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 - Malformed id, image not found, or its S3 object is unreadable.
 */
export const getPublicImage = asyncHandler(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) throw new ApiError(404, 'image not found')
  const [img] = await policyImageRepository.findKeyById(req.params.id)
  if (!img) throw new ApiError(404, 'image not found')

  let buf
  try {
    buf = await getObjectBuffer(img.key)
  } catch {
    throw new ApiError(404, 'image not found')
  }
  res.set('Content-Type', img.mime)
  res.set('Cache-Control', 'public, max-age=31536000, immutable')
  return res.send(buf)
})
