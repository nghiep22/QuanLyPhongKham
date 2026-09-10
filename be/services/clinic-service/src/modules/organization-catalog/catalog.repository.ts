import type { IRecordSet } from 'mssql';
import { executeCommand, getSqlPool, sql } from '../../infrastructure/database/sql-database.js';
import type { ClinicPrincipal } from '../identity/index.js';
import type {
  BranchPrice, BranchReference, CatalogRepository, CatalogService, CategoryReference,
  CreateRoomInput, CreateServiceInput, PublicBranch, PublicDoctor, PublicService,
  PublicSpecialty, Room, SetBranchPriceInput, SpecialtyReference, UpdateRoomInput,
  UpdateServiceInput,
} from './catalog.types.js';

function dateOnly(value: Date | string | null): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value.toISOString() : value).slice(0, 10);
}

function rowVersion(hex: string) {
  return Buffer.from(hex, 'hex').toString('base64');
}

type DoctorRow = {
  doctorPublicId: string; fullName: string; academicTitle: string | null;
  biography: string | null; defaultSlotMinutes: number; branchPublicId: string;
  branchName: string; specialtyPublicId: string | null; specialtyName: string | null;
  servicePublicId: string | null;
};

function mapDoctors(rows: IRecordSet<DoctorRow>): PublicDoctor[] {
  const doctors = new Map<string, PublicDoctor>();
  for (const row of rows) {
    const doctor = doctors.get(row.doctorPublicId) ?? {
      publicId: row.doctorPublicId, fullName: row.fullName, academicTitle: row.academicTitle,
      biography: row.biography, defaultSlotMinutes: Number(row.defaultSlotMinutes),
      branches: [], specialties: [], servicePublicIds: [],
    };
    if (!doctor.branches.some((branch) => branch.publicId === row.branchPublicId)) {
      doctor.branches.push({ publicId: row.branchPublicId, name: row.branchName });
    }
    if (row.specialtyPublicId && row.specialtyName
      && !doctor.specialties.some((specialty) => specialty.publicId === row.specialtyPublicId)) {
      doctor.specialties.push({ publicId: row.specialtyPublicId, name: row.specialtyName });
    }
    if (row.servicePublicId && !doctor.servicePublicIds.includes(row.servicePublicId)) {
      doctor.servicePublicIds.push(row.servicePublicId);
    }
    doctors.set(row.doctorPublicId, doctor);
  }
  return [...doctors.values()];
}

type ServiceRow = {
  serviceId: number; publicId: string; serviceCode: string; serviceName: string;
  serviceType: CatalogService['type']; defaultDurationMin: number; currentPrice: string;
  requiresDoctor: boolean; isActive: boolean; rowVersion: string;
  serviceCategoryId: number; categoryPublicId: string; categoryCode: string; categoryName: string;
  specialtyId: number | null; specialtyPublicId: string | null; specialtyCode: string | null;
  specialtyName: string | null;
};
type PriceRow = {
  serviceId: number; publicId: string; priceAmount: string; currencyCode: 'VND';
  effectiveFrom: Date | string; effectiveTo: Date | string | null; isAvailable: boolean;
};

function mapCatalogServices(serviceRows: IRecordSet<ServiceRow>, priceRows: IRecordSet<PriceRow>) {
  const prices = new Map<number, BranchPrice[]>();
  for (const row of priceRows) {
    const list = prices.get(Number(row.serviceId)) ?? [];
    list.push({
      publicId: row.publicId, amount: row.priceAmount, currency: row.currencyCode,
      effectiveFrom: dateOnly(row.effectiveFrom)!, effectiveTo: dateOnly(row.effectiveTo),
      isAvailable: Boolean(row.isAvailable),
    });
    prices.set(Number(row.serviceId), list);
  }
  return serviceRows.map((row): CatalogService => ({
    id: Number(row.serviceId), publicId: row.publicId, code: row.serviceCode,
    name: row.serviceName, type: row.serviceType,
    category: {
      id: Number(row.serviceCategoryId), publicId: row.categoryPublicId,
      code: row.categoryCode, name: row.categoryName,
    },
    specialty: row.specialtyId === null ? null : {
      id: Number(row.specialtyId), publicId: row.specialtyPublicId!,
      code: row.specialtyCode!, name: row.specialtyName!,
    },
    durationMinutes: Number(row.defaultDurationMin), basePrice: row.currentPrice,
    requiresDoctor: Boolean(row.requiresDoctor), isActive: Boolean(row.isActive),
    branchPrices: prices.get(Number(row.serviceId)) ?? [], rowVersion: rowVersion(row.rowVersion),
  }));
}

