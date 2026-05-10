const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'academy.db');
const db = new Database(dbPath);
try {
  db.pragma('foreign_keys = ON');
} catch (_) {
  /* ignore */
}

module.exports = db;
