export {
  EMPTY_PRINT_VALUE,
  VIETNAM_TIME_ZONE,
  formatViDate,
  formatViDateTime,
  formatViGender,
  formatViMoney,
  normalizePrintTimeZone,
} from './formatters'
export type { DateInput } from './formatters'

export { buildPrintDocumentHtml, escapeHtml, openPrintDocument } from './print-document'
export type {
  PrintDocumentModel,
  PrintField,
  PrintHeader,
  PrintPageSize,
  PrintSection,
  PrintSignature,
  PrintTable,
  PrintTableColumn,
  PrintValue,
} from './print-document'

export { buildExcelCsv, downloadExcelCsv, escapeCsvCell } from './csv'
export type { CsvColumn, CsvOptions, CsvValue } from './csv'

export {
  appointmentPrintDocument,
  clinicalReportPrintDocument,
  invoicePrintDocument,
  patientProfilePrintDocument,
  paymentReceiptPrintDocument,
  prescriptionPrintDocument,
  receptionSlipPrintDocument,
  refundReceiptPrintDocument,
} from './documents'
