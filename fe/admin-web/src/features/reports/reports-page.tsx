import { ApiClientError } from '@clinic/generated-api-client'
import type { InventoryReport, OperationsReport, ReportBranch, RevenueReport } from '@clinic/generated-api-types'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiClient } from '../../shared/api/client'
import { downloadExcelCsv, type CsvColumn } from '../../shared/printing'

type ExportMetadata = {
  rowType: string
  item?: string
  value?: string | number
}

type OperationsExportRow = ExportMetadata & {
  date?: string
  appointmentCount?: number
  arrivedCount?: number
  completedCount?: number
  noShowCount?: number
  cancelledCount?: number
}

type RevenueExportRow = ExportMetadata & {
  date?: string
  method?: string
  methodCode?: string
  collectedAmount?: number | string
  refundedAmount?: number | string
  netCollectedAmount?: number | string
}

type InventoryExportRow = ExportMetadata & {
  category?: string
  code?: string
  name?: string
  batchNumber?: string
  expiryDate?: string
  quantity?: number | string
  amount?: number | string
  reorderLevel?: number | string
  daysToExpiry?: number
}

const operationsColumns: readonly CsvColumn<OperationsExportRow>[] = [
  { header: 'Loại dòng', value: 'rowType' },
  { header: 'Chỉ tiêu', value: 'item' },
  { header: 'Giá trị', value: 'value' },
  { header: 'Ngày', value: 'date' },
  { header: 'Lịch hẹn', value: 'appointmentCount' },
  { header: 'Lượt đến', value: 'arrivedCount' },
  { header: 'Hoàn tất', value: 'completedCount' },
  { header: 'Không đến', value: 'noShowCount' },
  { header: 'Đã hủy', value: 'cancelledCount' },
]

const revenueColumns: readonly CsvColumn<RevenueExportRow>[] = [
  { header: 'Loại dòng', value: 'rowType' },
  { header: 'Chỉ tiêu', value: 'item' },
  { header: 'Giá trị', value: 'value' },
  { header: 'Ngày', value: 'date' },
  { header: 'Phương thức', value: 'method' },
  { header: 'Mã phương thức', value: 'methodCode' },
  { header: 'Thu (VND)', value: 'collectedAmount' },
  { header: 'Hoàn (VND)', value: 'refundedAmount' },
  { header: 'Thu ròng (VND)', value: 'netCollectedAmount' },
]

const inventoryColumns: readonly CsvColumn<InventoryExportRow>[] = [
  { header: 'Loại dòng', value: 'rowType' },
  { header: 'Chỉ tiêu', value: 'item' },
  { header: 'Giá trị', value: 'value' },
  { header: 'Nhóm chi tiết', value: 'category' },
  { header: 'Mã', value: 'code' },
  { header: 'Tên', value: 'name' },
  { header: 'Số lô', value: 'batchNumber' },
  { header: 'Ngày hết hạn', value: 'expiryDate' },
  { header: 'Số lượng', value: 'quantity' },
  { header: 'Thành tiền (VND)', value: 'amount' },
  { header: 'Mức đặt hàng', value: 'reorderLevel' },
  { header: 'Số ngày còn lại', value: 'daysToExpiry' },
]

