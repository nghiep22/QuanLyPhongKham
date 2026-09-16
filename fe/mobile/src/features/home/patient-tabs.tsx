import type { Appointment, AuthenticatedUser, PatientAccessLink } from '@clinic/generated-api-types';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppointmentScreen } from '../appointments/appointment-screen';
import {
  DiscoveryNavigator,
  type BookingIntent,
  type DiscoveryStackParamList,
} from '../discovery/discovery-screens';
import { PatientAccessScreen } from '../patient-access/patient-access-screen';
import { MedicalRecordsScreen } from '../medical-records/medical-records-screen';
import { apiClient } from '../../shared/api/client';
import { cardShadow, colors, radii } from '../../shared/ui/theme';

export type PatientTabParamList = {
  Home: undefined;
  Explore: NavigatorScreenParams<DiscoveryStackParamList> | undefined;
  Booking: BookingIntent | undefined;
  Records: undefined;
  Profiles: undefined;
  Account: undefined;
};

type PatientTabsProps = {
  user: AuthenticatedUser;
  onLogout: () => Promise<void>;
  initialBookingIntent?: BookingIntent;
  onBookingIntentHandled?: () => void;
};

const Tab = createBottomTabNavigator<PatientTabParamList>();

const tabMeta: Record<keyof PatientTabParamList, { glyph: string; label: string }> = {
  Home: { glyph: '⌂', label: 'Trang chủ' },
  Explore: { glyph: '✦', label: 'Khám phá' },
  Booking: { glyph: '▦', label: 'Lịch khám' },
  Records: { glyph: '◇', label: 'Kết quả' },
  Profiles: { glyph: '♡', label: 'Hồ sơ' },
  Account: { glyph: '●', label: 'Tài khoản' },
};

export function PatientTabs({ user, onLogout, initialBookingIntent, onBookingIntentHandled }: PatientTabsProps) {
  return <Tab.Navigator screenOptions={({ route }) => ({
    headerShown: false,
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: '#60736F',
    tabBarHideOnKeyboard: true,
    tabBarLabel: tabMeta[route.name].label,
    tabBarLabelStyle: { fontSize: 11, fontWeight: '800', marginBottom: 4 },
    tabBarStyle: {
      backgroundColor: colors.surface,
      borderTopColor: colors.border,
      paddingTop: 6,
    },
    tabBarIcon: ({ color, focused }) => <View style={[styles.tabIcon, focused && styles.tabIconActive]}>
      <Text style={[styles.tabGlyph, { color }]}>{tabMeta[route.name].glyph}</Text>
    </View>,
  })} initialRouteName={initialBookingIntent ? 'Booking' : 'Home'}>
    <Tab.Screen name="Home">
      {(props) => <PatientDashboardScreen {...props} user={user} />}
    </Tab.Screen>
    <Tab.Screen name="Explore">
      {(props) => <DiscoveryNavigator onBook={(intent) => props.navigation.navigate('Booking', intent)} />}
    </Tab.Screen>
    <Tab.Screen name="Booking" initialParams={initialBookingIntent}>
      {({ route }) => <AppointmentScreen bookingIntent={route.params} onBookingIntentHandled={onBookingIntentHandled} />}
    </Tab.Screen>
    <Tab.Screen name="Records" component={MedicalRecordsScreen} />
    <Tab.Screen name="Profiles" component={PatientAccessScreen} />
    <Tab.Screen name="Account">
      {(props) => <AccountScreen {...props} user={user} onLogout={onLogout} />}
    </Tab.Screen>
  </Tab.Navigator>;
}

