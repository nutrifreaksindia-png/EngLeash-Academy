import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  computeLessonPercentFromRecord,
  ensureLessonInventory,
  LESSON_PROGRESS_TYPES,
  summarizeLessonItemStatuses,
  type ContentSummaryItem,
} from '../lib/learnProgress';

async function loadLessonSummary(
  courseId: number,
  lessonId: number,
  existing?: ContentSummaryItem[],
): Promise<ContentSummaryItem[]> {
  if (Array.isArray(existing) && existing.length) {
    return existing.filter((s) =>
      LESSON_PROGRESS_TYPES.includes(s.type as (typeof LESSON_PROGRESS_TYPES)[number]),
    );
  }
  try {
    const q = `?courseId=${encodeURIComponent(String(courseId))}`;
    const lesson = await api.get(`/lessons/${lessonId}${q}`);
    const ordered = Array.isArray(lesson?.orderedContent) ? lesson.orderedContent : [];
    return ordered
      .filter((row: any) =>
        LESSON_PROGRESS_TYPES.includes(String(row.type) as (typeof LESSON_PROGRESS_TYPES)[number]),
      )
      .map((row: any) => ({
        type: String(row.type),
        id: Number(row.id),
        title: row.title,
        orderIndex: row.orderIndex,
        quizAssignmentId: row.quizAssignmentId ?? null,
      }));
  } catch {
    return [];
  }
}

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';
const PAGE_BG = '#edf1fa';

type Lesson = {
  id: number;
  title: string;
  sort_order: number;
  map_id?: number;
  contentSummary?: ContentSummaryItem[];
};

type LessonRow = Lesson & {
  progressPercent: number;
  statusLine: string;
  listKey: string;
};

function progressTone(pct: number): 'neutral' | 'partial' | 'complete' {
  if (pct >= 100) return 'complete';
  if (pct > 0) return 'partial';
  return 'neutral';
}

export default function CourseDetailScreen({ route, navigation }: any) {
  const { courseId, courseName } = route.params || {};
  const { user } = useAuth();
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) {
      setLessons([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const raw = await api.get(`/lessons/course/${courseId}`);
      const list: Lesson[] = Array.isArray(raw) ? raw : [];
      const sorted = [...list].sort(
        (a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0),
      );

      // Same library lesson can appear on multiple course days — show once (first day).
      const seen = new Set<number>();
      const unique: Lesson[] = [];
      for (const L of sorted) {
        if (seen.has(L.id)) continue;
        seen.add(L.id);
        unique.push(L);
      }

      const enriched: LessonRow[] = [];
      for (const L of unique) {
        const summary = await loadLessonSummary(courseId, L.id, L.contentSummary);
        const record = await ensureLessonInventory(user.id, courseId, L.id, summary);
        const progressPercent = computeLessonPercentFromRecord(record, summary);
        const chips = summarizeLessonItemStatuses(record, summary);
        const statusLine = [chips.watched, chips.learnt, chips.done].filter(Boolean).join(' · ');
        enriched.push({
          ...L,
          contentSummary: summary,
          progressPercent,
          statusLine: statusLine || (summary.length ? 'Not started' : 'No library items'),
          listKey: String(L.map_id ?? L.id),
        });
      }

      setLessons(enriched);
    } catch {
      setLessons([]);
    } finally {
      setLoading(false);
    }
  }, [courseId, user?.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading && !lessons.length) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title={courseName || 'My Lessons'} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.pageRoot}>
      <ScreenPageTitle title={courseName || 'My Lessons'} />
      <View style={styles.container}>
        <Text style={styles.subtitle}>Lessons</Text>
        <FlatList
          style={styles.listFlex}
          data={lessons}
          keyExtractor={(item) => item.listKey}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No lessons available yet.</Text>}
          renderItem={({ item, index }) => {
            const tone = progressTone(item.progressPercent);
            return (
              <TouchableOpacity
                style={styles.card}
                activeOpacity={0.88}
                onPress={() =>
                  navigation.navigate('LessonDetail', {
                    lessonId: item.id,
                    lessonTitle: item.title,
                    courseId,
                    courseLessonIds: lessons.map((l) => l.id),
                  })
                }
              >
                <View style={styles.cardHeader}>
                  <View style={styles.dayPill}>
                    <Text style={styles.dayPillText}>{index + 1}</Text>
                  </View>
                  <View style={styles.cardHeaderText}>
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text style={styles.cardStatus} numberOfLines={2}>
                      {item.statusLine}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.cardPct,
                      tone === 'partial' && styles.cardPctPartial,
                      tone === 'complete' && styles.cardPctComplete,
                    ]}
                  >
                    {item.progressPercent}%
                  </Text>
                </View>
                <View style={styles.miniTrack}>
                  <View
                    style={[
                      styles.miniFill,
                      { width: `${Math.min(100, item.progressPercent)}%` },
                      tone === 'partial' && styles.miniFillPartial,
                      tone === 'complete' && styles.miniFillComplete,
                    ]}
                  />
                </View>
              </TouchableOpacity>
            );
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: PAGE_BG },
  container: { flex: 1, backgroundColor: PAGE_BG },
  listFlex: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  subtitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 22,
    marginTop: 12,
    marginBottom: 10,
  },
  list: { paddingHorizontal: 20, paddingTop: 2, paddingBottom: 40 },
  empty: { color: '#64748b', textAlign: 'center', paddingVertical: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e4ebf8',
    shadowColor: BRAND_BLUE,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  dayPill: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayPillText: { fontSize: 14, fontWeight: '800', color: BRAND_BLUE },
  cardHeaderText: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', letterSpacing: -0.2 },
  cardStatus: { marginTop: 5, fontSize: 12, color: '#64748b', lineHeight: 17 },
  cardPct: { fontSize: 15, fontWeight: '800', color: '#94a3b8' },
  cardPctPartial: { color: '#ea580c' },
  cardPctComplete: { color: '#15803d' },
  miniTrack: {
    marginTop: 14,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#eef2f7',
    overflow: 'hidden',
  },
  miniFill: { height: '100%', borderRadius: 999, backgroundColor: '#cbd5e1' },
  miniFillPartial: { backgroundColor: '#f97316' },
  miniFillComplete: { backgroundColor: '#22c55e' },
});
