import db from '../db/index.js'
import ApiError from '../utils/api-error.js'
import ApiResponse from '../utils/api-response.js'
import { websites } from '../models/index.js'
import { asyncHandler } from '../utils/async-handler.js'
import { and, eq, desc } from 'drizzle-orm'

// All handlers are scoped to the authenticated user (req.user.id, set by jwtValidation).

export const listWebsites = asyncHandler(async (req, res) => {
  const rows = await db
    .select({
      id: websites.id,
      name: websites.name,
      url: websites.url,
      createdAt: websites.createdAt,
      updatedAt: websites.updatedAt,
    })
    .from(websites)
    .where(eq(websites.userId, req.user.id))
    .orderBy(desc(websites.createdAt))
  return res
    .status(200)
    .json(new ApiResponse(200, rows, 'websites fetched sucessfully'))
})

export const createWebsite = asyncHandler(async (req, res) => {
  const { name, url } = req.body
  const [website] = await db
    .insert(websites)
    .values({ name, url, userId: req.user.id })
    .returning({
      id: websites.id,
      name: websites.name,
      url: websites.url,
      createdAt: websites.createdAt,
    })
  return res
    .status(201)
    .json(new ApiResponse(201, website, 'website added sucessfully'))
})

export const updateWebsite = asyncHandler(async (req, res) => {
  const { name, url } = req.body
  const [website] = await db
    .update(websites)
    .set({ name, url })
    .where(and(eq(websites.id, req.params.id), eq(websites.userId, req.user.id)))
    .returning({
      id: websites.id,
      name: websites.name,
      url: websites.url,
      updatedAt: websites.updatedAt,
    })
  if (!website) {
    throw new ApiError(404, 'website not found')
  }
  return res
    .status(200)
    .json(new ApiResponse(200, website, 'website updated sucessfully'))
})

export const deleteWebsite = asyncHandler(async (req, res) => {
  const [website] = await db
    .delete(websites)
    .where(and(eq(websites.id, req.params.id), eq(websites.userId, req.user.id)))
    .returning({ id: websites.id })
  if (!website) {
    throw new ApiError(404, 'website not found')
  }
  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'website deleted sucessfully'))
})
