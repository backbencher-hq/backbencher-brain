// ide/vscode/src/usage-fallback.ts — M44.U6 pure decision core (issue #693).
//
// The SINGLE owner of the "show all usages" fallback decision (Understanding
// Rule 6: dead ends are defects). VS Code-free and headless-testable — the
// command handler in hover-commands.ts consumes this; the E5 in-editor leg
// exercises the same function through the built bundle.
//
// Contract (declared, never guessed):
//   native:   the editor's references surface is PRIMARY where it works. The
//             handler tries `editor.action.referencesTrigger` first and only
//             consults this core when the handoff is unavailable (command
//             missing, executes to false, or THROWS).
//   fallback: when the native handoff fails, the hub usages surface for the
//             SAME symbol opens — the server-resolved usages list (renderHub),
//             never a message-only dead end.
//   declared: every outcome names its surface so the caller (and every test)
//             can assert which one the user actually landed on.
//
// Every return carries `surface`:
//   "native-references"  — the editor's own references view took the click.
//   "fallback-hub"       — our usages list opened for the symbol.
//   "reveal"             — degrade floor: only the cursor-on-symbol reveal
//                          succeeded AND the symbol name was unknown to the
//                          fallback (reveal-only without a name is still a
//                          declared outcome, never a bare message).
//   "error"              — malformed input: loud declared failure.

/** Args the fallback decision needs. The hover's `show all usages` link
 *  carries the SERVER-RESOLVED identity {file, line, character, symbol}
 *  (U6 upgrade: symbol joins the location args so the fallback can query
 *  the usages surface without client-side guessing — issue #652 rule). */
export interface UsageFallbackArgs {
  file: string
  line: number
  character: number
  symbol: string
}

export type UsageFallbackSurface = "native-references" | "fallback-hub" | "reveal" | "error"

export type UsageFallbackOutcome =
  | { surface: "native-references" }
  | { surface: "fallback-hub"; symbol: string }
  | { surface: "reveal" }
  | { surface: "error"; reason: string }

/** Outcome of attempting the native handoff (executor-provided — the pure
 *  core never imports the editor; the handler adapts, the core decides). */
export type NativeHandoffResult = "ok" | "unavailable" | "threw"

/** Strict parse of the command args. Null = malformed (the handler surfaces
 *  a loud declared error, never a silent no-op). */
export function parseUsageFallbackArgs(raw: unknown): UsageFallbackArgs | null {
  if (raw === null || typeof raw !== "object") return null
  const a = raw as Record<string, unknown>
  if (typeof a.file !== "string" || a.file.length === 0) return null
  if (typeof a.line !== "number" || !Number.isInteger(a.line) || a.line < 0) return null
  if (typeof a.character !== "number" || !Number.isInteger(a.character) || a.character < 0) return null
  if (typeof a.symbol !== "string" || a.symbol.length === 0) return null
  return { file: a.file, line: a.line, character: a.character, symbol: a.symbol }
}

/** The ONE fallback decision (issue #693). `handoff` is the EXECUTED result
 *  of the native referencesTrigger attempt, decided by the caller's executor
 *  wrapper:
 *    ok           → native-references (the primary door worked).
 *    unavailable  → the command does not exist / executed to false.
 *    threw        → the command exists but its execution threw.
 *  For unavailable/threw, the hub usages surface opens for the symbol —
 *  UNLESS the symbol name is absent (legacy clients), where the outcome
 *  degrades to the declared reveal floor rather than a message-only dead
 *  end. Malformed args are a declared error before any attempt. */
export function resolveUsageFallback(args: UsageFallbackArgs | null, handoff: NativeHandoffResult): UsageFallbackOutcome {
  if (args === null) return { surface: "error", reason: "malformed args" }
  if (handoff === "ok") return { surface: "native-references" }
  if (args.symbol.length > 0) return { surface: "fallback-hub", symbol: args.symbol }
  return { surface: "reveal" }
}
