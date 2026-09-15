import { ApiClientError } from '@clinic/generated-api-client';
import type {
  PublicBranch,
  PublicDoctor,
  PublicService,
  PublicSpecialty,
} from '@clinic/generated-api-types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiClient } from '../../shared/api/client';
import { cardShadow, colors, radii } from '../../shared/ui/theme';

export type BookingIntent = {
  branchPublicId?: string;
  branchName?: string;
  doctorPublicId?: string;
  doctorName?: string;
  servicePublicId?: string;
  serviceName?: string;
};

export type DiscoveryStackParamList = {
  ExploreHome: undefined;
  Branches: undefined;
  BranchDetail: { branch: PublicBranch };
  Specialties: undefined;
  SpecialtyDetail: { specialty: PublicSpecialty };
  PriceList: { branch?: PublicBranch; specialty?: PublicSpecialty; query?: string } | undefined;
  ServiceDetail: { branch: PublicBranch; service: PublicService };
  Doctors: {
    branch?: PublicBranch;
    service?: PublicService;
    specialty?: PublicSpecialty;
  } | undefined;
  DoctorDetail: { doctor: PublicDoctor; branch?: PublicBranch };
};

const Stack = createNativeStackNavigator<DiscoveryStackParamList>();

const catalogKeys = {
  branches: ['public-catalog', 'branches'] as const,
  specialties: ['public-catalog', 'specialties'] as const,
  services: (branchPublicId: string, specialtyPublicId = '') =>
    ['public-catalog', 'services', branchPublicId, specialtyPublicId] as const,
  doctors: (branchPublicId = '', specialtyPublicId = '', servicePublicId = '') =>
    ['public-catalog', 'doctors', branchPublicId, specialtyPublicId, servicePublicId] as const,
};

function useBranches() {
  return useQuery({
    queryKey: catalogKeys.branches,
    queryFn: async () => (await apiClient.publicCatalog.branches()).data,
    staleTime: 5 * 60_000,
  });
}

function useSpecialties() {
  return useQuery({
    queryKey: catalogKeys.specialties,
    queryFn: async () => (await apiClient.publicCatalog.specialties()).data,
    staleTime: 5 * 60_000,
  });
}

function useServices(branchPublicId: string, specialtyPublicId = '') {
  return useQuery({
    queryKey: catalogKeys.services(branchPublicId, specialtyPublicId),
    queryFn: async () => (await apiClient.publicCatalog.services({
      branchPublicId,
      ...(specialtyPublicId ? { specialtyPublicId } : {}),
    })).data,
    enabled: Boolean(branchPublicId),
    staleTime: 2 * 60_000,
  });
}

function useDoctors(filters: {
  branchPublicId?: string;
  specialtyPublicId?: string;
  servicePublicId?: string;
}) {
  return useQuery({
    queryKey: catalogKeys.doctors(
      filters.branchPublicId,
      filters.specialtyPublicId,
      filters.servicePublicId,
    ),
    queryFn: async () => (await apiClient.publicCatalog.doctors(filters)).data,
    staleTime: 2 * 60_000,
  });
}

type DiscoveryNavigatorProps = {
  onBook?: (intent: BookingIntent) => void;
};

export function DiscoveryNavigator({ onBook }: DiscoveryNavigatorProps) {
  return <Stack.Navigator screenOptions={{
    contentStyle: { backgroundColor: colors.background },
    headerBackTitle: 'Quay lại',
    headerShadowVisible: false,
    headerStyle: { backgroundColor: colors.background },
    headerTintColor: colors.primaryDark,
    headerTitleStyle: { fontSize: 18, fontWeight: '800' },
  }}>
    <Stack.Screen name="ExploreHome" options={{ headerShown: false }}>
      {(props) => <ExploreHomeScreen {...props} onBook={onBook} />}
    </Stack.Screen>
    <Stack.Screen name="Branches" component={BranchesScreen} options={{ title: 'Chi nhánh' }} />
    <Stack.Screen name="BranchDetail" options={{ title: 'Thông tin chi nhánh' }}>
      {(props) => <BranchDetailScreen {...props} onBook={onBook} />}
    </Stack.Screen>
    <Stack.Screen name="Specialties" component={SpecialtiesScreen} options={{ title: 'Chuyên khoa' }} />
    <Stack.Screen name="SpecialtyDetail" options={{ title: 'Chi tiết chuyên khoa' }}>
      {(props) => <SpecialtyDetailScreen {...props} onBook={onBook} />}
    </Stack.Screen>
    <Stack.Screen name="PriceList" component={PriceListScreen} options={{ title: 'Dịch vụ & bảng giá' }} />
    <Stack.Screen name="ServiceDetail" options={{ title: 'Chi tiết dịch vụ' }}>
      {(props) => <ServiceDetailScreen {...props} onBook={onBook} />}
    </Stack.Screen>
    <Stack.Screen name="Doctors" component={DoctorsScreen} options={{ title: 'Đội ngũ bác sĩ' }} />
    <Stack.Screen name="DoctorDetail" options={{ title: 'Thông tin bác sĩ' }}>
      {(props) => <DoctorDetailScreen {...props} onBook={onBook} />}
    </Stack.Screen>
  </Stack.Navigator>;
}

