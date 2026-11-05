import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import QuizAnswerReview, { type QuizReviewItem } from './QuizAnswerReview';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

const CONFETTI = [
  { left: '12%', color: BRAND_RED, size: 8, delay: 0, drift: -18 },
  { left: '28%', color: '#f59e0b', size: 6, delay: 120, drift: 14 },
  { left: '42%', color: BRAND_BLUE, size: 9, delay: 60, drift: -10 },
  { left: '58%', color: '#10b981', size: 7, delay: 180, drift: 16 },
  { left: '72%', color: '#8b5cf6', size: 8, delay: 90, drift: -14 },
  { left: '84%', color: BRAND_RED, size: 6, delay: 200, drift: 12 },
  { left: '20%', color: '#38bdf8', size: 5, delay: 240, drift: 8 },
  { left: '66%', color: '#f97316', size: 7, delay: 150, drift: -12 },
] as const;

export type CelebrationVariant = 'lesson' | 'quiz_submit' | 'quiz_result' | 'quiz_pending';

type LessonProgressProps = {
  percent: number;
  complete: boolean;
};

type Props = {
  variant: CelebrationVariant;
  /** Lesson or quiz title shown in the card */
  subjectTitle?: string;
  score?: number;
  total?: number;
  review?: QuizReviewItem[] | null;
  lessonProgress?: LessonProgressProps | null;
  children?: React.ReactNode;
};

function copyFor(
  variant: CelebrationVariant,
  subjectTitle?: string,
  score?: number,
  total?: number,
  lessonProgress?: LessonProgressProps | null,
) {
  if (variant === 'lesson') {
    const pct = Math.max(0, Math.min(100, Math.round(Number(lessonProgress?.percent ?? 0))));
    const complete = Boolean(lessonProgress?.complete) || pct >= 100;
    if (complete) {
      return {
        icon: 'checkmark' as const,
        badgeColor: BRAND_RED,
        confetti: true,
        kicker: 'Congratulations',
        title: 'Lesson complete',
        cardLabel: 'You finished',
        cardTitle: subjectTitle || 'this lesson',
        cardHint: 'Great work — keep the momentum going.',
        percentLine: '100%' as string | null,
        detailLine: 'All lesson items complete' as string | null,
      };
    }
    return {
      icon: 'flag-outline' as const,
      badgeColor: BRAND_BLUE,
      confetti: false,
      kicker: 'In progress',
      title: `${pct}% complete`,
      cardLabel: 'Lesson progress',
      cardTitle: subjectTitle || 'this lesson',
      cardHint: 'Keep going — a few items are still open.',
      percentLine: `${pct}%`,
      detailLine: null,
    };
  }
  if (variant === 'quiz_submit') {
    return {
      icon: 'send' as const,
      badgeColor: BRAND_BLUE,
      confetti: true,
      kicker: 'Almost there',
      title: 'Ready to submit',
      cardLabel: 'Quiz',
      cardTitle: subjectTitle || 'Your answers',
      cardHint: 'Review if you need to, then submit for scoring.',
      percentLine: null,
      detailLine: null,
    };
  }
  if (variant === 'quiz_pending') {
    return {
      icon: 'hourglass-outline' as const,
      badgeColor: '#64748b',
      confetti: false,
      kicker: 'One more step',
      title: 'Results pending',
      cardLabel: 'Quiz',
      cardTitle: subjectTitle || 'Quiz',
      cardHint: 'Submit your answers from the previous page to see your score.',
      percentLine: null,
      detailLine: null,
    };
  }

  const s = Number(score ?? 0);
  const t = Number(total ?? 0);
  const pct = t > 0 ? Math.round((s / t) * 100) : 0;
  const perfect = t > 0 && s === t;
  const strong = t > 0 && s / t >= 0.7;
  return {
    icon: (perfect ? 'trophy' : strong ? 'ribbon' : 'checkmark-done') as const,
    badgeColor: perfect || strong ? BRAND_RED : BRAND_BLUE,
    confetti: true,
    kicker: perfect ? 'Perfect score' : strong ? 'Well done' : 'Quiz complete',
    title: perfect ? 'Outstanding!' : strong ? 'Nice work!' : 'Results are in',
    cardLabel: 'Quiz',
    cardTitle: subjectTitle || 'Quiz',
    cardHint: perfect
      ? 'Every answer correct — brilliant focus.'
      : strong
        ? 'Strong result. A quick redo can push you even further.'
        : 'Keep practicing — each attempt builds fluency.',
    percentLine: t > 0 ? `${pct}%` : null,
    detailLine: t > 0 ? `${s} of ${t} correct` : null,
  };
}

