import { ApiClientError } from '@clinic/generated-api-client'
import type {
  CatalogReferenceData, CatalogRoom, CatalogRoomType, CatalogService, CatalogServiceType,
} from '@clinic/generated-api-types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiClient } from '../../shared/api/client'

const roomLabels: Record<CatalogRoomType, string> = {
  CONSULTATION: 'Phòng khám', PROCEDURE: 'Phòng thủ thuật', LAB: 'Xét nghiệm',
  IMAGING: 'Chẩn đoán hình ảnh', PHARMACY: 'Nhà thuốc', OTHER: 'Khác',
}
const serviceLabels: Record<CatalogServiceType, string> = {
  CONSULTATION: 'Khám bệnh', LAB: 'Xét nghiệm', IMAGING: 'Chẩn đoán hình ảnh',
  PROCEDURE: 'Thủ thuật', VACCINATION: 'Tiêm chủng', OTHER: 'Khác',
}

function message(error: unknown) {
  if (!(error instanceof ApiClientError)) return 'Không thể kết nối hệ thống. Vui lòng thử lại.'
  if (error.code === 'CATALOG_VERSION_CONFLICT') return 'Dữ liệu đã được người khác cập nhật. Danh sách sẽ được tải lại.'
  if (error.code === 'PRICE_PERIOD_CONFLICT') return 'Dịch vụ đã có mức giá bắt đầu vào ngày này.'
  if (error.code === 'CATALOG_CODE_CONFLICT') return 'Mã danh mục đã tồn tại.'
  if (error.status === 403) return 'Bạn không có quyền quản lý danh mục trong phạm vi này.'
  return error.message
}

function formatMoney(value: string) {
  return `${new Intl.NumberFormat('vi-VN').format(Number(value))} ₫`
}

