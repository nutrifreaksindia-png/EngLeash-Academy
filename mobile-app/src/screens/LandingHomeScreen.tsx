import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../config';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

export type PublicCourse = {
  id: number;
  name: string;
  description?: string;
  image_url?: string | null;
  highlights?: string | null;
  specifications_html?: string;
  modes_json?: string | null;
  languages_json?: string | null;
  fee_inr?: number;
  discount_inr?: number;
  enrollment_type?: string;
};

const SERVICES = [
  'Spoken English & communication skills',
  'IELTS / exam-oriented coaching',
  'One-to-one and small-group live sessions',
  'Assignments with trainer feedback',
];

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

function primaryCta(typeRaw?: string) {
  const t = (typeRaw || 'free').toLowerCase();
  if (t === 'apply') return { label: 'Apply', kind: 'apply' as const };
  if (t === 'purchase') return { label: 'Purchase', kind: 'purchase' as const };
  return { label: 'Join Free', kind: 'free' as const };
}

export default function LandingHomeScreen({ navigation }: any) {
  const { user, refreshUser } = useAuth();
  const insets = useSafeAreaInsets();
  const [courses, setCourses] = useState<PublicCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [enrollingId, setEnrollingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.publicGet('/courses/public');
      setCourses(Array.isArray(data) ? data : []);
    } catch {
      setCourses([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const goAccount = () => navigation.getParent()?.getParent()?.navigate('Account');

  const enroll = async (course: PublicCourse, typeOverride?: string) => {
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in from the Account tab to continue.', [
        { text: 'OK', onPress: goAccount },
      ]);
      return;
    }
    setEnrollingId(course.id);
    try {
      const type = typeOverride ?? course.enrollment_type ?? 'free';
      await api.post('/enrollments/enroll', { course_id: course.id, enrollmentType: type });
      Alert.alert('Success', 'Your enrollment request was submitted.');
      refreshUser();
    } catch (e: any) {
      Alert.alert('Enrollment', e?.message || 'Could not complete enrollment');
    } finally {
      setEnrollingId(null);
    }
  };

  const onJoinFree = (course: PublicCourse) => {
    const t = (course.enrollment_type || 'free').toLowerCase();
    if (t !== 'free') {
      Alert.alert('Join Free', 'This course is not a free-enrollment course. Try Apply or Purchase.');
      return;
    }
    enroll(course, 'free');
  };

  const onApply = (course: PublicCourse) => {
    enroll(course, course.enrollment_type || 'application');
  };

  const onPurchase = () => {
    Alert.alert('Purchase', 'Online purchase will be available soon. Use Apply or Join Free where applicable, or contact us.');
  };

  const onPrimaryAction = (course: PublicCourse) => {
    const cta = primaryCta(course.enrollment_type);
    if (cta.kind === 'apply') {
      onApply(course);
      return;
    }
    if (cta.kind === 'purchase') {
      onPurchase();
      return;
    }
    onJoinFree(course);
  };

  if (loading) {
    return (
      <View style={styles.root}>
        <ScreenPageTitle title="Home" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingBottom: 8 + insets.bottom }]}>
      <ScreenPageTitle title="Home" />
      <FlatList style={styles.listFlex}
        data={courses}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <Text style={styles.heroTitle}>EngLeash Academy</Text>
            <Text style={styles.heroSub}>Learn English with live sessions, structured courses, and real feedback.</Text>
            <Text style={styles.sectionLabel}>What we offer</Text>
            {SERVICES.map((line) => (
              <Text key={line} style={styles.bullet}>
                • {line}
              </Text>
            ))}
            <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Courses</Text>
            <Text style={styles.hint}>Browse offerings below. Sign in from Account to enroll.</Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>No published courses yet.</Text>}
        renderItem={({ item }) => {
          const fee = item.fee_inr ?? 0;
          const disc = item.discount_inr ?? 0;
          const eff = Math.max(0, fee - disc);
          const type = (item.enrollment_type || 'free').toLowerCase();
          return (
            <View style={styles.card}>
              {resolveAssetUrl(item.image_url) ? (
                <Image source={{ uri: resolveAssetUrl(item.image_url) || '' }} style={styles.coverImg} resizeMode="cover" />
              ) : (
                <View style={styles.coverFallback}>
                  <Text style={styles.coverFallbackText}>{item.name}</Text>
                </View>
              )}
              <Text style={styles.cardTitle}>{item.name}</Text>
              {item.description ? (
                <Text style={styles.cardDesc} numberOfLines={3}>
                  {item.description}
                </Text>
              ) : null}
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
              <View style={styles.btnRow}>
                <TouchableOpacity
                  style={[styles.btnPrimary, type !== 'free' && primaryCta(item.enrollment_type).kind === 'free' && styles.btnMuted]}
                  onPress={() => onPrimaryAction(item)}
                  disabled={enrollingId !== null}
                >
                  <Text style={styles.btnPrimaryText}>{enrollingId === item.id ? '…' : primaryCta(item.enrollment_type).label}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.btnOutline}
                  onPress={() =>
                    navigation.navigate('PublicCourseDetail', {
                      courseId: item.id,
                      courseName: item.name,
                    })
                  }
                >
                  <Text style={styles.btnOutlineText}>See Full Specifications</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  listFlex: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingHorizontal: 16, paddingBottom: 72 },
  headerBlock: { paddingTop: 12, paddingBottom: 8 },
  heroTitle: { fontSize: 26, fontWeight: '800', color: BRAND_BLUE },
  heroSub: { fontSize: 15, color: '#444', marginTop: 8, lineHeight: 22 },
  sectionLabel: { fontSize: 17, fontWeight: '700', color: '#222', marginTop: 16 },
  bullet: { fontSize: 15, color: '#333', marginTop: 8, lineHeight: 22 },
  hint: { fontSize: 13, color: '#666', marginTop: 6 },
  empty: { color: '#666', paddingVertical: 24, textAlign: 'center' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e8eaf6',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  coverImg: { width: '100%', height: 170, borderRadius: 12, backgroundColor: '#dfe3f4' },
  coverFallback: {
    width: '100%',
    height: 170,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    backgroundColor: '#e8eaf6',
  },
  coverFallbackText: { color: BRAND_BLUE, fontWeight: '700', textAlign: 'center' },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#222' },
  cardDesc: { fontSize: 14, color: '#555', marginTop: 6 },
  price: { fontSize: 15, fontWeight: '600', color: BRAND_BLUE, marginTop: 8 },
  strike: { textDecorationLine: 'line-through', color: '#999', fontWeight: '400' },
  btnRow: { flexDirection: 'row', marginTop: 14, gap: 8, flexWrap: 'wrap' },
  btnOutline: {
    borderWidth: 1.5,
    borderColor: BRAND_BLUE,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  btnOutlineText: { color: BRAND_BLUE, fontWeight: '700', fontSize: 13 },
  btnPrimary: { backgroundColor: BRAND_RED, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 },
  btnMuted: { opacity: 0.45 },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
