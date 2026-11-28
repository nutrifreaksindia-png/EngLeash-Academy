/**
 * Keeps audio clear on weak networks by reducing video, and restores video gradually.
 * The mobile app has the same rule in mobile-app/src/live/audioFirst.ts: change both together.
 *
 * Level 0: normal, LiveKit's adaptive stream, dynacast and simulcast do the work.
 * Level 1: our upload is capped and low quality is requested from others.
 * Level 2: incoming video is paused, except the host and the active speaker.
 * Audio is never touched at any level.
 */
import { ConnectionQuality, RoomEvent, Track, VideoQuality } from 'livekit-client';
export const STEP_DOWN_AFTER_MS = 6000;
export const PAUSE_AFTER_MS = 12000;
export const STEP_UP_AFTER_MS = 20000;
const SAMPLE_MS = 3000;
/** Statistics are unreliable while a class is still connecting, so nothing is judged for this long. */
const SETTLE_MS = 10000;
export function initialLevelState() {
    return { level: 0, badSince: null, goodSince: null };
}
/** Pure rule, so brief blips do not flip quality back and forth. */
export function nextLevel(state, signal, now) {
    if (signal === 'good') {
        const goodSince = state.goodSince ?? now;
        if (state.level > 0 && now - goodSince >= STEP_UP_AFTER_MS) {
            return { level: (state.level - 1), badSince: null, goodSince: now };
        }
        return { level: state.level, badSince: null, goodSince };
    }
    const badSince = state.badSince ?? now;
    if (state.level === 0 && now - badSince >= STEP_DOWN_AFTER_MS)
        return { level: 1, badSince: now, goodSince: null };
    if (state.level === 1 && signal === 'severe' && now - badSince >= PAUSE_AFTER_MS) {
        return { level: 2, badSince: now, goodSince: null };
    }
    return { level: state.level, badSince, goodSince: null };
}
/**
 * Measured audio packet loss decides the signal. LiveKit's "poor" rating is deliberately not used: our
 * own upload cap lowers that rating, so the network could never be seen to recover.
 */
