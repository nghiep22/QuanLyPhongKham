import { describe, expect, it } from 'vitest'
import { canMarkAppointmentNoShow } from './appointment-actions'

const end = '2026-09-18T03:30:00.000Z'

describe('canMarkAppointmentNoShow', () => {
  it('allows a confirmed appointment only after its scheduled end', () => {
    expect(canMarkAppointmentNoShow({ status: 'CONFIRMED', scheduledEndUtc: end }, Date.parse(end))).toBe(true)
  })

  it('does not allow marking no-show before the scheduled end', () => {
    expect(canMarkAppointmentNoShow({ status: 'CONFIRMED', scheduledEndUtc: end }, Date.parse(end) - 1)).toBe(false)
  })

  it('does not allow no-show from another appointment state', () => {
    expect(canMarkAppointmentNoShow({ status: 'PENDING', scheduledEndUtc: end }, Date.parse(end) + 1)).toBe(false)
  })
})
