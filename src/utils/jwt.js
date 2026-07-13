import jwt from 'jsonwebtoken'
import { redisClient } from '../db/redis.js'
import { users } from '../models/index.js'
import db from '../db/index.js'
import { eq } from 'drizzle-orm'
import ApiError from './api-error.js'
import 'dotenv/config'
import crypto from 'crypto'
/**
 * Sign a short-lived access token for a user, embedding a random jti for revocation.
 * @param {string} userId - The user's id to look up ({ id, email } payload).
 * @returns {Promise<string>} The signed access JWT (payload { id, email, jti }).
 * @throws {ApiError} 404 - No user found for the given userId.
 */
export const acessSign = async function (userId) {
  const [payload] = await db
    .select({ id: users.userId, email: users.email })
    .from(users)
    .where(eq(users.userId, userId))
  if (!payload) {
    throw new ApiError(404, 'User not found')
  }
  const unhashedToken = crypto.randomBytes(20).toString('hex')
  payload.jti = unhashedToken
  const acessToken = jwt.sign(payload, process.env.ACCESS_SECRETKEY, {
    expiresIn: process.env.ACCESS_EXPIRY,
  })
  return acessToken
}
/**
 * Sign a refresh token and store it in Redis with a TTL derived from the token's own exp.
 * @param {string} userId - The user's id (becomes the { id } payload and Redis value).
 * @returns {Promise<string>} The signed refresh JWT (also keyed at refresh:<token> in Redis).
 */
export const refreshSign = async function (userId) {
  const refreshToken = jwt.sign({ id: userId }, process.env.REFRESH_SECRETKEY, {
    expiresIn: process.env.REFRESH_EXPIRY,
  })
  const { exp } = jwt.decode(refreshToken)
  const ttlSeconds = exp - Math.floor(Date.now() / 1000)
  await redisClient.set(`refresh:${refreshToken}`, userId, {
    EX: ttlSeconds,
  })

  return refreshToken
}
/**
 * Verify an access token's signature and expiry.
 * @param {string} token - The access JWT.
 * @returns {object} The decoded payload ({ id, email, jti, iat, exp }).
 * @throws {jwt.JsonWebTokenError} When the token is invalid or expired.
 */
export const verifyAccess = function (token) {
  const decoded = jwt.verify(token, process.env.ACCESS_SECRETKEY)
  return decoded
}
/**
 * Verify a refresh token's signature and confirm it still matches the value stored in Redis.
 * @param {string} token - The refresh JWT.
 * @returns {Promise<object>} The decoded payload ({ id, iat, exp }).
 * @throws {jwt.JsonWebTokenError} When the token signature is invalid or expired.
 * @throws {ApiError} 403 - Token absent from Redis or its stored userId doesn't match.
 */
export const verifyRefresh = async function (token) {
  const decoded = jwt.verify(token, process.env.REFRESH_SECRETKEY)
  const storedToken = await redisClient.get(`refresh:${token}`)

  if (!storedToken) {
    throw new ApiError(403, 'Invalid refresh token')
  }
  if (storedToken != decoded.id) {
    throw new ApiError(403, 'Invalid refresh token')
  }
  return decoded
}
