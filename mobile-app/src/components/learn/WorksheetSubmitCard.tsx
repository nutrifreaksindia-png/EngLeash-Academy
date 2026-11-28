import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api } from '../../api/client';
import { ContentBlocksView, parseContentBlocks } from './ContentBlocksView';

type Submission = {
  hasAnswerKey: boolean;
  submitted: boolean;
  responseText: string;
  answerKeyJson: string | null;
};

/** Shown under the last page of a worksheet: submit answers first, then the answer key unlocks. */
export function WorksheetSubmitCard({ worksheetId }: { worksheetId: number }) {
  const [state, setState] = useState<Submission | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get(`/worksheets/${worksheetId}/submission`)
      .then((d: Submission) => setState(d))
      .catch(() => setState(null));
  }, [worksheetId]);

  useEffect(load, [load]);

  // Without an answer key there is nothing to unlock.
  if (!state?.hasAnswerKey) return null;

  const submit = () => {
    Alert.alert('Submit worksheet', 'You cannot change your answers after submitting.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Submit',
        onPress: async () => {
          setBusy(true);
          try {
            setState(await api.post(`/worksheets/${worksheetId}/submit`, { responseText: draft }));
          } catch (e: any) {
            Alert.alert('Worksheet', e?.message || 'Could not submit');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.card}>
      {state.submitted ? (
        <>
          <Text style={styles.title}>Your answers</Text>
          <Text style={styles.mine}>{state.responseText}</Text>
          <Text style={styles.title}>Answer key</Text>
          <ContentBlocksView
            blocks={parseContentBlocks(state.answerKeyJson || '')}
            scrollable={false}
            horizontalInset={68}
          />
        </>
      ) : (
        <>
          <Text style={styles.title}>Submit your answers to unlock the answer key</Text>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            multiline
            placeholder="Write your answers here"
            placeholderTextColor="#94a3b8"
            accessibilityLabel="Your worksheet answers"
          />
          <TouchableOpacity
            style={[styles.btn, (!draft.trim() || busy) && styles.btnOff]}
            disabled={!draft.trim() || busy}
            onPress={submit}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Submit worksheet</Text>}
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 20, marginHorizontal: 12, alignSelf: 'stretch', padding: 14, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0' },
  title: { fontSize: 15, fontWeight: '800', color: '#1a237e', marginBottom: 8 },
  mine: { fontSize: 15, color: '#334155', marginBottom: 16, lineHeight: 22 },
  input: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 10,
    textAlignVertical: 'top',
    color: '#0f172a',
  },
  btn: { marginTop: 10, backgroundColor: '#c41e3a', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  btnOff: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '800' },
});
