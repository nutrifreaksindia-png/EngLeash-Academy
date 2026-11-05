import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Easing,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ResizeMode, Video } from 'expo-av';
import Ionicons from '@expo/vector-icons/Ionicons';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ContentBlocksView } from '../components/learn/ContentBlocksView';
import CelebrationMoment from '../components/learn/CelebrationMoment';
import LessonCompleteCelebration from '../components/learn/LessonCompleteCelebration';
import MatchingDragBoard from '../components/learn/MatchingDragBoard';
import {
  buildLessonSlides,
  findStartSlideIndex,
  firstIndexForLibraryCategory,
  libraryCategoriesInOrder,
  LearnSlide,
  listItemsInLibraryCategory,
  listQuizzesInDeck,
  nextLessonFooterAction,
  QuizPayload,
  siblingItemKey,
  slideItemTitle,
  slideLibraryCategory,
} from '../learn/buildLessonSlides';
import { resolveQuizReview } from '../learn/buildQuizReview';
import {
  clearCourseProgress,
  ensureLessonInventory,
  getLessonProgressV2,
  itemKey,
  markGenericDone,
  markLessonCompletedIfDone,
  markPagedItemView,
  markQuizDone,
  markVideoWatched,
  type ContentSummaryItem,
} from '../lib/learnProgress';
import { lockAppPortrait } from '../utils/appScreenOrientation';
import { applyVideoFullscreenOrientation } from '../utils/videoFullscreenOrientation';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

