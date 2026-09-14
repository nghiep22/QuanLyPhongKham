import { HttpError } from '../../shared/http/errors.js';
import type { BillingRepository } from './billing.types.js';

function errorNumber(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('number' in error && typeof error.number === 'number') return error.number;
  return 'originalError' in error ? errorNumber(error.originalError) : undefined;
}

export class BillingService {
  constructor(readonly repository: BillingRepository) {}
  async run<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) {
      const code = errorNumber(error);
      if ([51001, 51002].includes(code ?? 0))
        throw new HttpError(403, 'BILLING_FORBIDDEN', 'Bạn không có quyền thu ngân tại chi nhánh này.');
      if ([54001, 54002, 54003, 54007].includes(code ?? 0))
        throw new HttpError(404, 'BILLING_NOT_FOUND', 'Không tìm thấy tài nguyên hóa đơn.');
      if ([2601, 2627, 52051, 52052, 52053, 52055, 52056, 53401, 53402, 53405, 53406, 53409,
        53410, 53411, 53412, 53413, 53416, 53417, 53418, 53419, 53420, 53422, 53423, 53424,
        53425, 53426, 53427, 54005, 54006].includes(code ?? 0))
        throw new HttpError(409, 'BILLING_CONFLICT', 'Hóa đơn hoặc số dư vừa thay đổi hoặc chưa đủ điều kiện. Hãy tải lại.');
      if ([53400, 53403, 53404, 53407, 53408, 53414, 53415, 53421, 54004].includes(code ?? 0))
        throw new HttpError(400, 'BILLING_VALIDATION_ERROR', 'Dữ liệu hóa đơn hoặc thanh toán không hợp lệ.');
      throw error;
    }
  }
}
