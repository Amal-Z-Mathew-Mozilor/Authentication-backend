import db from '../db/index.js'
import ApiError from '../utils/api-error.js'
import ApiResponse from '../utils/api-response.js'
import { websites, cookiePolicy, policyImages } from '../models/index.js'
import { asyncHandler } from '../utils/async-handler.js'
import { and, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { uploadObject, presignGetUrl } from '../utils/s3.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Confirm real image content from the file's magic bytes (defence beyond mimetype).
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
async function ensureOwnedPolicy(websiteId, userId) {
  const [site] = await db
    .select({ id: websites.id })
    .from(websites)
    .where(and(eq(websites.id, websiteId), eq(websites.userId, userId)))
  if (!site) throw new ApiError(404, 'website not found')

  let [policy] = await db
    .select({ id: cookiePolicy.id })
    .from(cookiePolicy)
    .where(eq(cookiePolicy.websiteId, websiteId))
  if (!policy) {
    ;[policy] = await db
      .insert(cookiePolicy)
      .values({ websiteId, content: {} })
      .returning({ id: cookiePolicy.id })
  }
  return policy.id
}

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
  const [img] = await db
    .insert(policyImages)
    .values({ cookiePolicyId, key, mime, byteSize: req.file.size })
    .returning({ id: policyImages.id })

  return res
    .status(201)
    .json(
      new ApiResponse(201, { url: `/pulse/images/${img.id}` }, 'image uploaded sucessfully'),
    )
})

// Owner-scoped read: the image must belong to one of the caller's cookie policies
// (policy_images → cookie_policy → websites → userId). A non-existent id OR another
// user's image both return 404 (don't leak which ids exist). jwtValidation sets req.user.
// The bytes live in a private S3 bucket, so we mint a fresh short-lived presigned GET URL
// for the row's key and 302-redirect to it — the browser then fetches directly from S3.
// The stored /pulse/images/:id URL never changes and no presigned URL is persisted.
export const getImage = asyncHandler(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) throw new ApiError(404, 'image not found')
  const [img] = await db
    .select({ key: policyImages.key })
    .from(policyImages)
    .innerJoin(cookiePolicy, eq(policyImages.cookiePolicyId, cookiePolicy.id))
    .innerJoin(websites, eq(cookiePolicy.websiteId, websites.id))
    .where(
      and(eq(policyImages.id, req.params.id), eq(websites.userId, req.user.id)),
    )
  if (!img) throw new ApiError(404, 'image not found')

  const url = await presignGetUrl(img.key)
  // Don't let the browser cache the redirect — each load should mint a fresh (unexpired) URL.
  res.set('Cache-Control', 'no-store')
  return res.redirect(302, url)
})
