import ApiError from '../utils/api-error.js'
import ApiResponse from '../utils/api-response.js'
import {
  emailVerification,
  passwordResetVerification,
  sendEmail,
} from '../utils/mail.js'
import { hashPassword, verifyPassword } from '../utils/password.js'
import { hashToken, tokenGeneration } from '../utils/token.js'
import * as userRepository from '../repositories/user.repository.js'
import * as emailVerificationRepository from '../repositories/emailVerification.repository.js'
import * as passwordResetRepository from '../repositories/passwordReset.repository.js'
import { asyncHandler } from '../utils/async-handler.js'
import { acessSign, refreshSign, verifyRefresh } from '../utils/jwt.js'
import { redisClient } from '../db/redis.js'
import { resolveResetBase } from '../utils/resetBase.js'
import { resolveVerifyBase } from '../utils/verifyBase.js'
import { clearAuthCookies } from '../utils/cookies.js'
import jwt from 'jsonwebtoken'

// Environment configuration — all process.env reads live here at the top of the file.
const REFRESH_EXPIRY_SECONDS =
  Number(process.env.REFRESH_EXPIRY_SECONDS) || 604800
const COOKIE_SAMESITE = process.env.COOKIE_SAMESITE || 'lax'
const NODE_ENV = process.env.NODE_ENV
/**
 * Register a new user, hash their password, and email an email-verification link.
 * @param {import('express').Request} req - The Express request.
 * @param {object} req.body - Request body.
 * @param {string} req.body.email - New user's email address.
 * @param {string} req.body.password - New user's plaintext password (hashed before storage).
 * @param {string} req.body.verifyBase - Client email-link base (validated against the allowlist).
 * @param {import('express').Response} res - Sends 201 with an empty data envelope.
 * @returns {Promise<void>}
 * @throws {ApiError} 409 - Email already exists.
 */
export const signup = asyncHandler(async (req, res) => {
  const { email, password, verifyBase } = req.body
  const base = resolveVerifyBase(verifyBase)
  const [existing] = await userRepository.findByEmail(email)
  if (existing) {
    throw new ApiError(409, 'email already exist')
  }
  const hash = await hashPassword(password)
  const [user] = await userRepository.createUser({ email, password: hash })
  const { unhashedToken, hashedToken, tokenExpiry } = tokenGeneration()
  await emailVerificationRepository.create({
    token: hashedToken,
    tokenExpiry,
    userId: user.id,
  })
  await sendEmail({
    email: email,
    subject: 'please verify your email',
    emailContent: emailVerification('there', `${base}/${unhashedToken}`),
  })
  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        {},
        'Account created successfully. Please verify your email.',
      ),
    )
})
/**
 * Verify a user's email from the token, mark them verified, and start a session by setting auth cookies.
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.params.token - Raw email-verification token from the URL.
 * @param {import('express').Response} res - Sets accessToken/refreshToken cookies; sends 200.
 * @returns {Promise<void>}
 * @throws {ApiError} 403 - Invalid token (no matching record).
 * @throws {ApiError} 401 - Token expired or already used.
 */
export const verifyMail = asyncHandler(async (req, res) => {
  const { token } = req.params
  const hashedToken = hashToken(token)
  const [user] = await emailVerificationRepository.findByToken(hashedToken)
  if (!user) {
    throw new ApiError(403, 'Invalid Token')
  }
  if (user.expiry < new Date()) {
    throw new ApiError(401, 'Token expired')
  }
  if (user.isUsed) {
    throw new ApiError(401, 'token already used')
  }
  await emailVerificationRepository.markUsed(hashedToken)
  await userRepository.markVerified(user.id)
  const accessToken = await acessSign(user.id)
  const refreshToken = await refreshSign(user.id)
  // initialize the per-user iat cutoff for this new session (NX = don't move an existing cutoff)
  const { iat } = jwt.decode(accessToken)
  await redisClient.set(`session:iat:${user.id}`, String(iat), {
    NX: true,
    EX: REFRESH_EXPIRY_SECONDS,
  })
  const sameSite = COOKIE_SAMESITE
  const options = {
    httpOnly: true,
    secure: NODE_ENV === 'production' || sameSite === 'none',
    sameSite,
  }
  return res
    .status(200)
    .cookie('accessToken', accessToken, options)
    .cookie('refreshToken', refreshToken, options)
    .json(new ApiResponse(200, {}, 'verified'))
})
/**
 * Email a password-reset link when the account exists, always responding 200 so account existence never leaks.
 * @param {import('express').Request} req - The Express request.
 * @param {object} req.body - Request body.
 * @param {string} req.body.email - Account email to send the reset link to.
 * @param {string} req.body.resetBase - Client email-link base (validated against the allowlist).
 * @param {import('express').Response} res - Sends 200 with a generic message.
 * @returns {Promise<void>}
 */
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email, resetBase } = req.body
  const base = resolveResetBase(resetBase)
  const [user] = await userRepository.findByEmail(email)
  if (!user) {
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          {},
          'If the email exists, a reset link has been sent',
        ),
      )
  }
  const { unhashedToken, hashedToken, tokenExpiry } = tokenGeneration()
  await passwordResetRepository.create({
    userId: user.id,
    token: hashedToken,
    tokenExpiry,
  })
  await sendEmail({
    email: user.email,
    subject: 'To reset your password please verify your email',
    emailContent: passwordResetVerification(
      'there',
      `${base}/${unhashedToken}`,
    ),
  })
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        {},
        'If the email exists, a reset link has been sent',
      ),
    )
})
/**
 * Confirm a password-reset token is valid without consuming it (the token is validated by upstream middleware).
 * @param {import('express').Request} req - Unused; the token was validated by the tokenValidation middleware.
 * @param {import('express').Response} res - Sends 200 with "valid".
 * @returns {Promise<void>}
 */
