import express from 'express'
import { websiteValidator } from '../validators/website.validator.js'
import { validation } from '../middlewares/auth.middleware.js'
import { jwtValidation } from '../middlewares/jwt.middleware.js'
import {
  listWebsites,
  createWebsite,
  updateWebsite,
  deleteWebsite,
} from '../controllers/website.controller.js'
export const website_route = express.Router()
website_route.get('/', jwtValidation, listWebsites)
website_route.post('/', jwtValidation, websiteValidator(), validation, createWebsite)
website_route.put(
  '/:id',
  jwtValidation,
  websiteValidator(),
  validation,
  updateWebsite,
)
website_route.delete('/:id', jwtValidation, deleteWebsite)
