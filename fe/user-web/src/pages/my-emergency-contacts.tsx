import { ApiClientError } from '@clinic/generated-api-client'
import type { MyEmergencyContacts, PatientEmergencyContact } from '@clinic/generated-api-types'
import { useEffect, useState, type FormEvent } from 'react'
import { api, errorMessage } from '../api'

const blank = (): PatientEmergencyContact => ({ fullName: '', relationshipName: null, phone: '', isPrimary: false })

export function MyEmergencyContactsEditor({ patientId, patientName, onClose }: {
  patientId: string; patientName: string; onClose: () => void
}) {
  const [snapshot, setSnapshot] = useState<MyEmergencyContacts | null>(null)
  const [contacts, setContacts] = useState<PatientEmergencyContact[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = async () => {
    setBusy(true); setError(''); setNotice(''); setSnapshot(null); setContacts([])
    try { const response = await api.patients.myEmergencyContacts(patientId)
      setSnapshot(response.data); setContacts(response.data.contacts) }
    catch (cause) { if (cause instanceof ApiClientError && cause.code === 'FORBIDDEN') {
      setSnapshot(null); setContacts([]) }
      setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [patientId])
  const edit = (index: number, update: Partial<PatientEmergencyContact>) =>
    setContacts((items) => items.map((item, position) => position === index ? { ...item, ...update } : item))
  const primary = (index: number) => setContacts((items) => items.map((item, position) =>
    ({ ...item, isPrimary: position === index })))
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!snapshot) return
    if (contacts.some((item) => item.fullName.trim().length < 2 || !/^[0-9+(). -]{7,20}$/.test(item.phone.trim()))
      || (contacts.length > 0 && contacts.filter((item) => item.isPrimary).length !== 1)) {
      setError('Nhập tên, số điện thoại hợp lệ và chọn đúng một liên hệ chính.'); return
    }
    setBusy(true); setError(''); setNotice('')
    try { const response = await api.patients.replaceMyEmergencyContacts(patientId,
      { contacts: contacts.map((item) => ({ ...item, fullName: item.fullName.trim(),
        relationshipName: item.relationshipName?.trim() || null, phone: item.phone.trim() })) }, snapshot.rowVersion)
      setSnapshot(response.data); setContacts(response.data.contacts); setNotice('Đã lưu liên hệ khẩn cấp.') }
    catch (cause) { if (cause instanceof ApiClientError && cause.code === 'FORBIDDEN') {
      setSnapshot(null); setContacts([]) }
      setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  return <section className="panel emergency-editor" aria-label={`Liên hệ khẩn cấp của ${patientName}`}>
    <div className="panel-head"><h2>Liên hệ khẩn cấp · {patientName}</h2><button className="inline-link" onClick={onClose}>Đóng</button></div>
    <p>Tối đa 5 người. Khi có liên hệ, hãy chọn một người chính.</p>
    {error && <div className="error" role="alert">{error}</div>}{notice && <div className="success" role="status">{notice}</div>}
    <form onSubmit={(event) => void save(event)}>
      {!busy && snapshot && !contacts.length && <div className="empty-state patient-empty-compact"><strong>Chưa có liên hệ khẩn cấp</strong><p>Thêm người phòng khám có thể liên hệ khi cần.</p></div>}
      {contacts.map((contact, index) => <div className="emergency-contact-card" key={index}>
        <label>Họ tên<input value={contact.fullName} maxLength={200} onChange={(event) => edit(index, { fullName: event.target.value })} /></label>
        <label>Quan hệ<input value={contact.relationshipName ?? ''} maxLength={80} onChange={(event) => edit(index, { relationshipName: event.target.value })} /></label>
        <label>Số điện thoại<input type="tel" value={contact.phone} maxLength={20} onChange={(event) => edit(index, { phone: event.target.value })} /></label>
        <label><input type="radio" name="primary-emergency-contact" checked={contact.isPrimary} onChange={() => primary(index)} /> Liên hệ chính</label>
        <button type="button" className="inline-link danger-text" disabled={busy} onClick={() => setContacts((items) => {
          const remaining = items.filter((_, position) => position !== index)
          if (remaining.length && !remaining.some((item) => item.isPrimary)) remaining[0] = { ...remaining[0]!, isPrimary: true }
          return remaining
        })}>Xóa</button>
      </div>)}
      <div className="panel-head emergency-editor-actions"><button type="button" className="inline-link" disabled={busy || contacts.length >= 5}
        onClick={() => setContacts((items) => [...items, { ...blank(), isPrimary: items.length === 0 }])}>+ Thêm liên hệ</button>
        <button className="button" disabled={busy || !snapshot}>{busy ? 'Đang xử lý…' : 'Lưu thay đổi'}</button></div>
    </form>
    <button className="inline-link" disabled={busy} onClick={() => void load()}>Tải lại thông tin</button>
  </section>
}
