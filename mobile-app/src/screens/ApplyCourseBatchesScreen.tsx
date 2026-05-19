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
import { callbackParamsForCourse, isApplyEnquiryEnabled } from '../lib/applyNavigation';

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
  return 'First part';
}

function applyPlanAmount(course: PublicCourse, plan: 'registration' | 'single_payment' | 'first_installment') {
  const total = Math.max(0, Number(course.fee_inr || 0) - Number(course.discount_inr || 0));
  const registration = Math.min(total, Number(course.apply_registration_fee_inr ?? 999));
  const singleDiscount = Math.max(0, Number(course.apply_single_payment_discount_inr || 0));
  const installmentCount = Math.max(1, Number(course.apply_installment_count || 2));
  if (plan === 'registration') return registration;
  if (plan === 'single_payment') return Math.max(0, total - singleDiscount);
  try {
    const amounts = JSON.parse(String(course.apply_installment_amounts_json || '[]'));
    const first = Array.isArray(amounts) ? Number(amounts[0]) : NaN;
    if (Number.isFinite(first)) return first;
  } catch {
    /* fall back to legacy even split */
  }
  return Math.ceil((total * 100) / installmentCount) / 100;
}

function netCourseFee(course: PublicCourse) {
  return Math.max(0, Number(course.fee_inr || 0) - Number(course.discount_inr || 0));
}

function addDaysYmd(ymd: string | null | undefined, days: number) {
  if (!ymd) return null;
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function partAmounts(course: PublicCourse) {
  const total = netCourseFee(course);
  const count = Math.max(1, Number(course.apply_installment_count || 2));
  try {
    const parsed = JSON.parse(String(course.apply_installment_amounts_json || '[]'));
    if (Array.isArray(parsed)) {
      const manual = parsed.slice(0, Math.max(0, count - 1)).map((x) => Math.max(0, Number(x || 0)));
      const last = Math.max(0, total - manual.reduce((sum, x) => sum + x, 0));
      if (manual.length === count - 1) return [...manual, last];
    }
  } catch {
    /* fall back to even parts */
  }
  const basePaise = Math.floor((total * 100) / count);
  let remainder = Math.round(total * 100) - basePaise * count;
  return Array.from({ length: count }, () => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return (basePaise + extra) / 100;
  });
}

function nextPartPreview(course: PublicCourse, batch: OpenBatch) {
  const amounts = partAmounts(course);
  const gapDays = Math.max(0, Number(course.apply_installment_gap_days || 0));
  const startYmd = startDateForBatch(batch);
  return amounts.slice(1).map((amount, index) => {
    const dueDate = addDaysYmd(startYmd, gapDays * (index + 1));
    return { amount, dueDate, offsetDays: gapDays * (index + 1) };
  });
}

