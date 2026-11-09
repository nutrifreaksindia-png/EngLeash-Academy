import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

type Filter = 'today' | 'overdue' | 'upcoming';

type Occurrence = {
  id: number;
  displayLabel?: string;
  batchName?: string;
  schedule_date?: string;
  due_at?: string;
  done?: boolean;
  library?: { response_type?: string; displayLabel?: string };
};

export default function MyAssignmentsScreen({ navigation }: any) {
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>('today');
  const [rows, setRows] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.get(`/assignments/my?filter=${encodeURIComponent(filter)}`);
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
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
        <ScreenPageTitle title="My Assignments" />
        <View style={styles.centered}>
          <Text style={styles.hint}>Sign in from Account to view assignments.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenPageTitle title="My Assignments" />
      <View style={styles.filters}>
        {(
          [
            { id: 'today', label: 'Today' },
            { id: 'overdue', label: 'Overdue' },
            { id: 'upcoming', label: 'Upcoming' },
          ] as const
        ).map((f) => (
          <TouchableOpacity
            key={f.id}
            style={[styles.chip, filter === f.id && styles.chipOn]}
            onPress={() => {
              setFilter(f.id);
              setLoading(true);
            }}
          >
            <Text style={[styles.chipText, filter === f.id && styles.chipTextOn]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
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
            <Text style={styles.empty}>
              {filter === 'today'
                ? 'No assignments due today.'
                : filter === 'overdue'
                  ? 'No overdue assignments.'
                  : 'No upcoming assignments.'}
            </Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() =>
                navigation.navigate('AssignmentOccurrence', {
                  occurrenceId: item.id,
                  title: item.displayLabel || item.library?.displayLabel || 'Assignment',
                })
              }
            >
              <Text style={styles.cardTitle}>
                {item.displayLabel || item.library?.displayLabel || `Assignment #${item.id}`}
              </Text>
              {item.batchName ? <Text style={styles.cardSub}>{item.batchName}</Text> : null}
              <Text style={styles.cardMeta}>
                {item.due_at ? `Due ${String(item.due_at).replace('T', ' ').slice(0, 16)}` : `Day ${item.schedule_date}`}
                {item.done ? ' · Done' : ''}
                {item.library?.response_type ? ` · ${item.library.response_type}` : ''}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: '#f8fafc' },
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  hint: { color: '#64748b', textAlign: 'center' },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
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
  list: { padding: 16, paddingTop: 4, gap: 10 },
  empty: { color: '#94a3b8', textAlign: 'center', marginTop: 40 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTitle: { fontSize: 16, fontWeight: '800', color: BRAND_BLUE },
  cardSub: { marginTop: 4, color: '#64748b', fontSize: 13 },
  cardMeta: { marginTop: 8, color: '#94a3b8', fontSize: 12, fontWeight: '600' },
});
