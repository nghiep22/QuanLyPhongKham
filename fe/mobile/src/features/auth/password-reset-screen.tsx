import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiClient } from '../../shared/api/client';
import { authErrorMessage } from './auth-error-message';
import type { RootStackParamList } from './patient-auth';

export function ForgotPasswordScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'ForgotPassword'>) {
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const submit = async () => {
    if (identifier.trim().length < 3) { setError('Nhập email, số điện thoại hoặc tên đăng nhập.'); return; }
    setBusy(true); setError('');
    try {
      await apiClient.auth.requestPasswordReset({ identifier: identifier.trim() });
      setSent(true);
    } catch (cause) { setError(authErrorMessage(cause, 'Không thể gửi yêu cầu lúc này.')); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>Quên mật khẩu</Text>
    <Text style={styles.body}>Nhập kênh liên hệ đã đăng ký để nhận hướng dẫn đặt lại mật khẩu.</Text>
    <TextInput style={styles.input} value={identifier} onChangeText={setIdentifier}
      autoCapitalize="none" keyboardType="email-address" placeholder="Email, số điện thoại hoặc tên đăng nhập" />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {sent && <Text accessibilityRole="alert" style={styles.success}>
      Nếu tài khoản tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi đến kênh liên hệ đã đăng ký.</Text>}
    <Pressable style={styles.button} disabled={busy} onPress={() => void submit()}>
      {busy ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Gửi yêu cầu</Text>}
    </Pressable>
    <Pressable onPress={() => navigation.navigate('ResetPassword')}><Text style={styles.link}>Đã có mã đặt lại? Nhập mã</Text></Pressable>
  </ScrollView></SafeAreaView>;
}

export function ResetPasswordScreen({ navigation, route, onReset, authenticated }:
  NativeStackScreenProps<RootStackParamList, 'ResetPassword'> & {
    onReset: () => Promise<void>; authenticated: boolean
  }) {
  const [token, setToken] = useState(route.params?.token ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (!token.trim()) { setError('Nhập mã đặt lại mật khẩu.'); return; }
    if (password.length < 12 || password.length > 200 || !/[a-z]/.test(password)
      || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Mật khẩu mới cần 12–200 ký tự, gồm chữ hoa, chữ thường và chữ số.'); return;
    }
    if (password !== confirm) { setError('Mật khẩu xác nhận không khớp.'); return; }
    setBusy(true); setError('');
    try {
      await apiClient.auth.resetPassword({ token: token.trim(), newPassword: password });
      setPassword(''); setConfirm(''); setToken('');
      await onReset();
      if (!authenticated) navigation.replace('Login', { notice: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập.' });
    } catch (cause) { setError(authErrorMessage(cause, 'Không thể đặt lại mật khẩu. Mã có thể đã hết hạn.')); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>Đặt lại mật khẩu</Text>
    <Text style={styles.body}>Mã đặt lại chỉ dùng một lần và có thời hạn.</Text>
    <TextInput style={styles.input} value={token} onChangeText={setToken} autoCapitalize="none"
      placeholder="Mã đặt lại" />
    <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry
      placeholder="Mật khẩu mới" />
    <TextInput style={styles.input} value={confirm} onChangeText={setConfirm} secureTextEntry
      placeholder="Xác nhận mật khẩu mới" />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Pressable style={styles.button} disabled={busy} onPress={() => void submit()}>
      {busy ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Đặt lại mật khẩu</Text>}
    </Pressable>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#f1f8f6', flex: 1 },
  page: { padding: 22, paddingTop: 30, gap: 16 },
  title: { color: '#183a45', fontSize: 27, fontWeight: '800' },
  body: { color: '#60747a', fontSize: 15, lineHeight: 23 },
  input: { backgroundColor: 'white', borderColor: '#c7dcd7', borderRadius: 12, borderWidth: 1,
    color: '#183a45', fontSize: 16, minHeight: 50, paddingHorizontal: 14 },
  button: { alignItems: 'center', backgroundColor: '#167665', borderRadius: 13, justifyContent: 'center', minHeight: 50 },
  buttonText: { color: 'white', fontWeight: '800' },
  link: { color: '#167665', fontWeight: '700', marginTop: 6 },
  error: { backgroundColor: '#fff0ef', color: '#9d2c25', padding: 12 },
  success: { backgroundColor: '#dff3ec', color: '#17614f', padding: 12 },
});
