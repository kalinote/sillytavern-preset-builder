export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  const message = error instanceof Error ? error.message : "Unknown server error";
  return new ApiError(500, "INTERNAL_ERROR", message);
}
