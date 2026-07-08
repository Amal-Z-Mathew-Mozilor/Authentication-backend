import db from '../db/index.js'
import ApiError from '../utils/api-error.js'
import ApiResponse from '../utils/api-response.js'
import { websites, cookiePolicy } from '../models/index.js'
import { asyncHandler } from '../utils/async-handler.js'
import { and, eq } from 'drizzle-orm'

// Ownership: the cookie policy is reachable only through a website the user owns.
async function assertOwnedWebsite(websiteId, userId) {
  const [site] = await db
    .select({ id: websites.id })
    .from(websites)
    .where(and(eq(websites.id, websiteId), eq(websites.userId, userId)))
  if (!site) throw new ApiError(404, 'website not found')
}

export const getCookiePolicy = asyncHandler(async (req, res) => {
  await assertOwnedWebsite(req.params.websiteId, req.user.id)
  const [row] = await db
    .select({ content: cookiePolicy.content })
    .from(cookiePolicy)
    .where(eq(cookiePolicy.websiteId, req.params.websiteId))
  const content = row?.content || {}
  return res
    .status(200)
    .json(new ApiResponse(200, { content }, 'cookie policy fetched sucessfully'))
})

export const putAboutCookies = asyncHandler(async (req, res) => {
  await assertOwnedWebsite(req.params.websiteId, req.user.id)
  const { heading = '', description = '' } = req.body
  const aboutCookies = { heading, description }

  const [existing] = await db
    .select({ content: cookiePolicy.content })
    .from(cookiePolicy)
    .where(eq(cookiePolicy.websiteId, req.params.websiteId))

  let content
  if (!existing) {
    content = { aboutCookies }
    await db
      .insert(cookiePolicy)
      .values({ websiteId: req.params.websiteId, content })
  } else {
    content = { ...(existing.content || {}), aboutCookies }
    await db
      .update(cookiePolicy)
      .set({ content })
      .where(eq(cookiePolicy.websiteId, req.params.websiteId))
  }
  return res
    .status(200)
    .json(new ApiResponse(200, { content }, 'cookie policy updated sucessfully'))
})
