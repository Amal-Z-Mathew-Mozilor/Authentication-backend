import multer from 'multer'
import ApiError from '../utils/api-error.js'

const ALLOWED = new Set(['image/png', 'image/jpeg'])

// Memory storage (bytes go straight into Postgres bytea). No size limit (per spec);
// only png/jpeg pass the filter — magic bytes are re-checked in the controller.
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter(req, file, cb) {
    if (ALLOWED.has(file.mimetype)) cb(null, true)
    else cb(new ApiError(415, 'Only PNG and JPG images are allowed'))
  },
}).single('file')
