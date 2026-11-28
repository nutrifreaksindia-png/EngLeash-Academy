import { AudioSession } from '@livekit/react-native';
import { RemoteParticipant, Room, RoomEvent, Track, VideoTrack } from 'livekit-client';

function asVideoTrack(track: Track | undefined): VideoTrack | null {
  if (track && track.kind === Track.Kind.Video) return track as VideoTrack;
  return null;
}

type ConnectArgs = {
  url: string;
  token: string;
  roomName: string;
  onConnectionState?: (state: string) => void;
  onRemotePresence?: () => void;
  onActiveSpeaker?: (uid: number | null) => void;
  onJoined?: () => void;
  onMediaWarning?: (message: string, available: { mic: boolean; cam: boolean }) => void;
};

export type LiveKitClient = {
  kind: 'livekit';
  room: Room;
  roomName: string;
  disconnect: () => Promise<void>;
  setMicEnabled: (on: boolean) => Promise<void>;
  setCamEnabled: (on: boolean) => Promise<void>;
  renewToken: (token: string) => Promise<void>;
  getRemoteParticipants: () => RemoteParticipant[];
  getLocalVideoTrack: () => VideoTrack | null;
  getRemoteVideoTrack: (uid: number) => VideoTrack | null;
  getScreenShareTrack: () => VideoTrack | null;
  isScreenSharing: () => boolean;
  setScreenShareEnabled: (on: boolean) => Promise<void>;
  identityToUid: (identity: string) => number | null;
};

export async function connectLiveKitRoom({
  url,
  token,
  roomName,
  onConnectionState,
  onRemotePresence,
  onActiveSpeaker,
  onJoined,
  onMediaWarning,
}: ConnectArgs): Promise<LiveKitClient> {
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
  });

  room.on(RoomEvent.ConnectionStateChanged, (state) => {
    onConnectionState?.(String(state));
    if (String(state) === 'connected') onJoined?.();
  });

  room.on(RoomEvent.ParticipantConnected, () => onRemotePresence?.());
  room.on(RoomEvent.ParticipantDisconnected, () => onRemotePresence?.());
  room.on(RoomEvent.TrackSubscribed, () => onRemotePresence?.());
  room.on(RoomEvent.TrackUnsubscribed, () => onRemotePresence?.());
  room.on(RoomEvent.TrackMuted, () => onRemotePresence?.());
  room.on(RoomEvent.TrackUnmuted, () => onRemotePresence?.());
  room.on(RoomEvent.LocalTrackPublished, () => onRemotePresence?.());
  room.on(RoomEvent.LocalTrackUnpublished, () => onRemotePresence?.());

  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    const first = speakers?.[0];
    const id = first?.identity != null ? Number(first.identity) : null;
    onActiveSpeaker?.(Number.isFinite(id) ? id : null);
  });

  await room.connect(url, token, { autoSubscribe: true });

  await AudioSession.startAudioSession();
  // Publish separately: a blocked or missing camera/mic must not stop someone watching the class.
  const [mic, cam] = await Promise.allSettled([
    room.localParticipant.setMicrophoneEnabled(true),
    room.localParticipant.setCameraEnabled(true),
  ]);
  const missing = [mic.status === 'rejected' ? 'microphone' : null, cam.status === 'rejected' ? 'camera' : null]
    .filter(Boolean)
    .join(' and ');
  if (missing) {
    onMediaWarning?.(`Joined without your ${missing}. Allow access in Settings to use it.`, {
      mic: mic.status === 'fulfilled',
      cam: cam.status === 'fulfilled',
    });
  }

  onConnectionState?.('connected');
  onRemotePresence?.();
  onJoined?.();

  return {
    room,
    roomName,
    kind: 'livekit',
    async disconnect() {
      try {
        try {
          await AudioSession.stopAudioSession();
        } catch {
          /* ignore */
        }
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
        await Promise.race([
          room.disconnect(true),
          new Promise<void>((resolve) => {
            setTimeout(resolve, 3000);
          }),
        ]);
      } catch {
        /* ignore */
      }
    },
    async setMicEnabled(on: boolean) {
      await room.localParticipant.setMicrophoneEnabled(on);
    },
    async setCamEnabled(on: boolean) {
      await room.localParticipant.setCameraEnabled(on);
    },
    async renewToken(nextToken: string) {
      if (!nextToken) return;
      await room.engine.client.handleTokenRefresh(nextToken);
    },
    getRemoteParticipants() {
      return [...room.remoteParticipants.values()];
    },
    getLocalVideoTrack() {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      return asVideoTrack(pub?.track);
    },
    getRemoteVideoTrack(uid: number) {
      for (const p of room.remoteParticipants.values()) {
        if (Number(p.identity) !== uid) continue;
        const pub = p.getTrackPublication(Track.Source.Camera);
        if (pub?.track && !pub.isMuted) return asVideoTrack(pub.track);
      }
      return null;
    },
    getScreenShareTrack() {
      // Only other people's screens: rendering your own share would mirror endlessly.
      for (const p of room.remoteParticipants.values()) {
        const pub = p.getTrackPublication(Track.Source.ScreenShare);
        if (pub?.track && !pub.isMuted) return asVideoTrack(pub.track);
      }
      return null;
    },
    isScreenSharing() {
      return room.localParticipant.isScreenShareEnabled;
    },
    async setScreenShareEnabled(on: boolean) {
      await room.localParticipant.setScreenShareEnabled(on);
    },
    identityToUid(identity: string) {
      const n = Number(identity);
      return Number.isFinite(n) ? n : null;
    },
  };
}
