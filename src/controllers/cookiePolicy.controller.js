import db from '../db/index.js'
import ApiError from '../utils/api-error.js'
import ApiResponse from '../utils/api-response.js'
import { cookiePolicy } from '../models/index.js'
import { asyncHandler } from '../utils/async-handler.js'
import { eq } from 'drizzle-orm'
import {
  SECTIONS,
  imageIdsFrom,
  sanitizeIds,
  sweepOrphanImages,
  assertOwnedWebsite,
} from '../utils/cookiePolicy.js'

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
    .select({ id: cookiePolicy.id, content: cookiePolicy.content })
    .from(cookiePolicy)
    .where(eq(cookiePolicy.websiteId, req.params.websiteId))

  let content
  let policyId
  if (!existing) {
    content = { [section]: sectionData }
    const [ins] = await db
      .insert(cookiePolicy)
      .values({ websiteId: req.params.websiteId, content })
      .returning({ id: cookiePolicy.id })
    policyId = ins.id
  } else {
    // Merge: preserve sibling sections, upsert only this one.
    content = { ...(existing.content || {}), [section]: sectionData }
    await db
      .update(cookiePolicy)
      .set({ content })
      .where(eq(cookiePolicy.websiteId, req.params.websiteId))
    policyId = existing.id
  }

  // Keep images referenced by saved content (all sections) ∪ what the client reports
  // is still on screen across all editors; delete the rest for this policy.
  const keep = imageIdsFrom(JSON.stringify(content))
  for (const id of sanitizeIds(req.body.usedImageIds)) keep.add(id)
  await sweepOrphanImages(policyId, keep)

  return res
    .status(200)
    .json(new ApiResponse(200, { content }, 'cookie policy updated sucessfully'))
})

// Policy-level metadata (not a section) — currently the effective date. Stored as a
// top-level key in the same content jsonb, merge-upserted so sections are preserved.
export const putPolicyMeta = asyncHandler(async (req, res) => {
  await assertOwnedWebsite(req.params.websiteId, req.user.id)
  const { effectiveDate = '' } = req.body

  const [existing] = await db
    .select({ id: cookiePolicy.id, content: cookiePolicy.content })
    .from(cookiePolicy)
    .where(eq(cookiePolicy.websiteId, req.params.websiteId))

  let content
  let policyId
  if (!existing) {
    content = { effectiveDate }
    const [ins] = await db
      .insert(cookiePolicy)
      .values({ websiteId: req.params.websiteId, content })
      .returning({ id: cookiePolicy.id })
    policyId = ins.id
  } else {
    content = { ...(existing.content || {}), effectiveDate }
    await db
      .update(cookiePolicy)
      .set({ content })
      .where(eq(cookiePolicy.websiteId, req.params.websiteId))
    policyId = existing.id
  }

  // Same reconcile as putSection: effectiveDate carries no image, but the merged
  // content still holds sibling sections' images, and the client sends usedImageIds.
  const keep = imageIdsFrom(JSON.stringify(content))
  for (const id of sanitizeIds(req.body.usedImageIds)) keep.add(id)
  await sweepOrphanImages(policyId, keep)

  return res
    .status(200)
    .json(new ApiResponse(200, { content }, 'cookie policy updated sucessfully'))
})
