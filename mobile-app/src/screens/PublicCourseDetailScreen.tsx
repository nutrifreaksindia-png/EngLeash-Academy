import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { HtmlContent, htmlHasVisibleContent } from '../components/HtmlContent';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { PublicCourse } from './LandingHomeScreen';
import { API_BASE } from '../config';
import { applyPrimaryLabel, fetchActiveApplyEnquiry, navigateApplyForCourse } from '../lib/applyNavigation';
import type { ApplyEnquiry } from '../lib/applyNavigation';

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
  if (t === 'subscribe') return { label: 'Subscribe', kind: 'subscribe' as const };
  return { label: 'Join Free', kind: 'free' as const };
}

function formatModeLabel(m: string) {
  const s = String(m).trim();
  if (/^self-?paced$/i.test(s) || s === 'Self') return 'Self';
  return s;
}

export default function PublicCourseDetailScreen({ route, navigation }: any) {
  const { courseId, courseName } = route.params;
  const { user, refreshUser } = useAuth();
  const [course, setCourse] = useState<PublicCourse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [coverAspect, setCoverAspect] = useState<number | null>(null);
  const [applyEnquiry, setApplyEnquiry] = useState<ApplyEnquiry | null>(null);

  const coverUri = resolveAssetUrl(course?.image_url);

  useEffect(() => {
    setCoverAspect(null);
  }, [coverUri]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await api.publicGet(`/courses/public/${courseId}`);
      let enrolled = false;
      if (user?.id) {
        try {
          const catalog = await api.get('/courses/catalog');
          const match = Array.isArray(catalog)
            ? catalog.find((row: any) => Number(row?.id) === Number(courseId))
            : null;
          enrolled = !!match?.enrolled;
        } catch {
          enrolled = false;
        }
      }
      const next = detail ? { ...detail, enrolled } : null;
      setCourse(next);
      if (user?.id && next && String(next.enrollment_type || '').toLowerCase() === 'apply') {
        setApplyEnquiry(await fetchActiveApplyEnquiry(courseId));
      } else {
        setApplyEnquiry(null);
      }
    } catch {
      setCourse(null);
      setApplyEnquiry(null);
    } finally {
      setLoading(false);
    }
  }, [courseId, user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const goAccount = () => navigation.getParent()?.getParent()?.navigate('Account');
  const goToCourse = useCallback((targetCourse: PublicCourse) => {
    navigation.getParent()?.navigate?.('MyCourses', {
      screen: 'MyCoursesList',
      params: {
        focusCourseId: targetCourse.id,
        focusCourseName: targetCourse.name,
      },
    });
  }, [navigation]);

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
      load();
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
  const hasSpecs = htmlHasVisibleContent(course?.specifications_html);

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
  const showCoursePrice = cta.kind !== 'subscribe';
  const isActive = !!course.enrolled;
  const primaryLabel = isActive
    ? 'Go to Course'
    : cta.kind === 'apply'
      ? applyPrimaryLabel(course.enrollment_type, !!applyEnquiry)
      : cta.label;
  const onPrimaryAction = async () => {
    if (isActive) {
      goToCourse(course);
      return;
    }
    if (cta.kind === 'apply') {
      if (!user) {
        navigation.navigate('Signup', {
          redirectAfterSignup: 'apply',
          courseId: course.id,
          courseName: course.name,
        });
        return;
      }
      setBusy(true);
      try {
        await navigateApplyForCourse(navigation, course);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (cta.kind === 'purchase') {
      if (!user) {
        navigation.navigate('Signup', {
          redirectAfterSignup: 'purchase',
          courseId: course.id,
          courseName: course.name,
          courseFeeInr: course.fee_inr ?? 0,
          courseDiscountInr: course.discount_inr ?? 0,
        });
        return;
      }
      navigation.navigate('CoursePurchaseSummary', {
        courseId: course.id,
        courseName: course.name,
        fee_inr: course.fee_inr ?? 0,
        discount_inr: course.discount_inr ?? 0,
      });
      return;
    }
    if (cta.kind === 'subscribe') {
      if (!user) {
        navigation.navigate('Signup', {
          redirectAfterSignup: 'subscribe',
          courseId: course.id,
          courseName: course.name,
        });
        return;
      }
      navigation.navigate('CourseSubscribePackages', {
        courseId: course.id,
        courseName: course.name,
      });
      return;
    }
    void enroll('free');
  };

  return (
    <View style={styles.pageRoot}>
      <ScreenPageTitle title={pageHeading} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {coverUri ? (
          <Image
            source={{ uri: coverUri }}
            style={[styles.coverImg, coverAspect ? { aspectRatio: coverAspect } : styles.coverImgLoading]}
            resizeMode="contain"
            onLoad={(e) => {
              const { width, height } = e.nativeEvent.source;
              if (width > 0 && height > 0) setCoverAspect(width / height);
            }}
          />
        ) : null}
        {course.description ? <Text style={styles.desc}>{course.description}</Text> : null}
        {!showCoursePrice ? (
          <Text style={styles.price}>See packages</Text>
        ) : fee > 0 ? (
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
            <Text style={styles.metaLabel}>Mode:</Text> {modes.map(formatModeLabel).join(', ')}
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

        {hasSpecs && course.specifications_html ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Full Specifications</Text>
            <HtmlContent html={course.specifications_html} />
          </View>
        ) : null}

        <View style={styles.btnRow}>
          {isActive ? (
            <View style={styles.activeTag}>
              <Text style={styles.activeTagText}>Active</Text>
            </View>
          ) : null}
          <TouchableOpacity style={styles.btnPrimary} onPress={() => void onPrimaryAction()} disabled={busy}>
            <Text style={styles.btnPrimaryText}>{busy ? 'Please wait…' : primaryLabel}</Text>
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
  coverImg: { width: '100%', borderRadius: 14, marginBottom: 14, backgroundColor: '#dfe3f4' },
  coverImgLoading: { height: 200 },
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
  activeTag: {
    backgroundColor: '#e8f5e9',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  activeTagText: { color: '#2e7d32', fontWeight: '700', fontSize: 13 },
});
