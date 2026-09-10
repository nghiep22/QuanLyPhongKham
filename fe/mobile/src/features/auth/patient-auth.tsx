import { ApiClientError } from '@clinic/generated-api-client';
import type { AuthResponse, AuthenticatedUser, PatientRegistrationRequest } from '@clinic/generated-api-types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { apiClient } from '../../shared/api/client';
import { firstValidationMessage, type PatientRegistrationForm } from './registration-validation';

export type RootStackParamList = {
  Welcome: undefined;
  Login: { identifier?: string } | undefined;
  Register: undefined;
  PatientHome: undefined;
  Booking: undefined;
};

type SessionCallback = (response: AuthResponse) => Promise<void>;

function errorMessage(error: unknown, fallback: string) {
  if (!(error instanceof ApiClientError)) return fallback;
  if (error.code === 'INVALID_CREDENTIALS') return 'Email, số điện thoại hoặc mật khẩu không đúng.';
  if (error.code === 'ACCOUNT_LOCKED') return 'Tài khoản đang tạm khóa. Vui lòng thử lại sau.';
  if (error.code === 'PATIENT_ACCOUNT_REQUIRED') return 'Ứng dụng này chỉ dành cho tài khoản bệnh nhân.';
  if (error.code === 'IDEMPOTENCY_KEY_REUSED') return 'Yêu cầu đăng ký đã thay đổi. Vui lòng gửi lại.';
  if (error.code === 'INVALID_OR_EXPIRED_OTP') return 'Mã OTP không đúng, đã hết hạn hoặc đã được sử dụng.';
  return fallback;
}

function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random % 4) + 8;
    return value.toString(16);
  });
}

export function WelcomeScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Welcome'>) {
  return <SafeAreaView style={styles.screen}>
    <View style={styles.hero}>
      <Text style={styles.eyebrow}>PHÒNG KHÁM TƯ NHÂN</Text>
      <Text style={styles.title}>Chăm sóc sức khỏe, chủ động từng lịch hẹn.</Text>
      <Text style={styles.body}>Đăng nhập hoặc tạo tài khoản bệnh nhân đã xác minh để sử dụng dịch vụ trực tuyến.</Text>
      <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('Login')}>
        <Text style={styles.primaryButtonText}>Đăng nhập</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate('Register')}>
        <Text style={styles.secondaryButtonText}>Đăng ký tài khoản bệnh nhân</Text>
      </Pressable>
    </View>
  </SafeAreaView>;
}

export function LoginScreen({ navigation, route, onAuthenticated }:
  NativeStackScreenProps<RootStackParamList, 'Login'> & { onAuthenticated: SessionCallback }) {
  const [identifier, setIdentifier] = useState(route.params?.identifier ?? '');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (identifier.trim().length < 3 || password.length < 8) {
      setError('Nhập email/số điện thoại và mật khẩu hợp lệ.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiClient.auth.login({ identifier: identifier.trim(), password, clientType: 'mobile' });
      await onAuthenticated(response);
      setPassword('');
    } catch (cause) {
      setError(errorMessage(cause, 'Không thể đăng nhập lúc này.'));
    } finally {
      setSubmitting(false);
    }
  };

  return <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.formPage} keyboardShouldPersistTaps="handled">
      <Text style={styles.eyebrow}>CỔNG BỆNH NHÂN</Text>
      <Text style={styles.heading}>Đăng nhập</Text>
      <Field label="Email hoặc số điện thoại" value={identifier} onChangeText={setIdentifier}
        autoCapitalize="none" keyboardType="email-address" />
      <Field label="Mật khẩu" value={password} onChangeText={setPassword} secureTextEntry />
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <SubmitButton label="Đăng nhập" loading={submitting} onPress={submit} />
      <Pressable onPress={() => navigation.navigate('Register')}>
        <Text style={styles.link}>Chưa có tài khoản? Đăng ký ngay</Text>
      </Pressable>
    </ScrollView>
  </SafeAreaView>;
}

const initialRegistration: PatientRegistrationForm = {
  contactChannel: 'EMAIL',
  contact: '',
  password: '',
  confirmPassword: '',
  fullName: '',
  dateOfBirth: '',
  gender: 'OTHER',
};

