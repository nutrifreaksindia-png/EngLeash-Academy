'use strict';

const livekit = require('./livekitProvider');

async function buildJoinCredentials({ roomName, userId, displayName }) {
  return livekit.buildJoinCredentials({ roomName, userId, displayName });
}

function isRtcConfigured() {
  return livekit.isConfigured();
}

function providerName() {
  return 'livekit';
}

module.exports = {
  buildJoinCredentials,
  isRtcConfigured,
  providerName,
};
