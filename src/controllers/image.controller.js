import db from '../db/index.js'
import ApiError from '../utils/api-error.js'
import ApiResponse from '../utils/api-response.js'
import { websites, cookiePolicy, policyImages } from '../models/index.js'
import { asyncHandler } from '../utils/async-handler.js'
import { and, eq } from 'drizzle-orm'

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
  const [img] = await db
    .insert(policyImages)
    .values({
      cookiePolicyId,
      mime,
      data: req.file.buffer,
      byteSize: req.file.size,
    })
    .returning({ id: policyImages.id })

  return res
    .status(201)
    .json(
      new ApiResponse(201, { url: `/pulse/images/${img.id}` }, 'image uploaded sucessfully'),
    )
})

export const getImage = asyncHandler(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) throw new ApiError(404, 'image not found')
  const [img] = await db
    .select({ mime: policyImages.mime, data: policyImages.data })
    .from(policyImages)
    .where(eq(policyImages.id, req.params.id))
  if (!img) throw new ApiError(404, 'image not found')

  res.set('Content-Type', img.mime)
  res.set('Cache-Control', 'public, max-age=31536000, immutable')
  return res.send(img.data)
})
