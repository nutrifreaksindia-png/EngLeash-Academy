import { Room, RoomEvent, Track } from 'livekit-client';

function disconnectWithTimeout(room, ms = 3000) {
  return Promise.race([
    room.disconnect(true),
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
  ]);
}

/** @type {Map<string, { track: import('livekit-client').Track, el: HTMLMediaElement }>} */
const remoteAudioByIdentity = new Map();

function syncRemoteLiveKitAudio(room) {
  const activeKeys = new Set();
  for (const participant of room.remoteParticipants.values()) {
    const key = String(participant.identity);
    const pub = participant.getTrackPublication(Track.Source.Microphone);
    const track = pub?.track;
    if (!track || pub.isMuted) continue;
    activeKeys.add(key);
    if (remoteAudioByIdentity.has(key)) continue;
    const el = track.attach();
    el.style.display = 'none';
    document.body.appendChild(el);
    remoteAudioByIdentity.set(key, { track, el });
  }
  for (const [key, { track, el }] of [...remoteAudioByIdentity.entries()]) {
    if (activeKeys.has(key)) continue;
    try {
      track.detach(el);
      el.remove();
    } catch {
      /* ignore */
    }
    remoteAudioByIdentity.delete(key);
  }
}

export function detachAllLiveKitRemoteAudio() {
  for (const [, { track, el }] of remoteAudioByIdentity.entries()) {
    try {
      track.detach(el);
      el.remove();
    } catch {
      /* ignore */
    }
  }
  remoteAudioByIdentity.clear();
}

/**
 * Connect self-hosted LiveKit and wire callbacks used by LiveClassroomPage.
 * @param {object} p
 */
export async function connectLiveKitRoom({
  url,
  token,
  roomName,
  onConnectionState,
  onRemotePresence,
  onActiveSpeaker,
  onLocalTracks,
  onDeviceWarning,
}) {
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
  });

  room.on(RoomEvent.ConnectionStateChanged, (state) => {
    onConnectionState?.(String(state));
  });

  const bumpPresence = () => {
    syncRemoteLiveKitAudio(room);
    onRemotePresence?.();
  };

  room.on(RoomEvent.ParticipantConnected, bumpPresence);
  room.on(RoomEvent.ParticipantDisconnected, bumpPresence);
  room.on(RoomEvent.TrackSubscribed, bumpPresence);
  room.on(RoomEvent.TrackUnsubscribed, bumpPresence);
  room.on(RoomEvent.TrackMuted, bumpPresence);
  room.on(RoomEvent.TrackUnmuted, bumpPresence);
  room.on(RoomEvent.LocalTrackUnpublished, bumpPresence);

  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    const first = speakers?.[0];
    const id = first?.identity != null ? Number(first.identity) : null;
    onActiveSpeaker?.(Number.isFinite(id) ? id : null);
  });

  await room.connect(url, token, { autoSubscribe: true });

  // Publish mic and camera independently so a dead/virtual camera (e.g. a disconnected
  // Windows Phone Link device) does not block joining with audio.
  const localTracks = [];
  let micError = null;
  let camError = null;
  try {
    const pub = await room.localParticipant.setMicrophoneEnabled(true);
    if (pub?.track) localTracks.push(pub.track);
  } catch (e) {
    micError = e;
  }
  try {
    const pub = await room.localParticipant.setCameraEnabled(true);
    if (pub?.track) localTracks.push(pub.track);
  } catch (e) {
    camError = e;
    try {
      const cams = await Room.getLocalDevices('videoinput', true);
      for (const cam of cams) {
        try {
          const pub = await room.localParticipant.setCameraEnabled(true, { deviceId: cam.deviceId });
          if (pub?.track) {
            localTracks.push(pub.track);
            camError = null;
            break;
          }
        } catch {
          /* try next camera */
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (micError && camError) {
    await disconnectWithTimeout(room);
    throw new Error(micError?.message || 'Camera/microphone permission denied or no device found.');
  }
  const warnings = [];
  if (camError) warnings.push('No working camera found — you joined without video. Check your camera or pick another one.');
  if (micError) warnings.push('No working microphone found — you joined without audio.');
  onDeviceWarning?.(warnings.join(' '));
  onLocalTracks?.(localTracks);

  onConnectionState?.('connected');
  syncRemoteLiveKitAudio(room);
  onRemotePresence?.();

  return {
    room,
    roomName,
    kind: 'livekit',
    async disconnect() {
      try {
        detachAllLiveKitRemoteAudio();
        for (const pub of room.localParticipant.trackPublications.values()) {
          const t = pub.track;
          if (t) {
            try {
              t.stop?.();
            } catch {
              /* ignore */
            }
          }
        }
        await disconnectWithTimeout(room);
      } catch {
        /* ignore */
      }
    },
    async setMicEnabled(on) {
      await room.localParticipant.setMicrophoneEnabled(on);
    },
    async setCamEnabled(on) {
      await room.localParticipant.setCameraEnabled(on);
    },
    getRemoteParticipants() {
      return [...room.remoteParticipants.values()];
    },
    getLocalVideoTrack() {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      return pub?.track ?? null;
    },
    identityToUid(identity) {
      const n = Number(identity);
      return Number.isFinite(n) ? n : null;
    },
    async renewToken(nextToken) {
      if (!nextToken) return;
      await room.engine.client.handleTokenRefresh(nextToken);
    },
  };
}

export function attachLiveKitVideo(track, container) {
  if (!track || !container) return () => {};
  const el = track.attach();
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.objectFit = 'cover';
  container.appendChild(el);
  return () => {
    try {
      track.detach(el);
      el.remove();
    } catch {
      /* ignore */
    }
  };
}
