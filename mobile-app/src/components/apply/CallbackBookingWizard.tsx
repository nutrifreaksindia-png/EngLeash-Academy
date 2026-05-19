import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { defaultCountryIso, getAllCountriesSorted, loadGeoModule } from '../../lib/geoData';
import {
  buildCallbackDateOptions,
  filterCallbackTimeSlotsForDate,
} from '../../lib/callbackBookingMeta';
import {
  formatCallbackDateChip,
  formatCallbackDateLong,
  formatCallbackSlotRange,
  timezoneFootnote,
} from '../../lib/callbackTimezone';
import type { ApplyCallbackNavParams } from '../../lib/applyNavigation';
import { api } from '../../api/client';

const BRAND_BLUE = '#1a237e';
const BRAND_RED = '#c41e3a';
const STEPS = ['When', 'Time', 'You'] as const;
const { width: SCREEN_W } = Dimensions.get('window');

type TimeSlot = { id: string; label: string };
type CountryRow = Awaited<ReturnType<typeof getAllCountriesSorted>>[number];

type Props = {
  params: ApplyCallbackNavParams;
  onDone: () => void;
  onCancel: () => void;
};

function buildInterestLine(courseName: string, batchLabel?: string, noOpenBatches?: boolean) {
  const course = courseName.trim() || 'this course';
  if (noOpenBatches || !batchLabel) {
    return `Hi — I'm interested in joining ${course}.`;
  }
  return `Hi — I'm interested in joining ${course} in ${batchLabel}.`;
}

function buildFullMessage(
  courseName: string,
  batchLabel: string | undefined,
  noOpenBatches: boolean | undefined,
  dateYmd: string,
  slotId: string,
  name: string,
  dialCode: string,
  phone: string,
) {
  const interest = buildInterestLine(courseName, batchLabel, noOpenBatches);
  const datePart = formatCallbackDateLong(dateYmd);
  const slotPart = formatCallbackSlotRange(slotId, dateYmd).local;
  return `${interest}\n\nPlease call me on ${datePart} between ${slotPart}.\n\n— ${name.trim()}, ${dialCode} ${phone.trim()}`;
}

