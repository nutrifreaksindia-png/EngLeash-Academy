import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import Slider from '@react-native-community/slider';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { lockAppPortrait } from '../utils/appScreenOrientation';
import { applyVideoFullscreenOrientation } from '../utils/videoFullscreenOrientation';

const BRAND_RED = '#c41e3a';

type LoadedStatus = Extract<AVPlaybackStatus, { isLoaded: true }>;

export default function VideoPlayerScreen({ route, navigation }: any) {
  const { videoUrl, allowDownload } = route.params;
  const videoRef = useRef<Video | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadedStatus | null>(null);
  const [speed, setSpeed] = useState<1 | 1.25 | 1.5 | 1.75 | 2>(1);
  const [quality, setQuality] = useState<'low' | 'normal' | 'high'>('normal');
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const lastTapRef = useRef<number | null>(null);
  const insets = useSafeAreaInsets();

  useFocusEffect(
    useCallback(() => {
      void lockAppPortrait();
      return () => {
        void lockAppPortrait();
      };
    }, []),
  );

  useEffect(() => {
    if (!nativeFullscreen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      videoRef.current?.dismissFullscreenPlayer();
      void lockAppPortrait();
      setNativeFullscreen(false);
      return true;
    });
    return () => sub.remove();
  }, [nativeFullscreen]);

  const isLoaded = status?.isLoaded ?? false;

  if (!videoUrl) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title="Video" />
        <View style={styles.centered}>
          <Text style={styles.errorText}>No video for this lesson.</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.backBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const onDoubleTap = (direction: 'back' | 'forward') => {
    const now = Date.now();
    if (lastTapRef.current && now - lastTapRef.current < 300 && status && status.isLoaded) {
      const delta = direction === 'back' ? -10000 : 10000;
      const current = status.positionMillis;
      const duration = status.durationMillis ?? current;
      const next = Math.min(Math.max(current + delta, 0), duration);
      videoRef.current?.setStatusAsync({ positionMillis: next });
      lastTapRef.current = null;
    } else {
      lastTapRef.current = now;
    }
  };

  const titleBarHeight = insets.top + 52;

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom, paddingRight: insets.right }]}>
      <View style={[styles.titleBar, { paddingTop: insets.top }]}>
        <ScreenPageTitle title="Video" showDivider={false} />
      </View>
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      )}
      {error && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      <Video
        ref={videoRef}
        source={{ uri: videoUrl }}
        style={styles.video}
        resizeMode={ResizeMode.CONTAIN}
        useNativeControls={false}
        shouldPlay
        onLoad={() => setLoading(false)}
        onError={() => setError('Playback failed')}
        onFullscreenUpdate={(e) => {
          void applyVideoFullscreenOrientation(e.fullscreenUpdate, setNativeFullscreen);
        }}
        onPlaybackStatusUpdate={(s: AVPlaybackStatus) => {
          if (!s.isLoaded) return;
          setStatus(s as LoadedStatus);
        }}
      />

      {/* Double-tap areas for ±10s */}
      <Pressable style={styles.leftTapArea} onPress={() => onDoubleTap('back')} />
      <Pressable style={styles.rightTapArea} onPress={() => onDoubleTap('forward')} />

      {!allowDownload && (
        <View style={[styles.badge, { top: titleBarHeight + 8 }]}>
          <Text style={styles.badgeText}>View only • Download disabled</Text>
        </View>
      )}

      {/* Custom bottom control bar: play/pause, timeline, speed, quality, fullscreen */}
      {isLoaded && status?.durationMillis != null && (
        <View style={[styles.controlsBar, { bottom: 8 + insets.bottom }]}>
          {/* Play / Pause */}
          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => {
              if (!status) return;
              if (status.isPlaying) {
                videoRef.current?.pauseAsync();
              } else {
                videoRef.current?.playAsync();
              }
            }}
          >
            <Text style={styles.controlIcon}>{status.isPlaying ? '⏸' : '▶'}</Text>
          </TouchableOpacity>

          {/* Timeline */}
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={status.durationMillis}
            value={status.positionMillis}
            minimumTrackTintColor="#ffffff"
            maximumTrackTintColor="#555555"
            thumbTintColor="#ffffff"
            onSlidingComplete={(val) => {
              videoRef.current?.setStatusAsync({ positionMillis: val });
            }}
          />

          {/* Speed */}
          <TouchableOpacity
            style={styles.controlButton}
            onPress={async () => {
              const speeds: (1 | 1.25 | 1.5 | 1.75 | 2)[] = [1, 1.25, 1.5, 1.75, 2];
              const idx = speeds.indexOf(speed);
              const next = speeds[(idx + 1) % speeds.length];
              setSpeed(next);
              try {
                await videoRef.current?.setStatusAsync({ rate: next, shouldCorrectPitch: true });
              } catch {}
            }}
          >
            <Text style={styles.controlText}>{`${speed}x`}</Text>
          </TouchableOpacity>

          {/* Quality (UI only for now) */}
          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => {
              const order: ('low' | 'normal' | 'high')[] = ['low', 'normal', 'high'];
              const idx = order.indexOf(quality);
              const next = order[(idx + 1) % order.length];
              setQuality(next);
            }}
          >
            <Text style={styles.controlText}>
              {quality === 'low' ? 'L' : quality === 'normal' ? 'N' : 'H'}
            </Text>
          </TouchableOpacity>

          {/* Fullscreen */}
          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => {
              videoRef.current?.presentFullscreenPlayer();
            }}
          >
            <Text style={styles.controlIcon}>⤢</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity
        style={[styles.backBtn, { top: titleBarHeight + 6 }]}
        onPress={() => navigation.goBack()}
      >
        <Text style={styles.backBtnText}>{'‹'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: '#000' },
  container: { flex: 1, backgroundColor: '#000' },
  titleBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#c5c5c5',
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  video: { flex: 1, width: '100%' },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  errorOverlay: {
    position: 'absolute',
    bottom: 80,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(200,0,0,0.9)',
    padding: 12,
    borderRadius: 8,
  },
  errorText: { color: '#fff', textAlign: 'center' },
  badge: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  badgeText: { color: '#fff', fontSize: 12 },
  controlsBar: {
    position: 'absolute',
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  controlButton: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  controlIcon: {
    color: '#fff',
    fontSize: 14,
  },
  controlText: {
    color: '#fff',
    fontSize: 12,
  },
  slider: {
    flex: 1,
    marginHorizontal: 6,
  },
  leftTapArea: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '33%',
  },
  rightTapArea: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: '33%',
  },
  backBtn: {
    position: 'absolute',
    left: 16,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: 'center',
  },
  backBtnText: { color: '#fff', fontWeight: '600', fontSize: 18 },
});
