import type { ViewStyle } from 'react-native';

export const colors = {
  background: '#F4F7F5',
  surface: '#FFFFFF',
  surfaceMuted: '#EAF4F0',
  primary: '#176B5B',
  primaryDark: '#0D4F44',
  primarySoft: '#DCEFE8',
  accent: '#EAA54B',
  accentSoft: '#FFF2DD',
  ink: '#183B39',
  inkMuted: '#647976',
  border: '#D6E3DF',
  danger: '#A33A35',
  dangerSoft: '#FCEBE9',
  success: '#277A5D',
  successSoft: '#E1F3EA',
  white: '#FFFFFF',
} as const;

export const radii = {
  small: 10,
  medium: 16,
  large: 24,
  pill: 999,
} as const;

export const cardShadow: ViewStyle = {
  elevation: 2,
  shadowColor: '#123B34',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.07,
  shadowRadius: 8,
};
