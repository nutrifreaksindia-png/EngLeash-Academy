import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

type Quiz = { id: number; title: string; questions: { id: number; question_text: string; options: string[] }[] };

export default function QuizScreen({ route, navigation }: any) {
  const { lessonId, quiz, assignmentId } = route.params as { lessonId: number; quiz?: Quiz; assignmentId?: number };
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [multiSelected, setMultiSelected] = useState<Record<number, number[]>>({});
  const [matchingSelected, setMatchingSelected] = useState<Record<number, Record<string, string>>>({});
  const [blankAnswers, setBlankAnswers] = useState<Record<number, Record<string, string>>>({});
  const [loadedQuiz, setLoadedQuiz] = useState<any>(quiz || null);
  const [loadedAssignment, setLoadedAssignment] = useState<any>(null);
  const [submitted, setSubmitted] = useState<{ score: number; total: number } | null>(null);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (!assignmentId) return;
    setLoading(true);
    api.get(`/quizzes/v2/assignment/${assignmentId}`)
      .then((payload) => {
        setLoadedQuiz(payload.quiz || null);
        setLoadedAssignment(payload.assignment || null);
      })
      .catch((e) => Alert.alert('Error', e?.message || 'Could not load quiz'))
      .finally(() => setLoading(false));
  }, [assignmentId]);

  const submit = async () => {
    setLoading(true);
    try {
      if (assignmentId && loadedQuiz) {
        const answers = (loadedQuiz.questions || []).reduce((acc: any, q: any) => {
          if (q.type === 'mcq_single') {
            acc[q.id] = { selectedIndex: selected[q.id] ?? -1 };
          } else if (q.type === 'mcq_multi') {
            acc[q.id] = { selectedIndices: multiSelected[q.id] || [] };
          } else if (q.type === 'matching') {
            acc[q.id] = { matches: matchingSelected[q.id] || {} };
          } else if (q.type === 'fill_blank') {
            const blanks = Object.entries(blankAnswers[q.id] || {}).map(([blank_key, answer_text]) => ({ blank_key, answer_text }));
            acc[q.id] = { blanks };
          }
          return acc;
        }, {});
        const result = await api.post(`/quizzes/v2/assignment/${assignmentId}/submit`, { answers });
        setSubmitted({ score: Number(result.score || 0), total: Number(result.maxScore || 0) });
      } else if (quiz) {
        const result = await api.post(`/quizzes/lesson/${lessonId}/submit`, {
          answers: quiz.questions.map((q) => selected[q.id] ?? -1),
        });
        setSubmitted({ score: result.score, total: result.total });
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Submit failed');
    } finally {
      setLoading(false);
    }
  };

  const liveQuiz = loadedQuiz || quiz;

  const toggleMulti = (questionId: number, idx: number) => {
    setMultiSelected((prev) => {
      const set = new Set(prev[questionId] || []);
      if (set.has(idx)) set.delete(idx);
      else set.add(idx);
      return { ...prev, [questionId]: Array.from(set).sort((a, b) => a - b) };
    });
  };

  if (loading && !liveQuiz) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title="Quiz" />
        <View style={styles.resultCard}>
          <Text style={styles.resultScore}>Loading quiz…</Text>
        </View>
      </View>
    );
  }

  if (!liveQuiz) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title="Quiz" />
        <View style={styles.resultCard}>
          <Text style={styles.resultScore}>Quiz unavailable.</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.backBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (submitted !== null) {
    const passed = submitted.total > 0 && submitted.score === submitted.total;
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title="Quiz" />
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>{passed ? 'Well done!' : 'Quiz complete'}</Text>
          <Text style={styles.resultScore}>
            {submitted.score} / {submitted.total} correct
          </Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.backBtnText}>Back to lesson</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.pageRoot}>
      <ScreenPageTitle title="Quiz" />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.quizName}>{liveQuiz.title}</Text>
      {(liveQuiz.questions || []).map((q: any, qIndex: number) => (
        <View key={q.id} style={styles.questionBlock}>
          <Text style={styles.questionText}>{qIndex + 1}. {q.question_text || q.prompt}</Text>
          {(q.type === 'mcq_single' || !q.type) && (q.options || []).map((opt: any, optIndex: number) => (
            <TouchableOpacity key={optIndex} style={[styles.option, selected[q.id] === optIndex && styles.optionSelected]} onPress={() => setSelected((s) => ({ ...s, [q.id]: optIndex }))}>
              <Text style={[styles.optionText, selected[q.id] === optIndex && styles.optionTextSelected]}>{opt.option_text || opt}</Text>
            </TouchableOpacity>
          ))}
          {q.type === 'mcq_multi' && (q.options || []).map((opt: any, optIndex: number) => {
            const active = (multiSelected[q.id] || []).includes(optIndex);
            return (
              <TouchableOpacity key={optIndex} style={[styles.option, active && styles.optionSelected]} onPress={() => toggleMulti(q.id, optIndex)}>
                <Text style={[styles.optionText, active && styles.optionTextSelected]}>{opt.option_text || opt}</Text>
              </TouchableOpacity>
            );
          })}
          {q.type === 'matching' && (
            <View>
              {(q.pairs || []).map((p: any, pIdx: number) => (
                <View key={pIdx} style={{ marginBottom: 8 }}>
                  <Text style={styles.sectionHint}>{p.left_text}</Text>
                  <ScrollView horizontal>
                    {(q.pairs || []).map((choice: any, cIdx: number) => {
                      const current = matchingSelected[q.id]?.[String(p.left_text)] === String(choice.right_text);
                      return (
                        <TouchableOpacity
                          key={cIdx}
                          style={[styles.option, { marginRight: 8 }, current && styles.optionSelected]}
                          onPress={() =>
                            setMatchingSelected((prev) => ({
                              ...prev,
                              [q.id]: { ...(prev[q.id] || {}), [String(p.left_text)]: String(choice.right_text) },
                            }))
                          }
                        >
                          <Text style={[styles.optionText, current && styles.optionTextSelected]}>{choice.right_text}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              ))}
            </View>
          )}
          {q.type === 'fill_blank' && (
            <View>
              {(q.solutions || []).map((s: any, sIdx: number) => (
                <View key={sIdx} style={{ marginBottom: 8 }}>
                  <Text style={styles.sectionHint}>{s.blank_key}</Text>
                  <TextInput
                    style={styles.input}
                    value={blankAnswers[q.id]?.[String(s.blank_key)] || ''}
                    onChangeText={(txt) =>
                      setBlankAnswers((prev) => ({
                        ...prev,
                        [q.id]: { ...(prev[q.id] || {}), [String(s.blank_key)]: txt || '' },
                      }))
                    }
                    placeholder="Enter answer"
                  />
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
      <TouchableOpacity
        style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
        onPress={submit}
        disabled={loading}
      >
        <Text style={styles.submitBtnText}>{loading ? 'Submitting...' : 'Submit quiz'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.backBtnOutline} onPress={() => navigation.goBack()}>
        <Text style={styles.backBtnOutlineText}>Cancel</Text>
      </TouchableOpacity>
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 20, paddingBottom: 40 },
  quizName: { fontSize: 17, fontWeight: '600', color: '#333', marginBottom: 16 },
  questionBlock: { marginBottom: 24 },
  questionText: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 12 },
  option: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: '#e0e0e0',
  },
  optionSelected: { borderColor: BRAND_RED, backgroundColor: '#fff5f5' },
  optionText: { fontSize: 15, color: '#333' },
  optionTextSelected: { color: BRAND_RED, fontWeight: '600' },
  sectionHint: { fontSize: 13, color: '#666', marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderColor: '#ddd',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 15,
  },
  submitBtn: {
    backgroundColor: BRAND_RED,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  backBtnOutline: { alignItems: 'center', marginTop: 12 },
  backBtnOutlineText: { color: '#666', fontSize: 16 },
  resultCard: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    alignItems: 'center',
  },
  resultTitle: { fontSize: 24, fontWeight: '700', color: BRAND_BLUE, marginBottom: 12 },
  resultScore: { fontSize: 18, color: '#333', marginBottom: 24 },
  backBtn: {
    backgroundColor: BRAND_RED,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  backBtnText: { color: '#fff', fontWeight: '600' },
});
