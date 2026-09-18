import { EMPTY_PRINT_VALUE } from './formatters'

export type PrintPageSize = 'A4' | 'A5'
export type PrintValue = string | number | boolean | null | undefined

export interface PrintHeader {
  clinicName: string
  branchName?: string
  address?: string
  phone?: string
  email?: string
  website?: string
}

export interface PrintField {
  label: string
  value: PrintValue
  fullWidth?: boolean
  emphasis?: boolean
}

export interface PrintTableColumn {
  key: string
  label: string
  align?: 'left' | 'center' | 'right'
  width?: string
}

export interface PrintTable {
  columns: readonly PrintTableColumn[]
  rows: readonly Readonly<Record<string, PrintValue>>[]
  emptyText?: string
}

export interface PrintSection {
  title?: string
  fields?: readonly PrintField[]
  paragraphs?: readonly PrintValue[]
  table?: PrintTable
  notes?: readonly PrintValue[]
}

export interface PrintSignature {
  label: string
  name?: string
  hint?: string
}

export interface PrintDocumentModel {
  header: PrintHeader
  title: string
  subtitle?: string
  documentCode?: string
  pageSize?: PrintPageSize
  fields?: readonly PrintField[]
  sections?: readonly PrintSection[]
  notes?: readonly PrintValue[]
  signatures?: readonly PrintSignature[]
  footer?: string
  watermark?: string
}

const HTML_ESCAPE_PATTERN = /[&<>"']/g
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: PrintValue): string {
  return displayPrintValue(value).replace(
    HTML_ESCAPE_PATTERN,
    (character) => HTML_ENTITIES[character] ?? character,
  )
}

function displayPrintValue(value: PrintValue): string {
  if (value === null || value === undefined || value === '') {
    return EMPTY_PRINT_VALUE
  }
  if (typeof value === 'boolean') {
    return value ? 'Có' : 'Không'
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return EMPTY_PRINT_VALUE
  }
  return String(value)
}

function present(value: string | undefined): value is string {
  return Boolean(value?.trim())
}

function renderHeader(header: PrintHeader): string {
  const contact = [header.address, header.phone, header.email, header.website]
    .filter(present)
    .map((value) => `<div>${escapeHtml(value)}</div>`)
    .join('')

  return `<header class="print-header">
    <div class="clinic-name">${escapeHtml(header.clinicName)}</div>
    ${present(header.branchName) ? `<div class="branch-name">${escapeHtml(header.branchName)}</div>` : ''}
    ${contact ? `<div class="clinic-contact">${contact}</div>` : ''}
  </header>`
}

function renderFields(fields: readonly PrintField[] | undefined): string {
  if (!fields?.length) {
    return ''
  }

  return `<dl class="field-grid">${fields
    .map(
      (field) => `<div class="field${field.fullWidth ? ' field--wide' : ''}${field.emphasis ? ' field--emphasis' : ''}">
        <dt>${escapeHtml(field.label)}</dt>
        <dd>${escapeHtml(field.value)}</dd>
      </div>`,
    )
    .join('')}</dl>`
}

function safeColumnWidth(width: string | undefined): string {
  if (!width) {
    return ''
  }

  const match = /^(\d{1,3})(?:\.(\d{1,2}))?%$/.exec(width.trim())
  if (!match || Number.parseFloat(width) > 100) {
    return ''
  }
  return ` style="width:${escapeHtml(width.trim())}"`
}

function safeAlignment(align: PrintTableColumn['align']): 'left' | 'center' | 'right' {
  return align === 'center' || align === 'right' ? align : 'left'
}

function renderTable(table: PrintTable): string {
  const header = table.columns
    .map(
      (column) =>
        `<th class="align-${safeAlignment(column.align)}"${safeColumnWidth(column.width)}>${escapeHtml(column.label)}</th>`,
    )
    .join('')

  const body = table.rows.length
    ? table.rows
        .map(
          (row) => `<tr>${table.columns
            .map(
              (column) =>
                `<td class="align-${safeAlignment(column.align)}">${escapeHtml(row[column.key])}</td>`,
            )
            .join('')}</tr>`,
        )
        .join('')
    : `<tr><td class="empty-table" colspan="${Math.max(table.columns.length, 1)}">${escapeHtml(table.emptyText ?? 'Không có dữ liệu')}</td></tr>`

  return `<div class="table-wrap"><table>
    <thead><tr>${header}</tr></thead>
    <tbody>${body}</tbody>
  </table></div>`
}

