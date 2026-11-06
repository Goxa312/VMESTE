import { sqliteTable, text, integer, real, index, uniqueIndex, blob, primaryKey } from "drizzle-orm/sqlite-core";
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(), login: text("login").notNull().unique(), name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(), createdAt: integer("created_at").notNull(),
});
export const accountSessions = sqliteTable("account_sessions", {
  tokenHash: text("token_hash").primaryKey(), accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
}, t => [index("account_sessions_expiry_idx").on(t.expiresAt)]);
export const accountLimits = sqliteTable("account_limits", {
  key: text("key").primaryKey(), attempts: integer("attempts").notNull(), expiresAt: integer("expires_at").notNull(),
}, t => [index("account_limits_expiry_idx").on(t.expiresAt)]);
export const accountFavorites = sqliteTable("account_favorites", {
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }), videoId: text("video_id").notNull(),
  createdAt: integer("created_at").notNull(),
}, t => [primaryKey({ columns: [t.accountId, t.videoId] })]);

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(), title: text("title").notNull(),
  videoUrl: text("video_url").notNull(), videoTitle: text("video_title").notNull(),
  mediaUrl: text("media_url"), mediaFormat: text("media_format"),
  sourceMode: text("source_mode"), shareId: text("share_id"),
  kind: text("kind").notNull(), poster: text("poster").notNull().default(""),
  hostId: text("host_id").notNull(), playing: integer("playing").notNull().default(0),
  position: real("position").notNull().default(0), revision: integer("revision").notNull().default(0),
  updatedAt: integer("updated_at").notNull(), createdAt: integer("created_at").notNull(), expiresAt: integer("expires_at").notNull(),
});
export const participants = sqliteTable("participants", {
  id: text("id").primaryKey(), roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  accountId: text("account_id").references(() => accounts.id),
  tokenHash: text("token_hash").notNull(), name: text("name").notNull(), color: integer("color").notNull(),
  seenAt: integer("seen_at").notNull(), joinedAt: integer("joined_at").notNull(),
}, t => [index("participants_room_idx").on(t.roomId), uniqueIndex("participants_account_room_idx").on(t.accountId, t.roomId)]);
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }), roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  participantId: text("participant_id").notNull(), name: text("name").notNull(), body: text("body").notNull(), createdAt: integer("created_at").notNull(),
}, t => [index("messages_room_idx").on(t.roomId, t.id)]);
export const library = sqliteTable("library", {
  id: text("id").primaryKey(), ownerKey: text("owner_key").notNull(), title: text("title").notNull(),
  url: text("url").notNull(), sourceMode: text("source_mode"), kind: text("kind").notNull(), poster: text("poster").notNull().default(""), createdAt: integer("created_at").notNull(),
}, t => [index("library_owner_idx").on(t.ownerKey)]);

export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(), roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  title: text("title").notNull(), mime: text("mime").notNull(), size: integer("size").notNull(),
  backend: text("backend").notNull(), multipart: text("multipart"), state: text("state").notNull(),
  revision: integer("revision").notNull(), expiresAt: integer("expires_at").notNull(),
}, t => [index("uploads_room_idx").on(t.roomId), index("uploads_expiry_idx").on(t.expiresAt)]);
export const uploadParts = sqliteTable("upload_parts", {
  fileId: text("file_id").notNull().references(() => uploads.id, { onDelete: "cascade" }),
  part: integer("part").notNull(), tag: text("tag"), data: blob("data"),
}, t => [primaryKey({ columns: [t.fileId, t.part] })]);
export const sharePeers = sqliteTable("share_peers", {
  roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  guest: text("guest").notNull(), session: text("session").notNull(), attempt: text("attempt").notNull(),
  offer: text("offer"), answer: text("answer"), updatedAt: integer("updated_at").notNull(),
}, t => [primaryKey({ columns: [t.roomId, t.guest] })]);
