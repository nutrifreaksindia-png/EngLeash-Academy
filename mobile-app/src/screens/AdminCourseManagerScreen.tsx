import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';

const BRAND_BLUE = '#1a237e';
const BRAND_RED = '#c41e3a';

type Course = {
  id: number;
  name: string;
  description?: string;
};

type Lesson = {
  id: number;
  title: string;
  sort_order: number;
  video_url?: string | null;
};

export default function AdminCourseManagerScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [lessonsLoading, setLessonsLoading] = useState(false);
  const [uploadingLessonId, setUploadingLessonId] = useState<number | null>(null);

  const [courseName, setCourseName] = useState('');
  const [courseDescription, setCourseDescription] = useState('');
  const [lessonTitle, setLessonTitle] = useState('');
  const [lessonOrder, setLessonOrder] = useState('1');

  const loadCourses = useCallback(async () => {
    try {
      const data = await api.get('/courses');
      const rows = Array.isArray(data) ? data : [];
      setCourses(rows);
      if (!selectedCourseId && rows.length > 0) {
        setSelectedCourseId(rows[0].id);
      } else if (selectedCourseId && !rows.some((c: Course) => c.id === selectedCourseId)) {
        setSelectedCourseId(rows[0]?.id ?? null);
      }
    } catch {
      setCourses([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCourseId]);

  const loadLessons = useCallback(async () => {
    if (!selectedCourseId) {
      setLessons([]);
      return;
    }
    setLessonsLoading(true);
    try {
      const data = await api.get(`/lessons/course/${selectedCourseId}`);
      setLessons(Array.isArray(data) ? data : []);
    } catch {
      setLessons([]);
    } finally {
      setLessonsLoading(false);
    }
  }, [selectedCourseId]);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  useEffect(() => {
    loadLessons();
  }, [loadLessons]);

  const createCourse = async () => {
    if (!courseName.trim()) {
      Alert.alert('Missing field', 'Course name is required.');
      return;
    }
    try {
      const created = await api.post('/courses', {
        name: courseName.trim(),
        description: courseDescription.trim() || undefined,
      });
      setCourseName('');
      setCourseDescription('');
      await loadCourses();
      if (created?.id) setSelectedCourseId(created.id);
      Alert.alert('Done', 'Course created.');
    } catch (e: any) {
      Alert.alert('Create failed', e?.message || 'Could not create course');
    }
  };

  const createLesson = async () => {
    if (!selectedCourseId) {
      Alert.alert('Select course', 'Select a course first.');
      return;
    }
    if (!lessonTitle.trim()) {
      Alert.alert('Missing field', 'Lesson title is required.');
      return;
    }
    const parsedOrder = Number(lessonOrder);
    try {
      await api.post('/lessons', {
        course_id: selectedCourseId,
        title: lessonTitle.trim(),
        sort_order: Number.isFinite(parsedOrder) ? parsedOrder : 0,
      });
      setLessonTitle('');
      setLessonOrder(String((Number.isFinite(parsedOrder) ? parsedOrder : 0) + 1));
      await loadLessons();
      Alert.alert('Done', 'Lesson created.');
    } catch (e: any) {
      Alert.alert('Create failed', e?.message || 'Could not create lesson');
    }
  };

  const pickAndUploadVideo = async (lessonId: number) => {
    try {
      const pick = await DocumentPicker.getDocumentAsync({
        type: ['video/*'],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (pick.canceled || !pick.assets?.[0]) return;
      const asset = pick.assets[0];
      const name = asset.name || `lesson-${lessonId}.mp4`;
      const mimeType = asset.mimeType || 'video/mp4';

      const form = new FormData();
      form.append('file', {
        uri: asset.uri,
        name,
        type: mimeType,
      } as any);

      setUploadingLessonId(lessonId);
      await api.postForm(`/uploads/lesson/${lessonId}/video`, form);
      await loadLessons();
      Alert.alert('Uploaded', 'Lesson video uploaded to cloud storage.');
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Could not upload lesson video');
    } finally {
      setUploadingLessonId(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title="Manage courses" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      </View>
    );
  }

  const selectedCourseName = courses.find((c) => c.id === selectedCourseId)?.name || 'None';

  return (
    <View style={styles.pageRoot}>
      <ScreenPageTitle title="Manage courses" />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadCourses();
              loadLessons();
            }}
          />
        }
      >
      <Text style={styles.heading}>Create course</Text>
      <View style={styles.card}>
        <TextInput
          style={styles.input}
          value={courseName}
          onChangeText={setCourseName}
          placeholder="Course name"
          placeholderTextColor="#777"
        />
        <TextInput
          style={[styles.input, styles.inputMultiline]}
          value={courseDescription}
          onChangeText={setCourseDescription}
          placeholder="Course description"
          placeholderTextColor="#777"
          multiline
        />
        <TouchableOpacity style={styles.primaryBtn} onPress={createCourse}>
          <Text style={styles.primaryBtnText}>Create course</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.heading}>Select course</Text>
      <FlatList
        data={courses}
        horizontal
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.courseChips}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.chip, item.id === selectedCourseId && styles.chipActive]}
            onPress={() => setSelectedCourseId(item.id)}
          >
            <Text style={[styles.chipText, item.id === selectedCourseId && styles.chipTextActive]} numberOfLines={1}>
              {item.name}
            </Text>
          </TouchableOpacity>
        )}
      />

      <Text style={styles.heading}>Create lesson</Text>
      <View style={styles.card}>
        <Text style={styles.metaText}>Selected course: {selectedCourseName}</Text>
        <TextInput
          style={styles.input}
          value={lessonTitle}
          onChangeText={setLessonTitle}
          placeholder="Lesson title"
          placeholderTextColor="#777"
        />
        <TextInput
          style={styles.input}
          value={lessonOrder}
          onChangeText={setLessonOrder}
          placeholder="Sort order"
          placeholderTextColor="#777"
          keyboardType="number-pad"
        />
        <TouchableOpacity style={styles.primaryBtn} onPress={createLesson}>
          <Text style={styles.primaryBtnText}>Create lesson</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.heading}>Lessons in selected course</Text>
      {lessonsLoading ? (
        <View style={styles.centeredSmall}>
          <ActivityIndicator size="small" color={BRAND_RED} />
        </View>
      ) : lessons.length === 0 ? (
        <Text style={styles.empty}>No lessons yet.</Text>
      ) : (
        lessons.map((lesson) => (
          <View key={lesson.id} style={styles.lessonRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.lessonTitle}>
                {lesson.sort_order}. {lesson.title}
              </Text>
              <Text style={styles.lessonMeta} numberOfLines={1}>
                {lesson.video_url ? 'Video set' : 'No video yet'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.uploadBtn, uploadingLessonId === lesson.id && styles.uploadBtnDisabled]}
              onPress={() => pickAndUploadVideo(lesson.id)}
              disabled={uploadingLessonId !== null}
            >
              {uploadingLessonId === lesson.id ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.uploadBtnText}>{lesson.video_url ? 'Replace Video' : 'Upload Video'}</Text>
              )}
            </TouchableOpacity>
          </View>
        ))
      )}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 32 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  centeredSmall: { paddingVertical: 16, alignItems: 'center' },
  heading: { marginTop: 12, marginBottom: 8, fontSize: 18, fontWeight: '700', color: BRAND_BLUE },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: BRAND_RED,
    padding: 12,
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: '#222',
    backgroundColor: '#fff',
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  primaryBtn: {
    marginTop: 4,
    backgroundColor: BRAND_BLUE,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 12,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  courseChips: { gap: 8, paddingBottom: 4 },
  chip: {
    backgroundColor: '#fff',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BRAND_BLUE,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 200,
  },
  chipActive: { backgroundColor: BRAND_BLUE },
  chipText: { color: BRAND_BLUE, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  metaText: { color: '#444', fontSize: 13 },
  empty: { color: '#666', fontStyle: 'italic', marginTop: 8 },
  lessonRow: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  lessonTitle: { fontSize: 15, fontWeight: '600', color: '#222' },
  lessonMeta: { marginTop: 3, color: '#666', fontSize: 12 },
  uploadBtn: {
    backgroundColor: BRAND_RED,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  uploadBtnDisabled: { opacity: 0.75 },
  uploadBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
