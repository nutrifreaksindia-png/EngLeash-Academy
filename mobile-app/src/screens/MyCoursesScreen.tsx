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
import { joinOpensAtLabel, userMayJoinLiveSession } from '../utils/liveJoinWindow';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

type Course = { id: number; name: string; description?: string; my_schedule_hint?: string | null };
type Batch = { id: number; title?: string; name?: string; batch_status?: string; course_name?: string };
type TodaySession = {
  id: number;
  batch_id: number;
  session_day: number;
  lesson_title?: string;
  batch_title?: string;
  batch_name?: string;
  starts_at?: string;
  status?: string;
  live_session_id?: number | null;
  live_status?: string | null;
  live_starts_at?: string | null;
  live_ends_at?: string | null;
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
      const wantsToday = user.role === 'Student' || user.role === 'Lab' || user.role === 'Trainer';
      if (wantsToday) {
        const batchPromise =
          user.role === 'Student' || user.role === 'Lab' ? api.get('/batch-manager') : Promise.resolve([]);
        const [batchRows, todayRows] = await Promise.all([
          batchPromise,
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
      {user.role === 'Student' || user.role === 'Lab' ? (
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
        </View>
      ) : null}
      {user.role === 'Student' || user.role === 'Lab' || user.role === 'Trainer' ? (
        <View style={[styles.infoBox, user.role === 'Trainer' ? { marginTop: 12 } : null]}>
          <Text style={styles.infoTitle}>{user.role === 'Trainer' ? 'Today’s classes' : 'Today’s lesson shortcut'}</Text>
          {todaySessions.length === 0 ? (
            <Text style={styles.infoText}>No scheduled session today.</Text>
          ) : (
            todaySessions.map((s) => {
              const title = `Day ${s.session_day}: ${s.lesson_title || 'Session'}`;
              const liveStarts = s.live_starts_at || '';
              const liveEnds = s.live_ends_at || '';
              let canJoin = false;
              if (s.live_session_id && s.status !== 'cancelled' && s.live_status) {
                if (!liveStarts || !liveEnds) {
                  canJoin =
                    (user.role === 'Admin' || user.role === 'Trainer') &&
                    (s.live_status === 'scheduled' || s.live_status === 'live');
                } else {
                  canJoin = userMayJoinLiveSession({
                    userRole: user.role,
                    liveStatus: s.live_status,
                    startsAt: liveStarts,
                    endsAt: liveEnds,
                  });
                }
              }
              const showWaitHint =
                !canJoin &&
                (user.role === 'Student' || user.role === 'Lab') &&
                s.live_session_id &&
                s.live_status === 'scheduled' &&
                Boolean(liveStarts);
              return (
                <View key={s.id} style={styles.todayRow}>
                  <View style={styles.todayTextCol}>
                    <Text style={styles.todayTitle}>{title}</Text>
                    <Text style={styles.todaySub}>{s.batch_title || s.batch_name}</Text>
                    {s.status === 'cancelled' ? (
                      <Text style={styles.todayCancelled}>Cancelled</Text>
                    ) : null}
                    {showWaitHint ? (
                      <Text style={styles.todayHint}>{joinOpensAtLabel(liveStarts)}</Text>
                    ) : null}
                  </View>
                  {canJoin ? (
                    <TouchableOpacity
                      style={styles.todayJoinBtn}
                      onPress={() =>
                        navigation.getParent()?.getParent()?.navigate('MySessions', {
                          screen: 'LiveClassroom',
                          params: { liveSessionId: s.live_session_id!, title },
                        })
                      }
                    >
                      <Text style={styles.todayJoinText}>Join live</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.todayBrowseBtn}
                      onPress={() =>
                        navigation.getParent()?.getParent()?.navigate('MySessions', { screen: 'LiveSessions' })
                      }
                    >
                      <Text style={styles.todayBrowseText}>Sessions</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })
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
            {item.my_schedule_hint ? (
              <Text style={styles.cardScheduleHint}>{item.my_schedule_hint}</Text>
            ) : null}
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
  todayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  todayTextCol: { flex: 1, paddingRight: 10 },
  todayJoinBtn: {
    backgroundColor: BRAND_RED,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  todayJoinText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  todayBrowseBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BRAND_BLUE,
  },
  todayBrowseText: { color: BRAND_BLUE, fontWeight: '600', fontSize: 13 },
  todayCancelled: { color: '#999', fontSize: 12, marginTop: 4 },
  todayHint: { color: '#666', fontSize: 11, marginTop: 4, fontStyle: 'italic' },
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
  cardScheduleHint: { fontSize: 13, color: BRAND_BLUE, marginTop: 6, fontWeight: '600' },
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
