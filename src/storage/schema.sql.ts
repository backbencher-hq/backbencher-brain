import { integer } from "drizzle-orm/sqlite-core"
export const Timestamps = {
  time_created: integer("time_created").notNull(),
  time_updated: integer("time_updated").notNull(),
} as const
