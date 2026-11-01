// src/cli/terminal-style.ts — one place that decides "may I use colour, and how?"
//
// WHY THIS EXISTS. Every line the CLI printed was the same weight: the progress/ETA line, the phase
// timings, the summary, a warning, and the (now quieted) per-file `[STORE]` trace all arrived in the same
// colour, so the messages a user most needs — ETA, expectations, the final verdict, warnings — were
// indistinguishable from noise. The fix has two halves, and this is the first: colour and emphasis are
// applied only when the stream is a terminal that wants them, never in a pipe, a CI log, or a file.
//
// The rules are the standard ones (and the ones tests can assert):
//   · NO_COLOR set (any value)        -> no ANSI, whatever the stream is
//   · FORCE_COLOR=1                   -> ANSI even if the stream is not a TTY (for tools that want it)
//   · otherwise                       -> ANSI only on a TTY
//
// Codes are SGR reset at the end of every styled fragment, so a half-styled line cannot leak colour into
// the next line, and an empty string is never wrapped.
const CODES: Record<string, string> = {
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
}

export interface ColorContext {
  /** TTY-ness of the stream the text will be written to. */
  isTTY?: boolean
  /** Environment; injectable so tests can assert the three rules without touching the process. */
  env?: Record<string, string | undefined>
}

/** True when ANSI SGR codes may be written for this destination. */
export function colorEnabled(ctx: ColorContext = {}): boolean {
  const env = ctx.env ?? process.env
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false
  if (env.FORCE_COLOR === "1" || env.FORCE_COLOR === "true") return true
  return ctx.isTTY === true
}

/** Apply SGR attributes to text when enabled; otherwise return it unchanged. */
export function style(text: string, kinds: readonly string[], enabled: boolean): string {
  if (!enabled || text.length === 0) return text
  let prefix = ""
  for (const kind of kinds) prefix += CODES[kind] ?? ""
  if (prefix.length === 0) return text
  return `${prefix}${text}${CODES.reset}`
}

/** Convenience wrappers for the handful of emphasis kinds the CLI uses. */
export function bold(text: string, enabled: boolean): string {
  return style(text, ["bold"], enabled)
}
export function dim(text: string, enabled: boolean): string {
  return style(text, ["dim"], enabled)
}
export function cyan(text: string, enabled: boolean): string {
  return style(text, ["cyan"], enabled)
}
export function green(text: string, enabled: boolean): string {
  return style(text, ["green"], enabled)
}
export function yellow(text: string, enabled: boolean): string {
  return style(text, ["yellow"], enabled)
}
export function red(text: string, enabled: boolean): string {
  return style(text, ["red"], enabled)
}
