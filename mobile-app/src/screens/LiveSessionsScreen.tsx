import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { joinOpensAtLabel, userMayJoinLiveSession } from '../utils/liveJoinWindow';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';
const PAGE_BG = '#edf1fa';

type LiveSession = {
  id: number;
  batch_id: number;
  title: string;
  session_day?: number | null;
  session_date?: string | null;
  cancellation_reason?: string | null;
  starts_at: string;
  ends_at: string;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  batch_name: string;
  session_type: 'group' | 'one_to_one';
  trainer_name: string;
  recordingPlaybackUrl?: string | null;
};

type BatchOption = {
  id: number;
  name: string;
  batch_status?: string | null;
  session_type?: string | null;
  title?: string | null;
  batch_number?: number | null;
};

type DayTone = 'empty' | 'scheduled' | 'ended' | 'live' | 'cancelled';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

function sessionDayKey(s: LiveSession): string {
  const raw = String(s.session_date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(s.starts_at);
  if (Number.isNaN(d.getTime())) return '';
  return ymdLocal(d);
}

function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatFriendlyDate(ymd: string) {
  const d = parseYmd(ymd);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function statusRank(status: LiveSession['status']): number {
  if (status === 'live') return 4;
  if (status === 'scheduled') return 3;
  if (status === 'ended') return 2;
  if (status === 'cancelled') return 1;
  return 0;
}

function dayToneFromSessions(list: LiveSession[]): DayTone {
  if (!list.length) return 'empty';
  let best = list[0];
  for (const s of list) {
    if (statusRank(s.status) > statusRank(best.status)) best = s;
  }
  if (best.status === 'live') return 'live';
  if (best.status === 'scheduled') return 'scheduled';
  if (best.status === 'cancelled') return 'cancelled';
  return 'ended';
}

function sessionHeadline(item: LiveSession) {
  if (item.status === 'cancelled') {
    return formatFriendlyDate(sessionDayKey(item) || ymdLocal(new Date()));
  }
  if (Number.isFinite(Number(item.session_day))) {
    return `Day ${String(Number(item.session_day)).padStart(2, '0')}`;
  }
  return item.title?.trim() || 'Class';
}

function statusLabel(status: LiveSession['status']) {
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'live') return 'Live now';
  if (status === 'ended') return 'Ended';
  return 'Scheduled';
}

function isOngoingBatch(batch: BatchOption) {
  return String(batch.batch_status || '').toLowerCase() === 'started';
}

function sortBatches(list: BatchOption[]): BatchOption[] {
  return [...list].sort((a, b) => {
    const ao = isOngoingBatch(a) ? 0 : 1;
    const bo = isOngoingBatch(b) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return Number(b.id) - Number(a.id);
  });
}

function monthMatrix(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(ymdLocal(new Date(year, month, d)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

function pickDefaultDay(batchSessions: LiveSession[], todayYmd: string): string {
  const upcoming = batchSessions
    .filter((s) => s.status === 'scheduled' || s.status === 'live')
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  if (upcoming.length) {
    const key = sessionDayKey(upcoming[0]);
    if (key) return key;
  }
  const onToday = batchSessions.filter((s) => sessionDayKey(s) === todayYmd);
  if (onToday.length) return todayYmd;
  const past = [...batchSessions]
    .filter((s) => sessionDayKey(s))
    .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
  if (past.length) return sessionDayKey(past[0]);
  return todayYmd;
}

export default function LiveSessionsScreen({ navigation }: any) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<string>(ymdLocal(new Date()));
  const [cursorMonth, setCursorMonth] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  const [batchPickerOpen, setBatchPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [timePulse, setTimePulse] = useState(0);

  const load = useCallback(async () => {
    try {
      const [sessionData, batchData] = await Promise.all([
        api.get('/live/sessions'),
        api.get('/batch-manager').catch(() => []),
      ]);
      const sessionRows: LiveSession[] = Array.isArray(sessionData) ? sessionData : [];
      setSessions(sessionRows);

      const fromApi: BatchOption[] = Array.isArray(batchData)
        ? batchData.map((b: any) => ({
            id: Number(b.id),
            name: String(b.title || b.name || `Batch #${b.batch_number || b.id}`),
            batch_status: b.batch_status,
            session_type: b.session_type,
            title: b.title,
            batch_number: b.batch_number,
          }))
        : [];

      const byId = new Map<number, BatchOption>();
      for (const b of fromApi) byId.set(b.id, b);
      for (const s of sessionRows) {
        if (!byId.has(s.batch_id)) {
          byId.set(s.batch_id, {
            id: s.batch_id,
            name: s.batch_name || `Batch #${s.batch_id}`,
            session_type: s.session_type,
          });
        }
      }
      const ordered = sortBatches([...byId.values()]);
      setBatches(ordered);

      setSelectedBatchId((prev) => {
        if (prev != null && ordered.some((b) => b.id === prev)) return prev;
        return ordered[0]?.id ?? null;
      });
    } catch {
      setSessions([]);
      setBatches([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      setRefreshing(true);
      void load();
    }, [load]),
  );

  const batchSessions = useMemo(() => {
    if (selectedBatchId == null) return sessions;
    return sessions.filter((s) => Number(s.batch_id) === Number(selectedBatchId));
  }, [sessions, selectedBatchId]);

  const sessionsByDay = useMemo(() => {
    const map = new Map<string, LiveSession[]>();
    for (const s of batchSessions) {
      const key = sessionDayKey(s);
      if (!key) continue;
      const list = map.get(key) || [];
      list.push(s);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    }
    return map;
  }, [batchSessions]);

  useEffect(() => {
    if (selectedBatchId == null) return;
    const today = ymdLocal(new Date());
    const day = pickDefaultDay(batchSessions, today);
    setSelectedDay(day);
    const d = parseYmd(day);
    setCursorMonth({ year: d.getFullYear(), month: d.getMonth() });
    // Intentionally only when the selected batch changes — preserve manual day picks on refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatchId]);

  useFocusEffect(
    useCallback(() => {
      const pulseTimer = setInterval(() => {
        setTimePulse((v) => v + 1);
      }, 15000);

      const now = Date.now();
      const candidates: number[] = [];
      for (const s of sessions) {
        const startMs = new Date(s.starts_at).getTime();
        const endMs = new Date(s.ends_at).getTime();
        if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
        if (s.status !== 'scheduled' && s.status !== 'live') continue;
        const openAt = startMs - 5 * 60 * 1000;
        if (openAt > now) candidates.push(openAt);
        if (endMs > now) candidates.push(endMs);
      }
      const nextBoundary = candidates.length > 0 ? Math.min(...candidates) : null;
      const boundaryTimer =
        nextBoundary != null
          ? setTimeout(() => {
              setRefreshing(true);
              void load();
            }, Math.max(0, nextBoundary - Date.now()) + 50)
          : null;

      return () => {
        clearInterval(pulseTimer);
        if (boundaryTimer) clearTimeout(boundaryTimer);
      };
    }, [sessions, load]),
  );

  const selectedBatch = batches.find((b) => b.id === selectedBatchId) || null;
  const daySessions = sessionsByDay.get(selectedDay) || [];
  const todayYmd = ymdLocal(new Date());
  const matrix = monthMatrix(cursorMonth.year, cursorMonth.month);
  const monthLabel = new Date(cursorMonth.year, cursorMonth.month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const shiftMonth = (delta: number) => {
    setCursorMonth((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  void timePulse;

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenPageTitle title="My Sessions" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenPageTitle title="My Sessions" />
      <ScrollView
        style={styles.listFlex}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {batches.length > 1 ? (
          <TouchableOpacity
            style={styles.batchSelector}
            onPress={() => setBatchPickerOpen(true)}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel="Select batch"
          >
            <View style={styles.batchIconWrap}>
              <Ionicons name="layers-outline" size={20} color={BRAND_RED} />
            </View>
            <View style={styles.batchSelectorBody}>
              <Text style={styles.batchSelectorEyebrow}>Batch</Text>
              <Text style={styles.batchSelectorTitle} numberOfLines={1}>
                {selectedBatch?.name || 'Select batch'}
              </Text>
              {selectedBatch ? (
                <Text style={styles.batchSelectorMeta} numberOfLines={1}>
                  {isOngoingBatch(selectedBatch) ? 'Ongoing' : 'Past / upcoming'}
                  {selectedBatch.session_type
                    ? ` · ${selectedBatch.session_type === 'one_to_one' ? '1:1' : 'Group'}`
                    : ''}
                </Text>
              ) : null}
            </View>
            <Ionicons name="chevron-down" size={20} color="#64748b" />
          </TouchableOpacity>
        ) : null}

        <View style={styles.calendarCard}>
          <View style={styles.monthRow}>
            <TouchableOpacity
              style={styles.monthArrow}
              onPress={() => shiftMonth(-1)}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
            >
              <Ionicons name="chevron-back" size={20} color={BRAND_BLUE} />
            </TouchableOpacity>
            <Text style={styles.monthLabel}>{monthLabel}</Text>
            <TouchableOpacity
              style={styles.monthArrow}
              onPress={() => shiftMonth(1)}
              accessibilityRole="button"
              accessibilityLabel="Next month"
            >
              <Ionicons name="chevron-forward" size={20} color={BRAND_BLUE} />
            </TouchableOpacity>
          </View>

          <View style={styles.weekdayRow}>
            {WEEKDAYS.map((d) => (
              <Text key={d} style={styles.weekday}>
                {d}
              </Text>
            ))}
          </View>

          {matrix.map((row, ri) => (
            <View key={`row-${ri}`} style={styles.calRow}>
              {row.map((ymd, ci) => {
                if (!ymd) return <View key={`pad-${ri}-${ci}`} style={styles.dayCell} />;
                const tone = dayToneFromSessions(sessionsByDay.get(ymd) || []);
                const selected = ymd === selectedDay;
                const isToday = ymd === todayYmd;
                return (
                  <TouchableOpacity
                    key={ymd}
                    style={[
                      styles.dayCell,
                      tone === 'scheduled' && styles.dayScheduled,
                      tone === 'live' && styles.dayLive,
                      tone === 'ended' && styles.dayEnded,
                      tone === 'cancelled' && styles.dayCancelled,
                      selected && styles.daySelected,
                    ]}
                    onPress={() => setSelectedDay(ymd)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        tone === 'empty' && styles.dayTextEmpty,
                        tone === 'scheduled' && styles.dayTextScheduled,
                        tone === 'live' && styles.dayTextLive,
                        tone === 'ended' && styles.dayTextEnded,
                        tone === 'cancelled' && styles.dayTextCancelled,
                        selected && styles.dayTextSelected,
                      ]}
                    >
                      {Number(ymd.slice(8, 10))}
                    </Text>
                    {isToday && !selected ? <View style={styles.todayDot} /> : null}
                    {tone !== 'empty' && !selected ? (
                      <View
                        style={[
                          styles.toneDot,
                          tone === 'scheduled' && styles.toneDotScheduled,
                          tone === 'live' && styles.toneDotLive,
                          tone === 'ended' && styles.toneDotEnded,
                          tone === 'cancelled' && styles.toneDotCancelled,
                        ]}
                      />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}

          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, styles.legendEmpty]} />
              <Text style={styles.legendText}>Empty</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, styles.legendScheduled]} />
              <Text style={styles.legendText}>Scheduled</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, styles.legendEnded]} />
              <Text style={styles.legendText}>Ended</Text>
            </View>
          </View>
        </View>

        <Text style={styles.dayHeading}>{formatFriendlyDate(selectedDay)}</Text>

        {!daySessions.length ? (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-outline" size={28} color="#94a3b8" />
            <Text style={styles.emptyTitle}>No class this day</Text>
            <Text style={styles.emptySub}>Pick a highlighted date on the calendar.</Text>
          </View>
        ) : (
          daySessions.map((item) => {
            const canJoin =
              item.status !== 'cancelled' &&
              userMayJoinLiveSession({
                userRole: user?.role,
                liveStatus: item.status,
                startsAt: item.starts_at,
                endsAt: item.ends_at,
              });
            const showWaitHint =
              !canJoin &&
              (user?.role === 'Student' || user?.role === 'Lab') &&
              item.status === 'scheduled';
            const showPlayRecording =
              item.status === 'ended' &&
              typeof item.recordingPlaybackUrl === 'string' &&
              item.recordingPlaybackUrl.length > 0;
            const cancelled = item.status === 'cancelled';
            const titleText = sessionHeadline(item);
            const reason = (item.cancellation_reason || '').trim();

            return (
              <View key={item.id} style={styles.sessionCard}>
                <View style={styles.sessionCardTop}>
                  <View style={styles.sessionTitleBlock}>
                    <Text style={styles.sessionEyebrow}>
                      {item.session_type === 'one_to_one' ? '1:1 class' : 'Group class'}
                    </Text>
                    <Text style={styles.sessionTitle}>{titleText}</Text>
                  </View>
                  <View
                    style={[
                      styles.statusChip,
                      item.status === 'live' && styles.statusChipLive,
                      item.status === 'scheduled' && styles.statusChipScheduled,
                      item.status === 'ended' && styles.statusChipEnded,
                      item.status === 'cancelled' && styles.statusChipCancelled,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusChipText,
                        item.status === 'live' && styles.statusChipTextLive,
                        item.status === 'scheduled' && styles.statusChipTextScheduled,
                        item.status === 'ended' && styles.statusChipTextEnded,
                        item.status === 'cancelled' && styles.statusChipTextCancelled,
                      ]}
                    >
                      {statusLabel(item.status)}
                    </Text>
                  </View>
                </View>

                {cancelled ? (
                  reason ? (
                    <View style={styles.metaRow}>
                      <Ionicons name="information-circle-outline" size={18} color="#64748b" />
                      <Text style={styles.metaText}>{reason}</Text>
                    </View>
                  ) : null
                ) : (
                  <>
                    <View style={styles.metaRow}>
                      <Ionicons name="school-outline" size={18} color={BRAND_BLUE} />
                      <Text style={styles.metaText}>{item.batch_name}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Ionicons name="person-outline" size={18} color={BRAND_BLUE} />
                      <Text style={styles.metaText}>{item.trainer_name}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Ionicons name="time-outline" size={18} color={BRAND_BLUE} />
                      <Text style={styles.metaText}>
                        {formatClock(item.starts_at)} – {formatClock(item.ends_at)}
                      </Text>
                    </View>
                  </>
                )}

                {showWaitHint ? (
                  <Text style={styles.hint}>{joinOpensAtLabel(item.starts_at)}</Text>
                ) : null}

                {showPlayRecording ? (
                  <TouchableOpacity
                    style={styles.playBtn}
                    onPress={() =>
                      navigation.navigate('SessionRecordings', {
                        liveSessionId: item.id,
                        title: titleText,
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel="Play recording"
                  >
                    <Ionicons name="play-circle" size={20} color="#fff" />
                    <Text style={styles.playBtnText}>Play recording(s)</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.joinBtn, !canJoin && styles.joinBtnDisabled]}
                    disabled={!canJoin}
                    onPress={() =>
                      canJoin
                        ? navigation.navigate('LiveClassroom', {
                            liveSessionId: item.id,
                            title: titleText,
                          })
                        : undefined
                    }
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name={canJoin ? 'videocam' : cancelled ? 'close-circle' : 'lock-closed'}
                      size={18}
                      color="#fff"
                    />
                    <Text style={styles.joinBtnText}>
                      {canJoin
                        ? 'Join class'
                        : cancelled
                          ? 'Cancelled'
                          : item.status === 'ended'
                            ? 'Ended'
                            : 'Not yet'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      <Modal
        visible={batchPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setBatchPickerOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setBatchPickerOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Your batches</Text>
            <Text style={styles.modalSub}>Ongoing batches appear first.</Text>
            <ScrollView style={styles.modalList} showsVerticalScrollIndicator={false}>
              {batches.map((batch) => {
                const selected = batch.id === selectedBatchId;
                return (
                  <TouchableOpacity
                    key={batch.id}
                    style={[styles.batchOption, selected && styles.batchOptionSelected]}
                    onPress={() => {
                      setSelectedBatchId(batch.id);
                      setBatchPickerOpen(false);
                    }}
                    activeOpacity={0.88}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.batchOptionTitle, selected && styles.batchOptionTitleSelected]} numberOfLines={2}>
                        {batch.name}
                      </Text>
                      <Text style={styles.batchOptionMeta}>
                        {isOngoingBatch(batch) ? 'Ongoing' : 'Past / upcoming'}
                        {batch.session_type
                          ? ` · ${batch.session_type === 'one_to_one' ? '1:1' : 'Group'}`
                          : ''}
                      </Text>
                    </View>
                    {selected ? <Ionicons name="checkmark-circle" size={22} color={BRAND_RED} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: PAGE_BG },
  listFlex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 36 },

  batchSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e4ebf8',
    padding: 14,
    marginBottom: 14,
    shadowColor: BRAND_BLUE,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  batchIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#fff5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  batchSelectorBody: { flex: 1, minWidth: 0 },
  batchSelectorEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: BRAND_RED,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  batchSelectorTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  batchSelectorMeta: { marginTop: 2, fontSize: 12, color: '#64748b', fontWeight: '600' },

  calendarCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e4ebf8',
    padding: 14,
    marginBottom: 16,
    shadowColor: BRAND_BLUE,
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  monthArrow: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#f1f5fb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthLabel: { fontSize: 17, fontWeight: '800', color: BRAND_BLUE, letterSpacing: -0.2 },
  weekdayRow: { flexDirection: 'row', marginBottom: 6 },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.3,
  },
  calRow: { flexDirection: 'row', marginBottom: 4 },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    maxHeight: 44,
    marginHorizontal: 2,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayScheduled: { backgroundColor: '#fff1f2' },
  dayLive: { backgroundColor: '#dcfce7' },
  dayEnded: { backgroundColor: '#eef2f7' },
  dayCancelled: { backgroundColor: '#f1f5f9' },
  daySelected: {
    backgroundColor: BRAND_BLUE,
    shadowColor: BRAND_BLUE,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  dayText: { fontSize: 14, fontWeight: '700', color: '#334155' },
  dayTextEmpty: { color: '#cbd5e1', fontWeight: '600' },
  dayTextScheduled: { color: BRAND_RED },
  dayTextLive: { color: '#15803d' },
  dayTextEnded: { color: '#64748b' },
  dayTextCancelled: { color: '#94a3b8', textDecorationLine: 'line-through' },
  dayTextSelected: { color: '#fff' },
  todayDot: {
    position: 'absolute',
    bottom: 5,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: BRAND_BLUE,
  },
  toneDot: {
    position: 'absolute',
    bottom: 5,
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  toneDotScheduled: { backgroundColor: BRAND_RED },
  toneDotLive: { backgroundColor: '#22c55e' },
  toneDotEnded: { backgroundColor: '#94a3b8' },
  toneDotCancelled: { backgroundColor: '#cbd5e1' },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e8eef8',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 10, height: 10, borderRadius: 3 },
  legendEmpty: { backgroundColor: '#e2e8f0' },
  legendScheduled: { backgroundColor: BRAND_RED },
  legendEnded: { backgroundColor: '#94a3b8' },
  legendText: { fontSize: 11, fontWeight: '600', color: '#64748b' },

  dayHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginLeft: 2,
  },

  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e4ebf8',
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#334155' },
  emptySub: { fontSize: 13, color: '#94a3b8', textAlign: 'center' },

  sessionCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e4ebf8',
    padding: 16,
    marginBottom: 12,
    shadowColor: BRAND_BLUE,
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  sessionCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 14,
  },
  sessionTitleBlock: { flex: 1, minWidth: 0 },
  sessionEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: BRAND_RED,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  sessionTitle: { fontSize: 22, fontWeight: '800', color: '#0f172a', letterSpacing: -0.3 },
  statusChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#eef2f7',
  },
  statusChipLive: { backgroundColor: '#dcfce7' },
  statusChipScheduled: { backgroundColor: '#fff1f2' },
  statusChipEnded: { backgroundColor: '#eef2f7' },
  statusChipCancelled: { backgroundColor: '#f1f5f9' },
  statusChipText: { fontSize: 11, fontWeight: '800', color: '#64748b' },
  statusChipTextLive: { color: '#15803d' },
  statusChipTextScheduled: { color: BRAND_RED },
  statusChipTextEnded: { color: '#64748b' },
  statusChipTextCancelled: { color: '#94a3b8' },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  metaText: { flex: 1, fontSize: 14, color: '#334155', fontWeight: '600' },
  hint: { fontSize: 12, color: '#64748b', marginTop: 4, marginBottom: 4, fontStyle: 'italic' },
  joinBtn: {
    marginTop: 12,
    backgroundColor: BRAND_BLUE,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  joinBtnDisabled: { backgroundColor: '#94a3b8' },
  joinBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  playBtn: {
    marginTop: 12,
    backgroundColor: '#15803d',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  playBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    maxHeight: '70%',
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: BRAND_BLUE },
  modalSub: { marginTop: 4, marginBottom: 14, fontSize: 13, color: '#64748b' },
  modalList: { maxHeight: 360 },
  batchOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8eef8',
    marginBottom: 8,
    backgroundColor: '#f8fafc',
  },
  batchOptionSelected: {
    backgroundColor: '#fff5f5',
    borderColor: '#fecaca',
  },
  batchOptionTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  batchOptionTitleSelected: { color: BRAND_RED },
  batchOptionMeta: { marginTop: 3, fontSize: 12, color: '#64748b', fontWeight: '600' },
});
