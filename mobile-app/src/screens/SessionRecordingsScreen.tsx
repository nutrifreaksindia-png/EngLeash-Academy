import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';

const BRAND_RED = '#c41e3a';

type RecordingRow = {
  id: number;
  started_at?: string | null;
  stopped_at?: string | null;
  cdnUrls?: string[];
};

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function pickPlayableUrl(row: RecordingRow) {
  const urls = Array.isArray(row?.cdnUrls) ? row.cdnUrls.filter(Boolean) : [];
  const mp4 = urls.find((u) => /\.mp4(\?|$)/i.test(String(u)));
  if (mp4) return mp4;
  const hls = urls.find((u) => /\.m3u8(\?|$)/i.test(String(u)));
  return hls || urls[0] || null;
}

export default function SessionRecordingsScreen({ route, navigation }: any) {
  const liveSessionId = Number(route?.params?.liveSessionId || 0);
  const title = String(route?.params?.title || 'Session');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RecordingRow[]>([]);

  const load = useCallback(async () => {
    if (!liveSessionId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await api.get(`/live/sessions/${liveSessionId}/recordings`);
      setRows(Array.isArray(data?.recordings) ? data.recordings : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [liveSessionId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.root}>
      <ScreenPageTitle title={`Recordings - ${title}`} />
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={BRAND_RED} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {rows.length === 0 ? (
            <Text style={styles.empty}>No recordings available yet.</Text>
          ) : (
            rows.map((r, idx) => {
              const playUrl = pickPlayableUrl(r);
              const started = r.started_at ? formatTime(String(r.started_at)) : '—';
              const stopped = r.stopped_at ? formatTime(String(r.stopped_at)) : '—';
              return (
                <View key={r.id || idx} style={styles.card}>
                  <Text style={styles.meta}>Segment {idx + 1}</Text>
                  <Text style={styles.meta}>Started: {started}</Text>
                  <Text style={styles.meta}>Stopped: {stopped}</Text>
                  {playUrl ? (
                    <TouchableOpacity
                      style={styles.playBtn}
                      onPress={() =>
                        navigation.navigate('SessionRecordingPlayer', {
                          videoUrl: playUrl,
                          title: `${title} - Segment ${idx + 1}`,
                          allowDownload: false,
                        })
                      }
                    >
                      <Text style={styles.playText}>Play</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.empty}>No playable URL</Text>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 30 },
  empty: { color: '#666', textAlign: 'center', marginTop: 18 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#eee',
  },
  meta: { color: '#333', marginTop: 2, fontSize: 13 },
  playBtn: {
    marginTop: 10,
    backgroundColor: '#2e7d32',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  playText: { color: '#fff', fontWeight: '700' },
});
