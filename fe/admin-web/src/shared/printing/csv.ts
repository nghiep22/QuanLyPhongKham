export type CsvValue = string | number | boolean | Date | null | undefined

export interface CsvColumn<T> {
  header: string
  value: keyof T | ((row: T, index: number) => CsvValue)
}

export interface CsvOptions {
  delimiter?: ',' | ';' | '\t'
  includeBom?: boolean
  lineEnding?: '\r\n' | '\n'
}

const UTF8_BOM = '\uFEFF'
const FORMULA_PREFIX_PATTERN = /^[\t\r ]*[=+\-@]/

function resolveValue<T>(column: CsvColumn<T>, row: T, index: number): CsvValue {
  return typeof column.value === 'function' ? column.value(row, index) : row[column.value] as CsvValue
}

function csvText(value: CsvValue): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString()
  }
  return String(value)
}

export function escapeCsvCell(value: CsvValue): string {
  const text = csvText(value)
  const safeText = typeof value === 'string' && FORMULA_PREFIX_PATTERN.test(text) ? `'${text}` : text
  return `"${safeText.replaceAll('"', '""')}"`
}

export function buildExcelCsv<T>(
  columns: readonly CsvColumn<T>[],
  rows: readonly T[],
  options: CsvOptions = {},
): string {
  const delimiter = options.delimiter ?? ','
  const lineEnding = options.lineEnding ?? '\r\n'
  const includeBom = options.includeBom ?? true
  const header = columns.map((column) => escapeCsvCell(column.header)).join(delimiter)
  const body = rows.map((row, index) =>
    columns.map((column) => escapeCsvCell(resolveValue(column, row, index))).join(delimiter),
  )
  const content = [header, ...body].join(lineEnding)
  return `${includeBom ? UTF8_BOM : ''}${content}`
}

function csvFilename(filename: string): string {
  const trimmed = filename.trim() || 'du-lieu'
  return trimmed.toLocaleLowerCase('vi-VN').endsWith('.csv') ? trimmed : `${trimmed}.csv`
}

export function downloadExcelCsv<T>(
  filename: string,
  columns: readonly CsvColumn<T>[],
  rows: readonly T[],
  options: CsvOptions = {},
): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') {
    return false
  }

  const url = URL.createObjectURL(
    new Blob([buildExcelCsv(columns, rows, options)], { type: 'text/csv;charset=utf-8' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = csvFilename(filename)
  anchor.hidden = true
  document.body.append(anchor)

  try {
    anchor.click()
  } finally {
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return true
}
