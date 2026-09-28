// ide/vscode/src/hover-commands.ts — M42.H2 + M42.H4 (issues #650, #652):
// hover link actions.
//
// The rich hover body composes command URIs — bb.openUsage, bb.openDefinition,
// bb.showAllUsages (H2, location args {file, line, character}) and the H4
// actions bb.openGraph / bb.openImpact / bb.showCallHierarchy whose args
// carry the SERVER-RESOLVED symbol identity {symbol, file, line, character}
// (issue #652 negative list: no client-side position guessing — the client
// executes what the index resolved). THIS module is the client-side owner:
//   - strict arg validation — an unparseable or non-file arg is an ERROR
//     surfaced to the user, never a silent no-op;
//   - bb.openUsage / bb.openDefinition reveal the target and move the cursor;
//   - bb.showAllUsages reveals the hovered symbol, then hands off to the
//     editor's NATIVE references surface;
//   - bb.openGraph / bb.openImpact open the graph / impact webviews; every
//     declared server failure (not indexed, unknown symbol, schema mismatch)
//     renders LOUDLY inside the panel — never a silent empty surface;
//   - bb.showCallHierarchy reveals the declaration then hands off to the
//     editor's NATIVE call hierarchy view.
//
// M55.V1 (owner live test, 2026-09-13): every symbol-scoped action ALSO
// answers a palette / context-menu invocation, where VS Code passes no
// arguments at all. Identity for that entry point is not guessed — it is the
// server-resolved identity at the cursor (resolveIdentityAtCursor asks the
// server's own hover; issue #652's no-client-guessing rule holds). Both entry
// points converge in hoverActionArgs, so one surface can never answer two
// ways.
//
// Pure arg parsing is exported headless so the E5 inner test and the drift
// gate can assert the exact contract without spawning a UI.

import * as vscode from "vscode"
import type { LanguageClient } from "vscode-languageclient/node"
// M44.U6 (issue #693): the ONE fallback decision core (vscode-free, pure).
import { parseUsageFallbackArgs, resolveUsageFallback, type NativeHandoffResult, type UsageFallbackArgs } from "./usage-fallback"
// M55.V1: the args core is a separate PURE module so a headless gate can fail
// it (script/m55/verify-action-args.ts). This file keeps the IO around it.
import {
  classifyActionArgs,
  identityFromHoverPayload,
  parseHoverActionArgs,
  parseHoverLinkArgs,
  type HoverActionArgs,
  type HoverLinkArgs,
} from "./hover-action-args"

// Re-exported for existing importers (the E5 inner test and the drift gates
// read these names through the extension's public surface).
export { normalizeArgs, parseHoverActionArgs, parseHoverLinkArgs } from "./hover-action-args"
export type { HoverActionArgs, HoverLinkArgs } from "./hover-action-args"

export const OPEN_USAGE = "bb.openUsage"
export const OPEN_DEFINITION = "bb.openDefinition"
export const SHOW_ALL_USAGES = "bb.showAllUsages"
// M42.H4 (issue #652): the hover action commands — same ids the server's
// rich hover composes (src/lsp/rich_hover.ts), drift-gated by the H4 suite.
export const OPEN_GRAPH = "bb.openGraph"
export const OPEN_IMPACT = "bb.openImpact"
export const SHOW_CALL_HIERARCHY = "bb.showCallHierarchy"

/** Deps for the webview-opening actions (thin client: the panels own the
 *  rendering; this module only hands them the real client).
 *
 *  getClient is a GETTER, never a captured value: activate() registers these
 *  handlers before startClient() assigns the module-level client, so a
 *  value capture freezes deps.client at null and every bb.openGraph /
 *  bb.openImpact panel renders "bb_lsp is not running" forever (owner test,
 *  2026-09-06). Each click resolves the client at click time. */
export interface HoverActionDeps {
  getClient: () => LanguageClient | null
  cspSource: string
}