const serviceColumns = `
  service_id AS serviceId,CONVERT(varchar(36),public_id) AS publicId,
  service_code AS serviceCode,service_name AS serviceName,service_type AS serviceType,
  default_duration_min AS defaultDurationMin,
  CONVERT(varchar(30),current_price) AS currentPrice,
  requires_doctor AS requiresDoctor,is_active AS isActive,row_version AS rowVersion,
  service_category_id AS serviceCategoryId,
  CONVERT(varchar(36),category_public_id) AS categoryPublicId,
  category_code AS categoryCode,category_name AS categoryName,
  specialty_id AS specialtyId,CONVERT(varchar(36),specialty_public_id) AS specialtyPublicId,
  specialty_code AS specialtyCode,specialty_name AS specialtyName`;

export class SqlCatalogRepository implements CatalogRepository {
  async listPublicBranches(): Promise<PublicBranch[]> {
    const result = await (await getSqlPool()).request().query(`
      SELECT CONVERT(varchar(36),public_id) AS publicId,branch_code AS code,branch_name AS name,
        phone,email,address_line AS addressLine,ward,district,province,timezone_name AS timezoneName,
        booking_horizon_days AS bookingHorizonDays,online_hold_minutes AS onlineHoldMinutes,
        cancellation_deadline_minutes AS cancellationDeadlineMinutes
      FROM dbo.v_public_branches_v1 ORDER BY branch_name;`);
    return result.recordset as PublicBranch[];
  }

  async listPublicSpecialties(): Promise<PublicSpecialty[]> {
    const result = await (await getSqlPool()).request().query(`
      SELECT CONVERT(varchar(36),public_id) AS publicId,specialty_code AS code,
        specialty_name AS name,description
      FROM dbo.v_public_specialties_v1 ORDER BY specialty_name;`);
    return result.recordset as PublicSpecialty[];
  }

  async listPublicServices(branchPublicId: string, specialtyPublicId?: string, query?: string) {
    const request = (await getSqlPool()).request();
    request.input('branchPublicId', sql.UniqueIdentifier, branchPublicId);
    request.input('specialtyPublicId', sql.UniqueIdentifier, specialtyPublicId ?? null);
    request.input('query', sql.NVarChar(100), query ?? null);
    const result = await request.query(`
      SELECT CONVERT(varchar(36),service_public_id) AS publicId,service_code AS code,
        service_name AS name,service_type AS type,
        CONVERT(varchar(36),category_public_id) AS categoryPublicId,
        category_code AS categoryCode,category_name AS categoryName,
        CONVERT(varchar(36),specialty_public_id) AS specialtyPublicId,
        specialty_code AS specialtyCode,specialty_name AS specialtyName,
        default_duration_min AS durationMinutes,requires_doctor AS requiresDoctor,
        price_amount AS amount,currency_code AS currency,effective_from AS effectiveFrom
      FROM dbo.v_public_services_v1
      WHERE branch_public_id=@branchPublicId
        AND (@specialtyPublicId IS NULL OR specialty_public_id=@specialtyPublicId)
        AND (@query IS NULL OR service_name LIKE N'%'+@query+N'%' OR service_code LIKE '%'+CONVERT(varchar(100),@query)+'%')
      ORDER BY category_name,service_name;`);
    return result.recordset.map((row: Record<string, unknown>): PublicService => ({
      publicId: String(row.publicId), code: String(row.code), name: String(row.name),
      type: row.type as PublicService['type'],
      category: { publicId: String(row.categoryPublicId), code: String(row.categoryCode), name: String(row.categoryName) },
      specialty: row.specialtyPublicId ? {
        publicId: String(row.specialtyPublicId), code: String(row.specialtyCode), name: String(row.specialtyName),
      } : null,
      durationMinutes: Number(row.durationMinutes), requiresDoctor: Boolean(row.requiresDoctor),
      price: { amount: String(row.amount), currency: 'VND', effectiveFrom: dateOnly(row.effectiveFrom as Date | string)! },
    }));
  }

