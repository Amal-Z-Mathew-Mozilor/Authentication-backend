import db from '../db/index.js'
import { passwordReset } from '../models/index.js'
import { hashToken, tokenGeneration } from '../utils/token.js'
import ApiError from '../utils/api-error.js'
import { eq } from 'drizzle-orm'
/**
 * Validate an active password-reset token (exists, not expired, not used) before reset.
 * On success attaches req.user = { id, token: hashedToken } and calls next().
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.params.token - Raw reset token from the URL (hashed, then looked up in password_reset).
 * @param {import('express').Response} res - Unused.
 * @param {import('express').NextFunction} next - Called on success.
 * @returns {Promise<void>}
 * @throws {ApiError} 403 - No password_reset row matches the token.
 * @throws {ApiError} 401 - Token expired or already used.
 */
export const tokenValidation = async function (req, res, next) {
  const { token } = req.params
  const hashedToken = hashToken(token)
  const [user] = await db
    .select({
      id: passwordReset.userId,
      expiry: passwordReset.tokenExpiry,
      isUsed: passwordReset.isUsed,
    })
    .from(passwordReset)
    .where(eq(passwordReset.token, hashedToken))
  if (!user) {
    throw new ApiError(403, 'Invalid Token')
  }
  if (user.expiry < new Date()) {
    throw new ApiError(401, 'Token expired')
  }
  if (user.isUsed) {
    throw new ApiError(401, 'token already  used')
  }
  req.user = { id: user.id, token: hashedToken }
  next()
}
