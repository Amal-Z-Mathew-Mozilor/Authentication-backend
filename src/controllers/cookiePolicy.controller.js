import { ApiError, ApiResponse } from '../utils/response/index.js'
import * as cookiePolicyRepository from '../repositories/cookiePolicy.repository.js'
import * as websiteRepository from '../repositories/website.repository.js'
import * as policyImageRepository from '../repositories/policyImage.repository.js'
import { asyncHandler } from '../utils/async-handler.js'
import {
  SECTIONS,
  imageIdsFrom,
  sanitizeIds,
  sweepOrphanImages,
  assertOwnedWebsite,
  defaultCookieContent,
  renderPolicyHtml,
  todayISO,
} from '../utils/cookiePolicy/index.js'
import { sendEmail, policyInstallEmail } from '../utils/auth/index.js'
import { getObjectBuffer } from '../utils/aws/index.js'

/**
 * Fetch a website's saved cookie policy content plus its last-updated timestamp.
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.params.websiteId - Owning website id.
 * @param {string} req.user.id - Authenticated user id (set by jwtValidation).
 * @param {import('express').Response} res - Sends 200 with { content, updatedAt }.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 - Website does not exist or is not owned by the user.
 */
export const getCookiePolicy = asyncHandler(async (req, res) => {
  await assertOwnedWebsite(req.params.websiteId, req.user.id)
  const [row] = await cookiePolicyRepository.findContentByWebsiteId(
    req.params.websiteId,
  )
  const content = row?.content || {}
  const updatedAt = row?.updatedAt || null
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { content, updatedAt },
        'cookie policy fetched sucessfully',
      ),
    )
})

/**
 * Render a website's saved policy as a self-contained HTML snippet with every referenced image inlined as a base64 data URI. Shared by the "HTML format" export and the "send code to a teammate" email so the two outputs are byte-identical; an image whose S3 object can't be fetched is skipped (its /pulse/images URL is left unreplaced) rather than failing the whole export.
 * @param {string} websiteId - The owning website id (ownership must already be asserted by the caller).
 * @returns {Promise<{ html: string, url: string }>} The rendered snippet and the website url.
 */
async function buildPolicyHtml(websiteId) {
  const [site] = await websiteRepository.findUrlById(websiteId)

  const [row] = await cookiePolicyRepository.findByWebsiteId(websiteId)
  const content = row?.content || {}
  const lastUpdated = row?.updatedAt
    ? new Date(row.updatedAt).toISOString().slice(0, 10)
    : todayISO()

  const imagesById = {}
  const ids = [...imageIdsFrom(JSON.stringify(content))]
  if (row?.id && ids.length) {
    const imgs = await policyImageRepository.findByPolicyAndIds(row.id, ids)
    for (const img of imgs) {
      try {
        const buf = await getObjectBuffer(img.key)
        imagesById[img.id.toLowerCase()] =
          `data:${img.mime};base64,${buf.toString('base64')}`
      } catch {}
    }
  }

  const url = site?.url || ''
  return {
    html: renderPolicyHtml({ content, url, imagesById, lastUpdated }),
    url,
  }
}

/**
 * Return the saved cookie policy as a self-contained HTML snippet for the "HTML format" export.
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.params.websiteId - Owning website id.
 * @param {string} req.user.id - Authenticated user id (set by jwtValidation).
 * @param {import('express').Response} res - Sends 200 with { html }.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 - Website does not exist or is not owned by the user.
 */
export const getCookiePolicyHtml = asyncHandler(async (req, res) => {
  await assertOwnedWebsite(req.params.websiteId, req.user.id)
  const { html } = await buildPolicyHtml(req.params.websiteId)
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { html },
        'cookie policy html generated sucessfully',
      ),
    )
})

/**
 * Email the policy's install snippet to a teammate; mail-transport errors are swallowed so a mail outage still returns 200.
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.params.websiteId - Owning website id.
 * @param {object} req.body - Request body.
 * @param {string} req.body.email - Teammate's email address to send the install snippet to (validated).
 * @param {string} req.user.id - Authenticated user id (set by jwtValidation).
 * @param {import('express').Response} res - Sends 200 on success.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 - Website does not exist or is not owned by the user.
 */
export const sendPolicyCode = asyncHandler(async (req, res) => {
  await assertOwnedWebsite(req.params.websiteId, req.user.id)
  const { html, url } = await buildPolicyHtml(req.params.websiteId)
  const { subject, html: emailHtml, text } = policyInstallEmail(url, html)
  await sendEmail({ email: req.body.email, subject, html: emailHtml, text })
  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'installation code sent sucessfully'))
})

/**
 * Upsert one cookie-policy section into the content jsonb, track completion, and sweep now-orphaned images. completedSections is server-derived (the saved section is auto-added, deduped), never read from the request body; a saved edit un-generates the policy by dropping generatedAt.
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.params.websiteId - Owning website id.
 * @param {string} req.params.section - Section key (allowlisted: aboutCookies|useOfCookies|cookiePreferences).
 * @param {object} req.body - Request body.
 * @param {string} [req.body.heading] - Section heading text (defaults to '').
 * @param {string} [req.body.description] - Section rich-text HTML (defaults to '').
 * @param {string[]} [req.body.usedImageIds] - Image ids still on screen; kept from the orphan sweep.
 * @param {string} req.user.id - Authenticated user id (set by jwtValidation).
 * @param {import('express').Response} res - Sends 200 with the merged { content }.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 - Unknown cookie policy section, or website not owned by the user.
 */
