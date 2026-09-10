import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestContext(request: Request, response: Response, next: NextFunction) {
  const suppliedRequestId = request.header('x-request-id');
  const requestId = suppliedRequestId && requestIdPattern.test(suppliedRequestId)
    ? suppliedRequestId
    : randomUUID();

  request.headers['x-request-id'] = requestId;
  response.locals.requestId = requestId;
  response.setHeader('x-request-id', requestId);
  next();
}
