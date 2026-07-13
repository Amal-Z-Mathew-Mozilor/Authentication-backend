import db from '../db/index.js'
import { websites, cookiePolicy } from '../models/index.js'
import { and, eq, desc } from 'drizzle-orm'

/**
 * List a user's websites (id, name, url) for duplicate checking.
 * @param {string} userId - The owning user's id.
 * @returns {Promise<Array<{ id: string, name: string, url: string }>>} All the user's websites.
 */
export function findByUserId(userId) {
  return db
    .select({ id: websites.id, name: websites.name, url: websites.url })
    .from(websites)
    .where(eq(websites.userId, userId))
}

/**
 * List a user's websites (full row) newest first.
 * @param {string} userId - The owning user's id.
 * @returns {Promise<Array<object>>} The user's websites, ordered by createdAt desc.
 */
export function listByUserId(userId) {
  return db
    .select({
      id: websites.id,
      name: websites.name,
      url: websites.url,
      createdAt: websites.createdAt,
      updatedAt: websites.updatedAt,
    })
    .from(websites)
    .where(eq(websites.userId, userId))
    .orderBy(desc(websites.createdAt))
}

/**
 * Find a website's id scoped to its owner (ownership check).
 * @param {string} websiteId - The website id.
 * @param {string} userId - The owning user's id.
 * @returns {Promise<Array<{ id: string }>>} Zero or one row.
 */
export function findIdByIdForUser(websiteId, userId) {
  return db
    .select({ id: websites.id })
    .from(websites)
    .where(and(eq(websites.id, websiteId), eq(websites.userId, userId)))
}

/**
 * Find a website's url by id (used by the policy HTML export footer).
 * @param {string} websiteId - The website id.
 * @returns {Promise<Array<{ url: string }>>} Zero or one row.
 */
export function findUrlById(websiteId) {
  return db
    .select({ url: websites.url })
    .from(websites)
    .where(eq(websites.id, websiteId))
}

/**
 * Create a website and seed its cookie_policy row atomically (one transaction).
 * @param {object} data
 * @param {string} data.name - Website name.
 * @param {string} data.url - Website url.
 * @param {string} data.userId - The owning user's id.
 * @param {object} data.policyContent - Seed content for the website's cookie_policy row.
 * @returns {Promise<{ id: string, name: string, url: string, createdAt: Date }>} The created website.
 */
export function createWithPolicy({ name, url, userId, policyContent }) {
  return db.transaction(async (tx) => {
    const [w] = await tx
      .insert(websites)
      .values({ name, url, userId })
      .returning({
        id: websites.id,
        name: websites.name,
        url: websites.url,
        createdAt: websites.createdAt,
      })
    await tx
      .insert(cookiePolicy)
      .values({ websiteId: w.id, content: policyContent })
    return w
  })
}

/**
 * Update a website's name and url, scoped to its owner.
 * @param {string} id - The website id.
 * @param {string} userId - The owning user's id.
 * @param {object} data
 * @param {string} data.name - New name.
 * @param {string} data.url - New url.
 * @returns {Promise<Array<{ id: string, name: string, url: string, updatedAt: Date }>>} The updated row (empty if not owned).
 */
export function updateByIdForUser(id, userId, { name, url }) {
  return db
    .update(websites)
    .set({ name, url })
    .where(and(eq(websites.id, id), eq(websites.userId, userId)))
    .returning({
      id: websites.id,
      name: websites.name,
      url: websites.url,
      updatedAt: websites.updatedAt,
    })
}

/**
 * Delete a website by id, scoped to its owner.
 * @param {string} id - The website id.
 * @param {string} userId - The owning user's id.
 * @returns {Promise<Array<{ id: string }>>} The deleted row's id (empty if not owned).
 */
export function deleteByIdForUser(id, userId) {
  return db
    .delete(websites)
    .where(and(eq(websites.id, id), eq(websites.userId, userId)))
    .returning({ id: websites.id })
}
