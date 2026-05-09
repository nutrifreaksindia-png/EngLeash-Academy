const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const liveRecording = require('../services/liveRecording');
const { buildPublicUrl, getSignedPlaybackUrl, isSpacesConfigured } = require('../services/spaces');

let RtcTokenBuilder = null;
let RtcRole = null;
try {
  ({ RtcTokenBuilder, RtcRole } = require('agora-access-token'));
} catch (_) {
  // Keep route functional without crashing when dependency/env is missing.
}

const router = express.Router();

const REACTION_KINDS = new Set(['thumbsup', 'clap', 'heart', 'laugh', 'think']);
const liveRateBuckets = new Map();

/** Sliding-window rate limit; returns true if the call is allowed. */
function allowRate(key, max, windowMs) {
  const now = Date.now();
  const prev = liveRateBuckets.get(key) || [];
  const next = prev.filter((t) => now - t < windowMs);
  if (next.length >= max) return false;
  next.push(now);
  liveRateBuckets.set(key, next);
  return true;
}

/** Primary trainer or co-trainer (batch_trainers). */
function isStaffForBatch(userId, batchId) {
  const row = db
    .prepare(
      `
    SELECT 1 FROM batches b
    WHERE b.id = ?
      AND (b.trainer_id = ? OR EXISTS (
        SELECT 1 FROM batch_trainers bt WHERE bt.batch_id = b.id AND bt.trainer_id = ?
      ))
  `
    )
    .get(batchId, userId, userId);
  return !!row;
}

function isStudentInBatch(userId, batchId) {
  const row = db.prepare('SELECT 1 FROM batch_members WHERE batch_id = ? AND student_id = ?').get(batchId, userId);
  return !!row;
}

function isUserAllowedForSession(session, user) {
  if (!session) return false;
  if (user.role === 'Admin') return true;
  if (user.role === 'Trainer') return isStaffForBatch(user.id, session.batch_id);
  if (user.role === 'Student' || user.role === 'Lab') return isStudentInBatch(user.id, session.batch_id);
  return false;
}

function assertTrainerStaffCanManageLive(req, session) {
  if (req.user.role === 'Admin') return;
  if (req.user.role === 'Trainer' && isStaffForBatch(req.user.id, session.batch_id)) return;
  const e = new Error('Forbidden');
  e.statusCode = 403;
  throw e;
}

/** Scheduled/live: only within [starts_at − early, ends_at]. */
function joinTimeAllows(session) {
  if (session.status === 'live') return { ok: true };
  if (session.status === 'ended' || session.status === 'cancelled') {
    return { ok: false, code: 'bad_status' };
  }
  if (session.status !== 'scheduled') {
    return { ok: false, code: 'bad_status' };
  }
  const now = Date.now();
  const start = parseSessionInstantMs(session.starts_at);
  const end = parseSessionInstantMs(session.ends_at);
  if (Number.isNaN(start) || Number.isNaN(end)) return { ok: false, code: 'invalid_schedule' };
  const earlyMs = Number(process.env.LIVE_JOIN_EARLY_MS || 5 * 60 * 1000);
  if (now < start - earlyMs || now > end) {
    return { ok: false, code: 'outside_window' };
  }
  return { ok: true };
}

function logSessionEvent(sessionId, userId, eventType, detail) {
  try {
    db.prepare(
      'INSERT INTO live_session_logs (live_session_id, user_id, event_type, detail) VALUES (?, ?, ?, ?)'
    ).run(sessionId, userId || null, eventType, detail == null ? null : String(detail));
  } catch (_) {
    // ignore logging failures
  }
}

function parseSessionInstantMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return NaN;
  const hasTz = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw);
  if (hasTz) return new Date(raw).getTime();
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!m) return new Date(raw).getTime();
  const defaultOffsetMin = Number(process.env.LIVE_DEFAULT_TZ_OFFSET_MINUTES || 330);
  const sign = defaultOffsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(defaultOffsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  const sec = m[3] || '00';
  return new Date(`${m[1]}T${m[2]}:${sec}${sign}${hh}:${mm}`).getTime();
}

function countActiveParticipants(sessionId) {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM live_session_participants WHERE live_session_id = ? AND left_at IS NULL')
    .get(sessionId);
  return Number(row?.n || 0);
}

function reconcileLiveSessionLifecycle(sessionLike) {
  if (!sessionLike?.id) return sessionLike;
  if (sessionLike.status === 'cancelled' || sessionLike.status === 'ended') return sessionLike;
  const active = countActiveParticipants(sessionLike.id);
  const now = Date.now();
  const endMs = parseSessionInstantMs(sessionLike.ends_at || sessionLike.endsAt || '');

  let nextStatus = sessionLike.status;
  if (!Number.isNaN(endMs) && now > endMs && active === 0) {
    nextStatus = 'ended';
  } else if (active > 0) {
    nextStatus = 'live';
  } else if (sessionLike.status === 'live') {
    nextStatus = 'scheduled';
  }

  if (nextStatus !== sessionLike.status) {
    db.prepare('UPDATE live_sessions SET status = ? WHERE id = ?').run(nextStatus, sessionLike.id);
    return { ...sessionLike, status: nextStatus };
  }
  return sessionLike;
}

