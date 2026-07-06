import bcrypt from 'bcrypt'
export const hashPassword = async function (password) {
  const hash = await bcrypt.hash(password, 10)
  return hash
}
export const verifyPassword = async function (password1, password2) {
  const result = await bcrypt.compare(password1, password2)
  return result
}
