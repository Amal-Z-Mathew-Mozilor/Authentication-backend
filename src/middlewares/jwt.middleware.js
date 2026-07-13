import { redisClient } from '../db/redis.js'
import { ApiError } from '../utils/response/index.js'
import { verifyAccess, clearAuthCookies } from '../utils/auth/index.js'
/**
 * Verify the accessToken cookie and reject revoked/expired/invalidated sessions.
 * On success attaches req.user = decoded token payload and calls next().
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.cookies.accessToken - Access-token cookie to verify.
 * @param {import('express').Response} res - Used to clear auth cookies on session invalidation.
 * @param {import('express').NextFunction} next - Called on success.
 * @returns {Promise<void>}
 * @throws {ApiError} 401 - Missing token, expired/invalid token, or session invalidated (iat before cutoff).
 * @throws {ApiError} 403 - Token revoked (jti blacklisted in Redis).
 */
export const jwtValidation = async function (req, res, next) {
  const { accessToken } = req.cookies
  if (!accessToken) {
    throw new ApiError(401, 'Authorization token missing')
  }
  let decoded
  try {
    decoded = verifyAccess(accessToken)
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new ApiError(401, 'Token has expired')
    }

    throw new ApiError(401, 'invalid Token')
  }
  const exist = await redisClient.get(`blacklist:${decoded.jti}`)
  if (exist) {
    throw new ApiError(403, 'token revoked')
  }
  // per-user iat cutoff: a token issued before the cutoff (e.g. before a password change) is
  // rejected. Clear the dead cookies and signal the client to redirect to /login.
  const cutoff = await redisClient.get(`session:iat:${decoded.id}`)
  if (cutoff && decoded.iat < Number(cutoff)) {
    clearAuthCookies(res)
    throw new ApiError(401, 'Session invalidated, please login again')
  }
  req.user = decoded
  next()
}
