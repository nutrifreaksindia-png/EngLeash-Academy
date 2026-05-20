import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
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
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ContentBlocksView } from '../components/learn/ContentBlocksView';
import { buildLessonSlides, LearnSlide, QuizPayload } from '../learn/buildLessonSlides';
import {
  clearCourseProgress,
  getLessonProgress,
  saveLessonProgress,
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
  } = (route.params || {}) as {
    courseId: number;
    lessonId: number;
    lessonTitle?: string;
    restart?: boolean;
    courseLessonIds?: number[];
  };
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const slideW = winW;

  const [slides, setSlides] = useState<LearnSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lessonTitle, setLessonTitle] = useState(titleParam || '');
  const [index, setIndex] = useState(0);

  const [selectedMcq, setSelectedMcq] = useState<Record<string, number>>({});
  const [multiSelected, setMultiSelected] = useState<Record<string, number[]>>({});
  const [matchingSelected, setMatchingSelected] = useState<Record<string, Record<string, string>>>({});
  const [blankAnswers, setBlankAnswers] = useState<Record<string, Record<string, string>>>({});

  const [quizOutcome, setQuizOutcome] = useState<Record<string, { score: number; total: number }>>({});
  const [quizSubmitLoading, setQuizSubmitLoading] = useState<string | null>(null);

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

  const persistIndex = useCallback(
    async (idx: number) => {
      if (!user?.id || !slidesRef.current.length) return;
      const slide = slidesRef.current[idx];
      const prev = await getLessonProgress(user.id, courseId, lessonId);
      const completed =
        slide?.kind === 'done' ? true : prev?.completed ?? false;
      await saveLessonProgress(user.id, courseId, lessonId, {
        totalSteps: slidesRef.current.length,
        furthestStepIndex: idx,
        completed,
      });
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

        let startIdx = 0;
        const prev = await getLessonProgress(user.id, courseId, lessonId);
        if (prev?.furthestStepIndex != null) startIdx = Math.max(0, prev.furthestStepIndex);

        const q =
          courseId != null ? `?courseId=${encodeURIComponent(String(courseId))}` : '';
        const lessonPayload = await api.get(`/lessons/${lessonId}${q}`);
        if (cancelled) return;

        const built = await buildLessonSlides({
          ...lessonPayload,
          id: lessonPayload.id ?? lessonId,
          title: lessonPayload.title || titleParam || 'Lesson',
          allowVideoDownload: Boolean(lessonPayload.allowVideoDownload),
        });
        if (cancelled) return;

        setLessonTitle(lessonPayload.title || titleParam || 'Lesson');
        setSlides(built);
        slidesRef.current = built;

        const clampedIdx = Math.min(startIdx, Math.max(0, built.length - 1));
        pendingScrollIdx.current = clampedIdx;
        setIndex(clampedIdx);

        await saveLessonProgress(user.id, courseId, lessonId, {
          totalSteps: built.length,
          furthestStepIndex: clampedIdx,
          completed: Boolean(prev?.completed),
        });
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
  }, [courseId, courseLessonIds, lessonId, restart, titleParam, user?.id]);

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
        const result = await api.post(`/quizzes/v2/assignment/${pack.assignmentId}/submit`, { answers });
        const score = Number(result.score ?? 0);
        const total = Number(result.maxScore ?? 0);
        setQuizOutcome((o) => ({ ...o, [pack.quizKey]: { score, total } }));
      } else {
        const answers = liveQuiz.questions.map((q: any) => {
          const k = qKey(pack, q.id);
          return selectedMcq[k] ?? -1;
        });
        const result = await api.post(`/quizzes/lesson/${pack.lessonId}/submit`, { answers });
        setQuizOutcome((o) => ({
          ...o,
          [pack.quizKey]: { score: Number(result.score ?? 0), total: Number(result.total ?? 0) },
        }));
      }

      const resultIdx = slidesRef.current.findIndex(
        (s) => s.kind === 'quiz_result' && s.quiz.quizKey === pack.quizKey,
      );
      const nextIdx = resultIdx >= 0 ? resultIdx : index + 1;
      requestAnimationFrame(() => {
        try {
          flatListRef.current?.scrollToIndex({
            index: Math.min(Math.max(nextIdx, 0), slidesRef.current.length - 1),
            animated: true,
          });
        } catch {
          /* ignore */
        }
      });
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
      void persistIndex(clamped);
    },
    [persistIndex, slideW],
  );

  const pagePad = { width: slideW, paddingBottom: Math.max(insets.bottom, 12) };

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
            <Text style={styles.sectionLabel}>{item.title}</Text>
            <Video
              ref={listIndex === index ? learnVideoRef : undefined}
              source={{ uri: item.videoUrl }}
              style={styles.video}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay={listIndex === index}
              useNativeControls
              onFullscreenUpdate={(e) => {
                void applyVideoFullscreenOrientation(e.fullscreenUpdate, setNativeFullscreen);
              }}
            />
          </View>
        );

      case 'text':
        return (
          <View style={[styles.page, pagePad]}>
            <Text style={styles.sectionLabel}>{item.sectionTitle}</Text>
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
            />
          </View>
        );

      case 'quiz_submit':
        return (
          <View style={[styles.page, styles.centerSheet, pagePad]}>
            <Text style={styles.quizDeckTitle}>{item.quiz.mode === 'v2' ? item.quiz.quiz?.title || 'Quiz' : item.quiz.quiz.title}</Text>
            <Text style={styles.submitHint}>
              {"When you're happy with all answers on the previous slides, submit for scoring."}
            </Text>
            <TouchableOpacity
              style={[styles.primaryBtn, quizSubmitLoading === item.quiz.quizKey && styles.btnMuted]}
              onPress={() => void submitQuiz(item.quiz)}
              disabled={quizSubmitLoading === item.quiz.quizKey}
            >
              <Text style={styles.primaryBtnText}>
                {quizSubmitLoading === item.quiz.quizKey ? 'Submitting…' : 'Submit quiz'}
              </Text>
            </TouchableOpacity>
          </View>
        );

      case 'quiz_result': {
        const o = quizOutcome[item.quiz.quizKey];
        return (
          <View style={[styles.page, styles.centerSheet, pagePad]}>
            {!o ? (
              <>
                <Text style={styles.quizDeckTitle}>Results pending</Text>
                <Text style={styles.submitHint}>Submit answers from the quiz submit page.</Text>
              </>
            ) : (
              <>
                <Text style={styles.quizDeckTitle}>Quiz complete</Text>
                <Text style={styles.resultBig}>
                  {o.score} / {o.total} correct
                </Text>
              </>
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
          <View style={[styles.page, styles.centerSheet, pagePad]}>
            <Text style={styles.doneEmoji}>✓</Text>
            <Text style={styles.quizDeckTitle}>Lesson complete</Text>
            <Text style={styles.submitHint}>
              {`You've reviewed "${item.lessonTitle}". Tap exit to continue.`}
            </Text>
          </View>
        );

      default:
        return <View style={pagePad} />;
    }
  };

  const headerPct = slides.length ? Math.round(((index + 1) / slides.length) * 100) : 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.exitBtn} onPress={() => navigation.goBack()} accessibilityRole="button">
          <Text style={styles.exitBtnText}>Exit</Text>
        </TouchableOpacity>
        <View style={styles.titleCol}>
          <Text style={styles.topTitle} numberOfLines={1}>
            {lessonTitle}
          </Text>
          {!loading && slides.length ? (
            <Text style={styles.topSub}>
              {index + 1} / {slides.length} ({headerPct}%)
            </Text>
          ) : null}
        </View>
        <View style={styles.exitSpacer} />
      </View>

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
        <View style={styles.slideHost}>
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
        </View>
      )}
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
}) {
  const q = item.question;
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.quizScroll}>
      <Text style={styles.progressPill}>Question {item.qIndex + 1} of {item.qTotal}</Text>
      <Text style={styles.quizDeckTitle}>{q.question_text || q.prompt}</Text>
      {(q.type === 'mcq_single' || !q.type) &&
        (q.options || []).map((opt: any, optIndex: number) => (
          <TouchableOpacity
            key={optIndex}
            style={[styles.option, selectedMcq[key] === optIndex && styles.optionSel]}
            onPress={() => setSelectedMcq((s) => ({ ...s, [key]: optIndex }))}
          >
            <Text style={[styles.optionText, selectedMcq[key] === optIndex && styles.optionTextSel]}>
              {opt.option_text || opt}
            </Text>
          </TouchableOpacity>
        ))}
      {q.type === 'mcq_multi' &&
        (q.options || []).map((opt: any, optIndex: number) => {
          const active = (multiSelected[key] || []).includes(optIndex);
          return (
            <TouchableOpacity key={optIndex} style={[styles.option, active && styles.optionSel]} onPress={() => toggleMulti(key, optIndex)}>
              <Text style={[styles.optionText, active && styles.optionTextSel]}>{opt.option_text || opt}</Text>
            </TouchableOpacity>
          );
        })}
      {q.type === 'matching' && (
        <>
          {(q.pairs || []).map((p: any, pIdx: number) => (
            <View key={pIdx} style={{ marginBottom: 12 }}>
              <Text style={styles.matchLeft}>{p.left_text}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {(q.pairs || []).map((choice: any, cIdx: number) => {
                  const current = matchingSelected[key]?.[String(p.left_text)] === String(choice.right_text);
                  return (
                    <TouchableOpacity
                      key={cIdx}
                      style={[styles.optionWide, current && styles.optionSel]}
                      onPress={() =>
                        setMatchingSelected((prev) => ({
                          ...prev,
                          [key]: { ...(prev[key] || {}), [String(p.left_text)]: String(choice.right_text) },
                        }))
                      }
                    >
                      <Text style={[styles.optionText, current && styles.optionTextSel]}>{choice.right_text}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ))}
        </>
      )}
      {q.type === 'fill_blank' && (
        <>
          {(q.solutions || []).map((soln: any, sIdx: number) => (
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
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#e8eef9', minHeight: 0 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#cfd8ea',
    backgroundColor: '#e8eef9',
  },
  exitBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  exitBtnText: { color: BRAND_BLUE, fontWeight: '700', fontSize: 16 },
  titleCol: { flex: 1, alignItems: 'center' },
  topTitle: { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  topSub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  exitSpacer: { width: 52 },
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
  quizScroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 },
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
  optionWide: {
    borderWidth: 2,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginRight: 8,
  },
  optionSel: { borderColor: BRAND_RED, backgroundColor: '#fff5f5' },
  optionText: { fontSize: 15, color: '#334155' },
  optionTextSel: { color: BRAND_RED, fontWeight: '700' },
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
  doneEmoji: {
    fontSize: 52,
    color: BRAND_RED,
    fontWeight: '800',
    alignSelf: 'center',
    marginBottom: 8,
  },
});