function localDate(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
function initialRange() {
  const to = new Date(); const from = new Date(to)
  from.setDate(from.getDate() - 29)
  return { from: localDate(from), to: localDate(to) }
}
function message(error: unknown) {
  if (!(error instanceof ApiClientError)) return 'Không thể kết nối hệ thống báo cáo. Hãy thử lại.'
  if (error.status === 403) return 'Bạn không có quyền xem nhóm báo cáo này tại chi nhánh đã chọn.'
  return error.message
}
const money = (value: string | number) => `${Number(value).toLocaleString('vi-VN')} ₫`
const quantity = (value: string | number) => Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
const dateName = (value: string) => new Intl.DateTimeFormat('vi-VN').format(new Date(`${value}T00:00:00`))
const methods: Record<string, string> = {
  CASH: 'Tiền mặt', CARD: 'Thẻ', BANK_TRANSFER: 'Chuyển khoản', EWALLET: 'Ví điện tử', OTHER: 'Khác',
}

function exportNumber(value: string | number) {
  const number = Number(value)
  return Number.isFinite(number) ? number : String(value)
}

function safeFilenamePart(value: string) {
  const part = value.trim().toLocaleLowerCase('vi-VN').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return part.slice(0, 48) || 'khong-xac-dinh'
}

function reportFilename(kind: string, branchCode: string, from: string, to: string) {
  return [
    'bao-cao',
    safeFilenamePart(kind),
    safeFilenamePart(branchCode),
    safeFilenamePart(from),
    safeFilenamePart(to),
  ].join('-')
}

function reportMetadata(title: string, branch: ReportBranch, from: string, to: string): ExportMetadata[] {
  return [
    { rowType: 'Thông tin báo cáo', item: 'Báo cáo', value: title },
    { rowType: 'Thông tin báo cáo', item: 'Chi nhánh', value: branch.name },
    { rowType: 'Thông tin báo cáo', item: 'Mã chi nhánh', value: branch.code },
    { rowType: 'Thông tin báo cáo', item: 'Từ ngày', value: from },
    { rowType: 'Thông tin báo cáo', item: 'Đến ngày', value: to },
    { rowType: 'Thông tin báo cáo', item: 'Múi giờ', value: branch.timezoneName },
  ]
}

function exportOperationsReport(report: OperationsReport, branch: ReportBranch, from: string, to: string) {
  const rows: OperationsExportRow[] = [
    ...reportMetadata('Vận hành lịch hẹn và lượt khám', branch, from, to),
    { rowType: 'Tổng quan', item: 'Lịch hẹn', value: report.summary.appointmentCount },
    { rowType: 'Tổng quan', item: 'Lịch hẹn đã xác nhận', value: report.summary.confirmedCount },
    { rowType: 'Tổng quan', item: 'Lượt đến', value: report.summary.encounterCount },
    { rowType: 'Tổng quan', item: 'Lượt khám hoàn tất', value: report.summary.completedEncounterCount },
    { rowType: 'Tổng quan', item: 'Không đến', value: report.summary.noShowCount },
    { rowType: 'Tổng quan', item: 'Đã hủy', value: report.summary.cancelledCount },
    { rowType: 'Tổng quan', item: 'Thời gian chờ trung bình (phút)', value: report.summary.averageWaitMinutes ?? '' },
    ...report.daily.map((row) => ({
      rowType: 'Chi tiết theo ngày',
      date: row.date,
      appointmentCount: row.appointmentCount,
      arrivedCount: row.arrivedCount,
      completedCount: row.completedCount,
      noShowCount: row.noShowCount,
      cancelledCount: row.cancelledCount,
    })),
  ]

  downloadExcelCsv(reportFilename('van-hanh', branch.code, from, to), operationsColumns, rows)
}

function exportRevenueReport(report: RevenueReport, branch: ReportBranch, from: string, to: string) {
  const rows: RevenueExportRow[] = [
    ...reportMetadata('Doanh thu thu tiền ròng', branch, from, to),
    { rowType: 'Tổng quan', item: 'Đã phát hành (VND)', value: exportNumber(report.summary.invoicedAmount) },
    { rowType: 'Tổng quan', item: 'Đã thu (VND)', value: exportNumber(report.summary.collectedAmount) },
    { rowType: 'Tổng quan', item: 'Đã hoàn (VND)', value: exportNumber(report.summary.refundedAmount) },
    { rowType: 'Tổng quan', item: 'Thu ròng (VND)', value: exportNumber(report.summary.netCollectedAmount) },
    ...report.daily.map((row) => ({
      rowType: 'Chi tiết theo ngày và phương thức',
      date: row.date,
      method: methods[row.method] ?? row.method,
      methodCode: row.method,
      collectedAmount: exportNumber(row.collectedAmount),
      refundedAmount: exportNumber(row.refundedAmount),
      netCollectedAmount: exportNumber(row.netCollectedAmount),
    })),
  ]

  downloadExcelCsv(reportFilename('doanh-thu', branch.code, from, to), revenueColumns, rows)
}

function exportInventoryReport(report: InventoryReport, branch: ReportBranch, from: string, to: string) {
  const rows: InventoryExportRow[] = [
    ...reportMetadata('Sử dụng dịch vụ, thuốc và cảnh báo tồn', branch, from, to),
    { rowType: 'Tổng quan', item: 'Lượt dịch vụ', value: exportNumber(report.summary.serviceQuantity) },
    { rowType: 'Tổng quan', item: 'Thuốc đã cấp', value: exportNumber(report.summary.medicineQuantity) },
    { rowType: 'Tổng quan', item: 'Thuốc tồn thấp', value: report.summary.lowStockCount },
    { rowType: 'Tổng quan', item: 'Lô sắp hết hạn', value: report.summary.expiringBatchCount },
    ...report.services.map((item) => ({
      rowType: 'Chi tiết', category: 'Dịch vụ sử dụng', code: item.code, name: item.name,
      quantity: exportNumber(item.quantity), amount: exportNumber(item.amount),
    })),
    ...report.medicines.map((item) => ({
      rowType: 'Chi tiết', category: 'Thuốc đã cấp', code: item.code, name: item.name,
      quantity: exportNumber(item.quantity), amount: exportNumber(item.amount),
    })),
    ...report.lowStock.map((item) => ({
      rowType: 'Chi tiết', category: 'Tồn thấp', code: item.code, name: item.name,
      quantity: exportNumber(item.availableQuantity), reorderLevel: exportNumber(item.reorderLevel),
    })),
    ...report.expiringBatches.map((item) => ({
      rowType: 'Chi tiết', category: 'Lô hết hạn trong 90 ngày', code: item.medicineCode,
      name: item.medicineName, batchNumber: item.batchNumber, expiryDate: item.expiryDate,
      quantity: exportNumber(item.availableQuantity), daysToExpiry: item.daysToExpiry,
    })),
  ]

  downloadExcelCsv(reportFilename('kho', branch.code, from, to), inventoryColumns, rows)
}

function State({ loading, error }: { loading: boolean; error: unknown }) {
  if (loading) return <div className="page-state">Đang tổng hợp số liệu…</div>
  if (error) return <div className="page-state error-state">{message(error)}</div>
  return null
}

export function ReportsPage() {
  const defaults = initialRange()
  const [branchId, setBranchId] = useState('')
  const [from, setFrom] = useState(defaults.from)
  const [to, setTo] = useState(defaults.to)
  const branches = useQuery({ queryKey: ['report-branches'], queryFn: () => apiClient.reports.branches() })
  const branch = branches.data?.data.find((item) => item.publicId === branchId) ?? branches.data?.data[0]
  const selectedBranch = branch?.publicId ?? ''
  const validRange = Boolean(selectedBranch && from && to && from <= to)
  const operations = useQuery({ queryKey: ['report-operations', selectedBranch, from, to],
    queryFn: () => apiClient.reports.operations(selectedBranch, from, to),
    enabled: validRange && Boolean(branch?.canViewOperations) })
  const revenue = useQuery({ queryKey: ['report-revenue', selectedBranch, from, to],
    queryFn: () => apiClient.reports.revenue(selectedBranch, from, to),
    enabled: validRange && Boolean(branch?.canViewRevenue) })
  const inventory = useQuery({ queryKey: ['report-inventory', selectedBranch, from, to],
    queryFn: () => apiClient.reports.inventory(selectedBranch, from, to),
    enabled: validRange && Boolean(branch?.canViewInventory) })

  if (branches.isLoading) return <div className="page-state">Đang tải phạm vi báo cáo…</div>
  if (branches.error) return <div className="page-state error-state">{message(branches.error)}</div>
  if (!branches.data?.data.length) return <div className="panel page-state">Tài khoản chưa có quyền báo cáo tại chi nhánh nào.</div>

  const ops = operations.data?.data; const cash = revenue.data?.data; const stock = inventory.data?.data
  return <>
    <header><div><span className="eyebrow">REPORTING CENTER</span><h1>Báo cáo điều hành</h1>
      <p>Số liệu theo ngày nghiệp vụ của chi nhánh, tách quyền vận hành, tài chính và tồn kho.</p></div></header>
    <section className="panel report-toolbar">
      <label>Chi nhánh<select value={selectedBranch} onChange={(event) => setBranchId(event.target.value)}>
        {branches.data.data.map((item) => <option key={item.publicId} value={item.publicId}>{item.name}</option>)}</select></label>
      <label>Từ ngày<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>Đến ngày<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <button type="button" className="secondary" disabled={!validRange || operations.isFetching || revenue.isFetching || inventory.isFetching} onClick={() => {
        void operations.refetch(); void revenue.refetch(); void inventory.refetch()
      }}>Làm mới</button>
    </section>
    {!validRange && <div className="form-error" role="alert">Ngày kết thúc phải từ ngày bắt đầu trở đi.</div>}

    {branch?.canViewOperations && <section className="panel report-section"><h2>Vận hành lịch hẹn & lượt khám</h2>
      <State loading={operations.isLoading} error={operations.error} />
      {ops && branch && <><button type="button" className="secondary" aria-label="Xuất báo cáo vận hành ra CSV"
        onClick={() => exportOperationsReport(ops, branch, from, to)}>Xuất Excel (.csv)</button>
        <div className="summary-grid report-kpis">
        <div><span>Lịch hẹn</span><strong>{ops.summary.appointmentCount}</strong></div>
        <div><span>Lượt đến</span><strong>{ops.summary.encounterCount}</strong></div>
        <div><span>Hoàn tất</span><strong>{ops.summary.completedEncounterCount}</strong></div>
        <div><span>Không đến</span><strong>{ops.summary.noShowCount}</strong></div>
        <div><span>Đã hủy</span><strong>{ops.summary.cancelledCount}</strong></div>
        <div><span>Chờ trung bình</span><strong>{ops.summary.averageWaitMinutes == null ? '—' : `${ops.summary.averageWaitMinutes} phút`}</strong></div>
      </div><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Ngày</th><th>Lịch hẹn</th><th>Lượt đến</th>
        <th>Hoàn tất</th><th>Không đến</th><th>Đã hủy</th></tr></thead><tbody>{ops.daily.map((row) => <tr key={row.date}>
          <td>{dateName(row.date)}</td><td>{row.appointmentCount}</td><td>{row.arrivedCount}</td><td>{row.completedCount}</td>
          <td>{row.noShowCount}</td><td>{row.cancelledCount}</td></tr>)}</tbody></table></div>
        {!ops.daily.length && <p>Không có hoạt động trong khoảng đã chọn.</p>}</>}
    </section>}

    {branch?.canViewRevenue && <section className="panel report-section"><h2>Doanh thu thu tiền ròng</h2>
      <State loading={revenue.isLoading} error={revenue.error} />
      {cash && branch && <><button type="button" className="secondary" aria-label="Xuất báo cáo doanh thu ra CSV"
        onClick={() => exportRevenueReport(cash, branch, from, to)}>Xuất Excel (.csv)</button>
        <div className="summary-grid report-kpis">
        <div><span>Đã phát hành</span><strong>{money(cash.summary.invoicedAmount)}</strong></div>
        <div><span>Đã thu</span><strong>{money(cash.summary.collectedAmount)}</strong></div>
        <div><span>Đã hoàn</span><strong>{money(cash.summary.refundedAmount)}</strong></div>
        <div><span>Thu ròng</span><strong>{money(cash.summary.netCollectedAmount)}</strong></div>
      </div><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Ngày</th><th>Phương thức</th><th>Thu</th><th>Hoàn</th><th>Thu ròng</th>
        </tr></thead><tbody>{cash.daily.map((row) => <tr key={`${row.date}-${row.method}`}><td>{dateName(row.date)}</td>
          <td>{methods[row.method] ?? row.method}</td><td>{money(row.collectedAmount)}</td><td>{money(row.refundedAmount)}</td>
          <td>{money(row.netCollectedAmount)}</td></tr>)}</tbody></table></div>
        {!cash.daily.length && <p>Không có giao dịch trong khoảng đã chọn.</p>}</>}
    </section>}

    {branch?.canViewInventory && <section className="panel report-section"><h2>Sử dụng dịch vụ, thuốc & cảnh báo tồn</h2>
      <State loading={inventory.isLoading} error={inventory.error} />
      {stock && branch && <><button type="button" className="secondary" aria-label="Xuất báo cáo kho ra CSV"
        onClick={() => exportInventoryReport(stock, branch, from, to)}>Xuất Excel (.csv)</button>
        <div className="summary-grid report-kpis">
        <div><span>Lượt dịch vụ</span><strong>{quantity(stock.summary.serviceQuantity)}</strong></div>
        <div><span>Thuốc đã cấp</span><strong>{quantity(stock.summary.medicineQuantity)}</strong></div>
        <div><span>Thuốc tồn thấp</span><strong>{stock.summary.lowStockCount}</strong></div>
        <div><span>Lô sắp hết hạn</span><strong>{stock.summary.expiringBatchCount}</strong></div>
      </div><div className="report-columns"><div><h3>Dịch vụ sử dụng nhiều</h3>{stock.services.map((item) => <article className="report-row" key={item.code}>
        <span><strong>{item.name}</strong><small>{item.code}</small></span><span>{quantity(item.quantity)} · {money(item.amount)}</span></article>)}
        {!stock.services.length && <p>Chưa có dịch vụ hoàn tất.</p>}</div><div><h3>Thuốc đã cấp</h3>{stock.medicines.map((item) => <article className="report-row" key={item.code}>
          <span><strong>{item.name}</strong><small>{item.code}</small></span><span>{quantity(item.quantity)} · {money(item.amount)}</span></article>)}
          {!stock.medicines.length && <p>Chưa có thuốc được cấp.</p>}</div></div>
        <div className="report-columns"><div><h3>Tồn thấp</h3>{stock.lowStock.map((item) => <article className="report-row alert-row" key={item.code}>
          <span><strong>{item.name}</strong><small>{item.code}</small></span><span>{quantity(item.availableQuantity)} / mức {quantity(item.reorderLevel)}</span></article>)}
          {!stock.lowStock.length && <p>Không có thuốc dưới mức đặt hàng.</p>}</div><div><h3>Lô hết hạn trong 90 ngày</h3>
          {stock.expiringBatches.map((item) => <article className="report-row alert-row" key={`${item.medicineCode}-${item.batchNumber}`}>
            <span><strong>{item.medicineName}</strong><small>Lô {item.batchNumber} · {dateName(item.expiryDate)}</small></span>
            <span>{quantity(item.availableQuantity)} · còn {item.daysToExpiry} ngày</span></article>)}
          {!stock.expiringBatches.length && <p>Không có lô sắp hết hạn.</p>}</div></div></>}
    </section>}
  </>
}
