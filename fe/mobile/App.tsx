import type { AuthResponse, AuthenticatedUser } from '@clinic/generated-api-types';
import { ApiClientError } from '@clinic/generated-api-client';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import {
  LoginScreen,
  PatientHomeScreen,
  RegistrationScreen,
  type RootStackParamList,
  WelcomeScreen,
} from './src/features/auth/patient-auth';
import { apiClient } from './src/shared/api/client';
import { authTokenStorage } from './src/shared/storage/auth-token';
import { PatientAccessScreen } from './src/features/patient-access/patient-access-screen';

const Stack = createNativeStackNavigator<RootStackParamList>();
const queryClient = new QueryClient();

function BookingScreen() {
  return <SafeAreaView style={styles.screen}><View style={styles.card}>
    <Text style={styles.cardTitle}>Tài khoản đã sẵn sàng đặt lịch</Text>
    <Text style={styles.body}>Lát cắt tiếp theo sẽ nối các bước chọn chi nhánh, dịch vụ, bác sĩ và khung giờ với Clinic API.</Text>
  </View></SafeAreaView>;
}

function MobileApp() {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const refreshToken = await authTokenStorage.getRefreshToken();
        if (!refreshToken) return;
        const response = await apiClient.auth.refresh({ refreshToken });
        if (!response.data.refreshToken) throw new Error('Mobile refresh token is missing.');
        if (!response.data.user.roles.some((role) => role.code === 'PATIENT')) {
          await apiClient.auth.logout({ refreshToken: response.data.refreshToken }).catch(() => undefined);
          throw new Error('Patient role is required.');
        }
        await authTokenStorage.save(response.data.accessToken, response.data.refreshToken);
        if (active) setUser(response.data.user);
      } catch {
        await authTokenStorage.clear();
      } finally {
        if (active) setRestoring(false);
      }
    };
    void restore();
    return () => { active = false; };
  }, []);

  const authenticated = async (response: AuthResponse) => {
    if (!response.data.refreshToken) throw new Error('Mobile refresh token is missing.');
    if (!response.data.user.roles.some((role) => role.code === 'PATIENT')) {
      await apiClient.auth.logout({ refreshToken: response.data.refreshToken }).catch(() => undefined);
      throw new ApiClientError(403, 'PATIENT_ACCOUNT_REQUIRED', 'Ứng dụng chỉ dành cho tài khoản bệnh nhân.');
    }
    await authTokenStorage.save(response.data.accessToken, response.data.refreshToken);
    setUser(response.data.user);
  };

  const logout = async () => {
    const refreshToken = await authTokenStorage.getRefreshToken();
    try {
      await apiClient.auth.logout(refreshToken ? { refreshToken } : {});
    } catch {
      // Local credentials must still be removed when the network is unavailable.
    } finally {
      await authTokenStorage.clear();
      setUser(null);
    }
  };

  if (restoring) {
    return <SafeAreaView style={styles.loading}><ActivityIndicator size="large" color="#167665" />
      <Text style={styles.body}>Đang khôi phục phiên đăng nhập…</Text>
    </SafeAreaView>;
  }

  return <NavigationContainer>
    <StatusBar style="dark" />
    <Stack.Navigator screenOptions={{ headerShadowVisible: false, headerTintColor: '#155f55' }}>
      {user ? <>
        <Stack.Screen name="PatientHome" options={{ title: 'Cổng bệnh nhân' }}>
          {({ navigation }) => <PatientHomeScreen user={user} onLogout={logout} navigation={navigation} />}
        </Stack.Screen>
        <Stack.Screen name="PatientProfiles" component={PatientAccessScreen} options={{ title: 'Hồ sơ được ủy quyền' }} />
        <Stack.Screen name="Booking" component={BookingScreen} options={{ title: 'Đặt lịch khám' }} />
      </> : <>
        <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Login" options={{ title: 'Đăng nhập' }}>
          {(props) => <LoginScreen {...props} onAuthenticated={authenticated} />}
        </Stack.Screen>
        <Stack.Screen name="Register" component={RegistrationScreen} options={{ title: 'Đăng ký bệnh nhân' }} />
      </>}
    </Stack.Navigator>
  </NavigationContainer>;
}

export default function App() {
  return <QueryClientProvider client={queryClient}><MobileApp /></QueryClientProvider>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f1f8f6' },
  loading: { alignItems: 'center', backgroundColor: '#f1f8f6', flex: 1, gap: 14, justifyContent: 'center' },
  body: { color: '#60747a', fontSize: 16, lineHeight: 25, marginTop: 14 },
  card: { backgroundColor: 'white', borderRadius: 20, margin: 24, padding: 24 },
  cardTitle: { color: '#183a45', fontSize: 22, fontWeight: '800' },
});
