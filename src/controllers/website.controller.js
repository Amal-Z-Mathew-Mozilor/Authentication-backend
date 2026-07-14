import { ApiError, ApiResponse } from '../utils/response/index.js'
import * as websiteRepository from '../repositories/website.repository.js'
import { asyncHandler } from '../utils/async-handler.js'
import { defaultCookieContent } from '../utils/cookiePolicy/index.js'

// All handlers are scoped to the authenticated user (req.user.id, set by jwtValidation).

/**
 * Assert a website name and url are each unique among the user's own websites (normalized compare).
 * @param {string} userId - Authenticated req.user.id.
 * @param {string} name - Candidate website name.
 * @param {string} url - Candidate website url.
 * @param {string|null} [excludeId=null] - Row id to skip (the website being edited).
 * @returns {Promise<void>}
 * @throws {ApiError} 422 - Name or url already taken (errors: [{ path, msg }]).
 */
async function assertNoDuplicate(userId, name, url, excludeId = null) {
  const n = (name || '').trim().toLowerCase()
  const u = (url || '').trim().toLowerCase().replace(/\/+$/, '')
  const rows = await websiteRepository.findByUserId(userId)

  let nameTaken = false
  let urlTaken = false
  for (const row of rows) {
    if (excludeId && row.id === excludeId) continue
    if ((row.name || '').trim().toLowerCase() === n) nameTaken = true
    if ((row.url || '').trim().toLowerCase().replace(/\/+$/, '') === u)
      urlTaken = true
  }

  const errors = []
  if (nameTaken)
    errors.push({
      path: 'name',
      msg: 'A website with this name already exists',
    })
  if (urlTaken)
    errors.push({ path: 'url', msg: 'A website with this URL already exists' })
  if (errors.length) throw new ApiError(422, 'Validation failed', errors)
}

/**
 * List the authenticated user's websites, newest first.
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.user.id - Authenticated user id (set by jwtValidation).
 * @param {import('express').Response} res - Sends 200 with the website rows.
 * @returns {Promise<void>}
 */
export const listWebsites = asyncHandler(async (req, res) => {
  const rows = await websiteRepository.listByUserId(req.user.id)
  return res
    .status(200)
    .json(new ApiResponse(200, rows, 'websites fetched sucessfully'))
})

/**
 * Create a website for the authenticated user and seed its default cookie_policy row in one transaction.
 * @param {import('express').Request} req - The Express request.
 * @param {object} req.body - Request body.
 * @param {string} req.body.name - Website name (unique per user).
 * @param {string} req.body.url - Website url (unique per user).
 * @param {string} req.user.id - Authenticated owner id (set by jwtValidation).
 * @param {import('express').Response} res - Sends 201 with the created website.
 * @returns {Promise<void>}
 * @throws {ApiError} 422 - Duplicate name or url for this user (errors: [{ path, msg }]).
 */
export const createWebsite = asyncHandler(async (req, res) => {
  const { name, url } = req.body
  await assertNoDuplicate(req.user.id, name, url)
  const today = new Date().toISOString().slice(0, 10)
  const website = await websiteRepository.createWithPolicy({
    name,
    url,
    userId: req.user.id,
    policyContent: defaultCookieContent(today),
  })
  return res
    .status(201)
    .json(new ApiResponse(201, website, 'website added sucessfully'))
})

/**
 * Update the authenticated user's website name and url.
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.params.id - Website id to update.
 * @param {object} req.body - Request body.
 * @param {string} req.body.name - New website name (unique per user).
 * @param {string} req.body.url - New website url (unique per user).
 * @param {string} req.user.id - Authenticated owner id (set by jwtValidation).
 * @param {import('express').Response} res - Sends 200 with the updated website.
 * @returns {Promise<void>}
 * @throws {ApiError} 422 - Duplicate name or url for this user (errors: [{ path, msg }]).
 * @throws {ApiError} 404 - Website not found or not owned by the user.
 */
export const updateWebsite = asyncHandler(async (req, res) => {
  const { name, url } = req.body
  await assertNoDuplicate(req.user.id, name, url, req.params.id)
  const [website] = await websiteRepository.updateByIdForUser(
    req.params.id,
    req.user.id,
    { name, url },
  )
  if (!website) {
    throw new ApiError(404, 'website not found')
  }
  return res
    .status(200)
    .json(new ApiResponse(200, website, 'website updated sucessfully'))
})

/**
 * Delete the authenticated user's website by id.
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.params.id - Website id to delete.
 * @param {string} req.user.id - Authenticated owner id (set by jwtValidation).
 * @param {import('express').Response} res - Sends 200 on success.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 - Website not found or not owned by the user.
 */
export const deleteWebsite = asyncHandler(async (req, res) => {
  const [website] = await websiteRepository.deleteByIdForUser(
    req.params.id,
    req.user.id,
  )
  if (!website) {
    throw new ApiError(404, 'website not found')
  }
  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'website deleted sucessfully'))
})
