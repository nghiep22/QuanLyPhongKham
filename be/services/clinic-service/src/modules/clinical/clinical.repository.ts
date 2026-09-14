import { executeCommand, sql } from '../../infrastructure/database/sql-database.js';
import type { ClinicPrincipal } from '../identity/index.js';
import type {
  AmendmentInput, ClinicalEncounterDetail, ClinicalEncounterSummary,
  ClinicalRepository, ClinicalNotesInput, DiagnosisInput, EncounterStatus, FinalizeResultInput,
  OrderServiceInput, VitalSignsInput,
} from './clinical.types.js';

type Row = Record<string, unknown>;
const utc = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
const nullableUtc = (value: unknown) => value == null ? null : utc(value);
const dateOnly = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const nullable = (value: unknown) => value == null ? null : String(value);
const numberOrNull = (value: unknown) => value == null ? null : Number(value);
const hex = (value: unknown) => Buffer.isBuffer(value) ? value.toString('hex').toUpperCase() : String(value ?? '');

function summary(row: Row): ClinicalEncounterSummary {
  return {
    publicId: String(row.publicId), code: String(row.code), source: row.source as ClinicalEncounterSummary['source'],
    status: row.status as EncounterStatus, arrivedAtUtc: utc(row.arrivedAtUtc), startedAtUtc: nullableUtc(row.startedAtUtc),
    completedAtUtc: nullableUtc(row.completedAtUtc), chiefComplaint: nullable(row.chiefComplaint),
    patient: { publicId: String(row.patientPublicId), code: String(row.patientCode), fullName: String(row.patientName),
      dateOfBirth: dateOnly(row.patientDateOfBirth), gender: String(row.patientGender) },
    doctor: { publicId: String(row.doctorPublicId), fullName: String(row.doctorName) },
    room: row.roomPublicId == null ? null : { publicId: String(row.roomPublicId), name: String(row.roomName) },
    queue: row.queueDisplayNumber == null ? null : { displayNumber: String(row.queueDisplayNumber), status: String(row.queueStatus) },
  };
}

function detail(result: Awaited<ReturnType<typeof executeCommand<Row>>>): ClinicalEncounterDetail {
  const sets = result.recordsets as unknown as Row[][]; const base = sets[0]?.[0];
  if (!base) throw Object.assign(new Error('Encounter not found.'), { number: 53802 });
  let signature: ClinicalEncounterDetail['signature'] = null;
  if (base.signatureSha256 != null) signature = { schemaVersion: String(base.signatureSchemaVersion),
    sha256: hex(base.signatureSha256), signedAtUtc: utc(base.signatureSignedAtUtc) };
  return {
    ...summary(base), signedAtUtc: nullableUtc(base.signedAtUtc), signature,
    historyOfPresentIllness: nullable(base.historyOfPresentIllness), physicalExamination: nullable(base.physicalExamination),
    clinicalAssessment: nullable(base.clinicalAssessment), treatmentPlan: nullable(base.treatmentPlan),
    followUpInstructions: nullable(base.followUpInstructions), followUpDate: base.followUpDate == null ? null : dateOnly(base.followUpDate),
    vitalSigns: (sets[1] ?? []).map((row) => ({ publicId: String(row.publicId), measuredAtUtc: utc(row.measuredAtUtc),
      temperatureC: numberOrNull(row.temperatureC), pulseBpm: numberOrNull(row.pulseBpm),
      respiratoryRateBpm: numberOrNull(row.respiratoryRateBpm), systolicBpMmhg: numberOrNull(row.systolicBpMmhg),
      diastolicBpMmhg: numberOrNull(row.diastolicBpMmhg), spo2Percent: numberOrNull(row.spo2Percent),
      heightCm: numberOrNull(row.heightCm), weightKg: numberOrNull(row.weightKg), bmi: numberOrNull(row.bmi),
      painScore: numberOrNull(row.painScore), notes: nullable(row.notes), measuredBy: String(row.measuredBy) })),
    diagnoses: (sets[2] ?? []).map((row) => ({ publicId: String(row.publicId), code: String(row.code), name: String(row.name),
      type: row.type as DiagnosisInput['type'], isPrimary: Boolean(row.isPrimary), notes: nullable(row.notes),
      createdAtUtc: utc(row.createdAtUtc), recordedBy: String(row.recordedBy) })),
    services: (sets[3] ?? []).map((row) => ({ publicId: String(row.publicId), catalogPublicId: String(row.catalogPublicId),
      code: String(row.code), name: String(row.name), type: String(row.type), quantity: String(row.quantity),
      unitPrice: String(row.unitPrice), status: row.status as ClinicalEncounterDetail['services'][number]['status'],
      notes: nullable(row.notes), result: row.resultPublicId == null ? null : { publicId: String(row.resultPublicId),
        version: Number(row.resultVersion), status: String(row.resultStatus), summary: nullable(row.resultSummary),
        conclusion: nullable(row.resultConclusion), result: row.resultJson == null ? null : JSON.parse(String(row.resultJson)) as unknown,
        finalizedAtUtc: utc(row.resultFinalizedAtUtc) } })),
    amendments: (sets[4] ?? []).map((row) => ({ publicId: String(row.publicId), number: Number(row.number),
      reason: String(row.reason), content: String(row.content), hash: hex(row.hash), amendedAtUtc: utc(row.amendedAtUtc),
      amendedBy: String(row.amendedBy) })),
    availableServices: (sets[5] ?? []).map((row) => ({ publicId: String(row.publicId), code: String(row.code),
      name: String(row.name), type: String(row.type), priceAmount: String(row.priceAmount) })),
  };
}

