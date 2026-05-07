/**
 * Deletes DigitalOcean Spaces objects for live session recordings past retention and marks DB rows `expired`.
 *
 * Usage (from backend/):
 *   node scripts/pruneLiveSessionRecordings.js
 *
 * Requires SPACES_* env when deleting objects. Rows are still marked expired if Spaces is unconfigured
 * (objects may already be gone); prefer configuring Spaces for real deletes.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db = require('../db');
const { deleteObjectsUnderPrefix, isSpacesConfigured } = require('../services/spaces');

async function main() {
  const rows = db
    .prepare(
      `SELECT id, storage_prefix FROM live_session_recordings
       WHERE status IN ('stopped', 'failed')
         AND expires_at IS NOT NULL
         AND datetime(expires_at) < datetime('now')`
    )
    .all();

  let deletedObjects = 0;
  let marked = 0;

  for (const r of rows) {
    const prefix = r.storage_prefix ? String(r.storage_prefix) : '';
    if (prefix && isSpacesConfigured()) {
      try {
        deletedObjects += await deleteObjectsUnderPrefix(prefix);
      } catch (e) {
        console.error(`[pruneLiveSessionRecordings] Spaces delete failed for segment ${r.id}:`, e?.message || e);
        continue;
      }
    }
    db.prepare(`UPDATE live_session_recordings SET status = 'expired', updated_at = datetime('now') WHERE id = ?`).run(r.id);
    marked += 1;
  }

  console.log(
    `[pruneLiveSessionRecordings] Marked ${marked} segment(s) expired; deleted ~${deletedObjects} object(s) from Spaces.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
