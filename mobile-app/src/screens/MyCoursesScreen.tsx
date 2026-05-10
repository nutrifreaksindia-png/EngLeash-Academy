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
import { useAuth } from '../context/AuthContext';
import { joinOpensAtLabel, userMayJoinLiveSession } from '../utils/liveJoinWindow';
import {
  allLessonsCompleted,
  computeCourseProgressPercent,
  getLessonProgress,
  resolveLessonAction,
} from '../lib/learnProgress';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

type Course = {
  id: number;
  name: string;
  description?: string;
  my_schedule_hint?: string | null;
};
type LessonRow = { id: number; title?: string; sort_order?: number };

type CourseEnriched = Course & {
  lessonIds: number[];
  progressPercent: number;
  primaryLessonId: number | null;
  primaryLessonTitle: string;
  lessonAction: 'start' | 'resume' | 'restart';
};

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

  let progressPercent = await computeCourseProgressPercent(userId, c.id, sorted);

  let primaryLessonId: number | null = sorted[0]?.id ?? null;
  let primaryLessonTitle = sorted[0]?.title?.trim() || 'Current lesson';

  let lessonAction: 'start' | 'resume' | 'restart' = 'start';

  if (!sorted.length) {
    return {
      ...c,
      lessonIds,
      progressPercent: 0,
      primaryLessonId: null,
      primaryLessonTitle: '',
      lessonAction: 'start',
    };
  }

  let foundIncomplete = false;
  for (const L of sorted) {
    const p = await getLessonProgress(userId, c.id, L.id);
    if (!p?.completed) {
      foundIncomplete = true;
      primaryLessonId = L.id;
      primaryLessonTitle = L.title?.trim() || 'Lesson';
      lessonAction = await resolveLessonAction(userId, c.id, L.id);
      break;
    }
  }

  const allDone =
    lessonIds.length > 0 ? await allLessonsCompleted(userId, c.id, lessonIds) : false;

  if (!foundIncomplete || allDone) {
    primaryLessonId = sorted[0]!.id;
    primaryLessonTitle = sorted[0]!.title?.trim() || 'Lesson';
    lessonAction = allDone ? 'restart' : 'start';
  }

  return {
    ...c,
    lessonIds,
    progressPercent,
    primaryLessonId,
    primaryLessonTitle,
    lessonAction,
  };
}

