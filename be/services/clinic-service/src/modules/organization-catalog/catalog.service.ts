import { HttpError } from '../../shared/http/errors.js';
import type { ClinicPrincipal } from '../identity/index.js';
import type {
  CatalogRepository, CreateRoomInput, CreateServiceInput, SetBranchPriceInput,
  UpdateRoomInput, UpdateServiceInput,
} from './catalog.types.js';

function databaseErrorNumber(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('number' in error && typeof error.number === 'number') return error.number;
  if ('originalError' in error) return databaseErrorNumber(error.originalError);
  return undefined;
}

function mapDatabaseError(error: unknown): never {
  const number = databaseErrorNumber(error);
  if ([2601, 2627].includes(number ?? 0)) {
    throw new HttpError(409, 'CATALOG_CODE_CONFLICT', 'Mã phòng, mã dịch vụ hoặc ngày hiệu lực đã tồn tại.');
  }
  if ([53601, 53605].includes(number ?? 0)) {
    throw new HttpError(409, 'CATALOG_VERSION_CONFLICT', 'Dữ liệu đã thay đổi. Vui lòng tải lại trước khi lưu.');
  }
  if (number === 53611 || number === 52062) {
    throw new HttpError(409, 'PRICE_PERIOD_CONFLICT', 'Ngày hiệu lực hoặc khoảng giá bị trùng với lịch sử hiện có.');
  }
  if ([53600, 53604, 53608, 53609].includes(number ?? 0)) {
    throw new HttpError(404, 'CATALOG_NOT_FOUND', 'Dữ liệu danh mục không còn tồn tại.');
  }
  if ([53602, 53603, 53606, 53607].includes(number ?? 0)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Dữ liệu danh mục không còn hợp lệ tại thời điểm xử lý.');
  }
  if (number === 51002) {
    throw new HttpError(403, 'FORBIDDEN', 'Bạn không có quyền quản lý danh mục trong phạm vi này.');
  }
  throw error;
}

function roomView(room: Awaited<ReturnType<CatalogRepository['getRoom']>>) {
  if (!room) return null;
  const { id: _id, branchId: _branchId, ...view } = room;
  return view;
}

function serviceView(service: Awaited<ReturnType<CatalogRepository['getService']>>) {
  if (!service) return null;
  const { id: _id, category, specialty, ...view } = service;
  const { id: _categoryId, ...categoryView } = category;
  const specialtyView = specialty ? (({ id: _idValue, ...item }) => item)(specialty) : null;
  return { ...view, category: categoryView, specialty: specialtyView };
}

export class CatalogService {
  constructor(private readonly repository: CatalogRepository) {}

  publicBranches() { return this.repository.listPublicBranches(); }
  publicSpecialties() { return this.repository.listPublicSpecialties(); }

  async publicServices(branchPublicId: string, specialtyPublicId?: string, query?: string) {
    if (!await this.repository.resolveBranch(branchPublicId)) {
      throw new HttpError(404, 'BRANCH_NOT_FOUND', 'Không tìm thấy chi nhánh đang hoạt động.');
    }
    return this.repository.listPublicServices(branchPublicId, specialtyPublicId, query);
  }

  publicDoctors(branchPublicId?: string, specialtyPublicId?: string, servicePublicId?: string, query?: string) {
    return this.repository.listPublicDoctors(branchPublicId, specialtyPublicId, servicePublicId, query);
  }

  private async assertPermission(actor: ClinicPrincipal, branchId: number | null) {
    if (!await this.repository.hasPermission(actor.userId, branchId)) {
      throw new HttpError(403, 'FORBIDDEN', 'Bạn không có quyền quản lý danh mục trong phạm vi này.');
    }
  }

  private async branch(actor: ClinicPrincipal, publicId: string) {
    const branch = await this.repository.resolveBranch(publicId);
    if (!branch) throw new HttpError(404, 'BRANCH_NOT_FOUND', 'Không tìm thấy chi nhánh đang hoạt động.');
    await this.assertPermission(actor, branch.id);
    return branch;
  }

