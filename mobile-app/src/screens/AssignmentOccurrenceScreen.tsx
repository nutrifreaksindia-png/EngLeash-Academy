import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import RenderHTML from 'react-native-render-html';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import { api, getToken } from '../api/client';
import { API_BASE } from '../config';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

export default function AssignmentOccurrenceScreen({ route, navigation }: any) {
  const occurrenceId = Number(route.params?.occurrenceId);
  const { width } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [data, setData] = useState<any>(null);
  const [textDraft, setTextDraft] = useState('');
  const [showTextEditor, setShowTextEditor] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);

  const load = useCallback(async () => {
    try {
      const row = await api.get(`/assignments/occurrences/${occurrenceId}`);
      setData(row);
      navigation.setOptions({ title: row?.displayLabel || 'Assignment' });
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not load assignment');
    } finally {
      setLoading(false);
    }
  }, [navigation, occurrenceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitMultipart(fields: Record<string, string>, file?: { uri: string; name: string; type: string }) {
    setSubmitting(true);
    try {
      const token = await getToken();
      const form = new FormData();
      Object.entries(fields).forEach(([k, v]) => form.append(k, v));
      if (file) {
        form.append('file', {
          uri: file.uri,
          name: file.name,
          type: file.type,
        } as any);
      }
      const res = await fetch(`${API_BASE}/api/assignments/occurrences/${occurrenceId}/submit`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Submit failed');
      setData(body.occurrence || body);
      setShowTextEditor(false);
      Alert.alert('Done', 'Assignment marked complete.');
    } catch (e: any) {
      Alert.alert('Submit failed', e?.message || 'Try again');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitJson(payload: Record<string, string>) {
    setSubmitting(true);
    try {
      await api.post(`/assignments/occurrences/${occurrenceId}/submit`, payload);
      await load();
      setShowTextEditor(false);
      Alert.alert('Done', 'Assignment marked complete.');
    } catch (e: any) {
      // api.post may not support multipart; for text/other use FormData without file
      try {
        await submitMultipart(payload);
      } catch (err: any) {
        Alert.alert('Submit failed', err?.message || e?.message || 'Try again');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const responseType = String(data?.library?.response_type || 'file').toLowerCase();

  async function pickImage(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow camera/photos to continue.');
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.85,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.85,
        });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    await submitMultipart(
      { responseType: 'image' },
      {
        uri: asset.uri,
        name: asset.fileName || `photo-${Date.now()}.jpg`,
        type: asset.mimeType || 'image/jpeg',
      },
    );
  }

  async function pickVideo(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow camera/photos to continue.');
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['videos'],
          videoMaxDuration: 180,
          quality: 0.7,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['videos'],
          quality: 0.7,
        });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    await submitMultipart(
      { responseType: 'video' },
      {
        uri: asset.uri,
        name: asset.fileName || `video-${Date.now()}.mp4`,
        type: asset.mimeType || 'video/mp4',
      },
    );
  }

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    await submitMultipart(
      { responseType: 'file' },
      {
        uri: asset.uri,
        name: asset.name || `file-${Date.now()}`,
        type: asset.mimeType || 'application/octet-stream',
      },
    );
  }

  async function toggleVoiceRecord() {
    try {
      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI();
        setRecording(null);
        recordingRef.current = null;
        if (!uri) return;
        await submitMultipart(
          { responseType: 'voice' },
          { uri, name: `voice-${Date.now()}.m4a`, type: 'audio/m4a' },
        );
        return;
      }
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Allow microphone to record.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      recordingRef.current = rec;
      setRecording(rec);
    } catch (e: any) {
      Alert.alert('Recording error', e?.message || 'Could not record');
      recordingRef.current = null;
      setRecording(null);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BRAND_RED} />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Assignment not found.</Text>
      </View>
    );
  }

  const lib = data.library || {};
  const header = lib.header || {};
  const assets = Array.isArray(lib.assets) ? lib.assets : [];

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{data.displayLabel || lib.displayLabel || 'Assignment'}</Text>
      {data.batchName ? <Text style={styles.meta}>{data.batchName}</Text> : null}
      {data.due_at ? <Text style={styles.meta}>Due {String(data.due_at).replace('T', ' ').slice(0, 16)}</Text> : null}
      {data.done ? <Text style={styles.doneBadge}>Completed</Text> : null}

      {header.type === 'text' && header.text ? <Text style={styles.headerText}>{header.text}</Text> : null}
      {header.type === 'link' && header.url ? (
        <Text style={styles.link}>{header.title || header.url}</Text>
      ) : null}
      {header.url && header.type !== 'link' && header.type !== 'text' ? (
        <Text style={styles.meta}>
          Header ({header.type}): {header.url}
        </Text>
      ) : null}

      {lib.content_html ? (
        <View style={styles.htmlWrap}>
          <RenderHTML contentWidth={width - 32} source={{ html: lib.content_html }} />
        </View>
      ) : null}

      {assets.length ? (
        <View style={styles.assets}>
          <Text style={styles.section}>Attachments</Text>
          {assets.map((a: any) => (
            <Text key={a.id} style={styles.assetRow}>
              {a.asset_type}: {a.url || '—'}
            </Text>
          ))}
        </View>
      ) : null}

      <Text style={styles.section}>Your response</Text>

      {showTextEditor ? (
        <View style={styles.editorBox}>
          <TextInput
            style={styles.textArea}
            multiline
            value={textDraft}
            onChangeText={setTextDraft}
            placeholder="Write your answer…"
            placeholderTextColor="#94a3b8"
          />
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            disabled={submitting}
            onPress={() => void submitMultipart({ responseType: 'text', textBody: textDraft })}
          >
            <Text style={styles.btnPrimaryText}>{submitting ? 'Submitting…' : 'Submit'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.actions}>
        {responseType === 'text' ? (
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={() => setShowTextEditor(true)}
            disabled={submitting}
          >
            <Text style={styles.btnPrimaryText}>Write</Text>
          </TouchableOpacity>
        ) : null}

        {responseType === 'image' ? (
          <>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => void pickImage(false)}
              disabled={submitting}
            >
              <Text style={styles.btnPrimaryText}>Upload</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary]}
              onPress={() => void pickImage(true)}
              disabled={submitting}
            >
              <Text style={styles.btnSecondaryText}>Camera</Text>
            </TouchableOpacity>
          </>
        ) : null}

        {responseType === 'video' ? (
          <>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => void pickVideo(false)}
              disabled={submitting}
            >
              <Text style={styles.btnPrimaryText}>Upload</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary]}
              onPress={() => void pickVideo(true)}
              disabled={submitting}
            >
              <Text style={styles.btnSecondaryText}>Camera</Text>
            </TouchableOpacity>
          </>
        ) : null}

        {responseType === 'file' ? (
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={() => void pickFile()}
            disabled={submitting}
          >
            <Text style={styles.btnPrimaryText}>Upload</Text>
          </TouchableOpacity>
        ) : null}

        {responseType === 'voice' ? (
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={() => void toggleVoiceRecord()}
            disabled={submitting}
          >
            <Text style={styles.btnPrimaryText}>{recording ? 'Stop & submit' : 'Record'}</Text>
          </TouchableOpacity>
        ) : null}

        {responseType === 'other' ? (
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={() => void submitMultipart({ responseType: 'other' })}
            disabled={submitting}
          >
            <Text style={styles.btnPrimaryText}>{submitting ? 'Saving…' : 'Mark as Done'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: '#94a3b8' },
  title: { fontSize: 22, fontWeight: '800', color: BRAND_BLUE },
  meta: { marginTop: 4, color: '#64748b', fontSize: 13 },
  doneBadge: { marginTop: 8, color: '#15803d', fontWeight: '800' },
  headerText: { marginTop: 16, fontSize: 18, fontWeight: '700', color: '#0f172a' },
  link: { marginTop: 12, color: BRAND_RED, fontWeight: '700' },
  htmlWrap: { marginTop: 16 },
  assets: { marginTop: 16, gap: 4 },
  section: {
    marginTop: 20,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#94a3b8',
  },
  assetRow: { color: '#475569', fontSize: 13 },
  actions: { gap: 10, marginTop: 8 },
  btn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: BRAND_RED },
  btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  btnSecondary: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#cbd5e1',
  },
  btnSecondaryText: { color: '#64748b', fontWeight: '800', fontSize: 15 },
  editorBox: { gap: 10, marginBottom: 8 },
  textArea: {
    minHeight: 140,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
    textAlignVertical: 'top',
    color: '#0f172a',
  },
});
