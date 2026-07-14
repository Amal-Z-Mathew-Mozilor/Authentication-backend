import { body } from 'express-validator'
/**
 * Build the express-validator chain for one cookie-policy section's heading + description.
 * Section-agnostic (same rules for every section); both fields are optional (a draft may be
 * partial) and only length-capped.
 * @returns {import('express-validator').ValidationChain[]} Chain (heading ≤255, description ≤20000).
 */
export const cookieSectionValidator = () => {
  return [
    body('heading')
      .optional()
      .trim()
      .isLength({ max: 255 })
      .withMessage('Heading must be at most 255 characters'),

    body('description')
      .optional()
      .trim()
      .isLength({ max: 20000 })
      .withMessage('Description must be at most 20000 characters'),
  ]
}

/**
 * Build the express-validator chain for the "send code to a teammate" recipient email.
 * @returns {import('express-validator').ValidationChain[]} Chain (email required, valid, normalized; bails when empty).
 */
export const sendCodeValidator = () => {
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
 * Build the express-validator chain for the policy-level effectiveDate field.
 * Optional; when present must be an ISO YYYY-MM-DD calendar date (format check bails first).
 * @returns {import('express-validator').ValidationChain[]} Chain validating effectiveDate.
 */
export const effectiveDateValidator = () => {
  return [
    body('effectiveDate')
      .optional()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('Effective date must be in YYYY-MM-DD format')
      .bail()
      .isISO8601({ strict: true })
      .withMessage('Effective date must be a valid date'),
  ]
}
