import { body } from 'express-validator'
// A cookie-policy section (About cookies, Use of cookies, …) — fields are optional
// (a draft may be partial). Section-agnostic: same heading/description rules for all.
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

// "Send code to a teammate" — recipient email is required and must be valid. Mirrors the
// email chain in user.validator.js (.bail() so an empty field shows only "is required").
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

// Policy-level effective date — optional; when present must be an ISO calendar date
// (YYYY-MM-DD). The shape check bails first so a bad format shows one clear message.
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
