import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

type LessonData = {
  id: number;
  title: string;
  videoUrl: string | null;
  allowVideoDownload: boolean;
  classNotes: { id: number; title: string; fileUrl: string }[];
  worksheets: { id: number; title: string; fileUrl: string }[];
  quiz: { id: number; title: string; questions: { id: number; question_text: string; options: string[] }[] } | null;
  quizAssignments?: { id: number; quiz_title?: string }[];
  videoAssignments?: { id: number; video_id: number; video_title?: string; video_description?: string; video_url?: string }[];
  studyMaterialAssignments?: { id: number; material_id: number; material_title?: string; material_description?: string }[];
  libraryWorksheetAssignments?: {
    id: number;
    worksheet_id: number;
    worksheet_title?: string;
    worksheet_description?: string;
  }[];
  orderedContent?: {
    orderIndex: number;
    type: string;
    id: number;
    title?: string;
    description?: string;
    videoUrl?: string | null;
    quizAssignmentId?: number | null;
  }[];
};

export default function LessonDetailScreen({ route, navigation }: any) {
  const { lessonId, lessonTitle } = route.params;
  const [data, setData] = useState<LessonData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/lessons/${lessonId}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [lessonId]);

  if (loading) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title={lessonTitle || 'Lesson'} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      </View>
    );
  }
  if (!data) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title={lessonTitle || 'Lesson'} />
        <View style={styles.centered}>
          <Text style={styles.error}>Failed to load lesson.</Text>
        </View>
      </View>
    );
  }

  const ordered = data.orderedContent;

  if (ordered != null) {
    if (ordered.length === 0) {
      return (
        <View style={styles.pageRoot}>
          <ScreenPageTitle title={data.title || lessonTitle || 'Lesson'} />
          <View style={styles.centered}>
            <Text style={styles.sectionSub}>No content has been added to this lesson yet.</Text>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title={data.title || lessonTitle || 'Lesson'} />
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
          {ordered.map((row) => {
            const label = row.title || 'Item';
            const sub = row.description || '';
            const key = `${row.type}-${row.id}-${row.orderIndex}`;
            if (row.type === 'video') {
              return (
                <TouchableOpacity
                  key={key}
                  style={styles.section}
                  onPress={() =>
                    navigation.navigate('VideoPlayer', {
                      lessonId,
                      videoUrl: row.videoUrl || data.videoUrl,
                      allowDownload: data.allowVideoDownload,
                    })
                  }
                >
                  <Text style={styles.sectionTitle}>{label}</Text>
                  <Text style={styles.sectionSub}>{sub || `Stream only${!data.allowVideoDownload ? ' (no download)' : ''}`}</Text>
                </TouchableOpacity>
              );
            }
            if (row.type === 'study_material') {
              return (
                <TouchableOpacity
                  key={key}
                  style={styles.section}
                  onPress={() =>
                    navigation.navigate('StudyMaterial', {
                      materialId: row.id,
                      materialTitle: label,
                    })
                  }
                >
                  <Text style={styles.sectionTitle}>{label}</Text>
                  <Text style={styles.sectionSub}>{sub || 'Study material'}</Text>
                </TouchableOpacity>
              );
            }
            if (row.type === 'worksheet') {
              return (
                <TouchableOpacity
                  key={key}
                  style={styles.section}
                  onPress={() =>
                    navigation.navigate('WorksheetLibrary', {
                      worksheetId: row.id,
                      worksheetTitle: label,
                    })
                  }
                >
                  <Text style={styles.sectionTitle}>{label}</Text>
                  <Text style={styles.sectionSub}>{sub || 'Worksheet'}</Text>
                </TouchableOpacity>
              );
            }
            if (row.type === 'quiz') {
              return (
                <TouchableOpacity
                  key={key}
                  style={styles.section}
                  onPress={() =>
                    navigation.navigate('Quiz', {
                      lessonId,
                      assignmentId: row.quizAssignmentId,
                    })
                  }
                >
                  <Text style={styles.sectionTitle}>{label}</Text>
                  <Text style={styles.sectionSub}>{sub || 'Quiz'}</Text>
                </TouchableOpacity>
              );
            }
            if (row.type === 'assignment') {
              return (
                <TouchableOpacity
                  key={key}
                  style={styles.section}
                  onPress={() =>
                    navigation.navigate('AssignmentLibraryDetail', {
                      assignmentId: row.id,
                      title: label,
                    })
                  }
                >
                  <Text style={styles.sectionTitle}>{label}</Text>
                  <Text style={styles.sectionSub}>{sub || 'Assignment'}</Text>
                </TouchableOpacity>
              );
            }
            return null;
          })}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.pageRoot}>
      <ScreenPageTitle title={data.title || lessonTitle || 'Lesson'} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {(data.videoAssignments || []).length > 0 ? (
        (data.videoAssignments || []).map((v) => (
          <TouchableOpacity
            key={`vid-${v.id}`}
            style={styles.section}
            onPress={() => navigation.navigate('VideoPlayer', { lessonId, videoUrl: v.video_url, allowDownload: data.allowVideoDownload })}
          >
            <Text style={styles.sectionTitle}>{v.video_title || 'Lesson video'}</Text>
            <Text style={styles.sectionSub}>{v.video_description || `Stream only${!data.allowVideoDownload ? ' (no download)' : ''}`}</Text>
          </TouchableOpacity>
        ))
      ) : (
        <TouchableOpacity
          style={styles.section}
          onPress={() => navigation.navigate('VideoPlayer', { lessonId, videoUrl: data.videoUrl, allowDownload: data.allowVideoDownload })}
        >
          <Text style={styles.sectionTitle}>Lesson video</Text>
          <Text style={styles.sectionSub}>Stream only{!data.allowVideoDownload ? ' (no download)' : ''}</Text>
        </TouchableOpacity>
      )}

      {data.classNotes.length > 0 && (
        <TouchableOpacity
          style={styles.section}
          onPress={() => navigation.navigate('ClassNotes', { notes: data.classNotes })}
        >
          <Text style={styles.sectionTitle}>Class notes</Text>
          <Text style={styles.sectionSub}>View & download</Text>
        </TouchableOpacity>
      )}

      {data.quiz && (
        <TouchableOpacity
          style={styles.section}
          onPress={() => navigation.navigate('Quiz', { lessonId, quiz: data.quiz })}
        >
          <Text style={styles.sectionTitle}>Quiz</Text>
          <Text style={styles.sectionSub}>{data.quiz.questions.length} questions</Text>
        </TouchableOpacity>
      )}

      {!data.quiz && (data.quizAssignments || []).length > 0 && (
        <TouchableOpacity
          style={styles.section}
          onPress={() => navigation.navigate('Quiz', { lessonId, assignmentId: data.quizAssignments?.[0]?.id })}
        >
          <Text style={styles.sectionTitle}>Quiz</Text>
          <Text style={styles.sectionSub}>{data.quizAssignments?.[0]?.quiz_title || 'Assigned quiz'}</Text>
        </TouchableOpacity>
      )}

      {(data.studyMaterialAssignments || []).length > 0 && (
        (data.studyMaterialAssignments || []).map((m) => (
          <TouchableOpacity
            key={`sm-${m.id}`}
            style={styles.section}
            onPress={() => navigation.navigate('StudyMaterial', { materialId: m.material_id, materialTitle: m.material_title || 'Study material' })}
          >
            <Text style={styles.sectionTitle}>{m.material_title || 'Study material'}</Text>
            <Text style={styles.sectionSub}>{m.material_description || 'Rich content for this lesson'}</Text>
          </TouchableOpacity>
        ))
      )}

      {(data.libraryWorksheetAssignments || []).length > 0 &&
        (data.libraryWorksheetAssignments || []).map((w) => (
          <TouchableOpacity
            key={`lws-${w.id}`}
            style={styles.section}
            onPress={() =>
              navigation.navigate('WorksheetLibrary', {
                worksheetId: w.worksheet_id,
                worksheetTitle: w.worksheet_title || 'Worksheet',
              })
            }
          >
            <Text style={styles.sectionTitle}>{w.worksheet_title || 'Worksheet'}</Text>
            <Text style={styles.sectionSub}>{w.worksheet_description || 'Interactive worksheet content'}</Text>
          </TouchableOpacity>
        ))}

      {data.worksheets.length > 0 && (
        <TouchableOpacity
          style={styles.section}
          onPress={() => navigation.navigate('Worksheet', { worksheets: data.worksheets })}
        >
          <Text style={styles.sectionTitle}>Worksheet</Text>
          <Text style={styles.sectionSub}>View & download</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 20, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  error: { color: '#c62828', fontSize: 16 },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: BRAND_RED,
  },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: '#333' },
  sectionSub: { fontSize: 14, color: '#666', marginTop: 4 },
});
