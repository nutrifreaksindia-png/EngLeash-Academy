'use strict';

const { AccessToken } = require('livekit-server-sdk');

function livekitWsUrl() {
  const raw = String(process.env.LIVEKIT_URL || '').trim();
  return raw || null;
}

function livekitHttpUrl() {
  const ws = livekitWsUrl();
  if (!ws) return null;
  return ws.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
}

function isConfigured() {
  return Boolean(
    livekitWsUrl() &&
      process.env.LIVEKIT_API_KEY &&
      process.env.LIVEKIT_API_SECRET
  );
}

async function buildJoinCredentials({ roomName, userId, displayName }) {
  const url = livekitWsUrl();
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!url || !apiKey || !apiSecret) {
    return {
      rtcProvider: 'livekit',
      roomName,
      channelName: roomName,
      uid: userId,
      role: 'publisher',
      tokenExpiresAt: null,
      livekitUrl: url,
      livekitToken: null,
      livekitReady: false,
      warning: 'Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET for self-hosted LiveKit.',
    };
  }

  const identity = String(userId);
  const ttlSeconds = Number(process.env.LIVEKIT_TOKEN_EXPIRY_SECONDS || 3600);
  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name: displayName ? String(displayName).slice(0, 120) : identity,
    ttl: ttlSeconds,
  });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  return {
    rtcProvider: 'livekit',
    roomName,
    channelName: roomName,
    uid: userId,
    role: 'publisher',
    tokenExpiresAt: expiresAt,
    livekitUrl: url,
    livekitToken: token,
    livekitReady: Boolean(token),
    warning: null,
  };
}

module.exports = {
  isConfigured,
  buildJoinCredentials,
  livekitWsUrl,
  livekitHttpUrl,
};
