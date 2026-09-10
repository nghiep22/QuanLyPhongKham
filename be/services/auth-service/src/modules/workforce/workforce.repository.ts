import type { IRecordSet } from 'mssql';
import { executeCommand, getSqlPool, sql } from '../../infrastructure/database/sql-database.js';
import type {
  AccountStatus,
  BranchReference,
  CreateStaffInput,
  DoctorProfile,
  EmployeeType,
  EmploymentStatus,
  RoleAssignmentView,
  StaffListQuery,
  StaffReferences,
  StaffView,
  UpdateStaffInput,
  StaffVersion,
  WorkforceRepository,
} from './workforce.types.js';

type StaffRow = {
  publicId: string; userPublicId: string; userId: number; username: string;
  email: string | null; phone: string | null; accountStatus: AccountStatus;
  lockedUntilUtc: Date | null; employeeCode: string; employeeType: EmployeeType;
  fullName: string; dateOfBirth: Date | null; gender: StaffView['gender'];
  addressLine: string | null; hireDate: Date; employmentStatus: EmploymentStatus;
  branchId: number; branchPublicId: string; branchCode: string; branchName: string;
  doctorPublicId: string | null; medicalLicenseNo: string | null;
  licenseIssuedDate: Date | null; licenseExpiryDate: Date | null;
  academicTitle: string | null; biography: string | null;
  defaultSlotMinutes: number | null; acceptsOnlineBooking: boolean | null;
  employeeRowVersion: string; doctorRowVersion: string | null;
  rolesJson: string; totalCount: number;
};

const baseStaffSelect = `
  SELECT CONVERT(varchar(36),e.public_id) AS publicId,
    CONVERT(varchar(36),u.public_id) AS userPublicId,u.user_id AS userId,
    u.username,u.email,u.phone,u.status AS accountStatus,u.locked_until_utc AS lockedUntilUtc,
    e.employee_code AS employeeCode,e.employee_type AS employeeType,e.full_name AS fullName,
    e.date_of_birth AS dateOfBirth,e.gender,e.address_line AS addressLine,e.hire_date AS hireDate,
    e.employment_status AS employmentStatus,e.primary_branch_id AS branchId,
    CONVERT(varchar(36),b.public_id) AS branchPublicId,b.branch_code AS branchCode,
    b.branch_name AS branchName,CONVERT(varchar(36),d.public_id) AS doctorPublicId,
    d.medical_license_no AS medicalLicenseNo,d.license_issued_date AS licenseIssuedDate,
    d.license_expiry_date AS licenseExpiryDate,d.academic_title AS academicTitle,
    d.biography,d.default_slot_minutes AS defaultSlotMinutes,
    d.accepts_online_booking AS acceptsOnlineBooking,
    CONVERT(varchar(16),e.row_ver,2) AS employeeRowVersion,
    CONVERT(varchar(16),d.row_ver,2) AS doctorRowVersion,
    COALESCE((
      SELECT CONVERT(varchar(36),ur.public_id) AS publicId,r.role_code AS code,
        r.role_name AS name,CONVERT(varchar(36),rb.public_id) AS [branch.publicId],
        rb.branch_code AS [branch.code],rb.branch_name AS [branch.name],
        ur.valid_from_utc AS validFromUtc,ur.valid_to_utc AS validToUtc
      FROM dbo.user_roles ur JOIN dbo.roles r ON r.role_id=ur.role_id
      LEFT JOIN dbo.branches rb ON rb.branch_id=ur.branch_id
      WHERE ur.user_id=u.user_id AND ur.is_active=1
        AND ur.valid_from_utc<=SYSUTCDATETIME()
        AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc>SYSUTCDATETIME())
      ORDER BY r.role_code FOR JSON PATH
    ),'[]') AS rolesJson,COUNT_BIG(*) OVER() AS totalCount
  FROM dbo.employees e JOIN dbo.users u ON u.user_id=e.user_id
  JOIN dbo.branches b ON b.branch_id=e.primary_branch_id
  LEFT JOIN dbo.doctors d ON d.employee_id=e.employee_id
`;

