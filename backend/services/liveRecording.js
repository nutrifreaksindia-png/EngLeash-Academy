'use strict';

const crypto = require('crypto');
const db = require('../db');
const { buildPublicUrl } = require('./spaces');
const agoraRec = require('./agoraRecording');

let RtcTokenBuilder = null;
let RtcRole = null;
try {
  ({ RtcTokenBuilder, RtcRole } = require('agora-access-token'));
} catch (_) {
  /* optional */
}

const RETENTION_DAYS = Number(process.env.LIVE_RECORDING_RETENTION_DAYS || 14);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

function buildRecordingToken(channelName, uidNum) {
  const appId = process.env.AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;
  if (!appId || !appCertificate || !RtcTokenBuilder || !RtcRole) {
    throw new Error('agora-access-token and AGORA_APP_ID/CERTIFICATE required for recording bot token');
  }
  const privilegeSeconds = Number(process.env.AGORA_TOKEN_EXPIRY_SECONDS || 3600);
  const privilegeExpireTime = Math.floor(Date.now() / 1000) + privilegeSeconds;
  return RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    uidNum,
    RtcRole.PUBLISHER,
    privilegeExpireTime
  );
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

function extractFileList(resp) {
  const sr = resp?.serverResponse || resp?.ServerResponse;
  if (!sr) return [];
  let list = sr.fileList;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }
  return Array.isArray(list) ? list : [];
}

function playbackUrlsFromFileList(fileList, storagePrefix) {
  const prefix = String(storagePrefix || '').replace(/\/+$/, '');
  const urls = [];
  for (const f of fileList) {
    const fn = f?.fileName;
    if (!fn) continue;
    if (/\.ts(\?|$)/i.test(fn)) continue;
    if (String(fn).startsWith('http')) {
      urls.push(fn);
      continue;
    }
    const key = fn.startsWith(prefix) ? fn : `${prefix}/${String(fn).replace(/^\/+/, '')}`;
    try {
      urls.push(buildPublicUrl(key));
    } catch (_) {
      /* ignore */
    }
  }
  const mp4 = urls.filter((u) => /\.mp4(\?|$)/i.test(u));
  if (mp4.length) return mp4;
  const hls = urls.filter((u) => /\.m3u8(\?|$)/i.test(u));
  return hls.length ? hls : urls;
}

async function pollUntilFiles({ resourceId, sid, storagePrefix, maxAttempts = 20, delayMs = 2000 }) {
  let lastList = [];
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const q = await agoraRec.queryMix({ resourceId, sid });
      lastList = extractFileList(q);
      if (lastList.length) {
        const urls = playbackUrlsFromFileList(lastList, storagePrefix);
        if (urls.length) return { fileList: lastList, urls };
      }
    } catch (_) {
      /* keep polling briefly */
    }
    await sleep(delayMs);
  }
  return { fileList: lastList, urls: playbackUrlsFromFileList(lastList, storagePrefix) };
}

/**
 * Start a new recording segment when the first participant is present.
 */
