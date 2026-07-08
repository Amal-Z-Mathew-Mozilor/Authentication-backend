import { body } from 'express-validator'
export const websiteValidator = () => {
  return [
    body('name')
      .trim()
      .notEmpty()
      .withMessage('Name is required')
      .bail()
      .isLength({ max: 255 })
      .withMessage('Name must be at most 255 characters'),

    body('url')
      .trim()
      .notEmpty()
      .withMessage('URL is required')
      .bail()
      .isURL()
      .withMessage('Invalid URL'),
  ]
}
