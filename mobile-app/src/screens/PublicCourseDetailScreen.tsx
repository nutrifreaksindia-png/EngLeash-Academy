import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { PublicCourse } from './LandingHomeScreen';
import { API_BASE } from '../config';
import { alertApplyPaymentError, payApplyDueWithRazorpay } from '../payments/razorpayApplyBilling';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

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

function parseJsonList(raw?: string | null) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function plainTextFromHtml(raw?: string) {
  if (!raw) return '';
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseHighlights(raw?: string | null) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    // ignore
  }
  return plainTextFromHtml(raw)
    .split(/\s+[•\-]\s+|\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function primaryCta(typeRaw?: string) {
  const t = (typeRaw || 'free').toLowerCase();
  if (t === 'apply') return { label: 'Apply', kind: 'apply' as const };
  if (t === 'purchase') return { label: 'Purchase', kind: 'purchase' as const };
  if (t === 'subscribe') return { label: 'Subscribe', kind: 'subscribe' as const };
  return { label: 'Join Free', kind: 'free' as const };
}

function formatModeLabel(m: string) {
  const s = String(m).trim();
  if (/^self-?paced$/i.test(s) || s === 'Self') return 'Self';
  return s;
}

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

function startDateForBatch(batch: OpenBatch) {
  return batch.actual_start_date || batch.planned_start_date || null;
}

function allowedApplyPlansForBatch(batch: OpenBatch) {
  const startYmd = startDateForBatch(batch);
  if (!startYmd) return ['single_payment', 'first_installment'] as const;
  const startMs = new Date(`${startYmd}T00:00:00`).getTime();
  const now = new Date();
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.floor((startMs - todayMs) / (24 * 60 * 60 * 1000));
  return days > 7
    ? (['registration', 'single_payment', 'first_installment'] as const)
    : (['single_payment', 'first_installment'] as const);
}

function applyPlanLabel(plan: 'registration' | 'single_payment' | 'first_installment') {
  if (plan === 'registration') return 'Registration fee';
  if (plan === 'single_payment') return 'Single payment';
  return 'First installment';
}

function applyPlanAmount(course: PublicCourse, plan: 'registration' | 'single_payment' | 'first_installment') {
  const total = Math.max(0, Number(course.fee_inr || 0));
  const registration = Math.min(total, Number(course.apply_registration_fee_inr ?? 999));
  const singleDiscount = Math.max(0, Number(course.apply_single_payment_discount_inr || 0));
  const installmentCount = Math.max(1, Number(course.apply_installment_count || 2));
  if (plan === 'registration') return registration;
  if (plan === 'single_payment') return Math.max(0, total - singleDiscount);
  return Math.ceil((total * 100) / installmentCount) / 100;
}

export default function PublicCourseDetailScreen({ route, navigation }: any) {
  const { courseId, courseName } = route.params;
  const { user, refreshUser } = useAuth();
  const [course, setCourse] = useState<PublicCourse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [openBatches, setOpenBatches] = useState<OpenBatch[]>([]);
  const [openBatchesLoading, setOpenBatchesLoading] = useState(false);
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [applyBusyKey, setApplyBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await api.publicGet(`/courses/public/${courseId}`);
      let enrolled = false;
      if (user?.id) {
        try {
          const catalog = await api.get('/courses/catalog');
          const match = Array.isArray(catalog)
            ? catalog.find((row: any) => Number(row?.id) === Number(courseId))
            : null;
          enrolled = !!match?.enrolled;
        } catch {
          enrolled = false;
        }
      }
      setCourse(detail ? { ...detail, enrolled } : null);
    } catch {
      setCourse(null);
    } finally {
      setLoading(false);
    }
  }, [courseId, user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const goAccount = () => navigation.getParent()?.getParent()?.navigate('Account');
  const goToCourse = useCallback((targetCourse: PublicCourse) => {
    navigation.getParent()?.navigate?.('MyCourses', {
      screen: 'MyCoursesList',
      params: {
        focusCourseId: targetCourse.id,
        focusCourseName: targetCourse.name,
      },
    });
  }, [navigation]);

  const openApplyModal = useCallback(async () => {
    if (!course) return;
    setApplyModalOpen(true);
    setOpenBatches([]);
    setOpenBatchesLoading(true);
    try {
      const data = await api.get(`/enrollments/courses/${course.id}/open-batches`);
      setOpenBatches(Array.isArray(data?.batches) ? data.batches : []);
    } catch (e: any) {
      Alert.alert('Apply', e?.message || 'Could not load open batches');
      setApplyModalOpen(false);
    } finally {
      setOpenBatchesLoading(false);
    }
  }, [course]);

  const enroll = async (typeOverride?: string) => {
    if (!course) return;
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in from the Account tab.', [{ text: 'OK', onPress: goAccount }]);
      return;
    }
    setBusy(true);
    try {
      const type = typeOverride ?? course.enrollment_type ?? 'free';
      await api.post('/enrollments/enroll', { course_id: course.id, enrollmentType: type });
      Alert.alert('Success', 'Your enrollment request was submitted.');
      refreshUser();
      load();
    } catch (e: any) {
      Alert.alert('Enrollment', e?.message || 'Could not complete enrollment');
    } finally {
      setBusy(false);
    }
  };

  const pageHeading = course?.name || courseName || 'Course';
  const modes = useMemo(() => parseJsonList(course?.modes_json), [course?.modes_json]);
  const languages = useMemo(() => parseJsonList(course?.languages_json), [course?.languages_json]);
  const highlights = useMemo(() => parseHighlights(course?.highlights), [course?.highlights]);
  const specsText = useMemo(() => plainTextFromHtml(course?.specifications_html), [course?.specifications_html]);

  if (loading) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title={courseName || 'Course'} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      </View>
    );
  }

  if (!course) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title={courseName || 'Course'} />
        <View style={styles.centered}>
          <Text style={styles.err}>Course not found or unpublished.</Text>
        </View>
      </View>
    );
  }

  const fee = course.fee_inr ?? 0;
  const disc = course.discount_inr ?? 0;
  const eff = Math.max(0, fee - disc);
  const cta = primaryCta(course.enrollment_type);
  const isActive = !!course.enrolled;
  const primaryLabel = isActive ? 'Go to Course' : cta.label;
  const onPrimaryAction = async () => {
    if (isActive) {
      goToCourse(course);
      return;
    }
    if (cta.kind === 'apply') {
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
      await openApplyModal();
      return;
    }
    if (cta.kind === 'purchase') {
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
      return;
    }
    if (cta.kind === 'subscribe') {
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
      return;
    }
    void enroll('free');
  };

  async function applyToBatch(batch: OpenBatch, selectedPlan: 'registration' | 'single_payment' | 'first_installment') {
    if (!course || !user) return;
    const busyKey = `${batch.id}:${selectedPlan}`;
    setApplyBusyKey(busyKey);
    try {
      const result = await payApplyDueWithRazorpay({
        courseId: Number(course.id),
        batchId: Number(batch.id),
        selectedPlan,
        userEmail: user.email,
        userName: user.name,
        userMobileDigits: user.mobile_number ?? undefined,
        checkoutTitle: `${course.name} — ${applyPlanLabel(selectedPlan)}`,
      });
      if (!result?.ok) return;
      Alert.alert('Application sent', 'Payment successful. Your application is now pending review.');
      setApplyModalOpen(false);
      refreshUser();
      load();
    } catch (error) {
      alertApplyPaymentError(error);
    } finally {
      setApplyBusyKey(null);
    }
  }

  async function sendEnquiry(batchId: number) {
    if (!course) return;
    try {
      await api.post('/payments/apply/enquiries', { course_id: course.id, batch_id: batchId });
      Alert.alert('Enquiry sent', 'Your callback request has been shared with the academy team.');
    } catch (e: any) {
      Alert.alert('Enquiry', e?.message || 'Could not send enquiry');
    }
  }

  return (
    <View style={styles.pageRoot}>
      <ScreenPageTitle title={pageHeading} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {resolveAssetUrl(course.image_url) ? (
          <Image source={{ uri: resolveAssetUrl(course.image_url) || '' }} style={styles.coverImg} resizeMode="cover" />
        ) : null}
        {course.description ? <Text style={styles.desc}>{course.description}</Text> : null}
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

        {modes.length > 0 ? (
          <Text style={styles.metaRow}>
            <Text style={styles.metaLabel}>Mode:</Text> {modes.map(formatModeLabel).join(', ')}
          </Text>
        ) : null}
        {languages.length > 0 ? (
          <Text style={styles.metaRow}>
            <Text style={styles.metaLabel}>Language medium:</Text> {languages.join(', ')}
          </Text>
        ) : null}

        {highlights.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Course Highlights</Text>
            {highlights.map((h) => (
              <Text key={h} style={styles.bullet}>
                • {h}
              </Text>
            ))}
          </View>
        ) : null}

        {specsText ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Full Specifications</Text>
            <Text style={styles.specText}>{specsText}</Text>
          </View>
        ) : null}

        <View style={styles.btnRow}>
          {isActive ? (
            <View style={styles.activeTag}>
              <Text style={styles.activeTagText}>Active</Text>
            </View>
          ) : null}
          <TouchableOpacity style={styles.btnPrimary} onPress={() => void onPrimaryAction()} disabled={busy}>
            <Text style={styles.btnPrimaryText}>{busy ? 'Please wait…' : primaryLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnOutline}
            onPress={() => {
              if (navigation.canGoBack?.()) {
                navigation.goBack();
              } else {
                navigation.navigate('LandingHome');
              }
            }}
          >
            <Text style={styles.btnOutlineText}>Back to Courses</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <Modal visible={applyModalOpen} animationType="slide" transparent onRequestClose={() => setApplyModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Apply - {course?.name}</Text>
            {openBatchesLoading ? <ActivityIndicator color={BRAND_RED} /> : null}
            {!openBatchesLoading && openBatches.length === 0 ? (
              <Text style={styles.metaRow}>No open batches currently available for this course.</Text>
            ) : (
              <ScrollView style={styles.modalScroll}>
                {openBatches.map((batch) => {
                  const plans = allowedApplyPlansForBatch(batch);
                  return (
                    <View key={batch.id} style={styles.batchCard}>
                      <Text style={styles.batchTitle}>
                        Batch {batch.batch_number || batch.id} - {batch.title || batch.name}
                      </Text>
                      <Text style={styles.batchMeta}>Type: {batch.session_type === 'one_to_one' ? '1:1' : 'Group'}</Text>
                      <Text style={styles.batchMeta}>Duration: {batch.duration_days || '—'} days</Text>
                      <Text style={styles.batchMeta}>
                        Start: {batch.actual_start_date || batch.planned_start_date || '—'}
                      </Text>
                      <Text style={styles.batchMeta}>Choose a payment option to continue:</Text>
                      <View style={styles.batchPlanWrap}>
                        {plans.map((plan) => {
                          const busyKey = `${batch.id}:${plan}`;
                          return (
                            <TouchableOpacity
                              key={plan}
                              style={[styles.batchPlanBtn, applyBusyKey === busyKey && styles.batchPlanBtnDisabled]}
                              disabled={!!applyBusyKey}
                              onPress={() => void applyToBatch(batch, plan)}
                            >
                              <Text style={styles.batchPlanBtnText}>
                                {applyBusyKey === busyKey
                                  ? 'Opening…'
                                  : `${applyPlanLabel(plan)} · ${formatInr(applyPlanAmount(course, plan))}`}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      {course?.apply_enquiry_enabled === false || course?.apply_enquiry_enabled === 0 ? null : (
                        <TouchableOpacity style={styles.batchEnquiryBtn} onPress={() => void sendEnquiry(batch.id)}>
                          <Text style={styles.batchEnquiryText}>Enquiry / Request callback</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            )}
            <TouchableOpacity style={styles.btnOutline} onPress={() => setApplyModalOpen(false)}>
              <Text style={styles.btnOutlineText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 20, paddingBottom: 40 },
  coverImg: { width: '100%', height: 200, borderRadius: 14, marginBottom: 14, backgroundColor: '#dfe3f4' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  err: { color: '#666', textAlign: 'center' },
  desc: { fontSize: 15, color: '#444', lineHeight: 22 },
  price: { fontSize: 16, fontWeight: '700', color: BRAND_BLUE, marginTop: 16 },
  strike: { textDecorationLine: 'line-through', color: '#999', fontWeight: '400' },
  metaRow: { marginTop: 10, color: '#334155', fontSize: 14 },
  metaLabel: { fontWeight: '700', color: '#0f172a' },
  block: { marginTop: 16, padding: 14, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb' },
  blockTitle: { fontWeight: '700', color: '#1f2937', marginBottom: 8, fontSize: 15 },
  bullet: { fontSize: 14, color: '#374151', marginBottom: 6, lineHeight: 20 },
  specText: { fontSize: 14, color: '#374151', lineHeight: 21 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 24 },
  btnOutline: {
    borderWidth: 1.5,
    borderColor: BRAND_BLUE,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  btnOutlineText: { color: BRAND_BLUE, fontWeight: '700', fontSize: 13 },
  btnPrimary: { backgroundColor: BRAND_RED, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  activeTag: {
    backgroundColor: '#e8f5e9',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
  modalScroll: { marginBottom: 12 },
  batchCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    backgroundColor: '#f8fafc',
  },
  batchTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  batchMeta: { fontSize: 12, color: '#334155', marginTop: 4 },
  batchPlanWrap: { marginTop: 8, gap: 8 },
  batchPlanBtn: { backgroundColor: BRAND_RED, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 10 },
  batchPlanBtnDisabled: { opacity: 0.6 },
  batchPlanBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  batchEnquiryBtn: {
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BRAND_BLUE,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  batchEnquiryText: { color: BRAND_BLUE, fontSize: 12, fontWeight: '700', textAlign: 'center' },
});
