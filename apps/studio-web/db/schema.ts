import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const brandAccounts = sqliteTable("brand_accounts", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  handle: text("handle").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const portfolios = sqliteTable("portfolios", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  accountId: text("account_id").notNull(),
  name: text("name").notNull(),
  niche: text("niche").notNull().default("Marca personal"),
  essence: text("essence").notNull().default("Claro, cercano y profesional"),
  accent: text("accent").notNull().default("violet"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const recordingSessions = sqliteTable("recording_sessions", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  portfolioId: text("portfolio_id").notNull(),
  title: text("title").notNull(),
  script: text("script").notNull().default(""),
  status: text("status").notNull().default("recording"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const scenes = sqliteTable("scenes", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  sessionId: text("session_id").notNull(),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  script: text("script").notNull(),
  selectedTakeId: text("selected_take_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const takes = sqliteTable("takes", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  sessionId: text("session_id").notNull(),
  sceneId: text("scene_id").notNull(),
  objectKey: text("object_key").notNull(),
  mimeType: text("mime_type").notNull(),
  bytes: integer("bytes").notNull(),
  durationMs: integer("duration_ms").notNull().default(0),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
