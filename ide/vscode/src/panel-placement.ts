// ide/vscode/src/panel-placement.ts — M55.P1 (issue #776): the ONE
// panel-placement decision, vscode-free so the truth gate can execute it.
//
// Truth Rule 6 (§15): space is the user's. Before M55 every panel hardcoded
// `ViewColumn.Beside` and no panel set `preserveFocus`, so two hover actions in
// one session produced FOUR editor columns on a 1920px display
// (`app.ts │ hub(main) │ store.ts │ hub(Store)`) and each click moved the
// cursor out of the file. In the owner's real layout (explorer left, chat
// right, terminal bottom) every click shrank the editor — that is what "the
// middle window is tiny" actually was.
//
// Owner decision (2026-09-12): the default is a tab in the CURRENT editor
// group, no split. `bb.panelPlacement` exists so a user who prefers
// side-by-side can say so, and the value is remembered (settings are).
//
// Everything here is a pure decision over plain numbers. The `vscode` column
// enum is passed in by the caller, which is what keeps this module runnable in
// a gate — the same reason identity-label.ts exists.

/** The declared setting key (also the value the gate pins in the manifest). */
export const PANEL_PLACEMENT_SETTING = "bb.panelPlacement"

/** The values the setting accepts. */
export const PANEL_PLACEMENT_VALUES = ["activeGroup", "beside", "panel", "secondarySidebar"] as const
export type PanelPlacement = (typeof PANEL_PLACEMENT_VALUES)[number]

/** The owner's declared default (2026-09-12): no split, current group. */
export const DEFAULT_PANEL_PLACEMENT: PanelPlacement = "activeGroup"

/** The subset this extension can actually honor for a WEBVIEW panel.
 *  `vscode.window.createWebviewPanel` takes a `ViewColumn` (editor area) — it
 *  has no docked-area variant. Publishing a setting we silently ignore would
 *  be exactly the dishonesty this milestone exists to end, so the unimplemented
 *  values are accepted, resolved to the default, and DECLARED via `warning`. */
const IMPLEMENTED: readonly PanelPlacement[] = ["activeGroup", "beside"]

/** The editor's column numbers, injected so this module never imports vscode. */
export interface ColumnNumbers {
  Active: number
  Beside: number
}

export interface PlacementDecision {
  /** The column the panel is revealed in. */
  viewColumn: number
  /** Informational panels never move the cursor. A panel that takes keyboard
   *  input must pass `preserveFocus: false` explicitly — see resolvePanelPlacement. */
  preserveFocus: boolean
  /** The mode actually honored (never a silent substitution for a bad value). */
  mode: PanelPlacement
  /** Set when the requested value could not be honored verbatim. */
  warning?: string
}

/** Resolve the setting into a placement. Total by construction: an unknown or
 *  unimplemented value falls back to the declared default AND says so. */
export function resolvePanelPlacement(
  setting: unknown,
  columns: ColumnNumbers,
  opts: { takesKeyboardInput?: boolean } = {},
): PlacementDecision {
  const requested = typeof setting === "string" ? (setting as PanelPlacement) : undefined
  const known = requested !== undefined && (PANEL_PLACEMENT_VALUES as readonly string[]).includes(requested)
  if (!known) {
    return {
      viewColumn: columns.Active,
      preserveFocus: opts.takesKeyboardInput !== true,
      mode: DEFAULT_PANEL_PLACEMENT,
      ...(requested === undefined
        ? {}
        : { warning: `bb.panelPlacement '${String(requested)}' is not a declared value (${PANEL_PLACEMENT_VALUES.join(" | ")}) — using ${DEFAULT_PANEL_PLACEMENT}` }),
    }
  }
  if (!IMPLEMENTED.includes(requested)) {
    return {
      viewColumn: columns.Active,
      preserveFocus: opts.takesKeyboardInput !== true,
      mode: DEFAULT_PANEL_PLACEMENT,
      warning: `bb.panelPlacement '${requested}' is not implemented for webview panels (editor-area columns only) — using ${DEFAULT_PANEL_PLACEMENT}`,
    }
  }
  return {
    viewColumn: requested === "beside" ? columns.Beside : columns.Active,
    preserveFocus: opts.takesKeyboardInput !== true,
    mode: requested,
  }
}

/** One panel per key: an already-open panel is REUSED and updated, never
 *  duplicated (the "no column growth" half of the rule). The registry owns the
 *  bookkeeping so no panel file invents its own. */
export class PanelRegistry<T extends { reveal?: (...args: never[]) => void }> {
  private readonly open = new Map<string, T>()

  /** The live panel for a key, or null. */
  get(key: string): T | null {
    return this.open.get(key) ?? null
  }

  /** Register (or replace) the panel for a key. */
  set(key: string, panel: T): void {
    this.open.set(key, panel)
  }

  /** Drop a key (the panel was disposed) — no stale handle is kept. */
  delete(key: string): void {
    this.open.delete(key)
  }

  /** How many panels the extension currently holds for this kind. */
  get size(): number {
    return this.open.size
  }
}

/** The reuse key for a panel kind + symbol + defining file. Same symbol from a
 *  different file is a different panel (a repo has one `constructor` per
 *  class); the same symbol twice is the SAME panel.
 *
 *  M55.V1: "status" joins the kinds. It is not symbol-scoped (the status
 *  surface describes the SERVER and the INDEX, not a symbol), so callers pass
 *  a fixed symbol — the point is that it goes through THIS key function like
 *  every other panel, so "one panel per surface, never a second column" holds
 *  for it too instead of being re-implemented locally. */
export function panelKey(kind: "hub" | "impact" | "graph" | "status", symbol: string, file?: string): string {
  return file === undefined || file === "" ? `${kind}:${symbol}` : `${kind}:${symbol}:${file}`
}
