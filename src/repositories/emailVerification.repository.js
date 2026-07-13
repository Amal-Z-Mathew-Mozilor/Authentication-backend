import db from '../db/index.js'
import { emailVerify } from '../models/index.js'
import { eq } from 'drizzle-orm'

/**
 * Insert an email-verification token row.
 * @param {object} data
 * @param {string} data.token - The hashed verification token.
 * @param {Date} data.tokenExpiry - When the token expires.
 * @param {string} data.userId - The owning user's id.
 * @returns {Promise<void>}
 */
export function create({ token, tokenExpiry, userId }) {
  return db.insert(emailVerify).values({ token, tokenExpiry, userId })
}

/**
 * Find a verification token's user id, expiry, and used flag by hashed token.
 * @param {string} hashedToken - The hashed token to look up.
 * @returns {Promise<Array<{ id: string, expiry: Date, isUsed: boolean }>>} Zero or one row.
 */
export function findByToken(hashedToken) {
  return db
    .select({
      id: emailVerify.userId,
      expiry: emailVerify.tokenExpiry,
      isUsed: emailVerify.isUsed,
    })
    .from(emailVerify)
    .where(eq(emailVerify.token, hashedToken))
}

/**
 * Find only the user id for a hashed verification token (resend flow).
 * @param {string} hashedToken - The hashed token to look up.
 * @returns {Promise<Array<{ userId: string }>>} Zero or one row.
 */
export function findUserIdByToken(hashedToken) {
  return db
    .select({ userId: emailVerify.userId })
    .from(emailVerify)
    .where(eq(emailVerify.token, hashedToken))
}

/**
 * Mark a verification token as used.
 * @param {string} hashedToken - The hashed token to mark used.
 * @returns {Promise<void>}
 */
export function markUsed(hashedToken) {
  return db
    .update(emailVerify)
    .set({ isUsed: true })
    .where(eq(emailVerify.token, hashedToken))
}