export const checkResetToken = asyncHandler(async (req, res) => {
  return res.status(200).json(new ApiResponse(200, {}, 'valid'))
})
/**
 * Reset the authenticated user's password to a new value and mark the reset token used.
 * @param {import('express').Request} req - The Express request.
 * @param {object} req.body - Request body.
 * @param {string} req.body.newPassword - The new password.
 * @param {string} req.body.confirmPassword - Must match newPassword.
 * @param {string} req.body.email - Account email (must match the token's user).
 * @param {string} req.user.id - User id set by the tokenValidation middleware.
 * @param {string} req.user.token - Hashed reset token set by the tokenValidation middleware.
 * @param {import('express').Response} res - Sends 200 on success.
 * @returns {Promise<void>}
 * @throws {ApiError} 400 - Passwords don't match, user doesn't exist, new password equals the old one, or email mismatch.
 */
export const resetPassword = asyncHandler(async (req, res) => {
  const { newPassword, confirmPassword, email } = req.body
  if (newPassword != confirmPassword) {
    throw new ApiError(400, "Passwords doesn't match")
  }

  const id = req.user.id
  const [user] = await userRepository.findCredentialsById(id)
  if (!user) {
    throw new ApiError(400, "user doesn't exist")
  }
  const result = await verifyPassword(newPassword, user.password)
  if (result) {
    throw new ApiError(400, 'password cannot be same as old password')
  }
  if (email != user.email) {
    throw new ApiError(400, 'invalid credential')
  }
  const hash = await hashPassword(newPassword)
  await userRepository.updatePassword(id, hash)
  await passwordResetRepository.markUsed(req.user.token)
  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'password updated sucessfully'))
})
/**
 * Authenticate credentials, enforce per-account and per-IP lockout, and start a session by setting auth cookies.
 * @param {import('express').Request} req - The Express request.
 * @param {object} req.body - Request body.
 * @param {string} req.body.email - Account email.
 * @param {string} req.body.password - Account password.
 * @param {string} req.ip - Client IP for the per-IP rate limiter.
 * @param {import('express').Response} res - Sets accessToken/refreshToken cookies; sends 200.
 * @returns {Promise<void>}
 * @throws {ApiError} 429 - Too many login attempts per IP, or account locked (retryAfter provided).
 * @throws {ApiError} 401 - Invalid credentials.
 * @throws {ApiError} 403 - Email not verified.
 */