/**
 * Batch live sessions use two-way communication: every allowed participant gets a publisher token
 * (camera/mic) so web (rtc) and mobile (communication profile) can all send and receive.
 */
function roleForAgora() {
  return 'publisher';
}

function buildAgoraToken({ channelName, uid, role }) {
  const appId = process.env.AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;
  if (!appId || !appCertificate || !RtcTokenBuilder || !RtcRole) {
    return { token: null, expiresAt: null };
  }

  const privilegeSeconds = Number(process.env.AGORA_TOKEN_EXPIRY_SECONDS || 3600);
  const privilegeExpireTime = Math.floor(Date.now() / 1000) + privilegeSeconds;
  const agoraRole = role === 'publisher' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

  return {
    token: RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      uid,
      agoraRole,
      privilegeExpireTime
    ),
    expiresAt: new Date(privilegeExpireTime * 1000).toISOString(),
  };
}

router.get('/sessions', auth, (req, res) => {
  const { role, id: userId } = req.user;
  let rows = [];
  if (role === 'Admin') {
    rows = db.prepare(`
      SELECT ls.id, ls.batch_id, ls.batch_session_id AS batchSessionId,
             CASE
               WHEN bs.id IS NOT NULL THEN (
                 SELECT COUNT(*)
                 FROM batch_sessions bs2
                 WHERE bs2.batch_id = ls.batch_id
                   AND bs2.status != 'cancelled'
                   AND bs2.session_day <= bs.session_day
               )
               ELSE NULL
             END AS session_day,
             CASE
               WHEN ls.batch_session_id IS NOT NULL AND bs.session_day IS NOT NULL THEN printf('Day %02d', bs.session_day)
               ELSE ls.title
             END AS title,
             ls.agora_channel, ls.starts_at, ls.ends_at, ls.status,
             b.name AS batch_name, b.session_type, b.trainer_id, u.name AS trainer_name
      FROM live_sessions ls
      JOIN batches b ON b.id = ls.batch_id
      JOIN users u ON u.id = b.trainer_id
      LEFT JOIN batch_sessions bs ON bs.id = ls.batch_session_id
      ORDER BY ls.starts_at ASC
      LIMIT 100
    `).all();
  } else if (role === 'Trainer') {
    rows = db.prepare(`
      SELECT ls.id, ls.batch_id, ls.batch_session_id AS batchSessionId,
             CASE
               WHEN bs.id IS NOT NULL THEN (
                 SELECT COUNT(*)
                 FROM batch_sessions bs2
                 WHERE bs2.batch_id = ls.batch_id
                   AND bs2.status != 'cancelled'
                   AND bs2.session_day <= bs.session_day
               )
               ELSE NULL
             END AS session_day,
             CASE
               WHEN ls.batch_session_id IS NOT NULL AND bs.session_day IS NOT NULL THEN printf('Day %02d', bs.session_day)
               ELSE ls.title
             END AS title,
             ls.agora_channel, ls.starts_at, ls.ends_at, ls.status,
             b.name AS batch_name, b.session_type, b.trainer_id, u.name AS trainer_name
      FROM live_sessions ls
      JOIN batches b ON b.id = ls.batch_id
      JOIN users u ON u.id = b.trainer_id
      LEFT JOIN batch_sessions bs ON bs.id = ls.batch_session_id
      WHERE b.trainer_id = ? OR EXISTS (
        SELECT 1 FROM batch_trainers bt WHERE bt.batch_id = b.id AND bt.trainer_id = ?
      )
      ORDER BY ls.starts_at ASC
      LIMIT 100
    `).all(userId, userId);
  } else {
    rows = db.prepare(`
      SELECT ls.id, ls.batch_id, ls.batch_session_id AS batchSessionId,
             CASE
               WHEN bs.id IS NOT NULL THEN (
                 SELECT COUNT(*)
                 FROM batch_sessions bs2
                 WHERE bs2.batch_id = ls.batch_id
                   AND bs2.status != 'cancelled'
                   AND bs2.session_day <= bs.session_day
               )
               ELSE NULL
             END AS session_day,
             CASE
               WHEN ls.batch_session_id IS NOT NULL AND bs.session_day IS NOT NULL THEN printf('Day %02d', bs.session_day)
               ELSE ls.title
             END AS title,
             ls.agora_channel, ls.starts_at, ls.ends_at, ls.status,
             b.name AS batch_name, b.session_type, b.trainer_id, u.name AS trainer_name
      FROM live_sessions ls
      JOIN batches b ON b.id = ls.batch_id
      JOIN users u ON u.id = b.trainer_id
      LEFT JOIN batch_sessions bs ON bs.id = ls.batch_session_id
      JOIN batch_members bm ON bm.batch_id = b.id
      WHERE bm.student_id = ?
      ORDER BY ls.starts_at ASC
      LIMIT 100
    `).all(userId);
  }
  const reconciled = rows.map((row) => reconcileLiveSessionLifecycle(row));
  res.json(liveRecording.enrichLiveSessionsList(reconciled));
});

router.get('/students', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const rows = db.prepare("SELECT id, email, name FROM users WHERE role = 'Student' ORDER BY name, id").all();
  res.json(rows);
});

