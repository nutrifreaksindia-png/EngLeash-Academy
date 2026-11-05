import React, { useState } from 'react';
import { LayoutAnimation, Platform, StyleSheet, Text, TouchableOpacity, UIManager, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export type QuizReviewItem = {
  questionId?: number | string;
  index?: number;
  prompt: string;
  type?: string;
  isCorrect: boolean;
  yourAnswer: string;
  correctAnswer: string;
  explanation?: string | null;
};

type Props = {
  items: QuizReviewItem[];
};

/** Explanations are sometimes stored as `{"feedback":"..."}` — show plain text only. */
export function formatQuizExplanation(raw: unknown): string | null {
  if (raw == null) return null;
  let value: unknown = raw;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        value = JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    } else {
      return trimmed;
    }
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    const nested =
      obj.feedback ?? obj.explanation ?? obj.text ?? obj.message ?? obj.why ?? null;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
    if (nested != null && typeof nested === 'object') {
      return formatQuizExplanation(nested);
    }
  }
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

export default function QuizAnswerReview({ items }: Props) {
  const [open, setOpen] = useState(false);
  if (!items?.length) return null;

  const correctCount = items.filter((i) => i.isCorrect).length;

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((v) => !v);
  };

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.header, open && styles.headerOpen]}
        onPress={toggle}
        activeOpacity={0.88}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.headerIcon}>
          <Ionicons name="list-outline" size={18} color={BRAND_BLUE} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Review answers</Text>
          <Text style={styles.headerMeta}>
            {correctCount}/{items.length} correct
          </Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color="#94a3b8" />
      </TouchableOpacity>

      {open ? (
        <View style={styles.body}>
          {items.map((item, i) => {
            const ok = Boolean(item.isCorrect);
            return (
              <View key={`rev-${item.questionId ?? i}`} style={[styles.row, i === items.length - 1 && styles.rowLast]}>
                <View style={styles.rowTop}>
                  <View style={[styles.badge, ok ? styles.badgeOk : styles.badgeBad]}>
                    <Ionicons name={ok ? 'checkmark' : 'close'} size={12} color="#fff" />
                  </View>
                  <Text style={styles.qIndex}>Q{i + 1}</Text>
                </View>
                <Text style={styles.prompt}>{item.prompt}</Text>

                <View style={[styles.answerBlock, ok ? styles.answerBlockOk : styles.answerBlockBad]}>
                  <View style={styles.answerHeader}>
                    <Text style={styles.answerLabel}>Your answer</Text>
                    <Text style={[styles.status, ok ? styles.statusOk : styles.statusBad]}>
                      {ok ? 'Correct' : 'Incorrect'}
                    </Text>
                  </View>
                  <Text style={[styles.answerValue, !ok && styles.answerWrong]}>{item.yourAnswer || 'No answer'}</Text>
                </View>

                {!ok ? (
                  <View style={[styles.answerBlock, styles.correctBlock]}>
                    <Text style={styles.answerLabel}>Correct answer</Text>
                    <Text style={[styles.answerValue, styles.answerCorrect]}>{item.correctAnswer || '—'}</Text>
                  </View>
                ) : null}

                {(() => {
                  const why = formatQuizExplanation(item.explanation);
                  if (!why) return null;
                  return (
                    <View style={styles.explain}>
                      <Text style={styles.explainLabel}>Why</Text>
                      <Text style={styles.explainText}>{why}</Text>
                    </View>
                  );
                })()}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    maxWidth: 360,
    marginTop: 12,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e4eaf7',
    overflow: 'hidden',
    shadowColor: BRAND_BLUE,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  headerOpen: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8eef8',
  },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  headerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  headerMeta: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  body: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    paddingTop: 4,
  },
  row: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eef2f7',
  },
  rowLast: { borderBottomWidth: 0 },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  badge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeOk: { backgroundColor: '#16a34a' },
  badgeBad: { backgroundColor: BRAND_RED },
  qIndex: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.3,
  },
  status: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  statusOk: { color: '#16a34a' },
  statusBad: { color: BRAND_RED },
  prompt: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    color: BRAND_BLUE,
    marginBottom: 10,
  },
  answerBlock: {
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  answerBlockOk: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  answerBlockBad: {
    backgroundColor: '#fff5f5',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  correctBlock: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  answerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  answerLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#94a3b8',
  },
  answerValue: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: '#0f172a',
  },
  answerWrong: { color: BRAND_RED },
  answerCorrect: { color: '#15803d' },
  explain: {
    marginTop: 2,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e8eef8',
  },
  explainLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#94a3b8',
    marginBottom: 4,
  },
  explainText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
  },
});
