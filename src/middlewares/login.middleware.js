import { validationResult } from 'express-validator'
import { loginEmailValidator } from '../validators/user.validator.js'
import { redisClient } from '../db/redis.js'
import ApiError from '../utils/api-error.js'
import { asyncHandler } from '../utils/async-handler.js'

const MAX_IP_ATTEMPTS = 10
const IP_COUNTER_EXPIRY = 2 * 60

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
