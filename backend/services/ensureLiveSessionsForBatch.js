const db = require('../db');

function normalizeTimeFragment(t) {
  if (t == null || String(t).trim() === '') return '09:00:00';
  const s = String(t).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    return s.slice(11, 19) || '09:00:00';
  }
  if (/^\d{2}:\d{2}$/.test(s)) return `${s}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s;
  return '09:00:00';
}

function combineDateTime(dateStr, timeFrag) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const t = normalizeTimeFragment(timeFrag);
  return `${dateStr}T${t}`;
}

function liveStatusFromBatchSession(bs) {
  if (bs.status === 'cancelled') return 'cancelled';
  if (bs.status === 'completed') return 'ended';
  return 'scheduled';
}

function stableChannelName(batchSessionId) {
  return `live_bs_${batchSessionId}_main`;
}

/**
 * For each batch_session row, ensure a sibling live_sessions row (same time window, stable channel).
 * Idempotent: skips rows that already have batch_session_id linked.
 */
function ensureLiveSessionsForBatch(batchId) {
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
  if (!batch) throw new Error('Batch not found');

  const createdBy = batch.created_by || batch.trainer_id;
  if (!createdBy) throw new Error('Batch has no trainer/created_by for live session ownership');

  const rows = db.prepare('SELECT * FROM batch_sessions WHERE batch_id = ? ORDER BY session_day').all(batchId);

  const insert = db.prepare(`
    INSERT INTO live_sessions (batch_id, title, agora_channel, starts_at, ends_at, status, created_by, batch_session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateTimes = db.prepare(`
    UPDATE live_sessions
    SET title = ?, starts_at = ?, ends_at = ?, status = ?, batch_id = ?
    WHERE id = ?
  `);

  let created = 0;
  let updated = 0;

  for (const bs of rows) {
    const startsAt = combineDateTime(bs.session_date, bs.starts_at);
    const endsAt = combineDateTime(bs.session_date, bs.ends_at);
    if (!startsAt || !endsAt) continue;

    const title = `Day ${String(bs.session_day).padStart(2, '0')}`;
    const targetStatus = liveStatusFromBatchSession(bs);
    const channel = stableChannelName(bs.id);

    const existing = db
      .prepare('SELECT * FROM live_sessions WHERE batch_session_id = ?')
      .get(bs.id);

    if (existing) {
      updateTimes.run(title, startsAt, endsAt, targetStatus, batchId, existing.id);
      updated += 1;
      continue;
    }

    try {
      insert.run(
        batchId,
        title,
        channel,
        startsAt,
        endsAt,
        targetStatus,
        createdBy,
        bs.id
      );
      created += 1;
    } catch (e) {
      if (String(e.message || '').includes('UNIQUE')) {
        const clash = db.prepare('SELECT id FROM live_sessions WHERE agora_channel = ?').get(channel);
        if (clash) {
          db.prepare('UPDATE live_sessions SET batch_session_id = ?, title = ?, starts_at = ?, ends_at = ?, status = ? WHERE id = ?').run(
            bs.id,
            title,
            startsAt,
            endsAt,
            targetStatus,
            clash.id
          );
          updated += 1;
        }
      } else {
        throw e;
      }
    }
  }

  return { created, updated, total: rows.length };
}

module.exports = {
  ensureLiveSessionsForBatch,
  combineDateTime,
  stableChannelName,
};
