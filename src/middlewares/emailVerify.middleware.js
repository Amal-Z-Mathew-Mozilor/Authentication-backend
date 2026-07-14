import { hashToken } from '../utils/auth/index.js'
import { ApiError } from '../utils/response/index.js'
import * as emailVerificationRepository from '../repositories/emailVerification.repository.js'
import { asyncHandler } from '../utils/async-handler.js'

/**
 * Resolve an email-verification token to its userId for the resend flow. Does not check
 * expiry/isUsed because the token is already expired by the time resend is triggered — the row
 * only identifies whom to email. On success attaches req.user = { id } and calls next().
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
  const [row] = await emailVerificationRepository.findUserIdByToken(hashedToken)
  if (!row) {
    throw new ApiError(403, 'invalid token')
  }
  req.user = { id: row.userId }
  next()
})
