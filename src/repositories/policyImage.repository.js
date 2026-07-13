import db from '../db/index.js'
import { policyImages, cookiePolicy, websites } from '../models/index.js'
import { and, eq, inArray } from 'drizzle-orm'

/**
 * Find selected images (id, key, mime) for a policy, filtered to a set of ids.
 * @param {string} cookiePolicyId - The owning cookie_policy id.
 * @param {string[]} ids - Image ids to include.
 * @returns {Promise<Array<{ id: string, key: string, mime: string }>>} Matching image rows.
 */
export function findByPolicyAndIds(cookiePolicyId, ids) {
  return db
    .select({
      id: policyImages.id,
      key: policyImages.key,
      mime: policyImages.mime,
    })
    .from(policyImages)
    .where(
      and(
        eq(policyImages.cookiePolicyId, cookiePolicyId),
        inArray(policyImages.id, ids),
      ),
    )
}

/**
 * List a policy's images (id, key) — used by the orphan sweep.
 * @param {string} cookiePolicyId - The owning cookie_policy id.
 * @returns {Promise<Array<{ id: string, key: string }>>} All the policy's images.
 */
export function findByPolicyId(cookiePolicyId) {
  return db
    .select({ id: policyImages.id, key: policyImages.key })
    .from(policyImages)
    .where(eq(policyImages.cookiePolicyId, cookiePolicyId))
}

/**
 * Resolve an image's S3 key by id, scoped to the requesting owner (3-table join).
 * @param {string} imageId - The image id.
 * @param {string} userId - The requesting user's id.
 * @returns {Promise<Array<{ key: string }>>} Zero or one row (empty if missing or not owned).
 */
export function findKeyByIdForUser(imageId, userId) {
  return db
    .select({ key: policyImages.key })
    .from(policyImages)
    .innerJoin(cookiePolicy, eq(policyImages.cookiePolicyId, cookiePolicy.id))
    .innerJoin(websites, eq(cookiePolicy.websiteId, websites.id))
    .where(and(eq(policyImages.id, imageId), eq(websites.userId, userId)))
}

/**
 * Insert a policy image row (the S3 key + metadata; not the bytes).
 * @param {object} data
 * @param {string} data.cookiePolicyId - The owning cookie_policy id.
 * @param {string} data.key - The S3 object key.
 * @param {string} data.mime - The image mime type.
 * @param {number} data.byteSize - The image size in bytes.
 * @returns {Promise<Array<{ id: string }>>} The inserted row's id.
 */
export function create({ cookiePolicyId, key, mime, byteSize }) {
  return db
    .insert(policyImages)
    .values({ cookiePolicyId, key, mime, byteSize })
    .returning({ id: policyImages.id })
}

/**
 * Delete a set of a policy's image rows by id (the orphan sweep).
 * @param {string} cookiePolicyId - The owning cookie_policy id.
 * @param {string[]} ids - Image ids to delete.
 * @returns {Promise<void>}
 */
export function deleteByIdsForPolicy(cookiePolicyId, ids) {
  return db
    .delete(policyImages)
    .where(
      and(
        eq(policyImages.cookiePolicyId, cookiePolicyId),
        inArray(policyImages.id, ids),
      ),
    )
}
