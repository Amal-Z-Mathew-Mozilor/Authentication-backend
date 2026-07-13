import 'dotenv/config'

// Clears the auth cookies with the SAME attributes they were set with — otherwise the browser
// won't drop them. Reused by logout and by the session-invalidation paths (jwtValidation,
// rotateToken). Kept in a shared util so both the controller and the middleware can use it.
/**
 * Clear the accessToken and refreshToken cookies with the same attributes they were set with.
 * @param {import('express').Response} res - Response used to clear both auth cookies.
 * @returns {void}
 */
export function clearAuthCookies(res) {
  const sameSite = process.env.COOKIE_SAMESITE || 'lax'
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || sameSite === 'none',
    sameSite,
  }
  res.clearCookie('accessToken', options).clearCookie('refreshToken', options)
}
