import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureMasterKey } from "./crypto.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.AWW_DATA_DIR ?? path.resolve(here, "../../data");

export function openDb(): DatabaseSync {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  ensureMasterKey(DATA_DIR);
  const db = new DatabaseSync(path.join(DATA_DIR, "app.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS ai_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    base_url_override TEXT,
    api_key_enc TEXT,
    thinking_level TEXT NOT NULL DEFAULT 'medium',
    role_preference TEXT NOT NULL DEFAULT '[]',
    language_style TEXT NOT NULL DEFAULT '自然',
    avatar_style TEXT NOT NULL DEFAULT 'ink',
    description TEXT NOT NULL DEFAULT '',
    stats_play_count INTEGER NOT NULL DEFAULT 0,
    stats_win_count INTEGER NOT NULL DEFAULT 0,
    stats_mvp_count INTEGER NOT NULL DEFAULT 0,
    total_tokens_used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS game_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    mode TEXT NOT NULL,
    assignment TEXT NOT NULL,
    winner TEXT,
    reason TEXT,
    rounds INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS game_ai_mapping (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    profile_id INTEGER NOT NULL,
    seat INTEGER NOT NULL,
    role TEXT NOT NULL,
    team TEXT NOT NULL,
    alive INTEGER NOT NULL DEFAULT 1,
    thinking_level TEXT NOT NULL DEFAULT 'medium',
    win INTEGER NOT NULL DEFAULT 0,
    mvp INTEGER NOT NULL DEFAULT 0,
    speech_count INTEGER NOT NULL DEFAULT 0,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (game_id) REFERENCES game_sessions(id)
  );

  CREATE TABLE IF NOT EXISTS game_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    payload TEXT NOT NULL,
    FOREIGN KEY (game_id) REFERENCES game_sessions(id)
  );

  CREATE TABLE IF NOT EXISTS preset_lineups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ai_ids TEXT NOT NULL,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  `);
}

export type Db = DatabaseSync;