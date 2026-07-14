import ApiError from '../response/api-error.js'
import 'dotenv/config'

// Environment configuration — all process.env reads live here at the top of the file.
const ALLOWED_RESET_BASES = process.env.ALLOWED_RESET_BASES || ''

/**
 * Validate a client-supplied reset link base against the ALLOWED_RESET_BASES allowlist, guarding against open-redirect / phishing via an unchecked client URL.
 * @param {string} resetBase - The reset URL base sent by the frontend.
 * @returns {string} The same resetBase once confirmed allowlisted.
 * @throws {ApiError} 400 - Missing base or not an exact match in the allowlist.
 */
export function resolveResetBase(resetBase) {
  const allowed = ALLOWED_RESET_BASES.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!resetBase || !allowed.includes(resetBase)) {
    throw new ApiError(400, 'invalid reset url')
  }
  return resetBase
}
