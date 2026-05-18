import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { alertApplyPaymentError, payApplyDueWithRazorpay } from '../payments/razorpayApplyBilling';
import { alertBillingPaymentError, payBillingPackage } from '../payments/razorpayBillingPackage';

const BRAND_BLUE = '#1a237e';
const BRAND_RED = '#c41e3a';

function formatSubsDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatMoney(amount?: number | null) {
  return `Rs. ${Math.round(Number(amount || 0)).toLocaleString('en-IN')}`;
}

function formatTime12h(value?: string | null) {
  const raw = String(value || '').trim();
  const match = /^(\d{1,2}):(\d{2})/.exec(raw);
  if (!match) return raw;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return raw;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function formatBatchDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatAccountDate(value?: string | null) {
  if (!value) return '—';
  const text = String(value);
  const d = new Date(text.length === 10 ? `${text}T00:00:00` : text);
  if (Number.isNaN(d.getTime())) return text;
  return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}

function batchScheduleText(raw?: string | null) {
  try {
    const schedule = raw ? JSON.parse(raw) : {};
    const days = Array.isArray(schedule.daysOfWeek) ? schedule.daysOfWeek.join(', ') : '';
    const time = schedule.startTime && schedule.endTime
      ? `${formatTime12h(schedule.startTime)} - ${formatTime12h(schedule.endTime)}`
      : '';
    return [days, time].filter(Boolean).join(' · ') || 'Schedule not set';
  } catch {
    return 'Schedule not set';
  }
}

function dueTimingText(due?: any) {
  if (!due) return '—';
  if (due.dueDate) return formatAccountDate(due.dueDate);
  const offset = Number(due.meta?.dueOffsetDays);
  if (String(due.dueKind || '').toLowerCase() === 'installment' && Number.isFinite(offset)) {
    if (offset <= 0) return 'Course start date';
    return `${offset} day${offset === 1 ? '' : 's'} after course start`;
  }
  return '—';
}

function packageAmountInr(pkg?: any) {
  if (!pkg) return 0;
  return Math.max(0, Number(pkg.fee_inr || 0) - Number(pkg.discount_inr || 0));
}

export default function AccountScreen({ navigation }: any) {
  const { user, logout, refreshUser } = useAuth();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localPhotoUrl, setLocalPhotoUrl] = useState('');
  const [serverPhotoUrl, setServerPhotoUrl] = useState('');
  const [photoVersion, setPhotoVersion] = useState(0);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [batches, setBatches] = useState<any[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [applyProfiles, setApplyProfiles] = useState<any[]>([]);
  const [renewalPackagesByCourse, setRenewalPackagesByCourse] = useState<Record<string, any[]>>({});
  const [expandedBatchId, setExpandedBatchId] = useState<number | null>(null);
  const [expandedSubscriptionId, setExpandedSubscriptionId] = useState<number | null>(null);
  const [paymentBusyKey, setPaymentBusyKey] = useState<string | null>(null);
  const [partPaymentProfiles, setPartPaymentProfiles] = useState<Record<string, boolean>>({});

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
  const displayAddress = useMemo(() => {
    const parts = [
      studentProfile.address_line_1,
      studentProfile.address_line_2,
      studentProfile.city_district,
      studentProfile.state_province,
      studentProfile.country,
    ]
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    return parts.length ? parts.join(', ') : '-';
  }, [
    studentProfile.address_line_1,
    studentProfile.address_line_2,
    studentProfile.city_district,
    studentProfile.state_province,
    studentProfile.country,
  ]);

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

  useFocusEffect(
    useCallback(() => {
      if (!user) return undefined;
      let cancelled = false;
      setSubsLoading(true);
      setBatchesLoading(true);
      Promise.allSettled([api.get('/subscriptions/my'), api.get('/batch-manager'), api.get('/payments/apply/my')])
        .then(async ([subsResult, batchesResult, applyResult]) => {
          if (cancelled) return;
          const nextSubscriptions = subsResult.status === 'fulfilled' && Array.isArray(subsResult.value) ? subsResult.value : [];
          setSubscriptions(nextSubscriptions);
          setBatches(batchesResult.status === 'fulfilled' && Array.isArray(batchesResult.value) ? batchesResult.value : []);
          setApplyProfiles(applyResult.status === 'fulfilled' && Array.isArray(applyResult.value) ? applyResult.value : []);
          const courseIds = [...new Set(nextSubscriptions.map((s: any) => Number(s.courseId)).filter((id: number) => Number.isFinite(id)))];
          const packagePairs = await Promise.all(
            courseIds.map(async (courseId) => {
              try {
                const data = await api.publicGet(`/billing/public/course/${courseId}`);
                return [String(courseId), Array.isArray(data?.renewalPackages) ? data.renewalPackages : []] as const;
              } catch {
                return [String(courseId), []] as const;
              }
            }),
          );
          if (!cancelled) setRenewalPackagesByCourse(Object.fromEntries(packagePairs));
        })
        .finally(() => {
          if (!cancelled) {
            setSubsLoading(false);
            setBatchesLoading(false);
          }
        });
      return () => {
        cancelled = true;
      };
    }, [user]),
  );

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
    try {
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
    if (picked?.canceled) {
      return;
    }
    let file: any = null;
    if (Array.isArray((picked as any)?.assets) && (picked as any).assets.length > 0) {
      file = (picked as any).assets[0];
    } else if ((picked as any)?.uri) {
      // Legacy/alternate result shape fallback
      file = picked as any;
    }
    if (!file) {
      Alert.alert('Upload failed', 'Image picker returned no file. Please try again.');
      return;
    }
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
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Could not open image picker');
    }
  }

  function applyProfileForBatch(batch: any) {
    return applyProfiles.find((profile) => Number(profile.batchId) === Number(batch.id));
  }

  function nextPayableDue(profile?: any) {
    return (profile?.dueItems || []).find(
      (due: any) => due?.dueStatus !== 'paid' && due?.dueStatus !== 'cancelled' && Number(due?.amountDueNowInr || 0) > 0,
    );
  }

  function profileHasUnpaidParts(profile?: any) {
    return (profile?.dueItems || []).some(
      (due: any) =>
        String(due?.dueKind || '').toLowerCase() === 'installment' &&
        due?.dueStatus !== 'paid' &&
        due?.dueStatus !== 'cancelled' &&
        Number(due?.amountDueNowInr || 0) > 0,
    );
  }

  async function payApplyDue(profile: any, due: any) {
    if (!user || !due?.id) return;
    const key = `apply:${due.id}`;
    setPaymentBusyKey(key);
    try {
      const result = await payApplyDueWithRazorpay({
        dueItemId: due.id,
        userEmail: user.email,
        userName: user.name,
        userMobileDigits: user.mobile_number ?? undefined,
        checkoutTitle: `${profile?.courseName || 'Course'} — ${due.dueLabel || 'Payment'}`,
      });
      if (!result?.ok) return;
      Alert.alert('Payment successful', 'Your payment has been recorded.');
      refreshUser();
      const rows = await api.get('/payments/apply/my');
      setApplyProfiles(Array.isArray(rows) ? rows : []);
    } catch (error) {
      alertApplyPaymentError(error);
    } finally {
      setPaymentBusyKey(null);
    }
  }

  async function payRemainingFully(profile: any) {
    if (!user || !profile?.id) return;
    const key = `profile-full:${profile.id}`;
    setPaymentBusyKey(key);
    try {
      const prepared = await api.post(`/payments/apply/${profile.id}/pay-remaining-full`, {});
      const dueItemId = Number(prepared?.dueItemId);
      if (!Number.isFinite(dueItemId)) throw new Error('Remaining payment could not be prepared');
      const result = await payApplyDueWithRazorpay({
        dueItemId,
        userEmail: user.email,
        userName: user.name,
        userMobileDigits: user.mobile_number ?? undefined,
        checkoutTitle: `${profile.courseName || 'Course'} — Full payment`,
      });
      if (!result?.ok) return;
      Alert.alert('Payment successful', 'Your remaining fee has been paid.');
      refreshUser();
      const rows = await api.get('/payments/apply/my');
      setApplyProfiles(Array.isArray(rows) ? rows : []);
    } catch (error) {
      alertApplyPaymentError(error);
    } finally {
      setPaymentBusyKey(null);
    }
  }

  async function preparePartPayments(profile: any) {
    if (!profile?.id) return;
    const key = `profile-parts:${profile.id}`;
    setPaymentBusyKey(key);
    try {
      await api.post(`/payments/apply/${profile.id}/parts`, {});
      const rows = await api.get('/payments/apply/my');
      setApplyProfiles(Array.isArray(rows) ? rows : []);
      setPartPaymentProfiles((current) => ({ ...current, [String(profile.id)]: true }));
    } catch (error) {
      alertApplyPaymentError(error);
    } finally {
      setPaymentBusyKey(null);
    }
  }

  async function togglePartPayments(profile: any) {
    if (!profile?.id) return;
    const profileId = String(profile.id);
    const currentlySelected = !!partPaymentProfiles[profileId] || profileHasUnpaidParts(profile);
    if (currentlySelected) {
      setPartPaymentProfiles((current) => ({ ...current, [profileId]: false }));
      return;
    }
    if (profileHasUnpaidParts(profile)) {
      setPartPaymentProfiles((current) => ({ ...current, [profileId]: true }));
      return;
    }
    await preparePartPayments(profile);
  }

  async function payRenewalPackage(subscription: any, pkg: any) {
    if (!user || !pkg?.id) return;
    const key = `renewal:${subscription.id}:${pkg.id}`;
    setPaymentBusyKey(key);
    try {
      const ok = await payBillingPackage({
        billingPackageId: pkg.id,
        userEmail: user.email,
        userName: user.name,
        userMobileDigits: user.mobile_number ?? undefined,
        checkoutTitle: `${subscription.courseName || 'Course'} — Renewal`,
      });
      if (!ok) return;
      Alert.alert('Payment successful', 'Your renewal payment has been recorded.');
      refreshUser();
      const rows = await api.get('/subscriptions/my');
      setSubscriptions(Array.isArray(rows) ? rows : []);
    } catch (error) {
      alertBillingPaymentError(error);
    } finally {
      setPaymentBusyKey(null);
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
            <View style={styles.cardHeaderRow}>
              <Text style={styles.sectionTitle}>Profile</Text>
              <TouchableOpacity style={styles.iconBtn} onPress={() => setEditing((v) => !v)}>
                <Text style={styles.iconBtnText}>{editing ? 'Cancel' : 'Edit'}</Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.label, styles.spaceTop]}>Gender</Text>
            {editing ? <TextInput style={styles.input} value={form.gender} onChangeText={(value) => setForm((s) => ({ ...s, gender: value }))} /> : <Text style={styles.value}>{studentProfile.gender || '-'}</Text>}
            <Text style={[styles.label, styles.spaceTop]}>Birth Date</Text>
            {editing ? <TextInput style={styles.input} value={form.birthDate} onChangeText={(value) => setForm((s) => ({ ...s, birthDate: value }))} placeholder="YYYY-MM-DD" /> : <Text style={styles.value}>{displayBirthDate}</Text>}
            <Text style={[styles.label, styles.spaceTop]}>Address</Text>
            {editing ? (
              <>
                <TextInput style={styles.input} value={form.addressLine1} onChangeText={(value) => setForm((s) => ({ ...s, addressLine1: value }))} placeholder="Address line 1" />
                <TextInput style={styles.input} value={form.addressLine2} onChangeText={(value) => setForm((s) => ({ ...s, addressLine2: value }))} placeholder="Address line 2" />
                <TextInput style={styles.input} value={form.cityDistrict} onChangeText={(value) => setForm((s) => ({ ...s, cityDistrict: value }))} placeholder="City / District" />
                <TextInput style={styles.input} value={form.stateProvince} onChangeText={(value) => setForm((s) => ({ ...s, stateProvince: value }))} placeholder="State / Province" />
                <TextInput style={styles.input} value={form.country} onChangeText={(value) => setForm((s) => ({ ...s, country: value }))} placeholder="Country" />
              </>
            ) : (
              <Text style={styles.value}>{displayAddress}</Text>
            )}
            <Text style={[styles.label, styles.spaceTop]}>Occupation</Text>
            {editing ? <TextInput style={styles.input} value={form.occupation} onChangeText={(value) => setForm((s) => ({ ...s, occupation: value }))} /> : <Text style={styles.value}>{studentProfile.occupation || '-'}</Text>}
            {editing ? (
              <TouchableOpacity style={styles.primaryBtnSmallFull} onPress={saveProfile} disabled={busy}>
                <Text style={styles.primaryBtnText}>{busy ? 'Saving...' : 'Save profile'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Batches you're in</Text>
            {batchesLoading ? (
              <ActivityIndicator style={styles.spaceTop} color={BRAND_RED} />
            ) : batches.length === 0 ? (
              <Text style={styles.value}>You are not added to any batch yet.</Text>
            ) : (
              batches.map((batch, idx) => {
                const profile = applyProfileForBatch(batch);
                const due = nextPayableDue(profile);
                const expanded = expandedBatchId === Number(batch.id);
                const dueKey = due ? `apply:${due.id}` : '';
                return (
                  <View key={batch.id} style={[styles.subCard, idx > 0 ? styles.subCardSpaced : null]}>
                    <Text style={styles.subCourse}>
                      {batch.title || batch.name || `Batch #${batch.batch_number || batch.id}`}
                    </Text>
                    <Text style={styles.subMeta}>{batch.course_name || profile?.courseName || 'Course'}</Text>
                    {due ? (
                      <>
                        <TouchableOpacity
                          style={[styles.payBtn, paymentBusyKey === dueKey && styles.disabledBtn]}
                          disabled={!!paymentBusyKey}
                          onPress={() => payApplyDue(profile, due)}
                        >
                          <Text style={styles.payBtnText}>
                            {paymentBusyKey === dueKey ? 'Opening payment...' : `Pay ${formatMoney(due.amountDueNowInr)}`}
                          </Text>
                        </TouchableOpacity>
                        <Text style={styles.payDueOutside}>Due: {dueTimingText(due)}</Text>
                      </>
                    ) : (
                      <Text style={styles.subDates}>No payable batch dues right now.</Text>
                    )}
                    <TouchableOpacity style={styles.detailsBtn} onPress={() => setExpandedBatchId(expanded ? null : Number(batch.id))}>
                      <Text style={styles.detailsBtnText}>{expanded ? 'Hide Details' : 'More Details'}</Text>
                    </TouchableOpacity>
                    {expanded ? (
                      <View style={styles.expandedBox}>
                        <Text style={styles.subDetail}>
                          Batch {batch.batch_number || batch.id} · {batch.session_type === 'one_to_one' ? '1:1' : 'Group'}
                        </Text>
                        <Text style={styles.subDetail}>{batchScheduleText(batch.training_schedule_json)}</Text>
                        <Text style={styles.subDates}>
                          {String(batch.batch_status || '').toLowerCase() === 'started'
                            ? `Started ${formatBatchDate(batch.actual_start_date || batch.planned_start_date)}`
                            : `Starts ${formatBatchDate(batch.planned_start_date)}`}
                        </Text>
                        {profile ? (
                          <>
                            {(profile.dueItems || [])
                              .filter((item: any) => item.dueStatus !== 'cancelled')
                              .map((item: any) => (
                                <View key={item.id} style={styles.dueLine}>
                                  <Text style={styles.dueLineTitle}>{item.dueLabel || 'Payment'}</Text>
                                  {item.dueStatus === 'paid' ? (
                                    <>
                                      <Text style={styles.paidText}>Paid</Text>
                                      <Text style={styles.subfine}>Paid on: {formatAccountDate(item.satisfiedAt)}</Text>
                                    </>
                                  ) : (
                                    <>
                                      <Text style={styles.dueLineAmount}>{formatMoney(item.amountDueNowInr)}</Text>
                                      <Text style={styles.subfine}>{dueTimingText(item)}</Text>
                                    </>
                                  )}
                                </View>
                              ))}
                            {Number(profile.remainingBalanceInr || 0) > 0 ? (
                              <View style={styles.paymentOptionsBox}>
                                <TouchableOpacity
                                  style={[styles.smallActionBtn, paymentBusyKey === `profile-full:${profile.id}` && styles.disabledBtn]}
                                  disabled={!!paymentBusyKey}
                                  onPress={() => payRemainingFully(profile)}
                                >
                                  <Text style={styles.smallActionText}>Pay Fully</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[styles.checkboxRow, paymentBusyKey === `profile-parts:${profile.id}` && styles.disabledBtn]}
                                  disabled={!!paymentBusyKey}
                                  onPress={() => togglePartPayments(profile)}
                                >
                                  <View style={[
                                    styles.checkbox,
                                    (!!partPaymentProfiles[String(profile.id)] || profileHasUnpaidParts(profile)) && styles.checkboxChecked,
                                  ]}>
                                    {(!!partPaymentProfiles[String(profile.id)] || profileHasUnpaidParts(profile)) ? (
                                      <Text style={styles.checkboxTick}>✓</Text>
                                    ) : null}
                                  </View>
                                  <Text style={styles.checkboxText}>Part payments</Text>
                                </TouchableOpacity>
                              </View>
                            ) : null}
                          </>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Subscriptions & access</Text>
            {subsLoading ? (
              <ActivityIndicator style={styles.spaceTop} color={BRAND_RED} />
            ) : subscriptions.length === 0 ? (
              <Text style={styles.value}>No subscription or access grants on file.</Text>
            ) : (
              subscriptions.map((s, idx) => {
                const renewalPackages = renewalPackagesByCourse[String(s.courseId)] || [];
                const renewalPackage = renewalPackages[0] || null;
                const expanded = expandedSubscriptionId === Number(s.id);
                return (
                  <View key={s.id} style={[styles.subCard, idx > 0 ? styles.subCardSpaced : null]}>
                    <Text style={styles.subCourse}>{s.courseName || `Course #${s.courseId}`}</Text>
                    {renewalPackage ? (
                      <>
                        <TouchableOpacity
                          style={[styles.payBtn, paymentBusyKey === `renewal:${s.id}:${renewalPackage.id}` && styles.disabledBtn]}
                          disabled={!!paymentBusyKey}
                          onPress={() => payRenewalPackage(s, renewalPackage)}
                        >
                          <Text style={styles.payBtnText}>
                            {paymentBusyKey === `renewal:${s.id}:${renewalPackage.id}`
                              ? 'Opening payment...'
                              : `Pay ${formatMoney(packageAmountInr(renewalPackage))}`}
                          </Text>
                        </TouchableOpacity>
                        <Text style={styles.payDueOutside}>
                          Due: {s.isLifetime ? 'When you want to renew' : formatAccountDate(s.endsAtIso)}
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.subDates}>No renewal package available.</Text>
                    )}
                    <TouchableOpacity style={styles.detailsBtn} onPress={() => setExpandedSubscriptionId(expanded ? null : Number(s.id))}>
                      <Text style={styles.detailsBtnText}>{expanded ? 'Hide Details' : 'More Details'}</Text>
                    </TouchableOpacity>
                    {expanded ? (
                      <View style={styles.expandedBox}>
                        <Text style={styles.subMeta}>{s.sourceLabel || s.source}</Text>
                        {(s.durationUnit || s.durationCount != null) && !s.isLifetime ? (
                          <Text style={styles.subDetail}>
                            Subscription:{' '}
                            {String(s.durationUnit || '').toLowerCase() === 'day'
                              ? `${s.durationCount} day(s)`
                              : String(s.durationUnit || '').toLowerCase() === 'year'
                                ? `${s.durationCount} year(s)`
                                : `${s.durationCount} month(s)`}{' '}
                            · {String(s.packageKind || '') || 'subscription'}
                          </Text>
                        ) : null}
                        {s.batchTitle ? <Text style={styles.subDetail}>Batch: {s.batchTitle}</Text> : null}
                        <Text style={styles.subDates}>
                          {s.isLifetime
                            ? 'Full access · no end date'
                            : `${formatSubsDate(s.startsAtIso)} → ends ${formatSubsDate(s.endsAtIso)}`}
                        </Text>
                        {renewalPackages.length > 0 ? (
                          <View style={styles.renewalList}>
                            <Text style={styles.label}>Renewal details</Text>
                            {renewalPackages.map((pkg: any) => (
                              <Text key={pkg.id} style={styles.subDetail}>
                                {formatMoney(packageAmountInr(pkg))} · {pkg.duration_count}{' '}
                                {String(pkg.duration_unit || 'month').toLowerCase()}(s)
                              </Text>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
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
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  iconBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#eef2ff',
  },
  iconBtnText: { color: BRAND_BLUE, fontWeight: '800', fontSize: 12 },
  sectionCopy: { fontSize: 14, color: '#475569', lineHeight: 20 },
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
  primaryBtnSmallFull: {
    marginTop: 14,
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
  primaryActionBtn: {
    marginTop: 14,
    backgroundColor: BRAND_BLUE,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryActionBtnText: { color: '#fff', fontWeight: '800' },
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
  subCard: {
    borderWidth: 1,
    borderColor: '#e8ecf6',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#f8fafc',
  },
  subCardSpaced: { marginTop: 12 },
  subCourse: { fontSize: 16, fontWeight: '700', color: BRAND_BLUE },
  subMeta: { fontSize: 13, fontWeight: '600', color: '#475569', marginTop: 4 },
  subDetail: { fontSize: 13, color: '#64748b', marginTop: 4, lineHeight: 18 },
  subDates: { fontSize: 12, color: '#334155', marginTop: 6, lineHeight: 18 },
  subfine: { fontSize: 11, color: '#94a3b8', marginTop: 4 },
  payBtn: {
    marginTop: 10,
    backgroundColor: BRAND_BLUE,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  payBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  payDueOutside: { color: '#334155', fontWeight: '700', fontSize: 12, marginTop: 6 },
  disabledBtn: { opacity: 0.55 },
  detailsBtn: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  detailsBtnText: { color: BRAND_BLUE, fontWeight: '800', fontSize: 13 },
  expandedBox: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 10,
  },
  dueLine: {
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e8ecf6',
    padding: 10,
  },
  dueLineTitle: { color: '#334155', fontWeight: '800', fontSize: 13 },
  dueLineAmount: { color: BRAND_RED, fontWeight: '900', fontSize: 17, marginTop: 4 },
  paidText: { color: '#2e7d32', fontWeight: '900', fontSize: 17, marginTop: 4 },
  inlineActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  paymentOptionsBox: { marginTop: 10, gap: 10 },
  smallActionBtn: {
    backgroundColor: BRAND_RED,
    borderRadius: 9,
    paddingVertical: 10,
    alignItems: 'center',
  },
  smallActionText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  smallOutlineBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: BRAND_BLUE,
    borderRadius: 9,
    paddingVertical: 10,
    alignItems: 'center',
  },
  smallOutlineText: { color: BRAND_BLUE, fontWeight: '800', fontSize: 12 },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    borderRadius: 9,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: BRAND_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: BRAND_BLUE },
  checkboxTick: { color: '#fff', fontSize: 13, fontWeight: '900' },
  checkboxText: { color: BRAND_BLUE, fontWeight: '800', fontSize: 13 },
  renewalList: { marginTop: 10 },
});
