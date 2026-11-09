import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import CelebrationMoment from './CelebrationMoment';
import {
  getLessonProgressV2,
  summarizeLessonEndProgress,
  type ContentSummaryItem,
} from '../../lib/learnProgress';

const BRAND_BLUE = '#1a237e';
const BRAND_RED = '#c41e3a';

type Props = {
  lessonTitle: string;
  userId: number;
  courseId: number;
  lessonId: number;
  summary: ContentSummaryItem[];
};

export default function LessonCompleteCelebration({
  lessonTitle,
  userId,
  courseId,
  lessonId,
  summary,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState(() =>
    summarizeLessonEndProgress(null, summary),
  );

  useEffect(() => {
    let cancelled = false;
    const load = async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      try {
        const record = await getLessonProgressV2(userId, courseId, lessonId);
        if (!cancelled) setSnapshot(summarizeLessonEndProgress(record, summary));
      } catch {
        if (!cancelled) setSnapshot(summarizeLessonEndProgress(null, summary));
      } finally {
        if (!cancelled && showSpinner) setLoading(false);
      }
    };

    void load(true);
    // Re-read shortly after mount in case the last video mark finished a tick late.
    const t1 = setTimeout(() => {
      void load(false);
    }, 350);
    const t2 = setTimeout(() => {
      void load(false);
    }, 900);

    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [userId, courseId, lessonId, summary]);

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={BRAND_RED} />
      </View>
    );
  }

  const { percent, complete, completed, incomplete } = snapshot;

  return (
    <CelebrationMoment
      variant="lesson"
      subjectTitle={lessonTitle}
      lessonProgress={{
        percent,
        complete,
      }}
    >
      {!complete ? (
        <View style={styles.summary}>
          <Text style={styles.summaryLead}>
            You&apos;re at {percent}% — finish the items below to complete this lesson.
          </Text>
          {completed.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Completed</Text>
              {completed.map((row, i) => (
                <Text key={`c-${row.label}-${row.title}-${i}`} style={styles.rowOk}>
                  ✓ {row.label}: {row.title}
                </Text>
              ))}
            </View>
          ) : null}
          {incomplete.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Still to do</Text>
              {incomplete.map((row, i) => (
                <Text key={`i-${row.label}-${row.title}-${i}`} style={styles.rowTodo}>
                  ○ {row.label}: {row.title}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </CelebrationMoment>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f7fc',
  },
  summary: {
    marginTop: 4,
    gap: 12,
  },
  summaryLead: {
    fontSize: 14,
    lineHeight: 20,
    color: '#475569',
  },
  section: {
    gap: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: '#94a3b8',
    marginBottom: 2,
  },
  rowOk: {
    fontSize: 14,
    lineHeight: 20,
    color: '#15803d',
    fontWeight: '600',
  },
  rowTodo: {
    fontSize: 14,
    lineHeight: 20,
    color: BRAND_BLUE,
    fontWeight: '600',
  },
});
