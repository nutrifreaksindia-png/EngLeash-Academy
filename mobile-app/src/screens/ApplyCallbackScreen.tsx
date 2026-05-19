import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import CallbackBookingWizard from '../components/apply/CallbackBookingWizard';
import type { ApplyCallbackNavParams } from '../lib/applyNavigation';

export default function ApplyCallbackScreen({ navigation, route }: any) {
  const params: ApplyCallbackNavParams = {
    courseId: Number(route.params?.courseId),
    courseName: String(route.params?.courseName || 'Course'),
    batchId: route.params?.batchId ?? route.params?.batch_id ?? null,
    batchLabel: route.params?.batchLabel,
    noOpenBatches: route.params?.noOpenBatches ?? false,
    enquiryId: route.params?.enquiryId,
    editMode: route.params?.editMode,
    initialEnquiry: route.params?.initialEnquiry,
  };

  return (
    <View style={styles.root}>
      <ScreenPageTitle title={params.editMode ? 'Edit your call' : 'Book a call'} />
      <CallbackBookingWizard
        params={params}
        onDone={() => {
          if (navigation.canGoBack?.()) navigation.goBack();
          else navigation.navigate('LandingHome');
        }}
        onCancel={() => navigation.goBack()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
});