async function maybeStartRecordingAfterJoin(sessionId) {
  if (!agoraRec.isRecordingApiConfigured()) {
    return;
  }
  if (countActiveParticipants(sessionId) !== 1) return;

  const session = db
    .prepare(
      `SELECT ls.id, ls.batch_id, ls.agora_channel, ls.status
       FROM live_sessions ls WHERE ls.id = ?`
    )
    .get(sessionId);
  if (!session || session.status === 'ended' || session.status === 'cancelled') return;

  if (getActiveRecordingSegment(sessionId)) return;

  const recordingUid = pickRecordingUidString();
  const uidNum = Number(recordingUid);
  const startedAt = new Date().toISOString();

  const ins = db
    .prepare(
      `INSERT INTO live_session_recordings (
        live_session_id, batch_id, recording_uid, status, started_at, updated_at
      ) VALUES (?, ?, ?, 'starting', ?, datetime('now'))`
    )
    .run(sessionId, session.batch_id, recordingUid, startedAt);

  const segmentId = ins.lastInsertRowid;
  const dateStr = startedAt.slice(0, 10);
  const fileNamePrefix = [
    'live-recordings',
    // Agora Cloud Recording rejects some prefixes (for example spaces in segments).
    // Keep folder semantics but use a strict-safe slug segment.
    'live-session-recordings',
    `batch-${session.batch_id}`,
    `session-${sessionId}`,
    dateStr,
    `seg-${segmentId}`,
  ];
  const storagePrefix = `${fileNamePrefix.join('/')}/`;

  try {
    const acq = await agoraRec.acquire({ cname: session.agora_channel, uid: recordingUid });
    const resourceId = acq.resourceId || acq.resource_id;
    if (!resourceId) throw new Error('acquire did not return resourceId');

    const token = buildRecordingToken(session.agora_channel, uidNum);
    const storageConfig = agoraRec.buildSpacesStorageConfig(fileNamePrefix);
    const recordingConfig = agoraRec.buildMixRecordingConfig480p();
    // Agora mix mode rejects mp4-only outputs; include HLS + MP4.
    const recordingFileConfig = { avFileType: ['hls', 'mp4'] };

    const st = await agoraRec.startMix({
      resourceId,
      cname: session.agora_channel,
      uid: recordingUid,
      clientRequest: {
        token,
        storageConfig,
        recordingConfig,
        recordingFileConfig,
      },
    });
    const sid = st.sid || st.recordingId;
    if (!sid) throw new Error('start did not return sid');

    db.prepare(
      `UPDATE live_session_recordings
       SET agora_resource_id = ?, agora_sid = ?, status = 'recording', storage_prefix = ?, updated_at = datetime('now'), error_text = NULL
       WHERE id = ?`
    ).run(resourceId, sid, storagePrefix, segmentId);

    logSessionEvent(sessionId, null, 'recording_started', JSON.stringify({ segmentId, resourceId, sid }));
  } catch (e) {
    const msg = e?.message || String(e);
    db.prepare(
      `UPDATE live_session_recordings SET status = 'failed', error_text = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(msg, segmentId);
    logSessionEvent(sessionId, null, 'recording_failed', msg);
  }
}

async function finalizeStoppedSegment(segmentRow, stopResponse) {
  const storagePrefix = segmentRow.storage_prefix || '';
  let fileList = extractFileList(stopResponse);
  let urls = playbackUrlsFromFileList(fileList, storagePrefix);

  if (!urls.length && segmentRow.agora_resource_id && segmentRow.agora_sid) {
    const polled = await pollUntilFiles({
      resourceId: segmentRow.agora_resource_id,
      sid: segmentRow.agora_sid,
      storagePrefix,
    });
    fileList = polled.fileList.length ? polled.fileList : fileList;
    urls = polled.urls;
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
  ).run(
    expires,
    JSON.stringify(fileList),
    JSON.stringify(urls),
    segmentRow.id
  );
  logSessionEvent(segmentRow.live_session_id, null, 'recording_stopped', JSON.stringify({ segmentId: segmentRow.id }));
}

/**
 * Stop active recording when the last participant leaves the room (RTC leave API).
 */
async function maybeStopRecordingAfterLeave(sessionId) {
  if (!agoraRec.isRecordingApiConfigured()) return;
  if (countActiveParticipants(sessionId) !== 0) return;

  const seg = getActiveRecordingSegment(sessionId);
  if (!seg) return;

  if (!seg.agora_resource_id || !seg.agora_sid) {
    db.prepare(
      `UPDATE live_session_recordings SET status = 'failed', error_text = 'stopped_before_agora_ready', updated_at = datetime('now') WHERE id = ?`
    ).run(seg.id);
    return;
  }

  db.prepare(`UPDATE live_session_recordings SET status = 'stopping', updated_at = datetime('now') WHERE id = ?`).run(seg.id);

  try {
    const session = db.prepare(`SELECT agora_channel FROM live_sessions WHERE id = ?`).get(sessionId);
    if (!session) throw new Error('session missing');

    const stopResp = await agoraRec.stopMix({
      resourceId: seg.agora_resource_id,
      sid: seg.agora_sid,
      cname: session.agora_channel,
      uid: seg.recording_uid,
      asyncStop: false,
    });
    await finalizeStoppedSegment(seg, stopResp);
  } catch (e) {
    const msg = e?.message || String(e);
    db.prepare(
      `UPDATE live_session_recordings SET status = 'failed', error_text = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(msg, seg.id);
    logSessionEvent(sessionId, null, 'recording_stop_failed', msg);
  }
}

/**
 * Force-stop recording (session ended/cancelled by trainer/admin).
 */
async function forceStopRecordingForSession(sessionId) {
  if (!agoraRec.isRecordingApiConfigured()) return;

  const seg = getActiveRecordingSegment(sessionId);
  if (!seg) return;

  if (!seg.agora_resource_id || !seg.agora_sid) {
    db.prepare(
      `UPDATE live_session_recordings SET status = 'failed', error_text = coalesce(error_text, 'force_stop_no_agora_ids'), updated_at = datetime('now') WHERE id = ?`
    ).run(seg.id);
    return;
  }

  db.prepare(`UPDATE live_session_recordings SET status = 'stopping', updated_at = datetime('now') WHERE id = ?`).run(seg.id);

  try {
    const session = db.prepare(`SELECT agora_channel FROM live_sessions WHERE id = ?`).get(sessionId);
    if (!session) return;

    const stopResp = await agoraRec.stopMix({
      resourceId: seg.agora_resource_id,
      sid: seg.agora_sid,
      cname: session.agora_channel,
      uid: seg.recording_uid,
      asyncStop: false,
    });
    await finalizeStoppedSegment({ ...seg }, stopResp);
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
      `SELECT id, live_session_id, batch_id, status, storage_prefix, cdn_urls_json, file_list_json, started_at, stopped_at, expires_at, error_text
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

/** Attach recordingPlaybackUrl for ended sessions (latest stopped segment). */
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
  isRecordingApiConfigured: agoraRec.isRecordingApiConfigured,
  RETENTION_DAYS,
};
