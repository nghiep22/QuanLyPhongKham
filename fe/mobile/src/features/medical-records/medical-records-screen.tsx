import { ApiClientError } from '@clinic/generated-api-client';
import type { PatientClinicalRecord, PatientClinicalRecordSummary } from '@clinic/generated-api-types';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiClient } from '../../shared/api/client';
import { cardShadow, colors, radii } from '../../shared/ui/theme';

function message(error: unknown) {
  if (!(error instanceof ApiClientError)) return 'Không thể kết nối hệ thống. Vui lòng thử lại.';
  if (error.status === 403) return 'Quyền truy cập hồ sơ đã thay đổi. Hãy kiểm tra lại hồ sơ được ủy quyền.';
  if (error.status === 404) return 'Hồ sơ này chưa được công bố hoặc không còn khả dụng.';
  return error.message;
}

function dateTime(value: string) {
  return new Date(value).toLocaleString('vi-VN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh',
  });
}

function dayMonth(value: string) {
  const parts = new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: 'numeric', timeZone: 'Asia/Ho_Chi_Minh',
  }).formatToParts(new Date(value));
  return { day: parts.find((part) => part.type === 'day')?.value ?? '--',
    month: parts.find((part) => part.type === 'month')?.value ?? '--' };
}

export function MedicalRecordsScreen() {
  const [patientId, setPatientId] = useState('');
  const [recordId, setRecordId] = useState('');
  const access = useQuery({
    queryKey: ['mobile', 'patient-access'],
    queryFn: async () => (await apiClient.patientAccess.get()).data.links,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (!access.data) return;
    if (!access.data.some((link) => link.patient.publicId === patientId)) {
      setPatientId(access.data[0]?.patient.publicId ?? '');
      setRecordId('');
    }
  }, [access.data, patientId]);
  const history = useQuery({
    queryKey: ['mobile', 'clinical-records', patientId],
    queryFn: async () => (await apiClient.patientClinicalRecords.list(patientId)).data,
    enabled: Boolean(patientId),
    staleTime: 30_000,
  });
  const detail = useQuery({
    queryKey: ['mobile', 'clinical-record', patientId, recordId],
    queryFn: async () => (await apiClient.patientClinicalRecords.get(patientId, recordId)).data,
    enabled: Boolean(patientId && recordId),
    staleTime: 30_000,
  });
  const refreshing = access.isRefetching || history.isRefetching || detail.isRefetching;
  const refresh = () => void Promise.all([access.refetch(), patientId ? history.refetch() : Promise.resolve(),
    recordId ? detail.refetch() : Promise.resolve()]);

  return <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.page}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
      <Text style={styles.eyebrow}>HỒ SƠ SỨC KHỎE</Text>
      <Text style={styles.heading}>Lịch sử khám</Text>
      <Text style={styles.lead}>Chỉ hiển thị hồ sơ đã được bác sĩ ký và chủ động công bố.</Text>

      {access.isLoading ? <Loading label="Đang tải hồ sơ được ủy quyền…" />
        : access.error ? <ErrorCard error={access.error} retry={() => void access.refetch()} />
          : access.data?.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.profileRow}>
              {access.data.map((link) => <Pressable key={link.publicId}
                style={[styles.profileChoice, patientId === link.patient.publicId && styles.profileChoiceActive]}
                onPress={() => { setPatientId(link.patient.publicId); setRecordId(''); }}>
                <Text style={[styles.profileName, patientId === link.patient.publicId && styles.profileNameActive]}>
                  {link.patient.fullName}</Text>
                <Text style={[styles.profileCode, patientId === link.patient.publicId && styles.profileNameActive]}>
                  {link.patient.code}</Text>
              </Pressable>)}
            </ScrollView>
            : <Empty title="Chưa có hồ sơ được xác minh" body="Liên kết hồ sơ của bạn hoặc người thân trước khi xem lịch sử khám." />}

      {patientId && !recordId && <HistoryList loading={history.isLoading} error={history.error}
        records={history.data ?? []} retry={() => void history.refetch()} onSelect={setRecordId} />}
      {patientId && recordId && <>
        <Pressable accessibilityRole="button" style={styles.backButton} onPress={() => setRecordId('')}>
          <Text style={styles.backText}>‹ Quay lại lịch sử</Text>
        </Pressable>
        {detail.isLoading ? <Loading label="Đang tải hồ sơ khám…" />
          : detail.error ? <ErrorCard error={detail.error} retry={() => void detail.refetch()} />
            : detail.data && <RecordDetail record={detail.data} />}
      </>}
    </ScrollView>
  </SafeAreaView>;
}

