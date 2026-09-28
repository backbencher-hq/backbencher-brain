import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
export const ProjectTable = sqliteTable("project", {
  id: text("id").primaryKey(),
  workspace_id: text("workspace_id").notNull(),
  name: text("name"),
  time_created: integer("time_created").notNull(),
  time_updated: integer("time_updated").notNull(),
})
