import type {
  BillingBranch,
  ClinicalEncounterDetail,
  InvoiceDetail,
  PrescriptionDetail,
  QueueTicket,
  ReceptionBranch,
} from '@clinic/generated-api-types'
import { describe, expect, it } from 'vitest'
import {
  clinicalReportPrintDocument,
  invoicePrintDocument,
  prescriptionPrintDocument,
  receptionSlipPrintDocument,
} from './documents'

const receptionBranch: ReceptionBranch = {
  publicId: '11111111-1111-4111-8111-111111111111', code: 'MAIN', name: 'Phòng khám An Tâm',
  timezoneName: 'SE Asia Standard Time', medicalLicenseNo: null, phone: '02812345678', email: null,
  addressLine: '1 Đường Sức Khỏe', ward: null, district: null, province: 'TP.HCM',
}

describe('print document business rules', () => {
  it('labels the reception amount as an initial estimate from the snapshot', () => {
    const ticket: QueueTicket = {
      publicId: '21111111-1111-4111-8111-111111111111', encounterPublicId: '31111111-1111-4111-8111-111111111111',
      displayNumber: 'A001', priorityLevel: 0, status: 'WAITING', issuedAtUtc: '2026-09-18T01:00:00Z',
      calledAtUtc: null, serviceStartedAtUtc: null, encounterCode: 'LK-001', encounterSource: 'APPOINTMENT',
      bookingChannel: 'ONLINE', patient: { publicId: '41111111-1111-4111-8111-111111111111', code: 'BN001',
        fullName: 'Nguyễn An', dateOfBirth: '1990-01-02', gender: 'MALE', phone: '0900000000' },
      doctor: { publicId: '51111111-1111-4111-8111-111111111111', fullName: 'BS. Trần Bình' },
      room: { publicId: '61111111-1111-4111-8111-111111111111', name: 'Phòng 01' },
      initialService: { code: 'KHAM', name: 'Khám tổng quát', quantity: '1', unitPrice: '200000',
        lineTotal: '200000', currencyCode: 'VND' },
    }

    const document = receptionSlipPrintDocument(receptionBranch, ticket)

    expect(document.sections?.[0]?.fields?.some((field) => field.label === 'Tạm tính dịch vụ ban đầu')).toBe(true)
    expect(document.notes?.join(' ')).toContain('chưa bao gồm chỉ định thêm')
    expect(document.notes?.join(' ')).toContain('quầy thu ngân')
  })

  it('marks completed clinical results as unsigned drafts', () => {
    const encounter: ClinicalEncounterDetail = {
      publicId: '71111111-1111-4111-8111-111111111111', code: 'LK-002', source: 'WALK_IN', status: 'COMPLETED',
      arrivedAtUtc: '2026-09-18T01:00:00Z', startedAtUtc: '2026-09-18T01:10:00Z', completedAtUtc: '2026-09-18T01:30:00Z',
      chiefComplaint: 'Đau đầu', patient: { publicId: '81111111-1111-4111-8111-111111111111', code: 'BN002',
        fullName: 'Lê Minh', dateOfBirth: '1988-03-04', gender: 'FEMALE' },
      doctor: { publicId: '91111111-1111-4111-8111-111111111111', fullName: 'BS. Trần Bình' }, room: null, queue: null,
      signedAtUtc: null, patientRelease: null, signature: null, historyOfPresentIllness: null,
      physicalExamination: null, clinicalAssessment: null, treatmentPlan: null, followUpInstructions: null,
      followUpDate: null, vitalSigns: [], diagnoses: [], services: [], amendments: [], availableServices: [],
    }

    const document = clinicalReportPrintDocument(receptionBranch, encounter)

    expect(document.watermark).toBe('BẢN CHỜ KÝ')
    expect(document.subtitle).toContain('chưa phải kết quả chính thức')
  })

  it('prints a draft bill as an estimate and the authoritative amount as balance due', () => {
    const branch: BillingBranch = { ...receptionBranch }
    const bill: InvoiceDetail = {
      publicId: '12111111-1111-4111-8111-111111111111', number: 'HD-001', status: 'DRAFT',
      encounterPublicId: '13111111-1111-4111-8111-111111111111', encounterCode: 'LK-003',
      patientPublicId: '14111111-1111-4111-8111-111111111111', patientCode: 'BN003', patientName: 'Phạm Hà',
      currency: 'VND', patientPayableAmount: '300000', paidAmount: '100000', refundedAmount: '0', balanceDue: '200000',
      issuedAtUtc: null, createdAtUtc: '2026-09-18T01:00:00Z', supersedesInvoicePublicId: null,
      subtotalAmount: '300000', discountAmount: '0', taxAmount: '0', totalAmount: '300000', insuranceAmount: '0',
      dueAtUtc: null, voidedAtUtc: null, voidReason: null, items: [], payments: [], refunds: [],
    }

    const document = invoicePrintDocument(branch, bill)

    expect(document.title).toBe('PHIẾU TẠM TÍNH')
    expect(document.watermark).toBe('TẠM TÍNH')
    const totals = document.sections?.find((section) => section.title === 'Tổng hợp')?.fields
    expect(totals?.find((field) => field.label === 'Còn cần thanh toán')?.value).toContain('200.000')
  })

  it('includes prescriber identity and license on the prescription', () => {
    const prescription: PrescriptionDetail = {
      publicId: '15111111-1111-4111-8111-111111111111', code: 'DT-001', status: 'ISSUED',
      encounterPublicId: '16111111-1111-4111-8111-111111111111', patientPublicId: '17111111-1111-4111-8111-111111111111',
      patientCode: 'BN004', patientName: 'Vũ Nam', issuedAtUtc: '2026-09-18T01:00:00Z', validUntil: '2026-09-25', itemCount: 0,
      branch: receptionBranch, prescriber: { publicId: '18111111-1111-4111-8111-111111111111', fullName: 'Trần Bình',
        medicalLicenseNo: 'CCHN-001', academicTitle: 'BS.' },
      patient: { dateOfBirth: '1992-05-06', gender: 'MALE', phone: null, addressLine: null, healthInsuranceNo: null },
      clinicalNotes: null, generalInstructions: null, items: [], dispensations: [], dispensedItems: [], drugAllergies: [], allergyAlerts: [],
    }

    const document = prescriptionPrintDocument(prescription)

    expect(document.watermark).toBeUndefined()
    expect(document.fields?.find((field) => field.label === 'Bác sĩ kê đơn')?.value).toContain('Trần Bình')
    expect(document.fields?.find((field) => field.label === 'Số CCHN')?.value).toBe('CCHN-001')
  })
})