function ExploreHomeScreen({ navigation, onBook }:
  NativeStackScreenProps<DiscoveryStackParamList, 'ExploreHome'> & DiscoveryNavigatorProps) {
  const [search, setSearch] = useState('');
  const branches = useBranches();
  const specialties = useSpecialties();
  const doctors = useDoctors({});
  const firstBranch = branches.data?.[0];
  const services = useServices(firstBranch?.publicId ?? '');
  const refreshing = branches.isRefetching || specialties.isRefetching || doctors.isRefetching || services.isRefetching;
  const hasError = branches.isError || specialties.isError || doctors.isError;

  const refresh = () => {
    void Promise.all([branches.refetch(), specialties.refetch(), doctors.refetch()]);
    if (firstBranch) void services.refetch();
  };

  const submitSearch = () => {
    const query = search.trim();
    navigation.navigate('PriceList', query ? { query } : undefined);
  };

  return <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.homePage} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
      <View style={styles.hero}>
        <View style={styles.heroOrbOne} />
        <View style={styles.heroOrbTwo} />
        <View style={styles.brandRow}>
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>+</Text></View>
          <View><Text style={styles.brandName}>CỔNG BỆNH NHÂN</Text><Text style={styles.brandSub}>Chăm sóc chủ động</Text></View>
        </View>
        <Text style={styles.heroEyebrow}>THÔNG TIN MINH BẠCH · ĐẶT LỊCH DỄ DÀNG</Text>
        <Text style={styles.heroTitle}>Sức khỏe của bạn,{`\n`}được chăm sóc đúng lúc.</Text>
        <Text style={styles.heroBody}>Tìm bác sĩ, xem giá dịch vụ và chọn lịch khám phù hợp tại các chi nhánh.</Text>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput accessibilityLabel="Tìm dịch vụ" autoCapitalize="none"
            placeholder="Tìm dịch vụ…" placeholderTextColor="#81918E"
            returnKeyType="search" style={styles.searchInput} value={search} onChangeText={setSearch}
            onSubmitEditing={submitSearch} />
          <Pressable accessibilityRole="button" onPress={submitSearch} style={styles.searchSubmit}>
            <Text style={styles.searchSubmitText}>Tìm</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <View><Text style={styles.kicker}>KHÁM PHÁ</Text><Text style={styles.sectionTitle}>Bạn đang cần gì?</Text></View>
      </View>
      <View style={styles.actionGrid}>
        <ExploreTile code="CN" title="Chi nhánh" subtitle={`${branches.data?.length ?? 0} cơ sở`}
          tone="green" onPress={() => navigation.navigate('Branches')} />
        <ExploreTile code="CK" title="Chuyên khoa" subtitle={`${specialties.data?.length ?? 0} chuyên khoa`}
          tone="amber" onPress={() => navigation.navigate('Specialties')} />
        <ExploreTile code="₫" title="Bảng giá" subtitle="Giá theo cơ sở"
          tone="blue" onPress={() => navigation.navigate('PriceList')} />
        <ExploreTile code="BS" title="Bác sĩ" subtitle={`${doctors.data?.length ?? 0} bác sĩ`}
          tone="rose" onPress={() => navigation.navigate('Doctors')} />
      </View>

      {hasError && <ErrorCard message="Chưa tải được một số danh mục." onRetry={refresh} />}

      <View style={styles.sectionHeader}>
        <View><Text style={styles.kicker}>DỊCH VỤ NỔI BẬT</Text><Text style={styles.sectionTitle}>Chi phí rõ ràng</Text></View>
        <Pressable onPress={() => navigation.navigate('PriceList')}><Text style={styles.seeAll}>Xem tất cả ›</Text></Pressable>
      </View>
      {services.isLoading ? <InlineLoading /> : services.isError ? <ErrorCard message={errorMessage(services.error)}
        onRetry={() => void services.refetch()} /> : <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalList}>
        {services.data?.slice(0, 5).map((service) => firstBranch && <ServiceMiniCard key={service.publicId}
          service={service} branch={firstBranch} onPress={() => navigation.navigate('ServiceDetail', { branch: firstBranch, service })} />)}
      </ScrollView>}

      <View style={styles.sectionHeader}>
        <View><Text style={styles.kicker}>ĐỘI NGŨ CHUYÊN MÔN</Text><Text style={styles.sectionTitle}>Bác sĩ đồng hành</Text></View>
        <Pressable onPress={() => navigation.navigate('Doctors')}><Text style={styles.seeAll}>Xem tất cả ›</Text></Pressable>
      </View>
      {doctors.isLoading ? <InlineLoading /> : doctors.isError ? <ErrorCard message={errorMessage(doctors.error)}
        onRetry={() => void doctors.refetch()} /> : <View style={styles.homeDoctorList}>
        {doctors.data?.slice(0, 3).map((doctor) => <DoctorCard key={doctor.publicId} doctor={doctor}
          onPress={() => navigation.navigate('DoctorDetail', { doctor })} />)}
      </View>}

      <View style={styles.bookingBanner}>
        <View style={styles.bookingBannerCopy}>
          <Text style={styles.bookingBannerEyebrow}>ĐÃ CHỌN ĐƯỢC DỊCH VỤ?</Text>
          <Text style={styles.bookingBannerTitle}>Đặt lịch chỉ trong vài bước</Text>
          <Text style={styles.bookingBannerBody}>Chọn hồ sơ, thời gian và xác nhận lịch khám an toàn.</Text>
        </View>
        <Pressable style={styles.lightButton} onPress={() => onBook?.({})}>
          <Text style={styles.lightButtonText}>Đặt lịch ngay</Text>
        </Pressable>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

function BranchesScreen({ navigation }: NativeStackScreenProps<DiscoveryStackParamList, 'Branches'>) {
  const [search, setSearch] = useState('');
  const query = useBranches();
  const filtered = useMemo(() => {
    const needle = normalize(search);
    return (query.data ?? []).filter((branch) => normalize(`${branch.name} ${branch.district ?? ''} ${branch.province ?? ''}`).includes(needle));
  }, [query.data, search]);

  return <CatalogPage query={query} onRetry={() => void query.refetch()}>
    <PageIntro kicker="HỆ THỐNG PHÒNG KHÁM" title="Chọn cơ sở thuận tiện"
      body="Bảng giá, đội ngũ bác sĩ và lịch trống được cập nhật riêng cho từng chi nhánh." />
    <SearchInput value={search} onChangeText={setSearch} placeholder="Tìm tên hoặc khu vực…" />
    <Text style={styles.resultCount}>{filtered.length} chi nhánh đang hoạt động</Text>
    <View style={styles.stackGap}>{filtered.map((branch, index) => <BranchCard branch={branch} index={index}
      key={branch.publicId} onPress={() => navigation.navigate('BranchDetail', { branch })} />)}</View>
    {!filtered.length && <EmptyState title="Không tìm thấy chi nhánh" body="Thử một tên hoặc khu vực khác." />}
  </CatalogPage>;
}

function BranchDetailScreen({ navigation, route, onBook }:
  NativeStackScreenProps<DiscoveryStackParamList, 'BranchDetail'> & DiscoveryNavigatorProps) {
  const { branch } = route.params;
  return <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.screen}>
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.branchHero}>
        <View style={styles.largeBadge}><Text style={styles.largeBadgeText}>{initials(branch.name)}</Text></View>
        <Text style={styles.detailEyebrow}>{branch.code}</Text>
        <Text style={styles.detailTitle}>{branch.name}</Text>
        <Text style={styles.detailBody}>{fullAddress(branch)}</Text>
      </View>
      <View style={styles.infoCard}>
        <InfoRow label="Điện thoại" value={branch.phone || 'Đang cập nhật'} />
        <InfoRow label="Email" value={branch.email || 'Đang cập nhật'} />
        <InfoRow label="Đặt trước tối đa" value={`${branch.bookingHorizonDays} ngày`} />
        <InfoRow label="Giữ chỗ trực tuyến" value={`${branch.onlineHoldMinutes} phút`} />
        <InfoRow label="Hạn hủy lịch" value={`Trước giờ khám ${formatMinutes(branch.cancellationDeadlineMinutes)}`} last />
      </View>
      <View style={styles.buttonStack}>
        <PrimaryButton label="Đặt lịch tại chi nhánh này" onPress={() => onBook?.({
          branchPublicId: branch.publicId, branchName: branch.name,
        })} />
        <OutlineButton label="Xem dịch vụ & bảng giá" onPress={() => navigation.navigate('PriceList', { branch })} />
        <OutlineButton label="Xem bác sĩ tại đây" onPress={() => navigation.navigate('Doctors', { branch })} />
        {branch.phone && <TextButton label="Gọi cho phòng khám" onPress={() => void Linking.openURL(`tel:${branch.phone}`)} />}
      </View>
    </ScrollView>
  </SafeAreaView>;
}

