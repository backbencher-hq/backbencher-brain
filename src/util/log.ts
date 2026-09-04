// Structured logging — all output to stderr (stdout reserved for MCP JSON-RPC)
// Module-scoped loggers with level filtering

export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  SILENT = 5,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.TRACE]: "TRACE",
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
  [LogLevel.SILENT]: "SILENT",
}

let globalLevel: LogLevel = LogLevel.INFO

// M22.W1: honor BB_LOG_LEVEL from the environment at module load. The CLI sets
// it in its preAction hook (--verbose/--quiet), and pool workers inherit the
// parent's env so workers honor the same level instead of being hard-pinned.
if (process.env.BB_LOG_LEVEL) {
  const parsed = Number(process.env.BB_LOG_LEVEL)
  const byName = (LEVEL_LABELS as unknown as Record<string, LogLevel>)[process.env.BB_LOG_LEVEL.toUpperCase()]
  if (byName !== undefined) {
    globalLevel = byName
  } else if (!Number.isNaN(parsed) && parsed >= LogLevel.TRACE && parsed <= LogLevel.SILENT) {
    globalLevel = parsed as LogLevel
  }
}

export function setLogLevel(level: LogLevel): void {
  globalLevel = level
}

export function getLogLevel(): LogLevel {
  return globalLevel
}

export function setVerbose(verbose: boolean): void {
  globalLevel = verbose ? LogLevel.DEBUG : LogLevel.INFO
}

// M40.A9 purge: setQuiet() removed — zero callers in src/ or script/; the
// quiet path lives in BB_LOG_LEVEL (CLI --quiet, M22.W1).

export interface Logger {
  trace: (msg: string, context?: Record<string, any>) => void
  debug: (msg: string, context?: Record<string, any>) => void
  info: (msg: string, context?: Record<string, any>) => void
  warn: (msg: string, context?: Record<string, any>) => void
  error: (msg: string, context?: Record<string, any>) => void
}

function formatMessage(level: LogLevel, module: string, msg: string, context?: Record<string, any>): string {
  const now = new Date()
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`
  const label = LEVEL_LABELS[level]
  const ctx = context && Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : ""
  return `[${label}] [${time}] [${module}] ${msg}${ctx}`
}

export function createLogger(module: string): Logger {
  return {
    trace(msg, context) {
      if (globalLevel <= LogLevel.TRACE) {
        process.stderr.write(formatMessage(LogLevel.TRACE, module, msg, context) + "\n")
      }
    },
    debug(msg, context) {
      if (globalLevel <= LogLevel.DEBUG) {
        process.stderr.write(formatMessage(LogLevel.DEBUG, module, msg, context) + "\n")
      }
    },
    info(msg, context) {
      if (globalLevel <= LogLevel.INFO) {
        process.stderr.write(formatMessage(LogLevel.INFO, module, msg, context) + "\n")
      }
    },
    warn(msg, context) {
      if (globalLevel <= LogLevel.WARN) {
        process.stderr.write(formatMessage(LogLevel.WARN, module, msg, context) + "\n")
      }
    },
    error(msg, context) {
      if (globalLevel <= LogLevel.ERROR) {
        process.stderr.write(formatMessage(LogLevel.ERROR, module, msg, context) + "\n")
      }
    },
  }
}
