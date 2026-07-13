import { validationResult } from 'express-validator'
import { loginEmailValidator } from '../validators/user.validator.js'
import { redisClient } from '../db/redis.js'
import ApiError from '../utils/api-error.js'
import { asyncHandler } from '../utils/async-handler.js'

const MAX_IP_ATTEMPTS = 10
const IP_COUNTER_EXPIRY = 2 * 60

/**
 * Enforce the per-IP login rate limit and validate the login email before the controller runs.
 * Initializes/reads the Redis per-IP counter and calls next() when under the limit.
 * @param {import('express').Request} req - The Express request.
 * @param {string} req.ip - Client IP used as the per-IP counter key.
 * @param {object} req.body - Request body.
 * @param {string} req.body.email - Login email (validated by loginEmailValidator).
 * @param {import('express').Response} res - Unused.
 * @param {import('express').NextFunction} next - Called when email is valid and attempts are under MAX_IP_ATTEMPTS.
 * @returns {Promise<void>}
 * @throws {ApiError} 422 - Invalid email format (errors: the validator array).
 * @throws {ApiError} 429 - Too many attempts from this IP (errors: { retryAfter } seconds).
 */
export const loginMiddleware = asyncHandler(async (req, res, next) => {
  const key = `login:ip:${req.ip}`

  const exists = await redisClient.exists(key)

  if (!exists) {
    await redisClient.set(key, '0', {
      EX: IP_COUNTER_EXPIRY,
    })
  }

  const validators = loginEmailValidator()

  for (const validator of validators) {
    await validator.run(req)
  }

  const errors = validationResult(req)

  if (!errors.isEmpty()) {
    throw new ApiError(422, 'Invalid Email format', errors.array())
  }

  const attempts = Number(await redisClient.get(key))

  if (attempts >= MAX_IP_ATTEMPTS) {
    const ttl = await redisClient.ttl(key)

    throw new ApiError(429, 'Too many login attempts.', {
      retryAfter: ttl,
    })
  }
  next()
})