function PatientDashboardScreen({ navigation, user }:
  BottomTabScreenProps<PatientTabParamList, 'Home'> & { user: AuthenticatedUser }) {
  const appointments = useQuery({
    queryKey: ['mobile', 'appointments'],
    queryFn: async () => (await apiClient.appointments.list()).data,
    staleTime: 30_000,
  });
  const profiles = useQuery({
    queryKey: ['mobile', 'patient-access'],
    queryFn: async () => (await apiClient.patientAccess.get()).data.links,
    staleTime: 30_000,
  });
  const upcoming = appointments.data
    ?.filter((item) => ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'].includes(item.status)
      && Date.parse(item.scheduledEndUtc) >= Date.now())
    .sort((left, right) => Date.parse(left.scheduledStartUtc) - Date.parse(right.scheduledStartUtc))[0];
  const refreshing = appointments.isRefetching || profiles.isRefetching;
  const refresh = () => void Promise.all([appointments.refetch(), profiles.refetch()]);

  return <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.dashboardPage}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
      <View style={styles.dashboardHeader}>
        <View><Text style={styles.welcomeLabel}>CHÀO MỪNG TRỞ LẠI</Text>
          <Text style={styles.welcomeName}>{user.displayName}</Text></View>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(user.displayName)}</Text></View>
      </View>

      <View style={styles.careHero}>
        <View style={styles.careOrb} />
        <Text style={styles.careEyebrow}>CHĂM SÓC CHỦ ĐỘNG</Text>
        <Text style={styles.careTitle}>Đặt lịch khám{`\n`}nhanh và an tâm.</Text>
        <Text style={styles.careBody}>Chọn bác sĩ, dịch vụ và khung giờ phù hợp với bạn.</Text>
        <Pressable style={styles.careButton} onPress={() => navigation.navigate('Explore')}>
          <Text style={styles.careButtonText}>Khám phá dịch vụ</Text><Text style={styles.careButtonArrow}>→</Text>
        </Pressable>
      </View>

      <View style={styles.quickGrid}>
        <QuickAction code="BS" title="Bác sĩ" detail="Xem đội ngũ"
          onPress={() => navigation.navigate('Explore', { screen: 'Doctors' })} />
        <QuickAction code="₫" title="Bảng giá" detail="Theo chi nhánh"
          onPress={() => navigation.navigate('Explore', { screen: 'PriceList' })} />
        <QuickAction code="LS" title="Lịch khám" detail="Đặt và quản lý" onPress={() => navigation.navigate('Booking')} />
        <QuickAction code="HS" title="Hồ sơ" detail={`${profiles.data?.length ?? 0} hồ sơ liên kết`} onPress={() => navigation.navigate('Profiles')} />
      </View>

      <View style={styles.sectionRow}><Text style={styles.sectionTitle}>Lịch sắp tới</Text>
        <Pressable onPress={() => navigation.navigate('Booking')}><Text style={styles.sectionLink}>Xem tất cả ›</Text></Pressable></View>
      {appointments.isLoading ? <View style={styles.loadingCard}><ActivityIndicator color={colors.primary} /></View>
        : appointments.isError ? <DashboardError label="Không tải được lịch khám" onRetry={() => void appointments.refetch()} />
        : upcoming ? <UpcomingCard appointment={upcoming} onPress={() => navigation.navigate('Booking')} />
          : <View style={styles.emptyCard}><Text style={styles.emptyIcon}>○</Text><View style={styles.flexOne}>
            <Text style={styles.emptyTitle}>Chưa có lịch sắp tới</Text><Text style={styles.emptyBody}>Khám phá dịch vụ và chọn thời gian phù hợp.</Text></View>
            <Pressable onPress={() => navigation.navigate('Booking')}><Text style={styles.emptyAction}>Đặt lịch</Text></Pressable>
          </View>}

      <View style={styles.sectionRow}><Text style={styles.sectionTitle}>Hồ sơ đang quản lý</Text>
        <Pressable onPress={() => navigation.navigate('Profiles')}><Text style={styles.sectionLink}>Quản lý ›</Text></Pressable></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.profileList}>
        {profiles.data?.map((profile) => <ProfileCard key={profile.publicId} profile={profile} />)}
        {profiles.isError && <DashboardError label="Không tải được hồ sơ" onRetry={() => void profiles.refetch()} compact />}
        {!profiles.isLoading && !profiles.isError && !profiles.data?.length && <View style={styles.profileEmpty}>
          <Text style={styles.profileEmptyTitle}>Liên kết hồ sơ</Text><Text style={styles.profileEmptyBody}>Đặt lịch cho bạn hoặc người thân.</Text>
        </View>}
      </ScrollView>
    </ScrollView>
  </SafeAreaView>;
}

