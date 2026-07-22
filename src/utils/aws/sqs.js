import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { randomUUID } from 'node:crypto'
import 'dotenv/config'

// SQS publisher for mail events. The Node.js app no longer sends mail directly;
// it emits an event that the Go mailing service consumes, renders and sends.
// Credentials come from the standard AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env
// vars via the SDK's default provider chain; region from AWS_REGION. SQS_ENDPOINT
// (LocalStack/ElasticMQ) is optional for local dev.
const MAIL_QUEUE_URL = process.env.MAIL_QUEUE_URL || ''
const REGION = process.env.AWS_REGION || 'us-east-1'
const SQS_ENDPOINT = process.env.SQS_ENDPOINT

/**
 * Report whether a mail queue is configured (lets other paths skip publishing gracefully).
 * @returns {boolean} True when MAIL_QUEUE_URL is set.
 */
export const mailQueueEnabled = () => !!MAIL_QUEUE_URL

const client = new SQSClient({
  region: REGION,
  ...(SQS_ENDPOINT ? { endpoint: SQS_ENDPOINT } : {}),
})

/**
 * Publish a mail event to the SQS queue for the Go mailing service to consume.
 * A message id is generated if the event does not carry one (used for dedup/DLQ tracing).
 * Publish failures are caught and logged, never thrown — a queue outage must not fail the request
 * (mirrors the old fire-and-forget sendEmail behaviour).
 * @param {object} event - The mail event.
 * @param {string} event.type - Event type routing to a template (e.g. 'email_verification').
 * @param {string} event.to - Recipient email address.
 * @param {object} event.data - Template variables carried with the event.
 * @param {string} [event.id] - Optional unique id; generated when absent.
 * @returns {Promise<void>}
 */
export async function publishMailEvent(event) {
  if (!mailQueueEnabled()) {
    console.log(
      'publishMailEvent: MAIL_QUEUE_URL not configured; skipping',
      event.type,
    )
    return
  }
  const payload = { id: randomUUID(), ...event }
  try {
    await client.send(
      new SendMessageCommand({
        QueueUrl: MAIL_QUEUE_URL,
        MessageBody: JSON.stringify(payload),
      }),
    )
  } catch (err) {
    console.log('publishMailEvent: failed to publish', event.type, err)
  }
}
