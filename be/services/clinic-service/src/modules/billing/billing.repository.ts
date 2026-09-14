import { executeCommand, sql } from '../../infrastructure/database/sql-database.js';
import type { ClinicPrincipal } from '../identity/index.js';
import type {
  BillingRepository, InvoiceDetail, InvoiceSummary, ManualInvoiceItemInput, PaymentInput, RefundInput,
} from './billing.types.js';

type Row = Record<string, unknown>;
const ctx = (actor: ClinicPrincipal, requestId: string) => ({ actorUserId: actor.userId, requestId });
const actorParam = (actor: ClinicPrincipal) => ({ name: 'actor_user_id', type: sql.BigInt, value: actor.userId });
const uid = (name: string, value: string | null) => ({ name, type: sql.UniqueIdentifier, value });
const out = (name: string) => ({ name, type: sql.UniqueIdentifier, value: null, direction: 'output' as const });
const id = (value: unknown) => String(value);
const nullable = (value: unknown) => value == null ? null : String(value);
const utc = (value: unknown) => value == null ? null : value instanceof Date ? value.toISOString() : String(value);
const rows = (result: Awaited<ReturnType<typeof executeCommand<Row>>>) => result.recordsets as unknown as Row[][];

function summary(r: Row): InvoiceSummary {
  return { publicId: id(r.publicId), number: id(r.number), status: id(r.status),
    encounterPublicId: id(r.encounterPublicId), encounterCode: id(r.encounterCode),
    patientPublicId: id(r.patientPublicId), patientCode: id(r.patientCode), patientName: id(r.patientName), currency: 'VND',
    patientPayableAmount: id(r.patientPayableAmount), paidAmount: id(r.paidAmount),
    refundedAmount: id(r.refundedAmount), balanceDue: id(r.balanceDue),
    issuedAtUtc: utc(r.issuedAtUtc), createdAtUtc: utc(r.createdAtUtc)! };
}

