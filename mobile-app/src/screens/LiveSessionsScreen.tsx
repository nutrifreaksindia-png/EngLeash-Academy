import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { joinOpensAtLabel, userMayJoinLiveSession } from '../utils/liveJoinWindow';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

type LiveSession = {
  id: number;
  batch_id: number;
  title: string;
  starts_at: string;
  ends_at: string;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  batch_name: string;
  session_type: 'group' | 'one_to_one';
  trainer_name: string;
  /** Present when session ended and a recording is available (API enrich). */
  recordingPlaybackUrl?: string | null;
};

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

export default function LiveSessionsScreen({ navigation }: any) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [timePulse, setTimePulse] = useState(0);
  const [recordingsOpen, setRecordingsOpen] = useState(false);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [recordingsTitle, setRecordingsTitle] = useState('');
  const [recordingRows, setRecordingRows] = useState<RecordingRow[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/live/sessions');
      setSessions(Array.isArray(data) ? data : []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      setRefreshing(true);
      load();
    }, [load])
  );

  async function openRecordings(item: LiveSession) {
    setRecordingsTitle(item.title || 'Session');
    setRecordingRows([]);
    setRecordingsOpen(true);
    setRecordingsLoading(true);
    try {
      const data = await api.get(`/live/sessions/${item.id}/recordings`);
      setRecordingRows(Array.isArray(data?.recordings) ? data.recordings : []);
    } catch {
      setRecordingRows([]);
    } finally {
      setRecordingsLoading(false);
    }
  }

  function pickPlayableUrl(row: RecordingRow) {
    const urls = Array.isArray(row?.cdnUrls) ? row.cdnUrls.filter(Boolean) : [];
    const mp4 = urls.find((u) => /\.mp4(\?|$)/i.test(String(u)));
    if (mp4) return mp4;
    const hls = urls.find((u) => /\.m3u8(\?|$)/i.test(String(u)));
    return hls || urls[0] || null;
  }

  useFocusEffect(
    useCallback(() => {
      const pulseTimer = setInterval(() => {
        setTimePulse((v) => v + 1);
      }, 15000);

      const now = Date.now();
      const candidates: number[] = [];
      for (const s of sessions) {
        const startMs = new Date(s.starts_at).getTime();
        const endMs = new Date(s.ends_at).getTime();
        if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
        if (s.status !== 'scheduled' && s.status !== 'live') continue;
        const openAt = startMs - 5 * 60 * 1000;
        if (openAt > now) candidates.push(openAt);
        if (endMs > now) candidates.push(endMs);
      }
      const nextBoundary = candidates.length > 0 ? Math.min(...candidates) : null;
      const boundaryTimer =
        nextBoundary != null
          ? setTimeout(() => {
              setRefreshing(true);
              load();
            }, Math.max(0, nextBoundary - Date.now()) + 50)
          : null;

      return () => {
        clearInterval(pulseTimer);
        if (boundaryTimer) clearTimeout(boundaryTimer);
      };
    }, [sessions, load])
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenPageTitle title="My Sessions" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenPageTitle title="My Sessions" />
      <FlatList style={styles.listFlex}
        extraData={timePulse}
        data={sessions}
        keyExtractor={(item) => String(item.id)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No live sessions available yet.</Text>}
        renderItem={({ item }) => {
          const canJoin = userMayJoinLiveSession({
            userRole: user?.role,
            liveStatus: item.status,
            startsAt: item.starts_at,
            endsAt: item.ends_at,
          });
          const showWaitHint =
            !canJoin &&
            (user?.role === 'Student' || user?.role === 'Lab') &&
            item.status === 'scheduled';
          const showPlayRecording =
            item.status === 'ended' &&
            typeof item.recordingPlaybackUrl === 'string' &&
            item.recordingPlaybackUrl.length > 0;
          return (
            <View style={styles.card}>
              <TouchableOpacity
                activeOpacity={canJoin ? 0.85 : 1}
                disabled={!canJoin}
                onPress={() =>
                  canJoin ? navigation.navigate('LiveClassroom', { liveSessionId: item.id, title: item.title }) : undefined
                }
              >
                <View style={styles.row}>
                  <Text style={styles.title}>{item.title}</Text>
                  <Text style={[styles.badge, item.status === 'live' ? styles.badgeLive : styles.badgeScheduled]}>
                    {item.status.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.meta}>{item.batch_name} ({item.session_type === 'group' ? 'Group' : '1:1'})</Text>
                <Text style={styles.meta}>Trainer: {item.trainer_name}</Text>
                <Text style={styles.meta}>Starts: {formatTime(item.starts_at)}</Text>
                <Text style={styles.meta}>Ends: {formatTime(item.ends_at)}</Text>
                {showWaitHint ? (
                  <Text style={styles.hint}>{joinOpensAtLabel(item.starts_at)}</Text>
                ) : null}
              </TouchableOpacity>
              {showPlayRecording ? (
                <TouchableOpacity
                  style={styles.playBtn}
                  onPress={() => openRecordings(item)}
                  accessibilityRole="button"
                  accessibilityLabel="Play recording"
                >
                  <Text style={styles.playBtnText}>Play recording(s)</Text>
                </TouchableOpacity>
              ) : (
                <View style={[styles.joinBtn, !canJoin && styles.joinBtnDisabled]}>
                  <Text style={styles.joinBtnText}>
                    {canJoin ? 'Join class' : item.status === 'ended' || item.status === 'cancelled' ? 'Ended' : 'Not yet'}
                  </Text>
                </View>
              )}
            </View>
          );
        }}
      />

      <Modal visible={recordingsOpen} transparent animationType="fade" onRequestClose={() => setRecordingsOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Recordings - {recordingsTitle}</Text>
            {recordingsLoading ? (
              <ActivityIndicator color={BRAND_RED} />
            ) : (
              <ScrollView style={styles.modalScroll}>
                {recordingRows.length === 0 ? (
                  <Text style={styles.empty}>No recordings available yet.</Text>
                ) : (
                  recordingRows.map((r, idx) => {
                    const playUrl = pickPlayableUrl(r);
                    const started = r.started_at ? formatTime(String(r.started_at)) : '—';
                    const stopped = r.stopped_at ? formatTime(String(r.stopped_at)) : '—';
                    return (
                      <View key={r.id || idx} style={styles.recordingRow}>
                        <Text style={styles.meta}>Segment {idx + 1}</Text>
                        <Text style={styles.meta}>Started: {started}</Text>
                        <Text style={styles.meta}>Stopped: {stopped}</Text>
                        {playUrl ? (
                          <TouchableOpacity
                            style={styles.playBtn}
                            onPress={() =>
                              navigation.navigate('SessionRecordingPlayer', {
                                videoUrl: playUrl,
                                title: `${recordingsTitle} - Segment ${idx + 1}`,
                                allowDownload: false,
                              })
                            }
                          >
                            <Text style={styles.playBtnText}>Play</Text>
                          </TouchableOpacity>
                        ) : (
                          <Text style={styles.hint}>No playable URL</Text>
                        )}
                      </View>
                    );
                  })
                )}
              </ScrollView>
            )}
            <TouchableOpacity style={[styles.joinBtn, styles.modalCloseBtn]} onPress={() => setRecordingsOpen(false)}>
              <Text style={styles.joinBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  listFlex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 20, paddingBottom: 32 },
  empty: { textAlign: 'center', color: '#666', marginTop: 40 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: BRAND_BLUE,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 6, alignItems: 'center' },
  title: { flex: 1, fontSize: 17, fontWeight: '700', color: '#333' },
  badge: { color: '#fff', borderRadius: 999, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 4, fontSize: 11, fontWeight: '700' },
  badgeLive: { backgroundColor: '#2e7d32' },
  badgeScheduled: { backgroundColor: BRAND_RED },
  meta: { fontSize: 13, color: '#666', marginTop: 2 },
  joinBtn: {
    marginTop: 12,
    backgroundColor: BRAND_BLUE,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  joinBtnDisabled: {
    backgroundColor: '#9e9e9e',
  },
  joinBtnText: { color: '#fff', fontWeight: '700' },
  playBtn: {
    marginTop: 12,
    backgroundColor: '#2e7d32',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  playBtnText: { color: '#fff', fontWeight: '700' },
  hint: { fontSize: 12, color: '#666', marginTop: 6, fontStyle: 'italic' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    maxHeight: '80%',
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#222', marginBottom: 10 },
  modalScroll: { maxHeight: 420 },
  recordingRow: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  modalCloseBtn: { marginTop: 6 },
});
