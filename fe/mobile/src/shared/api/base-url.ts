const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const defaultApiUrl = 'http://localhost:5000/api/v1';

export type ApiBaseUrlOptions = {
  configuredUrl?: string;
  development: boolean;
  platform: string;
  expoHostUri?: string | null;
};

function hostnameFromExpoHostUri(hostUri: string | null | undefined) {
  if (!hostUri?.trim()) return null;
  try {
    const value = hostUri.includes('://') ? hostUri : `http://${hostUri}`;
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function isLanHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (loopbackHosts.has(host)) return true;
  if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^(fc|fd|fe[89ab])/.test(host)) return true;
  return host.endsWith('.local');
}

export function resolveApiBaseUrl({
  configuredUrl,
  development,
  platform,
  expoHostUri,
}: ApiBaseUrlOptions) {
  const explicitUrl = configuredUrl?.trim();
  if (!development && !explicitUrl) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must be configured for preview and production builds.');
  }

  let apiUrl: URL;
  try {
    apiUrl = new URL(explicitUrl || defaultApiUrl);
  } catch {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must be a valid absolute URL.');
  }
  if (!development && apiUrl.protocol !== 'https:') {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must use HTTPS outside development.');
  }

  if (development && platform !== 'web' && loopbackHosts.has(apiUrl.hostname)) {
    const expoHost = hostnameFromExpoHostUri(expoHostUri);
    if (expoHost && isLanHost(expoHost)) apiUrl.hostname = expoHost;
  }

  apiUrl.pathname = apiUrl.pathname.replace(/\/api\/v1\/?$/, '');
  return apiUrl.toString().replace(/\/$/, '');
}