const context = (actor: ClinicPrincipal, requestId: string) => ({ requestId, actorUserId: actor.userId });
const actorParam = (actor: ClinicPrincipal) => ({ name: 'actor_user_id', type: sql.BigInt, value: actor.userId });
const encounterParam = (publicId: string) => ({ name: 'encounter_public_id', type: sql.UniqueIdentifier, value: publicId });
const outId = (name: string) => ({ name, type: sql.UniqueIdentifier, value: null, direction: 'output' as const });

export class SqlClinicalRepository implements ClinicalRepository {
  async branches(actor: ClinicPrincipal, requestId: string) {
    const result = await executeCommand<Row>('dbo.sp_clinic_clinical_branches', [actorParam(actor)], context(actor, requestId));
    return result.recordset.map((row) => ({ publicId: String(row.publicId), code: String(row.code), name: String(row.name),
      timezoneName: String(row.timezoneName) }));
  }
  async list(actor: ClinicPrincipal, branchPublicId: string, statuses: EncounterStatus[], requestId: string) {
    const result = await executeCommand<Row>('dbo.sp_clinic_list_encounters', [actorParam(actor),
      { name: 'branch_public_id', type: sql.UniqueIdentifier, value: branchPublicId },
      { name: 'statuses', type: sql.VarChar(200), value: statuses.join(',') }], context(actor, requestId));
    return result.recordset.map(summary);
  }
  async get(actor: ClinicPrincipal, encounterPublicId: string, requestId: string) {
    return detail(await executeCommand<Row>('dbo.sp_clinic_get_encounter', [actorParam(actor), encounterParam(encounterPublicId)],
      context(actor, requestId)));
  }
  async start(actor: ClinicPrincipal, encounterPublicId: string, roomPublicId: string | null, requestId: string) {
    await executeCommand('dbo.sp_clinic_start_encounter', [actorParam(actor), encounterParam(encounterPublicId),
      { name: 'room_public_id', type: sql.UniqueIdentifier, value: roomPublicId }], context(actor, requestId));
  }
  async updateNotes(actor: ClinicPrincipal, encounterPublicId: string, input: ClinicalNotesInput, requestId: string) {
    await executeCommand('dbo.sp_clinic_update_encounter_clinical_notes', [actorParam(actor), encounterParam(encounterPublicId),
      { name: 'history_of_present_illness', type: sql.NVarChar(sql.MAX), value: input.historyOfPresentIllness ?? null },
      { name: 'physical_examination', type: sql.NVarChar(sql.MAX), value: input.physicalExamination ?? null },
      { name: 'clinical_assessment', type: sql.NVarChar(sql.MAX), value: input.clinicalAssessment ?? null },
      { name: 'treatment_plan', type: sql.NVarChar(sql.MAX), value: input.treatmentPlan ?? null },
      { name: 'follow_up_instructions', type: sql.NVarChar(sql.MAX), value: input.followUpInstructions ?? null },
      { name: 'follow_up_date', type: sql.Date, value: input.followUpDate ?? null }], context(actor, requestId));
  }
  async addVitalSigns(actor: ClinicPrincipal, encounterPublicId: string, input: VitalSignsInput, requestId: string) {
    const result = await executeCommand('dbo.sp_clinic_add_vital_signs', [actorParam(actor), encounterParam(encounterPublicId),
      { name: 'temperature_c', type: sql.Decimal(4, 1), value: input.temperatureC ?? null },
      { name: 'pulse_bpm', type: sql.SmallInt, value: input.pulseBpm ?? null },
      { name: 'respiratory_rate_bpm', type: sql.SmallInt, value: input.respiratoryRateBpm ?? null },
      { name: 'systolic_bp_mmhg', type: sql.SmallInt, value: input.systolicBpMmhg ?? null },
      { name: 'diastolic_bp_mmhg', type: sql.SmallInt, value: input.diastolicBpMmhg ?? null },
      { name: 'spo2_percent', type: sql.Decimal(5, 2), value: input.spo2Percent ?? null },
      { name: 'height_cm', type: sql.Decimal(6, 2), value: input.heightCm ?? null },
      { name: 'weight_kg', type: sql.Decimal(6, 2), value: input.weightKg ?? null },
      { name: 'pain_score', type: sql.TinyInt, value: input.painScore ?? null },
      { name: 'notes', type: sql.NVarChar(500), value: input.notes ?? null }, outId('vital_sign_public_id')], context(actor, requestId));
    return { publicId: String(result.output.vital_sign_public_id) };
  }
  async addDiagnosis(actor: ClinicPrincipal, encounterPublicId: string, input: DiagnosisInput, requestId: string) {
    const result = await executeCommand('dbo.sp_clinic_add_encounter_diagnosis', [actorParam(actor), encounterParam(encounterPublicId),
      { name: 'diagnosis_code', type: sql.VarChar(30), value: input.code },
      { name: 'diagnosis_name', type: sql.NVarChar(500), value: input.name },
      { name: 'diagnosis_type', type: sql.VarChar(20), value: input.type },
      { name: 'is_primary', type: sql.Bit, value: input.isPrimary },
      { name: 'notes', type: sql.NVarChar(1000), value: input.notes ?? null }, outId('diagnosis_public_id')], context(actor, requestId));
    return { publicId: String(result.output.diagnosis_public_id) };
  }
  async orderService(actor: ClinicPrincipal, encounterPublicId: string, input: OrderServiceInput, requestId: string) {
    const result = await executeCommand('dbo.sp_clinic_order_encounter_service', [actorParam(actor), encounterParam(encounterPublicId),
      { name: 'service_public_id', type: sql.UniqueIdentifier, value: input.servicePublicId },
      { name: 'quantity', type: sql.Decimal(12, 3), value: input.quantity },
      { name: 'notes', type: sql.NVarChar(1000), value: input.notes ?? null }, outId('encounter_service_public_id')], context(actor, requestId));
    return { publicId: String(result.output.encounter_service_public_id) };
  }
  async finalizeResult(actor: ClinicPrincipal, encounterServicePublicId: string, input: FinalizeResultInput, requestId: string) {
    const result = await executeCommand('dbo.sp_clinic_finalize_service_result', [actorParam(actor),
      { name: 'encounter_service_public_id', type: sql.UniqueIdentifier, value: encounterServicePublicId },
      { name: 'summary', type: sql.NVarChar(sql.MAX), value: input.summary ?? null },
      { name: 'conclusion', type: sql.NVarChar(sql.MAX), value: input.conclusion ?? null },
      { name: 'result_json', type: sql.NVarChar(sql.MAX), value: input.result == null ? null : JSON.stringify(input.result) },
      outId('service_result_public_id')], context(actor, requestId));
    return { publicId: String(result.output.service_result_public_id) };
  }
  async complete(actor: ClinicPrincipal, encounterPublicId: string, requestId: string) {
    await executeCommand('dbo.sp_clinic_complete_encounter', [actorParam(actor), encounterParam(encounterPublicId)], context(actor, requestId));
  }
  async sign(actor: ClinicPrincipal, encounterPublicId: string, requestId: string) {
    const result = await executeCommand('dbo.sp_clinic_sign_encounter', [actorParam(actor), encounterParam(encounterPublicId),
      { name: 'payload_sha256', type: sql.VarBinary(32), value: null, direction: 'output' }], context(actor, requestId));
    return { publicId: encounterPublicId, sha256: hex(result.output.payload_sha256) };
  }
  async amend(actor: ClinicPrincipal, encounterPublicId: string, input: AmendmentInput, requestId: string) {
    const result = await executeCommand('dbo.sp_clinic_add_encounter_amendment', [actorParam(actor), encounterParam(encounterPublicId),
      { name: 'reason', type: sql.NVarChar(1000), value: input.reason },
      { name: 'amendment_content', type: sql.NVarChar(sql.MAX), value: input.content }, outId('amendment_public_id'),
      { name: 'amendment_hash', type: sql.VarBinary(32), value: null, direction: 'output' }], context(actor, requestId));
    return { publicId: String(result.output.amendment_public_id), sha256: hex(result.output.amendment_hash) };
  }
}
