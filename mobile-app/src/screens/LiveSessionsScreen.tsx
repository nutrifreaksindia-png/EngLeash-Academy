import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
          return (
            <TouchableOpacity
              style={styles.card}
              disabled={!canJoin}
              onPress={() => navigation.navigate('LiveClassroom', { liveSessionId: item.id, title: item.title })}
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
              <View style={[styles.joinBtn, !canJoin && styles.joinBtnDisabled]}>
                <Text style={styles.joinBtnText}>
                  {canJoin ? 'Join class' : item.status === 'ended' || item.status === 'cancelled' ? 'Ended' : 'Not yet'}
                </Text>
              </View>
            </TouchableOpacity>
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
  hint: { fontSize: 12, color: '#666', marginTop: 6, fontStyle: 'italic' },
});
