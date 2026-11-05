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
import { api } from '../api/client';
import { BrandedTopBar } from '../components/BrandedTopBar';
import { useAuth } from '../context/AuthContext';
import { computeCourseProgressPercent } from '../lib/learnProgress';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

type Course = {
  id: number;
  name: string;
  description?: string;
  my_schedule_hint?: string | null;
};
type LessonRow = {
  id: number;
  title?: string;
  sort_order?: number;
  contentSummary?: { type: string; id: number; title?: string; orderIndex?: number; quizAssignmentId?: number | null }[];
};

type CourseEnriched = Course & {
  lessonIds: number[];
  progressPercent: number;
  hasLessons: boolean;
};

function fallbackEnriched(c: Course): CourseEnriched {
  return {
    ...c,
    lessonIds: [],
    progressPercent: 0,
    hasLessons: false,
  };
}

async function enrichCourse(userId: number, c: Course): Promise<CourseEnriched> {
  let lessonsRaw: LessonRow[];
  try {
    const raw = await api.get(`/lessons/course/${c.id}`);
    lessonsRaw = Array.isArray(raw) ? raw : [];
  } catch {
    lessonsRaw = [];
  }

  const sorted = [...lessonsRaw].sort(
    (a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0),
  );
  const lessonIds = sorted.map((l) => l.id);
  const progressPercent = await computeCourseProgressPercent(userId, c.id, sorted);

  return {
    ...c,
    lessonIds,
    progressPercent,
    hasLessons: lessonIds.length > 0,
  };
}

