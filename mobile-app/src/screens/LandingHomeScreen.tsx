import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
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
import { API_BASE } from '../config';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

export type PublicCourse = {
  id: number;
  name: string;
  description?: string;
  image_url?: string | null;
  highlights?: string | null;
  specifications_html?: string;
  modes_json?: string | null;
  languages_json?: string | null;
  fee_inr?: number;
  discount_inr?: number;
  enrollment_type?: string;
  enrolled?: boolean;
};

type OpenBatch = {
  id: number;
  batch_number?: number;
  title?: string;
  name?: string;
  session_type: 'group' | 'one_to_one';
  duration_days?: number | null;
  training_schedule_json?: string | null;
  batch_status?: string;
  planned_start_date?: string | null;
  actual_start_date?: string | null;
  sessions_passed?: number;
};

const SERVICES = [
  'Spoken English & communication skills',
  'IELTS / exam-oriented coaching',
  'One-to-one and small-group live sessions',
  'Assignments with trainer feedback',
];

function formatInr(n?: number) {
  if (n == null || Number.isNaN(Number(n))) return '';
  return `₹${Number(n).toLocaleString('en-IN')}`;
}

function resolveAssetUrl(url?: string | null) {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const apiBase = String(API_BASE || '').replace(/\/+$/, '');
  return apiBase ? `${apiBase}${url.startsWith('/') ? '' : '/'}${url}` : null;
}

function primaryCta(typeRaw?: string) {
  const t = (typeRaw || 'free').toLowerCase();
  if (t === 'apply') return { label: 'Apply', kind: 'apply' as const };
  if (t === 'purchase') return { label: 'Purchase', kind: 'purchase' as const };
  if (t === 'subscribe') return { label: 'Subscribe', kind: 'subscribe' as const };
  return { label: 'Join Free', kind: 'free' as const };
}

