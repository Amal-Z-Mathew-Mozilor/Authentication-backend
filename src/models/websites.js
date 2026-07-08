import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core'
import { users } from './userschema.js'
export const websites = pgTable('websites', {
  id: uuid('id').primaryKey().defaultRandom(),

  userId: uuid('user_id')
    .notNull()
    .references(() => users.userId, {
      onDelete: 'cascade',
    }),

  name: varchar('name', { length: 255 }).notNull(),

  url: varchar('url', { length: 2048 }).notNull(),

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
