import { HttpError } from '../../shared/http/errors.js';
import type { ReportsRepository } from './reports.types.js';

function errorNumber(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('number' in error && typeof error.number === 'number') return error.number;
  return 'originalError' in error ? errorNumber(error.originalError) : undefined;
}

export class ReportsService {
  constructor(readonly repository: ReportsRepository) {}
  async run<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) {
      const code = errorNumber(error);
      if ([51001, 51002, 54102].includes(code ?? 0))
        throw new HttpError(403, 'REPORT_FORBIDDEN', 'Bạn không có quyền xem báo cáo này tại chi nhánh đã chọn.');
      if (code === 54101) throw new HttpError(404, 'REPORT_BRANCH_NOT_FOUND', 'Không tìm thấy chi nhánh báo cáo.');
      if (code === 54100) throw new HttpError(400, 'REPORT_RANGE_INVALID', 'Khoảng báo cáo phải hợp lệ và không quá 366 ngày.');
      throw error;
    }
  }
}
