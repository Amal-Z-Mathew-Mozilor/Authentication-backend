import { pgTable, uuid, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { websites } from './websites.js'
export const cookiePolicy = pgTable('cookie_policy', {
  id: uuid('id').primaryKey().defaultRandom(),

  websiteId: uuid('website_id')
    .notNull()
    .unique()
    .references(() => websites.id, {
      onDelete: 'cascade',
    }),

  // Section content keyed by section, e.g. { aboutCookies: { heading, description } }.
  // Later sections add sibling keys — no schema migration needed.
  content: jsonb('content').notNull().default({}),

  createdAt: timestamp('created_at', {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),

  updatedAt: timestamp('updated_at', {
    withTimezone: true,
  })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})
