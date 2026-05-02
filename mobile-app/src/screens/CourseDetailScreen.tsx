import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';

const BRAND_RED = '#c41e3a';

type Lesson = { id: number; title: string; sort_order: number };

export default function CourseDetailScreen({ route, navigation }: any) {
  const { courseId, courseName } = route.params;
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/lessons/course/${courseId}`)
      .then(setLessons)
      .catch(() => setLessons([]))
      .finally(() => setLoading(false));
  }, [courseId]);

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

  return (
    <View style={styles.pageRoot}>
      <ScreenPageTitle title={courseName || 'Course'} />
      <View style={styles.container}>
      <Text style={styles.subtitle}>Lessons</Text>
      <FlatList style={styles.listFlex}
        data={lessons}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No lessons yet.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('LessonDetail', { lessonId: item.id, lessonTitle: item.title })}
          >
            <Text style={styles.cardTitle}>{item.title}</Text>
          </TouchableOpacity>
        )}
      />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  listFlex: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  subtitle: { fontSize: 16, fontWeight: '600', color: '#666', paddingHorizontal: 20, marginTop: 8, marginBottom: 12 },
  list: { padding: 20, paddingBottom: 40 },
  empty: { color: '#666', textAlign: 'center', paddingVertical: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: BRAND_RED,
  },
  cardTitle: { fontSize: 17, fontWeight: '600', color: '#333' },
});
