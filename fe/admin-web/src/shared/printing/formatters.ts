export type DateInput = Date | string | number | null | undefined

export const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'
export const EMPTY_PRINT_VALUE = '—'

const BARE_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const WINDOWS_TIME_ZONE_MAP: Readonly<Record<string, string>> = {
  'SE Asia Standard Time': VIETNAM_TIME_ZONE,
}

export function normalizePrintTimeZone(timeZone: string | null | undefined): string {
  const candidate = WINDOWS_TIME_ZONE_MAP[timeZone ?? ''] ?? timeZone ?? VIETNAM_TIME_ZONE

  try {
    new Intl.DateTimeFormat('vi-VN', { timeZone: candidate }).format(0)
    return candidate
  } catch {
    return VIETNAM_TIME_ZONE
  }
}

function validDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function dateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: normalizePrintTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

function formatBareDate(value: string): string | null {
  const match = BARE_DATE_PATTERN.exec(value)
  if (!match) {
    return null
  }

  const [, year, month, day] = match
  const probe = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (
    probe.getUTCFullYear() !== Number(year) ||
    probe.getUTCMonth() !== Number(month) - 1 ||
    probe.getUTCDate() !== Number(day)
  ) {
    return EMPTY_PRINT_VALUE
  }

  return `${day}/${month}/${year}`
}

export function formatViDate(
  value: DateInput,
  timeZone: string = VIETNAM_TIME_ZONE,
): string {
  if (typeof value === 'string') {
    const bareDate = formatBareDate(value)
    if (bareDate !== null) {
      return bareDate
    }
  }

  const date = validDate(value)
  if (!date) {
    return EMPTY_PRINT_VALUE
  }

  try {
    const parts = dateParts(date, timeZone)
    return `${parts.day}/${parts.month}/${parts.year}`
  } catch {
    return EMPTY_PRINT_VALUE
  }
}

export function formatViDateTime(
  value: DateInput,
  timeZone: string = VIETNAM_TIME_ZONE,
): string {
  if (typeof value === 'string') {
    const bareDate = formatBareDate(value)
    if (bareDate !== null) {
      return bareDate === EMPTY_PRINT_VALUE ? bareDate : `${bareDate} 00:00`
    }
  }

  const date = validDate(value)
  if (!date) {
    return EMPTY_PRINT_VALUE
  }

  try {
    const parts = dateParts(date, timeZone)
    return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`
  } catch {
    return EMPTY_PRINT_VALUE
  }
}

export function formatViMoney(
  value: number | string | null | undefined,
  currency = 'VND',
): string {
  if (value === null || value === undefined || value === '') {
    return EMPTY_PRINT_VALUE
  }

  const amount = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(amount)) {
    return EMPTY_PRINT_VALUE
  }

  try {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
    }).format(amount)
  } catch {
    return EMPTY_PRINT_VALUE
  }
}

const GENDER_LABELS: Readonly<Record<string, string>> = {
  MALE: 'Nam',
  M: 'Nam',
  NAM: 'Nam',
  FEMALE: 'Nữ',
  F: 'Nữ',
  'NỮ': 'Nữ',
  NU: 'Nữ',
  OTHER: 'Khác',
  O: 'Khác',
  'KHÁC': 'Khác',
  KHAC: 'Khác',
  UNKNOWN: 'Không xác định',
  U: 'Không xác định',
}

export function formatViGender(value: string | null | undefined): string {
  const normalized = value?.trim()
  if (!normalized) {
    return EMPTY_PRINT_VALUE
  }

  return GENDER_LABELS[normalized.toLocaleUpperCase('vi-VN')] ?? normalized
}
