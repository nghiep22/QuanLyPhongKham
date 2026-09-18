import type {
  Appointment,
  BillingBranch,
  ClinicalEncounterDetail,
  InvoiceDetail,
  InvoicePaymentAllocation,
  InvoiceRefund,
  PatientDetail,
  PrescriptionDetail,
  QueueTicket,
  ReceptionBranch,
} from '@clinic/generated-api-types'
import { formatViDate, formatViDateTime, formatViGender, formatViMoney } from './formatters'
import type { PrintDocumentModel, PrintHeader, PrintSection } from './print-document'

type BranchPrintData = {
  code?: string
  name: string
  medicalLicenseNo?: string | null
  phone?: string | null
  email?: string | null
  addressLine?: string | null
  ward?: string | null
  district?: string | null
  province?: string | null
  timezoneName?: string
}

const statusName: Record<string, string> = {
  DRAFT: 'Nháp', ISSUED: 'Đã phát hành', PARTIALLY_PAID: 'Đã thu một phần', PAID: 'Đã thanh toán',
  VOID: 'Đã hủy', PARTIALLY_DISPENSED: 'Đã cấp một phần', DISPENSED: 'Đã cấp đủ',
  CANCELLED: 'Đã hủy', EXPIRED: 'Hết hiệu lực', COMPLETED: 'Đã hoàn tất', SIGNED: 'Đã ký',
  ORDERED: 'Đã chỉ định', IN_PROGRESS: 'Đang thực hiện',
}
const paymentMethodName: Record<string, string> = {
  CASH: 'Tiền mặt', CARD: 'Thẻ', BANK_TRANSFER: 'Chuyển khoản', EWALLET: 'Ví điện tử', OTHER: 'Khác',
}
const channelName: Record<string, string> = { ONLINE: 'Đăng ký trực tuyến', PHONE: 'Đăng ký qua điện thoại', COUNTER: 'Đăng ký tại quầy' }
const diagnosisTypeName: Record<string, string> = { PROVISIONAL: 'Sơ bộ', DIFFERENTIAL: 'Phân biệt', FINAL: 'Xác định' }

function present(value: string | null | undefined): value is string {
  return Boolean(value?.trim())
}

function branchAddress(branch: BranchPrintData) {
  return [branch.addressLine, branch.ward, branch.district, branch.province].filter(present).join(', ') || undefined
}

function printHeader(branch: BranchPrintData): PrintHeader {
  const branchDetails = [branch.code ? `Cơ sở ${branch.code}` : null,
    branch.medicalLicenseNo ? `GPHĐ: ${branch.medicalLicenseNo}` : null].filter(present).join(' · ')
  return {
    clinicName: branch.name,
    branchName: branchDetails || undefined,
    address: branchAddress(branch),
    phone: branch.phone ? `Điện thoại: ${branch.phone}` : undefined,
    email: branch.email ?? undefined,
  }
}

function printFooter(printedBy?: string | null) {
  const actor = present(printedBy) ? ` · Người in: ${printedBy}` : ''
  return `Thời điểm in: ${formatViDateTime(new Date())}${actor}`
}

function maskedIdentifier(value: string | null) {
  if (!value) return '—'
  const visible = value.slice(-4)
  return value.length <= 4 ? value : `${'•'.repeat(Math.min(value.length - 4, 8))}${visible}`
}

function sourceLabel(source: QueueTicket['encounterSource']) {
  return source === 'WALK_IN' ? 'Khách đến trực tiếp' : 'Theo lịch hẹn'
}

function resultValue(value: unknown) {
  if (value == null) return '—'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) } catch { return 'Không thể hiển thị' }
}