function paymentDescription(course: PublicCourse, batch: OpenBatch, plan: 'registration' | 'single_payment' | 'first_installment') {
  const total = netCourseFee(course);
  const registration = Math.min(total, Number(course.apply_registration_fee_inr ?? 999));
  const singleDiscount = Math.max(0, Number(course.apply_single_payment_discount_inr || 0));
  if (plan === 'registration') {
    return `Reserve your seat in this batch by paying ${formatInr(registration)} now. The remaining course fee can be paid fully or in parts from the course start date.`;
  }
  if (plan === 'single_payment') {
    return singleDiscount > 0
      ? `Pay the full course fee now and receive an extra discount of ${formatInr(singleDiscount)}.`
      : 'Pay the full course fee now and complete your enrollment payment in one step.';
  }
  const previews = nextPartPreview(course, batch);
  if (!previews.length) return 'Pay your first part now and continue with the course payment schedule.';
  const started = String(batch.batch_status || '').toLowerCase() === 'started';
  const previewText = previews
    .map((p) => `${formatInr(p.amount)} ${started && p.dueDate ? `on ${formatDateFriendly(p.dueDate)}` : `after ${p.offsetDays} days from the course start date`}`)
    .join(', ');
  return `Pay your first part now. The next due${previews.length > 1 ? 's are' : ' is'}: ${previewText}.`;
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
  const [expandedBatchId, setExpandedBatchId] = useState<number | null>(null);

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
      loadBatches();
    }, [loadBatches]),
  );

  useEffect(() => {
    if (openBatchesLoading || !course?.id) return;
    if (openBatches.length > 0) return;
    if (!isApplyEnquiryEnabled(course)) return;
    navigation.replace(
      'ApplyCallback',
      callbackParamsForCourse(course, { noOpenBatches: true }),
    );
  }, [openBatchesLoading, openBatches.length, course, navigation]);

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
      Alert.alert('Enrolled', 'Payment successful. You are enrolled in this batch. Course access begins when the batch starts.');
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

  if (!openBatchesLoading && openBatches.length === 0 && isApplyEnquiryEnabled(course)) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={BRAND_RED} />
        <Text style={styles.muted}>Opening call booking…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingBottom: 12 + insets.bottom }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>Review the open batches, then enroll with a payment option or send an enquiry.</Text>
        {openBatchesLoading ? <ActivityIndicator color={BRAND_RED} style={styles.loading} /> : null}
        {!openBatchesLoading && openBatches.length === 0 && !isApplyEnquiryEnabled(course) ? (
          <Text style={styles.muted}>No open batches right now. Enquiries are disabled for this course.</Text>
        ) : null}
        {!openBatchesLoading && openBatches.length > 0 ? (
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
                <Text style={styles.batchMeta}>Course fee: {formatInr(netCourseFee(course))}</Text>
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.enrollBtn}
                    onPress={() => setExpandedBatchId((current) => (current === b.id ? null : b.id))}
                  >
                    <Text style={styles.enrollText}>{expandedBatchId === b.id ? 'Hide options' : 'Enroll'}</Text>
                  </TouchableOpacity>
                  {course.apply_enquiry_enabled === false || course.apply_enquiry_enabled === 0 ? null : (
                    <TouchableOpacity
                      style={styles.enquiryBtn}
                      onPress={() =>
                        navigation.navigate(
                          'ApplyCallback',
                          callbackParamsForCourse(course, { batch: b, noOpenBatches: false }),
                        )
                      }
                    >
                      <Text style={styles.enquiryText}>Book a call</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {expandedBatchId === b.id ? (
                  <View style={styles.paymentOptions}>
                    <Text style={styles.planHint}>Choose how you want to start:</Text>
                    {allowedPlans.map((plan) => {
                      const busy = applyBusyKey === `${b.id}:${plan}`;
                      return (
                        <TouchableOpacity
                          key={plan}
                          style={[styles.planCard, busy && styles.planBtnDisabled]}
                          disabled={!!applyBusyKey}
                          onPress={() => {
                            applyToBatch(b, plan);
                          }}
                        >
                          <Text style={styles.planCardTitle}>
                            {busy ? 'Opening…' : `${applyPlanLabel(plan)} ${formatInr(applyPlanAmount(course, plan))}`}
                          </Text>
                          <Text style={styles.planCardCopy}>{paymentDescription(course, b, plan)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })
        ) : null}
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
  loading: { marginVertical: 16 },
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
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  enrollBtn: {
    backgroundColor: BRAND_RED,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flex: 1,
    alignItems: 'center',
  },
  enrollText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  paymentOptions: { marginTop: 12, gap: 10 },
  planCard: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, backgroundColor: '#f8fafc' },
  planBtnDisabled: { opacity: 0.55 },
  planCardTitle: { color: BRAND_BLUE, fontWeight: '800', fontSize: 14 },
  planCardCopy: { color: '#475569', fontSize: 12, lineHeight: 18, marginTop: 6 },
  enquiryBtn: {
    borderWidth: 1.5,
    borderColor: BRAND_BLUE,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    paddingHorizontal: 12,
    flex: 1,
  },
  enquiryText: { color: BRAND_BLUE, fontWeight: '700', fontSize: 13 },
});
