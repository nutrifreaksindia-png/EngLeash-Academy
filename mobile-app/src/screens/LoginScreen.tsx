import React from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import LoginForm from '../components/LoginForm';

const BRAND_BLUE = '#1a237e';

/** Full-screen login (optional entry); primary login is on the Account tab. */
export default function LoginScreen({ navigation }: any) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.inner}>
        <LoginForm navigation={navigation} />
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
