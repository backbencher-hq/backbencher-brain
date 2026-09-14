// ide/vscode/src/status-model.ts — M25.E3 core (pure, headless-testable).
//
// The single owner of what the status surface may say (issue #501). Every
// rendered fact is derived from declared inputs; the render laws below ARE
// the honesty contract (§4.3) made mechanical:
//
//   law-stale:      staleness.stale === true  =>  staleBadge !== null
//                   (suppressing the badge is a verifier mutation, not an
//                   implementation choice)
//   law-unknown:    staleness.status === "unknown" is rendered as "unknown",
//                   never as "fresh" (silence is guilt — freshness.ts)
//   law-undeclared: a language with no declared claim level renders
//                   "undeclared", never an invented level
//   law-failure:    every failure state carries at least one action; a
//                   failure with no remediation path is a silent lie
//   law-identity:   the claim table is shipped with the extension and
//                   drift-gated against the generated tool doc
//                   (docs/m24/TOOL-DOC.md) by the E3 verifier — the UI can
//                   never claim more than the evidence chain recorded
//
// Rendering happens as data (StatusView). The extension layer maps it onto
// the status bar; E5 captures the in-editor renders as screenshots.

/** The launch set — single owner is src/lsp/launch_languages.ts (M29.R2:
 *  wave-1 adds javascript and python; this copy was a drift hazard). */
import { LAUNCH_LANGUAGES, type LaunchLanguage } from "../../../src/lsp/launch_languages"
export { LAUNCH_LANGUAGES }
export type { LaunchLanguage }

/**
 * Declared per-language claim levels, shipped with the extension.
 * DRIFT-GATED: script/m25/verify-status-surface.ts parses the generated
 * docs/m24/TOOL-DOC.md and fails this suite on any divergence. The value is
 * the WEAKEST feature level for the language (features are only as strong
 * as the weakest claim — contract §2).
 */
export const CLAIM_LEVELS: Record<LaunchLanguage, string> = {
  java: "I1",
  groovy: "I1",
  kotlin: "I1",
  scala: "I1",
  typescript: "I1",
  javascript: "I1",
  python: "I1",
  // Wave 2 (owner-approved 2026-09-14): the packs are authored and S1–S4
  // pass; the S5/S6 legs record the honest level per language on execution.
  // I1 is the claim the current evidence supports — never higher.
  zig: "I1",
  go: "I1",
  rust: "I1",
  c: "I1",
  cpp: "I1",
  vue: "I1",
  svelte: "I1",
}

/** Human-readable expansion of a claim level (contract §2 ladder). */
export function describeLevel(level: string): string {
  const known: Record<string, string> = {
    I0: "I0 — not claimed",
    I1: "I1 — protocol-passed",
    I2: "I2 — index-conformant",
    I3: "I3 — harness-verified",
    I4: "I4 — editor-verified",
    I5: "I5 — precision-verified",
  }
  return known[level] ?? level
}

/** The P2 stale marker shape (src/lsp/freshness.ts) — the wire contract. */
export interface StaleMarkerInput {
  stale: boolean
  status: "fresh" | "stale" | "missing" | "unknown"
  pendingReindex: boolean
  lastReindexAt?: string
}

export interface StatusInput {
  server: {
    up: boolean
    /** version from initialize result; null when not yet known */
    version: string | null
    versionOk: boolean
  }
  /** §7.3 activation budget facts; null when activation has not completed.
   * Law-budget (contract §6): a budget miss is SURFACED on the status
   * surface and degrades the badge — never hidden behind a clean check. */
  budget?: { activationMs: number; declaredBudgetMs: number; withinBudget: boolean } | null
  index: {
    phase: "idle" | "ready" | "awaiting-consent" | "estimating" | "indexing" | "cancelled" | "failed" | "no-index"
    filesDone?: number
    filesTotal?: number
  }
  /** staleness of the active file; null when no active editor */
  staleness: StaleMarkerInput | null
  /** active editor language id (null when no active editor) */
  language: string | null
}

export interface StatusAction {
  /** command title as shown to the user */
  title: string
  /** extension command id */
  command: string
}

export interface StatusView {
  /** status bar text (short) */
  badge: string
  /** the full honest surface, one line per fact */
  tooltipLines: string[]
  /** remediation actions for failure states (law-failure) */
  actions: StatusAction[]
  /** the stale marker text; law-stale: non-null whenever input staleness.stale */
  staleBadge: string | null
  /** per-language declared levels (law-undeclared: unknown languages absent) */
  perLanguage: Array<{ language: string; level: string; description: string }>
}

const STALE_BADGE = "⚠ stale"
const STALE_TEXT: Record<StaleMarkerInput["status"], string> = {
  fresh: "fresh (reindexed)",
  stale: "STALE — index behind your edits; results may be wrong until reindex",
  missing: "MISSING — file is not in the index; results are unavailable until reindex",
  unknown: "UNKNOWN — freshness could not be determined; treated as stale (silence is guilt)",
}

