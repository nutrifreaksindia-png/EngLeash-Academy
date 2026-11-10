import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Audio } from 'expo-av';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { detectMediaKind, type MediaKind } from '../lib/openMedia';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

/** Safe load — missing native binary must not crash the whole app at import time. */
let WebView: any = null;
let webViewLoadError: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  WebView = require('react-native-webview').WebView;
} catch (e: any) {
  webViewLoadError = e?.message || 'WebView native module is unavailable';
}

type Params = {
  url: string;
  title?: string;
  kind?: MediaKind;
  mimeType?: string | null;
};

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  // btoa available in RN Hermes
  return globalThis.btoa(binary);
}

function pdfJsHtml(base64: string): string {
  // Keep HTML free of template-injection by embedding base64 as a JS string carefully.
  const safe = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=4" />
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <style>
    html, body { margin: 0; padding: 0; background: #525659; }
    #pages { padding: 8px 0 24px; }
    canvas { display: block; margin: 8px auto; max-width: 100%; height: auto; box-shadow: 0 1px 4px rgba(0,0,0,.35); background: #fff; }
    #err { color: #fecaca; padding: 24px; font: 14px/1.4 -apple-system, sans-serif; text-align: center; }
  </style>
</head>
<body>
  <div id="pages"></div>
  <div id="err" hidden></div>
  <script>
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    function showErr(msg) {
      var el = document.getElementById('err');
      el.hidden = false;
      el.textContent = msg || 'Could not open PDF.';
    }
    try {
      var b64 = '${safe}';
      var raw = atob(b64);
      var bytes = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      pdfjsLib.getDocument({ data: bytes }).promise.then(function (pdf) {
        var root = document.getElementById('pages');
        var scale = Math.min(2, Math.max(1.1, (window.innerWidth - 16) / 600));
        function renderPage(n) {
          return pdf.getPage(n).then(function (page) {
            var viewport = page.getViewport({ scale: scale });
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            root.appendChild(canvas);
            return page.render({ canvasContext: ctx, viewport: viewport }).promise;
          });
        }
        var chain = Promise.resolve();
        for (var p = 1; p <= pdf.numPages; p++) {
          (function (pageNum) {
            chain = chain.then(function () { return renderPage(pageNum); });
          })(p);
        }
        return chain;
      }).catch(function (e) {
        showErr((e && e.message) || 'Could not open PDF.');
      });
    } catch (e) {
      showErr((e && e.message) || 'Could not open PDF.');
    }
  </script>
</body>
</html>`;
}

export default function MediaViewerScreen({ route, navigation }: any) {
  const params = (route?.params || {}) as Params;
  const url = String(params.url || '').trim();
  const kind = params.kind || detectMediaKind({ url, mimeType: params.mimeType });
  const title = params.title || 'Viewer';
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfHtml, setPdfHtml] = useState<string | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    navigation.setOptions?.({ title });
  }, [navigation, title]);

  useEffect(() => {
    if (kind !== 'video' || !url) return;
    const params = { videoUrl: url, title, allowDownload: false };
    try {
      const names: string[] = navigation?.getState?.()?.routeNames || [];
      if (names.includes('VideoPlayer') && typeof navigation.replace === 'function') {
        navigation.replace('VideoPlayer', params);
        return;
      }
      if (names.includes('SessionRecordingPlayer') && typeof navigation.replace === 'function') {
        navigation.replace('SessionRecordingPlayer', params);
        return;
      }
      navigation.navigate('VideoPlayer', params);
    } catch {
      /* keep inline fallback */
    }
  }, [kind, navigation, title, url]);

  useEffect(() => {
    let cancelled = false;
    async function loadPdf() {
      if (kind !== 'pdf' && kind !== 'file') return;
      if (kind === 'file' && !/\.pdf(\?|$)/i.test(url) && !/\/invoice(\?|$)/i.test(url)) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not load document (${res.status})`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        const b64 = bytesToBase64(new Uint8Array(buf));
        setPdfHtml(pdfJsHtml(b64));
        setLoading(false);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Could not load document.');
          setLoading(false);
        }
      }
    }
    void loadPdf();
    return () => {
      cancelled = true;
    };
  }, [kind, url]);

  useEffect(() => {
    let cancelled = false;
    async function loadAudio() {
      if (kind !== 'audio' || !url) return;
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
        if (cancelled) {
          await sound.unloadAsync();
          return;
        }
        soundRef.current = sound;
        setAudioPlaying(true);
        setLoading(false);
        sound.setOnPlaybackStatusUpdate((st) => {
          if (!st.isLoaded) return;
          setAudioPlaying(!!st.isPlaying);
          if (st.didJustFinish) setAudioPlaying(false);
        });
      } catch (e: any) {
        setError(e?.message || 'Could not play audio.');
        setLoading(false);
      }
    }
    void loadAudio();
    return () => {
      cancelled = true;
      const s = soundRef.current;
      soundRef.current = null;
      if (s) void s.unloadAsync();
    };
  }, [kind, url]);

  const showPdfWebView = useMemo(
    () => (kind === 'pdf' || (kind === 'file' && (/\/invoice(\?|$)/i.test(url) || /\.pdf(\?|$)/i.test(url)))) && pdfHtml,
    [kind, url, pdfHtml],
  );

  if (!url) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Nothing to open.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (kind === 'image') {
    return (
      <View style={[styles.rootDark, { paddingBottom: insets.bottom }]}>
        {loading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
          </View>
        ) : null}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.imageZoomContent}
          maximumZoomScale={4}
          minimumZoomScale={1}
          centerContent
          bouncesZoom
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
        >
          <Image
            source={{ uri: url }}
            style={{ width, height: Math.max(240, height - insets.top - insets.bottom - 24), resizeMode: 'contain' }}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError('Could not load image.');
            }}
          />
        </ScrollView>
        <Text style={styles.zoomHint}>Pinch to zoom</Text>
        {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
      </View>
    );
  }

  // Videos redirect to VideoPlayer; keep a short fallback while navigating.
  if (kind === 'video') {
    return (
      <View style={[styles.root, styles.videoRoot, { paddingBottom: insets.bottom }]}>
        <ActivityIndicator size="large" color="#fff" />
        <Text style={{ color: '#fff', marginTop: 12, fontWeight: '600' }}>Opening player…</Text>
        {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
      </View>
    );
  }

  if (kind === 'audio') {
    return (
      <View style={[styles.centered, { paddingBottom: insets.bottom }]}>
        <Ionicons name="musical-notes" size={56} color={BRAND_RED} />
        <Text style={styles.audioTitle}>{title}</Text>
        {loading ? <ActivityIndicator color={BRAND_RED} style={{ marginTop: 16 }} /> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {!loading && !error ? (
          <TouchableOpacity
            style={styles.playBtn}
            onPress={async () => {
              const s = soundRef.current;
              if (!s) return;
              const st = await s.getStatusAsync();
              if (st.isLoaded && st.isPlaying) await s.pauseAsync();
              else if (st.isLoaded) await s.playAsync();
            }}
          >
            <Ionicons name={audioPlaying ? 'pause' : 'play'} size={22} color="#fff" />
            <Text style={styles.playBtnText}>{audioPlaying ? 'Pause' : 'Play'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  // PDF / invoice / unknown file that looks like PDF
  if (kind === 'pdf' || showPdfWebView || /\/invoice(\?|$)/i.test(url) || /\.pdf(\?|$)/i.test(url)) {
    if (!WebView) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>
            {webViewLoadError || 'PDF viewer needs a native rebuild (react-native-webview).'}
          </Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.backBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={[styles.rootLight, { paddingBottom: insets.bottom }]}>
        {loading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={BRAND_RED} />
          </View>
        ) : null}
        {error ? (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
          </View>
        ) : pdfHtml ? (
          <WebView
            originWhitelist={['*']}
            source={{ html: pdfHtml, baseUrl: 'https://cdnjs.cloudflare.com' }}
            style={styles.webview}
            onLoadEnd={() => setLoading(false)}
            setSupportMultipleWindows={false}
            javaScriptEnabled
            allowFileAccess
            mixedContentMode="always"
          />
        ) : null}
      </View>
    );
  }

  // Generic file — try WebView page load (may still work for some types)
  if (!WebView) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>
          {webViewLoadError || 'This file type needs a native rebuild (react-native-webview).'}
        </Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <View style={[styles.rootLight, { paddingBottom: insets.bottom }]}>
      <WebView
        source={{ uri: url }}
        style={styles.webview}
        onLoadEnd={() => setLoading(false)}
        onError={() => setError('Could not open this file in the app.')}
        setSupportMultipleWindows={false}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
      />
      {loading ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      ) : null}
      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  rootLight: { flex: 1, backgroundColor: '#f1f5f9' },
  rootDark: { flex: 1, backgroundColor: '#000' },
  imageZoomContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  zoomHint: {
    position: 'absolute',
    bottom: 28,
    alignSelf: 'center',
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '600',
  },
  videoRoot: { backgroundColor: '#000', justifyContent: 'center' },
  webview: { flex: 1, backgroundColor: '#525659' },
  video: { width: '100%', height: '100%' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#edf1fa',
    padding: 24,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    backgroundColor: 'rgba(15,23,42,0.2)',
  },
  errorText: { color: '#b91c1c', marginTop: 12, textAlign: 'center' },
  errorBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 24,
    backgroundColor: '#7f1d1d',
    color: '#fff',
    padding: 10,
    borderRadius: 8,
    overflow: 'hidden',
    textAlign: 'center',
  },
  backBtn: {
    marginTop: 16,
    backgroundColor: BRAND_RED,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backBtnText: { color: '#fff', fontWeight: '700' },
  audioTitle: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '700',
    color: BRAND_BLUE,
    textAlign: 'center',
  },
  playBtn: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: BRAND_RED,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
  },
  playBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
