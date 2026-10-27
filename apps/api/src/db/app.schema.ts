import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth.schema";

/**
 * A bot is the user-facing agent. Its conversation and working state live in the
 * matching `BotAgent` Durable Object; this row is what the UI lists and what the
 * agent reads to configure itself.
 */
export const bot = sqliteTable(
  "bot",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** Appended to the system prompt — the bot's job and boundaries. */
    charter: text("charter").notNull().default(""),
    avatarShape: text("avatar_shape").notNull(),
    avatarColor: text("avatar_color").notNull(),
    model: text("model").notNull().default("claude-opus-5-5"),
    /** Projected from the Durable Object so the sidebar can render previews. */
    lastMessagePreview: text("last_message_preview"),
    lastMessageAuthor: text("last_message_author"),
    lastMessageAt: integer("last_message_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("bot_user_idx").on(table.userId)],
);

export const botRelations = relations(bot, ({ one }) => ({
  owner: one(user, { fields: [bot.userId], references: [user.id] }),
}));
