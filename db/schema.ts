import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(), title: text("title").notNull(),
  videoUrl: text("video_url").notNull(), videoTitle: text("video_title").notNull(),
  mediaUrl: text("media_url"), mediaFormat: text("media_format"),
  kind: text("kind").notNull(), poster: text("poster").notNull().default(""),
  hostId: text("host_id").notNull(), playing: integer("playing").notNull().default(0),
  position: real("position").notNull().default(0), revision: integer("revision").notNull().default(0),
  updatedAt: integer("updated_at").notNull(), createdAt: integer("created_at").notNull(), expiresAt: integer("expires_at").notNull(),
});
export const participants = sqliteTable("participants", {
  id: text("id").primaryKey(), roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(), name: text("name").notNull(), color: integer("color").notNull(),
  seenAt: integer("seen_at").notNull(), joinedAt: integer("joined_at").notNull(),
}, t => [index("participants_room_idx").on(t.roomId)]);
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }), roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  participantId: text("participant_id").notNull(), name: text("name").notNull(), body: text("body").notNull(), createdAt: integer("created_at").notNull(),
}, t => [index("messages_room_idx").on(t.roomId, t.id)]);
export const library = sqliteTable("library", {
  id: text("id").primaryKey(), ownerKey: text("owner_key").notNull(), title: text("title").notNull(),
  url: text("url").notNull(), kind: text("kind").notNull(), poster: text("poster").notNull().default(""), createdAt: integer("created_at").notNull(),
}, t => [index("library_owner_idx").on(t.ownerKey)]);