export function RegistrationScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Register'>) {
  const [form, setForm] = useState(initialRegistration);
  const [step, setStep] = useState<'DETAILS' | 'OTP' | 'DONE'>('DETAILS');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [patientCode, setPatientCode] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setTimeout(() => setResendSeconds((value) => value - 1), 1_000);
    return () => clearTimeout(timer);
  }, [resendSeconds]);

  const requestOtp = async (forceNewKey = false) => {
    const validation = firstValidationMessage(form);
    if (validation) {
      setError(validation);
      return;
    }
    if (forceNewKey || !idempotencyKey.current) idempotencyKey.current = createIdempotencyKey();
    const body: PatientRegistrationRequest = {
      contactChannel: form.contactChannel,
      contact: form.contact.trim(),
      password: form.password,
      fullName: form.fullName.trim(),
      dateOfBirth: form.dateOfBirth,
      gender: form.gender,
    };
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiClient.auth.requestPatientRegistration(body, idempotencyKey.current);
      setChallengeId(response.data.challengeId);
      setResendSeconds(response.data.resendAfter);
      setStep('OTP');
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.code === 'IDEMPOTENCY_KEY_REUSED') {
        idempotencyKey.current = null;
      }
      setError(errorMessage(cause, 'Không thể gửi mã OTP lúc này.'));
    } finally {
      setSubmitting(false);
    }
  };

  const verifyOtp = async () => {
    if (!challengeId || !/^\d{6}$/.test(otp)) {
      setError('OTP phải gồm đúng 6 chữ số.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiClient.auth.verifyPatientRegistration({ challengeId, otp });
      setPatientCode(response.data.patient.code);
      setForm((value) => ({ ...value, password: '', confirmPassword: '' }));
      setOtp('');
      setStep('DONE');
    } catch (cause) {
      setError(errorMessage(cause, 'Không thể xác minh OTP lúc này.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (step === 'DONE') {
    return <SafeAreaView style={styles.screen}><View style={styles.successCard}>
      <Text style={styles.successIcon}>✓</Text>
      <Text style={styles.heading}>Đăng ký thành công</Text>
      <Text style={styles.body}>Hồ sơ bệnh nhân {patientCode} đã được tạo và xác minh.</Text>
      <SubmitButton label="Đăng nhập" loading={false}
        onPress={() => navigation.replace('Login', { identifier: form.contact.trim() })} />
    </View></SafeAreaView>;
  }

  if (step === 'OTP') {
    return <SafeAreaView style={styles.screen}><View style={styles.formPage}>
      <Text style={styles.eyebrow}>XÁC MINH LIÊN HỆ</Text>
      <Text style={styles.heading}>Nhập mã OTP</Text>
      <Text style={styles.body}>Nếu thông tin có thể đăng ký, mã 6 số đã được gửi đến kênh liên hệ của bạn.</Text>
      <Field label="Mã OTP" value={otp} onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad" maxLength={6} />
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <SubmitButton label="Xác minh và tạo tài khoản" loading={submitting} onPress={verifyOtp} />
      <Pressable disabled={submitting || resendSeconds > 0} onPress={() => void requestOtp(true)}>
        <Text style={[styles.link, resendSeconds > 0 && styles.disabledText]}>
          {resendSeconds > 0 ? `Gửi lại sau ${resendSeconds}s` : 'Gửi lại mã OTP'}
        </Text>
      </Pressable>
    </View></SafeAreaView>;
  }

  return <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.formPage} keyboardShouldPersistTaps="handled">
      <Text style={styles.eyebrow}>TẠO TÀI KHOẢN</Text>
      <Text style={styles.heading}>Thông tin bệnh nhân</Text>
      <Field label="Họ và tên" value={form.fullName}
        onChangeText={(fullName) => setForm((value) => ({ ...value, fullName }))} />
      <Field label="Ngày sinh (YYYY-MM-DD)" value={form.dateOfBirth}
        onChangeText={(dateOfBirth) => setForm((value) => ({ ...value, dateOfBirth }))}
        keyboardType="numbers-and-punctuation" />
      <Text style={styles.label}>Giới tính</Text>
      <View style={styles.choiceRow}>
        {([['MALE', 'Nam'], ['FEMALE', 'Nữ'], ['OTHER', 'Khác']] as const).map(([value, label]) =>
          <Choice key={value} active={form.gender === value} label={label}
            onPress={() => setForm((current) => ({ ...current, gender: value }))} />)}
      </View>
      <Text style={styles.label}>Nhận OTP qua</Text>
      <View style={styles.choiceRow}>
        <Choice active={form.contactChannel === 'EMAIL'} label="Email"
          onPress={() => setForm((value) => ({ ...value, contactChannel: 'EMAIL', contact: '' }))} />
        <Choice active={form.contactChannel === 'SMS'} label="SMS"
          onPress={() => setForm((value) => ({ ...value, contactChannel: 'SMS', contact: '' }))} />
      </View>
      <Field label={form.contactChannel === 'EMAIL' ? 'Email' : 'Số điện thoại'} value={form.contact}
        onChangeText={(contact) => setForm((value) => ({ ...value, contact }))}
        autoCapitalize="none" keyboardType={form.contactChannel === 'EMAIL' ? 'email-address' : 'phone-pad'} />
      <Field label="Mật khẩu" value={form.password} secureTextEntry
        onChangeText={(password) => setForm((value) => ({ ...value, password }))} />
      <Field label="Xác nhận mật khẩu" value={form.confirmPassword} secureTextEntry
        onChangeText={(confirmPassword) => setForm((value) => ({ ...value, confirmPassword }))} />
      <Text style={styles.hint}>Tối thiểu 12 ký tự, gồm chữ hoa, chữ thường và số.</Text>
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <SubmitButton label="Gửi mã OTP" loading={submitting} onPress={() => requestOtp()} />
      <Pressable onPress={() => navigation.navigate('Login')}><Text style={styles.link}>Đã có tài khoản? Đăng nhập</Text></Pressable>
    </ScrollView>
  </SafeAreaView>;
}

export function PatientHomeScreen({ user, onLogout, navigation }: {
  user: AuthenticatedUser;
  onLogout: () => Promise<void>;
  navigation: NativeStackScreenProps<RootStackParamList, 'PatientHome'>['navigation'];
}) {
  const [loggingOut, setLoggingOut] = useState(false);
  return <SafeAreaView style={styles.screen}><View style={styles.hero}>
    <Text style={styles.eyebrow}>TÀI KHOẢN ĐÃ XÁC MINH</Text>
    <Text style={styles.heading}>Xin chào, {user.displayName}</Text>
    <Text style={styles.body}>Bạn đã đăng nhập bằng tài khoản bệnh nhân và có thể tiếp tục đến luồng đặt lịch.</Text>
    <SubmitButton label="Đặt lịch khám" loading={false} onPress={() => navigation.navigate('Booking')} />
    <Pressable disabled={loggingOut} onPress={async () => {
      setLoggingOut(true);
      await onLogout();
      setLoggingOut(false);
    }}><Text style={styles.link}>{loggingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}</Text></Pressable>
  </View></SafeAreaView>;
}

function Field({ label, ...inputProps }: React.ComponentProps<typeof TextInput> & { label: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text>
    <TextInput style={styles.input} placeholderTextColor="#8a9a9f" {...inputProps} />
  </View>;
}

function Choice({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return <Pressable style={[styles.choice, active && styles.choiceActive]} onPress={onPress}>
    <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
  </Pressable>;
}

function SubmitButton({ label, loading, onPress }: { label: string; loading: boolean; onPress: () => void | Promise<void> }) {
  return <Pressable disabled={loading} style={[styles.primaryButton, loading && styles.disabledButton]} onPress={onPress}>
    {loading ? <ActivityIndicator color="white" /> : <Text style={styles.primaryButtonText}>{label}</Text>}
  </Pressable>;
}

export const patientAuthStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f1f8f6' },
});

const styles = StyleSheet.create({
  screen: patientAuthStyles.screen,
  hero: { flex: 1, justifyContent: 'center', padding: 28 },
  formPage: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  successCard: { backgroundColor: 'white', borderRadius: 22, margin: 24, padding: 28, alignItems: 'center' },
  successIcon: { color: '#167665', fontSize: 48, fontWeight: '900' },
  eyebrow: { color: '#15806f', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: '#183a45', fontSize: 34, fontWeight: '800', lineHeight: 42, marginTop: 12 },
  heading: { color: '#183a45', fontSize: 27, fontWeight: '800', marginBottom: 12, marginTop: 8 },
  body: { color: '#60747a', fontSize: 16, lineHeight: 24, marginBottom: 12 },
  field: { marginTop: 14 },
  label: { color: '#34535a', fontSize: 14, fontWeight: '700', marginBottom: 7, marginTop: 10 },
  input: { backgroundColor: 'white', borderColor: '#c7dcd7', borderRadius: 12, borderWidth: 1,
    color: '#183a45', fontSize: 16, minHeight: 50, paddingHorizontal: 14 },
  choiceRow: { flexDirection: 'row', gap: 8 },
  choice: { backgroundColor: 'white', borderColor: '#c7dcd7', borderRadius: 20, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10 },
  choiceActive: { backgroundColor: '#167665', borderColor: '#167665' },
  choiceText: { color: '#34535a', fontWeight: '700' },
  choiceTextActive: { color: 'white' },
  primaryButton: { alignItems: 'center', backgroundColor: '#167665', borderRadius: 14, marginTop: 22, minHeight: 52, justifyContent: 'center', padding: 14 },
  primaryButtonText: { color: 'white', fontSize: 16, fontWeight: '800' },
  secondaryButton: { alignItems: 'center', borderColor: '#167665', borderRadius: 14, borderWidth: 1, marginTop: 12, padding: 14 },
  secondaryButtonText: { color: '#167665', fontSize: 16, fontWeight: '800' },
  disabledButton: { opacity: 0.65 },
  disabledText: { color: '#9aabaa' },
  error: { backgroundColor: '#fff0ef', borderRadius: 10, color: '#9d2c25', marginTop: 14, padding: 12 },
  hint: { color: '#70878b', fontSize: 13, marginTop: 8 },
  link: { color: '#167665', fontSize: 15, fontWeight: '700', marginTop: 18, textAlign: 'center' },
});
