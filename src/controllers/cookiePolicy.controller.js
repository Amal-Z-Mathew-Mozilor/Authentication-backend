import db from '../db/index.js'
import ApiError from '../utils/api-error.js'
import ApiResponse from '../utils/api-response.js'
import { cookiePolicy, websites, policyImages } from '../models/index.js'
import { asyncHandler } from '../utils/async-handler.js'
import { and, eq, inArray } from 'drizzle-orm'
import {
  SECTIONS,
  imageIdsFrom,
  sanitizeIds,
  sweepOrphanImages,
  assertOwnedWebsite,
} from '../utils/cookiePolicy.js'
import { defaultCookieContent } from '../utils/defaultCookiePolicy.js'
import { renderPolicyHtml } from '../utils/policyHtml.js'
import { sendEmail, policyInstallEmail } from '../utils/mail.js'

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

// Build the SAVED policy as a self-contained HTML snippet (styles + heading + dates +
// sections + footer) with every referenced /pulse/images/<id> inlined as a base64 data
// URI so the snippet is portable (the /pulse/images URL wouldn't resolve on a foreign
// host). Shared by the "HTML format" export and the "send code to a teammate" email so
// the two are byte-identical. Assumes ownership was already asserted by the caller.
async function buildPolicyHtml(websiteId) {
  // Website url — used in the footer ("Cookie Policy generated for <url>").
  const [site] = await db
    .select({ url: websites.url })
    .from(websites)
    .where(eq(websites.id, websiteId))

  const [row] = await db
    .select({ id: cookiePolicy.id, content: cookiePolicy.content })
    .from(cookiePolicy)
    .where(eq(cookiePolicy.websiteId, websiteId))
  const content = row?.content || {}

  // Batch-load only the images actually referenced by the saved content, scoped to this
  // policy, and build id → data:URI. Buffer bytes (bytea) → base64.
  const imagesById = {}
  const ids = [...imageIdsFrom(JSON.stringify(content))]
  if (row?.id && ids.length) {
    const imgs = await db
      .select({
        id: policyImages.id,
        mime: policyImages.mime,
        data: policyImages.data,
      })
      .from(policyImages)
      .where(
        and(
          eq(policyImages.cookiePolicyId, row.id),
          inArray(policyImages.id, ids),
        ),
      )
    for (const img of imgs)
      imagesById[img.id.toLowerCase()] =
        `data:${img.mime};base64,${img.data.toString('base64')}`
  }

  const url = site?.url || ''
  return { html: renderPolicyHtml({ content, url, imagesById }), url }
}

// The "HTML format" export: the owner pastes the snippet onto their own site. Owner-scoped.
export const getCookiePolicyHtml = asyncHandler(async (req, res) => {
  await assertOwnedWebsite(req.params.websiteId, req.user.id)
  const { html } = await buildPolicyHtml(req.params.websiteId)
  return res
    .status(200)
    .json(new ApiResponse(200, { html }, 'cookie policy html generated sucessfully'))
})

// "Send code to a teammate": email the SAME snippet to a teammate so they can add it to
// the site. Owner-scoped; email validated by sendCodeValidator. sendEmail swallows
// transport errors (logs, never throws) — a mail outage does not 500 the request.
export const sendPolicyCode = asyncHandler(async (req, res) => {
  await assertOwnedWebsite(req.params.websiteId, req.user.id)
  const { html, url } = await buildPolicyHtml(req.params.websiteId)
  const { subject, html: emailHtml, text } = policyInstallEmail(url, html)
  await sendEmail({ email: req.body.email, subject, html: emailHtml, text })
  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'installation code sent sucessfully'))
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

  // A section counts as completed once it has been saved — server-derived (never
  // client-sent), persisted in the same jsonb so progress survives reload/resume.
  const completedSections = [
    ...new Set([...(existing?.content?.completedSections || []), section]),
  ]

  let content
  let policyId
  if (!existing) {
    content = { [section]: sectionData, completedSections }
    const [ins] = await db
      .insert(cookiePolicy)
      .values({ websiteId: req.params.websiteId, content })
      .returning({ id: cookiePolicy.id })
    policyId = ins.id
  } else {
    // Merge: preserve sibling sections, upsert only this one.
    content = {
      ...(existing.content || {}),
      [section]: sectionData,
      completedSections,
    }
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

// "Delete" the policy — reset its content to the default seed (the same state a
// freshly created website's policy has) and remove all of this policy's images.
// This is a RESET, not a row-removal: cookie_policy is 1:1 with a website, seeded
// at website create with no independent create path, so resetting keeps the
// invariant and lets "Create new cookie policy" reopen the wizard on the default
// template. (Deleting the website itself still hard-removes the row via the FK
// cascade.)
export const deleteCookiePolicy = asyncHandler(async (req, res) => {
  await assertOwnedWebsite(req.params.websiteId, req.user.id)
  const today = new Date().toISOString().slice(0, 10)
  const content = defaultCookieContent(today)

  const [existing] = await db
    .select({ id: cookiePolicy.id })
    .from(cookiePolicy)
    .where(eq(cookiePolicy.websiteId, req.params.websiteId))

  let policyId
  if (!existing) {
    const [ins] = await db
      .insert(cookiePolicy)
      .values({ websiteId: req.params.websiteId, content })
      .returning({ id: cookiePolicy.id })
    policyId = ins.id
  } else {
    await db
      .update(cookiePolicy)
      .set({ content })
      .where(eq(cookiePolicy.websiteId, req.params.websiteId))
    policyId = existing.id
  }

  // The default content references no images, so an empty keep-set sweeps every
  // image belonging to this policy.
  await sweepOrphanImages(policyId, new Set())

  return res
    .status(200)
    .json(new ApiResponse(200, { content }, 'cookie policy deleted sucessfully'))
})

// Policy-level metadata (not a section) — currently the effective date. Stored as a
// top-level key in the same content jsonb, merge-upserted so sections are preserved.
export const putPolicyMeta = asyncHandler(async (req, res) => {
  await assertOwnedWebsite(req.params.websiteId, req.user.id)
  const { effectiveDate = '', generated } = req.body

  // Marking the policy "generated" is the explicit final step (the "Generate
  // cookie policy" button). Stamp a server-derived timestamp — never trust a
  // client clock — so the UI can route a returning user straight to the preview.
  // Ordinary meta auto-saves omit `generated`, so they never set this.
  const genStamp =
    generated === true ? { generatedAt: new Date().toISOString() } : {}

  const [existing] = await db
    .select({ id: cookiePolicy.id, content: cookiePolicy.content })
    .from(cookiePolicy)
    .where(eq(cookiePolicy.websiteId, req.params.websiteId))

  let content
  let policyId
  if (!existing) {
    content = { effectiveDate, ...genStamp }
    const [ins] = await db
      .insert(cookiePolicy)
      .values({ websiteId: req.params.websiteId, content })
      .returning({ id: cookiePolicy.id })
    policyId = ins.id
  } else {
    content = { ...(existing.content || {}), effectiveDate, ...genStamp }
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
