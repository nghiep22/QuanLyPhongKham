import type { ErrorRequestHandler, RequestHandler } from 'express';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFoundHandler: RequestHandler = (_request, _response, next) => {
  next(new HttpError(404, 'ROUTE_NOT_FOUND', 'Không tìm thấy API được yêu cầu.'));
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const httpError = error instanceof HttpError
    ? error
    : new HttpError(500, 'INTERNAL_ERROR', 'Hệ thống không thể xử lý yêu cầu.');

  if (httpError.status >= 500) response.locals.err = error;
  response.status(httpError.status).json({
    error: {
      code: httpError.code,
      message: httpError.message,
      ...(httpError.details ? { details: httpError.details } : {}),
    },
    requestId: response.locals.requestId,
  });
};