export default function MyCoursesScreen({ navigation, route }: any) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [courses, setCourses] = useState<CourseEnriched[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterCourseId, setFilterCourseId] = useState<number | null>(null);
  const [filterCourseName, setFilterCourseName] = useState('');

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const data = await api.get('/courses');
      const rows = Array.isArray(data) ? data : [];
      const enriched = await Promise.all(
        rows.map(async (c: Course) => {
          try {
            return await enrichCourse(user.id, c);
          } catch {
            return fallbackEnriched(c);
          }
        }),
      );
      setCourses(enriched);
    } catch {
      setCourses([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      void load();
    }, [load, user?.id]),
  );

  useFocusEffect(
    useCallback(() => {
      const rawId = route.params?.focusCourseId;
      if (rawId == null) return;
      const nextId = Number(rawId);
      if (!Number.isFinite(nextId)) return;
      setFilterCourseId(nextId);
      setFilterCourseName(String(route.params?.focusCourseName || ''));
      navigation.setParams({
        focusCourseId: undefined,
        focusCourseName: undefined,
      });
    }, [navigation, route.params?.focusCourseId, route.params?.focusCourseName]),
  );

  if (!user) {
    return (
      <View style={styles.shell}>
        <BrandedTopBar />
        <View style={[styles.centered, { paddingBottom: insets.bottom }]}>
          <Text style={styles.guestHint}>Open My Account to sign in.</Text>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.shell}>
        <BrandedTopBar />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      </View>
    );
  }

  const scheduleFabBottom = 20 + insets.bottom;
  const manageFabBottom = user.role === 'Admin' ? 82 + insets.bottom : scheduleFabBottom;
  const visibleCourses =
    filterCourseId == null ? courses : courses.filter((course) => course.id === filterCourseId);

  return (
    <View style={[styles.shell, { paddingBottom: insets.bottom }]}>
      <BrandedTopBar />
      <FlatList
        style={styles.listFlex}
        data={visibleCourses}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
        contentContainerStyle={[styles.list, { paddingBottom: 100 + insets.bottom }]}
        ListHeaderComponent={
          filterCourseId != null ? (
            <View style={styles.filterBanner}>
              <View style={styles.filterCopy}>
                <Text style={styles.filterLabel}>Showing selected course</Text>
                <Text style={styles.filterName} numberOfLines={1}>
                  {filterCourseName || 'Active course'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.filterClearBtn}
                onPress={() => {
                  setFilterCourseId(null);
                  setFilterCourseName('');
                }}
              >
                <Text style={styles.filterClearText}>Show all</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {filterCourseId != null
              ? 'This course is not currently active in My Courses.'
              : 'No enrolled courses yet. Explore and enroll from the Home tab.'}
          </Text>
        }
        renderItem={({ item }) => {
          const canLearn = item.hasLessons;
          const barW = Math.min(100, Math.max(0, item.progressPercent));
          return (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              {!canLearn ? (
                <Text style={styles.lessonCueMuted}>No lessons available yet.</Text>
              ) : null}
              {item.my_schedule_hint ? (
                <Text style={styles.scheduleHint}>{item.my_schedule_hint}</Text>
              ) : null}
              {item.description ? (
                <Text style={styles.cardDesc} numberOfLines={2}>
                  {item.description}
                </Text>
              ) : null}
              <View style={styles.progressRow}>
                <Text style={styles.progressLabel}>Progress</Text>
                <Text style={styles.progressPct}>{item.progressPercent}%</Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${barW}%` }]} />
              </View>
              <TouchableOpacity
                style={[styles.cta, !canLearn && styles.ctaDisabled]}
                disabled={!canLearn}
                onPress={() => {
                  navigation.navigate('CourseDetail', {
                    courseId: item.id,
                    courseName: item.name,
                  });
                }}
              >
                <Text style={styles.ctaText}>{canLearn ? 'Lessons' : 'Unavailable'}</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />
      {user.role === 'Trainer' || user.role === 'Admin' ? (
        <TouchableOpacity
          style={[styles.scheduleBtn, { bottom: scheduleFabBottom }]}
          onPress={() => navigation.getParent()?.getParent()?.navigate('MySessions', { screen: 'LiveSchedule' })}
        >
          <Text style={styles.scheduleBtnText}>Schedule live</Text>
        </TouchableOpacity>
      ) : null}
      {user.role === 'Admin' ? (
        <TouchableOpacity
          style={[styles.manageBtn, { bottom: manageFabBottom }]}
          onPress={() => navigation.navigate('AdminCourseManager')}
        >
          <Text style={styles.manageBtnText}>Manage courses</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#edf1fa' },
  listFlex: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  guestHint: { color: '#64748b', textAlign: 'center', fontSize: 17 },
  list: { padding: 18, paddingTop: 12, gap: 14 },
  empty: { color: '#64748b', textAlign: 'center', paddingVertical: 36, fontSize: 15 },
  filterBanner: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#dfe7f8',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  filterCopy: { flex: 1 },
  filterLabel: {
    fontSize: 12,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontWeight: '700',
  },
  filterName: { marginTop: 4, fontSize: 16, fontWeight: '700', color: BRAND_BLUE },
  filterClearBtn: {
    borderWidth: 1,
    borderColor: '#c7cff0',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f8fafc',
  },
  filterClearText: { color: BRAND_BLUE, fontWeight: '700', fontSize: 13 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#dfe7f8',
    shadowColor: BRAND_BLUE,
    shadowOpacity: 0.1,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1e293b',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  lessonCueMuted: { fontSize: 14, color: '#94a3b8', marginBottom: 8 },
  scheduleHint: { fontSize: 13, color: BRAND_RED, marginBottom: 10, fontWeight: '700' },
  cardDesc: { fontSize: 14, color: '#64748b', lineHeight: 20, marginBottom: 14 },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressLabel: { fontSize: 12, fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
  progressPct: { fontSize: 15, fontWeight: '700', color: BRAND_BLUE },
  track: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#e7ecf7',
    overflow: 'hidden',
    marginBottom: 18,
  },
  fill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: BRAND_RED,
    minWidth: 0,
  },
  cta: {
    backgroundColor: BRAND_RED,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    shadowColor: BRAND_RED,
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  ctaDisabled: {
    opacity: 0.5,
    shadowOpacity: 0,
    elevation: 0,
  },
  ctaText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  scheduleBtn: {
    position: 'absolute',
    left: 18,
    right: 18,
    borderRadius: 14,
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
    left: 18,
    right: 18,
    borderRadius: 14,
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
