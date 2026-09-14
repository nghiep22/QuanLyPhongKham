import { ApiClientError } from '@clinic/generated-api-client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { apiClient } from '../../shared/api/client'

function message(error: unknown) {
  if (!(error instanceof ApiClientError)) return 'Không thể kết nối hệ thống. Hãy thử lại.'
  if (error.status === 403) return 'Bạn không có quyền thu ngân tại chi nhánh này.'
  if (error.status === 409) return `${error.message} Tải lại hóa đơn trước khi thử tiếp.`
  return error.message
}
const money = (value: string | number) => `${Number(value).toLocaleString('vi-VN')} ₫`
const methodName: Record<string, string> = {
  CASH: 'Tiền mặt', CARD: 'Thẻ', BANK_TRANSFER: 'Chuyển khoản', EWALLET: 'Ví điện tử', OTHER: 'Khác',
}

export function BillingPage() {
  const queryClient = useQueryClient()
  const [branchId, setBranchId] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState('')
  const [itemName, setItemName] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [itemQuantity, setItemQuantity] = useState('1')
  const [itemPrice, setItemPrice] = useState('0')
  const [itemDiscount, setItemDiscount] = useState('0')
  const [insuranceAmount, setInsuranceAmount] = useState('0')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'BANK_TRANSFER' | 'EWALLET' | 'OTHER'>('CASH')
  const [transactionId, setTransactionId] = useState('')

  const branches = useQuery({ queryKey: ['billing-branches'], queryFn: () => apiClient.billing.branches() })
  const selectedBranch = branchId || branches.data?.data[0]?.publicId || ''
  const workspace = useQuery({ queryKey: ['billing-workspace', selectedBranch],
    queryFn: () => apiClient.billing.workspace(selectedBranch), enabled: Boolean(selectedBranch) })
  const invoice = useQuery({ queryKey: ['billing-invoice', selectedId],
    queryFn: () => apiClient.billing.get(selectedId), enabled: Boolean(selectedId) })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['billing-workspace', selectedBranch] })
    if (selectedId) void queryClient.invalidateQueries({ queryKey: ['billing-invoice', selectedId] })
  }
  const run = async (label: string, operation: () => Promise<unknown>) => {
    setBusy(label); setError(null); setNotice('')
    try { await operation(); refresh(); setNotice(`${label} thành công.`); return true }
    catch (cause) { setError(cause); return false }
    finally { setBusy('') }
  }
  const create = async (encounterId: string, supersedesInvoicePublicId?: string) => {
    let created = ''
    if (await run(supersedesInvoicePublicId ? 'Tạo hóa đơn thay thế' : 'Tạo hóa đơn nháp', async () => {
      created = (await apiClient.billing.create(encounterId,
        supersedesInvoicePublicId ? { supersedesInvoicePublicId } : {})).data.publicId
    }))
      setSelectedId(created)
  }
  const addItem = async (event: FormEvent) => {
    event.preventDefault()
    if (await run('Thêm khoản thu', () => apiClient.billing.addItem(selectedId, {
      code: itemCode.trim() || null, name: itemName.trim(), quantity: Number(itemQuantity),
      unitPrice: Number(itemPrice), discountAmount: Number(itemDiscount), taxRatePercent: 0,
    }))) { setItemCode(''); setItemName(''); setItemQuantity('1'); setItemPrice('0'); setItemDiscount('0') }
  }
  const pay = async (event: FormEvent) => {
    event.preventDefault()
    if (await run('Ghi nhận thanh toán', () => apiClient.billing.pay(selectedId, {
      amount: Number(paymentAmount), method: paymentMethod,
      externalTransactionId: paymentMethod === 'CASH' ? null : transactionId.trim(),
    }))) { setPaymentAmount(''); setTransactionId('') }
  }
  const refund = async (allocationId: string, refundableAmount: string) => {
    const raw = window.prompt(`Số tiền hoàn tối đa ${money(refundableAmount)}`, refundableAmount)
    if (!raw) return
    const reason = window.prompt('Lý do hoàn tiền')
    if (!reason) return
    await run('Hoàn tiền', () => apiClient.billing.refund(allocationId,
      { amount: Number(raw), method: 'CASH', reason }))
  }

  if (branches.isLoading) return <div className="page-state">Đang tải phạm vi thu ngân…</div>
  if (branches.error) return <div className="page-state error-state">{message(branches.error)}</div>
  if (!branches.data?.data.length) return <div className="panel page-state">Tài khoản chưa có quyền thu ngân tại chi nhánh nào.</div>
  const data = workspace.data?.data
  const bill = invoice.data?.data

  return <>
    <header><div><span className="eyebrow">BILLING WORKSPACE</span><h1>Thu ngân</h1>
      <p>Đồng bộ khoản thu, phát hành hóa đơn, thu từng phần, hoàn tiền và VOID có kiểm soát.</p></div></header>
    <section className="panel clinical-toolbar"><label>Chi nhánh<select value={selectedBranch}
      onChange={(event) => { setBranchId(event.target.value); setSelectedId('') }}>
      {branches.data.data.map((branch) => <option key={branch.publicId} value={branch.publicId}>{branch.name}</option>)}</select></label>
      <button type="button" className="secondary" onClick={refresh}>Tải lại</button></section>
    {notice && <div className="form-success" role="status">{notice}</div>}
    {Boolean(error) && <div className="form-error" role="alert">{message(error)}</div>}
    {workspace.isLoading ? <section className="panel page-state">Đang tải dữ liệu thu ngân…</section>
      : workspace.error ? <section className="panel error-state page-state">{message(workspace.error)}</section>
        : data && <>
          <section className="panel"><h2>Lượt khám có thể lập hóa đơn</h2>
            <div className="clinical-list-grid">{data.encounters.map((encounter) => <article className="clinical-record" key={encounter.publicId}>
              <strong>{encounter.patientName} · {encounter.patientCode}</strong>
              <p>{encounter.code} · <span className="status">{encounter.status}</span></p>
              {encounter.activeInvoicePublicId
                ? <button type="button" className="secondary" onClick={() => setSelectedId(encounter.activeInvoicePublicId ?? '')}>
                  Mở hóa đơn {encounter.activeInvoiceStatus}</button>
                : <button type="button" disabled={Boolean(busy)} onClick={() => void create(encounter.publicId)}>Tạo hóa đơn</button>}
            </article>)}</div>
            {!data.encounters.length && <p>Chưa có lượt khám trong phạm vi lập hóa đơn.</p>}</section>
          <div className="clinical-workspace"><section className="panel clinical-list"><h2>Hóa đơn gần đây</h2>
            {data.invoices.map((entry) => <button type="button" key={entry.publicId}
              className={`clinical-list-item ${selectedId === entry.publicId ? 'selected' : ''}`}
              onClick={() => setSelectedId(entry.publicId)}><span className="status">{entry.status}</span>
              <strong>{entry.patientName}</strong><small>{entry.number} · {entry.encounterCode}</small>
              <small>Còn thu {money(entry.balanceDue)}</small></button>)}
            {!data.invoices.length && <p>Chưa có hóa đơn tại chi nhánh.</p>}</section>
            <div className="clinical-detail">{!selectedId ? <section className="panel page-state">Chọn hóa đơn để thao tác.</section>
              : invoice.isLoading ? <section className="panel page-state">Đang tải hóa đơn…</section>
                : invoice.error ? <section className="panel error-state page-state">{message(invoice.error)}</section>
                  : bill && <>
                    <section className="panel"><div className="detail-heading"><div><h2>{bill.number}</h2>
                      <p>{bill.patientName} · {bill.patientCode} · {bill.encounterCode}</p></div><span className="status">{bill.status}</span></div>
                      <div className="summary-grid"><div><span>Tổng cộng</span><strong>{money(bill.totalAmount)}</strong></div>
                        <div><span>Bảo hiểm</span><strong>{money(bill.insuranceAmount)}</strong></div>
                        <div><span>Đã thu ròng</span><strong>{money(Number(bill.paidAmount) - Number(bill.refundedAmount))}</strong></div>
                        <div><span>Còn phải thu</span><strong>{money(bill.balanceDue)}</strong></div></div>
                      <h3>Khoản thu</h3>{bill.items.map((item) => <article className="clinical-record" key={item.publicId}>
                        <strong>{item.name}</strong><p>{item.type} · {item.quantity} × {money(item.unitPrice)}</p>
                        <small>Giảm {money(item.discountAmount)} · Thành tiền {money(item.lineTotal)}</small></article>)}
                      {!bill.items.length && <p>Hóa đơn chưa có khoản thu.</p>}
                      {bill.status === 'DRAFT' && <div className="action-row"><button type="button" disabled={Boolean(busy)}
                        onClick={() => void run('Đồng bộ dịch vụ và thuốc', () => apiClient.billing.synchronize(bill.publicId))}>Đồng bộ khoản thu</button>
                        <button type="button" disabled={Boolean(busy) || !bill.items.length}
                          onClick={() => void run('Phát hành hóa đơn', () => apiClient.billing.issue(bill.publicId))}>Phát hành</button></div>}
                      {['DRAFT', 'ISSUED'].includes(bill.status) && <button type="button" className="secondary" disabled={Boolean(busy)}
                        onClick={() => { const why = window.prompt('Lý do VOID hóa đơn');
                          if (why) void run('VOID hóa đơn', () => apiClient.billing.void(bill.publicId, { reason: why })) }}>VOID hóa đơn</button>}
                      {bill.status === 'VOID' && <button type="button" disabled={Boolean(busy)}
                        onClick={() => void create(bill.encounterPublicId, bill.publicId)}>Tạo hóa đơn thay thế</button>}
                    </section>
                    {bill.status === 'DRAFT' && <><section className="panel"><h2>Phần bảo hiểm</h2>
                      <form className="clinical-form-grid" onSubmit={(event) => { event.preventDefault();
                        void run('Cập nhật bảo hiểm', () => apiClient.billing.setInsurance(bill.publicId,
                          { amount: Number(insuranceAmount) })) }}><label>Số tiền bảo hiểm<input required type="number" min="0" step="0.01"
                            value={insuranceAmount} onChange={(event) => setInsuranceAmount(event.target.value)} /></label>
                        <button type="submit" disabled={Boolean(busy)}>Lưu bảo hiểm</button></form></section>
                      <section className="panel"><h2>Khoản thu thủ công</h2><form className="clinical-form-grid" onSubmit={(event) => void addItem(event)}>
                        <label>Mã khoản<input maxLength={40} value={itemCode} onChange={(event) => setItemCode(event.target.value)} /></label>
                        <label>Tên khoản<input required maxLength={300} value={itemName} onChange={(event) => setItemName(event.target.value)} /></label>
                        <label>Số lượng<input required type="number" min="0.001" step="0.001" value={itemQuantity} onChange={(event) => setItemQuantity(event.target.value)} /></label>
                        <label>Đơn giá<input required type="number" min="0" step="0.01" value={itemPrice} onChange={(event) => setItemPrice(event.target.value)} /></label>
                        <label>Giảm giá<input required type="number" min="0" step="0.01" value={itemDiscount} onChange={(event) => setItemDiscount(event.target.value)} /></label>
                        <button type="submit" disabled={Boolean(busy)}>Thêm khoản thu</button></form></section></>}
                    {['ISSUED', 'PARTIALLY_PAID'].includes(bill.status) && <section className="panel"><h2>Thu tiền</h2>
                      <form className="clinical-form-grid" onSubmit={(event) => void pay(event)}><label>Số tiền<input required type="number"
                        min="0.01" max={bill.balanceDue} step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></label>
                        <label>Phương thức<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}>
                          {Object.entries(methodName).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
                        {paymentMethod !== 'CASH' && <label>Mã giao dịch<input required maxLength={150} value={transactionId}
                          onChange={(event) => setTransactionId(event.target.value)} /></label>}
                        <button type="submit" disabled={Boolean(busy)}>Ghi nhận thanh toán</button></form></section>}
                    {!!bill.payments.length && <section className="panel"><h2>Thanh toán & hoàn tiền</h2>
                      {bill.payments.map((payment) => <article className="clinical-record" key={payment.publicId}>
                        <strong>{payment.number} · {money(payment.amount)}</strong><p>{methodName[payment.method] ?? payment.method}</p>
                        <small>Còn có thể hoàn {money(payment.refundableAmount)}</small>
                        {Number(payment.refundableAmount) > 0 && <button type="button" className="secondary" disabled={Boolean(busy)}
                          onClick={() => void refund(payment.publicId, payment.refundableAmount)}>Hoàn tiền</button>}
                      </article>)}
                      {bill.refunds.map((entry) => <p className="clinical-record" key={entry.publicId}>
                        Hoàn {entry.number}: {money(entry.amount)} · {entry.reason}</p>)}</section>}
                  </>}</div></div>
        </>}
  </>
}
