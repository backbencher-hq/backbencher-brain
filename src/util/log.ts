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

export function setLogLevel(level: LogLevel): void {
  globalLevel = level
}

export function getLogLevel(): LogLevel {
  return globalLevel
}

export function setVerbose(verbose: boolean): void {
  globalLevel = verbose ? LogLevel.DEBUG : LogLevel.INFO
}

export function setQuiet(quiet: boolean): void {
  globalLevel = quiet ? LogLevel.WARN : LogLevel.INFO
}

interface Logger {
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
