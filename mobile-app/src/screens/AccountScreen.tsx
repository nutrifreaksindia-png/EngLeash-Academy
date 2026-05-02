import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LoginForm from '../components/LoginForm';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { useAuth } from '../context/AuthContext';

const BRAND_BLUE = '#1a237e';
const BRAND_RED = '#c41e3a';

export default function AccountScreen({ navigation }: any) {
  const { user, logout, refreshUser } = useAuth();
  const insets = useSafeAreaInsets();

  if (user) {
    return (
      <View style={styles.profileRoot}>
        <ScreenPageTitle title="My Account" />
        <ScrollView
          style={styles.container}
          contentContainerStyle={[styles.profileContent, { paddingBottom: 24 + insets.bottom }]}
        >
        <View style={styles.card}>
          <Text style={styles.label}>Name</Text>
          <Text style={styles.value}>{user.name}</Text>
          <Text style={[styles.label, { marginTop: 16 }]}>Email</Text>
          <Text style={styles.value}>{user.email}</Text>
          <Text style={[styles.label, { marginTop: 16 }]}>Role</Text>
          <Text style={styles.value}>{user.role}</Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={() => refreshUser()}>
          <Text style={styles.refreshText}>Refresh profile</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.logoutBtn} onPress={() => logout()}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.loginRoot}>
      <ScreenPageTitle title="My Account" />
      <KeyboardAvoidingView
        style={[styles.loginWrap, { paddingBottom: insets.bottom }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.signInTitle}>Sign in</Text>
        <Text style={styles.signInSub}>Sign in to access My Courses, Sessions, and Assignments.</Text>
        <LoginForm navigation={navigation} showSignupLink />
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  profileRoot: { flex: 1, backgroundColor: '#f5f5f5' },
  loginRoot: { flex: 1, backgroundColor: BRAND_BLUE },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  profileContent: { padding: 20, paddingTop: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: BRAND_RED,
  },
  label: { fontSize: 13, fontWeight: '600', color: '#666' },
  value: { fontSize: 17, color: '#222', marginTop: 4 },
  refreshBtn: { marginTop: 16, paddingVertical: 12, alignItems: 'center' },
  refreshText: { color: BRAND_BLUE, fontWeight: '700' },
  logoutBtn: {
    marginTop: 8,
    backgroundColor: BRAND_RED,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  loginWrap: { flex: 1, backgroundColor: BRAND_BLUE },
  loginScroll: { padding: 20, paddingTop: 12 },
  signInTitle: { fontSize: 26, fontWeight: '800', color: '#fff', marginBottom: 8 },
  signInSub: { fontSize: 15, color: '#e8eaf6', marginBottom: 20, lineHeight: 22 },
});
