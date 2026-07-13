import ApiError from '../utils/api-error.js'
import ApiResponse from '../utils/api-response.js'
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
} from '../utils/cookiePolicy.js'
import { defaultCookieContent } from '../utils/defaultCookiePolicy.js'
import { renderPolicyHtml, todayISO } from '../utils/policyHtml.js'
import { sendEmail, policyInstallEmail } from '../utils/mail.js'
import { getObjectBuffer } from '../utils/s3.js'

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
  // updatedAt (last edit/generate) — used by the client to show an accurate "Last updated".
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

// Build the SAVED policy as a self-contained HTML snippet (styles + heading + dates +
// sections + footer) with every referenced /pulse/images/<id> inlined as a base64 data
// URI so the snippet is portable (the /pulse/images URL wouldn't resolve on a foreign
// host). Shared by the "HTML format" export and the "send code to a teammate" email so
// the two are byte-identical. Assumes ownership was already asserted by the caller.
/**
 * Render a website's saved policy as a self-contained HTML snippet with every referenced image inlined as a base64 data URI.
 * @param {string} websiteId - The owning website id (ownership must already be asserted by the caller).
 * @returns {Promise<{ html: string, url: string }>} The rendered snippet and the website url.
 */
async function buildPolicyHtml(websiteId) {
  // Website url — used in the footer ("Cookie Policy generated for <url>").
  const [site] = await websiteRepository.findUrlById(websiteId)

  const [row] = await cookiePolicyRepository.findByWebsiteId(websiteId)
  const content = row?.content || {}
  // Last edit/generate date for the "Last updated" line (YYYY-MM-DD; not render time).
  const lastUpdated = row?.updatedAt
    ? new Date(row.updatedAt).toISOString().slice(0, 10)
    : todayISO()

  // Load the images actually referenced by the saved content, scoped to this policy, and
  // build id → data:URI. Bytes come from S3 (by key) → base64 so the export stays
  // self-contained. An image whose S3 object can't be fetched is skipped (its
  // /pulse/images/<id> URL is left as-is) rather than failing the whole export.
  const imagesById = {}
  const ids = [...imageIdsFrom(JSON.stringify(content))]
  if (row?.id && ids.length) {
    const imgs = await policyImageRepository.findByPolicyAndIds(row.id, ids)
    for (const img of imgs) {
      try {
        const buf = await getObjectBuffer(img.key)
        imagesById[img.id.toLowerCase()] =
          `data:${img.mime};base64,${buf.toString('base64')}`
      } catch {
        /* object missing/unreadable — leave the /pulse/images URL unreplaced */
      }
    }
  }

  const url = site?.url || ''
  return {
    html: renderPolicyHtml({ content, url, imagesById, lastUpdated }),
    url,
  }
}

// The "HTML format" export: the owner pastes the snippet onto their own site. Owner-scoped.
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

// "Send code to a teammate": email the SAME snippet to a teammate so they can add it to
// the site. Owner-scoped; email validated by sendCodeValidator. sendEmail swallows
// transport errors (logs, never throws) — a mail outage does not 500 the request.
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
 * Upsert one cookie-policy section into the content jsonb, track completion, and sweep now-orphaned images.
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

  // A section counts as completed once it has been saved — server-derived (never
  // client-sent), persisted in the same jsonb so progress survives reload/resume.
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
    // Merge: preserve sibling sections, upsert only this one.
    content = {
      ...(existing.content || {}),
      [section]: sectionData,
      completedSections,
    }
    // A saved edit un-generates the policy: the saved content no longer matches the
    // generated snapshot, so drop generatedAt. Clicking "Cookie policy" then reopens the
    // wizard (needs re-generation). The Generate action re-stamps it afterwards.
    delete content.generatedAt
    await cookiePolicyRepository.updateContentByWebsiteId(
      req.params.websiteId,
      content,
    )
    policyId = existing.id
  }

  // Keep images referenced by saved content (all sections) ∪ what the client reports
  // is still on screen across all editors; delete the rest for this policy.
  const keep = imageIdsFrom(JSON.stringify(content))
  for (const id of sanitizeIds(req.body.usedImageIds)) keep.add(id)
  await sweepOrphanImages(policyId, keep)

  return res
    .status(200)
    .json(
      new ApiResponse(200, { content }, 'cookie policy updated sucessfully'),
    )
})

// "Delete" the policy — reset its content to the default seed (the same state a
// freshly created website's policy has) and remove all of this policy's images.
// This is a RESET, not a row-removal: cookie_policy is 1:1 with a website, seeded
// at website create with no independent create path, so resetting keeps the
// invariant and lets "Create new cookie policy" reopen the wizard on the default
// template. (Deleting the website itself still hard-removes the row via the FK
// cascade.)
/**
 * Reset a website's cookie policy to the default seed content and delete all of its images.
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

  // The default content references no images, so an empty keep-set sweeps every
  // image belonging to this policy.
  await sweepOrphanImages(policyId, new Set())

  return res
    .status(200)
    .json(
      new ApiResponse(200, { content }, 'cookie policy deleted sucessfully'),
    )
})

// Policy-level metadata (not a section) — currently the effective date. Stored as a
// top-level key in the same content jsonb, merge-upserted so sections are preserved.
/**
 * Upsert policy-level metadata (effectiveDate, optional generatedAt) into the content jsonb and sweep orphaned images.
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

  // Marking the policy "generated" is the explicit final step (the "Generate
  // cookie policy" button). Stamp a server-derived timestamp — never trust a
  // client clock — so the UI can route a returning user straight to the preview.
  // Ordinary meta auto-saves omit `generated`, so they never set this.
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
    // A plain meta save (no `generated: true`) is an edit → un-generate the policy so the
    // dashboard reopens the wizard. The Generate action (generated === true) re-stamps it
    // via genStamp above.
    if (generated !== true) delete content.generatedAt
    await cookiePolicyRepository.updateContentByWebsiteId(
      req.params.websiteId,
      content,
    )
    policyId = existing.id
  }

  // Same reconcile as putSection: effectiveDate carries no image, but the merged
  // content still holds sibling sections' images, and the client sends usedImageIds.
  const keep = imageIdsFrom(JSON.stringify(content))
  for (const id of sanitizeIds(req.body.usedImageIds)) keep.add(id)
  await sweepOrphanImages(policyId, keep)

  return res
    .status(200)
    .json(
      new ApiResponse(200, { content }, 'cookie policy updated sucessfully'),
    )
})
