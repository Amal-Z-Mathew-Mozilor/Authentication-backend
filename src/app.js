import express from 'express'
import cors from 'cors'
import { user_route } from './routes/auth.routes.js'
import { website_route } from './routes/website.routes.js'
import { image_route } from './routes/image.routes.js'
import cookieParser from 'cookie-parser'
import 'dotenv/config'
export const app = express()
const port = process.env.PORT
// Behind nginx/CDN, the socket IP is the proxy's — the real client IP is in
// X-Forwarded-For. Trust exactly TRUST_PROXY_HOPS proxies so Express derives
// req.ip from XFF without trusting client-spoofed entries. Local dev has no
// proxy, so this defaults to 0 (trust nothing → req.ip = socket IP).
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 0)
// Allowed cross-origin frontends, from CORS_ORIGINS (comma-separated). Cookie auth
// requires credentials:true + a specific echoed origin ("*" is invalid with credentials).
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)
app.use(
  cors({
    origin(origin, callback) {
      // no Origin header = non-browser client (curl/Postman/server-to-server) → allow
      if (!origin || allowedOrigins.includes(origin))
        return callback(null, true)
      return callback(new Error('Not allowed by CORS'))
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
)
app.use(express.json())
app.use(cookieParser())
app.use('/pulse/users', user_route)
app.use('/pulse/websites', website_route)
app.use('/pulse/images', image_route)
/**
 * Global error handler — map a thrown ApiError (or any error) to the JSON error envelope.
 * @param {Error & { statuscode?: number, error?: Array }} err - Error propagated from a route/asyncHandler; statuscode and error are read when present.
 * @param {import('express').Request} req - Incoming request (unused).
 * @param {import('express').Response} res - Sends err.statuscode||500 with { success:false, message, errors }.
 * @param {import('express').NextFunction} next - Express next (unused; required for the 4-arg error signature).
 * @returns {void}
 */
app.use((err, req, res, next) => {
  const status = err.statuscode || 500
  res.status(status).json({
    success: false,
    message: err.message || 'Internal Server Error',
    errors: err.error || [],
  })
})
app.listen(port, () => {
  console.log(`listenng to ${port}`)
})