router.get('/batches', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const { role, id: userId } = req.user;
  let rows;
  if (role === 'Admin') {
    rows = db.prepare(`
      SELECT b.id, b.name, b.session_type AS sessionType, b.trainer_id AS trainerId, u.name AS trainerName, b.created_at AS createdAt
      FROM batches b
      JOIN users u ON u.id = b.trainer_id
      ORDER BY b.id DESC
      LIMIT 200
    `).all();
  } else {
    rows = db.prepare(`
      SELECT b.id, b.name, b.session_type AS sessionType, b.trainer_id AS trainerId, u.name AS trainerName, b.created_at AS createdAt
      FROM batches b
      JOIN users u ON u.id = b.trainer_id
      WHERE b.trainer_id = ?
      ORDER BY b.id DESC
      LIMIT 200
    `).all(userId);
  }
  res.json(rows);
});

router.get('/batches/:id', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const batchId = Number(req.params.id);
  const batch = db.prepare(`
    SELECT b.id, b.name, b.session_type AS sessionType, b.trainer_id AS trainerId, u.name AS trainerName, b.created_at AS createdAt
    FROM batches b
    JOIN users u ON u.id = b.trainer_id
    WHERE b.id = ?
  `).get(batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (req.user.role === 'Trainer' && batch.trainerId !== req.user.id) {
    return res.status(403).json({ error: 'You can only view your own batch' });
  }
  const members = db.prepare(`
    SELECT u.id, u.email, u.name
    FROM batch_members bm
    JOIN users u ON u.id = bm.student_id
    WHERE bm.batch_id = ?
    ORDER BY u.name, u.id
  `).all(batchId);
  res.json({ ...batch, members });
});

router.get('/sessions/:id/state', auth, (req, res) => {
  const sessionId = Number(req.params.id);
  let session = db.prepare(`
    SELECT ls.id, ls.batch_id, ls.status, b.trainer_id, b.session_type
    FROM live_sessions ls
    JOIN batches b ON b.id = ls.batch_id
    WHERE ls.id = ?
  `).get(sessionId);
  session = reconcileLiveSessionLifecycle(session);
  if (!session) return res.status(404).json({ error: 'Live session not found' });
  if (!isUserAllowedForSession(session, req.user)) {
    return res.status(403).json({ error: 'You are not part of this live session' });
  }
  const promoted = db.prepare('SELECT user_id FROM live_session_speakers WHERE live_session_id = ?').all(sessionId);
  const hands = db.prepare('SELECT user_id FROM live_session_hands WHERE live_session_id = ?').all(sessionId);
  const meActive = db
    .prepare(
      `SELECT 1 FROM live_session_participants
       WHERE live_session_id = ? AND user_id = ? AND left_at IS NULL
       LIMIT 1`
    )
    .get(sessionId, req.user.id);
  const recordingConfigured = liveRecording.isRecordingApiConfigured();
  const canSeeRecordingDebug =
    req.user.role === 'Admin' ||
    (req.user.role === 'Trainer' && isStaffForBatch(req.user.id, session.batch_id));
  let recordingFailureHint = null;
  if (canSeeRecordingDebug && recordingConfigured) {
    const fr = db
      .prepare(
        `SELECT error_text FROM live_session_recordings
         WHERE live_session_id = ? AND status = 'failed' AND error_text IS NOT NULL AND trim(error_text) != ''
         ORDER BY id DESC LIMIT 1`
      )
      .get(sessionId);
    if (fr?.error_text) recordingFailureHint = String(fr.error_text).slice(0, 400);
  }
  res.json({
    status: session.status,
    sessionType: session.session_type,
    promotedUserIds: promoted.map((r) => r.user_id),
    handRaisedUserIds: hands.map((r) => r.user_id),
    participantActive: Boolean(meActive),
    recordingActive: liveRecording.isRecordingActive(sessionId),
    recordingConfigured,
    recordingFailureHint,
  });
});

/** Pre-join: session title and window without joining the channel (Phase C green room). */
router.get('/sessions/:id/meta', auth, (req, res) => {
  const sessionId = Number(req.params.id);
  let session = db.prepare(`
    SELECT ls.id, ls.batch_id, ls.title, ls.status, ls.starts_at AS startsAt, ls.ends_at AS endsAt, b.session_type AS sessionType
    FROM live_sessions ls
    JOIN batches b ON b.id = ls.batch_id
    WHERE ls.id = ?
  `).get(sessionId);
  session = reconcileLiveSessionLifecycle({
    ...session,
    starts_at: session?.startsAt,
    ends_at: session?.endsAt,
  });
  if (session) {
    session = {
      ...session,
      startsAt: session.startsAt || session.starts_at,
      endsAt: session.endsAt || session.ends_at,
    };
  }
  if (!session) return res.status(404).json({ error: 'Live session not found' });
  if (!isUserAllowedForSession(session, req.user)) {
    return res.status(403).json({ error: 'You are not part of this live session' });
  }
  const { batch_id: _batchId, ...meta } = session;
  res.json(meta);
});

