import db from '../db/index.js'
import ApiError from '../utils/api-error.js'
import ApiResponse from '../utils/api-response.js'
import { websites, cookiePolicy } from '../models/index.js'
import { asyncHandler } from '../utils/async-handler.js'
import { and, eq } from 'drizzle-orm'

// Sections stored as sibling keys in the cookie_policy.content jsonb. Adding a new
// section (e.g. cookie preferences) is a one-line allowlist entry — no migration.
const SECTIONS = ['aboutCookies', 'useOfCookies']

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

export const putSection = asyncHandler(async (req, res) => {
  const { section } = req.params
  if (!SECTIONS.includes(section))
    throw new ApiError(404, 'unknown cookie policy section')

  await assertOwnedWebsite(req.params.websiteId, req.user.id)
  const { heading = '', description = '' } = req.body
  const sectionData = { heading, description }

  const [existing] = await db
    .select({ content: cookiePolicy.content })
    .from(cookiePolicy)
    .where(eq(cookiePolicy.websiteId, req.params.websiteId))

  let content
  if (!existing) {
    content = { [section]: sectionData }
    await db
      .insert(cookiePolicy)
      .values({ websiteId: req.params.websiteId, content })
  } else {
    // Merge: preserve sibling sections, upsert only this one.
    content = { ...(existing.content || {}), [section]: sectionData }
    await db
      .update(cookiePolicy)
      .set({ content })
      .where(eq(cookiePolicy.websiteId, req.params.websiteId))
  }
  return res
    .status(200)
    .json(new ApiResponse(200, { content }, 'cookie policy updated sucessfully'))
})
