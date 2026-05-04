require('dotenv').config();
const os = require('os');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { ensureV1Tables } = require('./migrations/v1');

// Ensure core auth/live tables exist in runtime.
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token_jti TEXT NOT NULL,
    device_name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    session_type TEXT NOT NULL CHECK(session_type IN ('group', 'one_to_one')),
    trainer_id INTEGER NOT NULL REFERENCES users(id),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS batch_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT DEFAULT (datetime('now')),
    UNIQUE(batch_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS live_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    agora_channel TEXT NOT NULL UNIQUE,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'live', 'ended', 'cancelled')),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS live_session_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    live_session_id INTEGER NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT DEFAULT (datetime('now')),
    left_at TEXT,
    UNIQUE(live_session_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS live_session_speakers (
    live_session_id INTEGER NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    promoted_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (live_session_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS live_session_hands (
    live_session_id INTEGER NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    raised_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (live_session_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS live_session_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    live_session_id INTEGER NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    event_type TEXT NOT NULL,
    detail TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_live_session_logs_session ON live_session_logs(live_session_id);
`);
ensureV1Tables(db);

const authRoutes = require('./routes/auth');
const courseRoutes = require('./routes/courses');
const enrollmentRoutes = require('./routes/enrollments');
const lessonRoutes = require('./routes/lessons');
const quizRoutes = require('./routes/quizzes');
const userRoutes = require('./routes/users');
const uploadRoutes = require('./routes/uploads');
const liveRoutes = require('./routes/live');
const batchManagerRoutes = require('./routes/batchManager');
const videoRoutes = require('./routes/videos');
const studyMaterialRoutes = require('./routes/studyMaterials');
const worksheetRoutes = require('./routes/worksheets');
const assignmentRoutes = require('./routes/assignments');

const app = express();
const PORT = process.env.PORT || 3001;

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/lessons', lessonRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/users', userRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/live', liveRoutes);
app.use('/api/batch-manager', batchManagerRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/study-materials', studyMaterialRoutes);
app.use('/api/worksheets', worksheetRoutes);
app.use('/api/assignments', assignmentRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/health/details', (req, res) => {
  const count = (table) => db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
  res.json({
    ok: true,
    dbPath: path.join(__dirname, 'data', 'academy.db'),
    counts: {
      users: count('users'),
      courses: count('courses'),
      lessons: count('lessons'),
      lessonLibrary: count('lesson_library'),
      batches: count('batches'),
    },
  });
});

const LISTEN_HOST = process.env.BIND_HOST || '0.0.0.0';

function logLanAddresses() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets || {})) {
    for (const net of nets[name] || []) {
      const v4 = net.family === 'IPv4' || net.family === 4;
      if (v4 && !net.internal) ips.push(net.address);
    }
  }
  if (ips.length) {
    console.log(`Also reachable from devices on your LAN, e.g. ${ips.map((ip) => `http://${ip}:${PORT}`).join(', ')}`);
  }
}

app.listen(PORT, LISTEN_HOST, () => {
  console.log(`EngLeash Academy API running on http://localhost:${PORT} (bound on ${LISTEN_HOST})`);
  logLanAddresses();
});
