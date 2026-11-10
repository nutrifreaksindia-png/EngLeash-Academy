const db = require('../db');
const { isSpacesConfigured, deleteObjectKeys } = require('../services/spaces');

/**
 * Delete Spaces objects for assignment submissions past retention and clear remote URLs.
 * Keeps submission rows (text/score/review) so history remains; students rely on device cache for media.
 */
async function runAssignmentResponsePrune() {
  const rows = db
    .prepare(
      `SELECT id, file_key, occurrence_id, batch_id, assignment_id
       FROM assignment_submissions
       WHERE expires_at IS NOT NULL
         AND datetime(expires_at) < datetime('now')
         AND COALESCE(spaces_status, 'active') = 'active'
         AND file_key IS NOT NULL
         AND TRIM(file_key) != ''
         AND TRIM(file_key) != 'none'`,
    )
    .all();

  let deletedObjects = 0;
  let marked = 0;

  for (const r of rows) {
    const key = String(r.file_key || '').replace(/^\/+/, '');
    if (key && isSpacesConfigured()) {
      try {
        deletedObjects += await deleteObjectKeys([key]);
      } catch (e) {
        console.error('[assignment-response-prune] delete failed', r.id, e?.message || e);
        continue;
      }
    }

    db.prepare(
      `UPDATE assignment_submissions SET
         spaces_status = 'expired',
         file_url = '',
         file_key = 'none'
       WHERE id = ?`,
    ).run(r.id);
    marked += 1;
  }

  // Also expire rows that never had media (text/other) once past expires_at.
  const textExpired = db
    .prepare(
      `UPDATE assignment_submissions SET spaces_status = 'expired'
       WHERE expires_at IS NOT NULL
         AND datetime(expires_at) < datetime('now')
         AND COALESCE(spaces_status, 'active') = 'active'
         AND (file_key IS NULL OR TRIM(file_key) = '' OR TRIM(file_key) = 'none')`,
    )
    .run();

  return { scanned: rows.length, marked: marked + (textExpired.changes || 0), deletedObjects };
}

module.exports = { runAssignmentResponsePrune };
