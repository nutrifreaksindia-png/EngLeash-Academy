/**
 * Deletes DigitalOcean Spaces objects for assignment responses past admin retention
 * and clears remote file_url/file_key (spaces_status = expired).
 *
 * Usage (from backend/):
 *   node scripts/pruneAssignmentResponses.js
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { ensureV1Tables } = require('../migrations/v1');
const db = require('../db');
const { runAssignmentResponsePrune } = require('../lib/pruneAssignmentResponses');

ensureV1Tables(db);

runAssignmentResponsePrune()
  .then((summary) => {
    console.log('[pruneAssignmentResponses]', summary);
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