export default function MyCoursesScreen({ navigation }: any) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [courses, setCourses] = useState<CourseEnriched[]>([]);
  const [todaySessions, setTodaySessions] = useState<TodaySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const data = await api.get('/courses');
      const rows = Array.isArray(data) ? data : [];
      const enriched = await Promise.all(rows.map((c: Course) => enrichCourse(user.id, c)));
      setCourses(enriched);

      const wantsToday = user.role === 'Student' || user.role === 'Lab' || user.role === 'Trainer';
      if (wantsToday) {
        try {
          const todayRows = await api.get('/batch-manager/my/today');
          setTodaySessions(Array.isArray(todayRows) ? todayRows : []);
        } catch {
          setTodaySessions([]);
        }
      } else {
        setTodaySessions([]);
      }
    } catch {
      setCourses([]);
      setTodaySessions([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      void load();
    }, [load, user?.id]),
  );

  if (!user) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom }]}>
        <View style={styles.centered}>
          <Text style={styles.guestHint}>Open My Account to sign in.</Text>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {user.role === 'Student' || user.role === 'Lab' || user.role === 'Trainer' ? (
        <View style={[styles.todayBox, { marginTop: Math.max(insets.top, 10) }]}>
          <Text style={styles.todayTitle}>{user.role === 'Trainer' ? 'Today’s classes' : 'Today’s lesson shortcut'}</Text>
          {todaySessions.length === 0 ? (
            <Text style={styles.todaySub}>No scheduled session today.</Text>
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
                    <Text style={styles.todayLesson}>{title}</Text>
                    <Text style={styles.todayBatch}>{s.batch_title || s.batch_name}</Text>
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
                        navigation.getParent()?.getParent()?.navigate('MySessions', {
                          screen: 'LiveSessions',
                        })
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
      ) : (
        <View style={{ marginTop: Math.max(insets.top, 10) }} />
      )}
      <FlatList
        style={styles.listFlex}
        data={courses}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
        contentContainerStyle={[styles.list, { paddingBottom: 200 + insets.bottom }]}
        ListEmptyComponent={<Text style={styles.empty}>No enrolled courses. Browse the catalog to enroll.</Text>}
        renderItem={({ item }) => {
          const ctaLabel =
            item.lessonAction === 'resume'
              ? 'Resume'
              : item.lessonAction === 'restart'
                ? 'Restart'
                : 'Start';
          const canLearn = Boolean(item.primaryLessonId);
          const barW = Math.min(100, Math.max(0, item.progressPercent));
          return (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              {canLearn ? (
                <Text style={styles.lessonCue} numberOfLines={2}>
                  {item.lessonAction === 'restart'
                    ? 'Course complete · start again from the first lesson'
                    : `Continue: ${item.primaryLessonTitle}`}
                </Text>
              ) : (
                <Text style={styles.lessonCueMuted}>No lessons available yet.</Text>
              )}
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
                  if (!item.primaryLessonId) return;
                  navigation.navigate('LearnMode', {
                    courseId: item.id,
                    lessonId: item.primaryLessonId,
                    lessonTitle: item.primaryLessonTitle,
                    restart: item.lessonAction === 'restart',
                    courseLessonIds: item.lessonIds,
                  });
                }}
              >
                <Text style={styles.ctaText}>{canLearn ? ctaLabel : 'Unavailable'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.outlineBtn}
                onPress={() =>
                  navigation.navigate('CourseDetail', {
                    courseId: item.id,
                    courseName: item.name,
                  })
                }
              >
                <Text style={styles.outlineBtnText}>Course outline</Text>
              </TouchableOpacity>
            </View>
          );
        }}
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
      {user.role === 'Trainer' || user.role === 'Admin' ? (
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
  container: { flex: 1, backgroundColor: '#edf1fa' },
  listFlex: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  guestHint: { color: '#64748b', textAlign: 'center', fontSize: 17 },
  list: { padding: 18, paddingTop: 12, gap: 14 },
  todayBox: {
    marginHorizontal: 18,
    marginBottom: 4,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#dfe7f8',
    shadowColor: BRAND_BLUE,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  todayTitle: { fontSize: 15, fontWeight: '700', color: BRAND_BLUE, marginBottom: 10 },
  todaySub: { color: '#64748b', fontSize: 14 },
  todayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e8edf5',
    paddingTop: 10,
    marginTop: 8,
  },
  todayTextCol: { flex: 1, paddingRight: 12 },
  todayLesson: { color: '#0f172a', fontWeight: '700', fontSize: 15 },
  todayBatch: { color: '#64748b', fontSize: 13, marginTop: 4 },
  todayCancelled: { color: '#94a3b8', fontSize: 12, marginTop: 4 },
  todayHint: { color: '#64748b', fontSize: 11, marginTop: 4, fontStyle: 'italic' },
  todayJoinBtn: {
    backgroundColor: BRAND_RED,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  todayJoinText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  todayBrowseBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BRAND_BLUE,
  },
  todayBrowseText: { color: BRAND_BLUE, fontWeight: '600', fontSize: 13 },
  empty: { color: '#64748b', textAlign: 'center', paddingVertical: 36, fontSize: 15 },
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
  lessonCue: { fontSize: 14, color: BRAND_BLUE, fontWeight: '600', marginBottom: 8 },
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
    marginBottom: 16,
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
    marginBottom: 10,
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
  outlineBtn: {
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#c7cff0',
    backgroundColor: '#f8fafc',
  },
  outlineBtnText: { color: BRAND_BLUE, fontWeight: '600', fontSize: 14 },
  catalogBtn: {
    position: 'absolute',
    bottom: 24,
    left: 18,
    right: 18,
    backgroundColor: BRAND_BLUE,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  catalogBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  liveBtn: {
    position: 'absolute',
    left: 18,
    right: 18,
    borderRadius: 14,
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