export function receptionSlipPrintDocument(
  branch: ReceptionBranch | (ReceptionBranch & BranchPrintData),
  ticket: QueueTicket,
  printedBy?: string | null,
): PrintDocumentModel {
  const service = ticket.initialService
  return {
    header: printHeader(branch),
    title: 'PHIẾU TIẾP NHẬN',
    subtitle: 'Vui lòng giữ phiếu và theo dõi số thứ tự',
    documentCode: ticket.encounterCode,
    pageSize: 'A5',
    fields: [
      { label: 'Số thứ tự', value: ticket.displayNumber, emphasis: true },
      { label: 'Thời điểm cấp số', value: formatViDateTime(ticket.issuedAtUtc, branch.timezoneName) },
      { label: 'Bệnh nhân', value: ticket.patient.fullName },
      { label: 'Mã bệnh nhân', value: ticket.patient.code },
      { label: 'Ngày sinh', value: formatViDate(ticket.patient.dateOfBirth) },
      { label: 'Giới tính', value: formatViGender(ticket.patient.gender) },
      { label: 'Điện thoại', value: ticket.patient.phone },
      { label: 'Hình thức tiếp nhận', value: ticket.bookingChannel ? channelName[ticket.bookingChannel] : sourceLabel(ticket.encounterSource) },
      { label: 'Bác sĩ', value: ticket.doctor.fullName },
      { label: 'Phòng khám', value: ticket.room?.name },
    ],
    sections: [{
      title: 'Dịch vụ ban đầu',
      fields: [
        { label: 'Dịch vụ', value: service ? `${service.code} · ${service.name}` : 'Chưa xác định', fullWidth: true },
        { label: 'Số lượng', value: service?.quantity },
        { label: 'Đơn giá', value: service ? formatViMoney(service.unitPrice, service.currencyCode) : null },
        { label: 'Tạm tính dịch vụ ban đầu', value: service ? formatViMoney(service.lineTotal, service.currencyCode) : null, emphasis: true },
      ],
    }],
    notes: [
      'Số tiền trên phiếu chỉ là tạm tính cho dịch vụ ban đầu, chưa bao gồm chỉ định thêm, thuốc, BHYT, giảm trừ hoặc hoàn tiền.',
      'Số tiền cần thanh toán chính thức được xác định trên bảng kê chi phí tại quầy thu ngân.',
    ],
    footer: printFooter(printedBy),
  }
}

export function appointmentPrintDocument(item: Appointment, printedBy?: string | null): PrintDocumentModel {
  return {
    header: printHeader({ name: item.branch.name }),
    title: 'PHIẾU HẸN KHÁM',
    documentCode: item.code,
    pageSize: 'A5',
    fields: [
      { label: 'Bệnh nhân', value: item.patient.fullName },
      { label: 'Mã bệnh nhân', value: item.patient.code },
      { label: 'Ngày khám', value: formatViDate(item.serviceDateLocal), emphasis: true },
      { label: 'Giờ khám', value: `${item.startTimeLocal} – ${item.endTimeLocal}`, emphasis: true },
      { label: 'Dịch vụ', value: `${item.service.code} · ${item.service.name}`, fullWidth: true },
      { label: 'Bác sĩ', value: item.doctor.fullName },
      { label: 'Phòng', value: item.roomName },
      { label: 'Kênh đăng ký', value: channelName[item.bookingChannel] ?? item.bookingChannel },
      { label: 'Lý do khám', value: item.chiefComplaint, fullWidth: true },
    ],
    notes: ['Vui lòng đến sớm và mang theo giấy tờ tùy thân, thẻ BHYT (nếu có).'],
    footer: printFooter(printedBy),
  }
}

export function patientProfilePrintDocument(patient: PatientDetail, printedBy?: string | null): PrintDocumentModel {
  return {
    header: printHeader({ name: patient.branch.name }),
    title: 'THÔNG TIN HÀNH CHÍNH BỆNH NHÂN',
    documentCode: patient.code,
    pageSize: 'A4',
    fields: [
      { label: 'Họ và tên', value: patient.fullName, emphasis: true },
      { label: 'Mã bệnh nhân', value: patient.code },
      { label: 'Ngày sinh', value: formatViDate(patient.dateOfBirth) },
      { label: 'Giới tính', value: formatViGender(patient.gender) },
      { label: 'Điện thoại', value: patient.phone },
      { label: 'Email', value: patient.email },
      { label: 'Số định danh', value: maskedIdentifier(patient.nationalId) },
      { label: 'Số BHYT', value: patient.healthInsuranceNo },
      { label: 'Tỉnh/thành', value: patient.province },
      { label: 'Địa chỉ', value: patient.addressLine, fullWidth: true },
      { label: 'Trạng thái hồ sơ', value: patient.status },
    ],
    notes: ['Tài liệu chứa thông tin cá nhân. Chỉ sử dụng cho mục đích chăm sóc và quản lý người bệnh.'],
    signatures: [{ label: 'Người bệnh/người đại diện', hint: 'Ký và ghi rõ họ tên' }, { label: 'Nhân viên tiếp nhận', hint: 'Ký và ghi rõ họ tên' }],
    footer: printFooter(printedBy),
  }
}