router.get('/sessions/:id/messages', auth, (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db.prepare(`
    SELECT ls.id, ls.batch_id, ls.status
    FROM live_sessions ls
    JOIN batches b ON b.id = ls.batch_id
    WHERE ls.id = ?
  `).get(sessionId);
  if (!session) return res.status(404).json({ error: 'Live session not found' });
  if (!isUserAllowedForSession(session, req.user)) {
    return res.status(403).json({ error: 'You are not part of this live session' });
  }
  const rawAfter = req.query.afterId;
  const afterId = rawAfter == null || rawAfter === '' ? 0 : Number(rawAfter);
  const safeAfter = Number.isFinite(afterId) && afterId >= 0 ? afterId : 0;
  const rows = db
    .prepare(
      `
    SELECT m.id, m.user_id AS userId, u.name AS userName, u.email AS userEmail, m.body, m.created_at AS createdAt
    FROM live_chat_messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.live_session_id = ? AND m.id > ?
    ORDER BY m.id ASC
    LIMIT 120
  `
    )
    .all(sessionId, safeAfter);
  res.json({ messages: rows });
});

router.post('/sessions/:id/messages', auth, (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db.prepare(`
    SELECT ls.id, ls.batch_id, ls.status
    FROM live_sessions ls
    JOIN batches b ON b.id = ls.batch_id
    WHERE ls.id = ?
  `).get(sessionId);
  if (!session) return res.status(404).json({ error: 'Live session not found' });
  if (!isUserAllowedForSession(session, req.user)) {
    return res.status(403).json({ error: 'You are not part of this live session' });
  }
  if (session.status === 'ended' || session.status === 'cancelled') {
    return res.status(409).json({ error: 'Session is not accepting messages' });
  }
  const key = `msg:${sessionId}:${req.user.id}`;
  if (!allowRate(key, 12, 10_000)) {
    return res.status(429).json({ error: 'Too many messages. Wait a few seconds.' });
  }
  let body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ error: 'body is required' });
  if (body.length > 2000) body = body.slice(0, 2000);
  const result = db
    .prepare(
      'INSERT INTO live_chat_messages (live_session_id, user_id, body) VALUES (?, ?, ?)'
    )
    .run(sessionId, req.user.id, body);
  logSessionEvent(sessionId, req.user.id, 'chat_message', String(result.lastInsertRowid));
  res.status(201).json({
    id: result.lastInsertRowid,
    userId: req.user.id,
    userName: req.user.name || null,
    userEmail: req.user.email || null,
    body,
    createdAt: new Date().toISOString(),
  });
});

router.get('/sessions/:id/reactions', auth, (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db.prepare(`
    SELECT ls.id, ls.batch_id, ls.status
    FROM live_sessions ls
    JOIN batches b ON b.id = ls.batch_id
    WHERE ls.id = ?
  `).get(sessionId);
  if (!session) return res.status(404).json({ error: 'Live session not found' });
  if (!isUserAllowedForSession(session, req.user)) {
    return res.status(403).json({ error: 'You are not part of this live session' });
  }
  const rawAfter = req.query.afterId;
  const afterId = rawAfter == null || rawAfter === '' ? 0 : Number(rawAfter);
  const safeAfter = Number.isFinite(afterId) && afterId >= 0 ? afterId : 0;
  const rows = db
    .prepare(
      `
    SELECT r.id, r.user_id AS userId, u.name AS userName, r.kind, r.created_at AS createdAt
    FROM live_reactions r
    JOIN users u ON u.id = r.user_id
    WHERE r.live_session_id = ? AND r.id > ?
    ORDER BY r.id ASC
    LIMIT 80
  `
    )
    .all(sessionId, safeAfter);
  res.json({ reactions: rows });
});

router.post('/sessions/:id/reactions', auth, (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db.prepare(`
    SELECT ls.id, ls.batch_id, ls.status
    FROM live_sessions ls
    JOIN batches b ON b.id = ls.batch_id
    WHERE ls.id = ?
  `).get(sessionId);
  if (!session) return res.status(404).json({ error: 'Live session not found' });
  if (!isUserAllowedForSession(session, req.user)) {
    return res.status(403).json({ error: 'You are not part of this live session' });
  }
  if (session.status === 'ended' || session.status === 'cancelled') {
    return res.status(409).json({ error: 'Session is not accepting reactions' });
  }
  const kind = typeof req.body?.kind === 'string' ? req.body.kind.trim() : '';
  if (!REACTION_KINDS.has(kind)) {
    return res.status(400).json({ error: 'Invalid reaction kind', allowed: [...REACTION_KINDS] });
  }
  const key = `react:${sessionId}:${req.user.id}`;
  if (!allowRate(key, 20, 60_000)) {
    return res.status(429).json({ error: 'Too many reactions. Try again in a minute.' });
  }
  const result = db
    .prepare('INSERT INTO live_reactions (live_session_id, user_id, kind) VALUES (?, ?, ?)')
    .run(sessionId, req.user.id, kind);
  logSessionEvent(sessionId, req.user.id, 'reaction', kind);
  res.status(201).json({
    id: result.lastInsertRowid,
    userId: req.user.id,
    userName: req.user.name || null,
    kind,
    createdAt: new Date().toISOString(),
  });
});

