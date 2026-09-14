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
      availability: (query: {
        branchPublicId: string; servicePublicId: string; doctorPublicId?: string; fromDate: string; toDate: string;
      }) => request<import('@clinic/generated-api-types').AvailabilityListResponse>(
        `/api/v1/public/availability?${new URLSearchParams(Object.entries(query)
          .filter(([, value]) => value !== undefined) as Array<[string, string]>).toString()}`,
      ),
    },
    appointments: {
      list: () => request<import('@clinic/generated-api-types').AppointmentListResponse>('/api/v1/appointments'),
      book: (body: import('@clinic/generated-api-types').BookAppointmentRequest, idempotencyKey: string) =>
        request<import('@clinic/generated-api-types').AppointmentResponse>('/api/v1/appointments', {
          method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(body),
        }),
      reschedule: (appointmentId: string, body: import('@clinic/generated-api-types').RescheduleAppointmentRequest,
        idempotencyKey: string) => request<import('@clinic/generated-api-types').AppointmentResponse>(
        `/api/v1/appointments/${encodeURIComponent(appointmentId)}/reschedule`,
        { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(body) },
      ),
      cancel: (appointmentId: string, body: import('@clinic/generated-api-types').AppointmentReasonRequest) =>
        request<import('@clinic/generated-api-types').AppointmentResponse>(
          `/api/v1/appointments/${encodeURIComponent(appointmentId)}/cancel`,
          { method: 'POST', body: JSON.stringify(body) },
        ),
    },
    appointmentAdmin: {
      list: (query: { branchPublicId: string; serviceDate: string;
        status?: import('@clinic/generated-api-types').AppointmentStatus; query?: string }) => {
        const search = new URLSearchParams();
        Object.entries(query).forEach(([name, value]) => { if (value) search.set(name, value); });
        return request<import('@clinic/generated-api-types').AppointmentListResponse>(
          `/api/v1/admin/appointments?${search.toString()}`,
        );
      },
      book: (body: import('@clinic/generated-api-types').BookStaffAppointmentRequest, idempotencyKey: string) =>
        request<import('@clinic/generated-api-types').AppointmentResponse>('/api/v1/admin/appointments', {
          method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(body),
        }),
      confirm: (appointmentId: string) => request<import('@clinic/generated-api-types').AppointmentResponse>(
        `/api/v1/admin/appointments/${encodeURIComponent(appointmentId)}/confirm`, { method: 'POST' },
      ),
      reschedule: (appointmentId: string, body: import('@clinic/generated-api-types').RescheduleAppointmentRequest,
        idempotencyKey: string) => request<import('@clinic/generated-api-types').AppointmentResponse>(
        `/api/v1/admin/appointments/${encodeURIComponent(appointmentId)}/reschedule`,
        { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(body) },
      ),
      cancel: (appointmentId: string, body: import('@clinic/generated-api-types').AppointmentReasonRequest) =>
        request<import('@clinic/generated-api-types').AppointmentResponse>(
          `/api/v1/admin/appointments/${encodeURIComponent(appointmentId)}/cancel`,
          { method: 'POST', body: JSON.stringify(body) },
        ),
      noShow: (appointmentId: string, body: import('@clinic/generated-api-types').OptionalAppointmentReasonRequest = {}) =>
        request<import('@clinic/generated-api-types').AppointmentResponse>(
          `/api/v1/admin/appointments/${encodeURIComponent(appointmentId)}/no-show`,
          { method: 'POST', body: JSON.stringify(body) },
        ),
    },
    scheduling: {
      get: (branchPublicId: string) => request<import('@clinic/generated-api-types').SchedulingResponse>(
        `/api/v1/schedules?${new URLSearchParams({ branchPublicId }).toString()}`,
      ),
      create: (body: import('@clinic/generated-api-types').CreateWorkingScheduleRequest) =>
        request<import('@clinic/generated-api-types').CreatedScheduleResponse>('/api/v1/schedules', {
          method: 'POST', body: JSON.stringify(body),
        }),
      generateSlots: (scheduleId: string, body: import('@clinic/generated-api-types').GenerateSlotsRequest) =>
        request<import('@clinic/generated-api-types').GeneratedSlotsResponse>(
          `/api/v1/schedules/${encodeURIComponent(scheduleId)}/generate-slots`,
          { method: 'POST', body: JSON.stringify(body) },
        ),
    },
    reception: {
      branches: () => request<import('@clinic/generated-api-types').ReceptionBranchListResponse>(
        '/api/v1/reception/branches',
      ),
      get: (branchPublicId: string) => request<import('@clinic/generated-api-types').ReceptionWorkspaceResponse>(
        `/api/v1/reception?${new URLSearchParams({ branchPublicId }).toString()}`,
      ),
      searchPatients: (branchPublicId: string, query: string) =>
        request<import('@clinic/generated-api-types').ReceptionPatientListResponse>(
          `/api/v1/reception/patients?${new URLSearchParams({ branchPublicId, query }).toString()}`,
        ),
      checkIn: (appointmentId: string, body: import('@clinic/generated-api-types').AppointmentCheckInRequest,
        idempotencyKey: string) => request<import('@clinic/generated-api-types').QueueCommandResponse>(
        `/api/v1/check-ins/appointments/${encodeURIComponent(appointmentId)}`,
        { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(body) },
      ),
      createWalkIn: (body: import('@clinic/generated-api-types').CreateWalkInRequest, idempotencyKey: string) =>
        request<import('@clinic/generated-api-types').QueueCommandResponse>('/api/v1/check-ins/walk-ins', {
          method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(body),
        }),
      callNext: (body: import('@clinic/generated-api-types').CallNextQueueRequest) =>
        request<import('@clinic/generated-api-types').NullableQueueCommandResponse>('/api/v1/queues/call-next', {
          method: 'POST', body: JSON.stringify(body),
        }),
    },
    pharmacy: {
      branches: () => request<import('@clinic/generated-api-types').PharmacyBranchListResponse>('/api/v1/pharmacy/branches'),
      workspace: (branchPublicId: string) => request<import('@clinic/generated-api-types').PharmacyWorkspaceResponse>(
        `/api/v1/pharmacy/workspace?${new URLSearchParams({ branchPublicId })}`),
      reconcile: (branchPublicId: string) => request<import('@clinic/generated-api-types').PharmacyReconciliationResponse>(
        `/api/v1/pharmacy/reconciliation?${new URLSearchParams({ branchPublicId })}`),
      getPrescription: (id: string) => request<import('@clinic/generated-api-types').PrescriptionDetailResponse>(
        `/api/v1/prescriptions/${encodeURIComponent(id)}`),
      createMedicine: (body: import('@clinic/generated-api-types').CreateMedicineRequest) =>
        request<import('@clinic/generated-api-types').PharmacyResourceResponse>('/api/v1/pharmacy/medicines',
          { method: 'POST', body: JSON.stringify(body) }),
      createBatch: (body: import('@clinic/generated-api-types').CreateMedicineBatchRequest) =>
        request<import('@clinic/generated-api-types').PharmacyResourceResponse>('/api/v1/pharmacy/batches',
          { method: 'POST', body: JSON.stringify(body) }),
      createLocation: (body: import('@clinic/generated-api-types').CreatePharmacyLocationRequest) =>
        request<import('@clinic/generated-api-types').PharmacyResourceResponse>('/api/v1/pharmacy/locations',
          { method: 'POST', body: JSON.stringify(body) }),
      receive: (body: import('@clinic/generated-api-types').ReceiveStockRequest, idempotencyKey = crypto.randomUUID()) =>
        request<import('@clinic/generated-api-types').PharmacyResourceResponse>('/api/v1/pharmacy/receipts',
          { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(body) }),
      createPrescription: (encounterId: string, body: import('@clinic/generated-api-types').CreatePrescriptionRequest) =>
        request<import('@clinic/generated-api-types').PrescriptionDetailResponse>(
          `/api/v1/encounters/${encodeURIComponent(encounterId)}/prescriptions`,
          { method: 'POST', body: JSON.stringify(body) }),
      addItem: (prescriptionId: string, body: import('@clinic/generated-api-types').AddPrescriptionItemRequest) =>
        request<import('@clinic/generated-api-types').PrescriptionDetailResponse>(
          `/api/v1/prescriptions/${encodeURIComponent(prescriptionId)}/items`,
          { method: 'POST', body: JSON.stringify(body) }),
      issue: (prescriptionId: string) => request<import('@clinic/generated-api-types').PrescriptionDetailResponse>(
        `/api/v1/prescriptions/${encodeURIComponent(prescriptionId)}/issue`, { method: 'POST' }),
      cancelPrescription: (prescriptionId: string, reason: string) =>
        request<import('@clinic/generated-api-types').PrescriptionDetailResponse>(
          `/api/v1/prescriptions/${encodeURIComponent(prescriptionId)}/cancel`,
          { method: 'POST', body: JSON.stringify({ reason }) }),
      openDispensation: (prescriptionId: string, locationPublicId: string) =>
        request<import('@clinic/generated-api-types').PharmacyResourceResponse>(
          `/api/v1/prescriptions/${encodeURIComponent(prescriptionId)}/dispensations`,
          { method: 'POST', body: JSON.stringify({ locationPublicId }) }),
      dispense: (dispensationId: string, body: import('@clinic/generated-api-types').DispenseItemRequest,
        idempotencyKey = crypto.randomUUID()) =>
        request<import('@clinic/generated-api-types').PharmacyResourceResponse>(
          `/api/v1/dispensations/${encodeURIComponent(dispensationId)}/items`,
          { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(body) }),
      completeDispensation: (dispensationId: string) =>
        request<import('@clinic/generated-api-types').PharmacyStatusResponse>(
          `/api/v1/dispensations/${encodeURIComponent(dispensationId)}/complete`, { method: 'POST' }),
      cancelDispensation: (dispensationId: string, reason: string) =>
        request<import('@clinic/generated-api-types').PharmacyStatusResponse>(
          `/api/v1/dispensations/${encodeURIComponent(dispensationId)}/cancel`,
          { method: 'POST', body: JSON.stringify({ reason }) }),
      reverse: (itemId: string, body: import('@clinic/generated-api-types').ReverseDispensationRequest) =>
        request<import('@clinic/generated-api-types').PharmacyResourceResponse>(
          `/api/v1/pharmacy/dispensation-items/${encodeURIComponent(itemId)}/reverse`,
          { method: 'POST', body: JSON.stringify(body) }),
    },
    billing: {
      branches: () => request<import('@clinic/generated-api-types').BillingBranchListResponse>(
        '/api/v1/billing/branches'),
      workspace: (branchPublicId: string) => request<import('@clinic/generated-api-types').BillingWorkspaceResponse>(
        `/api/v1/billing/workspace?${new URLSearchParams({ branchPublicId })}`),
      get: (invoiceId: string) => request<import('@clinic/generated-api-types').InvoiceDetailResponse>(
        `/api/v1/invoices/${encodeURIComponent(invoiceId)}`),
      create: (encounterId: string, body: import('@clinic/generated-api-types').CreateInvoiceRequest = {}) =>
        request<import('@clinic/generated-api-types').InvoiceDetailResponse>(
          `/api/v1/encounters/${encodeURIComponent(encounterId)}/invoices`,
          { method: 'POST', body: JSON.stringify(body) }),
      synchronize: (invoiceId: string) => request<import('@clinic/generated-api-types').InvoiceDetailResponse>(
        `/api/v1/invoices/${encodeURIComponent(invoiceId)}/synchronize`, { method: 'POST' }),
      addItem: (invoiceId: string, body: import('@clinic/generated-api-types').ManualInvoiceItemRequest) =>
        request<import('@clinic/generated-api-types').InvoiceDetailResponse>(
          `/api/v1/invoices/${encodeURIComponent(invoiceId)}/items`,
          { method: 'POST', body: JSON.stringify(body) }),
      setInsurance: (invoiceId: string, body: import('@clinic/generated-api-types').InvoiceInsuranceRequest) =>
        request<import('@clinic/generated-api-types').InvoiceDetailResponse>(
          `/api/v1/invoices/${encodeURIComponent(invoiceId)}/insurance`,
          { method: 'PATCH', body: JSON.stringify(body) }),
      issue: (invoiceId: string, body: import('@clinic/generated-api-types').IssueInvoiceRequest = {},
        idempotencyKey = crypto.randomUUID()) => request<import('@clinic/generated-api-types').InvoiceDetailResponse>(
        `/api/v1/invoices/${encodeURIComponent(invoiceId)}/issue`,
        { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(body) }),
      pay: (invoiceId: string, body: import('@clinic/generated-api-types').InvoicePaymentRequest,
        idempotencyKey = crypto.randomUUID()) => request<import('@clinic/generated-api-types').InvoiceDetailResponse>(
        `/api/v1/invoices/${encodeURIComponent(invoiceId)}/payments`,
        { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(body) }),
      refund: (allocationId: string, body: import('@clinic/generated-api-types').PaymentRefundRequest,
        idempotencyKey = crypto.randomUUID()) => request<import('@clinic/generated-api-types').BillingResourceResponse>(
        `/api/v1/payment-allocations/${encodeURIComponent(allocationId)}/refunds`,
        { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(body) }),
      void: (invoiceId: string, body: import('@clinic/generated-api-types').BillingReasonRequest) =>
        request<import('@clinic/generated-api-types').InvoiceDetailResponse>(
          `/api/v1/invoices/${encodeURIComponent(invoiceId)}/void`,
          { method: 'POST', body: JSON.stringify(body) }),
    },
    reports: {
      branches: () => request<import('@clinic/generated-api-types').ReportBranchListResponse>(
        '/api/v1/reports/branches'),
      operations: (branchPublicId: string, from: string, to: string) =>
        request<import('@clinic/generated-api-types').OperationsReportResponse>(
          `/api/v1/reports/operations?${new URLSearchParams({ branchPublicId, from, to })}`),
      revenue: (branchPublicId: string, from: string, to: string) =>
        request<import('@clinic/generated-api-types').RevenueReportResponse>(
          `/api/v1/reports/revenue?${new URLSearchParams({ branchPublicId, from, to })}`),
      inventory: (branchPublicId: string, from: string, to: string) =>
        request<import('@clinic/generated-api-types').InventoryReportResponse>(
          `/api/v1/reports/inventory?${new URLSearchParams({ branchPublicId, from, to })}`),
    },
    clinical: {
      branches: () => request<import('@clinic/generated-api-types').ClinicalBranchListResponse>(
        '/api/v1/clinical/branches',
      ),
      list: (branchPublicId: string, status?: string) => request<import('@clinic/generated-api-types').ClinicalEncounterListResponse>(
        `/api/v1/encounters?${new URLSearchParams({ branchPublicId, ...(status ? { status } : {}) })}`,
      ),
      get: (encounterId: string) => request<import('@clinic/generated-api-types').ClinicalEncounterResponse>(
        `/api/v1/encounters/${encodeURIComponent(encounterId)}`,
      ),
      start: (encounterId: string, body: import('@clinic/generated-api-types').ClinicalStartRequest = {}) =>
        request<import('@clinic/generated-api-types').ClinicalEncounterResponse>(
          `/api/v1/encounters/${encodeURIComponent(encounterId)}/start`,
          { method: 'POST', body: JSON.stringify(body) },
        ),
      updateNotes: (encounterId: string, body: import('@clinic/generated-api-types').ClinicalNotesRequest) =>
        request<import('@clinic/generated-api-types').ClinicalEncounterResponse>(
          `/api/v1/encounters/${encodeURIComponent(encounterId)}/clinical-notes`,
          { method: 'PATCH', body: JSON.stringify(body) },
        ),
      addVitalSigns: (encounterId: string, body: import('@clinic/generated-api-types').ClinicalVitalSignsRequest) =>
        request<import('@clinic/generated-api-types').ClinicalCommandResponse>(
          `/api/v1/encounters/${encodeURIComponent(encounterId)}/vital-signs`,
          { method: 'POST', body: JSON.stringify(body) },
        ),
      addDiagnosis: (encounterId: string, body: import('@clinic/generated-api-types').ClinicalDiagnosisRequest) =>
        request<import('@clinic/generated-api-types').ClinicalCommandResponse>(
          `/api/v1/encounters/${encodeURIComponent(encounterId)}/diagnoses`,
          { method: 'POST', body: JSON.stringify(body) },
        ),
      orderService: (encounterId: string, body: import('@clinic/generated-api-types').ClinicalOrderServiceRequest) =>
        request<import('@clinic/generated-api-types').ClinicalCommandResponse>(
          `/api/v1/encounters/${encodeURIComponent(encounterId)}/services`,
          { method: 'POST', body: JSON.stringify(body) },
        ),
      finalizeResult: (serviceId: string, body: import('@clinic/generated-api-types').ClinicalFinalizeResultRequest) =>
        request<import('@clinic/generated-api-types').ClinicalCommandResponse>(
          `/api/v1/clinical/services/${encodeURIComponent(serviceId)}/results/finalize`,
          { method: 'POST', body: JSON.stringify(body) },
        ),
      complete: (encounterId: string) => request<import('@clinic/generated-api-types').ClinicalEncounterResponse>(
        `/api/v1/encounters/${encodeURIComponent(encounterId)}/complete`, { method: 'POST' },
      ),
      sign: (encounterId: string) => request<import('@clinic/generated-api-types').ClinicalCommandResponse>(
        `/api/v1/encounters/${encodeURIComponent(encounterId)}/sign`, { method: 'POST' },
      ),
      amend: (encounterId: string, body: import('@clinic/generated-api-types').ClinicalAmendmentRequest) =>
        request<import('@clinic/generated-api-types').ClinicalCommandResponse>(
          `/api/v1/encounters/${encodeURIComponent(encounterId)}/amendments`,
          { method: 'POST', body: JSON.stringify(body) },
        ),
    },
    patients: {
      references: () => request<import('@clinic/generated-api-types').PatientReferenceResponse>(
        '/api/v1/admin/patients/reference-data',
      ),
      search: (body: import('@clinic/generated-api-types').PatientSearchRequest) =>
        request<import('@clinic/generated-api-types').PatientSummaryListResponse>(
          '/api/v1/admin/patients/search', { method: 'POST', body: JSON.stringify(body) },
        ),
      duplicates: (body: import('@clinic/generated-api-types').PatientDuplicateRequest) =>
        request<import('@clinic/generated-api-types').PatientSummaryListResponse>(
          '/api/v1/admin/patients/duplicates', { method: 'POST', body: JSON.stringify(body) },
        ),
      get: (patientId: string, branchPublicId: string) =>
        request<import('@clinic/generated-api-types').PatientDetailResponse>(
          `/api/v1/admin/patients/${encodeURIComponent(patientId)}?${new URLSearchParams({ branchPublicId })}`,
        ),
      create: (body: import('@clinic/generated-api-types').CreatePatientRequest) =>
        request<import('@clinic/generated-api-types').PatientDetailResponse>(
          '/api/v1/admin/patients', { method: 'POST', body: JSON.stringify(body) },
        ),
      update: (patientId: string, branchPublicId: string,
        body: import('@clinic/generated-api-types').PatientWriteRequest, rowVersion: string) =>
        request<import('@clinic/generated-api-types').PatientDetailResponse>(
          `/api/v1/admin/patients/${encodeURIComponent(patientId)}?${new URLSearchParams({ branchPublicId })}`,
          { method: 'PUT', headers: { 'if-match': `"${rowVersion}"` }, body: JSON.stringify(body) },
        ),
      clinicalSummary: (patientId: string, branchPublicId: string) =>
        request<import('@clinic/generated-api-types').PatientClinicalSummaryResponse>(
          `/api/v1/patients/${encodeURIComponent(patientId)}/clinical-summary?${new URLSearchParams({ branchPublicId })}`,
        ),
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