function structuredResultSections(item: ClinicalEncounterDetail, timeZone?: string): PrintSection[] {
  return item.services.filter((service) => service.result).map((service) => {
    const result = service.result
    const values = result?.result && typeof result.result === 'object' && !Array.isArray(result.result)
      ? result.result as Record<string, unknown> : {}
    const rows = service.resultSchema ? Object.entries(service.resultSchema.properties).map(([key, schema]) => ({
      name: schema.title,
      value: resultValue(values[key]),
      unit: schema.unit ?? '',
    })) : Object.entries(values).map(([key, value]) => ({ name: key, value: resultValue(value), unit: '' }))
    return {
      title: `Kết quả: ${service.name}`,
      fields: [
        { label: 'Tóm tắt', value: result?.summary, fullWidth: true },
        { label: 'Kết luận', value: result?.conclusion, fullWidth: true, emphasis: true },
        { label: 'Thời điểm chốt', value: formatViDateTime(result?.finalizedAtUtc, timeZone) },
      ],
      ...(rows.length ? { table: { columns: [
        { key: 'name', label: 'Chỉ số' }, { key: 'value', label: 'Kết quả' }, { key: 'unit', label: 'Đơn vị' },
      ], rows } } : {}),
    }
  })
}

export function clinicalReportPrintDocument(
  branch: ReceptionBranch | (ReceptionBranch & BranchPrintData),
  item: ClinicalEncounterDetail,
  printedBy?: string | null,
): PrintDocumentModel {
  const latestVital = item.vitalSigns.at(-1)
  const watermark = item.status === 'COMPLETED' ? 'BẢN CHỜ KÝ'
    : item.signature && !item.signature.isVerified ? 'DẤU KÝ KHÔNG HỢP LỆ' : undefined
  return {
    header: printHeader(branch),
    title: 'KẾT QUẢ KHÁM BỆNH',
    subtitle: item.status === 'SIGNED' ? 'Hồ sơ đã ký' : 'Bản xem trước – chưa phải kết quả chính thức',
    documentCode: item.code,
    pageSize: 'A4',
    watermark,
    fields: [
      { label: 'Bệnh nhân', value: item.patient.fullName, emphasis: true },
      { label: 'Mã bệnh nhân', value: item.patient.code },
      { label: 'Ngày sinh', value: formatViDate(item.patient.dateOfBirth) },
      { label: 'Giới tính', value: formatViGender(item.patient.gender) },
      { label: 'Bác sĩ phụ trách', value: item.doctor.fullName },
      { label: 'Phòng khám', value: item.room?.name },
      { label: 'Thời điểm đến', value: formatViDateTime(item.arrivedAtUtc, branch.timezoneName) },
      { label: 'Lý do khám', value: item.chiefComplaint, fullWidth: true },
    ],
    sections: [
      {
        title: 'Sinh hiệu gần nhất',
        fields: latestVital ? [
          { label: 'Nhiệt độ', value: latestVital.temperatureC == null ? null : `${latestVital.temperatureC} °C` },
          { label: 'Mạch', value: latestVital.pulseBpm == null ? null : `${latestVital.pulseBpm} lần/phút` },
          { label: 'Huyết áp', value: latestVital.systolicBpMmhg == null && latestVital.diastolicBpMmhg == null
            ? null : `${latestVital.systolicBpMmhg ?? '—'}/${latestVital.diastolicBpMmhg ?? '—'} mmHg` },
          { label: 'SpO₂', value: latestVital.spo2Percent == null ? null : `${latestVital.spo2Percent}%` },
          { label: 'Chiều cao / cân nặng', value: `${latestVital.heightCm ?? '—'} cm / ${latestVital.weightKg ?? '—'} kg` },
          { label: 'BMI', value: latestVital.bmi },
        ] : [],
        notes: latestVital ? [`Đo lúc ${formatViDateTime(latestVital.measuredAtUtc, branch.timezoneName)} bởi ${latestVital.measuredBy}.`] : ['Chưa ghi nhận sinh hiệu.'],
      },
      { title: 'Nội dung khám', fields: [
        { label: 'Bệnh sử', value: item.historyOfPresentIllness, fullWidth: true },
        { label: 'Khám thực thể', value: item.physicalExamination, fullWidth: true },
        { label: 'Nhận định', value: item.clinicalAssessment, fullWidth: true },
        { label: 'Kế hoạch điều trị', value: item.treatmentPlan, fullWidth: true },
      ] },
      { title: 'Chẩn đoán', table: {
        columns: [{ key: 'primary', label: '' }, { key: 'code', label: 'Mã' }, { key: 'name', label: 'Chẩn đoán' }, { key: 'type', label: 'Loại' }],
        rows: item.diagnoses.map((diagnosis) => ({ primary: diagnosis.isPrimary ? 'Chính' : '', code: diagnosis.code,
          name: diagnosis.name, type: diagnosis.type ? diagnosisTypeName[diagnosis.type] ?? diagnosis.type : '—' })),
        emptyText: 'Chưa ghi chẩn đoán.',
      } },
      { title: 'Chỉ định', table: {
        columns: [{ key: 'code', label: 'Mã' }, { key: 'name', label: 'Dịch vụ' }, { key: 'quantity', label: 'SL', align: 'right' }, { key: 'status', label: 'Trạng thái' }],
        rows: item.services.map((service) => ({ code: service.code, name: service.name, quantity: service.quantity,
          status: statusName[service.status] ?? service.status })), emptyText: 'Không có chỉ định.',
      } },
      ...structuredResultSections(item, branch.timezoneName),
      { title: 'Dặn dò & tái khám', fields: [
        { label: 'Dặn dò', value: item.followUpInstructions, fullWidth: true },
        { label: 'Ngày tái khám', value: formatViDate(item.followUpDate) },
      ] },
      ...(item.amendments.length ? [{ title: 'Phụ lục sau ký', table: {
        columns: [{ key: 'number', label: '#' }, { key: 'content', label: 'Nội dung' }, { key: 'reason', label: 'Lý do' },
          { key: 'actor', label: 'Người bổ sung' }, { key: 'time', label: 'Thời điểm' }],
        rows: item.amendments.map((entry) => ({ number: entry.number, content: entry.content, reason: entry.reason,
          actor: entry.amendedBy, time: formatViDateTime(entry.amendedAtUtc, branch.timezoneName) })),
      } }] : []),
    ],
    notes: item.signature ? [`Dấu toàn vẹn SHA-256: ${item.signature.sha256}`] : ['Bản này chưa được ký, không dùng làm kết quả chính thức.'],
    signatures: [{ label: 'Bác sĩ phụ trách', name: item.doctor.fullName,
      hint: item.signedAtUtc ? `Đã ký lúc ${formatViDateTime(item.signedAtUtc, branch.timezoneName)}` : 'Ký và ghi rõ họ tên' }],
    footer: printFooter(printedBy),
  }
}

