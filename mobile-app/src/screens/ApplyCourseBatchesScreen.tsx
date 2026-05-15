import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { alertApplyPaymentError, payApplyDueWithRazorpay } from '../payments/razorpayApplyBilling';
import type { PublicCourse } from './LandingHomeScreen';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

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

function formatInr(n?: number) {
  if (n == null || Number.isNaN(Number(n))) return '';
  return `₹${Number(n).toLocaleString('en-IN')}`;
}

function localYmd(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function startDateForBatch(batch: OpenBatch) {
  return batch.actual_start_date || batch.planned_start_date || null;
}

function allowedApplyPlansForBatch(batch: OpenBatch) {
  const startYmd = startDateForBatch(batch);
  if (!startYmd) return ['single_payment', 'first_installment'] as const;
  const today = localYmd(new Date().toISOString()) || startYmd;
  const startMs = new Date(`${startYmd}T00:00:00`).getTime();
  const todayMs = new Date(`${today}T00:00:00`).getTime();
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

function formatDateFriendly(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ApplyCourseBatchesScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { user, refreshUser } = useAuth();
  const initial = route.params?.course as PublicCourse | undefined;
  const [course, setCourse] = useState<PublicCourse | null>(initial ?? null);
  const [openBatches, setOpenBatches] = useState<OpenBatch[]>([]);
  const [openBatchesLoading, setOpenBatchesLoading] = useState(true);
  const [applyBusyKey, setApplyBusyKey] = useState<string | null>(null);

  useEffect(() => {
    if (!initial?.id) {
      Alert.alert('Apply', 'Missing course.');
      navigation.goBack();
    }
  }, [initial?.id, navigation]);

  useEffect(() => {
    const id = course?.id;
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const catalog = await api.get('/courses/catalog');
        const row = Array.isArray(catalog) ? catalog.find((c: any) => Number(c.id) === Number(id)) : null;
        if (cancelled) return;
        if (row) setCourse((c) => ({ ...(c || ({} as PublicCourse)), ...row }));
        else {
          const pub = await api.publicGet(`/courses/public/${id}`);
          if (!cancelled && pub) setCourse((c) => ({ ...(c || ({} as PublicCourse)), ...pub }));
        }
      } catch {
        /* keep params course */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [course?.id]);

  const loadBatches = useCallback(async () => {
    if (!course?.id) return;
    setOpenBatchesLoading(true);
    try {
      const data = await api.get(`/enrollments/courses/${course.id}/open-batches`);
      setOpenBatches(Array.isArray(data?.batches) ? data.batches : []);
    } catch (e: any) {
      Alert.alert('Apply', e?.message || 'Could not load open batches');
      setOpenBatches([]);
    } finally {
      setOpenBatchesLoading(false);
    }
  }, [course?.id]);

  useFocusEffect(
    useCallback(() => {
      void loadBatches();
    }, [loadBatches]),
  );

  async function applyToBatch(batch: OpenBatch, selectedPlan: 'registration' | 'single_payment' | 'first_installment') {
    if (!course || !user) return;
    const busyKey = `${batch.id}:${selectedPlan}`;
    setApplyBusyKey(busyKey);
    try {
      const result = await payApplyDueWithRazorpay({
        courseId: course.id,
        batchId: batch.id,
        selectedPlan,
        userEmail: user.email,
        userName: user.name,
        userMobileDigits: user.mobile_number ?? undefined,
        checkoutTitle: `${course.name} — ${applyPlanLabel(selectedPlan)}`,
      });
      if (!result?.ok) return;
      Alert.alert('Application sent', 'Payment successful. Your application is now pending review.');
      refreshUser();
      navigation.goBack();
    } catch (e: any) {
      alertApplyPaymentError(e);
    } finally {
      setApplyBusyKey(null);
    }
  }

  if (!course?.id) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={BRAND_RED} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingBottom: 12 + insets.bottom }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>Choose a batch and payment option, or request a callback.</Text>
        {openBatchesLoading ? <ActivityIndicator color={BRAND_RED} style={{ marginVertical: 16 }} /> : null}
        {!openBatchesLoading && openBatches.length === 0 ? (
          course.apply_enquiry_enabled === false || course.apply_enquiry_enabled === 0 ? (
            <Text style={styles.muted}>No open batches right now. Enquiries are disabled for this course.</Text>
          ) : (
            <TouchableOpacity
              style={styles.enquiryBtn}
              onPress={() =>
                navigation.navigate('ApplyCallback', {
                  courseId: course.id,
                  courseName: course.name,
                  batchId: null,
                })
              }
            >
              <Text style={styles.enquiryText}>Enquiry</Text>
            </TouchableOpacity>
          )
        ) : (
          openBatches.map((b) => {
            const allowedPlans = allowedApplyPlansForBatch(b);
            let sched: Record<string, unknown> = {};
            try {
              sched = b.training_schedule_json ? JSON.parse(b.training_schedule_json) : {};
            } catch {
              sched = {};
            }
            const days = Array.isArray(sched.daysOfWeek) ? (sched.daysOfWeek as string[]).join(', ') : '—';
            const timing =
              sched.startTime && sched.endTime ? `${String(sched.startTime)}-${String(sched.endTime)}` : '—';
            return (
              <View key={b.id} style={styles.batchCard}>
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
                <Text style={styles.planHint}>Choose a payment option to apply:</Text>
                <View style={styles.planRow}>
                  {allowedPlans.map((plan) => {
                    const busy = applyBusyKey === `${b.id}:${plan}`;
                    return (
                      <TouchableOpacity
                        key={plan}
                        style={[styles.planBtn, busy && styles.planBtnDisabled]}
                        disabled={!!applyBusyKey}
                        onPress={() => void applyToBatch(b, plan)}
                      >
                        <Text style={styles.planBtnText}>
                          {busy ? 'Opening…' : `${applyPlanLabel(plan)} · ${formatInr(applyPlanAmount(course, plan))}`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {course.apply_enquiry_enabled === false || course.apply_enquiry_enabled === 0 ? null : (
                  <TouchableOpacity
                    style={styles.enquiryBtn}
                    onPress={() =>
                      navigation.navigate('ApplyCallback', {
                        courseId: course.id,
                        courseName: course.name,
                        batchId: b.id,
                      })
                    }
                  >
                    <Text style={styles.enquiryText}>Enquiry</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 32 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
  lead: { fontSize: 15, color: '#334155', marginBottom: 12, lineHeight: 22 },
  muted: { fontSize: 14, color: '#64748b', marginTop: 8 },
  batchCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  batchCardTitle: { fontSize: 15, fontWeight: '800', color: BRAND_BLUE, marginBottom: 8 },
  batchMeta: { fontSize: 13, color: '#475569', marginBottom: 4 },
  planHint: { fontSize: 13, fontWeight: '700', color: '#0f172a', marginTop: 10 },
  planRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  planBtn: {
    backgroundColor: BRAND_RED,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  planBtnDisabled: { opacity: 0.55 },
  planBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  enquiryBtn: {
    marginTop: 12,
    borderWidth: 1.5,
    borderColor: BRAND_BLUE,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  enquiryText: { color: BRAND_BLUE, fontWeight: '700', fontSize: 13 },
});
