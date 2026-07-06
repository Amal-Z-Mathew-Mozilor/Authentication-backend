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