export function prescriptionPrintDocument(rx: PrescriptionDetail, printedBy?: string | null): PrintDocumentModel {
  const doctorName = [rx.prescriber.academicTitle, rx.prescriber.fullName].filter(present).join(' ')
  const watermark = rx.status === 'DRAFT' ? 'BẢN NHÁP' : rx.status === 'CANCELLED' ? 'ĐÃ HỦY'
    : rx.status === 'EXPIRED' ? 'HẾT HIỆU LỰC' : undefined
  return {
    header: printHeader(rx.branch),
    title: 'ĐƠN THUỐC',
    subtitle: `Trạng thái: ${statusName[rx.status] ?? rx.status}`,
    documentCode: rx.code,
    pageSize: 'A5',
    watermark,
    fields: [
      { label: 'Bệnh nhân', value: rx.patientName, emphasis: true },
      { label: 'Mã bệnh nhân', value: rx.patientCode },
      { label: 'Ngày sinh', value: formatViDate(rx.patient.dateOfBirth) },
      { label: 'Giới tính', value: formatViGender(rx.patient.gender) },
      { label: 'Điện thoại', value: rx.patient.phone },
      { label: 'Số BHYT', value: rx.patient.healthInsuranceNo },
      { label: 'Địa chỉ', value: rx.patient.addressLine, fullWidth: true },
      { label: 'Ngày phát hành', value: formatViDateTime(rx.issuedAtUtc, rx.branch.timezoneName) },
      { label: 'Dùng đến', value: formatViDate(rx.validUntil) },
      { label: 'Bác sĩ kê đơn', value: doctorName },
      { label: 'Số CCHN', value: rx.prescriber.medicalLicenseNo },
    ],
    sections: [
      { title: 'Thuốc kê', table: {
        columns: [
          { key: 'index', label: '#', align: 'center', width: '6%' },
          { key: 'medicine', label: 'Thuốc – hàm lượng' },
          { key: 'quantity', label: 'SL', align: 'right', width: '9%' },
          { key: 'dose', label: 'Liều dùng' },
          { key: 'usage', label: 'Cách dùng' },
        ],
        rows: rx.items.map((item, index) => ({ index: index + 1, medicine: `${item.medicineName} ${item.strength}`,
          quantity: item.prescribedQuantity, dose: [item.dose, item.frequency,
            item.durationDays == null ? null : `${item.durationDays} ngày`, item.timingInstruction].filter(present).join(' · '),
          usage: `${item.route} · ${item.usageInstruction}` })), emptyText: 'Đơn chưa có thuốc.',
      } },
      { title: 'Hướng dẫn chung', paragraphs: [rx.clinicalNotes, rx.generalInstructions] },
    ],
    notes: rx.drugAllergies.length ? [`Dị ứng đã ghi nhận: ${rx.drugAllergies.map((entry) => `${entry.allergenName} (${entry.severity})`).join(', ')}`] : [],
    signatures: [{ label: 'Bác sĩ kê đơn', name: doctorName, hint: `Số CCHN: ${rx.prescriber.medicalLicenseNo}` }],
    footer: printFooter(printedBy),
  }
}

