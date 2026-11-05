import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  computeLessonPercentFromRecord,
  ensureLessonInventory,
  itemKey,
  itemStatusBadge,
  markQuizDone,
  nextUnreadPageIndex,
  type ContentSummaryItem,
  type ItemProgress,
  type LessonLearnRecordV2,
} from '../lib/learnProgress';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';
const PAGE_BG = '#edf1fa';

type OrderedRow = {
  orderIndex: number;
  type: string;
  id: number;
  title?: string;
  description?: string;
  videoUrl?: string | null;
  quizAssignmentId?: number | null;
};

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
  orderedContent?: OrderedRow[];
};

function toSummary(rows: OrderedRow[]): ContentSummaryItem[] {
  return rows
    .filter((r) => ['video', 'study_material', 'worksheet', 'quiz'].includes(String(r.type)))
    .map((r) => ({
      type: r.type,
      id: r.id,
      title: r.title,
      orderIndex: r.orderIndex,
      quizAssignmentId: r.quizAssignmentId ?? null,
    }));
}

function legacyToOrdered(data: LessonData): OrderedRow[] {
  const out: OrderedRow[] = [];
  let i = 0;
  if ((data.videoAssignments || []).length) {
    for (const v of data.videoAssignments || []) {
      out.push({
        orderIndex: i++,
        type: 'video',
        id: v.video_id || v.id,
        title: v.video_title || 'Lesson video',
        description: v.video_description || '',
        videoUrl: v.video_url,
      });
    }
  } else if (data.videoUrl) {
    out.push({
      orderIndex: i++,
      type: 'video',
      id: data.id,
      title: 'Lesson video',
      videoUrl: data.videoUrl,
    });
  }
  for (const m of data.studyMaterialAssignments || []) {
    out.push({
      orderIndex: i++,
      type: 'study_material',
      id: m.material_id,
      title: m.material_title || 'Study material',
      description: m.material_description || '',
    });
  }
  for (const w of data.libraryWorksheetAssignments || []) {
    out.push({
      orderIndex: i++,
      type: 'worksheet',
      id: w.worksheet_id,
      title: w.worksheet_title || 'Worksheet',
      description: w.worksheet_description || '',
    });
  }
  if (data.quiz) {
    out.push({
      orderIndex: i++,
      type: 'quiz',
      id: data.quiz.id,
      title: data.quiz.title || 'Quiz',
    });
  } else {
    for (const q of data.quizAssignments || []) {
      out.push({
        orderIndex: i++,
        type: 'quiz',
        id: q.id,
        title: q.quiz_title || 'Quiz',
        quizAssignmentId: q.id,
      });
    }
  }
  if ((data.worksheets || []).length) {
    out.push({
      orderIndex: i++,
      type: 'pdf_worksheet',
      id: data.worksheets[0].id,
      title: 'Worksheet files',
    });
  }
  return out;
}

function typeEyebrow(type: string): string {
  if (type === 'video') return 'Video';
  if (type === 'study_material') return 'Study material';
  if (type === 'worksheet') return 'Worksheet';
  if (type === 'quiz') return 'Quiz';
  if (type === 'assignment') return 'Assignment';
  if (type === 'pdf_worksheet') return 'Worksheet files';
  return 'Item';
}

function typeIcon(type: string): keyof typeof Ionicons.glyphMap {
  if (type === 'video') return 'play-circle-outline';
  if (type === 'study_material') return 'reader-outline';
  if (type === 'worksheet') return 'clipboard-outline';
  if (type === 'quiz') return 'help-circle-outline';
  if (type === 'pdf_worksheet') return 'document-text-outline';
  if (type === 'assignment') return 'create-outline';
  return 'ellipse-outline';
}