function renderParagraphs(paragraphs: readonly PrintValue[] | undefined): string {
  if (!paragraphs?.length) {
    return ''
  }
  return `<div class="paragraphs">${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}</div>`
}

function renderNotes(notes: readonly PrintValue[] | undefined, withHeading = false): string {
  if (!notes?.length) {
    return ''
  }
  return `<aside class="notes">${withHeading ? '<div class="notes-title">Lưu ý</div>' : ''}<ul>${notes
    .map((note) => `<li>${escapeHtml(note)}</li>`)
    .join('')}</ul></aside>`
}

function renderSections(sections: readonly PrintSection[] | undefined): string {
  if (!sections?.length) {
    return ''
  }

  return sections
    .map(
      (section) => `<section class="document-section">
        ${present(section.title) ? `<h2>${escapeHtml(section.title)}</h2>` : ''}
        ${renderFields(section.fields)}
        ${renderParagraphs(section.paragraphs)}
        ${section.table ? renderTable(section.table) : ''}
        ${renderNotes(section.notes)}
      </section>`,
    )
    .join('')
}

function renderSignatures(signatures: readonly PrintSignature[] | undefined): string {
  if (!signatures?.length) {
    return ''
  }

  return `<section class="signatures">${signatures
    .map(
      (signature) => `<div class="signature">
        <div class="signature-label">${escapeHtml(signature.label)}</div>
        ${present(signature.hint) ? `<div class="signature-hint">${escapeHtml(signature.hint)}</div>` : ''}
        <div class="signature-space"></div>
        ${present(signature.name) ? `<div class="signature-name">${escapeHtml(signature.name)}</div>` : ''}
      </div>`,
    )
    .join('')}</section>`
}

