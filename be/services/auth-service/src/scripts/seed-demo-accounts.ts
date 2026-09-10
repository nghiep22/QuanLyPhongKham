import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { z } from 'zod';
import { env } from '../config.js';
import { closeSqlPool, executeCommand, getSqlPool, sql } from '../infrastructure/database/sql-database.js';

const input = z.object({
  DEMO_ACCOUNT_PASSWORD: z.string().min(12).max(200).default('ClinicDemo@2026!'),
}).parse(process.env);

type DemoStaff = {
  username: string;
  email: string;
  phone: string;
  employeeCode: string;
  employeeType: 'MANAGER' | 'DOCTOR' | 'NURSE' | 'RECEPTIONIST' | 'PHARMACIST' | 'CASHIER' | 'LAB_TECH';
  fullName: string;
  dateOfBirth: string;
  gender: 'MALE' | 'FEMALE';
  medicalLicenseNo?: string;
  academicTitle?: string;
};

const demoStaff: DemoStaff[] = [
  {
    username: 'manager.demo', email: 'manager.demo@example.com', phone: '0900000002',
    employeeCode: 'DEMO-MANAGER', employeeType: 'MANAGER', fullName: 'Nguyễn Minh Quản',
    dateOfBirth: '1985-03-12', gender: 'MALE',
  },
  {
    username: 'doctor.demo', email: 'doctor.demo@example.com', phone: '0900000003',
    employeeCode: 'DEMO-DOCTOR', employeeType: 'DOCTOR', fullName: 'Bác sĩ Trần An',
    dateOfBirth: '1988-07-18', gender: 'FEMALE', medicalLicenseNo: 'DEMO-CCHN-0001',
    academicTitle: 'Bác sĩ đa khoa',
  },
  {
    username: 'nurse.demo', email: 'nurse.demo@example.com', phone: '0900000004',
    employeeCode: 'DEMO-NURSE', employeeType: 'NURSE', fullName: 'Lê Thị Điều',
    dateOfBirth: '1993-11-08', gender: 'FEMALE',
  },
  {
    username: 'receptionist.demo', email: 'receptionist.demo@example.com', phone: '0900000005',
    employeeCode: 'DEMO-RECEPTION', employeeType: 'RECEPTIONIST', fullName: 'Phạm Thu Lễ',
    dateOfBirth: '1997-04-21', gender: 'FEMALE',
  },
  {
    username: 'pharmacist.demo', email: 'pharmacist.demo@example.com', phone: '0900000006',
    employeeCode: 'DEMO-PHARMACY', employeeType: 'PHARMACIST', fullName: 'Võ Minh Dược',
    dateOfBirth: '1990-09-14', gender: 'MALE',
  },
  {
    username: 'cashier.demo', email: 'cashier.demo@example.com', phone: '0900000007',
    employeeCode: 'DEMO-CASHIER', employeeType: 'CASHIER', fullName: 'Đặng Ngọc Thu',
    dateOfBirth: '1995-01-30', gender: 'FEMALE',
  },
  {
    username: 'lab.demo', email: 'lab.demo@example.com', phone: '0900000008',
    employeeCode: 'DEMO-LAB', employeeType: 'LAB_TECH', fullName: 'Bùi Quốc Kỹ',
    dateOfBirth: '1992-06-25', gender: 'MALE',
  },
];

function asDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