export class SqlBillingRepository implements BillingRepository {
  async branches(actor: ClinicPrincipal, requestId: string) {
    const result = await executeCommand<Row>('dbo.sp_clinic_billing_branches', [actorParam(actor)], ctx(actor, requestId));
    return result.recordset.map((r) => ({ publicId: id(r.publicId), code: id(r.code), name: id(r.name),
      timezoneName: id(r.timezoneName) }));
  }
  async workspace(actor: ClinicPrincipal, branchPublicId: string, requestId: string) {
    const sets = rows(await executeCommand<Row>('dbo.sp_clinic_billing_workspace', [actorParam(actor),
      uid('branch_public_id', branchPublicId)], ctx(actor, requestId)));
    return {
      encounters: (sets[0] ?? []).map((r) => ({ publicId: id(r.publicId), code: id(r.code), status: id(r.status),
        completedAtUtc: utc(r.completedAtUtc), patientPublicId: id(r.patientPublicId),
        patientCode: id(r.patientCode), patientName: id(r.patientName),
        activeInvoicePublicId: nullable(r.activeInvoicePublicId), activeInvoiceStatus: nullable(r.activeInvoiceStatus) })),
      invoices: (sets[1] ?? []).map(summary),
    };
  }
  async get(actor: ClinicPrincipal, invoicePublicId: string, requestId: string): Promise<InvoiceDetail> {
    const sets = rows(await executeCommand<Row>('dbo.sp_clinic_get_invoice', [actorParam(actor),
      uid('invoice_public_id', invoicePublicId)], ctx(actor, requestId)));
    const r = sets[0]?.[0];
    if (!r) throw Object.assign(new Error('Invoice not found'), { number: 54002 });
    return { ...summary(r), supersedesInvoicePublicId: nullable(r.supersedesInvoicePublicId),
      subtotalAmount: id(r.subtotalAmount), discountAmount: id(r.discountAmount), taxAmount: id(r.taxAmount),
      totalAmount: id(r.totalAmount), insuranceAmount: id(r.insuranceAmount), dueAtUtc: utc(r.dueAtUtc),
      voidedAtUtc: utc(r.voidedAtUtc), voidReason: nullable(r.voidReason),
      items: (sets[1] ?? []).map((x) => ({ publicId: id(x.publicId), type: id(x.type), code: nullable(x.code),
        name: id(x.name), quantity: id(x.quantity), unitPrice: id(x.unitPrice), discountAmount: id(x.discountAmount),
        taxRatePercent: id(x.taxRatePercent), lineTotal: id(x.lineTotal) })),
      payments: (sets[2] ?? []).map((x) => ({ publicId: id(x.publicId), paymentPublicId: id(x.paymentPublicId),
        number: id(x.number), amount: id(x.amount), method: id(x.method), status: id(x.status),
        externalTransactionId: nullable(x.externalTransactionId), paidAtUtc: utc(x.paidAtUtc)!,
        refundableAmount: id(x.refundableAmount) })),
      refunds: (sets[3] ?? []).map((x) => ({ publicId: id(x.publicId), allocationPublicId: id(x.allocationPublicId),
        paymentAllocationPublicId: id(x.paymentAllocationPublicId), number: id(x.number), amount: id(x.amount),
        method: id(x.method), status: id(x.status), reason: id(x.reason), refundedAtUtc: utc(x.refundedAtUtc)! })),
    };
  }
  private async output(actor: ClinicPrincipal, procedure: string, parameters: Parameters<typeof executeCommand>[1],
    outputName: string, requestId: string) {
    const result = await executeCommand(procedure, [actorParam(actor), ...parameters, out(outputName)], ctx(actor, requestId));
    return id(result.output[outputName]);
  }
  async create(actor: ClinicPrincipal, encounterPublicId: string, supersedesInvoicePublicId: string | null,
    requestId: string) {
    return this.output(actor, 'dbo.sp_clinic_create_invoice', [uid('encounter_public_id', encounterPublicId),
      uid('supersedes_invoice_public_id', supersedesInvoicePublicId)], 'invoice_public_id', requestId);
  }
  async synchronize(actor: ClinicPrincipal, invoicePublicId: string, requestId: string) {
    await executeCommand('dbo.sp_clinic_sync_invoice', [actorParam(actor), uid('invoice_public_id', invoicePublicId)],
      ctx(actor, requestId));
  }
  async addManualItem(actor: ClinicPrincipal, invoicePublicId: string, input: ManualInvoiceItemInput, requestId: string) {
    return this.output(actor, 'dbo.sp_clinic_add_manual_invoice_item', [uid('invoice_public_id', invoicePublicId),
      { name: 'item_code', type: sql.VarChar(40), value: input.code ?? null },
      { name: 'item_name', type: sql.NVarChar(300), value: input.name },
      { name: 'quantity', type: sql.Decimal(18, 3), value: input.quantity },
      { name: 'unit_price', type: sql.Decimal(19, 2), value: input.unitPrice },
      { name: 'discount_amount', type: sql.Decimal(19, 2), value: input.discountAmount ?? 0 },
      { name: 'tax_rate_percent', type: sql.Decimal(7, 4), value: input.taxRatePercent ?? 0 },
    ], 'invoice_item_public_id', requestId);
  }
  async setInsurance(actor: ClinicPrincipal, invoicePublicId: string, amount: number, requestId: string) {
    await executeCommand('dbo.sp_clinic_set_invoice_insurance', [actorParam(actor), uid('invoice_public_id', invoicePublicId),
      { name: 'insurance_amount', type: sql.Decimal(19, 2), value: amount }], ctx(actor, requestId));
  }
  async issue(actor: ClinicPrincipal, invoicePublicId: string, dueAtUtc: string | null,
    idempotencyKey: string, requestId: string) {
    await executeCommand('dbo.sp_clinic_issue_invoice', [actorParam(actor), uid('invoice_public_id', invoicePublicId),
      { name: 'due_at_utc', type: sql.DateTime2(3), value: dueAtUtc }, uid('idempotency_key', idempotencyKey)],
    ctx(actor, requestId));
  }
  async recordPayment(actor: ClinicPrincipal, invoicePublicId: string, input: PaymentInput,
    idempotencyKey: string, requestId: string) {
    return this.output(actor, 'dbo.sp_clinic_record_invoice_payment', [uid('invoice_public_id', invoicePublicId),
      { name: 'amount', type: sql.Decimal(19, 2), value: input.amount },
      { name: 'payment_method', type: sql.VarChar(20), value: input.method },
      { name: 'external_transaction_id', type: sql.NVarChar(150), value: input.externalTransactionId ?? null },
      uid('idempotency_key', idempotencyKey), { name: 'notes', type: sql.NVarChar(500), value: input.notes ?? null },
    ], 'payment_public_id', requestId);
  }
  async refund(actor: ClinicPrincipal, paymentAllocationPublicId: string, input: RefundInput,
    idempotencyKey: string, requestId: string) {
    return this.output(actor, 'dbo.sp_clinic_refund_payment', [
      uid('payment_allocation_public_id', paymentAllocationPublicId),
      { name: 'amount', type: sql.Decimal(19, 2), value: input.amount },
      { name: 'refund_method', type: sql.VarChar(20), value: input.method },
      { name: 'external_transaction_id', type: sql.NVarChar(150), value: input.externalTransactionId ?? null },
      uid('idempotency_key', idempotencyKey), { name: 'reason', type: sql.NVarChar(500), value: input.reason },
    ], 'refund_public_id', requestId);
  }
  async voidInvoice(actor: ClinicPrincipal, invoicePublicId: string, reason: string, requestId: string) {
    await executeCommand('dbo.sp_clinic_void_invoice', [actorParam(actor), uid('invoice_public_id', invoicePublicId),
      { name: 'reason', type: sql.NVarChar(500), value: reason }], ctx(actor, requestId));
  }
}
