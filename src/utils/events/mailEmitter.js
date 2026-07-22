import { EventEmitter } from 'node:events'
import { publishMailEvent } from '../aws/sqs.js'

// In-process event emitter that fronts the SQS mail queue. Controllers `emit` a
// mail event and return immediately (non-blocking); a listener publishes it to
// SQS, where the Go mailing service consumes it. The emitter is only a local
// hand-off — SQS is still the durable cross-service queue.
//
// Trade-off: emit() is fire-and-forget, so the request responds before SQS
// confirms the enqueue. publishMailEvent already swallows/logs its own errors, so
// a publish failure is logged, not thrown.
export const MAIL_EVENT = 'mail'

export const mailEmitter = new EventEmitter()

mailEmitter.on(MAIL_EVENT, (event) => {
  publishMailEvent(event)
})

/**
 * Emit a mail event onto the in-process emitter (which publishes it to SQS).
 * Fire-and-forget: returns synchronously without awaiting the SQS publish.
 * @param {object} event - The mail event ({ type, to, data }).
 * @returns {void}
 */
export const emitMailEvent = (event) => {
  mailEmitter.emit(MAIL_EVENT, event)
}