export const login = asyncHandler(async (req, res) => {
  const MAX_ATTEMPTS = 5
  const MAX_IP_ATTEMPTS = 10
  const key = `login:ip:${req.ip}`
  const { email, password } = req.body
  const [user] = await userRepository.findAuthByEmail(email)
  if (!user) {
    const attempts = await redisClient.incr(key)

    if (attempts >= MAX_IP_ATTEMPTS) {
      const ttl = await redisClient.ttl(key)

      throw new ApiError(429, 'Too many login attempts.', {
        retryAfter: ttl,
      })
    }
    throw new ApiError(401, 'invalid credential')
  }
  if (user.locked) {
    if (user.lockedUntil > new Date()) {
      const remainingTime = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / 1000,
      )
      throw new ApiError(429, 'Account is locked. Too many failed attempts.', {
        retryAfter: remainingTime,
      })
    }
    await userRepository.clearLock(user.id)
    user.limit = 0
  }
  const result = await verifyPassword(password, user.password)
  if (!result) {
    const limit = user.limit + 1

    const attempt = await redisClient.incr(key)
    if (limit >= MAX_ATTEMPTS || attempt >= MAX_IP_ATTEMPTS) {
      let remainingTime = 0
      if (limit >= MAX_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + 2 * 60 * 1000)

        await userRepository.applyLock(user.id, {
          failedLoginAttempts: limit,
          isLocked: true,
          lockedUntil,
        })

        remainingTime = Math.ceil((lockedUntil.getTime() - Date.now()) / 1000)
      }

      if (attempt >= MAX_IP_ATTEMPTS) {
        const ttl = await redisClient.ttl(key)

        throw new ApiError(429, 'Too many login attempts.', {
          retryAfter: ttl,
        })
      }
      throw new ApiError(429, 'Account is locked. Too many failed attempts.', {
        retryAfter: remainingTime,
      })
    }

    await userRepository.setFailedAttempts(user.id, limit)

    throw new ApiError(401, 'Invalid credentials')
  }
  if (!user.verified) {
    throw new ApiError(403, 'pls verify email')
  }
  await redisClient.del(key)
  await userRepository.resetFailedAttempts(user.id)
  const accessToken = await acessSign(user.id)
  const refreshToken = await refreshSign(user.id)
  // initialize the per-user iat cutoff for this new session (NX = don't move an existing cutoff)
  const { iat } = jwt.decode(accessToken)
  await redisClient.set(`session:iat:${user.id}`, String(iat), {
    NX: true,
    EX: REFRESH_EXPIRY_SECONDS,
  })
  const sameSite = COOKIE_SAMESITE
  const options = {
    httpOnly: true,
    secure: NODE_ENV === 'production' || sameSite === 'none',
    sameSite,
  }
  return res
    .status(200)
    .cookie('accessToken', accessToken, options)
    .cookie('refreshToken', refreshToken, options)
    .json(new ApiResponse(200, {}, 'login sucessfull'))
})
/**
 * Revoke the current session by deleting the refresh token, blacklisting the access token jti, and clearing cookies.
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.cookies.refreshToken - Refresh-token cookie (deleted from the Redis store).
 * @param {number} req.user.exp - Access-token expiry (set by jwtValidation; used for the blacklist TTL).
 * @param {string} req.user.jti - Access-token id to blacklist (set by jwtValidation).
 * @param {import('express').Response} res - Clears auth cookies; sends 200.
 * @returns {Promise<void>}
 * @throws {ApiError} 401 - Refresh token missing from the Redis store (invalid token).
 */
export const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.cookies
  const token = await redisClient.get(`refresh:${refreshToken}`)
  if (!token) {
    throw new ApiError(401, 'invalid token')
  }
  await redisClient.del(`refresh:${refreshToken}`)
  const ttl = req.user.exp - Math.floor(Date.now() / 1000)
  await redisClient.set(`blacklist:${req.user.jti}`, 'true', { EX: ttl })
  // cutoff key is left in place (self-expires via TTL); only clear the cookies.
  clearAuthCookies(res)
  return res.status(200).json(new ApiResponse(200, {}, 'logout sucessful'))
})
/**
 * Rotate the refresh token: verify it, enforce the session iat cutoff, and issue a fresh access+refresh pair.
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.cookies.refreshToken - Refresh-token cookie to rotate.
 * @param {import('express').Response} res - Sets new accessToken/refreshToken cookies; sends 200.
 * @returns {Promise<void>}
 * @throws {ApiError} 401 - Refresh token missing, invalid, or issued before the session cutoff (session invalidated).
 */
export const rotateToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.cookies
  if (!refreshToken) {
    throw new ApiError(401, 'Refresh token missing')
  }
  let decoded
  try {
    decoded = await verifyRefresh(refreshToken)
  } catch (err) {
    throw new ApiError(401, 'invalid token')
  }
  // cutoff guard — a refresh token issued before the user's cutoff must not mint a fresh token
  const cutoff = await redisClient.get(`session:iat:${decoded.id}`)
  if (cutoff && decoded.iat < Number(cutoff)) {
    await redisClient.del(`refresh:${refreshToken}`)
    clearAuthCookies(res)
    throw new ApiError(401, 'Session invalidated, please login again')
  }
  await redisClient.del(`refresh:${refreshToken}`)
  const accessToken = await acessSign(decoded.id)
  const refresh = await refreshSign(decoded.id)
  // extend the cutoff key's TTL for this active session (value unchanged); no-op if absent
  await redisClient.expire(`session:iat:${decoded.id}`, REFRESH_EXPIRY_SECONDS)
  const sameSite = COOKIE_SAMESITE
  const options = {
    httpOnly: true,
    secure: NODE_ENV === 'production' || sameSite === 'none',
    sameSite,
  }
  return res
    .status(200)
    .cookie('accessToken', accessToken, options)
    .cookie('refreshToken', refresh, options)
    .json(new ApiResponse(200, {}, 'token rotated sucessfully'))
})
/**
 * Change the authenticated user's password and invalidate all existing sessions by bumping the iat cutoff.
 * @param {import('express').Request} req - The Express request.
 * @param {object} req.body - Request body.
 * @param {string} req.body.oldPassword - Current password.
 * @param {string} req.body.newPassword - The new password.
 * @param {string} req.body.confirmPassword - Must match newPassword.
 * @param {string} req.user.id - Authenticated user id (set by jwtValidation).
 * @param {import('express').Response} res - Sends 200 on success.
 * @returns {Promise<void>}
 * @throws {ApiError} 400 - Old password mismatch, new/confirm mismatch, or new password equals the old one.
 */
