import React, { useEffect, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LoginForm from '../components/LoginForm';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

const BRAND_BLUE = '#1a237e';
const BRAND_RED = '#c41e3a';

export default function AccountScreen({ navigation }: any) {
  const { user, logout, refreshUser } = useAuth();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: '',
    mobileNumber: '',
    gender: '',
    birthDate: '',
    addressLine1: '',
    addressLine2: '',
    cityDistrict: '',
    stateProvince: '',
    country: '',
    countryCode: '',
    occupation: '',
  });

  const userAny = (user || {}) as any;
  const profile = userAny.profile || {};
  const studentProfile = userAny.studentProfile || {};
  const profilePhotoUrl = userAny.profile_photo_url || profile.profile_photo_url || '';

  useEffect(() => {
    if (!user) return;
    const nextUser: any = user;
    const nextProfile = nextUser.profile || {};
    const nextStudentProfile = nextUser.studentProfile || {};
    setForm({
      name: nextUser.name || '',
      mobileNumber: nextUser.mobile_number || nextProfile.mobile_number || '',
      gender: nextStudentProfile.gender || '',
      birthDate: nextStudentProfile.birth_date || '',
      addressLine1: nextStudentProfile.address_line_1 || '',
      addressLine2: nextStudentProfile.address_line_2 || '',
      cityDistrict: nextStudentProfile.city_district || '',
      stateProvince: nextStudentProfile.state_province || '',
      country: nextStudentProfile.country || '',
      countryCode: nextStudentProfile.country_code || '',
      occupation: nextStudentProfile.occupation || '',
    });
  }, [user]);

  async function saveProfile() {
    setBusy(true);
    try {
      await api.put('/users/me', { ...form, policiesAgreed: true });
      setEditing(false);
      refreshUser();
      Alert.alert('Saved', 'Profile updated successfully.');
    } catch (e: any) {
      Alert.alert('Profile', e?.message || 'Could not update profile');
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: 'image/*',
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.length) return;
    const file = picked.assets[0];
    const formData = new FormData();
    formData.append('file', {
      uri: file.uri,
      name: file.name || `profile-${Date.now()}.jpg`,
      type: file.mimeType || 'image/jpeg',
    } as any);
    setBusy(true);
    try {
      await api.postForm('/users/me/photo', formData);
      refreshUser();
      Alert.alert('Success', 'Profile photo updated.');
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Could not upload photo');
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <View style={styles.profileRoot}>
        <ScreenPageTitle title="My Account" />
        <ScrollView
          style={styles.container}
          contentContainerStyle={[styles.profileContent, { paddingBottom: 24 + insets.bottom }]}
        >
        <View style={styles.card}>
          {profilePhotoUrl ? <Image source={{ uri: profilePhotoUrl }} style={styles.avatar} /> : null}
          <TouchableOpacity style={styles.refreshBtn} onPress={uploadPhoto} disabled={busy}>
            <Text style={styles.refreshText}>{busy ? 'Please wait...' : 'Upload profile photo'}</Text>
          </TouchableOpacity>
          <Text style={styles.label}>Name</Text>
          {editing ? (
            <TextInput style={styles.input} value={form.name} onChangeText={(value) => setForm((s) => ({ ...s, name: value }))} />
          ) : (
            <Text style={styles.value}>{userAny.name}</Text>
          )}
          <Text style={[styles.label, { marginTop: 16 }]}>Email</Text>
          <Text style={styles.value}>{userAny.email}</Text>
          <Text style={[styles.label, { marginTop: 16 }]}>Mobile Number</Text>
          {editing ? (
            <TextInput style={styles.input} value={form.mobileNumber} onChangeText={(value) => setForm((s) => ({ ...s, mobileNumber: value }))} />
          ) : (
            <Text style={styles.value}>{userAny.mobile_number || '-'}</Text>
          )}
          <Text style={[styles.label, { marginTop: 16 }]}>Role</Text>
          <Text style={styles.value}>{userAny.role}</Text>
          <Text style={[styles.label, { marginTop: 16 }]}>Gender</Text>
          {editing ? <TextInput style={styles.input} value={form.gender} onChangeText={(value) => setForm((s) => ({ ...s, gender: value }))} /> : <Text style={styles.value}>{studentProfile.gender || '-'}</Text>}
          <Text style={[styles.label, { marginTop: 16 }]}>Birth Date</Text>
          {editing ? <TextInput style={styles.input} value={form.birthDate} onChangeText={(value) => setForm((s) => ({ ...s, birthDate: value }))} placeholder="YYYY-MM-DD" /> : <Text style={styles.value}>{studentProfile.birth_date || '-'}</Text>}
          <Text style={[styles.label, { marginTop: 16 }]}>Address Line 1</Text>
          {editing ? <TextInput style={styles.input} value={form.addressLine1} onChangeText={(value) => setForm((s) => ({ ...s, addressLine1: value }))} /> : <Text style={styles.value}>{studentProfile.address_line_1 || '-'}</Text>}
          <Text style={[styles.label, { marginTop: 16 }]}>Address Line 2</Text>
          {editing ? <TextInput style={styles.input} value={form.addressLine2} onChangeText={(value) => setForm((s) => ({ ...s, addressLine2: value }))} /> : <Text style={styles.value}>{studentProfile.address_line_2 || '-'}</Text>}
          <Text style={[styles.label, { marginTop: 16 }]}>City / District</Text>
          {editing ? <TextInput style={styles.input} value={form.cityDistrict} onChangeText={(value) => setForm((s) => ({ ...s, cityDistrict: value }))} /> : <Text style={styles.value}>{studentProfile.city_district || '-'}</Text>}
          <Text style={[styles.label, { marginTop: 16 }]}>State / Province</Text>
          {editing ? <TextInput style={styles.input} value={form.stateProvince} onChangeText={(value) => setForm((s) => ({ ...s, stateProvince: value }))} /> : <Text style={styles.value}>{studentProfile.state_province || '-'}</Text>}
          <Text style={[styles.label, { marginTop: 16 }]}>Country</Text>
          {editing ? <TextInput style={styles.input} value={form.country} onChangeText={(value) => setForm((s) => ({ ...s, country: value }))} /> : <Text style={styles.value}>{studentProfile.country || '-'}</Text>}
          <Text style={[styles.label, { marginTop: 16 }]}>Country Code</Text>
          {editing ? <TextInput style={styles.input} value={form.countryCode} onChangeText={(value) => setForm((s) => ({ ...s, countryCode: value }))} /> : <Text style={styles.value}>{studentProfile.country_code || '-'}</Text>}
          <Text style={[styles.label, { marginTop: 16 }]}>Occupation</Text>
          {editing ? <TextInput style={styles.input} value={form.occupation} onChangeText={(value) => setForm((s) => ({ ...s, occupation: value }))} /> : <Text style={styles.value}>{studentProfile.occupation || '-'}</Text>}
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={() => setEditing((v) => !v)}>
          <Text style={styles.refreshText}>{editing ? 'Cancel edit' : 'Edit profile'}</Text>
        </TouchableOpacity>
        {editing ? (
          <TouchableOpacity style={styles.refreshBtn} onPress={saveProfile} disabled={busy}>
            <Text style={styles.refreshText}>{busy ? 'Saving...' : 'Save profile'}</Text>
          </TouchableOpacity>
        ) : null}
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
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignSelf: 'center',
    marginBottom: 10,
  },
  label: { fontSize: 13, fontWeight: '600', color: '#666' },
  value: { fontSize: 17, color: '#222', marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#d7def0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
    color: '#1f2a44',
    backgroundColor: '#fff',
  },
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
