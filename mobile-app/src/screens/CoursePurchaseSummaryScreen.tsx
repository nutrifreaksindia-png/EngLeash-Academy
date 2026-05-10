import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { useAuth } from '../context/AuthContext';
import { alertPurchaseError, purchaseCourseWithRazorpay } from '../payments/razorpayCoursePurchase';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

function formatInr(n: number) {
  return `₹${Math.max(0, n).toLocaleString('en-IN')}`;
}

export default function CoursePurchaseSummaryScreen({ route, navigation }: any) {
  const { courseId, courseName, fee_inr, discount_inr } = route.params || {};
  const { user, refreshUser } = useAuth();
  const [busy, setBusy] = useState(false);

  const eff = useMemo(() => Math.max(0, Number(fee_inr || 0) - Number(discount_inr || 0)), [fee_inr, discount_inr]);

  const confirmPay = async () => {
    if (!user) {
      navigation.getParent()?.navigate?.('Account', {
        screen: 'Signup',
        params: {
          redirectAfterSignup: 'purchase',
          courseId,
          courseName,
          courseFeeInr: fee_inr ?? 0,
          courseDiscountInr: discount_inr ?? 0,
        },
      });
      return;
    }

    Alert.alert(
      'Confirm payment',
      `One-time lifetime purchase for "${courseName || 'Course'}" totaling ${formatInr(eff)}. Proceed to Razorpay?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Pay now',
          onPress: async () => {
            setBusy(true);
            try {
              const ok = await purchaseCourseWithRazorpay({
                courseId: Number(courseId),
                courseDisplayName: String(courseName || 'Course'),
                userEmail: user.email,
                userName: user.name,
                userMobileDigits: user.mobile_number ?? undefined,
              });
              if (ok) {
                Alert.alert('Success', 'Payment successful. You now have unlimited access.');
                refreshUser();
                navigation.goBack();
              }
            } catch (e) {
              alertPurchaseError(e);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.pageRoot}>
      <ScreenPageTitle title="Purchase summary" />
      <ScrollView contentContainerStyle={styles.box}>
        <Text style={styles.title}>{courseName || 'Course'}</Text>
        <Text style={styles.label}>Enrollment</Text>
        <Text style={styles.val}>One-time lifetime purchase — access does not expire.</Text>

        {(Number(discount_inr) || 0) > 0 ? (
          <>
            <Text style={styles.label}>List price</Text>
            <Text style={[styles.price, styles.strike]}>{formatInr(Number(fee_inr) || 0)}</Text>
            <Text style={styles.label}>You pay</Text>
            <Text style={styles.price}>{formatInr(eff)}</Text>
          </>
        ) : (
          <>
            <Text style={styles.label}>Price</Text>
            <Text style={styles.price}>{formatInr(Number(fee_inr) || 0)}</Text>
          </>
        )}

        <TouchableOpacity style={styles.btnPrimary} disabled={busy} onPress={() => void confirmPay()}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Proceed to secure payment</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: '#f5f5f5' },
  box: { padding: 24, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '800', color: BRAND_BLUE, marginBottom: 20 },
  label: { fontSize: 13, color: '#666', marginTop: 12 },
  val: { fontSize: 16, color: '#111', lineHeight: 22 },
  price: { fontSize: 24, fontWeight: '700', color: BRAND_BLUE },
  strike: { textDecorationLine: 'line-through', color: '#999', fontWeight: '500' },
  btnPrimary: { marginTop: 28, backgroundColor: BRAND_RED, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
