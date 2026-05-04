import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { allowLandscapeForMedia, lockAppPortrait } from '../utils/appScreenOrientation';
import {
  ChannelProfileType,
  ClientRoleType,
  createAgoraRtcEngine,
  RtcSurfaceView,
  RtcTextureView,
  VideoSourceType,
} from 'react-native-agora';

const BRAND_BLUE = '#1a237e';
const BRAND_RED = '#c41e3a';

/** react-native-agora uses `if (canvas.uid)` : uid 0 is falsy and wrongly selects remote setup — use sourceType for local. */
const LOCAL_VIDEO_CANVAS = { sourceType: VideoSourceType.VideoSourceCamera };

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
};

type RoomState = {
  status: string;
  sessionType: string;
  promotedUserIds: number[];
  handRaisedUserIds: number[];
};

export default function LiveClassroomScreen({ route, navigation }: any) {
  const { liveSessionId, title } = route.params as { liveSessionId: number; title: string };
  const { user } = useAuth();

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: !isLandscape });
  }, [isLandscape, navigation]);

  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<JoinPayload | null>(null);
  const [joined, setJoined] = useState(false);
  const [agoraAvailable, setAgoraAvailable] = useState(true);
  const [remoteUids, setRemoteUids] = useState<number[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [rtcIsPublisher, setRtcIsPublisher] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  const insets = useSafeAreaInsets();

  const engineRef = useRef<any>(null);
  const payloadRef = useRef<JoinPayload | null>(null);
  const agoraInitKeyRef = useRef<string | null>(null);
  const initialJoinWasAudienceRef = useRef(false);
  const sessionEndedAlertRef = useRef(false);

  useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);

  useFocusEffect(
    useCallback(() => {
      void allowLandscapeForMedia();
      return () => {
        void lockAppPortrait();
      };
    }, [])
  );

  const join = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.post(`/live/sessions/${liveSessionId}/join`);
      setPayload(data);
      initialJoinWasAudienceRef.current = data?.role === 'subscriber';
      setRtcIsPublisher(data?.role === 'publisher');
      if (!data?.agoraReady) {
        Alert.alert(
          'Agora not fully configured',
          data?.warning || 'Set AGORA_APP_ID and AGORA_APP_CERTIFICATE in backend to issue tokens.'
        );
      }
    } catch (e: any) {
      Alert.alert('Join failed', e?.message || 'Could not join live class');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [liveSessionId, navigation]);

  const leave = useCallback(async () => {
    try {
      if (engineRef.current) {
        engineRef.current.leaveChannel();
        engineRef.current.removeAllListeners();
        engineRef.current.release();
        engineRef.current = null;
      }
    } catch (_) {
      // ignore rtc cleanup errors
    }
    agoraInitKeyRef.current = null;
    try {
      await api.post(`/live/sessions/${liveSessionId}/leave`);
    } catch (_) {
      // Ignore leave errors in client.
    } finally {
      navigation.goBack();
    }
  }, [liveSessionId, navigation]);

  const initAgoraAndJoin = useCallback(
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
        engine.setChannelProfile(ChannelProfileType.ChannelProfileLiveBroadcasting);
        engine.setClientRole(
          joinPayload.role === 'publisher'
            ? ClientRoleType.ClientRoleBroadcaster
            : ClientRoleType.ClientRoleAudience
        );
        // Local preview for everyone: publishers transmit; audience sees self-view only until promoted.
        engine.startPreview();

        engine.addListener('onJoinChannelSuccess', () => {
          setJoined(true);
        });
        engine.addListener('onUserJoined', (_connection: any, uid: number) => {
          setRemoteUids((prev) => (prev.includes(uid) ? prev : [...prev, uid]));
        });
        engine.addListener('onUserOffline', (_connection: any, uid: number) => {
          setRemoteUids((prev) => prev.filter((id) => id !== uid));
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

        engine.joinChannel(joinPayload.token, joinPayload.channelName, joinPayload.uid, {
          clientRoleType:
            joinPayload.role === 'publisher'
              ? ClientRoleType.ClientRoleBroadcaster
              : ClientRoleType.ClientRoleAudience,
          publishCameraTrack: joinPayload.role === 'publisher',
          publishMicrophoneTrack: joinPayload.role === 'publisher',
          autoSubscribeAudio: true,
          autoSubscribeVideo: true,
        });
      } catch (e) {
        console.log('agora init error', e);
        setAgoraAvailable(false);
        Alert.alert(
          'Agora native module unavailable',
          'Use Expo Dev Client build (not Expo Go) to run live video in-app.'
        );
      }
    },
    [liveSessionId]
  );

  useEffect(() => {
    join();
  }, [join]);

  useEffect(() => {
    const p = payload;
    if (!p?.agoraReady || !p.channelName || !p.uid) return;
    const key = `${liveSessionId}|${p.channelName}|${p.uid}`;
    if (agoraInitKeyRef.current === key) return;
    agoraInitKeyRef.current = key;
    initAgoraAndJoin(p);
    return () => {
      try {
        engineRef.current?.leaveChannel();
        engineRef.current?.removeAllListeners();
        engineRef.current?.release();
      } catch (_) {}
      engineRef.current = null;
      agoraInitKeyRef.current = null;
      setJoined(false);
    };
  }, [liveSessionId, payload?.agoraReady, payload?.channelName, payload?.uid, initAgoraAndJoin]);

  useEffect(() => {
    if (!payload) return;
    const id = setInterval(async () => {
      try {
        const s = await api.get(`/live/sessions/${liveSessionId}/state`);
        setRoomState(s);
        if ((s?.status === 'ended' || s?.status === 'cancelled') && !sessionEndedAlertRef.current) {
          sessionEndedAlertRef.current = true;
          clearInterval(id);
          Alert.alert('Session ended', 'This live class was ended by the host.', [
            { text: 'OK', onPress: () => leave() },
          ]);
        }
      } catch (_) {
        // ignore transient errors
      }
    }, 2800);
    return () => clearInterval(id);
  }, [liveSessionId, payload, leave]);

  useEffect(() => {
    const engine = engineRef.current;
    const p = payloadRef.current;
    if (!engine || !p?.agoraReady || !roomState || !joined) return;

    const uid = p.uid;
    const group = p.sessionType === 'group';
    const startedAsAudience = initialJoinWasAudienceRef.current;
    const promoted = Array.isArray(roomState.promotedUserIds) && roomState.promotedUserIds.includes(uid);

    const upgrade = async () => {
      try {
        if (Platform.OS === 'android') {
          await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.CAMERA,
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          ]);
        }
        const td = await api.post(`/live/sessions/${liveSessionId}/token`);
        if (!td?.token) return;
        engine.renewToken(td.token);
        engine.setClientRole(ClientRoleType.ClientRoleBroadcaster);
        engine.updateChannelMediaOptions({
          publishCameraTrack: true,
          publishMicrophoneTrack: true,
          clientRoleType: ClientRoleType.ClientRoleBroadcaster,
          autoSubscribeAudio: true,
          autoSubscribeVideo: true,
        });
        engine.muteLocalVideoStream(false);
        engine.muteLocalAudioStream(false);
        engine.startPreview();
        setRtcIsPublisher(true);
        setPayload((prev) =>
          prev
            ? {
                ...prev,
                role: 'publisher',
                token: td.token,
                tokenExpiresAt: td.tokenExpiresAt ?? prev.tokenExpiresAt,
              }
            : prev
        );
      } catch (e) {
        console.warn('upgrade to speaker failed', e);
      }
    };

    const downgrade = async () => {
      try {
        const td = await api.post(`/live/sessions/${liveSessionId}/token`);
        if (td?.token) engine.renewToken(td.token);
        engine.setClientRole(ClientRoleType.ClientRoleAudience);
        engine.updateChannelMediaOptions({
          publishCameraTrack: false,
          publishMicrophoneTrack: false,
          clientRoleType: ClientRoleType.ClientRoleAudience,
          autoSubscribeAudio: true,
          autoSubscribeVideo: true,
        });
        engine.startPreview();
        setRtcIsPublisher(false);
        setMuted(false);
        setCameraOff(false);
        setPayload((prev) =>
          prev
            ? {
                ...prev,
                role: 'subscriber',
                token: td.token ?? prev.token,
                tokenExpiresAt: td.tokenExpiresAt ?? prev.tokenExpiresAt,
              }
            : prev
        );
      } catch (e) {
        console.warn('downgrade to audience failed', e);
      }
    };

    if (group && startedAsAudience && promoted && !rtcIsPublisher) {
      upgrade();
    } else if (group && startedAsAudience && !promoted && rtcIsPublisher) {
      downgrade();
    }
  }, [roomState, liveSessionId, rtcIsPublisher, joined]);

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

  const canTrainerManageStage =
    (user?.role === 'Trainer' || user?.role === 'Admin') && rtcIsPublisher && payload?.sessionType === 'group';

  const onRemotePress = (remoteUid: number) => {
    if (!payload || !canTrainerManageStage) return;
    const promoted = roomState?.promotedUserIds?.includes(remoteUid);
    Alert.alert(
      `Participant ${remoteUid}`,
      promoted ? 'This student is on stage (publishing).' : 'Let this student share camera and mic?',
      [
        { text: 'Cancel', style: 'cancel' },
        promoted
          ? {
              text: 'Revoke',
              style: 'destructive',
              onPress: async () => {
                try {
                  await api.post(`/live/sessions/${liveSessionId}/demote`, { studentId: remoteUid });
                } catch (e: any) {
                  Alert.alert('Error', e?.message || 'Could not revoke');
                }
              },
            }
          : {
              text: 'Let speak',
              onPress: async () => {
                try {
                  await api.post(`/live/sessions/${liveSessionId}/promote`, { studentId: remoteUid });
                } catch (e: any) {
                  Alert.alert('Error', e?.message || 'Could not promote');
                }
              },
            },
      ]
    );
  };

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

  if (loading) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title="Live classroom" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
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

  const handRaisedSelf = user?.id != null && roomState?.handRaisedUserIds?.includes(user.id);
  const showStudentHand =
    payload.sessionType === 'group' &&
    !rtcIsPublisher &&
    (user?.role === 'Student' || user?.role === 'Lab');

  /** Portrait stage heights; landscape uses computed height so video + controls fit on screen. */
  const portraitPublisherH = 220;
  const portraitAudienceH = 240;
  const landscapeChromeH =
    56 + insets.top + insets.bottom + (showStudentHand ? 52 : 0) + 128;
  const landscapeStageHeight = Math.max(200, windowHeight - landscapeChromeH);

  const publisherVideoHeight = isLandscape ? landscapeStageHeight : portraitPublisherH;
  const audienceMainHeight = isLandscape ? landscapeStageHeight : portraitAudienceH;

  /** Android: PiP over remote must use TextureView — stacked SurfaceViews hide the local preview when remote video starts. iOS: draw above remote SurfaceView. */
  const LocalPreview = ({ style: s }: { style: StyleProp<ViewStyle> }) =>
    Platform.OS === 'android' ? (
      <RtcTextureView style={s} canvas={LOCAL_VIDEO_CANVAS} />
    ) : (
      <RtcSurfaceView style={s} canvas={LOCAL_VIDEO_CANVAS} zOrderMediaOverlay />
    );

  const toggleMute = () => {
    if (!engineRef.current) return;
    const next = !muted;
    setMuted(next);
    engineRef.current.muteLocalAudioStream(next);
  };

  const toggleCamera = () => {
    if (!engineRef.current) return;
    const next = !cameraOff;
    setCameraOff(next);
    engineRef.current.muteLocalVideoStream(next);
  };

  const renderMediaControls = () => (
    <View style={styles.controlsRow}>
      <TouchableOpacity
        style={[styles.ctrlBtn, muted && styles.ctrlBtnWarn]}
        onPress={toggleMute}
        accessibilityRole="button"
        accessibilityLabel={muted ? 'Unmute microphone' : 'Mute microphone'}
      >
        <Ionicons name={muted ? 'mic-off' : 'mic'} size={22} color="#fff" />
        <Text style={styles.ctrlBtnText}>{muted ? 'Unmute' : 'Mute'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.ctrlBtn, cameraOff && styles.ctrlBtnWarn]}
        onPress={toggleCamera}
        accessibilityRole="button"
        accessibilityLabel={cameraOff ? 'Turn camera on' : 'Turn camera off'}
      >
        <Ionicons name={cameraOff ? 'videocam-off' : 'videocam'} size={22} color="#fff" />
        <Text style={styles.ctrlBtnText}>{cameraOff ? 'Cam on' : 'Cam off'}</Text>
      </TouchableOpacity>
    </View>
  );

  const videoSection =
    payload.agoraReady && agoraAvailable ? (
      <View style={[styles.videoContainer, isLandscape && styles.videoContainerLandscape]}>
        {rtcIsPublisher ? (
          <>
            <RtcSurfaceView
              style={[styles.localVideo, { height: publisherVideoHeight }]}
              canvas={LOCAL_VIDEO_CANVAS}
            />
            <ScrollView horizontal contentContainerStyle={styles.remoteStrip}>
              {remoteUids.length === 0 ? (
                <View style={styles.remoteEmpty}>
                  <Text style={styles.remoteEmptyText}>Waiting for other participants...</Text>
                </View>
              ) : (
                remoteUids.map((uid) => {
                  const raised = roomState?.handRaisedUserIds?.includes(uid);
                  return (
                    <TouchableOpacity
                      key={uid}
                      activeOpacity={0.85}
                      onPress={() => (canTrainerManageStage ? onRemotePress(uid) : undefined)}
                      style={styles.remoteWrap}
                    >
                      <RtcSurfaceView style={styles.remoteVideo} canvas={{ uid }} />
                      {raised ? (
                        <View style={styles.handBadge}>
                          <Text style={styles.handBadgeText}>✋</Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
            {joined ? renderMediaControls() : null}
          </>
        ) : (
          <>
            <View style={[styles.audienceStage, { minHeight: audienceMainHeight }]}>
              {remoteUids.length > 0 ? (
                <TouchableOpacity
                  style={styles.mainRemoteTouchable}
                  activeOpacity={canTrainerManageStage ? 0.88 : 1}
                  onPress={() =>
                    canTrainerManageStage && remoteUids[0] != null ? onRemotePress(remoteUids[0]) : undefined
                  }
                >
                  <RtcSurfaceView
                    style={[styles.mainRemoteVideo, { height: audienceMainHeight }]}
                    canvas={{ uid: remoteUids[0] }}
                  />
                  {canTrainerManageStage ? (
                    <View style={styles.trainerTapHint} pointerEvents="none">
                      <Text style={styles.trainerTapHintText}>Tap for stage controls</Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
              ) : (
                <View style={[styles.waitingHost, { minHeight: audienceMainHeight }]}>
                  <Text style={styles.waitingHostText}>Waiting for host to join…</Text>
                </View>
              )}
              <View style={styles.localPip}>
                <LocalPreview style={styles.localPipVideo} />
                <Text style={styles.pipLabel}>You</Text>
              </View>
            </View>
            {remoteUids.length > 1 ? (
              <ScrollView horizontal contentContainerStyle={styles.remoteStrip}>
                {remoteUids.slice(1).map((uid) => {
                  const raised = roomState?.handRaisedUserIds?.includes(uid);
                  return (
                    <TouchableOpacity
                      key={uid}
                      activeOpacity={0.85}
                      onPress={() => (canTrainerManageStage ? onRemotePress(uid) : undefined)}
                      style={styles.remoteWrap}
                    >
                      <RtcSurfaceView style={styles.remoteVideo} canvas={{ uid }} />
                      {raised ? (
                        <View style={styles.handBadge}>
                          <Text style={styles.handBadgeText}>✋</Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : null}
            {joined ? renderMediaControls() : null}
          </>
        )}
      </View>
    ) : null;

  if (isLandscape && payload.agoraReady && agoraAvailable) {
    return (
      <View style={styles.landscapeRoot}>
        <StatusBar hidden />
        <View style={[styles.landscapeHeader, { paddingTop: insets.top + 6 }]}>
          <View style={styles.landscapeHeaderLeft}>
            <Text numberOfLines={1} style={styles.landscapeHeaderTitle}>
              {title}
            </Text>
            <Text style={styles.landscapeHeaderSub}>
              {reconnecting ? 'Refreshing…' : joined ? 'Connected' : 'Connecting…'}
            </Text>
          </View>
          <TouchableOpacity onPress={leave} style={styles.landscapeLeaveChip} accessibilityRole="button">
            <Text style={styles.landscapeLeaveText}>Leave</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.landscapeVideoWrap}>{videoSection}</View>
        {showStudentHand ? (
          <View style={[styles.handRow, styles.handRowLandscape]}>
            <TouchableOpacity style={styles.handBtn} onPress={raiseHand}>
              <Text style={styles.handBtnText}>Raise hand</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.handBtn, styles.handBtnOutline]} onPress={lowerHand}>
              <Text style={[styles.handBtnText, styles.handBtnTextOutline]}>Lower hand</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.pageRoot}>
      <StatusBar style="dark" />
      <ScreenPageTitle title="Live classroom" />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sessionName}>{title}</Text>
      <Text style={styles.subtitle}>
        {reconnecting ? 'Refreshing connection…' : joined ? 'Connected to live classroom' : 'Joining classroom…'}
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>Role</Text>
        <Text style={styles.value}>
          {rtcIsPublisher ? 'Host / Publisher' : 'Audience / Subscriber'}
        </Text>

        <Text style={styles.label}>Session type</Text>
        <Text style={styles.value}>{payload.sessionType === 'group' ? 'Group class' : 'One-to-one'}</Text>

        {payload.sessionType === 'group' && roomState?.promotedUserIds?.length ? (
          <>
            <Text style={styles.label}>On stage (IDs)</Text>
            <Text style={styles.valueMono}>{roomState.promotedUserIds.join(', ')}</Text>
          </>
        ) : null}

        <Text style={styles.label}>Agora channel</Text>
        <Text style={styles.valueMono}>{payload.channelName}</Text>

        <Text style={styles.label}>UID</Text>
        <Text style={styles.valueMono}>{String(payload.uid)}</Text>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Integration status</Text>
        {payload.agoraReady && agoraAvailable ? (
          <Text style={styles.infoText}>
            {payload.sessionType === 'group' && canTrainerManageStage
              ? 'Tap a remote video to let a student speak or revoke the mic.'
              : rtcIsPublisher
                ? 'Live RTC is active. Rotate your device to landscape for a full-screen class view.'
                : 'Your camera preview is in the corner. Rotate to landscape for full screen. Others see your video only when promoted or in 1:1.'}
          </Text>
        ) : (
          <Text style={styles.infoText}>
            {payload.agoraReady
              ? 'Backend is ready, but native Agora module is unavailable in this runtime. Build and open with Expo Dev Client.'
              : 'Backend join flow works, but Agora token is missing. Configure server env variables first.'}
          </Text>
        )}
        {payload.tokenExpiresAt ? <Text style={styles.infoText}>Token expires at: {payload.tokenExpiresAt}</Text> : null}
        {Platform.OS === 'ios' ? <Text style={styles.infoText}>iOS uses app-level permission prompts for camera/mic.</Text> : null}
      </View>

      {showStudentHand ? (
        <View style={styles.handRow}>
          <TouchableOpacity style={styles.handBtn} onPress={raiseHand}>
            <Text style={styles.handBtnText}>Raise hand</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.handBtn, styles.handBtnOutline]} onPress={lowerHand}>
            <Text style={[styles.handBtnText, styles.handBtnTextOutline]}>Lower hand</Text>
          </TouchableOpacity>
          {handRaisedSelf ? <Text style={styles.handNote}>Hand is up</Text> : null}
        </View>
      ) : null}

      {videoSection}

      <TouchableOpacity style={styles.leaveBtn} onPress={leave}>
        <Text style={styles.leaveBtnText}>Leave class</Text>
      </TouchableOpacity>
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 20, paddingBottom: 32 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  landscapeRoot: { flex: 1, backgroundColor: '#000' },
  landscapeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: '#0f172a',
  },
  landscapeHeaderLeft: { flex: 1, marginRight: 12 },
  landscapeHeaderTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  landscapeHeaderSub: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  landscapeLeaveChip: {
    backgroundColor: BRAND_RED,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  landscapeLeaveText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  landscapeVideoWrap: { flex: 1, minHeight: 0 },
  handRowLandscape: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#111',
    justifyContent: 'center',
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
  localVideo: {
    width: '100%',
    backgroundColor: '#000',
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
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remoteEmptyText: {
    color: '#bbb',
    fontSize: 12,
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
    justifyContent: 'center',
  },
  ctrlBtnWarn: {
    backgroundColor: '#455a64',
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
