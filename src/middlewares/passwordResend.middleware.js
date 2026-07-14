import { hashToken } from '../utils/auth/index.js'
import { ApiError } from '../utils/response/index.js'
import * as passwordResetRepository from '../repositories/passwordReset.repository.js'
import { asyncHandler } from '../utils/async-handler.js'

/**
 * Resolve a password-reset token to its userId for the resend flow. Does not check expiry/isUsed
 * because the token is already expired by the time resend is triggered — the row only identifies
 * whom to email. On success attaches req.user = { id } and calls next().
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