export default function CallbackBookingWizard({ params, onDone, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const courseId = Number(params.courseId);
  const courseName = String(params.courseName || 'Course');
  const batchIdNorm =
    params.batchId === null || params.batchId === undefined || params.batchId === ''
      ? null
      : Number(params.batchId);
  const batchLabel =
    params.batchLabel || (batchIdNorm != null ? `Batch ${batchIdNorm}` : undefined);
  const noOpenBatches = params.noOpenBatches === true || !batchLabel;

  const [step, setStep] = useState(0);
  const slideX = useRef(new Animated.Value(0)).current;
  const [metaLoading, setMetaLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [countryIso, setCountryIso] = useState('IN');
  const [allCountries, setAllCountries] = useState<CountryRow[]>([]);
  const [phoneLocal, setPhoneLocal] = useState('');
  const [callbackDate, setCallbackDate] = useState('');
  const [callbackSlot, setCallbackSlot] = useState('');
  const [countryModal, setCountryModal] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    Animated.spring(slideX, {
      toValue: -step * SCREEN_W,
      useNativeDriver: true,
      tension: 68,
      friction: 12,
    }).start();
  }, [step, slideX]);

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
    const c = allCountries.find((x) => x.isoCode === countryIso);
    return c ? `+${c.phonecode}` : '+91';
  }, [allCountries, countryIso]);

  const interestPreview = useMemo(
    () => buildInterestLine(courseName, batchLabel, noOpenBatches),
    [courseName, batchLabel, noOpenBatches],
  );

  const finalPreview = useMemo(() => {
    if (!callbackDate || !callbackSlot || !displayName.trim()) return '';
    return buildFullMessage(
      courseName,
      batchLabel,
      noOpenBatches,
      callbackDate,
      callbackSlot,
      displayName,
      dialCode,
      phoneLocal,
    );
  }, [
    courseName,
    batchLabel,
    noOpenBatches,
    callbackDate,
    callbackSlot,
    displayName,
    dialCode,
    phoneLocal,
  ]);

  useEffect(() => {
    if (!Number.isFinite(courseId)) return;
    let cancelled = false;
    setMetaLoading(true);
    Promise.all([
      api.get('/payments/apply/callback-meta'),
      api.get('/users/me'),
      getAllCountriesSorted(),
      loadGeoModule(),
    ])
      .then(([meta, me, countries]) => {
        if (cancelled) return;
        setHolidays(Array.isArray(meta?.holidays) ? meta.holidays : []);
        setTimeSlots(Array.isArray(meta?.time_slots) ? meta.time_slots : []);
        setAllCountries(countries);
        const nm = String(me?.name || '').trim();
        if (nm) setDisplayName(nm);
        const sp = me?.studentProfile;
        const cc = String(sp?.country_code || '').trim();
        if (cc.startsWith('+')) {
          const digits = cc.replace(/\D/g, '');
          const match = countries.find((co) => String(co.phonecode).replace(/\D/g, '') === digits);
          if (match) setCountryIso(match.isoCode);
        } else {
          defaultCountryIso().then((iso) => {
            if (!cancelled && iso) setCountryIso(iso);
          });
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
        if (!cancelled) setMetaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

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

  useEffect(() => {
    if (availableTimeSlots.length === 1 && !callbackSlot) {
      setCallbackSlot(availableTimeSlots[0].id);
    }
  }, [availableTimeSlots, callbackSlot]);

  const goStep = useCallback((next: number) => {
    setStep(Math.max(0, Math.min(2, next)));
  }, []);

  async function submit() {
    const name = displayName.trim();
    const digits = phoneLocal.replace(/\D/g, '');
    if (name.length < 2) {
      Alert.alert('Almost there', 'Please enter your name.');
      return;
    }
    if (digits.length < 6 || digits.length > 15) {
      Alert.alert('Almost there', 'Please enter a valid phone number.');
      return;
    }
    if (!callbackDate || !callbackSlot) {
      Alert.alert('Almost there', 'Please choose a date and time.');
      return;
    }
    setSubmitting(true);
    try {
      const note = buildFullMessage(
        courseName,
        batchLabel,
        noOpenBatches,
        callbackDate,
        callbackSlot,
        name,
        dialCode,
        digits,
      );
      await api.post('/payments/apply/enquiries', {
        course_id: courseId,
        batch_id: batchIdNorm,
        display_name: name,
        phone_country_code: dialCode,
        phone_local: digits,
        callback_date: callbackDate,
        callback_slot: callbackSlot,
        note,
      });
      setSuccess(true);
    } catch (e: any) {
      Alert.alert('Could not book', e?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    const slotLabel = formatCallbackSlotRange(callbackSlot, callbackDate);
    return (
      <View style={[styles.page, styles.successPage, { paddingBottom: 24 + insets.bottom }]}>
        <Text style={styles.successIcon}>✓</Text>
        <Text style={styles.successTitle}>You&apos;re booked!</Text>
        <Text style={styles.successBody}>
          We&apos;ll call you on {formatCallbackDateLong(callbackDate)} between {slotLabel.local}.
          {slotLabel.ist ? `\n(${slotLabel.ist})` : ''}
        </Text>
        <Text style={styles.privacyLine}>We only use your details for this callback.</Text>
        <TouchableOpacity style={styles.btnPrimary} onPress={onDone}>
          <Text style={styles.btnPrimaryText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const canContinueStep0 = !!callbackDate && dateOptions.length > 0;
  const canContinueStep1 = !!callbackSlot && availableTimeSlots.length > 0;

  return (
    <View style={[styles.page, { paddingBottom: 12 + insets.bottom }]}>
      <View style={styles.progressRow}>
        {STEPS.map((label, i) => (
          <View key={label} style={styles.progressItem}>
            <View style={[styles.progressDot, i < step && styles.progressDotOn, i === step && styles.progressDotCurrent]}>
              <Text
                style={[
                  styles.progressDotText,
                  i < step && styles.progressDotTextOn,
                  i === step && styles.progressDotTextCurrent,
                ]}
              >
                {i + 1}
              </Text>
            </View>
            <Text style={[styles.progressLabel, i === step && styles.progressLabelOn]}>{label}</Text>
          </View>
        ))}
      </View>

      {metaLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={BRAND_RED} />
          <Text style={styles.loadingText}>Loading available times…</Text>
        </View>
      ) : (
        <>
          <View style={styles.pagerClip}>
            <Animated.View style={[styles.pagerTrack, { width: SCREEN_W * 3, transform: [{ translateX: slideX }] }]}>
              {/* Step 1 — When */}
              <ScrollView
                style={{ width: SCREEN_W }}
                contentContainerStyle={styles.stepScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.card}>
                  <Text style={styles.stepTitle}>Let&apos;s find a time that works for you</Text>
                  <View style={styles.bubble}>
                    <Text style={styles.bubbleText}>{interestPreview}</Text>
                    <Text style={styles.bubbleText}>Please call me on…</Text>
                  </View>
                  <Text style={styles.fieldLabel}>Choose a day</Text>
                  <Text style={styles.tzHint}>{timezoneFootnote()}</Text>
                  {dateOptions.length === 0 ? (
                    <Text style={styles.warn}>No slots this week. Please try again in a day or two.</Text>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                      {dateOptions.map((ymd) => (
                        <TouchableOpacity
                          key={ymd}
                          style={[styles.chip, callbackDate === ymd && styles.chipOn]}
                          onPress={() => setCallbackDate(ymd)}
                        >
                          <Text style={[styles.chipText, callbackDate === ymd && styles.chipTextOn]}>
                            {formatCallbackDateChip(ymd)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                </View>
              </ScrollView>

              {/* Step 2 — Time */}
              <ScrollView
                style={{ width: SCREEN_W }}
                contentContainerStyle={styles.stepScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.card}>
                  <Text style={styles.stepTitle}>What time suits you?</Text>
                  <View style={styles.bubble}>
                    <Text style={styles.bubbleText}>{interestPreview}</Text>
                    <Text style={styles.bubbleText}>
                      Please call me on{' '}
                      <Text style={styles.bubbleStrong}>
                        {callbackDate ? formatCallbackDateLong(callbackDate) : '…'}
                      </Text>{' '}
                      between
                    </Text>
                  </View>
                  {availableTimeSlots.length === 0 ? (
                    <Text style={styles.warn}>No times left on this day. Go back and pick another day.</Text>
                  ) : (
                    <View style={styles.slotGrid}>
                      {availableTimeSlots.map((slot) => {
                        const range = formatCallbackSlotRange(slot.id, callbackDate);
                        const on = callbackSlot === slot.id;
                        return (
                          <TouchableOpacity
                            key={slot.id}
                            style={[styles.slotBtn, on && styles.slotBtnOn]}
                            onPress={() => setCallbackSlot(slot.id)}
                          >
                            <Text style={[styles.slotText, on && styles.slotTextOn]}>{range.local}</Text>
                            {range.ist ? <Text style={styles.slotIst}>{range.ist}</Text> : null}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                  <Text style={styles.microHint}>We&apos;ll call within the hour you choose.</Text>
                </View>
              </ScrollView>

              {/* Step 3 — You */}
              <ScrollView
                style={{ width: SCREEN_W }}
                contentContainerStyle={styles.stepScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.card}>
                  <Text style={styles.stepTitle}>Almost done — how should we reach you?</Text>
                  <Text style={styles.stepSub}>
                    Takes under a minute. Your details stay private and are only used for this callback.
                  </Text>
                  <Text style={styles.fieldLabel}>My name is</Text>
                  <TextInput
                    style={styles.input}
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder="Your full name"
                    placeholderTextColor="#94a3b8"
                  />
                  <Text style={styles.fieldLabel}>Call my number</Text>
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
                  {finalPreview ? (
                    <View style={styles.previewCard}>
                      <Text style={styles.previewLabel}>Your request</Text>
                      <Text style={styles.previewBody}>{finalPreview}</Text>
                    </View>
                  ) : null}
                </View>
              </ScrollView>
            </Animated.View>
          </View>

          <Text style={styles.privacyLine}>We only use this to call you about this course. No spam.</Text>

          <View style={styles.footer}>
            {step > 0 ? (
              <TouchableOpacity style={styles.btnOutline} onPress={() => goStep(step - 1)} disabled={submitting}>
                <Text style={styles.btnOutlineText}>Back</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.btnOutline} onPress={onCancel} disabled={submitting}>
                <Text style={styles.btnOutlineText}>Cancel</Text>
              </TouchableOpacity>
            )}
            {step < 2 ? (
              <TouchableOpacity
                style={[
                  styles.btnPrimary,
                  styles.btnPrimaryFlex,
                  (step === 0 && !canContinueStep0) || (step === 1 && !canContinueStep1) ? styles.btnDisabled : null,
                ]}
                disabled={(step === 0 && !canContinueStep0) || (step === 1 && !canContinueStep1)}
                onPress={() => goStep(step + 1)}
              >
                <Text style={styles.btnPrimaryText}>Continue</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.btnPrimary, styles.btnPrimaryFlex, submitting && styles.btnDisabled]}
                onPress={() => void submit()}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnPrimaryText}>Request my call</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </>
      )}

      <Modal visible={countryModal} animationType="fade" transparent onRequestClose={() => setCountryModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setCountryModal(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Country code</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {allCountries.map((c) => (
                <TouchableOpacity
                  key={c.isoCode}
                  style={styles.modalRow}
                  onPress={() => {
                    setCountryIso(c.isoCode);
                    setCountryModal(false);
                  }}
                >
                  <Text style={styles.modalRowText}>{`+${c.phonecode} — ${c.name}`}</Text>
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
  successPage: { justifyContent: 'center', alignItems: 'center', padding: 28 },
  successIcon: { fontSize: 48, color: '#166534', marginBottom: 12 },
  successTitle: { fontSize: 22, fontWeight: '800', color: BRAND_BLUE, marginBottom: 10 },
  successBody: { fontSize: 15, lineHeight: 22, color: '#334155', textAlign: 'center', marginBottom: 12 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  progressItem: { alignItems: 'center', flex: 1 },
  progressDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressDotOn: { backgroundColor: '#c7d2fe' },
  progressDotCurrent: { backgroundColor: BRAND_BLUE },
  progressDotText: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  progressDotTextOn: { color: BRAND_BLUE },
  progressDotTextCurrent: { color: '#fff' },
  progressLabel: { fontSize: 11, color: '#94a3b8', marginTop: 4, fontWeight: '600' },
  progressLabelOn: { color: BRAND_BLUE },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: '#64748b', fontSize: 14 },
  pagerClip: { flex: 1, overflow: 'hidden' },
  pagerTrack: { flexDirection: 'row', flex: 1 },
  stepScroll: { paddingHorizontal: 16, paddingBottom: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e8eaf6',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  stepTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a', marginBottom: 12 },
  stepSub: { fontSize: 14, lineHeight: 20, color: '#64748b', marginBottom: 14 },
  bubble: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 4,
    borderLeftColor: BRAND_BLUE,
    marginBottom: 16,
  },
  bubbleText: { fontSize: 15, lineHeight: 22, color: '#334155' },
  bubbleStrong: { fontWeight: '700', color: BRAND_BLUE },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: '#0f172a', marginBottom: 6 },
  tzHint: { fontSize: 12, color: '#94a3b8', marginBottom: 10 },
  microHint: { fontSize: 12, color: '#64748b', marginTop: 10 },
  warn: { fontSize: 13, color: '#b45309', lineHeight: 18 },
  chipScroll: { marginBottom: 4 },
  chip: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginRight: 8,
    backgroundColor: '#fff',
  },
  chipOn: { backgroundColor: BRAND_BLUE, borderColor: BRAND_BLUE },
  chipText: { fontSize: 13, color: '#334155', fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slotBtn: {
    width: (SCREEN_W - 32 - 32 - 8) / 2,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    backgroundColor: '#fafbff',
  },
  slotBtnOn: { borderColor: BRAND_BLUE, backgroundColor: '#eef2ff' },
  slotText: { fontSize: 14, fontWeight: '600', color: '#334155' },
  slotTextOn: { color: BRAND_BLUE },
  slotIst: { fontSize: 11, color: '#64748b', marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0f172a',
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  phoneRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 12 },
  codeBtn: {
    borderWidth: 1,
    borderColor: BRAND_BLUE,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  codeBtnText: { fontWeight: '700', color: BRAND_BLUE, fontSize: 14 },
  phoneInput: { flex: 1, marginBottom: 0 },
  previewCard: {
    backgroundColor: '#f0fdf4',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    marginTop: 4,
  },
  previewLabel: { fontSize: 11, fontWeight: '700', color: '#166534', marginBottom: 6, textTransform: 'uppercase' },
  previewBody: { fontSize: 14, lineHeight: 20, color: '#14532d' },
  privacyLine: { fontSize: 12, color: '#64748b', textAlign: 'center', paddingHorizontal: 20, marginTop: 4 },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
    alignItems: 'center',
  },
  btnOutline: {
    borderWidth: 1.5,
    borderColor: BRAND_BLUE,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  btnOutlineText: { color: BRAND_BLUE, fontWeight: '700', fontSize: 14 },
  btnPrimary: { backgroundColor: BRAND_RED, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20 },
  btnPrimaryFlex: { flex: 1, alignItems: 'center' },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.45 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, maxHeight: '70%' },
  modalTitle: { fontWeight: '800', fontSize: 16, marginBottom: 8, color: BRAND_BLUE },
  modalRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e2e8f0' },
  modalRowText: { fontSize: 14, color: '#0f172a' },
});