function billingBranch(branch: BillingBranch): BranchPrintData {
  return branch
}

export function invoicePrintDocument(branch: BillingBranch, bill: InvoiceDetail, printedBy?: string | null): PrintDocumentModel {
  const draft = bill.status === 'DRAFT'
  return {
    header: printHeader(billingBranch(branch)),
    title: draft ? 'PHIẾU TẠM TÍNH' : 'BẢNG KÊ CHI PHÍ',
    subtitle: `Trạng thái: ${statusName[bill.status] ?? bill.status}`,
    documentCode: bill.number,
    pageSize: 'A4',
    watermark: draft ? 'TẠM TÍNH' : bill.status === 'VOID' ? 'ĐÃ HỦY' : undefined,
    fields: [
      { label: 'Bệnh nhân', value: bill.patientName, emphasis: true },
      { label: 'Mã bệnh nhân', value: bill.patientCode },
      { label: 'Mã lượt khám', value: bill.encounterCode },
      { label: 'Ngày lập', value: formatViDateTime(bill.issuedAtUtc ?? bill.createdAtUtc, branch.timezoneName) },
    ],
    sections: [
      { title: 'Chi tiết chi phí', table: {
        columns: [
          { key: 'index', label: '#', align: 'center', width: '5%' }, { key: 'name', label: 'Nội dung' },
          { key: 'quantity', label: 'SL', align: 'right' }, { key: 'unitPrice', label: 'Đơn giá', align: 'right' },
          { key: 'discount', label: 'Giảm', align: 'right' }, { key: 'total', label: 'Thành tiền', align: 'right' },
        ],
        rows: bill.items.map((item, index) => ({ index: index + 1, name: `${item.code ? `${item.code} · ` : ''}${item.name}`,
          quantity: item.quantity, unitPrice: formatViMoney(item.unitPrice), discount: formatViMoney(item.discountAmount),
          total: formatViMoney(item.lineTotal) })), emptyText: 'Chưa có khoản chi phí.',
      } },
      { title: 'Tổng hợp', fields: [
        { label: 'Tạm tính', value: formatViMoney(bill.subtotalAmount) },
        { label: 'Giảm giá', value: formatViMoney(bill.discountAmount) },
        { label: 'Thuế', value: formatViMoney(bill.taxAmount) },
        { label: 'Tổng chi phí', value: formatViMoney(bill.totalAmount), emphasis: true },
        { label: 'BHYT/bảo hiểm chi trả', value: formatViMoney(bill.insuranceAmount) },
        { label: 'Người bệnh chịu', value: formatViMoney(bill.patientPayableAmount), emphasis: true },
        { label: 'Đã thu ròng', value: formatViMoney(Number(bill.paidAmount) - Number(bill.refundedAmount)) },
        { label: 'Còn cần thanh toán', value: formatViMoney(bill.balanceDue), emphasis: true },
      ] },
    ],
    notes: draft
      ? ['Số tiền tạm tính có thể thay đổi khi đồng bộ thêm dịch vụ, thuốc, BHYT, giảm trừ hoặc hoàn tiền.']
      : ['Đây là bảng kê chi phí/đối soát thanh toán, không thay thế hóa đơn điện tử hoặc hóa đơn GTGT.'],
    signatures: [{ label: 'Người bệnh/người nộp tiền', hint: 'Ký và ghi rõ họ tên' },
      { label: 'Người lập/in bảng kê', name: printedBy ?? undefined }],
    footer: printFooter(printedBy),
  }
}

