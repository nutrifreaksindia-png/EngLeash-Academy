import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const BRAND_RED = '#c41e3a';

type Batch = { id: number; title?: string; name?: string; course_name?: string };

export default function MyAssignmentsScreen({ navigation }: any) {
  const { user } = useAuth();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const rows = await api.get('/batch-manager');
      setBatches(Array.isArray(rows) ? rows : []);
    } catch {
      setBatches([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      setLoading(true);
      load();
    }, [load, user?.id])
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

  if (loading) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title="My Assignments" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenPageTitle title="My Assignments" />
      <Text style={styles.sub}>Choose a batch to open its assignments.</Text>
      <FlatList style={styles.listFlex}
        data={batches}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No batches linked to your account yet.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('Assignment', { batchId: item.id })}
          >
            <Text style={styles.cardTitle}>{item.title || item.name}</Text>
            {item.course_name ? <Text style={styles.cardSub}>{item.course_name}</Text> : null}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, backgroundColor: '#f5f5f5', paddingTop: 0 },
  listFlex: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  hint: { color: '#666', textAlign: 'center' },
  sub: { fontSize: 14, color: '#555', paddingHorizontal: 20, marginTop: 4, marginBottom: 12 },
  list: { padding: 20, paddingBottom: 40 },
  empty: { color: '#666', textAlign: 'center', paddingVertical: 32 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: BRAND_RED,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#222' },
  cardSub: { fontSize: 14, color: '#666', marginTop: 4 },
});
