import { hashToken } from '../utils/token.js'
import ApiError from '../utils/api-error.js'
import * as passwordResetRepository from '../repositories/passwordReset.repository.js'
import { asyncHandler } from '../utils/async-handler.js'

// Resolves a password-reset token (from the URL) to its userId so the resend controller
// knows whom to email. Does not check expiry/isUsed — the row is only used to identify the
// user (the token is expired by the time resend is triggered).
/**
 * Resolve a password-reset token to its userId for the resend flow (no expiry/isUsed check).
 * On success attaches req.user = { id } and calls next().
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.params.token - Raw reset token from the URL (hashed, then looked up in password_reset).
 * @param {import('express').Response} res - Unused.
 * @param {import('express').NextFunction} next - Called on success.
 * @returns {Promise<void>}
 * @throws {ApiError} 403 - No password_reset row matches the token.
 */
export const resetTokenResolve = asyncHandler(async (req, res, next) => {
  const { token } = req.params
  const hashedToken = hashToken(token)
  const [row] = await passwordResetRepository.findUserIdByToken(hashedToken)
  if (!row) {
    throw new ApiError(403, 'invalid token')
  }
  req.user = { id: row.userId }
  next()
})
