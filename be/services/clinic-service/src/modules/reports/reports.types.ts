import type { ClinicPrincipal } from '../identity/index.js';

export type ReportBranch = { publicId: string; code: string; name: string; timezoneName: string;
  canViewOperations: boolean; canViewRevenue: boolean; canViewInventory: boolean };
export type ReportRange = { from: string; to: string };
export type OperationsReport = {
  summary: { appointmentCount: number; confirmedCount: number; cancelledCount: number; noShowCount: number;
    encounterCount: number; completedEncounterCount: number; averageWaitMinutes: number | null };
  daily: Array<{ date: string; appointmentCount: number; arrivedCount: number; completedCount: number;
    cancelledCount: number; noShowCount: number }>;
};
export type RevenueReport = {
  summary: { invoicedAmount: string; collectedAmount: string; refundedAmount: string; netCollectedAmount: string };
  daily: Array<{ date: string; method: string; collectedAmount: string; refundedAmount: string;
    netCollectedAmount: string }>;
};
export type InventoryReport = {
  summary: { serviceQuantity: string; medicineQuantity: string; lowStockCount: number; expiringBatchCount: number };
  services: Array<{ code: string; name: string; quantity: string; amount: string }>;
  medicines: Array<{ code: string; name: string; quantity: string; amount: string }>;
  lowStock: Array<{ code: string; name: string; availableQuantity: string; reorderLevel: string }>;
  expiringBatches: Array<{ medicineCode: string; medicineName: string; batchNumber: string; expiryDate: string;
    availableQuantity: string; daysToExpiry: number }>;
};

export interface ReportsRepository {
  branches(actor: ClinicPrincipal, requestId: string): Promise<ReportBranch[]>;
  operations(actor: ClinicPrincipal, branchPublicId: string, range: ReportRange,
    requestId: string): Promise<OperationsReport>;
  revenue(actor: ClinicPrincipal, branchPublicId: string, range: ReportRange,
    requestId: string): Promise<RevenueReport>;
  inventory(actor: ClinicPrincipal, branchPublicId: string, range: ReportRange,
    requestId: string): Promise<InventoryReport>;
}
