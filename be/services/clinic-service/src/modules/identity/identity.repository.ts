import { getSqlPool, sql } from '../../infrastructure/database/sql-database.js';
import type { ClinicPrincipal, PrincipalRepository } from './identity.types.js';

type PrincipalRow = {
  userId: number;
  userPublicId: string;
  tokenVersion: number;
  roleCode: string;
  roleBranchId: number | null;
};

export class SqlPrincipalRepository implements PrincipalRepository {
  async getPrincipal(userId: number): Promise<ClinicPrincipal | null> {
    const pool = await getSqlPool();
    const result = await pool.request()
      .input('userId', sql.BigInt, userId)
      .query<PrincipalRow>(`
        SELECT user_id AS userId,CONVERT(varchar(36),user_public_id) AS userPublicId,
               token_version AS tokenVersion,role_code AS roleCode,role_branch_id AS roleBranchId
        FROM dbo.v_clinic_principal_v1
        WHERE user_id=@userId
        ORDER BY role_code,role_branch_id;`);
    const first = result.recordset[0];
    if (!first) return null;
    const roleKeys = new Set<string>();
    const roles = result.recordset.flatMap((row) => {
      const branchId = row.roleBranchId === null ? null : Number(row.roleBranchId);
      const key = `${row.roleCode}:${branchId ?? 'global'}`;
      if (roleKeys.has(key)) return [];
      roleKeys.add(key);
      return [{ code: row.roleCode, branchId }];
    });
    return {
      userId: Number(first.userId),
      publicId: first.userPublicId,
      tokenVersion: Number(first.tokenVersion),
      roles,
    };
  }
}
