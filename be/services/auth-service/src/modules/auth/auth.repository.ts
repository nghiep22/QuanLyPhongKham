import type { IRecordSet } from 'mssql';
import { env } from '../../config.js';
import { executeCommand, getSqlPool, sql } from '../../infrastructure/database/sql-database.js';
import type {
  AuthPrincipal,
  AuthRepository,
  CredentialUser,
  PatientRegistrationChallengeResult,
  PatientRegistrationInput,
  PatientRegistrationVerificationResult,
  PasswordResetCredential,
  RotateSessionResult,
  RoleAssignment,
  SessionMetadata,
} from './auth.types.js';

type UserRow = {
  userId: number;
  publicId: string;
  passwordHash: string;
  displayName: string;
  status: CredentialUser['status'];
  failedLoginCount: number;
  lockedUntilUtc: Date | null;
  tokenVersion: number;
  email: string | null;
  phone: string | null;
};

type RoleRow = {
  roleCode: string;
  branchId: number | null;
  permissionCode: string | null;
};

function mapPrincipal(user: UserRow, roleRows: IRecordSet<RoleRow>): AuthPrincipal {
  const roleKeys = new Set<string>();
  const roles: RoleAssignment[] = [];
  const permissions = new Set<string>();
  for (const row of roleRows) {
    const branchId = row.branchId === null ? null : String(row.branchId);
    const key = `${row.roleCode}:${branchId ?? 'global'}`;
    if (!roleKeys.has(key)) {
      roleKeys.add(key);
      roles.push({ code: row.roleCode, branchId });
    }
    if (row.permissionCode) permissions.add(row.permissionCode);
  }
  return {
    userId: Number(user.userId),
    publicId: user.publicId,
    displayName: user.displayName,
    tokenVersion: user.tokenVersion,
    roles,
    permissions: [...permissions].sort(),
  };
}

async function loadRoles(userId: number) {
  const pool = await getSqlPool();
  const request = pool.request();
  request.input('userId', sql.BigInt, userId);
  const result = await request.query<RoleRow>(`
    SELECT r.role_code AS roleCode, ur.branch_id AS branchId, p.permission_code AS permissionCode
    FROM dbo.user_roles ur
    JOIN dbo.roles r ON r.role_id=ur.role_id AND r.is_active=1
    LEFT JOIN dbo.role_permissions rp ON rp.role_id=r.role_id
    LEFT JOIN dbo.permissions p ON p.permission_id=rp.permission_id
    WHERE ur.user_id=@userId AND ur.is_active=1
      AND ur.valid_from_utc<=SYSUTCDATETIME()
      AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc>SYSUTCDATETIME());
  `);
  return result.recordset;
}

export class SqlAuthRepository implements AuthRepository {
  async findCredential(identifier: string): Promise<CredentialUser | null> {
    const pool = await getSqlPool();
    const request = pool.request();
    const normalized = identifier.trim().toLowerCase();
    const normalizedPhone = normalized.replace(/[ .-]/g, '');
    request.input('identifier', sql.NVarChar(254), normalized);
    request.input('phone', sql.VarChar(20), normalizedPhone);
    const result = await request.query<UserRow>(`
      SELECT TOP (1) user_id AS userId,CONVERT(varchar(36),public_id) AS publicId,
        password_hash AS passwordHash,display_name AS displayName,email,phone,status,
        failed_login_count AS failedLoginCount,locked_until_utc AS lockedUntilUtc,
        token_version AS tokenVersion
      FROM dbo.users
      WHERE deleted_at_utc IS NULL AND
        (username_normalized=@identifier OR email_normalized=@identifier OR phone_normalized=@phone);
    `);
    const user = result.recordset[0];
    if (!user) return null;
    return { ...mapPrincipal(user, await loadRoles(Number(user.userId))), passwordHash: user.passwordHash,
      email: user.email, phone: user.phone,
      status: user.status, lockedUntilUtc: user.lockedUntilUtc };
  }