  async listPublicDoctors(branchPublicId?: string, specialtyPublicId?: string, servicePublicId?: string, query?: string) {
    const request = (await getSqlPool()).request();
    request.input('branchPublicId', sql.UniqueIdentifier, branchPublicId ?? null);
    request.input('specialtyPublicId', sql.UniqueIdentifier, specialtyPublicId ?? null);
    request.input('servicePublicId', sql.UniqueIdentifier, servicePublicId ?? null);
    request.input('query', sql.NVarChar(100), query ?? null);
    const result = await request.query<DoctorRow>(`
      SELECT CONVERT(varchar(36),d.doctor_public_id) AS doctorPublicId,d.full_name AS fullName,
        d.academic_title AS academicTitle,d.biography,d.default_slot_minutes AS defaultSlotMinutes,
        CONVERT(varchar(36),d.branch_public_id) AS branchPublicId,d.branch_name AS branchName,
        CONVERT(varchar(36),d.specialty_public_id) AS specialtyPublicId,d.specialty_name AS specialtyName,
        CONVERT(varchar(36),d.service_public_id) AS servicePublicId
      FROM dbo.v_public_doctors_v1 d
      WHERE (@branchPublicId IS NULL OR d.branch_public_id=@branchPublicId)
        AND (@query IS NULL OR d.full_name LIKE N'%'+@query+N'%')
        AND (@specialtyPublicId IS NULL OR EXISTS
          (SELECT 1 FROM dbo.v_public_doctors_v1 x
           WHERE x.doctor_public_id=d.doctor_public_id AND x.specialty_public_id=@specialtyPublicId
             AND (@branchPublicId IS NULL OR x.branch_public_id=@branchPublicId)))
        AND (@servicePublicId IS NULL OR EXISTS
          (SELECT 1 FROM dbo.v_public_doctors_v1 x
           WHERE x.doctor_public_id=d.doctor_public_id AND x.service_public_id=@servicePublicId
             AND (@branchPublicId IS NULL OR x.branch_public_id=@branchPublicId)))
      ORDER BY d.full_name;`);
    return mapDoctors(result.recordset);
  }

  async hasPermission(actorUserId: number, branchId: number | null) {
    const request = (await getSqlPool()).request();
    request.input('actorUserId', sql.BigInt, actorUserId);
    request.input('branchId', sql.BigInt, branchId);
    const result = await request.query<{ allowed: boolean }>(`
      SELECT CONVERT(bit,CASE WHEN EXISTS(
        SELECT 1 FROM dbo.v_clinic_principal_v1
        WHERE user_id=@actorUserId
          AND (role_code='ADMIN' OR permission_code='MASTER_DATA_MANAGE')
          AND (role_branch_id IS NULL OR role_branch_id=@branchId)
      ) THEN 1 ELSE 0 END) AS allowed;`);
    return Boolean(result.recordset[0]?.allowed);
  }

  async listManageableBranches(actorUserId: number) {
    const request = (await getSqlPool()).request();
    request.input('actorUserId', sql.BigInt, actorUserId);
    const result = await request.query<BranchReference>(`
      SELECT b.branch_id AS id,CONVERT(varchar(36),b.public_id) AS publicId,
        b.branch_code AS code,b.branch_name AS name
      FROM dbo.v_catalog_branches_v1 b
      WHERE b.is_active=1 AND EXISTS(
        SELECT 1 FROM dbo.v_clinic_principal_v1 p
        WHERE p.user_id=@actorUserId
          AND (p.role_code='ADMIN' OR p.permission_code='MASTER_DATA_MANAGE')
          AND (p.role_branch_id IS NULL OR p.role_branch_id=b.branch_id))
      ORDER BY b.branch_name;`);
    return result.recordset.map((row) => ({ ...row, id: Number(row.id) }));
  }

  async listCategories() {
    const result = await (await getSqlPool()).request().query<CategoryReference>(`
      SELECT service_category_id AS id,CONVERT(varchar(36),public_id) AS publicId,
        category_code AS code,category_name AS name
      FROM dbo.v_catalog_categories_v1 WHERE is_active=1 ORDER BY display_order,category_name;`);
    return result.recordset.map((row) => ({ ...row, id: Number(row.id) }));
  }

  async listSpecialties() {
    const result = await (await getSqlPool()).request().query<SpecialtyReference>(`
      SELECT specialty_id AS id,CONVERT(varchar(36),public_id) AS publicId,
        specialty_code AS code,specialty_name AS name
      FROM dbo.v_catalog_specialties_v1 WHERE is_active=1 ORDER BY specialty_name;`);
    return result.recordset.map((row) => ({ ...row, id: Number(row.id) }));
  }

  async resolveBranch(publicId: string) {
    const result = await (await getSqlPool()).request().input('publicId', sql.UniqueIdentifier, publicId)
      .query<BranchReference>(`SELECT branch_id AS id,CONVERT(varchar(36),public_id) AS publicId,
        branch_code AS code,branch_name AS name FROM dbo.v_catalog_branches_v1
        WHERE public_id=@publicId AND is_active=1;`);
    return result.recordset[0] ? { ...result.recordset[0], id: Number(result.recordset[0].id) } : null;
  }

