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
  allergies: Array<{ allergenName: string; type: string; severity: string; reaction: string | null; notedAt: string | null }>;
  conditions: Array<{ code: string | null; name: string; diagnosedDate: string | null; status: string; notes: string | null }>;
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
  clinicalSummary(actor: ClinicPrincipal, branchId: number, publicId: string, requestId: string): Promise<ClinicalSummary>;
}