router.get('/sessions/:id/logs', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db.prepare(`
    SELECT ls.id, ls.batch_id, b.trainer_id
    FROM live_sessions ls
    JOIN batches b ON b.id = ls.batch_id
    WHERE ls.id = ?
  `).get(sessionId);
  if (!session) return res.status(404).json({ error: 'Live session not found' });
  if (req.user.role === 'Trainer' && !isStaffForBatch(req.user.id, session.batch_id)) {
    return res.status(403).json({ error: 'You can only view logs for your own sessions' });
  }
  const rows = db.prepare(`
    SELECT l.id, l.user_id AS userId, u.email AS userEmail, u.name AS userName, l.event_type AS eventType, l.detail, l.created_at AS createdAt
    FROM live_session_logs l
    LEFT JOIN users u ON u.id = l.user_id
    WHERE l.live_session_id = ?
    ORDER BY l.id DESC
    LIMIT 500
  `).all(sessionId);
  res.json(rows);
});

router.post('/sessions/:id/promote', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const sessionId = Number(req.params.id);
  const studentId = Number(req.body.studentId);
  if (!studentId) return res.status(400).json({ error: 'studentId is required' });

  const session = db.prepare(`
    SELECT ls.id, ls.batch_id, b.trainer_id, b.session_type
    FROM live_sessions ls
    JOIN batches b ON b.id = ls.batch_id
    WHERE ls.id = ?
  `).get(sessionId);
  if (!session) return res.status(404).json({ error: 'Live session not found' });
  if (req.user.role === 'Trainer' && !isStaffForBatch(req.user.id, session.batch_id)) {
    return res.status(403).json({ error: 'You can only manage your own session' });
  }
  if (session.session_type !== 'group') {
    return res.status(400).json({ error: 'Promote is only for group sessions' });
  }
  if (isStaffForBatch(studentId, session.batch_id)) {
    return res.status(400).json({ error: 'Cannot change host role' });
  }
  if (!isStudentInBatch(studentId, session.batch_id)) {
    return res.status(400).json({ error: 'Student is not in this batch' });
  }

  db.prepare(`
    INSERT INTO live_session_speakers (live_session_id, user_id, promoted_by)
    VALUES (?, ?, ?)
    ON CONFLICT(live_session_id, user_id) DO UPDATE SET promoted_by = excluded.promoted_by, created_at = datetime('now')
  `).run(sessionId, studentId, req.user.id);
  db.prepare('DELETE FROM live_session_hands WHERE live_session_id = ? AND user_id = ?').run(sessionId, studentId);
  logSessionEvent(sessionId, req.user.id, 'promote', JSON.stringify({ studentId }));
  res.json({ ok: true });
});

router.post('/sessions/:id/demote', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const sessionId = Number(req.params.id);
  const studentId = Number(req.body.studentId);
  if (!studentId) return res.status(400).json({ error: 'studentId is required' });

  const session = db.prepare(`
    SELECT ls.id, ls.batch_id, b.trainer_id
    FROM live_sessions ls
    JOIN batches b ON b.id = ls.batch_id
    WHERE ls.id = ?
  `).get(sessionId);
  if (!session) return res.status(404).json({ error: 'Live session not found' });
  if (req.user.role === 'Trainer' && !isStaffForBatch(req.user.id, session.batch_id)) {
    return res.status(403).json({ error: 'You can only manage your own session' });
  }

  db.prepare('DELETE FROM live_session_speakers WHERE live_session_id = ? AND user_id = ?').run(sessionId, studentId);
  logSessionEvent(sessionId, req.user.id, 'demote', JSON.stringify({ studentId }));
  res.json({ ok: true });
});

router.post('/sessions/:id/hand', auth, (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db.prepare(`
    SELECT ls.id, ls.batch_id, b.trainer_id
    FROM live_sessions ls
    JOIN batches b ON b.id = ls.batch_id
    WHERE ls.id = ?
  `).get(sessionId);
  if (!session) return res.status(404).json({ error: 'Live session not found' });
  if (!isUserAllowedForSession(session, req.user)) {
    return res.status(403).json({ error: 'You are not part of this live session' });
  }
  if (req.user.role !== 'Student' && req.user.role !== 'Lab') {
    return res.status(400).json({ error: 'Only students use raise hand' });
  }
  db.prepare(`
    INSERT INTO live_session_hands (live_session_id, user_id, raised_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(live_session_id, user_id) DO UPDATE SET raised_at = datetime('now')
  `).run(sessionId, req.user.id);
  logSessionEvent(sessionId, req.user.id, 'hand_raise', null);
  res.json({ ok: true });
});

router.post('/sessions/:id/hand/clear', auth, (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db.prepare(`
    SELECT ls.id, ls.batch_id, b.trainer_id
    FROM live_sessions ls
    JOIN batches b ON b.id = ls.batch_id
    WHERE ls.id = ?
  `).get(sessionId);
  if (!session) return res.status(404).json({ error: 'Live session not found' });
  if (!isUserAllowedForSession(session, req.user)) {
    return res.status(403).json({ error: 'You are not part of this live session' });
  }
  db.prepare('DELETE FROM live_session_hands WHERE live_session_id = ? AND user_id = ?').run(sessionId, req.user.id);
  res.json({ ok: true });
});

