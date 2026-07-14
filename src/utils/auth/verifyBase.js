import ApiError from '../response/api-error.js'
import 'dotenv/config'

// Environment configuration — all process.env reads live here at the top of the file.
const ALLOWED_VERIFY_BASES = process.env.ALLOWED_VERIFY_BASES || ''

/**
 * Validate a client-supplied verify link base against the ALLOWED_VERIFY_BASES allowlist, guarding against open-redirect / phishing via an unchecked client URL.
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