export function renderStatus(input: StatusInput): StatusView {
  const tooltipLines: string[] = []
  const actions: StatusAction[] = []

  // --- Server state ---------------------------------------------------------
  if (!input.server.up) {
    tooltipLines.push("server: DOWN — no LSP features")
    actions.push({ title: "Restart bb_lsp", command: "bbLsp.restartServer" })
  } else if (!input.server.versionOk) {
    tooltipLines.push(`server: running at ${input.server.version ?? "(version not reported)"} — INCOMPATIBLE with the declared minimum; features off`)
    actions.push({ title: "Restart bb_lsp", command: "bbLsp.restartServer" })
  } else {
    tooltipLines.push(`server: running (${input.server.version ?? "version not reported"})`)
  }

  // --- Index state ----------------------------------------------------------
  switch (input.index.phase) {
    case "idle":
      tooltipLines.push("index: not started — no detection has run yet")
      actions.push({ title: "Index now", command: "bbLsp.indexNow" })
      break
    case "ready":
      tooltipLines.push("index: ready")
      break
    case "indexing": {
      const done = input.index.filesTotal ? `${input.index.filesDone ?? 0}/${input.index.filesTotal}` : ""
      tooltipLines.push(`index: indexing ${done} — editor stays usable; features arrive when it lands`)
      actions.push({ title: "Index now", command: "bbLsp.indexNow" })
      break
    }
    case "estimating":
      tooltipLines.push("index: estimating workspace scale…")
      break
    case "awaiting-consent":
      tooltipLines.push("index: no index yet — consent pending")
      actions.push({ title: "Index now", command: "bbLsp.indexNow" })
      break
    case "no-index":
      tooltipLines.push("index: NO INDEX — features are off until an index exists")
      actions.push({ title: "Index now", command: "bbLsp.indexNow" })
      break
    case "cancelled":
      tooltipLines.push("index: cancelled — partial index on disk; reopen resumes without re-asking")
      actions.push({ title: "Index now", command: "bbLsp.indexNow" })
      break
    case "failed":
      tooltipLines.push("index: FAILED — see output channel for the honest error")
      actions.push({ title: "Index now", command: "bbLsp.indexNow" })
      break
  }

  // --- Staleness of the active file (law-stale, law-unknown) ----------------
  let staleBadge: string | null = null
  if (input.staleness !== null) {
    tooltipLines.push(`active file: ${STALE_TEXT[input.staleness.status]}`)
    if (input.staleness.stale) staleBadge = STALE_BADGE
  }

  // --- Activation budget (law-budget: a miss is surfaced, never hidden) -----
  const overBudget = input.budget !== null && input.budget !== undefined && input.budget.withinBudget === false
  if (input.budget !== null && input.budget !== undefined) {
    tooltipLines.push(
      overBudget
        ? `activation: ${input.budget.activationMs}ms — OVER the declared ${input.budget.declaredBudgetMs}ms budget (contract §7.3); startup was degraded, this is not a silent miss`
        : `activation: ${input.budget.activationMs}ms (declared budget ${input.budget.declaredBudgetMs}ms)`,
    )
  }

  // --- Per-language declared levels (law-undeclared) ------------------------
  const perLanguage = LAUNCH_LANGUAGES.filter((l) => CLAIM_LEVELS[l] !== undefined).map((l) => ({
    language: l,
    level: CLAIM_LEVELS[l],
    description: describeLevel(CLAIM_LEVELS[l]),
  }))
  if (input.language !== null) {
    const declared = (LAUNCH_LANGUAGES as readonly string[]).includes(input.language)
    tooltipLines.push(
      declared
        ? `this file (${input.language}): ${describeLevel(CLAIM_LEVELS[input.language as LaunchLanguage])}`
        : `this file (${input.language}): no declared claim level — features not offered`,
    )
  }

  // --- Badge ----------------------------------------------------------------
  let badge: string
  if (!input.server.up) badge = "$(error) bb: server down"
  else if (!input.server.versionOk) badge = "$(error) bb: version"
  else if (staleBadge !== null) badge = `$(warning) bb ${STALE_BADGE}`
  else if (overBudget) badge = "$(warning) bb: slow start"
  else if (input.index.phase === "indexing") badge = "$(sync~spin) bb: indexing"
  else if (input.index.phase === "no-index" || input.index.phase === "awaiting-consent" || input.index.phase === "estimating") badge = "$(circle-slash) bb: no index"
  else if (input.index.phase === "failed") badge = "$(error) bb: index failed"
  else if (input.index.phase === "cancelled") badge = "$(circle-slash) bb: paused"
  else badge = "$(check) bb"

  return { badge, tooltipLines, actions, staleBadge, perLanguage }
}
