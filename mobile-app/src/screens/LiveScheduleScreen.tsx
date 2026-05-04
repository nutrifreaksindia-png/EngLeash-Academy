import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

type Batch = {
  id: number;
  name: string;
  sessionType: 'group' | 'one_to_one';
  trainerId: number;
  trainerName: string;
};

type Student = { id: number; email: string; name: string };

type LiveSessionRow = {
  id: number;
  batch_id: number;
  title: string;
  starts_at: string;
  ends_at: string;
  status: string;
  batch_name: string;
  session_type: string;
  trainer_id: number;
  trainer_name: string;
};

type LogRow = {
  id: number;
  userId: number | null;
  userEmail?: string;
  userName?: string;
  eventType: string;
  detail: string | null;
  createdAt: string;
};

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function LiveScheduleScreen() {
  const { user } = useAuth();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [sessions, setSessions] = useState<LiveSessionRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [batchName, setBatchName] = useState('');
  const [batchType, setBatchType] = useState<'group' | 'one_to_one'>('group');
  const [batchStudentIds, setBatchStudentIds] = useState('');

  const [memberBatchId, setMemberBatchId] = useState('');
  const [memberStudentId, setMemberStudentId] = useState('');

  const [sessBatchId, setSessBatchId] = useState('');
  const [sessTitle, setSessTitle] = useState('');
  const [sessStartMin, setSessStartMin] = useState('15');
  const [sessDurationMin, setSessDurationMin] = useState('60');

  const [logSessionId, setLogSessionId] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, s, sess] = await Promise.all([
        api.get('/live/batches'),
        api.get('/live/students'),
        api.get('/live/sessions'),
      ]);
      setBatches(Array.isArray(b) ? b : []);
      setStudents(Array.isArray(s) ? s : []);
      setSessions(Array.isArray(sess) ? sess : []);
    } catch {
      setBatches([]);
      setStudents([]);
      setSessions([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const canManageSession = (_row: LiveSessionRow) =>
    user?.role === 'Admin' || user?.role === 'Trainer';

  const showLegacyComposer = user?.role === 'Admin';

  const createBatch = async () => {
    if (!batchName.trim()) {
      Alert.alert('Missing name', 'Enter a batch name.');
      return;
    }
    const ids = batchStudentIds
      .split(/[,\s]+/)
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    try {
      await api.post('/live/batches', {
        name: batchName.trim(),
        sessionType: batchType,
        studentIds: ids,
      });
      setBatchName('');
      setBatchStudentIds('');
      await load();
      Alert.alert('Created', 'Batch created.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not create batch');
    }
  };

  const addMember = async () => {
    const bid = Number(memberBatchId);
    const sid = Number(memberStudentId);
    if (!bid || !sid) {
      Alert.alert('Invalid', 'Enter batch ID and student ID.');
      return;
    }
    try {
      await api.post(`/live/batches/${bid}/members`, { studentId: sid });
      await load();
      Alert.alert('Added', 'Student added to batch.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not add member');
    }
  };

  const createSession = async () => {
    const bid = Number(sessBatchId);
    if (!bid || !sessTitle.trim()) {
      Alert.alert('Invalid', 'Enter batch ID and session title.');
      return;
    }
    const startOff = Math.max(0, Number(sessStartMin) || 0);
    const dur = Math.max(5, Number(sessDurationMin) || 60);
    const start = new Date(Date.now() + startOff * 60 * 1000);
    const end = new Date(start.getTime() + dur * 60 * 1000);
    try {
      await api.post('/live/sessions', {
        batchId: bid,
        title: sessTitle.trim(),
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
      });
      setSessTitle('');
      await load();
      Alert.alert('Scheduled', 'Live session created.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not create session');
    }
  };

  const startSession = async (id: number) => {
    try {
      await api.post(`/live/sessions/${id}/start`);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not start');
    }
  };

  const endSession = async (id: number) => {
    Alert.alert('End session', 'Mark this session as ended and clear stage state?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.post(`/live/sessions/${id}/end`);
            await load();
          } catch (e: any) {
            Alert.alert('Error', e?.message || 'Could not end');
          }
        },
      },
    ]);
  };

  const loadLogs = async () => {
    const sid = Number(logSessionId);
    if (!sid) {
      Alert.alert('Invalid', 'Enter a live session ID.');
      return;
    }
    setLogsLoading(true);
    try {
      const data = await api.get(`/live/sessions/${sid}/logs`);
      setLogs(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setLogs([]);
      Alert.alert('Error', e?.message || 'Could not load logs');
    } finally {
      setLogsLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title="Schedule live" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.pageRoot}>
      <ScreenPageTitle title="Schedule live" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
      {user?.role === 'Trainer' ? (
        <Text style={styles.banner}>
          Course batches are managed in Web Admin. Live rooms for each class day are created automatically when a batch is
          started. Below you can start/end sessions and view logs; only admins can create ad-hoc batches here.
        </Text>
      ) : null}
      <Text style={styles.heading}>Batches</Text>
      {batches.length === 0 ? (
        <Text style={styles.muted}>No batches yet.</Text>
      ) : (
        batches.map((item) => (
          <View key={item.id} style={styles.card}>
            <Text style={styles.cardTitle}>{item.name}</Text>
            <Text style={styles.cardMeta}>
              #{item.id} · {item.sessionType === 'group' ? 'Group' : '1:1'} · {item.trainerName}
            </Text>
          </View>
        ))
      )}

      {showLegacyComposer ? (
        <>
          <Text style={styles.heading}>Create batch (legacy / testing)</Text>
          <View style={styles.form}>
            <TextInput style={styles.input} placeholder="Batch name" value={batchName} onChangeText={setBatchName} />
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.chip, batchType === 'group' && styles.chipOn]}
                onPress={() => setBatchType('group')}
              >
                <Text style={[styles.chipText, batchType === 'group' && styles.chipTextOn]}>Group</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, batchType === 'one_to_one' && styles.chipOn]}
                onPress={() => setBatchType('one_to_one')}
              >
                <Text style={[styles.chipText, batchType === 'one_to_one' && styles.chipTextOn]}>One-to-one</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Student user IDs (comma-separated, optional)"
              value={batchStudentIds}
              onChangeText={setBatchStudentIds}
              keyboardType="numbers-and-punctuation"
            />
            <TouchableOpacity style={styles.primaryBtn} onPress={createBatch}>
              <Text style={styles.primaryBtnText}>Create batch</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.heading}>Add student to batch</Text>
          <View style={styles.form}>
            <TextInput style={styles.input} placeholder="Batch ID" value={memberBatchId} onChangeText={setMemberBatchId} keyboardType="number-pad" />
            <TextInput style={styles.input} placeholder="Student user ID" value={memberStudentId} onChangeText={setMemberStudentId} keyboardType="number-pad" />
            <TouchableOpacity style={styles.primaryBtn} onPress={addMember}>
              <Text style={styles.primaryBtnText}>Add member</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.heading}>Students (reference)</Text>
          <Text style={styles.muted}>First few accounts — use ID when adding members.</Text>
          {students.slice(0, 20).map((item) => (
            <Text key={item.id} style={styles.listLine}>
              #{item.id} · {item.name || item.email}
            </Text>
          ))}

          <Text style={styles.heading}>Schedule ad-hoc live session</Text>
          <View style={styles.form}>
            <TextInput style={styles.input} placeholder="Batch ID" value={sessBatchId} onChangeText={setSessBatchId} keyboardType="number-pad" />
            <TextInput style={styles.input} placeholder="Session title" value={sessTitle} onChangeText={setSessTitle} />
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.inputHalf]}
                placeholder="Starts in (min)"
                value={sessStartMin}
                onChangeText={setSessStartMin}
                keyboardType="number-pad"
              />
              <TextInput
                style={[styles.input, styles.inputHalf]}
                placeholder="Duration (min)"
                value={sessDurationMin}
                onChangeText={setSessDurationMin}
                keyboardType="number-pad"
              />
            </View>
            <TouchableOpacity style={styles.primaryBtn} onPress={createSession}>
              <Text style={styles.primaryBtnText}>Create session</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      <Text style={styles.heading}>Your sessions</Text>
      {sessions.length === 0 ? (
        <Text style={styles.muted}>No sessions.</Text>
      ) : (
        sessions.map((item) => (
          <View key={item.id} style={styles.card}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardMeta}>
              #{item.id} · {item.batch_name} · {item.status}
            </Text>
            <Text style={styles.cardMeta}>{formatTime(item.starts_at)} → {formatTime(item.ends_at)}</Text>
            {canManageSession(item) ? (
              <View style={styles.row}>
                {item.status === 'scheduled' ? (
                  <TouchableOpacity style={styles.smallBtn} onPress={() => startSession(item.id)}>
                    <Text style={styles.smallBtnText}>Start</Text>
                  </TouchableOpacity>
                ) : null}
                {item.status === 'scheduled' || item.status === 'live' ? (
                  <TouchableOpacity style={[styles.smallBtn, styles.smallBtnDanger]} onPress={() => endSession(item.id)}>
                    <Text style={styles.smallBtnText}>End</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </View>
        ))
      )}

      <Text style={styles.heading}>Session activity log</Text>
      <View style={styles.form}>
        <TextInput style={styles.input} placeholder="Live session ID" value={logSessionId} onChangeText={setLogSessionId} keyboardType="number-pad" />
        <TouchableOpacity style={styles.secondaryBtn} onPress={loadLogs} disabled={logsLoading}>
          <Text style={styles.secondaryBtnText}>{logsLoading ? 'Loading…' : 'Load recent events'}</Text>
        </TouchableOpacity>
      </View>
      {logs.length > 0
        ? logs.map((item) => (
            <Text key={item.id} style={styles.logLine}>
              {item.createdAt} · {item.eventType}
              {item.userName || item.userEmail ? ` · ${item.userName || item.userEmail}` : ''}
              {item.detail ? ` · ${item.detail}` : ''}
            </Text>
          ))
        : null}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: '#f5f5f5' },
  scroll: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  banner: {
    backgroundColor: '#e8eaf6',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    color: '#333',
    fontSize: 14,
    lineHeight: 20,
  },
  heading: { fontSize: 18, fontWeight: '700', color: BRAND_BLUE, marginTop: 20, marginBottom: 8 },
  muted: { color: '#666', marginBottom: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: BRAND_RED,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#222' },
  cardMeta: { fontSize: 13, color: '#555', marginTop: 4 },
  form: { gap: 8 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  inputHalf: { flex: 1 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BRAND_BLUE,
    backgroundColor: '#fff',
  },
  chipOn: { backgroundColor: BRAND_BLUE },
  chipText: { color: BRAND_BLUE, fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  primaryBtn: { backgroundColor: BRAND_BLUE, borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  secondaryBtn: { backgroundColor: '#fff', borderRadius: 8, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: BRAND_BLUE },
  secondaryBtnText: { color: BRAND_BLUE, fontWeight: '700' },
  smallBtn: { marginTop: 8, backgroundColor: BRAND_BLUE, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 },
  smallBtnDanger: { backgroundColor: BRAND_RED },
  smallBtnText: { color: '#fff', fontWeight: '600' },
  listLine: { fontSize: 14, color: '#333', marginVertical: 2 },
  logLine: { fontSize: 12, color: '#333', marginVertical: 4, fontFamily: 'Courier' },
});
