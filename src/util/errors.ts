// Typed error classes for consistent error handling
// All BrainErrors include: message, code, recoverable flag, context

export class BrainError extends Error {
  public readonly code: string
  public readonly recoverable: boolean
  public readonly context: Record<string, any>

  constructor(message: string, code: string, recoverable = false, context: Record<string, any> = {}) {
    super(message)
    this.name = "BrainError"
    this.code = code
    this.recoverable = recoverable
    this.context = context
  }
}

export class IndexingError extends BrainError {
  constructor(message: string, context: Record<string, any> = {}) {
    super(message, "INDEXING_ERROR", true, context)
    this.name = "IndexingError"
  }
}

export class DatabaseError extends BrainError {
  constructor(message: string, context: Record<string, any> = {}) {
    super(message, "DATABASE_ERROR", false, context)
    this.name = "DatabaseError"
  }
}

export class ToolError extends BrainError {
  constructor(message: string, code: string, context: Record<string, any> = {}) {
    super(message, code, true, context)
    this.name = "ToolError"
  }
}

export class WasmError extends BrainError {
  constructor(message: string, language: string, context: Record<string, any> = {}) {
    super(message, "WASM_ERROR", true, { ...context, language })
    this.name = "WasmError"
  }
}

// Standard error codes for MCP tool responses
export enum ErrorCode {
  NOT_FOUND = "NOT_FOUND",
  NOT_INDEXED = "NOT_INDEXED",
  INVALID_PARAMS = "INVALID_PARAMS",
  DB_ERROR = "DB_ERROR",
  TIMEOUT = "TIMEOUT",
  RATE_LIMITED = "RATE_LIMITED",
  INTERNAL = "INTERNAL",
}

// MCP-safe error serialization — never leaks stack traces to the LLM
export function serializeError(err: unknown): { code: string; message: string; recoverable: boolean } {
  if (err instanceof BrainError) {
    return {
      code: err.code,
      message: err.message,
      recoverable: err.recoverable,
    }
  }

  if (err instanceof Error) {
    // Don't leak stack traces or file paths
    return {
      code: ErrorCode.INTERNAL,
      message: err.message.split("\n")[0] || "Unknown error",
      recoverable: false,
    }
  }

  return {
    code: ErrorCode.INTERNAL,
    message: "Unknown error",
    recoverable: false,
  }
}
