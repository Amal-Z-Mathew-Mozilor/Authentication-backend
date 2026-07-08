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