router.post('/batches', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const { name, sessionType, trainerId, studentIds } = req.body;
  if (!name || !sessionType || !['group', 'one_to_one'].includes(sessionType)) {
    return res.status(400).json({ error: 'name and valid sessionType are required' });
  }
  const effectiveTrainerId = req.user.role === 'Trainer' ? req.user.id : Number(trainerId || 0);
  if (!effectiveTrainerId) return res.status(400).json({ error: 'trainerId is required' });

  const trainer = db.prepare("SELECT id, role FROM users WHERE id = ? AND role IN ('Trainer', 'Admin')").get(effectiveTrainerId);
  if (!trainer) return res.status(404).json({ error: 'Trainer not found' });

  const inserted = db.prepare(
    'INSERT INTO batches (name, session_type, trainer_id, created_by) VALUES (?, ?, ?, ?)'
  ).run(name.trim(), sessionType, effectiveTrainerId, req.user.id);
  const batchId = inserted.lastInsertRowid;

  const addMember = db.prepare('INSERT OR IGNORE INTO batch_members (batch_id, student_id) VALUES (?, ?)');
  const ids = Array.isArray(studentIds) ? studentIds : [];
  ids.forEach((rawId) => {
    const studentId = Number(rawId);
    const student = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'Student'").get(studentId);
    if (student) addMember.run(batchId, studentId);
  });

  const batch = db.prepare(`
    SELECT b.id, b.name, b.session_type AS sessionType, b.trainer_id AS trainerId, u.name AS trainerName, b.created_at
    FROM batches b
    JOIN users u ON u.id = b.trainer_id
    WHERE b.id = ?
  `).get(batchId);
  res.status(201).json(batch);
});

router.post('/batches/:id/members', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const batchId = Number(req.params.id);
  const { studentId } = req.body;
  if (!studentId) return res.status(400).json({ error: 'studentId is required' });

  const batch = db.prepare('SELECT id, trainer_id FROM batches WHERE id = ?').get(batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (req.user.role === 'Trainer' && batch.trainer_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only manage your own batch' });
  }

  const student = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'Student'").get(studentId);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  db.prepare('INSERT OR IGNORE INTO batch_members (batch_id, student_id) VALUES (?, ?)').run(batchId, Number(studentId));
  res.status(201).json({ ok: true });
});

router.post('/sessions', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const { batchId, title, startsAt, endsAt } = req.body;
  if (!batchId || !title || !startsAt || !endsAt) {
    return res.status(400).json({ error: 'batchId, title, startsAt, endsAt are required' });
  }
  const batch = db.prepare('SELECT id, trainer_id FROM batches WHERE id = ?').get(batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (req.user.role === 'Trainer' && !isStaffForBatch(req.user.id, batchId)) {
    return res.status(403).json({ error: 'You can only create sessions for your own batch' });
  }

  const agoraChannel = `live_${batchId}_${crypto.randomUUID().slice(0, 12)}`;
  const result = db.prepare(`
    INSERT INTO live_sessions (batch_id, title, agora_channel, starts_at, ends_at, status, created_by)
    VALUES (?, ?, ?, ?, ?, 'scheduled', ?)
  `).run(Number(batchId), title.trim(), agoraChannel, startsAt, endsAt, req.user.id);

  const session = db.prepare('SELECT * FROM live_sessions WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(session);
});

router.post('/sessions/:id/start', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db.prepare(`
    SELECT ls.id, ls.status, ls.batch_id, ls.ends_at, b.trainer_id
    FROM live_sessions ls
    JOIN batches b ON b.id = ls.batch_id
    WHERE ls.id = ?
  `).get(sessionId);
  if (!session) return res.status(404).json({ error: 'Live session not found' });
  if (req.user.role === 'Trainer' && !isStaffForBatch(req.user.id, session.batch_id)) {
    return res.status(403).json({ error: 'You can only start your own session' });
  }
  db.prepare("UPDATE live_sessions SET status = 'live' WHERE id = ?").run(sessionId);
  res.json({ ok: true });
});

router.post('/sessions/:id/end', auth, requireRole('Admin', 'Trainer'), async (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db.prepare(`
    SELECT ls.id, ls.status, ls.batch_id, b.trainer_id
    FROM live_sessions ls
    JOIN batches b ON b.id = ls.batch_id
    WHERE ls.id = ?
  `).get(sessionId);
  if (!session) return res.status(404).json({ error: 'Live session not found' });
  if (req.user.role === 'Trainer' && !isStaffForBatch(req.user.id, session.batch_id)) {
    return res.status(403).json({ error: 'You can only end your own session' });
  }
  try {
    await liveRecording.forceStopRecordingForSession(sessionId);
  } catch (e) {
    console.warn('liveRecording.forceStopRecordingForSession', sessionId, e?.message || e);
  }
  const endedAt = new Date(session.ends_at || '').getTime();
  const shouldBeEnded = !Number.isNaN(endedAt) && Date.now() > endedAt;
  db.prepare('UPDATE live_session_participants SET left_at = datetime(\'now\') WHERE live_session_id = ? AND left_at IS NULL').run(sessionId);
  db.prepare("UPDATE live_sessions SET status = ? WHERE id = ?").run(shouldBeEnded ? 'ended' : 'scheduled', sessionId);
  db.prepare('DELETE FROM live_session_speakers WHERE live_session_id = ?').run(sessionId);
  db.prepare('DELETE FROM live_session_hands WHERE live_session_id = ?').run(sessionId);
  logSessionEvent(sessionId, req.user.id, 'session_force_leave', null);
  res.json({ ok: true, status: shouldBeEnded ? 'ended' : 'scheduled' });
});