function printStyles(pageSize: PrintPageSize): string {
  const pageMargin = pageSize === 'A5' ? '10mm' : '14mm'
  const baseFontSize = pageSize === 'A5' ? '10pt' : '10.5pt'

  return `
    @page { size: ${pageSize} portrait; margin: ${pageMargin}; }
    * { box-sizing: border-box; }
    html { color: #172033; background: #fff; font-family: Arial, "Helvetica Neue", sans-serif; font-size: ${baseFontSize}; }
    body { margin: 0; line-height: 1.42; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .document { position: relative; isolation: isolate; width: 100%; }
    .document > :not(.watermark) { position: relative; z-index: 1; }
    .watermark { position: fixed; inset: 45% 0 auto; z-index: 0; color: rgba(30, 64, 175, .09); font-size: 42pt; font-weight: 800; letter-spacing: .08em; pointer-events: none; text-align: center; text-transform: uppercase; transform: rotate(-24deg); }
    .print-header { border-bottom: 2px solid #1d4ed8; padding-bottom: 8px; text-align: center; }
    .clinic-name { color: #153e75; font-size: 17pt; font-weight: 800; letter-spacing: .02em; text-transform: uppercase; }
    .branch-name { margin-top: 2px; font-size: 11pt; font-weight: 700; }
    .clinic-contact { margin-top: 3px; color: #475569; font-size: 8.5pt; }
    .document-heading { margin: 16px 0 12px; text-align: center; }
    h1 { margin: 0; color: #102a56; font-size: 18pt; line-height: 1.2; text-transform: uppercase; }
    .subtitle { margin-top: 4px; color: #475569; font-style: italic; white-space: pre-wrap; }
    .document-code { margin-top: 4px; font-size: 9pt; font-weight: 700; }
    .field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px 18px; margin: 0; }
    .field { display: grid; grid-template-columns: minmax(92px, .8fr) minmax(0, 1.5fr); gap: 6px; min-width: 0; }
    .field--wide { grid-column: 1 / -1; }
    .field dt { color: #475569; font-weight: 600; }
    .field dd { min-width: 0; margin: 0; font-weight: 500; overflow-wrap: anywhere; white-space: pre-wrap; }
    .field--emphasis dd { color: #b42318; font-size: 1.08em; font-weight: 800; }
    .document-section { break-inside: avoid; margin-top: 14px; }
    .document-section h2 { margin: 0 0 7px; border-left: 4px solid #2563eb; padding: 4px 7px; background: #eff6ff; color: #173b70; font-size: 11.5pt; text-transform: uppercase; }
    .paragraphs p { margin: 5px 0; white-space: pre-wrap; }
    .table-wrap { width: 100%; overflow: visible; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th, td { border: 1px solid #94a3b8; padding: 5px 6px; vertical-align: top; overflow-wrap: anywhere; white-space: pre-wrap; }
    th { background: #eaf2ff; color: #173b70; font-size: 9pt; font-weight: 700; }
    .align-left { text-align: left; }
    .align-center { text-align: center; }
    .align-right { text-align: right; }
    .empty-table { color: #64748b; font-style: italic; text-align: center; }
    .notes { break-inside: avoid; margin-top: 12px; border: 1px solid #f0c36d; border-radius: 4px; padding: 7px 9px; background: #fffaf0; font-size: 9pt; }
    .notes-title { margin-bottom: 3px; font-weight: 800; text-transform: uppercase; }
    .notes ul { margin: 0; padding-left: 18px; }
    .notes li { margin: 2px 0; white-space: pre-wrap; }
    .signatures { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 20px; margin-top: 22px; break-inside: avoid; text-align: center; }
    .signature-label { font-weight: 700; }
    .signature-hint { color: #64748b; font-size: 8.5pt; font-style: italic; }
    .signature-space { height: 52px; }
    .signature-name { font-weight: 700; }
    .print-footer { margin-top: 18px; border-top: 1px solid #cbd5e1; padding-top: 6px; color: #64748b; font-size: 8pt; text-align: center; white-space: pre-wrap; }
    @media screen { body { max-width: ${pageSize === 'A5' ? '148mm' : '210mm'}; margin: 18px auto; padding: ${pageMargin}; box-shadow: 0 5px 24px rgba(15, 23, 42, .15); } }
    @media print { .document { min-height: 0; } }
  `
}

export function buildPrintDocumentHtml(model: PrintDocumentModel): string {
  const pageSize: PrintPageSize = model.pageSize === 'A5' ? 'A5' : 'A4'
  const title = displayPrintValue(model.title)

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <title>${escapeHtml(title)}</title>
  <style>${printStyles(pageSize)}</style>
</head>
<body>
  <main class="document">
    ${present(model.watermark) ? `<div class="watermark">${escapeHtml(model.watermark)}</div>` : ''}
    ${renderHeader(model.header)}
    <div class="document-heading">
      <h1>${escapeHtml(title)}</h1>
      ${present(model.subtitle) ? `<div class="subtitle">${escapeHtml(model.subtitle)}</div>` : ''}
      ${present(model.documentCode) ? `<div class="document-code">Mã: ${escapeHtml(model.documentCode)}</div>` : ''}
    </div>
    ${renderFields(model.fields)}
    ${renderSections(model.sections)}
    ${renderNotes(model.notes, true)}
    ${renderSignatures(model.signatures)}
    ${present(model.footer) ? `<footer class="print-footer">${escapeHtml(model.footer)}</footer>` : ''}
  </main>
</body>
</html>`
}

export function openPrintDocument(model: PrintDocumentModel): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  const printWindow = window.open('', '_blank', 'popup,width=980,height=760')
  if (!printWindow) {
    return false
  }

  try {
    printWindow.opener = null
    printWindow.document.open()
    printWindow.document.write(buildPrintDocumentHtml(model))
    printWindow.document.close()

    window.setTimeout(() => {
      if (!printWindow.closed) {
        printWindow.focus()
        printWindow.print()
      }
    }, 100)
    return true
  } catch {
    printWindow.close()
    return false
  }
}
