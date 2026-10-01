import { ApiClientError } from '@clinic/generated-api-client';
import type { MyEmergencyContacts, PatientEmergencyContact } from '@clinic/generated-api-types';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiClient } from '../../shared/api/client';

const blank = (): PatientEmergencyContact => ({ fullName: '', relationshipName: null, phone: '', isPrimary: false });

export function MyEmergencyContactsEditor({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<MyEmergencyContacts | null>(null);
  const [contacts, setContacts] = useState<PatientEmergencyContact[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = async () => {
    setBusy(true); setError(''); setNotice(''); setSnapshot(null); setContacts([]);
    try { const response = await apiClient.patients.myEmergencyContacts(patientId);
      setSnapshot(response.data); setContacts(response.data.contacts); }
    catch { setError('Không tải được liên hệ khẩn cấp. Kiểm tra quyền truy cập rồi thử lại.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, [patientId]);
  const edit = (index: number, update: Partial<PatientEmergencyContact>) =>
    setContacts((items) => items.map((item, position) => position === index ? { ...item, ...update } : item));
  const save = async () => {
    if (!snapshot) return;
    if (contacts.some((item) => item.fullName.trim().length < 2 || !/^[0-9+(). -]{7,20}$/.test(item.phone.trim()))
      || (contacts.length > 0 && contacts.filter((item) => item.isPrimary).length !== 1)) {
      setError('Nhập tên, số điện thoại hợp lệ và chọn đúng một liên hệ chính.'); return;
    }
    setBusy(true); setError(''); setNotice('');
    try { const response = await apiClient.patients.replaceMyEmergencyContacts(patientId,
      { contacts: contacts.map((item) => ({ ...item, fullName: item.fullName.trim(),
        relationshipName: item.relationshipName?.trim() || null, phone: item.phone.trim() })) }, snapshot.rowVersion);
      setSnapshot(response.data); setContacts(response.data.contacts); setNotice('Đã lưu liên hệ khẩn cấp.'); }
    catch (cause) { if (cause instanceof ApiClientError && cause.code === 'FORBIDDEN') {
      setSnapshot(null); setContacts([]); setError('Quyền truy cập hồ sơ đã thay đổi.');
    } else if (cause instanceof ApiClientError && cause.code === 'PATIENT_VERSION_CONFLICT') {
      setError('Hồ sơ đã thay đổi. Hãy tải lại trước khi sửa.');
    } else setError('Không lưu được liên hệ khẩn cấp. Vui lòng thử lại.'); }
    finally { setBusy(false); }
  };
  return <View style={styles.panel}>
    <Text style={styles.title}>Liên hệ khẩn cấp</Text>
    <Text style={styles.help}>Tối đa 5 người. Chọn một liên hệ chính.</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
    {contacts.map((contact, index) => <View style={styles.contact} key={index}>
      <Text style={styles.label}>Họ tên</Text><TextInput style={styles.input} value={contact.fullName} maxLength={200}
        onChangeText={(value) => edit(index, { fullName: value })} />
      <Text style={styles.label}>Quan hệ</Text><TextInput style={styles.input} value={contact.relationshipName ?? ''} maxLength={80}
        onChangeText={(value) => edit(index, { relationshipName: value })} />
      <Text style={styles.label}>Số điện thoại</Text><TextInput style={styles.input} value={contact.phone} maxLength={20}
        keyboardType="phone-pad" onChangeText={(value) => edit(index, { phone: value })} />
      <Pressable accessibilityRole="radio" accessibilityState={{ checked: contact.isPrimary }}
        onPress={() => setContacts((items) => items.map((item, position) => ({ ...item, isPrimary: position === index })))}>
        <Text style={styles.link}>{contact.isPrimary ? '●' : '○'} Liên hệ chính</Text>
      </Pressable>
      <Pressable onPress={() => setContacts((items) => {
        const remaining = items.filter((_, position) => position !== index);
        if (remaining.length && !remaining.some((item) => item.isPrimary)) remaining[0] = { ...remaining[0]!, isPrimary: true };
        return remaining;
      })}><Text style={styles.danger}>Xóa liên hệ</Text></Pressable>
    </View>)}
    <Pressable disabled={busy || contacts.length >= 5} onPress={() => setContacts((items) =>
      [...items, { ...blank(), isPrimary: items.length === 0 }])}>
      <Text style={styles.link}>+ Thêm liên hệ</Text>
    </Pressable>
    <Pressable style={styles.button} disabled={busy || !snapshot} onPress={() => void save()}>
      {busy ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Lưu thay đổi</Text>}
    </Pressable>
    <Pressable disabled={busy} onPress={() => void load()}><Text style={styles.link}>Tải lại thông tin</Text></Pressable>
    <Pressable onPress={onClose}><Text style={styles.link}>Đóng</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: '#e7f4f0', borderRadius: 18, marginTop: 16, padding: 18 },
  title: { color: '#183a45', fontSize: 19, fontWeight: '800' },
  help: { color: '#60747a', marginTop: 8 },
  contact: { backgroundColor: 'white', borderRadius: 12, marginTop: 12, padding: 12 },
  label: { color: '#34535a', fontWeight: '700', marginBottom: 5, marginTop: 8 },
  input: { borderColor: '#c7dcd7', borderRadius: 10, borderWidth: 1, color: '#183a45', minHeight: 44, paddingHorizontal: 10 },
  link: { color: '#167665', fontWeight: '700', marginTop: 12 },
  danger: { color: '#a73531', fontWeight: '700', marginTop: 12 },
  button: { alignItems: 'center', backgroundColor: '#167665', borderRadius: 12, marginTop: 15, padding: 14 },
  buttonText: { color: 'white', fontWeight: '800' },
  error: { color: '#9d2c25', marginTop: 10 },
  notice: { color: '#17614f', marginTop: 10 },
});