function AccountScreen({ navigation, user, onLogout }:
  BottomTabScreenProps<PatientTabParamList, 'Account'> & Pick<PatientTabsProps, 'user' | 'onLogout'>) {
  const [loggingOut, setLoggingOut] = useState(false);
  return <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.accountPage}>
      <Text style={styles.accountEyebrow}>TÀI KHOẢN</Text><Text style={styles.accountTitle}>Thông tin của bạn</Text>
      <View style={styles.accountCard}>
        <View style={styles.avatarLarge}><Text style={styles.avatarLargeText}>{initials(user.displayName)}</Text></View>
        <Text style={styles.accountName}>{user.displayName}</Text><Text style={styles.accountRole}>TÀI KHOẢN BỆNH NHÂN</Text>
      </View>
      <View style={styles.settingsCard}>
        <SettingRow code="HS" title="Hồ sơ được ủy quyền" subtitle="Quản lý hồ sơ của bạn và người thân"
          onPress={() => navigation.navigate('Profiles')} />
        <SettingRow code="AT" title="Bảo mật tài khoản" subtitle="Mật khẩu và các phiên đăng nhập" status="Sắp có" />
        <SettingRow code="TB" title="Thông báo" subtitle="Nhắc lịch và thông tin từ phòng khám" status="Sắp có" last />
      </View>
      <Pressable disabled={loggingOut} style={styles.logoutButton} onPress={async () => {
        setLoggingOut(true);
        await onLogout();
        setLoggingOut(false);
      }}>
        {loggingOut ? <ActivityIndicator color={colors.danger} /> : <Text style={styles.logoutText}>Đăng xuất khỏi thiết bị</Text>}
      </Pressable>
      <Text style={styles.version}>Cổng bệnh nhân · Phiên bản 1.0.0</Text>
    </ScrollView>
  </SafeAreaView>;
}

function QuickAction({ code, title, detail, onPress }: { code: string; title: string; detail: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]} onPress={onPress}>
    <View style={styles.quickIcon}><Text style={styles.quickIconText}>{code}</Text></View>
    <Text style={styles.quickTitle}>{title}</Text><Text style={styles.quickDetail}>{detail}</Text>
  </Pressable>;
}

function UpcomingCard({ appointment, onPress }: { appointment: Appointment; onPress: () => void }) {
  return <Pressable style={({ pressed }) => [styles.appointmentCard, pressed && styles.pressed]} onPress={onPress}>
    <View style={styles.dateBlock}><Text style={styles.dateDay}>{appointment.serviceDateLocal.slice(-2)}</Text>
      <Text style={styles.dateMonth}>THÁNG {Number(appointment.serviceDateLocal.slice(5, 7))}</Text></View>
    <View style={styles.flexOne}><View style={styles.appointmentTop}><Text numberOfLines={1} style={styles.appointmentService}>{appointment.service.name}</Text>
      <View style={styles.statusPill}><Text style={styles.statusText}>{appointmentStatus(appointment.status)}</Text></View></View>
      <Text style={styles.appointmentTime}>{appointment.startTimeLocal} – {appointment.endTimeLocal}</Text>
      <Text numberOfLines={1} style={styles.appointmentMeta}>{appointment.doctor.fullName} · {appointment.branch.name}</Text>
    </View>
  </Pressable>;
}

function ProfileCard({ profile }: { profile: PatientAccessLink }) {
  return <View style={styles.profileCard}><View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{initials(profile.patient.fullName)}</Text></View>
    <Text numberOfLines={1} style={styles.profileName}>{profile.patient.fullName}</Text>
    <Text style={styles.profileCode}>{profile.patient.code}</Text>
    <View style={styles.relationPill}><Text style={styles.relationText}>{relationshipLabel(profile.relationshipType)}</Text></View>
  </View>;
}

function SettingRow({ code, title, subtitle, status, last = false, onPress }: {
  code: string; title: string; subtitle: string; status?: string; last?: boolean; onPress?: () => void;
}) {
  const content = <><View style={styles.settingIcon}><Text style={styles.settingIconText}>{code}</Text></View>
    <View style={styles.flexOne}><Text style={styles.settingTitle}>{title}</Text><Text style={styles.settingSubtitle}>{subtitle}</Text></View>
    {onPress ? <Text style={styles.settingArrow}>›</Text> : <Text style={styles.settingStatus}>{status}</Text>}</>;
  return onPress ? <Pressable accessibilityRole="button" style={[styles.settingRow, last && styles.settingRowLast]} onPress={onPress}>{content}</Pressable>
    : <View style={[styles.settingRow, last && styles.settingRowLast]}>{content}</View>;
}

