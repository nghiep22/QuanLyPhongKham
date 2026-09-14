import { executeReport, sql } from '../../infrastructure/database/sql-database.js';
import type { ClinicPrincipal } from '../identity/index.js';
import type { InventoryReport, OperationsReport, ReportRange, ReportsRepository, RevenueReport } from './reports.types.js';

type Row = Record<string, unknown>;
const actorParam = (actor: ClinicPrincipal) => ({ name: 'actor_user_id', type: sql.BigInt, value: actor.userId });
const branchParam = (value: string) => ({ name: 'branch_public_id', type: sql.UniqueIdentifier, value });
const rangeParams = (range: ReportRange) => [
  { name: 'from_date', type: sql.Date, value: range.from }, { name: 'to_date', type: sql.Date, value: range.to },
];
const context = (actor: ClinicPrincipal, requestId: string) => ({ actorUserId: actor.userId, requestId });
const sets = (result: Awaited<ReturnType<typeof executeReport<Row>>>) => result.recordsets as unknown as Row[][];
const text = (value: unknown) => String(value);
const number = (value: unknown) => Number(value ?? 0);
const nullableNumber = (value: unknown) => value == null ? null : Number(value);
const date = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

export class SqlReportsRepository implements ReportsRepository {
  async branches(actor: ClinicPrincipal, requestId: string) {
    const result = await executeReport<Row>('dbo.sp_clinic_report_branches', [actorParam(actor)], context(actor, requestId));
    return result.recordset.map((row) => ({ publicId: text(row.publicId), code: text(row.code), name: text(row.name),
      timezoneName: text(row.timezoneName), canViewOperations: Boolean(row.canViewOperations),
      canViewRevenue: Boolean(row.canViewRevenue), canViewInventory: Boolean(row.canViewInventory) }));
  }
  async operations(actor: ClinicPrincipal, branchPublicId: string, range: ReportRange, requestId: string) {
    const result = sets(await executeReport<Row>('dbo.sp_clinic_operations_report',
      [actorParam(actor), branchParam(branchPublicId), ...rangeParams(range)], context(actor, requestId)));
    const summary = result[0]?.[0] ?? {};
    return { summary: { appointmentCount: number(summary.appointmentCount), confirmedCount: number(summary.confirmedCount),
      cancelledCount: number(summary.cancelledCount), noShowCount: number(summary.noShowCount),
      encounterCount: number(summary.encounterCount), completedEncounterCount: number(summary.completedEncounterCount),
      averageWaitMinutes: nullableNumber(summary.averageWaitMinutes) }, daily: (result[1] ?? []).map((row) => ({
        date: date(row.date), appointmentCount: number(row.appointmentCount), arrivedCount: number(row.arrivedCount),
        completedCount: number(row.completedCount), cancelledCount: number(row.cancelledCount),
        noShowCount: number(row.noShowCount) })) } satisfies OperationsReport;
  }
  async revenue(actor: ClinicPrincipal, branchPublicId: string, range: ReportRange, requestId: string) {
    const result = sets(await executeReport<Row>('dbo.sp_clinic_revenue_report',
      [actorParam(actor), branchParam(branchPublicId), ...rangeParams(range)], context(actor, requestId)));
    const summary = result[0]?.[0] ?? {};
    return { summary: { invoicedAmount: text(summary.invoicedAmount ?? 0), collectedAmount: text(summary.collectedAmount ?? 0),
      refundedAmount: text(summary.refundedAmount ?? 0), netCollectedAmount: text(summary.netCollectedAmount ?? 0) },
    daily: (result[1] ?? []).map((row) => ({ date: date(row.date), method: text(row.method),
      collectedAmount: text(row.collectedAmount), refundedAmount: text(row.refundedAmount),
      netCollectedAmount: text(row.netCollectedAmount) })) } satisfies RevenueReport;
  }
  async inventory(actor: ClinicPrincipal, branchPublicId: string, range: ReportRange, requestId: string) {
    const result = sets(await executeReport<Row>('dbo.sp_clinic_inventory_report',
      [actorParam(actor), branchParam(branchPublicId), ...rangeParams(range)], context(actor, requestId)));
    const summary = result[0]?.[0] ?? {};
    return { summary: { serviceQuantity: text(summary.serviceQuantity ?? 0), medicineQuantity: text(summary.medicineQuantity ?? 0),
      lowStockCount: number(summary.lowStockCount), expiringBatchCount: number(summary.expiringBatchCount) },
    services: (result[1] ?? []).map((row) => ({ code: text(row.code), name: text(row.name), quantity: text(row.quantity), amount: text(row.amount) })),
    medicines: (result[2] ?? []).map((row) => ({ code: text(row.code), name: text(row.name), quantity: text(row.quantity), amount: text(row.amount) })),
    lowStock: (result[3] ?? []).map((row) => ({ code: text(row.code), name: text(row.name), availableQuantity: text(row.availableQuantity), reorderLevel: text(row.reorderLevel) })),
    expiringBatches: (result[4] ?? []).map((row) => ({ medicineCode: text(row.medicineCode), medicineName: text(row.medicineName),
      batchNumber: text(row.batchNumber), expiryDate: date(row.expiryDate), availableQuantity: text(row.availableQuantity),
      daysToExpiry: number(row.daysToExpiry) })) } satisfies InventoryReport;
  }
}