export const putSection = asyncHandler(async (req, res) => {
  const { section } = req.params
  if (!SECTIONS.includes(section))
    throw new ApiError(404, 'unknown cookie policy section')

  await assertOwnedWebsite(req.params.websiteId, req.user.id)
  const { heading = '', description = '' } = req.body
  const sectionData = { heading, description }

  const [existing] = await cookiePolicyRepository.findIdAndContentByWebsiteId(
    req.params.websiteId,
  )

  const completedSections = [
    ...new Set([...(existing?.content?.completedSections || []), section]),
  ]

  let content
  let policyId
  if (!existing) {
    content = { [section]: sectionData, completedSections }
    const [ins] = await cookiePolicyRepository.create({
      websiteId: req.params.websiteId,
      content,
    })
    policyId = ins.id
  } else {
    content = {
      ...(existing.content || {}),
      [section]: sectionData,
      completedSections,
    }
    delete content.generatedAt
    await cookiePolicyRepository.updateContentByWebsiteId(
      req.params.websiteId,
      content,
    )
    policyId = existing.id
  }

  const keep = imageIdsFrom(JSON.stringify(content))
  for (const id of sanitizeIds(req.body.usedImageIds)) keep.add(id)
  await sweepOrphanImages(policyId, keep)

  return res
    .status(200)
    .json(
      new ApiResponse(200, { content }, 'cookie policy updated sucessfully'),
    )
})

/**
 * Reset a website's cookie policy to the default seed content and delete all of its images. This resets the row rather than removing it (cookie_policy is 1:1 with the website, seeded at create), so "Create new cookie policy" can reopen the wizard on the default template; only deleting the website drops the row (FK cascade).
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.params.websiteId - Owning website id.
 * @param {string} req.user.id - Authenticated user id (set by jwtValidation).
 * @param {import('express').Response} res - Sends 200 with the default { content }.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 - Website does not exist or is not owned by the user.
 */
export const deleteCookiePolicy = asyncHandler(async (req, res) => {
  await assertOwnedWebsite(req.params.websiteId, req.user.id)
  const today = new Date().toISOString().slice(0, 10)
  const content = defaultCookieContent(today)

  const [existing] = await cookiePolicyRepository.findIdByWebsiteId(
    req.params.websiteId,
  )

  let policyId
  if (!existing) {
    const [ins] = await cookiePolicyRepository.create({
      websiteId: req.params.websiteId,
      content,
    })
    policyId = ins.id
  } else {
    await cookiePolicyRepository.updateContentByWebsiteId(
      req.params.websiteId,
      content,
    )
    policyId = existing.id
  }

  await sweepOrphanImages(policyId, new Set())

  return res
    .status(200)
    .json(
      new ApiResponse(200, { content }, 'cookie policy deleted sucessfully'),
    )
})

/**
 * Upsert policy-level metadata (effectiveDate, optional generatedAt) into the content jsonb and sweep orphaned images. A plain meta save (without generated: true) un-generates the policy by dropping generatedAt.
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.params.websiteId - Owning website id.
 * @param {object} req.body - Request body.
 * @param {string} [req.body.effectiveDate] - Policy effective date, ISO YYYY-MM-DD (defaults to '').
 * @param {boolean} [req.body.generated] - When true, stamp generatedAt = now (the "Generate cookie policy" action).
 * @param {string[]} [req.body.usedImageIds] - Image ids still on screen; kept from the orphan sweep.
 * @param {string} req.user.id - Authenticated user id (set by jwtValidation).
 * @param {import('express').Response} res - Sends 200 with the merged { content }.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 - Website does not exist or is not owned by the user.
 */
export const putPolicyMeta = asyncHandler(async (req, res) => {
  await assertOwnedWebsite(req.params.websiteId, req.user.id)
  const { effectiveDate = '', generated } = req.body

  const genStamp =
    generated === true ? { generatedAt: new Date().toISOString() } : {}

  const [existing] = await cookiePolicyRepository.findIdAndContentByWebsiteId(
    req.params.websiteId,
  )

  let content
  let policyId
  if (!existing) {
    content = { effectiveDate, ...genStamp }
    const [ins] = await cookiePolicyRepository.create({
      websiteId: req.params.websiteId,
      content,
    })
    policyId = ins.id
  } else {
    content = { ...(existing.content || {}), effectiveDate, ...genStamp }
    if (generated !== true) delete content.generatedAt
    await cookiePolicyRepository.updateContentByWebsiteId(
      req.params.websiteId,
      content,
    )
    policyId = existing.id
  }

  const keep = imageIdsFrom(JSON.stringify(content))
  for (const id of sanitizeIds(req.body.usedImageIds)) keep.add(id)
  await sweepOrphanImages(policyId, keep)

  return res
    .status(200)
    .json(
      new ApiResponse(200, { content }, 'cookie policy updated sucessfully'),
    )
})