function SpecialtiesScreen({ navigation }: NativeStackScreenProps<DiscoveryStackParamList, 'Specialties'>) {
  const [search, setSearch] = useState('');
  const query = useSpecialties();
  const filtered = useMemo(() => {
    const needle = normalize(search);
    return (query.data ?? []).filter((item) => normalize(`${item.name} ${item.description ?? ''}`).includes(needle));
  }, [query.data, search]);

  return <CatalogPage query={query} onRetry={() => void query.refetch()}>
    <PageIntro kicker="CHUYÊN MÔN PHÙ HỢP" title="Tìm đúng chuyên khoa"
      body="Xem dịch vụ và bác sĩ đang nhận lịch trực tuyến theo từng chuyên khoa." />
    <SearchInput value={search} onChangeText={setSearch} placeholder="Tìm chuyên khoa…" />
    <View style={styles.stackGap}>{filtered.map((specialty, index) => <Pressable key={specialty.publicId}
      style={({ pressed }) => [styles.specialtyCard, pressed && styles.pressed]}
      onPress={() => navigation.navigate('SpecialtyDetail', { specialty })}>
      <View style={[styles.specialtyBadge, index % 2 ? styles.specialtyBadgeAmber : undefined]}>
        <Text style={styles.specialtyBadgeText}>{String(index + 1).padStart(2, '0')}</Text>
      </View>
      <View style={styles.flexOne}><Text style={styles.cardTitle}>{specialty.name}</Text>
        <Text numberOfLines={2} style={styles.cardBody}>{specialty.description || 'Thông tin chuyên khoa đang được cập nhật.'}</Text></View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>)}</View>
    {!filtered.length && <EmptyState title="Không tìm thấy chuyên khoa" body="Thử từ khóa ngắn hơn." />}
  </CatalogPage>;
}

function SpecialtyDetailScreen({ navigation, route, onBook }:
  NativeStackScreenProps<DiscoveryStackParamList, 'SpecialtyDetail'> & DiscoveryNavigatorProps) {
  const { specialty } = route.params;
  const branches = useBranches();
  const [branchId, setBranchId] = useState('');
  const selectedBranch = branches.data?.find((item) => item.publicId === branchId) ?? branches.data?.[0];
  const services = useServices(selectedBranch?.publicId ?? '', specialty.publicId);
  const doctors = useDoctors({ specialtyPublicId: specialty.publicId, branchPublicId: selectedBranch?.publicId });

  return <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.screen}>
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.softHero}>
        <Text style={styles.kicker}>CHUYÊN KHOA</Text><Text style={styles.detailTitle}>{specialty.name}</Text>
        <Text style={styles.detailBody}>{specialty.description || 'Nội dung giới thiệu đang được cập nhật.'}</Text>
      </View>
      <SectionLabel title="Chọn chi nhánh" />
      <ChipRow items={branches.data ?? []} selectedId={selectedBranch?.publicId ?? ''}
        getId={(item) => item.publicId} getLabel={(item) => item.name} onSelect={(item) => setBranchId(item.publicId)} />
      <SectionLabel title="Dịch vụ" action="Xem bảng giá" onAction={() => navigation.navigate('PriceList', {
        ...(selectedBranch ? { branch: selectedBranch } : {}), specialty,
      })} />
      {services.isLoading ? <InlineLoading /> : <View style={styles.stackGap}>
        {services.data?.slice(0, 4).map((service) => selectedBranch && <ServiceRow key={service.publicId}
          branch={selectedBranch} service={service} onPress={() => navigation.navigate('ServiceDetail', { branch: selectedBranch, service })} />)}
      </View>}
      <SectionLabel title="Bác sĩ phù hợp" action="Xem tất cả" onAction={() => navigation.navigate('Doctors', {
        specialty, ...(selectedBranch ? { branch: selectedBranch } : {}),
      })} />
      {doctors.isLoading ? <InlineLoading /> : doctors.isError ? <ErrorCard message={errorMessage(doctors.error)}
        onRetry={() => void doctors.refetch()} /> : <View style={styles.stackGap}>
        {doctors.data?.slice(0, 3).map((doctor) => <DoctorCard doctor={doctor} key={doctor.publicId}
          onPress={() => navigation.navigate('DoctorDetail', { doctor, ...(selectedBranch ? { branch: selectedBranch } : {}) })} />)}
      </View>}
      <PrimaryButton label="Tìm lịch khám phù hợp" onPress={() => onBook?.({
        branchPublicId: selectedBranch?.publicId, branchName: selectedBranch?.name,
      })} />
    </ScrollView>
  </SafeAreaView>;
}

function PriceListScreen({ navigation, route }: NativeStackScreenProps<DiscoveryStackParamList, 'PriceList'>) {
  const branches = useBranches();
  const specialties = useSpecialties();
  const [branchId, setBranchId] = useState(route.params?.branch?.publicId ?? '');
  const [specialtyId, setSpecialtyId] = useState(route.params?.specialty?.publicId ?? '');
  const [search, setSearch] = useState(route.params?.query ?? '');
  const selectedBranch = branches.data?.find((item) => item.publicId === branchId) ?? branches.data?.[0];
  const services = useServices(selectedBranch?.publicId ?? '', specialtyId);
  const filtered = useMemo(() => {
    const needle = normalize(search);
    return (services.data ?? []).filter((service) => normalize(`${service.name} ${service.code} ${service.category.name}`).includes(needle));
  }, [search, services.data]);

  return <CatalogPage query={branches} onRetry={() => void branches.refetch()}>
    <PageIntro kicker="BẢNG GIÁ CÔNG KHAI" title="Chọn dịch vụ phù hợp"
      body="Mức giá dưới đây đang có hiệu lực tại chi nhánh được chọn." />
    <Text style={styles.fieldLabel}>Chi nhánh</Text>
    <ChipRow items={branches.data ?? []} selectedId={selectedBranch?.publicId ?? ''}
      getId={(item) => item.publicId} getLabel={(item) => item.name} onSelect={(item) => setBranchId(item.publicId)} />
    <SearchInput value={search} onChangeText={setSearch} placeholder="Tìm tên hoặc mã dịch vụ…" />
    <Text style={styles.fieldLabel}>Chuyên khoa</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      <FilterChip active={!specialtyId} label="Tất cả" onPress={() => setSpecialtyId('')} />
      {specialties.data?.map((item) => <FilterChip active={specialtyId === item.publicId} key={item.publicId}
        label={item.name} onPress={() => setSpecialtyId(item.publicId)} />)}
    </ScrollView>
    <View style={styles.priceSummary}>
      <Text style={styles.priceSummaryLabel}>DỊCH VỤ ĐANG HIỂN THỊ</Text>
      <Text style={styles.priceSummaryValue}>{filtered.length}</Text>
      <Text style={styles.priceSummaryHint}>Giá đã gồm theo cấu hình hiện hành · VND</Text>
    </View>
    {services.isLoading ? <InlineLoading /> : services.isError ? <ErrorCard message={errorMessage(services.error)}
      onRetry={() => void services.refetch()} /> : <View style={styles.stackGap}>
      {filtered.map((service) => selectedBranch && <ServiceRow branch={selectedBranch} service={service}
        key={service.publicId} onPress={() => navigation.navigate('ServiceDetail', { branch: selectedBranch, service })} />)}
    </View>}
    {!services.isLoading && !filtered.length && <EmptyState title="Chưa có dịch vụ phù hợp"
      body="Thử đổi chi nhánh, chuyên khoa hoặc từ khóa." />}
    <Text style={styles.disclaimer}>Giá tham khảo tại thời điểm tra cứu. Tổng chi phí thực tế có thể thay đổi theo dịch vụ phát sinh và quyền lợi bảo hiểm.</Text>
  </CatalogPage>;
}

