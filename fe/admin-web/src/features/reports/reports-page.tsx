import { ApiClientError } from '@clinic/generated-api-client'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiClient } from '../../shared/api/client'

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
      <button type="button" className="secondary" onClick={() => {
        void operations.refetch(); void revenue.refetch(); void inventory.refetch()
      }}>Làm mới</button>
    </section>
    {!validRange && <div className="form-error" role="alert">Ngày kết thúc phải từ ngày bắt đầu trở đi.</div>}

    {branch?.canViewOperations && <section className="panel report-section"><h2>Vận hành lịch hẹn & lượt khám</h2>
      <State loading={operations.isLoading} error={operations.error} />
      {ops && <><div className="summary-grid report-kpis">
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
      {cash && <><div className="summary-grid report-kpis">
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
      {stock && <><div className="summary-grid report-kpis">
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
