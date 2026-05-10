import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { alertBillingPaymentError, payBillingPackage } from '../payments/razorpayBillingPackage';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

type PkgRow = {
  id: number;
  package_kind?: string;
  duration_unit?: string;
  duration_count?: number;
  fee_inr?: number;
  discount_inr?: number;
  sort_order?: number;
};

function formatInr(n?: number) {
  if (n == null || Number.isNaN(Number(n))) return '';
  return `₹${Math.max(0, Number(n)).toLocaleString('en-IN')}`;
}

function payable(p: PkgRow) {
  return Math.max(0, Number(p.fee_inr || 0) - Number(p.discount_inr || 0));
}

function durationLabel(u?: string, c?: number) {
  const n = Number(c) || 1;
  const raw = String(u || '').toLowerCase();
  if (raw === 'day') return n === 1 ? '1 day' : `${n} days`;
  if (raw === 'month') return n === 1 ? '1 month (30-day periods)' : `${n} months (30-day periods)`;
  if (raw === 'year') return n === 1 ? '1 year (365-day periods)' : `${n} years (365-day periods)`;
  return `${n} ${u || ''}`.trim();
}

export default function CourseSubscribePackagesScreen({ route, navigation }: any) {
  const { courseId, courseName } = route.params || {};
  const { user, refreshUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState<PkgRow[]>([]);
  const [rens, setRens] = useState<PkgRow[]>([]);
  const [payingId, setPayingId] = useState<number | null>(null);

  useEffect(() => {
    api
      .publicGet(`/billing/public/course/${courseId}`)
      .then((d: any) => {
        setSubs(Array.isArray(d?.subscriptionPackages) ? d.subscriptionPackages : []);
        setRens(Array.isArray(d?.renewalPackages) ? d.renewalPackages : []);
      })
      .catch(() => {
        setSubs([]);
        setRens([]);
      })
      .finally(() => setLoading(false));
  }, [courseId]);

  function goLoginForPurchase() {
    navigation.getParent()?.navigate?.('Account', {
      screen: 'Signup',
      params: { redirectAfterSignup: 'purchase', courseId: Number(courseId), courseName: String(courseName || '') },
    });
  }

  const ensureUser = (): boolean => {
    if (!user) {
      Alert.alert('Sign in required', 'Create an account or sign in to subscribe.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign up', onPress: goLoginForPurchase },
      ]);
      return false;
    }
    return true;
  };

  async function checkout(pkg: PkgRow, phase: 'sub' | 'renew') {
    if (!ensureUser()) return;
    const isRenew = phase === 'renew';
    const eff = payable(pkg);
    const title = `"${courseName || 'Course'}" — ${isRenew ? 'Renewal' : 'Subscribe'} (${durationLabel(pkg.duration_unit, pkg.duration_count)})`;
    Alert.alert('Confirm payment', `${title}\nAmount: ${formatInr(eff)}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Pay now',
        onPress: async () => {
          setPayingId(pkg.id);
          try {
            const ok = await payBillingPackage({
              billingPackageId: pkg.id,
              userEmail: user!.email,
              userName: user!.name,
              userMobileDigits: user!.mobile_number ?? undefined,
              checkoutTitle: title,
            });
            if (ok) {
              Alert.alert('Success', isRenew ? 'Renewal complete.' : 'Subscription active for the purchased period.');
              refreshUser();
              navigation.goBack();
            }
          } catch (e) {
            alertBillingPaymentError(e);
          } finally {
            setPayingId(null);
          }
        },
      },
    ]);
  }

  function renderPkg(p: PkgRow, phase: 'sub' | 'renew') {
    const eff = payable(p);
    const busyRow = payingId === p.id;
    return (
      <TouchableOpacity
        key={`${phase}-${p.id}`}
        style={styles.pkgCard}
        disabled={busyRow}
        onPress={() => void checkout(p, phase)}
      >
        <Text style={styles.pkgDuration}>{durationLabel(p.duration_unit, p.duration_count)}</Text>
        {(Number(p.discount_inr) || 0) > 0 ? (
          <Text style={styles.pkgPrice}>
            <Text style={styles.strike}>{formatInr(p.fee_inr)}</Text> {formatInr(eff)}
          </Text>
        ) : (
          <Text style={styles.pkgPrice}>{formatInr(eff)}</Text>
        )}
        {busyRow ? <ActivityIndicator color={BRAND_RED} /> : null}
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.pageRoot}>
      <ScreenPageTitle title={courseName || 'Plans'} />
      <ScrollView contentContainerStyle={styles.pad}>
        {loading ? (
          <ActivityIndicator size="large" color={BRAND_RED} style={{ marginTop: 40 }} />
        ) : (
          <>
            <Text style={styles.section}>Subscribe</Text>
            <Text style={styles.hint}>Choose a subscription period (includes a 7-day renewal grace window after expiry).</Text>
            {subs.length === 0 ? <Text style={styles.empty}>No subscription packages configured yet.</Text> : subs.map((p) => renderPkg(p, 'sub'))}

            <Text style={[styles.section, { marginTop: 28 }]}>Renewal</Text>
            <Text style={styles.hint}>Available while your access is active or within the grace period.</Text>
            {rens.length === 0 ? <Text style={styles.empty}>No renewal packages configured.</Text> : rens.map((p) => renderPkg(p, 'renew'))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: '#f5f5f5' },
  pad: { padding: 20, paddingBottom: 48 },
  section: { fontSize: 18, fontWeight: '800', color: BRAND_BLUE },
  hint: { fontSize: 14, color: '#555', marginTop: 6, marginBottom: 12, lineHeight: 20 },
  empty: { color: '#777', marginBottom: 12 },
  pkgCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  pkgDuration: { fontSize: 16, fontWeight: '700', color: '#111' },
  pkgPrice: { fontSize: 18, marginTop: 8, fontWeight: '700', color: BRAND_BLUE },
  strike: { textDecorationLine: 'line-through', color: '#9ca3af', fontWeight: '500', fontSize: 14 },
});
