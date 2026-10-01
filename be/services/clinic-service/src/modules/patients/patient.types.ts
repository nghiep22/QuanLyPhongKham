import type { ClinicPrincipal } from '../identity/index.js';

export type Branch = { id: number; publicId: string; name: string };
export type PatientSummary = {
  publicId: string;
  code: string;
  fullName: string;
  dateOfBirth: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  phone: string | null;
  status: string;
  nationalIdLast4: string | null;
  rowVersion: string;
};
export type PatientDetail = PatientSummary & {
  branch: { publicId: string; name: string };
  nationalId: string | null;
  healthInsuranceNo: string | null;
  email: string | null;
  addressLine: string | null;
  province: string | null;
  emergencyContacts: EmergencyContact[];
};
export type EmergencyContact = {
  fullName: string; relationshipName: string | null; phone: string; isPrimary: boolean;
};
export type MyEmergencyContacts = {
  patientPublicId: string; rowVersion: string; contacts: EmergencyContact[];
};
export type PatientMergePreview = {
  sourcePublicId: string; sourceCode: string; sourceName: string; sourceDateOfBirth: string;
  sourceGender: PatientSummary['gender'];
  sourceBranchPublicId: string | null; sourceBranchName: string | null;
  sourceNationalIdLast4: string | null; sourceRowVersion: string;
  targetPublicId: string; targetCode: string; targetName: string; targetDateOfBirth: string;
  targetGender: PatientSummary['gender'];
  targetBranchPublicId: string | null; targetBranchName: string | null;
  targetNationalIdLast4: string | null; targetRowVersion: string;
  sourceAppointments: number; sourceSignedEncounters: number; sourceInvoices: number;
  sourceActiveLinks: number; sourceActiveAllergies: number; sourceOpenConditions: number;
  sourceActiveContacts: number; identityCompatible: boolean; hasOpenWork: boolean;
  hasInboundMerge: boolean; hasLinkConflict: boolean; hasContactConflict: boolean;
};
export type PatientMergeResult = {
  sourcePublicId: string; sourceCode: string; targetPublicId: string; targetCode: string; mergedAtUtc: string;
};
export type PatientMergeHistoryItem = PatientMergeResult & {
  sourceName: string; reason: string; performedByPublicId: string; performedByName: string;
};
export type PatientInput = {
  fullName: string;
  dateOfBirth: string;
  gender: PatientSummary['gender'];
  nationalId?: string | null;
  healthInsuranceNo?: string | null;
  phone?: string | null;
  email?: string | null;
  addressLine?: string | null;
  province?: string | null;
};
export type CreatePatientInput = PatientInput & {
  branchPublicId: string;
  duplicateOverride?: boolean;
  duplicateReason?: string;
};
export type ClinicalSummary = {
  patient: Pick<PatientSummary, 'publicId' | 'code' | 'fullName' | 'dateOfBirth' | 'gender'>;
  allergies: Array<{ publicId: string; allergenName: string; type: string; severity: string; reaction: string | null; notedAt: string | null }>;
  conditions: Array<{ publicId: string; code: string | null; name: string; diagnosedDate: string | null; status: string; notes: string | null }>;
};
export type PatientAllergyInput = {
  allergenName: string; type: 'DRUG' | 'FOOD' | 'ENVIRONMENT' | 'OTHER';
  severity: 'MILD' | 'MODERATE' | 'SEVERE' | 'UNKNOWN';
  reaction?: string | null; notedAt?: string | null;
};
export type PatientConditionInput = {
  code?: string | null; name: string; diagnosedDate?: string | null;
  status: 'ACTIVE' | 'CONTROLLED'; notes?: string | null;
};

export interface PatientRepository {
  branches(actorUserId: number): Promise<Branch[]>;
  resolveBranch(publicId: string): Promise<Branch | null>;
  search(actorUserId: number, branchId: number, requestId: string, query?: string, dateOfBirth?: string): Promise<PatientSummary[]>;
  duplicates(actorUserId: number, branchId: number, requestId: string, input: PatientInput): Promise<PatientSummary[]>;
  get(actorUserId: number, branchId: number, publicId: string, requestId: string): Promise<PatientDetail | null>;
  create(actor: ClinicPrincipal, branchId: number, input: CreatePatientInput, requestId: string): Promise<string>;
  update(actor: ClinicPrincipal, branchId: number, publicId: string, input: PatientInput,
    expectedVersion: string, requestId: string): Promise<void>;
  replaceEmergencyContacts(actor: ClinicPrincipal, branchId: number, publicId: string,
    contacts: EmergencyContact[], expectedVersion: string, requestId: string): Promise<void>;
  myEmergencyContacts(actor: ClinicPrincipal, publicId: string, requestId: string): Promise<MyEmergencyContacts>;
  replaceMyEmergencyContacts(actor: ClinicPrincipal, publicId: string, contacts: EmergencyContact[],
    expectedVersion: string, requestId: string): Promise<void>;
  previewMerge(actor: ClinicPrincipal, sourcePublicId: string, targetPublicId: string,
    requestId: string): Promise<PatientMergePreview>;
  merge(actor: ClinicPrincipal, sourcePublicId: string, targetPublicId: string,
    sourceVersion: string, targetVersion: string, reason: string, requestId: string): Promise<PatientMergeResult>;
  mergeHistory(actor: ClinicPrincipal, targetPublicId: string, requestId: string): Promise<PatientMergeHistoryItem[]>;
  clinicalSummary(actor: ClinicPrincipal, branchId: number, publicId: string, requestId: string): Promise<ClinicalSummary>;
  addAllergy(actor: ClinicPrincipal, branchId: number, publicId: string, input: PatientAllergyInput,
    requestId: string): Promise<string>;
  deactivateAllergy(actor: ClinicPrincipal, branchId: number, publicId: string, allergyId: string,
    reason: string, requestId: string): Promise<void>;
  addCondition(actor: ClinicPrincipal, branchId: number, publicId: string, input: PatientConditionInput,
    requestId: string): Promise<string>;
  resolveCondition(actor: ClinicPrincipal, branchId: number, publicId: string, conditionId: string,
    reason: string, requestId: string): Promise<void>;
}
