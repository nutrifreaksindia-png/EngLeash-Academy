import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
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
import { API_BASE } from '../config';
import {
  applyPrimaryLabel,
  fetchActiveApplyEnquiryMap,
  navigateApplyForCourse,
} from '../lib/applyNavigation';
import type { ApplyEnquiry } from '../lib/applyNavigation';

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
  apply_registration_fee_inr?: number;
  apply_single_payment_discount_inr?: number;
  apply_installment_count?: number;
  apply_installment_amounts_json?: string | null;
  apply_installment_gap_days?: number;
  apply_grace_days?: number;
  apply_enquiry_enabled?: boolean | number;
  joined?: boolean;
  enrolled?: boolean;
};

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
  const { user, refreshUser } = useAuth();
  const insets = useSafeAreaInsets();
  const [courses, setCourses] = useState<PublicCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [enrollingId, setEnrollingId] = useState<number | null>(null);
  const [authNavId, setAuthNavId] = useState<number | null>(null);
  const [applyNavId, setApplyNavId] = useState<number | null>(null);
  const [applyEnquiries, setApplyEnquiries] = useState<Record<number, ApplyEnquiry>>({});
  const subscribeResumeKeyRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = user?.id ? await api.get('/courses/catalog') : await api.publicGet('/courses/public');
      setCourses(Array.isArray(data) ? data : []);
      if (user?.id) {
        setApplyEnquiries(await fetchActiveApplyEnquiryMap());
      } else {
        setApplyEnquiries({});
      }
    } catch {
      setCourses([]);
      setApplyEnquiries({});
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

  useFocusEffect(
    useCallback(() => {
      setAuthNavId(null);
      setApplyNavId(null);
    }, []),
  );

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

  const openSignup = (course: PublicCourse, params: Record<string, unknown>) => {
    setAuthNavId(course.id);
    navigation.navigate('Signup', params);
  };

  const onApply = async (course: PublicCourse) => {
    if (!user) {
      openSignup(course, {
        redirectAfterSignup: 'apply',
        courseId: course.id,
        courseName: course.name,
      });
      return;
    }
    setApplyNavId(course.id);
    try {
      await navigateApplyForCourse(navigation, course);
    } finally {
      setApplyNavId(null);
    }
  };

  const onPurchase = (course: PublicCourse) => {
    if (!user) {
      openSignup(course, {
        redirectAfterSignup: 'purchase',
        courseId: course.id,
        courseName: course.name,
        courseFeeInr: course.fee_inr ?? 0,
        courseDiscountInr: course.discount_inr ?? 0,
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
      openSignup(course, {
        redirectAfterSignup: 'subscribe',
        courseId: course.id,
        courseName: course.name,
      });
      return;
    }
    navigation.navigate('CourseSubscribePackages', {
      courseId: course.id,
      courseName: course.name,
    });
  };

  const onPrimaryAction = async (course: PublicCourse) => {
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
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>No published courses yet.</Text>}
        renderItem={({ item }) => {
          const fee = item.fee_inr ?? 0;
          const disc = item.discount_inr ?? 0;
          const eff = Math.max(0, fee - disc);
          const type = (item.enrollment_type || 'free').toLowerCase();
          const isActive = !!item.enrolled;
          const isJoined = !!item.joined && !isActive;
          const primaryLabel = isActive
            ? 'Go to Course'
            : isJoined
              ? 'Joined'
              : applyPrimaryLabel(item.enrollment_type, !!applyEnquiries[item.id]);
          return (
            <View style={styles.card}>
              {resolveAssetUrl(item.image_url) ? (
                <Image source={{ uri: resolveAssetUrl(item.image_url) || '' }} style={styles.coverImg} resizeMode="contain" />
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
                {isActive || isJoined ? (
                  <View style={styles.activeTag}>
                    <Text style={styles.activeTagText}>{isActive ? 'Active' : 'Joined'}</Text>
                  </View>
                ) : null}
                <TouchableOpacity
                  style={[
                    styles.btnPrimary,
                    (isJoined || (type !== 'free' && primaryCta(item.enrollment_type).kind === 'free')) && styles.btnMuted,
                  ]}
                  onPress={() => void onPrimaryAction(item)}
                  disabled={isJoined || (!isActive && (enrollingId !== null || authNavId !== null || applyNavId !== null))}
                >
                  {!isActive && (authNavId === item.id || applyNavId === item.id) ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.btnPrimaryText}>
                      {!isActive && enrollingId === item.id ? '…' : primaryLabel}
                    </Text>
                  )}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  listFlex: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 72 },
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
  coverImg: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: '#dfe3f4' },
  coverFallback: {
    width: '100%',
    aspectRatio: 16 / 9,
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
});
