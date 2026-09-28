// ide/vscode/src/hover-action-args.ts — M55.V1: the PURE argument core of the
// hover actions (vscode-free, headless-gateable — script/m55/verify-action-args.ts).
//
// Why this file exists (owner live test, 2026-09-13): the actions worked from
// the hover's own link, but a PALETTE / context-menu invocation — VS Code
// passes no arguments there — answered "malformed … link (no symbol target)"
// on all three symbol-scoped commands. The frames proved it (flows 4 and 5
// captured the error toast instead of a panel). The fix must not break the
// declared rule that the client never guesses identity (issue #652), so the
// answer is: ask the server, and keep every decision here pure so a gate can
// fail it.
//
// Owners (all of them, one file):
//   normalizeArgs            — whatever VS Code delivers -> a plain object
//   parseHoverLinkArgs       — location args (H2: usage / definition)
//   parseHoverActionArgs     — SERVER-RESOLVED identity args (H4: actions)
//   classifyActionArgs       — which ARRIVAL the command is answering
//   identityFromHoverPayload — the server's hover payload -> identity args
//
// NOTE ON DRIFT: `HoverActionArgs` here mirrors the wire shape the server
// composes in src/lsp/rich_hover.ts (and its uri builders). The two are kept
// in step by script/m42/verify-hover-actions.ts (R6) and read end-to-end by
// script/m55/verify-action-args.ts.

/** Location args carried by the H2 links (bb.openUsage / bb.openDefinition). */
export interface HoverLinkArgs {
  file: string
  line: number
  character: number
}

/** Action args carried by the H4 links: the SERVER-RESOLVED identity — the
 *  symbol name plus the index-stored declaration location. */
export interface HoverActionArgs {
  symbol: string
  file: string
  line: number
  character: number
}

/** Normalize whatever VS Code delivers for a command-URI click into the args
 *  object: an object (modern delivery), a JSON string, or the first element
 *  of an args array (array delivery). Strict afterwards: rejects any payload
 *  that is not an object with a string file and integer line/character. */
export function normalizeArgs(raw: unknown): Record<string, unknown> | null {
  let a: unknown = raw
  if (typeof a === "string") {
    try {
      a = JSON.parse(a)
    } catch {
      return null
    }
  }
  if (Array.isArray(a)) a = a[0]
  if (typeof a !== "object" || a === null) return null
  return a as Record<string, unknown>
}

export function parseHoverLinkArgs(raw: unknown): HoverLinkArgs | null {
  const a = normalizeArgs(raw)
  if (a === null) return null
  if (typeof a.file !== "string" || a.file.length === 0) return null
  if (typeof a.line !== "number" || !Number.isInteger(a.line) || a.line < 0) return null
  if (typeof a.character !== "number" || !Number.isInteger(a.character) || a.character < 0) return null
  return { file: a.file, line: a.line, character: a.character }
}

// M42.H4: action args = the SERVER-RESOLVED symbol identity (name + the
// index-stored declaration location). Strict parse mirrors H2's law.
export function parseHoverActionArgs(raw: unknown): HoverActionArgs | null {
  const a = normalizeArgs(raw)
  if (a === null) return null
  if (typeof a.symbol !== "string" || a.symbol.length === 0) return null
  if (typeof a.file !== "string" || a.file.length === 0) return null
  if (typeof a.line !== "number" || !Number.isInteger(a.line) || a.line < 0) return null
  if (typeof a.character !== "number" || !Number.isInteger(a.character) || a.character < 0) return null
  return { symbol: a.symbol, file: a.file, line: a.line, character: a.character }
}

/** Which ARRIVAL is this invocation? Three cases, all declared:
 *
 *    "link"      — a parseable payload: the hover-link click path (H4).
 *    "absent"    — NO payload at all: a palette / context-menu invocation.
 *                  That is absence, not corruption, and it has a real answer
 *                  (ask the server for the identity at the cursor).
 *    "malformed" — a payload arrived and cannot be parsed: a corrupted link.
 *                  Its answer is a loud declared error, never a fallback —
 *                  a broken link must not be papered over with a guess about
 *                  where the cursor happens to be.
 *
 *  `null` and `undefined` are absence; anything else is a delivered payload. */
export type ActionArgsArrival =
  | { kind: "link"; args: HoverActionArgs }
  | { kind: "absent" }
  | { kind: "malformed" }

export function classifyActionArgs(raw: unknown): ActionArgsArrival {
  const args = parseHoverActionArgs(raw)
  if (args !== null) return { kind: "link", args }
  if (raw === undefined || raw === null) return { kind: "absent" }
  return { kind: "malformed" }
}

/** The server's hover payload's structured identity slot, as src/lsp/server.ts
 *  composes it: `{ provenance, symbol }`, where `symbol` is the
 *  SymbolHoverData whose `name` / `filePath` / `definition` triple is EXACTLY
 *  what the actions row's command URIs carry (src/lsp/hover.ts calls
 *  `actionsSection(symbol.name, file.path, range.start.line,
 *  range.start.character)`). Reading identity from here is not guessing: it is
 *  the index's own resolution, handed back over the same request the editor's
 *  hover uses. */
export function identityFromHoverPayload(hover: unknown): HoverActionArgs | null {
  if (typeof hover !== "object" || hover === null) return null
  const data = (hover as { data?: unknown }).data
  if (typeof data !== "object" || data === null) return null
  const sym = (data as { symbol?: unknown }).symbol
  if (typeof sym !== "object" || sym === null) return null
  const { name, filePath, definition } = sym as { name?: unknown; filePath?: unknown; definition?: unknown }
  if (typeof name !== "string" || name.length === 0) return null
  if (typeof filePath !== "string" || filePath.length === 0) return null
  // A symbol with no resolvable declaration has no clickable target: the
  // server itself renders NO actions row for it (§12.1 nothing unclickable),
  // so absence here is consistent, not a gap.
  if (typeof definition !== "object" || definition === null) return null
  const { line, character } = definition as { line?: unknown; character?: unknown }
  if (typeof line !== "number" || !Number.isInteger(line) || line < 0) return null
  if (typeof character !== "number" || !Number.isInteger(character) || character < 0) return null
  return { symbol: name, file: filePath, line, character }
}
