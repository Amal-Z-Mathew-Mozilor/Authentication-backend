import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  text,
} from 'drizzle-orm/pg-core'
export const users = pgTable('users', {
  userId: uuid('user_id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),

  password: text().notNull(),

  failedLoginAttempts: integer('failed_login_attempts').default(0).notNull(),

  isVerified: boolean('is_verified').default(false).notNull(),
  isLocked: boolean('is_locked').notNull().default(false),
  lockedUntil: timestamp('locked_until', {
    mode: 'date',
  }).default(null),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),

  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})
