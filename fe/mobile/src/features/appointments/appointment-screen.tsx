import { ApiClientError } from '@clinic/generated-api-client';
import type { Appointment, AvailabilitySlot, PatientAccessLink, PublicBranch, PublicService } from '@clinic/generated-api-types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../auth/patient-auth';
import { apiClient } from '../../shared/api/client';

const statusLabels: Record<Appointment['status'], string> = {
  PENDING: 'Chờ xác nhận', CONFIRMED: 'Đã xác nhận', CHECKED_IN: 'Đã check-in', IN_PROGRESS: 'Đang khám',
  COMPLETED: 'Hoàn tất', CANCELLED: 'Đã hủy', NO_SHOW: 'Không đến', EXPIRED: 'Hết giữ chỗ',
};
function key() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16); return (character === 'x' ? random : (random % 4) + 8).toString(16);
  });
}
function localDate(offset = 0) {
  const value = new Date(); value.setDate(value.getDate() + offset);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
function message(error: unknown) {
  if (!(error instanceof ApiClientError)) return 'Không thể kết nối hệ thống. Vui lòng thử lại.';
  const messages: Record<string, string> = {
    SLOT_CONFLICT: 'Khung giờ vừa được người khác giữ. Hãy chọn giờ khác.',
    BOOKING_POLICY_CONFLICT: 'Đã ngoài thời hạn cho phép đặt, đổi hoặc hủy lịch.',
    AVAILABILITY_CHANGED: 'Bác sĩ hoặc dịch vụ không còn nhận lịch này.',
    IDEMPOTENCY_KEY_REUSED: 'Nội dung yêu cầu đã thay đổi. Vui lòng thử lại.',
    APPOINTMENT_STATE_CONFLICT: 'Trạng thái lịch hẹn vừa thay đổi. Hãy tải lại.',
    FORBIDDEN: 'Bạn không còn quyền đặt lịch cho hồ sơ này.',
  };
  return messages[error.code] ?? error.message;
}
function money(value: string) { return `${Number(value).toLocaleString('vi-VN')} ₫`; }

export function AppointmentScreen(_props: NativeStackScreenProps<RootStackParamList, 'Booking'>) {
  const [profiles, setProfiles] = useState<PatientAccessLink[]>([]);
  const [branches, setBranches] = useState<PublicBranch[]>([]);
  const [services, setServices] = useState<PublicService[]>([]);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [profileId, setProfileId] = useState(''); const [branchId, setBranchId] = useState('');
  const [serviceId, setServiceId] = useState(''); const [date, setDate] = useState(localDate(1));
  const [complaint, setComplaint] = useState(''); const [rescheduling, setRescheduling] = useState<Appointment | null>(null);
  const [loading, setLoading] = useState(true); const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false); const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const retry = useRef<{ payload: string; key: string } | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [access, branchResponse, appointmentResponse] = await Promise.all([
        apiClient.patientAccess.get(), apiClient.publicCatalog.branches(), apiClient.appointments.list(),
      ]);
      const allowed = access.data.links.filter((item) => item.bookingAllowed);
      setProfiles(allowed); setBranches(branchResponse.data); setAppointments(appointmentResponse.data);
      setProfileId((current) => current || allowed[0]?.patient.publicId || '');
      setBranchId((current) => current || branchResponse.data[0]?.publicId || '');
    } catch (cause) { setError(message(cause)); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!branchId) return;
    let active = true;
    setServices([]); setSlots([]);
    void apiClient.publicCatalog.services({ branchPublicId: branchId }).then((response) => {
      if (!active) return;
      setServices(response.data);
      setServiceId((current) => response.data.some((item) => item.publicId === current)
        ? current : response.data[0]?.publicId || '');
    }).catch((cause) => { if (active) setError(message(cause)); });
    return () => { active = false; };
  }, [branchId]);

  const findSlots = async () => {
    if (!branchId || !serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Chọn chi nhánh, dịch vụ và nhập ngày theo YYYY-MM-DD.'); return;
    }
    setSearching(true); setError(null); setNotice(null);
    try {
      const response = await apiClient.publicCatalog.availability({ branchPublicId: branchId, servicePublicId: serviceId,
        fromDate: date, toDate: date });
      setSlots(response.data);
    } catch (cause) { setError(message(cause)); }
    finally { setSearching(false); }
  };

  const chooseSlot = async (slot: AvailabilitySlot) => {
    if (!profileId && !rescheduling) { setError('Chọn hồ sơ bệnh nhân trước khi đặt lịch.'); return; }
    const body = rescheduling
      ? { newSlotPublicId: slot.publicId, newServicePublicId: serviceId, reason: 'Bệnh nhân chủ động đổi lịch trên ứng dụng' }
      : { patientPublicId: profileId, slotPublicId: slot.publicId, servicePublicId: serviceId,
        ...(complaint.trim() ? { chiefComplaint: complaint.trim() } : {}) };
    const payload = JSON.stringify(body);
    if (!retry.current || retry.current.payload !== payload) retry.current = { payload, key: key() };
    setSubmitting(true); setError(null);
    try {
      if (rescheduling) await apiClient.appointments.reschedule(rescheduling.publicId, body as {
        newSlotPublicId: string; newServicePublicId: string; reason: string }, retry.current.key);
      else await apiClient.appointments.book(body as {
        patientPublicId: string; slotPublicId: string; servicePublicId: string; chiefComplaint?: string }, retry.current.key);
      retry.current = null; setSlots([]); setComplaint(''); setRescheduling(null);
      setNotice(rescheduling ? 'Đã chuyển lịch sang khung giờ mới.' : 'Đã giữ chỗ. Phòng khám sẽ xác nhận trước khi hết hạn.');
      await load(true);
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.code === 'IDEMPOTENCY_KEY_REUSED') retry.current = null;
      setError(message(cause));
    } finally { setSubmitting(false); }
  };

  const cancel = (item: Appointment) => Alert.alert('Hủy lịch hẹn', `${item.code} · ${item.service.name}`, [
    { text: 'Giữ lịch', style: 'cancel' }, { text: 'Hủy lịch', style: 'destructive', onPress: () => void (async () => {
      try { await apiClient.appointments.cancel(item.publicId, { reason: 'Bệnh nhân chủ động hủy trên ứng dụng' }); await load(true); }
      catch (cause) { setError(message(cause)); }
    })() },
  ]);

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator color="#167665" size="large" />
    <Text style={styles.muted}>Đang tải lịch khám…</Text></SafeAreaView>;

  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled"
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}>
    <Text style={styles.eyebrow}>ĐẶT LỊCH TRỰC TUYẾN</Text><Text style={styles.heading}>Chọn khung giờ phù hợp</Text>
    <Text style={styles.muted}>Slot hiển thị theo giờ địa phương của chi nhánh và được giữ an toàn khi bạn xác nhận.</Text>
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {notice && <Text accessibilityRole="alert" style={styles.success}>{notice}</Text>}
    {rescheduling && <View style={styles.banner}><Text style={styles.cardTitle}>Đang đổi lịch {rescheduling.code}</Text>
      <Pressable onPress={() => { setRescheduling(null); setSlots([]); }}><Text style={styles.link}>Thoát</Text></Pressable></View>}

    {!rescheduling && <><Text style={styles.label}>Hồ sơ đi khám</Text><View style={styles.wrap}>{profiles.map((item) =>
      <Chip key={item.patient.publicId} label={`${item.patient.fullName} · ${item.patient.code}`}
        active={profileId === item.patient.publicId} onPress={() => setProfileId(item.patient.publicId)} />)}</View>
      {!profiles.length && <Text style={styles.empty}>Chưa có hồ sơ được phép đặt lịch.</Text>}</>}
    <Text style={styles.label}>Chi nhánh</Text><View style={styles.wrap}>{branches.map((item) =>
      <Chip key={item.publicId} label={item.name} active={branchId === item.publicId} onPress={() => setBranchId(item.publicId)} />)}</View>
    <Text style={styles.label}>Dịch vụ</Text><View style={styles.wrap}>{services.map((item) =>
      <Chip key={item.publicId} label={`${item.name} · ${money(item.price.amount)}`} active={serviceId === item.publicId}
        onPress={() => { setServiceId(item.publicId); setSlots([]); }} />)}</View>
    <Text style={styles.label}>Ngày khám</Text><TextInput style={styles.input} value={date} onChangeText={setDate}
      keyboardType="numbers-and-punctuation" placeholder="YYYY-MM-DD" />
    {!rescheduling && <><Text style={styles.label}>Lý do khám (không bắt buộc)</Text><TextInput style={[styles.input, styles.multiline]}
      value={complaint} onChangeText={setComplaint} multiline maxLength={1000} /></>}
    <Pressable disabled={searching} style={[styles.button, searching && styles.disabled]} onPress={() => void findSlots()}>
      {searching ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Tìm khung giờ trống</Text>}
    </Pressable>

    <View style={styles.slotList}>{slots.map((item) => <View key={item.publicId} style={styles.slotCard}>
      <View><Text style={styles.cardTitle}>{item.startTimeLocal} – {item.endTimeLocal}</Text>
        <Text style={styles.muted}>{item.doctor.name} · {item.room.name}</Text></View>
      <Pressable disabled={submitting} style={styles.slotButton} onPress={() => void chooseSlot(item)}>
        <Text style={styles.buttonText}>{rescheduling ? 'Chuyển lịch' : 'Giữ chỗ'}</Text></Pressable>
    </View>)}</View>
    {slots.length === 0 && !searching && <Text style={styles.empty}>Tìm lịch để xem các khung giờ đang trống.</Text>}

    <Text style={styles.sectionTitle}>Lịch của bạn</Text>
    {appointments.length ? appointments.map((item) => <View style={styles.appointmentCard} key={item.publicId}>
      <View style={styles.row}><Text style={styles.cardTitle}>{item.service.name}</Text><Text style={styles.badge}>{statusLabels[item.status]}</Text></View>
      <Text style={styles.date}>{item.serviceDateLocal} · {item.startTimeLocal} – {item.endTimeLocal}</Text>
      <Text style={styles.muted}>{item.doctor.fullName} · {item.branch.name} · {item.roomName}</Text>
      {item.holdExpiresAtUtc && <Text style={styles.warning}>Giữ chỗ đến {new Date(item.holdExpiresAtUtc).toLocaleString('vi-VN')}</Text>}
      {(['PENDING', 'CONFIRMED'] as Appointment['status'][]).includes(item.status) && <View style={styles.actions}>
        <Pressable style={styles.secondary} onPress={() => { setRescheduling(item); setBranchId(item.branch.publicId);
          setServiceId(item.service.publicId); setDate(item.serviceDateLocal); setSlots([]); }}><Text style={styles.secondaryText}>Đổi lịch</Text></Pressable>
        <Pressable style={styles.danger} onPress={() => cancel(item)}><Text style={styles.dangerText}>Hủy lịch</Text></Pressable>
      </View>}
    </View>) : <Text style={styles.empty}>Bạn chưa có lịch hẹn.</Text>}
  </ScrollView></SafeAreaView>;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#f1f8f6', flex: 1 }, center: { alignItems: 'center', backgroundColor: '#f1f8f6', flex: 1, gap: 12, justifyContent: 'center' },
  page: { padding: 20, paddingBottom: 54 }, eyebrow: { color: '#15806f', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  heading: { color: '#183a45', fontSize: 27, fontWeight: '800', marginBottom: 8, marginTop: 8 },
  sectionTitle: { color: '#183a45', fontSize: 21, fontWeight: '800', marginBottom: 12, marginTop: 30 },
  label: { color: '#34535a', fontSize: 14, fontWeight: '700', marginBottom: 8, marginTop: 18 },
  muted: { color: '#60747a', fontSize: 14, lineHeight: 21 }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: 'white', borderColor: '#bfd5cf', borderRadius: 20, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 9 },
  chipActive: { backgroundColor: '#167665', borderColor: '#167665' }, chipText: { color: '#34535a', fontWeight: '700' }, chipTextActive: { color: 'white' },
  input: { backgroundColor: 'white', borderColor: '#c7dcd7', borderRadius: 12, borderWidth: 1, color: '#183a45', fontSize: 16, minHeight: 50, paddingHorizontal: 14, paddingVertical: 12 },
  multiline: { minHeight: 82, textAlignVertical: 'top' }, button: { alignItems: 'center', backgroundColor: '#167665', borderRadius: 13, justifyContent: 'center', marginTop: 18, minHeight: 50, padding: 13 },
  buttonText: { color: 'white', fontWeight: '800' }, disabled: { opacity: 0.6 }, slotList: { gap: 10, marginTop: 18 },
  slotCard: { alignItems: 'center', backgroundColor: 'white', borderColor: '#d7e6e2', borderRadius: 14, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 15 },
  slotButton: { backgroundColor: '#167665', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11 },
  appointmentCard: { backgroundColor: 'white', borderColor: '#d7e6e2', borderRadius: 15, borderWidth: 1, marginBottom: 11, padding: 16 },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: 10, justifyContent: 'space-between' }, cardTitle: { color: '#183a45', fontSize: 16, fontWeight: '800' },
  date: { color: '#17614f', fontWeight: '800', marginBottom: 5, marginTop: 8 }, badge: { backgroundColor: '#dff3ec', borderRadius: 20, color: '#17614f', fontSize: 11, fontWeight: '800', paddingHorizontal: 9, paddingVertical: 5 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 }, secondary: { backgroundColor: '#e7f4f0', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  secondaryText: { color: '#167665', fontWeight: '800' }, danger: { backgroundColor: '#fff0ef', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 }, dangerText: { color: '#a73531', fontWeight: '800' },
  warning: { color: '#8a5c12', marginTop: 8 }, empty: { color: '#70878b', fontStyle: 'italic', paddingVertical: 12 },
  error: { backgroundColor: '#fff0ef', borderRadius: 10, color: '#9d2c25', marginTop: 14, padding: 12 },
  success: { backgroundColor: '#dff3ec', borderRadius: 10, color: '#17614f', marginTop: 14, padding: 12 },
  banner: { alignItems: 'center', backgroundColor: '#fff6df', borderRadius: 12, flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, padding: 14 },
  link: { color: '#167665', fontWeight: '800' },
});
