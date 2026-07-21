import express from 'express'
import { jwtValidation } from '../middlewares/jwt.middleware.js'
import { getImage, getPublicImage } from '../controllers/image.controller.js'
export const image_route = express.Router()
// Authenticated + owner-scoped: a user may only read images from their OWN cookie
// policies (getImage joins policy_images → cookie_policy → websites → userId). Renders in
// the editor/preview via the auto-attached accessToken cookie.
image_route.get('/:id', jwtValidation, getImage)

// PUBLIC (no auth, no ownership): backs the absolute image URLs in the exported/emailed
// policy so a pasted policy page renders on any host. Bytes are read server-side from the
// still-private S3 bucket; anyone with the UUID link can fetch (cookie-policy images are
// public-by-intent). Mounted at /pulse/public/images in app.js.
export const public_image_route = express.Router()
public_image_route.get('/:id', getPublicImage)
