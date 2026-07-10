import { pgTable, uuid, varchar, integer, timestamp } from 'drizzle-orm/pg-core'
import { cookiePolicy } from './cookie_policy.js'

// Cookie-policy image metadata. The bytes live in S3 (private bucket); this row stores the
// S3 object `key` (e.g. policy-images/<uuid>.png), not the bytes. FK → cookie_policy for
// ownership scoping + cascade delete.
export const policyImages = pgTable('policy_images', {
  id: uuid('id').primaryKey().defaultRandom(),

  cookiePolicyId: uuid('cookie_policy_id')
    .notNull()
    .references(() => cookiePolicy.id, {
      onDelete: 'cascade',
    }),

  key: varchar('key', { length: 1024 }).notNull(),

  mime: varchar('mime', { length: 32 }).notNull(),

  byteSize: integer('byte_size').notNull(),

  createdAt: timestamp('created_at', {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
})
