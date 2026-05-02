import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';

const BRAND_BLUE = '#1a237e';
const BRAND_RED = '#c41e3a';

export default function AssignmentScreen({ route }: any) {
  const { batchId } = route.params;
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [submissions, setSubmissions] = useState<Record<number, any[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.get(`/batch-manager/${batchId}/assignments`);
      setAssignments(Array.isArray(rows) ? rows : []);
    } catch {
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    load();
  }, [load]);

  const loadSubmissions = async (assignmentId: number) => {
    try {
      const rows = await api.get(`/batch-manager/${batchId}/assignments/${assignmentId}/submissions`);
      setSubmissions((prev) => ({ ...prev, [assignmentId]: Array.isArray(rows) ? rows : [] }));
    } catch {
      setSubmissions((prev) => ({ ...prev, [assignmentId]: [] }));
    }
  };

  const submitPdf = async (assignmentId: number) => {
    const pick = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf'],
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (pick.canceled || !pick.assets?.[0]) return;
    const file = pick.assets[0];

    const form = new FormData();
    form.append('file', {
      uri: file.uri,
      name: file.name || `assignment-${assignmentId}.pdf`,
      type: file.mimeType || 'application/pdf',
    } as any);
    try {
      setUploadingId(assignmentId);
      await api.postForm(`/batch-manager/${batchId}/assignments/${assignmentId}/submit`, form);
      Alert.alert('Uploaded', 'Assignment submitted.');
      await loadSubmissions(assignmentId);
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Could not upload assignment');
    } finally {
      setUploadingId(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title="Assignment" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.pageRoot}>
      <ScreenPageTitle title="Assignment" />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {assignments.length === 0 ? (
        <Text style={styles.empty}>No assignments yet for this batch.</Text>
      ) : (
        assignments.map((a) => (
          <View key={a.id} style={styles.card}>
            <Text style={styles.title}>{a.title}</Text>
            {a.description ? <Text style={styles.desc}>{a.description}</Text> : null}
            <View style={styles.row}>
              <TouchableOpacity style={styles.submitBtn} onPress={() => submitPdf(a.id)} disabled={uploadingId !== null}>
                {uploadingId === a.id ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Upload PDF</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.viewBtn} onPress={() => loadSubmissions(a.id)}>
                <Text style={styles.viewText}>View Submissions</Text>
              </TouchableOpacity>
            </View>
            {(submissions[a.id] || []).map((s) => (
              <TouchableOpacity key={s.id} onPress={() => Linking.openURL(s.file_url)}>
                <Text style={styles.submissionLine}>
                  {s.student_name || s.student_email} - {new Date(s.submitted_at).toLocaleString()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ))
      )}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 28 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: '#666', textAlign: 'center', marginTop: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: BRAND_RED,
    padding: 14,
    marginBottom: 12,
  },
  title: { fontSize: 17, fontWeight: '700', color: '#222' },
  desc: { marginTop: 5, color: '#555' },
  row: { flexDirection: 'row', gap: 8, marginTop: 10 },
  submitBtn: { backgroundColor: BRAND_RED, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  submitText: { color: '#fff', fontWeight: '700' },
  viewBtn: { backgroundColor: BRAND_BLUE, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  viewText: { color: '#fff', fontWeight: '700' },
  submissionLine: { marginTop: 8, color: BRAND_BLUE, textDecorationLine: 'underline' },
});