function DashboardError({ label, onRetry, compact = false }: { label: string; onRetry: () => void; compact?: boolean }) {
  return <View style={[styles.dashboardError, compact && styles.dashboardErrorCompact]}>
    <Text style={styles.dashboardErrorText}>{label}</Text><Pressable onPress={onRetry} hitSlop={8}>
      <Text style={styles.dashboardRetry}>Thử lại</Text></Pressable>
  </View>;
}

function initials(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.slice(-2).map((word) => word[0]?.toLocaleUpperCase('vi-VN')).join('') || 'BN';
}

function appointmentStatus(status: Appointment['status']) {
  const labels: Record<Appointment['status'], string> = {
    PENDING: 'Chờ xác nhận', CONFIRMED: 'Đã xác nhận', CHECKED_IN: 'Đã check-in', IN_PROGRESS: 'Đang khám',
    COMPLETED: 'Hoàn tất', CANCELLED: 'Đã hủy', NO_SHOW: 'Không đến', EXPIRED: 'Hết giữ chỗ',
  };
  return labels[status];
}

function relationshipLabel(value: PatientAccessLink['relationshipType']) {
  const labels: Record<PatientAccessLink['relationshipType'], string> = {
    SELF: 'Bản thân', CHILD: 'Con', SPOUSE: 'Vợ/chồng', PARENT: 'Cha/mẹ', GUARDIAN: 'Giám hộ', OTHER: 'Khác',
  };
  return labels[value];
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 }, flexOne: { flex: 1 }, pressed: { opacity: 0.74 },
  tabIcon: { alignItems: 'center', borderRadius: 12, height: 29, justifyContent: 'center', width: 35 },
  tabIconActive: { backgroundColor: colors.primarySoft }, tabGlyph: { fontSize: 18, fontWeight: '900' },
  dashboardPage: { padding: 20, paddingBottom: 36 },
  dashboardHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 19 },
  welcomeLabel: { color: colors.primary, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  welcomeName: { color: colors.ink, fontSize: 22, fontWeight: '900', marginTop: 4 },
  avatar: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 21, height: 42, justifyContent: 'center', width: 42 },
  avatarText: { color: colors.white, fontSize: 12, fontWeight: '900' },
  careHero: { backgroundColor: colors.primaryDark, borderRadius: radii.large, overflow: 'hidden', padding: 22 },
  careOrb: { backgroundColor: colors.accent, borderRadius: 100, height: 150, opacity: 0.16, position: 'absolute', right: -40, top: -55, width: 150 },
  careEyebrow: { color: '#ADD2C9', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  careTitle: { color: colors.white, fontSize: 27, fontWeight: '900', letterSpacing: -0.5, lineHeight: 33, marginTop: 8 },
  careBody: { color: '#CEE1DD', fontSize: 13, lineHeight: 20, marginTop: 9, maxWidth: 260 },
  careButton: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.white, borderRadius: 12, flexDirection: 'row', gap: 13, marginTop: 18, paddingHorizontal: 15, paddingVertical: 11 },
  careButtonText: { color: colors.primaryDark, fontSize: 13, fontWeight: '900' }, careButtonArrow: { color: colors.primary, fontSize: 16 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  quickAction: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.medium, borderWidth: 1, flexBasis: '47%', flexGrow: 1, minHeight: 105, padding: 13, ...cardShadow },
  quickIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 10, height: 34, justifyContent: 'center', width: 34 },
  quickIconText: { color: colors.primaryDark, fontSize: 10, fontWeight: '900' }, quickTitle: { color: colors.ink, fontSize: 14, fontWeight: '900', marginTop: 10 },
  quickDetail: { color: colors.inkMuted, fontSize: 11, marginTop: 3 },
  sectionRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 11, marginTop: 27 },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' }, sectionLink: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  loadingCard: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.medium, padding: 28 },
  appointmentCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.medium, borderWidth: 1, flexDirection: 'row', gap: 13, padding: 14, ...cardShadow },
  dateBlock: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 13, height: 60, justifyContent: 'center', width: 61 },
  dateDay: { color: colors.primaryDark, fontSize: 20, fontWeight: '900' }, dateMonth: { color: colors.primary, fontSize: 9, fontWeight: '900', marginTop: 1 },
  appointmentTop: { alignItems: 'flex-start', flexDirection: 'row', gap: 7, justifyContent: 'space-between' }, appointmentService: { color: colors.ink, flex: 1, fontSize: 14, fontWeight: '900' },
  statusPill: { backgroundColor: colors.accentSoft, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 4 }, statusText: { color: '#82591E', fontSize: 10, fontWeight: '900' },
  appointmentTime: { color: colors.primary, fontSize: 13, fontWeight: '900', marginTop: 6 }, appointmentMeta: { color: colors.inkMuted, fontSize: 10, marginTop: 3 },
  emptyCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.medium, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 16 },
  emptyIcon: { color: colors.primary, fontSize: 25 }, emptyTitle: { color: colors.ink, fontSize: 13, fontWeight: '900' }, emptyBody: { color: colors.inkMuted, fontSize: 10, marginTop: 3 },
  emptyAction: { color: colors.primary, fontSize: 11, fontWeight: '900' },
  profileList: { gap: 10, paddingBottom: 3 }, profileCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.medium, borderWidth: 1, padding: 14, width: 155 },
  profileAvatar: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 18, height: 42, justifyContent: 'center', width: 42 }, profileAvatarText: { color: colors.primaryDark, fontSize: 11, fontWeight: '900' },
  profileName: { color: colors.ink, fontSize: 13, fontWeight: '900', marginTop: 10 }, profileCode: { color: colors.inkMuted, fontSize: 10, marginTop: 3 },
  relationPill: { alignSelf: 'flex-start', backgroundColor: colors.primarySoft, borderRadius: radii.pill, marginTop: 10, paddingHorizontal: 8, paddingVertical: 4 }, relationText: { color: colors.primary, fontSize: 8, fontWeight: '900' },
  profileEmpty: { backgroundColor: colors.primarySoft, borderRadius: radii.medium, padding: 16, width: 190 }, profileEmptyTitle: { color: colors.ink, fontSize: 13, fontWeight: '900' }, profileEmptyBody: { color: colors.inkMuted, fontSize: 10, lineHeight: 15, marginTop: 5 },
  dashboardError: { alignItems: 'center', backgroundColor: colors.dangerSoft, borderRadius: radii.medium, flexDirection: 'row', justifyContent: 'space-between', padding: 16 },
  dashboardErrorCompact: { minWidth: 210 }, dashboardErrorText: { color: colors.danger, fontSize: 12, fontWeight: '800' }, dashboardRetry: { color: colors.danger, fontSize: 12, fontWeight: '900' },
  accountPage: { padding: 20, paddingBottom: 40 }, accountEyebrow: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 }, accountTitle: { color: colors.ink, fontSize: 28, fontWeight: '900', marginTop: 6 },
  accountCard: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radii.large, marginTop: 19, padding: 24 }, avatarLarge: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 37, height: 74, justifyContent: 'center', width: 74 },
  avatarLargeText: { color: colors.white, fontSize: 20, fontWeight: '900' }, accountName: { color: colors.ink, fontSize: 20, fontWeight: '900', marginTop: 13 }, accountRole: { color: colors.primary, fontSize: 9, fontWeight: '900', letterSpacing: 1.1, marginTop: 5 },
  settingsCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.medium, borderWidth: 1, marginTop: 18, paddingHorizontal: 15 },
  settingRow: { alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: 'row', gap: 12, paddingVertical: 15 }, settingRowLast: { borderBottomWidth: 0 },
  settingIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 10, height: 36, justifyContent: 'center', width: 36 }, settingIconText: { color: colors.primaryDark, fontSize: 9, fontWeight: '900' },
  settingTitle: { color: colors.ink, fontSize: 13, fontWeight: '900' }, settingSubtitle: { color: colors.inkMuted, fontSize: 11, marginTop: 3 }, settingArrow: { color: colors.primary, fontSize: 22 },
  settingStatus: { color: colors.inkMuted, fontSize: 10, fontWeight: '800' },
  logoutButton: { alignItems: 'center', backgroundColor: colors.dangerSoft, borderRadius: 14, marginTop: 20, minHeight: 52, justifyContent: 'center' }, logoutText: { color: colors.danger, fontSize: 14, fontWeight: '900' },
  version: { color: colors.inkMuted, fontSize: 10, marginTop: 20, textAlign: 'center' },
});
