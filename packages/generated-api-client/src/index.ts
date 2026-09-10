export type ApiClientOptions = {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null>;
};

export function createApiClient(options: ApiClientOptions) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const accessToken = await options.getAccessToken?.();
    let response: Response;
    try {
      response = await fetch(`${options.baseUrl}${path}`, {
        credentials: 'include',
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
          ...init.headers,
        },
      });
    } catch (cause) {
      throw new ApiNetworkError(cause);
    }

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
      changePassword: (body: import('@clinic/generated-api-types').ChangePasswordRequest) =>
        request<import('@clinic/generated-api-types').PasswordChangedResponse>('/api/v1/auth/password/change', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      requestPasswordReset: (body: import('@clinic/generated-api-types').ForgotPasswordRequest) =>
        request<import('@clinic/generated-api-types').PasswordResetAcceptedResponse>('/api/v1/auth/password/forgot', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      resetPassword: (body: import('@clinic/generated-api-types').ResetPasswordRequest) =>
        request<import('@clinic/generated-api-types').PasswordChangedResponse>('/api/v1/auth/password/reset', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      requestPatientRegistration: (
        body: import('@clinic/generated-api-types').PatientRegistrationRequest,
        idempotencyKey: string,
      ) => request<import('@clinic/generated-api-types').PatientRegistrationAcceptedResponse>(
        '/api/v1/auth/patient-registration/request',
        {
          method: 'POST',
          headers: { 'idempotency-key': idempotencyKey },
          body: JSON.stringify(body),
        },
      ),
      verifyPatientRegistration: (
        body: import('@clinic/generated-api-types').PatientRegistrationVerificationRequest,
      ) => request<import('@clinic/generated-api-types').PatientRegistrationCompletedResponse>(
        '/api/v1/auth/patient-registration/verify',
        { method: 'POST', body: JSON.stringify(body) },
      ),
    },
    patientAccess: {
      references: () => request<import('@clinic/generated-api-types').PatientLinkReferenceResponse>(
        '/api/v1/patient-access/reference-data',
      ),
      get: () => request<import('@clinic/generated-api-types').PatientAccessResponse>(
        '/api/v1/patient-access',
      ),
      requestLink: (body: import('@clinic/generated-api-types').CreatePatientLinkRequest, idempotencyKey: string) =>
        request<import('@clinic/generated-api-types').PatientLinkRequestAcceptedResponse>(
          '/api/v1/patient-access/requests',
          { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(body) },
        ),
      cancelRequest: (requestId: string) =>
        request<import('@clinic/generated-api-types').PatientLinkCancelledResponse>(
          `/api/v1/patient-access/requests/${encodeURIComponent(requestId)}`,
          { method: 'DELETE' },
        ),
      revokeLink: (linkId: string, body: import('@clinic/generated-api-types').PatientLinkReasonRequest) =>
        request<import('@clinic/generated-api-types').PatientLinkRevokedResponse>(
          `/api/v1/patient-access/links/${encodeURIComponent(linkId)}`,
          { method: 'DELETE', body: JSON.stringify(body) },
        ),
    },
    patientLinkAdmin: {
      references: () => request<import('@clinic/generated-api-types').PatientLinkReferenceResponse>(
        '/api/v1/admin/patient-link-requests/reference-data',
      ),
      list: (query: {
        branchPublicId: string;
        status?: import('@clinic/generated-api-types').PatientLinkRequestStatus;
        page?: number;
        pageSize?: number;
      }) => {
        const search = new URLSearchParams();
        Object.entries(query).forEach(([key, value]) => {
          if (value !== undefined && value !== '') search.set(key, String(value));
        });
        return request<import('@clinic/generated-api-types').StaffPatientLinkRequestListResponse>(
          `/api/v1/admin/patient-link-requests?${search.toString()}`,
        );
      },
      decide: (requestId: string, body: import('@clinic/generated-api-types').PatientLinkDecisionRequest,
        rowVersion: string) => request<import('@clinic/generated-api-types').PatientLinkDecisionResponse>(
        `/api/v1/admin/patient-link-requests/${encodeURIComponent(requestId)}/decision`,
        { method: 'POST', headers: { 'if-match': `"${rowVersion}"` }, body: JSON.stringify(body) },
      ),
      revokeLink: (linkId: string, body: import('@clinic/generated-api-types').PatientLinkReasonRequest) =>
        request<import('@clinic/generated-api-types').PatientLinkRevokedResponse>(
          `/api/v1/admin/patient-links/${encodeURIComponent(linkId)}`,
          { method: 'DELETE', body: JSON.stringify(body) },
        ),
    },
    publicCatalog: {
      branches: () => request<import('@clinic/generated-api-types').PublicBranchListResponse>(
        '/api/v1/public/branches',
      ),
      specialties: () => request<import('@clinic/generated-api-types').PublicSpecialtyListResponse>(
        '/api/v1/public/specialties',
      ),
      services: (query: { branchPublicId: string; specialtyPublicId?: string; query?: string }) => {
        const search = new URLSearchParams();
        Object.entries(query).forEach(([key, value]) => {
          if (value !== undefined && value !== '') search.set(key, value);
        });
        return request<import('@clinic/generated-api-types').PublicServiceListResponse>(
          `/api/v1/public/services?${search.toString()}`,
        );
      },
      doctors: (query: {
        branchPublicId?: string; specialtyPublicId?: string; servicePublicId?: string; query?: string;
      } = {}) => {
        const search = new URLSearchParams();
        Object.entries(query).forEach(([key, value]) => {
          if (value !== undefined && value !== '') search.set(key, value);
        });
        const suffix = search.size ? `?${search.toString()}` : '';
        return request<import('@clinic/generated-api-types').PublicDoctorListResponse>(
          `/api/v1/public/doctors${suffix}`,
        );
      },
    },
    catalog: {
      references: () => request<import('@clinic/generated-api-types').CatalogReferenceResponse>(
        '/api/v1/admin/catalog/reference-data',
      ),
      rooms: (branchPublicId: string) => request<import('@clinic/generated-api-types').CatalogRoomListResponse>(
        `/api/v1/admin/catalog/rooms?${new URLSearchParams({ branchPublicId }).toString()}`,
      ),
      createRoom: (body: import('@clinic/generated-api-types').CreateCatalogRoomRequest) =>
        request<import('@clinic/generated-api-types').CatalogRoomResponse>('/api/v1/admin/catalog/rooms', {
          method: 'POST', body: JSON.stringify(body),
        }),
      updateRoom: (roomId: string, body: import('@clinic/generated-api-types').UpdateCatalogRoomRequest,
        rowVersion: string) => request<import('@clinic/generated-api-types').CatalogRoomResponse>(
          `/api/v1/admin/catalog/rooms/${encodeURIComponent(roomId)}`,
          { method: 'PUT', headers: { 'if-match': `"${rowVersion}"` }, body: JSON.stringify(body) },
        ),
      services: (branchPublicId: string) => request<import('@clinic/generated-api-types').CatalogServiceListResponse>(
        `/api/v1/admin/catalog/services?${new URLSearchParams({ branchPublicId }).toString()}`,
      ),
      createService: (branchPublicId: string, body: import('@clinic/generated-api-types').CreateCatalogServiceRequest) =>
        request<import('@clinic/generated-api-types').CatalogServiceResponse>(
          `/api/v1/admin/catalog/services?${new URLSearchParams({ branchPublicId }).toString()}`,
          { method: 'POST', body: JSON.stringify(body) },
        ),
      updateService: (serviceId: string, branchPublicId: string,
        body: import('@clinic/generated-api-types').UpdateCatalogServiceRequest, rowVersion: string) =>
        request<import('@clinic/generated-api-types').CatalogServiceResponse>(
          `/api/v1/admin/catalog/services/${encodeURIComponent(serviceId)}?${new URLSearchParams({ branchPublicId }).toString()}`,
          { method: 'PUT', headers: { 'if-match': `"${rowVersion}"` }, body: JSON.stringify(body) },
        ),
      setBranchPrice: (serviceId: string, body: import('@clinic/generated-api-types').SetCatalogBranchPriceRequest) =>
        request<import('@clinic/generated-api-types').CatalogServiceResponse>(
          `/api/v1/admin/catalog/services/${encodeURIComponent(serviceId)}/prices`,
          { method: 'POST', body: JSON.stringify(body) },
        ),
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

export class ApiNetworkError extends Error {
  constructor(cause: unknown) {
    super('The API could not be reached.', { cause });
    this.name = 'ApiNetworkError';
  }
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
