import crypto from 'crypto'
export const tokenGeneration = function () {
  const unhashedToken = crypto.randomBytes(20).toString('hex')
  const hashedToken = crypto
    .createHash('sha256')
    .update(unhashedToken)
    .digest('hex')
  const tokenExpiry = new Date(Date.now() + 20 * 60 * 1000)
  return { unhashedToken, hashedToken, tokenExpiry }
}
export const hashToken = function (unhashedToken) {
  const hashedToken = crypto
    .createHash('sha256')
    .update(unhashedToken)
    .digest('hex')
  return hashedToken
}
