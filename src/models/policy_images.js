import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  customType,
} from 'drizzle-orm/pg-core'
import { cookiePolicy } from './cookie_policy.js'

// Postgres bytea (Drizzle has no native type); round-trips as a Node Buffer.
const bytea = customType({
  dataType() {
    return 'bytea'
  },
})

export const policyImages = pgTable('policy_images', {
  id: uuid('id').primaryKey().defaultRandom(),

  cookiePolicyId: uuid('cookie_policy_id')
    .notNull()
    .references(() => cookiePolicy.id, {
      onDelete: 'cascade',
    }),

  mime: varchar('mime', { length: 32 }).notNull(),

  data: bytea('data').notNull(),

  byteSize: integer('byte_size').notNull(),

  createdAt: timestamp('created_at', {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
})
