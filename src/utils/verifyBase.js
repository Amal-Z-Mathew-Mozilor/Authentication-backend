import ApiError from './api-error.js'
import 'dotenv/config'

// Environment configuration — all process.env reads live here at the top of the file.
const ALLOWED_VERIFY_BASES = process.env.ALLOWED_VERIFY_BASES || ''

// The verify link base is supplied by the frontend and MUST be validated against an allowlist
// (exact match) — an unchecked client URL would be an open-redirect / phishing vector.
/**
 * Validate a client-supplied verify link base against the ALLOWED_VERIFY_BASES allowlist.
 * @param {string} verifyBase - The verify URL base sent by the frontend.
 * @returns {string} The same verifyBase once confirmed allowlisted.
 * @throws {ApiError} 400 - Missing base or not an exact match in the allowlist.
 */
export function resolveVerifyBase(verifyBase) {
  const allowed = ALLOWED_VERIFY_BASES.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!verifyBase || !allowed.includes(verifyBase)) {
    throw new ApiError(400, 'invalid verify url')
  }
  return verifyBase
}
