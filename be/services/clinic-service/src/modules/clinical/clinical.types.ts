import type { ClinicPrincipal } from '../identity/index.js';
import type { ClinicalResultSchema } from '../organization-catalog/catalog.types.js';

export type EncounterStatus = 'WAITING' | 'IN_PROGRESS' | 'COMPLETED' | 'SIGNED' | 'CANCELLED';

export type ClinicalBranch = {
  publicId: string;
  code: string;
  name: string;
  timezoneName: string;
};

export type ClinicalEncounterSummary = {
  publicId: string;
  code: string;
  source: 'APPOINTMENT' | 'WALK_IN';
  status: EncounterStatus;
  arrivedAtUtc: string;
  startedAtUtc: string | null;
  completedAtUtc: string | null;
  patient: { publicId: string; code: string; fullName: string; dateOfBirth: string; gender: string };
  doctor: { publicId: string; fullName: string };
  room: { publicId: string; name: string } | null;
  queue: { displayNumber: string; status: string } | null;
  chiefComplaint: string | null;
};

export type VitalSignsInput = {
  temperatureC?: number | null;
  pulseBpm?: number | null;
  respiratoryRateBpm?: number | null;
  systolicBpMmhg?: number | null;
  diastolicBpMmhg?: number | null;
  spo2Percent?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  painScore?: number | null;
  notes?: string | null;
};

export type ClinicalNotesInput = {
  historyOfPresentIllness?: string | null;
  physicalExamination?: string | null;
  clinicalAssessment?: string | null;
  treatmentPlan?: string | null;
  followUpInstructions?: string | null;
  followUpDate?: string | null;
};

export type DiagnosisInput = {
  code: string;
  name: string;
  type: 'PROVISIONAL' | 'DIFFERENTIAL' | 'FINAL';
  isPrimary: boolean;
  notes?: string | null;
};

export type OrderServiceInput = {
  servicePublicId: string;
  quantity: number;
  notes?: string | null;
};

export type FinalizeResultInput = {
  summary?: string | null;
  conclusion?: string | null;
  result?: Record<string, unknown> | null;
};

export type AmendmentInput = { reason: string; content: string };

export type ClinicalEncounterDetail = ClinicalEncounterSummary & ClinicalNotesInput & {
  signedAtUtc: string | null;
  patientRelease: { releasedAtUtc: string; releasedBy: string } | null;
  signature: { schemaVersion: string; sha256: string; signedAtUtc: string; isVerified: boolean } | null;
  vitalSigns: Array<VitalSignsInput & { publicId: string; measuredAtUtc: string; bmi: number | null; measuredBy: string }>;
  diagnoses: Array<DiagnosisInput & { publicId: string; createdAtUtc: string; recordedBy: string }>;
  services: Array<{
    publicId: string;
    catalogPublicId: string;
    code: string;
    name: string;
    type: string;
    quantity: string;
    unitPrice: string;
    status: 'ORDERED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    notes: string | null;
    resultSchema: ClinicalResultSchema | null;
    result: null | { publicId: string; version: number; status: string; summary: string | null;
      conclusion: string | null; result: unknown; finalizedAtUtc: string };
  }>;
  amendments: Array<{ publicId: string; number: number; reason: string; content: string; hash: string;
    amendedAtUtc: string; amendedBy: string }>;
  availableServices: Array<{ publicId: string; code: string; name: string; type: string; priceAmount: string }>;
};

export type PatientClinicalRecordSummary = {
  publicId: string;
  code: string;
  arrivedAtUtc: string;
  completedAtUtc: string;
  signedAtUtc: string;
  releasedAtUtc: string;
  chiefComplaint: string | null;
  patient: { publicId: string; code: string; fullName: string };
  branch: { publicId: string; name: string; timezoneName: string };
  doctor: { publicId: string; fullName: string };
  primaryDiagnosis: { code: string; name: string } | null;
};

export type PatientClinicalRecord = PatientClinicalRecordSummary & ClinicalNotesInput & {
  patient: PatientClinicalRecordSummary['patient'] & { dateOfBirth: string; gender: string };
  signature: { schemaVersion: string; sha256: string; signedAtUtc: string; isVerified: boolean };
  vitalSigns: Array<VitalSignsInput & { publicId: string; measuredAtUtc: string; bmi: number | null }>;
  diagnoses: Array<DiagnosisInput & { publicId: string; createdAtUtc: string }>;
  services: Array<{
    publicId: string;
    code: string;
    name: string;
    type: string;
    status: 'ORDERED' | 'IN_PROGRESS' | 'COMPLETED';
    notes: string | null;
    result: null | {
      publicId: string;
      version: number;
      status: 'FINAL' | 'AMENDED';
      releasedToPatient: true;
      summary: string | null;
      conclusion: string | null;
      result: unknown;
      releasedAtUtc: string;
    };
  }>;
  amendments: Array<{ publicId: string; number: number; reason: string; content: string; amendedAtUtc: string }>;
};

export type ClinicalCommandResult = { publicId: string; sha256?: string };

export interface ClinicalRepository {
  branches(actor: ClinicPrincipal, requestId: string): Promise<ClinicalBranch[]>;
  list(actor: ClinicPrincipal, branchPublicId: string, statuses: EncounterStatus[], requestId: string): Promise<ClinicalEncounterSummary[]>;
  get(actor: ClinicPrincipal, encounterPublicId: string, requestId: string): Promise<ClinicalEncounterDetail>;
  start(actor: ClinicPrincipal, encounterPublicId: string, roomPublicId: string | null,
    queueBypassReason: string | null, requestId: string): Promise<void>;
  updateNotes(actor: ClinicPrincipal, encounterPublicId: string, input: ClinicalNotesInput, requestId: string): Promise<void>;
  addVitalSigns(actor: ClinicPrincipal, encounterPublicId: string, input: VitalSignsInput,
    requestId: string): Promise<ClinicalCommandResult>;
  addDiagnosis(actor: ClinicPrincipal, encounterPublicId: string, input: DiagnosisInput,
    requestId: string): Promise<ClinicalCommandResult>;
  orderService(actor: ClinicPrincipal, encounterPublicId: string, input: OrderServiceInput,
    requestId: string): Promise<ClinicalCommandResult>;
  finalizeResult(actor: ClinicPrincipal, encounterServicePublicId: string, input: FinalizeResultInput,
    requestId: string): Promise<ClinicalCommandResult>;
  complete(actor: ClinicPrincipal, encounterPublicId: string, requestId: string): Promise<void>;
  sign(actor: ClinicPrincipal, encounterPublicId: string, requestId: string): Promise<ClinicalCommandResult>;
  releaseToPatient(actor: ClinicPrincipal, encounterPublicId: string, requestId: string): Promise<void>;
  amend(actor: ClinicPrincipal, encounterPublicId: string, input: AmendmentInput,
    requestId: string): Promise<ClinicalCommandResult>;
  patientHistory(actor: ClinicPrincipal, patientPublicId: string, requestId: string): Promise<PatientClinicalRecordSummary[]>;
  patientRecord(actor: ClinicPrincipal, patientPublicId: string, encounterPublicId: string,
    requestId: string): Promise<PatientClinicalRecord>;
}