function ServiceDetailScreen({ navigation, route, onBook }:
  NativeStackScreenProps<DiscoveryStackParamList, 'ServiceDetail'> & DiscoveryNavigatorProps) {
  const { branch, service } = route.params;
  const doctors = useDoctors({ branchPublicId: branch.publicId, servicePublicId: service.publicId });
  return <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.screen}>
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.serviceHero}>
        <View style={styles.serviceTypePill}><Text style={styles.serviceTypePillText}>{serviceTypeLabel(service.type)}</Text></View>
        <Text style={[styles.detailTitle, styles.detailTitleLight]}>{service.name}</Text>
        <Text style={styles.serviceCode}>Mã dịch vụ · {service.code}</Text>
        <Text style={styles.heroPrice}>{money(service.price.amount)}</Text>
        <Text style={styles.priceAt}>{branch.name} · hiệu lực từ {formatDate(service.price.effectiveFrom)}</Text>
      </View>
      <View style={styles.metricRow}>
        <Metric label="Thời lượng" value={`~${service.durationMinutes} phút`} />
        <Metric label="Chuyên khoa" value={service.specialty?.name ?? 'Đa khoa'} />
      </View>
      <View style={styles.infoCard}>
        <InfoRow label="Nhóm dịch vụ" value={service.category.name} />
        <InfoRow label="Cần bác sĩ" value={service.requiresDoctor ? 'Có' : 'Không'} last />
      </View>
      <SectionLabel title="Bác sĩ thực hiện" action="Xem tất cả" onAction={() => navigation.navigate('Doctors', { branch, service })} />
      {doctors.isLoading ? <InlineLoading /> : doctors.isError ? <ErrorCard message={errorMessage(doctors.error)}
        onRetry={() => void doctors.refetch()} /> : <View style={styles.stackGap}>
        {doctors.data?.slice(0, 3).map((doctor) => <DoctorCard doctor={doctor} key={doctor.publicId}
          onPress={() => navigation.navigate('DoctorDetail', { doctor, branch })} />)}
      </View>}
      {!doctors.isLoading && !doctors.data?.length && <EmptyState title="Chưa có bác sĩ trực tuyến"
        body="Bạn vẫn có thể tìm khung giờ chung của dịch vụ." compact />}
      <PrimaryButton label="Chọn lịch cho dịch vụ này" onPress={() => onBook?.({
        branchPublicId: branch.publicId, branchName: branch.name,
        servicePublicId: service.publicId, serviceName: service.name,
      })} />
      <Text style={styles.disclaimer}>Giá hiển thị là giá đang có hiệu lực tại chi nhánh đã chọn và chưa bao gồm dịch vụ phát sinh.</Text>
    </ScrollView>
  </SafeAreaView>;
}

function DoctorsScreen({ navigation, route }: NativeStackScreenProps<DiscoveryStackParamList, 'Doctors'>) {
  const branches = useBranches();
  const specialties = useSpecialties();
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState(route.params?.branch?.publicId ?? '');
  const [specialtyId, setSpecialtyId] = useState(route.params?.specialty?.publicId ?? '');
  const selectedBranch = branches.data?.find((item) => item.publicId === branchId);
  const doctors = useDoctors({
    ...(branchId ? { branchPublicId: branchId } : {}),
    ...(specialtyId ? { specialtyPublicId: specialtyId } : {}),
    ...(route.params?.service ? { servicePublicId: route.params.service.publicId } : {}),
  });
  const filtered = useMemo(() => {
    const needle = normalize(search);
    return (doctors.data ?? []).filter((doctor) => normalize(`${doctor.fullName} ${doctor.academicTitle ?? ''} ${doctor.specialties.map((item) => item.name).join(' ')}`).includes(needle));
  }, [doctors.data, search]);

  return <CatalogPage query={doctors} onRetry={() => void doctors.refetch()}>
    <PageIntro kicker="ĐỘI NGŨ CHUYÊN MÔN" title="Tìm bác sĩ đồng hành"
      body="Danh sách gồm các bác sĩ đang nhận đặt lịch trực tuyến." />
    <SearchInput value={search} onChangeText={setSearch} placeholder="Tìm tên bác sĩ…" />
    <Text style={styles.fieldLabel}>Chi nhánh</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      <FilterChip active={!branchId} label="Tất cả" onPress={() => setBranchId('')} />
      {branches.data?.map((item) => <FilterChip active={branchId === item.publicId} key={item.publicId}
        label={item.name} onPress={() => setBranchId(item.publicId)} />)}
    </ScrollView>
    <Text style={styles.fieldLabel}>Chuyên khoa</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      <FilterChip active={!specialtyId} label="Tất cả" onPress={() => setSpecialtyId('')} />
      {specialties.data?.map((item) => <FilterChip active={specialtyId === item.publicId} key={item.publicId}
        label={item.name} onPress={() => setSpecialtyId(item.publicId)} />)}
    </ScrollView>
    {route.params?.service && <View style={styles.activeFilter}><Text style={styles.activeFilterText}>Dịch vụ: {route.params.service.name}</Text></View>}
    <Text style={styles.resultCount}>{filtered.length} bác sĩ phù hợp</Text>
    <View style={styles.stackGap}>{filtered.map((doctor) => <DoctorCard doctor={doctor} key={doctor.publicId}
      onPress={() => navigation.navigate('DoctorDetail', { doctor, ...(selectedBranch ? { branch: selectedBranch } : {}) })} />)}</View>
    {!doctors.isError && !filtered.length && <EmptyState title="Không tìm thấy bác sĩ" body="Thử bỏ bớt bộ lọc hoặc chọn chi nhánh khác." />}
  </CatalogPage>;
}

