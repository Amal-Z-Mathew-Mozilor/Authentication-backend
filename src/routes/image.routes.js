import express from 'express'
import { jwtValidation } from '../middlewares/jwt.middleware.js'
import { getImage } from '../controllers/image.controller.js'
export const image_route = express.Router()
// Authenticated + owner-scoped: a user may only read images from their OWN cookie
// policies (getImage joins policy_images → cookie_policy → websites → userId). Renders in
// the editor/preview via the auto-attached accessToken cookie; the HTML export inlines
// base64 server-side, so pasted policy pages never hit this route.
image_route.get('/:id', jwtValidation, getImage)
