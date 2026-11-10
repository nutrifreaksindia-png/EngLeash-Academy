import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Audio, ResizeMode, Video } from 'expo-av';
import Ionicons from '@expo/vector-icons/Ionicons';
import { detectMediaKind, openMedia, type MediaKind } from '../lib/openMedia';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

export type MaterialItem = {
  key: string;
  label: string;
  url?: string;
  type?: string;
  icon?: keyof typeof Ionicons.glyphMap;
};

function hostnameOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function fmtMs(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function LinkPreviewCard({
  url,
  label,
  onOpen,
}: {
  url: string;
  label: string;
  onOpen: () => void;
}) {
  const [meta, setMeta] = useState<{ title?: string; description?: string; image?: string }>({});
  const host = hostnameOf(url);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url, {
          headers: { Accept: 'text/html' },
        });
        const html = await res.text();
        if (cancelled || !html) return;
        const pick = (prop: string) => {
          const re = new RegExp(
            `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
            'i',
          );
          const re2 = new RegExp(
            `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
            'i',
          );
          return (html.match(re) || html.match(re2))?.[1];
        };
        const title =
          pick('og:title') ||
          html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
        const description = pick('og:description') || pick('description');
        let image = pick('og:image') || pick('twitter:image');
        if (image && image.startsWith('//')) image = `https:${image}`;
        else if (image && image.startsWith('/')) {
          try {
            const u = new URL(url);
            image = `${u.origin}${image}`;
          } catch {
            /* ignore */
          }
        }
        if (!cancelled) {
          setMeta({
            title: title ? String(title).slice(0, 120) : undefined,
            description: description ? String(description).slice(0, 160) : undefined,
            image: image || undefined,
          });
        }
      } catch {
        /* preview optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <TouchableOpacity style={styles.linkCard} onPress={onOpen} activeOpacity={0.9}>
      {meta.image ? (
        <Image source={{ uri: meta.image }} style={styles.linkImage} resizeMode="cover" />
      ) : (
        <View style={styles.linkImageFallback}>
          <Ionicons name="link-outline" size={28} color={BRAND_BLUE} />
        </View>
      )}
      <View style={styles.linkBody}>
        <Text style={styles.linkHost} numberOfLines={1}>
          {host}
        </Text>
        <Text style={styles.linkTitle} numberOfLines={2}>
          {meta.title || label || host}
        </Text>
        {meta.description ? (
          <Text style={styles.linkDesc} numberOfLines={2}>
            {meta.description}
          </Text>
        ) : (
          <Text style={styles.linkUrl} numberOfLines={1}>
            {url}
          </Text>
        )}
        <Text style={styles.linkCta}>Open link</Text>
      </View>
    </TouchableOpacity>
  );
}

function AudioPreviewCard({ url, label }: { url: string; label: string }) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [positionMs, setPositionMs] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return () => {
      void soundRef.current?.unloadAsync().catch(() => undefined);
      soundRef.current = null;
    };
  }, [url]);

  async function toggle() {
    try {
      setBusy(true);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      if (playing && soundRef.current) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
        return;
      }
      if (soundRef.current) {
        const st = await soundRef.current.getStatusAsync();
        if (st.isLoaded) {
          await soundRef.current.playAsync();
          setPlaying(true);
          return;
        }
        await soundRef.current.unloadAsync().catch(() => undefined);
      }
      const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
      soundRef.current = sound;
      setPlaying(true);
      sound.setOnPlaybackStatusUpdate((st) => {
        if (!st.isLoaded) return;
        if (st.durationMillis != null) setDurationMs(st.durationMillis);
        setPositionMs(st.positionMillis || 0);
        setPlaying(!!st.isPlaying);
        if (st.didJustFinish) {
          setPlaying(false);
          setPositionMs(0);
        }
      });
    } catch {
      setPlaying(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.audioCard}>
      <TouchableOpacity style={styles.audioBtn} onPress={() => void toggle()} disabled={busy}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Ionicons name={playing ? 'pause' : 'play'} size={22} color="#fff" />
        )}
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.audioLabel} numberOfLines={1}>
          {label || 'Audio'}
        </Text>
        <Text style={styles.audioTime}>
          {fmtMs(positionMs)} / {durationMs > 0 ? fmtMs(durationMs) : '0:00'}
        </Text>
      </View>
    </View>
  );
}

export default function AssignmentMaterialPreview({
  item,
  navigation,
}: {
  item: MaterialItem;
  navigation: any;
}) {
  const url = String(item.url || '').trim();
  if (!url) return null;

  const kind: MediaKind =
    String(item.type || '').toLowerCase() === 'link'
      ? detectMediaKind({ url }) === 'file'
        ? 'file'
        : detectMediaKind({ url })
      : detectMediaKind({ url, typeHint: item.type });

  const isPlainLink =
    String(item.type || '').toLowerCase() === 'link' ||
    (kind === 'file' && /^https?:\/\//i.test(url) && !/\.(pdf|png|jpe?g|gif|webp|mp4|mov|webm|mp3|m4a|wav)(\?|$)/i.test(url));

  const open = () => {
    if (isPlainLink && kind === 'file') {
      void Linking.openURL(url);
      return;
    }
    openMedia(navigation, {
      url,
      title: item.label,
      kind: kind === 'file' && /\.pdf(\?|$)/i.test(url) ? 'pdf' : kind === 'file' ? undefined : kind,
    });
  };

  if (kind === 'image') {
    return (
      <TouchableOpacity style={styles.mediaCard} onPress={open} activeOpacity={0.92}>
        <Image source={{ uri: url }} style={styles.imagePreview} resizeMode="cover" />
        <View style={styles.mediaFooter}>
          <Text style={styles.mediaFooterText} numberOfLines={1}>
            {item.label || 'Image'}
          </Text>
          <Text style={styles.mediaFooterHint}>Tap to view full</Text>
        </View>
      </TouchableOpacity>
    );
  }

  if (kind === 'video') {
    return (
      <TouchableOpacity style={styles.videoCard} onPress={open} activeOpacity={0.92}>
        <View style={styles.videoThumb}>
          <Video
            source={{ uri: url }}
            style={StyleSheet.absoluteFillObject}
            resizeMode={ResizeMode.COVER}
            shouldPlay={false}
            isMuted
            useNativeControls={false}
            pointerEvents="none"
          />
          <View style={styles.videoScrim} />
          <View style={styles.videoPlay}>
            <Ionicons name="play-circle" size={52} color="#fff" />
            <Text style={styles.videoPlayText}>Play video</Text>
            <Text style={styles.videoHint}>Fullscreen · landscape</Text>
          </View>
        </View>
        <View style={styles.videoFooter}>
          <Text style={styles.videoFooterTitle} numberOfLines={1}>
            {item.label || 'Video'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  if (kind === 'audio') {
    return <AudioPreviewCard url={url} label={item.label || 'Audio'} />;
  }

  if (kind === 'pdf' || /\.pdf(\?|$)/i.test(url) || /\/invoice(\?|$)/i.test(url)) {
    return (
      <TouchableOpacity style={styles.pdfCard} onPress={open} activeOpacity={0.9}>
        <View style={styles.pdfIcon}>
          <Ionicons name="document-text" size={28} color={BRAND_RED} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.pdfTitle} numberOfLines={2}>
            {item.label || 'PDF document'}
          </Text>
          <Text style={styles.pdfHint}>Open in PDF viewer</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
      </TouchableOpacity>
    );
  }

  if (isPlainLink) {
    return <LinkPreviewCard url={url} label={item.label} onOpen={open} />;
  }

  return (
    <TouchableOpacity style={styles.fileRow} onPress={open} activeOpacity={0.85}>
      <View style={styles.fileIcon}>
        <Ionicons name={item.icon || 'attach-outline'} size={18} color={BRAND_RED} />
      </View>
      <Text style={styles.fileLabel} numberOfLines={2}>
        {item.label || 'Attachment'}
      </Text>
      <Ionicons name="eye-outline" size={16} color="#94a3b8" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  mediaCard: {
    marginTop: 8,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  imagePreview: { width: '100%', height: 220, backgroundColor: '#1e293b' },
  mediaFooter: {
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  mediaFooterText: { flex: 1, fontWeight: '700', color: '#0f172a', fontSize: 13 },
  mediaFooterHint: { color: '#64748b', fontSize: 11, fontWeight: '600' },
  videoCard: {
    marginTop: 8,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  videoThumb: {
    height: 200,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  videoPlay: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    zIndex: 2,
  },
  videoPlayText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  videoHint: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600' },
  videoFooter: {
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  videoFooterTitle: { fontWeight: '700', color: '#0f172a', fontSize: 13 },
  pdfCard: {
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff7f7',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pdfIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#fee2e2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pdfTitle: { fontWeight: '800', color: '#0f172a', fontSize: 14 },
  pdfHint: { color: '#64748b', fontSize: 12, marginTop: 2, fontWeight: '600' },
  audioCard: {
    marginTop: 8,
    borderRadius: 999,
    backgroundColor: '#128c7e',
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  audioBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioLabel: { color: '#fff', fontWeight: '800', fontSize: 14 },
  audioTime: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },
  linkCard: {
    marginTop: 8,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  linkImage: { width: '100%', height: 140, backgroundColor: '#e2e8f0' },
  linkImageFallback: {
    height: 88,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkBody: { padding: 12, gap: 4 },
  linkHost: { color: '#64748b', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  linkTitle: { color: '#0f172a', fontSize: 15, fontWeight: '800' },
  linkDesc: { color: '#475569', fontSize: 13, lineHeight: 18 },
  linkUrl: { color: '#94a3b8', fontSize: 12 },
  linkCta: { marginTop: 6, color: BRAND_BLUE, fontWeight: '800', fontSize: 13 },
  fileRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
  },
  fileIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#fff1f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileLabel: { flex: 1, color: '#0f172a', fontWeight: '700', fontSize: 14 },
});
