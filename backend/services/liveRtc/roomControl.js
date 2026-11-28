'use strict';

/** Asks the video server who is connected, and disconnects people so access does not rest on the apps behaving. */
const { RoomServiceClient } = require('livekit-server-sdk');
const livekit = require('./livekitProvider');

function client() {
  if (!livekit.isConfigured()) return null;
  return new RoomServiceClient(livekit.livekitHttpUrl(), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
}

async function attempt(label, action) {
  const rooms = client();
  if (!rooms) return;
  try {
    await action(rooms);
  } catch (e) {
    // The room or participant may simply not be there any more.
    console.warn(label, e?.message || e);
  }
}

function closeRoom(roomName) {
  if (!roomName) return Promise.resolve();
  return attempt('livekit closeRoom', (rooms) => rooms.deleteRoom(roomName));
}

function removeParticipant(roomName, userId) {
  if (!roomName) return Promise.resolve();
  return attempt('livekit removeParticipant', (rooms) => rooms.removeParticipant(roomName, String(userId)));
}

/** Identities (user ids as text) connected to the room right now. Empty when the room does not exist yet. */
async function connectedIdentities(roomName) {
  let identities = [];
  if (!roomName) return identities;
  await attempt('livekit listParticipants', async (rooms) => {
    identities = (await rooms.listParticipants(roomName)).map((p) => p.identity);
  });
  return identities;
}

module.exports = { closeRoom, removeParticipant, connectedIdentities };
