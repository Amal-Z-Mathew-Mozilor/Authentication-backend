import { ApiError, ApiResponse } from '../utils/response/index.js'
import * as cookiePolicyRepository from '../repositories/cookiePolicy.repository.js'
import * as websiteRepository from '../repositories/website.repository.js'
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
import {
  buildPolicyInstallEvent,
  buildPolicyScriptEvent,
} from '../utils/auth/index.js'
import { emitMailEvent } from '../utils/events/mailEmitter.js'
import { postScript, buildEmbedTag } from '../utils/scriptGenerator/index.js'
import 'dotenv/config'

// Environment configuration — all process.env reads live here at the top of the file.
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || ''

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
 * Render a website's saved policy as an HTML snippet whose image references are absolute public URLs (${PUBLIC_BASE_URL}/pulse/public/images/<id>), so the pasted policy renders on any host without inlining bytes. Shared by the "HTML format" export and the "send code to a teammate" email so the two outputs are byte-identical.
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

  const url = site?.url || ''
  return {
    html: renderPolicyHtml({
      content,
      url,
      publicBase: PUBLIC_BASE_URL,
      lastUpdated,
    }),
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
 * @param {string} [req.body.format] - 'html' (default) emails the copy-HTML snippet; 'script' emails the <script> embed tag.
 * @param {string} req.user.id - Authenticated user id (set by jwtValidation).
 * @param {import('express').Response} res - Sends 200 on success.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 - Website does not exist or is not owned by the user.
 */
export const sendPolicyCode = asyncHandler(async (req, res) => {
  await assertOwnedWebsite(req.params.websiteId, req.user.id)

  let event
  if (req.body.format === 'script') {
    const [site] = await websiteRepository.findUrlById(req.params.websiteId)
    const scriptTag = buildEmbedTag(req.params.websiteId)
    event = buildPolicyScriptEvent(req.body.email, site?.url || '', scriptTag)
  } else {
    const { html, url } = await buildPolicyHtml(req.params.websiteId)
    event = buildPolicyInstallEvent(req.body.email, url, html)
  }

  emitMailEvent(event)
  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'installation code sent sucessfully'))
})

/**
 * Return the <script> embed tag for the "Code snippet" add-to-site method. The tag's src points at the script-generator service (GET /scripts/:id.js), which serves the .js stored on the last "Generate cookie policy".
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.params.websiteId - Owning website id (= the embed id).
 * @param {string} req.user.id - Authenticated user id (set by jwtValidation).
 * @param {import('express').Response} res - Sends 200 with { script }.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 - Website does not exist or is not owned by the user.
 */
export const getPolicyScript = asyncHandler(async (req, res) => {
  await assertOwnedWebsite(req.params.websiteId, req.user.id)
  const script = buildEmbedTag(req.params.websiteId)
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { script },
        'cookie policy script generated sucessfully',
      ),
    )
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

  // On "Generate cookie policy", (re)generate the embeddable script in S3 via the
  // Go script-generator service. Best-effort: a script-service outage is logged and
  // swallowed so it never fails the generate save — the script is rebuilt next generate.
  if (generated === true) {
    try {
      const [site] = await websiteRepository.findUrlById(req.params.websiteId)
      await postScript({
        id: req.params.websiteId,
        url: site?.url || '',
        lastUpdated: todayISO(),
        publicBase: PUBLIC_BASE_URL,
        content,
      })
    } catch (err) {
      console.log('postScript failed:', err.message)
    }
  }

  return res
    .status(200)
    .json(
      new ApiResponse(200, { content }, 'cookie policy updated sucessfully'),
    )
})