  async getCredential(userId: number): Promise<CredentialUser | null> {
    const pool = await getSqlPool();
    const request = pool.request();
    request.input('userId', sql.BigInt, userId);
    const result = await request.query<UserRow>(`
      SELECT user_id AS userId,CONVERT(varchar(36),public_id) AS publicId,
        password_hash AS passwordHash,display_name AS displayName,email,phone,status,
        failed_login_count AS failedLoginCount,locked_until_utc AS lockedUntilUtc,
        token_version AS tokenVersion
      FROM dbo.users WHERE user_id=@userId AND deleted_at_utc IS NULL;
    `);
    const user = result.recordset[0];
    if (!user) return null;
    return { ...mapPrincipal(user, await loadRoles(userId)), passwordHash: user.passwordHash,
      email: user.email, phone: user.phone, status: user.status, lockedUntilUtc: user.lockedUntilUtc };
  }

  async findPasswordResetCredential(tokenHash: Buffer): Promise<PasswordResetCredential | null> {
    const pool = await getSqlPool();
    const request = pool.request();
    request.input('tokenHash', sql.VarBinary(32), tokenHash);
    const result = await request.query<PasswordResetCredential>(`
      SELECT u.user_id AS userId,u.password_hash AS passwordHash
      FROM dbo.password_reset_challenges c
      JOIN dbo.users u ON u.user_id=c.user_id
      WHERE c.token_hash=@tokenHash AND c.consumed_at_utc IS NULL AND c.revoked_at_utc IS NULL
        AND c.expires_at_utc>SYSUTCDATETIME() AND u.status IN ('ACTIVE','LOCKED')
        AND u.deleted_at_utc IS NULL;
    `);
    const row = result.recordset[0];
    return row ? { userId: Number(row.userId), passwordHash: row.passwordHash } : null;
  }

  async getPrincipal(userId: number): Promise<AuthPrincipal | null> {
    const pool = await getSqlPool();
    const request = pool.request();
    request.input('userId', sql.BigInt, userId);
    const result = await request.query<UserRow>(`
      SELECT user_id AS userId,CONVERT(varchar(36),public_id) AS publicId,password_hash AS passwordHash,
        display_name AS displayName,email,phone,status,failed_login_count AS failedLoginCount,
        locked_until_utc AS lockedUntilUtc,token_version AS tokenVersion
      FROM dbo.users WHERE user_id=@userId AND status='ACTIVE' AND deleted_at_utc IS NULL
        AND (locked_until_utc IS NULL OR locked_until_utc<=SYSUTCDATETIME());
    `);
    const user = result.recordset[0];
    return user ? mapPrincipal(user, await loadRoles(userId)) : null;
  }

  async recordLoginFailure(userId: number, requestId: string) {
    const result = await executeCommand<never>('dbo.sp_auth_record_login_failure', [
      { name: 'user_id', type: sql.BigInt, value: userId },
      { name: 'max_failed_attempts', type: sql.SmallInt, value: env.LOGIN_MAX_FAILED_ATTEMPTS },
      { name: 'lock_minutes', type: sql.Int, value: env.LOGIN_LOCK_MINUTES },
      { name: 'locked_until_utc', type: sql.DateTime2(3), value: null, direction: 'output' },
    ], { requestId, actorUserId: userId });
    return (result.output.locked_until_utc as Date | null) ?? null;
  }

  async createSession(user: AuthPrincipal, refreshTokenHash: Buffer, expiresAtUtc: Date, metadata: SessionMetadata, requestId: string) {
    const result = await executeCommand<never>('dbo.sp_auth_create_session', [
      { name: 'user_id', type: sql.BigInt, value: user.userId },
      { name: 'expected_token_version', type: sql.Int, value: user.tokenVersion },
      { name: 'refresh_token_hash', type: sql.VarBinary(32), value: refreshTokenHash },
      { name: 'device_info', type: sql.NVarChar(500), value: metadata.deviceInfo ?? null },
      { name: 'ip_address', type: sql.VarChar(45), value: metadata.ipAddress ?? null },
      { name: 'expires_at_utc', type: sql.DateTime2(3), value: expiresAtUtc },
      { name: 'session_id', type: sql.UniqueIdentifier, value: null, direction: 'output' },
    ], { requestId, actorUserId: user.userId });
    return String(result.output.session_id);
  }