/** M55.V1 (owner live test, 2026-09-13): a PALETTE / context-menu invocation
 *  carries no arguments, so every symbol-scoped action answered
 *  "malformed … link (no symbol target)" — a dead end on the editor's own
 *  command-discovery surface (the frames proved it: 4-open-in-graph and
 *  5-impact captured the error toast, not a panel).
 *
 *  The declared rule stands: identity comes from the INDEX, never from
 *  client-side position guessing (issue #652 negative list). So this fallback
 *  does not guess — it ASKS the server: the same `textDocument/hover` request
 *  the editor's own hover uses, at the cursor position, and reads the
 *  server-resolved identity out of `Hover.data.symbol`. The args produced here
 *  are the identical triple the hover's action link would have carried, so both
 *  entry points converge on one identity owner.
 *
 *  Absence is declared, never invented: a cursor that is not on an indexed
 *  symbol returns null and the caller reports it loudly. A not-running server
 *  also returns null (the caller's message names both remedies). */
export async function resolveIdentityAtCursor(deps: HoverActionDeps): Promise<HoverActionArgs | null> {
  const client = deps.getClient()
  const editor = vscode.window.activeTextEditor
  if (client === null || editor === undefined) return null
  const position = editor.selection.active
  let hover: unknown = null
  try {
    hover = await client.sendRequest<unknown>("textDocument/hover", {
      textDocument: { uri: editor.document.uri.toString() },
      position: { line: position.line, character: position.character },
    })
  } catch {
    return null
  }
  // The shape decision lives in the pure core (one owner, gateable).
  return identityFromHoverPayload(hover)
}

/** The ONE argument-source for the three symbol-scoped hover actions, so all
 *  three entry points answer alike (M55.V1: one surface, one answer):
 *
 *    1. link args present  -> strict parse (the hover-link click path);
 *    2. NO args at all     -> server-resolved identity at the cursor (palette
 *                             / context menu — the same identity the link
 *                             would have carried);
 *    3. args present but MALFORMED -> the declared loud error, unchanged (a
 *                             corrupted link is a defect, not a missing one).
 *
 *  Returns null in cases 2-with-unresolvable-cursor and 3, having already
 *  surfaced the reason; callers return their declared not-ok result. */
async function hoverActionArgs(raw: unknown, deps: HoverActionDeps, label: string): Promise<HoverActionArgs | null> {
  const arrival = classifyActionArgs(raw)
  if (arrival.kind === "link") return arrival.args
  // A delivered-but-unparseable payload is corruption: unchanged loud error.
  if (arrival.kind === "malformed") {
    void vscode.window.showErrorMessage(`bb_lsp: malformed ${label} link (no symbol target).`)
    return null
  }
  const fromCursor = await resolveIdentityAtCursor(deps)
  if (fromCursor !== null) return fromCursor
  void vscode.window.showErrorMessage(
    `bb_lsp: ${label} needs a symbol — put the cursor on an indexed symbol, or use the hover's own action link (the index decides the identity).`,
  )
  return null
}

/** Reveal a file at an LSP position and move the cursor there. */
export async function revealLocation(args: HoverLinkArgs): Promise<void> {
  const uri = vscode.Uri.file(args.file)
  const pos = new vscode.Position(args.line, args.character)
  const editor = await vscode.window.showTextDocument(uri, { preview: true, preserveFocus: false })
  const range = new vscode.Range(pos, pos)
  editor.selection = new vscode.Selection(pos, pos)
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
}

