export type ApiError = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

export type HealthResponse = {
  status: 'ok' | 'ready';
  service: string;
};