  async references(actor: ClinicPrincipal) {
    const branches = await this.repository.listManageableBranches(actor.userId);
    if (branches.length === 0) {
      throw new HttpError(403, 'FORBIDDEN', 'Bạn không có phạm vi quản lý danh mục.');
    }
    const [categories, specialties, canManageOrganizationServices] = await Promise.all([
      this.repository.listCategories(), this.repository.listSpecialties(),
      this.repository.hasPermission(actor.userId, null),
    ]);
    return {
      branches: branches.map(({ id: _id, ...item }) => item),
      categories: categories.map(({ id: _id, ...item }) => item),
      specialties: specialties.map(({ id: _id, ...item }) => item),
      canManageOrganizationServices,
    };
  }

  async rooms(actor: ClinicPrincipal, branchPublicId: string) {
    const branch = await this.branch(actor, branchPublicId);
    return (await this.repository.listRooms(branch.id)).map((room) => roomView(room)!);
  }

  async createRoom(actor: ClinicPrincipal, input: CreateRoomInput, requestId: string) {
    const branch = await this.branch(actor, input.branchPublicId);
    try {
      const publicId = await this.repository.createRoom(actor, branch.id, input, requestId);
      return roomView(await this.repository.getRoom(publicId))!;
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async updateRoom(actor: ClinicPrincipal, publicId: string, input: UpdateRoomInput, expectedVersion: string, requestId: string) {
    const room = await this.repository.getRoom(publicId);
    if (!room) throw new HttpError(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng.');
    await this.assertPermission(actor, room.branchId);
    try {
      await this.repository.updateRoom(actor, room, input, expectedVersion, requestId);
      return roomView(await this.repository.getRoom(publicId))!;
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async services(actor: ClinicPrincipal, branchPublicId: string) {
    const branch = await this.branch(actor, branchPublicId);
    return (await this.repository.listServices(branch.id)).map((service) => serviceView(service)!);
  }

  private async referencesForService(categoryPublicId: string, specialtyPublicId?: string) {
    const category = await this.repository.resolveCategory(categoryPublicId);
    if (!category) throw new HttpError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy nhóm dịch vụ.');
    const specialty = specialtyPublicId ? await this.repository.resolveSpecialty(specialtyPublicId) : null;
    if (specialtyPublicId && !specialty) {
      throw new HttpError(404, 'SPECIALTY_NOT_FOUND', 'Không tìm thấy chuyên khoa.');
    }
    return { category, specialty };
  }

  async createService(actor: ClinicPrincipal, branchPublicId: string, input: CreateServiceInput, requestId: string) {
    await this.assertPermission(actor, null);
    const branch = await this.branch(actor, branchPublicId);
    const { category, specialty } = await this.referencesForService(input.categoryPublicId, input.specialtyPublicId);
    try {
      const publicId = await this.repository.createService(actor, category.id, specialty?.id ?? null, input, requestId);
      return serviceView(await this.repository.getService(publicId, branch.id))!;
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async updateService(actor: ClinicPrincipal, publicId: string, branchPublicId: string, input: UpdateServiceInput, expectedVersion: string, requestId: string) {
    await this.assertPermission(actor, null);
    const branch = await this.branch(actor, branchPublicId);
    const service = await this.repository.getService(publicId, branch.id);
    if (!service) throw new HttpError(404, 'SERVICE_NOT_FOUND', 'Không tìm thấy dịch vụ.');
    const { category, specialty } = await this.referencesForService(input.categoryPublicId, input.specialtyPublicId);
    try {
      await this.repository.updateService(actor, service.id, category.id, specialty?.id ?? null, input, expectedVersion, requestId);
      return serviceView(await this.repository.getService(publicId, branch.id))!;
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async setBranchPrice(actor: ClinicPrincipal, publicId: string, input: SetBranchPriceInput, requestId: string) {
    const branch = await this.branch(actor, input.branchPublicId);
    const service = await this.repository.getService(publicId, branch.id);
    if (!service) throw new HttpError(404, 'SERVICE_NOT_FOUND', 'Không tìm thấy dịch vụ.');
    try {
      await this.repository.setBranchPrice(actor, branch.id, service.id, input, requestId);
      return serviceView(await this.repository.getService(publicId, branch.id))!;
    } catch (error) {
      mapDatabaseError(error);
    }
  }
}
