import type { IRecordSet } from 'mssql';
import { executeCommand, getSqlPool, sql } from '../../infrastructure/database/sql-database.js';
import type {
  BranchReference,
  PatientAccessLink,
  PatientAccessRepository,
  PatientLinkRequestStatus,
  PatientLinkRequestView,
  PatientRelationship,
  StaffPatientLinkRequest,
  StaffPatientLinkRequestQuery,
} from './patient-access.types.js';

type PatientLinkRow = {
  public_id: string;
  patient_public_id: string;
  patient_code: string;
  full_name: string;
  date_of_birth: Date | string;
  relationship_type: PatientRelationship;
  status: 'ACTIVE';
  is_booking_allowed: boolean;
  access_kind: 'OWN' | 'DELEGATED';
  linked_user_public_id: string;
  linked_user_display_name: string;
  verified_branch_public_id: string | null;
  verified_branch_name: string | null;
  verified_at_utc: Date | string | null;
  can_revoke: boolean;
  row_ver: Buffer;
};

type PatientRequestRow = {
  total_count?: number;
  public_id: string;
  branch_public_id: string;
  branch_code: string;
  branch_name: string;
  patient_reference_mask: string;
  relationship_type: PatientRelationship;
  request_note: string | null;
  status: PatientLinkRequestStatus;
  decision_reason: string | null;
  created_at_utc: Date | string;
  expires_at_utc: Date | string;
  decided_at_utc: Date | string | null;
  patient_public_id: string | null;
  patient_code: string | null;
  full_name?: string | null;
  patient_full_name?: string;
  date_of_birth?: Date | string;
  requester_public_id?: string;
  requester_display_name?: string;
  requester_email?: string | null;
  requester_phone?: string | null;
  row_ver: Buffer;
};

