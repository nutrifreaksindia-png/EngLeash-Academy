import React from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import LoginForm from '../components/LoginForm';
import {
  navigateLandingResumeCourseAfterAuth,
  navigatePurchaseSummaryAfterAuth,
  normalizeResumeCourseAuthParams,
  purchaseSummaryParamsFromRoute,
} from '../navigation/resumeCourseAfterAuth';

const BRAND_BLUE = '#1a237e';

/** Stack login; used from Account funnel and Apply/Purchase “sign in instead” with resume params. */
export default function LoginScreen({ navigation, route }: any) {
  const r = route?.params || {};
  const purchaseP = purchaseSummaryParamsFromRoute(r);
  const resume = normalizeResumeCourseAuthParams(r);
  const signupRouteParams =
    purchaseP != null
      ? {
          redirectAfterSignup: 'purchase' as const,
          courseId: purchaseP.courseId,
          courseName: purchaseP.courseName,
          courseFeeInr: purchaseP.fee_inr,
          courseDiscountInr: purchaseP.discount_inr,
        }
      : resume != null
        ? { redirectAfterSignup: resume.redirectAfterSignup, courseId: resume.courseId, courseName: resume.courseName }
        : undefined;

  function handleLoggedIn() {
    const tabNav = navigation.getParent?.()?.getParent?.() ?? navigation.getParent?.();
    if (navigatePurchaseSummaryAfterAuth(tabNav, purchaseP)) return;
    if (navigateLandingResumeCourseAfterAuth(tabNav, resume)) return;
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('AccountMain');
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.inner}>
        <LoginForm
          navigation={navigation}
          signupRouteParams={signupRouteParams}
          showSignupLink
          onLoggedIn={handleLoggedIn}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BRAND_BLUE,
    justifyContent: 'center',
    padding: 24,
  },
  inner: {},
});
