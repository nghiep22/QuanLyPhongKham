import { HttpError } from '../../shared/http/errors.js';
import type { PharmacyRepository } from './pharmacy.types.js';

function errorNumber(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('number' in error && typeof error.number === 'number') return error.number;
  return 'originalError' in error ? errorNumber(error.originalError) : undefined;
}

export class PharmacyService {
  constructor(readonly repository: PharmacyRepository) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) {
      const code = errorNumber(error);
      if (code === 51001 || code === 51002 || [53301, 53303, 53306, 53312].includes(code ?? 0))
        throw new HttpError(403, 'PHARMACY_FORBIDDEN', 'Bạn không có quyền thao tác tại chi nhánh hoặc đơn thuốc này.');
      if ([53902, 53903, 53905, 53907, 53908, 53911, 53913, 53914, 53915, 53916].includes(code ?? 0))
        throw new HttpError(404, 'PHARMACY_NOT_FOUND', 'Không tìm thấy tài nguyên nhà thuốc.');
      if (code === 53910 || code === 53923)
        throw new HttpError(409, 'PHARMACY_ALLERGY_CONFLICT', code === 53910
          ? 'Thuốc trùng dị ứng đã ghi nhận. Bác sĩ cần quyền override và lý do tối thiểu 10 ký tự.'
          : 'Thuốc trùng dị ứng đã ghi nhận. Dược sĩ cần xác nhận lại và nhập lý do tối thiểu 10 ký tự.');
      if ([2601, 2627, 53912, 53917, 53919, 53920, 53302, 53304, 53307, 53308, 53309, 53313,
        53314, 53315, 53317, 53318, 53319, 53320, 53321, 53322, 53323, 53325, 53326,
        53327, 53328, 53329, 53330, 53331, 53332, 53333, 53334, 53335, 53336, 53340,
        53341, 53342, 53344, 53345, 53347, 53348, 53353, 53922, 52045, 52046, 52047, 52048,
        52049, 52063, 52064].includes(code ?? 0))
        throw new HttpError(409, 'PHARMACY_CONFLICT',
          'Trạng thái đơn, lô hoặc tồn kho vừa thay đổi hoặc chưa đủ điều kiện. Hãy tải lại.');
      if ([53904, 53906, 53909, 53918, 53921, 53300, 53305, 53310, 53311, 53316, 53324,
        53337, 53338, 53343, 53346, 53352].includes(code ?? 0))
        throw new HttpError(400, 'PHARMACY_VALIDATION_ERROR', 'Dữ liệu nhà thuốc không hợp lệ.');
      throw error;
    }
  }
}
