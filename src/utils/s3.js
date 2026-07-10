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
export const s3Enabled = () => !!S3_BUCKET

const client = new S3Client({
  region: REGION,
  ...(process.env.S3_ENDPOINT
    ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
    : {}),
})

// Upload bytes under `key` with the given content type.
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
export async function getObjectBuffer(key) {
  const resp = await client.send(
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
  )
  const bytes = await resp.Body.transformToByteArray()
  return Buffer.from(bytes)
}

export async function deleteObject(key) {
  await client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }))
}

// Mint a short-lived presigned GET URL for `key` (the browser fetches directly from S3).
export function presignGetUrl(key, expiresIn = PRESIGN_EXPIRY) {
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
    { expiresIn },
  )
}
