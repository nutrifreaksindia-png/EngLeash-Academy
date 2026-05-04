#!/usr/bin/env node
/**
 * Optional: create/update live_sessions rows for batches that already have batch_sessions
 * but were started before ensureLiveSessionsForBatch existed.
 *
 * Usage: node scripts/backfillLiveSessions.js
 */
const db = require('../db');
const { ensureLiveSessionsForBatch } = require('../services/ensureLiveSessionsForBatch');

const rows = db.prepare('SELECT DISTINCT batch_id FROM batch_sessions').all();
let ok = 0;
let fail = 0;
for (const { batch_id } of rows) {
  try {
    const r = ensureLiveSessionsForBatch(batch_id);
    console.log(`batch ${batch_id}:`, r);
    ok += 1;
  } catch (e) {
    console.warn(`batch ${batch_id}:`, e.message);
    fail += 1;
  }
}
console.log(`Done. ${ok} batches ok, ${fail} failed.`);
