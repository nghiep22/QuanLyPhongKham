import { ApiClientError } from '@clinic/generated-api-client';
import type { BranchReference, PatientAccessData, PatientRelationship } from '@clinic/generated-api-types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../auth/patient-auth';
import { apiClient } from '../../shared/api/client';

const relationships: Array<[PatientRelationship, string]> = [
  ['SELF', 'Bản thân'], ['CHILD', 'Con'], ['SPOUSE', 'Vợ/chồng'],
  ['PARENT', 'Cha/mẹ'], ['GUARDIAN', 'Giám hộ'], ['OTHER', 'Khác'],
];
const statusLabels = {
  PENDING: 'Đang chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Đã từ chối',
  CANCELLED: 'Đã hủy', EXPIRED: 'Đã hết hạn',
} as const;

function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random % 4) + 8).toString(16);
  });
}

function message(error: unknown) {
  if (!(error instanceof ApiClientError)) return 'Không thể kết nối hệ thống. Vui lòng thử lại.';
  if (error.code === 'PATIENT_LINK_RATE_LIMITED') return 'Bạn đã gửi quá nhiều yêu cầu trong ngày.';
  if (error.code === 'IDEMPOTENCY_KEY_REUSED') return 'Nội dung đã thay đổi. Vui lòng gửi lại yêu cầu.';
  if (error.code === 'PATIENT_LINK_STATE_CONFLICT') return 'Yêu cầu đã được xử lý. Hãy tải lại danh sách.';
  if (error.code === 'FORBIDDEN') return 'Bạn không có quyền thực hiện thao tác này.';
  return error.message || 'Không thể xử lý yêu cầu.';
}

