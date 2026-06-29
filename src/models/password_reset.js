import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  text,
} from "drizzle-orm/pg-core";
import { users } from "./userschema.js";
export const passwordReset = pgTable(
  "password_reset_tokens",
  {
    tokenId: uuid("token_id")
      .primaryKey()
      .defaultRandom(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, {
        onDelete: "cascade",
      }),

    token: varchar("token", { length: 255 })
      .notNull(),

    tokenExpiry: timestamp("token_expiry", {
      withTimezone: true,
    }).notNull(),

    isUsed: boolean("is_used")
      .default(false)
      .notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  }
);