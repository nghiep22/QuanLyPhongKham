import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiClient } from '../../shared/api/client';
import { colors, radii } from '../../shared/ui/theme';
import { authErrorMessage } from './auth-error-message';
import {
  firstChangePasswordValidationMessage,
  type ChangePasswordForm,
} from './change-password-validation';
import type { RootStackParamList } from './patient-auth';

const initialForm: ChangePasswordForm = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

type Props = NativeStackScreenProps<RootStackParamList, 'AccountSecurity'> & {
  onPasswordChanged: () => Promise<void>;
};

export function ChangePasswordScreen({ onPasswordChanged }: Props) {
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const validation = firstChangePasswordValidationMessage(form);
    if (validation) {
      setError(validation);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await apiClient.auth.changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      setForm(initialForm);
      setSubmitting(false);
      await onPasswordChanged();
    } catch (cause) {
      setError(authErrorMessage(cause, 'Không thể đổi mật khẩu lúc này. Vui lòng thử lại.'));
      setSubmitting(false);
    }
  };

  return <SafeAreaView edges={['bottom']} style={styles.screen}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.eyebrow}>BẢO MẬT TÀI KHOẢN</Text>
      <Text style={styles.heading}>Đổi mật khẩu</Text>
      <Text style={styles.body}>Sau khi đổi mật khẩu, tất cả phiên đăng nhập sẽ được thu hồi để bảo vệ tài khoản.</Text>

      <PasswordField label="Mật khẩu hiện tại" value={form.currentPassword}
        onChangeText={(currentPassword) => setForm((value) => ({ ...value, currentPassword }))} />
      <PasswordField label="Mật khẩu mới" value={form.newPassword}
        onChangeText={(newPassword) => setForm((value) => ({ ...value, newPassword }))} />
      <PasswordField label="Xác nhận mật khẩu mới" value={form.confirmPassword}
        onChangeText={(confirmPassword) => setForm((value) => ({ ...value, confirmPassword }))} />
      <Text style={styles.hint}>Tối thiểu 12 ký tự, gồm chữ hoa, chữ thường và số.</Text>

      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Pressable accessibilityRole="button" disabled={submitting}
        style={[styles.button, submitting && styles.buttonDisabled]} onPress={() => void submit()}>
        {submitting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Đổi mật khẩu</Text>}
      </Pressable>
    </ScrollView>
  </SafeAreaView>;
}

function PasswordField({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) {
  const [visible, setVisible] = useState(false);
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.inputRow}>
      <TextInput {...props} autoCapitalize="none" autoCorrect={false} secureTextEntry={!visible}
        style={styles.input} placeholderTextColor={colors.inkMuted} />
      <Pressable accessibilityRole="button" accessibilityLabel={visible ? `Ẩn ${label.toLocaleLowerCase('vi-VN')}` : `Hiện ${label.toLocaleLowerCase('vi-VN')}`}
        hitSlop={8} onPress={() => setVisible((value) => !value)}>
        <Text style={styles.visibility}>{visible ? 'Ẩn' : 'Hiện'}</Text>
      </Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  page: { flexGrow: 1, padding: 24, paddingBottom: 48 },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.4, marginTop: 8 },
  heading: { color: colors.ink, fontSize: 28, fontWeight: '900', marginTop: 7 },
  body: { color: colors.inkMuted, fontSize: 15, lineHeight: 23, marginBottom: 8, marginTop: 10 },
  field: { marginTop: 16 },
  label: { color: colors.ink, fontSize: 14, fontWeight: '800', marginBottom: 8 },
  inputRow: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border,
    borderRadius: radii.medium, borderWidth: 1, flexDirection: 'row', paddingRight: 14 },
  input: { color: colors.ink, flex: 1, fontSize: 16, minHeight: 52, paddingHorizontal: 14, paddingVertical: 12 },
  visibility: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  hint: { color: colors.inkMuted, fontSize: 12, lineHeight: 18, marginTop: 10 },
  error: { backgroundColor: colors.dangerSoft, borderRadius: radii.small, color: colors.danger,
    marginTop: 16, padding: 13 },
  button: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radii.medium,
    justifyContent: 'center', marginTop: 22, minHeight: 52, padding: 14 },
  buttonDisabled: { opacity: 0.65 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '900' },
});