function HistoryList({ loading, error, records, retry, onSelect }: {
  loading: boolean; error: unknown; records: PatientClinicalRecordSummary[]; retry: () => void;
  onSelect: (id: string) => void;
}) {
  if (loading) return <Loading label="Đang tải lịch sử khám…" />;
  if (error) return <ErrorCard error={error} retry={retry} />;
  if (!records.length) return <Empty title="Chưa có hồ sơ đã công bố"
    body="Hồ sơ sẽ xuất hiện tại đây sau khi bác sĩ hoàn tất, ký và công bố." />;
  return <View style={styles.list}>
    <Text style={styles.sectionTitle}>{records.length} lượt khám đã công bố</Text>
    {records.map((record) => <Pressable accessibilityRole="button" key={record.publicId}
      style={({ pressed }) => [styles.recordCard, pressed && styles.pressed]} onPress={() => onSelect(record.publicId)}>
      <View style={styles.recordTop}><View style={styles.recordDate}><Text style={styles.recordDay}>
        {dayMonth(record.arrivedAtUtc).day}</Text><Text style={styles.recordMonth}>
        THÁNG {dayMonth(record.arrivedAtUtc).month}</Text></View>
        <View style={styles.flexOne}><Text style={styles.recordTitle}>
          {record.primaryDiagnosis?.name ?? record.chiefComplaint ?? 'Lượt khám đã hoàn tất'}</Text>
          <Text style={styles.recordMeta}>{record.doctor.fullName}</Text>
          <Text style={styles.recordMeta}>{record.branch.name} · {record.code}</Text></View>
        <Text style={styles.arrow}>›</Text></View>
      <Text style={styles.releaseNote}>Công bố {dateTime(record.releasedAtUtc)}</Text>
    </Pressable>)}
  </View>;
}

