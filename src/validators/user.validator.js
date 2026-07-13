import { body } from 'express-validator'
/**
 * Build the express-validator chain for signup (email + password).
 * @returns {import('express-validator').ValidationChain[]} Chain (email valid/normalized; password ≥12 chars with upper/lower/number/special and no spaces; .bail() after each notEmpty).
 */
export const registerValidator = () => {
  return [
    body('email')
      .trim()
      .notEmpty()
      .withMessage('Email is required')
      .bail()
      .isEmail()
      .withMessage('Invalid email address')
      .normalizeEmail(),

    body('password')
      .notEmpty()
      .withMessage('Password is required')
      .bail()
      .isLength({ min: 12 })
      .withMessage('Password must be at least 12 characters long')
      .matches(/[A-Z]/)
      .withMessage('Password must contain at least one uppercase letter')
      .matches(/[a-z]/)
      .withMessage('Password must contain at least one lowercase letter')
      .matches(/[0-9]/)
      .withMessage('Password must contain at least one number')
      .matches(/[!@#$%^&*()_\-+={[}\]|\\:;"'<>,.?/~`]/)
      .withMessage('Password must contain at least one special character')
      .matches(/^\S+$/)
      .withMessage('Password cannot contain spaces'),
  ]
}
/**
 * Build the express-validator chain for the forgot-password request email.
 * @returns {import('express-validator').ValidationChain[]} Chain (email required, valid, normalized; bails when empty).
 */
export const forgotPasswordEmail = () => {
  return [
    body('email')
      .trim()
      .notEmpty()
      .withMessage('Email is required')
      .bail()
      .isEmail()
      .withMessage('Invalid email address')
      .normalizeEmail(),
  ]
}
/**
 * Build the express-validator chain for password reset (email + newPassword + confirmPassword).
 * @returns {import('express-validator').ValidationChain[]} Chain (email valid/normalized; newPassword and confirmPassword each ≥12 chars with upper/lower/number/special and no spaces; .bail() after each notEmpty).
 */
export const resetPasswordValidator = () => {
  return [
    body('email')
      .trim()
      .notEmpty()
      .withMessage('Email is required')
      .bail()
      .isEmail()
      .withMessage('Invalid email address')
      .normalizeEmail(),

    body('newPassword')
      .notEmpty()
      .withMessage('Password is required')
      .bail()
      .isLength({ min: 12 })
      .withMessage('Password must be at least 12 characters long')
      .matches(/[A-Z]/)
      .withMessage('Password must contain at least one uppercase letter')
      .matches(/[a-z]/)
      .withMessage('Password must contain at least one lowercase letter')
      .matches(/[0-9]/)
      .withMessage('Password must contain at least one number')
      .matches(/[!@#$%^&*()_\-+={[}\]|\\:;"'<>,.?/~`]/)
      .withMessage('Password must contain at least one special character')
      .matches(/^\S+$/)
      .withMessage('Password cannot contain spaces'),

    body('confirmPassword')
      .notEmpty()
      .withMessage('Password is required')
      .bail()
      .isLength({ min: 12 })
      .withMessage('Password must be at least 12 characters long')
      .matches(/[A-Z]/)
      .withMessage('Password must contain at least one uppercase letter')
      .matches(/[a-z]/)
      .withMessage('Password must contain at least one lowercase letter')
      .matches(/[0-9]/)
      .withMessage('Password must contain at least one number')
      .matches(/[!@#$%^&*()_\-+={[}\]|\\:;"'<>,.?/~`]/)
      .withMessage('Password must contain at least one special character')
      .matches(/^\S+$/)
      .withMessage('Password cannot contain spaces'),
  ]
}
/**
 * Build the express-validator chain for the login email field.
 * @returns {import('express-validator').ValidationChain[]} Chain (email required, valid, normalized; bails when empty).
 */
export const loginEmailValidator = () => {
  return [
    body('email')
      .trim()
      .notEmpty()
      .withMessage('Email is required')
      .bail()
      .isEmail()
      .withMessage('Invalid email address')
      .normalizeEmail(),
  ]
}
/**
 * Build the express-validator chain for change-password (oldPassword + newPassword + confirmPassword).
 * @returns {import('express-validator').ValidationChain[]} Chain (each of oldPassword, newPassword, confirmPassword ≥12 chars with upper/lower/number/special and no spaces; .bail() after each notEmpty).
 */
export const changePasswordValidator = () => {
  return [
    body('oldPassword')
      .notEmpty()
      .withMessage('Password is required')
      .bail()
      .isLength({ min: 12 })
      .withMessage('Password must be at least 12 characters long')
      .matches(/[A-Z]/)
      .withMessage('Password must contain at least one uppercase letter')
      .matches(/[a-z]/)
      .withMessage('Password must contain at least one lowercase letter')
      .matches(/[0-9]/)
      .withMessage('Password must contain at least one number')
      .matches(/[!@#$%^&*()_\-+={[}\]|\\:;"'<>,.?/~`]/)
      .withMessage('Password must contain at least one special character')
      .matches(/^\S+$/)
      .withMessage('Password cannot contain spaces'),

    body('newPassword')
      .notEmpty()
      .withMessage('Password is required')
      .bail()
      .isLength({ min: 12 })
      .withMessage('Password must be at least 12 characters long')
      .matches(/[A-Z]/)
      .withMessage('Password must contain at least one uppercase letter')
      .matches(/[a-z]/)
      .withMessage('Password must contain at least one lowercase letter')
      .matches(/[0-9]/)
      .withMessage('Password must contain at least one number')
      .matches(/[!@#$%^&*()_\-+={[}\]|\\:;"'<>,.?/~`]/)
      .withMessage('Password must contain at least one special character')
      .matches(/^\S+$/)
      .withMessage('Password cannot contain spaces'),

    body('confirmPassword')
      .notEmpty()
      .withMessage('Password is required')
      .bail()
      .isLength({ min: 12 })
      .withMessage('Password must be at least 12 characters long')
      .matches(/[A-Z]/)
      .withMessage('Password must contain at least one uppercase letter')
      .matches(/[a-z]/)
      .withMessage('Password must contain at least one lowercase letter')
      .matches(/[0-9]/)
      .withMessage('Password must contain at least one number')
      .matches(/[!@#$%^&*()_\-+={[}\]|\\:;"'<>,.?/~`]/)
      .withMessage('Password must contain at least one special character')
      .matches(/^\S+$/)
      .withMessage('Password cannot contain spaces'),
  ]
}
