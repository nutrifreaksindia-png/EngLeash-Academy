import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
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
} from '../../lib/callbackTimezone';
import type { ApplyCallbackNavParams } from '../../lib/applyNavigation';
import { api } from '../../api/client';

const BRAND_BLUE = '#1a237e';
const BRAND_RED = '#c41e3a';
const STEP_COUNT = 3;
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
  return `${interest}\nCall on ${datePart}, ${slotPart}.\n${name.trim()} · ${dialCode} ${phone.trim()}`;
}

function Arrow({ dir, disabled, onPress }: { dir: 'left' | 'right'; disabled?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.arrowHit, disabled && styles.arrowDisabled]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      accessibilityRole="button"
      accessibilityLabel={dir === 'left' ? 'Previous' : 'Next'}
    >
      <Text style={[styles.arrowGlyph, disabled && styles.arrowGlyphDisabled]}>{dir === 'left' ? '‹' : '›'}</Text>
    </TouchableOpacity>
  );
}

export default function CallbackBookingWizard({ params, onDone, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const editMode = !!params.editMode && !!params.enquiryId;
  const enquiryId = params.enquiryId;
  const courseId = Number(params.courseId);
  const courseName = String(params.courseName || 'Course');
  const batchIdNorm =
    params.batchId === null || params.batchId === undefined || params.batchId === ''
      ? null
      : Number(params.batchId);
  const batchLabel =
    params.batchLabel || (batchIdNorm != null ? `Batch ${batchIdNorm}` : undefined);
  const noOpenBatches = params.noOpenBatches === true || !batchLabel;

  const pagerRef = useRef<ScrollView>(null);
  const [step, setStep] = useState(0);
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

  const interestMessage = useMemo(
    () => buildInterestLine(courseName, batchLabel, noOpenBatches),
    [courseName, batchLabel, noOpenBatches],
  );

  const scheduleSummary = useMemo(() => {
    if (!callbackDate || !callbackSlot) return '';
    const slot = formatCallbackSlotRange(callbackSlot, callbackDate);
    return `${formatCallbackDateLong(callbackDate)} · ${slot.local}`;
  }, [callbackDate, callbackSlot]);

  const contactReady = useMemo(() => {
    const name = displayName.trim();
    const digits = phoneLocal.replace(/\D/g, '');
    return name.length >= 2 && digits.length >= 6 && digits.length <= 15 && !!callbackDate && !!callbackSlot;
  }, [displayName, phoneLocal, callbackDate, callbackSlot]);

  const scrollToStep = useCallback((index: number) => {
    const next = Math.max(0, Math.min(STEP_COUNT - 1, index));
    setStep(next);
    pagerRef.current?.scrollTo({ x: next * SCREEN_W, animated: true });
  }, []);

  const onPagerScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const i = Math.round(x / SCREEN_W);
    if (i !== step) setStep(i);
  }, [step]);

  const pickDate = useCallback(
    (ymd: string) => {
      setCallbackDate(ymd);
      setCallbackSlot('');
      setTimeout(() => scrollToStep(1), 120);
    },
    [scrollToStep],
  );

  const pickSlot = useCallback(
    (slotId: string) => {
      setCallbackSlot(slotId);
      setTimeout(() => scrollToStep(2), 120);
    },
    [scrollToStep],
  );

  const submit = useCallback(async () => {
    const name = displayName.trim();
    const digits = phoneLocal.replace(/\D/g, '');
    if (!contactReady) return;
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
      if (editMode && enquiryId) {
        await api.patch(`/payments/apply/enquiries/${enquiryId}`, {
          batch_id: batchIdNorm,
          display_name: name,
          phone_country_code: dialCode,
          phone_local: digits,
          callback_date: callbackDate,
          callback_slot: callbackSlot,
          note,
        });
      } else {
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
      }
      setSuccess(true);
    } catch (e: any) {
      Alert.alert(editMode ? 'Update failed' : 'Booking failed', e?.message || 'Try again');
    } finally {
      setSubmitting(false);
    }
  }, [
    contactReady,
    courseName,
    batchLabel,
    noOpenBatches,
    callbackDate,
    callbackSlot,
    displayName,
    dialCode,
    phoneLocal,
    editMode,
    enquiryId,
    batchIdNorm,
    courseId,
  ]);

  const onRightArrow = useCallback(() => {
    if (success) {
      onDone();
      return;
    }
    if (step === 0 && callbackDate) scrollToStep(1);
    else if (step === 1 && callbackSlot) scrollToStep(2);
  }, [success, step, callbackDate, callbackSlot, scrollToStep, onDone]);

  const onLeftArrow = useCallback(() => {
    if (success) {
      onDone();
      return;
    }
    if (step === 0) onCancel();
    else scrollToStep(step - 1);
  }, [success, step, scrollToStep, onCancel, onDone]);

  const rightEnabled = success || (step === 0 && !!callbackDate) || (step === 1 && !!callbackSlot);

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
        const e = params.initialEnquiry;
        if (editMode && e) {
          if (e.displayName) setDisplayName(e.displayName);
          if (e.phoneLocal) setPhoneLocal(e.phoneLocal);
          if (e.callbackDate) setCallbackDate(e.callbackDate);
          if (e.callbackSlot) setCallbackSlot(e.callbackSlot);
          const cc = String(e.phoneCountryCode || '').trim();
          if (cc.startsWith('+')) {
            const digits = cc.replace(/\D/g, '');
            const match = countries.find((co) => String(co.phonecode).replace(/\D/g, '') === digits);
            if (match) setCountryIso(match.isoCode);
          }
        } else {
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
        }
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
  }, [courseId, editMode, params.initialEnquiry]);

  useEffect(() => {
    if (!callbackSlot) return;
    if (!availableTimeSlots.some((slot) => slot.id === callbackSlot)) {
      setCallbackSlot('');
    }
  }, [availableTimeSlots, callbackSlot]);

  if (success) {
    return (
      <View style={[styles.page, { paddingBottom: insets.bottom }]}>
        <View style={styles.topHeader}>
          <Text style={styles.topTitle}>Book a call back — We&apos;ll reach you!</Text>
          <Text style={styles.messageLabel}>Your message is:</Text>
          <Text style={styles.interestLine}>{interestMessage}</Text>
        </View>
        <View style={styles.navRow}>
          <Arrow dir="left" onPress={onDone} />
          <View style={styles.dotsRow}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.dot, styles.dotDone]} />
            ))}
          </View>
          <Arrow dir="right" onPress={onDone} />
        </View>
        <View style={styles.successBody}>
          <Text style={styles.successMark}>✓</Text>
          <Text style={styles.successTitle}>{editMode ? 'Updated' : 'Booked'}</Text>
          <Text style={styles.successSub}>{scheduleSummary}</Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.page, { paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.topHeader}>
        <Text style={styles.topTitle}>Book a call back — We&apos;ll reach you!</Text>
        <Text style={styles.messageLabel}>Your message is:</Text>
        <Text style={styles.interestLine}>{interestMessage}</Text>
      </View>

      <View style={styles.navRow}>
        <Arrow dir="left" onPress={onLeftArrow} />
        <View style={styles.dotsRow}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotActive, i < step && styles.dotDone]} />
          ))}
        </View>
        {submitting && step === 2 ? (
          <View style={styles.arrowHit}>
            <ActivityIndicator color={BRAND_RED} size="small" />
          </View>
        ) : (
          <Arrow dir="right" disabled={!rightEnabled} onPress={onRightArrow} />
        )}
      </View>

      {metaLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      ) : (
        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onPagerScrollEnd}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          style={styles.pager}
        >
          {/* Day */}
          <View style={[styles.slide, { width: SCREEN_W }]}>
            <Text style={styles.slideTitle}>Call me on</Text>
            {dateOptions.length === 0 ? (
              <Text style={styles.empty}>No slots this week</Text>
            ) : (
              <ScrollView style={styles.listFill} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
                {dateOptions.map((ymd) => {
                  const on = callbackDate === ymd;
                  return (
                    <TouchableOpacity
                      key={ymd}
                      style={[styles.optionRow, on && styles.optionRowOn]}
                      onPress={() => pickDate(ymd)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.optionText, on && styles.optionTextOn]}>{formatCallbackDateChip(ymd)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>

          {/* Time */}
          <View style={[styles.slide, { width: SCREEN_W }]}>
            <Text style={styles.slideTitle}>Call me between</Text>
            {availableTimeSlots.length === 0 ? (
              <Text style={styles.empty}>Pick another day</Text>
            ) : (
              <ScrollView style={styles.listFill} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
                {availableTimeSlots.map((slot) => {
                  const range = formatCallbackSlotRange(slot.id, callbackDate);
                  const on = callbackSlot === slot.id;
                  return (
                    <TouchableOpacity
                      key={slot.id}
                      style={[styles.optionRow, on && styles.optionRowOn]}
                      onPress={() => pickSlot(slot.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.optionText, on && styles.optionTextOn]}>{range.local}</Text>
                      {range.ist ? <Text style={[styles.optionSub, on && styles.optionSubOn]}>{range.ist}</Text> : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>

          {/* Contact */}
          <View style={[styles.slide, { width: SCREEN_W }]}>
            <View style={styles.formFill}>
              <Text style={styles.slideTitle}>My name is</Text>
              <TextInput
                style={styles.field}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Name"
                placeholderTextColor="#94a3b8"
                autoCapitalize="words"
                returnKeyType="next"
              />
              <Text style={[styles.slideTitle, styles.slideTitleSpaced]}>My number is</Text>
              <View style={styles.phoneRow}>
                <TouchableOpacity style={styles.codeTap} onPress={() => setCountryModal(true)}>
                  <Text style={styles.codeTapText}>{dialCode}</Text>
                </TouchableOpacity>
                <TextInput
                  style={[styles.field, styles.phoneField]}
                  value={phoneLocal}
                  onChangeText={(t) => setPhoneLocal(t.replace(/[^\d\s-]/g, ''))}
                  placeholder="Mobile"
                  keyboardType="phone-pad"
                  placeholderTextColor="#94a3b8"
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (contactReady && !submitting) void submit();
                  }}
                />
              </View>
            </View>
            <View style={styles.finishBlock}>
              {scheduleSummary ? <Text style={styles.scheduleAboveBtn}>{scheduleSummary}</Text> : null}
              <TouchableOpacity
                style={[styles.finishBtn, (!contactReady || submitting) && styles.finishBtnDisabled]}
                onPress={() => void submit()}
                disabled={!contactReady || submitting}
                activeOpacity={0.85}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.finishBtnText}>{editMode ? 'Update call back' : 'Book call back'}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      )}

      <Modal visible={countryModal} animationType="fade" transparent onRequestClose={() => setCountryModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setCountryModal(false)}>
          <View style={styles.modalSheet}>
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
                  <Text style={styles.modalRowText}>{`+${c.phonecode}`}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f5f5f5' },
  topHeader: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  topTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: BRAND_BLUE,
    lineHeight: 24,
  },
  messageLabel: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '700',
    color: '#64748b',
  },
  interestLine: {
    marginTop: 6,
    fontSize: 15,
    lineHeight: 22,
    color: '#334155',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
    minHeight: 48,
  },
  arrowHit: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowDisabled: { opacity: 0.25 },
  arrowGlyph: { fontSize: 36, fontWeight: '300', color: BRAND_BLUE, lineHeight: 40 },
  arrowGlyphDisabled: { color: '#cbd5e1' },
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#cbd5e1' },
  dotActive: { backgroundColor: BRAND_RED, width: 10, height: 10, borderRadius: 5 },
  dotDone: { backgroundColor: BRAND_BLUE },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  pager: { flex: 1 },
  slide: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
  slideTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: BRAND_BLUE,
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  slideTitleSpaced: {
    marginTop: 8,
    marginBottom: 10,
  },
  listFill: { flex: 1 },
  listContent: { paddingBottom: 24, gap: 10 },
  optionRow: {
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  optionRowOn: {
    backgroundColor: BRAND_BLUE,
    borderColor: BRAND_BLUE,
  },
  optionText: { fontSize: 17, fontWeight: '600', color: '#1e293b' },
  optionTextOn: { color: '#fff' },
  optionSub: { fontSize: 12, color: '#64748b', marginTop: 4 },
  optionSubOn: { color: '#e0e7ff' },
  empty: { fontSize: 15, color: '#94a3b8', marginTop: 8 },
  formFill: { flex: 1, gap: 14 },
  field: {
    borderBottomWidth: 2,
    borderBottomColor: '#cbd5e1',
    paddingVertical: 14,
    fontSize: 20,
    fontWeight: '600',
    color: '#0f172a',
  },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  codeTap: { paddingVertical: 14, paddingRight: 4, borderBottomWidth: 2, borderBottomColor: BRAND_BLUE },
  codeTapText: { fontSize: 20, fontWeight: '700', color: BRAND_BLUE },
  phoneField: { flex: 1 },
  finishBlock: {
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
  },
  scheduleAboveBtn: {
    fontSize: 15,
    fontWeight: '600',
    color: BRAND_BLUE,
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 21,
  },
  finishBtn: {
    backgroundColor: BRAND_RED,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  finishBtnDisabled: { opacity: 0.45 },
  finishBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  successBody: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  successMark: { fontSize: 56, color: '#166534', marginBottom: 12 },
  successTitle: { fontSize: 32, fontWeight: '800', color: BRAND_BLUE },
  successSub: { fontSize: 16, color: '#64748b', marginTop: 8, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '50%' },
  modalRow: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e2e8f0' },
  modalRowText: { fontSize: 17, fontWeight: '600', color: '#0f172a' },
});