function DoctorDetailScreen({ navigation, route, onBook }:
  NativeStackScreenProps<DiscoveryStackParamList, 'DoctorDetail'> & DiscoveryNavigatorProps) {
  const { doctor } = route.params;
  const branches = useBranches();
  const [branchId, setBranchId] = useState(route.params.branch?.publicId ?? doctor.branches[0]?.publicId ?? '');
  const selectedBranch = branches.data?.find((item) => item.publicId === branchId)
    ?? route.params.branch
    ?? branches.data?.find((item) => doctor.branches.some((branch) => branch.publicId === item.publicId));
  const services = useServices(selectedBranch?.publicId ?? '');
  const branchDoctors = useDoctors({ branchPublicId: selectedBranch?.publicId });
  const branchDoctor = branchDoctors.data?.find((item) => item.publicId === doctor.publicId);
  const doctorServices = services.data?.filter((service) => branchDoctor?.servicePublicIds.includes(service.publicId)) ?? [];

  return <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.screen}>
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.doctorHero}>
        <View style={styles.doctorAvatarLarge}><Text style={styles.doctorAvatarLargeText}>{initials(doctor.fullName)}</Text></View>
        <Text style={styles.doctorTitle}>{doctor.academicTitle || 'Bác sĩ'}</Text>
        <Text style={styles.detailTitle}>{doctor.fullName}</Text>
        <Text style={styles.doctorSpecialties}>{doctor.specialties.map((item) => item.name).join(' · ') || 'Đa khoa'}</Text>
      </View>
      <SectionLabel title="Giới thiệu" />
      <Text style={styles.longBody}>{doctor.biography || 'Thông tin giới thiệu bác sĩ đang được phòng khám cập nhật.'}</Text>
      <SectionLabel title="Chi nhánh làm việc" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {doctor.branches.map((item) => <FilterChip active={branchId === item.publicId} key={item.publicId}
          label={item.name} onPress={() => setBranchId(item.publicId)} />)}
      </ScrollView>
      <SectionLabel title="Dịch vụ có thể đặt" />
      {services.isLoading || branchDoctors.isLoading ? <InlineLoading />
        : services.isError || branchDoctors.isError ? <ErrorCard
          message={errorMessage(services.error ?? branchDoctors.error)}
          onRetry={() => void Promise.all([services.refetch(), branchDoctors.refetch()])} />
          : <View style={styles.stackGap}>
        {doctorServices.map((service) => selectedBranch && <ServiceRow branch={selectedBranch} service={service}
          key={service.publicId} onPress={() => navigation.navigate('ServiceDetail', { branch: selectedBranch, service })} />)}
      </View>}
      {!services.isLoading && !branchDoctors.isLoading && !services.isError && !branchDoctors.isError
        && !doctorServices.length && <EmptyState compact title="Chưa có dịch vụ tại cơ sở này"
        body="Chọn một chi nhánh khác của bác sĩ." />}
      <PrimaryButton label="Đặt lịch với bác sĩ" onPress={() => onBook?.({
        branchPublicId: selectedBranch?.publicId,
        branchName: selectedBranch?.name,
        doctorPublicId: doctor.publicId, doctorName: doctor.fullName,
        servicePublicId: doctorServices[0]?.publicId,
        serviceName: doctorServices[0]?.name,
      })} />
    </ScrollView>
  </SafeAreaView>;
}

function CatalogPage({ children, query, onRetry }: {
  children: React.ReactNode;
  query: { isLoading: boolean; isError: boolean; error: unknown };
  onRetry: () => void;
}) {
  if (query.isLoading) return <FullLoading />;
  if (query.isError) return <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.center}>
    <ErrorCard message={errorMessage(query.error)} onRetry={onRetry} />
  </SafeAreaView>;
  return <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.screen}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">{children}</ScrollView>
  </SafeAreaView>;
}

function PageIntro({ kicker, title, body }: { kicker: string; title: string; body: string }) {
  return <View style={styles.pageIntro}><Text style={styles.kicker}>{kicker}</Text>
    <Text style={styles.pageTitle}>{title}</Text><Text style={styles.pageBody}>{body}</Text></View>;
}

function ExploreTile({ code, title, subtitle, tone, onPress }: {
  code: string; title: string; subtitle: string; tone: 'green' | 'amber' | 'blue' | 'rose'; onPress: () => void;
}) {
  const toneStyle = tone === 'green' ? styles.tileGreen : tone === 'amber' ? styles.tileAmber
    : tone === 'blue' ? styles.tileBlue : styles.tileRose;
  return <Pressable accessibilityRole="button" style={({ pressed }) => [styles.exploreTile, pressed && styles.pressed]} onPress={onPress}>
    <View style={[styles.tileIcon, toneStyle]}><Text style={styles.tileIconText}>{code}</Text></View>
    <Text style={styles.tileTitle}>{title}</Text><Text style={styles.tileSubtitle}>{subtitle}</Text>
    <Text style={styles.tileArrow}>↗</Text>
  </Pressable>;
}

function BranchCard({ branch, index, onPress }: { branch: PublicBranch; index: number; onPress: () => void }) {
  return <Pressable style={({ pressed }) => [styles.branchCard, pressed && styles.pressed]} onPress={onPress}>
    <View style={[styles.branchNumber, index % 2 ? styles.branchNumberAlt : undefined]}>
      <Text style={styles.branchNumberText}>{String(index + 1).padStart(2, '0')}</Text>
    </View>
    <View style={styles.flexOne}><Text style={styles.cardTitle}>{branch.name}</Text>
      <Text numberOfLines={2} style={styles.cardBody}>{fullAddress(branch)}</Text>
      {branch.phone && <Text style={styles.cardMeta}>Điện thoại · {branch.phone}</Text>}
    </View><Text style={styles.chevron}>›</Text>
  </Pressable>;
}

