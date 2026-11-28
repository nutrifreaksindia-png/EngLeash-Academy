'use strict';

/**
 * Who may be in a live classroom.
 *
 * Hosts (Admin, or a trainer of the batch) enter directly and activate the meeting.
 * Everyone else waits until a host admits them, and only while the meeting is active.
 * The meeting stays active through connection drops; it lapses when a host ends it
 * or when nobody is left in the room.
 */
const db = require('../db');

function isHost(user, batchId) {
  if (!user) return false;
  if (user.role === 'Admin') return true;
  if (user.role !== 'Trainer') return false;
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM batches b
         WHERE b.id = ? AND (b.trainer_id = ? OR EXISTS (
           SELECT 1 FROM batch_trainers bt WHERE bt.batch_id = b.id AND bt.trainer_id = ?))`
      )
      .get(batchId, user.id, user.id)
  );
}

function isMeetingActive(sessionId) {
  return Boolean(db.prepare('SELECT 1 FROM live_session_activations WHERE live_session_id = ?').get(sessionId));
}

function activateMeeting(sessionId, hostId) {
  db.prepare(
    `INSERT OR IGNORE INTO live_session_activations (live_session_id, activated_by, activated_at)
     VALUES (?, ?, datetime('now'))`
  ).run(sessionId, hostId);
}

function deactivateMeeting(sessionId) {
  db.prepare('DELETE FROM live_session_activations WHERE live_session_id = ?').run(sessionId);
}

/** Hosts who have joined this session and not left. */
function presentHostIds(sessionId) {
  return (
    db
      .prepare(
        `SELECT p.user_id AS id FROM live_session_participants p
         JOIN users u ON u.id = p.user_id
         JOIN live_sessions ls ON ls.id = p.live_session_id
         JOIN batches b ON b.id = ls.batch_id
         WHERE p.live_session_id = ? AND p.left_at IS NULL AND (
           u.role = 'Admin' OR (u.role = 'Trainer' AND (b.trainer_id = u.id OR EXISTS (
             SELECT 1 FROM batch_trainers bt WHERE bt.batch_id = b.id AND bt.trainer_id = u.id))))`
      )
      .all(sessionId)
      .map((row) => row.id)
  );
}

/** True while at least one host is in the room. */
function isHostPresent(sessionId) {
  return presentHostIds(sessionId).length > 0;
}

/** 'waiting', 'admitted', 'denied' or null when entry was never requested. */
function admissionStatus(sessionId, userId) {
  const row = db
    .prepare('SELECT status FROM live_session_admissions WHERE live_session_id = ? AND user_id = ?')
    .get(sessionId, userId);
  return row?.status || null;
}

/** Put a participant in the waiting room. An existing admission is kept, so reconnecting needs no second approval. */
function requestEntry(sessionId, userId) {
  db.prepare(
    `INSERT INTO live_session_admissions (live_session_id, user_id, status, requested_at)
     VALUES (?, ?, 'waiting', datetime('now'))
     ON CONFLICT(live_session_id, user_id) DO UPDATE SET status = 'waiting', requested_at = datetime('now'),
       decided_at = NULL, decided_by = NULL
     WHERE live_session_admissions.status = 'denied'`
  ).run(sessionId, userId);
}

function mayParticipate(sessionId, batchId, user) {
  if (isHost(user, batchId)) return true;
  return isMeetingActive(sessionId) && admissionStatus(sessionId, user.id) === 'admitted';
}

function listWaiting(sessionId) {
  return db
    .prepare(
      `SELECT a.user_id AS userId, COALESCE(NULLIF(trim(u.name), ''), u.email) AS name
       FROM live_session_admissions a
       JOIN users u ON u.id = a.user_id
       WHERE a.live_session_id = ? AND a.status = 'waiting'
       ORDER BY a.requested_at, a.id`
    )
    .all(sessionId);
}

/** Admit or deny one person, or everyone waiting when userId is null. Returns how many changed. */
function decide(sessionId, userId, status, hostId) {
  const one = userId != null;
  const result = db
    .prepare(
      `UPDATE live_session_admissions SET status = ?, decided_at = datetime('now'), decided_by = ?
       WHERE live_session_id = ? AND ${one ? 'user_id = ?' : "status = 'waiting'"}`
    )
    .run(...[status, hostId, sessionId, ...(one ? [userId] : [])]);
  return result.changes;
}

/** When a class is ended, everyone has to be admitted again next time. */
function resetSession(sessionId) {
  deactivateMeeting(sessionId);
  db.prepare('DELETE FROM live_session_admissions WHERE live_session_id = ?').run(sessionId);
}

module.exports = {
  isHost,
  isMeetingActive,
  activateMeeting,
  deactivateMeeting,
  isHostPresent,
  presentHostIds,
  admissionStatus,
  requestEntry,
  mayParticipate,
  listWaiting,
  decide,
  resetSession,
};