function RoomForm({ references, branchPublicId }: { references: CatalogReferenceData; branchPublicId: string }) {
  const client = useQueryClient()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<CatalogRoomType>('CONSULTATION')
  const [floorNo, setFloorNo] = useState('')
  const [capacity, setCapacity] = useState('1')
  const mutation = useMutation({
    mutationFn: () => apiClient.catalog.createRoom({
      branchPublicId, code: code.trim().toUpperCase(), name: name.trim(), type,
      ...(floorNo ? { floorNo: Number(floorNo) } : {}), capacity: Number(capacity),
    }),
    onSuccess: () => {
      setCode(''); setName(''); setFloorNo(''); setCapacity('1')
      void client.invalidateQueries({ queryKey: ['catalog-rooms', branchPublicId] })
    },
  })
  return <form className="catalog-form panel" onSubmit={(event) => {
    event.preventDefault()
    if (code.trim() && name.trim() && Number(capacity) > 0) mutation.mutate()
  }}>
    <h2>Thêm phòng</h2>
    <p>Phòng được tạo trực tiếp trong {references.branches.find((item) => item.publicId === branchPublicId)?.name}.</p>
    <div className="form-grid">
      <label>Mã phòng<input value={code} maxLength={30} required onChange={(event) => setCode(event.target.value)} /></label>
      <label>Tên phòng<input value={name} maxLength={150} required onChange={(event) => setName(event.target.value)} /></label>
      <label>Loại phòng<select value={type} onChange={(event) => setType(event.target.value as CatalogRoomType)}>
        {Object.entries(roomLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Tầng<input type="number" min={-5} max={200} value={floorNo} onChange={(event) => setFloorNo(event.target.value)} /></label>
      <label>Sức chứa<input type="number" min={1} max={500} value={capacity} required onChange={(event) => setCapacity(event.target.value)} /></label>
    </div>
    {mutation.error && <div className="form-error" role="alert">{message(mutation.error)}</div>}
    <button disabled={mutation.isPending} type="submit">{mutation.isPending ? 'Đang tạo…' : 'Tạo phòng'}</button>
  </form>
}

function ServiceForm({ references, branchPublicId }: { references: CatalogReferenceData; branchPublicId: string }) {
  const client = useQueryClient()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<CatalogServiceType>('CONSULTATION')
  const [categoryPublicId, setCategoryPublicId] = useState(references.categories[0]?.publicId ?? '')
  const [specialtyPublicId, setSpecialtyPublicId] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('30')
  const [basePrice, setBasePrice] = useState('0')
  const mutation = useMutation({
    mutationFn: () => apiClient.catalog.createService(branchPublicId, {
      categoryPublicId, ...(specialtyPublicId ? { specialtyPublicId } : {}),
      code: code.trim().toUpperCase(), name: name.trim(), type,
      durationMinutes: Number(durationMinutes), basePrice, requiresDoctor: type === 'CONSULTATION',
    }),
    onSuccess: () => {
      setCode(''); setName(''); setBasePrice('0')
      void client.invalidateQueries({ queryKey: ['catalog-services', branchPublicId] })
    },
  })
  return <form className="catalog-form panel" onSubmit={(event) => {
    event.preventDefault()
    if (categoryPublicId && code.trim() && name.trim()) mutation.mutate()
  }}>
    <h2>Thêm dịch vụ toàn hệ thống</h2>
    <p>Định nghĩa dịch vụ dùng chung; giá và khả dụng được thiết lập riêng cho từng chi nhánh.</p>
    <div className="form-grid">
      <label>Mã dịch vụ<input value={code} maxLength={30} required onChange={(event) => setCode(event.target.value)} /></label>
      <label>Tên dịch vụ<input value={name} maxLength={200} required onChange={(event) => setName(event.target.value)} /></label>
      <label>Nhóm<select value={categoryPublicId} onChange={(event) => setCategoryPublicId(event.target.value)}>
        {references.categories.map((item) => <option key={item.publicId} value={item.publicId}>{item.name}</option>)}
      </select></label>
      <label>Chuyên khoa<select value={specialtyPublicId} onChange={(event) => setSpecialtyPublicId(event.target.value)}>
        <option value="">Không giới hạn</option>
        {references.specialties.map((item) => <option key={item.publicId} value={item.publicId}>{item.name}</option>)}
      </select></label>
      <label>Loại dịch vụ<select value={type} onChange={(event) => setType(event.target.value as CatalogServiceType)}>
        {Object.entries(serviceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Thời lượng (phút)<input type="number" min={5} max={480} value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} /></label>
      <label>Giá cơ sở (VND)<input inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={basePrice} onChange={(event) => setBasePrice(event.target.value)} /></label>
    </div>
    {mutation.error && <div className="form-error" role="alert">{message(mutation.error)}</div>}
    <button disabled={mutation.isPending} type="submit">{mutation.isPending ? 'Đang tạo…' : 'Tạo dịch vụ'}</button>
  </form>
}

function PriceForm({ service, branchPublicId }: { service: CatalogService; branchPublicId: string }) {
  const client = useQueryClient()
  const [amount, setAmount] = useState(service.branchPrices[0]?.amount ?? service.basePrice)
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10))
  const [isAvailable, setIsAvailable] = useState(service.branchPrices[0]?.isAvailable ?? true)
  const mutation = useMutation({
    mutationFn: () => apiClient.catalog.setBranchPrice(service.publicId, { branchPublicId, amount, effectiveFrom, isAvailable }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['catalog-services', branchPublicId] }),
  })
  return <form className="price-form" onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
    <label>Giá mới<input inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={amount} required onChange={(event) => setAmount(event.target.value)} /></label>
    <label>Hiệu lực từ<input type="date" value={effectiveFrom} required onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
    <label className="checkbox"><input type="checkbox" checked={isAvailable} onChange={(event) => setIsAvailable(event.target.checked)} /> Cho phép đặt</label>
    <button disabled={mutation.isPending} type="submit">Lưu giá</button>
    {mutation.error && <div className="form-error" role="alert">{message(mutation.error)}</div>}
  </form>
}

