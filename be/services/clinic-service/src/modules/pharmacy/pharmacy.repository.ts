import { executeCommand, sql } from '../../infrastructure/database/sql-database.js';
import type { ClinicPrincipal } from '../identity/index.js';
import type { BatchInput, MedicineInput, PharmacyRepository, PrescriptionInput, PrescriptionItemInput } from './pharmacy.types.js';

type Row = Record<string, unknown>;
const ctx = (actor: ClinicPrincipal, requestId: string) => ({ actorUserId: actor.userId, requestId });
const actorParam = (actor: ClinicPrincipal) => ({ name: 'actor_user_id', type: sql.BigInt, value: actor.userId });
const uid = (name: string, value: string) => ({ name, type: sql.UniqueIdentifier, value });
const out = (name: string) => ({ name, type: sql.UniqueIdentifier, value: null, direction: 'output' as const });
const date = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const utc = (value: unknown) => value == null ? null : value instanceof Date ? value.toISOString() : String(value);
const str = (value: unknown) => value == null ? null : String(value);
const id = (value: unknown) => String(value);
const rows = (result: Awaited<ReturnType<typeof executeCommand<Row>>>) => result.recordsets as unknown as Row[][];
const allergenNames = (value: unknown): string[] => {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as Array<{ allergenName?: unknown }>;
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry.allergenName ?? '')).filter(Boolean) : [];
  } catch { return []; }
};