  async resolveCategory(publicId: string) {
    const result = await (await getSqlPool()).request().input('publicId', sql.UniqueIdentifier, publicId)
      .query<CategoryReference>(`SELECT service_category_id AS id,CONVERT(varchar(36),public_id) AS publicId,
        category_code AS code,category_name AS name FROM dbo.v_catalog_categories_v1
        WHERE public_id=@publicId AND is_active=1;`);
    return result.recordset[0] ? { ...result.recordset[0], id: Number(result.recordset[0].id) } : null;
  }

  async resolveSpecialty(publicId: string) {
    const result = await (await getSqlPool()).request().input('publicId', sql.UniqueIdentifier, publicId)
      .query<SpecialtyReference>(`SELECT specialty_id AS id,CONVERT(varchar(36),public_id) AS publicId,
        specialty_code AS code,specialty_name AS name FROM dbo.v_catalog_specialties_v1
        WHERE public_id=@publicId AND is_active=1;`);
    return result.recordset[0] ? { ...result.recordset[0], id: Number(result.recordset[0].id) } : null;
  }

  async listRooms(branchId: number) {
    const result = await (await getSqlPool()).request().input('branchId', sql.BigInt, branchId).query(`
      SELECT room_id AS id,CONVERT(varchar(36),public_id) AS publicId,branch_id AS branchId,
        CONVERT(varchar(36),branch_public_id) AS branchPublicId,branch_code AS branchCode,
        branch_name AS branchName,room_code AS code,room_name AS name,room_type AS type,
        floor_no AS floorNo,capacity,is_active AS isActive,row_version AS rowVersion
      FROM dbo.v_catalog_rooms_v1 WHERE branch_id=@branchId ORDER BY room_code;`);
    return result.recordset.map((row: Record<string, unknown>): Room => ({
      id: Number(row.id), publicId: String(row.publicId), branchId: Number(row.branchId),
      branch: { publicId: String(row.branchPublicId), code: String(row.branchCode), name: String(row.branchName) },
      code: String(row.code), name: String(row.name), type: row.type as Room['type'],
      floorNo: row.floorNo === null ? null : Number(row.floorNo), capacity: Number(row.capacity),
      isActive: Boolean(row.isActive), rowVersion: rowVersion(String(row.rowVersion)),
    }));
  }

  async getRoom(publicId: string) {
    const result = await (await getSqlPool()).request().input('publicId', sql.UniqueIdentifier, publicId)
      .query<{ branchId: number }>('SELECT branch_id AS branchId FROM dbo.v_catalog_rooms_v1 WHERE public_id=@publicId;');
    const row = result.recordset[0];
    if (!row) return null;
    return (await this.listRooms(Number(row.branchId))).find((room) => room.publicId === publicId) ?? null;
  }

