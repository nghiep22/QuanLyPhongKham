import { executeCommand, getSqlPool, sql } from '../../infrastructure/database/sql-database.js';
import type { ClinicPrincipal } from '../identity/index.js';
import type { Branch, ClinicalSummary, CreatePatientInput, PatientInput, PatientRepository, PatientSummary } from './patient.types.js';

type PatientRow = Record<string, unknown>;
function dateOnly(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
function summary(row: PatientRow): PatientSummary {
  return {
    publicId: String(row.publicId), code: String(row.code), fullName: String(row.fullName),
    dateOfBirth: dateOnly(row.dateOfBirth), gender: row.gender as PatientSummary['gender'],
    phone: row.phone == null ? null : String(row.phone), status: String(row.status),
    nationalIdLast4: row.nationalIdLast4 == null ? null : String(row.nationalIdLast4),
    rowVersion: Buffer.from(row.rowVersion as Uint8Array).toString('base64'),
  };
}
function patientInputs(input: PatientInput) {
  return [
    { name: 'full_name', type: sql.NVarChar(200), value: input.fullName },
    { name: 'date_of_birth', type: sql.Date, value: input.dateOfBirth },
    { name: 'gender', type: sql.VarChar(10), value: input.gender },
    { name: 'national_id', type: sql.VarChar(30), value: input.nationalId ?? null },
    { name: 'health_insurance_no', type: sql.VarChar(30), value: input.healthInsuranceNo ?? null },
    { name: 'phone', type: sql.VarChar(20), value: input.phone ?? null },
    { name: 'email', type: sql.VarChar(254), value: input.email ?? null },
    { name: 'address_line', type: sql.NVarChar(300), value: input.addressLine ?? null },
    { name: 'province', type: sql.NVarChar(100), value: input.province ?? null },
  ];
}

export class SqlPatientRepository implements PatientRepository {
  async branches(actorUserId: number) {
    const result = await (await getSqlPool()).request()
      .input('actor_user_id', sql.BigInt, actorUserId)
      .execute<{ publicId: string; name: string }>('dbo.sp_clinic_patient_branches');
    const branches: Branch[] = [];
    for (const row of result.recordset) {
      const branch = await this.resolveBranch(row.publicId);
      if (branch) branches.push(branch);
    }
    return branches;
  }

  async resolveBranch(publicId: string) {
    const result = await (await getSqlPool()).request().input('publicId', sql.UniqueIdentifier, publicId)
      .query<{ id: number; publicId: string; name: string }>(`
        SELECT branch_id AS id,CONVERT(varchar(36),public_id) AS publicId,branch_name AS name
        FROM dbo.v_catalog_branches_v1 WHERE public_id=@publicId AND is_active=1;`);
    const row = result.recordset[0];
    return row ? { ...row, id: Number(row.id) } : null;
  }

  async search(actorUserId: number, branchId: number, requestId: string, query?: string, dateOfBirth?: string) {
    const result = await executeCommand<PatientRow>('dbo.sp_clinic_search_patients', [
      { name: 'actor_user_id', type: sql.BigInt, value: actorUserId },
      { name: 'branch_id', type: sql.BigInt, value: branchId },
      { name: 'query', type: sql.NVarChar(100), value: query ?? null },
      { name: 'date_of_birth', type: sql.Date, value: dateOfBirth ?? null },
    ], { requestId, actorUserId, branchId });
    return result.recordset.map(summary);
  }

  async duplicates(actorUserId: number, branchId: number, requestId: string, input: PatientInput) {
    const result = await executeCommand<PatientRow>('dbo.sp_clinic_find_patient_duplicates', [
      { name: 'actor_user_id', type: sql.BigInt, value: actorUserId },
      { name: 'branch_id', type: sql.BigInt, value: branchId },
      { name: 'full_name', type: sql.NVarChar(200), value: input.fullName },
      { name: 'date_of_birth', type: sql.Date, value: input.dateOfBirth },
      { name: 'phone', type: sql.VarChar(20), value: input.phone ?? null },
      { name: 'national_id', type: sql.VarChar(30), value: input.nationalId ?? null },
    ], { requestId, actorUserId, branchId });
    return result.recordset.map(summary);
  }

  async get(actorUserId: number, branchId: number, publicId: string, requestId: string) {
    const result = await executeCommand<PatientRow>('dbo.sp_clinic_get_patient', [
      { name: 'actor_user_id', type: sql.BigInt, value: actorUserId },
      { name: 'branch_id', type: sql.BigInt, value: branchId },
      { name: 'patient_public_id', type: sql.UniqueIdentifier, value: publicId },
    ], { requestId, actorUserId, branchId });
    const row = result.recordset[0];
    if (!row) return null;
    return {
      ...summary(row), branch: { publicId: String(row.branchPublicId), name: String(row.branchName) },
      nationalId: row.nationalId == null ? null : String(row.nationalId),
      healthInsuranceNo: row.healthInsuranceNo == null ? null : String(row.healthInsuranceNo),
      email: row.email == null ? null : String(row.email),
      addressLine: row.addressLine == null ? null : String(row.addressLine),
      province: row.province == null ? null : String(row.province),
    };
  }

  async create(actor: ClinicPrincipal, branchId: number, input: CreatePatientInput, requestId: string) {
    const result = await executeCommand('dbo.sp_create_patient', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'branch_id', type: sql.BigInt, value: branchId },
      ...patientInputs(input),
      { name: 'duplicate_override', type: sql.Bit, value: input.duplicateOverride ?? false },
      { name: 'duplicate_reason', type: sql.NVarChar(500), value: input.duplicateReason ?? null },
      { name: 'patient_id', type: sql.BigInt, value: null, direction: 'output' },
      { name: 'patient_public_id', type: sql.UniqueIdentifier, value: null, direction: 'output' },
    ], { requestId, actorUserId: actor.userId, branchId });
    return String(result.output.patient_public_id);
  }

  async update(actor: ClinicPrincipal, branchId: number, publicId: string, input: PatientInput,
    expectedVersion: string, requestId: string) {
    await executeCommand('dbo.sp_update_patient', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'branch_id', type: sql.BigInt, value: branchId },
      { name: 'patient_public_id', type: sql.UniqueIdentifier, value: publicId },
      ...patientInputs(input),
      { name: 'expected_row_ver', type: sql.VarBinary(8), value: Buffer.from(expectedVersion, 'base64') },
    ], { requestId, actorUserId: actor.userId, branchId });
  }

  async clinicalSummary(actor: ClinicPrincipal, branchId: number, publicId: string, requestId: string) {
    const result = await executeCommand<PatientRow>('dbo.sp_clinic_get_patient_clinical_summary', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'branch_id', type: sql.BigInt, value: branchId },
      { name: 'patient_public_id', type: sql.UniqueIdentifier, value: publicId },
    ], { requestId, actorUserId: actor.userId, branchId });
    const [patientRows, allergyRows, conditionRows] = result.recordsets as unknown as PatientRow[][];
    const patient = patientRows?.[0];
    if (!patient) throw new Error('Patient clinical summary returned no patient.');
    return {
      patient: { publicId: String(patient.publicId), code: String(patient.code),
        fullName: String(patient.fullName), dateOfBirth: dateOnly(patient.dateOfBirth),
        gender: patient.gender as ClinicalSummary['patient']['gender'] },
      allergies: (allergyRows ?? []).map((row) => ({ allergenName: String(row.allergenName),
        type: String(row.type), severity: String(row.severity),
        reaction: row.reaction == null ? null : String(row.reaction),
        notedAt: row.notedAt == null ? null : dateOnly(row.notedAt) })),
      conditions: (conditionRows ?? []).map((row) => ({ code: row.code == null ? null : String(row.code),
        name: String(row.name), diagnosedDate: row.diagnosedDate == null ? null : dateOnly(row.diagnosedDate),
        status: String(row.status), notes: row.notes == null ? null : String(row.notes) })),
    };
  }
}
