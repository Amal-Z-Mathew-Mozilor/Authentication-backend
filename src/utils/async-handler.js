/**
 * Wrap an async Express handler so rejected promises are forwarded to next() (the error handler).
 * @param {Function} requestHandler - Async (req, res, next) route handler.
 * @returns {import('express').RequestHandler} A handler that catches and forwards errors to next().
 */
const asyncHandler = (requestHandler) => (req, res, next) =>
  Promise.resolve(requestHandler(req, res, next)).catch((err) => next(err))

export { asyncHandler }
