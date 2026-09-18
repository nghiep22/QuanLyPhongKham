import type { Appointment } from '@clinic/generated-api-types'

export function canMarkAppointmentNoShow(
  appointment: Pick<Appointment, 'status' | 'scheduledEndUtc'>,
  now = Date.now(),
) {
  const scheduledEnd = Date.parse(appointment.scheduledEndUtc)
  return appointment.status === 'CONFIRMED'
    && Number.isFinite(scheduledEnd)
    && scheduledEnd <= now
}
