import multer from 'multer'
import ApiError from '../utils/api-error.js'

const ALLOWED = new Set(['image/png', 'image/jpeg'])

// Memory storage (bytes go straight into Postgres bytea). No size limit (per spec);
// only png/jpeg pass the filter — magic bytes are re-checked in the controller.
/**
 * Multer middleware that accepts a single png/jpeg upload in the "file" field into memory.
 * Reads the multipart body, rejecting any file whose mimetype is not png/jpeg (no size limit).
 * @type {import('express').RequestHandler}
 * @throws {ApiError} 415 - Uploaded file is not PNG or JPEG (passed to multer's callback).
 */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter(req, file, cb) {
    if (ALLOWED.has(file.mimetype)) cb(null, true)
    else cb(new ApiError(415, 'Only PNG and JPG images are allowed'))
  },
}).single('file')
