import db from '../db/index.js'
import { users } from '../models/index.js'
import { eq } from 'drizzle-orm'

/**
 * Find a user's id and email by email address.
 * @param {string} email - The email to look up.
 * @returns {Promise<Array<{ id: string, email: string }>>} Zero or one matching row.
 */
export function findByEmail(email) {
  return db
    .select({ id: users.userId, email: users.email })
    .from(users)
    .where(eq(users.email, email))
}

/**
 * Find the fields the login flow needs (lock state, verification, password hash) by email.
 * @param {string} email - The email to look up.
 * @returns {Promise<Array<{ id: string, locked: boolean, lockedUntil: Date|null, limit: number, verified: boolean, password: string }>>} Zero or one row.
 */
export function findAuthByEmail(email) {
  return db
    .select({
      id: users.userId,
      locked: users.isLocked,
      lockedUntil: users.lockedUntil,
      limit: users.failedLoginAttempts,
      verified: users.isVerified,
      password: users.password,
    })
    .from(users)
    .where(eq(users.email, email))
}

/**
 * Find a user's id and email by user id (the access-token payload lookup).
 * @param {string} userId - The user id.
 * @returns {Promise<Array<{ id: string, email: string }>>} Zero or one row.
 */
export function findIdAndEmailById(userId) {
  return db
    .select({ id: users.userId, email: users.email })
    .from(users)
    .where(eq(users.userId, userId))
}

/**
 * Find a user's password hash and email by id (reset-password credential check).
 * @param {string} userId - The user id.
 * @returns {Promise<Array<{ password: string, email: string }>>} Zero or one row.
 */
export function findCredentialsById(userId) {
  return db
    .select({ password: users.password, email: users.email })
    .from(users)
    .where(eq(users.userId, userId))
}

/**
 * Find a user's password hash by id (change-password check).
 * @param {string} userId - The user id.
 * @returns {Promise<Array<{ password: string }>>} Zero or one row.
 */
export function findPasswordById(userId) {
  return db
    .select({ password: users.password })
    .from(users)
    .where(eq(users.userId, userId))
}

/**
 * Find a user's email and verified flag by id (resend-verification check).
 * @param {string} userId - The user id.
 * @returns {Promise<Array<{ email: string, verified: boolean }>>} Zero or one row.
 */
export function findEmailAndVerifiedById(userId) {
  return db
    .select({ email: users.email, verified: users.isVerified })
    .from(users)
    .where(eq(users.userId, userId))
}

/**
 * Find a user's email by id (reset-resend lookup).
 * @param {string} userId - The user id.
 * @returns {Promise<Array<{ email: string }>>} Zero or one row.
 */
export function findEmailById(userId) {
  return db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.userId, userId))
}

/**
 * Insert a new user with a hashed password.
 * @param {object} data
 * @param {string} data.email - The user's email.
 * @param {string} data.password - The bcrypt password hash.
 * @returns {Promise<Array<{ id: string }>>} The inserted row's id.
 */
export function createUser({ email, password }) {
  return db
    .insert(users)
    .values({ password, email })
    .returning({ id: users.userId })
}

/**
 * Mark a user's email as verified.
 * @param {string} userId - The user id.
 * @returns {Promise<void>}
 */
export function markVerified(userId) {
  return db
    .update(users)
    .set({ isVerified: true })
    .where(eq(users.userId, userId))
}

/**
 * Clear a user's lock (unlock, reset lockedUntil and failed-attempt counter).
 * @param {string} userId - The user id.
 * @returns {Promise<void>}
 */
export function clearLock(userId) {
  return db
    .update(users)
    .set({ isLocked: false, lockedUntil: null, failedLoginAttempts: 0 })
    .where(eq(users.userId, userId))
}

/**
 * Apply a login lockout: set the failed-attempt count, lock flag, and lock expiry.
 * @param {string} userId - The user id.
 * @param {object} data
 * @param {number} data.failedLoginAttempts - New failed-attempt count.
 * @param {boolean} data.isLocked - Lock flag.
 * @param {Date} data.lockedUntil - When the lock expires.
 * @returns {Promise<void>}
 */
export function applyLock(
  userId,
  { failedLoginAttempts, isLocked, lockedUntil },
) {
  return db
    .update(users)
    .set({ failedLoginAttempts, isLocked, lockedUntil })
    .where(eq(users.userId, userId))
}

/**
 * Set a user's failed-login-attempt counter to a specific value.
 * @param {string} userId - The user id.
 * @param {number} count - The new failed-attempt count.
 * @returns {Promise<void>}
 */
export function setFailedAttempts(userId, count) {
  return db
    .update(users)
    .set({ failedLoginAttempts: count })
    .where(eq(users.userId, userId))
}

/**
 * Reset a user's failed-login-attempt counter to zero (on successful login).
 * @param {string} userId - The user id.
 * @returns {Promise<void>}
 */
export function resetFailedAttempts(userId) {
  return db
    .update(users)
    .set({ failedLoginAttempts: 0 })
    .where(eq(users.userId, userId))
}

/**
 * Update a user's password hash.
 * @param {string} userId - The user id.
 * @param {string} hash - The new bcrypt password hash.
 * @returns {Promise<void>}
 */
export function updatePassword(userId, hash) {
  return db
    .update(users)
    .set({ password: hash })
    .where(eq(users.userId, userId))
}
