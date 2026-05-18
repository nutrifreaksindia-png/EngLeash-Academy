import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { alertApplyPaymentError, payApplyDueWithRazorpay } from '../payments/razorpayApplyBilling';

const BRAND_BLUE = '#1a237e';
const BRAND_RED = '#c41e3a';

function formatAmount(amountInr?: number, currency = 'INR') {
  const value = Number(amountInr || 0);
  if (String(currency || '').toUpperCase() === 'INR') {
    return `₹${Math.round(value).toLocaleString('en-IN')}`;
  }
  return `${String(currency || '').toUpperCase()} ${Math.round(value).toLocaleString('en-IN')}`;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const text = String(value);
  const dt = new Date(text.length === 10 ? `${text}T00:00:00` : text);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

type PaymentRow = {
  id: number;
  title: string;
  packageLabel?: string;
  paymentKind?: string;
  orderKind?: string;
  amountInr?: number;
  currency?: string;
  paidAtIso?: string;
  invoiceNumber?: string;
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  status?: string;
  hasInvoice?: boolean;
};

type ApplyDueRow = {
  id: number;
  dueKind?: string;
  dueLabel: string;
  dueDate?: string | null;
  graceEndDate?: string | null;
  amountInr?: number;
  amountDueNowInr?: number;
  paidAmountInr?: number;
  dueStatus?: string;
  isInitialDue?: boolean;
  satisfiedAt?: string | null;
  invoicePayments?: { paymentRecordId: number; hasInvoice: boolean }[];
  meta?: {
    dueOffsetDays?: number;
    batchStarted?: boolean;
  };
};

type ApplyBillingRow = {
  id: number;
  courseName?: string;
  batchTitle?: string | null;
  batchNumber?: number | null;
  selectedPlanLabel?: string;
  status?: string;
  remainingBalanceInr?: number;
  dueItems?: ApplyDueRow[];
};

function hasPaidInitialDue(profile: ApplyBillingRow) {
  return (profile.dueItems || []).some((due) => due.isInitialDue && due.dueStatus === 'paid');
}

function hasUnpaidPart(profile: ApplyBillingRow) {
  return (profile.dueItems || []).some(
    (due) => String(due.dueKind || '').toLowerCase() === 'installment' && due.dueStatus !== 'paid' && due.dueStatus !== 'cancelled',
  );
}

function shouldShowDue(due: ApplyDueRow) {
  return due.dueStatus !== 'cancelled';
}

function dueTimingText(due: ApplyDueRow) {
  if (due.dueDate) return `Due on ${formatDate(due.dueDate)}`;
  const offset = Number(due.meta?.dueOffsetDays);
  if (String(due.dueKind || '').toLowerCase() === 'installment' && Number.isFinite(offset)) {
    if (offset <= 0) return 'Due from the course start date';
    return `Due ${offset} day${offset === 1 ? '' : 's'} after the course start date`;
  }
  return null;
}

export default function PaymentsInvoicesScreen() {
  const { user, refreshUser } = useAuth();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [applyProfiles, setApplyProfiles] = useState<ApplyBillingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [invoiceDownloadingKey, setInvoiceDownloadingKey] = useState<string | null>(null);
  const [payingDueId, setPayingDueId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [rows, applyRows] = await Promise.all([
        api.get('/payments/my'),
        api.get('/payments/apply/my'),
      ]);
      setPayments(Array.isArray(rows) ? rows : []);
      setApplyProfiles(Array.isArray(applyRows) ? applyRows : []);
    } catch {
      setPayments([]);
      setApplyProfiles([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function openInvoice(paymentId: number) {
    const key = `inv:${paymentId}`;
    setInvoiceDownloadingKey(key);
    try {
      const data = await api.get(`/payments/my/${paymentId}/invoice-link`);
      const url = String(data?.url || '').trim();
      if (!url) throw new Error('Invoice link not available');
      await Linking.openURL(url);
    } catch (error: any) {
      Alert.alert('Invoice', error?.message || 'Could not open invoice PDF');
    } finally {
      setInvoiceDownloadingKey(null);
    }
  }

  async function payDue(profile: ApplyBillingRow, due: ApplyDueRow) {
    if (!user || !due?.id) return;
    setPayingDueId(due.id);
    try {
      const result = await payApplyDueWithRazorpay({
        dueItemId: due.id,
        userEmail: user.email,
        userName: user.name,
        userMobileDigits: user.mobile_number ?? undefined,
        checkoutTitle: `${profile.courseName || 'Course'} — ${due.dueLabel}`,
      });
      if (!result?.ok) return;
      Alert.alert('Payment successful', 'Your apply-course due has been recorded.');
      refreshUser();
      load();
    } catch (error) {
      alertApplyPaymentError(error);
    } finally {
      setPayingDueId(null);
    }
  }

  async function payRemainingFully(profile: ApplyBillingRow) {
    if (!user || !profile?.id) return;
    setPayingDueId(-profile.id);
    try {
      const prepared = await api.post(`/payments/apply/${profile.id}/pay-remaining-full`, {});
      const dueItemId = Number(prepared?.dueItemId);
      if (!Number.isFinite(dueItemId)) throw new Error('Remaining balance could not be prepared');
      const result = await payApplyDueWithRazorpay({
        dueItemId,
        userEmail: user.email,
        userName: user.name,
        userMobileDigits: user.mobile_number ?? undefined,
        checkoutTitle: `${profile.courseName || 'Course'} — Remaining balance`,
      });
      if (!result?.ok) return;
      Alert.alert('Payment successful', 'Your remaining balance has been recorded.');
      refreshUser();
      load();
    } catch (error) {
      alertApplyPaymentError(error);
    } finally {
      setPayingDueId(null);
    }
  }

  async function preparePartPayments(profile: ApplyBillingRow) {
    if (!profile?.id) return;
    setPayingDueId(-profile.id);
    try {
      await api.post(`/payments/apply/${profile.id}/parts`, {});
      Alert.alert('Part payments ready', 'Your remaining balance is now available as part payments.');
      load();
    } catch (error) {
      alertApplyPaymentError(error);
    } finally {
      setPayingDueId(null);
    }
  }

  return (
    <View style={styles.root}>
      <ScreenPageTitle title="Payments & Invoices" />
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          <Text style={styles.intro}>
            View your payment history, invoice PDFs, and apply-course due schedules in one place.
          </Text>
          {applyProfiles.map((profile) => (
            <View key={`apply-${profile.id}`} style={styles.card}>
              <Text style={styles.title}>{profile.courseName || 'Apply course'}</Text>
              <Text style={styles.meta}>
                {profile.selectedPlanLabel || 'Apply plan'}
                {profile.batchTitle ? ` · ${profile.batchTitle}${profile.batchNumber ? ` (#${profile.batchNumber})` : ''}` : ''}
              </Text>
              {hasPaidInitialDue(profile) && Number(profile.remainingBalanceInr || 0) > 0 ? (
                <View style={styles.balanceActions}>
                  <TouchableOpacity
                    style={[styles.downloadBtn, payingDueId === -profile.id && styles.downloadBtnDisabled]}
                    disabled={payingDueId === -profile.id}
                    onPress={() => payRemainingFully(profile)}
                  >
                    <Text style={styles.downloadText}>
                      {payingDueId === -profile.id ? 'Opening payment...' : 'Pay remaining fully'}
                    </Text>
                  </TouchableOpacity>
                  {!hasUnpaidPart(profile) ? (
                    <TouchableOpacity
                      style={[styles.outlineBtn, payingDueId === -profile.id && styles.downloadBtnDisabled]}
                      disabled={payingDueId === -profile.id}
                      onPress={() => preparePartPayments(profile)}
                    >
                      <Text style={styles.outlineText}>Pay in parts</Text>
                    </TouchableOpacity>
                  ) : null}
                  <Text style={styles.detail}>
                    Full remaining payment keeps the extra single-payment discount unless you have already paid the first part.
                  </Text>
                </View>
              ) : null}
              {(profile.dueItems || []).filter(shouldShowDue).map((due) => {
                const invList = Array.isArray(due.invoicePayments) ? due.invoicePayments : [];
                const hasRecorded = due.dueStatus === 'paid' || Number(due.paidAmountInr || 0) > 0;
                return (
                  <View key={due.id} style={styles.dueCard}>
                    <Text style={styles.dueTitle}>{due.dueLabel}</Text>
                    {dueTimingText(due) && due.dueStatus !== 'paid' ? (
                      <Text style={styles.detail}>{dueTimingText(due)}</Text>
                    ) : null}
                    {due.dueStatus === 'paid' ? (
                      <Text style={styles.detail}>Paid on: {formatDate(due.satisfiedAt)}</Text>
                    ) : (
                      <>
                        {Number(due.paidAmountInr || 0) > 0 ? (
                          <Text style={styles.detail}>Paid so far: {formatAmount(due.paidAmountInr, 'INR')}</Text>
                        ) : null}
                        <Text style={styles.dueAmount}>{formatAmount(due.amountDueNowInr, 'INR')}</Text>
                        <TouchableOpacity
                          style={[styles.downloadBtn, payingDueId === due.id && styles.downloadBtnDisabled]}
                          disabled={payingDueId === due.id}
                          onPress={() => payDue(profile, due)}
                        >
                          <Text style={styles.downloadText}>
                            {payingDueId === due.id
                              ? 'Opening payment...'
                              : String(due.dueKind || '').toLowerCase() === 'installment'
                                ? 'Pay this part'
                                : 'Pay this due'}
                          </Text>
                        </TouchableOpacity>
                      </>
                    )}
                    {invList.map((inv, invIdx) => (
                      <TouchableOpacity
                        key={`inv-${due.id}-${inv.paymentRecordId}`}
                        style={[
                          styles.dueInvoiceBtn,
                          (!inv.hasInvoice || invoiceDownloadingKey !== null) && styles.downloadBtnDisabled,
                        ]}
                        disabled={!inv.hasInvoice || invoiceDownloadingKey !== null}
                        onPress={() => openInvoice(inv.paymentRecordId)}
                      >
                        <Text style={styles.downloadText}>
                          {!inv.hasInvoice
                            ? 'Invoice pending'
                            : invoiceDownloadingKey === `inv:${inv.paymentRecordId}`
                              ? 'Opening PDF...'
                              : invList.length > 1
                                ? `Download invoice (${invIdx + 1})`
                                : 'Download invoice PDF'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                    {hasRecorded && invList.length === 0 ? (
                      <Text style={styles.detail}>Invoice not linked for this payment yet.</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ))}
          {payments.map((payment) => (
            <View key={payment.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.title}>{payment.title || 'Payment'}</Text>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusText}>{String(payment.status || 'paid').toUpperCase()}</Text>
                </View>
              </View>
              {payment.packageLabel ? (
                <Text style={styles.meta}>{payment.packageLabel}</Text>
              ) : null}
              <Text style={styles.amount}>{formatAmount(payment.amountInr, payment.currency)}</Text>
              <Text style={styles.detail}>Invoice: {payment.invoiceNumber || 'Pending'}</Text>
              <Text style={styles.detail}>Paid on: {formatDate(payment.paidAtIso)}</Text>
              {payment.orderKind ? <Text style={styles.detail}>Type: {payment.orderKind}</Text> : null}
              {payment.gatewayOrderId ? <Text style={styles.detail}>Order ID: {payment.gatewayOrderId}</Text> : null}
              {payment.gatewayPaymentId ? <Text style={styles.detail}>Payment ID: {payment.gatewayPaymentId}</Text> : null}
              <TouchableOpacity
                style={[styles.downloadBtn, (!payment.hasInvoice || invoiceDownloadingKey !== null) && styles.downloadBtnDisabled]}
                disabled={!payment.hasInvoice || invoiceDownloadingKey !== null}
                onPress={() => openInvoice(payment.id)}
              >
                <Text style={styles.downloadText}>
                  {invoiceDownloadingKey === `inv:${payment.id}` ? 'Opening PDF...' : 'View / Download Invoice PDF'}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
          {payments.length === 0 && applyProfiles.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No payments yet</Text>
              <Text style={styles.emptyText}>
                Course purchases, subscriptions, and apply-course dues will appear here with invoice downloads.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f7fb' },
  scroll: { flex: 1, backgroundColor: '#f5f7fb' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 28, gap: 12 },
  intro: { fontSize: 14, color: '#475569', lineHeight: 21 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: { flex: 1, fontSize: 17, fontWeight: '800', color: BRAND_BLUE },
  statusBadge: {
    backgroundColor: '#e8f5e9',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusText: { color: '#2e7d32', fontSize: 11, fontWeight: '800' },
  meta: { marginTop: 6, fontSize: 13, color: '#475569', fontWeight: '600' },
  amount: { marginTop: 12, fontSize: 21, fontWeight: '800', color: BRAND_RED },
  detail: { marginTop: 6, fontSize: 13, color: '#475569', lineHeight: 18 },
  balanceActions: { marginTop: 10 },
  dueCard: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  dueTitle: { fontSize: 14, fontWeight: '800', color: BRAND_BLUE },
  dueAmount: { marginTop: 8, fontSize: 20, fontWeight: '900', color: BRAND_RED },
  downloadBtn: {
    marginTop: 16,
    backgroundColor: BRAND_BLUE,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  dueInvoiceBtn: {
    marginTop: 10,
    backgroundColor: BRAND_BLUE,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  downloadBtnDisabled: { opacity: 0.55 },
  downloadText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  outlineBtn: {
    marginTop: 10,
    borderWidth: 1.5,
    borderColor: BRAND_BLUE,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  outlineText: { color: BRAND_BLUE, fontSize: 13, fontWeight: '800' },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 18,
    alignItems: 'center',
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: BRAND_BLUE },
  emptyText: { marginTop: 8, fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 20 },
});
