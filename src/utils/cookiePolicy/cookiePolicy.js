import ApiError from '../response/api-error.js'
import * as websiteRepository from '../../repositories/website.repository.js'
import * as policyImageRepository from '../../repositories/policyImage.repository.js'
import { deleteObject } from '../aws/s3.js'

// Sections stored as sibling keys in the cookie_policy.content jsonb. Adding a new
// section (e.g. cookie preferences) is a one-line allowlist entry — no migration.
export const SECTIONS = ['aboutCookies', 'useOfCookies', 'cookiePreferences']

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * Collect the ids of every /pulse/images/<uuid> referenced in a string (the saved content JSON).
 * @param {string} str - Content/HTML to scan (coerced to string).
 * @returns {Set<string>} The referenced image ids, lowercased and deduped.
 */
export function imageIdsFrom(str) {
  const ids = new Set()
  const re = new RegExp(`/pulse/images/(${UUID_RE.source})`, 'gi')
  for (const m of String(str).matchAll(re)) ids.add(m[1].toLowerCase())
  return ids
}

/**
 * Keep only well-formed UUID strings from a client-supplied array and lowercase them.
 * @param {unknown} arr - Candidate array of ids (anything non-array yields []).
 * @returns {string[]} The subset that are valid UUIDs, lowercased.
 */
export function sanitizeIds(arr) {
  if (!Array.isArray(arr)) return []
  const exact = new RegExp(`^${UUID_RE.source}$`, 'i')
  return arr
    .filter((x) => typeof x === 'string' && exact.test(x))
    .map((x) => x.toLowerCase())
}

/**
 * Delete this policy's images no longer referenced by the saved content or any live editor.
 * Removes the S3 object first, then the DB row; best-effort per object, so a transient S3 delete error does not block the DB row cleanup.
 * @param {string} cookiePolicyId - The owning cookie_policy row id (scopes the sweep).
 * @param {Set<string>} keepIds - Lowercased image ids still in use (content ∪ usedImageIds).
 * @returns {Promise<void>}
 */
export async function sweepOrphanImages(cookiePolicyId, keepIds) {
  const rows = await policyImageRepository.findByPolicyId(cookiePolicyId)
  const orphans = rows.filter((r) => !keepIds.has(r.id.toLowerCase()))
  if (!orphans.length) return

  for (const o of orphans) {
    try {
      await deleteObject(o.key)
    } catch {
      /* best-effort: leave the object; DB row is still removed below */
    }
  }
  await policyImageRepository.deleteByIdsForPolicy(
    cookiePolicyId,
    orphans.map((o) => o.id),
  )
}

/**
 * Assert the website exists and is owned by the given user (reachability gate for its policy).
 * @param {string} websiteId - Website id from the route.
 * @param {string} userId - Authenticated req.user.id.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 - Website does not exist or is not owned by the user.
 */
export async function assertOwnedWebsite(websiteId, userId) {
  const [site] = await websiteRepository.findIdByIdForUser(websiteId, userId)
  if (!site) throw new ApiError(404, 'website not found')
}