function RecordDetail({ record }: { record: PatientClinicalRecord }) {
  return <View style={styles.detail}>
    <View style={styles.heroCard}><Text style={styles.heroLabel}>HỒ SƠ ĐÃ KÝ</Text>
      <Text style={styles.heroTitle}>{record.primaryDiagnosis?.name ?? 'Kết quả lượt khám'}</Text>
      <Text style={styles.heroMeta}>{dateTime(record.arrivedAtUtc)} · {record.branch.name}</Text>
      <Text style={styles.heroMeta}>{record.doctor.fullName} · {record.code}</Text></View>
    <Section title="Nội dung khám">
      <Fact label="Lý do khám" value={record.chiefComplaint} />
      <Fact label="Bệnh sử" value={record.historyOfPresentIllness} />
      <Fact label="Khám thực thể" value={record.physicalExamination} />
      <Fact label="Nhận định" value={record.clinicalAssessment} />
      <Fact label="Kế hoạch điều trị" value={record.treatmentPlan} />
      <Fact label="Dặn dò" value={record.followUpInstructions} />
      <Fact label="Ngày tái khám" value={record.followUpDate} />
    </Section>
    <Section title="Chẩn đoán">
      {record.diagnoses.length ? record.diagnoses.map((diagnosis) => <View style={styles.lineCard} key={diagnosis.publicId}>
        <Text style={styles.lineTitle}>{diagnosis.isPrimary ? 'Chẩn đoán chính · ' : ''}{diagnosis.code}</Text>
        <Text style={styles.lineBody}>{diagnosis.name}</Text></View>) : <Text style={styles.muted}>Chưa có chẩn đoán.</Text>}
    </Section>
    <Section title="Chỉ số sinh hiệu">
      {record.vitalSigns.length ? record.vitalSigns.map((vital) => <View style={styles.lineCard} key={vital.publicId}>
        <Text style={styles.lineTitle}>{dateTime(vital.measuredAtUtc)}</Text>
        <Text style={styles.lineBody}>Nhiệt độ {vital.temperatureC ?? '—'} °C · Mạch {vital.pulseBpm ?? '—'}</Text>
        <Text style={styles.lineBody}>Huyết áp {vital.systolicBpMmhg ?? '—'}/{vital.diastolicBpMmhg ?? '—'} · SpO₂ {vital.spo2Percent ?? '—'}%</Text>
      </View>) : <Text style={styles.muted}>Không có chỉ số sinh hiệu.</Text>}
    </Section>
    <Section title="Dịch vụ và kết quả">
      {record.services.map((service) => <View style={styles.lineCard} key={service.publicId}>
        <Text style={styles.lineTitle}>{service.name}</Text>
        {service.result ? <><Text style={styles.resultBadge}>{service.result.status} · phiên bản {service.result.version}</Text>
          <Text style={styles.lineBody}>{service.result.summary || service.result.conclusion || formatResult(service.result.result)}</Text>
          <Text style={styles.releaseNote}>Công bố {dateTime(service.result.releasedAtUtc)}</Text></>
          : <Text style={styles.muted}>Không có kết quả riêng.</Text>}
      </View>)}
    </Section>
    {record.amendments.length > 0 && <Section title="Phụ lục sau ký">
      {record.amendments.map((item) => <View style={styles.lineCard} key={item.publicId}>
        <Text style={styles.lineTitle}>#{item.number} · {item.reason}</Text><Text style={styles.lineBody}>{item.content}</Text>
        <Text style={styles.releaseNote}>{dateTime(item.amendedAtUtc)}</Text></View>)}
    </Section>}
    <View style={styles.integrityCard}><Text style={styles.integrityTitle}>Dấu vết toàn vẹn hồ sơ</Text>
      <Text style={styles.integrityBody}>Hồ sơ được khóa lúc {dateTime(record.signature.signedAtUtc)} theo {record.signature.schemaVersion}.</Text>
      <Text selectable style={styles.hash}>{record.signature.sha256}</Text></View>
  </View>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>;
}
function Fact({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return <View style={styles.fact}><Text style={styles.factLabel}>{label}</Text><Text style={styles.factValue}>{value}</Text></View>;
}
function Loading({ label }: { label: string }) {
  return <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>{label}</Text></View>;
}
function ErrorCard({ error, retry }: { error: unknown; retry: () => void }) {
  return <View style={styles.errorCard}><Text style={styles.errorText}>{message(error)}</Text>
    <Pressable onPress={retry}><Text style={styles.retry}>Thử lại</Text></Pressable></View>;
}
function Empty({ title, body }: { title: string; body: string }) {
  return <View style={styles.emptyCard}><Text style={styles.emptyIcon}>◇</Text><Text style={styles.emptyTitle}>{title}</Text>
    <Text style={styles.muted}>{body}</Text></View>;
}
function formatResult(value: unknown) {
  if (value == null) return 'Kết quả đã hoàn tất.';
  try { return JSON.stringify(value); } catch { return 'Kết quả đã hoàn tất.'; }
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 }, page: { padding: 20, paddingBottom: 50 },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  heading: { color: colors.ink, fontSize: 28, fontWeight: '900', marginTop: 6 },
  lead: { color: colors.inkMuted, fontSize: 13, lineHeight: 20, marginTop: 7 },
  profileRow: { gap: 9, paddingVertical: 18 },
  profileChoice: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.medium, borderWidth: 1, minWidth: 145, padding: 13 },
  profileChoiceActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  profileName: { color: colors.ink, fontSize: 13, fontWeight: '900' }, profileNameActive: { color: colors.white },
  profileCode: { color: colors.inkMuted, fontSize: 10, marginTop: 4 }, list: { gap: 10 },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '900', marginBottom: 10, marginTop: 5 },
  recordCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.medium, borderWidth: 1, padding: 14, ...cardShadow },
  recordTop: { alignItems: 'center', flexDirection: 'row', gap: 12 }, pressed: { opacity: 0.72 }, flexOne: { flex: 1 },
  recordDate: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 12, height: 55, justifyContent: 'center', width: 58 },
  recordDay: { color: colors.primaryDark, fontSize: 19, fontWeight: '900' }, recordMonth: { color: colors.primary, fontSize: 8, fontWeight: '900' },
  recordTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' }, recordMeta: { color: colors.inkMuted, fontSize: 11, marginTop: 3 },
  arrow: { color: colors.primary, fontSize: 24 }, releaseNote: { color: colors.primary, fontSize: 10, fontWeight: '800', marginTop: 9 },
  backButton: { alignSelf: 'flex-start', marginVertical: 17, paddingVertical: 5 }, backText: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  detail: { gap: 12 }, heroCard: { backgroundColor: colors.primaryDark, borderRadius: radii.large, padding: 20 },
  heroLabel: { color: '#B9D9D2', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  heroTitle: { color: colors.white, fontSize: 22, fontWeight: '900', marginTop: 8 }, heroMeta: { color: '#D5E8E4', fontSize: 12, marginTop: 7 },
  section: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.medium, borderWidth: 1, padding: 16 },
  fact: { borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: 9 },
  factLabel: { color: colors.inkMuted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  factValue: { color: colors.ink, fontSize: 13, lineHeight: 20, marginTop: 4 },
  lineCard: { backgroundColor: colors.surfaceMuted, borderRadius: 12, marginTop: 8, padding: 12 },
  lineTitle: { color: colors.ink, fontSize: 13, fontWeight: '900' }, lineBody: { color: colors.inkMuted, fontSize: 12, lineHeight: 19, marginTop: 5 },
  resultBadge: { alignSelf: 'flex-start', backgroundColor: colors.successSoft, borderRadius: radii.pill, color: colors.success, fontSize: 9, fontWeight: '900', marginTop: 7, paddingHorizontal: 8, paddingVertical: 4 },
  integrityCard: { backgroundColor: colors.accentSoft, borderRadius: radii.medium, padding: 16 },
  integrityTitle: { color: '#80591F', fontSize: 13, fontWeight: '900' }, integrityBody: { color: '#795F38', fontSize: 11, lineHeight: 17, marginTop: 5 },
  hash: { color: '#795F38', fontFamily: 'monospace', fontSize: 9, marginTop: 9 }, muted: { color: colors.inkMuted, fontSize: 12, lineHeight: 19 },
  state: { alignItems: 'center', gap: 10, padding: 30 },
  errorCard: { alignItems: 'center', backgroundColor: colors.dangerSoft, borderRadius: radii.medium, gap: 8, marginTop: 18, padding: 17 },
  errorText: { color: colors.danger, fontSize: 12, textAlign: 'center' }, retry: { color: colors.danger, fontSize: 12, fontWeight: '900' },
  emptyCard: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.medium, marginTop: 18, padding: 24 },
  emptyIcon: { color: colors.primary, fontSize: 27 }, emptyTitle: { color: colors.ink, fontSize: 15, fontWeight: '900', marginBottom: 7, marginTop: 8 },
});
