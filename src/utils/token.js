import crypto from 'crypto'
/**
 * Generate a one-time token: a random raw value, its sha256 hash, and a 20-minute expiry.
 * @returns {{ unhashedToken: string, hashedToken: string, tokenExpiry: Date }} Raw token (emailed), stored hash, and expiry.
 */
export const tokenGeneration = function () {
  const unhashedToken = crypto.randomBytes(20).toString('hex')
  const hashedToken = crypto
    .createHash('sha256')
    .update(unhashedToken)
    .digest('hex')
  const tokenExpiry = new Date(Date.now() + 20 * 60 * 1000)
  return { unhashedToken, hashedToken, tokenExpiry }
}
/**
 * Compute the sha256 hash of a raw token (to match against the stored hash).
 * @param {string} unhashedToken - The raw token from the link.
 * @returns {string} The hex-encoded sha256 hash.
 */
export const hashToken = function (unhashedToken) {
  const hashedToken = crypto
    .createHash('sha256')
    .update(unhashedToken)
    .digest('hex')
  return hashedToken
}
