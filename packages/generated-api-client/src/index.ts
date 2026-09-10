export type ApiClientOptions = {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null>;
};

export * from './generated/sdk.gen.js';
export { client as generatedClient } from './generated/client.gen.js';

export function createApiClient(options: ApiClientOptions) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const accessToken = await options.getAccessToken?.();
    const response = await fetch(`${options.baseUrl}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => undefined) as
        | { error?: { code?: string; message?: string }; requestId?: string }
        | undefined;
      throw new ApiClientError(
        response.status,
        body?.error?.code ?? 'HTTP_ERROR',
        body?.error?.message ?? `API request failed with status ${response.status}`,
        body?.requestId ?? response.headers.get('x-request-id') ?? undefined,
      );
    }

    return response.json() as Promise<T>;
  }

  return {
    request,
    auth: {
      login: (body: import('@clinic/generated-api-types').LoginRequest) =>
        request<import('@clinic/generated-api-types').AuthResponse>('/api/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      refresh: (body: import('@clinic/generated-api-types').RefreshRequest = {}) =>
        request<import('@clinic/generated-api-types').AuthResponse>('/api/v1/auth/refresh', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      logout: (body: import('@clinic/generated-api-types').RefreshRequest = {}) =>
        request<import('@clinic/generated-api-types').LogoutResponse>('/api/v1/auth/logout', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      logoutAll: () =>
        request<import('@clinic/generated-api-types').LogoutAllResponse>('/api/v1/auth/logout-all', {
          method: 'POST',
        }),
    },
    staff: {
      references: () =>
        request<import('@clinic/generated-api-types').StaffReferenceResponse>(
          '/api/v1/admin/staff/reference-data',
        ),
      list: (query: {
        query?: string;
        branchPublicId?: string;
        employeeType?: import('@clinic/generated-api-types').EmployeeType;
        accountStatus?: import('@clinic/generated-api-types').AccountStatus;
        page?: number;
        pageSize?: number;
      } = {}) => {
        const search = new URLSearchParams();
        Object.entries(query).forEach(([key, value]) => {
          if (value !== undefined && value !== '') search.set(key, String(value));
        });
        const suffix = search.size ? `?${search.toString()}` : '';
        return request<import('@clinic/generated-api-types').StaffListResponse>(
          `/api/v1/admin/staff${suffix}`,
        );
      },
      get: (staffId: string) =>
        request<import('@clinic/generated-api-types').StaffResponse>(
          `/api/v1/admin/staff/${encodeURIComponent(staffId)}`,
        ),
      create: (body: import('@clinic/generated-api-types').CreateStaffRequestWritable) =>
        request<import('@clinic/generated-api-types').StaffResponse>('/api/v1/admin/staff', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      update: (
        staffId: string,
        body: import('@clinic/generated-api-types').UpdateStaffRequest,
        employeeRowVersion: string,
        doctorRowVersion?: string,
      ) =>
        request<import('@clinic/generated-api-types').StaffResponse>(
          `/api/v1/admin/staff/${encodeURIComponent(staffId)}`,
          {
            method: 'PUT',
            headers: { 'if-match': `"${employeeRowVersion}${doctorRowVersion ? `:${doctorRowVersion}` : ''}"` },
            body: JSON.stringify(body),
          },
        ),
      setStatus: (userId: string, body: import('@clinic/generated-api-types').SetAccountStatusRequest) =>
        request<import('@clinic/generated-api-types').StaffResponse>(
          `/api/v1/admin/users/${encodeURIComponent(userId)}/status`,
          { method: 'PUT', body: JSON.stringify(body) },
        ),
      unlock: (userId: string, body: import('@clinic/generated-api-types').ReasonRequest) =>
        request<import('@clinic/generated-api-types').StaffResponse>(
          `/api/v1/admin/users/${encodeURIComponent(userId)}/unlock`,
          { method: 'POST', body: JSON.stringify(body) },
        ),
      grantRole: (userId: string, body: import('@clinic/generated-api-types').GrantRoleRequest) =>
        request<import('@clinic/generated-api-types').StaffResponse>(
          `/api/v1/admin/users/${encodeURIComponent(userId)}/roles`,
          { method: 'POST', body: JSON.stringify(body) },
        ),
      revokeRole: (userId: string, assignmentId: string, body: import('@clinic/generated-api-types').ReasonRequest) =>
        request<import('@clinic/generated-api-types').StaffResponse>(
          `/api/v1/admin/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(assignmentId)}`,
          { method: 'DELETE', body: JSON.stringify(body) },
        ),
    },
    health: {
      live: () => request<import('@clinic/generated-api-types').HealthResponse>('/health/live'),
      ready: () => request<import('@clinic/generated-api-types').ReadinessResponse>('/health/ready'),
    },
  };
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId?: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}
