import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';

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

/**
 * Play a remote video track into the grid.
 * Uses subscribe()'s returned track when provided so we do not depend on remoteUsers[].videoTrack being populated synchronously.
 * Retries until the grid ref exists (layout can lag user-published).
 */
function schedulePlayRemoteVideo({ remoteWrapRef, remoteElsRef, uid, videoTrack }) {
  const uidKey = String(uid);
  let attempts = 0;
  const maxAttempts = 150;

  const run = () => {
    if (attempts++ >= maxAttempts) return;
    const wrap = remoteWrapRef.current;
    if (!videoTrack || !wrap) {
      requestAnimationFrame(run);
      return;
    }

    let box = remoteElsRef.current.get(uidKey);
    if (!box) {
      box = document.createElement('div');
      box.className = 'liveRemoteTile';
      box.dataset.uid = uidKey;
      wrap.appendChild(box);
      remoteElsRef.current.set(uidKey, box);
    }
    try {
      videoTrack.play(box, { fit: 'cover' });
    } catch (e) {
      console.warn('Live classroom: remote video play failed', e);
    }
  };

  run();
}

export default function LiveClassroomPage({ token }) {
  const { liveSessionId } = useParams();
  const navigate = useNavigate();
  const id = Number(liveSessionId);
  const [phase, setPhase] = useState('loading'); // loading | inRoom | error | leaving
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

  const clientRef = useRef(null);
  const localTracksRef = useRef([]);
  const renewTimerRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteWrapRef = useRef(null);
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
    if (phase !== 'inRoom') return;
    const tracks = localTracksRef.current;
    if (!tracks?.length) return;
    const camTrack = tracks[1];
    const el = localVideoRef.current;
    if (!camTrack || !el) return;
    try {
      camTrack.play(el, { mirror: true, fit: 'cover' });
      setDeviceHint('');
    } catch (e) {
      setDeviceHint(e?.message || 'Could not show camera preview.');
    }
  }, [phase, localTracksVersion]);

  /** After React mounts the remote grid, subscribe/play any users already in the channel (join-after-publish / missed events). */
  useLayoutEffect(() => {
    if (phase !== 'inRoom') return;
    const client = clientRef.current;
    if (!client) return;

    void (async () => {
      for (const u of client.remoteUsers) {
        if (u.hasVideo) {
          if (u.videoTrack) {
            schedulePlayRemoteVideo({
              remoteWrapRef,
              remoteElsRef,
              uid: u.uid,
              videoTrack: u.videoTrack,
            });
          } else {
            try {
              const videoTrack = await client.subscribe(u, 'video');
              schedulePlayRemoteVideo({
                remoteWrapRef,
                remoteElsRef,
                uid: u.uid,
                videoTrack,
              });
            } catch {
              /* race with user-published */
            }
          }
        }
        if (u.hasAudio) {
          try {
            const audioTrack = u.audioTrack ?? (await client.subscribe(u, 'audio'));
            audioTrack?.play();
          } catch {
            /* ignore */
          }
        }
      }
    })();
  }, [phase]);

  const teardown = useCallback(async () => {
    if (renewTimerRef.current) {
      clearInterval(renewTimerRef.current);
      renewTimerRef.current = null;
    }
    const client = clientRef.current;
    clientRef.current = null;
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
    setPhase('leaving');
    try {
      await liveApi(`/live/sessions/${id}/leave`, token, { method: 'POST', body: '{}' });
    } catch {
      /* ignore */
    }
    await teardown();
    if (window.history.length > 1) navigate(-1);
    else navigate('/', { replace: true });
  }, [id, navigate, teardown, token]);

  function toggleMic() {
    const t = localTracksRef.current[0];
    if (!t?.setEnabled) return;
    const next = !micOn;
    t.setEnabled(next);
    setMicOn(next);
  }

  function toggleCam() {
    const t = localTracksRef.current[1];
    if (!t?.setEnabled) return;
    const next = !camOn;
    t.setEnabled(next);
    setCamOn(next);
  }

  useEffect(() => {
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
        });

        if (!data.agoraReady || !data.token || !data.appId) {
          setPhase('error');
          setError(data.warning || 'Agora is not configured on the server (missing token or env).');
          return;
        }

        const AgoraRTC = (await import('agora-rtc-sdk-ng')).default;
        // Must match native mobile: ChannelProfileLiveBroadcasting uses interactive live (host/audience), not 1:1 "rtc" mode.
        const initialRole = data.role === 'publisher' ? 'host' : 'audience';
        const client = AgoraRTC.createClient({
          mode: 'live',
          codec: 'vp8',
          role: initialRole,
        });
        clientRef.current = client;

        client.on('connection-state-change', (curState) => {
          setRtcState(String(curState));
        });

        const playRemoteOrSubscribe = async (user, existingTrack) => {
          const track = existingTrack ?? user.videoTrack;
          if (track) {
            schedulePlayRemoteVideo({
              remoteWrapRef,
              remoteElsRef,
              uid: user.uid,
              videoTrack: track,
            });
            return;
          }
          try {
            const videoTrack = await client.subscribe(user, 'video');
            schedulePlayRemoteVideo({
              remoteWrapRef,
              remoteElsRef,
              uid: user.uid,
              videoTrack,
            });
          } catch (e) {
            console.warn('Live classroom: subscribe video failed', e);
          }
        };

        const handlePublished = async (user, mediaType) => {
          try {
            if (mediaType === 'video') {
              await playRemoteOrSubscribe(user, null);
            } else if (mediaType === 'audio') {
              const audioTrack = user.audioTrack ?? (await client.subscribe(user, 'audio'));
              audioTrack?.play();
            }
          } catch (e) {
            console.warn('Live classroom: subscribe failed', e);
          }
        };

        client.on('user-published', handlePublished);

        /** Live profile: user-joined reports hosts (incl. audience→host). Catches publish edge cases with user-published. */
        client.on('user-joined', (user) => {
          if (user.hasVideo) void playRemoteOrSubscribe(user, null);
        });

        client.on('user-unpublished', (user, mediaType) => {
          const uidKey = String(user.uid);
          if (mediaType === 'video') {
            try {
              user.videoTrack?.stop();
            } catch {
              /* ignore */
            }
            const el = remoteElsRef.current.get(uidKey);
            if (el) {
              el.remove();
              remoteElsRef.current.delete(uidKey);
            }
          }
        });

        client.on('user-left', (user) => {
          const uidKey = String(user.uid);
          const el = remoteElsRef.current.get(uidKey);
          if (el) {
            el.remove();
            remoteElsRef.current.delete(uidKey);
          }
        });

        /* Interactive live: set role before join so the client is host/audience for the whole join handshake (matches Agora guidance for publish; avoids join-as-audience-then-host races for multi-host). */
        await client.setClientRole(data.role === 'publisher' ? 'host' : 'audience');
        /*
         * Agora Web SDK ≥4.24: join()'s IJoinOptions.autoSubscribe defaults to false — the SFU will not stream remote
         * broadcasters' media until subscription is active. Native mobile uses autoSubscribeVideo/Audio: true, so it
         * receives the web host; without this flag the web host often gets no remote A/V from native (asymmetric).
         */
        const joinUid = Number(data.uid);
        if (!Number.isFinite(joinUid)) {
          throw new Error('Invalid Agora uid from server');
        }
        await client.join(data.appId, data.channelName, data.token, joinUid, { autoSubscribe: true });

        /* autoSubscribe may attach tracks before user-published; start remote audio and queue video play. */
        for (const u of client.remoteUsers) {
          try {
            u.audioTrack?.play();
          } catch {
            /* ignore */
          }
          if (u.videoTrack) {
            schedulePlayRemoteVideo({
              remoteWrapRef,
              remoteElsRef,
              uid: u.uid,
              videoTrack: u.videoTrack,
            });
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
            await client.publish(tracks);
            setLocalTracksVersion((v) => v + 1);
          } catch (e) {
            setDeviceHint(
              e?.message || 'Camera/microphone permission denied or no device found. Allow access in the browser bar.'
            );
          }
        } else {
          setHint('You are in the audience. Video from the host appears when they turn their camera on.');
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
  }, [id, teardown, token]);

  const isPublisher = joinMeta?.role === 'publisher';
  const showStage = phase === 'inRoom' || phase === 'leaving';

  return (
    <div className="liveClassroomRoot">
      <header className="liveClassroomBar">
        <div className="liveClassroomTitle">
          <strong>{joinMeta?.title || 'Live class'}</strong>
          {joinMeta?.channelName ? (
            <span className="liveClassroomChannel">{joinMeta.channelName}</span>
          ) : null}
          {phase === 'inRoom' && participants.length > 0 ? (
            <span className="liveClassroomParticipants" title={participants.map((p) => p.name || p.email).join(', ')}>
              In session: {participants.length} —{' '}
              {participants.map((p) => p.name || p.email || `User ${p.id}`).join(', ')}
            </span>
          ) : null}
          {rtcState ? <span className="liveClassroomRtc">Connection: {rtcState}</span> : null}
        </div>
        <div className="liveClassroomBarActions">
          {phase === 'inRoom' ? (
            <span className={`liveBadge ${isPublisher ? 'liveBadgeHost' : ''}`}>
              {isPublisher ? 'Publishing (host)' : 'Audience'}
            </span>
          ) : null}
          <button type="button" className="liveBarBtn liveBarBtnLeave" onClick={() => void leaveRoom()} disabled={phase === 'leaving'}>
            {phase === 'leaving' ? 'Leaving…' : 'Leave session'}
          </button>
        </div>
      </header>

      {isPublisher && phase === 'inRoom' ? (
        <div className="liveToolbar">
          <button type="button" className={`liveToolBtn ${!micOn ? 'liveToolBtnOff' : ''}`} onClick={toggleMic}>
            {micOn ? 'Mute mic' : 'Unmute mic'}
          </button>
          <button type="button" className={`liveToolBtn ${!camOn ? 'liveToolBtnOff' : ''}`} onClick={toggleCam}>
            {camOn ? 'Camera off' : 'Camera on'}
          </button>
        </div>
      ) : null}

      {phase === 'loading' ? (
        <div className="liveClassroomCenter">
          <p>Connecting to classroom…</p>
          <p className="liveClassroomSub">Allow camera and microphone when the browser asks.</p>
        </div>
      ) : null}

      {phase === 'error' ? (
        <div className="liveClassroomCenter liveClassroomError">
          <p>{error || 'Could not join.'}</p>
          <button type="button" className="liveBarBtn" onClick={() => navigate(-1)}>
            Go back
          </button>
        </div>
      ) : null}

      {showStage ? (
        <div className="liveClassroomStage">
          <div className="liveStageLabel">
            Remote video (Agora){' '}
            {participants.length > 0 ? (
              <span className="liveStageHint">
                · {participants.length} in room (see list in header)
              </span>
            ) : null}
          </div>
          <div ref={remoteWrapRef} className="liveRemoteGrid" />
          <div className="liveStageLabel">Your preview</div>
          <div className="liveLocalWrap">
            <div ref={localVideoRef} className="liveLocalVideo" />
            {deviceHint ? <p className="liveDeviceError">{deviceHint}</p> : null}
            {hint ? <p className="liveHint">{hint}</p> : null}
            {isPublisher && !deviceHint ? (
              <p className="liveHint">If preview stays black, check browser permissions (camera icon in address bar).</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