export default function LandingHomeScreen({ navigation, route }: any) {
  function formatDateFriendly(value: string | null | undefined) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  const { user, refreshUser } = useAuth();
  const insets = useSafeAreaInsets();
  const [courses, setCourses] = useState<PublicCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [enrollingId, setEnrollingId] = useState<number | null>(null);
  const [applyCourse, setApplyCourse] = useState<PublicCourse | null>(null);
  const [openBatches, setOpenBatches] = useState<OpenBatch[]>([]);
  const [openBatchesLoading, setOpenBatchesLoading] = useState(false);
  const applyResumeKeyRef = useRef<string | null>(null);
  const subscribeResumeKeyRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = user?.id ? await api.get('/courses/catalog') : await api.publicGet('/courses/public');
      setCourses(Array.isArray(data) ? data : []);
    } catch {
      setCourses([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  /** Load open batches modal for Apply (authenticated). */
  const openApplyModalForCourse = useCallback((course: PublicCourse) => {
    setApplyCourse(course);
    setOpenBatches([]);
    setOpenBatchesLoading(true);
    api
      .get(`/enrollments/courses/${course.id}/open-batches`)
      .then((data) => setOpenBatches(Array.isArray(data?.batches) ? data.batches : []))
      .catch((e: any) => Alert.alert('Apply', e?.message || 'Could not load open batches'))
      .finally(() => setOpenBatchesLoading(false));
  }, []);

  const goAccount = () => navigation.getParent()?.navigate?.('Account');

  const goToCourse = useCallback((course: PublicCourse) => {
    navigation.getParent()?.navigate?.('MyCourses', {
      screen: 'MyCoursesList',
      params: {
        focusCourseId: course.id,
        focusCourseName: course.name,
      },
    });
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      const rawId = route.params?.applyAfterAuthCourseId;
      if (!user || rawId == null) return;

      const id = Number(rawId);
      const nameRaw = route.params?.applyAfterAuthCourseName;
      const resumeKey = `${user.id}:${id}:${String(nameRaw || '')}`;
      if (!Number.isFinite(id) || applyResumeKeyRef.current === resumeKey) return;
      applyResumeKeyRef.current = resumeKey;

      navigation.setParams({
        applyAfterAuthCourseId: undefined,
        applyAfterAuthCourseName: undefined,
      });

      const fromList = courses.find((c) => c.id === id);
      const course: PublicCourse =
        fromList ||
        ({
          id,
          name: String(nameRaw || 'Course'),
          enrollment_type: 'apply',
        } as PublicCourse);
      openApplyModalForCourse(course);
    }, [user, route.params?.applyAfterAuthCourseId, route.params?.applyAfterAuthCourseName, courses, navigation, openApplyModalForCourse])
  );

  useFocusEffect(
    useCallback(() => {
      const rawId = route.params?.subscribeAfterAuthCourseId;
      if (!user || rawId == null) return;

      const id = Number(rawId);
      const nameRaw = route.params?.subscribeAfterAuthCourseName;
      const resumeKey = `sub:${user.id}:${id}:${String(nameRaw || '')}`;
      if (!Number.isFinite(id) || subscribeResumeKeyRef.current === resumeKey) return;
      subscribeResumeKeyRef.current = resumeKey;

      navigation.setParams({
        subscribeAfterAuthCourseId: undefined,
        subscribeAfterAuthCourseName: undefined,
      });

      navigation.navigate('CourseSubscribePackages', {
        courseId: id,
        courseName: String(nameRaw || 'Course'),
      });
    }, [user, route.params?.subscribeAfterAuthCourseId, route.params?.subscribeAfterAuthCourseName, navigation])
  );

  const enroll = async (course: PublicCourse, typeOverride?: string) => {
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in from the Account tab to continue.', [
        { text: 'OK', onPress: goAccount },
      ]);
      return;
    }
    setEnrollingId(course.id);
    try {
      const type = typeOverride ?? course.enrollment_type ?? 'free';
      await api.post('/enrollments/enroll', { course_id: course.id, enrollmentType: type });
      Alert.alert('Success', 'Your enrollment request was submitted.');
      refreshUser();
    } catch (e: any) {
      Alert.alert('Enrollment', e?.message || 'Could not complete enrollment');
    } finally {
      setEnrollingId(null);
    }
  };

  const onJoinFree = (course: PublicCourse) => {
    const t = (course.enrollment_type || 'free').toLowerCase();
    if (t !== 'free') {
      Alert.alert('Join Free', 'This course is not a free-enrollment course. Try Apply, Subscribe, or Purchase.');
      return;
    }
    enroll(course, 'free');
  };

  const onApply = (course: PublicCourse) => {
    if (!user) {
      navigation.getParent()?.navigate?.('Account', {
        screen: 'Signup',
        params: {
          redirectAfterSignup: 'apply',
          courseId: course.id,
          courseName: course.name,
        },
      });
      return;
    }
    applyResumeKeyRef.current = null;
    openApplyModalForCourse(course);
  };

  async function applyToBatch(batchId: number) {
    if (!applyCourse) return;
    try {
      await api.post('/enrollments/apply-batch', { course_id: applyCourse.id, batch_id: batchId });
      Alert.alert('Application sent', 'Your batch application was submitted.');
      setApplyCourse(null);
      setOpenBatches([]);
      refreshUser();
    } catch (e: any) {
      Alert.alert('Apply', e?.message || 'Could not submit application');
    }
  }

  const onPurchase = (course: PublicCourse) => {
    if (!user) {
      navigation.getParent()?.navigate?.('Account', {
        screen: 'Signup',
        params: {
          redirectAfterSignup: 'purchase',
          courseId: course.id,
          courseName: course.name,
          courseFeeInr: course.fee_inr ?? 0,
          courseDiscountInr: course.discount_inr ?? 0,
        },
      });
      return;
    }
    navigation.navigate('CoursePurchaseSummary', {
      courseId: course.id,
      courseName: course.name,
      fee_inr: course.fee_inr ?? 0,
      discount_inr: course.discount_inr ?? 0,
    });
  };

  const onSubscribe = (course: PublicCourse) => {
    if (!user) {
      navigation.getParent()?.navigate?.('Account', {
        screen: 'Signup',
        params: {
          redirectAfterSignup: 'subscribe',
          courseId: course.id,
          courseName: course.name,
        },
      });
      return;
    }
    navigation.navigate('CourseSubscribePackages', {
      courseId: course.id,
      courseName: course.name,
    });
  };

  const onPrimaryAction = (course: PublicCourse) => {
    if (course.enrolled) {
      goToCourse(course);
      return;
    }
    const cta = primaryCta(course.enrollment_type);
    if (cta.kind === 'apply') {
      onApply(course);
      return;
    }
    if (cta.kind === 'purchase') {
      onPurchase(course);
      return;
    }
    if (cta.kind === 'subscribe') {
      onSubscribe(course);
      return;
    }
    onJoinFree(course);
  };

  if (loading) {
    return (
      <View style={styles.root}>
        <ScreenPageTitle title="Home" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingBottom: 8 + insets.bottom }]}>
      <ScreenPageTitle title="Home" />
      <FlatList style={styles.listFlex}
        data={courses}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <Text style={styles.heroTitle}>EngLeash Academy</Text>
            <Text style={styles.heroSub}>Learn English with live sessions, structured courses, and real feedback.</Text>
            <Text style={styles.sectionLabel}>What we offer</Text>
            {SERVICES.map((line) => (
              <Text key={line} style={styles.bullet}>
                • {line}
              </Text>
            ))}
            <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Courses</Text>
            <Text style={styles.hint}>
              Browse offerings below. Apply opens sign-up if needed. Subscribe and Purchase use a summary screen before secure payment.
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>No published courses yet.</Text>}
        renderItem={({ item }) => {
          const fee = item.fee_inr ?? 0;
          const disc = item.discount_inr ?? 0;
          const eff = Math.max(0, fee - disc);
          const type = (item.enrollment_type || 'free').toLowerCase();
          const isActive = !!item.enrolled;
          const primaryLabel = isActive ? 'Go to Course' : primaryCta(item.enrollment_type).label;
          return (
            <View style={styles.card}>
              {resolveAssetUrl(item.image_url) ? (
                <Image source={{ uri: resolveAssetUrl(item.image_url) || '' }} style={styles.coverImg} resizeMode="cover" />
              ) : (
                <View style={styles.coverFallback}>
                  <Text style={styles.coverFallbackText}>{item.name}</Text>
                </View>
              )}
              <Text style={styles.cardTitle}>{item.name}</Text>
              {item.description ? (
                <Text style={styles.cardDesc} numberOfLines={3}>
                  {item.description}
                </Text>
              ) : null}
              {fee > 0 ? (
                <Text style={styles.price}>
                  {disc > 0 ? (
                    <>
                      <Text style={styles.strike}>{formatInr(fee)}</Text> {formatInr(eff)}
                    </>
                  ) : (
                    formatInr(fee)
                  )}
                </Text>
              ) : (
                <Text style={styles.price}>Free</Text>
              )}
              <View style={styles.btnRow}>
                {isActive ? (
                  <View style={styles.activeTag}>
                    <Text style={styles.activeTagText}>Active</Text>
                  </View>
                ) : null}
                <TouchableOpacity
                  style={[styles.btnPrimary, type !== 'free' && primaryCta(item.enrollment_type).kind === 'free' && styles.btnMuted]}
                  onPress={() => onPrimaryAction(item)}
                  disabled={!isActive && enrollingId !== null}
                >
                  <Text style={styles.btnPrimaryText}>
                    {!isActive && enrollingId === item.id ? '…' : primaryLabel}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.btnOutline}
                  onPress={() =>
                    navigation.navigate('PublicCourseDetail', {
                      courseId: item.id,
                      courseName: item.name,
                    })
                  }
                >
                  <Text style={styles.btnOutlineText}>See Full Specifications</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />
      <Modal visible={!!applyCourse} animationType="slide" transparent onRequestClose={() => setApplyCourse(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Apply - {applyCourse?.name}</Text>
            {openBatchesLoading ? <ActivityIndicator color={BRAND_RED} /> : null}
            {!openBatchesLoading && openBatches.length === 0 ? (
              <Text style={styles.hint}>No open batches currently available for this course.</Text>
            ) : (
              <ScrollView style={styles.batchListScroll}>
                {openBatches.map((b) => {
                  let sched = {};
                  try {
                    sched = b.training_schedule_json ? JSON.parse(b.training_schedule_json) : {};
                  } catch {
                    sched = {};
                  }
                  const days = Array.isArray((sched as any).daysOfWeek) ? (sched as any).daysOfWeek.join(', ') : '—';
                  const timing = (sched as any).startTime && (sched as any).endTime ? `${(sched as any).startTime}-${(sched as any).endTime}` : '—';
                  return (
                    <TouchableOpacity key={b.id} style={styles.batchCard} onPress={() => void applyToBatch(b.id)}>
                      <Text style={styles.batchCardTitle}>
                        Batch {b.batch_number || b.id} - {b.title || b.name}
                      </Text>
                      <Text style={styles.batchMeta}>Type: {b.session_type === 'one_to_one' ? '1:1' : 'Group'}</Text>
                      <Text style={styles.batchMeta}>Duration: {b.duration_days || '—'} days</Text>
                      <Text style={styles.batchMeta}>Days: {days}</Text>
                      <Text style={styles.batchMeta}>Live timing: {timing}</Text>
                      <Text style={styles.batchMeta}>Status: {b.batch_status === 'started' ? 'Started' : 'Not started'}</Text>
                      {b.batch_status === 'started' ? (
                        <>
                          <Text style={styles.batchMeta}>Date started: {formatDateFriendly(b.actual_start_date)}</Text>
                          <Text style={styles.batchMeta}>Sessions passed: {b.sessions_passed || 0}</Text>
                        </>
                      ) : (
                        <Text style={styles.batchMeta}>Expected start: {formatDateFriendly(b.planned_start_date)}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
            <TouchableOpacity style={styles.btnOutline} onPress={() => setApplyCourse(null)}>
              <Text style={styles.btnOutlineText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  listFlex: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingHorizontal: 16, paddingBottom: 72 },
  headerBlock: { paddingTop: 12, paddingBottom: 8 },
  heroTitle: { fontSize: 26, fontWeight: '800', color: BRAND_BLUE },
  heroSub: { fontSize: 15, color: '#444', marginTop: 8, lineHeight: 22 },
  sectionLabel: { fontSize: 17, fontWeight: '700', color: '#222', marginTop: 16 },
  bullet: { fontSize: 15, color: '#333', marginTop: 8, lineHeight: 22 },
  hint: { fontSize: 13, color: '#666', marginTop: 6 },
  empty: { color: '#666', paddingVertical: 24, textAlign: 'center' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e8eaf6',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  coverImg: { width: '100%', height: 170, borderRadius: 12, backgroundColor: '#dfe3f4' },
  coverFallback: {
    width: '100%',
    height: 170,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    backgroundColor: '#e8eaf6',
  },
  coverFallbackText: { color: BRAND_BLUE, fontWeight: '700', textAlign: 'center' },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#222' },
  cardDesc: { fontSize: 14, color: '#555', marginTop: 6 },
  price: { fontSize: 15, fontWeight: '600', color: BRAND_BLUE, marginTop: 8 },
  strike: { textDecorationLine: 'line-through', color: '#999', fontWeight: '400' },
  btnRow: { flexDirection: 'row', marginTop: 14, gap: 8, flexWrap: 'wrap' },
  btnOutline: {
    borderWidth: 1.5,
    borderColor: BRAND_BLUE,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  btnOutlineText: { color: BRAND_BLUE, fontWeight: '700', fontSize: 13 },
  btnPrimary: { backgroundColor: BRAND_RED, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 },
  btnMuted: { opacity: 0.45 },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  activeTag: {
    backgroundColor: '#e8f5e9',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignSelf: 'center',
  },
  activeTagText: { color: '#2e7d32', fontWeight: '700', fontSize: 13 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    maxHeight: '84%',
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: BRAND_BLUE, marginBottom: 10 },
  batchListScroll: { marginBottom: 12 },
  batchCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    backgroundColor: '#f8fafc',
  },
  batchCardTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  batchMeta: { fontSize: 12, color: '#334155', marginTop: 2 },
});
