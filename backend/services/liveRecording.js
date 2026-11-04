'use strict';

const crypto = require('crypto');
const db = require('../db');
const livekitEgress = require('./livekitEgress');

const RETENTION_DAYS = Number(process.env.LIVE_RECORDING_RETENTION_DAYS || 14);

function logSessionEvent(sessionId, userId, eventType, detail) {
  try {
    db.prepare(
      'INSERT INTO live_session_logs (live_session_id, user_id, event_type, detail) VALUES (?, ?, ?, ?)'
    ).run(sessionId, userId || null, eventType, detail == null ? null : String(detail));
  } catch (_) {
    /* ignore */
  }
}

function pickRecordingUidString() {
  const lo = 2000000001;
  const hi = 2147483646;
  return String(crypto.randomInt(lo, hi));
}

function countActiveParticipants(sessionId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM live_session_participants WHERE live_session_id = ? AND left_at IS NULL`
    )
    .get(sessionId);
  return Number(row?.n || 0);
}

function getActiveRecordingSegment(sessionId) {
  return db
    .prepare(
      `SELECT * FROM live_session_recordings
       WHERE live_session_id = ? AND status IN ('starting', 'recording', 'stopping')
       ORDER BY id DESC LIMIT 1`
    )
    .get(sessionId);
}

function sessionRoomName(session) {
  return session?.room_name || null;
}

function buildStoragePrefixParts(session, sessionId, segmentId, startedAt) {
  const dateStr = startedAt.slice(0, 10);
  return [
    'live-recordings',
    'live-session-recordings',
    `batch-${session.batch_id}`,
    `session-${sessionId}`,
    dateStr,
    `seg-${segmentId}`,
  ];
}

function isRecordingApiConfigured() {
  return livekitEgress.isEgressConfigured();
}

async function finalizeStoppedSegment(segmentRow) {
  let fileList = [];
  let urls = [];
  const fp = segmentRow.storage_prefix ? `${segmentRow.storage_prefix.replace(/\/+$/, '')}/room.mp4` : null;
  if (fp) {
    const url = livekitEgress.playbackUrlForFilepath(fp);
    if (url) {
      fileList = [{ fileName: fp }];
      urls = [url];
    }
  }

  const expires = new Date(Date.now() + RETENTION_DAYS * 864e5).toISOString();
  db.prepare(
    `UPDATE live_session_recordings
     SET status = 'stopped',
         stopped_at = datetime('now'),
         expires_at = ?,
         file_list_json = ?,
         cdn_urls_json = ?,
         updated_at = datetime('now'),
         error_text = NULL
     WHERE id = ?`
  ).run(expires, JSON.stringify(fileList), JSON.stringify(urls), segmentRow.id);
  logSessionEvent(segmentRow.live_session_id, null, 'recording_stopped', JSON.stringify({ segmentId: segmentRow.id }));
}

async function startLiveKitSegment(session, sessionId, segmentId, storagePrefix) {
  const roomName = sessionRoomName(session);
  if (!roomName) throw new Error('session missing room name');
  const filepath = `${storagePrefix.replace(/\/+$/, '')}/room.mp4`;
  const { egressId } = await livekitEgress.startRoomCompositeMp4({
    roomName,
    filepath,
  });

  db.prepare(
    `UPDATE live_session_recordings
     SET livekit_egress_id = ?, status = 'recording', storage_prefix = ?, rtc_provider = 'livekit', updated_at = datetime('now'), error_text = NULL
     WHERE id = ?`
  ).run(egressId, storagePrefix, segmentId);

  logSessionEvent(sessionId, null, 'recording_started', JSON.stringify({ segmentId, egressId, provider: 'livekit' }));
}

async function maybeStartRecordingAfterJoin(sessionId) {
  if (!isRecordingApiConfigured()) return;
  if (countActiveParticipants(sessionId) < 1) return;

  const session = db
    .prepare(`SELECT ls.id, ls.batch_id, ls.room_name, ls.status FROM live_sessions ls WHERE ls.id = ?`)
    .get(sessionId);
  if (!session || session.status === 'ended' || session.status === 'cancelled') return;
  if (getActiveRecordingSegment(sessionId)) return;

  const recordingUid = pickRecordingUidString();
  const startedAt = new Date().toISOString();
  const ins = db
    .prepare(
      `INSERT INTO live_session_recordings (
        live_session_id, batch_id, recording_uid, status, started_at, rtc_provider, updated_at
      ) VALUES (?, ?, ?, 'starting', ?, 'livekit', datetime('now'))`
    )
    .run(sessionId, session.batch_id, recordingUid, startedAt);

  const segmentId = ins.lastInsertRowid;
  const fileNamePrefix = buildStoragePrefixParts(session, sessionId, segmentId, startedAt);
  const storagePrefix = `${fileNamePrefix.join('/')}/`;

  try {
    await startLiveKitSegment(session, sessionId, segmentId, storagePrefix);
  } catch (e) {
    const msg = e?.message || String(e);
    db.prepare(
      `UPDATE live_session_recordings SET status = 'failed', error_text = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(msg, segmentId);
    logSessionEvent(sessionId, null, 'recording_failed', msg);
  }
}

