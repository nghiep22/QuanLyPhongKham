import { ApiClientError } from '@clinic/generated-api-client'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../shared/api/client'
import { getAdminAccess } from '../auth/admin-access'
import { useAuth } from '../auth/auth-context'
import './dashboard-page.css'

function localDate(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function reportError(error: unknown) {
  if (!(error instanceof ApiClientError)) return 'Không thể kết nối hệ thống báo cáo.'
  if (error.status === 403) return 'Bạn không có quyền xem số liệu này tại chi nhánh đã chọn.'
  return error.message
}

const number = (value: number) => value.toLocaleString('vi-VN')
const money = (value: string | number) => `${Number(value).toLocaleString('vi-VN')} ₫`

type MetricCardProps = {
  label: string
  value: string
  detail: string
  badge: string
  tone: 'mint' | 'blue' | 'amber' | 'violet' | 'rose'
  loading?: boolean
  error?: unknown
}

function MetricCard({ label, value, detail, badge, tone, loading, error }: MetricCardProps) {
  return (
    <article className={`ops-metric ops-metric-${tone}`}>
      <div className="ops-metric-top">
        <span>{label}</span>
        <span className="ops-metric-badge" aria-hidden="true">{badge}</span>
      </div>
      {loading
        ? <div className="ops-metric-skeleton" aria-label={`Đang tải ${label}`} />
        : <strong>{error ? '—' : value}</strong>}
      <small className={error ? 'ops-text-error' : undefined}>{error ? reportError(error) : detail}</small>
    </article>
  )
}

type QuickLink = {
  to: string
  code: string
  title: string
  description: string
  allowed: boolean
}

export function DashboardPage() {
  const { user } = useAuth()
  const access = getAdminAccess(user)
  const [branchId, setBranchId] = useState('')
  const today = localDate(new Date())

  const branches = useQuery({
    queryKey: ['report-branches'],
    queryFn: () => apiClient.reports.branches(),
    enabled: access.canViewReports,
    refetchInterval: 5 * 60_000,
  })
  const branch = branches.data?.data.find((item) => item.publicId === branchId)
    ?? branches.data?.data[0]
  const selectedBranchId = branch?.publicId ?? ''

  const operations = useQuery({
    queryKey: ['dashboard-operations', selectedBranchId, today],
    queryFn: () => apiClient.reports.operations(selectedBranchId, today, today),
    enabled: Boolean(selectedBranchId && branch?.canViewOperations),
    refetchInterval: 60_000,
  })
  const revenue = useQuery({
    queryKey: ['dashboard-revenue', selectedBranchId, today],
    queryFn: () => apiClient.reports.revenue(selectedBranchId, today, today),
    enabled: Boolean(selectedBranchId && branch?.canViewRevenue),
    refetchInterval: 5 * 60_000,
  })
  const inventory = useQuery({
    queryKey: ['dashboard-inventory', selectedBranchId, today],
    queryFn: () => apiClient.reports.inventory(selectedBranchId, today, today),
    enabled: Boolean(selectedBranchId && branch?.canViewInventory),
    refetchInterval: 5 * 60_000,
  })

  const ops = operations.data?.data.summary
  const cash = revenue.data?.data.summary
  const stock = inventory.data?.data.summary
  const completionRate = ops?.encounterCount
    ? Math.round((ops.completedEncounterCount / ops.encounterCount) * 100)
    : 0
  const isRefreshing = branches.isFetching || operations.isFetching || revenue.isFetching || inventory.isFetching
  const updatedAt = Math.max(
    operations.dataUpdatedAt,
    revenue.dataUpdatedAt,
    inventory.dataUpdatedAt,
  )
  const updatedLabel = updatedAt
    ? new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(updatedAt)
    : 'chưa có dữ liệu'

  const quickLinks: QuickLink[] = [
    { to: '/appointments', code: 'LH', title: 'Lịch hẹn', description: 'Xác nhận, đổi lịch và theo dõi bệnh nhân hôm nay.', allowed: access.canManageAppointments },
    { to: '/reception', code: 'TN', title: 'Tiếp nhận', description: 'Check-in, khách vãng lai và điều phối hàng chờ.', allowed: access.canManageReception },
    { to: '/clinical', code: 'KB', title: 'Khám bệnh', description: 'Mở lượt khám, ghi nhận chỉ định và kết quả.', allowed: access.canUseClinical },
    { to: '/patients', code: 'BN', title: 'Bệnh nhân', description: 'Tra cứu và cập nhật hồ sơ hành chính.', allowed: access.canManagePatients },
    { to: '/pharmacy', code: 'NT', title: 'Nhà thuốc', description: 'Cấp thuốc, nhập kho và đối soát tồn.', allowed: access.canUsePharmacy },
    { to: '/billing', code: 'TN', title: 'Thu ngân', description: 'Phát hành hóa đơn, thu tiền và hoàn tiền.', allowed: access.canUseBilling },
    { to: '/schedules', code: 'CA', title: 'Ca & slot', description: 'Quản lý lịch làm việc và khung giờ khám.', allowed: access.canManageSchedules },
    { to: '/reports', code: 'BC', title: 'Báo cáo', description: 'Phân tích vận hành, doanh thu và tồn kho.', allowed: access.canViewReports },
    { to: '/staff', code: 'NS', title: 'Nhân sự', description: 'Tài khoản, bác sĩ và phân quyền chi nhánh.', allowed: access.canManageStaff },
    { to: '/catalog', code: 'DM', title: 'Danh mục', description: 'Phòng khám, dịch vụ và bảng giá áp dụng.', allowed: access.canManageCatalog },
  ].filter((item) => item.allowed)

  const alerts = [
    ...(ops?.noShowCount ? [{ key: 'no-show', tone: 'rose', value: ops.noShowCount, title: 'Bệnh nhân không đến', description: 'Kiểm tra các lịch hẹn cần liên hệ lại.', to: access.canManageAppointments ? '/appointments' : '/reports' }] : []),
    ...(ops?.cancelledCount ? [{ key: 'cancelled', tone: 'amber', value: ops.cancelledCount, title: 'Lịch hẹn đã hủy', description: 'Rà soát công suất trống trong ngày.', to: access.canManageAppointments ? '/appointments' : '/reports' }] : []),
    ...(stock?.lowStockCount ? [{ key: 'low-stock', tone: 'amber', value: stock.lowStockCount, title: 'Thuốc dưới mức tồn', description: 'Cần kiểm tra kế hoạch nhập bổ sung.', to: access.canUsePharmacy ? '/pharmacy' : '/reports' }] : []),
    ...(stock?.expiringBatchCount ? [{ key: 'expiry', tone: 'rose', value: stock.expiringBatchCount, title: 'Lô sắp hết hạn', description: 'Ưu tiên xử lý các lô trong 90 ngày.', to: access.canUsePharmacy ? '/pharmacy' : '/reports' }] : []),
  ]

  const refresh = () => {
    void branches.refetch()
    if (branch?.canViewOperations) void operations.refetch()
    if (branch?.canViewRevenue) void revenue.refetch()
    if (branch?.canViewInventory) void inventory.refetch()
  }

  return (
    <div className="ops-dashboard">
      <header className="ops-header">
        <div>
          <span className="eyebrow">TRUNG TÂM ĐIỀU HÀNH</span>
          <h1>Chào {user?.displayName}</h1>
          <p>{new Intl.DateTimeFormat('vi-VN', {
            weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
          }).format(new Date())}</p>
        </div>
        {access.canViewReports && branches.data?.data.length ? (
          <div className="ops-header-actions">
            <label>
              <span>Chi nhánh đang xem</span>
              <select value={selectedBranchId} onChange={(event) => setBranchId(event.target.value)}>
                {branches.data.data.map((item) => (
                  <option key={item.publicId} value={item.publicId}>{item.name}</option>
                ))}
              </select>
            </label>
            <button type="button" className="secondary ops-refresh" disabled={isRefreshing} onClick={refresh}>
              {isRefreshing ? 'Đang cập nhật…' : 'Làm mới'}
            </button>
          </div>
        ) : null}
      </header>

      <section className="ops-hero">
        <div className="ops-hero-copy">
          <span className="ops-live"><i /> TỔNG QUAN HÔM NAY</span>
          <h2>{branch ? `Vận hành tại ${branch.name}` : 'Mọi phân hệ trong một nơi'}</h2>
          <p>
            {access.canViewReports
              ? 'Số liệu được tổng hợp theo ngày nghiệp vụ và phạm vi chi nhánh của tài khoản.'
              : 'Truy cập nhanh các công việc được cấp quyền cho tài khoản của bạn.'}
          </p>
        </div>
        <div className="ops-hero-status">
          <span>Cập nhật gần nhất</span>
          <strong>{updatedLabel}</strong>
          <small>Tự động đồng bộ định kỳ</small>
        </div>
      </section>

      {access.canViewReports && branches.isLoading && (
        <section className="ops-state" aria-live="polite">Đang tải phạm vi chi nhánh…</section>
      )}
      {access.canViewReports && branches.error && (
        <section className="ops-state ops-state-error" role="alert">
          <strong>Chưa thể tải bảng điều hành</strong>
          <span>{reportError(branches.error)}</span>
          <button type="button" className="secondary" onClick={() => void branches.refetch()}>Thử lại</button>
        </section>
      )}
      {access.canViewReports && !branches.isLoading && !branches.error && !branches.data?.data.length && (
        <section className="ops-state">
          <strong>Chưa có phạm vi báo cáo</strong>
          <span>Tài khoản chưa được cấp quyền báo cáo tại chi nhánh nào.</span>
        </section>
      )}

      {branch && (
        <>
          <section className="ops-section-heading">
            <div><span>CHỈ SỐ TRỌNG YẾU</span><h2>Nhịp vận hành trong ngày</h2></div>
            <small>Dữ liệu ngày {new Intl.DateTimeFormat('vi-VN').format(new Date(`${today}T00:00:00`))}</small>
          </section>
          <section className="ops-metric-grid" aria-live="polite">
            {branch.canViewOperations && (
              <>
                <MetricCard label="Lịch hẹn" value={number(ops?.appointmentCount ?? 0)}
                  detail={`${number(ops?.confirmedCount ?? 0)} lịch đã xác nhận`} badge="LH" tone="blue"
                  loading={operations.isLoading} error={operations.error} />
                <MetricCard label="Lượt khám" value={number(ops?.encounterCount ?? 0)}
                  detail={`${number(ops?.completedEncounterCount ?? 0)} hoàn tất · ${completionRate}%`} badge="KB" tone="mint"
                  loading={operations.isLoading} error={operations.error} />
                <MetricCard label="Chờ trung bình" value={ops?.averageWaitMinutes == null ? '—' : `${ops.averageWaitMinutes} phút`}
                  detail="Từ check-in đến bắt đầu khám" badge="TG" tone="violet"
                  loading={operations.isLoading} error={operations.error} />
              </>
            )}
            {branch.canViewRevenue && (
              <MetricCard label="Thu ròng" value={money(cash?.netCollectedAmount ?? 0)}
                detail={`${money(cash?.collectedAmount ?? 0)} đã thu`} badge="DT" tone="mint"
                loading={revenue.isLoading} error={revenue.error} />
            )}
            {branch.canViewInventory && (
              <MetricCard label="Tồn kho cần xử lý" value={number((stock?.lowStockCount ?? 0) + (stock?.expiringBatchCount ?? 0))}
                detail={`${number(stock?.lowStockCount ?? 0)} tồn thấp · ${number(stock?.expiringBatchCount ?? 0)} sắp hết hạn`} badge="TK" tone="amber"
                loading={inventory.isLoading} error={inventory.error} />
            )}
          </section>

          <section className="ops-insight-grid">
            <article className="ops-panel">
              <div className="ops-panel-heading">
                <div><span>CẦN CHÚ Ý</span><h2>Cảnh báo vận hành</h2></div>
                {alerts.length > 0 && <span className="ops-count">{alerts.length}</span>}
              </div>
              {(operations.isLoading || inventory.isLoading) && !alerts.length
                ? <p className="ops-muted">Đang kiểm tra các chỉ số cần chú ý…</p>
                : alerts.length ? (
                  <div className="ops-alert-list">
                    {alerts.map((alert) => (
                      <Link className="ops-alert" to={alert.to} key={alert.key}>
                        <span className={`ops-alert-value ops-alert-${alert.tone}`}>{alert.value}</span>
                        <span><strong>{alert.title}</strong><small>{alert.description}</small></span>
                        <b aria-hidden="true">→</b>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="ops-all-clear">
                    <span aria-hidden="true">✓</span>
                    <div><strong>Chưa có cảnh báo cần xử lý</strong><small>Các chỉ số hiện tại đang trong trạng thái ổn định.</small></div>
                  </div>
                )}
            </article>

            <article className="ops-panel ops-progress-panel">
              <div className="ops-panel-heading">
                <div><span>TIẾN ĐỘ TRONG NGÀY</span><h2>Hoàn tất lượt khám</h2></div>
              </div>
              {branch.canViewOperations ? (
                <>
                  <div className="ops-progress-value"><strong>{completionRate}%</strong><span>đã hoàn tất</span></div>
                  <div className="ops-progress-track" aria-label={`${completionRate}% lượt khám đã hoàn tất`}>
                    <span style={{ width: `${completionRate}%` }} />
                  </div>
                  <p>{number(ops?.completedEncounterCount ?? 0)} trên {number(ops?.encounterCount ?? 0)} lượt khám đã hoàn thành.</p>
                  <Link to="/reports" className="ops-text-link">Xem báo cáo chi tiết <span aria-hidden="true">→</span></Link>
                </>
              ) : <p className="ops-muted">Bạn không có quyền xem số liệu vận hành tại chi nhánh này.</p>}
            </article>
          </section>
        </>
      )}

      {!access.canViewReports && (
        <section className="ops-access-note">
          <span aria-hidden="true">i</span>
          <div><strong>Dashboard được cá nhân hóa theo vai trò</strong><p>Tài khoản của bạn chưa có quyền xem KPI báo cáo; các phân hệ được phép vẫn hiển thị bên dưới.</p></div>
        </section>
      )}

      <section className="ops-section-heading ops-module-heading">
        <div><span>TRUY CẬP NHANH</span><h2>Phân hệ của bạn</h2></div>
        <small>{quickLinks.length} phân hệ được cấp quyền</small>
      </section>
      <section className="ops-module-grid">
        {quickLinks.map((item) => (
          <Link to={item.to} className="ops-module-card" key={item.to}>
            <span className="ops-module-code" aria-hidden="true">{item.code}</span>
            <div><h3>{item.title}</h3><p>{item.description}</p></div>
            <span className="ops-module-arrow" aria-hidden="true">→</span>
          </Link>
        ))}
      </section>
    </div>
  )
}
