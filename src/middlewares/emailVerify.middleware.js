import db from '../db/index.js'
import { emailVerify } from '../models/index.js'
import { hashToken } from '../utils/token.js'
import ApiError from '../utils/api-error.js'
import { eq } from 'drizzle-orm'
import { asyncHandler } from '../utils/async-handler.js'

// Resolves an email-verification token (from the URL) to its userId so the resend
// controller knows whom to email. Does not check expiry/isUsed — the row is only used
// to identify the user (the token is expired by the time resend is triggered).
/**
 * Resolve an email-verification token to its userId for the resend flow (no expiry/isUsed check).
 * On success attaches req.user = { id } and calls next().
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.params.token - Raw email-verification token from the URL (hashed, then looked up in email_verify).
 * @param {import('express').Response} res - Unused.
 * @param {import('express').NextFunction} next - Called on success.
 * @returns {Promise<void>}
 * @throws {ApiError} 403 - No email_verify row matches the token.
 */
export const emailTokenValidation = asyncHandler(async (req, res, next) => {
  const { token } = req.params
  const hashedToken = hashToken(token)
  const [row] = await db
    .select({ userId: emailVerify.userId })
    .from(emailVerify)
    .where(eq(emailVerify.token, hashedToken))
  if (!row) {
    throw new ApiError(403, 'invalid token')
  }
  req.user = { id: row.userId }
  next()
})
