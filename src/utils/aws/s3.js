import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import 'dotenv/config'

// S3-backed storage for cookie-policy images. Credentials come from the standard
// AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars via the SDK's default provider chain;
// region + bucket from AWS_REGION / S3_BUCKET. S3_ENDPOINT (+ path-style) supports a local
// S3 (LocalStack/MinIO). The bucket is PRIVATE — the app reads objects' bytes (getObjectBuffer)
// and serves them itself; no presigned URLs are minted.
export const S3_BUCKET = process.env.S3_BUCKET || ''
const REGION = process.env.AWS_REGION || 'us-east-1'
const S3_ENDPOINT = process.env.S3_ENDPOINT

/**
 * Report whether a bucket is configured (lets smoke/other paths skip S3 gracefully).
 * @returns {boolean} True when S3_BUCKET is set.
 */
export const s3Enabled = () => !!S3_BUCKET

const client = new S3Client({
  region: REGION,
  ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT, forcePathStyle: true } : {}),
})

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
