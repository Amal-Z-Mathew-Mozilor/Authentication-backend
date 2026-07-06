import ApiError from './api-error.js'

// The reset link base is supplied by the frontend and MUST be validated against an allowlist
// (exact match) — an unchecked client URL would be an open-redirect / phishing vector.
export function resolveResetBase(resetBase) {
  const allowed = (process.env.ALLOWED_RESET_BASES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!resetBase || !allowed.includes(resetBase)) {
    throw new ApiError(400, 'invalid reset url')
  }
  return resetBase
}
