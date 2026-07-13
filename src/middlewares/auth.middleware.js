import { validationResult } from 'express-validator'
import ApiError from '../utils/api-error.js'

/**
 * Turn express-validator results into a 422, or call next() when the request is clean.
 * @param {import('express').Request} req - Reads the validation results accumulated on the request by prior validator chains.
 * @param {import('express').Response} res - Unused (errors are thrown, not sent here).
 * @param {import('express').NextFunction} next - Called when there are no validation errors.
 * @returns {void}
 * @throws {ApiError} 422 - One or more express-validator checks failed (errors: the validator array).
 */
export const validation = function (req, res, next) {
  const error = validationResult(req)
  if (error.isEmpty()) {
    return next()
  }
  const extractedErrors = []
  error.array().map((err) => {
    extractedErrors.push(err)
  })
  throw new ApiError(422, 'Invalid credential', extractedErrors)
}
