import { body } from 'express-validator'
// About cookies section — fields are optional (a draft may be partial).
export const aboutCookiesValidator = () => {
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