  async rotateSession(currentHash: Buffer, nextHash: Buffer, expiresAtUtc: Date, metadata: SessionMetadata, requestId: string): Promise<RotateSessionResult> {
    const result = await executeCommand<never>('dbo.sp_auth_rotate_session', [
      { name: 'current_refresh_token_hash', type: sql.VarBinary(32), value: currentHash },
      { name: 'new_refresh_token_hash', type: sql.VarBinary(32), value: nextHash },
      { name: 'device_info', type: sql.NVarChar(500), value: metadata.deviceInfo ?? null },
      { name: 'ip_address', type: sql.VarChar(45), value: metadata.ipAddress ?? null },
      { name: 'expires_at_utc', type: sql.DateTime2(3), value: expiresAtUtc },
      { name: 'user_id', type: sql.BigInt, value: null, direction: 'output' },
      { name: 'token_version', type: sql.Int, value: null, direction: 'output' },
      { name: 'new_session_id', type: sql.UniqueIdentifier, value: null, direction: 'output' },
      { name: 'reuse_detected', type: sql.Bit, value: false, direction: 'output' },
    ], { requestId });
    return {
      userId: result.output.user_id === null ? null : Number(result.output.user_id),
      tokenVersion: result.output.token_version === null ? null : Number(result.output.token_version),
      sessionId: result.output.new_session_id ? String(result.output.new_session_id) : null,
      reuseDetected: Boolean(result.output.reuse_detected),
    };
  }

  async revokeSession(refreshTokenHash: Buffer, requestId: string) {
    await executeCommand('dbo.sp_auth_revoke_session', [
      { name: 'refresh_token_hash', type: sql.VarBinary(32), value: refreshTokenHash },
      { name: 'reason', type: sql.VarChar(30), value: 'LOGOUT' },
    ], { requestId });
  }

  async revokeAllSessions(userId: number, requestId: string) {
    await executeCommand('dbo.sp_auth_revoke_all_sessions', [
      { name: 'actor_user_id', type: sql.BigInt, value: userId },
    ], { requestId, actorUserId: userId });
  }

  async createPasswordReset(userId: number, tokenHash: Buffer, expiresAtUtc: Date, requestedIp: string | undefined, requestId: string) {
    const result = await executeCommand<never>('dbo.sp_auth_create_password_reset', [
      { name: 'user_id', type: sql.BigInt, value: userId },
      { name: 'token_hash', type: sql.VarBinary(32), value: tokenHash },
      { name: 'requested_ip', type: sql.VarChar(45), value: requestedIp ?? null },
      { name: 'expires_at_utc', type: sql.DateTime2(3), value: expiresAtUtc },
      { name: 'max_requests_per_hour', type: sql.SmallInt, value: env.PASSWORD_RESET_MAX_PER_HOUR },
      { name: 'created', type: sql.Bit, value: false, direction: 'output' },
    ], { requestId, actorUserId: userId });
    return Boolean(result.output.created);
  }

  async cancelPasswordReset(tokenHash: Buffer, requestId: string) {
    await executeCommand('dbo.sp_auth_cancel_password_reset', [
      { name: 'token_hash', type: sql.VarBinary(32), value: tokenHash },
    ], { requestId });
  }

  async consumePasswordReset(tokenHash: Buffer, newPasswordHash: string, requestId: string) {
    const result = await executeCommand<never>('dbo.sp_auth_consume_password_reset', [
      { name: 'token_hash', type: sql.VarBinary(32), value: tokenHash },
      { name: 'new_password_hash', type: sql.VarChar(255), value: newPasswordHash },
      { name: 'succeeded', type: sql.Bit, value: false, direction: 'output' },
    ], { requestId });
    return Boolean(result.output.succeeded);
  }

  async changePassword(userId: number, expectedPasswordHash: string, newPasswordHash: string, requestId: string) {
    await executeCommand('dbo.sp_auth_change_password', [
      { name: 'actor_user_id', type: sql.BigInt, value: userId },
      { name: 'expected_password_hash', type: sql.VarChar(255), value: expectedPasswordHash },
      { name: 'new_password_hash', type: sql.VarChar(255), value: newPasswordHash },
    ], { requestId, actorUserId: userId });
  }