async function hashDemoPassword() {
  return argon2.hash(input.DEMO_ACCOUNT_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

async function findUser(username: string) {
  const pool = await getSqlPool();
  const result = await pool.request()
    .input('username', sql.NVarChar(80), username)
    .query<{ userId: number; status: string }>(`
      SELECT user_id AS userId,status
      FROM dbo.users
      WHERE username_normalized=LOWER(LTRIM(RTRIM(@username))) AND deleted_at_utc IS NULL;
    `);
  return result.recordset[0]
    ? { userId: Number(result.recordset[0].userId), status: result.recordset[0].status }
    : null;
}

async function findActiveGlobalAdmin() {
  const pool = await getSqlPool();
  const result = await pool.request().query<{ userId: number; username: string }>(`
    SELECT TOP (1) u.user_id AS userId,u.username
    FROM dbo.users u
    JOIN dbo.user_roles ur ON ur.user_id=u.user_id
    JOIN dbo.roles r ON r.role_id=ur.role_id
    WHERE r.role_code='ADMIN' AND ur.branch_id IS NULL AND ur.is_active=1
      AND ur.valid_from_utc<=SYSUTCDATETIME()
      AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc>SYSUTCDATETIME())
      AND u.status='ACTIVE' AND u.deleted_at_utc IS NULL
    ORDER BY u.user_id;
  `);
  return result.recordset[0]
    ? { userId: Number(result.recordset[0].userId), username: result.recordset[0].username }
    : null;
}

async function ensureAdmin() {
  const existingAdmin = await findActiveGlobalAdmin();
  if (existingAdmin) return { ...existingAdmin, created: false };

  const pool = await getSqlPool();
  const count = await pool.request().query<{ total: number }>('SELECT COUNT_BIG(*) AS total FROM dbo.users;');
  if (Number(count.recordset[0]?.total ?? 0) !== 0) {
    throw new Error('Database đã có tài khoản nhưng không có Admin toàn cục đang hoạt động. Không thể seed an toàn.');
  }

  const passwordHash = await hashDemoPassword();
  const result = await executeCommand('dbo.sp_bootstrap_first_admin', [
    { name: 'username', type: sql.NVarChar(80), value: 'admin.demo' },
    { name: 'email', type: sql.VarChar(254), value: 'admin.demo@example.com' },
    { name: 'phone', type: sql.VarChar(20), value: '0900000001' },
    { name: 'password_hash', type: sql.VarChar(255), value: passwordHash },
    { name: 'display_name', type: sql.NVarChar(200), value: 'Quản trị viên Demo' },
    { name: 'user_id', type: sql.BigInt, value: null, direction: 'output' },
  ], { requestId: randomUUID() });

  return { userId: Number(result.output.user_id), username: 'admin.demo', created: true };
}

async function getSeedReferences() {
  const pool = await getSqlPool();
  const result = await pool.request().query<{ branchId: number; specialtyId: number }>(`
    SELECT b.branch_id AS branchId,s.specialty_id AS specialtyId
    FROM dbo.branches b
    CROSS JOIN dbo.specialties s
    WHERE b.branch_code='MAIN' AND b.is_active=1
      AND s.specialty_code='GENERAL' AND s.is_active=1;
  `);
  const row = result.recordset[0];
  if (!row) throw new Error('Thiếu dữ liệu nền MAIN/GENERAL. Hãy áp dụng quan_ly_phong_kham.sql trước.');
  return { branchId: Number(row.branchId), specialtyId: Number(row.specialtyId) };
}

async function ensureStaff(actorUserId: number, branchId: number, specialtyId: number, staff: DemoStaff) {
  const existing = await findUser(staff.username);
  if (existing) {
    const pool = await getSqlPool();
    const match = await pool.request()
      .input('userId', sql.BigInt, existing.userId)
      .input('employeeCode', sql.VarChar(30), staff.employeeCode)
      .input('employeeType', sql.VarChar(30), staff.employeeType)
      .query(`
        SELECT 1 AS matched FROM dbo.employees
        WHERE user_id=@userId AND employee_code=@employeeCode AND employee_type=@employeeType;
      `);
    if (!match.recordset[0]) {
      throw new Error(`Tài khoản ${staff.username} đã tồn tại nhưng không khớp hồ sơ demo; seed đã dừng.`);
    }
    return false;
  }

  const passwordHash = await hashDemoPassword();
  await executeCommand('dbo.sp_create_staff_account', [
    { name: 'actor_user_id', type: sql.BigInt, value: actorUserId },
    { name: 'branch_id', type: sql.BigInt, value: branchId },
    { name: 'username', type: sql.NVarChar(80), value: staff.username },
    { name: 'email', type: sql.VarChar(254), value: staff.email },
    { name: 'phone', type: sql.VarChar(20), value: staff.phone },
    { name: 'password_hash', type: sql.VarChar(255), value: passwordHash },
    { name: 'employee_code', type: sql.VarChar(30), value: staff.employeeCode },
    { name: 'employee_type', type: sql.VarChar(30), value: staff.employeeType },
    { name: 'full_name', type: sql.NVarChar(200), value: staff.fullName },
    { name: 'date_of_birth', type: sql.Date, value: asDate(staff.dateOfBirth) },
    { name: 'gender', type: sql.VarChar(10), value: staff.gender },
    { name: 'address_line', type: sql.NVarChar(300), value: 'TP. Hồ Chí Minh' },
    { name: 'hire_date', type: sql.Date, value: asDate('2025-01-02') },
    { name: 'medical_license_no', type: sql.NVarChar(100), value: staff.medicalLicenseNo ?? null },
    { name: 'license_issued_date', type: sql.Date, value: staff.medicalLicenseNo ? asDate('2020-01-02') : null },
    { name: 'license_expiry_date', type: sql.Date, value: staff.medicalLicenseNo ? asDate('2030-01-02') : null },
    { name: 'academic_title', type: sql.NVarChar(100), value: staff.academicTitle ?? null },
    { name: 'biography', type: sql.NVarChar(sql.MAX), value: staff.medicalLicenseNo ? 'Tài khoản bác sĩ dùng cho môi trường demo.' : null },
    { name: 'default_slot_minutes', type: sql.SmallInt, value: 30 },
    { name: 'accepts_online_booking', type: sql.Bit, value: true },
    { name: 'specialty_id', type: sql.BigInt, value: staff.employeeType === 'DOCTOR' ? specialtyId : null },
    { name: 'user_id', type: sql.BigInt, value: null, direction: 'output' },
    { name: 'employee_id', type: sql.BigInt, value: null, direction: 'output' },
    { name: 'doctor_id', type: sql.BigInt, value: null, direction: 'output' },
  ], { requestId: randomUUID(), actorUserId, branchId });
  return true;
}

async function ensurePatient(actorUserId: number, branchId: number) {
  const username = 'patient.demo';
  const existing = await findUser(username);
  if (existing) {
    const pool = await getSqlPool();
    const match = await pool.request()
      .input('userId', sql.BigInt, existing.userId)
      .query(`
        SELECT 1 AS matched
        FROM dbo.user_patient_access upa
        JOIN dbo.patients p ON p.patient_id=upa.patient_id
        WHERE upa.user_id=@userId AND upa.relationship_type='SELF'
          AND upa.status='ACTIVE' AND p.national_id_normalized='079095000001';
      `);
    if (!match.recordset[0]) {
      throw new Error('Tài khoản patient.demo đã tồn tại nhưng không khớp hồ sơ demo; seed đã dừng.');
    }
    return false;
  }

  const pool = await getSqlPool();
  const patientLookup = await pool.request().query<{
    patientId: number; fullName: string; dateOfBirth: Date; nationalId: string | null; email: string | null;
  }>(`
    SELECT patient_id AS patientId,full_name AS fullName,date_of_birth AS dateOfBirth,
      national_id AS nationalId,email
    FROM dbo.patients
    WHERE national_id_normalized='079095000001' OR email='patient.demo@example.com';
  `);
  if (patientLookup.recordset.length > 1) {
    throw new Error('Có nhiều hồ sơ trùng định danh bệnh nhân demo; seed đã dừng để tránh liên kết nhầm.');
  }
  const matchedPatient = patientLookup.recordset[0];
  if (matchedPatient && (matchedPatient.fullName !== 'Nguyễn An Bình'
    || matchedPatient.dateOfBirth.toISOString().slice(0, 10) !== '1995-05-20'
    || matchedPatient.nationalId !== '079095000001'
    || matchedPatient.email !== 'patient.demo@example.com')) {
    throw new Error('Định danh bệnh nhân demo đang thuộc hồ sơ khác; seed đã dừng để tránh liên kết nhầm.');
  }

  let patientId = matchedPatient ? Number(matchedPatient.patientId) : null;
  if (patientId === null) {
    const patientResult = await executeCommand('dbo.sp_create_patient', [
      { name: 'actor_user_id', type: sql.BigInt, value: actorUserId },
      { name: 'branch_id', type: sql.BigInt, value: branchId },
      { name: 'full_name', type: sql.NVarChar(200), value: 'Nguyễn An Bình' },
      { name: 'date_of_birth', type: sql.Date, value: asDate('1995-05-20') },
      { name: 'gender', type: sql.VarChar(10), value: 'MALE' },
      { name: 'national_id', type: sql.VarChar(30), value: '079095000001' },
      { name: 'health_insurance_no', type: sql.VarChar(30), value: 'DN401000000001' },
      { name: 'phone', type: sql.VarChar(20), value: '0900000009' },
      { name: 'email', type: sql.VarChar(254), value: 'patient.demo@example.com' },
      { name: 'address_line', type: sql.NVarChar(300), value: 'TP. Hồ Chí Minh' },
      { name: 'province', type: sql.NVarChar(100), value: 'TP. Hồ Chí Minh' },
      { name: 'portal_user_id', type: sql.BigInt, value: null },
      { name: 'relationship_type', type: sql.VarChar(20), value: 'SELF' },
      { name: 'patient_id', type: sql.BigInt, value: null, direction: 'output' },
    ], { requestId: randomUUID(), actorUserId, branchId });
    patientId = Number(patientResult.output.patient_id);
  }

  const passwordHash = await hashDemoPassword();
  await executeCommand('dbo.sp_create_patient_portal_account', [
    { name: 'actor_user_id', type: sql.BigInt, value: actorUserId },
    { name: 'branch_id', type: sql.BigInt, value: branchId },
    { name: 'patient_id', type: sql.BigInt, value: patientId },
    { name: 'username', type: sql.NVarChar(80), value: username },
    { name: 'email', type: sql.VarChar(254), value: 'patient.demo@example.com' },
    { name: 'phone', type: sql.VarChar(20), value: '0900000009' },
    { name: 'password_hash', type: sql.VarChar(255), value: passwordHash },
    { name: 'relationship_type', type: sql.VarChar(20), value: 'SELF' },
    { name: 'user_id', type: sql.BigInt, value: null, direction: 'output' },
  ], { requestId: randomUUID(), actorUserId, branchId });
  return true;
}

if (env.NODE_ENV !== 'development') {
  throw new Error('Dữ liệu demo chỉ được phép seed khi NODE_ENV=development.');
}

try {
  const admin = await ensureAdmin();
  const references = await getSeedReferences();
  const results: Array<{ username: string; created: boolean }> = [
    { username: admin.username, created: admin.created },
  ];

  for (const staff of demoStaff) {
    results.push({
      username: staff.username,
      created: await ensureStaff(admin.userId, references.branchId, references.specialtyId, staff),
    });
  }
  results.push({
    username: 'patient.demo',
    created: await ensurePatient(admin.userId, references.branchId),
  });

  process.stdout.write('\nTài khoản demo:\n');
  for (const result of results) {
    process.stdout.write(`- ${result.username}: ${result.created ? 'đã tạo' : 'đã tồn tại'}\n`);
  }
  process.stdout.write(process.env.DEMO_ACCOUNT_PASSWORD
    ? 'Mật khẩu chung: giá trị DEMO_ACCOUNT_PASSWORD đã cung cấp.\n'
    : `Mật khẩu chung mặc định: ${input.DEMO_ACCOUNT_PASSWORD}\n`);
  process.stdout.write('Chỉ sử dụng các tài khoản này trong môi trường development.\n');
} finally {
  await closeSqlPool();
}
