import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

type RootStackParamList = {
  Welcome: undefined;
  Booking: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const queryClient = new QueryClient();

function WelcomeScreen({ navigation }: { navigation: { navigate: (screen: 'Booking') => void } }) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>PHÒNG KHÁM TƯ NHÂN</Text>
        <Text style={styles.title}>Chăm sóc sức khỏe, chủ động từng lịch hẹn.</Text>
        <Text style={styles.body}>Đặt lịch khám online, theo dõi lượt khám và xem hướng dẫn sau khám tại một nơi.</Text>
        <Pressable style={styles.button} onPress={() => navigation.navigate('Booking')}>
          <Text style={styles.buttonText}>Đặt lịch khám</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function BookingScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Luồng đặt lịch đã sẵn sàng</Text>
        <Text style={styles.body}>Các bước chọn chuyên khoa, bác sĩ, khung giờ và xác nhận sẽ được nối với Clinic API.</Text>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>
        <StatusBar style="dark" />
        <Stack.Navigator screenOptions={{ headerShadowVisible: false, headerTintColor: '#155f55' }}>
          <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Booking" component={BookingScreen} options={{ title: 'Đặt lịch khám' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f1f8f6' },
  hero: { flex: 1, justifyContent: 'center', padding: 28 },
  eyebrow: { color: '#15806f', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: '#183a45', fontSize: 34, fontWeight: '800', lineHeight: 42, marginTop: 12 },
  body: { color: '#60747a', fontSize: 16, lineHeight: 25, marginTop: 14 },
  button: { alignItems: 'center', backgroundColor: '#167665', borderRadius: 14, marginTop: 30, padding: 16 },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '800' },
  card: { backgroundColor: 'white', borderRadius: 20, margin: 24, padding: 24 },
  cardTitle: { color: '#183a45', fontSize: 22, fontWeight: '800' },
});