router.post('/sessions/:id/join', auth, (req, res) => {
  const sessionId = Number(req.params.id);
  let session = db.prepare(`
    SELECT ls.id, ls.batch_id, ls.batch_session_id, ls.title, ls.agora_channel, ls.starts_at, ls.ends_at, ls.status, b.trainer_id, b.session_type
    FROM live_sessions ls
    JOIN batches b ON b.id = ls.batch_id
    WHERE ls.id = ?
  `).get(sessionId);
  session = reconcileLiveSessionLifecycle(session);
  if (!session) return res.status(404).json({ error: 'Live session not found' });
  if (!isUserAllowedForSession(session, req.user)) {
    return res.status(403).json({ error: 'You are not part of this live session' });
  }
  if (session.status === 'ended' || session.status === 'cancelled') {
    return res.status(409).json({ error: `Session is ${session.status}` });
  }

  const bypassTimeWindow =
    req.user.role === 'Admin' ||
    (req.user.role === 'Trainer' && isStaffForBatch(req.user.id, session.batch_id));
  const canEndSession =
    req.user.role === 'Admin' ||
    (req.user.role === 'Trainer' && isStaffForBatch(req.user.id, session.batch_id));
  const timeOk = bypassTimeWindow ? { ok: true } : joinTimeAllows(session);
  if (!timeOk.ok) {
    logSessionEvent(sessionId, req.user.id, 'join_denied', timeOk.code || 'time');
    return res.status(403).json({
      error:
        timeOk.code === 'outside_window'
          ? 'Join is only available shortly before and during the scheduled time.'
          : 'Cannot join this session right now.',
    });
  }

  const agoraRole = roleForAgora();
  const { token, expiresAt } = buildAgoraToken({
    channelName: session.agora_channel,
    uid: req.user.id,
    role: agoraRole,
  });

  db.prepare(`
    INSERT INTO live_session_participants (live_session_id, user_id, joined_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(live_session_id, user_id) DO UPDATE SET joined_at = datetime('now'), left_at = NULL
  `).run(sessionId, req.user.id);

  if (session.status === 'scheduled') {
    db.prepare("UPDATE live_sessions SET status = 'live' WHERE id = ?").run(sessionId);
  }

  logSessionEvent(sessionId, req.user.id, 'join', null);

  void liveRecording.maybeStartRecordingAfterJoin(sessionId).catch((e) =>
    console.warn('maybeStartRecordingAfterJoin', sessionId, e?.message || e)
  );

  res.json({
    liveSessionId: session.id,
    batchSessionId: session.batch_session_id || null,
    title: session.title,
    channelName: session.agora_channel,
    uid: req.user.id,
    role: agoraRole,
    sessionType: session.session_type,
    canEndSession,
    recordingConfigured: liveRecording.isRecordingApiConfigured(),
    appId: process.env.AGORA_APP_ID || null,
    token,
    tokenExpiresAt: expiresAt,
    agoraReady: Boolean(process.env.AGORA_APP_ID && process.env.AGORA_APP_CERTIFICATE && token),
    warning: token
      ? null
      : 'Agora token is not generated. Set AGORA_APP_ID, AGORA_APP_CERTIFICATE and install agora-access-token in backend.',
  });
});

router.post('/sessions/:id/token', auth, (req, res) => {
  const sessionId = Number(req.params.id);
  let session = db.prepare(`
    SELECT ls.id, ls.batch_id, ls.agora_channel, ls.starts_at, ls.ends_at, ls.status, b.trainer_id, b.session_type
    FROM live_sessions ls
    JOIN batches b ON b.id = ls.batch_id
    WHERE ls.id = ?
  `).get(sessionId);
  session = reconcileLiveSessionLifecycle(session);
  if (!session) return res.status(404).json({ error: 'Live session not found' });
  if (!isUserAllowedForSession(session, req.user)) {
    return res.status(403).json({ error: 'You are not part of this live session' });
  }
  if (session.status === 'ended' || session.status === 'cancelled') {
    return res.status(409).json({ error: `Session is ${session.status}` });
  }
  const bypassTimeWindow =
    req.user.role === 'Admin' ||
    (req.user.role === 'Trainer' && isStaffForBatch(req.user.id, session.batch_id));
  const timeOk = bypassTimeWindow ? { ok: true } : joinTimeAllows(session);
  if (!timeOk.ok) {
    return res.status(403).json({
      error:
        timeOk.code === 'outside_window'
          ? 'Join is only available shortly before and during the scheduled time.'
          : 'Cannot refresh token for this session right now.',
    });
  }

  const agoraRole = roleForAgora();
  const { token, expiresAt } = buildAgoraToken({
    channelName: session.agora_channel,
    uid: req.user.id,
    role: agoraRole,
  });
  if (!token) {
    return res.status(503).json({
      error: 'Agora token generation is not configured',
      warning: 'Set AGORA_APP_ID, AGORA_APP_CERTIFICATE and install agora-access-token in backend.',
    });
  }
  res.json({ token, tokenExpiresAt: expiresAt, channelName: session.agora_channel, uid: req.user.id, role: agoraRole });
});