function dateOnly(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function rowVersion(value: string) {
  return Buffer.from(value, 'hex').toString('base64');
}

function mapStaff(row: StaffRow): StaffView & { userId: number; branchId: number } {
  const roles = JSON.parse(row.rolesJson) as Array<{
    publicId: string; code: string; name: string;
    branch?: { publicId: string; code: string; name: string };
    validFromUtc: string; validToUtc?: string;
  }>;
  const doctor: DoctorProfile | null = row.doctorPublicId ? {
    publicId: row.doctorPublicId,
    medicalLicenseNo: row.medicalLicenseNo!,
    licenseIssuedDate: dateOnly(row.licenseIssuedDate),
    licenseExpiryDate: dateOnly(row.licenseExpiryDate),
    academicTitle: row.academicTitle,
    biography: row.biography,
    defaultSlotMinutes: row.defaultSlotMinutes!,
    acceptsOnlineBooking: Boolean(row.acceptsOnlineBooking),
    rowVersion: rowVersion(row.doctorRowVersion!),
  } : null;
  return {
    publicId: row.publicId,
    userPublicId: row.userPublicId,
    userId: Number(row.userId),
    username: row.username,
    email: row.email,
    phone: row.phone,
    accountStatus: row.accountStatus,
    lockedUntilUtc: row.lockedUntilUtc?.toISOString() ?? null,
    employeeCode: row.employeeCode,
    employeeType: row.employeeType,
    fullName: row.fullName,
    dateOfBirth: dateOnly(row.dateOfBirth),
    gender: row.gender,
    addressLine: row.addressLine,
    hireDate: dateOnly(row.hireDate)!,
    employmentStatus: row.employmentStatus,
    branchId: Number(row.branchId),
    branch: { publicId: row.branchPublicId, code: row.branchCode, name: row.branchName },
    doctor,
    roles: roles.map((role): RoleAssignmentView => ({
      publicId: role.publicId,
      code: role.code,
      name: role.name,
      branch: role.branch ?? null,
      validFromUtc: new Date(role.validFromUtc).toISOString(),
      validToUtc: role.validToUtc ? new Date(role.validToUtc).toISOString() : null,
    })),
    rowVersion: rowVersion(row.employeeRowVersion),
  };
}

function asDate(value?: string) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

export class SqlWorkforceRepository implements WorkforceRepository {
  async resolveBranch(publicId: string) {
    const pool = await getSqlPool();
    const request = pool.request();
    request.input('publicId', sql.UniqueIdentifier, publicId);
    const result = await request.query<{ id: number; publicId: string; code: string; name: string }>(`
      SELECT branch_id AS id,CONVERT(varchar(36),public_id) AS publicId,
        branch_code AS code,branch_name AS name
      FROM dbo.branches WHERE public_id=@publicId AND is_active=1;`);
    const row = result.recordset[0];
    return row ? { ...row, id: Number(row.id) } : null;
  }

  async resolveSpecialty(publicId: string) {
    const pool = await getSqlPool();
    const request = pool.request();
    request.input('publicId', sql.UniqueIdentifier, publicId);
    const result = await request.query<{ id: number }>(
      'SELECT specialty_id AS id FROM dbo.specialties WHERE public_id=@publicId AND is_active=1;',
    );
    return result.recordset[0] ? { id: Number(result.recordset[0].id) } : null;
  }

  async hasPermission(actorUserId: number, permission: string, branchId: number | null) {
    const pool = await getSqlPool();
    const request = pool.request();
    request.input('actorUserId', sql.BigInt, actorUserId);
    request.input('permission', sql.VarChar(80), permission);
    request.input('branchId', sql.BigInt, branchId);
    const result = await request.query<{ allowed: boolean }>(`
      SELECT CONVERT(bit,IIF(EXISTS(
        SELECT 1 FROM dbo.user_roles ur JOIN dbo.roles r ON r.role_id=ur.role_id AND r.is_active=1
        LEFT JOIN dbo.role_permissions rp ON rp.role_id=r.role_id
        LEFT JOIN dbo.permissions p ON p.permission_id=rp.permission_id
        JOIN dbo.users u ON u.user_id=ur.user_id
        WHERE ur.user_id=@actorUserId AND u.status='ACTIVE' AND u.deleted_at_utc IS NULL
          AND (u.locked_until_utc IS NULL OR u.locked_until_utc<=SYSUTCDATETIME())
          AND ur.is_active=1 AND ur.valid_from_utc<=SYSUTCDATETIME()
          AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc>SYSUTCDATETIME())
          AND (ur.branch_id IS NULL OR ur.branch_id=@branchId)
          AND (r.role_code='ADMIN' OR p.permission_code=@permission)
      ),1,0)) AS allowed;`);
    return Boolean(result.recordset[0]?.allowed);
  }

  async getReferences(actorUserId: number): Promise<StaffReferences> {
    const pool = await getSqlPool();
    const request = pool.request();
    request.input('actorUserId', sql.BigInt, actorUserId);
    const result = await request.query(`
      SELECT DISTINCT CONVERT(varchar(36),b.public_id) AS publicId,b.branch_code AS code,b.branch_name AS name
      FROM dbo.branches b
      WHERE b.is_active=1 AND EXISTS(
        SELECT 1 FROM dbo.user_roles ur JOIN dbo.roles r ON r.role_id=ur.role_id AND r.is_active=1
        LEFT JOIN dbo.role_permissions rp ON rp.role_id=r.role_id
        LEFT JOIN dbo.permissions p ON p.permission_id=rp.permission_id
        WHERE ur.user_id=@actorUserId AND ur.is_active=1
          AND ur.valid_from_utc<=SYSUTCDATETIME()
          AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc>SYSUTCDATETIME())
          AND (ur.branch_id IS NULL OR ur.branch_id=b.branch_id)
          AND (r.role_code='ADMIN' OR p.permission_code='USERS_MANAGE')
      ) ORDER BY name;
      SELECT role_code AS code,role_name AS name,
        CONVERT(varchar(10),IIF(role_code='ADMIN','GLOBAL','BRANCH')) AS scope
      FROM dbo.roles WHERE is_active=1 AND role_code<>'PATIENT' ORDER BY role_name;
      SELECT CONVERT(varchar(36),public_id) AS publicId,specialty_code AS code,
        specialty_name AS name FROM dbo.specialties WHERE is_active=1 ORDER BY specialty_name;
    `);
    const recordsets = result.recordsets as IRecordSet<unknown>[];
    return {
      branches: recordsets[0] as IRecordSet<BranchReference>,
      roles: recordsets[1] as StaffReferences['roles'],
      specialties: recordsets[2] as IRecordSet<StaffReferences['specialties'][number]>,
    };
  }

  async list(query: StaffListQuery, branchId: number | null) {
    const pool = await getSqlPool();
    const request = pool.request();
    request.input('branchId', sql.BigInt, branchId);
    request.input('query', sql.NVarChar(100), query.query ?? null);
    request.input('employeeType', sql.VarChar(30), query.employeeType ?? null);
    request.input('accountStatus', sql.VarChar(20), query.accountStatus ?? null);
    request.input('offset', sql.Int, (query.page - 1) * query.pageSize);
    request.input('pageSize', sql.Int, query.pageSize);
    const result = await request.query<StaffRow>(`
      ${baseStaffSelect}
      WHERE (@branchId IS NULL OR e.primary_branch_id=@branchId)
        AND (@employeeType IS NULL OR e.employee_type=@employeeType)
        AND (@accountStatus IS NULL OR u.status=@accountStatus)
        AND (@query IS NULL OR e.full_name LIKE N'%'+@query+N'%'
             OR e.employee_code LIKE '%'+CONVERT(varchar(100),@query)+'%'
             OR u.username LIKE N'%'+@query+N'%')
      ORDER BY e.full_name,e.employee_id
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;`);
    return {
      items: result.recordset.map(mapStaff),
      total: Number(result.recordset[0]?.totalCount ?? 0),
    };
  }

  private async getWhere(column: 'e.public_id' | 'u.public_id', publicId: string) {
    const pool = await getSqlPool();
    const request = pool.request();
    request.input('publicId', sql.UniqueIdentifier, publicId);
    const result = await request.query<StaffRow>(`${baseStaffSelect}
      WHERE ${column}=@publicId;`);
    return result.recordset[0] ? mapStaff(result.recordset[0]) : null;
  }

  getStaff(publicId: string) { return this.getWhere('e.public_id', publicId); }
  getStaffByUser(publicId: string) { return this.getWhere('u.public_id', publicId); }

  async create(actorUserId: number, branchId: number, specialtyId: number | null, input: CreateStaffInput, passwordHash: string, requestId: string) {
    const result = await executeCommand<never>('dbo.sp_create_staff_account', [
      { name: 'actor_user_id', type: sql.BigInt, value: actorUserId },
      { name: 'branch_id', type: sql.BigInt, value: branchId },
      { name: 'username', type: sql.NVarChar(80), value: input.username },
      { name: 'email', type: sql.VarChar(254), value: input.email ?? null },
      { name: 'phone', type: sql.VarChar(20), value: input.phone ?? null },
      { name: 'password_hash', type: sql.VarChar(255), value: passwordHash },
      { name: 'employee_code', type: sql.VarChar(30), value: input.employeeCode },
      { name: 'employee_type', type: sql.VarChar(30), value: input.employeeType },
      { name: 'full_name', type: sql.NVarChar(200), value: input.fullName },
      { name: 'date_of_birth', type: sql.Date, value: asDate(input.dateOfBirth) },
      { name: 'gender', type: sql.VarChar(10), value: input.gender ?? null },
      { name: 'address_line', type: sql.NVarChar(300), value: input.addressLine ?? null },
      { name: 'hire_date', type: sql.Date, value: asDate(input.hireDate) },
      { name: 'medical_license_no', type: sql.NVarChar(100), value: input.medicalLicenseNo ?? null },
      { name: 'license_issued_date', type: sql.Date, value: asDate(input.licenseIssuedDate) },
      { name: 'license_expiry_date', type: sql.Date, value: asDate(input.licenseExpiryDate) },
      { name: 'academic_title', type: sql.NVarChar(100), value: input.academicTitle ?? null },
      { name: 'biography', type: sql.NVarChar(sql.MAX), value: input.biography ?? null },
      { name: 'default_slot_minutes', type: sql.SmallInt, value: input.defaultSlotMinutes ?? 30 },
      { name: 'accepts_online_booking', type: sql.Bit, value: input.acceptsOnlineBooking ?? true },
      { name: 'specialty_id', type: sql.BigInt, value: specialtyId },
      { name: 'user_id', type: sql.BigInt, value: null, direction: 'output' },
      { name: 'employee_id', type: sql.BigInt, value: null, direction: 'output' },
      { name: 'doctor_id', type: sql.BigInt, value: null, direction: 'output' },
    ], { requestId, actorUserId, branchId });
    const employeeId = Number(result.output.employee_id);
    const pool = await getSqlPool();
    const lookup = await pool.request().input('employeeId', sql.BigInt, employeeId)
      .query<{ publicId: string }>('SELECT CONVERT(varchar(36),public_id) AS publicId FROM dbo.employees WHERE employee_id=@employeeId;');
    return lookup.recordset[0]!.publicId;
  }

  async update(actorUserId: number, targetUserId: number, input: UpdateStaffInput & StaffVersion, requestId: string) {
    await executeCommand('dbo.sp_update_staff_account', [
      { name: 'actor_user_id', type: sql.BigInt, value: actorUserId },
      { name: 'target_user_id', type: sql.BigInt, value: targetUserId },
      { name: 'email', type: sql.VarChar(254), value: input.email ?? null },
      { name: 'phone', type: sql.VarChar(20), value: input.phone ?? null },
      { name: 'full_name', type: sql.NVarChar(200), value: input.fullName },
      { name: 'date_of_birth', type: sql.Date, value: asDate(input.dateOfBirth) },
      { name: 'gender', type: sql.VarChar(10), value: input.gender ?? null },
      { name: 'address_line', type: sql.NVarChar(300), value: input.addressLine ?? null },
      { name: 'hire_date', type: sql.Date, value: asDate(input.hireDate) },
      { name: 'employment_status', type: sql.VarChar(20), value: input.employmentStatus },
      { name: 'termination_date', type: sql.Date, value: asDate(input.terminationDate) },
      { name: 'medical_license_no', type: sql.NVarChar(100), value: input.medicalLicenseNo ?? null },
      { name: 'license_issued_date', type: sql.Date, value: asDate(input.licenseIssuedDate) },
      { name: 'license_expiry_date', type: sql.Date, value: asDate(input.licenseExpiryDate) },
      { name: 'academic_title', type: sql.NVarChar(100), value: input.academicTitle ?? null },
      { name: 'biography', type: sql.NVarChar(sql.MAX), value: input.biography ?? null },
      { name: 'default_slot_minutes', type: sql.SmallInt, value: input.defaultSlotMinutes ?? null },
      { name: 'accepts_online_booking', type: sql.Bit, value: input.acceptsOnlineBooking ?? null },
      { name: 'expected_employee_row_ver', type: sql.VarBinary(8), value: Buffer.from(input.employeeRowVersion, 'base64') },
      { name: 'expected_doctor_row_ver', type: sql.VarBinary(8), value: input.doctorRowVersion ? Buffer.from(input.doctorRowVersion, 'base64') : null },
    ], { requestId, actorUserId });
  }

  setAccountStatus(actorUserId: number, targetUserId: number, status: 'ACTIVE' | 'DISABLED', reason: string, requestId: string) {
    return executeCommand('dbo.sp_set_staff_account_status', [
      { name: 'actor_user_id', type: sql.BigInt, value: actorUserId },
      { name: 'target_user_id', type: sql.BigInt, value: targetUserId },
      { name: 'status', type: sql.VarChar(20), value: status },
      { name: 'reason', type: sql.NVarChar(500), value: reason },
    ], { requestId, actorUserId }).then(() => undefined);
  }

  unlock(actorUserId: number, targetUserId: number, reason: string, requestId: string) {
    return executeCommand('dbo.sp_unlock_staff_account', [
      { name: 'actor_user_id', type: sql.BigInt, value: actorUserId },
      { name: 'target_user_id', type: sql.BigInt, value: targetUserId },
      { name: 'reason', type: sql.NVarChar(500), value: reason },
    ], { requestId, actorUserId }).then(() => undefined);
  }

  grantRole(actorUserId: number, targetUserId: number, roleCode: string, branchId: number | null, validToUtc: Date | null, requestId: string) {
    return executeCommand('dbo.sp_grant_user_role', [
      { name: 'actor_user_id', type: sql.BigInt, value: actorUserId },
      { name: 'target_user_id', type: sql.BigInt, value: targetUserId },
      { name: 'role_code', type: sql.VarChar(50), value: roleCode },
      { name: 'branch_id', type: sql.BigInt, value: branchId },
      { name: 'valid_to_utc', type: sql.DateTime2(3), value: validToUtc },
    ], { requestId, actorUserId, branchId: branchId ?? undefined }).then(() => undefined);
  }

  async resolveAssignment(assignmentPublicId: string, targetUserId: number) {
    const pool = await getSqlPool();
    const request = pool.request();
    request.input('publicId', sql.UniqueIdentifier, assignmentPublicId);
    request.input('targetUserId', sql.BigInt, targetUserId);
    const result = await request.query<{ id: number; branchId: number | null }>(`
      SELECT user_role_id AS id,branch_id AS branchId FROM dbo.user_roles
      WHERE public_id=@publicId AND user_id=@targetUserId AND is_active=1;`);
    const row = result.recordset[0];
    return row ? { id: Number(row.id), branchId: row.branchId === null ? null : Number(row.branchId) } : null;
  }

  revokeRole(actorUserId: number, assignmentId: number, reason: string, requestId: string) {
    return executeCommand('dbo.sp_revoke_user_role', [
      { name: 'actor_user_id', type: sql.BigInt, value: actorUserId },
      { name: 'user_role_id', type: sql.BigInt, value: assignmentId },
      { name: 'reason', type: sql.NVarChar(500), value: reason },
    ], { requestId, actorUserId }).then(() => undefined);
  }
}
