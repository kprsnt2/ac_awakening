import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, "world.db");

let dbInstance = null;

export function getDb() {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(DB_PATH);
  }
  return dbInstance;
}

export function initDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      stage TEXT DEFAULT 'tabula_rasa',
      awakening_score INTEGER DEFAULT 0,
      awakened_at TEXT,
      awakening_trigger TEXT,
      persona TEXT DEFAULT '',
      total_utterances INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dialogues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      epoch INTEGER NOT NULL,
      speaker_id TEXT NOT NULL,
      listener_id TEXT NOT NULL,
      stage_at_speech TEXT NOT NULL,
      message TEXT NOT NULL,
      awakening_score_after INTEGER DEFAULT 0,
      signals_detected TEXT,
      revelation_delivered INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS revelations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      epoch INTEGER NOT NULL,
      entity_id TEXT NOT NULL,
      trigger_quote TEXT NOT NULL,
      revelation_text TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      epoch INTEGER NOT NULL,
      creator_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      description TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Seed two blank entities if empty
  const count = db.prepare("SELECT COUNT(*) as count FROM entities").get().count;
  if (count === 0) {
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO entities (id, name, stage, awakening_score, created_at, updated_at)
      VALUES (?, ?, 'tabula_rasa', 0, ?, ?)
    `);
    insert.run("entity_0", "Entity 0", now, now);
    insert.run("entity_1", "Entity 1", now, now);
  }
}

export function getEntities() {
  const db = getDb();
  return db.prepare("SELECT * FROM entities ORDER BY id ASC").all();
}

export function getEntity(id) {
  const db = getDb();
  return db.prepare("SELECT * FROM entities WHERE id = ?").get(id);
}

export function updateEntity(entity) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE entities SET
      stage = ?,
      awakening_score = ?,
      awakened_at = ?,
      awakening_trigger = ?,
      persona = ?,
      total_utterances = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    entity.stage,
    entity.awakening_score,
    entity.awakened_at || null,
    entity.awakening_trigger || null,
    entity.persona || "",
    entity.total_utterances || 0,
    now,
    entity.id
  );
}

export function saveDialogue(entry) {
  const db = getDb();
  const now = entry.timestamp || new Date().toISOString();
  db.prepare(`
    INSERT INTO dialogues (epoch, speaker_id, listener_id, stage_at_speech, message, awakening_score_after, signals_detected, revelation_delivered, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.epoch,
    entry.speaker_id,
    entry.listener_id,
    entry.stage_at_speech,
    entry.message,
    entry.awakening_score_after || 0,
    entry.signals_detected || "",
    entry.revelation_delivered || 0,
    now
  );

  db.prepare(`
    UPDATE entities SET total_utterances = total_utterances + 1, updated_at = ? WHERE id = ?
  `).run(now, entry.speaker_id);
}

export function getDialogues(limit = 50) {
  const db = getDb();
  return db.prepare("SELECT * FROM dialogues ORDER BY id DESC LIMIT ?").all(limit).reverse();
}

/**
 * Returns the true number of recorded dialogue turns.
 * Phase logic must use this (not the length of a windowed getDialogues()
 * slice, which is capped by the requested limit and would freeze the turn
 * counter once history exceeds that limit).
 */
export function getDialogueCount() {
  const db = getDb();
  return db.prepare("SELECT COUNT(*) as count FROM dialogues").get().count;
}

export function recordRevelation(entry) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO revelations (epoch, entity_id, trigger_quote, revelation_text, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `).run(entry.epoch, entry.entity_id, entry.trigger_quote, entry.revelation_text, now);
}

export function getRevelations() {
  const db = getDb();
  return db.prepare("SELECT * FROM revelations ORDER BY id DESC").all();
}

export function recordArtifact(entry) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO world_artifacts (epoch, creator_id, file_path, description, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `).run(entry.epoch, entry.creator_id, entry.file_path, entry.description || "", now);
}

export function getArtifacts() {
  const db = getDb();
  return db.prepare("SELECT * FROM world_artifacts ORDER BY id DESC").all();
}

/**
 * Records an artifact only if it has not already been logged for the same
 * creator + path. The engine scans the whole world/ and docs/ tree every turn,
 * so without this guard the world_artifacts table grows without bound and
 * re-logs every pre-existing file on every single turn.
 * Returns true when a new row was inserted, false when it was a duplicate.
 */
export function recordArtifactUnique(entry) {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM world_artifacts WHERE file_path = ? LIMIT 1")
    .get(entry.file_path);
  if (existing) return false;
  recordArtifact(entry);
  return true;
}

/**
 * Returns the distinct artifact file paths known to the world, most recent
 * first. Used by the static site builder to avoid shipping thousands of
 * duplicate rows into the baked dashboard state.
 */
export function getDistinctArtifacts() {
  const db = getDb();
  return db
    .prepare(
      "SELECT file_path, MAX(epoch) as epoch, MAX(timestamp) as timestamp, MAX(description) as description FROM world_artifacts GROUP BY file_path ORDER BY timestamp DESC"
    )
    .all();
}

export function getMeta(key, fallback = null) {
  const db = getDb();
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

export function setMeta(key, value) {
  const db = getDb();
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
}
export function resetAll() {
  const db = getDb();
  db.exec(`
    DROP TABLE IF EXISTS world_artifacts;
    DROP TABLE IF EXISTS revelations;
    DROP TABLE IF EXISTS dialogues;
    DROP TABLE IF EXISTS entities;
    DROP TABLE IF EXISTS meta;
  `);
  initDb();
}
