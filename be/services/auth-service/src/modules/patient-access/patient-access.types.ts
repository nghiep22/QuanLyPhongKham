import type { AuthPrincipal } from '../auth/auth.types.js';

export const patientRelationships = ['SELF', 'CHILD', 'SPOUSE', 'PARENT', 'GUARDIAN', 'OTHER'] as const;
export type PatientRelationship = typeof patientRelationships[number];
export type PatientLinkRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';

export type BranchReference = { id: number; publicId: string; code: string; name: string };

export type PatientAccessLink = {
  publicId: string;
  patient: { publicId: string; code: string; fullName: string; dateOfBirth: string };
  relationshipType: PatientRelationship;
  status: 'ACTIVE';
  bookingAllowed: boolean;
  accessKind: 'OWN' | 'DELEGATED';
  linkedUser: { publicId: string; displayName: string };
  verifiedBranch: Omit<BranchReference, 'id' | 'code'> | null;
  verifiedAtUtc: string | null;
  canRevoke: boolean;
  rowVersion: string;
};

export type PatientLinkRequestView = {
  publicId: string;
  branch: Omit<BranchReference, 'id'>;
  patientReference: string;
  relationshipType: PatientRelationship;
  requestNote: string | null;
  status: PatientLinkRequestStatus;
  decisionReason: string | null;
  createdAtUtc: string;
  expiresAtUtc: string;
  decidedAtUtc: string | null;
  patient: { publicId: string; code: string; fullName: string } | null;
  rowVersion: string;
};

export type StaffPatientLinkRequest = PatientLinkRequestView & {
  requester: { publicId: string; displayName: string; email: string | null; phone: string | null };
  patient: { publicId: string; code: string; fullName: string; dateOfBirth: string };
};

export type CreatePatientLinkRequestInput = {
  branchPublicId: string;
  patientCode: string;
  dateOfBirth: string;
  relationshipType: PatientRelationship;
  requestNote?: string;
};

export type StaffPatientLinkRequestQuery = {
  branchPublicId: string;
  status?: PatientLinkRequestStatus;
  page: number;
  pageSize: number;
};

export type Actor = Pick<AuthPrincipal, 'userId' | 'roles' | 'permissions'>;

export interface PatientAccessRepository {
  resolveBranch(publicId: string): Promise<BranchReference | null>;
  listPatientBranches(): Promise<BranchReference[]>;
  listManagedBranches(actorUserId: number): Promise<BranchReference[]>;
  hasPermission(actorUserId: number, permission: string, branchId: number | null): Promise<boolean>;
  requestLink(input: {
    actorUserId: number;
    branchId: number;
    patientCode: string;
    dateOfBirth: string;
    relationshipType: PatientRelationship;
    requestNote: string | null;
    idempotencyKey: string;
    requestHash: Buffer;
    expiresAtUtc: Date;
    maxRequestsPerDay: number;
  }, requestId: string): Promise<{ requestPublicId: string; created: boolean }>;
  getPatientAccess(actorUserId: number, requestId: string): Promise<{
    links: PatientAccessLink[];
    requests: PatientLinkRequestView[];
  }>;
  cancelRequest(actorUserId: number, requestPublicId: string, requestId: string): Promise<void>;
  listRequests(actorUserId: number, branchId: number, query: StaffPatientLinkRequestQuery, requestId: string): Promise<{
    items: StaffPatientLinkRequest[];
    total: number;
  }>;
  decideRequest(actorUserId: number, requestPublicId: string, decision: 'APPROVED' | 'REJECTED', reason: string,
    expectedRowVersion: string, requestId: string): Promise<string | null>;
  revokeLink(actorUserId: number, linkPublicId: string, reason: string, requestId: string): Promise<void>;
}
