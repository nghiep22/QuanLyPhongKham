import type { ClinicPrincipal } from '../identity/index.js';

export type QueueStatus = 'WAITING' | 'CALLED' | 'SERVING';

export type QueueTicket = {
  publicId: string;
  encounterPublicId: string;
  displayNumber: string;
  priorityLevel: number;
  status: QueueStatus;
  issuedAtUtc: string;
  calledAtUtc: string | null;
  serviceStartedAtUtc: string | null;
  encounterCode: string;
  encounterSource: 'APPOINTMENT' | 'WALK_IN';
  patient: { publicId: string; code: string; fullName: string };
  doctor: { publicId: string; fullName: string };
  room: { publicId: string; name: string } | null;
};

export type CheckInCandidate = {
  publicId: string;
  code: string;
  patient: { publicId: string; code: string; fullName: string };
  doctor: { publicId: string; fullName: string };
  service: { publicId: string; name: string };
  room: { publicId: string; name: string };
  scheduledStartUtc: string;
  scheduledEndUtc: string;
  startTimeLocal: string;
  chiefComplaint: string | null;
};

export type ReceptionPatient = {
  publicId: string;
  code: string;
  fullName: string;
  dateOfBirth: string;
  gender: string;
  phone: string | null;
};

export type ReceptionWorkspace = {
  branch: {
    publicId: string;
    code: string;
    name: string;
    timezoneName: string;
    businessDate: string;
    checkInEarlyMinutes: number;
    checkInLateMinutes: number;
  };
  queue: QueueTicket[];
  appointments: CheckInCandidate[];
  doctors: Array<{ publicId: string; fullName: string }>;
  rooms: Array<{ publicId: string; code: string; name: string }>;
  services: Array<{ publicId: string; code: string; name: string; priceAmount: string; currencyCode: 'VND' }>;
  doctorServices: Array<{ doctorPublicId: string; servicePublicId: string }>;
};

export type WalkInInput = {
  branchPublicId: string;
  patientPublicId: string;
  doctorPublicId: string;
  roomPublicId: string;
  servicePublicId: string;
  chiefComplaint?: string | null;
  priorityLevel: number;
};

export type QueueCommandResult = {
  queueTicketPublicId: string;
  encounterPublicId: string;
  displayNumber: string;
};

export interface ReceptionRepository {
  branches(actor: ClinicPrincipal, requestId: string): Promise<Array<{ publicId: string; code: string; name: string; timezoneName: string }>>;
  workspace(actor: ClinicPrincipal, branchPublicId: string, requestId: string): Promise<ReceptionWorkspace>;
  searchPatients(actor: ClinicPrincipal, branchPublicId: string, query: string, requestId: string): Promise<ReceptionPatient[]>;
  checkIn(actor: ClinicPrincipal, appointmentPublicId: string, priorityLevel: number,
    idempotencyKey: string, requestId: string): Promise<QueueCommandResult>;
  createWalkIn(actor: ClinicPrincipal, input: WalkInInput, idempotencyKey: string,
    requestId: string): Promise<QueueCommandResult>;
  callNext(actor: ClinicPrincipal, branchPublicId: string, requestId: string): Promise<QueueCommandResult | null>;
}