export default function CelebrationMoment({
  variant,
  subjectTitle,
  score,
  total,
  review,
  lessonProgress,
  children,
}: Props) {
  const copy = copyFor(variant, subjectTitle, score, total, lessonProgress);
  const badgeScale = useRef(new Animated.Value(0.35)).current;
  const badgeOpacity = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(0.6)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleY = useRef(new Animated.Value(18)).current;
  const bodyOpacity = useRef(new Animated.Value(0)).current;
  const bodyY = useRef(new Animated.Value(14)).current;
  const confetti = useMemo(
    () => CONFETTI.map(() => ({ y: new Animated.Value(0), opacity: new Animated.Value(0) })),
    [],
  );

  useEffect(() => {
    badgeScale.setValue(0.35);
    badgeOpacity.setValue(0);
    ringScale.setValue(0.6);
    ringOpacity.setValue(0);
    titleOpacity.setValue(0);
    titleY.setValue(18);
    bodyOpacity.setValue(0);
    bodyY.setValue(14);
    confetti.forEach((p) => {
      p.y.setValue(0);
      p.opacity.setValue(0);
    });

    Animated.sequence([
      Animated.parallel([
        Animated.spring(badgeScale, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }),
        Animated.timing(badgeOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
        Animated.timing(ringOpacity, { toValue: 1, duration: 320, useNativeDriver: true }),
        Animated.timing(ringScale, {
          toValue: 1.35,
          duration: 700,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(ringOpacity, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]).start();

    Animated.sequence([
      Animated.delay(180),
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 1, duration: 360, useNativeDriver: true }),
        Animated.timing(titleY, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(bodyOpacity, { toValue: 1, duration: 360, useNativeDriver: true }),
        Animated.timing(bodyY, {
          toValue: 0,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    if (!copy.confetti) return undefined;

    const loops = confetti.map((piece, i) => {
      const cfg = CONFETTI[i];
      const anim = Animated.loop(
        Animated.sequence([
          Animated.delay(cfg.delay),
          Animated.parallel([
            Animated.timing(piece.opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
            Animated.timing(piece.y, {
              toValue: 1,
              duration: 2200 + i * 90,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
          Animated.timing(piece.opacity, { toValue: 0, duration: 280, useNativeDriver: true }),
          Animated.timing(piece.y, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
      anim.start();
      return anim;
    });

    return () => {
      loops.forEach((a) => a.stop());
    };
  }, [
    badgeOpacity,
    badgeScale,
    bodyOpacity,
    bodyY,
    confetti,
    copy.confetti,
    ringOpacity,
    ringScale,
    titleOpacity,
    titleY,
    variant,
    score,
    total,
    lessonProgress?.percent,
    lessonProgress?.complete,
  ]);

  const isQuizResult = variant === 'quiz_result';
  const isLesson = variant === 'lesson';
  const hasReview = Boolean(review?.length);
  const compact = isQuizResult && hasReview;
  const scrollLesson = isLesson && Boolean(children);

  const body = (
    <>
      <View style={[styles.badgeWrap, compact && styles.badgeWrapCompact]}>
        <Animated.View
          style={[
            styles.pulseRing,
            compact && styles.pulseRingCompact,
            {
              borderColor: `${copy.badgeColor}48`,
              opacity: ringOpacity,
              transform: [{ scale: ringScale }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.badge,
            compact && styles.badgeCompact,
            {
              backgroundColor: copy.badgeColor,
              shadowColor: copy.badgeColor,
              opacity: badgeOpacity,
              transform: [{ scale: badgeScale }],
            },
          ]}
        >
          <Ionicons name={copy.icon} size={compact ? 28 : copy.icon === 'send' ? 34 : 40} color="#fff" />
        </Animated.View>
      </View>

      <Animated.View style={{ opacity: titleOpacity, transform: [{ translateY: titleY }], alignItems: 'center' }}>
        <Text style={styles.kicker}>{copy.kicker}</Text>
        <Text style={[styles.title, compact && styles.titleCompact]}>{copy.title}</Text>
      </Animated.View>

      <Animated.View style={[styles.card, { opacity: bodyOpacity, transform: [{ translateY: bodyY }] }]}>
        <Text style={styles.cardLabel}>{copy.cardLabel}</Text>
        <Text style={styles.cardTitle} numberOfLines={3}>
          {copy.cardTitle}
        </Text>
        {copy.percentLine ? <Text style={styles.scoreLine}>{copy.percentLine}</Text> : null}
        {copy.detailLine ? <Text style={styles.scoreDetail}>{copy.detailLine}</Text> : null}
        <Text style={styles.cardHint}>{copy.cardHint}</Text>
        {children ? <View style={styles.actions}>{children}</View> : null}
      </Animated.View>

      {hasReview ? (
        <Animated.View
          style={[
            styles.reviewWrap,
            { opacity: bodyOpacity, transform: [{ translateY: bodyY }] },
          ]}
        >
          <QuizAnswerReview items={review!} />
        </Animated.View>
      ) : null}
    </>
  );

  return (
    <View style={[styles.root, (isQuizResult || scrollLesson) && styles.rootResult]}>
      {!compact && !isLesson ? <View style={styles.glowTop} pointerEvents="none" /> : null}
      {/* Large bottom glow sat behind the footer and looked like a tall empty box — omit it. */}

      {copy.confetti ? (
        <View style={[styles.confettiLayer, compact && styles.confettiLayerCompact]} pointerEvents="none">
          {CONFETTI.map((cfg, i) => {
            const piece = confetti[i];
            return (
              <Animated.View
                key={`${cfg.left}-${i}`}
                style={[
                  styles.confetti,
                  {
                    left: cfg.left as `${number}%`,
                    width: cfg.size,
                    height: cfg.size,
                    borderRadius: cfg.size / 2,
                    backgroundColor: cfg.color,
                    opacity: piece.opacity,
                    transform: [
                      {
                        translateY: piece.y.interpolate({
                          inputRange: [0, 1],
                          outputRange: [-8, 120],
                        }),
                      },
                      {
                        translateX: piece.y.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, cfg.drift],
                        }),
                      },
                      {
                        rotate: piece.y.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', `${cfg.drift > 0 ? 140 : -140}deg`],
                        }),
                      },
                    ],
                  },
                ]}
              />
            );
          })}
        </View>
      ) : null}

      {isQuizResult || scrollLesson ? (
        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContentResult}
          bounces
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: '#f5f7fc',
    overflow: 'hidden',
  },
  rootResult: {
    justifyContent: 'flex-start',
    paddingHorizontal: 20,
  },
  scroll: {
    flex: 1,
    width: '100%',
  },
  scrollContentResult: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 24,
    flexGrow: 0,
  },
  reviewWrap: {
    width: '100%',
    alignItems: 'center',
    marginTop: 4,
  },
  glowTop: {
    position: 'absolute',
    top: -60,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(26, 35, 126, 0.08)',
  },
  glowBottom: {
    position: 'absolute',
    bottom: -80,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(196, 30, 58, 0.06)',
  },
  confettiLayer: {
    ...StyleSheet.absoluteFillObject,
    top: 36,
    height: 180,
  },
  confettiLayerCompact: {
    top: 8,
    height: 100,
  },
  confetti: {
    position: 'absolute',
    top: 24,
  },
  badgeWrap: {
    width: 118,
    height: 118,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  badgeWrapCompact: {
    width: 88,
    height: 88,
    marginBottom: 10,
    marginTop: 4,
  },
  pulseRing: {
    position: 'absolute',
    width: 118,
    height: 118,
    borderRadius: 59,
    borderWidth: 3,
  },
  pulseRingCompact: {
    width: 88,
    height: 88,
    borderRadius: 44,
  },
  badge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  badgeCompact: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  kicker: {
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: BRAND_RED,
    marginBottom: 8,
  },
  title: {
    textAlign: 'center',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    color: BRAND_BLUE,
    letterSpacing: -0.4,
    marginBottom: 22,
  },
  titleCompact: {
    fontSize: 24,
    lineHeight: 30,
    marginBottom: 14,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e4eaf7',
    shadowColor: BRAND_BLUE,
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#94a3b8',
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    color: '#0f172a',
  },
  scoreLine: {
    marginTop: 12,
    fontSize: 36,
    lineHeight: 40,
    fontWeight: '800',
    color: BRAND_BLUE,
    letterSpacing: -0.8,
  },
  scoreDetail: {
    marginTop: 4,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: '#64748b',
  },
  cardHint: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 20,
    color: '#64748b',
  },
  actions: {
    marginTop: 16,
  },
});
