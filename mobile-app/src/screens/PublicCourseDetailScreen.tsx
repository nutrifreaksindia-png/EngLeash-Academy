import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { PublicCourse } from './LandingHomeScreen';
import { API_BASE } from '../config';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

function formatInr(n?: number) {
  if (n == null || Number.isNaN(Number(n))) return '';
  return `₹${Number(n).toLocaleString('en-IN')}`;
}

function resolveAssetUrl(url?: string | null) {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const apiBase = String(API_BASE || '').replace(/\/+$/, '');
  return apiBase ? `${apiBase}${url.startsWith('/') ? '' : '/'}${url}` : null;
}

function parseJsonList(raw?: string | null) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function plainTextFromHtml(raw?: string) {
  if (!raw) return '';
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseHighlights(raw?: string | null) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    // ignore
  }
  return plainTextFromHtml(raw)
    .split(/\s+[•\-]\s+|\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function primaryCta(typeRaw?: string) {
  const t = (typeRaw || 'free').toLowerCase();
  if (t === 'apply') return { label: 'Apply', kind: 'apply' as const };
  if (t === 'purchase') return { label: 'Purchase', kind: 'purchase' as const };
  return { label: 'Join Free', kind: 'free' as const };
}

export default function PublicCourseDetailScreen({ route, navigation }: any) {
  const { courseId, courseName } = route.params;
  const { user, refreshUser } = useAuth();
  const [course, setCourse] = useState<PublicCourse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .publicGet(`/courses/public/${courseId}`)
      .then(setCourse)
      .catch(() => setCourse(null))
      .finally(() => setLoading(false));
  }, [courseId]);

  const goAccount = () => navigation.getParent()?.getParent()?.navigate('Account');

  const enroll = async (typeOverride?: string) => {
    if (!course) return;
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in from the Account tab.', [{ text: 'OK', onPress: goAccount }]);
      return;
    }
    setBusy(true);
    try {
      const type = typeOverride ?? course.enrollment_type ?? 'free';
      await api.post('/enrollments/enroll', { course_id: course.id, enrollmentType: type });
      Alert.alert('Success', 'Your enrollment request was submitted.');
      refreshUser();
    } catch (e: any) {
      Alert.alert('Enrollment', e?.message || 'Could not complete enrollment');
    } finally {
      setBusy(false);
    }
  };

  const pageHeading = course?.name || courseName || 'Course';
  const modes = useMemo(() => parseJsonList(course?.modes_json), [course?.modes_json]);
  const languages = useMemo(() => parseJsonList(course?.languages_json), [course?.languages_json]);
  const highlights = useMemo(() => parseHighlights(course?.highlights), [course?.highlights]);
  const specsText = useMemo(() => plainTextFromHtml(course?.specifications_html), [course?.specifications_html]);

  if (loading) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title={courseName || 'Course'} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      </View>
    );
  }

  if (!course) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title={courseName || 'Course'} />
        <View style={styles.centered}>
          <Text style={styles.err}>Course not found or unpublished.</Text>
        </View>
      </View>
    );
  }

  const fee = course.fee_inr ?? 0;
  const disc = course.discount_inr ?? 0;
  const eff = Math.max(0, fee - disc);
  const cta = primaryCta(course.enrollment_type);
  const onPrimaryAction = () => {
    if (cta.kind === 'apply') {
      void enroll('apply');
      return;
    }
    if (cta.kind === 'purchase') {
      Alert.alert('Purchase', 'Online purchase will be available soon.');
      return;
    }
    void enroll('free');
  };

  return (
    <View style={styles.pageRoot}>
      <ScreenPageTitle title={pageHeading} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {resolveAssetUrl(course.image_url) ? (
          <Image source={{ uri: resolveAssetUrl(course.image_url) || '' }} style={styles.coverImg} resizeMode="cover" />
        ) : null}
        {course.description ? <Text style={styles.desc}>{course.description}</Text> : null}
        {fee > 0 ? (
          <Text style={styles.price}>
            {disc > 0 ? (
              <>
                <Text style={styles.strike}>{formatInr(fee)}</Text> {formatInr(eff)}
              </>
            ) : (
              formatInr(fee)
            )}
          </Text>
        ) : (
          <Text style={styles.price}>Free</Text>
        )}

        {modes.length > 0 ? (
          <Text style={styles.metaRow}>
            <Text style={styles.metaLabel}>Mode:</Text> {modes.join(', ')}
          </Text>
        ) : null}
        {languages.length > 0 ? (
          <Text style={styles.metaRow}>
            <Text style={styles.metaLabel}>Language medium:</Text> {languages.join(', ')}
          </Text>
        ) : null}

        {highlights.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Course Highlights</Text>
            {highlights.map((h) => (
              <Text key={h} style={styles.bullet}>
                • {h}
              </Text>
            ))}
          </View>
        ) : null}

        {specsText ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Full Specifications</Text>
            <Text style={styles.specText}>{specsText}</Text>
          </View>
        ) : null}

        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.btnPrimary} onPress={onPrimaryAction} disabled={busy}>
            <Text style={styles.btnPrimaryText}>{busy ? 'Please wait…' : cta.label}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnOutline}
            onPress={() => {
              if (navigation.canGoBack?.()) {
                navigation.goBack();
              } else {
                navigation.navigate('LandingHome');
              }
            }}
          >
            <Text style={styles.btnOutlineText}>Back to Courses</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 20, paddingBottom: 40 },
  coverImg: { width: '100%', height: 200, borderRadius: 14, marginBottom: 14, backgroundColor: '#dfe3f4' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  err: { color: '#666', textAlign: 'center' },
  desc: { fontSize: 15, color: '#444', lineHeight: 22 },
  price: { fontSize: 16, fontWeight: '700', color: BRAND_BLUE, marginTop: 16 },
  strike: { textDecorationLine: 'line-through', color: '#999', fontWeight: '400' },
  metaRow: { marginTop: 10, color: '#334155', fontSize: 14 },
  metaLabel: { fontWeight: '700', color: '#0f172a' },
  block: { marginTop: 16, padding: 14, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb' },
  blockTitle: { fontWeight: '700', color: '#1f2937', marginBottom: 8, fontSize: 15 },
  bullet: { fontSize: 14, color: '#374151', marginBottom: 6, lineHeight: 20 },
  specText: { fontSize: 14, color: '#374151', lineHeight: 21 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 24 },
  btnOutline: {
    borderWidth: 1.5,
    borderColor: BRAND_BLUE,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  btnOutlineText: { color: BRAND_BLUE, fontWeight: '700', fontSize: 13 },
  btnPrimary: { backgroundColor: BRAND_RED, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
