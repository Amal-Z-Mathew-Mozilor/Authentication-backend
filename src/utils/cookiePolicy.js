import db from '../db/index.js'
import ApiError from './api-error.js'
import { websites, policyImages } from '../models/index.js'
import { and, eq, inArray } from 'drizzle-orm'
import { deleteObject } from './s3.js'

// Sections stored as sibling keys in the cookie_policy.content jsonb. Adding a new
// section (e.g. cookie preferences) is a one-line allowlist entry — no migration.
export const SECTIONS = ['aboutCookies', 'useOfCookies', 'cookiePreferences']

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

// Collect the ids of every /pulse/images/<uuid> referenced in a string (the saved
// content JSON). These images are "in use" and must be kept.
export function imageIdsFrom(str) {
  const ids = new Set()
  const re = new RegExp(`/pulse/images/(${UUID_RE.source})`, 'gi')
  for (const m of String(str).matchAll(re)) ids.add(m[1].toLowerCase())
  return ids
}

// Only trust well-formed UUIDs from the client; drop anything else.
export function sanitizeIds(arr) {
  if (!Array.isArray(arr)) return []
  const exact = new RegExp(`^${UUID_RE.source}$`, 'i')
  return arr
    .filter((x) => typeof x === 'string' && exact.test(x))
    .map((x) => x.toLowerCase())
}

// Mark-and-sweep: delete this policy's images that are no longer referenced by the
// saved content OR any live section editor (keepIds). Always scoped to this policy.
// Removes the S3 object first (best-effort — a transient S3 error must not block the
// save; a stray object is harmless), then the DB row.
export async function sweepOrphanImages(cookiePolicyId, keepIds) {
  const rows = await db
    .select({ id: policyImages.id, key: policyImages.key })
    .from(policyImages)
    .where(eq(policyImages.cookiePolicyId, cookiePolicyId))
  const orphans = rows.filter((r) => !keepIds.has(r.id.toLowerCase()))
  if (!orphans.length) return

  for (const o of orphans) {
    try {
      await deleteObject(o.key)
    } catch {
      /* best-effort: leave the object; DB row is still removed below */
    }
  }
  await db
    .delete(policyImages)
    .where(
      and(
        eq(policyImages.cookiePolicyId, cookiePolicyId),
        inArray(
          policyImages.id,
          orphans.map((o) => o.id),
        ),
      ),
    )
}

// Ownership: the cookie policy is reachable only through a website the user owns.
export async function assertOwnedWebsite(websiteId, userId) {
  const [site] = await db
    .select({ id: websites.id })
    .from(websites)
    .where(and(eq(websites.id, websiteId), eq(websites.userId, userId)))
  if (!site) throw new ApiError(404, 'website not found')
}