export function CatalogPage() {
  const client = useQueryClient()
  const references = useQuery({ queryKey: ['catalog-references'], queryFn: () => apiClient.catalog.references().then((result) => result.data) })
  const [selectedBranchPublicId, setBranchPublicId] = useState('')
  const branchPublicId = selectedBranchPublicId || references.data?.branches[0]?.publicId || ''
  const rooms = useQuery({ queryKey: ['catalog-rooms', branchPublicId], enabled: Boolean(branchPublicId),
    queryFn: () => apiClient.catalog.rooms(branchPublicId).then((result) => result.data) })
  const services = useQuery({ queryKey: ['catalog-services', branchPublicId], enabled: Boolean(branchPublicId),
    queryFn: () => apiClient.catalog.services(branchPublicId).then((result) => result.data) })
  const roomStatus = useMutation({
    mutationFn: (room: CatalogRoom) => apiClient.catalog.updateRoom(room.publicId, {
      name: room.name, type: room.type, ...(room.floorNo === null ? {} : { floorNo: room.floorNo }),
      capacity: room.capacity, isActive: !room.isActive,
    }, room.rowVersion),
    onSettled: () => void client.invalidateQueries({ queryKey: ['catalog-rooms', branchPublicId] }),
  })
  const serviceStatus = useMutation({
    mutationFn: (service: CatalogService) => apiClient.catalog.updateService(
      service.publicId, branchPublicId, {
        categoryPublicId: service.category.publicId,
        ...(service.specialty ? { specialtyPublicId: service.specialty.publicId } : {}),
        name: service.name, type: service.type, durationMinutes: service.durationMinutes,
        basePrice: service.basePrice, requiresDoctor: service.requiresDoctor, isActive: !service.isActive,
      }, service.rowVersion,
    ),
    onSettled: () => void client.invalidateQueries({ queryKey: ['catalog-services', branchPublicId] }),
  })

  if (references.isLoading) return <div className="page-state">Đang tải danh mục…</div>
  if (references.error || !references.data) return <div className="page-state error-state">{message(references.error)}</div>

  return <>
    <header><div><span className="eyebrow">DANH MỤC VẬN HÀNH</span><h1>Cơ sở, phòng và dịch vụ</h1>
      <p>Quản lý tài nguyên theo chi nhánh và công bố mức giá có hiệu lực cho luồng đặt lịch.</p></div></header>
    <section className="catalog-toolbar panel"><label>Chi nhánh<select value={branchPublicId} onChange={(event) => setBranchPublicId(event.target.value)}>
      {references.data.branches.map((item) => <option key={item.publicId} value={item.publicId}>{item.name}</option>)}
    </select></label></section>

    <div className="catalog-columns">
      <section><RoomForm references={references.data} branchPublicId={branchPublicId} />
        <div className="catalog-list">
          <h2>Phòng tại chi nhánh</h2>
          {rooms.isLoading && <div className="page-state">Đang tải phòng…</div>}
          {rooms.error && <div className="form-error">{message(rooms.error)}</div>}
          {roomStatus.error && <div className="form-error">{message(roomStatus.error)}</div>}
          {rooms.data?.length === 0 && <div className="page-state">Chưa có phòng.</div>}
          {rooms.data?.map((room) => <article key={room.publicId} className="catalog-card">
            <div><span className={`status ${room.isActive ? 'status-active' : 'status-disabled'}`}>{room.isActive ? 'Hoạt động' : 'Tạm ngừng'}</span>
              <h3>{room.name}</h3><p>{room.code} · {roomLabels[room.type]} · Tầng {room.floorNo ?? '—'} · {room.capacity} chỗ</p></div>
            <button className="secondary" disabled={roomStatus.isPending} onClick={() => roomStatus.mutate(room)}>{room.isActive ? 'Tạm ngừng' : 'Kích hoạt'}</button>
          </article>)}</div>
      </section>
      <section>
        {references.data.canManageOrganizationServices && <ServiceForm references={references.data} branchPublicId={branchPublicId} />}
        <div className="catalog-list"><h2>Dịch vụ và giá chi nhánh</h2>
          {services.isLoading && <div className="page-state">Đang tải dịch vụ…</div>}
          {services.error && <div className="form-error">{message(services.error)}</div>}
          {serviceStatus.error && <div className="form-error">{message(serviceStatus.error)}</div>}
          {services.data?.map((service) => <article key={service.publicId} className="catalog-card service-card">
            <div className="catalog-card-heading"><div><span className={`status ${service.isActive ? 'status-active' : 'status-disabled'}`}>{service.isActive ? serviceLabels[service.type] : 'Tạm ngừng'}</span>
              <h3>{service.name}</h3><p>{service.code} · {service.durationMinutes} phút · {service.specialty?.name ?? 'Mọi chuyên khoa'}</p>
              <strong>{service.branchPrices[0] ? formatMoney(service.branchPrices[0].amount) : 'Chưa có giá tại chi nhánh'}</strong></div>
              {references.data.canManageOrganizationServices && <button className="secondary" disabled={serviceStatus.isPending}
                onClick={() => serviceStatus.mutate(service)}>{service.isActive ? 'Tạm ngừng' : 'Kích hoạt'}</button>}</div>
            <PriceForm key={`${service.publicId}:${branchPublicId}:${service.branchPrices[0]?.publicId ?? 'new'}`}
              service={service} branchPublicId={branchPublicId} />
          </article>)}</div>
      </section>
    </div>
  </>
}
