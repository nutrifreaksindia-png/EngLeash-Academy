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

const BRAND_BLUE = '#1a237e';
const BRAND_RED = '#c41e3a';

function formatAmount(amountInr?: number, currency = 'INR') {
  const value = Number(amountInr || 0);
  if (String(currency || '').toUpperCase() === 'INR') {
    return `Rs. ${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${String(currency || '').toUpperCase()} ${value.toFixed(2)}`;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
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

export default function PaymentsInvoicesScreen() {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await api.get('/payments/my');
      setPayments(Array.isArray(rows) ? rows : []);
    } catch {
      setPayments([]);
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
    setDownloadingId(paymentId);
    try {
      const data = await api.get(`/payments/my/${paymentId}/invoice-link`);
      const url = String(data?.url || '').trim();
      if (!url) throw new Error('Invoice link not available');
      await Linking.openURL(url);
    } catch (error: any) {
      Alert.alert('Invoice', error?.message || 'Could not open invoice PDF');
    } finally {
      setDownloadingId(null);
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
            View your payment history and download invoice PDFs for course purchases and subscriptions.
          </Text>
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
                style={[styles.downloadBtn, (!payment.hasInvoice || downloadingId === payment.id) && styles.downloadBtnDisabled]}
                disabled={!payment.hasInvoice || downloadingId === payment.id}
                onPress={() => openInvoice(payment.id)}
              >
                <Text style={styles.downloadText}>
                  {downloadingId === payment.id ? 'Opening PDF...' : 'View / Download Invoice PDF'}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
          {payments.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No payments yet</Text>
              <Text style={styles.emptyText}>
                Course purchases and subscriptions will appear here with invoice downloads.
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
  downloadBtn: {
    marginTop: 16,
    backgroundColor: BRAND_BLUE,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  downloadBtnDisabled: { opacity: 0.55 },
  downloadText: { color: '#fff', fontSize: 13, fontWeight: '800' },
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
