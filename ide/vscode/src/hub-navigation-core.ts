// ide/vscode/src/hub-navigation-core.ts — M42.H6 (issue #654): the PURE,
// headless-testable decision core of the hub→editor navigation handler.
//
// ZERO editor imports (only the ONE protocol owner). The vscode bindings
// live in hub-navigation.ts; this core is what the verifier + the mutation
// suite exercise, and what the editor leg drives through the same exported
// executeHubMessage function (one code path, two doors).
//
//   validateTargetAgainstWorkspace — fabricated-path guard (pure over
//     injected roots/exists).
//   executeHubMessage — validate → guard → reveal/label/refresh/ack.
//     Side effects arrive via injected deps, so a stub editor can record
//     what happened (and prove what did NOT: a rejected message never
//     touches the editor).

import {
  ackError,
  ackOk,
  HUB_PROTOCOL_ERROR_PREFIX,
  validateHubMessage,
  type HubAckMessage,
  type HubMessage,
} from "../../../src/lsp/hub_protocol"

import path from "node:path"

export type WorkspaceRoot = { path: string }

export type ResolvedTarget =
  | { ok: true; file: string }
  | { ok: false; error: string }

/** Pure fabricated-path guard + resolver. The hub rows carry the index's
 *  STORED path — relative to the workspace root (what analyzers write), so
 *  a relative target is resolved against each open root (first root whose
 *  candidate exists on disk wins); an absolute target must sit inside a root.
 *  Whatever does not resolve inside the workspace is a declared error — a
 *  fabricated path can never reach the editor. Returns the RESOLVED absolute
 *  file the reveal must use (never the raw string). */
export function resolveNavigateTarget(
  target: { file: string; line: number },
  roots: WorkspaceRoot[],
  exists: (p: string) => boolean,
): ResolvedTarget {
  if (typeof target.file !== "string" || target.file.length === 0) {
    return { ok: false, error: `${HUB_PROTOCOL_ERROR_PREFIX} navigate target file is empty` }
  }
  if (roots.length === 0) {
    return { ok: false, error: `${HUB_PROTOCOL_ERROR_PREFIX} no workspace is open — nothing to reveal into` }
  }
  const isAbsolute = path.isAbsolute(target.file)
  for (const r of roots) {
    const root = r.path.replace(/[\/\\]+$/, "")
    if (!root) continue
    const candidate = isAbsolute ? target.file : path.join(root, target.file)
    // Containment: the candidate must be the root or strictly inside it
    // (prefix-boundary safe — a sibling of the root never passes).
    const inside = candidate === root || candidate.startsWith(root + path.sep)
    if (!inside) continue
    if (isAbsolute && !inside) continue
    if (exists(candidate)) return { ok: true, file: candidate }
    if (isAbsolute) {
      return { ok: false, error: `${HUB_PROTOCOL_ERROR_PREFIX} navigate target ${target.file} does not exist on disk` }
    }
    // relative candidate missing in THIS root — try the next root
  }
  return {
    ok: false,
    error: `${HUB_PROTOCOL_ERROR_PREFIX} navigate target ${target.file} does not resolve inside any open workspace (fabricated path rejected)`,
  }
}

export interface HubNavigationDeps {
  workspaceRoots: WorkspaceRoot[]
  exists: (p: string) => boolean
  /** Reveal a file at a 0-based LSP position; returns the line the cursor
   *  actually landed on (the editor leg asserts this). */
  reveal: (file: string, line: number, character: number | undefined, symbolId: string | undefined) => Promise<{ file: string; line: number }>
  /** Surface a stale label (status bar / message) — called only when the
   *  click carried staleness. */
  staleSurface: (status: string) => void
}

export interface HubNavigationOutcome {
  ack: HubAckMessage
  /** What actually happened (evidence for the editor leg). */
  action: "navigate" | "refresh" | "none"
  revealed?: { file: string; line: number }
  staleLabeled?: boolean
}

/** Execute one webview message against the editor. Validate → guard →
 *  act — in that order, so a rejected message NEVER touches the editor
 *  (a fabricated path or wrong version cannot reveal). */
export async function executeHubMessage(
  raw: unknown,
  deps: HubNavigationDeps,
  refresh: ((msg: Extract<HubMessage, { type: "requestRefresh" }>) => Promise<void>) | undefined,
): Promise<HubNavigationOutcome> {
  const parsed = validateHubMessage(raw)
  if (!parsed.ok) return { ack: ackError(parsed.error), action: "none" }
  const msg = parsed.message
  if (msg.type === "navigate") {
    const resolved = resolveNavigateTarget(msg.target, deps.workspaceRoots, deps.exists)
    if (!resolved.ok) return { ack: ackError(resolved.error), action: "none" }
    const revealed = await deps.reveal(resolved.file, msg.target.line, msg.target.character, msg.target.symbolId)
    let staleLabeled = false
    if (msg.staleness?.stale === true) {
      deps.staleSurface(msg.staleness.status)
      staleLabeled = true
    }
    return { ack: ackOk(), action: "navigate", revealed, staleLabeled }
  }
  if (msg.type === "requestRefresh") {
    if (refresh !== undefined) await refresh(msg)
    return { ack: ackOk(), action: "refresh" }
  }
  // ack messages are editor→webview; a webview echoing one is ignored, not
  // an error (no loop).
  return { ack: ackError(`${HUB_PROTOCOL_ERROR_PREFIX} ack is editor→webview only`), action: "none" }
}
