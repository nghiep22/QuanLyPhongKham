import { createApiClient } from '@clinic/generated-api-client';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { authTokenStorage } from '../storage/auth-token';
import { resolveApiBaseUrl } from './base-url';

export const apiClient = createApiClient({
  baseUrl: resolveApiBaseUrl({
    configuredUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
    development: __DEV__,
    platform: Platform.OS,
    expoHostUri: Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost ?? Constants.linkingUri,
  }),
  getAccessToken: authTokenStorage.getAccessToken,
});
