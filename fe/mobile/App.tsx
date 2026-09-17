import type { AuthResponse, AuthenticatedUser } from '@clinic/generated-api-types';
import { ApiClientError } from '@clinic/generated-api-client';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  LoginScreen,
  RegistrationScreen,
  type RootStackParamList,
  WelcomeScreen,
} from './src/features/auth/patient-auth';
import { ChangePasswordScreen } from './src/features/auth/change-password-screen';
import { apiClient } from './src/shared/api/client';
import { authTokenStorage } from './src/shared/storage/auth-token';
import { DiscoveryNavigator } from './src/features/discovery/discovery-screens';
import type { BookingIntent } from './src/features/discovery/discovery-screens';
import { PatientTabs } from './src/features/home/patient-tabs';

const Stack = createNativeStackNavigator<RootStackParamList>();
const queryClient = new QueryClient();

function MobileApp() {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [guestInitialRoute, setGuestInitialRoute] = useState<'Welcome' | 'Login'>('Welcome');
  const [loginNotice, setLoginNotice] = useState<string>();
  const [pendingBookingIntent, setPendingBookingIntent] = useState<BookingIntent>();
  const clearPendingBookingIntent = useCallback(() => setPendingBookingIntent(undefined), []);

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
    setLoginNotice(undefined);
    setGuestInitialRoute('Welcome');
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
      queryClient.clear();
      setPendingBookingIntent(undefined);
      setLoginNotice(undefined);
      setGuestInitialRoute('Welcome');
      setUser(null);
    }
  };

  const passwordChanged = async () => {
    await authTokenStorage.clear();
    queryClient.clear();
    setPendingBookingIntent(undefined);
    setLoginNotice('Đổi mật khẩu thành công. Tất cả phiên cũ đã được thu hồi; vui lòng đăng nhập lại.');
    setGuestInitialRoute('Login');
    setUser(null);
  };

  if (restoring) {
    return <SafeAreaView style={styles.loading}><ActivityIndicator size="large" color="#167665" />
      <Text style={styles.body}>Đang khôi phục phiên đăng nhập…</Text>
    </SafeAreaView>;
  }

  return <NavigationContainer>
    <StatusBar style="dark" />
    <Stack.Navigator key={user ? 'patient' : `guest-${guestInitialRoute}`}
      initialRouteName={user ? 'PatientHome' : guestInitialRoute}
      screenOptions={{ headerShadowVisible: false, headerTintColor: '#155f55' }}>
      {user ? <>
        <Stack.Screen name="PatientHome" options={{ headerShown: false }}>
          {({ navigation }) => <PatientTabs user={user} onLogout={logout}
            onOpenSecurity={() => navigation.navigate('AccountSecurity')}
            initialBookingIntent={pendingBookingIntent}
            onBookingIntentHandled={clearPendingBookingIntent} />}
        </Stack.Screen>
        <Stack.Screen name="AccountSecurity" options={{ title: 'Bảo mật tài khoản' }}>
          {(props) => <ChangePasswordScreen {...props} onPasswordChanged={passwordChanged} />}
        </Stack.Screen>
      </> : <>
        <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
        <Stack.Screen name="GuestExplore" options={{ headerShown: false }}>
          {({ navigation }) => <DiscoveryNavigator onBook={(intent) => {
            setPendingBookingIntent(intent);
            navigation.navigate('Login');
          }} />}
        </Stack.Screen>
        <Stack.Screen name="Login" initialParams={loginNotice ? { notice: loginNotice } : undefined}
          options={{ title: 'Đăng nhập' }}>
          {(props) => <LoginScreen {...props} onAuthenticated={authenticated} />}
        </Stack.Screen>
        <Stack.Screen name="Register" component={RegistrationScreen} options={{ title: 'Đăng ký bệnh nhân' }} />
      </>}
    </Stack.Navigator>
  </NavigationContainer>;
}

export default function App() {
  return <SafeAreaProvider>
    <QueryClientProvider client={queryClient}><MobileApp /></QueryClientProvider>
  </SafeAreaProvider>;
}

const styles = StyleSheet.create({
  loading: { alignItems: 'center', backgroundColor: '#f1f8f6', flex: 1, gap: 14, justifyContent: 'center' },
  body: { color: '#60747a', fontSize: 16, lineHeight: 25, marginTop: 14 },
});