  async getRegistrationBranchId(branchCode: string) {
    const pool = await getSqlPool();
    const request = pool.request();
    request.input('branchCode', sql.VarChar(30), branchCode);
    const result = await request.query<{ branchId: number }>(`
      SELECT branch_id AS branchId FROM dbo.branches
      WHERE branch_code=@branchCode AND is_active=1;
    `);
    return result.recordset[0] ? Number(result.recordset[0].branchId) : null;
  }

  async createPatientRegistration(input: PatientRegistrationInput, requestId: string) {
    const result = await executeCommand<never>('dbo.sp_auth_create_patient_registration', [
      { name: 'registration_challenge_id', type: sql.UniqueIdentifier, value: input.challengeId },
      { name: 'idempotency_key', type: sql.UniqueIdentifier, value: input.idempotencyKey },
      { name: 'request_hash', type: sql.VarBinary(32), value: input.requestHash },
      { name: 'branch_id', type: sql.BigInt, value: input.branchId },
      { name: 'username', type: sql.NVarChar(80), value: input.username },
      { name: 'contact_channel', type: sql.VarChar(10), value: input.contactChannel },
      { name: 'contact_value', type: sql.VarChar(254), value: input.contactValue },
      { name: 'contact_normalized', type: sql.VarChar(254), value: input.contactNormalized },
      { name: 'password_hash', type: sql.VarChar(255), value: input.passwordHash },
      { name: 'full_name', type: sql.NVarChar(200), value: input.fullName },
      { name: 'date_of_birth', type: sql.Date, value: new Date(`${input.dateOfBirth}T00:00:00.000Z`) },
      { name: 'gender', type: sql.VarChar(10), value: input.gender },
      { name: 'otp_hash', type: sql.VarBinary(32), value: input.otpHash },
      { name: 'requested_ip', type: sql.VarChar(45), value: input.requestedIp ?? null },
      { name: 'expires_at_utc', type: sql.DateTime2(3), value: input.expiresAtUtc },
      { name: 'max_attempts', type: sql.SmallInt, value: env.AUTH_OTP_MAX_ATTEMPTS },
      { name: 'max_requests_per_hour', type: sql.SmallInt, value: env.AUTH_OTP_MAX_REQUESTS_PER_HOUR },
      { name: 'effective_challenge_id', type: sql.UniqueIdentifier, value: null, direction: 'output' },
      { name: 'created', type: sql.Bit, value: false, direction: 'output' },
    ], { requestId });
    return {
      challengeId: String(result.output.effective_challenge_id),
      created: Boolean(result.output.created),
    } satisfies PatientRegistrationChallengeResult;
  }

  async cancelPatientRegistration(challengeId: string, requestId: string) {
    await executeCommand('dbo.sp_auth_cancel_patient_registration', [
      { name: 'registration_challenge_id', type: sql.UniqueIdentifier, value: challengeId },
    ], { requestId });
  }

  async verifyPatientRegistration(challengeId: string, otpHash: Buffer, requestId: string) {
    const result = await executeCommand<never>('dbo.sp_auth_verify_patient_registration', [
      { name: 'registration_challenge_id', type: sql.UniqueIdentifier, value: challengeId },
      { name: 'otp_hash', type: sql.VarBinary(32), value: otpHash },
      { name: 'succeeded', type: sql.Bit, value: false, direction: 'output' },
      { name: 'user_id', type: sql.BigInt, value: null, direction: 'output' },
      { name: 'patient_public_id', type: sql.UniqueIdentifier, value: null, direction: 'output' },
      { name: 'patient_code', type: sql.VarChar(30), value: null, direction: 'output' },
    ], { requestId });
    return {
      succeeded: Boolean(result.output.succeeded),
      userId: result.output.user_id === null ? null : Number(result.output.user_id),
      patientPublicId: result.output.patient_public_id ? String(result.output.patient_public_id) : null,
      patientCode: result.output.patient_code ? String(result.output.patient_code) : null,
    } satisfies PatientRegistrationVerificationResult;
  }
}
