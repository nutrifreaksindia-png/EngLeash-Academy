import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';

const BRAND_RED = '#c41e3a';

type Course = { id: number; name: string; description?: string; enrolled: boolean };

export default function CourseCatalogScreen({ navigation }: any) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrollingId, setEnrollingId] = useState<number | null>(null);

  const load = async () => {
    try {
      const data = await api.get('/courses/catalog');
      setCourses(data);
    } catch {
      setCourses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const goToCourse = (course: Course) => {
    navigation.navigate('MyCoursesList', {
      focusCourseId: course.id,
      focusCourseName: course.name,
    });
  };

  const enroll = async (courseId: number) => {
    setEnrollingId(courseId);
    try {
      await api.post('/enrollments/enroll', { course_id: courseId });
      setCourses((prev) => prev.map((c) => (c.id === courseId ? { ...c, enrolled: true } : c)));
      Alert.alert('Enrolled', 'You can now access this course from Home.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Enrollment failed');
    } finally {
      setEnrollingId(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenPageTitle title="Course catalog" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenPageTitle title="Course catalog" />
      <FlatList style={styles.listFlex}
        data={courses}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.cardContent}
              onPress={() => navigation.navigate('CourseDetail', { courseId: item.id, courseName: item.name })}
            >
              <Text style={styles.cardTitle}>{item.name}</Text>
              {item.description ? <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text> : null}
            </TouchableOpacity>
            {!item.enrolled ? (
              <TouchableOpacity
                style={[styles.enrollBtn, enrollingId === item.id && styles.enrollBtnDisabled]}
                onPress={() => enroll(item.id)}
                disabled={enrollingId !== null}
              >
                {enrollingId === item.id ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.enrollBtnText}>Enroll</Text>
                )}
              </TouchableOpacity>
            ) : (
              <View style={styles.activeWrap}>
                <View style={styles.enrolledBadge}>
                  <Text style={styles.enrolledText}>Active</Text>
                </View>
                <TouchableOpacity style={styles.enrollBtn} onPress={() => goToCourse(item)}>
                  <Text style={styles.enrollBtnText}>Go to Course</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  listFlex: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
  list: { padding: 20, paddingTop: 12, paddingBottom: 40 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardContent: { flex: 1 },
  activeWrap: { alignItems: 'flex-end', gap: 8 },
  cardTitle: { fontSize: 17, fontWeight: '600', color: '#333' },
  cardDesc: { fontSize: 14, color: '#666', marginTop: 4 },
  enrollBtn: { backgroundColor: BRAND_RED, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  enrollBtnDisabled: { opacity: 0.7 },
  enrollBtnText: { color: '#fff', fontWeight: '600' },
  enrolledBadge: { backgroundColor: '#e8f5e9', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  enrolledText: { color: '#2e7d32', fontWeight: '600', fontSize: 14 },
});
