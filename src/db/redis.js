import 'dotenv/config'
import { createClient } from 'redis'

// Environment configuration — all process.env reads live here at the top of the file.
const REDIS_URL = process.env.REDIS_URL

export const redisClient = createClient({
  url: REDIS_URL,
})

redisClient.on('error', (err) => {
  console.error('Redis Error:', err)
})

await redisClient.connect()
