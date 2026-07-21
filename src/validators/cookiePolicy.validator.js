import { body } from 'express-validator'
/**
 * Build the express-validator chain for one cookie-policy section's heading + description.
 * Section-agnostic (same rules for every section). Both fields are REQUIRED and non-empty
 * (the backend is now the authority — matches the wizard, which won't save an empty section)
 * and length-capped. Description is rich-text HTML, so emptiness is checked after stripping
 * tags/&nbsp; (a visually-empty "<p></p>" counts as empty).
 * @returns {import('express-validator').ValidationChain[]} Chain (heading required ≤255, description required ≤20000).
 */
export const cookieSectionValidator = () => {
  return [
    body('heading')
      .trim()
      .notEmpty()
      .withMessage('Heading is required')
      .bail()
      .isLength({ max: 255 })
      .withMessage('Heading must be at most 255 characters'),

    body('description')
      .trim()
      .isLength({ max: 20000 })
      .withMessage('Description must be at most 20000 characters')
      .bail()
      .custom(
        (v) =>
          v
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .trim().length > 0,
      )
      .withMessage('Description cannot be empty'),
  ]
}

/**
 * Build the express-validator chain for the "send code to a teammate" recipient email.
 * `format` is optional and selects which snippet is emailed ('html' default | 'script').
 * @returns {import('express-validator').ValidationChain[]} Chain (email required, valid, normalized; format allowlisted).
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

    body('format')
      .optional()
      .isIn(['html', 'script'])
      .withMessage('Invalid format'),
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