export function PatientAccessScreen(_props: NativeStackScreenProps<RootStackParamList, 'PatientProfiles'>) {
  const [data, setData] = useState<PatientAccessData | null>(null);
  const [branches, setBranches] = useState<BranchReference[]>([]);
  const [branchPublicId, setBranchPublicId] = useState('');
  const [patientCode, setPatientCode] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [relationshipType, setRelationshipType] = useState<PatientRelationship>('SELF');
  const [requestNote, setRequestNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const retry = useRef<{ payload: string; key: string } | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [access, references] = await Promise.all([
        apiClient.patientAccess.get(), apiClient.patientAccess.references(),
      ]);
      setData(access.data);
      setBranches(references.data.branches);
      setBranchPublicId((current) => current || references.data.branches[0]?.publicId || '');
    } catch (cause) {
      setError(message(cause));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    const parsedBirthDate = new Date(`${dateOfBirth}T00:00:00.000Z`);
    const validBirthDate = /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
      && !Number.isNaN(parsedBirthDate.valueOf())
      && parsedBirthDate.toISOString().slice(0, 10) === dateOfBirth
      && parsedBirthDate < new Date();
    if (!branchPublicId || patientCode.trim().length < 2 || !validBirthDate) {
      setError('Chọn chi nhánh, nhập mã bệnh nhân và ngày sinh theo YYYY-MM-DD.');
      return;
    }
    if (relationshipType !== 'SELF' && requestNote.trim().length < 3) {
      setError('Liên kết người thân cần ghi chú về giấy tờ sẽ dùng để xác minh.');
      return;
    }
    const body = {
      branchPublicId, patientCode: patientCode.trim().toUpperCase(), dateOfBirth,
      relationshipType, ...(requestNote.trim() ? { requestNote: requestNote.trim() } : {}),
    };
    const payload = JSON.stringify(body);
    if (!retry.current || retry.current.payload !== payload) retry.current = { payload, key: newIdempotencyKey() };
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await apiClient.patientAccess.requestLink(body, retry.current.key);
      retry.current = null;
      setPatientCode('');
      setDateOfBirth('');
      setRequestNote('');
      setSuccess('Đã tiếp nhận yêu cầu. Phòng khám sẽ chỉ duyệt sau khi đối chiếu giấy tờ.');
      await load(true);
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.code === 'IDEMPOTENCY_KEY_REUSED') retry.current = null;
      setError(message(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (requestId: string) => {
    setError(null);
    try {
      await apiClient.patientAccess.cancelRequest(requestId);
      await load(true);
    } catch (cause) { setError(message(cause)); }
  };

  const revoke = (linkId: string, displayName: string) => Alert.alert(
    'Thu hồi quyền truy cập',
    `Sau khi thu hồi, ${displayName} không thể đặt lịch cho hồ sơ này.`,
    [
      { text: 'Giữ lại', style: 'cancel' },
      { text: 'Thu hồi', style: 'destructive', onPress: () => void (async () => {
        setError(null);
        try {
          await apiClient.patientAccess.revokeLink(linkId, { reason: 'Người dùng chủ động thu hồi trên ứng dụng' });
          await load(true);
        } catch (cause) { setError(message(cause)); }
      })() },
    ],
  );

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator size="large" color="#167665" />
    <Text style={styles.muted}>Đang tải quyền truy cập…</Text></SafeAreaView>;

  return <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}>
      <Text style={styles.eyebrow}>HỒ SƠ ĐƯỢC ỦY QUYỀN</Text>
      <Text style={styles.heading}>Quản lý hồ sơ bệnh nhân</Text>
      <Text style={styles.muted}>Chỉ hồ sơ đã được phòng khám xác minh mới có thể dùng để đặt lịch.</Text>
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {success && <Text accessibilityRole="alert" style={styles.success}>{success}</Text>}

      <Text style={styles.sectionTitle}>Đang có quyền truy cập</Text>
      {data?.links.length ? data.links.map((link) => <View style={styles.card} key={link.publicId}>
        <View style={styles.cardHeading}><View>
          <Text style={styles.cardTitle}>{link.patient.fullName}</Text>
          <Text style={styles.muted}>{link.patient.code} · {link.patient.dateOfBirth}</Text>
        </View><Text style={styles.badge}>{relationships.find(([value]) => value === link.relationshipType)?.[1]}</Text></View>
        {link.accessKind === 'DELEGATED' && <Text style={styles.muted}>Người được cấp: {link.linkedUser.displayName}</Text>}
        {link.canRevoke && <Pressable onPress={() => revoke(link.publicId, link.linkedUser.displayName)}>
          <Text style={styles.dangerLink}>Thu hồi quyền truy cập</Text>
        </Pressable>}
      </View>) : <Text style={styles.empty}>Chưa có hồ sơ đã xác minh.</Text>}

      <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Yêu cầu liên kết hồ sơ có sẵn</Text>
        <Text style={styles.label}>Chi nhánh đối chiếu giấy tờ</Text>
        <View style={styles.wrap}>{branches.map((branch) => <Choice key={branch.publicId}
          label={branch.name} active={branch.publicId === branchPublicId}
          onPress={() => setBranchPublicId(branch.publicId)} />)}</View>
        <Field label="Mã bệnh nhân" value={patientCode} autoCapitalize="characters" onChangeText={setPatientCode} />
        <Field label="Ngày sinh (YYYY-MM-DD)" value={dateOfBirth} keyboardType="numbers-and-punctuation"
          onChangeText={setDateOfBirth} />
        <Text style={styles.label}>Quan hệ</Text>
        <View style={styles.wrap}>{relationships.map(([value, label]) => <Choice key={value} label={label}
          active={value === relationshipType} onPress={() => setRelationshipType(value)} />)}</View>
        <Field label="Ghi chú giấy tờ xác minh" value={requestNote} multiline onChangeText={setRequestNote} />
        <Pressable disabled={submitting} style={[styles.button, submitting && styles.disabled]} onPress={() => void submit()}>
          {submitting ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Gửi yêu cầu liên kết</Text>}
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>Lịch sử yêu cầu</Text>
      {data?.requests.length ? data.requests.map((item) => <View style={styles.card} key={item.publicId}>
        <View style={styles.cardHeading}>
          <Text style={styles.cardTitle}>{item.patientReference}</Text>
          <Text style={[styles.badge, item.status === 'REJECTED' && styles.badgeDanger]}>{statusLabels[item.status]}</Text>
        </View>
        <Text style={styles.muted}>{item.branch.name} · {relationships.find(([value]) => value === item.relationshipType)?.[1]}</Text>
        {item.decisionReason && <Text style={styles.reason}>Phản hồi: {item.decisionReason}</Text>}
        {item.status === 'PENDING' && <Pressable onPress={() => void cancel(item.publicId)}>
          <Text style={styles.dangerLink}>Hủy yêu cầu</Text>
        </Pressable>}
      </View>) : <Text style={styles.empty}>Chưa gửi yêu cầu nào.</Text>}
    </ScrollView>
  </SafeAreaView>;
}

function Field({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text>
    <TextInput style={styles.input} placeholderTextColor="#8a9a9f" {...props} /></View>;
}

function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable style={[styles.choice, active && styles.choiceActive]} onPress={onPress}>
    <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#f1f8f6', flex: 1 },
  center: { alignItems: 'center', backgroundColor: '#f1f8f6', flex: 1, gap: 12, justifyContent: 'center' },
  page: { padding: 20, paddingBottom: 50 },
  eyebrow: { color: '#15806f', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  heading: { color: '#183a45', fontSize: 27, fontWeight: '800', marginBottom: 8, marginTop: 8 },
  sectionTitle: { color: '#183a45', fontSize: 19, fontWeight: '800', marginBottom: 10, marginTop: 24 },
  muted: { color: '#60747a', fontSize: 14, lineHeight: 21 },
  empty: { color: '#70878b', fontStyle: 'italic', paddingVertical: 10 },
  card: { backgroundColor: 'white', borderColor: '#d7e6e2', borderRadius: 15, borderWidth: 1, marginBottom: 10, padding: 16 },
  formCard: { backgroundColor: '#e7f4f0', borderRadius: 18, marginTop: 16, padding: 18 },
  cardHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
  cardTitle: { color: '#183a45', fontSize: 16, fontWeight: '800' },
  badge: { backgroundColor: '#dff3ec', borderRadius: 20, color: '#17614f', fontSize: 11, fontWeight: '800', paddingHorizontal: 9, paddingVertical: 5 },
  badgeDanger: { backgroundColor: '#fff0ef', color: '#9d2c25' },
  field: { marginTop: 12 },
  label: { color: '#34535a', fontSize: 14, fontWeight: '700', marginBottom: 7, marginTop: 8 },
  input: { backgroundColor: 'white', borderColor: '#c7dcd7', borderRadius: 12, borderWidth: 1, color: '#183a45', fontSize: 16, minHeight: 50, paddingHorizontal: 14, paddingVertical: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { backgroundColor: 'white', borderColor: '#bcd4ce', borderRadius: 20, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 9 },
  choiceActive: { backgroundColor: '#167665', borderColor: '#167665' },
  choiceText: { color: '#34535a', fontWeight: '700' },
  choiceTextActive: { color: 'white' },
  button: { alignItems: 'center', backgroundColor: '#167665', borderRadius: 13, justifyContent: 'center', marginTop: 18, minHeight: 50, padding: 13 },
  buttonText: { color: 'white', fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.65 },
  dangerLink: { color: '#a73531', fontWeight: '700', marginTop: 12 },
  reason: { color: '#516a72', lineHeight: 20, marginTop: 8 },
  error: { backgroundColor: '#fff0ef', borderRadius: 10, color: '#9d2c25', marginTop: 14, padding: 12 },
  success: { backgroundColor: '#dff3ec', borderRadius: 10, color: '#17614f', marginTop: 14, padding: 12 },
});