async function stopActiveSegment(seg) {
  await livekitEgress.stopEgress(seg.livekit_egress_id);
  await finalizeStoppedSegment(seg);
}

async function maybeStopRecordingAfterLeave(sessionId) {
  if (!isRecordingApiConfigured()) return;
  if (countActiveParticipants(sessionId) !== 0) return;

  const seg = getActiveRecordingSegment(sessionId);
  if (!seg) return;

  db.prepare(`UPDATE live_session_recordings SET status = 'stopping', updated_at = datetime('now') WHERE id = ?`).run(seg.id);

  try {
    await stopActiveSegment(seg);
  } catch (e) {
    const msg = e?.message || String(e);
    db.prepare(
      `UPDATE live_session_recordings SET status = 'failed', error_text = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(msg, seg.id);
    logSessionEvent(sessionId, null, 'recording_stop_failed', msg);
  }
}

async function forceStopRecordingForSession(sessionId) {
  if (!isRecordingApiConfigured()) return;

  const seg = getActiveRecordingSegment(sessionId);
  if (!seg) return;

  db.prepare(`UPDATE live_session_recordings SET status = 'stopping', updated_at = datetime('now') WHERE id = ?`).run(seg.id);

  try {
    await stopActiveSegment(seg);
  } catch (e) {
    const msg = e?.message || String(e);
    db.prepare(
      `UPDATE live_session_recordings SET status = 'failed', error_text = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(msg, seg.id);
    logSessionEvent(sessionId, null, 'recording_stop_failed', msg);
  }
}

function forceStopForBatchSessionLink(batchSessionId) {
  const rows = db.prepare(`SELECT id FROM live_sessions WHERE batch_session_id = ?`).all(batchSessionId);
  for (const r of rows) {
    void forceStopRecordingForSession(r.id).catch((e) =>
      console.warn('liveRecording forceStop batchSession', batchSessionId, e?.message || e)
    );
  }
}

function isRecordingActive(sessionId) {
  const row = db
    .prepare(
      `SELECT 1 AS x FROM live_session_recordings
       WHERE live_session_id = ? AND status IN ('starting', 'recording', 'stopping') LIMIT 1`
    )
    .get(sessionId);
  return !!row;
}

function listRecordingsForSession(sessionId) {
  return db
    .prepare(
      `SELECT id, live_session_id, batch_id, status, storage_prefix, cdn_urls_json, file_list_json, started_at, stopped_at, expires_at, error_text, rtc_provider, livekit_egress_id
       FROM live_session_recordings WHERE live_session_id = ? ORDER BY id ASC`
    )
    .all(sessionId);
}

function listRecordingsForBatch(batchId) {
  return db
    .prepare(
      `SELECT r.id, r.live_session_id, r.batch_id, r.status, r.cdn_urls_json, r.file_list_json, r.storage_prefix, r.started_at, r.stopped_at, r.expires_at,
              ls.title AS liveTitle, ls.starts_at AS startsAt
       FROM live_session_recordings r
       JOIN live_sessions ls ON ls.id = r.live_session_id
       WHERE r.batch_id = ? AND r.status = 'stopped'
       ORDER BY r.stopped_at DESC, r.id DESC`
    )
    .all(batchId);
}

function parseFirstPlaybackUrl(cdnJson) {
  if (!cdnJson) return null;
  try {
    const arr = typeof cdnJson === 'string' ? JSON.parse(cdnJson) : cdnJson;
    if (Array.isArray(arr) && arr.length) return arr[0];
  } catch (_) {
    /* ignore */
  }
  return null;
}

function enrichLiveSessionsList(rows) {
  const stmt = db.prepare(
    `SELECT cdn_urls_json FROM live_session_recordings
     WHERE live_session_id = ? AND status = 'stopped'
     ORDER BY datetime(stopped_at) DESC, id DESC LIMIT 1`
  );
  return rows.map((r) => {
    const rec = stmt.get(r.id);
    const recordingPlaybackUrl = parseFirstPlaybackUrl(rec?.cdn_urls_json);
    return { ...r, recordingPlaybackUrl: recordingPlaybackUrl || null };
  });
}

module.exports = {
  maybeStartRecordingAfterJoin,
  maybeStopRecordingAfterLeave,
  forceStopRecordingForSession,
  forceStopForBatchSessionLink,
  isRecordingActive,
  listRecordingsForSession,
  listRecordingsForBatch,
  enrichLiveSessionsList,
  isRecordingApiConfigured,
  RETENTION_DAYS,
};
