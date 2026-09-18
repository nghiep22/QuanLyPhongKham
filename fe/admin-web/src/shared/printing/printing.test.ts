import { describe, expect, it } from 'vitest'
import {
  buildExcelCsv,
  buildPrintDocumentHtml,
  escapeCsvCell,
  formatViDate,
  formatViDateTime,
  formatViGender,
  formatViMoney,
  normalizePrintTimeZone,
  openPrintDocument,
  type PrintDocumentModel,
} from './index'

const documentModel: PrintDocumentModel = {
  header: {
    clinicName: 'Phòng khám <An Tâm>',
    branchName: 'Chi nhánh & Trung tâm',
    address: '1 "Đường A"',
  },
  title: 'Kết quả khám </title><script>alert(1)</script>',
  subtitle: 'Bản chính',
  documentCode: 'HS-001',
  pageSize: 'A5',
  watermark: '<DRAFT>',
  fields: [
    { label: 'Bệnh nhân', value: 'Nguyễn <Văn A>', fullWidth: true },
    { label: 'Đã thu', value: true, emphasis: true },
  ],
  sections: [
    {
      title: 'Chẩn đoán',
      paragraphs: ['Theo dõi & tái khám'],
      table: {
        columns: [
          { key: 'name', label: 'Dịch vụ', width: '60%' },
          { key: 'amount', label: 'Thành tiền', align: 'right', width: '40%' },
        ],
        rows: [{ name: '<img src=x onerror=alert(1)>', amount: '100.000 ₫' }],
      },
    },
  ],
  notes: ['Không tự ý dùng thuốc > liều'],
  signatures: [{ label: 'Bác sĩ', name: 'BS. A & B', hint: 'Ký, ghi rõ họ tên' }],
  footer: 'Thông tin y tế riêng tư',
}

describe('buildPrintDocumentHtml', () => {
  it('builds an A5 document and escapes every dynamic HTML value', () => {
    const html = buildPrintDocumentHtml(documentModel)

    expect(html).toContain('@page { size: A5 portrait;')
    expect(html).toContain('Phòng khám &lt;An Tâm&gt;')
    expect(html).toContain('Chi nhánh &amp; Trung tâm')
    expect(html).toContain('Kết quả khám &lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('&lt;DRAFT&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<img src=x')
  })

  it('rejects unsafe table widths instead of inserting them into CSS', () => {
    const html = buildPrintDocumentHtml({
      ...documentModel,
      sections: [{ table: { columns: [{ key: 'x', label: 'X', width: '10%;color:red' }], rows: [] } }],
    })

    expect(html).not.toContain('10%;color:red')
    expect(html).toContain('Không có dữ liệu')
  })
})

describe('Vietnamese print formatters', () => {
  it('formats date-only values without timezone drift', () => {
    expect(formatViDate('2026-09-18')).toBe('18/09/2026')
    expect(formatViDate('2026-02-30')).toBe('—')
  })

  it('formats UTC date-times in the Vietnam timezone', () => {
    expect(formatViDateTime('2026-09-18T03:30:00.000Z')).toBe('18/09/2026 10:30')
    expect(formatViDateTime('2026-09-18T03:30:00.000Z', 'SE Asia Standard Time')).toBe(
      '18/09/2026 10:30',
    )
    expect(normalizePrintTimeZone('Invalid/Timezone')).toBe('Asia/Ho_Chi_Minh')
  })

  it('formats money, gender and invalid values safely', () => {
    expect(formatViMoney(125000, 'VND')).toMatch(/125[.\s]000/)
    expect(formatViMoney('not-a-number')).toBe('—')
    expect(formatViGender('FEMALE')).toBe('Nữ')
    expect(formatViGender(null)).toBe('—')
  })
})

describe('Excel-compatible CSV', () => {
  it('adds a UTF-8 BOM and escapes commas, quotes and newlines', () => {
    const csv = buildExcelCsv(
      [
        { header: 'Họ, tên', value: 'name' },
        { header: 'Ghi chú', value: 'note' },
      ],
      [{ name: 'Nguyễn "An"', note: 'Dòng 1\nDòng 2' }],
    )

    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"Họ, tên"')
    expect(csv).toContain('"Nguyễn ""An"""')
    expect(csv).toContain('"Dòng 1\nDòng 2"')
  })

  it.each(['=SUM(A1:A2)', '+cmd', '-2+3', '@IMPORT', '  =1+1'])(
    'neutralizes formula-like text: %s',
    (value) => {
      expect(escapeCsvCell(value)).toBe(`"'${value}"`)
    },
  )

  it('keeps negative numeric values numeric', () => {
    expect(escapeCsvCell(-125)).toBe('"-125"')
  })
})

describe('browser-only actions', () => {
  it('does not attempt to print outside a browser', () => {
    expect(openPrintDocument(documentModel)).toBe(false)
  })
})
