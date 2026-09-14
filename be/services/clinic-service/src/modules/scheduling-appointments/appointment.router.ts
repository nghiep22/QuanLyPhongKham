import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../shared/http/errors.js';
import type { PrincipalAuthenticator } from '../identity/index.js';
import { appointmentStatuses } from './appointment.types.js';
import { AppointmentService } from './appointment.service.js';

const uuid = z.string().regex(/^[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}$/);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
});
const timeOnly = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((value) => value || null);
const availabilityQuery = z.object({ branchPublicId: uuid, servicePublicId: uuid, doctorPublicId: uuid.optional(),
  fromDate: dateOnly, toDate: dateOnly }).strict();
const booking = z.object({ patientPublicId: uuid, slotPublicId: uuid, servicePublicId: uuid,
  chiefComplaint: optionalText(1000), patientNote: optionalText(1000) }).strict();
const adminBooking = booking.extend({ bookingChannel: z.enum(['PHONE', 'COUNTER']) }).strict();
const reschedule = z.object({ newSlotPublicId: uuid, newServicePublicId: uuid.optional(),
  reason: z.string().trim().min(3).max(500) }).strict();
const reason = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const optionalReason = z.object({ reason: z.string().trim().min(3).max(500).optional() }).strict();
const adminList = z.object({ branchPublicId: uuid, serviceDate: dateOnly,
  status: z.enum(appointmentStatuses).optional(), query: z.string().trim().max(100).optional() }).strict();
const createSchedule = z.object({ branchPublicId: uuid, doctorPublicId: uuid, roomPublicId: uuid,
  weekdayIso: z.number().int().min(1).max(7), localStartTime: timeOnly, localEndTime: timeOnly,
  slotDurationMinutes: z.number().int().min(5).max(240), effectiveFrom: dateOnly,
  effectiveTo: dateOnly.nullable().optional(), bookingHorizonDays: z.number().int().min(1).max(365).nullable().optional(),
  breaks: z.array(z.object({ localStartTime: timeOnly, localEndTime: timeOnly,
    breakName: z.string().trim().max(100).nullable().optional() }).strict()).max(10).default([]) }).strict();
const generate = z.object({ fromDate: dateOnly, toDate: dateOnly }).strict();

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Dữ liệu lịch không hợp lệ.', {
    fields: result.error.issues.map((item) => ({ path: item.path.join('.'), message: item.message })),
  });
  return result.data;
}
function asyncRoute(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next);
}
async function actor(request: Request, auth: PrincipalAuthenticator) {
  const authorization = request.header('authorization');
  if (!authorization?.startsWith('Bearer ')) throw new HttpError(401, 'ACCESS_TOKEN_REQUIRED', 'Yêu cầu access token.');
  return auth.authenticate(authorization.slice(7));
}
function key(request: Request) {
  const value = request.header('idempotency-key');
  if (!value) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Yêu cầu header Idempotency-Key.');
  return validate(uuid, value);
}
function success(response: Response, data: unknown) {
  response.set('Cache-Control', 'no-store').json({ data, meta: {}, requestId: response.locals.requestId });
}

export function createPublicAvailabilityRouter(service: AppointmentService) {
  const router = Router();
  router.get('/availability', asyncRoute(async (request, response) => {
    const query = validate(availabilityQuery, request.query);
    success(response, await service.availability(query.branchPublicId, query.servicePublicId,
      query.fromDate, query.toDate, query.doctorPublicId));
  }));
  return router;
}

export function createPatientAppointmentRouter(auth: PrincipalAuthenticator, service: AppointmentService) {
  const router = Router();
  router.get('/', asyncRoute(async (request, response) => success(response,
    await service.listMine(await actor(request, auth), response.locals.requestId))));
  router.post('/', asyncRoute(async (request, response) => {
    const input = validate(booking, request.body);
    const item = await service.book(await actor(request, auth), { ...input, bookingChannel: 'ONLINE' },
      key(request), response.locals.requestId);
    response.status(201); success(response, item);
  }));
  router.post('/:appointmentId/reschedule', asyncRoute(async (request, response) => {
    const input = validate(reschedule, request.body);
    success(response, await service.reschedule(await actor(request, auth), validate(uuid, request.params.appointmentId),
      input.newSlotPublicId, input.reason, key(request), response.locals.requestId, input.newServicePublicId));
  }));
  router.post('/:appointmentId/cancel', asyncRoute(async (request, response) => {
    const input = validate(reason, request.body);
    success(response, await service.cancel(await actor(request, auth), validate(uuid, request.params.appointmentId),
      input.reason, response.locals.requestId));
  }));
  return router;
}

export function createAdminAppointmentRouter(auth: PrincipalAuthenticator, service: AppointmentService) {
  const router = Router();
  router.get('/', asyncRoute(async (request, response) => {
    const query = validate(adminList, request.query);
    success(response, await service.listAdmin(await actor(request, auth), query.branchPublicId,
      query.serviceDate, response.locals.requestId, query.status, query.query));
  }));
  router.post('/', asyncRoute(async (request, response) => {
    const input = validate(adminBooking, request.body);
    const item = await service.book(await actor(request, auth), input, key(request), response.locals.requestId);
    response.status(201); success(response, item);
  }));
  router.post('/:appointmentId/confirm', asyncRoute(async (request, response) => success(response,
    await service.confirm(await actor(request, auth), validate(uuid, request.params.appointmentId), response.locals.requestId))));
  router.post('/:appointmentId/reschedule', asyncRoute(async (request, response) => {
    const input = validate(reschedule, request.body);
    success(response, await service.reschedule(await actor(request, auth), validate(uuid, request.params.appointmentId),
      input.newSlotPublicId, input.reason, key(request), response.locals.requestId, input.newServicePublicId));
  }));
  router.post('/:appointmentId/cancel', asyncRoute(async (request, response) => {
    const input = validate(reason, request.body);
    success(response, await service.cancel(await actor(request, auth), validate(uuid, request.params.appointmentId),
      input.reason, response.locals.requestId));
  }));
  router.post('/:appointmentId/no-show', asyncRoute(async (request, response) => {
    const input = validate(optionalReason, request.body ?? {});
    success(response, await service.noShow(await actor(request, auth), validate(uuid, request.params.appointmentId),
      input.reason, response.locals.requestId));
  }));
  return router;
}

export function createSchedulingRouter(auth: PrincipalAuthenticator, service: AppointmentService) {
  const router = Router();
  router.get('/', asyncRoute(async (request, response) => {
    const query = validate(z.object({ branchPublicId: uuid }).strict(), request.query);
    success(response, await service.scheduling(await actor(request, auth), query.branchPublicId, response.locals.requestId));
  }));
  router.post('/', asyncRoute(async (request, response) => {
    const created = await service.createSchedule(await actor(request, auth), validate(createSchedule, request.body),
      response.locals.requestId);
    response.status(201); success(response, created);
  }));
  router.post('/:scheduleId/generate-slots', asyncRoute(async (request, response) => {
    const input = validate(generate, request.body);
    success(response, await service.generateSlots(await actor(request, auth), validate(uuid, request.params.scheduleId),
      input.fromDate, input.toDate, response.locals.requestId));
  }));
  return router;
}
