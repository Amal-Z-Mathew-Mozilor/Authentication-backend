import 'dotenv/config'

// Environment configuration — all process.env reads live here at the top of the file.
const COOKIE_SAMESITE = process.env.COOKIE_SAMESITE || 'lax'
const NODE_ENV = process.env.NODE_ENV

/**
 * Clear the accessToken and refreshToken cookies with the same attributes they were set with, so the browser actually drops them.
 * @param {import('express').Response} res - Response used to clear both auth cookies.
 * @returns {void}
 */
export function clearAuthCookies(res) {
  const sameSite = COOKIE_SAMESITE
  const options = {
    httpOnly: true,
    secure: NODE_ENV === 'production' || sameSite === 'none',
    sameSite,
  }
  res.clearCookie('accessToken', options).clearCookie('refreshToken', options)
}
