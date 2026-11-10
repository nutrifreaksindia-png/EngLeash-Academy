import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  formatAssignmentDue,
  listStatusChip,
  responseTypeIcon,
  responseTypeLabel,
} from '../lib/assignmentLabels';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';
const PAGE_BG = '#edf1fa';

type Filter = 'due_today' | 'overdue' | 'upcoming' | 'completed';

type Occurrence = {
  id: number;
  displayLabel?: string;
  batchName?: string;
  schedule_date?: string;
  due_at?: string;
  done?: boolean;
  library?: { response_type?: string; displayLabel?: string };
  submission?: {
    review_status?: string | null;
    score?: number | null;
    max_score?: number | null;
    feedback?: string | null;
  };
  max_score?: number | null;
};

type Counts = {
  due_today: number;
  overdue: number;
  upcoming: number;
  completed: number;
};

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'due_today', label: 'Due today' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'completed', label: 'Completed' },
];

export default function MyAssignmentsScreen({ navigation }: any) {
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>('due_today');
  const [rows, setRows] = useState<Occurrence[]>([]);
  const [counts, setCounts] = useState<Counts>({
    due_today: 0,
    overdue: 0,
    upcoming: 0,
    completed: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setError(null);
      const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
      // Load the active list + each bucket in parallel so the strip matches the tabs
      // (avoids a separate /counts call that can 404 on an old server and leave zeros).
      const [data, dueToday, overdue, upcoming, completed] = await Promise.all([
        api.get(`/assignments/my?filter=${encodeURIComponent(filter)}`),
        api.get('/assignments/my?filter=due_today'),
        api.get('/assignments/my?filter=overdue'),
        api.get('/assignments/my?filter=upcoming'),
        api.get('/assignments/my?filter=completed'),
      ]);
      setRows(Array.isArray(data) ? data : []);
      setCounts({
        due_today: len(dueToday),
        overdue: len(overdue),
        upcoming: len(upcoming),
        completed: len(completed),
      });
    } catch (e: any) {
      setRows([]);
      setError(e?.message || 'Could not load assignments.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, user]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      setLoading(true);
      void load();
    }, [load, user?.id]),
  );

  if (!user) {
    return (
      <View style={styles.pageRoot}>
        <View style={styles.centered}>
          <Text style={styles.hint}>Sign in from Account to view assignments.</Text>
        </View>
      </View>
    );
  }

  const emptyCopy =
    filter === 'due_today'
      ? 'Nothing open right now. Check Upcoming or Completed.'
      : filter === 'overdue'
        ? 'No overdue work. You are caught up.'
        : filter === 'upcoming'
          ? 'No upcoming assignments scheduled yet.'
          : 'No completed assignments yet.';

  return (
    <View style={styles.container}>
      <Text style={styles.countStrip}>
        Due today {counts.due_today} · Overdue {counts.overdue} · Upcoming {counts.upcoming} ·
        Completed {counts.completed}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filtersScroll}
        contentContainerStyle={styles.filters}
      >
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.id}
            style={[styles.chip, filter === f.id && styles.chipOn]}
            onPress={() => {
              setFilter(f.id);
              setLoading(true);
            }}
          >
            <Text style={[styles.chipText, filter === f.id && styles.chipTextOn]}>
              {f.label}
              {` (${counts[f.id]})`}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={36} color="#94a3b8" />
          <Text style={styles.errorTitle}>Couldn’t load</Text>
          <Text style={styles.hint}>{error}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => {
              setLoading(true);
              void load();
            }}
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          style={styles.listFlex}
          data={rows}
          keyExtractor={(item) => String(item.id)}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
            />
          }
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Ionicons name="checkbox-outline" size={28} color="#94a3b8" />
              <Text style={styles.emptyTitle}>{emptyCopy}</Text>
            </View>
          }
          renderItem={({ item }) => {
            const responseType = item.library?.response_type;
            const chip = listStatusChip({
              done: item.done,
              reviewStatus: item.submission?.review_status,
              score: item.submission?.score,
              dueAt: item.due_at,
              scheduleDate: item.schedule_date,
              filter,
            });
            const title =
              item.displayLabel || item.library?.displayLabel || `Assignment #${item.id}`;
            return (
              <TouchableOpacity
                style={styles.card}
                onPress={() =>
                  navigation.navigate('AssignmentOccurrence', {
                    occurrenceId: item.id,
                    title,
                  })
                }
                activeOpacity={0.88}
              >
                <View style={styles.cardTop}>
                  <View style={styles.typeIconWrap}>
                    <Ionicons
                      name={responseTypeIcon(responseType)}
                      size={22}
                      color={BRAND_RED}
                    />
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {title}
                    </Text>
                    {item.batchName ? (
                      <Text style={styles.cardSub} numberOfLines={1}>
                        {item.batchName}
                      </Text>
                    ) : null}
                    <Text style={styles.cardMeta}>
                      {formatAssignmentDue({
                        dueAt: item.due_at,
                        scheduleDate: item.schedule_date,
                      })}
                      {' · '}
                      {responseTypeLabel(responseType)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusChip,
                      chip.tone === 'danger' && styles.statusDanger,
                      chip.tone === 'warn' && styles.statusWarn,
                      chip.tone === 'info' && styles.statusInfo,
                      chip.tone === 'success' && styles.statusSuccess,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusChipText,
                        chip.tone === 'danger' && styles.statusTextDanger,
                        chip.tone === 'warn' && styles.statusTextWarn,
                        chip.tone === 'info' && styles.statusTextInfo,
                        chip.tone === 'success' && styles.statusTextSuccess,
                      ]}
                    >
                      {filter === 'completed'
                        ? chip.label === 'Graded'
                          ? 'Graded'
                          : 'Submitted'
                        : chip.label}
                    </Text>
                  </View>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color="#cbd5e1"
                  style={styles.cardChevron}
                />
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: PAGE_BG },
  container: { flex: 1, backgroundColor: PAGE_BG },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  hint: { color: '#64748b', textAlign: 'center', lineHeight: 20 },
  errorTitle: { fontSize: 16, fontWeight: '800', color: '#334155', marginTop: 4 },
  countStrip: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.2,
  },
  filtersScroll: { flexGrow: 0, maxHeight: 48 },
  filters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  chipOn: { backgroundColor: BRAND_RED, borderColor: BRAND_RED },
  chipText: { fontWeight: '700', color: '#64748b', fontSize: 13 },
  chipTextOn: { color: '#fff' },
  listFlex: { flex: 1 },
  list: { padding: 16, paddingTop: 4, paddingBottom: 32, gap: 10 },
  emptyCard: {
    marginTop: 24,
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e4ebf8',
    padding: 28,
    alignItems: 'center',
    gap: 10,
  },
  emptyTitle: { color: '#64748b', textAlign: 'center', fontSize: 14, lineHeight: 20, fontWeight: '600' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e4ebf8',
    shadowColor: BRAND_BLUE,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  typeIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#fff5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', letterSpacing: -0.2 },
  cardSub: { marginTop: 3, color: '#64748b', fontSize: 13, fontWeight: '600' },
  cardMeta: { marginTop: 8, color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  cardChevron: { position: 'absolute', right: 12, bottom: 14 },
  statusChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#eef2f7',
  },
  statusDanger: { backgroundColor: '#fee2e2' },
  statusWarn: { backgroundColor: '#ffedd5' },
  statusInfo: { backgroundColor: '#e0e7ff' },
  statusSuccess: { backgroundColor: '#dcfce7' },
  statusChipText: { fontSize: 11, fontWeight: '800', color: '#64748b' },
  statusTextDanger: { color: '#b91c1c' },
  statusTextWarn: { color: '#c2410c' },
  statusTextInfo: { color: BRAND_BLUE },
  statusTextSuccess: { color: '#15803d' },
  retryBtn: {
    marginTop: 10,
    backgroundColor: BRAND_RED,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  retryBtnText: { color: '#fff', fontWeight: '800' },
});
