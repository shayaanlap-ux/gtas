import { integer, pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

// Lifetime stats for the online modes, keyed by display name.
export const playerStats = pgTable("player_stats", {
  name: text("name").primaryKey(),
  kills: integer("kills").notNull().default(0),
  deaths: integer("deaths").notNull().default(0),
  matches: integer("matches").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// One row per finished Deathmatch / Team Deathmatch / Jetpack Arena match.
export const matchResults = pgTable("match_results", {
  id: serial("id").primaryKey(),
  mode: text("mode").notNull(),
  room: text("room").notNull(),
  winner: text("winner").notNull(),
  scores: jsonb("scores").notNull(),
  endedAt: timestamp("ended_at").notNull().defaultNow(),
});
