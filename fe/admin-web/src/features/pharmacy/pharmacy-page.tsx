import { ApiClientError } from '@clinic/generated-api-client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/auth-context'
import { apiClient } from '../../shared/api/client'

function message(error: unknown) {
  if (!(error instanceof ApiClientError)) return 'Không thể kết nối hệ thống. Hãy thử lại.'
  if (error.status === 403) return 'Bạn không có quyền thực hiện thao tác này tại chi nhánh.'
  if (error.status === 409 && error.code === 'PHARMACY_ALLERGY_CONFLICT') return error.message
  if (error.status === 409) return error.code === 'PHARMACY_CONFLICT'
    ? `${error.message} Kiểm tra dị ứng, lô FEFO hoặc lượng tồn trước khi thử lại.` : error.message
  return error.message
}
const amount = (value: string | number) => Number(value).toLocaleString('vi-VN')

export function PharmacyPage() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const [branchId, setBranchId] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState('')
  const canPrescribe = Boolean(user?.permissions.includes('PRESCRIPTIONS_WRITE'))
  const canDispense = Boolean(user?.permissions.includes('PHARMACY_DISPENSE'))
  const canInventory = Boolean(user?.permissions.includes('INVENTORY_MANAGE'))
  const canCatalog = Boolean(user?.roles.some((role) => role.code === 'ADMIN'))
  const branches = useQuery({ queryKey: ['pharmacy-branches'], queryFn: () => apiClient.pharmacy.branches() })
  const selectedBranch = branchId || branches.data?.data[0]?.publicId || ''
  const workspace = useQuery({ queryKey: ['pharmacy-workspace', selectedBranch],
    queryFn: () => apiClient.pharmacy.workspace(selectedBranch), enabled: Boolean(selectedBranch) })
  const prescription = useQuery({ queryKey: ['pharmacy-prescription', selectedId],
    queryFn: () => apiClient.pharmacy.getPrescription(selectedId), enabled: Boolean(selectedId) })
  const reconcile = useQuery({ queryKey: ['pharmacy-reconciliation', selectedBranch],
    queryFn: () => apiClient.pharmacy.reconcile(selectedBranch), enabled: Boolean(selectedBranch && canInventory) })
  const [encounterId, setEncounterId] = useState(params.get('encounterId') ?? '')
  const [validDays, setValidDays] = useState('7')
  const [medicineId, setMedicineId] = useState('')
  const [prescribedQuantity, setPrescribedQuantity] = useState('1')
  const [dose, setDose] = useState('')
  const [frequency, setFrequency] = useState('')
  const [durationDays, setDurationDays] = useState('')
  const [usageInstruction, setUsageInstruction] = useState('')
  const [allergyReason, setAllergyReason] = useState('')
  const [locationId, setLocationId] = useState('')
  const [batchId, setBatchId] = useState('')
  const [stockQuantity, setStockQuantity] = useState('')
  const [dispenseItemId, setDispenseItemId] = useState('')
  const [dispenseBatchId, setDispenseBatchId] = useState('')
  const [dispenseQuantity, setDispenseQuantity] = useState('')
  const [dispenseAllergyReason, setDispenseAllergyReason] = useState('')
  const [reason, setReason] = useState('')
  const [medicineCode, setMedicineCode] = useState('')
  const [genericName, setGenericName] = useState('')
  const [activeIngredient, setActiveIngredient] = useState('')
  const [medicineAllergens, setMedicineAllergens] = useState('')
  const [strength, setStrength] = useState('')
  const [dosageForm, setDosageForm] = useState('')
  const [route, setRoute] = useState('')
  const [baseUnit, setBaseUnit] = useState('viên')
  const [salePrice, setSalePrice] = useState('0')
  const [newBatchMedicine, setNewBatchMedicine] = useState('')
  const [batchNumber, setBatchNumber] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [purchasePrice, setPurchasePrice] = useState('0')
  const [batchSalePrice, setBatchSalePrice] = useState('0')
  const [locationCode, setLocationCode] = useState('')
  const [locationName, setLocationName] = useState('')
  const [locationType, setLocationType] = useState<'WAREHOUSE' | 'PHARMACY' | 'CABINET' | 'QUARANTINE'>('WAREHOUSE')

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['pharmacy-workspace', selectedBranch] })
    void queryClient.invalidateQueries({ queryKey: ['pharmacy-reconciliation', selectedBranch] })
    if (selectedId) void queryClient.invalidateQueries({ queryKey: ['pharmacy-prescription', selectedId] })
  }
  const run = async (label: string, operation: () => Promise<unknown>) => {
    setBusy(label); setError(null); setNotice('')
    try { await operation(); refresh(); setNotice(`${label} thành công.`); return true }
    catch (cause) { setError(cause); return false }
    finally { setBusy('') }
  }
  const createPrescription = async (event: FormEvent) => {
    event.preventDefault()
    let created = ''
    if (await run('Tạo đơn nháp', async () => { const result = await apiClient.pharmacy.createPrescription(encounterId,
      { validDays: Number(validDays) }); created = result.data.publicId })) {
      setSelectedId(created); setEncounterId('')
    }
  }
  const addItem = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedId) return
    if (await run('Thêm thuốc', () => apiClient.pharmacy.addItem(selectedId, {
      medicinePublicId: medicineId, prescribedQuantity: Number(prescribedQuantity), dose: dose.trim(),
      frequency: frequency.trim(), durationDays: durationDays ? Number(durationDays) : null,
      usageInstruction: usageInstruction.trim(), allergyOverrideReason: allergyReason.trim() || null,
    }))) { setMedicineId(''); setDose(''); setFrequency(''); setDurationDays(''); setUsageInstruction(''); setAllergyReason('') }
  }
  const receive = async (event: FormEvent) => {
    event.preventDefault()
    if (await run('Nhập kho', () => apiClient.pharmacy.receive({ locationPublicId: locationId,
      batchPublicId: batchId, quantity: Number(stockQuantity), reason: reason.trim() || null }))) {
      setBatchId(''); setStockQuantity(''); setReason('')
    }
  }
  const addMedicine = async (event: FormEvent) => {
    event.preventDefault()
    if (await run('Tạo danh mục thuốc', () => apiClient.pharmacy.createMedicine({ code: medicineCode.trim(),
      genericName: genericName.trim(), activeIngredient: activeIngredient.trim(), strength: strength.trim(),
      dosageForm: dosageForm.trim(), route: route.trim(), baseUnit: baseUnit.trim(), salePrice: Number(salePrice),
      allergenNames: medicineAllergens.split(/[,;\n]/).map((name) => name.trim()).filter(Boolean) }))) {
      setMedicineCode(''); setGenericName(''); setActiveIngredient(''); setMedicineAllergens('')
      setStrength(''); setDosageForm(''); setRoute('')
    }
  }
  const addBatch = async (event: FormEvent) => {
    event.preventDefault()
    if (await run('Đăng ký lô', () => apiClient.pharmacy.createBatch({ branchPublicId: selectedBranch,
      medicinePublicId: newBatchMedicine, batchNumber: batchNumber.trim(), expiryDate,
      purchasePrice: Number(purchasePrice), salePrice: Number(batchSalePrice) }))) {
      setNewBatchMedicine(''); setBatchNumber(''); setExpiryDate('')
    }
  }
  const addLocation = async (event: FormEvent) => {
    event.preventDefault()
    if (await run('Tạo vị trí kho', () => apiClient.pharmacy.createLocation({ branchPublicId: selectedBranch,
      code: locationCode.trim(), name: locationName.trim(), type: locationType,
      isDispensing: locationType === 'PHARMACY' }))) { setLocationCode(''); setLocationName('') }
  }
  const dispense = async (event: FormEvent) => {
    event.preventDefault()
    const openSession = prescription.data?.data.dispensations.find((session) => session.status === 'DRAFT')
    if (!openSession) return
    if (await run('Cấp thuốc', () => apiClient.pharmacy.dispense(openSession.publicId, {
      prescriptionItemPublicId: dispenseItemId, batchPublicId: dispenseBatchId, quantity: Number(dispenseQuantity),
      allergyOverrideReason: dispenseAllergyReason.trim() || null,
    }))) { setDispenseItemId(''); setDispenseBatchId(''); setDispenseQuantity(''); setDispenseAllergyReason('') }
  }

  if (branches.isLoading) return <div className="page-state">Đang tải phạm vi nhà thuốc…</div>
  if (branches.error) return <div className="page-state error-state">{message(branches.error)}</div>
  if (!branches.data?.data.length) return <div className="panel page-state">Tài khoản chưa có quyền nhà thuốc tại chi nhánh nào.</div>
  const data = workspace.data?.data
  const rx = prescription.data?.data
  const openSession = rx?.dispensations.find((session) => session.status === 'DRAFT')
  const selectedLocation = openSession?.locationPublicId
  const selectedRxItem = rx?.items.find((item) => item.publicId === dispenseItemId)
  const eligibleBatches = data?.batches.filter((batch) => batch.locationPublicId === selectedLocation
    && batch.medicinePublicId === selectedRxItem?.medicinePublicId && batch.status === 'AVAILABLE'
    && Number(batch.availableQuantity) > 0).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)) ?? []
  const uniqueBatches = [...new Map(data?.batches.map((lot) => [lot.publicId, lot]) ?? []).values()]
  const quarantineId = data?.locations.find((location) => location.type === 'QUARANTINE')?.publicId
  const reverseToSellable = (line: NonNullable<typeof rx>['dispensedItems'][number]) => {
    const session = rx?.dispensations.find((item) => item.publicId === line.dispensationPublicId)
    if (!session || !window.confirm('Xác nhận thuốc còn nguyên vẹn, được bảo quản đúng và đã qua kiểm tra chất lượng để trở lại kho bán?')) return
    const why = window.prompt('Ghi kết quả kiểm tra và lý do hoàn về kho bán (tối thiểu 5 ký tự)')
    if (why?.trim()) void run('Hoàn về kho bán', () => apiClient.pharmacy.reverse(line.publicId, {
      returnLocationPublicId: session.locationPublicId, disposition: 'SELLABLE', reason: why.trim(),
      sellableInspectionConfirmed: true,
    }))
  }

  return <>
    <header><div><span className="eyebrow">PHARMACY WORKSPACE</span><h1>Đơn thuốc & nhà thuốc</h1>
      <p>Kê đơn, nhập lô, cấp thuốc FEFO và đối soát tồn theo chi nhánh.</p></div></header>
    <section className="panel clinical-toolbar"><label>Chi nhánh<select value={selectedBranch}
      onChange={(event) => { setBranchId(event.target.value); setSelectedId('') }}>
      {branches.data.data.map((branch) => <option key={branch.publicId} value={branch.publicId}>{branch.name}</option>)}</select></label>
      <button type="button" className="secondary" onClick={refresh}>Tải lại</button></section>
    {notice && <div className="form-success" role="status">{notice}</div>}
    {Boolean(error) && <div className="form-error" role="alert">{message(error)}</div>}
    {workspace.isLoading ? <section className="panel page-state">Đang tải danh mục và đơn thuốc…</section>
      : workspace.error ? <section className="panel error-state page-state">{message(workspace.error)}</section>
        : data && <>
          {canPrescribe && <section className="panel"><h2>Tạo đơn từ lượt khám</h2>
            <form className="clinical-form-grid" onSubmit={(event) => void createPrescription(event)}>
              <label>Mã public ID lượt khám<input required value={encounterId}
                onChange={(event) => setEncounterId(event.target.value)} placeholder="Mở từ màn Khám bệnh" /></label>
              <label>Hiệu lực (ngày)<input type="number" required min="1" max="90" value={validDays}
                onChange={(event) => setValidDays(event.target.value)} /></label>
              <button type="submit" disabled={Boolean(busy)}>Tạo đơn DRAFT</button></form></section>}
          <div className="clinical-workspace"><section className="panel clinical-list"><h2>Đơn thuốc</h2>
            {!data.prescriptions.length && <p>Chưa có đơn thuốc trong phạm vi này.</p>}
            {data.prescriptions.map((entry) => <button type="button" key={entry.publicId}
              className={`clinical-list-item ${selectedId === entry.publicId ? 'selected' : ''}`}
              onClick={() => setSelectedId(entry.publicId)}><span className="status">{entry.status}</span>
              <strong>{entry.patientName}</strong><small>{entry.code} · {entry.patientCode}</small>
              <small>{entry.itemCount} thuốc · Hạn {entry.validUntil ?? 'chưa phát hành'}</small></button>)}</section>
            <div className="clinical-detail">{!selectedId ? <section className="panel page-state">Chọn đơn thuốc để xem chi tiết.</section>
              : prescription.isLoading ? <section className="panel page-state">Đang tải đơn thuốc…</section>
                : prescription.error ? <section className="panel error-state page-state">{message(prescription.error)}</section>
                  : rx && <>
                    <section className="panel"><div className="detail-heading"><div><h2>{rx.code}</h2>
                      <p>{rx.patientName} · {rx.patientCode} · Hạn {rx.validUntil ?? '—'}</p></div>
                      <span className="status">{rx.status}</span></div>
                      {!!rx.drugAllergies.length && <div className="notice" role="alert">
                        Dị ứng thuốc: {rx.drugAllergies.map((allergy) => `${allergy.allergenName} (${allergy.severity})`).join(', ')}</div>}
                      {!!rx.allergyAlerts.length && <div className="form-error" role="alert">
                        Cảnh báo theo mapping hoạt chất: {rx.allergyAlerts.map((alert) =>
                          `${alert.medicineName} ↔ ${alert.allergenName} (${alert.severity})`).join('; ')}
                      </div>}
                      {rx.items.map((item) => <article className="clinical-record" key={item.publicId}>
                        <strong>{item.medicineName} · {item.strength}</strong>
                        <p>{item.dose} · {item.frequency} · {item.usageInstruction}</p>
                        <small>Dị nguyên chuẩn hóa: {item.allergenNames.join(', ') || 'chưa khai báo'}</small>
                        {item.allergyOverrideReason && <small>Đã override lúc kê: {item.allergyOverrideReason}</small>}
                        <small>Đã cấp {item.dispensedQuantity}/{item.prescribedQuantity}</small></article>)}
                      {!rx.items.length && <p>Đơn chưa có thuốc.</p>}
                      {canPrescribe && rx.status === 'DRAFT' && <div className="action-row">
                        <button type="button" disabled={Boolean(busy) || !rx.items.length}
                          onClick={() => void run('Phát hành đơn', () => apiClient.pharmacy.issue(rx.publicId))}>Phát hành đơn</button>
                        <button type="button" className="secondary" disabled={Boolean(busy)}
                          onClick={() => { const why = window.prompt('Lý do hủy đơn thuốc');
                            if (why) void run('Hủy đơn', () => apiClient.pharmacy.cancelPrescription(rx.publicId, why)) }}>Hủy đơn</button></div>}
                      {canPrescribe && rx.status === 'ISSUED' && <button type="button" className="secondary" disabled={Boolean(busy)}
                        onClick={() => { const why = window.prompt('Lý do hủy đơn thuốc');
                          if (why) void run('Hủy đơn', () => apiClient.pharmacy.cancelPrescription(rx.publicId, why)) }}>Hủy đơn</button>}
                    </section>
                    {canPrescribe && rx.status === 'DRAFT' && <section className="panel"><h2>Thêm thuốc</h2>
                      <form className="clinical-form-grid" onSubmit={(event) => void addItem(event)}>
                        <label>Thuốc<select required value={medicineId} onChange={(event) => setMedicineId(event.target.value)}>
                          <option value="">Chọn thuốc</option>{data.medicines.map((med) => <option key={med.publicId} value={med.publicId}>
                            {med.genericName} · {med.strength}</option>)}</select></label>
                        <label>Số lượng<input type="number" required min="0.001" step="0.001" value={prescribedQuantity}
                          onChange={(event) => setPrescribedQuantity(event.target.value)} /></label>
                        <label>Liều<input required maxLength={100} value={dose} onChange={(event) => setDose(event.target.value)} /></label>
                        <label>Tần suất<input required maxLength={100} value={frequency} onChange={(event) => setFrequency(event.target.value)} /></label>
                        <label>Số ngày<input type="number" min="1" max="365" value={durationDays}
                          onChange={(event) => setDurationDays(event.target.value)} /></label>
                        <label>Hướng dẫn<input required maxLength={1000} value={usageInstruction}
                          onChange={(event) => setUsageInstruction(event.target.value)} /></label>
                        <label>Lý do override dị ứng (khi có quyền)<input minLength={10} maxLength={500} value={allergyReason}
                          onChange={(event) => setAllergyReason(event.target.value)} /></label>
                        <button type="submit" disabled={Boolean(busy)}>Thêm vào đơn</button></form></section>}
                    {canDispense && ['ISSUED', 'PARTIALLY_DISPENSED'].includes(rx.status) && <section className="panel"><h2>Cấp phát</h2>
                      {!openSession ? <div className="clinical-form-grid"><label>Quầy cấp<select value={locationId}
                        onChange={(event) => setLocationId(event.target.value)}><option value="">Chọn quầy</option>
                        {data.locations.filter((loc) => loc.isDispensing).map((loc) => <option key={loc.publicId} value={loc.publicId}>
                          {loc.name}</option>)}</select></label><button type="button" disabled={Boolean(busy) || !locationId}
                          onClick={() => void run('Mở phiên cấp', () => apiClient.pharmacy.openDispensation(rx.publicId, locationId))}>Mở phiên cấp</button></div>
                        : <><p>Phiên {openSession.code} · quầy {data.locations.find((loc) => loc.publicId === selectedLocation)?.name}</p>
                          <form className="clinical-form-grid" onSubmit={(event) => void dispense(event)}>
                            <label>Dòng kê<select required value={dispenseItemId} onChange={(event) => { setDispenseItemId(event.target.value); setDispenseBatchId('') }}>
                              <option value="">Chọn thuốc còn thiếu</option>{rx.items.filter((item) => Number(item.dispensedQuantity) < Number(item.prescribedQuantity))
                                .map((item) => <option key={item.publicId} value={item.publicId}>{item.medicineName} · còn {amount(Number(item.prescribedQuantity) - Number(item.dispensedQuantity))}</option>)}</select></label>
                            <label>Lô FEFO<select required value={dispenseBatchId} onChange={(event) => setDispenseBatchId(event.target.value)}>
                              <option value="">Chọn lô</option>{eligibleBatches.map((lot) => <option key={lot.publicId} value={lot.publicId}>
                                {lot.batchNumber} · hạn {lot.expiryDate} · tồn {lot.availableQuantity}</option>)}</select></label>
                            <label>Số lượng<input required type="number" min="0.001" step="0.001" value={dispenseQuantity}
                              onChange={(event) => setDispenseQuantity(event.target.value)} /></label>
                            <label>Lý do xác nhận lại dị ứng (nếu cảnh báo)<input minLength={10} maxLength={500}
                              value={dispenseAllergyReason} onChange={(event) => setDispenseAllergyReason(event.target.value)} /></label>
                            <button type="submit" disabled={Boolean(busy)}>Cấp thuốc</button></form>
                          <div className="action-row"><button type="button" disabled={Boolean(busy)}
                            onClick={() => void run('Hoàn tất cấp phát', () => apiClient.pharmacy.completeDispensation(openSession.publicId))}>Hoàn tất</button>
                            <button type="button" className="secondary" disabled={Boolean(busy)}
                              onClick={() => { const why = window.prompt('Lý do hủy phiên');
                                if (why) void run('Hủy phiên cấp', () => apiClient.pharmacy.cancelDispensation(openSession.publicId, why)) }}>Hủy phiên</button></div></>}
                    </section>}
                    {!!rx.dispensedItems.length && <section className="panel"><h2>Lịch sử cấp thuốc</h2>
                      {rx.dispensedItems.map((line) => <article className="clinical-record" key={line.publicId}>
                        <strong>Lô {line.batchNumber} · {line.quantity} × {amount(line.unitPrice)} ₫</strong>
                        <p>{line.reversed ? 'Đã đảo' : 'Đang hiệu lực'}</p>
                        {line.allergyOverrideReason && <small>Đã xác nhận dị ứng lúc cấp: {line.allergyOverrideReason}</small>}
                        {canDispense && !line.reversed && <div className="action-row">
                          <button type="button" className="secondary" disabled={Boolean(busy)}
                            onClick={() => reverseToSellable(line)}>Hoàn về kho bán sau kiểm tra</button>
                          {quarantineId && <button type="button" className="secondary" disabled={Boolean(busy)}
                            onClick={() => { const why = window.prompt('Lý do đảo cấp phát vào cách ly');
                              if (why) void run('Đảo vào cách ly', () => apiClient.pharmacy.reverse(line.publicId,
                                { returnLocationPublicId: quarantineId, disposition: 'QUARANTINE', reason: why,
                                  sellableInspectionConfirmed: false })) }}>Đảo vào cách ly</button>}
                        </div>}
                      </article>)}</section>}
                  </>}</div></div>
          {canInventory && <><section className="panel"><h2>Nhập kho</h2>
            <form className="clinical-form-grid" onSubmit={(event) => void receive(event)}>
              <label>Vị trí<select required value={locationId} onChange={(event) => setLocationId(event.target.value)}>
                <option value="">Chọn kho</option>{data.locations.map((loc) => <option key={loc.publicId} value={loc.publicId}>{loc.name}</option>)}</select></label>
              <label>Lô<select required value={batchId} onChange={(event) => setBatchId(event.target.value)}>
                <option value="">Chọn lô</option>{uniqueBatches.map((lot) => <option key={lot.publicId} value={lot.publicId}>{lot.batchNumber}</option>)}</select></label>
              <label>Số lượng<input required type="number" min="0.001" step="0.001" value={stockQuantity}
                onChange={(event) => setStockQuantity(event.target.value)} /></label>
              <label>Ghi chú<input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
              <button type="submit" disabled={Boolean(busy)}>Ghi nhập kho</button></form>
            <h3>Tồn tại chi nhánh</h3>{data.batches.map((lot) => <p className="clinical-record" key={`${lot.publicId}-${lot.locationPublicId}`}>
              {data.medicines.find((med) => med.publicId === lot.medicinePublicId)?.genericName} · {lot.batchNumber} · hạn {lot.expiryDate}
              {' · '}{data.locations.find((loc) => loc.publicId === lot.locationPublicId)?.name}: {lot.availableQuantity}</p>)}
            {!data.batches.length && <p>Chưa có lô nhập kho.</p>}
            {!!data.lowStock.length && <div className="notice" role="status">Tồn thấp: {data.lowStock.map((item) => item.medicineName).join(', ')}</div>}
            <h3>Đối soát ledger</h3>{reconcile.isLoading ? <p>Đang đối soát…</p>
              : reconcile.error ? <div className="form-error">{message(reconcile.error)}</div>
                : reconcile.data?.data.length ? reconcile.data.data.map((diff) => <p className="form-error" key={`${diff.locationPublicId}-${diff.batchPublicId}`}>
                  Lô {diff.batchNumber}: balance {diff.balanceQuantity}, ledger {diff.ledgerQuantity}</p>)
                  : <p>Balance khớp ledger.</p>}
          </section>
            <section className="panel"><h2>Vị trí kho và quầy</h2><form className="clinical-form-grid" onSubmit={(event) => void addLocation(event)}>
              <label>Mã vị trí<input required maxLength={30} value={locationCode} onChange={(event) => setLocationCode(event.target.value)} /></label>
              <label>Tên vị trí<input required maxLength={150} value={locationName} onChange={(event) => setLocationName(event.target.value)} /></label>
              <label>Loại<select value={locationType} onChange={(event) => setLocationType(event.target.value as typeof locationType)}>
                <option value="WAREHOUSE">Kho</option><option value="PHARMACY">Quầy cấp</option>
                <option value="CABINET">Tủ thuốc</option><option value="QUARANTINE">Cách ly</option></select></label>
              <button type="submit" disabled={Boolean(busy)}>Tạo vị trí</button></form></section>
            <section className="panel"><h2>Đăng ký lô mới</h2><form className="clinical-form-grid" onSubmit={(event) => void addBatch(event)}>
              <label>Thuốc<select required value={newBatchMedicine} onChange={(event) => setNewBatchMedicine(event.target.value)}>
                <option value="">Chọn thuốc</option>{data.medicines.map((med) => <option key={med.publicId} value={med.publicId}>{med.genericName}</option>)}</select></label>
              <label>Số lô<input required maxLength={80} value={batchNumber} onChange={(event) => setBatchNumber(event.target.value)} /></label>
              <label>Hạn dùng<input required type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} /></label>
              <label>Giá nhập<input required type="number" min="0" step="0.01" value={purchasePrice} onChange={(event) => setPurchasePrice(event.target.value)} /></label>
              <label>Giá bán<input required type="number" min="0" step="0.01" value={batchSalePrice} onChange={(event) => setBatchSalePrice(event.target.value)} /></label>
              <button type="submit" disabled={Boolean(busy)}>Tạo lô</button></form></section></>}
          {canCatalog && <section className="panel"><h2>Danh mục thuốc cấp tổ chức</h2>
            <form className="clinical-form-grid" onSubmit={(event) => void addMedicine(event)}>
              <label>Mã thuốc<input required maxLength={30} value={medicineCode} onChange={(event) => setMedicineCode(event.target.value)} /></label>
              <label>Tên thuốc<input required maxLength={250} value={genericName} onChange={(event) => setGenericName(event.target.value)} /></label>
              <label>Hoạt chất<input required maxLength={500} value={activeIngredient} onChange={(event) => setActiveIngredient(event.target.value)} /></label>
              <label>Dị nguyên chuẩn hóa<input required maxLength={1000} value={medicineAllergens}
                onChange={(event) => setMedicineAllergens(event.target.value)}
                placeholder="Mỗi hoạt chất cách nhau bởi dấu phẩy" /></label>
              <label>Hàm lượng<input required maxLength={100} value={strength} onChange={(event) => setStrength(event.target.value)} /></label>
              <label>Dạng bào chế<input required maxLength={100} value={dosageForm} onChange={(event) => setDosageForm(event.target.value)} /></label>
              <label>Đường dùng<input required maxLength={100} value={route} onChange={(event) => setRoute(event.target.value)} /></label>
              <label>Đơn vị<input required maxLength={30} value={baseUnit} onChange={(event) => setBaseUnit(event.target.value)} /></label>
              <label>Giá bán tham chiếu<input required type="number" min="0" step="0.01" value={salePrice} onChange={(event) => setSalePrice(event.target.value)} /></label>
              <button type="submit" disabled={Boolean(busy)}>Tạo thuốc</button></form></section>}
          <p><Link to="/clinical">Quay lại màn Khám bệnh</Link></p>
        </>}
  </>
}
