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
import { aboutCookiesValidator } from '../validators/cookiePolicy.validator.js'
import {
  getCookiePolicy,
  putAboutCookies,
} from '../controllers/cookiePolicy.controller.js'
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

// Cookie policy for a website (nested; ownership via the website's owner)
website_route.get('/:websiteId/cookie-policy', jwtValidation, getCookiePolicy)
website_route.put(
  '/:websiteId/cookie-policy',
  jwtValidation,
  aboutCookiesValidator(),
  validation,
  putAboutCookies,
)
