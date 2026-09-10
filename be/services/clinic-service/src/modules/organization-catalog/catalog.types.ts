import type { ClinicPrincipal } from '../identity/index.js';

export const roomTypes = ['CONSULTATION', 'PROCEDURE', 'LAB', 'IMAGING', 'PHARMACY', 'OTHER'] as const;
export const serviceTypes = ['CONSULTATION', 'LAB', 'IMAGING', 'PROCEDURE', 'VACCINATION', 'OTHER'] as const;
export type RoomType = typeof roomTypes[number];
export type ServiceType = typeof serviceTypes[number];

export type BranchReference = { id: number; publicId: string; code: string; name: string };
export type CategoryReference = { id: number; publicId: string; code: string; name: string };
export type SpecialtyReference = { id: number; publicId: string; code: string; name: string };

export type PublicBranch = Omit<BranchReference, 'id'> & {
  phone: string | null;
  email: string | null;
  addressLine: string;
  ward: string | null;
  district: string | null;
  province: string | null;
  timezoneName: string;
  bookingHorizonDays: number;
  onlineHoldMinutes: number;
  cancellationDeadlineMinutes: number;
};

export type PublicSpecialty = Omit<SpecialtyReference, 'id'> & { description: string | null };

export type PublicService = {
  publicId: string;
  code: string;
  name: string;
  type: ServiceType;
  category: Omit<CategoryReference, 'id'>;
  specialty: Omit<SpecialtyReference, 'id'> | null;
  durationMinutes: number;
  requiresDoctor: boolean;
  price: { amount: string; currency: 'VND'; effectiveFrom: string };
};

export type PublicDoctor = {
  publicId: string;
  fullName: string;
  academicTitle: string | null;
  biography: string | null;
  defaultSlotMinutes: number;
  branches: Array<{ publicId: string; name: string }>;
  specialties: Array<{ publicId: string; name: string }>;
  servicePublicIds: string[];
};

export type Room = {
  id: number;
  publicId: string;
  branchId: number;
  branch: Omit<BranchReference, 'id'>;
  code: string;
  name: string;
  type: RoomType;
  floorNo: number | null;
  capacity: number;
  isActive: boolean;
  rowVersion: string;
};

export type BranchPrice = {
  publicId: string;
  amount: string;
  currency: 'VND';
  effectiveFrom: string;
  effectiveTo: string | null;
  isAvailable: boolean;
};

export type CatalogService = {
  id: number;
  publicId: string;
  code: string;
  name: string;
  type: ServiceType;
  category: CategoryReference;
  specialty: SpecialtyReference | null;
  durationMinutes: number;
  basePrice: string;
  requiresDoctor: boolean;
  isActive: boolean;
  branchPrices: BranchPrice[];
  rowVersion: string;
};

export type CreateRoomInput = {
  branchPublicId: string;
  code: string;
  name: string;
  type: RoomType;
  floorNo?: number;
  capacity: number;
};
export type UpdateRoomInput = Omit<CreateRoomInput, 'branchPublicId' | 'code'> & { isActive: boolean };

export type CreateServiceInput = {
  categoryPublicId: string;
  specialtyPublicId?: string;
  code: string;
  name: string;
  type: ServiceType;
  durationMinutes: number;
  basePrice: string;
  requiresDoctor: boolean;
};
export type UpdateServiceInput = Omit<CreateServiceInput, 'code'> & { isActive: boolean };
export type SetBranchPriceInput = {
  branchPublicId: string;
  amount: string;
  effectiveFrom: string;
  isAvailable: boolean;
};

export interface CatalogRepository {
  listPublicBranches(): Promise<PublicBranch[]>;
  listPublicSpecialties(): Promise<PublicSpecialty[]>;
  listPublicServices(branchPublicId: string, specialtyPublicId?: string, query?: string): Promise<PublicService[]>;
  listPublicDoctors(branchPublicId?: string, specialtyPublicId?: string, servicePublicId?: string, query?: string): Promise<PublicDoctor[]>;
  hasPermission(actorUserId: number, branchId: number | null): Promise<boolean>;
  listManageableBranches(actorUserId: number): Promise<BranchReference[]>;
  listCategories(): Promise<CategoryReference[]>;
  listSpecialties(): Promise<SpecialtyReference[]>;
  resolveBranch(publicId: string): Promise<BranchReference | null>;
  resolveCategory(publicId: string): Promise<CategoryReference | null>;
  resolveSpecialty(publicId: string): Promise<SpecialtyReference | null>;
  listRooms(branchId: number): Promise<Room[]>;
  getRoom(publicId: string): Promise<Room | null>;
  createRoom(actor: ClinicPrincipal, branchId: number, input: CreateRoomInput, requestId: string): Promise<string>;
  updateRoom(actor: ClinicPrincipal, room: Room, input: UpdateRoomInput, expectedVersion: string, requestId: string): Promise<void>;
  listServices(branchId: number): Promise<CatalogService[]>;
  getService(publicId: string, branchId: number): Promise<CatalogService | null>;
  createService(actor: ClinicPrincipal, categoryId: number, specialtyId: number | null, input: CreateServiceInput, requestId: string): Promise<string>;
  updateService(actor: ClinicPrincipal, serviceId: number, categoryId: number, specialtyId: number | null, input: UpdateServiceInput, expectedVersion: string, requestId: string): Promise<void>;
  setBranchPrice(actor: ClinicPrincipal, branchId: number, serviceId: number, input: SetBranchPriceInput, requestId: string): Promise<void>;
}