export function paymentReceiptPrintDocument(
  branch: BillingBranch,
  bill: InvoiceDetail,
  payment: InvoicePaymentAllocation,
  printedBy?: string | null,
): PrintDocumentModel {
  return {
    header: printHeader(billingBranch(branch)),
    title: 'PHIẾU THU',
    documentCode: payment.number,
    pageSize: 'A5',
    fields: [
      { label: 'Bệnh nhân', value: bill.patientName }, { label: 'Mã bệnh nhân', value: bill.patientCode },
      { label: 'Bảng kê', value: bill.number }, { label: 'Mã lượt khám', value: bill.encounterCode },
      { label: 'Số tiền thu', value: formatViMoney(payment.amount), emphasis: true },
      { label: 'Phương thức', value: paymentMethodName[payment.method] ?? payment.method },
      { label: 'Thời điểm thu', value: formatViDateTime(payment.paidAtUtc, branch.timezoneName) },
      { label: 'Mã giao dịch', value: payment.externalTransactionId },
    ],
    notes: ['Phiếu thu xác nhận riêng khoản thanh toán nêu trên. Số dư hiện tại xem trên bảng kê chi phí mới nhất.'],
    signatures: [{ label: 'Người nộp tiền', hint: 'Ký và ghi rõ họ tên' },
      { label: 'Người lập/in phiếu', name: printedBy ?? undefined }],
    footer: printFooter(printedBy),
  }
}

export function refundReceiptPrintDocument(
  branch: BillingBranch,
  bill: InvoiceDetail,
  refund: InvoiceRefund,
  printedBy?: string | null,
): PrintDocumentModel {
  return {
    header: printHeader(billingBranch(branch)),
    title: 'PHIẾU HOÀN TIỀN',
    documentCode: refund.number,
    pageSize: 'A5',
    fields: [
      { label: 'Bệnh nhân', value: bill.patientName }, { label: 'Mã bệnh nhân', value: bill.patientCode },
      { label: 'Bảng kê', value: bill.number }, { label: 'Mã lượt khám', value: bill.encounterCode },
      { label: 'Số tiền hoàn', value: formatViMoney(refund.amount), emphasis: true },
      { label: 'Phương thức', value: paymentMethodName[refund.method] ?? refund.method },
      { label: 'Thời điểm hoàn', value: formatViDateTime(refund.refundedAtUtc, branch.timezoneName) },
      { label: 'Lý do', value: refund.reason, fullWidth: true },
    ],
    signatures: [{ label: 'Người nhận tiền', hint: 'Ký và ghi rõ họ tên' },
      { label: 'Người lập/in phiếu', name: printedBy ?? undefined }],
    footer: printFooter(printedBy),
  }
}

export type { BranchPrintData }
