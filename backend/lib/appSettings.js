const db = require('../db');

const KEY_ASSIGNMENT_RESPONSE_RETENTION_DAYS = 'assignment_response_retention_days';
const DEFAULT_ASSIGNMENT_RESPONSE_RETENTION_DAYS = 20;

function ensureAppSettingsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      updated_by INTEGER REFERENCES users(id)
    );
  `);
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(KEY_ASSIGNMENT_RESPONSE_RETENTION_DAYS);
  if (!row) {
    db.prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)`,
    ).run(KEY_ASSIGNMENT_RESPONSE_RETENTION_DAYS, String(DEFAULT_ASSIGNMENT_RESPONSE_RETENTION_DAYS));
  }
}

function getSetting(key, fallback = null) {
  ensureAppSettingsTable();
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value, updatedBy = null) {
  ensureAppSettingsTable();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at, updated_by)
     VALUES (?, ?, datetime('now'), ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = datetime('now'),
       updated_by = excluded.updated_by`,
  ).run(key, String(value), updatedBy);
  return getSetting(key);
}

function getAssignmentResponseRetentionDays() {
  const raw = Number(getSetting(KEY_ASSIGNMENT_RESPONSE_RETENTION_DAYS, DEFAULT_ASSIGNMENT_RESPONSE_RETENTION_DAYS));
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_ASSIGNMENT_RESPONSE_RETENTION_DAYS;
  return Math.min(3650, Math.floor(raw));
}

function setAssignmentResponseRetentionDays(days, updatedBy = null) {
  const n = Math.min(3650, Math.max(1, Math.floor(Number(days) || DEFAULT_ASSIGNMENT_RESPONSE_RETENTION_DAYS)));
  setSetting(KEY_ASSIGNMENT_RESPONSE_RETENTION_DAYS, String(n), updatedBy);
  return n;
}

/** SQLite datetime string for now + N days. */
function expiresAtFromRetentionDays(days = getAssignmentResponseRetentionDays()) {
  const n = Math.max(1, Math.floor(Number(days) || DEFAULT_ASSIGNMENT_RESPONSE_RETENTION_DAYS));
  return db.prepare(`SELECT datetime('now', '+' || ? || ' days') AS t`).get(String(n)).t;
}

module.exports = {
  KEY_ASSIGNMENT_RESPONSE_RETENTION_DAYS,
  DEFAULT_ASSIGNMENT_RESPONSE_RETENTION_DAYS,
  ensureAppSettingsTable,
  getSetting,
  setSetting,
  getAssignmentResponseRetentionDays,
  setAssignmentResponseRetentionDays,
  expiresAtFromRetentionDays,
};
