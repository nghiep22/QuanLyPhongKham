import { ApiClientError, createApiClient } from '@clinic/generated-api-client'

let accessToken: string | null = null
const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/api\/v1\/?$/, '') ?? 'http://localhost:5000'
const localHosts = new Set(['localhost', '127.0.0.1'])
const apiBaseUrl = (() => {
  if (typeof window === 'undefined' || !localHosts.has(window.location.hostname)) return configuredBaseUrl
  let url: URL
  try { url = new URL(configuredBaseUrl) } catch { return configuredBaseUrl }
  if (!localHosts.has(url.hostname)) return configuredBaseUrl
  url.hostname = window.location.hostname
  return url.toString().replace(/\/$/, '')
})()
export const api = createApiClient({
  baseUrl: apiBaseUrl,
  getAccessToken: async () => accessToken,
})
export function setAccessToken(token: string | null) { accessToken = token }

export function errorMessage(error: unknown) {
  if (!(error instanceof ApiClientError)) return 'Không thể kết nối hệ thống. Vui lòng thử lại.'
  const messages: Record<string, string> = {
    SLOT_CONFLICT: 'Khung giờ vừa được người khác giữ. Hãy tìm lại lịch.',
    BOOKING_POLICY_CONFLICT: 'Đã ngoài thời hạn cho phép đặt, đổi hoặc hủy lịch.',
    AVAILABILITY_CHANGED: 'Bác sĩ hoặc dịch vụ không còn nhận lịch này.',
    IDEMPOTENCY_KEY_REUSED: 'Nội dung yêu cầu đã thay đổi. Vui lòng gửi lại.',
    APPOINTMENT_STATE_CONFLICT: 'Lịch hẹn đã thay đổi. Hãy tải lại.',
    PATIENT_LINK_RATE_LIMITED: 'Bạn đã gửi quá nhiều yêu cầu trong ngày.',
    PATIENT_LINK_STATE_CONFLICT: 'Yêu cầu đã được xử lý. Hãy tải lại.',
    FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  }
  return messages[error.code] ?? error.message ?? 'Không thể xử lý yêu cầu.'
}

export const money = (value: string) => `${Number(value).toLocaleString('vi-VN')} ₫`
export const localDate = (offset = 0) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: 'year' | 'month' | 'day') => Number(parts.find((item) => item.type === type)?.value)
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day') + offset)).toISOString().slice(0, 10)
}
export const dateTime = (value: string) => new Date(value).toLocaleString('vi-VN', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh',
})
export const dayMonth = (value: string) => {
  const parts = new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: 'numeric', timeZone: 'Asia/Ho_Chi_Minh',
  }).formatToParts(new Date(value))
  return {
    day: parts.find((part) => part.type === 'day')?.value ?? '--',
    month: parts.find((part) => part.type === 'month')?.value ?? '--',
  }
}
