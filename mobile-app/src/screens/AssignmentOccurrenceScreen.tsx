import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import Ionicons from '@expo/vector-icons/Ionicons';
import { api, getToken } from '../api/client';
import { API_BASE } from '../config';
import {
  clearLocalAssignmentResponse,
  getLocalAssignmentResponse,
  saveLocalAssignmentResponse,
  type LocalAssignmentResponse,
} from '../lib/assignmentLocalStore';
import { workStatusFromSubmission } from '../lib/assignmentLabels';
import { detectMediaKind, openMedia } from '../lib/openMedia';
import AssignmentMaterialPreview from '../components/AssignmentMaterialPreview';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';
const PAGE_BG = '#edf1fa';

function assetIcon(type?: string): keyof typeof Ionicons.glyphMap {
  const t = String(type || '').toLowerCase();
  if (t === 'image' || t === 'gif') return 'image-outline';
  if (t === 'video') return 'videocam-outline';
  if (t === 'audio') return 'musical-notes-outline';
  if (t === 'pdf') return 'document-text-outline';
  if (t === 'link') return 'link-outline';
  return 'attach-outline';
}

export default function AssignmentOccurrenceScreen({ route, navigation }: any) {
  const occurrenceId = Number(route.params?.occurrenceId);
  const { width } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [data, setData] = useState<any>(null);
  const [local, setLocal] = useState<LocalAssignmentResponse | null>(null);
  const [textDraft, setTextDraft] = useState('');
  const [showTextEditor, setShowTextEditor] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordSecs, setRecordSecs] = useState(0);
  const [pendingItems, setPendingItems] = useState<
    {
      id: string;
      uri: string;
      name: string;
      type: string;
      kind: 'image' | 'video' | 'file' | 'voice';
    }[]
  >([]);
  const [submitAppend, setSubmitAppend] = useState(false);
  const [feedbackPlaying, setFeedbackPlaying] = useState(false);
  const [feedbackDurationMs, setFeedbackDurationMs] = useState(0);
  const [feedbackPositionMs, setFeedbackPositionMs] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const detailsUserToggled = useRef(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedbackSoundRef = useRef<Audio.Sound | null>(null);

  const clearRecordTimer = () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  const load = useCallback(async () => {
    try {
      const [row, cached] = await Promise.all([
        api.get(`/assignments/occurrences/${occurrenceId}`),
        getLocalAssignmentResponse(occurrenceId),
      ]);
      setData(row);
      setLocal(cached);
      if (cached?.textBody && !row?.submission?.text_body) {
        setTextDraft(cached.textBody);
      } else if (row?.submission?.text_body) {
        setTextDraft(String(row.submission.text_body));
      }
      // Reviewed/completed → collapse instructions; others stay open
      if (!detailsUserToggled.current) {
        const status = workStatusFromSubmission({
          done: Boolean(
            row?.done ||
              row?.submission?.status === 'done' ||
              row?.submission?.status === 'submitted' ||
              row?.submission?.file_url ||
              row?.submission?.text_body,
          ),
          reviewStatus: row?.submission?.review_status,
          score: row?.submission?.score,
        });
        setDetailsOpen(status !== 'graded');
      }
      navigation.setOptions({ title: row?.displayLabel || 'Assignment' });
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not load assignment');
    } finally {
      setLoading(false);
    }
  }, [navigation, occurrenceId]);

  useEffect(() => {
    void load();
    return () => {
      clearRecordTimer();
      void feedbackSoundRef.current?.unloadAsync().catch(() => undefined);
      feedbackSoundRef.current = null;
    };
  }, [load]);

  function fmtMs(ms: number) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  async function toggleFeedbackAudio(url: string) {
    try {
      if (feedbackPlaying && feedbackSoundRef.current) {
        await feedbackSoundRef.current.pauseAsync();
        setFeedbackPlaying(false);
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      if (feedbackSoundRef.current) {
        const st = await feedbackSoundRef.current.getStatusAsync();
        if (st.isLoaded) {
          await feedbackSoundRef.current.playAsync();
          setFeedbackPlaying(true);
          return;
        }
        await feedbackSoundRef.current.unloadAsync().catch(() => undefined);
      }
      const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
      feedbackSoundRef.current = sound;
      setFeedbackPlaying(true);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        if (status.durationMillis != null) setFeedbackDurationMs(status.durationMillis);
        setFeedbackPositionMs(status.positionMillis || 0);
        setFeedbackPlaying(!!status.isPlaying);
        if (status.didJustFinish) {
          setFeedbackPlaying(false);
          setFeedbackPositionMs(0);
        }
      });
    } catch (e: any) {
      Alert.alert('Playback failed', e?.message || 'Could not play voice feedback');
      setFeedbackPlaying(false);
    }
  }

  async function persistLocal(opts: {
    responseType: string;
    textBody?: string | null;
    sourceUri?: string | null;
    mimeType?: string | null;
    fileName?: string | null;
    remoteUrl?: string | null;
  }) {
    const cached = await saveLocalAssignmentResponse({
      occurrenceId,
      responseType: opts.responseType,
      textBody: opts.textBody,
      sourceUri: opts.sourceUri,
      mimeType: opts.mimeType,
      fileName: opts.fileName,
      remoteUrl: opts.remoteUrl,
    });
    setLocal(cached);
  }

  function addPending(item: {
    uri: string;
    name: string;
    type: string;
    kind: 'image' | 'video' | 'file' | 'voice';
  }) {
    setPendingItems((prev) => [
      ...prev,
      { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
    ]);
  }

  async function submitMultipart(
    fields: Record<string, string>,
    files: { uri: string; name: string; type: string }[] = [],
    opts?: { append?: boolean },
  ) {
    setSubmitting(true);
    try {
      const token = await getToken();
      const form = new FormData();
      Object.entries(fields).forEach(([k, v]) => form.append(k, v));
      if (opts?.append) form.append('append', '1');
      files.forEach((file) => {
        form.append('files', {
          uri: file.uri,
          name: file.name,
          type: file.type,
        } as any);
      });
      const res = await fetch(`${API_BASE}/api/assignments/occurrences/${occurrenceId}/submit`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Submit failed');
      const occurrence = body.occurrence || body;
      setData(occurrence);
      const first = files[0];
      await persistLocal({
        responseType: fields.responseType || 'file',
        textBody: fields.textBody || null,
        sourceUri: first?.uri || null,
        mimeType: first?.type || null,
        fileName: first?.name || null,
        remoteUrl: occurrence?.submission?.file_url || null,
      });
      setShowTextEditor(false);
      setReplacing(false);
      setSubmitAppend(false);
      setPendingItems([]);
      Alert.alert('Submitted', 'Saved on this device and sent for review.');
    } catch (e: any) {
      Alert.alert('Submit failed', e?.message || 'Try again');
    } finally {
      setSubmitting(false);
    }
  }

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
          allowsMultipleSelection: true,
          quality: 0.85,
        });
    if (result.canceled || !result.assets?.length) return;
    result.assets.forEach((asset, idx) => {
      addPending({
        uri: asset.uri,
        name: asset.fileName || `photo-${Date.now()}-${idx}.jpg`,
        type: asset.mimeType || 'image/jpeg',
        kind: 'image',
      });
    });
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
          allowsMultipleSelection: true,
          quality: 0.7,
        });
    if (result.canceled || !result.assets?.length) return;
    result.assets.forEach((asset, idx) => {
      addPending({
        uri: asset.uri,
        name: asset.fileName || `video-${Date.now()}-${idx}.mp4`,
        type: asset.mimeType || 'video/mp4',
        kind: 'video',
      });
    });
  }

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (result.canceled || !result.assets?.length) return;
    result.assets.forEach((asset, idx) => {
      addPending({
        uri: asset.uri,
        name: asset.name || `file-${Date.now()}-${idx}`,
        type: asset.mimeType || 'application/octet-stream',
        kind: 'file',
      });
    });
  }

  async function toggleVoiceRecord() {
    try {
      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI();
        setRecording(null);
        recordingRef.current = null;
        clearRecordTimer();
        if (!uri) return;
        addPending({
          uri,
          name: `voice-${Date.now()}.m4a`,
          type: 'audio/m4a',
          kind: 'voice',
        });
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
      setRecordSecs(0);
      clearRecordTimer();
      recordTimerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
    } catch (e: any) {
      Alert.alert('Recording error', e?.message || 'Could not record');
      recordingRef.current = null;
      setRecording(null);
      clearRecordTimer();
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
  const submission = data.submission || {};
  const spacesExpired = Boolean(data.spacesExpired || submission.spacesExpired);
  const remoteUrl = !spacesExpired ? submission.file_url || '' : '';
  const responseMediaUri = local?.localUri || remoteUrl || '';
  const responseText = submission.text_body || local?.textBody || '';
  const responseType = String(lib.response_type || local?.responseType || 'file').toLowerCase();
  const work = workStatusFromSubmission({
    done: data.done,
    reviewStatus: submission.review_status,
    score: submission.score,
  });
  const isLocked = work === 'graded' || (work !== 'not_started' && !replacing);
  const recordLabel = `${String(Math.floor(recordSecs / 60)).padStart(2, '0')}:${String(
    recordSecs % 60,
  ).padStart(2, '0')}`;
  const trainerNotes = String(data.notes || '').trim();
  const feedbackAudioUrl = String(submission.feedback_audio_url || '').trim();
  const hasFeedback = Boolean(String(submission.feedback || '').trim() || feedbackAudioUrl);
  const submittedFiles: {
    id?: number | null;
    url: string;
    mime_type?: string | null;
    kind?: string | null;
    file_name?: string | null;
  }[] = Array.isArray(submission.files) && submission.files.length
    ? submission.files.filter((f: any) => f?.url)
    : responseMediaUri
      ? [
          {
            url: responseMediaUri,
            mime_type: local?.mimeType || submission.mime_type,
            kind: responseType,
            file_name: local?.fileName || null,
          },
        ]
      : [];

  const materials: {
    key: string;
    label: string;
    url?: string;
    type?: string;
    icon: keyof typeof Ionicons.glyphMap;
  }[] = [];
  const normUrl = (u?: string | null) =>
    String(u || '')
      .split('?')[0]
      .split('#')[0]
      .trim()
      .toLowerCase();
  const headerUrlNorm = header.url ? normUrl(header.url) : '';
  const headerAssetId = header.assetId != null ? Number(header.assetId) : null;
  const seenUrls = new Set<string>();

  const pushMaterial = (item: (typeof materials)[number]) => {
    const n = item.url ? normUrl(item.url) : '';
    if (n && seenUrls.has(n)) return;
    if (n) seenUrls.add(n);
    materials.push(item);
  };

  if (header.type === 'link' && header.url) {
    pushMaterial({
      key: 'header-link',
      label: header.title || header.url,
      url: header.url,
      type: 'link',
      icon: 'link-outline',
    });
  }

  assets.forEach((a: any) => {
    const isHeaderAsset =
      (headerAssetId != null && Number(a.id) === headerAssetId) ||
      (headerUrlNorm && normUrl(a.url) === headerUrlNorm && header.type !== 'text' && header.type !== 'link');
    const niceType = String(a.asset_type || header.type || 'file');
    pushMaterial({
      key: `asset-${a.id}`,
      label:
        (isHeaderAsset && (header.text || header.title)) ||
        a.meta_json?.name ||
        (isHeaderAsset
          ? niceType === 'video'
            ? 'Video'
            : niceType === 'pdf'
              ? 'PDF'
              : niceType === 'image'
                ? 'Image'
                : niceType === 'audio'
                  ? 'Audio'
                  : 'Attachment'
          : `${niceType.toUpperCase()} attachment`),
      url: a.url,
      type: a.asset_type || header.type,
      icon: assetIcon(a.asset_type || header.type),
    });
  });

  // Header media that was never stored as an asset row
  if (header.url && header.type !== 'text' && header.type !== 'link' && !seenUrls.has(headerUrlNorm)) {
    pushMaterial({
      key: 'header-media',
      label:
        header.text ||
        header.title ||
        (header.type === 'video'
          ? 'Video'
          : header.type === 'pdf'
            ? 'PDF'
            : header.type === 'image'
              ? 'Image'
              : 'Attachment'),
      url: header.url,
      type: header.type,
      icon: assetIcon(header.type),
    });
  }

  const statusLabel =
    work === 'graded' ? 'Reviewed' : work === 'submitted' ? 'Submitted' : 'Not started';
  const reviewedMeta = (() => {
    const when = submission.reviewed_at
      ? new Date(String(submission.reviewed_at).includes('T')
          ? submission.reviewed_at
          : String(submission.reviewed_at).replace(' ', 'T') + 'Z')
      : null;
    const whenLabel =
      when && !Number.isNaN(when.getTime())
        ? when.toLocaleString(undefined, {
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
          })
        : submission.reviewed_at
          ? String(submission.reviewed_at).replace('T', ' ').slice(0, 16)
          : '';
    return {
      name: submission.reviewer_name || data.batch_trainer_name || 'Trainer',
      when: whenLabel,
    };
  })();

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { flex: 1, paddingRight: 10 }]}>
            {data.displayLabel || lib.displayLabel || 'Assignment'}
          </Text>
          <View
            style={[
              styles.badge,
              styles.badgeLarge,
              work === 'graded' && styles.badgeSuccess,
              work === 'submitted' && styles.badgeInfo,
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                styles.badgeTextLarge,
                work === 'graded' && styles.badgeTextSuccess,
                work === 'submitted' && styles.badgeTextInfo,
              ]}
            >
              {statusLabel}
            </Text>
          </View>
        </View>
        {spacesExpired ? (
          <Text style={styles.expiredHint}>
            Cloud copy expired. Showing your on-device response when available.
          </Text>
        ) : null}
      </View>

      <View style={styles.sectionCard}>
        <TouchableOpacity
          style={styles.collapseHead}
          onPress={() => {
            detailsUserToggled.current = true;
            setDetailsOpen((v) => !v);
          }}
          activeOpacity={0.85}
        >
          <Text style={[styles.sectionLabel, { marginBottom: 0 }]}>Instructions & materials</Text>
          <Ionicons name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#64748b" />
        </TouchableOpacity>
        {detailsOpen ? (
          <View style={{ marginTop: 12 }}>
            {trainerNotes ? (
              <View style={styles.noteBox}>
                <Text style={styles.noteLabel}>Note</Text>
                <Text style={styles.feedbackText}>{trainerNotes}</Text>
              </View>
            ) : null}
            {header.type === 'text' && header.text ? (
              <Text style={styles.headerText}>{header.text}</Text>
            ) : null}
            {lib.content_html ? (
              <View style={styles.htmlWrap}>
                <RenderHTML contentWidth={width - 64} source={{ html: lib.content_html }} />
              </View>
            ) : !header.text && !trainerNotes ? (
              <Text style={styles.mutedInline}>No instructions loaded.</Text>
            ) : null}
            {materials.length ? (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.sectionLabel}>Materials</Text>
                {materials.map((m) => (
                  <AssignmentMaterialPreview key={m.key} item={m} navigation={navigation} />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionLabel}>Your work</Text>

        {isLocked ? (
          <>
            {responseText ? <Text style={styles.responseText}>{responseText}</Text> : null}
            {submittedFiles.length ? (
              <View style={styles.mediaBox}>
                {submittedFiles.map((f, idx) => {
                  const mime = String(f.mime_type || '').toLowerCase();
                  const kind = detectMediaKind({
                    url: f.url,
                    mimeType: f.mime_type,
                    typeHint: f.kind || responseType,
                  });
                  const title = f.file_name || `Item ${idx + 1}`;
                  if (kind === 'image') {
                    return (
                      <TouchableOpacity
                        key={f.id || `${idx}-${f.url}`}
                        activeOpacity={0.92}
                        style={{ marginBottom: 10 }}
                        onPress={() =>
                          openMedia(navigation, {
                            url: f.url,
                            title,
                            kind: 'image',
                            mimeType: mime,
                          })
                        }
                      >
                        <Image source={{ uri: f.url }} style={styles.previewImage} resizeMode="cover" />
                        <Text style={styles.tapHint}>{title} · Tap to view</Text>
                      </TouchableOpacity>
                    );
                  }
                  const label =
                    kind === 'video'
                      ? 'Play video'
                      : kind === 'audio'
                        ? 'Play voice note'
                        : kind === 'pdf'
                          ? 'View PDF'
                          : 'View file';
                  const icon =
                    kind === 'video'
                      ? 'play-circle-outline'
                      : kind === 'audio'
                        ? 'musical-notes-outline'
                        : kind === 'pdf'
                          ? 'document-text-outline'
                          : 'eye-outline';
                  return (
                    <TouchableOpacity
                      key={f.id || `${idx}-${f.url}`}
                      style={[styles.viewFileBtn, { marginBottom: 8 }]}
                      onPress={() =>
                        openMedia(navigation, {
                          url: f.url,
                          title,
                          kind,
                          mimeType: mime,
                        })
                      }
                    >
                      <Ionicons name={icon as any} size={22} color="#fff" />
                      <Text style={styles.viewFileBtnText}>
                        {label}
                        {submittedFiles.length > 1 ? ` (${idx + 1})` : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
            {!responseText && !submittedFiles.length && responseType === 'other' ? (
              <Text style={styles.mutedInline}>Marked complete.</Text>
            ) : null}
            {submission.submitted_at ? (
              <Text style={styles.submittedAt}>
                Submitted {String(submission.submitted_at).replace('T', ' ').slice(0, 16)}
                {submittedFiles.length > 1 ? ` · ${submittedFiles.length} files` : ''}
              </Text>
            ) : null}
            {work !== 'graded' ? (
              <View style={{ gap: 8 }}>
                {responseType !== 'text' && responseType !== 'other' ? (
                  <TouchableOpacity
                    style={[styles.btn, styles.btnPrimary]}
                    onPress={() => {
                      setSubmitAppend(true);
                      setReplacing(true);
                      setPendingItems([]);
                    }}
                  >
                    <Text style={styles.btnPrimaryText}>Add more</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={[styles.btn, styles.btnSecondary]}
                  onPress={() => {
                    setSubmitAppend(false);
                    setReplacing(true);
                    setPendingItems([]);
                    if (responseType === 'text') setShowTextEditor(true);
                  }}
                >
                  <Text style={styles.btnSecondaryText}>
                    {responseType === 'text' ? 'Replace submission' : 'Replace all'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        ) : (
          <>
            {showTextEditor || responseType === 'text' ? (
              <View style={styles.editorBox}>
                <TextInput
                  style={styles.textArea}
                  multiline
                  value={textDraft}
                  onChangeText={async (txt) => {
                    setTextDraft(txt);
                    await persistLocal({
                      responseType: 'text',
                      textBody: txt,
                      remoteUrl: remoteUrl || null,
                    });
                  }}
                  placeholder="Write your answer…"
                  placeholderTextColor="#94a3b8"
                />
                {local?.textBody ? (
                  <Text style={styles.draftHint}>Draft saved on this device</Text>
                ) : null}
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary]}
                  disabled={submitting || !textDraft.trim()}
                  onPress={() =>
                    void submitMultipart({ responseType: 'text', textBody: textDraft })
                  }
                >
                  <Text style={styles.btnPrimaryText}>
                    {submitting ? 'Submitting…' : 'Submit answer'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {pendingItems.length ? (
              <View style={styles.pendingBox}>
                {pendingItems.map((item) => (
                  <View key={item.id} style={styles.pendingItemRow}>
                    {item.kind === 'image' ? (
                      <Image source={{ uri: item.uri }} style={styles.pendingThumb} />
                    ) : (
                      <View style={styles.fileChip}>
                        <Ionicons
                          name={
                            item.kind === 'video'
                              ? 'videocam-outline'
                              : item.kind === 'voice'
                                ? 'mic-outline'
                                : 'document-outline'
                          }
                          size={18}
                          color={BRAND_BLUE}
                        />
                        <Text style={styles.fileChipText} numberOfLines={1}>
                          {item.name}
                        </Text>
                      </View>
                    )}
                    <TouchableOpacity
                      onPress={() =>
                        setPendingItems((prev) => prev.filter((p) => p.id !== item.id))
                      }
                      hitSlop={8}
                    >
                      <Ionicons name="close-circle" size={22} color="#94a3b8" />
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary]}
                  disabled={submitting}
                  onPress={() =>
                    void submitMultipart(
                      { responseType },
                      pendingItems.map((p) => ({
                        uri: p.uri,
                        name: p.name,
                        type: p.type,
                      })),
                      { append: submitAppend },
                    )
                  }
                >
                  <Text style={styles.btnPrimaryText}>
                    {submitting
                      ? 'Submitting…'
                      : submitAppend
                        ? `Add ${pendingItems.length} file${pendingItems.length > 1 ? 's' : ''}`
                        : `Submit ${pendingItems.length} file${pendingItems.length > 1 ? 's' : ''}`}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {responseType !== 'text' ? (
              <View style={styles.actions}>
                {responseType === 'image' ? (
                  <>
                    <TouchableOpacity
                      style={[styles.btn, styles.btnPrimary]}
                      onPress={() => void pickImage(false)}
                      disabled={submitting}
                    >
                      <Text style={styles.btnPrimaryText}>
                        {pendingItems.length ? 'Add photos' : 'Choose photos'}
                      </Text>
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
                      <Text style={styles.btnPrimaryText}>
                        {pendingItems.length ? 'Add videos' : 'Choose videos'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btn, styles.btnSecondary]}
                      onPress={() => void pickVideo(true)}
                      disabled={submitting}
                    >
                      <Text style={styles.btnSecondaryText}>Record video</Text>
                    </TouchableOpacity>
                  </>
                ) : null}

                {responseType === 'file' ? (
                  <TouchableOpacity
                    style={[styles.btn, styles.btnPrimary]}
                    onPress={() => void pickFile()}
                    disabled={submitting}
                  >
                    <Text style={styles.btnPrimaryText}>
                      {pendingItems.length ? 'Add files' : 'Upload files'}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {responseType === 'voice' ? (
                  <TouchableOpacity
                    style={[styles.btn, styles.btnPrimary]}
                    onPress={() => void toggleVoiceRecord()}
                    disabled={submitting}
                  >
                    <Text style={styles.btnPrimaryText}>
                      {recording
                        ? `Stop (${recordLabel})`
                        : pendingItems.length
                          ? 'Record another'
                          : 'Record voice note'}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {responseType === 'other' ? (
                  <TouchableOpacity
                    style={[styles.btn, styles.btnPrimary]}
                    onPress={() => void submitMultipart({ responseType: 'other' })}
                    disabled={submitting}
                  >
                    <Text style={styles.btnPrimaryText}>
                      {submitting ? 'Saving…' : 'Mark as done'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            {replacing ? (
              <TouchableOpacity
                style={[styles.btn, styles.btnSecondary, { marginTop: 8 }]}
                onPress={() => {
                  setReplacing(false);
                  setSubmitAppend(false);
                  setShowTextEditor(false);
                  setPendingItems([]);
                }}
              >
                <Text style={styles.btnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}

        {local && !isLocked ? (
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost]}
            onPress={() => {
              Alert.alert('Clear device copy?', 'Removes only the copy saved on this phone.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Clear',
                  style: 'destructive',
                  onPress: () => {
                    void clearLocalAssignmentResponse(occurrenceId).then(() => setLocal(null));
                  },
                },
              ]);
            }}
          >
            <Text style={styles.btnGhostText}>Clear from this device</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {work === 'graded' || hasFeedback ? (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>Feedback</Text>
          <Text style={styles.feedbackMeta}>
            {reviewedMeta.name}
            {reviewedMeta.when ? ` · ${reviewedMeta.when}` : ''}
          </Text>
          {submission.feedback ? (
            <Text style={styles.feedbackText}>{submission.feedback}</Text>
          ) : (
            <Text style={styles.mutedInline}>No written feedback.</Text>
          )}
          {feedbackAudioUrl ? (
            <TouchableOpacity
              style={styles.feedbackAudioBtn}
              onPress={() => void toggleFeedbackAudio(feedbackAudioUrl)}
              activeOpacity={0.85}
            >
              <Ionicons
                name={feedbackPlaying ? 'pause-circle' : 'play-circle'}
                size={28}
                color="#fff"
              />
              <View>
                <Text style={styles.feedbackAudioText}>
                  {feedbackPlaying ? 'Pause voice feedback' : 'Play voice feedback'}
                </Text>
                <Text style={styles.feedbackAudioTime}>
                  {fmtMs(feedbackPositionMs)}
                  {' / '}
                  {feedbackDurationMs > 0 ? fmtMs(feedbackDurationMs) : '0:00'}
                </Text>
              </View>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAGE_BG },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: PAGE_BG },
  muted: { color: '#94a3b8' },
  mutedInline: { color: '#94a3b8', fontSize: 14 },
  heroCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e4ebf8',
    padding: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a', letterSpacing: -0.3 },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#eef2f7',
  },
  badgeLarge: { paddingHorizontal: 12, paddingVertical: 7 },
  badgeInfo: { backgroundColor: '#e0e7ff' },
  badgeSuccess: { backgroundColor: '#dcfce7' },
  badgeText: { fontSize: 11, fontWeight: '800', color: '#64748b' },
  badgeTextLarge: { fontSize: 13 },
  badgeTextInfo: { color: BRAND_BLUE },
  badgeTextSuccess: { color: '#15803d' },
  collapseHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  noteBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  noteLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#64748b',
  },
  feedbackMeta: { color: '#64748b', fontSize: 13, fontWeight: '600', marginBottom: 4 },
  feedbackAudioTime: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },
  expiredHint: { marginTop: 10, color: '#b45309', fontSize: 13, fontWeight: '600' },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e4ebf8',
    padding: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#94a3b8',
    marginBottom: 10,
  },
  feedbackText: { marginTop: 10, fontSize: 15, lineHeight: 22, color: '#334155' },
  feedbackAudioBtn: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#128c7e',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  feedbackAudioText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  headerText: { fontSize: 17, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  htmlWrap: { marginTop: 4 },
  materialVideoCard: {
    marginTop: 6,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  materialVideoTitle: {
    color: '#e2e8f0',
    fontWeight: '700',
    fontSize: 13,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  materialVideoPlay: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    gap: 6,
  },
  materialVideoPlayText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  materialVideoHint: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '600' },
  materialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e8eef8',
  },
  materialIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#fff5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  materialLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: '#0f172a' },
  responseText: { color: '#0f172a', fontSize: 15, lineHeight: 22, marginBottom: 10 },
  mediaBox: { marginBottom: 12 },
  previewImage: { width: '100%', height: 220, borderRadius: 12, backgroundColor: '#e2e8f0' },
  tapHint: {
    marginTop: 6,
    textAlign: 'center',
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
  },
  openMediaBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewFileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: BRAND_BLUE,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  viewFileBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  link: { color: BRAND_RED, fontWeight: '700' },
  submittedAt: { marginBottom: 10, fontSize: 12, color: '#94a3b8', fontWeight: '600' },
  actions: { gap: 10 },
  pendingBox: { gap: 10 },
  pendingItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  pendingThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
  },
  pendingActions: { flexDirection: 'row', gap: 8 },
  fileChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f1f5fb',
    borderRadius: 12,
    padding: 12,
  },
  fileChipText: { flex: 1, fontWeight: '700', color: '#334155' },
  editorBox: { gap: 10 },
  draftHint: { fontSize: 12, color: BRAND_BLUE, fontWeight: '700' },
  textArea: {
    minHeight: 140,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#f8fafc',
    textAlignVertical: 'top',
    color: '#0f172a',
  },
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
  btnGhost: { marginTop: 8, paddingVertical: 10 },
  btnGhostText: { color: '#94a3b8', fontWeight: '700', fontSize: 13 },
});
