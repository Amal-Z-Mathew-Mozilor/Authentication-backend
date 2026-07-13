/**
 * Standard success envelope returned by controllers ({ statuscode, data, message, sucess }).
 * @param {number} statuscode - HTTP status code (sets sucess = statuscode < 400).
 * @param {*} data - Response payload.
 * @param {string} [message='request Sucessful'] - Human-readable message.
 */
class ApiResponse {
  constructor(statuscode, data, message = 'request Sucessful') {
    this.statuscode = statuscode
    this.data = data
    this.message = message
    this.sucess = statuscode < 400
  }
}
export default ApiResponse
