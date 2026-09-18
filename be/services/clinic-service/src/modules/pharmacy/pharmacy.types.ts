import type { ClinicPrincipal } from '../identity/index.js';

export type PharmacyBranch = { publicId: string; code: string; name: string; timezoneName: string };
export type PharmacyLocation = { publicId: string; code: string; name: string; type: string; isDispensing: boolean };
export type Medicine = { publicId: string; code: string; genericName: string; brandName: string | null;
  activeIngredient: string; strength: string; dosageForm: string; route: string; baseUnit: string;
  salePrice: string; isActive: boolean; allergenNames: string[] };
export type MedicineBatch = { publicId: string; medicinePublicId: string; locationPublicId: string;
  batchNumber: string; expiryDate: string; status: string; salePrice: string;
  quantityOnHand: string; availableQuantity: string };
export type PrescriptionSummary = { publicId: string; code: string; status: string; encounterPublicId: string;
  patientPublicId: string; patientCode: string; patientName: string; issuedAtUtc: string | null;
  validUntil: string | null; itemCount: number };
export type PharmacyWorkspace = { locations: PharmacyLocation[]; medicines: Medicine[]; batches: MedicineBatch[];
  prescriptions: PrescriptionSummary[]; lowStock: Array<{ medicinePublicId: string; medicineName: string;
    availableQuantity: string; reorderLevel: string }> };
export type PrescriptionDetail = PrescriptionSummary & {
  branch: { publicId: string; code: string; name: string; timezoneName: string;
    medicalLicenseNo: string | null; phone: string | null; email: string | null; addressLine: string;
    ward: string | null; district: string | null; province: string | null };
  prescriber: { publicId: string; fullName: string; medicalLicenseNo: string; academicTitle: string | null };
  patient: { dateOfBirth: string; gender: string; phone: string | null;
    addressLine: string | null; healthInsuranceNo: string | null };
  clinicalNotes: string | null; generalInstructions: string | null;
  items: Array<{ publicId: string; medicinePublicId: string; medicineName: string; strength: string;
    dosageForm: string; route: string; prescribedQuantity: string; dispensedQuantity: string;
    dose: string; frequency: string; durationDays: number | null; timingInstruction: string | null;
    usageInstruction: string; allergenNames: string[]; allergyOverrideReason: string | null }>;
  dispensations: Array<{ publicId: string; code: string; status: string; locationPublicId: string;
    openedAtUtc: string; completedAtUtc: string | null }>;
  dispensedItems: Array<{ publicId: string; dispensationPublicId: string; prescriptionItemPublicId: string;
    batchPublicId: string; batchNumber: string; quantity: string; unitPrice: string;
    dispensedAtUtc: string; reversed: boolean; allergyOverrideReason: string | null }>;
  drugAllergies: Array<{ allergenName: string; severity: string; reaction: string | null }>;
  allergyAlerts: Array<{ prescriptionItemPublicId: string; medicinePublicId: string; medicineName: string;
    allergenName: string; severity: string; reaction: string | null; prescribingOverrideReason: string | null }>;
};
export type ReconciliationDifference = { locationPublicId: string; batchPublicId: string;
  batchNumber: string; balanceQuantity: string; ledgerQuantity: string };
export type MedicineInput = { code: string; genericName: string; activeIngredient: string; strength: string;
  dosageForm: string; route: string; baseUnit: string; salePrice: number; allergenNames: string[] };
export type BatchInput = { branchPublicId: string; medicinePublicId: string; batchNumber: string;
  expiryDate: string; purchasePrice: number; salePrice: number };
export type PrescriptionInput = { validDays: number; clinicalNotes?: string | null;
  generalInstructions?: string | null };
export type PrescriptionItemInput = { medicinePublicId: string; prescribedQuantity: number; dose: string;
  frequency: string; durationDays?: number | null; timingInstruction?: string | null;
  usageInstruction: string; sortOrder?: number; allergyOverrideReason?: string | null };

export interface PharmacyRepository {
  branches(actor: ClinicPrincipal, requestId: string): Promise<PharmacyBranch[]>;
  workspace(actor: ClinicPrincipal, branchPublicId: string, requestId: string): Promise<PharmacyWorkspace>;
  get(actor: ClinicPrincipal, publicId: string, requestId: string): Promise<PrescriptionDetail>;
  createMedicine(actor: ClinicPrincipal, input: MedicineInput, requestId: string): Promise<string>;
  createBatch(actor: ClinicPrincipal, input: BatchInput, requestId: string): Promise<string>;
  createLocation(actor: ClinicPrincipal, input: { branchPublicId: string; code: string; name: string;
    type: 'WAREHOUSE' | 'PHARMACY' | 'CABINET' | 'QUARANTINE'; isDispensing: boolean }, requestId: string): Promise<string>;
  createPrescription(actor: ClinicPrincipal, encounterId: string, input: PrescriptionInput, requestId: string): Promise<string>;
  addItem(actor: ClinicPrincipal, prescriptionId: string, input: PrescriptionItemInput, requestId: string): Promise<string>;
  issue(actor: ClinicPrincipal, prescriptionId: string, requestId: string): Promise<void>;
  cancelPrescription(actor: ClinicPrincipal, prescriptionId: string, reason: string, requestId: string): Promise<void>;
  receive(actor: ClinicPrincipal, locationId: string, batchId: string, quantity: number,
    reason: string | null, idempotencyKey: string, requestId: string): Promise<string>;
  openDispensation(actor: ClinicPrincipal, prescriptionId: string, locationId: string, requestId: string): Promise<string>;
  dispense(actor: ClinicPrincipal, dispensationId: string, prescriptionItemId: string,
    batchId: string, quantity: number, allergyOverrideReason: string | null,
    idempotencyKey: string, requestId: string): Promise<string>;
  completeDispensation(actor: ClinicPrincipal, dispensationId: string, requestId: string): Promise<void>;
  cancelDispensation(actor: ClinicPrincipal, dispensationId: string, reason: string, requestId: string): Promise<void>;
  reverse(actor: ClinicPrincipal, dispensationItemId: string, returnLocationId: string,
    disposition: 'SELLABLE' | 'QUARANTINE', reason: string, sellableInspectionConfirmed: boolean,
    requestId: string): Promise<string>;
  reconcile(actor: ClinicPrincipal, branchId: string, requestId: string): Promise<ReconciliationDifference[]>;
}
