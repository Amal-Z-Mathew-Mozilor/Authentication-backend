import { redisClient } from '../db/redis.js'
import ApiError from '../utils/api-error.js'
import { verifyAccess } from '../utils/jwt.js'
import { clearAuthCookies } from '../utils/cookies.js'
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
