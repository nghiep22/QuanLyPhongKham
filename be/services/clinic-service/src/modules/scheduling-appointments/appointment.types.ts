import type { ClinicPrincipal } from '../identity/index.js';

export const appointmentStatuses = [
  'PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED',
] as const;
export type AppointmentStatus = typeof appointmentStatuses[number];

export type AvailabilitySlot = {
  publicId: string;
  branch: { publicId: string; code: string; name: string; timezoneName: string };
  doctor: { publicId: string; name: string };
  service: { publicId: string; code: string; name: string; price: { amount: string; currency: 'VND' } };
  room: { publicId: string; code: string; name: string };
  serviceDateLocal: string;
  startTimeLocal: string;
  endTimeLocal: string;
  startsAtUtc: string;
  endsAtUtc: string;
};

export type Appointment = {
  publicId: string;
  code: string;
  status: AppointmentStatus;
  bookingChannel: 'ONLINE' | 'PHONE' | 'COUNTER';
  scheduledStartUtc: string;
  scheduledEndUtc: string;
  serviceDateLocal: string;
  startTimeLocal: string;
  endTimeLocal: string;
  holdExpiresAtUtc: string | null;
  chiefComplaint: string | null;
  patientNote: string | null;
  cancellationReason: string | null;
  slotPublicId: string;
  branch: { publicId: string; name: string; timezoneName: string };
  patient: { publicId: string; code: string; fullName: string };
  doctor: { publicId: string; fullName: string };
  service: { publicId: string; code: string; name: string };
  roomName: string;
  rowVersion: string;
};

export type ScheduleBreakInput = { localStartTime: string; localEndTime: string; breakName?: string | null };
export type CreateScheduleInput = {
  branchPublicId: string;
  doctorPublicId: string;
  roomPublicId: string;
  weekdayIso: number;
  localStartTime: string;
  localEndTime: string;
  slotDurationMinutes: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  bookingHorizonDays?: number | null;
  breaks?: ScheduleBreakInput[];
};

export type SchedulingData = {
  branch: { publicId: string; code: string; name: string; timezoneName: string; bookingHorizonDays: number };
  doctors: Array<{ publicId: string; fullName: string; defaultSlotMinutes: number; acceptsOnlineBooking: boolean }>;
  rooms: Array<{ publicId: string; code: string; name: string; type: string }>;
  schedules: Array<{
    publicId: string;
    doctorPublicId: string;
    doctorName: string;
    roomPublicId: string;
    roomName: string;
    weekdayIso: number;
    localStartTime: string;
    localEndTime: string;
    slotDurationMinutes: number;
    bookingHorizonDays: number | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    isActive: boolean;
    breaks: ScheduleBreakInput[];
    slotCount: number;
    rowVersion: string;
  }>;
};

export type BookAppointmentInput = {
  patientPublicId: string;
  slotPublicId: string;
  servicePublicId: string;
  bookingChannel: Appointment['bookingChannel'];
  chiefComplaint?: string | null;
  patientNote?: string | null;
};

export interface AppointmentRepository {
  availability(branchPublicId: string, servicePublicId: string, fromDate: string, toDate: string,
    doctorPublicId?: string): Promise<AvailabilitySlot[]>;
  scheduling(actor: ClinicPrincipal, branchPublicId: string, requestId: string): Promise<SchedulingData>;
  createSchedule(actor: ClinicPrincipal, input: CreateScheduleInput, requestId: string): Promise<string>;
  generateSlots(actor: ClinicPrincipal, schedulePublicId: string, fromDate: string, toDate: string,
    requestId: string): Promise<number>;
  listMine(actor: ClinicPrincipal, requestId: string): Promise<Appointment[]>;
  listAdmin(actor: ClinicPrincipal, branchPublicId: string, serviceDate: string, requestId: string,
    status?: AppointmentStatus, query?: string): Promise<Appointment[]>;
  get(actor: ClinicPrincipal, publicId: string, requestId: string): Promise<Appointment>;
  book(actor: ClinicPrincipal, input: BookAppointmentInput, idempotencyKey: string,
    requestId: string): Promise<string>;
  reschedule(actor: ClinicPrincipal, publicId: string, slotPublicId: string, reason: string,
    idempotencyKey: string, requestId: string, servicePublicId?: string): Promise<void>;
  confirm(actor: ClinicPrincipal, publicId: string, requestId: string): Promise<void>;
  cancel(actor: ClinicPrincipal, publicId: string, reason: string, requestId: string): Promise<void>;
  noShow(actor: ClinicPrincipal, publicId: string, reason: string | undefined, requestId: string): Promise<void>;
}
