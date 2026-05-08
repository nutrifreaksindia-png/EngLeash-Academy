import React, { useEffect, useMemo, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
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
  const [localPhotoUrl, setLocalPhotoUrl] = useState('');
  const [serverPhotoUrl, setServerPhotoUrl] = useState('');
  const [photoVersion, setPhotoVersion] = useState(0);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
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
  const profilePhotoUrl = String(localPhotoUrl || serverPhotoUrl || userAny.profile_photo_url || profile.profile_photo_url || '').trim();
  const displayMobile = `${String(studentProfile.country_code || form.countryCode || '').trim()} ${String(userAny.mobile_number || form.mobileNumber || '').trim()}`.trim();
  const displayBirthDate = useMemo(() => {
    const raw = String(studentProfile.birth_date || '').trim();
    if (!raw) return '-';
    const dt = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(dt.getTime())) return raw;
    return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }, [studentProfile.birth_date]);

  const profileCompletion = useMemo(() => {
    const fields = [
      userAny.name,
      userAny.email,
      userAny.mobile_number,
      studentProfile.gender,
      studentProfile.birth_date,
      studentProfile.city_district,
      studentProfile.state_province,
      studentProfile.country,
      studentProfile.occupation,
      profilePhotoUrl,
    ];
    const done = fields.filter((x) => String(x || '').trim()).length;
    return Math.round((done / fields.length) * 100);
  }, [
    profilePhotoUrl,
    studentProfile.birth_date,
    studentProfile.city_district,
    studentProfile.country,
    studentProfile.gender,
    studentProfile.occupation,
    studentProfile.state_province,
    userAny.email,
    userAny.mobile_number,
    userAny.name,
  ]);

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

  useEffect(() => {
    setImageLoadFailed(false);
    setPhotoVersion((v) => v + 1);
  }, [localPhotoUrl, serverPhotoUrl, userAny.profile_photo_url, profile.profile_photo_url]);

  useFocusEffect(
    React.useCallback(() => {
      refreshUser();
    }, [refreshUser])
  );

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
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photo library access to upload a profile photo.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
      base64: true,
    });
    if (picked.canceled || !picked.assets?.length) return;
    const file = picked.assets[0];
    let uploadUri = String(file.uri || '').trim();
    if (!uploadUri) {
      Alert.alert('Upload failed', 'Selected image has no file path.');
      return;
    }
    // On some Android devices, cropped picker output is content:// and fails in multipart upload.
    // Copy to cache as file:// before appending to FormData.
    if (uploadUri.startsWith('content://')) {
      const ext = (file.mimeType || '').toLowerCase().includes('png') ? 'png' : 'jpg';
      const localPath = `${FileSystem.cacheDirectory || ''}profile-upload-${Date.now()}.${ext}`;
      await FileSystem.copyAsync({ from: uploadUri, to: localPath });
      uploadUri = localPath;
    }
    const formData = new FormData();
    formData.append('file', {
      uri: uploadUri,
      name: file.fileName || `profile-${Date.now()}.jpg`,
      type: file.mimeType || 'image/jpeg',
    } as any);
    setBusy(true);
    try {
      setImageLoadFailed(false);
      if (uploadUri) setLocalPhotoUrl(`${uploadUri}${uploadUri.includes('?') ? '&' : '?'}t=${Date.now()}`);
      const uploaded = await api.postForm('/users/me/photo', formData);
      const nextUrl = String(uploaded?.photoUrl || '').trim();
      if (nextUrl) {
        const sep = nextUrl.includes('?') ? '&' : '?';
        setLocalPhotoUrl('');
        setServerPhotoUrl(`${nextUrl}${sep}t=${Date.now()}`);
      }
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
        <ScrollView style={styles.container} contentContainerStyle={[styles.profileContent, { paddingBottom: 24 + insets.bottom }]}>
          <View style={styles.heroCard}>
            <View style={styles.avatarWrap}>
              {profilePhotoUrl ? (
                <Image
                  key={`profile-photo-${photoVersion}`}
                  source={{ uri: profilePhotoUrl }}
                  style={styles.avatar}
                  onError={() => {
                    setImageLoadFailed(true);
                  }}
                />
              ) : (
                <View style={styles.avatarFallback}>
                  <View style={styles.avatarHumanHead} />
                  <View style={styles.avatarHumanBody} />
                </View>
              )}
              <TouchableOpacity style={styles.avatarActionBtn} onPress={uploadPhoto} disabled={busy}>
                <Text style={styles.avatarActionText}>{profilePhotoUrl ? '✎' : '+'}</Text>
              </TouchableOpacity>
              {busy ? (
                <View style={styles.avatarBusy}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : null}
            </View>
            {imageLoadFailed ? <Text style={styles.avatarErrorText}>Could not render profile photo</Text> : null}
            {!profilePhotoUrl ? <Text style={styles.avatarHint}>Add profile photo</Text> : null}
            <Text style={styles.heroName}>{userAny.name || 'User'}</Text>
            <View style={styles.heroMetaRow}>
              <Text style={styles.heroEmail}>{userAny.email}</Text>
              <Text style={styles.heroMetaDivider}>•</Text>
              <Text style={styles.heroEmail}>{displayMobile || '-'}</Text>
            </View>
            <View style={styles.progressRow}>
              <Text style={styles.progressLabel}>Profile completion</Text>
              <Text style={styles.progressValue}>{profileCompletion}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${profileCompletion}%` }]} />
            </View>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Student profile</Text>
            <Text style={[styles.label, styles.spaceTop]}>Gender</Text>
            {editing ? <TextInput style={styles.input} value={form.gender} onChangeText={(value) => setForm((s) => ({ ...s, gender: value }))} /> : <Text style={styles.value}>{studentProfile.gender || '-'}</Text>}
            <Text style={[styles.label, styles.spaceTop]}>Birth Date</Text>
            {editing ? <TextInput style={styles.input} value={form.birthDate} onChangeText={(value) => setForm((s) => ({ ...s, birthDate: value }))} placeholder="YYYY-MM-DD" /> : <Text style={styles.value}>{displayBirthDate}</Text>}
            <Text style={[styles.label, styles.spaceTop]}>Address Line 1</Text>
            {editing ? <TextInput style={styles.input} value={form.addressLine1} onChangeText={(value) => setForm((s) => ({ ...s, addressLine1: value }))} /> : <Text style={styles.value}>{studentProfile.address_line_1 || '-'}</Text>}
            <Text style={[styles.label, styles.spaceTop]}>Address Line 2</Text>
            {editing ? <TextInput style={styles.input} value={form.addressLine2} onChangeText={(value) => setForm((s) => ({ ...s, addressLine2: value }))} /> : <Text style={styles.value}>{studentProfile.address_line_2 || '-'}</Text>}
            <Text style={[styles.label, styles.spaceTop]}>City / District</Text>
            {editing ? <TextInput style={styles.input} value={form.cityDistrict} onChangeText={(value) => setForm((s) => ({ ...s, cityDistrict: value }))} /> : <Text style={styles.value}>{studentProfile.city_district || '-'}</Text>}
            <Text style={[styles.label, styles.spaceTop]}>State / Province</Text>
            {editing ? <TextInput style={styles.input} value={form.stateProvince} onChangeText={(value) => setForm((s) => ({ ...s, stateProvince: value }))} /> : <Text style={styles.value}>{studentProfile.state_province || '-'}</Text>}
            <Text style={[styles.label, styles.spaceTop]}>Country</Text>
            {editing ? <TextInput style={styles.input} value={form.country} onChangeText={(value) => setForm((s) => ({ ...s, country: value }))} /> : <Text style={styles.value}>{studentProfile.country || '-'}</Text>}
            <Text style={[styles.label, styles.spaceTop]}>Occupation</Text>
            {editing ? <TextInput style={styles.input} value={form.occupation} onChangeText={(value) => setForm((s) => ({ ...s, occupation: value }))} /> : <Text style={styles.value}>{studentProfile.occupation || '-'}</Text>}
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => setEditing((v) => !v)}>
              <Text style={styles.ghostBtnText}>{editing ? 'Cancel edit' : 'Edit profile'}</Text>
            </TouchableOpacity>
            {editing ? (
              <TouchableOpacity style={styles.primaryBtnSmall} onPress={saveProfile} disabled={busy}>
                <Text style={styles.primaryBtnText}>{busy ? 'Saving...' : 'Save profile'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
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
      <KeyboardAvoidingView style={[styles.loginWrap, { paddingBottom: insets.bottom }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
  profileRoot: { flex: 1, backgroundColor: '#f5f7fb' },
  loginRoot: { flex: 1, backgroundColor: BRAND_BLUE },
  container: { flex: 1, backgroundColor: '#f5f7fb' },
  profileContent: { padding: 16, paddingTop: 12, gap: 12 },
  heroCard: {
    backgroundColor: '#1a237e',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  avatarWrap: {
    position: 'relative',
    width: 98,
    height: 98,
    marginBottom: 10,
  },
  avatar: {
    width: 98,
    height: 98,
    borderRadius: 49,
    borderWidth: 2,
    borderColor: '#fff',
  },
  avatarFallback: {
    width: 98,
    height: 98,
    borderRadius: 49,
    backgroundColor: '#3949ab',
    alignItems: 'center',
    justifyContent: 'flex-end',
    borderWidth: 2,
    borderColor: '#fff',
    overflow: 'hidden',
  },
  avatarHumanHead: {
    position: 'absolute',
    top: 20,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.58)',
  },
  avatarHumanBody: {
    width: 64,
    height: 38,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  avatarActionBtn: {
    position: 'absolute',
    right: -4,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#dbe3f0',
  },
  avatarActionText: {
    color: BRAND_BLUE,
    fontSize: 16,
    fontWeight: '800',
  },
  avatarBusy: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroName: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
  },
  heroEmail: {
    color: '#c7d2fe',
    fontSize: 13,
  },
  avatarHint: {
    color: '#c7d2fe',
    fontSize: 12,
    marginBottom: 6,
  },
  avatarErrorText: {
    color: '#fecaca',
    fontSize: 12,
    marginBottom: 6,
  },
  heroMetaRow: {
    marginTop: 4,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  heroMetaDivider: { color: '#93a0c6' },
  progressRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: { color: '#e8eaf6', fontSize: 12, fontWeight: '600' },
  progressValue: { color: '#fff', fontSize: 12, fontWeight: '700' },
  progressTrack: {
    width: '100%',
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#22c55e',
  },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e8ecf6',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1f2a44',
    marginBottom: 6,
  },
  label: { fontSize: 12, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase' },
  value: { fontSize: 16, color: '#111827', marginTop: 4 },
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
  spaceTop: { marginTop: 16 },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  primaryBtnSmall: {
    flex: 1,
    backgroundColor: BRAND_RED,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  ghostBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#eef2ff',
  },
  ghostBtnText: { color: BRAND_BLUE, fontWeight: '700' },
  refreshBtn: { marginTop: 6, paddingVertical: 12, alignItems: 'center' },
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
