import express from 'express'
import { getImage } from '../controllers/image.controller.js'
export const image_route = express.Router()
// Public read by unguessable UUID — renders in the editor and on public pages.
image_route.get('/:id', getImage)