export function signalFrom(quality, audioLoss) {
    if (quality === ConnectionQuality.Lost || audioLoss >= 0.15)
        return 'severe';
    if (audioLoss >= 0.05)
        return 'poor';
    return 'good';
}
/** Upload caps per encoding. Layers stay under dynacast's control; only their ceiling changes. */
const CAPS = {
    1: { maxBitrate: 150000, maxFramerate: 15 },
    2: { maxBitrate: 80000, maxFramerate: 10 },
};
export function startAudioFirst(room, onChange) {
    let state = initialLevelState();
    let alwaysShow = new Set();
    let quality;
    /** Smoothed, so one lucky or unlucky sample does not decide. */
    let loss = 0;
    const paused = new Set();
    const lastAudio = new Map();
    const originalEncodings = new WeakMap();
    const report = async (publication) => {
        const stats = await publication?.track?.getRTCStatsReport?.().catch(() => undefined);
        const rows = [];
        stats?.forEach((row) => rows.push(row));
        return rows;
    };
    /** Worse of: audio packets lost on the way to us, and lost on the way from us. */
    const sampleAudioLoss = async () => {
        let lost = 0;
        let received = 0;
        for (const participant of room.remoteParticipants.values()) {
            for (const row of await report(participant.getTrackPublication(Track.Source.Microphone))) {
                if (row.type !== 'inbound-rtp')
                    continue;
                const now = { lost: Number(row.packetsLost) || 0, received: Number(row.packetsReceived) || 0 };
                const before = lastAudio.get(participant.identity);
                lastAudio.set(participant.identity, now);
                if (!before || now.received < before.received)
                    continue;
                lost += Math.max(0, now.lost - before.lost);
                received += now.received - before.received;
            }
        }
        // Too few packets (everyone silent) says nothing about the network.
        const down = lost + received >= 25 ? lost / (lost + received) : 0;
        let up = 0;
        for (const row of await report(room.localParticipant.getTrackPublication(Track.Source.Microphone))) {
            if (row.type === 'remote-inbound-rtp')
                up = Math.max(up, Number(row.fractionLost) || 0);
        }
        return Math.max(down, up);
    };
    const capUpload = async () => {
        const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
        const sender = track?.sender;
        if (!sender?.getParameters)
            return;
        try {
            const params = sender.getParameters();
            if (!params.encodings?.length)
                return;
            if (!originalEncodings.has(sender)) {
                if (state.level === 0)
                    return;
                originalEncodings.set(sender, params.encodings.map((e) => ({ maxBitrate: e.maxBitrate, maxFramerate: e.maxFramerate })));
            }
            const original = originalEncodings.get(sender);
            params.encodings.forEach((encoding, i) => {
                const cap = state.level === 0 ? null : CAPS[state.level];
                const base = original[i] || {};
                const bitrate = cap ? Math.min(base.maxBitrate ?? cap.maxBitrate, cap.maxBitrate) : base.maxBitrate;
                const framerate = cap ? Math.min(base.maxFramerate ?? cap.maxFramerate, cap.maxFramerate) : base.maxFramerate;
                if (bitrate !== undefined)
                    encoding.maxBitrate = bitrate;
                if (framerate !== undefined)
                    encoding.maxFramerate = framerate;
            });
            await sender.setParameters(params);
            if (state.level === 0)
                originalEncodings.delete(sender);
        }
        catch (e) {
            console.warn('Could not adjust outgoing video', e);
        }
    };
    /** Hand a publication back to adaptive stream. livekit-client has no public call for this. */
    const resume = (publication) => {
        publication.requestedDisabled = undefined;
        publication.emitTrackUpdate?.();
    };
    const applyIncoming = () => {
        const speaker = room.activeSpeakers.find((p) => p !== room.localParticipant)?.identity;
        let changed = false;
        for (const participant of room.remoteParticipants.values()) {
            const publication = participant.getTrackPublication(Track.Source.Camera);
            if (!publication?.isSubscribed)
                continue;
            publication.setVideoQuality(state.level === 0 ? VideoQuality.HIGH : VideoQuality.LOW);
            const shouldPause = state.level === 2 && !alwaysShow.has(participant.identity) && participant.identity !== speaker;
            if (shouldPause && !paused.has(participant.identity)) {
                publication.setEnabled(false);
                paused.add(participant.identity);
                changed = true;
            }
            else if (!shouldPause && paused.has(participant.identity)) {
                resume(publication);
                paused.delete(participant.identity);
                changed = true;
            }
        }
        for (const identity of paused) {
            if (!room.remoteParticipants.has(identity))
                paused.delete(identity);
        }
        if (changed)
            onChange();
    };
    const apply = () => {
        applyIncoming();
        void capUpload();
    };
    const onQuality = (value, participant) => {
        if (participant.identity === room.localParticipant.identity)
            quality = value;
    };
    /** New or restarted tracks must follow the current level too. */
    const onTracks = () => {
        if (state.level > 0)
            apply();
    };
    const onSpeakers = () => {
        if (state.level === 2)
            applyIncoming();
    };
    room.on(RoomEvent.ConnectionQualityChanged, onQuality);
    room.on(RoomEvent.TrackSubscribed, onTracks);
    room.on(RoomEvent.LocalTrackPublished, onTracks);
    room.on(RoomEvent.Reconnected, onTracks);
    room.on(RoomEvent.ActiveSpeakersChanged, onSpeakers);
    // The server may pause a video itself when our download is starved.
    room.on(RoomEvent.TrackStreamStateChanged, onChange);
    let busy = false;
    let connectedSince = 0;
    const timer = setInterval(async () => {
        if (String(room.state) !== 'connected') {
            connectedSince = 0;
            return;
        }
        connectedSince = connectedSince || Date.now();
        if (busy)
            return;
        busy = true;
        try {
            loss = (loss + (await sampleAudioLoss())) / 2;
            if (Date.now() - connectedSince < SETTLE_MS)
                return;
            const before = state.level;
            state = nextLevel(state, signalFrom(quality, loss), Date.now());
            if (state.level !== before) {
                apply();
                onChange();
            }
        }
        finally {
            busy = false;
        }
    }, SAMPLE_MS);
    return {
        level: () => state.level,
        isVideoPaused: (identity) => {
            if (paused.has(identity))
                return true;
            const publication = room.remoteParticipants.get(identity)?.getTrackPublication(Track.Source.Camera);
            return String(publication?.track?.streamState) === 'paused' && state.level > 0;
        },
        setAlwaysShow: (identities) => {
            alwaysShow = new Set(identities);
            if (state.level === 2)
                applyIncoming();
        },
        stop: () => {
            clearInterval(timer);
            room.off(RoomEvent.ConnectionQualityChanged, onQuality);
            room.off(RoomEvent.TrackSubscribed, onTracks);
            room.off(RoomEvent.LocalTrackPublished, onTracks);
            room.off(RoomEvent.Reconnected, onTracks);
            room.off(RoomEvent.ActiveSpeakersChanged, onSpeakers);
            room.off(RoomEvent.TrackStreamStateChanged, onChange);
        },
    };
}