export class SqlPharmacyRepository implements PharmacyRepository {
  async branches(actor: ClinicPrincipal, requestId: string) {
    const result = await executeCommand<Row>('dbo.sp_clinic_pharmacy_branches', [actorParam(actor)], ctx(actor, requestId));
    return result.recordset.map((r) => ({ publicId: id(r.publicId), code: id(r.code), name: id(r.name), timezoneName: id(r.timezoneName) }));
  }
  async workspace(actor: ClinicPrincipal, branchPublicId: string, requestId: string) {
    const sets = rows(await executeCommand<Row>('dbo.sp_clinic_pharmacy_workspace', [actorParam(actor),
      uid('branch_public_id', branchPublicId)], ctx(actor, requestId)));
    return {
      locations: (sets[0] ?? []).map((r) => ({ publicId: id(r.publicId), code: id(r.code), name: id(r.name),
        type: id(r.type), isDispensing: Boolean(r.isDispensing) })),
      medicines: (sets[1] ?? []).map((r) => ({ publicId: id(r.publicId), code: id(r.code), genericName: id(r.genericName),
        brandName: str(r.brandName), activeIngredient: id(r.activeIngredient), strength: id(r.strength),
        dosageForm: id(r.dosageForm), route: id(r.route), baseUnit: id(r.baseUnit),
        salePrice: id(r.salePrice), isActive: Boolean(r.isActive), allergenNames: allergenNames(r.allergensJson) })),
      batches: (sets[2] ?? []).map((r) => ({ publicId: id(r.publicId), medicinePublicId: id(r.medicinePublicId),
        locationPublicId: id(r.locationPublicId), batchNumber: id(r.batchNumber), expiryDate: date(r.expiryDate),
        status: id(r.status), salePrice: id(r.salePrice), quantityOnHand: id(r.quantityOnHand),
        availableQuantity: id(r.availableQuantity) })),
      prescriptions: (sets[3] ?? []).map((r) => ({ publicId: id(r.publicId), code: id(r.code), status: id(r.status),
        encounterPublicId: id(r.encounterPublicId), patientPublicId: id(r.patientPublicId),
        patientCode: id(r.patientCode), patientName: id(r.patientName), issuedAtUtc: utc(r.issuedAtUtc),
        validUntil: r.validUntil == null ? null : date(r.validUntil), itemCount: Number(r.itemCount) })),
      lowStock: (sets[4] ?? []).map((r) => ({ medicinePublicId: id(r.medicinePublicId),
        medicineName: id(r.medicineName), availableQuantity: id(r.availableQuantity), reorderLevel: id(r.reorderLevel) })),
    };
  }
  async get(actor: ClinicPrincipal, publicId: string, requestId: string) {
    const sets = rows(await executeCommand<Row>('dbo.sp_clinic_get_prescription', [actorParam(actor),
      uid('prescription_public_id', publicId)], ctx(actor, requestId)));
    const r = sets[0]?.[0];
    if (!r) throw Object.assign(new Error('Prescription not found'), { number: 53903 });
    return {
      publicId: id(r.publicId), code: id(r.code), status: id(r.status), encounterPublicId: id(r.encounterPublicId),
      patientPublicId: id(r.patientPublicId), patientCode: id(r.patientCode), patientName: id(r.patientName),
      issuedAtUtc: utc(r.issuedAtUtc), validUntil: r.validUntil == null ? null : date(r.validUntil),
      itemCount: Number(r.itemCount), clinicalNotes: str(r.clinicalNotes), generalInstructions: str(r.generalInstructions),
      items: (sets[1] ?? []).map((x) => ({ publicId: id(x.publicId), medicinePublicId: id(x.medicinePublicId),
        medicineName: id(x.medicineName), strength: id(x.strength), dosageForm: id(x.dosageForm), route: id(x.route),
        prescribedQuantity: id(x.prescribedQuantity), dispensedQuantity: id(x.dispensedQuantity),
        dose: id(x.dose), frequency: id(x.frequency), durationDays: x.durationDays == null ? null : Number(x.durationDays),
        timingInstruction: str(x.timingInstruction), usageInstruction: id(x.usageInstruction),
        allergenNames: allergenNames(x.allergensJson), allergyOverrideReason: str(x.allergyOverrideReason) })),
      dispensations: (sets[2] ?? []).map((x) => ({ publicId: id(x.publicId), code: id(x.code), status: id(x.status),
        locationPublicId: id(x.locationPublicId), openedAtUtc: utc(x.openedAtUtc)!, completedAtUtc: utc(x.completedAtUtc) })),
      dispensedItems: (sets[3] ?? []).map((x) => ({ publicId: id(x.publicId), dispensationPublicId: id(x.dispensationPublicId),
        prescriptionItemPublicId: id(x.prescriptionItemPublicId), batchPublicId: id(x.batchPublicId),
        batchNumber: id(x.batchNumber), quantity: id(x.quantity), unitPrice: id(x.unitPrice),
        dispensedAtUtc: utc(x.dispensedAtUtc)!, reversed: Boolean(x.reversed),
        allergyOverrideReason: str(x.allergyOverrideReason) })),
      drugAllergies: (sets[4] ?? []).map((x) => ({ allergenName: id(x.allergenName),
        severity: id(x.severity), reaction: str(x.reaction) })),
      allergyAlerts: (sets[5] ?? []).map((x) => ({ prescriptionItemPublicId: id(x.prescriptionItemPublicId),
        medicinePublicId: id(x.medicinePublicId), medicineName: id(x.medicineName),
        allergenName: id(x.allergenName), severity: id(x.severity), reaction: str(x.reaction),
        prescribingOverrideReason: str(x.prescribingOverrideReason) })),
    };
  }
  private async create(actor: ClinicPrincipal, procedure: string, parameters: Parameters<typeof executeCommand>[1],
    output: string, requestId: string) {
    const result = await executeCommand(procedure, [actorParam(actor), ...parameters, out(output)], ctx(actor, requestId));
    return id(result.output[output]);
  }
  async createMedicine(actor: ClinicPrincipal, input: MedicineInput, requestId: string) {
    return this.create(actor, 'dbo.sp_clinic_create_medicine', [
      { name: 'code', type: sql.VarChar(30), value: input.code },
      { name: 'generic_name', type: sql.NVarChar(250), value: input.genericName },
      { name: 'active_ingredient', type: sql.NVarChar(500), value: input.activeIngredient },
      { name: 'strength', type: sql.NVarChar(100), value: input.strength },
      { name: 'dosage_form', type: sql.NVarChar(100), value: input.dosageForm },
      { name: 'route', type: sql.NVarChar(100), value: input.route },
      { name: 'base_unit', type: sql.NVarChar(30), value: input.baseUnit },
      { name: 'sale_price', type: sql.Decimal(19, 2), value: input.salePrice },
      { name: 'allergen_names_json', type: sql.NVarChar(sql.MAX), value: JSON.stringify(input.allergenNames) },
    ], 'medicine_public_id', requestId);
  }
  async createBatch(actor: ClinicPrincipal, input: BatchInput, requestId: string) {
    return this.create(actor, 'dbo.sp_clinic_create_batch', [uid('branch_public_id', input.branchPublicId),
      uid('medicine_public_id', input.medicinePublicId), { name: 'batch_number', type: sql.NVarChar(80), value: input.batchNumber },
      { name: 'expiry_date', type: sql.Date, value: input.expiryDate },
      { name: 'purchase_price', type: sql.Decimal(19, 2), value: input.purchasePrice },
      { name: 'sale_price', type: sql.Decimal(19, 2), value: input.salePrice }], 'batch_public_id', requestId);
  }
  async createLocation(actor: ClinicPrincipal, input: { branchPublicId: string; code: string; name: string;
    type: 'WAREHOUSE' | 'PHARMACY' | 'CABINET' | 'QUARANTINE'; isDispensing: boolean }, requestId: string) {
    return this.create(actor, 'dbo.sp_clinic_create_inventory_location', [uid('branch_public_id', input.branchPublicId),
      { name: 'code', type: sql.VarChar(30), value: input.code },
      { name: 'name', type: sql.NVarChar(150), value: input.name },
      { name: 'type', type: sql.VarChar(20), value: input.type },
      { name: 'is_dispensing', type: sql.Bit, value: input.isDispensing }], 'location_public_id', requestId);
  }
  async createPrescription(actor: ClinicPrincipal, encounterId: string, input: PrescriptionInput, requestId: string) {
    return this.create(actor, 'dbo.sp_clinic_create_prescription', [uid('encounter_public_id', encounterId),
      { name: 'valid_days', type: sql.SmallInt, value: input.validDays },
      { name: 'clinical_notes', type: sql.NVarChar(1000), value: input.clinicalNotes ?? null },
      { name: 'general_instructions', type: sql.NVarChar(1000), value: input.generalInstructions ?? null }],
    'prescription_public_id', requestId);
  }
  async addItem(actor: ClinicPrincipal, prescriptionId: string, input: PrescriptionItemInput, requestId: string) {
    return this.create(actor, 'dbo.sp_clinic_add_prescription_item', [uid('prescription_public_id', prescriptionId),
      uid('medicine_public_id', input.medicinePublicId),
      { name: 'prescribed_quantity', type: sql.Decimal(18, 3), value: input.prescribedQuantity },
      { name: 'dose', type: sql.NVarChar(100), value: input.dose },
      { name: 'frequency', type: sql.NVarChar(100), value: input.frequency },
      { name: 'duration_days', type: sql.SmallInt, value: input.durationDays ?? null },
      { name: 'timing_instruction', type: sql.NVarChar(200), value: input.timingInstruction ?? null },
      { name: 'usage_instruction', type: sql.NVarChar(1000), value: input.usageInstruction },
      { name: 'sort_order', type: sql.SmallInt, value: input.sortOrder ?? 0 },
      { name: 'allergy_override_reason', type: sql.NVarChar(500), value: input.allergyOverrideReason ?? null }],
    'item_public_id', requestId);
  }
  private async command(actor: ClinicPrincipal, procedure: string, parameters: Parameters<typeof executeCommand>[1], requestId: string) {
    await executeCommand(procedure, [actorParam(actor), ...parameters], ctx(actor, requestId));
  }
  issue(actor: ClinicPrincipal, prescriptionId: string, requestId: string) {
    return this.command(actor, 'dbo.sp_clinic_issue_prescription', [uid('prescription_public_id', prescriptionId)], requestId);
  }
  cancelPrescription(actor: ClinicPrincipal, prescriptionId: string, reason: string, requestId: string) {
    return this.command(actor, 'dbo.sp_clinic_cancel_prescription', [uid('prescription_public_id', prescriptionId),
      { name: 'reason', type: sql.NVarChar(500), value: reason }], requestId);
  }
  receive(actor: ClinicPrincipal, locationId: string, batchId: string, quantity: number, reason: string | null,
    idempotencyKey: string, requestId: string) {
    return this.create(actor, 'dbo.sp_clinic_receive_stock', [uid('location_public_id', locationId),
      uid('batch_public_id', batchId), { name: 'quantity', type: sql.Decimal(18, 3), value: quantity },
      { name: 'reason', type: sql.NVarChar(500), value: reason },
      uid('idempotency_key', idempotencyKey)], 'movement_public_id', requestId);
  }
  openDispensation(actor: ClinicPrincipal, prescriptionId: string, locationId: string, requestId: string) {
    return this.create(actor, 'dbo.sp_clinic_open_dispensation', [uid('prescription_public_id', prescriptionId),
      uid('location_public_id', locationId)], 'dispensation_public_id', requestId);
  }
  dispense(actor: ClinicPrincipal, dispensationId: string, prescriptionItemId: string, batchId: string,
    quantity: number, allergyOverrideReason: string | null, idempotencyKey: string, requestId: string) {
    return this.create(actor, 'dbo.sp_clinic_dispense_item', [uid('dispensation_public_id', dispensationId),
      uid('prescription_item_public_id', prescriptionItemId), uid('batch_public_id', batchId),
      { name: 'quantity', type: sql.Decimal(18, 3), value: quantity },
      uid('idempotency_key', idempotencyKey),
      { name: 'allergy_override_reason', type: sql.NVarChar(500), value: allergyOverrideReason }],
    'dispensation_item_public_id', requestId);
  }
  completeDispensation(actor: ClinicPrincipal, dispensationId: string, requestId: string) {
    return this.command(actor, 'dbo.sp_clinic_complete_dispensation', [uid('dispensation_public_id', dispensationId)], requestId);
  }
  cancelDispensation(actor: ClinicPrincipal, dispensationId: string, reason: string, requestId: string) {
    return this.command(actor, 'dbo.sp_clinic_cancel_dispensation', [uid('dispensation_public_id', dispensationId),
      { name: 'reason', type: sql.NVarChar(500), value: reason }], requestId);
  }
  reverse(actor: ClinicPrincipal, itemId: string, locationId: string, disposition: 'SELLABLE' | 'QUARANTINE',
    reason: string, sellableInspectionConfirmed: boolean, requestId: string) {
    return this.create(actor, 'dbo.sp_clinic_reverse_dispensation_item', [uid('dispensation_item_public_id', itemId),
      uid('return_location_public_id', locationId), { name: 'disposition', type: sql.VarChar(20), value: disposition },
      { name: 'reason', type: sql.NVarChar(500), value: reason },
      { name: 'sellable_inspection_confirmed', type: sql.Bit, value: sellableInspectionConfirmed }],
    'movement_public_id', requestId);
  }
  async reconcile(actor: ClinicPrincipal, branchId: string, requestId: string) {
    const result = await executeCommand<Row>('dbo.sp_clinic_reconcile_stock', [actorParam(actor),
      uid('branch_public_id', branchId)], ctx(actor, requestId));
    return result.recordset.map((r) => ({ locationPublicId: id(r.locationPublicId), batchPublicId: id(r.batchPublicId),
      batchNumber: id(r.batchNumber), balanceQuantity: id(r.balanceQuantity), ledgerQuantity: id(r.ledgerQuantity) }));
  }
}
