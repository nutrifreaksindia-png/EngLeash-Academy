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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

type Course = { id: number; name: string; description?: string };
type Batch = { id: number; title?: string; name?: string; batch_status?: string; course_name?: string };
type TodaySession = {
  id: number;
  batch_id: number;
  session_day: number;
  lesson_title?: string;
  batch_title?: string;
  batch_name?: string;
  starts_at?: string;
};

export default function MyCoursesScreen({ navigation }: any) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [courses, setCourses] = useState<Course[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [todaySessions, setTodaySessions] = useState<TodaySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.get('/courses');
      setCourses(Array.isArray(data) ? data : []);
      if (user.role === 'Student' || user.role === 'Lab') {
        const [batchRows, todayRows] = await Promise.all([
          api.get('/batch-manager'),
          api.get('/batch-manager/my/today'),
        ]);
        setBatches(Array.isArray(batchRows) ? batchRows : []);
        setTodaySessions(Array.isArray(todayRows) ? todayRows : []);
      } else {
        setBatches([]);
        setTodaySessions([]);
      }
    } catch {
      setCourses([]);
      setBatches([]);
      setTodaySessions([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      load();
    }, [load, user?.id])
  );

  if (!user) {
    return (
      <View style={styles.container}>
        <ScreenPageTitle title="My Courses" />
        <View style={styles.centered}>
          <Text style={styles.guestHint}>Open My Account to sign in.</Text>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenPageTitle title="My Courses" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenPageTitle title="My Courses" />
      <Text style={styles.greeting}>Hello, {user.name || user.email}</Text>
      {(user.role === 'Student' || user.role === 'Lab') ? (
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>My Batches</Text>
          {batches.length === 0 ? (
            <Text style={styles.infoText}>No approved batch assigned yet.</Text>
          ) : (
            batches.map((b) => (
              <View key={b.id} style={styles.batchRow}>
                <Text style={styles.infoText}>{b.title || b.name}</Text>
                <TouchableOpacity
                  style={styles.assignmentMiniBtn}
                  onPress={() =>
                    navigation.getParent()?.getParent()?.navigate('MyAssignments', {
                      screen: 'Assignment',
                      params: { batchId: b.id },
                    })
                  }
                >
                  <Text style={styles.assignmentMiniText}>Assignments</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
          <Text style={[styles.infoTitle, { marginTop: 10 }]}>Today’s lesson shortcut</Text>
          {todaySessions.length === 0 ? (
            <Text style={styles.infoText}>No scheduled session today.</Text>
          ) : (
            todaySessions.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={styles.todayShortcut}
                onPress={() => navigation.getParent()?.getParent()?.navigate('MySessions', { screen: 'LiveSessions' })}
              >
                <Text style={styles.todayTitle}>
                  Day {s.session_day}: {s.lesson_title || 'Session'}
                </Text>
                <Text style={styles.todaySub}>{s.batch_title || s.batch_name}</Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      ) : null}
      <FlatList
        style={styles.listFlex}
        data={courses}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        contentContainerStyle={[styles.list, { paddingBottom: 200 + insets.bottom }]}
        ListEmptyComponent={<Text style={styles.empty}>No enrolled courses. Browse the catalog to enroll.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('CourseDetail', { courseId: item.id, courseName: item.name })}
          >
            <Text style={styles.cardTitle}>{item.name}</Text>
            {item.description ? <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text> : null}
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity
        style={[styles.catalogBtn, { bottom: 16 + insets.bottom }]}
        onPress={() => navigation.navigate('CourseCatalog')}
      >
        <Text style={styles.catalogBtnText}>Browse course catalog</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.liveBtn, { bottom: 70 + insets.bottom }]}
        onPress={() => navigation.getParent()?.getParent()?.navigate('MySessions', { screen: 'LiveSessions' })}
      >
        <Text style={styles.liveBtnText}>Join live classes</Text>
      </TouchableOpacity>
      {(user.role === 'Trainer' || user.role === 'Admin') ? (
        <TouchableOpacity
          style={[styles.scheduleBtn, { bottom: 124 + insets.bottom }]}
          onPress={() => navigation.getParent()?.getParent()?.navigate('MySessions', { screen: 'LiveSchedule' })}
        >
          <Text style={styles.scheduleBtnText}>Schedule live</Text>
        </TouchableOpacity>
      ) : null}
      {user.role === 'Admin' ? (
        <TouchableOpacity
          style={[styles.manageBtn, { bottom: 178 + insets.bottom }]}
          onPress={() => navigation.navigate('AdminCourseManager')}
        >
          <Text style={styles.manageBtnText}>Manage courses</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  listFlex: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  guestHint: { color: '#666', textAlign: 'center', fontSize: 16 },
  greeting: { fontSize: 18, color: BRAND_BLUE, paddingHorizontal: 20, paddingTop: 16, fontWeight: '600' },
  list: { padding: 20, paddingTop: 8, paddingBottom: 220 },
  infoBox: {
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 4,
    borderLeftColor: BRAND_RED,
  },
  infoTitle: { fontSize: 15, fontWeight: '700', color: BRAND_BLUE },
  infoText: { color: '#444', marginTop: 6 },
  batchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  assignmentMiniBtn: { backgroundColor: BRAND_BLUE, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 },
  assignmentMiniText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  todayShortcut: {
    backgroundColor: '#eef2ff',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
  },
  todayTitle: { color: '#222', fontWeight: '700' },
  todaySub: { color: '#555', marginTop: 3 },
  empty: { color: '#666', textAlign: 'center', paddingVertical: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: BRAND_RED,
  },
  cardTitle: { fontSize: 17, fontWeight: '600', color: '#333' },
  cardDesc: { fontSize: 14, color: '#666', marginTop: 4 },
  catalogBtn: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    backgroundColor: BRAND_BLUE,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  catalogBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  liveBtn: {
    position: 'absolute',
    left: 20,
    right: 20,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: BRAND_BLUE,
    backgroundColor: '#fff',
  },
  liveBtnText: {
    color: BRAND_BLUE,
    fontSize: 15,
    fontWeight: '700',
  },
  scheduleBtn: {
    position: 'absolute',
    left: 20,
    right: 20,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: BRAND_BLUE,
  },
  scheduleBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  manageBtn: {
    position: 'absolute',
    left: 20,
    right: 20,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#283593',
  },
  manageBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
