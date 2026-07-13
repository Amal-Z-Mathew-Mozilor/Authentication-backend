/**
 * Error carrying an HTTP status code, used by controllers and caught by the global handler.
 * @param {number} statuscode - HTTP status code for the response.
 * @param {string} [message='request invalid'] - Human-readable error message.
 * @param {Array} [error=[]] - Field/detail errors (e.g. the express-validator array).
 * @param {string} [stack=''] - Optional pre-captured stack; otherwise one is captured.
 */
class ApiError extends Error {
  constructor(statuscode, message = 'request invalid', error = [], stack = '') {
    super(message)
    this.statuscode = statuscode
    this.error = error
    this.sucess = false
    if (stack) {
      this.stack = stack
    } else {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}
export default ApiError
