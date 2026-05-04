/**
 * Thin wrapper so you can run from the repo root:
 *   node scripts/purgeAllBatches.js --confirm
 * Implementation: backend/scripts/purgeAllBatches.js
 */
const path = require('path');
require(path.join(__dirname, '..', 'backend', 'scripts', 'purgeAllBatches.js'));
