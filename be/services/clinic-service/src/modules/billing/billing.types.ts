import type { ClinicPrincipal } from '../identity/index.js';

export type BillingBranch = { publicId: string; code: string; name: string; timezoneName: string };
export type BillableEncounter = { publicId: string; code: string; status: string; completedAtUtc: string | null;
  patientPublicId: string; patientCode: string; patientName: string; activeInvoicePublicId: string | null;
  activeInvoiceStatus: string | null };
export type InvoiceSummary = { publicId: string; number: string; status: string; encounterPublicId: string;
  encounterCode: string; patientPublicId: string; patientCode: string; patientName: string; currency: 'VND';
  patientPayableAmount: string; paidAmount: string; refundedAmount: string; balanceDue: string;
  issuedAtUtc: string | null; createdAtUtc: string };
export type BillingWorkspace = { encounters: BillableEncounter[]; invoices: InvoiceSummary[] };
export type InvoiceItem = { publicId: string; type: string; code: string | null; name: string;
  quantity: string; unitPrice: string; discountAmount: string; taxRatePercent: string; lineTotal: string };
export type PaymentAllocation = { publicId: string; paymentPublicId: string; number: string; amount: string;
  method: string; status: string; externalTransactionId: string | null; paidAtUtc: string;
  refundableAmount: string };
export type PaymentRefund = { publicId: string; allocationPublicId: string; paymentAllocationPublicId: string;
  number: string; amount: string; method: string; status: string; reason: string; refundedAtUtc: string };
export type InvoiceDetail = InvoiceSummary & { supersedesInvoicePublicId: string | null; subtotalAmount: string;
  discountAmount: string; taxAmount: string; totalAmount: string; insuranceAmount: string;
  dueAtUtc: string | null; voidedAtUtc: string | null; voidReason: string | null;
  items: InvoiceItem[]; payments: PaymentAllocation[]; refunds: PaymentRefund[] };
export type ManualInvoiceItemInput = { code?: string | null; name: string; quantity: number; unitPrice: number;
  discountAmount?: number; taxRatePercent?: number };
export type PaymentInput = { amount: number; method: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'EWALLET' | 'OTHER';
  externalTransactionId?: string | null; notes?: string | null };
export type RefundInput = { amount: number; method: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'EWALLET' | 'OTHER';
  externalTransactionId?: string | null; reason: string };

export interface BillingRepository {
  branches(actor: ClinicPrincipal, requestId: string): Promise<BillingBranch[]>;
  workspace(actor: ClinicPrincipal, branchPublicId: string, requestId: string): Promise<BillingWorkspace>;
  get(actor: ClinicPrincipal, invoicePublicId: string, requestId: string): Promise<InvoiceDetail>;
  create(actor: ClinicPrincipal, encounterPublicId: string, supersedesInvoicePublicId: string | null,
    requestId: string): Promise<string>;
  synchronize(actor: ClinicPrincipal, invoicePublicId: string, requestId: string): Promise<void>;
  addManualItem(actor: ClinicPrincipal, invoicePublicId: string, input: ManualInvoiceItemInput,
    requestId: string): Promise<string>;
  setInsurance(actor: ClinicPrincipal, invoicePublicId: string, amount: number, requestId: string): Promise<void>;
  issue(actor: ClinicPrincipal, invoicePublicId: string, dueAtUtc: string | null,
    idempotencyKey: string, requestId: string): Promise<void>;
  recordPayment(actor: ClinicPrincipal, invoicePublicId: string, input: PaymentInput,
    idempotencyKey: string, requestId: string): Promise<string>;
  refund(actor: ClinicPrincipal, paymentAllocationPublicId: string, input: RefundInput,
    idempotencyKey: string, requestId: string): Promise<string>;
  voidInvoice(actor: ClinicPrincipal, invoicePublicId: string, reason: string, requestId: string): Promise<void>;
}