  async createRoom(actor: ClinicPrincipal, branchId: number, input: CreateRoomInput, requestId: string) {
    const result = await executeCommand('dbo.sp_create_room', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'branch_id', type: sql.BigInt, value: branchId },
      { name: 'room_code', type: sql.VarChar(30), value: input.code },
      { name: 'room_name', type: sql.NVarChar(150), value: input.name },
      { name: 'room_type', type: sql.VarChar(30), value: input.type },
      { name: 'floor_no', type: sql.SmallInt, value: input.floorNo ?? null },
      { name: 'capacity', type: sql.SmallInt, value: input.capacity },
      { name: 'room_id', type: sql.BigInt, value: null, direction: 'output' },
    ], { requestId, actorUserId: actor.userId, branchId });
    const lookup = await (await getSqlPool()).request().input('id', sql.BigInt, result.output.room_id)
      .query<{ publicId: string }>('SELECT CONVERT(varchar(36),public_id) AS publicId FROM dbo.v_catalog_rooms_v1 WHERE room_id=@id;');
    return lookup.recordset[0]!.publicId;
  }

  updateRoom(actor: ClinicPrincipal, room: Room, input: UpdateRoomInput, expectedVersion: string, requestId: string) {
    return executeCommand('dbo.sp_update_room', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'branch_id', type: sql.BigInt, value: room.branchId },
      { name: 'room_id', type: sql.BigInt, value: room.id },
      { name: 'room_name', type: sql.NVarChar(150), value: input.name },
      { name: 'room_type', type: sql.VarChar(30), value: input.type },
      { name: 'floor_no', type: sql.SmallInt, value: input.floorNo ?? null },
      { name: 'capacity', type: sql.SmallInt, value: input.capacity },
      { name: 'is_active', type: sql.Bit, value: input.isActive },
      { name: 'expected_row_ver', type: sql.VarBinary(8), value: Buffer.from(expectedVersion, 'base64') },
    ], { requestId, actorUserId: actor.userId, branchId: room.branchId }).then(() => undefined);
  }

  async listServices(branchId: number) {
    const request = (await getSqlPool()).request();
    request.input('branchId', sql.BigInt, branchId);
    const result = await request.query(`
      SELECT DISTINCT ${serviceColumns} FROM dbo.v_catalog_services_v1 ORDER BY service_name;
      SELECT service_id AS serviceId,CONVERT(varchar(36),price_public_id) AS publicId,
        price_amount AS priceAmount,currency_code AS currencyCode,effective_from AS effectiveFrom,
        effective_to AS effectiveTo,is_available AS isAvailable
      FROM dbo.v_catalog_services_v1 WHERE branch_id=@branchId ORDER BY service_id,effective_from DESC;`);
    const recordsets = result.recordsets as unknown as [IRecordSet<ServiceRow>, IRecordSet<PriceRow>];
    return mapCatalogServices(recordsets[0], recordsets[1]);
  }

  async getService(publicId: string, branchId: number) {
    return (await this.listServices(branchId)).find((service) => service.publicId === publicId) ?? null;
  }

  async createService(actor: ClinicPrincipal, categoryId: number, specialtyId: number | null, input: CreateServiceInput, requestId: string) {
    const result = await executeCommand('dbo.sp_create_service', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'branch_id', type: sql.BigInt, value: null },
      { name: 'service_category_id', type: sql.BigInt, value: categoryId },
      { name: 'specialty_id', type: sql.BigInt, value: specialtyId },
      { name: 'service_code', type: sql.VarChar(30), value: input.code },
      { name: 'service_name', type: sql.NVarChar(200), value: input.name },
      { name: 'service_type', type: sql.VarChar(30), value: input.type },
      { name: 'default_duration_min', type: sql.SmallInt, value: input.durationMinutes },
      { name: 'current_price', type: sql.Decimal(19, 2), value: input.basePrice },
      { name: 'requires_doctor', type: sql.Bit, value: input.requiresDoctor },
      { name: 'service_id', type: sql.BigInt, value: null, direction: 'output' },
    ], { requestId, actorUserId: actor.userId });
    const lookup = await (await getSqlPool()).request().input('id', sql.BigInt, result.output.service_id)
      .query<{ publicId: string }>('SELECT CONVERT(varchar(36),public_id) AS publicId FROM dbo.v_catalog_services_v1 WHERE service_id=@id;');
    return lookup.recordset[0]!.publicId;
  }

  updateService(actor: ClinicPrincipal, serviceId: number, categoryId: number, specialtyId: number | null, input: UpdateServiceInput, expectedVersion: string, requestId: string) {
    return executeCommand('dbo.sp_update_service', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'service_id', type: sql.BigInt, value: serviceId },
      { name: 'service_category_id', type: sql.BigInt, value: categoryId },
      { name: 'specialty_id', type: sql.BigInt, value: specialtyId },
      { name: 'service_name', type: sql.NVarChar(200), value: input.name },
      { name: 'service_type', type: sql.VarChar(30), value: input.type },
      { name: 'default_duration_min', type: sql.SmallInt, value: input.durationMinutes },
      { name: 'current_price', type: sql.Decimal(19, 2), value: input.basePrice },
      { name: 'requires_doctor', type: sql.Bit, value: input.requiresDoctor },
      { name: 'is_active', type: sql.Bit, value: input.isActive },
      { name: 'expected_row_ver', type: sql.VarBinary(8), value: Buffer.from(expectedVersion, 'base64') },
    ], { requestId, actorUserId: actor.userId }).then(() => undefined);
  }

  setBranchPrice(actor: ClinicPrincipal, branchId: number, serviceId: number, input: SetBranchPriceInput, requestId: string) {
    return executeCommand('dbo.sp_set_branch_service_price', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'branch_id', type: sql.BigInt, value: branchId },
      { name: 'service_id', type: sql.BigInt, value: serviceId },
      { name: 'price_amount', type: sql.Decimal(19, 2), value: input.amount },
      { name: 'effective_from', type: sql.Date, value: input.effectiveFrom },
      { name: 'is_available', type: sql.Bit, value: input.isAvailable },
      { name: 'service_branch_price_id', type: sql.BigInt, value: null, direction: 'output' },
    ], { requestId, actorUserId: actor.userId, branchId }).then(() => undefined);
  }
}