function register(ctx: vscode.ExtensionContext, deps: HoverActionDeps): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand(OPEN_USAGE, async (raw: unknown) => {
      const args = parseHoverLinkArgs(raw)
      if (args === null) {
        void vscode.window.showErrorMessage("bb_lsp: malformed bb.openUsage link (no navigation).")
        return { ok: false as const, reason: "malformed args" }
      }
      await revealLocation(args)
      return { ok: true as const, surface: "reveal", line: args.line }
    }),
    vscode.commands.registerCommand(OPEN_DEFINITION, async (raw: unknown) => {
      const args = parseHoverLinkArgs(raw)
      if (args === null) {
        void vscode.window.showErrorMessage("bb_lsp: malformed bb.openDefinition link (no navigation).")
        return { ok: false as const, reason: "malformed args" }
      }
      await revealLocation(args)
      return { ok: true as const, surface: "reveal", line: args.line }
    }),
    vscode.commands.registerCommand(SHOW_ALL_USAGES, async (raw: unknown) => {
      // M44.U6 (issue #693): the message-only dead end is a contract defect
      // (Understanding Rule 6). The decision comes from the ONE pure core:
      //   1. strict parse — the upgraded server link now carries the
      //      SERVER-RESOLVED identity {file, line, character, symbol};
      //   2. reveal first (always works), so even the degrade floor lands
      //      the cursor on the symbol;
      //   3. native references handoff is PRIMARY where it works — the
      //      three-way executor distinguishes missing/false (unavailable)
      //      from a thrown failure;
      //   4. on any native failure the hub usages surface opens for the
      //      SAME symbol (renderHubForPanel over the live client) — data,
      //      never a message.
      const args: UsageFallbackArgs | null = parseUsageFallbackArgs(raw)
      if (args === null) {
        // Legacy bare-location args (pre-U6 links) still parse through the
        // strict core only when a symbol is present. A malformed payload is
        // a loud declared error, never a silent no-op.
        const legacy = parseHoverLinkArgs(raw)
        if (legacy === null) {
          void vscode.window.showErrorMessage("bb_lsp: malformed bb.showAllUsages link (no navigation).")
          return { ok: false as const, reason: "malformed args" }
        }
        // No symbol in the args: reveal floor, declared (never message-only).
        await revealLocation(legacy)
        return { ok: true as const, surface: "reveal" as const, line: legacy.line }
      }
      await revealLocation(args)
      // Three-way native handoff (primary): the editor's own references view
      // takes the click where it works.
      let handoff: NativeHandoffResult = "ok"
      try {
        const taken = await vscode.commands.executeCommand("editor.action.referencesTrigger")
        if (taken === false) handoff = "unavailable"
      } catch {
        handoff = "threw"
      }
      const resolved = resolveUsageFallback(args, handoff)
      if (resolved.surface === "native-references") {
        return { ok: true as const, surface: "references" as const, line: args.line }
      }
      if (resolved.surface === "fallback-hub") {
        // THE FALLBACK: our usages list for the same symbol (the hub's
        // grouped usages surface). The native door stays primary; this door
        // means the user still lands on DATA, never on a bare message.
        try {
          const { renderHubForPanel } = await import("./hub-panel")
          const result = await renderHubForPanel({ symbol: resolved.symbol, file: args.file }, { client: deps.getClient(), cspSource: deps.cspSource })
          if (result.ok) {
            await vscode.window.showInformationMessage(`bb_lsp: native references view unavailable — showing the Backbencher usages list for ${resolved.symbol}.`)
            return { ok: true as const, surface: "usages-fallback" as const, symbol: resolved.symbol, rendered: true as const }
          }
          // The hub itself failed (declared reason) — surface it loudly.
          void vscode.window.showErrorMessage(`bb_lsp: usages fallback failed — ${result.error}`)
          return { ok: true as const, surface: "usages-fallback" as const, symbol: resolved.symbol, rendered: false as const, error: result.error }
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e)
          void vscode.window.showErrorMessage(`bb_lsp: usages fallback failed — ${reason}`)
          return { ok: true as const, surface: "usages-fallback" as const, symbol: resolved.symbol, rendered: false as const, error: reason }
        }
      }
      // Declared reveal floor (no symbol name to fall back to): the cursor
      // reveal already ran above — this is a success, not a dead end.
      if (resolved.surface === "reveal") {
        return { ok: true as const, surface: "reveal" as const, line: args.line }
      }
      // resolved.surface === "error" (unreachable after the args/nav checks;
      // kept total for the type) — the declared reason, verbatim.
      return { ok: false as const, reason: resolved.reason }
    }),
    // --- M42.H4: the hover actions -------------------------------------------
    // bb.openGraph: open the graph webview for the hovered symbol. The panel
    // renders server-declared failures (not indexed / unknown symbol) LOUDLY
    // in-UI — the command itself never no-ops silently.
    vscode.commands.registerCommand(OPEN_GRAPH, async (raw: unknown) => {
      // M55.V1: both entry points (hover link, palette) resolve here.
      const args = await hoverActionArgs(raw, deps, OPEN_GRAPH)
      if (args === null) {
        return { ok: false as const, reason: "no symbol target" }
      }
      // M42.H5: the graph action opens THE HUB (usages list/tree) — the M26
      // webview evolved into the usage/connections center (docs/m42/HUB.md).
      // The args' file (the symbol's declaration) feeds the whole-panel
      // staleness marker; the symbol name feeds the usages query.
      const { showHubPanel } = await import("./hub-panel")
      try {
        // Live client at click time (HoverActionDeps.getClient) — a null
        // client renders the panel's declared not-running error; a running
        // client renders the hub data. `rendered` reports which one the
        // panel actually shows (a click is not a success when its panel only
        // ever renders the banner).
        const opened = await showHubPanel({ symbol: args.symbol, file: args.file }, { client: deps.getClient(), cspSource: deps.cspSource }, ctx)
        const outcome = opened.outcome
        return outcome.ok
          ? { ok: true as const, surface: "graph" as const, symbol: args.symbol, rendered: true as const }
          : { ok: true as const, surface: "graph" as const, symbol: args.symbol, rendered: false as const, error: outcome.error }
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e)
        void vscode.window.showErrorMessage(`bb_lsp: bb.openGraph failed — ${reason}`)
        return { ok: false as const, reason }
      }
    }),
    // bb.openImpact: open the impact webview (W5 bounded reverse-dependency
    // set, truncation declared in-UI). Same honest-error surface as above.
    vscode.commands.registerCommand(OPEN_IMPACT, async (raw: unknown) => {
      const args = await hoverActionArgs(raw, deps, OPEN_IMPACT)
      if (args === null) {
        return { ok: false as const, reason: "no symbol target" }
      }
      const { showImpactPanel } = await import("./impact-panel")
      try {
        // Live client at click time (same rule as bb.openGraph above).
        // The hover's file identity rides along: same-name members
        // (constructors) resolve through it server-side (X1 closure).
        const opened = await showImpactPanel(args.symbol, { client: deps.getClient(), cspSource: deps.cspSource }, ctx, args.file)
        const outcome = opened.outcome
        return outcome.ok
          ? { ok: true as const, surface: "impact" as const, symbol: args.symbol, rendered: true as const }
          : { ok: true as const, surface: "impact" as const, symbol: args.symbol, rendered: false as const, error: outcome.error }
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e)
        void vscode.window.showErrorMessage(`bb_lsp: bb.openImpact failed — ${reason}`)
        return { ok: false as const, reason }
      }
    }),
    // bb.showCallHierarchy: reveal the declaration (always works), then hand
    // off to the editor's NATIVE call hierarchy view. Best-effort like
    // bb.showAllUsages — a fork without the native view still lands the
    // cursor (never silent about it).
    vscode.commands.registerCommand(SHOW_CALL_HIERARCHY, async (raw: unknown) => {
      const args = await hoverActionArgs(raw, deps, SHOW_CALL_HIERARCHY)
      if (args === null) {
        return { ok: false as const, reason: "no symbol target" }
      }
      await revealLocation(args)
      try {
        await vscode.commands.executeCommand("editor.showCallHierarchy")
      } catch {
        void vscode.window.showInformationMessage("bb_lsp: this editor has no native call hierarchy view; cursor placed on the symbol.")
      }
      return { ok: true as const, surface: "callHierarchy", symbol: args.symbol, line: args.line }
    }),
  )
}

export { register as registerHoverCommands }