function iso(value: Date | string | null) {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function dateOnly(value: Date | string) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function rowVersion(value: Buffer) {
  return Buffer.from(value).toString('base64');
}

function mapLink(row: PatientLinkRow): PatientAccessLink {
  return {
    publicId: row.public_id,
    patient: {
      publicId: row.patient_public_id,
      code: row.patient_code,
      fullName: row.full_name,
      dateOfBirth: dateOnly(row.date_of_birth),
    },
    relationshipType: row.relationship_type,
    status: row.status,
    bookingAllowed: Boolean(row.is_booking_allowed),
    accessKind: row.access_kind,
    linkedUser: { publicId: row.linked_user_public_id, displayName: row.linked_user_display_name },
    verifiedBranch: row.verified_branch_public_id && row.verified_branch_name
      ? { publicId: row.verified_branch_public_id, name: row.verified_branch_name }
      : null,
    verifiedAtUtc: iso(row.verified_at_utc),
    canRevoke: Boolean(row.can_revoke),
    rowVersion: rowVersion(row.row_ver),
  };
}

function mapRequest(row: PatientRequestRow): PatientLinkRequestView {
  return {
    publicId: row.public_id,
    branch: { publicId: row.branch_public_id, code: row.branch_code, name: row.branch_name },
    patientReference: row.patient_reference_mask,
    relationshipType: row.relationship_type,
    requestNote: row.request_note,
    status: row.status,
    decisionReason: row.decision_reason,
    createdAtUtc: iso(row.created_at_utc)!,
    expiresAtUtc: iso(row.expires_at_utc)!,
    decidedAtUtc: iso(row.decided_at_utc),
    patient: row.patient_public_id && row.patient_code && row.full_name
      ? { publicId: row.patient_public_id, code: row.patient_code, fullName: row.full_name }
      : null,
    rowVersion: rowVersion(row.row_ver),
  };
}

function mapStaffRequest(row: PatientRequestRow): StaffPatientLinkRequest {
  const base = mapRequest({ ...row, full_name: row.patient_full_name });
  return {
    ...base,
    requester: {
      publicId: row.requester_public_id!,
      displayName: row.requester_display_name!,
      email: row.requester_email ?? null,
      phone: row.requester_phone ?? null,
    },
    patient: {
      publicId: row.patient_public_id!,
      code: row.patient_code!,
      fullName: row.patient_full_name!,
      dateOfBirth: dateOnly(row.date_of_birth!),
    },
  };
}

function mapBranch(row: { id: number; publicId: string; code: string; name: string }): BranchReference {
  return { ...row, id: Number(row.id) };
}

export class SqlPatientAccessRepository implements PatientAccessRepository {
  async resolveBranch(publicId: string) {
    const pool = await getSqlPool();
    const result = await pool.request().input('publicId', sql.UniqueIdentifier, publicId)
      .query<{ id: number; publicId: string; code: string; name: string }>(`
        SELECT branch_id AS id,CONVERT(varchar(36),public_id) AS publicId,
          branch_code AS code,branch_name AS name
        FROM dbo.branches WHERE public_id=@publicId AND is_active=1;`);
    return result.recordset[0] ? mapBranch(result.recordset[0]) : null;
  }

  async listPatientBranches() {
    const pool = await getSqlPool();
    const result = await pool.request().query<{ id: number; publicId: string; code: string; name: string }>(`
      SELECT branch_id AS id,CONVERT(varchar(36),public_id) AS publicId,
        branch_code AS code,branch_name AS name
      FROM dbo.branches WHERE is_active=1 ORDER BY branch_name;`);
    return result.recordset.map(mapBranch);
  }

  async listManagedBranches(actorUserId: number) {
    const pool = await getSqlPool();
    const result = await pool.request().input('actorUserId', sql.BigInt, actorUserId)
      .query<{ id: number; publicId: string; code: string; name: string }>(`
        SELECT DISTINCT b.branch_id AS id,CONVERT(varchar(36),b.public_id) AS publicId,
          b.branch_code AS code,b.branch_name AS name
        FROM dbo.branches b
        WHERE b.is_active=1 AND EXISTS(
          SELECT 1 FROM dbo.users u
          JOIN dbo.user_roles ur ON ur.user_id=u.user_id AND ur.is_active=1
            AND ur.valid_from_utc<=SYSUTCDATETIME()
            AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc>SYSUTCDATETIME())
          JOIN dbo.roles r ON r.role_id=ur.role_id AND r.is_active=1
          LEFT JOIN dbo.role_permissions rp ON rp.role_id=r.role_id
          LEFT JOIN dbo.permissions p ON p.permission_id=rp.permission_id
          WHERE u.user_id=@actorUserId AND u.status='ACTIVE' AND u.deleted_at_utc IS NULL
            AND (u.locked_until_utc IS NULL OR u.locked_until_utc<=SYSUTCDATETIME())
            AND (ur.branch_id IS NULL OR ur.branch_id=b.branch_id)
            AND (r.role_code='ADMIN' OR p.permission_code='PATIENT_PORTAL_LINK_MANAGE')
        ) ORDER BY name;`);
    return result.recordset.map(mapBranch);
  }

  async hasPermission(actorUserId: number, permission: string, branchId: number | null) {
    const pool = await getSqlPool();
    const request = pool.request();
    request.input('actorUserId', sql.BigInt, actorUserId);
    request.input('permission', sql.VarChar(80), permission);
    request.input('branchId', sql.BigInt, branchId);
    const result = await request.query<{ allowed: boolean }>(`
      SELECT CONVERT(bit,IIF(EXISTS(
        SELECT 1 FROM dbo.users u
        JOIN dbo.user_roles ur ON ur.user_id=u.user_id AND ur.is_active=1
          AND ur.valid_from_utc<=SYSUTCDATETIME()
          AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc>SYSUTCDATETIME())
        JOIN dbo.roles r ON r.role_id=ur.role_id AND r.is_active=1
        LEFT JOIN dbo.role_permissions rp ON rp.role_id=r.role_id
        LEFT JOIN dbo.permissions p ON p.permission_id=rp.permission_id
        WHERE u.user_id=@actorUserId AND u.status='ACTIVE' AND u.deleted_at_utc IS NULL
          AND (u.locked_until_utc IS NULL OR u.locked_until_utc<=SYSUTCDATETIME())
          AND (ur.branch_id IS NULL OR ur.branch_id=@branchId)
          AND (r.role_code='ADMIN' OR p.permission_code=@permission)
      ),1,0)) AS allowed;`);
    return Boolean(result.recordset[0]?.allowed);
  }

  async requestLink(input: Parameters<PatientAccessRepository['requestLink']>[0], requestId: string) {
    const result = await executeCommand('dbo.sp_auth_request_patient_link', [
      { name: 'actor_user_id', type: sql.BigInt, value: input.actorUserId },
      { name: 'branch_id', type: sql.BigInt, value: input.branchId },
      { name: 'patient_code', type: sql.VarChar(30), value: input.patientCode },
      { name: 'date_of_birth', type: sql.Date, value: new Date(`${input.dateOfBirth}T00:00:00.000Z`) },
      { name: 'relationship_type', type: sql.VarChar(20), value: input.relationshipType },
      { name: 'request_note', type: sql.NVarChar(500), value: input.requestNote },
      { name: 'idempotency_key', type: sql.UniqueIdentifier, value: input.idempotencyKey },
      { name: 'request_hash', type: sql.VarBinary(32), value: input.requestHash },
      { name: 'expires_at_utc', type: sql.DateTime2(3), value: input.expiresAtUtc },
      { name: 'max_requests_per_day', type: sql.SmallInt, value: input.maxRequestsPerDay },
      { name: 'request_public_id', type: sql.UniqueIdentifier, value: null, direction: 'output' },
      { name: 'created', type: sql.Bit, value: null, direction: 'output' },
    ], { requestId, actorUserId: input.actorUserId, branchId: input.branchId });
    return {
      requestPublicId: String(result.output.request_public_id),
      created: Boolean(result.output.created),
    };
  }

  async getPatientAccess(actorUserId: number, requestId: string) {
    const result = await executeCommand<PatientLinkRow>('dbo.sp_auth_get_patient_access', [
      { name: 'actor_user_id', type: sql.BigInt, value: actorUserId },
    ], { requestId, actorUserId });
    const recordsets = result.recordsets as IRecordSet<unknown>[];
    return {
      links: (recordsets[0] as IRecordSet<PatientLinkRow>).map(mapLink),
      requests: (recordsets[1] as IRecordSet<PatientRequestRow>).map(mapRequest),
    };
  }

  cancelRequest(actorUserId: number, requestPublicId: string, requestId: string) {
    return executeCommand('dbo.sp_auth_cancel_patient_link_request', [
      { name: 'actor_user_id', type: sql.BigInt, value: actorUserId },
      { name: 'request_public_id', type: sql.UniqueIdentifier, value: requestPublicId },
    ], { requestId, actorUserId }).then(() => undefined);
  }

  async listRequests(actorUserId: number, branchId: number, query: StaffPatientLinkRequestQuery, requestId: string) {
    const result = await executeCommand<PatientRequestRow>('dbo.sp_auth_list_patient_link_requests', [
      { name: 'actor_user_id', type: sql.BigInt, value: actorUserId },
      { name: 'branch_id', type: sql.BigInt, value: branchId },
      { name: 'status', type: sql.VarChar(20), value: query.status ?? null },
      { name: 'offset', type: sql.Int, value: (query.page - 1) * query.pageSize },
      { name: 'page_size', type: sql.Int, value: query.pageSize },
    ], { requestId, actorUserId, branchId });
    return {
      items: result.recordset.map(mapStaffRequest),
      total: Number(result.recordset[0]?.total_count ?? 0),
    };
  }

  async decideRequest(actorUserId: number, requestPublicId: string, decision: 'APPROVED' | 'REJECTED', reason: string,
    expectedRowVersion: string, requestId: string) {
    const result = await executeCommand('dbo.sp_auth_decide_patient_link_request', [
      { name: 'actor_user_id', type: sql.BigInt, value: actorUserId },
      { name: 'request_public_id', type: sql.UniqueIdentifier, value: requestPublicId },
      { name: 'decision', type: sql.VarChar(10), value: decision },
      { name: 'reason', type: sql.NVarChar(500), value: reason },
      { name: 'expected_row_ver', type: sql.VarBinary(8), value: Buffer.from(expectedRowVersion, 'base64') },
      { name: 'link_public_id', type: sql.UniqueIdentifier, value: null, direction: 'output' },
    ], { requestId, actorUserId });
    return result.output.link_public_id ? String(result.output.link_public_id) : null;
  }

  revokeLink(actorUserId: number, linkPublicId: string, reason: string, requestId: string) {
    return executeCommand('dbo.sp_auth_revoke_patient_link', [
      { name: 'actor_user_id', type: sql.BigInt, value: actorUserId },
      { name: 'link_public_id', type: sql.UniqueIdentifier, value: linkPublicId },
      { name: 'reason', type: sql.NVarChar(500), value: reason },
    ], { requestId, actorUserId }).then(() => undefined);
  }
}
