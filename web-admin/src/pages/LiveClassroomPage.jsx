import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Track } from 'livekit-client';
import {
  attachLiveKitVideo,
  connectLiveKitRoom,
  detachAllLiveKitRemoteAudio,
} from '../live/connectLiveKitRoom.js';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';

/** True in `npm run dev`, or add `?liveDebug=1` to the URL (any build). Filter console with: EngLeash Live */
function isLiveDebug() {
  try {
    if (import.meta.env.DEV) return true;
    return new URLSearchParams(window.location.search).get('liveDebug') === '1';
  } catch {
    return Boolean(import.meta.env.DEV);
  }
}

function liveDbg(...args) {
  if (isLiveDebug()) console.log('[EngLeash Live]', ...args);
}

function liveDbgWarn(...args) {
  if (isLiveDebug()) console.warn('[EngLeash Live]', ...args);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    }),
  ]);
}

async function exitPictureInPictureWithTimeout(ms = 1500) {
  try {
    if (!document.pictureInPictureElement) return;
    await withTimeout(document.exitPictureInPicture().catch(() => {}), ms);
  } catch {
    /* ignore */
  }
}

async function liveApi(path, token, options = {}) {
  const { timeoutMs, ...fetchOptions } = options;
  const headers = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers || {}),
    Authorization: `Bearer ${token}`,
  };
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer =
    controller != null
      ? window.setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : null;
  try {
    const res = await fetch(`${API_BASE}/api${path}`, {
      ...fetchOptions,
      headers,
      signal: controller?.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('Request timed out');
    throw e;
  } finally {
    if (timer != null) window.clearTimeout(timer);
  }
}

/** Request layout pass after DOM / RTC state updates. */
function bumpRemoteLayout(repositionRef) {
  requestAnimationFrame(() => {
    try {
      repositionRef.current?.();
    } catch (e) {
      console.warn('Live classroom: layout bump failed', e);
    }
  });
}

/** Optional green-room bypass: `?skipPreJoin=1` (not advertised in UI). */
function readSkipPreJoin() {
  try {
    return new URLSearchParams(window.location.search).get('skipPreJoin') === '1';
  } catch {
    return false;
  }
}

const REACTION_EMOJI = {
  thumbsup: '👍',
  clap: '👏',
  heart: '❤️',
  laugh: '😂',
  think: '🤔',
};

function LiveSvg({ children }) {
  return (
    <svg
      className="liveSvgIcon"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export default function LiveClassroomPage({ token }) {
  const { liveSessionId } = useParams();
  const navigate = useNavigate();
  const id = Number(liveSessionId);
  const [readyToEnter, setReadyToEnter] = useState(readSkipPreJoin);
  const [phase, setPhase] = useState(() => (readSkipPreJoin() ? 'loading' : 'preJoin')); // preJoin | loading | inRoom | error | leaving | left
  const [preJoinMeta, setPreJoinMeta] = useState(null);
  const [sessionRunId, setSessionRunId] = useState(0);
  const suppressJoinRef = useRef(false);
  const leaveInProgressRef = useRef(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [deviceHint, setDeviceHint] = useState('');
  const [joinMeta, setJoinMeta] = useState(null);
  const [rtcState, setRtcState] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  /** Bump after local tracks are published so the “play preview” effect runs (tracks weren’t ready on first inRoom paint). */
  const [localTracksVersion, setLocalTracksVersion] = useState(0);
  const [participants, setParticipants] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactionMenuOpen, setReactionMenuOpen] = useState(false);
  const [hangupMenuOpen, setHangupMenuOpen] = useState(false);
  const [showTechDetails, setShowTechDetails] = useState(false);
  const [remoteTileCount, setRemoteTileCount] = useState(0);
  /** Count of remote users publishing video (empty-state hints). */
  const [remoteVideoCount, setRemoteVideoCount] = useState(0);
  /** Others connected to the LiveKit room (drives solo vs gallery layout). */
  const [remotePeerCount, setRemotePeerCount] = useState(0);
  const [activeSpeakerUid, setActiveSpeakerUid] = useState(null);
  const [participantPanelOpen, setParticipantPanelOpen] = useState(false);
  const [roomState, setRoomState] = useState(null);
  /** Re-render participant panel when remotes change (panel reads clientRef). */
  const [rtcPresenceTick, setRtcPresenceTick] = useState(0);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [reactionFeed, setReactionFeed] = useState([]);
  const [flashMessages, setFlashMessages] = useState([]);
  /** Bumps when pre-join getUserMedia stream is attached so track enabled state can sync to micOn/camOn. */
  const [preJoinPreviewKey, setPreJoinPreviewKey] = useState(0);
  const menuRef = useRef(null);
  const reactionMenuRef = useRef(null);
  const hangupMenuRef = useRef(null);
  const preJoinVideoRef = useRef(null);
  const preJoinStreamRef = useRef(null);
  const lastChatPollIdRef = useRef(0);
  const lastReactPollIdRef = useRef(0);
  const flashTimersRef = useRef(new Map());

  const clientRef = useRef(null);
  const rtcProviderRef = useRef('livekit');
  const livekitLocalDetachRef = useRef(null);
  /** Latest mic/cam intent; read when joining so join effect deps stay stable. */
  const micCamForJoinRef = useRef({ mic: true, cam: true });
  const localTracksRef = useRef([]);
  const renewTimerRef = useRef(null);
  const localVideoRef = useRef(null);
  /** When others are in the channel, remote tiles append here (`display: contents` so tiles are grid siblings with local). */
  const galleryRemoteSlotRef = useRef(null);
  const remoteLayoutRootRef = useRef(null);
  const localJoinUidRef = useRef(null);
  const repositionRef = useRef(() => {});
  const remoteElsRef = useRef(new Map());
  /** After layout mounts (phase === inRoom), attach local camera preview — refs are null if play() runs inside join() before React paints. Do not stop() here; teardown stops tracks on leave. */
  useEffect(() => {
    if (phase !== 'inRoom' || !Number.isFinite(id)) return;
    let cancelled = false;
    const loadParts = async () => {
      try {
        const rows = await liveApi(`/live/sessions/${id}/participants`, token);
        if (!cancelled && Array.isArray(rows)) setParticipants(rows);
      } catch {
        if (!cancelled) setParticipants([]);
      }
    };
    loadParts();
    const t = window.setInterval(loadParts, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [phase, id, token]);

  useEffect(() => {
    if (phase !== 'inRoom') {
      setRemoteTileCount(0);
      setRemoteVideoCount(0);
      setRemotePeerCount(0);
      return;
    }
    const tick = () => {
      setRemoteTileCount(remoteElsRef.current.size);
      const c = clientRef.current;
      let vid = 0;
      let peers = 0;
      if (c?.kind === 'livekit') {
        const remotes = c.getRemoteParticipants?.() || [];
        peers = remotes.length;
        vid = remotes.filter((p) => {
          const pub = p.getTrackPublication?.(Track.Source.Camera);
          return pub?.track && !pub.isMuted;
        }).length;
      }
      setRemoteVideoCount((prev) => (prev !== vid ? vid : prev));
      setRemotePeerCount((prev) => (prev !== peers ? peers : prev));
    };
    tick();
    const idInt = window.setInterval(tick, 400);
    return () => window.clearInterval(idInt);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'inRoom' || !participantPanelOpen) return;
    const t = window.setInterval(() => setRtcPresenceTick((x) => x + 1), 1200);
    return () => window.clearInterval(t);
  }, [phase, participantPanelOpen]);

  useEffect(() => {
    if (!participantPanelOpen && !chatOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setParticipantPanelOpen(false);
        setChatOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [participantPanelOpen, chatOpen]);

  const pushFlash = useCallback((item) => {
    const fid = item.id;
    setFlashMessages((prev) => [...prev.filter((x) => x.id !== fid), item].slice(-5));
    if (flashTimersRef.current.has(fid)) {
      window.clearTimeout(flashTimersRef.current.get(fid));
    }
    const t = window.setTimeout(() => {
      setFlashMessages((prev) => prev.filter((x) => x.id !== fid));
      flashTimersRef.current.delete(fid);
    }, 4200);
    flashTimersRef.current.set(fid, t);
  }, []);

  const recordingFlashPrevRef = useRef(null);

  useEffect(() => {
    if (phase !== 'inRoom') {
      recordingFlashPrevRef.current = null;
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== 'inRoom') return;
    const cur = Boolean(roomState?.recordingActive);
    const prev = recordingFlashPrevRef.current;
    if (prev !== null && prev !== cur) {
      if (cur) {
        pushFlash({
          id: 'recording-on',
          kind: 'recording',
          title: 'Recording started',
          body: 'This session is being recorded.',
        });
      } else {
        pushFlash({
          id: 'recording-off',
          kind: 'recording',
          title: 'Recording stopped',
          body: '',
        });
      }
    }
    recordingFlashPrevRef.current = cur;
  }, [phase, roomState?.recordingActive, pushFlash]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

  useEffect(() => {
    if (!reactionMenuOpen) return;
    const close = (e) => {
      if (reactionMenuRef.current && !reactionMenuRef.current.contains(e.target)) setReactionMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [reactionMenuOpen]);

  useEffect(() => {
    if (!hangupMenuOpen) return;
    const close = (e) => {
      if (hangupMenuRef.current && !hangupMenuRef.current.contains(e.target)) setHangupMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [hangupMenuOpen]);

  useEffect(() => {
    if (phase !== 'inRoom' || !Number.isFinite(id)) return;
    let cancelled = false;
    const loadState = async () => {
      try {
        const s = await liveApi(`/live/sessions/${id}/state`, token);
        if (!cancelled) setRoomState(s);
      } catch {
        if (!cancelled) setRoomState(null);
      }
    };
    loadState();
    const t = window.setInterval(loadState, 2800);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [phase, id, token]);

  const displayNameForUid = useCallback(
    (uid) => {
      const id = Number(uid);
      const fromRoster = participants.find((p) => Number(p.id) === id);
      const label = fromRoster?.name || fromRoster?.email || `User ${id}`;
      return Number.isFinite(id) ? label : 'Guest';
    },
    [participants]
  );

  const repositionRemoteVideoTiles = useCallback(() => {
    const client = clientRef.current;
    const mount = galleryRemoteSlotRef.current;
    if (!client || phase !== 'inRoom') return;

    if (client.kind === 'livekit') {
      const remotes = client.getRemoteParticipants();
      const solo = remotes.length === 0;
      if (solo || !mount) {
        for (const [, el] of [...remoteElsRef.current.entries()]) {
          try {
            el.remove();
          } catch {
            /* ignore */
          }
        }
        remoteElsRef.current.clear();
        return;
      }
      const validKeys = new Set(remotes.map((p) => String(p.identity)));
      for (const p of remotes) {
        const uidKey = String(p.identity);
        const uid = client.identityToUid(p.identity);
        const label = displayNameForUid(uid ?? uidKey);
        const camPub = p.getTrackPublication(Track.Source.Camera);
        const micPub = p.getTrackPublication(Track.Source.Microphone);
        const camLive = Boolean(camPub?.track && !camPub.isMuted);
        const micLive = Boolean(micPub && !micPub.isMuted);
        let el = remoteElsRef.current.get(uidKey);
        if (!el) {
          el = document.createElement('div');
          el.className = 'liveMeetCell liveMeetCell--remote';
          el.dataset.uid = uidKey;
          const media = document.createElement('div');
          media.className = 'liveMeetCellMedia';
          const blackout = document.createElement('div');
          blackout.className = 'liveMeetCellBlackout';
          const bn = document.createElement('div');
          bn.className = 'liveMeetBlackoutName';
          const bh = document.createElement('div');
          bh.className = 'liveMeetBlackoutHint';
          bh.textContent = 'Camera Off';
          blackout.appendChild(bn);
          blackout.appendChild(bh);
          const namebar = document.createElement('div');
          namebar.className = 'liveMeetCellNamebar';
          const mic = document.createElement('div');
          mic.className = 'liveMeetCellMic';
          el.appendChild(media);
          el.appendChild(blackout);
          el.appendChild(namebar);
          el.appendChild(mic);
          remoteElsRef.current.set(uidKey, el);
        }
        const media = el.querySelector(':scope > .liveMeetCellMedia');
        const blackout = el.querySelector(':scope > .liveMeetCellBlackout');
        const bn = el.querySelector(':scope > .liveMeetBlackoutName');
        const namebar = el.querySelector(':scope > .liveMeetCellNamebar');
        const mic = el.querySelector(':scope > .liveMeetCellMic');
        if (bn) bn.textContent = label;
        if (namebar) namebar.textContent = label;
        if (mic) {
          mic.classList.toggle('liveMeetCellMic--muted', !micLive);
        }
        if (blackout) blackout.classList.toggle('liveMeetCellBlackout--visible', !camLive);
        if (namebar) namebar.classList.toggle('liveMeetCellNamebar--visible', camLive);
        if (media) {
          media.innerHTML = '';
          if (camLive && camPub?.track) {
            attachLiveKitVideo(camPub.track, media);
          }
        }
        if (el.parentNode !== mount) mount.appendChild(el);
        el.classList.toggle(
          'liveMeetCellSpeaking',
          activeSpeakerUid != null && uid != null && Number(uid) === Number(activeSpeakerUid)
        );
      }
      for (const [key, el] of [...remoteElsRef.current.entries()]) {
        if (!validKeys.has(key)) {
          try {
            el.remove();
          } catch {
            /* ignore */
          }
          remoteElsRef.current.delete(key);
        }
      }
      return;
    }
  }, [phase, activeSpeakerUid, displayNameForUid]);

  repositionRef.current = repositionRemoteVideoTiles;

  useEffect(() => {
    if (phase !== 'inRoom') return;
    bumpRemoteLayout(repositionRef);
  }, [phase, activeSpeakerUid, repositionRemoteVideoTiles, remotePeerCount, remoteVideoCount, participants]);

  useEffect(() => {
    if (phase !== 'inRoom') return;
    const el = localVideoRef.current;
    if (!el) return;
    const client = clientRef.current;
    if (!client || client.kind !== 'livekit') return undefined;
    if (!camOn) {
      el.innerHTML = '';
      return undefined;
    }
    const track = client.getLocalVideoTrack?.();
    if (!track) return undefined;
    try {
      livekitLocalDetachRef.current?.();
      livekitLocalDetachRef.current = attachLiveKitVideo(track, el);
      setDeviceHint('');
    } catch (e) {
      setDeviceHint(e?.message || 'Could not show camera preview.');
    }
    return () => {
      try {
        livekitLocalDetachRef.current?.();
      } catch {
        /* ignore */
      }
      livekitLocalDetachRef.current = null;
    };
  }, [phase, localTracksVersion, camOn, remotePeerCount]);

  /** Dev / ?liveDebug=1: periodic LiveKit snapshot. */
  useEffect(() => {
    if (phase !== 'inRoom' || !isLiveDebug()) return;
    const tick = () => {
      const c = clientRef.current;
      if (!c || c.kind !== 'livekit') return;
      const remotes = c.getRemoteParticipants?.() || [];
      liveDbg('rtc tick', {
        remoteCount: remotes.length,
        remotes: remotes.map((p) => ({
          identity: p.identity,
          camera: Boolean(p.getTrackPublication?.(Track.Source.Camera)?.track),
          mic: Boolean(p.getTrackPublication?.(Track.Source.Microphone)),
        })),
      });
    };
    tick();
    const id2 = window.setInterval(tick, 4000);
    return () => window.clearInterval(id2);
  }, [phase, id]);

  useEffect(() => {
    if (!Number.isFinite(id) || id < 1 || readyToEnter) return;
    let cancelled = false;
    void (async () => {
      try {
        const m = await liveApi(`/live/sessions/${id}/meta`, token);
        if (!cancelled) setPreJoinMeta(m);
      } catch (e) {
        if (!cancelled) {
          setPhase('error');
          setError(e.message || 'Could not load session');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, token, readyToEnter]);

  useEffect(() => {
    if (phase !== 'preJoin' || readyToEnter) return;
    let cancelled = false;
    void (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        preJoinStreamRef.current = s;
        const el = preJoinVideoRef.current;
        if (el) {
          el.srcObject = s;
          try {
            await el.play();
          } catch {
            /* ignore */
          }
        }
        if (!cancelled) setPreJoinPreviewKey((k) => k + 1);
      } catch (e) {
        if (!cancelled) {
          setDeviceHint(
            e?.message || 'Allow camera and microphone in the browser bar to preview devices before joining.'
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      setPreJoinPreviewKey(0);
      const s = preJoinStreamRef.current;
      if (s) {
        try {
          s.getTracks().forEach((t) => t.stop());
        } catch {
          /* ignore */
        }
        preJoinStreamRef.current = null;
      }
      const el = preJoinVideoRef.current;
      if (el) el.srcObject = null;
    };
  }, [phase, readyToEnter]);

  useEffect(() => {
    micCamForJoinRef.current = { mic: micOn, cam: camOn };
  }, [micOn, camOn]);

  useEffect(() => {
    if (phase !== 'preJoin' || !preJoinPreviewKey) return;
    const s = preJoinStreamRef.current;
    if (!s) return;
    for (const t of s.getAudioTracks()) t.enabled = micOn;
    for (const t of s.getVideoTracks()) t.enabled = camOn;
  }, [phase, preJoinPreviewKey, micOn, camOn]);

  useEffect(() => {
    if (phase !== 'inRoom' || !Number.isFinite(id)) return;
    const selfUid = Number(joinMeta?.uid ?? NaN);
    const poll = async () => {
      try {
        const d = await liveApi(`/live/sessions/${id}/messages?afterId=${lastChatPollIdRef.current}`, token);
        const rows = Array.isArray(d?.messages) ? d.messages : [];
        if (rows.length) {
          for (const m of rows) lastChatPollIdRef.current = Math.max(lastChatPollIdRef.current, m.id);
          setChatMessages((prev) => {
            const seen = new Set(prev.map((x) => x.id));
            const next = [...prev];
            for (const m of rows) {
              if (!seen.has(m.id)) {
                seen.add(m.id);
                next.push(m);
                if (Number.isFinite(selfUid) && Number(m.userId) !== selfUid) {
                  pushFlash({
                    id: `chat-${m.id}`,
                    kind: 'chat',
                    title: m.userName || m.userEmail || `User ${m.userId}`,
                    body: m.body,
                  });
                }
              }
            }
            return next.slice(-250);
          });
        }
      } catch {
        /* ignore */
      }
      try {
        const r = await liveApi(`/live/sessions/${id}/reactions?afterId=${lastReactPollIdRef.current}`, token);
        const reactRows = Array.isArray(r?.reactions) ? r.reactions : [];
        if (reactRows.length) {
          for (const x of reactRows) lastReactPollIdRef.current = Math.max(lastReactPollIdRef.current, x.id);
          setReactionFeed((prev) => {
            const seen = new Set(prev.map((x) => x.id));
            const next = [...prev];
            for (const x of reactRows) {
              if (!seen.has(x.id)) {
                seen.add(x.id);
                next.push(x);
                if (Number.isFinite(selfUid) && Number(x.userId) !== selfUid) {
                  pushFlash({
                    id: `react-${x.id}`,
                    kind: 'reaction',
                    title: x.userName || `User ${x.userId}`,
                    emoji: REACTION_EMOJI[x.kind] || '·',
                    body: x.kind,
                  });
                }
              }
            }
            return next.slice(-40);
          });
        }
      } catch {
        /* ignore */
      }
    };
    void poll();
    const t = window.setInterval(poll, 2600);
    return () => window.clearInterval(t);
  }, [phase, id, token, joinMeta?.uid, pushFlash]);

  const teardown = useCallback(async () => {
    if (renewTimerRef.current) {
      clearInterval(renewTimerRef.current);
      renewTimerRef.current = null;
    }
    const client = clientRef.current;
    clientRef.current = null;
    try {
      livekitLocalDetachRef.current?.();
    } catch {
      /* ignore */
    }
    livekitLocalDetachRef.current = null;
    detachAllLiveKitRemoteAudio();
    for (const t of localTracksRef.current) {
      try {
        t.stop?.();
        t.close?.();
      } catch {
        /* ignore */
      }
    }
    localTracksRef.current = [];
    remoteElsRef.current.forEach((el) => {
      try {
        el?.remove?.();
      } catch {
        /* ignore */
      }
    });
    remoteElsRef.current.clear();
    if (client?.kind === 'livekit') {
      void withTimeout(client.disconnect(), 3000);
    }
  }, []);

  const finishLeaveNavigate = useCallback(() => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/', { replace: true });
  }, [navigate]);

  const exitClassroom = useCallback(
    async (mode) => {
      if (leaveInProgressRef.current) return;
      leaveInProgressRef.current = true;
      setHangupMenuOpen(false);
      if (
        mode === 'end' &&
        !window.confirm(
          'End this session for everyone? All participants will be disconnected from the classroom.'
        )
      ) {
        leaveInProgressRef.current = false;
        return;
      }

      setPhase('leaving');
      suppressJoinRef.current = true;
      await exitPictureInPictureWithTimeout(1500);

      const apiPath = mode === 'end' ? `/live/sessions/${id}/end` : `/live/sessions/${id}/leave`;
      let endFailed = false;
      try {
        if (mode === 'end') {
          await withTimeout(
            liveApi(apiPath, token, { method: 'POST', body: '{}', timeoutMs: 10000 }),
            10000
          );
        } else {
          void withTimeout(
            liveApi(apiPath, token, { method: 'POST', body: '{}', timeoutMs: 10000 }),
            10000
          ).catch(() => {});
        }
      } catch (e) {
        if (mode === 'end') {
          endFailed = true;
          suppressJoinRef.current = false;
          setPhase('inRoom');
          setHint(e?.message || 'Could not end session. You might not have permission.');
          window.setTimeout(() => setHint(''), 5000);
          return;
        }
      } finally {
        if (!endFailed) {
          await withTimeout(teardown(), 3500);
          setParticipantPanelOpen(false);
          setChatOpen(false);
          setSessionRunId((x) => x + 1);
          finishLeaveNavigate();
        }
        leaveInProgressRef.current = false;
      }
    },
    [finishLeaveNavigate, id, teardown, token]
  );

  const leaveRoom = useCallback(() => exitClassroom('leave'), [exitClassroom]);

  const endSessionForAll = useCallback(() => exitClassroom('end'), [exitClassroom]);

  const rejoinLiveSession = useCallback(() => {
    suppressJoinRef.current = false;
    setChatMessages([]);
    setReactionFeed([]);
    lastChatPollIdRef.current = 0;
    lastReactPollIdRef.current = 0;
    setActiveSpeakerUid(null);
    setHint('');
    setPhase('loading');
    setSessionRunId((x) => x + 1);
  }, []);

  /** Safety net: never stay on "Leaving…" if PiP, fetch, or RTC teardown stalls. */
  useEffect(() => {
    if (phase !== 'leaving') return undefined;
    const t = window.setTimeout(() => {
      if (!leaveInProgressRef.current) return;
      setParticipantPanelOpen(false);
      setChatOpen(false);
      finishLeaveNavigate();
    }, 8000);
    return () => window.clearTimeout(t);
  }, [finishLeaveNavigate, phase]);

  /**
   * PiP: prefer remote participant video when presenting (Google Meet–style), else any stage video.
   * @param {{ preferRemoteVideo?: boolean; silent?: boolean; allowFallbackLocal?: boolean }} [opts]
   */
  const tryPictureInPicture = useCallback(
    async (opts = {}) => {
      const preferRemoteVideo = opts.preferRemoteVideo ?? screenSharing;
      const silent = opts.silent ?? false;
      const allowFallbackLocal = opts.allowFallbackLocal ?? !silent;
      const toast = (msg, ms = 5000) => {
        if (silent || !msg) return;
        setHint(msg);
        window.setTimeout(() => setHint(''), ms);
      };
      try {
        const root = document.getElementById('live-main-stage');
        if (!root) {
          toast('Picture-in-picture is not available in this layout.');
          setMenuOpen(false);
          return;
        }
        let v = preferRemoteVideo ? root.querySelector('.liveMeetCell--remote video') : null;
        if (!v && allowFallbackLocal) {
          v = root.querySelector('.liveMeetCell--remote video') || root.querySelector('video');
        }
        if (!v || typeof v.requestPictureInPicture !== 'function') {
          toast(
            preferRemoteVideo && !allowFallbackLocal
              ? ''
              : 'Picture-in-picture needs a playing video (join the call first) and a supported browser (e.g. Chrome).'
          );
          setMenuOpen(false);
          return;
        }
        if (!document.pictureInPictureEnabled) {
          toast('Picture-in-picture is disabled in this browser or tab.', 4000);
          setMenuOpen(false);
          return;
        }
        if (document.pictureInPictureElement === v) {
          setMenuOpen(false);
          return;
        }
        if (document.pictureInPictureElement && document.pictureInPictureElement !== v) {
          await document.exitPictureInPicture().catch(() => {});
        }
        await v.requestPictureInPicture();
        setMenuOpen(false);
      } catch (e) {
        if (!silent) {
          setHint(e?.message || 'Could not start picture-in-picture.');
          window.setTimeout(() => setHint(''), 4000);
        }
        setMenuOpen(false);
      }
    },
    [screenSharing]
  );

  function toggleMic() {
    const next = !micOn;
    if (phase === 'preJoin') {
      const s = preJoinStreamRef.current;
      const a = s?.getAudioTracks?.()?.[0];
      if (a) a.enabled = next;
    } else {
      const client = clientRef.current;
      if (client?.kind === 'livekit') void client.setMicEnabled(next);
    }
    setMicOn(next);
  }

  function toggleCam() {
    const next = !camOn;
    if (phase === 'preJoin') {
      const s = preJoinStreamRef.current;
      const v = s?.getVideoTracks?.()?.[0];
      if (v) v.enabled = next;
    } else {
      const client = clientRef.current;
      if (client?.kind === 'livekit') void client.setCamEnabled(next);
    }
    setCamOn(next);
  }

  function stopPreJoinPreview() {
    const s = preJoinStreamRef.current;
    if (s) {
      try {
        s.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
      preJoinStreamRef.current = null;
    }
    const el = preJoinVideoRef.current;
    if (el) el.srcObject = null;
  }

  function confirmEnterLiveRoom() {
    if (preJoinMeta?.status === 'ended' || preJoinMeta?.status === 'cancelled') {
      setError('This session has already ended.');
      setPhase('error');
      return;
    }
    setDeviceHint('');
    stopPreJoinPreview();
    setReadyToEnter(true);
  }

  async function sendChatMessage() {
    const body = chatDraft.trim();
    if (!body || chatSending || phase !== 'inRoom' || !Number.isFinite(id)) return;
    setChatSending(true);
    try {
      await liveApi(`/live/sessions/${id}/messages`, token, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      setChatDraft('');
    } catch (e) {
      setHint(e.message || 'Could not send message');
      window.setTimeout(() => setHint(''), 4000);
    } finally {
      setChatSending(false);
    }
  }

  async function sendReaction(kind) {
    if (phase !== 'inRoom' || !Number.isFinite(id)) return;
    try {
      await liveApi(`/live/sessions/${id}/reactions`, token, {
        method: 'POST',
        body: JSON.stringify({ kind }),
      });
    } catch (e) {
      setHint(e.message || 'Could not send reaction');
      window.setTimeout(() => setHint(''), 3000);
    }
  }

  useEffect(() => {
    if (!readyToEnter) return undefined;
    if (suppressJoinRef.current) return undefined;
    if (!Number.isFinite(id) || id < 1) {
      setPhase('error');
      setError('Invalid session');
      return undefined;
    }

    let cancelled = false;

    async function run() {
      setPhase('loading');
      setError('');
      setDeviceHint('');
      try {
        const data = await liveApi(`/live/sessions/${id}/join`, token, {
          method: 'POST',
          body: '{}',
        });
        if (cancelled) return;

        rtcProviderRef.current = 'livekit';

        setJoinMeta({
          title: data.title,
          channelName: data.channelName,
          role: data.role,
          rtcProvider: 'livekit',
          livekitReady: data.livekitReady,
          sessionType: data.sessionType === 'one_to_one' ? 'one_to_one' : 'group',
          uid: Number(data.uid),
          canEndSession: Boolean(data.canEndSession),
        });

        if (data.canEndSession && data.recordingConfigured === false) {
          setHint(
            'Cloud recording is off: set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and DigitalOcean Spaces (SPACES_ENDPOINT, SPACES_BUCKET, SPACES_KEY, SPACES_SECRET) on the API server.'
          );
          window.setTimeout(() => setHint(''), 14000);
        }

        if (!data.livekitReady || !data.livekitToken || !data.livekitUrl) {
          setPhase('error');
          setError(data.warning || 'LiveKit is not configured on the server (missing token or env).');
          return;
        }

        const joinUid = Number(data.uid);
        if (!Number.isFinite(joinUid)) {
          throw new Error('Invalid LiveKit uid from server');
        }
        localJoinUidRef.current = joinUid;

        const client = await connectLiveKitRoom({
          url: data.livekitUrl,
          token: data.livekitToken,
          roomName: data.roomName || data.channelName,
          onConnectionState: (state) => {
            liveDbg('livekit connection-state', state);
            setRtcState(String(state));
          },
          onRemotePresence: () => {
            bumpRemoteLayout(repositionRef);
            setRtcPresenceTick((x) => x + 1);
          },
          onActiveSpeaker: (uid) => setActiveSpeakerUid(uid),
          onLocalTracks: (tracks) => {
            localTracksRef.current = tracks;
            setLocalTracksVersion((v) => v + 1);
          },
        });
        clientRef.current = client;

        try {
          const { mic, cam } = micCamForJoinRef.current;
          await client.setMicEnabled(mic);
          await client.setCamEnabled(cam);
        } catch {
          /* ignore */
        }

        setPhase('inRoom');

        renewTimerRef.current = window.setInterval(async () => {
          try {
            const td = await liveApi(`/live/sessions/${id}/token`, token, { method: 'POST', body: '{}' });
            const cl = clientRef.current;
            const next = td?.livekitToken || td?.token;
            if (!next || !cl || cl.kind !== 'livekit' || typeof cl.renewToken !== 'function') return;
            await cl.renewToken(next);
          } catch {
            /* ignore */
          }
        }, 10 * 60 * 1000);
      } catch (e) {
        if (!cancelled) {
          setPhase('error');
          setError(e.message || 'Could not join');
        }
      }
    }

    run();

    return () => {
      cancelled = true;
      if (suppressJoinRef.current) return;
      void (async () => {
        try {
          await liveApi(`/live/sessions/${id}/leave`, token, { method: 'POST', body: '{}' });
        } catch {
          /* ignore */
        }
        await Promise.race([
          teardown(),
          new Promise((resolve) => {
            setTimeout(resolve, 3000);
          }),
        ]);
      })();
    };
  }, [id, teardown, token, readyToEnter, sessionRunId]);

  const isPublisher = joinMeta?.role === 'publisher';
  const canEndSession = joinMeta?.canEndSession === true;
  const showStage = phase === 'inRoom' || phase === 'leaving';
  const showPreJoin = phase === 'preJoin';
  const showLeftEnd = phase === 'left';
  const pipSupported =
    typeof document !== 'undefined' &&
    typeof HTMLVideoElement !== 'undefined' &&
    typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function';

  const rtcHuman = (() => {
    const s = String(rtcState || '').toLowerCase();
    if (!s) return '';
    if (s.includes('connected')) return 'Connected';
    if (s.includes('reconnect')) return 'Reconnecting…';
    if (s.includes('connecting')) return 'Connecting…';
    if (s.includes('disconnected') || s.includes('failed') || s.includes('abort')) return 'Offline';
    return rtcState;
  })();

  void rtcPresenceTick;
  const handsRaw = roomState?.handRaisedUserIds;
  const handsSet = new Set((Array.isArray(handsRaw) ? handsRaw : []).map((id) => Number(id)));
  const clientLive = clientRef.current;
  const remoteByUid = new Map();
  if (phase === 'inRoom' && clientLive) {
    if (clientLive.kind === 'livekit') {
      for (const rp of clientLive.getRemoteParticipants?.() || []) {
        const uid = clientLive.identityToUid(rp.identity);
        if (uid != null) remoteByUid.set(uid, rp);
      }
    }
  }
  const participantPanelRows = participants.map((p) => {
    const ru = remoteByUid.get(Number(p.id));
    let hasVideo = false;
    let hasAudio = false;
    if (ru) {
      const camPub = ru.getTrackPublication?.(Track.Source.Camera);
      const micPub = ru.getTrackPublication?.(Track.Source.Microphone);
      hasVideo = Boolean(camPub?.track && !camPub.isMuted);
      hasAudio = Boolean(micPub && !micPub.isMuted);
    }
    return {
      id: p.id,
      name: p.name,
      email: p.email,
      role: p.role,
      handRaised: handsSet.has(Number(p.id)),
      hasVideo,
      hasAudio,
    };
  });

  const inCallUi = showStage && (phase === 'inRoom' || phase === 'leaving');
  const soloInMeeting = phase === 'inRoom' && remotePeerCount === 0;
  const videoStageTier = soloInMeeting ? 'solo' : 'meet';

  const selfVideoLabel = useMemo(() => {
    const uid = joinMeta?.uid;
    if (uid == null || !Number.isFinite(Number(uid))) return 'You';
    return displayNameForUid(uid);
  }, [joinMeta?.uid, displayNameForUid]);

  const micCamControlButtons = (
    <>
      <button
        type="button"
        className={`liveIconBtn ${!micOn ? 'liveIconBtn--off' : ''}`}
        onClick={toggleMic}
        aria-pressed={micOn}
        aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
      >
        {micOn ? (
          <LiveSvg>
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </LiveSvg>
        ) : (
          <LiveSvg>
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
            <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 1-.2 1.94-.6 2.8" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </LiveSvg>
        )}
      </button>
      <button
        type="button"
        className={`liveIconBtn ${!camOn ? 'liveIconBtn--off' : ''}`}
        onClick={toggleCam}
        aria-pressed={camOn}
        aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
        disabled={screenSharing}
        title={screenSharing ? 'Stop screen sharing to use the camera toggle' : undefined}
      >
        {camOn ? (
          <LiveSvg>
            <path d="M23 7l-7 5 7 5V7z" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </LiveSvg>
        ) : (
          <LiveSvg>
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M21 21H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />
            <path d="M8 5h3a2 2 0 0 1 2 2v5" />
            <path d="M16 16l5-3v6" />
          </LiveSvg>
        )}
      </button>
    </>
  );

  return (
    <div className={`liveClassroomRoot${inCallUi ? ' liveClassroomRoot--inCall' : ''}`}>
      <a href="#live-main-stage" className="liveSkipLink">
        Skip to video
      </a>
      {!inCallUi ? (
        <header className="liveClassroomBar" role="banner">
          <div className="liveClassroomTitle">
            <strong id="live-room-title">{joinMeta?.title || preJoinMeta?.title || 'Live class'}</strong>
            <div className="liveClassroomTitleRow" aria-live="polite">
              {phase === 'preJoin' ? (
                <span className="liveStatusChip liveStatusChipConnecting">Green room</span>
              ) : null}
              {phase === 'loading' ? (
                <span className="liveStatusChip liveStatusChipConnecting">Connecting…</span>
              ) : null}
              {phase === 'leaving' ? (
                <span className="liveStatusChip liveStatusChipConnecting">Leaving…</span>
              ) : null}
              {phase === 'left' ? (
                <span className="liveStatusChip liveStatusChipConnecting">You left</span>
              ) : null}
              {phase === 'error' ? <span className="liveStatusChip liveStatusChipError">Error</span> : null}
              {rtcHuman ? (
                <span className="liveClassroomRtc" title={rtcState}>
                  {rtcHuman}
                </span>
              ) : null}
            </div>
            {joinMeta?.channelName && showTechDetails ? (
              <span className="liveClassroomChannel">{joinMeta.channelName}</span>
            ) : null}
          </div>
          <div className="liveClassroomBarActions">
            {phase !== 'left' ? (
              <div className="liveOverflowWrap" ref={menuRef}>
                <button
                  type="button"
                  className="liveBarBtn liveBarBtnGhost"
                  aria-expanded={menuOpen}
                  aria-haspopup="true"
                  aria-label="More options"
                  onClick={() => setMenuOpen((o) => !o)}
                >
                  More
                </button>
                {menuOpen ? (
                  <div className="liveOverflowMenu" role="menu">
                    <button
                      type="button"
                      className="liveOverflowItem"
                      role="menuitem"
                      onClick={() => {
                        setShowTechDetails((v) => !v);
                        setMenuOpen(false);
                      }}
                    >
                      {showTechDetails ? 'Hide' : 'Show'} channel name
                    </button>
                    {participants.length ? (
                      <div className="liveOverflowStatic" role="presentation">
                        <strong>Roster</strong>
                        <ul className="liveOverflowRoster">
                          {participants.map((p) => (
                            <li key={p.id}>{p.name || p.email || `User ${p.id}`}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              className={`liveBarBtn${phase === 'left' ? '' : ' liveBarBtnLeave'}`}
              onClick={() => {
                if (phase === 'preJoin') {
                  stopPreJoinPreview();
                  navigate(-1);
                } else if (phase === 'left') {
                  finishLeaveNavigate();
                } else {
                  void leaveRoom();
                }
              }}
              disabled={phase === 'leaving'}
              aria-label={
                phase === 'preJoin'
                  ? 'Go back without joining'
                  : phase === 'leaving'
                    ? 'Leaving session'
                    : phase === 'left'
                      ? 'Close and go back'
                      : 'Leave live session'
              }
            >
              {phase === 'preJoin' ? 'Back' : phase === 'leaving' ? 'Leaving…' : phase === 'left' ? 'Done' : 'Leave'}
            </button>
          </div>
        </header>
      ) : null}

      {showPreJoin ? (
        <div className="livePreJoin" role="region" aria-label="Camera and microphone preview before joining">
          <div className="livePreJoinVideoWrap">
            <video ref={preJoinVideoRef} className="livePreJoinVideo" autoPlay playsInline muted />
          </div>
          {deviceHint ? (
            <p className="liveDeviceError" role="alert">
              {deviceHint}
            </p>
          ) : null}
          <div className="livePreJoinMediaToolbar" role="group" aria-label="Microphone and camera">
            {micCamControlButtons}
          </div>
          <div className="livePreJoinActions">
            <button type="button" className="liveBarBtn liveBarBtnPrimary" onClick={() => confirmEnterLiveRoom()}>
              Enter live room
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'loading' ? (
        <div className="liveClassroomCenter" role="status" aria-live="polite" aria-busy="true">
          <p className="liveLoadingTitle">Connecting to classroom…</p>
          <p className="liveClassroomSub">Allow camera and microphone when the browser asks.</p>
          <div className="liveLoadingSkeleton" aria-hidden="true">
            <div className="liveLoadingSkeletonBar liveLoadingSkeletonBarLg" />
            <div className="liveLoadingSkeletonBar" />
            <div className="liveLoadingSkeletonBar liveLoadingSkeletonBarSm" />
          </div>
        </div>
      ) : null}

      {phase === 'error' ? (
        <div className="liveClassroomCenter liveClassroomError" role="alert">
          <p>{error || 'Could not join.'}</p>
          <button type="button" className="liveBarBtn" onClick={() => navigate(-1)} aria-label="Go back to previous page">
            Go back
          </button>
        </div>
      ) : null}

      {showLeftEnd ? (
        <div className="liveEndScreen" role="region" aria-labelledby="live-end-title">
          <h2 className="liveEndTitle" id="live-end-title">
            You left the live class
          </h2>
          <p className="liveEndSub">
            If the session is still running, use <strong>Rejoin now</strong>. Use <strong>Done</strong> in the bar when
            you are finished.
          </p>
          <div className="liveEndActions">
            <button type="button" className="liveBarBtn liveBarBtnPrimary" onClick={() => rejoinLiveSession()}>
              Rejoin now
            </button>
          </div>
        </div>
      ) : null}

      {showStage ? (
        <div className="liveCallChrome">
          <header className="liveCallBar liveCallBar--top" role="banner">
            <div className="liveCallBarCluster liveCallBarCluster--left">
              <span className="liveCallBarTitle" id="live-room-title">
                {joinMeta?.title || 'Live class'}
              </span>
              {phase === 'leaving' ? (
                <span className="liveStatusChip liveStatusChipConnecting">Leaving…</span>
              ) : (
                <span className="liveStatusChip liveStatusChipLive">Live</span>
              )}
              {phase === 'inRoom' ? (
                roomState?.recordingConfigured === false ? (
                  <span
                    className="liveStatusChip liveStatusChipMuted"
                    title="Server is missing LiveKit egress or Spaces env. Trainers see a banner after join."
                  >
                    Recording unavailable
                  </span>
                ) : roomState?.recordingActive ? (
                  <span className="liveStatusChip liveStatusChipRecording">Recording</span>
                ) : (
                  <span
                    className="liveStatusChip liveStatusChipMuted"
                    title={
                      joinMeta?.canEndSession && roomState?.recordingFailureHint
                        ? roomState.recordingFailureHint
                        : 'Starts automatically when cloud recording is configured and the session is being recorded.'
                    }
                  >
                    Not recording
                  </span>
                )
              ) : null}
              {rtcHuman ? (
                <span className="liveCallRtcPill" title={rtcState}>
                  {rtcHuman}
                </span>
              ) : null}
            </div>
          </header>

          <main id="live-main-stage" className="liveCallStage" role="main" aria-labelledby="live-room-title">
            <span className="liveVisuallyHidden" id="live-remote-label">
              Participant video
            </span>
            <div
              ref={remoteLayoutRootRef}
              className={`liveVideoStage liveVideoStage--${videoStageTier}`}
              role="region"
              aria-labelledby="live-remote-label"
              aria-label="Live video"
            >
              <div className={`liveMeetGrid${soloInMeeting ? ' liveMeetGrid--solo' : ''}`}>
                <div className={`liveMeetCell liveMeetCell--local${soloInMeeting ? ' liveMeetCell--soloFill' : ''}`}>
                  <div className="liveLocalVideoShell">
                    <div ref={localVideoRef} className="liveLocalVideo liveLocalVideo--stage" role="region" aria-label="Your camera preview" />
                    {camOn ? (
                      <div className="liveMeetCellNamebar liveMeetCellNamebar--visible">{selfVideoLabel}</div>
                    ) : (
                      <div className="liveMeetCellBlackout liveMeetCellBlackout--visible liveMeetCellBlackout--local">
                        <div className="liveMeetBlackoutName">{selfVideoLabel}</div>
                        <div className="liveMeetBlackoutHint">Camera Off</div>
                      </div>
                    )}
                    <div
                      className={`liveMeetCellMic liveMeetCellMic--local${micOn ? '' : ' liveMeetCellMic--muted'}`}
                      aria-label={micOn ? 'Microphone on' : 'Microphone muted'}
                    >
                      {micOn ? (
                        <LiveSvg>
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        </LiveSvg>
                      ) : (
                        <LiveSvg>
                          <line x1="1" y1="1" x2="23" y2="23" />
                          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                          <path d="M17 16.95A7 7 0 0 1 5 12v-2" />
                        </LiveSvg>
                      )}
                    </div>
                  </div>
                </div>
                {!soloInMeeting ? <div ref={galleryRemoteSlotRef} className="liveMeetGridRemotes" /> : null}
              </div>
              {phase === 'inRoom' && remotePeerCount >= 1 && remoteVideoCount === 0 && participants.length > 1 ? (
                <div className="liveRemoteEmpty liveRemoteEmptyOverlay" aria-live="polite">
                  <p className="liveRemoteEmptyTitle">Waiting for video</p>
                  <p className="liveRemoteEmptySub">Others are in the call but have not turned their camera on yet.</p>
                </div>
              ) : null}
            </div>

            {phase === 'inRoom' && flashMessages.length > 0 ? (
              <div className="liveFlashStack" aria-live="polite">
                {flashMessages.map((f) => (
                  <div
                    key={f.id}
                    className={[
                      'liveFlashCard',
                      f.kind === 'reaction' ? 'liveFlashCard--reaction' : '',
                      f.kind === 'recording' ? 'liveFlashCard--recording' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {f.kind === 'reaction' ? (
                      <span className="liveFlashEmoji" aria-hidden>
                        {f.emoji}
                      </span>
                    ) : null}
                    {f.kind === 'recording' ? <span className="liveFlashRecDot" aria-hidden /> : null}
                    <div className="liveFlashText">
                      <div className="liveFlashTitle">{f.title}</div>
                      {f.kind === 'chat' && f.body ? <div className="liveFlashBody">{f.body}</div> : null}
                      {f.kind === 'recording' && f.body ? <div className="liveFlashBody">{f.body}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {(deviceHint || hint) && phase === 'inRoom' ? (
              <div className="liveCallToast" role="status">
                {deviceHint ? <p className="liveCallToastLine liveCallToastLine--error">{deviceHint}</p> : null}
                {hint ? <p className="liveCallToastLine">{hint}</p> : null}
              </div>
            ) : null}

            {!isPublisher && phase === 'inRoom' ? (
              <p className="liveCallSubscriberNote">You are connected as receive-only.</p>
            ) : null}

            {chatOpen && phase === 'inRoom' ? (
            <>
              <button
                type="button"
                className="liveParticipantPanelBackdrop"
                aria-label="Close chat panel"
                onClick={() => setChatOpen(false)}
              />
              <aside className="liveChatPanel" id="live-chat-panel" aria-label="In-call chat">
                <div className="liveParticipantPanelHeader">
                  <h2 className="liveParticipantPanelTitle">Chat</h2>
                  <button type="button" className="liveParticipantPanelClose" onClick={() => setChatOpen(false)}>
                    Close
                  </button>
                </div>
                <div className="liveChatMessages" role="log" aria-relevant="additions">
                  {chatMessages.length === 0 ? (
                    <p className="liveParticipantPanelEmpty">No messages yet.</p>
                  ) : (
                    chatMessages.map((m) => (
                      <div key={m.id} className="liveChatRow">
                        <div className="liveChatMeta">
                          <strong>{m.userName || m.userEmail || `User ${m.userId}`}</strong>
                          <span className="liveChatTime">{m.createdAt}</span>
                        </div>
                        <div className="liveChatBody">{m.body}</div>
                      </div>
                    ))
                  )}
                </div>
                <form
                  className="liveChatComposer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendChatMessage();
                  }}
                >
                  <input
                    type="text"
                    className="liveChatInput"
                    value={chatDraft}
                    onChange={(e) => setChatDraft(e.target.value)}
                    placeholder="Message everyone…"
                    maxLength={2000}
                    aria-label="Chat message"
                  />
                  <button type="submit" className="liveBarBtn liveBarBtnPrimary" disabled={chatSending || !chatDraft.trim()}>
                    Send
                  </button>
                </form>
              </aside>
            </>
          ) : null}

          {participantPanelOpen && phase === 'inRoom' ? (
            <>
              <button
                type="button"
                className="liveParticipantPanelBackdrop"
                aria-label="Close participants panel"
                onClick={() => setParticipantPanelOpen(false)}
              />
              <aside className="liveParticipantPanel" id="live-participant-panel" aria-label="Participants">
                <div className="liveParticipantPanelHeader">
                  <h2 className="liveParticipantPanelTitle">People</h2>
                  <button
                    type="button"
                    className="liveParticipantPanelClose"
                    onClick={() => setParticipantPanelOpen(false)}
                    aria-label="Close participants list"
                  >
                    Close
                  </button>
                </div>
                {participantPanelRows.length === 0 ? (
                  <p className="liveParticipantPanelEmpty">No roster loaded yet.</p>
                ) : (
                  <ul className="liveParticipantPanelList">
                    {participantPanelRows.map((row) => (
                      <li key={row.id} className="liveParticipantPanelRow">
                        <div className="liveParticipantPanelName">
                          {row.handRaised ? <span className="liveHandRaisedBadge" title="Hand raised">✋ </span> : null}
                          <span>{row.name || row.email || `User ${row.id}`}</span>
                        </div>
                        <div className="liveParticipantPanelMeta">
                          {row.role ? <span className="liveParticipantRole">{row.role}</span> : null}
                          <span className={row.hasVideo ? 'livePresenceOn' : 'livePresenceOff'} title="Camera">
                            Cam {row.hasVideo ? 'on' : 'off'}
                          </span>
                          <span className={row.hasAudio ? 'livePresenceOn' : 'livePresenceOff'} title="Microphone">
                            Mic {row.hasAudio ? 'on' : 'off'}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </aside>
            </>
          ) : null}
        </main>

        <footer className="liveCallBar liveCallBar--bottom" role="toolbar" aria-label="Call controls">
          <div className="liveCallBarBottomToolbar">
            <div className="liveCallBarCluster liveCallBarCluster--media">
              {isPublisher && phase === 'inRoom' ? (
                <>
                  {micCamControlButtons}
                </>
              ) : null}
            </div>
            {phase === 'inRoom' ? (
              <div className="liveCallBarCluster liveCallBarCluster--sessionTools" role="group" aria-label="Session tools">
                <button
                  type="button"
                  className={`liveIconBtn${roomState?.recordingActive ? ' liveIconBtn--recordOn' : ''}`}
                  disabled
                  aria-label={
                    roomState?.recordingConfigured === false
                      ? 'Recording unavailable (server not configured)'
                      : roomState?.recordingActive
                        ? 'Recording in progress'
                        : 'Not recording'
                  }
                  title={
                    roomState?.recordingConfigured === false
                      ? 'Configure LIVEKIT_* and SPACES_* on the API server.'
                      : joinMeta?.canEndSession && roomState?.recordingFailureHint
                        ? roomState.recordingFailureHint
                        : roomState?.recordingActive
                          ? 'Recording in progress'
                          : 'Not recording'
                  }
                >
                  <LiveSvg>
                    <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />
                  </LiveSvg>
                </button>
                <button
                  type="button"
                  className="liveIconBtn"
                  onClick={() => setParticipantPanelOpen((o) => !o)}
                  aria-expanded={participantPanelOpen}
                  aria-controls="live-participant-panel"
                  aria-label="People"
                  disabled={phase === 'leaving'}
                >
                  <LiveSvg>
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </LiveSvg>
                </button>
                <button
                  type="button"
                  className="liveIconBtn"
                  onClick={() => setChatOpen((o) => !o)}
                  aria-expanded={chatOpen}
                  aria-controls="live-chat-panel"
                  aria-label="Chat"
                  disabled={phase === 'leaving'}
                >
                  <LiveSvg>
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </LiveSvg>
                </button>
                <div className="liveReactionMenuWrap" ref={reactionMenuRef}>
                  <button
                    type="button"
                    className="liveIconBtn"
                    onClick={() => {
                      setReactionMenuOpen((o) => {
                        const next = !o;
                        if (next) {
                          setMenuOpen(false);
                          setHangupMenuOpen(false);
                        }
                        return next;
                      });
                    }}
                    aria-label="Open reactions"
                    aria-haspopup="true"
                    aria-expanded={reactionMenuOpen}
                    disabled={phase === 'leaving'}
                  >
                    <LiveSvg>
                      <circle cx="12" cy="12" r="10" />
                      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                      <circle cx="9" cy="9" r="1.5" fill="currentColor" stroke="none" />
                      <circle cx="15" cy="9" r="1.5" fill="currentColor" stroke="none" />
                    </LiveSvg>
                  </button>
                  {reactionMenuOpen ? (
                    <div className="liveReactionMenu" role="menu" aria-label="Reaction menu">
                      {Object.entries(REACTION_EMOJI).map(([kind, sym]) => (
                        <button
                          key={kind}
                          type="button"
                          className="liveIconBtn liveIconBtn--reactionPicker"
                          onClick={() => {
                            void sendReaction(kind);
                            setReactionMenuOpen(false);
                          }}
                          aria-label={`Send ${kind} reaction`}
                          role="menuitem"
                          disabled={phase === 'leaving'}
                        >
                          <span className="liveReactionEmoji" aria-hidden>
                            {sym}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="liveHangupMenuWrap" ref={hangupMenuRef}>
                  <button
                    type="button"
                    className="liveIconBtn liveIconBtn--leave"
                    aria-label="Leave or end session"
                    aria-haspopup="true"
                    aria-expanded={hangupMenuOpen}
                    disabled={phase === 'leaving'}
                    onClick={() => {
                      setHangupMenuOpen((o) => {
                        const next = !o;
                        if (next) {
                          setMenuOpen(false);
                          setReactionMenuOpen(false);
                        }
                        return next;
                      });
                    }}
                  >
                    <LiveSvg>
                      <g transform="rotate(135 12 12)">
                        <path
                          d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
                          fill="currentColor"
                          stroke="none"
                        />
                      </g>
                    </LiveSvg>
                  </button>
                  {hangupMenuOpen ? (
                    <div className="liveHangupMenu" role="menu" aria-label="End call options">
                      <button
                        type="button"
                        className="liveHangupMenuItem"
                        role="menuitem"
                        onClick={() => void leaveRoom()}
                      >
                        Leave session
                      </button>
                      {canEndSession ? (
                        <button
                          type="button"
                          className="liveHangupMenuItem liveHangupMenuItem--danger"
                          role="menuitem"
                          onClick={() => void endSessionForAll()}
                        >
                          End session
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="liveOverflowWrap liveOverflowWrap--dark liveOverflowWrap--dropUp" ref={menuRef}>
                  <button
                    type="button"
                    className="liveIconBtn"
                    aria-expanded={menuOpen}
                    aria-haspopup="true"
                    aria-label="More options"
                    disabled={phase === 'leaving'}
                    onClick={() => {
                      setMenuOpen((o) => {
                        const next = !o;
                        if (next) {
                          setReactionMenuOpen(false);
                          setHangupMenuOpen(false);
                        }
                        return next;
                      });
                    }}
                  >
                    <LiveSvg>
                      <circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" />
                      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
                      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
                    </LiveSvg>
                  </button>
                  {menuOpen ? (
                    <div className="liveOverflowMenu" role="menu">
                      {pipSupported ? (
                        <button
                          type="button"
                          className="liveOverflowItem"
                          role="menuitem"
                          onClick={() => void tryPictureInPicture()}
                        >
                          Picture-in-picture
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="liveOverflowItem"
                        role="menuitem"
                        onClick={() => {
                          setShowTechDetails((v) => !v);
                          setMenuOpen(false);
                        }}
                      >
                        {showTechDetails ? 'Hide' : 'Show'} channel name
                      </button>
                      {joinMeta?.channelName && showTechDetails ? (
                        <div className="liveOverflowStatic" role="presentation">
                          <span className="liveClassroomChannel">{joinMeta.channelName}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </footer>
        </div>
      ) : null}
    </div>
  );
}
