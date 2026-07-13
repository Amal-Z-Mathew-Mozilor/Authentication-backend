import bcrypt from 'bcrypt'
/**
 * Hash a plaintext password with bcrypt (10 salt rounds).
 * @param {string} password - The plaintext password.
 * @returns {Promise<string>} The bcrypt hash.
 */
export const hashPassword = async function (password) {
  const hash = await bcrypt.hash(password, 10)
  return hash
}
/**
 * Compare a plaintext password against a bcrypt hash.
 * @param {string} password1 - The plaintext password to check.
 * @param {string} password2 - The stored bcrypt hash.
 * @returns {Promise<boolean>} True when the password matches the hash.
 */
export const verifyPassword = async function (password1, password2) {
  const result = await bcrypt.compare(password1, password2)
  return result
}
