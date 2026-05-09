import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  BackHandler,
  FlatList,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { LiveClassroomErrorBoundary } from '../components/LiveClassroomErrorBoundary';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { allowLandscapeForMedia, lockAppPortrait, lockLandscapeForLive } from '../utils/appScreenOrientation';
import {
  AudioScenarioType,
  ChannelMediaOptions,
  ChannelProfileType,
  ClientRoleType,
  createAgoraRtcEngine,
  RemoteVideoState,
  RtcSurfaceView,
  RtcTextureView,
  ScreenCaptureParameters2,
  ScreenVideoParameters,
  VideoEncoderConfiguration,
  VideoSourceType,
} from 'react-native-agora';

const BRAND_BLUE = '#1a237e';
const BRAND_RED = '#c41e3a';

/** react-native-agora uses `if (canvas.uid)` when sourceType is omitted — uid 0 is falsy and wrongly calls setupLocalVideo for a remote user. */
const LOCAL_VIDEO_CANVAS = { sourceType: VideoSourceType.VideoSourceCamera };
const LOCAL_SCREEN_CANVAS = { sourceType: VideoSourceType.VideoSourceScreenPrimary };

function remoteVideoCanvas(uid: number) {
  return { uid, sourceType: VideoSourceType.VideoSourceRemote };
}

type JoinPayload = {
  liveSessionId: number;
  title: string;
  channelName: string;
  uid: number;
  role: 'publisher' | 'subscriber';
  sessionType: 'group' | 'one_to_one';
  appId: string | null;
  token: string | null;
  tokenExpiresAt: string | null;
  agoraReady: boolean;
  warning: string | null;
  canEndSession?: boolean;
  /** False when AGORA_CUSTOMER_* or SPACES_* is missing — cloud recording cannot start */
  recordingConfigured?: boolean;
};

type RoomState = {
  status: string;
  sessionType: string;
  promotedUserIds: number[];
  handRaisedUserIds: number[];
  recordingActive?: boolean;
  recordingConfigured?: boolean;
  /** Admin / batch trainers only — last recording error for this session */
  recordingFailureHint?: string | null;
};

type ParticipantRow = {
  id: number;
  name: string | null;
  email: string | null;
  role: string | null;
  joinedAt?: string;
};

type SessionMeta = {
  id: number;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string;
  sessionType: string;
};

type ChatMessageRow = {
  id: number;
  userId: number;
  userName: string | null;
  userEmail: string | null;
  body: string;
  createdAt: string;
};

type ReactionRow = {
  id: number;
  userId: number;
  userName: string | null;
  kind: string;
  createdAt: string;
};

const REACTION_EMOJI: Record<string, string> = {
  thumbsup: '👍',
  clap: '👏',
  heart: '❤️',
  laugh: '😂',
  think: '🤔',
};

function buildBroadcasterJoinMediaOptions(): ChannelMediaOptions {
  const o = new ChannelMediaOptions();
  o.clientRoleType = ClientRoleType.ClientRoleBroadcaster;
  o.publishCameraTrack = true;
  o.publishMicrophoneTrack = true;
  o.autoSubscribeAudio = true;
  o.autoSubscribeVideo = true;
  return o;
}

