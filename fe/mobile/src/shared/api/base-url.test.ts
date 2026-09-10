import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl } from './base-url';

describe('resolveApiBaseUrl', () => {
  it('uses the Expo development host for a native app configured with localhost', () => {
    expect(resolveApiBaseUrl({
      configuredUrl: 'http://localhost:5000/api/v1',
      development: true,
      platform: 'android',
      expoHostUri: '192.168.1.119:8081',
    })).toBe('http://192.168.1.119:5000');
  });

  it('keeps localhost for web development', () => {
    expect(resolveApiBaseUrl({
      configuredUrl: 'http://localhost:5000/api/v1',
      development: true,
      platform: 'web',
      expoHostUri: '192.168.1.119:8081',
    })).toBe('http://localhost:5000');
  });

  it('does not replace an explicitly reachable API host', () => {
    expect(resolveApiBaseUrl({
      configuredUrl: 'https://api.clinic.example/api/v1/',
      development: true,
      platform: 'ios',
      expoHostUri: '192.168.1.119:8081',
    })).toBe('https://api.clinic.example');
  });

  it('falls back safely when Expo does not provide a development host', () => {
    expect(resolveApiBaseUrl({
      development: true,
      platform: 'android',
      expoHostUri: null,
    })).toBe('http://localhost:5000');
  });

  it('does not treat an Expo tunnel as the API host', () => {
    expect(resolveApiBaseUrl({
      development: true,
      platform: 'android',
      expoHostUri: 'example.exp.direct:443',
    })).toBe('http://localhost:5000');
  });

  it('requires an explicit HTTPS endpoint outside development', () => {
    expect(() => resolveApiBaseUrl({ development: false, platform: 'android' }))
      .toThrow('must be configured');
    expect(() => resolveApiBaseUrl({
      configuredUrl: 'http://api.clinic.example/api/v1',
      development: false,
      platform: 'android',
    })).toThrow('must use HTTPS');
  });

  it('reports an invalid configured URL clearly', () => {
    expect(() => resolveApiBaseUrl({
      configuredUrl: 'not a URL',
      development: true,
      platform: 'android',
    })).toThrow('valid absolute URL');
  });
});