router.post('/sessions/:id/leave', auth, (req, res) => {
  const sessionId = Number(req.params.id);
  db.prepare(`
    UPDATE live_session_participants
    SET left_at = datetime('now')
    WHERE live_session_id = ? AND user_id = ? AND left_at IS NULL
  `).run(sessionId, req.user.id);
  logSessionEvent(sessionId, req.user.id, 'leave', null);

  void liveRecording.maybeStopRecordingAfterLeave(sessionId).catch((e) =>
    console.warn('maybeStopRecordingAfterLeave', sessionId, e?.message || e)
  );

  const s = db
    .prepare('SELECT id, status, starts_at, ends_at FROM live_sessions WHERE id = ?')
    .get(sessionId);
  if (s) reconcileLiveSessionLifecycle(s);

  res.json({ ok: true });
});

function safeJsonParse(str, fallback) {
  if (str == null || str === '') return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

async function derivePlaybackUrls(cdnUrlsJson, fileListJson, storagePrefix) {
  const list = safeJsonParse(fileListJson, []);
  const prefix = String(storagePrefix || '').replace(/\/+$/, '');
  const urls = [];
  const useSigned = isSpacesConfigured();
  for (const f of list) {
    const fn = f?.fileName;
    if (!fn || /\.ts(\?|$)/i.test(String(fn))) continue;
    if (String(fn).startsWith('http')) {
      urls.push(fn);
      continue;
    }
    const key = prefix && String(fn).startsWith(prefix) ? fn : `${prefix}/${String(fn).replace(/^\/+/, '')}`;
    try {
      if (useSigned) {
        const signed = await getSignedPlaybackUrl(key);
        if (signed) urls.push(signed);
      } else {
        urls.push(buildPublicUrl(key));
      }
    } catch {
      /* ignore malformed */
    }
  }
  if (urls.length === 0) {
    const fallback = safeJsonParse(cdnUrlsJson, []);
    return Array.isArray(fallback) ? fallback : [];
  }
  const mp4 = urls.filter((u) => /\.mp4(\?|$)/i.test(String(u)));
  if (mp4.length) return mp4;
  const hls = urls.filter((u) => /\.m3u8(\?|$)/i.test(String(u)));
  return hls.length ? hls : urls;
}

router.get('/sessions/:id/recordings', auth, async (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db.prepare(`
    SELECT ls.id, ls.batch_id
    FROM live_sessions ls
    WHERE ls.id = ?
  `).get(sessionId);
  if (!session) return res.status(404).json({ error: 'Live session not found' });
  if (!isUserAllowedForSession(session, req.user)) {
    return res.status(403).json({ error: 'You are not part of this live session' });
  }
  const rows = await Promise.all(
    liveRecording.listRecordingsForSession(sessionId).map(async (r) => ({
      ...r,
      cdnUrls: await derivePlaybackUrls(r.cdn_urls_json, r.file_list_json, r.storage_prefix),
      fileList: safeJsonParse(r.file_list_json, []),
    }))
  );
  res.json({ recordings: rows });
});

router.get('/batches/:batchId/recordings', auth, requireRole('Admin', 'Trainer'), async (req, res) => {
  const batchId = Number(req.params.batchId);
  const batch = db.prepare('SELECT id, trainer_id FROM batches WHERE id = ?').get(batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (req.user.role === 'Trainer' && !isStaffForBatch(req.user.id, batchId)) {
    return res.status(403).json({ error: 'You can only view recordings for your own batch' });
  }
  const rows = await Promise.all(
    liveRecording.listRecordingsForBatch(batchId).map(async (r) => ({
      id: r.id,
      liveSessionId: r.live_session_id,
      batchId: r.batch_id,
      liveTitle: r.liveTitle,
      startsAt: r.startsAt,
      stoppedAt: r.stopped_at,
      expiresAt: r.expires_at,
      cdnUrls: await derivePlaybackUrls(r.cdn_urls_json, r.file_list_json, r.storage_prefix),
    }))
  );
  res.json({ recordings: rows });
});

/** Users currently in the room (joined, not left). Same access rules as joining the session. */
router.get('/sessions/:id/participants', auth, (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db.prepare(`
    SELECT ls.id, ls.batch_id, ls.status
    FROM live_sessions ls
    WHERE ls.id = ?
  `).get(sessionId);
  if (!session) return res.status(404).json({ error: 'Live session not found' });
  if (!isUserAllowedForSession(session, req.user)) {
    return res.status(403).json({ error: 'You are not part of this live session' });
  }
  const rows = db
    .prepare(
      `
    SELECT u.id, u.name, u.email, u.role, p.joined_at AS joinedAt
    FROM live_session_participants p
    JOIN users u ON u.id = p.user_id
    WHERE p.live_session_id = ? AND p.left_at IS NULL
    ORDER BY p.joined_at ASC, u.id ASC
  `
    )
    .all(sessionId);
  res.json(rows);
});

module.exports = router;
