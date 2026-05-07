import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

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

function formatAgoraErr(e) {
  if (e == null) return String(e);
  if (typeof e === 'string') return e;
  const code = e.code != null ? `code=${e.code}` : '';
  const msg = e.message != null ? e.message : String(e);
  return [code, msg].filter(Boolean).join(' ');
}

async function liveApi(path, token, options = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/** Request layout pass after DOM / Agora state updates (replaces legacy schedulePlayRemoteVideo). */
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
  /** Others connected to the Agora channel (drives solo vs gallery layout). */
  const [remotePeerCount, setRemotePeerCount] = useState(0);
  const [activeSpeakerUid, setActiveSpeakerUid] = useState(null);
  const [participantPanelOpen, setParticipantPanelOpen] = useState(false);
  const [roomState, setRoomState] = useState(null);
  /** Re-render participant panel when Agora remotes change (panel reads clientRef). */
  const [rtcPresenceTick, setRtcPresenceTick] = useState(0);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [reactionFeed, setReactionFeed] = useState([]);
  const [flashMessages, setFlashMessages] = useState([]);
  /** Bumps when pre-join getUserMedia stream is attached so track enabled state can sync to micOn/camOn. */
  const [preJoinPreviewKey, setPreJoinPreviewKey] = useState(0);
  const [screenSharing, setScreenSharing] = useState(false);
  /** Next screen share includes tab/system audio when supported (default off). */
  const [screenSharePrefIncludeAudio, setScreenSharePrefIncludeAudio] = useState(false);
  /** Mic uplink unpublished so screen-capture audio can publish (remotes hear screen/system audio only). */
  const [screenSharePublishedAudio, setScreenSharePublishedAudio] = useState(false);
  const [screenShareBusy, setScreenShareBusy] = useState(false);
  const menuRef = useRef(null);
  const reactionMenuRef = useRef(null);
  const hangupMenuRef = useRef(null);
  const preJoinVideoRef = useRef(null);
  const preJoinStreamRef = useRef(null);
  const lastChatPollIdRef = useRef(0);
  const lastReactPollIdRef = useRef(0);
  const flashTimersRef = useRef(new Map());

  const clientRef = useRef(null);
  /** Cached Agora Web module (set on join) for screen-share without re-importing. */
  const agoraRtcRef = useRef(null);
  /** Active screen-share tracks (camera stays in `localTracksRef` but is unpublished while sharing). */
  const screenShareVideoTrackRef = useRef(null);
  const screenShareAudioTrackRef = useRef(null);
  /** Optional Document PiP window when sharing alone (Chrome 116+). */
  const docPipWindowRef = useRef(null);
  /** True if mic was unpublished so screen-capture audio could be published. */
  const micWasUnpublishedForScreenShareRef = useRef(false);
  /** Latest mic/cam intent; read when publishing Agora tracks so join effect deps stay stable. */
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
      const vid = c ? c.remoteUsers.filter((u) => u.videoTrack).length : 0;
      const peers = c ? c.remoteUsers.length : 0;
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

    const solo = client.remoteUsers.length === 0;
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

    const users = client.remoteUsers.slice().sort((a, b) => Number(a.uid) - Number(b.uid));
    const validKeys = new Set(users.map((u) => String(u.uid)));

    for (const u of users) {
      const uidKey = String(u.uid);
      const label = displayNameForUid(u.uid);
      const camLive = Boolean(u.videoTrack && u.hasVideo);
      const micLive = Boolean(u.hasAudio);

      let el = remoteElsRef.current.get(uidKey);
      if (!el) {
        el = document.createElement('div');
        el.className = 'liveMeetCell liveMeetCell--remote';
        el.dataset.uid = uidKey;
        el.title = label;
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
        mic.setAttribute('aria-hidden', 'true');
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
        mic.innerHTML = micLive
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>'
          : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2"/></svg>';
      }

      if (blackout) blackout.classList.toggle('liveMeetCellBlackout--visible', !camLive);
      if (namebar) namebar.classList.toggle('liveMeetCellNamebar--visible', camLive);
      if (media) {
        if (camLive && u.videoTrack) {
          try {
            u.videoTrack.play(media, { fit: 'cover' });
          } catch (e) {
            console.warn('Live classroom: remote play failed', e);
          }
        } else {
          try {
            u.videoTrack?.stop();
          } catch {
            /* ignore */
          }
        }
      }

      if (el.parentNode !== mount) mount.appendChild(el);
      el.classList.toggle('liveMeetCellSpeaking', activeSpeakerUid != null && Number(u.uid) === Number(activeSpeakerUid));
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
    const screenV = screenShareVideoTrackRef.current;
    if (screenSharing && screenV) {
      try {
        screenV.play(el, { mirror: false, fit: 'contain' });
        setDeviceHint('');
      } catch (e) {
        setDeviceHint(e?.message || 'Could not show screen preview.');
      }
      return () => {
        try {
          screenV.stop?.();
        } catch {
          /* ignore */
        }
      };
    }
    const tracks = localTracksRef.current;
    if (!tracks?.length) return;
    const camTrack = tracks[1];
    if (!camTrack) return;
    try {
      camTrack.play(el, { mirror: true, fit: 'cover' });
      setDeviceHint('');
    } catch (e) {
      setDeviceHint(e?.message || 'Could not show camera preview.');
    }
  }, [phase, localTracksVersion, camOn, remotePeerCount, screenSharing]);

  /** Dev / ?liveDebug=1: periodic Agora snapshot (confirms whether any remote *hosts* exist vs REST participant list). */
  useEffect(() => {
    if (phase !== 'inRoom' || !isLiveDebug()) return;
    const tick = () => {
      const c = clientRef.current;
      if (!c) return;
      let stats = null;
      try {
        stats = typeof c.getRTCStats === 'function' ? c.getRTCStats() : null;
      } catch {
        /* ignore */
      }
      liveDbg('rtc tick', {
        remoteUsers: c.remoteUsers.length,
        remotes: c.remoteUsers.map((u) => ({
          uid: u.uid,
          hasVideo: u.hasVideo,
          hasAudio: u.hasAudio,
        })),
        statsUserCount: stats?.UserCount,
        recvBitrate: stats?.RecvBitrate,
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

  /** After React mounts the remote grid, subscribe/play any users already in the channel (join-after-publish / missed events). */
  useLayoutEffect(() => {
    if (phase !== 'inRoom') return;
    const client = clientRef.current;
    if (!client) return;

    void (async () => {
      liveDbg('layout sync remoteUsers', {
        count: client.remoteUsers.length,
        remotes: client.remoteUsers.map((u) => ({
          uid: u.uid,
          hasVideo: u.hasVideo,
          hasAudio: u.hasAudio,
        })),
      });
      for (const u of client.remoteUsers) {
        if (u.hasVideo) {
          if (!u.videoTrack) {
            try {
              liveDbg('layout sync: subscribe video', { uid: u.uid });
              await client.subscribe(u, 'video');
            } catch (e) {
              liveDbgWarn('layout sync subscribe video failed', { uid: u.uid }, formatAgoraErr(e));
            }
          } else {
            liveDbg('layout sync: existing videoTrack', { uid: u.uid });
          }
        }
        if (u.hasAudio) {
          try {
            const audioTrack = u.audioTrack ?? (await client.subscribe(u, 'audio'));
            audioTrack?.play();
            liveDbg('layout sync audio', { uid: u.uid, hadTrack: Boolean(u.audioTrack) });
          } catch (e) {
            liveDbgWarn('layout sync subscribe audio failed', { uid: u.uid }, formatAgoraErr(e));
          }
        }
      }
      repositionRemoteVideoTiles();
    })();
  }, [phase, repositionRemoteVideoTiles, remotePeerCount]);

  const teardown = useCallback(async () => {
    if (renewTimerRef.current) {
      clearInterval(renewTimerRef.current);
      renewTimerRef.current = null;
    }
    const client = clientRef.current;
    const sv = screenShareVideoTrackRef.current;
    const sa = screenShareAudioTrackRef.current;
    if (client && (sv || sa)) {
      try {
        await client.unpublish([sv, sa].filter(Boolean));
      } catch {
        /* ignore */
      }
      try {
        sv?.close?.();
      } catch {
        /* ignore */
      }
      try {
        sa?.close?.();
      } catch {
        /* ignore */
      }
    }
    screenShareVideoTrackRef.current = null;
    screenShareAudioTrackRef.current = null;
    micWasUnpublishedForScreenShareRef.current = false;
    try {
      const dw = docPipWindowRef.current;
      if (dw && !dw.closed) dw.close();
    } catch {
      /* ignore */
    }
    docPipWindowRef.current = null;
    clientRef.current = null;
    setScreenSharing(false);
    setScreenSharePublishedAudio(false);
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
    if (client) {
      try {
        await client.removeAllListeners();
        await client.leave();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const leaveRoom = useCallback(async () => {
    setHangupMenuOpen(false);
    setPhase('leaving');
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture().catch(() => {});
      }
    } catch {
      /* ignore */
    }
    suppressJoinRef.current = true;
    try {
      await liveApi(`/live/sessions/${id}/leave`, token, { method: 'POST', body: '{}' });
    } catch {
      /* ignore */
    }
    await teardown();
    setParticipantPanelOpen(false);
    setChatOpen(false);
    setPhase('left');
    setSessionRunId((x) => x + 1);
  }, [id, teardown, token]);

  const endSessionForAll = useCallback(async () => {
    setHangupMenuOpen(false);
    if (
      !window.confirm(
        'End this session for everyone? All participants will be disconnected from the classroom.'
      )
    ) {
      return;
    }
    setPhase('leaving');
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture().catch(() => {});
      }
    } catch {
      /* ignore */
    }
    suppressJoinRef.current = true;
    try {
      await liveApi(`/live/sessions/${id}/end`, token, { method: 'POST', body: '{}' });
    } catch (e) {
      setPhase('inRoom');
      setHint(e?.message || 'Could not end session. You might not have permission.');
      window.setTimeout(() => setHint(''), 5000);
      return;
    }
    await teardown();
    setParticipantPanelOpen(false);
    setChatOpen(false);
    setPhase('left');
    setSessionRunId((x) => x + 1);
  }, [id, teardown, token]);

  const rejoinLiveSession = useCallback(() => {
    suppressJoinRef.current = false;
    setChatMessages([]);
    setReactionFeed([]);
    lastChatPollIdRef.current = 0;
    lastReactPollIdRef.current = 0;
    setActiveSpeakerUid(null);
    setHint('');
    setScreenSharing(false);
    setScreenSharePublishedAudio(false);
    setPhase('loading');
    setSessionRunId((x) => x + 1);
  }, []);

  const finishLeaveNavigate = useCallback(() => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/', { replace: true });
  }, [navigate]);

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
      const t = localTracksRef.current[0];
      if (!t?.setEnabled) return;
      t.setEnabled(next);
    }
    setMicOn(next);
  }

  function toggleCam() {
    if (phase === 'inRoom' && screenSharing) return;
    const next = !camOn;
    if (phase === 'preJoin') {
      const s = preJoinStreamRef.current;
      const v = s?.getVideoTracks?.()?.[0];
      if (v) v.enabled = next;
    } else {
      const t = localTracksRef.current[1];
      if (!t?.setEnabled) return;
      t.setEnabled(next);
    }
    setCamOn(next);
  }

  const stopScreenShare = useCallback(async () => {
    const client = clientRef.current;
    const sv = screenShareVideoTrackRef.current;
    const sa = screenShareAudioTrackRef.current;
    if (!client || (!sv && !sa)) {
      setScreenSharing(false);
      setScreenSharePublishedAudio(false);
      return;
    }
    setScreenShareBusy(true);
    try {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture().catch(() => {});
        }
      } catch {
        /* ignore */
      }
      try {
        const dw = docPipWindowRef.current;
        if (dw && !dw.closed) dw.close();
      } catch {
        /* ignore */
      }
      docPipWindowRef.current = null;
      const tracks = localTracksRef.current;
      const mic = tracks?.[0];
      const cam = tracks?.[1];
      try {
        await client.unpublish([sv, sa].filter(Boolean));
      } catch {
        /* ignore */
      }
      try {
        const mst = sv?.getMediaStreamTrack?.();
        if (mst) mst.onended = null;
      } catch {
        /* ignore */
      }
      try {
        sv?.close?.();
      } catch {
        /* ignore */
      }
      try {
        sa?.close?.();
      } catch {
        /* ignore */
      }
      screenShareVideoTrackRef.current = null;
      screenShareAudioTrackRef.current = null;
      setScreenSharePublishedAudio(false);
      const needMic = micWasUnpublishedForScreenShareRef.current;
      micWasUnpublishedForScreenShareRef.current = false;
      if (mic && needMic) {
        try {
          await client.publish([mic]);
        } catch (e) {
          liveDbgWarn('republish mic after screen share', formatAgoraErr(e));
        }
        try {
          mic.setEnabled?.(micOn);
        } catch {
          /* ignore */
        }
      }
      if (cam) {
        try {
          await client.publish([cam]);
        } catch (e) {
          liveDbgWarn('republish camera after screen share', formatAgoraErr(e));
        }
        try {
          cam.setEnabled?.(camOn);
        } catch {
          /* ignore */
        }
      }
      setScreenSharing(false);
      setScreenSharePublishedAudio(false);
      setLocalTracksVersion((v) => v + 1);
    } finally {
      setScreenShareBusy(false);
    }
  }, [camOn, micOn]);

  const startScreenShare = useCallback(async () => {
    const AgoraRTC = agoraRtcRef.current;
    const client = clientRef.current;
    const tracks = localTracksRef.current;
    const mic = tracks?.[0];
    const cam = tracks?.[1];
    if (!AgoraRTC || !client || !cam || phase !== 'inRoom') {
      setHint('Screen sharing is not available right now.');
      window.setTimeout(() => setHint(''), 4000);
      return;
    }
    setScreenShareBusy(true);
    setDeviceHint('');
    micWasUnpublishedForScreenShareRef.current = false;
    let camUnpublished = false;
    let screenVideo = null;
    let screenAudio = null;
    try {
      /**
       * First `await` from the Share click must be `createScreenVideoTrack` (getDisplayMedia) so the browser keeps
       * transient user activation. Immediately after that await, request participant PiP before any other await.
       */
      const withAudio = screenSharePrefIncludeAudio;
      const created = await AgoraRTC.createScreenVideoTrack(
        { encoderConfig: '720p_1' },
        withAudio ? 'auto' : 'disable'
      );
      screenVideo = Array.isArray(created) ? created[0] : created;
      screenAudio = Array.isArray(created) ? created[1] : null;

      const stage = document.getElementById('live-main-stage');
      const pipVideo = stage?.querySelector?.('.liveMeetCell--remote video');
      if (pipVideo && document.pictureInPictureEnabled && typeof pipVideo.requestPictureInPicture === 'function') {
        try {
          if (document.pictureInPictureElement && document.pictureInPictureElement !== pipVideo) {
            void document.exitPictureInPicture();
          }
        } catch {
          /* ignore */
        }
        try {
          if (document.pictureInPictureElement !== pipVideo) {
            try {
              if (pipVideo.paused) void pipVideo.play();
            } catch {
              /* ignore */
            }
            void pipVideo.requestPictureInPicture().catch((e) => {
              liveDbgWarn('participant PiP after screen picker', formatAgoraErr(e));
            });
          }
        } catch (e) {
          liveDbgWarn('participant PiP after screen picker', formatAgoraErr(e));
        }
      } else if (
        !pipVideo &&
        typeof window !== 'undefined' &&
        window.documentPictureInPicture &&
        typeof window.documentPictureInPicture.requestWindow === 'function'
      ) {
        void window.documentPictureInPicture
          .requestWindow({
            width: 400,
            height: 140,
          })
          .then((pipWin) => {
            docPipWindowRef.current = pipWin;
            const d = pipWin.document;
            d.body.replaceChildren();
            const style = d.createElement('style');
            style.textContent =
              'body{margin:0;background:#0f172a;color:#e2e8f0;font:14px/1.45 system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:16px;box-sizing:border-box}';
            d.head.appendChild(style);
            const msg = d.createElement('p');
            msg.textContent =
              'You are presenting. Keep this window open while you share your screen. Return to the meeting tab to stop sharing or use the meeting controls.';
            d.body.appendChild(msg);
          })
          .catch((e) => {
            liveDbgWarn('document PiP (solo presenter)', formatAgoraErr(e));
          });
      }

      await client.unpublish([cam]);
      camUnpublished = true;
      if (screenAudio && mic) {
        try {
          await client.unpublish([mic]);
          micWasUnpublishedForScreenShareRef.current = true;
        } catch (e) {
          liveDbgWarn('unpublish mic for screen audio', formatAgoraErr(e));
        }
      }
      const toPublish = screenAudio ? [screenVideo, screenAudio] : [screenVideo];
      await client.publish(toPublish);
      screenShareVideoTrackRef.current = screenVideo;
      screenShareAudioTrackRef.current = screenAudio || null;
      try {
        const mst = screenVideo.getMediaStreamTrack?.();
        if (mst) {
          mst.onended = () => {
            void stopScreenShare();
          };
        }
      } catch {
        /* ignore */
      }
      setScreenSharing(true);
      setScreenSharePublishedAudio(Boolean(screenAudio));
      setLocalTracksVersion((v) => v + 1);
    } catch (e) {
      liveDbgWarn('startScreenShare failed', formatAgoraErr(e));
      setDeviceHint(e?.message || 'Could not start screen sharing. Check browser permissions.');
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture().catch(() => {});
        }
      } catch {
        /* ignore */
      }
      try {
        const dw = docPipWindowRef.current;
        if (dw && !dw.closed) dw.close();
      } catch {
        /* ignore */
      }
      docPipWindowRef.current = null;
      if (screenVideo || screenAudio) {
        try {
          await client.unpublish([screenVideo, screenAudio].filter(Boolean));
        } catch {
          /* ignore */
        }
        try {
          screenVideo?.close?.();
        } catch {
          /* ignore */
        }
        try {
          screenAudio?.close?.();
        } catch {
          /* ignore */
        }
      }
      screenShareVideoTrackRef.current = null;
      screenShareAudioTrackRef.current = null;
      const hadUnpublishedMic = micWasUnpublishedForScreenShareRef.current;
      micWasUnpublishedForScreenShareRef.current = false;
      try {
        if (camUnpublished && cam) await client.publish([cam]);
      } catch (e2) {
        liveDbgWarn('recover camera publish after screen share failure', formatAgoraErr(e2));
      }
      try {
        if (hadUnpublishedMic && mic) await client.publish([mic]);
      } catch (e3) {
        liveDbgWarn('recover mic publish after screen share failure', formatAgoraErr(e3));
      }
    } finally {
      setScreenShareBusy(false);
    }
  }, [phase, screenSharePrefIncludeAudio, stopScreenShare]);

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

        setJoinMeta({
          title: data.title,
          channelName: data.channelName,
          role: data.role,
          agoraReady: data.agoraReady,
          sessionType: data.sessionType === 'one_to_one' ? 'one_to_one' : 'group',
          uid: Number(data.uid),
          canEndSession: Boolean(data.canEndSession),
        });

        if (data.canEndSession && data.recordingConfigured === false) {
          setHint(
            'Cloud recording is off: set AGORA_CUSTOMER_ID, AGORA_CUSTOMER_SECRET, and DigitalOcean Spaces (SPACES_ENDPOINT, SPACES_BUCKET, SPACES_KEY, SPACES_SECRET) on the API server.'
          );
          window.setTimeout(() => setHint(''), 14000);
        }

        if (!data.agoraReady || !data.token || !data.appId) {
          setPhase('error');
          setError(data.warning || 'Agora is not configured on the server (missing token or env).');
          return;
        }

        const AgoraRTC = (await import('agora-rtc-sdk-ng')).default;
        agoraRtcRef.current = AgoraRTC;
        // Match native: ChannelProfileCommunication ↔ Web `rtc` (everyone publishes/subscribes; two-way meeting).
        const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'h264' });
        clientRef.current = client;

        client.on('connection-state-change', (curState) => {
          liveDbg('connection-state-change', String(curState));
          setRtcState(String(curState));
        });

        const playRemoteOrSubscribe = async (user, existingTrack) => {
          const track = existingTrack ?? user.videoTrack;
          if (!track) {
            try {
              await client.subscribe(user, 'video');
            } catch (e) {
              liveDbgWarn('subscribe(video) failed', { uid: user?.uid }, formatAgoraErr(e));
              console.warn('Live classroom: subscribe video failed', e);
            }
          }
          bumpRemoteLayout(repositionRef);
          setRtcPresenceTick((x) => x + 1);
        };

        const handlePublished = async (user, mediaType) => {
          liveDbg('user-published', { uid: user?.uid, mediaType, hasVideo: user?.hasVideo, hasAudio: user?.hasAudio });
          try {
            if (mediaType === 'video') {
              await playRemoteOrSubscribe(user, null);
              liveDbg('user-published video handled', { uid: user?.uid });
            } else if (mediaType === 'audio') {
              const audioTrack = user.audioTrack ?? (await client.subscribe(user, 'audio'));
              audioTrack?.play();
              liveDbg('user-published audio playing', { uid: user?.uid, hadTrack: Boolean(user.audioTrack) });
            }
            setRtcPresenceTick((x) => x + 1);
          } catch (e) {
            liveDbgWarn('user-published handler error', { uid: user?.uid, mediaType }, formatAgoraErr(e));
            console.warn('Live classroom: subscribe failed', e);
          }
        };

        client.on('user-published', handlePublished);

        /** Communication profile: user-joined for each remote peer. */
        client.on('user-joined', (user) => {
          liveDbg('user-joined', {
            uid: user?.uid,
            hasVideo: user?.hasVideo,
            hasAudio: user?.hasAudio,
            videoTrack: Boolean(user?.videoTrack),
            audioTrack: Boolean(user?.audioTrack),
          });
          if (user.hasVideo) void playRemoteOrSubscribe(user, null);
        });

        client.on('user-unpublished', (user, mediaType) => {
          liveDbg('user-unpublished', { uid: user?.uid, mediaType });
          if (mediaType === 'video') {
            try {
              user.videoTrack?.stop();
            } catch {
              /* ignore */
            }
          }
          bumpRemoteLayout(repositionRef);
          setRtcPresenceTick((x) => x + 1);
        });

        client.on('user-left', (user, reason) => {
          liveDbg('user-left', { uid: user?.uid, reason });
          const gone = Number(user.uid);
          setActiveSpeakerUid((a) => (a === gone ? null : a));
          bumpRemoteLayout(repositionRef);
          setRtcPresenceTick((x) => x + 1);
        });

        /*
         * Agora Web SDK ≥4.24: join()'s IJoinOptions.autoSubscribe defaults to false — keep explicit subscription + true here.
         */
        const joinUid = Number(data.uid);
        if (!Number.isFinite(joinUid)) {
          throw new Error('Invalid Agora uid from server');
        }
        liveDbg('joining Agora', {
          channel: data.channelName,
          joinUid,
          apiRole: data.role,
          autoSubscribe: true,
        });
        await client.join(data.appId, data.channelName, data.token, joinUid, { autoSubscribe: true });
        liveDbg('join ok', {
          localUid: client.uid,
          remoteCount: client.remoteUsers.length,
          remotes: client.remoteUsers.map((u) => ({
            uid: u.uid,
            hasVideo: u.hasVideo,
            hasAudio: u.hasAudio,
            videoTrack: Boolean(u.videoTrack),
            audioTrack: Boolean(u.audioTrack),
          })),
        });

        localJoinUidRef.current = joinUid;
        try {
          client.enableAudioVolumeIndicator();
        } catch (e) {
          liveDbgWarn('enableAudioVolumeIndicator failed', formatAgoraErr(e));
        }
        const SPEAK_LEVEL = 22;
        client.on('volume-indicator', (volumes) => {
          const selfUid = localJoinUidRef.current;
          let bestUid = null;
          let bestLevel = 0;
          for (const { uid, level } of volumes) {
            const n = Number(uid);
            if (!Number.isFinite(n) || n === Number(selfUid)) continue;
            if (level > bestLevel) {
              bestLevel = level;
              bestUid = n;
            }
          }
          setActiveSpeakerUid(bestLevel >= SPEAK_LEVEL ? bestUid : null);
        });

        /* autoSubscribe may attach tracks before user-published; start remote audio. */
        for (const u of client.remoteUsers) {
          try {
            u.audioTrack?.play();
          } catch {
            /* ignore */
          }
        }

        /* Mount video layout before publishing so refs exist for remote tiles and local preview effect. */
        setPhase('inRoom');

        if (data.role === 'publisher') {
          try {
            const tracks = await AgoraRTC.createMicrophoneAndCameraTracks(
              {},
              {
                encoderConfig: '720p_1',
              }
            );
            localTracksRef.current = tracks;
            try {
              const { mic, cam } = micCamForJoinRef.current;
              tracks[0]?.setEnabled?.(mic);
              tracks[1]?.setEnabled?.(cam);
            } catch {
              /* ignore */
            }
            await client.publish(tracks);
            liveDbg('local publish ok', { tracks: tracks.length });
            setLocalTracksVersion((v) => v + 1);
          } catch (e) {
            liveDbgWarn('local publish failed', formatAgoraErr(e));
            setDeviceHint(
              e?.message || 'Camera/microphone permission denied or no device found. Allow access in the browser bar.'
            );
          }
        } else {
          setHint('You are connected as a subscriber only. If this message appears, refresh after a server update.');
        }

        renewTimerRef.current = window.setInterval(async () => {
          try {
            const td = await liveApi(`/live/sessions/${id}/token`, token, { method: 'POST', body: '{}' });
            const cl = clientRef.current;
            if (!td?.token || !cl || typeof cl.renewToken !== 'function') return;
            await cl.renewToken(td.token);
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
      void (async () => {
        try {
          await liveApi(`/live/sessions/${id}/leave`, token, { method: 'POST', body: '{}' });
        } catch {
          /* ignore */
        }
        await teardown();
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
  const agoraRemotes = phase === 'inRoom' && clientLive ? clientLive.remoteUsers : [];
  const remoteByUid = new Map(agoraRemotes.map((u) => [Number(u.uid), u]));
  const participantPanelRows = participants.map((p) => {
    const ru = remoteByUid.get(Number(p.id));
    return {
      id: p.id,
      name: p.name,
      email: p.email,
      role: p.role,
      handRaised: handsSet.has(Number(p.id)),
      agoraVideo: Boolean(ru?.hasVideo),
      agoraAudio: Boolean(ru?.hasAudio),
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
        disabled={screenSharePublishedAudio}
        title={
          screenSharePublishedAudio
            ? 'Microphone is replaced by shared tab/system audio while screen sharing'
            : undefined
        }
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
                    title="Server is missing Agora Cloud Recording or Spaces env. Trainers see a banner after join."
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
                          <span className={row.agoraVideo ? 'livePresenceOn' : 'livePresenceOff'} title="Camera (Agora)">
                            Cam {row.agoraVideo ? 'on' : 'off'}
                          </span>
                          <span className={row.agoraAudio ? 'livePresenceOn' : 'livePresenceOff'} title="Microphone (Agora)">
                            Mic {row.agoraAudio ? 'on' : 'off'}
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
                  <button
                    type="button"
                    className={`liveIconBtn${screenSharing ? ' liveIconBtn--screenOn' : ''}`}
                    onClick={() => void (screenSharing ? stopScreenShare() : startScreenShare())}
                    disabled={screenShareBusy || phase === 'leaving'}
                    aria-pressed={screenSharing}
                    aria-label={screenSharing ? 'Stop sharing screen' : 'Share screen'}
                    title={
                      screenSharePrefIncludeAudio
                        ? 'Next share includes tab/system audio when the browser offers it'
                        : 'Screen only (no tab/system audio)'
                    }
                  >
                    <LiveSvg>
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </LiveSvg>
                  </button>
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
                      ? 'Configure AGORA_CUSTOMER_ID, AGORA_CUSTOMER_SECRET, and SPACES_* on the API server.'
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
                      {isPublisher && phase === 'inRoom' ? (
                        <button
                          type="button"
                          className={`liveOverflowItem${screenSharePrefIncludeAudio ? ' liveOverflowItem--on' : ''}`}
                          role="menuitemcheckbox"
                          aria-checked={screenSharePrefIncludeAudio}
                          onClick={() => {
                            setScreenSharePrefIncludeAudio((v) => !v);
                            setMenuOpen(false);
                          }}
                        >
                          {screenSharePrefIncludeAudio ? '✓ ' : ''}
                          Include tab/system audio (next screen share)
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
