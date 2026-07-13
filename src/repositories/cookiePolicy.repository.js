import db from '../db/index.js'
import { cookiePolicy } from '../models/index.js'
import { eq } from 'drizzle-orm'

/**
 * Find a policy's content and last-updated timestamp by website id.
 * @param {string} websiteId - The owning website id.
 * @returns {Promise<Array<{ content: object, updatedAt: Date }>>} Zero or one row.
 */
export function findContentByWebsiteId(websiteId) {
  return db
    .select({
      content: cookiePolicy.content,
      updatedAt: cookiePolicy.updatedAt,
    })
    .from(cookiePolicy)
    .where(eq(cookiePolicy.websiteId, websiteId))
}

/**
 * Find a policy's id, content, and updatedAt by website id (HTML export).
 * @param {string} websiteId - The owning website id.
 * @returns {Promise<Array<{ id: string, content: object, updatedAt: Date }>>} Zero or one row.
 */
export function findByWebsiteId(websiteId) {
  return db
    .select({
      id: cookiePolicy.id,
      content: cookiePolicy.content,
      updatedAt: cookiePolicy.updatedAt,
    })
    .from(cookiePolicy)
    .where(eq(cookiePolicy.websiteId, websiteId))
}

/**
 * Find a policy's id and content by website id (section/meta upserts).
 * @param {string} websiteId - The owning website id.
 * @returns {Promise<Array<{ id: string, content: object }>>} Zero or one row.
 */
export function findIdAndContentByWebsiteId(websiteId) {
  return db
    .select({ id: cookiePolicy.id, content: cookiePolicy.content })
    .from(cookiePolicy)
    .where(eq(cookiePolicy.websiteId, websiteId))
}

/**
 * Find a policy's id by website id.
 * @param {string} websiteId - The owning website id.
 * @returns {Promise<Array<{ id: string }>>} Zero or one row.
 */
export function findIdByWebsiteId(websiteId) {
  return db
    .select({ id: cookiePolicy.id })
    .from(cookiePolicy)
    .where(eq(cookiePolicy.websiteId, websiteId))
}

/**
 * Insert a cookie_policy row for a website.
 * @param {object} data
 * @param {string} data.websiteId - The owning website id.
 * @param {object} data.content - The policy content jsonb.
 * @returns {Promise<Array<{ id: string }>>} The inserted row's id.
 */
export function create({ websiteId, content }) {
  return db
    .insert(cookiePolicy)
    .values({ websiteId, content })
    .returning({ id: cookiePolicy.id })
}

/**
 * Overwrite a policy's content jsonb by website id.
 * @param {string} websiteId - The owning website id.
 * @param {object} content - The new content jsonb.
 * @returns {Promise<void>}
 */
export function updateContentByWebsiteId(websiteId, content) {
  return db
    .update(cookiePolicy)
    .set({ content })
    .where(eq(cookiePolicy.websiteId, websiteId))
}
