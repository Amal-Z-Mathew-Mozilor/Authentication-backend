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
import {
  cookieSectionValidator,
  effectiveDateValidator,
  sendCodeValidator,
} from '../validators/cookiePolicy.validator.js'
import {
  getCookiePolicy,
  getCookiePolicyHtml,
  sendPolicyCode,
  putSection,
  putPolicyMeta,
  deleteCookiePolicy,
} from '../controllers/cookiePolicy.controller.js'
import { imageUpload } from '../middlewares/upload.middleware.js'
import { uploadImage } from '../controllers/image.controller.js'
export const website_route = express.Router()
website_route.get('/', jwtValidation, listWebsites)
website_route.post(
  '/',
  jwtValidation,
  websiteValidator(),
  validation,
  createWebsite,
)
website_route.put(
  '/:id',
  jwtValidation,
  websiteValidator(),
  validation,
  updateWebsite,
)
website_route.delete('/:id', jwtValidation, deleteWebsite)

// Cookie policy for a website (nested; ownership via the website's owner).
// GET returns all sections + policy meta. PUT (base) upserts policy meta
// (effectiveDate); PUT /:section upserts one section
// (:section ∈ aboutCookies|useOfCookies|cookiePreferences). Distinct paths — no collision.
website_route.get('/:websiteId/cookie-policy', jwtValidation, getCookiePolicy)
// Self-contained HTML export of the saved policy (the "HTML format" add-to-site option).
website_route.get(
  '/:websiteId/cookie-policy/html',
  jwtValidation,
  getCookiePolicyHtml,
)
// Email that HTML snippet to a teammate ("Send code to a teammate").
website_route.post(
  '/:websiteId/cookie-policy/send-code',
  jwtValidation,
  sendCodeValidator(),
  validation,
  sendPolicyCode,
)
website_route.put(
  '/:websiteId/cookie-policy',
  jwtValidation,
  effectiveDateValidator(),
  validation,
  putPolicyMeta,
)
website_route.put(
  '/:websiteId/cookie-policy/:section',
  jwtValidation,
  cookieSectionValidator(),
  validation,
  putSection,
)
// "Delete" (reset) the whole policy back to the default seed content.
website_route.delete(
  '/:websiteId/cookie-policy',
  jwtValidation,
  deleteCookiePolicy,
)

// Image upload for a website's cookie policy (multipart; stored in Postgres bytea)
website_route.post(
  '/:websiteId/images',
  jwtValidation,
  imageUpload,
  uploadImage,
)