export const changePassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword, confirmPassword } = req.body
  const [user] = await userRepository.findPasswordById(req.user.id)
  const result = await verifyPassword(oldPassword, user.password)
  if (!result) {
    throw new ApiError(400, 'old password doesnt match')
  }

  if (confirmPassword != newPassword) {
    throw new ApiError(400, 'new and confirm password are wrong')
  }
  const same = await verifyPassword(newPassword, user.password)
  if (same) {
    throw new ApiError(400, 'new password must not be same as old one')
  }
  const hash = await hashPassword(newPassword)
  await userRepository.updatePassword(req.user.id, hash)
  // bump the cutoff to now → every existing access/refresh token (iat < now) is invalidated,
  // logging the user out of every browser/device on their next request.
  const now = Math.floor(Date.now() / 1000)
  await redisClient.set(`session:iat:${req.user.id}`, String(now), {
    EX: REFRESH_EXPIRY_SECONDS,
  })
  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'password reseted sucessfully'))
})
/**
 * Return the authenticated user's email, confirming the session is valid.
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.user.email - Authenticated user's email (set by jwtValidation).
 * @param {import('express').Response} res - Sends 200 with the email as data.
 * @returns {Promise<void>}
 */
export const me = asyncHandler(async (req, res) => {
  const { email } = req.user
  return res
    .status(200)
    .json(new ApiResponse(200, email, 'user authenticated sucessfully'))
})
/**
 * Re-issue an email-verification token and resend the verification email to the authenticated user.
 * @param {import('express').Request} req - The Express request.
 * @param {object} [req.body] - Request body.
 * @param {string} [req.body.verifyBase] - Client email-link base (validated against the allowlist).
 * @param {string} req.user.id - Authenticated user id (set by jwtValidation).
 * @param {import('express').Response} res - Sends 200 on success.
 * @returns {Promise<void>}
 * @throws {ApiError} 400 - User doesn't exist.
 * @throws {ApiError} 409 - Email already verified.
 */
export const resendVerification = asyncHandler(async (req, res) => {
  const id = req.user.id
  const base = resolveVerifyBase(req.body?.verifyBase)
  const [user] = await userRepository.findEmailAndVerifiedById(id)
  if (!user) {
    throw new ApiError(400, "user doesn't exist")
  }
  if (user.verified) {
    throw new ApiError(409, 'email already verified')
  }
  const { unhashedToken, hashedToken, tokenExpiry } = tokenGeneration()
  await emailVerificationRepository.create({
    token: hashedToken,
    tokenExpiry,
    userId: id,
  })
  await sendEmail({
    email: user.email,
    subject: 'please verify your email',
    emailContent: emailVerification('there', `${base}/${unhashedToken}`),
  })
  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'A new verification email has been sent.'))
})
/**
 * Re-issue a password-reset token and resend the reset email to the authenticated user.
 * @param {import('express').Request} req - The Express request.
 * @param {object} [req.body] - Request body.
 * @param {string} [req.body.resetBase] - Client email-link base (validated against the allowlist).
 * @param {string} req.user.id - Authenticated user id (set by jwtValidation).
 * @param {import('express').Response} res - Sends 200 on success.
 * @returns {Promise<void>}
 * @throws {ApiError} 400 - User doesn't exist.
 */
export const resetResend = asyncHandler(async (req, res) => {
  const id = req.user.id
  const base = resolveResetBase(req.body?.resetBase)
  const [user] = await userRepository.findEmailById(id)
  if (!user) {
    throw new ApiError(400, "user doesn't exist")
  }
  const { unhashedToken, hashedToken, tokenExpiry } = tokenGeneration()
  await passwordResetRepository.create({
    token: hashedToken,
    tokenExpiry,
    userId: id,
  })
  await sendEmail({
    email: user.email,
    subject: 'To reset your password please verify your email',
    emailContent: passwordResetVerification(
      'there',
      `${base}/${unhashedToken}`,
    ),
  })
  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'A new password reset email has been sent.'))
})
