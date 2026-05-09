import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
  session_day?: number | null;
  session_date?: string | null;
  cancellation_reason?: string | null;
  starts_at: string;
  ends_at: string;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  batch_name: string;
  session_type: 'group' | 'one_to_one';
  trainer_name: string;
  /** Present when session ended and a recording is available (API enrich). */
  recordingPlaybackUrl?: string | null;
};

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDateFriendly(value?: string | null) {
  if (!value) return '—';
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusBadgeStyle(status: LiveSession['status']) {
  if (status === 'live') return styles.badgeLive;
  if (status === 'ended') return styles.badgeEnded;
  if (status === 'cancelled') return styles.badgeCancelled;
  return styles.badgeScheduled;
}

function statusLabel(status: LiveSession['status']) {
  if (status === 'cancelled') return 'CANCELLED';
  return status.toUpperCase();
}

export default function LiveSessionsScreen({ navigation }: any) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [timePulse, setTimePulse] = useState(0);

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
          const canJoin =
            item.status !== 'cancelled' &&
            userMayJoinLiveSession({
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
          const cancelled = item.status === 'cancelled';
          const headlineDate = formatDateFriendly(item.session_date ?? item.starts_at);
          const titleText = cancelled
            ? headlineDate
            : Number.isFinite(Number(item.session_day))
              ? `Day ${String(Number(item.session_day)).padStart(2, '0')}`
              : item.title?.trim() || headlineDate;

          const reason = (item.cancellation_reason || '').trim();

          return (
            <View style={styles.card}>
              <TouchableOpacity
                activeOpacity={canJoin ? 0.85 : 1}
                disabled={!canJoin}
                onPress={() =>
                  canJoin ? navigation.navigate('LiveClassroom', { liveSessionId: item.id, title: titleText }) : undefined
                }
              >
                <View style={styles.row}>
                  <Text style={styles.title}>{titleText}</Text>
                  <Text style={[styles.badge, statusBadgeStyle(item.status)]}>{statusLabel(item.status)}</Text>
                </View>
                {cancelled ? (
                  <>
                    {reason ? <Text style={styles.reasonLabel}>Reason</Text> : null}
                    {reason ? <Text style={styles.reasonText}>{reason}</Text> : null}
                  </>
                ) : (
                  <>
                    <Text style={styles.meta}>{item.batch_name} ({item.session_type === 'group' ? 'Group' : '1:1'})</Text>
                    <Text style={styles.meta}>Trainer: {item.trainer_name}</Text>
                    <Text style={styles.meta}>Starts: {formatTime(item.starts_at)}</Text>
                    <Text style={styles.meta}>Ends: {formatTime(item.ends_at)}</Text>
                  </>
                )}
                {showWaitHint ? (
                  <Text style={styles.hint}>{joinOpensAtLabel(item.starts_at)}</Text>
                ) : null}
              </TouchableOpacity>
              {showPlayRecording ? (
                <TouchableOpacity
                  style={styles.playBtn}
                  onPress={() =>
                    navigation.navigate('SessionRecordings', {
                      liveSessionId: item.id,
                      title: titleText,
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Play recording"
                >
                  <Text style={styles.playBtnText}>Play recording(s)</Text>
                </TouchableOpacity>
              ) : (
                <View style={[styles.joinBtn, !canJoin && styles.joinBtnDisabled]}>
                  <Text style={styles.joinBtnText}>
                    {canJoin
                      ? 'Join class'
                      : item.status === 'cancelled'
                        ? 'Cancelled'
                        : item.status === 'ended'
                          ? 'Ended'
                          : 'Not yet'}
                  </Text>
                </View>
              )}
            </View>
          );
        }}
      />
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
  badgeEnded: { backgroundColor: '#757575' },
  badgeCancelled: { backgroundColor: '#424242' },
  meta: { fontSize: 13, color: '#666', marginTop: 2 },
  reasonLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    marginTop: 6,
    letterSpacing: 0.6,
  },
  reasonText: { fontSize: 14, color: '#444', marginTop: 4, lineHeight: 20 },
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
});