function LiveClassroomScreenContent({ route, navigation }: any) {
  const raw = route?.params ?? {};
  const liveSessionId = Number(raw.liveSessionId);
  const title =
    typeof raw.title === 'string' && raw.title.length > 0 ? raw.title : 'Live classroom';
  const { user } = useAuth();

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;

  const [loading, setLoading] = useState(true);
  const [sessionMeta, setSessionMeta] = useState<SessionMeta | null>(null);
  const [payload, setPayload] = useState<JoinPayload | null>(null);
  const [joined, setJoined] = useState(false);
  const [agoraAvailable, setAgoraAvailable] = useState(true);
  const [remoteUids, setRemoteUids] = useState<number[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  /** True only after engine.initialize + preview; avoids mounting Rtc* views before native engine exists (prevents crashes). */
  const [engineReady, setEngineReady] = useState(false);
  /** Lobby = no payload yet; preview = engine + local preview only; active = joined Agora channel. */
  const [liveStage, setLiveStage] = useState<'preview' | 'active'>('preview');
  const liveStageRef = useRef(liveStage);
  const [activeSpeakerUid, setActiveSpeakerUid] = useState<number | null>(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [roster, setRoster] = useState<ParticipantRow[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessageRow[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [videoTier, setVideoTier] = useState<'hd' | 'sd' | 'low'>('hd');
  const [screenSharing, setScreenSharing] = useState(false);
  /** When true, next screen share requests system/tab audio capture (Android 10+; device-dependent). */
  const [screenShareWithSystemAudioPref, setScreenShareWithSystemAudioPref] = useState(false);
  const [screenShareBusy, setScreenShareBusy] = useState(false);
  const [flashBanner, setFlashBanner] = useState<string | null>(null);

  const insets = useSafeAreaInsets();
  const lastChatPollIdRef = useRef(0);
  const lastReactPollIdRef = useRef(0);

  const engineRef = useRef<any>(null);
  const payloadRef = useRef<JoinPayload | null>(null);
  const joinUidRef = useRef<number | null>(null);
  const agoraInitKeyRef = useRef<string | null>(null);
  const joinDispatchedRef = useRef(false);
  const joinedRef = useRef(false);
  const exitLiveRef = useRef<() => Promise<void>>(async () => {});
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingFlashPrevRef = useRef<boolean | null>(null);
  const sessionEndedAlertRef = useRef(false);

  const restoreTabBarStyle = useMemo(
    () => ({
      paddingTop: 4,
      paddingBottom: Math.max(insets.bottom, 8),
      height: 58 + Math.max(insets.bottom, 8),
    }),
    [insets.bottom]
  );

  useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);

  useEffect(() => {
    joinedRef.current = joined;
  }, [joined]);

  useEffect(() => {
    liveStageRef.current = liveStage;
  }, [liveStage]);

  useLayoutEffect(() => {
    const hideForLive = !!payload && isLandscape;
    navigation.setOptions({
      headerShown: !hideForLive,
      title: title.length > 28 ? `${title.slice(0, 26)}…` : title,
    });
  }, [isLandscape, navigation, title, payload]);

  const loadSessionMeta = useCallback(async () => {
    if (!Number.isFinite(liveSessionId) || liveSessionId <= 0) return;
    setLoading(true);
    try {
      const m = await api.get(`/live/sessions/${liveSessionId}/meta`);
      setSessionMeta(m as SessionMeta);
    } catch (e: any) {
      Alert.alert('Session unavailable', e?.message || 'Could not load live class');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [liveSessionId, navigation]);

  const showFlash = useCallback((text: string) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlashBanner(text);
    flashTimerRef.current = setTimeout(() => {
      setFlashBanner(null);
      flashTimerRef.current = null;
    }, 3800);
  }, []);

  const commitJoinLive = useCallback(async () => {
    if (sessionMeta?.status === 'ended' || sessionMeta?.status === 'cancelled') {
      Alert.alert('Session ended', 'This live class is no longer available.');
      return;
    }
    setLoading(true);
    try {
      await lockLandscapeForLive();
      const data = (await api.post(`/live/sessions/${liveSessionId}/join`)) as JoinPayload;
      setLiveStage('preview');
      joinDispatchedRef.current = false;
      setPayload(data);
      if (data.canEndSession && data.recordingConfigured === false) {
        showFlash('Recording unavailable: server missing Agora Customer ID/secret or Spaces.');
      }
      if (!data?.agoraReady) {
        Alert.alert(
          'Agora not fully configured',
          data?.warning || 'Set AGORA_APP_ID and AGORA_APP_CERTIFICATE in backend to issue tokens.'
        );
      }
    } catch (e: any) {
      Alert.alert('Join failed', e?.message || 'Could not join live class');
    } finally {
      setLoading(false);
    }
  }, [liveSessionId, sessionMeta?.status, showFlash]);

  const exitLiveToSessions = useCallback(async () => {
    try {
      if (engineRef.current) {
        try {
          engineRef.current.stopScreenCapture();
        } catch (_) {
          // ignore if not sharing
        }
        engineRef.current.leaveChannel();
        engineRef.current.removeAllListeners();
        engineRef.current.release();
        engineRef.current = null;
      }
    } catch (_) {
      // ignore rtc cleanup errors
    }
    agoraInitKeyRef.current = null;
    joinDispatchedRef.current = false;
    setJoined(false);
    setEngineReady(false);
    setScreenSharing(false);
    setRemoteUids([]);
    setActiveSpeakerUid(null);
    setPeopleOpen(false);
    setChatOpen(false);
    setSettingsOpen(false);
    lastChatPollIdRef.current = 0;
    lastReactPollIdRef.current = 0;
    setChatMessages([]);
    setChatDraft('');
    setPayload(null);
    setLiveStage('preview');
    try {
      await api.post(`/live/sessions/${liveSessionId}/leave`);
    } catch (_) {
      // Ignore leave errors in client.
    }
    try {
      await lockAppPortrait();
    } catch (_) {
      // ignore
    }
    navigation.goBack();
  }, [liveSessionId, navigation]);

  useEffect(() => {
    exitLiveRef.current = exitLiveToSessions;
  }, [exitLiveToSessions]);

  useEffect(() => {
    if (!joined || liveStage !== 'active') {
      recordingFlashPrevRef.current = null;
      return;
    }
    const cur = Boolean(roomState?.recordingActive);
    const prev = recordingFlashPrevRef.current;
    if (prev !== null && prev !== cur) {
      if (cur) showFlash('Recording started');
      else showFlash('Recording stopped');
    }
    recordingFlashPrevRef.current = cur;
  }, [joined, liveStage, roomState?.recordingActive, showFlash]);

  useFocusEffect(
    useCallback(() => {
      void allowLandscapeForMedia();
      const tab = navigation.getParent();
      tab?.setOptions({ tabBarStyle: { display: 'none' } });
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!payloadRef.current) return false;
        void exitLiveRef.current();
        return true;
      });
      return () => {
        sub.remove();
        tab?.setOptions({ tabBarStyle: restoreTabBarStyle });
        void lockAppPortrait();
      };
    }, [navigation, restoreTabBarStyle])
  );

  const bootstrapAgoraEngine = useCallback(
    async (joinPayload: JoinPayload) => {
      if (!joinPayload.agoraReady || !joinPayload.appId || !joinPayload.token) return;
      try {
        if (Platform.OS === 'android') {
          await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.CAMERA,
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          ]);
        }
        const engine = createAgoraRtcEngine();
        engineRef.current = engine;
        engine.initialize({ appId: joinPayload.appId });
        engine.enableVideo();
        engine.setChannelProfile(ChannelProfileType.ChannelProfileCommunication);
        engine.startPreview();
        const enc = new VideoEncoderConfiguration();
        if (videoTier === 'hd') {
          enc.dimensions = { width: 1280, height: 720 };
          enc.frameRate = 15;
        } else if (videoTier === 'sd') {
          enc.dimensions = { width: 640, height: 480 };
          enc.frameRate = 15;
        } else {
          enc.dimensions = { width: 640, height: 360 };
          enc.frameRate = 15;
        }
        try {
          engine.setVideoEncoderConfiguration(enc);
        } catch (_) {
          // ignore encoder preset errors on older SDK builds
        }
        joinUidRef.current = joinPayload.uid;

        engine.addListener('onJoinChannelSuccess', () => {
          setJoined(true);
          try {
            engine.muteAllRemoteVideoStreams(false);
            engine.muteAllRemoteAudioStreams(false);
          } catch (_) {
            // ignore
          }
          try {
            engine.enableAudioVolumeIndication(400, 3, false);
          } catch (_) {
            // ignore if not supported
          }
        });
        engine.addListener('onAudioVolumeIndication', (_connection: any, speakers: { uid?: number; volume?: number }[]) => {
          const self = Number(joinUidRef.current ?? NaN);
          let best: number | null = null;
          let bestV = 0;
          for (const s of speakers || []) {
            const uid = s.uid;
            const v = s.volume ?? 0;
            if (uid == null || uid <= 0) continue;
            if (Number.isFinite(self) && uid === self) continue;
            if (v > bestV) {
              bestV = v;
              best = uid;
            }
          }
          const threshold = 28;
          setActiveSpeakerUid(bestV >= threshold ? best : null);
        });
        engine.addListener('onUserJoined', (_connection: any, uid: number) => {
          setRemoteUids((prev) => (prev.includes(uid) ? prev : [...prev, uid]));
        });
        engine.addListener(
          'onRemoteVideoStateChanged',
          (_connection: any, uid: number, state: RemoteVideoState) => {
            if (uid == null || uid <= 0) return;
            if (state === RemoteVideoState.RemoteVideoStateDecoding || state === RemoteVideoState.RemoteVideoStateStarting) {
              setRemoteUids((prev) => (prev.includes(uid) ? prev : [...prev, uid]));
            }
          }
        );
        engine.addListener('onUserOffline', (_connection: any, uid: number) => {
          setRemoteUids((prev) => prev.filter((id) => id !== uid));
          setActiveSpeakerUid((a) => (a === uid ? null : a));
        });
        engine.addListener('onTokenPrivilegeWillExpire', async () => {
          try {
            const tokenData = await api.post(`/live/sessions/${liveSessionId}/token`);
            if (tokenData?.token) {
              engine.renewToken(tokenData.token);
            }
          } catch (_) {
            // Keep session alive with old token if renewal fails.
          }
        });

        /** If user already chose "Join" while permissions/engine were starting, join here so we never miss the channel. */
        if (liveStageRef.current === 'active' && !joinDispatchedRef.current) {
          const uidNum = Number(joinPayload.uid);
          if (joinPayload.token && joinPayload.channelName && Number.isFinite(uidNum)) {
            joinDispatchedRef.current = true;
            try {
              const ret = engine.joinChannel(
                joinPayload.token,
                joinPayload.channelName,
                uidNum,
                buildBroadcasterJoinMediaOptions()
              );
              if (ret !== 0) {
                joinDispatchedRef.current = false;
                console.warn('Agora joinChannel returned', ret);
              }
            } catch (e) {
              joinDispatchedRef.current = false;
              console.warn('Agora joinChannel failed', e);
            }
          }
        }

        setEngineReady(true);
      } catch (e) {
        console.log('agora init error', e);
        setEngineReady(false);
        setAgoraAvailable(false);
        Alert.alert(
          'Agora native module unavailable',
          'Use Expo Dev Client build (not Expo Go) to run live video in-app.'
        );
      }
    },
    [liveSessionId, videoTier]
  );

  const confirmJoinSession = useCallback(async () => {
    await lockLandscapeForLive();
    setLiveStage('active');
  }, []);

  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !joined) return;
    const enc = new VideoEncoderConfiguration();
    if (videoTier === 'hd') {
      enc.dimensions = { width: 1280, height: 720 };
      enc.frameRate = 15;
    } else if (videoTier === 'sd') {
      enc.dimensions = { width: 640, height: 480 };
      enc.frameRate = 15;
    } else {
      enc.dimensions = { width: 640, height: 360 };
      enc.frameRate = 15;
    }
    try {
      eng.setVideoEncoderConfiguration(enc);
    } catch (_) {
      // ignore
    }
  }, [videoTier, joined]);

  useEffect(() => {
    void loadSessionMeta();
  }, [loadSessionMeta]);

  useEffect(() => {
    if (!joined || !payload) return;
    const poll = async () => {
      try {
        const d = await api.get(`/live/sessions/${liveSessionId}/messages?afterId=${lastChatPollIdRef.current}`);
        const rows = Array.isArray(d?.messages) ? (d.messages as ChatMessageRow[]) : [];
        if (rows.length) {
          for (const m of rows) lastChatPollIdRef.current = Math.max(lastChatPollIdRef.current, m.id);
          for (const m of rows) {
            if (user?.id != null && m.userId !== user.id) {
              const who = m.userName || m.userEmail || `User ${m.userId}`;
              const snippet = m.body.length > 100 ? `${m.body.slice(0, 100)}…` : m.body;
              showFlash(`${who}: ${snippet}`);
            }
          }
          setChatMessages((prev) => {
            const seen = new Set(prev.map((x) => x.id));
            const next = [...prev];
            for (const m of rows) {
              if (!seen.has(m.id)) {
                seen.add(m.id);
                next.push(m);
              }
            }
            return next.slice(-250);
          });
        }
      } catch (_) {
        // ignore
      }
      try {
        const r = await api.get(`/live/sessions/${liveSessionId}/reactions?afterId=${lastReactPollIdRef.current}`);
        const reactRows = Array.isArray(r?.reactions) ? (r.reactions as ReactionRow[]) : [];
        if (reactRows.length) {
          for (const x of reactRows) lastReactPollIdRef.current = Math.max(lastReactPollIdRef.current, x.id);
          for (const x of reactRows) {
            if (user?.id != null && x.userId !== user.id) {
              const who = x.userName || `User ${x.userId}`;
              const em = REACTION_EMOJI[x.kind] || '·';
              showFlash(`${who} ${em}`);
            }
          }
        }
      } catch (_) {
        // ignore
      }
    };
    void poll();
    const id = setInterval(poll, 2600);
    return () => {
      clearInterval(id);
    };
  }, [joined, payload, liveSessionId, user?.id, showFlash]);

  useEffect(() => {
    if (!peopleOpen || !joined) return;
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await api.get(`/live/sessions/${liveSessionId}/participants`);
        if (!cancelled && Array.isArray(rows)) setRoster(rows as ParticipantRow[]);
      } catch (_) {
        if (!cancelled) setRoster([]);
      }
    };
    void load();
    const id = setInterval(() => void load(), 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [peopleOpen, joined, liveSessionId]);

  useEffect(() => {
    const p = payload;
    const uidNum = p?.uid != null ? Number(p.uid) : NaN;
    if (!p?.agoraReady || !p.channelName || !Number.isFinite(uidNum)) return undefined;
    const key = `${liveSessionId}|${p.channelName}|${uidNum}`;
    if (agoraInitKeyRef.current === key) return undefined;
    agoraInitKeyRef.current = key;
    joinDispatchedRef.current = false;
    void bootstrapAgoraEngine({ ...p, uid: uidNum });
    return () => {
      try {
        try {
          engineRef.current?.stopScreenCapture();
        } catch (_) {
          // ignore
        }
        engineRef.current?.leaveChannel();
        engineRef.current?.removeAllListeners();
        engineRef.current?.release();
      } catch (_) {}
      engineRef.current = null;
      agoraInitKeyRef.current = null;
      joinDispatchedRef.current = false;
      joinUidRef.current = null;
      setJoined(false);
      setEngineReady(false);
      setScreenSharing(false);
    };
  }, [liveSessionId, payload, bootstrapAgoraEngine]);

  useEffect(() => {
    if (liveStage !== 'active') return undefined;
    if (!engineReady || joined) return undefined;
    const eng = engineRef.current;
    const p = payloadRef.current;
    const uidNum = p?.uid != null ? Number(p.uid) : NaN;
    if (!eng || !p?.agoraReady || !p.token || !p.channelName || !Number.isFinite(uidNum)) return undefined;
    if (joinDispatchedRef.current) return undefined;
    joinDispatchedRef.current = true;
    try {
      const ret = eng.joinChannel(p.token, p.channelName, uidNum, buildBroadcasterJoinMediaOptions());
      if (ret !== 0) {
        joinDispatchedRef.current = false;
        console.warn('Agora joinChannel returned', ret);
      }
    } catch (_) {
      joinDispatchedRef.current = false;
    }
    return undefined;
  }, [liveStage, engineReady, joined, payload]);

  useEffect(() => {
    if (!payload) return undefined;
    const id = setInterval(async () => {
      try {
        const s = await api.get(`/live/sessions/${liveSessionId}/state`);
        setRoomState(s);
        if (s?.participantActive === false && !sessionEndedAlertRef.current) {
          sessionEndedAlertRef.current = true;
          clearInterval(id);
          Alert.alert('Meeting ended', 'Host ended the meeting for all participants.', [
            { text: 'OK', onPress: () => void exitLiveToSessions() },
          ]);
          return;
        }
        if ((s?.status === 'ended' || s?.status === 'cancelled') && !sessionEndedAlertRef.current) {
          sessionEndedAlertRef.current = true;
          clearInterval(id);
          Alert.alert('Session ended', 'This live class was ended by the host.', [
            { text: 'OK', onPress: () => void exitLiveToSessions() },
          ]);
        }
      } catch (_) {
        // ignore transient errors
      }
    }, 2800);
    return () => clearInterval(id);
  }, [liveSessionId, payload, exitLiveToSessions]);

  useEffect(() => {
    const onApp = async (next: AppStateStatus) => {
      if (next !== 'active' || !engineRef.current || !payloadRef.current?.agoraReady) return;
      setReconnecting(true);
      try {
        const tokenData = await api.post(`/live/sessions/${liveSessionId}/token`);
        if (tokenData?.token) {
          engineRef.current.renewToken(tokenData.token);
        }
      } catch (_) {
        // ignore
      } finally {
        setReconnecting(false);
      }
    };
    const sub = AppState.addEventListener('change', onApp);
    return () => sub.remove();
  }, [liveSessionId]);

  const raiseHand = async () => {
    try {
      await api.post(`/live/sessions/${liveSessionId}/hand`);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not raise hand');
    }
  };

  const lowerHand = async () => {
    try {
      await api.post(`/live/sessions/${liveSessionId}/hand/clear`);
    } catch (_) {
      // ignore
    }
  };

  const sendChatMessage = async () => {
    const body = chatDraft.trim();
    if (!body || chatSending || !joined) return;
    setChatSending(true);
    try {
      await api.post(`/live/sessions/${liveSessionId}/messages`, { body });
      setChatDraft('');
    } catch (e: any) {
      Alert.alert('Chat', e?.message || 'Could not send');
    } finally {
      setChatSending(false);
    }
  };

  const sendReaction = async (kind: string) => {
    if (!joined) return;
    try {
      await api.post(`/live/sessions/${liveSessionId}/reactions`, { kind });
    } catch (e: any) {
      Alert.alert('Reaction', e?.message || 'Could not send');
    }
  };

  const stopMobileScreenShare = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      setScreenSharing(false);
      return;
    }
    setScreenShareBusy(true);
    try {
      try {
        engine.stopScreenCapture();
      } catch (_) {
        // ignore
      }
      const opts = new ChannelMediaOptions();
      opts.publishScreenCaptureVideo = false;
      opts.publishScreenCaptureAudio = false;
      opts.publishCameraTrack = true;
      opts.publishMicrophoneTrack = true;
      engine.updateChannelMediaOptions(opts);
      try {
        engine.setAudioScenario(AudioScenarioType.AudioScenarioDefault);
      } catch (_) {
        // ignore
      }
      setScreenSharing(false);
    } finally {
      setScreenShareBusy(false);
    }
  }, []);

  const startMobileScreenShare = useCallback(() => {
    const engine = engineRef.current;
    if (!joined || !engine || payloadRef.current?.role !== 'publisher') return;
    setScreenShareBusy(true);
    try {
      const withAudio = screenShareWithSystemAudioPref;
      if (withAudio) {
        try {
          engine.setAudioScenario(AudioScenarioType.AudioScenarioGameStreaming);
        } catch (_) {
          // ignore
        }
      }
      const cap = new ScreenCaptureParameters2();
      cap.captureVideo = true;
      cap.captureAudio = withAudio;
      const vp = new ScreenVideoParameters();
      vp.dimensions = { width: 1280, height: 720 };
      vp.frameRate = 15;
      cap.videoParams = vp;
      const code = engine.startScreenCapture(cap);
      if (code !== 0) {
        Alert.alert(
          'Screen share',
          `Could not start screen capture (code ${code}). On iOS you may need a Broadcast Upload Extension in the native project; on Android, allow screen capture when prompted.`
        );
        try {
          engine.setAudioScenario(AudioScenarioType.AudioScenarioDefault);
        } catch (_) {
          // ignore
        }
        return;
      }
      const opts = new ChannelMediaOptions();
      opts.publishCameraTrack = false;
      opts.publishScreenCaptureVideo = true;
      opts.publishScreenCaptureAudio = withAudio;
      opts.publishMicrophoneTrack = !withAudio;
      engine.updateChannelMediaOptions(opts);
      setScreenSharing(true);
    } catch (e: any) {
      Alert.alert('Screen share', e?.message || 'Failed to start');
      try {
        engine.setAudioScenario(AudioScenarioType.AudioScenarioDefault);
      } catch (_) {
        // ignore
      }
    } finally {
      setScreenShareBusy(false);
    }
  }, [joined, screenShareWithSystemAudioPref]);

  const videoPages = useMemo(() => {
    type Slot = { key: string; kind: 'local' } | { key: string; kind: 'remote'; uid: number };
    const slots: Slot[] =
      !joined
        ? [{ key: 'local', kind: 'local' }]
        : [{ key: 'local', kind: 'local' }, ...remoteUids.map((uid) => ({ key: `r-${uid}`, kind: 'remote' as const, uid }))];
    const pages: Slot[][] = [];
    for (let i = 0; i < slots.length; i += 2) pages.push(slots.slice(i, i + 2));
    return pages;
  }, [joined, remoteUids]);

  if (!Number.isFinite(liveSessionId) || liveSessionId <= 0) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title="Live classroom" />
        <View style={styles.centered}>
          <Text style={styles.error}>Missing or invalid live session. Go back and tap Join live again.</Text>
          <TouchableOpacity style={styles.leaveBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.leaveBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (loading && !sessionMeta) {
    return (
      <View style={styles.pageRoot} accessibilityLabel="Loading live classroom">
        <ScreenPageTitle title="Live classroom" />
        <View style={styles.centered} accessibilityRole="progressbar" accessibilityLiveRegion="polite">
          <ActivityIndicator size="large" color={BRAND_RED} />
          <Text style={styles.loadingTitle}>Loading session…</Text>
          <Text style={styles.loadingSub}>This may take a few seconds.</Text>
          <View style={styles.skeletonRow} accessibilityElementsHidden>
            <View style={[styles.skeletonBar, styles.skeletonBarLg]} />
            <View style={styles.skeletonBar} />
            <View style={[styles.skeletonBar, styles.skeletonBarSm]} />
          </View>
        </View>
      </View>
    );
  }

  if (!payload && sessionMeta) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title={sessionMeta.title || 'Live classroom'} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}>
          <Text style={styles.preJoinTitle}>Before you join</Text>
          <Text style={styles.preJoinSub}>
            Next you will see a landscape camera preview. When you join the session, the room opens in landscape only.
            Camera and microphone are requested before preview.
          </Text>
          <Text style={styles.label}>Session</Text>
          <Text style={styles.value}>{sessionMeta.title}</Text>
          <Text style={styles.label}>Status</Text>
          <Text style={styles.value}>{sessionMeta.status}</Text>
          <Text style={styles.label}>Outgoing video (first publish)</Text>
          <View style={styles.videoTierRow}>
            {(['hd', 'sd', 'low'] as const).map((tier) => (
              <TouchableOpacity
                key={tier}
                style={[styles.videoTierChip, videoTier === tier && styles.videoTierChipOn]}
                onPress={() => setVideoTier(tier)}
              >
                <Text style={[styles.videoTierChipText, videoTier === tier && styles.videoTierChipTextOn]}>
                  {tier === 'hd' ? '720p' : tier === 'sd' ? '480p' : '360p'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.leaveBtn, { marginTop: 20, backgroundColor: BRAND_BLUE }]}
            onPress={() => void commitJoinLive()}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Enter live classroom"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.leaveBtnText}>Continue to preview</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.leaveBtn} onPress={() => navigation.goBack()} accessibilityRole="button">
            <Text style={styles.leaveBtnText}>Go back</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  if (!payload) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title="Live classroom" />
        <View style={styles.centered}>
          <Text style={styles.error}>Could not load live class details.</Text>
          <TouchableOpacity style={styles.leaveBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.leaveBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!isLandscape) {
    return (
      <View style={styles.rotateGateRoot}>
        <StatusBar style="light" />
        <Ionicons name="phone-landscape-outline" size={56} color="#e2e8f0" />
        <Text style={styles.rotateGateTitle}>Rotate to landscape</Text>
        <Text style={styles.rotateGateBody}>
          This live class uses a wide video layout only. Turn your device sideways to preview or join.
        </Text>
      </View>
    );
  }

  const handRaisedSelf = user?.id != null && roomState?.handRaisedUserIds?.includes(user.id);
  const showStudentHand =
    payload.sessionType === 'group' && (user?.role === 'Student' || user?.role === 'Lab');

  const toggleMute = () => {
    if (!engineRef.current) return;
    const next = !muted;
    setMuted(next);
    engineRef.current.muteLocalAudioStream(next);
  };

  const toggleCamera = () => {
    if (!engineRef.current || screenSharing) return;
    const next = !cameraOff;
    setCameraOff(next);
    engineRef.current.muteLocalVideoStream(next);
  };

  const renderMediaControls = () => (
    <View style={styles.liveDockWrap}>
      <View style={[styles.controlsRow, styles.controlsRowCompact]}>
        <TouchableOpacity
          style={[styles.ctrlBtn, styles.ctrlBtnIconOnly, muted && styles.ctrlBtnWarn, screenShareWithSystemAudioPref && screenSharing && styles.ctrlBtnWarn]}
          onPress={toggleMute}
          accessibilityRole="button"
          accessibilityLabel={muted ? 'Unmute microphone' : 'Mute microphone'}
          disabled={screenShareWithSystemAudioPref && screenSharing}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        >
          <Ionicons name={muted ? 'mic-off' : 'mic'} size={26} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.ctrlBtn, styles.ctrlBtnIconOnly, cameraOff && styles.ctrlBtnWarn, screenSharing && styles.ctrlBtnDim]}
          onPress={toggleCamera}
          accessibilityRole="button"
          accessibilityLabel={cameraOff ? 'Turn camera on' : 'Turn camera off'}
          disabled={screenSharing}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        >
          <Ionicons name={cameraOff ? 'videocam-off' : 'videocam'} size={26} color="#fff" />
        </TouchableOpacity>
        {payload?.role === 'publisher' && joined ? (
          <TouchableOpacity
            style={[styles.ctrlBtn, styles.ctrlBtnIconOnly, screenSharing ? styles.ctrlBtnScreenOn : null]}
            onPress={() => (screenSharing ? stopMobileScreenShare() : startMobileScreenShare())}
            disabled={screenShareBusy}
            accessibilityRole="button"
            accessibilityLabel={screenSharing ? 'Stop sharing screen' : 'Share screen'}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Ionicons name="desktop-outline" size={26} color="#fff" />
          </TouchableOpacity>
        ) : null}
      </View>
      {joined && engineReady ? (
        <View style={[styles.controlsRow, styles.sessionToolsRow]}>
          <View
            style={[styles.iconBarBtn, roomState?.recordingActive ? styles.iconBarBtnRecOn : null]}
            accessibilityLabel={roomState?.recordingActive ? 'Recording in progress' : 'Not recording'}
          >
            <Ionicons
              name="radio-button-on"
              size={22}
              color={roomState?.recordingActive ? '#fecaca' : '#475569'}
            />
          </View>
          <TouchableOpacity style={styles.iconBarBtn} onPress={() => setPeopleOpen(true)} accessibilityLabel="People">
            <Ionicons name="people-outline" size={24} color="#e2e8f0" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBarBtn} onPress={() => setChatOpen(true)} accessibilityLabel="Chat">
            <Ionicons name="chatbubble-ellipses-outline" size={24} color="#e2e8f0" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBarBtn} onPress={() => setSettingsOpen(true)} accessibilityLabel="Settings">
            <Ionicons name="settings-outline" size={24} color="#e2e8f0" />
          </TouchableOpacity>
          {Object.keys(REACTION_EMOJI).map((kind) => (
            <TouchableOpacity key={kind} style={styles.reactionDockBtn} onPress={() => void sendReaction(kind)}>
              <Text style={styles.reactionBarEmoji}>{REACTION_EMOJI[kind]}</Text>
            </TouchableOpacity>
          ))}
          {showStudentHand ? (
            <>
              <TouchableOpacity style={styles.iconBarBtn} onPress={raiseHand} accessibilityLabel="Raise hand">
                <Ionicons name="hand-right-outline" size={24} color="#e2e8f0" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBarBtn} onPress={lowerHand} accessibilityLabel="Lower hand">
                <Ionicons name="hand-left-outline" size={24} color="#64748b" />
              </TouchableOpacity>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const handsSet = new Set(roomState?.handRaisedUserIds ?? []);

  const peopleModal = (
    <Modal
      visible={peopleOpen}
      animationType="slide"
      transparent
      onRequestClose={() => setPeopleOpen(false)}
    >
      <View style={styles.peopleModalRoot}>
        <Pressable style={styles.peopleModalBackdrop} onPress={() => setPeopleOpen(false)} />
        <View style={styles.peopleModalSheet}>
          <View style={styles.peopleModalHeader}>
            <Text style={styles.peopleModalTitle}>People</Text>
            <TouchableOpacity onPress={() => setPeopleOpen(false)} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={styles.peopleModalClose}>Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.peopleModalScroll} keyboardShouldPersistTaps="handled">
            {roster.length === 0 ? (
              <Text style={styles.peopleModalEmpty}>No roster loaded yet.</Text>
            ) : (
              roster.map((p) => (
                <View key={p.id} style={styles.peopleModalRow}>
                  <Text style={styles.peopleModalName}>
                    {handsSet.has(p.id) ? '✋ ' : ''}
                    {p.name || p.email || `User ${p.id}`}
                  </Text>
                  {p.role ? (
                    <Text style={styles.peopleModalMeta}>{p.role}</Text>
                  ) : null}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  const chatModal = (
    <Modal visible={chatOpen} animationType="slide" transparent onRequestClose={() => setChatOpen(false)}>
      <View style={styles.peopleModalRoot}>
        <Pressable style={styles.peopleModalBackdrop} onPress={() => setChatOpen(false)} />
        <View style={styles.peopleModalSheet}>
          <View style={styles.peopleModalHeader}>
            <Text style={styles.peopleModalTitle}>Chat</Text>
            <TouchableOpacity onPress={() => setChatOpen(false)} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={styles.peopleModalClose}>Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.peopleModalScroll} keyboardShouldPersistTaps="handled">
            {chatMessages.length === 0 ? (
              <Text style={styles.peopleModalEmpty}>No messages yet.</Text>
            ) : (
              chatMessages.map((m) => (
                <View key={m.id} style={styles.peopleModalRow}>
                  <Text style={styles.peopleModalName}>
                    {m.userName || m.userEmail || `User ${m.userId}`}
                  </Text>
                  <Text style={styles.chatBody}>{m.body}</Text>
                </View>
              ))
            )}
          </ScrollView>
          <View style={styles.chatComposer}>
            <TextInput
              style={styles.chatInput}
              value={chatDraft}
              onChangeText={setChatDraft}
              placeholder="Message everyone…"
              placeholderTextColor="#888"
              maxLength={2000}
              editable={!chatSending}
            />
            <TouchableOpacity
              style={styles.chatSendBtn}
              onPress={() => void sendChatMessage()}
              disabled={chatSending || !chatDraft.trim()}
            >
              <Text style={styles.chatSendBtnText}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  const settingsModal = (
    <Modal visible={settingsOpen} animationType="fade" transparent onRequestClose={() => setSettingsOpen(false)}>
      <View style={styles.peopleModalRoot}>
        <Pressable style={styles.peopleModalBackdrop} onPress={() => setSettingsOpen(false)} />
        <View style={[styles.peopleModalSheet, { maxHeight: '50%' }]}>
          <View style={styles.peopleModalHeader}>
            <Text style={styles.peopleModalTitle}>Call settings</Text>
            <TouchableOpacity onPress={() => setSettingsOpen(false)} accessibilityRole="button">
              <Text style={styles.peopleModalClose}>Close</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.settingsBody}>
            <Text style={styles.label}>Outgoing video quality</Text>
            <View style={styles.videoTierRow}>
              {(['hd', 'sd', 'low'] as const).map((tier) => (
                <TouchableOpacity
                  key={tier}
                  style={[styles.videoTierChip, videoTier === tier && styles.videoTierChipOn]}
                  onPress={() => setVideoTier(tier)}
                >
                  <Text style={[styles.videoTierChipText, videoTier === tier && styles.videoTierChipTextOn]}>
                    {tier === 'hd' ? '720p' : tier === 'sd' ? '480p' : '360p'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.settingsHint}>
              Applies to your uplink while publishing. Choose a lower tier on slower networks.
            </Text>
            {payload?.role === 'publisher' ? (
              <View style={styles.settingsSwitchRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.label}>Screen share: system audio</Text>
                  <Text style={styles.settingsHint}>
                    Off by default. When on, the next screen share tries to capture device audio (Android 10+; not all
                    devices). Your microphone uplink is paused while system audio is shared.
                  </Text>
                </View>
                <Switch
                  value={screenShareWithSystemAudioPref}
                  onValueChange={setScreenShareWithSystemAudioPref}
                  trackColor={{ false: '#475569', true: '#22c55e' }}
                  thumbColor="#f8fafc"
                />
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );

  const renderMeetVideoSlot = (slot: { key: string; kind: 'local' } | { key: string; kind: 'remote'; uid: number }) => {
    if (slot.kind === 'local') {
      return (
        <View style={styles.meetCellWrap}>
          <View style={[styles.meetCellAspect, screenSharing ? styles.cellScreenShare : null]}>
            {Platform.OS === 'android' ? (
              <View style={styles.meetCellShell}>
                <RtcTextureView
                  key={screenSharing ? 'local-screen' : 'local-cam'}
                  style={styles.remoteTextureFill}
                  canvas={screenSharing ? LOCAL_SCREEN_CANVAS : LOCAL_VIDEO_CANVAS}
                />
              </View>
            ) : (
              <RtcSurfaceView
                key={screenSharing ? 'local-screen' : 'local-cam'}
                style={styles.remoteTextureFill}
                canvas={screenSharing ? LOCAL_SCREEN_CANVAS : LOCAL_VIDEO_CANVAS}
              />
            )}
          </View>
          {handRaisedSelf ? (
            <View style={styles.handBadge}>
              <Text style={styles.handBadgeText}>✋</Text>
            </View>
          ) : null}
          <Text style={styles.meetCellLabel}>You</Text>
        </View>
      );
    }
    const uid = slot.uid;
    const canvas = remoteVideoCanvas(uid);
    const speakH = activeSpeakerUid === uid;
    return (
      <View style={styles.meetCellWrap}>
        <View style={[styles.meetCellAspect, speakH && styles.remoteTileSpeaking]}>
          {Platform.OS === 'android' ? (
            <View style={styles.meetCellShell}>
              <RtcTextureView style={styles.remoteTextureFill} canvas={canvas} />
            </View>
          ) : (
            <RtcSurfaceView style={styles.remoteTextureFill} canvas={canvas} />
          )}
        </View>
      </View>
    );
  };

  const videoMain =
    payload.agoraReady && agoraAvailable && engineReady ? (
      <View style={[styles.videoContainer, styles.videoContainerRel, styles.videoContainerLandscape]}>
        <FlatList
          data={videoPages}
          keyExtractor={(_, i) => `vp-${i}`}
          horizontal
          pagingEnabled
          removeClippedSubviews={false}
          extraData={`${joined}:${remoteUids.join(',')}:${activeSpeakerUid ?? ''}:${screenSharing ? 1 : 0}`}
          showsHorizontalScrollIndicator={false}
          style={styles.meetPager}
          renderItem={({ item: page }) => (
            <View style={[styles.meetPagerPage, { width: windowWidth }]}>
              {page.map((slot) => (
                <View key={slot.key} style={styles.meetPagerCell}>
                  {renderMeetVideoSlot(slot)}
                </View>
              ))}
              {page.length === 1 ? <View style={styles.meetPagerCell} /> : null}
            </View>
          )}
        />
      </View>
    ) : payload.agoraReady && agoraAvailable && !engineReady ? (
      <View style={[styles.videoContainer, styles.videoContainerLandscape, styles.videoPlaceholder]}>
        <ActivityIndicator size="large" color="#fff" />
        <Text style={styles.videoPlaceholderText}>Starting camera…</Text>
      </View>
    ) : (
      <View style={[styles.videoContainer, styles.videoContainerLandscape, styles.videoPlaceholder]}>
        <Text style={styles.videoPlaceholderText}>Video unavailable in this build.</Text>
      </View>
    );

  const headerSub =
    liveStage === 'preview'
      ? 'Preview — join when you are ready'
      : reconnecting
        ? 'Refreshing…'
        : joined
          ? 'Connected'
          : 'Connecting…';

  return (
    <>
        <View style={styles.landscapeRoot}>
          <StatusBar hidden />
          <View style={[styles.landscapeHeader, { paddingTop: insets.top + 6 }]}>
            <TouchableOpacity
              onPress={() => void exitLiveToSessions()}
              style={styles.landscapeBackBtn}
              accessibilityRole="button"
              accessibilityLabel="Back to My Sessions"
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}
            >
              <Ionicons name="chevron-back" size={26} color="#e2e8f0" />
            </TouchableOpacity>
            <View style={styles.landscapeHeaderCenter}>
              <Text numberOfLines={1} style={styles.landscapeHeaderTitle}>
                {title}
              </Text>
              <Text style={styles.landscapeHeaderSub}>{headerSub}</Text>
            </View>
            <View style={styles.landscapeHeaderRight}>
              {roomState?.recordingActive ? (
                <View style={styles.recBadge} accessibilityLabel="Recording in progress">
                  <View style={styles.recDot} />
                  <Text style={styles.recBadgeText}>REC</Text>
                </View>
              ) : (
                <View style={styles.landscapeHeaderSpacer} />
              )}
            </View>
          </View>
          <View style={styles.landscapeVideoWrap}>
            {videoMain}
            {flashBanner ? (
              <View style={styles.flashBannerAbs} pointerEvents="none">
                <Text style={styles.flashBannerText} numberOfLines={3}>
                  {flashBanner}
                </Text>
              </View>
            ) : null}
          </View>
          {liveStage === 'preview' && !joined ? (
            <View style={[styles.previewDock, { paddingBottom: Math.max(insets.bottom, 10) }]}>
              <View style={styles.previewDockInner}>
                {renderMediaControls()}
                <TouchableOpacity
                  style={[styles.joinCircleBtn, !engineReady && styles.joinCircleBtnDisabled]}
                  onPress={() => void confirmJoinSession()}
                  disabled={!engineReady}
                  accessibilityRole="button"
                  accessibilityLabel="Join session"
                >
                  <Ionicons name="videocam" size={26} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          ) : joined ? (
            <View style={[styles.landscapeDock, { paddingBottom: Math.max(insets.bottom, 10) }]}>{renderMediaControls()}</View>
          ) : liveStage === 'active' && !joined ? (
            <View style={[styles.landscapeDock, styles.landscapeDockConnecting, { paddingBottom: Math.max(insets.bottom, 10) }]}>
              <ActivityIndicator color="#f8fafc" />
              <Text style={styles.connectingText}>Connecting…</Text>
            </View>
          ) : null}
        </View>
        {peopleModal}
        {chatModal}
        {settingsModal}
      </>
    );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 20, paddingBottom: 32 },
  postLeaveContent: { flexGrow: 1, justifyContent: 'center' },
  postLeaveDoneBtn: { backgroundColor: '#fff', borderWidth: 2, borderColor: BRAND_BLUE },
  postLeaveDoneBtnText: { color: BRAND_BLUE },
  loadingTitle: { marginTop: 16, fontSize: 17, fontWeight: '700', color: '#222', textAlign: 'center' },
  loadingSub: { marginTop: 8, fontSize: 14, color: '#666', textAlign: 'center' },
  skeletonRow: { width: '100%', maxWidth: 280, marginTop: 20, gap: 10 },
  skeletonBar: { height: 10, borderRadius: 5, backgroundColor: '#e0e0e0' },
  skeletonBarLg: { height: 100, borderRadius: 10 },
  skeletonBarSm: { width: '60%', alignSelf: 'flex-start' },
  rotateHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#eef2ff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#c5cae9',
  },
  rotateHintText: { flex: 1, fontSize: 13, color: '#333', lineHeight: 18 },
  rotateHintDismiss: { fontSize: 13, fontWeight: '700', color: BRAND_RED },
  portraitDock: {
    marginTop: 12,
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  landscapeDock: {
    backgroundColor: '#111',
    paddingTop: 6,
  },
  sessionDetailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  sessionDetailsToggleText: { fontSize: 15, fontWeight: '700', color: BRAND_BLUE },
  controlsRowCompact: {
    justifyContent: 'center',
    gap: 20,
    paddingVertical: 4,
  },
  ctrlBtnIconOnly: {
    minWidth: 56,
    paddingHorizontal: 16,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  landscapeRoot: { flex: 1, backgroundColor: '#000' },
  landscapeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingBottom: 8,
    backgroundColor: '#0f172a',
  },
  landscapeBackBtn: { padding: 6, borderRadius: 8 },
  landscapeHeaderCenter: { flex: 1, minWidth: 0, paddingHorizontal: 4 },
  landscapeHeaderRight: { width: 56, alignItems: 'flex-end', justifyContent: 'center' },
  landscapeHeaderSpacer: { width: 38 },
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(127, 29, 29, 0.95)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(254, 202, 202, 0.5)',
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  recBadgeText: { color: '#fecaca', fontWeight: '800', fontSize: 11, letterSpacing: 1 },
  landscapeHeaderTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  landscapeHeaderSub: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  landscapeLeaveChip: {
    backgroundColor: BRAND_RED,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  landscapeLeaveText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  landscapeVideoWrap: { flex: 1, minHeight: 0, position: 'relative' },
  flashBannerAbs: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.35)',
  },
  flashBannerText: { color: '#f8fafc', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  liveDockWrap: { alignItems: 'center', gap: 8 },
  sessionToolsRow: {
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
    paddingHorizontal: 4,
  },
  reactionDockBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  rotateGateRoot: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 32,
  },
  rotateGateTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 16, textAlign: 'center' },
  rotateGateBody: {
    color: '#94a3b8',
    fontSize: 15,
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 22,
  },
  landscapeLeaveIcon: {
    backgroundColor: BRAND_RED,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 6 },
  iconBarBtn: { padding: 8, borderRadius: 10 },
  iconBarBtnRecOn: {
    borderWidth: 2,
    borderColor: 'rgba(248, 113, 113, 0.85)',
    backgroundColor: 'rgba(239, 68, 68, 0.18)',
  },
  previewDock: { backgroundColor: '#0f172a', paddingTop: 8 },
  previewDockInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  joinCircleBtn: {
    backgroundColor: '#15803d',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinCircleBtnDisabled: { opacity: 0.45 },
  meetPager: { flex: 1 },
  meetPagerPage: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 8 },
  meetPagerCell: { flex: 1, justifyContent: 'center' },
  meetCellWrap: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  meetCellAspect: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  meetCellShell: { flex: 1, width: '100%', height: '100%' },
  meetCellLabel: {
    marginTop: 6,
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  cellScreenShare: { borderWidth: 2, borderColor: '#22c55e' },
  landscapeDockConnecting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  connectingText: { color: '#94a3b8', fontSize: 14 },
  handRowLandscape: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#111',
    justifyContent: 'center',
    gap: 12,
  },
  sessionName: { fontSize: 18, color: '#222', fontWeight: '700' },
  subtitle: { marginTop: 6, fontSize: 14, color: BRAND_BLUE, marginBottom: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: BRAND_RED,
  },
  label: { marginTop: 10, fontSize: 12, color: '#777', textTransform: 'uppercase' },
  value: { marginTop: 2, fontSize: 16, color: '#222', fontWeight: '600' },
  valueMono: { marginTop: 2, fontSize: 13, color: '#111', fontFamily: 'Courier' },
  infoCard: { marginTop: 14, backgroundColor: '#eef2ff', borderRadius: 12, padding: 14 },
  infoTitle: { color: BRAND_BLUE, fontWeight: '700', marginBottom: 6 },
  infoText: { color: '#333', fontSize: 13, marginTop: 2 },
  videoContainer: {
    marginTop: 14,
    borderRadius: 12,
    backgroundColor: '#111',
    overflow: 'hidden',
  },
  videoContainerLandscape: {
    flex: 1,
    marginTop: 0,
    borderRadius: 0,
  },
  videoContainerRel: {
    position: 'relative',
  },
  filmMainStage: {
    width: '100%',
    backgroundColor: '#000',
    borderRadius: 10,
    overflow: 'hidden',
  },
  filmMainFill: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  filmMainVideoShell: {
    flex: 1,
    width: '100%',
    height: '100%',
    minHeight: 120,
    backgroundColor: '#000',
  },
  filmMainSurface: {
    flex: 1,
    width: '100%',
    height: '100%',
    minHeight: 120,
    backgroundColor: '#000',
  },
  remoteGridWrap: {
    width: '100%',
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  remoteGridInner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  remoteGridCell: {
    width: '48%',
    aspectRatio: 16 / 9,
    position: 'relative',
    marginBottom: 4,
  },
  remoteGridCellShell: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#222',
  },
  remoteGridSurface: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
    backgroundColor: '#222',
  },
  remoteTilePinned: {
    borderWidth: 3,
    borderColor: '#eab308',
  },
  remoteTileSpeaking: {
    borderWidth: 3,
    borderColor: '#22c55e',
  },
  pinBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  pinBadgeText: {
    color: '#fef08a',
    fontSize: 11,
    fontWeight: '800',
  },
  remoteEmptyMain: {
    flex: 1,
    justifyContent: 'center',
    width: '100%',
  },
  remoteEmptyGrid: {
    paddingVertical: 24,
    alignSelf: 'center',
  },
  layoutModeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  layoutChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c5cae9',
    backgroundColor: '#fff',
  },
  layoutChipOn: {
    backgroundColor: BRAND_RED,
    borderColor: BRAND_RED,
  },
  layoutChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: BRAND_BLUE,
  },
  layoutChipTextOn: {
    color: '#fff',
  },
  landscapeLayoutRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  peopleModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  peopleModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  peopleModalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '72%',
    paddingBottom: 16,
  },
  peopleModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  peopleModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111',
  },
  peopleModalClose: {
    fontSize: 15,
    fontWeight: '700',
    color: BRAND_RED,
  },
  peopleModalScroll: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  peopleModalEmpty: {
    paddingVertical: 20,
    fontSize: 14,
    color: '#666',
  },
  peopleModalRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  peopleModalName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#222',
  },
  peopleModalMeta: {
    marginTop: 4,
    fontSize: 13,
    color: '#666',
    textTransform: 'capitalize',
  },
  preJoinTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111',
    marginBottom: 8,
  },
  preJoinSub: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
    marginBottom: 12,
  },
  videoTierRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
    marginBottom: 4,
  },
  videoTierChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c5cae9',
    backgroundColor: '#fff',
  },
  videoTierChipOn: {
    backgroundColor: BRAND_RED,
    borderColor: BRAND_RED,
  },
  videoTierChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: BRAND_BLUE,
  },
  videoTierChipTextOn: {
    color: '#fff',
  },
  chatBody: {
    marginTop: 4,
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  chatComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    backgroundColor: '#fafafa',
  },
  chatInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    backgroundColor: '#fff',
  },
  chatSendBtn: {
    backgroundColor: BRAND_BLUE,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  chatSendBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  settingsBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  settingsHint: {
    marginTop: 10,
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },
  reactionFeedRow: {
    maxHeight: 40,
    marginTop: 4,
  },
  reactionFeedRowPortrait: {
    maxHeight: 40,
    marginBottom: 6,
  },
  reactionFeedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
    borderRadius: 999,
    backgroundColor: '#e8eaf6',
  },
  reactionFeedEmoji: {
    fontSize: 14,
  },
  reactionFeedName: {
    fontSize: 11,
    color: '#333',
    maxWidth: 72,
  },
  reactionBarRow: {
    maxHeight: 44,
    marginTop: 4,
  },
  reactionBarRowPortrait: {
    maxHeight: 44,
    marginBottom: 8,
  },
  reactionBarBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 4,
  },
  reactionBarEmoji: {
    fontSize: 22,
  },
  videoPlaceholder: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  videoPlaceholderText: {
    color: '#bbb',
    marginTop: 12,
    fontSize: 13,
  },
  localVideo: {
    width: '100%',
    backgroundColor: '#000',
  },
  /** Outer chrome for Android local preview (background lives here, not on RtcTextureView). */
  localVideoShell: {
    width: '100%',
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  /** Layout only — never set backgroundColor on RtcTextureView (Android / Fabric crash). */
  localTextureFill: {
    width: '100%',
    height: '100%',
  },
  remoteVideoShell: {
    width: 140,
    height: 100,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#222',
  },
  remoteTextureFill: {
    width: '100%',
    height: '100%',
  },
  audienceStage: {
    width: '100%',
    position: 'relative',
    backgroundColor: '#000',
    borderRadius: 10,
    overflow: 'hidden',
  },
  mainRemoteTouchable: {
    width: '100%',
    backgroundColor: '#000',
  },
  mainRemoteVideo: {
    width: '100%',
    backgroundColor: '#000',
  },
  waitingHost: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#181818',
  },
  waitingHostText: {
    color: '#aaa',
    fontSize: 15,
    paddingHorizontal: 16,
    textAlign: 'center',
  },
  localPip: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 112,
    height: 148,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: '#000',
    zIndex: 2,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
  },
  localPipVideo: {
    width: '100%',
    height: '100%',
  },
  pipLabel: {
    position: 'absolute',
    bottom: 6,
    left: 8,
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  trainerTapHint: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  trainerTapHintText: {
    color: '#eee',
    fontSize: 11,
    fontWeight: '600',
  },
  remoteStrip: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
  },
  remoteWrap: {
    position: 'relative',
    marginRight: 8,
  },
  remoteVideo: {
    width: 140,
    height: 100,
    backgroundColor: '#222',
    borderRadius: 8,
  },
  handBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  handBadgeText: { fontSize: 14 },
  remoteEmpty: {
    width: 220,
    minHeight: 100,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remoteEmptyText: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '700',
  },
  remoteEmptySub: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 8,
    maxWidth: 200,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    paddingVertical: 12,
    paddingHorizontal: 6,
    gap: 8,
  },
  ctrlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: BRAND_BLUE,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minWidth: 100,
    minHeight: 48,
    justifyContent: 'center',
  },
  ctrlBtnWarn: {
    backgroundColor: '#455a64',
  },
  ctrlBtnDim: {
    opacity: 0.45,
  },
  ctrlBtnScreenOn: {
    borderWidth: 2,
    borderColor: '#4ade80',
  },
  settingsSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#cbd5e1',
  },
  ctrlBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  handRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  handBtn: {
    backgroundColor: BRAND_BLUE,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  handBtnOutline: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: BRAND_BLUE,
  },
  handBtnText: { color: '#fff', fontWeight: '700' },
  handBtnTextOutline: { color: BRAND_BLUE },
  handNote: { fontSize: 13, color: '#333', fontWeight: '600' },
  leaveBtn: {
    marginTop: 18,
    backgroundColor: BRAND_RED,
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 14,
  },
  leaveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  error: { color: '#c62828', marginBottom: 10 },
});

export default function LiveClassroomScreen(props: any) {
  return (
    <LiveClassroomErrorBoundary onGoBack={() => props.navigation.goBack()}>
      <LiveClassroomScreenContent {...props} />
    </LiveClassroomErrorBoundary>
  );
}