export default function LessonDetailScreen({ route, navigation }: any) {
  const { lessonId, lessonTitle, courseId, courseLessonIds } = route.params;
  const { user } = useAuth();
  const [data, setData] = useState<LessonData | null>(null);
  const [items, setItems] = useState<OrderedRow[]>([]);
  const [record, setRecord] = useState<LessonLearnRecordV2 | null>(null);
  const [quizLatest, setQuizLatest] = useState<Record<string, { score: number; total: number }>>({});
  const [loading, setLoading] = useState(true);
  const [lessonPercent, setLessonPercent] = useState(0);

  const openLearn = (row: OrderedRow, redoQuiz?: boolean) => {
    const progressItem = record?.items[itemKey(row.type, row.id)];
    const startPageIndex =
      row.type === 'study_material' || row.type === 'worksheet'
        ? nextUnreadPageIndex(progressItem)
        : undefined;
    navigation.navigate('LearnMode', {
      courseId,
      lessonId,
      lessonTitle: data?.title || lessonTitle,
      startOrderIndex: row.orderIndex,
      startType: row.type,
      startId: row.id,
      startPageIndex,
      redoQuiz: Boolean(redoQuiz),
      courseLessonIds,
    });
  };

  const load = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const q =
        courseId != null && courseId !== ''
          ? `?courseId=${encodeURIComponent(String(courseId))}`
          : '';
      const lesson = await api.get(`/lessons/${lessonId}${q}`);
      setData(lesson);
      const ordered =
        lesson.orderedContent != null && Array.isArray(lesson.orderedContent)
          ? [...lesson.orderedContent].sort((a: OrderedRow, b: OrderedRow) => a.orderIndex - b.orderIndex)
          : legacyToOrdered(lesson);
      setItems(ordered);
      const summary = toSummary(ordered);
      const progress = await ensureLessonInventory(user.id, courseId, lessonId, summary);
      setRecord(progress);
      setLessonPercent(computeLessonPercentFromRecord(progress, summary));

      const latestMap: Record<string, { score: number; total: number }> = {};
      let progressAfterQuizzes = progress;
      for (const row of ordered) {
        if (row.type !== 'quiz') continue;
        const local = progressAfterQuizzes.items[itemKey('quiz', row.id)];
        if (local?.status === 'done' && local.latestScore != null) {
          latestMap[itemKey('quiz', row.id)] = {
            score: Number(local.latestScore),
            total: Number(local.latestTotal ?? 0),
          };
        }
        if (row.quizAssignmentId) {
          try {
            const cq =
              courseId != null ? `?courseId=${encodeURIComponent(String(courseId))}` : '';
            const payload = await api.get(`/quizzes/v2/assignment/${row.quizAssignmentId}${cq}`);
            const attempt = payload?.latestAttempt;
            if (attempt && (attempt.score != null || attempt.max_score != null || attempt.maxScore != null)) {
              const score = Number(attempt.score ?? 0);
              const total = Number(attempt.max_score ?? attempt.maxScore ?? 0);
              latestMap[itemKey('quiz', row.id)] = { score, total };
              if (local?.status !== 'done') {
                await markQuizDone(user.id, courseId, lessonId, row.id, score, total, summary);
                progressAfterQuizzes =
                  (await ensureLessonInventory(user.id, courseId, lessonId, summary)) ||
                  progressAfterQuizzes;
              }
            }
          } catch {
            /* ignore */
          }
        }
      }
      setRecord(progressAfterQuizzes);
      setLessonPercent(computeLessonPercentFromRecord(progressAfterQuizzes, summary));
      setQuizLatest(latestMap);
    } catch {
      setData(null);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [courseId, lessonId, lessonTitle, user?.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading && !data) {
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

  if (!items.length) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title={data.title || lessonTitle || 'Lesson'} />
        <View style={styles.centered}>
          <Text style={styles.sectionSub}>No content has been added to this lesson yet.</Text>
        </View>
      </View>
    );
  }

  const lessonTone =
    lessonPercent >= 100 ? 'complete' : lessonPercent > 0 ? 'partial' : 'neutral';

  return (
    <View style={styles.pageRoot}>
      <ScreenPageTitle title={data.title || lessonTitle || 'Lesson'} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.progressCard}>
          <View style={styles.progressRow}>
            <Text style={styles.progressLabel}>Lesson progress</Text>
            <Text
              style={[
                styles.progressPct,
                lessonTone === 'partial' && styles.progressPctPartial,
                lessonTone === 'complete' && styles.progressPctComplete,
              ]}
            >
              {lessonPercent}%
            </Text>
          </View>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${Math.min(100, lessonPercent)}%` },
                lessonTone === 'partial' && styles.fillPartial,
                lessonTone === 'complete' && styles.fillComplete,
              ]}
            />
          </View>
        </View>

        {items.map((row, rowIndex) => {
          const key = itemKey(row.type, row.id);
          const item: ItemProgress | undefined = record?.items[key];
          const quizResult = quizLatest[key];
          const badge = itemStatusBadge(row.type, item, { quizHasResult: Boolean(quizResult) });
          const isQuizDone = row.type === 'quiz' && (item?.status === 'done' || Boolean(quizResult));

          return (
            <View key={`${row.type}-${row.id}-${row.orderIndex}-${rowIndex}`} style={styles.card}>
              <TouchableOpacity
                style={styles.cardPress}
                onPress={() => openLearn(row)}
                accessibilityRole="button"
                activeOpacity={0.88}
              >
                <View style={styles.typeMark}>
                  <Ionicons name={typeIcon(row.type)} size={30} color={BRAND_RED} />
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.eyebrow}>{typeEyebrow(row.type)}</Text>
                  <Text style={styles.sectionTitle} numberOfLines={2}>
                    {row.title || 'Item'}
                  </Text>
                  {row.description ? (
                    <Text style={styles.sectionSub} numberOfLines={2}>
                      {row.description}
                    </Text>
                  ) : null}
                  <View style={styles.badgeRow}>
                    <Text
                      style={[
                        styles.badge,
                        badge.tone === 'complete' && styles.badgeDone,
                        badge.tone === 'partial' && styles.badgePartial,
                      ]}
                    >
                      {badge.label}
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#cbd5e1" />
              </TouchableOpacity>

              {row.type === 'quiz' && isQuizDone && quizResult ? (
                <View style={styles.quizResultBox}>
                  <View style={styles.quizResultRow}>
                    <Ionicons name="ribbon-outline" size={18} color={BRAND_BLUE} />
                    <Text style={styles.quizResultLabel}>Latest Score:</Text>
                    <Text style={styles.quizResultText}>
                      {quizResult.score}/{quizResult.total}
                      {` (${
                        quizResult.total > 0
                          ? Math.round((quizResult.score / quizResult.total) * 100)
                          : 0
                      }%)`}
                    </Text>
                    <TouchableOpacity style={styles.redoBtn} onPress={() => openLearn(row, true)}>
                      <Text style={styles.redoBtnText}>Redo</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: PAGE_BG },
  container: { flex: 1, backgroundColor: PAGE_BG },
  content: { padding: 20, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  error: { color: '#c62828', fontSize: 16 },
  progressCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#dfe7f8',
    shadowColor: BRAND_BLUE,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  progressLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  progressPct: { fontSize: 16, fontWeight: '800', color: '#94a3b8' },
  progressPctPartial: { color: '#ea580c' },
  progressPctComplete: { color: '#15803d' },
  track: { height: 8, borderRadius: 999, backgroundColor: '#e7ecf7', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#cbd5e1', borderRadius: 999 },
  fillPartial: { backgroundColor: '#f97316' },
  fillComplete: { backgroundColor: '#22c55e' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e4ebf8',
    overflow: 'hidden',
    shadowColor: BRAND_BLUE,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardPress: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
  },
  typeMark: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#fff5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, minWidth: 0 },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.1,
    fontWeight: '700',
    color: BRAND_RED,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', letterSpacing: -0.2 },
  sectionSub: { fontSize: 13, color: '#64748b', marginTop: 4, lineHeight: 18 },
  badgeRow: { flexDirection: 'row', marginTop: 10 },
  badge: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    backgroundColor: '#eef2f7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
  },
  badgeDone: { color: '#166534', backgroundColor: '#dcfce7' },
  badgePartial: { color: '#9a3412', backgroundColor: '#ffedd5' },
  quizResultBox: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e8eef8',
    marginLeft: 70,
  },
  quizResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'nowrap',
  },
  quizResultLabel: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  quizResultText: { fontSize: 14, fontWeight: '800', color: BRAND_BLUE, flex: 1 },
  redoBtn: {
    marginLeft: 'auto',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#fff5f5',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  redoBtnText: { color: BRAND_RED, fontWeight: '700', fontSize: 12 },
});
