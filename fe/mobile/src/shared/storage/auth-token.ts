import * as SecureStore from 'expo-secure-store';

const accessTokenKey = 'clinic.access-token';
const refreshTokenKey = 'clinic.refresh-token';

export const authTokenStorage = {
  getAccessToken: () => SecureStore.getItemAsync(accessTokenKey),
  getRefreshToken: () => SecureStore.getItemAsync(refreshTokenKey),
  save: async (accessToken: string, refreshToken: string) => {
    await Promise.all([
      SecureStore.setItemAsync(accessTokenKey, accessToken),
      SecureStore.setItemAsync(refreshTokenKey, refreshToken),
    ]);
  },
  clear: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(accessTokenKey),
      SecureStore.deleteItemAsync(refreshTokenKey),
    ]);
  },
};
