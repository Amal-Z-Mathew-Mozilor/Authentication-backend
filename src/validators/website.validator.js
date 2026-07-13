import { body } from 'express-validator'
/**
 * Build the express-validator chain for a website's name + url fields.
 * @returns {import('express-validator').ValidationChain[]} Chain (name required, ≤255; url required, valid URL; .bail() after each notEmpty).
 */
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
