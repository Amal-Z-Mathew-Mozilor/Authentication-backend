import db from '../db/index.js'
import { passwordReset } from '../models/index.js'
import { eq } from 'drizzle-orm'

/**
 * Insert a password-reset token row.
 * @param {object} data
 * @param {string} data.userId - The owning user's id.
 * @param {string} data.token - The hashed reset token.
 * @param {Date} data.tokenExpiry - When the token expires.
 * @returns {Promise<void>}
 */
export function create({ userId, token, tokenExpiry }) {
  return db.insert(passwordReset).values({ userId, token, tokenExpiry })
}

/**
 * Find a reset token's user id, expiry, and used flag by hashed token.
 * @param {string} hashedToken - The hashed token to look up.
 * @returns {Promise<Array<{ id: string, expiry: Date, isUsed: boolean }>>} Zero or one row.
 */
export function findByToken(hashedToken) {
  return db
    .select({
      id: passwordReset.userId,
      expiry: passwordReset.tokenExpiry,
      isUsed: passwordReset.isUsed,
    })
    .from(passwordReset)
    .where(eq(passwordReset.token, hashedToken))
}

/**
 * Find only the user id for a hashed reset token (resend flow).
 * @param {string} hashedToken - The hashed token to look up.
 * @returns {Promise<Array<{ userId: string }>>} Zero or one row.
 */
export function findUserIdByToken(hashedToken) {
  return db
    .select({ userId: passwordReset.userId })
    .from(passwordReset)
    .where(eq(passwordReset.token, hashedToken))
}

/**
 * Mark a reset token as used.
 * @param {string} hashedToken - The hashed token to mark used.
 * @returns {Promise<void>}
 */
export function markUsed(hashedToken) {
  return db
    .update(passwordReset)
    .set({ isUsed: true })
    .where(eq(passwordReset.token, hashedToken))
}
