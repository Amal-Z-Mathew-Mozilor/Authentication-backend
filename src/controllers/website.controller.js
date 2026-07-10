import db from '../db/index.js'
import ApiError from '../utils/api-error.js'
import ApiResponse from '../utils/api-response.js'
import { websites, cookiePolicy } from '../models/index.js'
import { asyncHandler } from '../utils/async-handler.js'
import { and, eq, desc } from 'drizzle-orm'
import { defaultCookieContent } from '../utils/defaultCookiePolicy.js'

// All handlers are scoped to the authenticated user (req.user.id, set by jwtValidation).

// Name and URL must each be unique among the user's OWN websites. Comparison is
// normalized (trim + lowercase; url also ignores a trailing slash) but the stored value
// keeps the user's original text. On a collision, throw a 422 in the express-validator
// shape ({ path, msg }) so the frontend renders it inline under the offending field.
// `excludeId` skips the row being edited (so a website may keep its own name/url).
async function assertNoDuplicate(userId, name, url, excludeId = null) {
  const n = (name || '').trim().toLowerCase()
  const u = (url || '').trim().toLowerCase().replace(/\/+$/, '')
  const rows = await db
    .select({ id: websites.id, name: websites.name, url: websites.url })
    .from(websites)
    .where(eq(websites.userId, userId))

  let nameTaken = false
  let urlTaken = false
  for (const row of rows) {
    if (excludeId && row.id === excludeId) continue
    if ((row.name || '').trim().toLowerCase() === n) nameTaken = true
    if ((row.url || '').trim().toLowerCase().replace(/\/+$/, '') === u) urlTaken = true
  }

  const errors = []
  if (nameTaken)
    errors.push({ path: 'name', msg: 'A website with this name already exists' })
  if (urlTaken)
    errors.push({ path: 'url', msg: 'A website with this URL already exists' })
  if (errors.length) throw new ApiError(422, 'Validation failed', errors)
}

export const listWebsites = asyncHandler(async (req, res) => {
  const rows = await db
    .select({
      id: websites.id,
      name: websites.name,
      url: websites.url,
      createdAt: websites.createdAt,
      updatedAt: websites.updatedAt,
    })
    .from(websites)
    .where(eq(websites.userId, req.user.id))
    .orderBy(desc(websites.createdAt))
  return res
    .status(200)
    .json(new ApiResponse(200, rows, 'websites fetched sucessfully'))
})

export const createWebsite = asyncHandler(async (req, res) => {
  const { name, url } = req.body
  // Reject a duplicate name/url for this user before creating anything.
  await assertNoDuplicate(req.user.id, name, url)
  // Effective date defaults to today (server date, ISO YYYY-MM-DD); user can edit later.
  const today = new Date().toISOString().slice(0, 10)
  // Create the website AND seed its cookie_policy (default content) atomically, so a new
  // site's editor opens pre-filled instead of blank. Rolls back if either insert fails.
  const website = await db.transaction(async (tx) => {
    const [w] = await tx
      .insert(websites)
      .values({ name, url, userId: req.user.id })
      .returning({
        id: websites.id,
        name: websites.name,
        url: websites.url,
        createdAt: websites.createdAt,
      })
    await tx
      .insert(cookiePolicy)
      .values({ websiteId: w.id, content: defaultCookieContent(today) })
    return w
  })
  return res
    .status(201)
    .json(new ApiResponse(201, website, 'website added sucessfully'))
})

export const updateWebsite = asyncHandler(async (req, res) => {
  const { name, url } = req.body
  // Reject collisions with the user's OTHER websites; the row being edited is excluded so
  // it can keep its own name/url.
  await assertNoDuplicate(req.user.id, name, url, req.params.id)
  const [website] = await db
    .update(websites)
    .set({ name, url })
    .where(and(eq(websites.id, req.params.id), eq(websites.userId, req.user.id)))
    .returning({
      id: websites.id,
      name: websites.name,
      url: websites.url,
      updatedAt: websites.updatedAt,
    })
  if (!website) {
    throw new ApiError(404, 'website not found')
  }
  return res
    .status(200)
    .json(new ApiResponse(200, website, 'website updated sucessfully'))
})

export const deleteWebsite = asyncHandler(async (req, res) => {
  const [website] = await db
    .delete(websites)
    .where(and(eq(websites.id, req.params.id), eq(websites.userId, req.user.id)))
    .returning({ id: websites.id })
  if (!website) {
    throw new ApiError(404, 'website not found')
  }
  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'website deleted sucessfully'))
})
