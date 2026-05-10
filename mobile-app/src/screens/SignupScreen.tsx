import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { City, Country, State } from 'country-state-city';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { useAuth } from '../context/AuthContext';
import {
  navigateLandingResumeCourseAfterAuth,
  navigatePurchaseSummaryAfterAuth,
  normalizeResumeCourseAuthParams,
  purchaseSummaryParamsFromRoute,
} from '../navigation/resumeCourseAfterAuth';

const BRAND_BLUE = '#1a237e';
const BRAND_RED = '#c41e3a';
const POLICY_URL = 'https://engleashacademy.com/policies/';

const ALL_COUNTRIES = Country.getAllCountries().sort((a, b) => a.name.localeCompare(b.name));
const DEFAULT_COUNTRY_ISO = ALL_COUNTRIES.find((c) => c.isoCode === 'IN')?.isoCode || ALL_COUNTRIES[0]?.isoCode || '';

export default function SignupScreen({ navigation, route }: any) {
  const { signup } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showBirthDatePicker, setShowBirthDatePicker] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [showSelectModal, setShowSelectModal] = useState(false);
  const [selectTitle, setSelectTitle] = useState('');
  const [selectOptions, setSelectOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [selectOnPick, setSelectOnPick] = useState<((value: string) => void) | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmPasswordFocused, setConfirmPasswordFocused] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    mobileNumber: '',
    gender: 'Other',
    birthDate: '',
    addressLine1: '',
    addressLine2: '',
    cityDistrict: '',
    stateProvince: '',
    country: '',
    countryCode: '',
    countryIso: DEFAULT_COUNTRY_ISO,
    stateIso: '',
    occupation: 'Student',
    policiesAgreed: false,
  });

  const states = useMemo(
    () => State.getStatesOfCountry(form.countryIso).sort((a, b) => a.name.localeCompare(b.name)),
    [form.countryIso]
  );
  const cities = useMemo(() => {
    if (form.stateIso) {
      return City.getCitiesOfState(form.countryIso, form.stateIso).sort((a, b) => a.name.localeCompare(b.name));
    }
    return City.getCitiesOfCountry(form.countryIso).sort((a, b) => a.name.localeCompare(b.name));
  }, [form.countryIso, form.stateIso]);

  const submit = async () => {
    const selectedCountry = ALL_COUNTRIES.find((c) => c.isoCode === form.countryIso);
    const selectedState = states.find((s) => s.isoCode === form.stateIso);
    const payload = {
      ...form,
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      mobileNumber: form.mobileNumber.trim(),
      addressLine1: form.addressLine1.trim(),
      addressLine2: form.addressLine2.trim(),
      occupation: form.occupation.trim(),
      country: selectedCountry?.name || form.country || '',
      countryCode: form.countryCode || `+${selectedCountry?.phonecode || ''}`,
      stateProvince: selectedState?.name || form.stateProvince || '',
    };
    if (!payload.name || !payload.email || !payload.password || !payload.confirmPassword) {
      Alert.alert('Required', 'Please fill name, email and password');
      return;
    }
    if (!passwordChecks.minLength || !passwordChecks.uppercase || !passwordChecks.number || !passwordChecks.symbol) {
      Alert.alert('Weak password', 'Please satisfy all password rules');
      return;
    }
    if (payload.password !== payload.confirmPassword) {
      Alert.alert('Password mismatch', 'Password and confirm password must match');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(payload.email)) {
      Alert.alert('Invalid email', 'Please enter a valid email address');
      return;
    }
    if (!/^\d{10}$/.test(payload.mobileNumber.replace(/\D/g, ''))) {
      Alert.alert('Invalid mobile', 'Please enter a valid 10 digit mobile number');
      return;
    }
    if (!payload.policiesAgreed) {
      Alert.alert('Required', 'Please agree to policies');
      return;
    }
    setLoading(true);
    try {
      await signup(payload);
      Alert.alert('Welcome', 'Your account was created successfully.', [
        {
          text: 'OK',
          onPress: () => {
            const tabNav = navigation.getParent?.()?.getParent?.() ?? navigation.getParent?.();
            const purchaseP = purchaseSummaryParamsFromRoute(route?.params);
            if (navigatePurchaseSummaryAfterAuth(tabNav, purchaseP)) return;
            const landingResume = normalizeResumeCourseAuthParams(route?.params);
            if (navigateLandingResumeCourseAfterAuth(tabNav, landingResume)) return;
            if (navigation?.canGoBack?.()) {
              navigation.goBack();
            } else {
              navigation?.navigate?.('AccountMain');
            }
          },
        },
      ]);
    } catch (e: any) {
      Alert.alert('Signup failed', e?.message || 'Could not sign up');
    } finally {
      setLoading(false);
    }
  };

  const set = (k: string, v: any) => setForm((prev) => ({ ...prev, [k]: v }));
  const birthDateText = useMemo(() => {
    if (!form.birthDate) return 'Select birth date';
    const dt = new Date(`${form.birthDate}T00:00:00`);
    return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }, [form.birthDate]);
  const birthDateValue = form.birthDate ? new Date(`${form.birthDate}T00:00:00`) : new Date('2000-01-01T00:00:00');
  const passwordChecks = useMemo(() => {
    const v = form.password || '';
    return {
      minLength: v.length >= 8,
      uppercase: /[A-Z]/.test(v),
      number: /[0-9]/.test(v),
      symbol: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?`~]/.test(v),
    };
  }, [form.password]);
  const passwordsMatch = useMemo(
    () => (form.confirmPassword.length > 0 ? form.password === form.confirmPassword : false),
    [form.password, form.confirmPassword]
  );

  const setCountry = (countryIso: string) => {
    const selectedCountry = ALL_COUNTRIES.find((c) => c.isoCode === countryIso);
    const nextStates = State.getStatesOfCountry(countryIso);
    const defaultState = nextStates.find((s) => s.name === 'Tamil Nadu') || nextStates[0] || null;
    const nextCities = defaultState
      ? City.getCitiesOfState(countryIso, defaultState.isoCode)
      : City.getCitiesOfCountry(countryIso);
    const defaultCity = nextCities.find((c) => c.name === 'Madurai') || nextCities[0] || null;
    setForm((prev) => ({
      ...prev,
      countryIso,
      country: selectedCountry?.name || '',
      countryCode: `+${selectedCountry?.phonecode || ''}`,
      stateIso: defaultState?.isoCode || '',
      stateProvince: defaultState?.name || '',
      cityDistrict: defaultCity?.name || '',
    }));
  };

  const setState = (stateIso: string) => {
    const selectedState = states.find((s) => s.isoCode === stateIso);
    const nextCities = stateIso ? City.getCitiesOfState(form.countryIso, stateIso) : City.getCitiesOfCountry(form.countryIso);
    const defaultCity = nextCities[0] || null;
    setForm((prev) => ({
      ...prev,
      stateIso,
      stateProvince: selectedState?.name || '',
      cityDistrict: defaultCity?.name || '',
    }));
  };

  function openSelect(
    title: string,
    options: Array<{ label: string; value: string }>,
    onPick: (value: string) => void
  ) {
    setSelectTitle(title);
    setSelectOptions(options);
    setSelectOnPick(() => onPick);
    setShowSelectModal(true);
  }

  React.useEffect(() => {
    if (!form.countryIso && DEFAULT_COUNTRY_ISO) {
      setCountry(DEFAULT_COUNTRY_ISO);
    } else if (form.countryIso && !form.countryCode) {
      setCountry(form.countryIso);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.pageRoot}>
      <ScreenPageTitle title="Sign up" />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.subhead}>Create your student account</Text>

      <Text style={styles.label}>Name <Text style={styles.required}>*</Text></Text>
      <TextInput style={styles.input} placeholder="Enter full name" value={form.name} onChangeText={(v) => set('name', v)} />

      <Text style={styles.label}>Email <Text style={styles.required}>*</Text></Text>
      <TextInput style={styles.input} placeholder="Enter email" value={form.email} onChangeText={(v) => set('email', v)} autoCapitalize="none" keyboardType="email-address" />

      <Text style={styles.label}>Password <Text style={styles.required}>*</Text></Text>
      <View style={styles.passwordWrap}>
        <TextInput
          style={[styles.input, styles.passwordInput]}
          placeholder="Create a password"
          value={form.password}
          onChangeText={(v) => set('password', v)}
          onFocus={() => setPasswordFocused(true)}
          onBlur={() => setPasswordFocused(false)}
          secureTextEntry={!showPassword}
        />
        <TouchableOpacity style={styles.passwordEye} onPress={() => setShowPassword((p) => !p)}>
          <Text style={styles.passwordEyeText}>{showPassword ? 'Hide' : 'View'}</Text>
        </TouchableOpacity>
      </View>
      {passwordFocused ? (
        <>
          <Text style={[styles.passwordRule, passwordChecks.minLength ? styles.passOk : styles.passBad]}>Minimum 8 characters</Text>
          <Text style={[styles.passwordRule, passwordChecks.uppercase ? styles.passOk : styles.passBad]}>At least one capital letter (A-Z)</Text>
          <Text style={[styles.passwordRule, passwordChecks.number ? styles.passOk : styles.passBad]}>At least one number (0-9)</Text>
          <Text style={[styles.passwordRule, passwordChecks.symbol ? styles.passOk : styles.passBad]}>
            At least one symbol (! @ # $ % ^ & * ( ) _ + - = [ ] {'{'} {'}'} ; : ' " \ | , . &lt; &gt; / ? ` ~)
          </Text>
        </>
      ) : null}

      <Text style={styles.label}>Confirm Password <Text style={styles.required}>*</Text></Text>
      <View style={styles.passwordWrap}>
        <TextInput
          style={[styles.input, styles.passwordInput]}
          placeholder="Confirm password"
          value={form.confirmPassword}
          onChangeText={(v) => set('confirmPassword', v)}
          onFocus={() => setConfirmPasswordFocused(true)}
          onBlur={() => setConfirmPasswordFocused(false)}
          secureTextEntry={!showConfirmPassword}
        />
        <TouchableOpacity style={styles.passwordEye} onPress={() => setShowConfirmPassword((p) => !p)}>
          <Text style={styles.passwordEyeText}>{showConfirmPassword ? 'Hide' : 'View'}</Text>
        </TouchableOpacity>
      </View>
      {confirmPasswordFocused && form.confirmPassword.length > 0 ? (
        <Text style={[styles.passwordRule, passwordsMatch ? styles.passOk : styles.passBad]}>
          {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
        </Text>
      ) : null}

      <View style={styles.row}>
        <View style={styles.codeWrap}>
          <Text style={styles.label}>Code <Text style={styles.required}>*</Text></Text>
          <TouchableOpacity style={[styles.input, styles.codeInput]} onPress={() => setShowCodeModal(true)}>
            <Text style={styles.codeText}>{form.countryCode || '+000'}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.mobileWrap}>
          <Text style={styles.label}>Mobile Number <Text style={styles.required}>*</Text></Text>
          <TextInput
            style={styles.input}
            placeholder="10 digit number"
            value={form.mobileNumber}
            onChangeText={(v) => set('mobileNumber', v.replace(/[^\d]/g, '').slice(0, 10))}
            keyboardType="phone-pad"
            maxLength={10}
          />
        </View>
      </View>

      <Text style={styles.label}>Gender <Text style={styles.required}>*</Text></Text>
      <View style={styles.pickerContainer}>
        <TouchableOpacity
          style={styles.selectField}
          onPress={() => openSelect('Select Gender', [
            { label: 'Male', value: 'Male' },
            { label: 'Female', value: 'Female' },
            { label: 'Other', value: 'Other' },
          ], (v) => set('gender', v))}
        >
          <Text style={styles.selectFieldText}>{form.gender || 'Select gender'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Birth Date <Text style={styles.required}>*</Text></Text>
      <TouchableOpacity style={[styles.input, styles.birthDateInput]} onPress={() => setShowBirthDatePicker(true)}>
        <Text style={styles.dateText}>{birthDateText}</Text>
      </TouchableOpacity>
      {showBirthDatePicker ? (
        <DateTimePicker
          value={birthDateValue}
          mode="date"
          maximumDate={new Date()}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, selected) => {
            if (Platform.OS !== 'ios') setShowBirthDatePicker(false);
            if (selected) {
              set('birthDate', selected.toISOString().slice(0, 10));
            }
            if (event.type === 'dismissed') {
              setShowBirthDatePicker(false);
            }
          }}
        />
      ) : null}

      <Text style={styles.label}>Address Line 1 <Text style={styles.required}>*</Text></Text>
      <TextInput style={styles.input} placeholder="House/Street" value={form.addressLine1} onChangeText={(v) => set('addressLine1', v)} />

      <Text style={styles.label}>Address Line 2</Text>
      <TextInput style={styles.input} placeholder="Area/Landmark (optional)" value={form.addressLine2} onChangeText={(v) => set('addressLine2', v)} />

      <Text style={styles.label}>Country <Text style={styles.required}>*</Text></Text>
      <View style={styles.pickerContainer}>
        <TouchableOpacity
          style={styles.selectField}
          onPress={() => openSelect(
            'Select Country',
            ALL_COUNTRIES.map((country) => ({ label: country.name, value: country.isoCode })),
            (v) => setCountry(v)
          )}
        >
          <Text style={styles.selectFieldText}>{form.country || 'Select country'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>State / Province <Text style={styles.required}>*</Text></Text>
      <View style={styles.pickerContainer}>
        <TouchableOpacity
          style={styles.selectField}
          onPress={() => openSelect(
            'Select State / Province',
            states.length
              ? states.map((state) => ({ label: state.name, value: state.isoCode }))
              : [{ label: 'No states available', value: '' }],
            (v) => setState(v)
          )}
        >
          <Text style={styles.selectFieldText}>{form.stateProvince || 'Select state / province'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>City / District <Text style={styles.required}>*</Text></Text>
      <View style={styles.pickerContainer}>
        <TouchableOpacity
          style={styles.selectField}
          onPress={() => openSelect(
            'Select City / District',
            cities.length
              ? cities.map((city) => ({ label: city.name, value: city.name }))
              : [{ label: 'No city data', value: '' }],
            (v) => set('cityDistrict', v)
          )}
        >
          <Text style={styles.selectFieldText}>{form.cityDistrict || 'Select city / district'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Occupation <Text style={styles.required}>*</Text></Text>
      <View style={styles.pickerContainer}>
        <TouchableOpacity
          style={styles.selectField}
          onPress={() => openSelect('Select Occupation', [
            { label: 'Student', value: 'Student' },
            { label: 'Working Professional', value: 'Working Professional' },
            { label: 'Homemaker', value: 'Homemaker' },
            { label: 'Business', value: 'Business' },
            { label: 'Freelancer', value: 'Freelancer' },
            { label: 'Other', value: 'Other' },
          ], (v) => set('occupation', v))}
        >
          <Text style={styles.selectFieldText}>{form.occupation || 'Select occupation'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>I agree to the policies</Text>
        <Switch value={form.policiesAgreed} onValueChange={(v) => set('policiesAgreed', v)} />
      </View>
      <TouchableOpacity onPress={() => Linking.openURL(POLICY_URL)}>
        <Text style={styles.policyLink}>Read our policies</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.submitBtn} onPress={submit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Create account</Text>}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.loginLinkBelow}
        onPress={() => {
          const p = route?.params || {};
          const purch = purchaseSummaryParamsFromRoute(p);
          if (purch != null) {
            navigation.navigate('Login', {
              redirectAfterSignup: 'purchase',
              courseId: p.courseId,
              courseName: p.courseName,
              courseFeeInr: (p as any).courseFeeInr,
              courseDiscountInr: (p as any).courseDiscountInr,
            });
            return;
          }
          const resume = normalizeResumeCourseAuthParams(p);
          navigation.navigate(
            'Login',
            resume != null
              ? {
                  redirectAfterSignup: resume.redirectAfterSignup,
                  courseId: resume.courseId,
                  courseName: resume.courseName,
                }
              : {}
          );
        }}
      >
        <Text style={styles.loginLinkBelowText}>Already have an account? Sign in</Text>
      </TouchableOpacity>

      <Modal visible={showCodeModal} animationType="slide" transparent onRequestClose={() => setShowCodeModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Select Country Code</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {ALL_COUNTRIES.map((country) => (
                <TouchableOpacity
                  key={`code-${country.isoCode}`}
                  style={styles.modalRow}
                  onPress={() => {
                    setCountry(country.isoCode);
                    setShowCodeModal(false);
                  }}
                >
                  <Text style={styles.modalRowText}>{`+${country.phonecode} - ${country.name}`}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={[styles.submitBtn, { marginTop: 10 }]} onPress={() => setShowCodeModal(false)}>
              <Text style={styles.submitText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal visible={showSelectModal} animationType="slide" transparent onRequestClose={() => setShowSelectModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{selectTitle}</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {selectOptions.map((opt) => (
                <TouchableOpacity
                  key={`${selectTitle}-${opt.value}`}
                  style={styles.modalRow}
                  onPress={() => {
                    selectOnPick?.(opt.value);
                    setShowSelectModal(false);
                  }}
                >
                  <Text style={styles.modalRowText}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={[styles.submitBtn, { marginTop: 10 }]} onPress={() => setShowSelectModal(false)}>
              <Text style={styles.submitText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 30 },
  subhead: { fontSize: 15, fontWeight: '600', color: '#444', marginBottom: 16 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  codeWrap: { width: 96 },
  mobileWrap: { flex: 1 },
  label: { fontSize: 13, color: '#374151', marginBottom: 4, fontWeight: '600' },
  required: { color: '#dc2626' },
  pickerContainer: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fff',
    marginBottom: 10,
    height: 48,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  selectField: {
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  selectFieldText: {
    color: '#111827',
    fontSize: 16,
  },
  dateText: { color: '#222', fontSize: 16, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 48,
    backgroundColor: '#fff',
    marginBottom: 10,
  },
  birthDateInput: {
    justifyContent: 'center',
  },
  codeInput: {
    width: 96,
    justifyContent: 'center',
    alignItems: 'center',
  },
  codeText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  passwordWrap: {
    position: 'relative',
    marginBottom: 4,
  },
  passwordInput: {
    paddingRight: 70,
    marginBottom: 0,
  },
  passwordEye: {
    position: 'absolute',
    right: 10,
    top: 12,
  },
  passwordEyeText: {
    color: BRAND_BLUE,
    fontWeight: '700',
  },
  passwordRule: {
    fontSize: 12,
    marginBottom: 2,
  },
  passOk: {
    color: '#15803d',
  },
  passBad: {
    color: '#dc2626',
  },
  switchRow: {
    marginTop: 4,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchLabel: { fontSize: 14, color: '#333' },
  policyLink: { color: BRAND_BLUE, textDecorationLine: 'underline', marginBottom: 14, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
    color: BRAND_BLUE,
  },
  modalRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f7',
  },
  modalRowText: {
    color: '#1f2937',
    fontSize: 14,
  },
  submitBtn: {
    backgroundColor: BRAND_RED,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitText: { color: '#fff', fontWeight: '700' },
  loginLinkBelow: { marginTop: 16, alignItems: 'center', paddingBottom: 8 },
  loginLinkBelowText: { color: BRAND_BLUE, fontWeight: '700', fontSize: 15 },
});
