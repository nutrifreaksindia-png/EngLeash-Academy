import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Country } from 'country-state-city';
import { api } from '../api/client';
import { buildCallbackDateOptions, filterCallbackTimeSlotsForDate } from '../lib/callbackBookingMeta';

const BRAND_BLUE = '#1a237e';
const BRAND_RED = '#c41e3a';

const ALL_COUNTRIES = Country.getAllCountries().sort((a, b) => a.name.localeCompare(b.name));
const DEFAULT_COUNTRY_ISO = ALL_COUNTRIES.find((c) => c.isoCode === 'IN')?.isoCode || ALL_COUNTRIES[0]?.isoCode || '';

type TimeSlot = { id: string; label: string };

function friendlyDate(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d, 6, 30, 0));
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ApplyCallbackScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const courseId = Number(route.params?.courseId);
  const courseName = String(route.params?.courseName || 'Course');
  const batchId = route.params?.batch_id ?? route.params?.batchId;
  const batchIdNorm = batchId === null || batchId === undefined || batchId === '' ? null : Number(batchId);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [countryIso, setCountryIso] = useState(DEFAULT_COUNTRY_ISO);
  const [phoneLocal, setPhoneLocal] = useState('');
  const [callbackDate, setCallbackDate] = useState('');
  const [callbackSlot, setCallbackSlot] = useState('');
  const [countryModal, setCountryModal] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const rawDateOptions = useMemo(() => buildCallbackDateOptions(holidays, 7), [holidays]);
  const dateOptions = useMemo(
    () => rawDateOptions.filter((ymd) => filterCallbackTimeSlotsForDate(timeSlots, ymd, now).length > 0),
    [rawDateOptions, timeSlots, now],
  );
  const availableTimeSlots = useMemo(
    () => filterCallbackTimeSlotsForDate(timeSlots, callbackDate, now),
    [timeSlots, callbackDate, now],
  );

  const dialCode = useMemo(() => {
    const c = ALL_COUNTRIES.find((x) => x.isoCode === countryIso);
    return c ? `+${c.phonecode}` : '+91';
  }, [countryIso]);

  const resetForm = useCallback(() => {
    setDisplayName('');
    setCountryIso(DEFAULT_COUNTRY_ISO);
    setPhoneLocal('');
    setCallbackDate('');
    setCallbackSlot('');
  }, []);

  useEffect(() => {
    if (!Number.isFinite(courseId)) {
      Alert.alert('Callback', 'Invalid course.');
      navigation.goBack();
      return;
    }
    let cancelled = false;
    setLoading(true);
    resetForm();
    Promise.all([api.get('/payments/apply/callback-meta'), api.get('/users/me')])
      .then(([meta, me]) => {
        if (cancelled) return;
        setHolidays(Array.isArray(meta?.holidays) ? meta.holidays : []);
        setTimeSlots(Array.isArray(meta?.time_slots) ? meta.time_slots : []);
        const sp = me?.studentProfile;
        const nm = String(me?.name || '').trim();
        if (nm) setDisplayName(nm);
        const cc = String(sp?.country_code || '').trim();
        if (cc.startsWith('+')) {
          const digits = cc.replace(/\D/g, '');
          const match = ALL_COUNTRIES.find((co) => String(co.phonecode).replace(/\D/g, '') === digits);
          if (match) setCountryIso(match.isoCode);
        }
        const mob = String(me?.mobile_number || '').replace(/\D/g, '');
        if (mob) setPhoneLocal(mob);
      })
      .catch(() => {
        if (!cancelled) {
          setHolidays([]);
          setTimeSlots([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, navigation, resetForm]);

  useEffect(() => {
    if (!dateOptions.length) return;
    if (!callbackDate || !dateOptions.includes(callbackDate)) {
      setCallbackDate(dateOptions[0]);
    }
  }, [dateOptions, callbackDate]);

  useEffect(() => {
    if (!callbackSlot) return;
    if (!availableTimeSlots.some((slot) => slot.id === callbackSlot)) {
      setCallbackSlot('');
    }
  }, [availableTimeSlots, callbackSlot]);

  async function submit() {
    const name = displayName.trim();
    const digits = phoneLocal.replace(/\D/g, '');
    if (name.length < 2) {
      Alert.alert('Callback', 'Please enter your name.');
      return;
    }
    if (digits.length < 6 || digits.length > 15) {
      Alert.alert('Callback', 'Please enter a valid phone number.');
      return;
    }
    if (!callbackDate) {
      Alert.alert('Callback', 'Please choose a preferred date.');
      return;
    }
    if (!callbackSlot) {
      Alert.alert('Callback', 'Please choose a time slot.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/payments/apply/enquiries', {
        course_id: courseId,
        batch_id: batchIdNorm,
        display_name: name,
        phone_country_code: dialCode,
        phone_local: digits,
        callback_date: callbackDate,
        callback_slot: callbackSlot,
      });
      Alert.alert('Request sent', 'We will call you back at your chosen time. Thank you.');
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Callback', e?.message || 'Could not submit request');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.page, { paddingBottom: 12 + insets.bottom }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.sub}>{courseName}</Text>
        {batchIdNorm != null ? <Text style={styles.hint}>Regarding batch #{batchIdNorm}</Text> : null}
        {loading ? <ActivityIndicator color={BRAND_RED} style={{ marginVertical: 16 }} /> : null}
        {!loading ? (
          <>
            <Text style={styles.label}>Your name</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Full name"
              placeholderTextColor="#94a3b8"
            />

            <Text style={styles.label}>Phone</Text>
            <View style={styles.phoneRow}>
              <TouchableOpacity style={styles.codeBtn} onPress={() => setCountryModal(true)}>
                <Text style={styles.codeBtnText}>{dialCode}</Text>
              </TouchableOpacity>
              <TextInput
                style={[styles.input, styles.phoneInput]}
                value={phoneLocal}
                onChangeText={(t) => setPhoneLocal(t.replace(/[^\d\s-]/g, ''))}
                placeholder="Mobile number"
                keyboardType="phone-pad"
                placeholderTextColor="#94a3b8"
              />
            </View>

            <Text style={styles.label}>Preferred date (IST)</Text>
            <Text style={styles.hintSmall}>
              Next 7 days only. Sundays, second Saturdays, and academy holidays are excluded.
            </Text>
            {dateOptions.length === 0 ? (
              <Text style={styles.noDatesHint}>No bookable slots in this week. Please try again later.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                {dateOptions.map((ymd) => (
                  <TouchableOpacity
                    key={ymd}
                    style={[styles.chip, callbackDate === ymd && styles.chipOn]}
                    onPress={() => setCallbackDate(ymd)}
                  >
                    <Text style={[styles.chipText, callbackDate === ymd && styles.chipTextOn]}>{friendlyDate(ymd)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <Text style={styles.label}>Time slot</Text>
            {availableTimeSlots.length === 0 ? (
              <Text style={styles.noDatesHint}>No remaining slots for this date. Please choose another date.</Text>
            ) : (
              availableTimeSlots.map((slot) => (
                <TouchableOpacity
                  key={slot.id}
                  style={[styles.slotBtn, callbackSlot === slot.id && styles.slotBtnOn]}
                  onPress={() => setCallbackSlot(slot.id)}
                >
                  <Text style={[styles.slotText, callbackSlot === slot.id && styles.slotTextOn]}>{slot.label}</Text>
                </TouchableOpacity>
              ))
            )}
          </>
        ) : null}

        <View style={styles.actions}>
          <TouchableOpacity style={styles.btnOutline} onPress={() => navigation.goBack()} disabled={submitting}>
            <Text style={styles.btnOutlineText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={() => void submit()}
            disabled={submitting || loading || dateOptions.length === 0 || availableTimeSlots.length === 0}
          >
            <Text style={styles.btnPrimaryText}>{submitting ? 'Sending…' : 'Submit'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal visible={countryModal} animationType="fade" transparent onRequestClose={() => setCountryModal(false)}>
        <TouchableOpacity style={styles.countryOverlay} activeOpacity={1} onPress={() => setCountryModal(false)}>
          <View style={styles.countryCard}>
            <Text style={styles.countryTitle}>Country code</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {ALL_COUNTRIES.map((c) => (
                <TouchableOpacity
                  key={c.isoCode}
                  style={styles.countryRow}
                  onPress={() => {
                    setCountryIso(c.isoCode);
                    setCountryModal(false);
                  }}
                >
                  <Text style={styles.countryRowText}>{`+${c.phonecode} — ${c.name}`}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f5f5f5' },
  scroll: { padding: 16, paddingBottom: 32 },
  sub: { fontSize: 16, fontWeight: '700', color: BRAND_BLUE },
  hint: { fontSize: 12, color: '#64748b', marginTop: 4 },
  hintSmall: { fontSize: 12, color: '#94a3b8', marginBottom: 6 },
  noDatesHint: { fontSize: 13, color: '#b45309', marginTop: 6, marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '700', color: '#0f172a', marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0f172a',
    marginTop: 6,
    backgroundColor: '#fff',
  },
  phoneRow: { flexDirection: 'row', gap: 8, marginTop: 6, alignItems: 'center' },
  codeBtn: {
    borderWidth: 1,
    borderColor: BRAND_BLUE,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  codeBtnText: { fontWeight: '700', color: BRAND_BLUE, fontSize: 14 },
  phoneInput: { flex: 1, marginTop: 0 },
  chipScroll: { marginTop: 8, marginBottom: 4 },
  chip: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    backgroundColor: '#fff',
  },
  chipOn: { backgroundColor: BRAND_BLUE, borderColor: BRAND_BLUE },
  chipText: { fontSize: 12, color: '#334155', fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  slotBtn: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 8,
    backgroundColor: '#fff',
  },
  slotBtnOn: { borderColor: BRAND_BLUE, backgroundColor: '#e8eaf6' },
  slotText: { fontSize: 14, color: '#334155' },
  slotTextOn: { color: BRAND_BLUE, fontWeight: '700' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 20 },
  btnOutline: { borderWidth: 1.5, borderColor: BRAND_BLUE, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  btnOutlineText: { color: BRAND_BLUE, fontWeight: '700' },
  btnPrimary: { backgroundColor: BRAND_RED, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
  countryOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 20 },
  countryCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, maxHeight: '70%' },
  countryTitle: { fontWeight: '800', fontSize: 16, marginBottom: 8, color: BRAND_BLUE },
  countryRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e2e8f0' },
  countryRowText: { fontSize: 14, color: '#0f172a' },
});