function DoctorCard({ doctor, onPress }: { doctor: PublicDoctor; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Xem bác sĩ ${doctor.fullName}`}
    style={({ pressed }) => [styles.doctorCard, pressed && styles.pressed]} onPress={onPress}>
    <View style={styles.doctorAvatar}><Text style={styles.doctorAvatarText}>{initials(doctor.fullName)}</Text></View>
    <View style={styles.flexOne}><Text style={styles.doctorLabel}>{doctor.academicTitle || 'BÁC SĨ'}</Text>
      <Text style={styles.cardTitle}>{doctor.fullName}</Text>
      <Text numberOfLines={1} style={styles.cardBody}>{doctor.specialties.map((item) => item.name).join(' · ') || 'Đa khoa'}</Text>
      <Text numberOfLines={1} style={styles.cardMeta}>{doctor.branches.map((item) => item.name).join(' · ')}</Text>
    </View><Text style={styles.chevron}>›</Text>
  </Pressable>;
}

function ServiceMiniCard({ service, branch, onPress }: { service: PublicService; branch: PublicBranch; onPress: () => void }) {
  return <Pressable style={({ pressed }) => [styles.serviceMiniCard, pressed && styles.pressed]} onPress={onPress}>
    <View style={styles.serviceMiniIcon}><Text style={styles.serviceMiniIconText}>+</Text></View>
    <Text numberOfLines={2} style={styles.serviceMiniTitle}>{service.name}</Text>
    <Text style={styles.serviceMiniCategory}>{service.category.name}</Text>
    <Text style={styles.serviceMiniPrice}>{money(service.price.amount)}</Text>
    <Text numberOfLines={1} style={styles.serviceMiniBranch}>{branch.name}</Text>
  </Pressable>;
}

function ServiceRow({ service, onPress }: { branch: PublicBranch; service: PublicService; onPress: () => void }) {
  return <Pressable style={({ pressed }) => [styles.serviceRow, pressed && styles.pressed]} onPress={onPress}>
    <View style={styles.serviceRowTop}><View style={styles.serviceIcon}><Text style={styles.serviceIconText}>+</Text></View>
      <View style={styles.flexOne}><Text style={styles.serviceCategory}>{service.category.name}</Text>
        <Text style={styles.cardTitle}>{service.name}</Text><Text style={styles.cardBody}>{service.durationMinutes} phút · {serviceTypeLabel(service.type)}</Text></View>
      <Text style={styles.chevron}>›</Text></View>
    <View style={styles.serviceRowBottom}><Text style={styles.effectiveDate}>Hiệu lực {formatDate(service.price.effectiveFrom)}</Text>
      <Text style={styles.rowPrice}>{money(service.price.amount)}</Text></View>
  </Pressable>;
}

function SearchInput({ value, onChangeText, placeholder }: { value: string; onChangeText: (value: string) => void; placeholder: string }) {
  return <View style={styles.listSearch}><Text style={styles.listSearchIcon}>⌕</Text>
    <TextInput autoCapitalize="none" clearButtonMode="while-editing" placeholder={placeholder}
      placeholderTextColor="#82908E" style={styles.listSearchInput} value={value} onChangeText={onChangeText} /></View>;
}

function ChipRow<T>({ items, selectedId, getId, getLabel, onSelect }: {
  items: T[]; selectedId: string; getId: (item: T) => string; getLabel: (item: T) => string; onSelect: (item: T) => void;
}) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
    {items.map((item) => <FilterChip active={selectedId === getId(item)} key={getId(item)}
      label={getLabel(item)} onPress={() => onSelect(item)} />)}
  </ScrollView>;
}

function FilterChip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} hitSlop={4}
    style={[styles.filterChip, active && styles.filterChipActive]} onPress={onPress}>
    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
  </Pressable>;
}

function SectionLabel({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <View style={styles.sectionLabel}><Text style={styles.sectionLabelText}>{title}</Text>
    {action && onAction && <Pressable onPress={onAction}><Text style={styles.seeAll}>{action} ›</Text></Pressable>}</View>;
}

function InfoRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return <View style={[styles.infoRow, last && styles.infoRowLast]}><Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value}</Text></View>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]} onPress={onPress}>
    <Text style={styles.primaryButtonText}>{label}</Text><Text style={styles.primaryButtonArrow}>→</Text>
  </Pressable>;
}

function OutlineButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable style={({ pressed }) => [styles.outlineButton, pressed && styles.pressed]} onPress={onPress}>
    <Text style={styles.outlineButtonText}>{label}</Text><Text style={styles.outlineButtonArrow}>›</Text>
  </Pressable>;
}

function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable style={styles.textButton} onPress={onPress}><Text style={styles.textButtonText}>{label}</Text></Pressable>;
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <View style={styles.errorCard}><Text style={styles.errorSymbol}>!</Text><View style={styles.flexOne}>
    <Text style={styles.errorTitle}>Chưa thể tải dữ liệu</Text><Text style={styles.errorBody}>{message}</Text>
    <Pressable onPress={onRetry}><Text style={styles.retryText}>Thử lại</Text></Pressable></View></View>;
}

function EmptyState({ title, body, compact = false }: { title: string; body: string; compact?: boolean }) {
  return <View style={[styles.emptyState, compact && styles.emptyStateCompact]}><Text style={styles.emptySymbol}>○</Text>
    <Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyBody}>{body}</Text></View>;
}

function FullLoading() {
  return <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.center}>
    <ActivityIndicator color={colors.primary} size="large" /><Text style={styles.loadingText}>Đang tải thông tin…</Text>
  </SafeAreaView>;
}

function InlineLoading() {
  return <View style={styles.inlineLoading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>Đang cập nhật…</Text></View>;
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('vi-VN').trim();
}

function initials(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.slice(-2).map((word) => word[0]?.toLocaleUpperCase('vi-VN')).join('') || 'PK';
}

function money(value: string) {
  return `${Number(value).toLocaleString('vi-VN')} ₫`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-');
  return day && month && year ? `${day}/${month}/${year}` : value;
}

function formatMinutes(value: number) {
  if (value < 60) return `${value} phút`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes ? `${hours} giờ ${minutes} phút` : `${hours} giờ`;
}

function fullAddress(branch: PublicBranch) {
  return [branch.addressLine, branch.ward, branch.district, branch.province].filter(Boolean).join(', ');
}

function serviceTypeLabel(value: PublicService['type']) {
  const labels: Record<PublicService['type'], string> = {
    CONSULTATION: 'Khám bệnh', LAB: 'Xét nghiệm', IMAGING: 'Chẩn đoán hình ảnh',
    PROCEDURE: 'Thủ thuật', VACCINATION: 'Tiêm chủng', OTHER: 'Dịch vụ khác',
  };
  return labels[value];
}

function errorMessage(error: unknown) {
  if (error instanceof ApiClientError) return error.message;
  return 'Vui lòng kiểm tra kết nối và thử lại.';
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  center: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: 24 },
  flexOne: { flex: 1 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.995 }] },
  buttonPressed: { backgroundColor: colors.primaryDark },
  homePage: { paddingBottom: 42 },
  page: { padding: 20, paddingBottom: 48 },
  hero: { backgroundColor: colors.primaryDark, borderBottomLeftRadius: 34, borderBottomRightRadius: 34, overflow: 'hidden', padding: 22, paddingBottom: 30 },
  heroOrbOne: { backgroundColor: '#217565', borderRadius: 140, height: 220, opacity: 0.55, position: 'absolute', right: -86, top: -80, width: 220 },
  heroOrbTwo: { backgroundColor: colors.accent, borderRadius: 60, bottom: 80, height: 80, opacity: 0.18, position: 'absolute', right: 18, width: 80 },
  brandRow: { alignItems: 'center', flexDirection: 'row', gap: 10, marginBottom: 32 },
  brandMark: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: 12, height: 40, justifyContent: 'center', width: 40 },
  brandMarkText: { color: colors.primaryDark, fontSize: 28, fontWeight: '500', lineHeight: 31 },
  brandName: { color: colors.white, fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  brandSub: { color: '#A9C8C1', fontSize: 11, marginTop: 2 },
  heroEyebrow: { color: '#A9D6CC', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  heroTitle: { color: colors.white, fontSize: 31, fontWeight: '900', letterSpacing: -0.7, lineHeight: 38, marginTop: 11 },
  heroBody: { color: '#D2E4E0', fontSize: 14, lineHeight: 22, marginTop: 12, maxWidth: 330 },
  searchBox: { alignItems: 'center', backgroundColor: colors.white, borderRadius: 16, flexDirection: 'row', marginTop: 22, minHeight: 56, paddingLeft: 15, paddingRight: 7, ...cardShadow },
  searchIcon: { color: colors.primary, fontSize: 27, marginRight: 8, transform: [{ rotate: '-15deg' }] },
  searchInput: { color: colors.ink, flex: 1, fontSize: 15, minHeight: 54 },
  searchSubmit: { backgroundColor: colors.primary, borderRadius: 11, paddingHorizontal: 16, paddingVertical: 11 },
  searchSubmitText: { color: colors.white, fontSize: 13, fontWeight: '800' },
  sectionHeader: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: 20, marginBottom: 13, marginTop: 27 },
  kicker: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1.35 },
  sectionTitle: { color: colors.ink, fontSize: 22, fontWeight: '900', letterSpacing: -0.35, marginTop: 4 },
  seeAll: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 20 },
  exploreTile: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.medium, borderWidth: 1, minHeight: 142, padding: 14, position: 'relative', width: '48%', ...cardShadow },
  tileIcon: { alignItems: 'center', borderRadius: 13, height: 42, justifyContent: 'center', width: 42 },
  tileGreen: { backgroundColor: colors.primarySoft }, tileAmber: { backgroundColor: colors.accentSoft },
  tileBlue: { backgroundColor: '#E3EFF7' }, tileRose: { backgroundColor: '#F7E7E5' },
  tileIconText: { color: colors.primaryDark, fontSize: 14, fontWeight: '900' },
  tileTitle: { color: colors.ink, fontSize: 16, fontWeight: '900', marginTop: 13 },
  tileSubtitle: { color: colors.inkMuted, fontSize: 12, marginTop: 3 },
  tileArrow: { color: colors.primary, fontSize: 17, fontWeight: '800', position: 'absolute', right: 13, top: 14 },
  horizontalList: { gap: 12, paddingHorizontal: 20, paddingBottom: 3 },
  serviceMiniCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.medium, borderWidth: 1, padding: 16, width: 210, ...cardShadow },
  serviceMiniIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 11, height: 38, justifyContent: 'center', width: 38 },
  serviceMiniIconText: { color: colors.primary, fontSize: 25, lineHeight: 28 },
  serviceMiniTitle: { color: colors.ink, fontSize: 15, fontWeight: '900', lineHeight: 20, marginTop: 13, minHeight: 40 },
  serviceMiniCategory: { color: colors.inkMuted, fontSize: 11, marginTop: 5 },
  serviceMiniPrice: { color: colors.primary, fontSize: 17, fontWeight: '900', marginTop: 14 },
  serviceMiniBranch: { color: colors.inkMuted, fontSize: 11, marginTop: 3 },
  stackGap: { gap: 11 },
  homeDoctorList: { gap: 11, paddingHorizontal: 20 },
  bookingBanner: { backgroundColor: colors.primary, borderRadius: radii.large, margin: 20, marginTop: 30, overflow: 'hidden', padding: 22 },
  bookingBannerCopy: { maxWidth: 310 },
  bookingBannerEyebrow: { color: '#BCE1D8', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  bookingBannerTitle: { color: colors.white, fontSize: 22, fontWeight: '900', marginTop: 7 },
  bookingBannerBody: { color: '#D8ECE7', fontSize: 13, lineHeight: 20, marginTop: 7 },
  lightButton: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.white, borderRadius: 12, marginTop: 18, paddingHorizontal: 18, paddingVertical: 12 },
  lightButtonText: { color: colors.primaryDark, fontSize: 14, fontWeight: '900' },
  pageIntro: { marginBottom: 18 },
  pageTitle: { color: colors.ink, fontSize: 28, fontWeight: '900', letterSpacing: -0.55, marginTop: 7 },
  pageBody: { color: colors.inkMuted, fontSize: 14, lineHeight: 22, marginTop: 8 },
  listSearch: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 15, borderWidth: 1, flexDirection: 'row', marginBottom: 17, minHeight: 54, paddingHorizontal: 14 },
  listSearchIcon: { color: colors.primary, fontSize: 25, marginRight: 9, transform: [{ rotate: '-15deg' }] },
  listSearchInput: { color: colors.ink, flex: 1, fontSize: 15, minHeight: 52 },
  resultCount: { color: colors.inkMuted, fontSize: 12, fontWeight: '700', marginBottom: 12 },
  branchCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.medium, borderWidth: 1, flexDirection: 'row', gap: 13, padding: 15, ...cardShadow },
  branchNumber: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 14, height: 54, justifyContent: 'center', width: 54 },
  branchNumberAlt: { backgroundColor: colors.accentSoft },
  branchNumberText: { color: colors.primaryDark, fontSize: 16, fontWeight: '900' },
  cardTitle: { color: colors.ink, fontSize: 15, fontWeight: '900', lineHeight: 20 },
  cardBody: { color: colors.inkMuted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  cardMeta: { color: colors.primary, fontSize: 11, fontWeight: '700', marginTop: 6 },
  chevron: { color: colors.primary, fontSize: 27, fontWeight: '300', marginLeft: 4 },
  branchHero: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radii.large, padding: 23 },
  largeBadge: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 24, height: 72, justifyContent: 'center', marginBottom: 16, width: 72 },
  largeBadgeText: { color: colors.white, fontSize: 22, fontWeight: '900' },
  detailEyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  detailTitle: { color: colors.ink, fontSize: 26, fontWeight: '900', letterSpacing: -0.5, marginTop: 7, textAlign: 'center' },
  detailTitleLight: { color: colors.white },
  detailBody: { color: colors.inkMuted, fontSize: 14, lineHeight: 22, marginTop: 9, textAlign: 'center' },
  infoCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.medium, borderWidth: 1, marginTop: 18, paddingHorizontal: 16 },
  infoRow: { borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: 'row', gap: 15, justifyContent: 'space-between', paddingVertical: 15 },
  infoRowLast: { borderBottomWidth: 0 }, infoLabel: { color: colors.inkMuted, flex: 1, fontSize: 13 },
  infoValue: { color: colors.ink, flex: 1.2, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  buttonStack: { gap: 10, marginTop: 19 },
  primaryButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 14, flexDirection: 'row', justifyContent: 'center', marginTop: 20, minHeight: 54, paddingHorizontal: 18 },
  primaryButtonText: { color: colors.white, flex: 1, fontSize: 15, fontWeight: '900', textAlign: 'center' },
  primaryButtonArrow: { color: colors.white, fontSize: 20, position: 'absolute', right: 18 },
  outlineButton: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 14, borderWidth: 1, flexDirection: 'row', minHeight: 52, paddingHorizontal: 16 },
  outlineButtonText: { color: colors.ink, flex: 1, fontSize: 14, fontWeight: '800' },
  outlineButtonArrow: { color: colors.primary, fontSize: 22 },
  textButton: { alignItems: 'center', padding: 13 }, textButtonText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  specialtyCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.medium, borderWidth: 1, flexDirection: 'row', gap: 13, padding: 15 },
  specialtyBadge: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 13, height: 48, justifyContent: 'center', width: 48 },
  specialtyBadgeAmber: { backgroundColor: colors.accentSoft }, specialtyBadgeText: { color: colors.primaryDark, fontSize: 14, fontWeight: '900' },
  softHero: { backgroundColor: colors.primarySoft, borderRadius: radii.large, padding: 22 },
  sectionLabel: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 11, marginTop: 25 },
  sectionLabelText: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  fieldLabel: { color: colors.ink, fontSize: 13, fontWeight: '800', marginBottom: 9, marginTop: 6 },
  chips: { gap: 8, paddingBottom: 4 },
  filterChip: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.pill, borderWidth: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: 14, paddingVertical: 9 },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterChipText: { color: colors.inkMuted, fontSize: 12, fontWeight: '800' }, filterChipTextActive: { color: colors.white },
  priceSummary: { backgroundColor: colors.primaryDark, borderRadius: radii.medium, marginBottom: 16, marginTop: 18, overflow: 'hidden', padding: 17 },
  priceSummaryLabel: { color: '#B8D8D0', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  priceSummaryValue: { color: colors.white, fontSize: 30, fontWeight: '900', marginTop: 2 },
  priceSummaryHint: { color: '#C9DFDA', fontSize: 11, marginTop: 3 },
  serviceRow: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.medium, borderWidth: 1, overflow: 'hidden', padding: 15, ...cardShadow },
  serviceRowTop: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  serviceIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 12, height: 43, justifyContent: 'center', width: 43 },
  serviceIconText: { color: colors.primary, fontSize: 27, lineHeight: 30 },
  serviceCategory: { color: colors.primary, fontSize: 9, fontWeight: '900', letterSpacing: 0.8, marginBottom: 3, textTransform: 'uppercase' },
  serviceRowBottom: { alignItems: 'flex-end', borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 13, paddingTop: 12 },
  effectiveDate: { color: colors.inkMuted, fontSize: 10 }, rowPrice: { color: colors.primaryDark, fontSize: 17, fontWeight: '900' },
  disclaimer: { color: colors.inkMuted, fontSize: 11, fontStyle: 'italic', lineHeight: 17, marginTop: 18, textAlign: 'center' },
  serviceHero: { alignItems: 'center', backgroundColor: colors.primaryDark, borderRadius: radii.large, padding: 23 },
  serviceTypePill: { backgroundColor: '#236D60', borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 6 },
  serviceTypePillText: { color: '#D8ECE7', fontSize: 10, fontWeight: '900' },
  serviceCode: { color: '#BED6D0', fontSize: 11, marginTop: 7 }, heroPrice: { color: colors.accent, fontSize: 29, fontWeight: '900', marginTop: 18 },
  priceAt: { color: '#C9DFDA', fontSize: 11, marginTop: 5, textAlign: 'center' },
  metricRow: { flexDirection: 'row', gap: 10, marginTop: 13 }, metric: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 14, borderWidth: 1, flex: 1, padding: 14 },
  metricLabel: { color: colors.inkMuted, fontSize: 10, fontWeight: '700' }, metricValue: { color: colors.ink, fontSize: 13, fontWeight: '900', marginTop: 5 },
  activeFilter: { alignSelf: 'flex-start', backgroundColor: colors.accentSoft, borderRadius: radii.pill, marginBottom: 14, marginTop: 13, paddingHorizontal: 13, paddingVertical: 8 },
  activeFilterText: { color: '#82591E', fontSize: 11, fontWeight: '800' },
  doctorCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.medium, borderWidth: 1, flexDirection: 'row', gap: 13, padding: 14, ...cardShadow },
  doctorAvatar: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 24, height: 58, justifyContent: 'center', width: 58 },
  doctorAvatarText: { color: colors.primaryDark, fontSize: 16, fontWeight: '900' }, doctorLabel: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 0.8, marginBottom: 3 },
  doctorHero: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radii.large, padding: 24 },
  doctorAvatarLarge: { alignItems: 'center', backgroundColor: colors.primary, borderColor: colors.white, borderRadius: 45, borderWidth: 4, height: 90, justifyContent: 'center', width: 90, ...cardShadow },
  doctorAvatarLargeText: { color: colors.white, fontSize: 25, fontWeight: '900' }, doctorTitle: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1, marginTop: 14, textTransform: 'uppercase' },
  doctorSpecialties: { color: colors.inkMuted, fontSize: 13, marginTop: 7, textAlign: 'center' }, longBody: { color: colors.inkMuted, fontSize: 14, lineHeight: 23 },
  errorCard: { alignItems: 'flex-start', backgroundColor: colors.dangerSoft, borderRadius: radii.medium, flexDirection: 'row', gap: 12, margin: 20, padding: 16 },
  errorSymbol: { color: colors.danger, fontSize: 20, fontWeight: '900' }, errorTitle: { color: colors.danger, fontSize: 14, fontWeight: '900' },
  errorBody: { color: '#744D49', fontSize: 12, lineHeight: 18, marginTop: 4 }, retryText: { color: colors.danger, fontSize: 13, fontWeight: '900', marginTop: 9 },
  emptyState: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.medium, borderWidth: 1, marginTop: 10, padding: 27 },
  emptyStateCompact: { padding: 18 }, emptySymbol: { color: colors.primary, fontSize: 26 }, emptyTitle: { color: colors.ink, fontSize: 15, fontWeight: '900', marginTop: 5 },
  emptyBody: { color: colors.inkMuted, fontSize: 12, lineHeight: 18, marginTop: 5, textAlign: 'center' },
  inlineLoading: { alignItems: 'center', flexDirection: 'row', gap: 9, justifyContent: 'center', padding: 24 }, loadingText: { color: colors.inkMuted, fontSize: 13 },
});