export default function LearnModeScreen({ route, navigation }: any) {
  const {
    courseId,
    lessonId,
    lessonTitle: titleParam,
    restart,
    courseLessonIds,
    startOrderIndex,
    startType,
    startId,
    startPageIndex,
    redoQuiz,
  } = (route.params || {}) as {
    courseId: number;
    lessonId: number;
    lessonTitle?: string;
    restart?: boolean;
    courseLessonIds?: number[];
    startOrderIndex?: number;
    startType?: string;
    startId?: number;
    /** 0-based page within study material / worksheet to resume at. */
    startPageIndex?: number;
    redoQuiz?: boolean;
  };
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const slideW = winW;
  const restoreTabBarStyle = useMemo(
    () => ({
      paddingTop: 4,
      paddingBottom: Math.max(insets.bottom, 8),
      height: 58 + Math.max(insets.bottom, 8),
    }),
    [insets.bottom],
  );

  // Collapse the parent tab bar while Learn Mode is focused (Android left a white gap otherwise).
  useFocusEffect(
    useCallback(() => {
      const tab = navigation.getParent();
      tab?.setOptions({
        tabBarStyle: {
          display: 'none',
          height: 0,
          overflow: 'hidden',
          opacity: 0,
          borderTopWidth: 0,
          elevation: 0,
          position: 'absolute',
        },
      });
      return () => {
        tab?.setOptions({ tabBarStyle: restoreTabBarStyle });
      };
    }, [navigation, restoreTabBarStyle]),
  );

  const [slides, setSlides] = useState<LearnSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lessonTitle, setLessonTitle] = useState(titleParam || '');
  const [index, setIndex] = useState(0);
  const summaryRef = useRef<ContentSummaryItem[]>([]);

  const [selectedMcq, setSelectedMcq] = useState<Record<string, number>>({});
  const [multiSelected, setMultiSelected] = useState<Record<string, number[]>>({});
  const [matchingSelected, setMatchingSelected] = useState<Record<string, Record<string, string>>>({});
  const [blankAnswers, setBlankAnswers] = useState<Record<string, Record<string, string>>>({});

  const [quizOutcome, setQuizOutcome] = useState<
    Record<string, { score: number; total: number; review?: any[] }>
  >({});
  const [quizSubmitLoading, setQuizSubmitLoading] = useState<string | null>(null);
  const contentFade = useRef(new Animated.Value(1)).current;
  const contentShiftX = useRef(new Animated.Value(0)).current;

  const flatListRef = useRef<FlatList<LearnSlide>>(null);
  const learnVideoRef = useRef<Video | null>(null);
  const pendingScrollIdx = useRef<number | null>(null);
  const slidesRef = useRef<LearnSlide[]>([]);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  slidesRef.current = slides;

  useFocusEffect(
    useCallback(() => {
      void lockAppPortrait();
      return () => {
        void lockAppPortrait();
      };
    }, []),
  );

  useEffect(() => {
    if (!nativeFullscreen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      learnVideoRef.current?.dismissFullscreenPlayer();
      void lockAppPortrait();
      setNativeFullscreen(false);
      return true;
    });
    return () => sub.remove();
  }, [nativeFullscreen]);

  const qKey = useCallback((pack: QuizPayload, qId: number | string) => `${pack.quizKey}:${qId}`, []);

  const trackSlide = useCallback(
    async (idx: number) => {
      if (!user?.id || !slidesRef.current.length) return;
      const slide = slidesRef.current[idx];
      if (!slide) return;
      const summary = summaryRef.current;

      if (slide.kind === 'text') {
        await markPagedItemView(
          user.id,
          courseId,
          lessonId,
          slide.contentType,
          slide.contentId,
          slide.pageIndex,
          slide.pageCount,
          summary,
        );
      } else if (slide.kind === 'open_notes') {
        await markGenericDone(user.id, courseId, lessonId, 'notes', slide.contentId, summary);
      } else if (slide.kind === 'open_pdf_sheet') {
        await markGenericDone(user.id, courseId, lessonId, 'pdf_worksheet', slide.contentId, summary);
      } else if (slide.kind === 'assignment') {
        await markGenericDone(user.id, courseId, lessonId, 'assignment', slide.contentId, summary);
      } else if (slide.kind === 'done') {
        await markLessonCompletedIfDone(user.id, courseId, lessonId, summary);
      }
    },
    [courseId, lessonId, user?.id],
  );

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (!user?.id) {
        setError('Please sign in to learn.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        if (restart && Array.isArray(courseLessonIds) && courseLessonIds.length) {
          await clearCourseProgress(user.id, courseId, courseLessonIds);
        }

        const q =
          courseId != null ? `?courseId=${encodeURIComponent(String(courseId))}` : '';
        const lessonPayload = await api.get(`/lessons/${lessonId}${q}`);
        if (cancelled) return;

        const ordered = Array.isArray(lessonPayload.orderedContent)
          ? lessonPayload.orderedContent
          : [];
        let summary: ContentSummaryItem[] = ordered.map((row: any) => ({
          type: row.type,
          id: row.id,
          title: row.title,
          orderIndex: row.orderIndex,
          quizAssignmentId: row.quizAssignmentId ?? null,
        }));

        const full = await buildLessonSlides({
          ...lessonPayload,
          id: lessonPayload.id ?? lessonId,
          title: lessonPayload.title || titleParam || 'Lesson',
          courseId: courseId ?? lessonPayload.course_id ?? null,
          allowVideoDownload: Boolean(lessonPayload.allowVideoDownload),
        });
        if (cancelled) return;

        if (!summary.length) {
          const seen = new Set<string>();
          for (const s of full) {
            if (!('contentType' in s) || !('contentId' in s)) continue;
            const k = `${s.contentType}:${s.contentId}`;
            if (seen.has(k)) continue;
            seen.add(k);
            summary.push({
              type: s.contentType,
              id: s.contentId,
              orderIndex: 'orderIndex' in s ? s.orderIndex : undefined,
            });
          }
        }
        summaryRef.current = summary;
        await ensureLessonInventory(user.id, courseId, lessonId, summary);

        // Keep the full lesson deck so the category stepper can reach every type
        // (e.g. Video still available when opening from Study Material).
        const hasExplicitStart =
          (startType != null && startId != null) ||
          (startOrderIndex != null && Number.isFinite(Number(startOrderIndex))) ||
          Boolean(redoQuiz);
        const built = hasExplicitStart
          ? full.filter((s) => s.kind !== 'intro')
          : full;

        const progress = await getLessonProgressV2(user.id, courseId, lessonId);
        const restoredOutcomes: Record<string, { score: number; total: number; review?: any[] }> = {};
        const courseQ =
          courseId != null ? `?courseId=${encodeURIComponent(String(courseId))}` : '';
        for (const s of built) {
          if (s.kind !== 'quiz_start') continue;
          const prog = progress?.items?.[itemKey('quiz', Number(s.quiz.quizId))];
          if (prog?.status !== 'done') continue;
          let review = Array.isArray(prog.latestReview) ? prog.latestReview : undefined;
          let score = Number(prog.latestScore ?? 0);
          let total = Number(prog.latestTotal ?? 0);

          // Always try to hydrate Review Answers from the server when local cache lacks it.
          if (!review?.length) {
            try {
              if (s.quiz.mode === 'v2' && s.quiz.assignmentId) {
                const latest = await api.get(
                  `/quizzes/v2/assignment/${s.quiz.assignmentId}/attempts/latest${courseQ}`,
                );
                if (latest) {
                  if (latest.score != null && latest.max_score != null) {
                    score = Number(latest.score);
                    total = Number(latest.max_score);
                  }
                  const qs = s.quiz.quiz?.questions || [];
                  review = resolveQuizReview(latest.review, qs, latest.responses);
                }
              } else if (s.quiz.mode === 'legacy' && s.quiz.lessonId) {
                const latest = await api.get(
                  `/quizzes/lesson/${s.quiz.lessonId}/attempts/latest${courseQ}`,
                );
                if (latest) {
                  if (latest.score != null && latest.total != null) {
                    score = Number(latest.score);
                    total = Number(latest.total);
                  }
                  if (Array.isArray(latest.review) && latest.review.length) {
                    review = latest.review;
                  }
                }
              }
              if (review?.length && user?.id) {
                void markQuizDone(
                  user.id,
                  courseId,
                  lessonId,
                  s.quiz.quizId,
                  score,
                  total,
                  summaryRef.current,
                  review,
                );
              }
            } catch {
              /* keep local progress scores */
            }
          }

          restoredOutcomes[s.quiz.quizKey] = {
            score,
            total,
            ...(review?.length ? { review } : {}),
          };
        }
        if (!cancelled) setQuizOutcome(restoredOutcomes);

        setLessonTitle(lessonPayload.title || titleParam || 'Lesson');
        setSlides(built);
        slidesRef.current = built;

        let startIdx = findStartSlideIndex(built, {
          startOrderIndex: startOrderIndex ?? null,
          startType: startType ?? null,
          startId: startId ?? null,
        });
        if (startType === 'quiz' && startId != null) {
          const quizStart = built.find(
            (s) => s.kind === 'quiz_start' && Number(s.contentId) === Number(startId),
          );
          if (quizStart && quizStart.kind === 'quiz_start') {
            if (redoQuiz) {
              // Clear prior outcome so Redo opens the start screen fresh.
              delete restoredOutcomes[quizStart.quiz.quizKey];
              if (!cancelled) setQuizOutcome({ ...restoredOutcomes });
              const startSlide = built.findIndex(
                (s) => s.kind === 'quiz_start' && Number(s.contentId) === Number(startId),
              );
              if (startSlide >= 0) startIdx = startSlide;
            } else if (restoredOutcomes[quizStart.quiz.quizKey]) {
              const resultSlide = built.findIndex(
                (s) =>
                  s.kind === 'quiz_result' && s.quiz.quizKey === quizStart.quiz.quizKey,
              );
              if (resultSlide >= 0) startIdx = resultSlide;
            } else {
              const startSlide = built.findIndex(
                (s) => s.kind === 'quiz_start' && Number(s.contentId) === Number(startId),
              );
              if (startSlide >= 0) startIdx = startSlide;
            }
          }
        } else if (
          (startType === 'study_material' || startType === 'worksheet') &&
          startId != null &&
          startPageIndex != null &&
          Number.isFinite(Number(startPageIndex))
        ) {
          const pageIdx = built.findIndex(
            (s) =>
              s.kind === 'text' &&
              s.contentType === startType &&
              Number(s.contentId) === Number(startId) &&
              Number(s.pageIndex) === Number(startPageIndex),
          );
          if (pageIdx >= 0) startIdx = pageIdx;
        }
        pendingScrollIdx.current = startIdx;
        setIndex(startIdx);
        await trackSlide(startIdx);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load lesson.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [
    courseId,
    courseLessonIds,
    lessonId,
    redoQuiz,
    restart,
    startId,
    startOrderIndex,
    startPageIndex,
    startType,
    titleParam,
    trackSlide,
    user?.id,
  ]);

  useEffect(() => {
    const idx = pendingScrollIdx.current;
    if (idx == null || !slides.length) return;
    pendingScrollIdx.current = null;
    requestAnimationFrame(() => {
      try {
        flatListRef.current?.scrollToIndex({ index: idx, animated: false });
      } catch {
        flatListRef.current?.scrollToOffset({ offset: idx * slideW, animated: false });
      }
    });
  }, [slides, slideW]);

  const toggleMulti = (key: string, optIndex: number) => {
    setMultiSelected((prev) => {
      const set = new Set(prev[key] || []);
      if (set.has(optIndex)) set.delete(optIndex);
      else set.add(optIndex);
      return { ...prev, [key]: Array.from(set).sort((a, b) => a - b) };
    });
  };

  const submitQuiz = async (pack: QuizPayload) => {
    const liveQuiz = pack.mode === 'v2' ? pack.quiz : pack.quiz;
    if (!liveQuiz?.questions?.length) return;

    setQuizSubmitLoading(pack.quizKey);
    try {
      if (pack.mode === 'v2') {
        const answers = (liveQuiz.questions || []).reduce((acc: Record<string, any>, q: any) => {
          const k = qKey(pack, q.id);
          if (q.type === 'mcq_single' || !q.type) acc[q.id] = { selectedIndex: selectedMcq[k] ?? -1 };
          else if (q.type === 'mcq_multi') acc[q.id] = { selectedIndices: multiSelected[k] || [] };
          else if (q.type === 'matching') acc[q.id] = { matches: matchingSelected[k] || {} };
          else if (q.type === 'fill_blank') {
            const blanks = Object.entries(blankAnswers[k] || {}).map(([blank_key, answer_text]) => ({
              blank_key,
              answer_text,
            }));
            acc[q.id] = { blanks };
          }
          return acc;
        }, {});
        const result = await api.post(`/quizzes/v2/assignment/${pack.assignmentId}/submit`, {
          answers,
          ...(courseId != null ? { courseId: Number(courseId) } : {}),
        });
        const score = Number(result.score ?? 0);
        const total = Number(result.maxScore ?? 0);
        const review = resolveQuizReview(result.review, liveQuiz.questions, result.responses);
        setQuizOutcome((o) => ({
          ...o,
          [pack.quizKey]: { score, total, ...(review?.length ? { review } : {}) },
        }));
        if (user?.id) {
          await markQuizDone(
            user.id,
            courseId,
            lessonId,
            pack.quizId,
            score,
            total,
            summaryRef.current,
            review,
          );
        }
      } else {
        const answers = liveQuiz.questions.map((q: any) => {
          const k = qKey(pack, q.id);
          return selectedMcq[k] ?? -1;
        });
        const result = await api.post(`/quizzes/lesson/${pack.lessonId}/submit`, {
          answers,
          ...(courseId != null ? { courseId: Number(courseId) } : {}),
        });
        const score = Number(result.score ?? 0);
        const total = Number(result.total ?? 0);
        const review = Array.isArray(result.review) ? result.review : undefined;
        setQuizOutcome((o) => ({
          ...o,
          [pack.quizKey]: { score, total, ...(review?.length ? { review } : {}) },
        }));
        if (user?.id) {
          await markQuizDone(
            user.id,
            courseId,
            lessonId,
            pack.quizId,
            score,
            total,
            summaryRef.current,
            review,
          );
        }
      }

      const resultIdx = slidesRef.current.findIndex(
        (s) => s.kind === 'quiz_result' && s.quiz.quizKey === pack.quizKey,
      );
      if (resultIdx >= 0) {
        requestAnimationFrame(() => transitionToSlide(resultIdx));
      }
    } catch (e: any) {
      Alert.alert('Submit failed', e?.message || 'Try again.');
    } finally {
      setQuizSubmitLoading(null);
    }
  };

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const idx = Math.round(x / slideW);
      const max = slidesRef.current.length - 1;
      const clamped = Math.min(Math.max(0, idx), max);
      setIndex(clamped);
      void trackSlide(clamped);
    },
    [trackSlide, slideW],
  );

  const onVideoPlayback = useCallback(
    (slide: Extract<LearnSlide, { kind: 'video' }>, status: any) => {
      if (!user?.id || !status?.isLoaded) return;
      const played =
        Boolean(status.didJustFinish) ||
        (typeof status.positionMillis === 'number' && status.positionMillis > 500);
      if (!played) return;
      void markVideoWatched(
        user.id,
        courseId,
        lessonId,
        slide.contentId,
        summaryRef.current,
      );
    },
    [courseId, lessonId, user?.id],
  );

  // Footer is in layout flow (not overlay), so slides must not reserve bottom inset —
  // that padding showed up as the white strip above Exit / page nav.
  const pagePad = { width: slideW };

  const renderSlide = ({ item, index: listIndex }: { item: LearnSlide; index: number }) => {
    switch (item.kind) {
      case 'intro':
        return (
          <View style={[styles.page, styles.introPage, pagePad]}>
            <View style={styles.heroCard}>
              <Text style={styles.heroEyebrow}>Lesson</Text>
              <Text style={styles.heroTitle}>{item.lessonTitle}</Text>
              <Text style={styles.heroHint}>{item.hint || 'Swipe to begin.'}</Text>
            </View>
          </View>
        );

      case 'video':
        return (
          <View style={[styles.page, styles.videoPage, pagePad]}>
            <Video
              ref={listIndex === index ? learnVideoRef : undefined}
              source={{ uri: item.videoUrl }}
              style={styles.video}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay={listIndex === index}
              useNativeControls
              onPlaybackStatusUpdate={(status) => onVideoPlayback(item, status)}
              onFullscreenUpdate={(e) => {
                void applyVideoFullscreenOrientation(e.fullscreenUpdate, setNativeFullscreen);
              }}
            />
          </View>
        );

      case 'text':
        return (
          <View style={[styles.page, pagePad]}>
            {(!item.blocks || item.blocks.length === 0) && item.description ? (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.textScroll}>
                <Text style={styles.fallbackText}>{item.description}</Text>
              </ScrollView>
            ) : !item.blocks?.length ? (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.textScroll}>
                <Text style={styles.fallbackText}>No body text for this section.</Text>
              </ScrollView>
            ) : (
              <ScrollView
                style={styles.textBlocksScroll}
                contentContainerStyle={styles.textBlocksContent}
                showsVerticalScrollIndicator={false}
              >
                <ContentBlocksView
                  blocks={item.blocks}
                  description={item.description}
                  scrollable={false}
                  horizontalInset={40}
                />
              </ScrollView>
            )}
          </View>
        );

      case 'quizzes_list':
        return <View style={[styles.page, pagePad]} />;

      case 'quiz_question':
        return (
          <View style={[styles.page, pagePad]}>
            <QuizQuestionPage
              item={item}
              qKey={qKey(item.quiz, item.question.id)}
              selectedMcq={selectedMcq}
              setSelectedMcq={setSelectedMcq}
              multiSelected={multiSelected}
              toggleMulti={toggleMulti}
              matchingSelected={matchingSelected}
              setMatchingSelected={setMatchingSelected}
              blankAnswers={blankAnswers}
              setBlankAnswers={setBlankAnswers}
              onPrevQuestion={() => {
                if (item.qIndex > 0) goToSlide(index - 1);
              }}
              onNextQuestion={() => {
                if (item.qIndex < item.qTotal - 1) goToSlide(index + 1);
              }}
              onSubmit={() => void submitQuiz(item.quiz)}
              submitLoading={quizSubmitLoading === item.quiz.quizKey}
            />
          </View>
        );

      case 'quiz_start': {
        const quizTitle =
          item.quiz.mode === 'v2' ? item.quiz.quiz?.title || 'Quiz' : item.quiz.quiz.title;
        return (
          <View style={[styles.page, styles.centerSheet, pagePad]}>
            <View style={styles.quizStartCard}>
              <Text style={styles.quizStartEyebrow}>Quiz</Text>
              <Text style={styles.quizStartTitle}>{quizTitle}</Text>
              <Text style={styles.quizStartMeta}>
                {item.questionCount} question{item.questionCount === 1 ? '' : 's'}
              </Text>
              <Text style={styles.quizStartHint}>
                Answer each question, then submit on the last one. You can redo after you finish.
              </Text>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => {
                  const jump = slidesRef.current.findIndex(
                    (s) =>
                      s.kind === 'quiz_question' &&
                      s.quiz.quizKey === item.quiz.quizKey &&
                      s.qIndex === 0,
                  );
                  if (jump >= 0) transitionToSlide(jump);
                }}
              >
                <Text style={styles.primaryBtnText}>Start quiz</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      }

      case 'quiz_result': {
        const o = quizOutcome[item.quiz.quizKey];
        const quizTitle =
          item.quiz.mode === 'v2' ? item.quiz.quiz?.title || 'Quiz' : item.quiz.quiz.title;
        return (
          <View style={[styles.page, { width: slideW, paddingHorizontal: 0 }]}>
            {!o ? (
              <CelebrationMoment variant="quiz_pending" subjectTitle={quizTitle} />
            ) : (
              <CelebrationMoment
                variant="quiz_result"
                subjectTitle={quizTitle}
                score={o.score}
                total={o.total}
                review={o.review}
              >
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => {
                    const prefix = `${item.quiz.quizKey}:`;
                    reviewFetchTriedRef.current.delete(item.quiz.quizKey);
                    setQuizOutcome((prev) => {
                      const next = { ...prev };
                      delete next[item.quiz.quizKey];
                      return next;
                    });
                    setSelectedMcq((prev) => {
                      const next = { ...prev };
                      for (const k of Object.keys(next)) if (k.startsWith(prefix)) delete next[k];
                      return next;
                    });
                    setMultiSelected((prev) => {
                      const next = { ...prev };
                      for (const k of Object.keys(next)) if (k.startsWith(prefix)) delete next[k];
                      return next;
                    });
                    setMatchingSelected((prev) => {
                      const next = { ...prev };
                      for (const k of Object.keys(next)) if (k.startsWith(prefix)) delete next[k];
                      return next;
                    });
                    setBlankAnswers((prev) => {
                      const next = { ...prev };
                      for (const k of Object.keys(next)) if (k.startsWith(prefix)) delete next[k];
                      return next;
                    });
                    const jump = slidesRef.current.findIndex(
                      (s) => s.kind === 'quiz_start' && s.quiz.quizKey === item.quiz.quizKey,
                    );
                    if (jump >= 0) transitionToSlide(jump);
                  }}
                >
                  <Text style={styles.primaryBtnText}>Redo quiz</Text>
                </TouchableOpacity>
              </CelebrationMoment>
            )}
          </View>
        );
      }

      case 'open_notes':
        return (
          <View style={[styles.page, styles.centerSheet, pagePad]}>
            <Text style={styles.sectionLabel}>{item.sectionTitle}</Text>
            <Text style={styles.submitHint}>{item.notes.length} PDF file{item.notes.length === 1 ? '' : 's'} attached.</Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => navigation.navigate('ClassNotes', { notes: item.notes })}
            >
              <Text style={styles.primaryBtnText}>Open class notes</Text>
            </TouchableOpacity>
          </View>
        );

      case 'open_pdf_sheet':
        return (
          <View style={[styles.page, styles.centerSheet, pagePad]}>
            <Text style={styles.sectionLabel}>{item.sectionTitle}</Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => navigation.navigate('Worksheet', { worksheets: item.worksheets })}
            >
              <Text style={styles.primaryBtnText}>Open worksheet files</Text>
            </TouchableOpacity>
          </View>
        );

      case 'assignment':
        return (
          <View style={[styles.page, styles.centerSheet, pagePad]}>
            <Text style={styles.sectionLabel}>{item.title}</Text>
            {item.description ? <Text style={styles.submitHint}>{item.description}</Text> : null}
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() =>
                navigation.navigate('AssignmentLibraryDetail', {
                  assignmentId: item.assignmentId,
                  title: item.title,
                })
              }
            >
              <Text style={styles.primaryBtnText}>Open assignment</Text>
            </TouchableOpacity>
          </View>
        );

      case 'done':
        return (
          <View style={[styles.page, { width: slideW, paddingHorizontal: 0 }]}>
            {user?.id ? (
              <LessonCompleteCelebration
                lessonTitle={item.lessonTitle}
                userId={user.id}
                courseId={courseId}
                lessonId={lessonId}
                summary={summaryRef.current}
              />
            ) : (
              <CelebrationMoment variant="lesson" subjectTitle={item.lessonTitle} />
            )}
          </View>
        );

      default:
        return <View style={pagePad} />;
    }
  };

  const goToSlide = useCallback(
    (next: number, animated = true) => {
      const max = slidesRef.current.length - 1;
      const clamped = Math.min(Math.max(0, next), Math.max(0, max));
      try {
        flatListRef.current?.scrollToIndex({ index: clamped, animated });
      } catch {
        flatListRef.current?.scrollToOffset({ offset: clamped * slideW, animated });
      }
      setIndex(clamped);
      void trackSlide(clamped);
    },
    [slideW, trackSlide],
  );

  /**
   * Shared hop for categories, sibling items, and quiz squares:
   * soft lateral dissolve (drift out → land from the other side), no whip-scroll.
   */
  const transitionToSlide = useCallback(
    (next: number) => {
      const max = slidesRef.current.length - 1;
      const clamped = Math.min(Math.max(0, next), Math.max(0, max));
      if (clamped === index) return;
      const direction = clamped > index ? 1 : -1;

      Animated.parallel([
        Animated.timing(contentFade, {
          toValue: 0,
          duration: 160,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(contentShiftX, {
          toValue: -direction * 36,
          duration: 160,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!finished) return;
        goToSlide(clamped, false);
        contentShiftX.setValue(direction * 36);
        requestAnimationFrame(() => {
          Animated.parallel([
            Animated.timing(contentFade, {
              toValue: 1,
              duration: 300,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(contentShiftX, {
              toValue: 0,
              duration: 320,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]).start();
        });
      });
    },
    [contentFade, contentShiftX, goToSlide, index],
  );

  const currentSlide = slides[index];
  const reviewFetchTriedRef = useRef(new Set<string>());

  // If results opened without Review Answers (old local cache / prior API), fetch once.
  useEffect(() => {
    if (!currentSlide || currentSlide.kind !== 'quiz_result') return;
    const pack = currentSlide.quiz;
    const existing = quizOutcome[pack.quizKey];
    if (!existing || existing.review?.length) return;
    if (reviewFetchTriedRef.current.has(pack.quizKey)) return;
    reviewFetchTriedRef.current.add(pack.quizKey);
    let cancelled = false;
    const courseQ =
      courseId != null ? `?courseId=${encodeURIComponent(String(courseId))}` : '';
    void (async () => {
      try {
        let review: any[] | undefined;
        let score = existing.score;
        let total = existing.total;
        if (pack.mode === 'v2' && pack.assignmentId) {
          const latest = await api.get(
            `/quizzes/v2/assignment/${pack.assignmentId}/attempts/latest${courseQ}`,
          );
          if (!latest) return;
          if (latest.score != null && latest.max_score != null) {
            score = Number(latest.score);
            total = Number(latest.max_score);
          }
          review = resolveQuizReview(latest.review, pack.quiz?.questions, latest.responses);
        } else if (pack.mode === 'legacy' && pack.lessonId) {
          const latest = await api.get(
            `/quizzes/lesson/${pack.lessonId}/attempts/latest${courseQ}`,
          );
          if (!latest) return;
          if (latest.score != null && latest.total != null) {
            score = Number(latest.score);
            total = Number(latest.total);
          }
          if (Array.isArray(latest.review) && latest.review.length) review = latest.review;
        }
        if (cancelled || !review?.length) return;
        setQuizOutcome((prev) => ({
          ...prev,
          [pack.quizKey]: { score, total, review },
        }));
        if (user?.id) {
          void markQuizDone(
            user.id,
            courseId,
            lessonId,
            pack.quizId,
            score,
            total,
            summaryRef.current,
            review,
          );
        }
      } catch {
        /* keep score-only result */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, currentSlide, lessonId, quizOutcome, user?.id]);

  const itemTitle = slideItemTitle(currentSlide);
  const activeCategory = slideLibraryCategory(currentSlide);
  const categorySteps = libraryCategoriesInOrder(slides);
  const quizActive =
    currentSlide?.kind === 'quiz_start' ||
    currentSlide?.kind === 'quiz_question' ||
    currentSlide?.kind === 'quiz_result';
  const deckQuizzes = listQuizzesInDeck(slides);
  const activeQuizKey =
    currentSlide &&
    (currentSlide.kind === 'quiz_start' ||
      currentSlide.kind === 'quiz_question' ||
      currentSlide.kind === 'quiz_result')
      ? currentSlide.quiz.quizKey
      : null;
  const categoryItems =
    activeCategory && !quizActive ? listItemsInLibraryCategory(slides, activeCategory) : [];
  const activeItemKey = currentSlide ? siblingItemKey(currentSlide) : null;
  const showQuizSquares = quizActive && deckQuizzes.length > 1;
  const showCategorySquares = !quizActive && categoryItems.length > 1;
  const pagedMaterial =
    currentSlide?.kind === 'text' &&
    (currentSlide.contentType === 'study_material' || currentSlide.contentType === 'worksheet') &&
    Number(currentSlide.pageCount) > 1
      ? {
          page: Number(currentSlide.pageIndex) + 1,
          total: Number(currentSlide.pageCount),
          contentType: currentSlide.contentType,
          contentId: currentSlide.contentId,
          pageIndex: Number(currentSlide.pageIndex),
        }
      : null;

  const goToPagedMaterial = useCallback(
    (delta: number) => {
      if (!pagedMaterial) return;
      const targetPage = pagedMaterial.pageIndex + delta;
      if (targetPage < 0 || targetPage >= pagedMaterial.total) return;
      const jump = slidesRef.current.findIndex(
        (s) =>
          s.kind === 'text' &&
          s.contentType === pagedMaterial.contentType &&
          Number(s.contentId) === Number(pagedMaterial.contentId) &&
          Number(s.pageIndex) === targetPage,
      );
      if (jump >= 0) goToSlide(jump, true);
    },
    [goToSlide, pagedMaterial],
  );

  const openQuizSquare = useCallback(
    (quizKey: string) => {
      const entry = listQuizzesInDeck(slidesRef.current).find((q) => q.quizKey === quizKey);
      if (!entry) return;
      const done = Boolean(quizOutcome[quizKey]);
      const targetKey = done ? entry.resultKey : entry.startKey;
      const jump = slidesRef.current.findIndex((s) => s.key === targetKey);
      if (jump >= 0) transitionToSlide(jump);
    },
    [transitionToSlide, quizOutcome],
  );

  const openLibraryCategory = useCallback(
    (categoryId: (typeof categorySteps)[number]['id']) => {
      if (categoryId === 'quiz') {
        const first = listQuizzesInDeck(slidesRef.current)[0];
        if (first) {
          openQuizSquare(first.quizKey);
          return;
        }
      }
      const target = firstIndexForLibraryCategory(slidesRef.current, categoryId);
      if (target >= 0) transitionToSlide(target);
    },
    [openQuizSquare, transitionToSlide],
  );

  const footerNext = nextLessonFooterAction(slides, index);
  const showCloseFooter = currentSlide?.kind === 'done';

  const goFooterNext = useCallback(() => {
    const action = nextLessonFooterAction(slidesRef.current, index);
    if (!action) {
      navigation.goBack();
      return;
    }
    if (action.kind === 'done') {
      transitionToSlide(action.doneIndex);
      return;
    }
    if (action.item.category === 'quiz' && action.item.quizKey) {
      openQuizSquare(action.item.quizKey);
      return;
    }
    transitionToSlide(action.item.firstIndex);
  }, [index, navigation, openQuizSquare, transitionToSlide]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {!loading && !error && slides.length > 0 ? (
        <View style={styles.chrome}>
          {categorySteps.length > 0 ? (
            <View style={styles.categoryCard}>
              <View style={styles.categoryStepper}>
                {categorySteps.map((step, i) => {
                  const activeIdx = categorySteps.findIndex((s) => s.id === activeCategory);
                  const active = activeCategory === step.id;
                  const reached = activeIdx >= 0 && i <= activeIdx;
                  return (
                    <TouchableOpacity
                      key={step.id}
                      style={styles.categoryStep}
                      onPress={() => openLibraryCategory(step.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={step.label}
                    >
                      {i < categorySteps.length - 1 ? (
                        <View
                          style={[
                            styles.categoryConnector,
                            reached && i < activeIdx && styles.categoryConnectorReached,
                          ]}
                        />
                      ) : null}
                      <View
                        style={[
                          styles.categoryDot,
                          reached && styles.categoryDotReached,
                          active && styles.categoryDotActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.categoryDotText,
                            reached && styles.categoryDotTextReached,
                            active && styles.categoryDotTextActive,
                          ]}
                        >
                          {i + 1}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.categoryLabel,
                          reached && styles.categoryLabelReached,
                          active && styles.categoryLabelActive,
                        ]}
                        numberOfLines={2}
                      >
                        {step.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}

          {showQuizSquares ? (
            <View style={styles.quizSquareBar}>
              <Text style={styles.quizSquareLabel} numberOfLines={1}>
                {itemTitle || 'Quizzes'}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.quizSquareRow}
                style={styles.quizSquareScroll}
              >
                {deckQuizzes.map((qz, i) => {
                  const active = qz.quizKey === activeQuizKey;
                  const done = Boolean(quizOutcome[qz.quizKey]);
                  return (
                    <TouchableOpacity
                      key={qz.quizKey}
                      style={[
                        styles.quizSquare,
                        active && styles.quizSquareActive,
                        done && !active && styles.quizSquareDone,
                      ]}
                      onPress={() => openQuizSquare(qz.quizKey)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`Quiz ${i + 1}${done ? ', completed' : ''}`}
                    >
                      <Text
                        style={[
                          styles.quizSquareText,
                          active && styles.quizSquareTextActive,
                          done && !active && styles.quizSquareTextDone,
                        ]}
                      >
                        {i + 1}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : showCategorySquares ? (
            <View style={styles.quizSquareBar}>
              <Text style={styles.quizSquareLabel} numberOfLines={1}>
                {itemTitle || 'Items'}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.quizSquareRow}
                style={styles.quizSquareScroll}
              >
                {categoryItems.map((it, i) => {
                  const active = it.key === activeItemKey;
                  return (
                    <TouchableOpacity
                      key={it.key}
                      style={[styles.quizSquare, active && styles.quizSquareActive]}
                      onPress={() => transitionToSlide(it.firstIndex)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${it.title || `Item ${i + 1}`}`}
                    >
                      <Text
                        style={[styles.quizSquareText, active && styles.quizSquareTextActive]}
                      >
                        {i + 1}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : itemTitle ? (
            <Text style={styles.itemTitle} numberOfLines={2}>
              {itemTitle}
            </Text>
          ) : null}
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      ) : error ? (
        <View style={styles.loader}>
          <Text style={styles.err}>{error}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.primaryBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Animated.View
          style={[
            styles.slideHost,
            {
              opacity: contentFade,
              transform: [{ translateX: contentShiftX }],
            },
          ]}
        >
          <FlatList
            ref={flatListRef}
            data={slides}
            horizontal
            pagingEnabled
            keyExtractor={(s) => s.key}
            renderItem={renderSlide}
            style={styles.slideList}
            getItemLayout={(_, i) => ({ length: slideW, offset: slideW * i, index: i })}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onMomentumEnd}
            scrollEventThrottle={16}
            onScrollToIndexFailed={(info) => {
              flatListRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            }}
            extraData={{ index, quizOutcome, bottomInset: insets.bottom }}
          />
        </Animated.View>
      )}

      {!loading ? (
        <View style={[styles.exitFooter, showCloseFooter && styles.exitFooterCelebrate]}>
          {pagedMaterial ? (
            <View style={styles.pageNav}>
              <TouchableOpacity
                style={[styles.pageNavArrow, pagedMaterial.page <= 1 && styles.pageNavArrowDisabled]}
                disabled={pagedMaterial.page <= 1}
                onPress={() => goToPagedMaterial(-1)}
                accessibilityRole="button"
                accessibilityLabel="Previous page"
              >
                <Ionicons
                  name="chevron-back"
                  size={18}
                  color={pagedMaterial.page <= 1 ? '#cbd5e1' : BRAND_RED}
                />
              </TouchableOpacity>
              <Text style={styles.pageNavMeta}>
                Page {pagedMaterial.page} of {pagedMaterial.total}
              </Text>
              <TouchableOpacity
                style={[
                  styles.pageNavArrow,
                  pagedMaterial.page >= pagedMaterial.total && styles.pageNavArrowDisabled,
                ]}
                disabled={pagedMaterial.page >= pagedMaterial.total}
                onPress={() => goToPagedMaterial(1)}
                accessibilityRole="button"
                accessibilityLabel="Next page"
              >
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={pagedMaterial.page >= pagedMaterial.total ? '#cbd5e1' : BRAND_RED}
                />
              </TouchableOpacity>
            </View>
          ) : null}
          {showCloseFooter ? (
            <TouchableOpacity
              style={[styles.exitFooterBtn, styles.exitFooterBtnCelebrate]}
              onPress={() => navigation.goBack()}
              accessibilityRole="button"
            >
              <Text style={styles.exitFooterBtnText}>Close</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.exitFooterRow}>
              <TouchableOpacity
                style={[styles.exitFooterBtn, styles.exitFooterBtnExit]}
                onPress={() => navigation.goBack()}
                accessibilityRole="button"
              >
                <Text style={styles.exitFooterBtnExitText}>Exit</Text>
              </TouchableOpacity>
              {footerNext ? (
                <TouchableOpacity
                  style={[styles.exitFooterBtn, styles.exitFooterBtnCategory]}
                  onPress={goFooterNext}
                  accessibilityRole="button"
                  accessibilityLabel={footerNext.label}
                >
                  <Text style={styles.exitFooterBtnText} numberOfLines={1}>
                    {footerNext.label}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
          <View
            style={{
              height: Math.max(insets.bottom, 12),
              backgroundColor: showCloseFooter ? '#f5f7fc' : '#e8eef9',
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function QuizQuestionPage({
  item,
  qKey: key,
  selectedMcq,
  setSelectedMcq,
  multiSelected,
  toggleMulti,
  matchingSelected,
  setMatchingSelected,
  blankAnswers,
  setBlankAnswers,
  onPrevQuestion,
  onNextQuestion,
  onSubmit,
  submitLoading,
}: {
  item: Extract<LearnSlide, { kind: 'quiz_question' }>;
  qKey: string;
  selectedMcq: Record<string, number>;
  setSelectedMcq: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  multiSelected: Record<string, number[]>;
  toggleMulti: (key: string, optIndex: number) => void;
  matchingSelected: Record<string, Record<string, string>>;
  setMatchingSelected: React.Dispatch<React.SetStateAction<Record<string, Record<string, string>>>>;
  blankAnswers: Record<string, Record<string, string>>;
  setBlankAnswers: React.Dispatch<React.SetStateAction<Record<string, Record<string, string>>>>;
  onPrevQuestion: () => void;
  onNextQuestion: () => void;
  onSubmit: () => void;
  submitLoading: boolean;
}) {
  const q = item.question;
  const isLast = item.qIndex >= item.qTotal - 1;
  const blink = useRef(new Animated.Value(1)).current;
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    blink.setValue(1);
    if (autoAdvanceTimer.current) {
      clearTimeout(autoAdvanceTimer.current);
      autoAdvanceTimer.current = null;
    }
    return () => {
      if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    };
  }, [key, blink]);

  const selectSingle = (optIndex: number) => {
    setSelectedMcq((s) => ({ ...s, [key]: optIndex }));
    if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    blink.setValue(1);
    Animated.sequence([
      Animated.timing(blink, { toValue: 0.35, duration: 140, useNativeDriver: true }),
      Animated.timing(blink, { toValue: 1, duration: 140, useNativeDriver: true }),
      Animated.timing(blink, { toValue: 0.35, duration: 140, useNativeDriver: true }),
      Animated.timing(blink, { toValue: 1, duration: 140, useNativeDriver: true }),
    ]).start();
    if (!isLast) {
      autoAdvanceTimer.current = setTimeout(() => {
        onNextQuestion();
      }, 650);
    }
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.quizScroll}>
      <Text style={styles.progressPill}>
        Question {item.qIndex + 1} of {item.qTotal}
      </Text>
      <Text style={styles.quizDeckTitle}>{q.question_text || q.prompt}</Text>

      {(q.type === 'mcq_single' || !q.type) &&
        (q.options || []).map((opt: any, optIndex: number) => {
          const selected = selectedMcq[key] === optIndex;
          return (
            <Animated.View key={optIndex} style={selected ? { opacity: blink } : undefined}>
              <TouchableOpacity
                style={[styles.option, selected && styles.optionSel]}
                onPress={() => selectSingle(optIndex)}
              >
                <Text style={[styles.optionText, selected && styles.optionTextSel]}>
                  {opt.option_text || opt}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          );
        })}

      {q.type === 'mcq_multi' &&
        (q.options || []).map((opt: any, optIndex: number) => {
          const active = (multiSelected[key] || []).includes(optIndex);
          return (
            <TouchableOpacity
              key={optIndex}
              style={[styles.option, styles.optionMultiRow, active && styles.optionSel]}
              onPress={() => toggleMulti(key, optIndex)}
            >
              <View style={[styles.checkbox, active && styles.checkboxOn]}>
                {active ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
              </View>
              <Text style={[styles.optionText, active && styles.optionTextSel, { flex: 1 }]}>
                {opt.option_text || opt}
              </Text>
            </TouchableOpacity>
          );
        })}

      {q.type === 'matching' ? (
        <MatchingDragBoard
          pairs={q.pairs || []}
          matches={matchingSelected[key] || {}}
          onChange={(next) => setMatchingSelected((prev) => ({ ...prev, [key]: next }))}
        />
      ) : null}

      {q.type === 'fill_blank' &&
        (q.solutions || []).map((soln: any, sIdx: number) => (
          <View key={sIdx} style={{ marginBottom: 12 }}>
            <Text style={styles.matchLeft}>{soln.blank_key}</Text>
            <TextInput
              style={styles.input}
              value={blankAnswers[key]?.[String(soln.blank_key)] || ''}
              onChangeText={(txt) =>
                setBlankAnswers((prev) => ({
                  ...prev,
                  [key]: { ...(prev[key] || {}), [String(soln.blank_key)]: txt || '' },
                }))
              }
              placeholder="Your answer"
              placeholderTextColor="#94a3b8"
            />
          </View>
        ))}

      <View style={styles.quizNavRow}>
        <TouchableOpacity
          style={[styles.quizNavArrow, item.qIndex === 0 && styles.quizNavArrowDisabled]}
          disabled={item.qIndex === 0}
          onPress={onPrevQuestion}
          accessibilityRole="button"
          accessibilityLabel="Previous question"
        >
          <Ionicons name="chevron-back" size={36} color={item.qIndex === 0 ? '#cbd5e1' : BRAND_BLUE} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.quizNavArrow, isLast && styles.quizNavArrowDisabled]}
          disabled={isLast}
          onPress={onNextQuestion}
          accessibilityRole="button"
          accessibilityLabel="Next question"
        >
          <Ionicons name="chevron-forward" size={36} color={isLast ? '#cbd5e1' : BRAND_BLUE} />
        </TouchableOpacity>
      </View>

      {isLast ? (
        <TouchableOpacity
          style={[styles.quizSubmitInline, submitLoading && styles.btnMuted]}
          onPress={onSubmit}
          disabled={submitLoading}
        >
          <Text style={styles.primaryBtnText}>{submitLoading ? 'Submitting…' : 'Submit quiz'}</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#e8eef9', minHeight: 0 },
  chrome: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#cfd8ea',
    backgroundColor: '#e8eef9',
    gap: 10,
  },
  categoryCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#dfe7f8',
  },
  categoryStepper: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  categoryStep: {
    flex: 1,
    alignItems: 'center',
    position: 'relative',
    paddingHorizontal: 2,
  },
  categoryDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#eef2f7',
    borderWidth: 2,
    borderColor: '#d7deed',
    marginBottom: 6,
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryDotReached: {
    backgroundColor: '#fff1f2',
    borderColor: '#fda4af',
  },
  categoryDotActive: {
    backgroundColor: BRAND_RED,
    borderColor: BRAND_RED,
    width: 28,
    height: 28,
    borderRadius: 14,
    marginBottom: 5,
  },
  categoryDotText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#94a3b8',
  },
  categoryDotTextReached: { color: BRAND_RED },
  categoryDotTextActive: { color: '#fff', fontSize: 13 },
  categoryLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 15,
    paddingHorizontal: 1,
  },
  categoryLabelReached: { color: '#64748b', fontWeight: '700' },
  categoryLabelActive: { color: BRAND_RED, fontWeight: '800' },
  categoryConnector: {
    position: 'absolute',
    top: 12,
    left: '58%',
    width: '84%',
    height: 2,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
    zIndex: 1,
  },
  categoryConnectorReached: { backgroundColor: '#fda4af' },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  arrowBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dfe7f8',
  },
  arrowBtnDisabled: { opacity: 0.35 },
  arrowText: { fontSize: 28, lineHeight: 30, color: BRAND_BLUE, fontWeight: '300', marginTop: -2 },
  arrowTextDisabled: { color: '#94a3b8' },
  typeLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '800',
    color: BRAND_BLUE,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  itemTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: -0.2,
    paddingHorizontal: 2,
    textAlign: 'center',
  },
  pageNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#f1c4cb',
    paddingVertical: 6,
    paddingHorizontal: 6,
    marginBottom: 10,
  },
  pageNavArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff5f5',
  },
  pageNavArrowDisabled: { backgroundColor: '#f8fafc' },
  pageNavMeta: {
    flex: 1,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: 0.1,
  },
  exitFooter: {
    paddingHorizontal: 14,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#cfd8ea',
    backgroundColor: '#e8eef9',
  },
  exitFooterCelebrate: {
    borderTopColor: '#e8ecf7',
    backgroundColor: '#f5f7fc',
  },
  exitFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  exitFooterBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitFooterBtnExit: {
    flex: 0.9,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#cbd5e1',
  },
  exitFooterBtnCategory: {
    flex: 1.35,
    backgroundColor: BRAND_RED,
    shadowColor: BRAND_RED,
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  exitFooterBtnCelebrate: {
    backgroundColor: BRAND_RED,
    borderRadius: 14,
    paddingVertical: 14,
    shadowColor: BRAND_RED,
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  exitFooterBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  exitFooterBtnExitText: {
    color: '#64748b',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28 },
  err: { color: '#991b1b', textAlign: 'center', marginBottom: 16, fontSize: 16 },
  slideHost: { flex: 1, minHeight: 0 },
  slideList: { flex: 1 },
  page: { flex: 1, backgroundColor: '#f8fafc', minHeight: 0 },
  introPage: { justifyContent: 'center', paddingHorizontal: 16 },
  videoPage: { paddingTop: 8, minHeight: 0 },
  video: { flex: 1, width: '100%', minHeight: 0, backgroundColor: '#0f172a' },
  centerSheet: {
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  heroCard: {
    padding: 22,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dfe7f8',
    shadowColor: BRAND_BLUE,
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    maxHeight: '88%',
  },
  heroEyebrow: { fontSize: 13, letterSpacing: 1.6, fontWeight: '700', color: BRAND_RED, marginBottom: 10 },
  heroTitle: { fontSize: 26, fontWeight: '700', color: '#0f172a', lineHeight: 32 },
  heroHint: { marginTop: 16, fontSize: 16, color: '#475569', lineHeight: 24 },
  sectionLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: BRAND_BLUE,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
    backgroundColor: '#f8fafc',
  },
  textScroll: { padding: 28, paddingBottom: 40 },
  textBlocksScroll: { flex: 1 },
  textBlocksContent: { paddingBottom: 24 },
  fallbackText: { fontSize: 16, color: '#64748b', lineHeight: 24 },
  quizScroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 96 },
  progressPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#e0e7ff',
    color: BRAND_BLUE,
    fontWeight: '700',
    fontSize: 12,
    marginBottom: 12,
  },
  quizDeckTitle: { fontSize: 18, fontWeight: '700', color: '#1e293b', marginBottom: 16 },
  submitHint: { fontSize: 15, color: '#64748b', textAlign: 'center', marginBottom: 22, lineHeight: 22 },
  quizStartCard: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e4ebf8',
    padding: 24,
    shadowColor: BRAND_BLUE,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  quizStartEyebrow: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: BRAND_RED,
    marginBottom: 8,
  },
  quizStartTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: BRAND_BLUE,
    lineHeight: 30,
    marginBottom: 8,
  },
  quizStartMeta: { fontSize: 14, fontWeight: '600', color: '#64748b', marginBottom: 12 },
  quizStartHint: { fontSize: 15, color: '#475569', lineHeight: 22, marginBottom: 22 },
  quizSquareBar: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e4ebf8',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  quizSquareLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
  },
  quizSquareScroll: {
    width: '100%',
  },
  quizSquareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    width: '100%',
    gap: 8,
    paddingVertical: 2,
  },
  quizSquare: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quizSquareActive: {
    borderColor: BRAND_RED,
    backgroundColor: BRAND_RED,
  },
  quizSquareDone: {
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
  },
  quizSquareText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#64748b',
  },
  quizSquareTextActive: { color: '#fff' },
  quizSquareTextDone: { color: '#15803d' },
  quizNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 28,
    paddingTop: 8,
  },
  quizNavArrow: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#dfe7f8',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: BRAND_BLUE,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  quizNavArrowDisabled: {
    opacity: 0.4,
    borderColor: '#e2e8f0',
  },
  quizSubmitInline: {
    marginTop: 14,
    backgroundColor: BRAND_RED,
    borderRadius: 16,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryBtn: {
    backgroundColor: BRAND_RED,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    alignItems: 'center',
    minWidth: 200,
    alignSelf: 'center',
  },
  btnMuted: { opacity: 0.65 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  option: {
    borderWidth: 2,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  optionMultiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxOn: {
    borderColor: BRAND_BLUE,
    backgroundColor: BRAND_BLUE,
  },
  optionWide: {
    borderWidth: 2,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginRight: 8,
  },
  optionSel: { borderColor: BRAND_BLUE, backgroundColor: '#eef2ff' },
  optionText: { fontSize: 15, color: '#334155' },
  optionTextSel: { color: BRAND_BLUE, fontWeight: '700' },
  matchLeft: { fontSize: 14, fontWeight: '600', color: '#475569', marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
    color: '#0f172a',
  },
  resultBig: { fontSize: 28, fontWeight: '700', color: BRAND_BLUE, marginTop: 8 },
  quizPickCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e4ebf8',
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
    shadowColor: BRAND_BLUE,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  quizPickIndexWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#fff5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quizPickIndex: { fontSize: 15, fontWeight: '800', color: BRAND_RED },
  quizPickTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', lineHeight: 22 },
  quizPickMeta: { marginTop: 3, fontSize: 13, color: '#64748b' },
});
