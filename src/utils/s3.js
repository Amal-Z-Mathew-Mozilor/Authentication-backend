import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import 'dotenv/config'

// S3-backed storage for cookie-policy images. Credentials come from the standard
// AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars via the SDK's default provider chain;
// region + bucket from AWS_REGION / S3_BUCKET. S3_ENDPOINT (+ path-style) supports a local
// S3 (LocalStack/MinIO). The bucket is PRIVATE — reads go through short-lived presigned URLs.
export const S3_BUCKET = process.env.S3_BUCKET || ''
const REGION = process.env.AWS_REGION || 'us-east-1'
const PRESIGN_EXPIRY = Number(process.env.S3_PRESIGN_EXPIRY) || 300

// True only when a bucket is configured — lets smoke and other paths skip S3 gracefully.
/**
 * Report whether a bucket is configured (lets smoke/other paths skip S3 gracefully).
 * @returns {boolean} True when S3_BUCKET is set.
 */
export const s3Enabled = () => !!S3_BUCKET

const client = new S3Client({
  region: REGION,
  ...(process.env.S3_ENDPOINT
    ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
    : {}),
})

// Upload bytes under `key` with the given content type.
/**
 * Upload bytes to the bucket under the given key.
 * @param {string} key - S3 object key.
 * @param {Buffer|Uint8Array|string} body - Object bytes to store.
 * @param {string} contentType - MIME type stored as the object's ContentType.
 * @returns {Promise<void>}
 */
export async function uploadObject(key, body, contentType) {
  await client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

// Read an object's bytes as a Buffer (server-side; used to base64-inline in the export).
/**
 * Read an object's bytes into a Buffer (used to base64-inline images in the HTML export).
 * @param {string} key - S3 object key.
 * @returns {Promise<Buffer>} The object's contents.
 */
export async function getObjectBuffer(key) {
  const resp = await client.send(
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
  )
  const bytes = await resp.Body.transformToByteArray()
  return Buffer.from(bytes)
}

/**
 * Delete an object from the bucket.
 * @param {string} key - S3 object key.
 * @returns {Promise<void>}
 */
export async function deleteObject(key) {
  await client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }))
}

// Mint a short-lived presigned GET URL for `key` (the browser fetches directly from S3).
/**
 * Mint a short-lived presigned GET URL for an object (browser fetches directly from S3).
 * @param {string} key - S3 object key.
 * @param {number} [expiresIn=PRESIGN_EXPIRY] - URL lifetime in seconds.
 * @returns {Promise<string>} The presigned GET URL.
 */
export function presignGetUrl(key, expiresIn = PRESIGN_EXPIRY) {
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
    { expiresIn },
  )
}
