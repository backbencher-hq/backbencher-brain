// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_health: it refuses options the chosen
// call cannot honour, calls the health provider once, and shapes the result
// (text report, or `{ health, history }` JSON when history=true) plus the
// machine-readable `healthy` channel.
// WHICH TOOL IT SERVES — bb_health (mutability read, requiresIndex false,
//   behaviours: status, refresh).
// WHY IT IS SHAPED THIS WAY — the answer to "is the index healthy?" is a
// REPORT, not a failure: an error-severity finding sets `healthy:false` but
// never `isError`, because the tool did its job. Wrong INPUT is different and
// is refused loudly (`isError:true`). The refusals here are the
// option/behaviour mismatches validation cannot see: a page size with no page
// request, a wait with no refresh, a sample size with a complete census — each
// names the accepted form so the next call is correct.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_health.md, docs/BB_HEALTH.md,
//   validation/tools/bb_health/**, gates: script/verify-health.ts,
//   script/m13/verify-health-*.ts, script/m15/verify-health-deep.ts,
//   script/m40/verify-a6-health-refresh.ts, script/m64/verify-*.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_health/descriptor.ts,
//   src/intelligence/health/health-provider.ts, script/tool-docs/curation/
//   bb_health.ts, docs/tools/bb_health.md (generated), docs/BB_HEALTH.md.
// CONTRACTS IT MUST NOT BREAK — read/write boundary (`refresh`/`force` are the
//   only mutations), declared defaults, declared bounds, the `healthy` channel,
//   and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolHandler } from "../shared"
import { textResult } from "../shared"
import { getUnifiedHealth, formatUnifiedHealth } from "../../../intelligence/health/health-provider"
import { getAnalysisHistory } from "../../../intelligence/analysis/run-history"

/**
 * Refuse an option the selected behaviour cannot honour.
 *
 * These are not schema errors — `limit` is a legitimate number, `wait` a
 * legitimate boolean — but accepting them would let the caller believe a page
 * was bounded or a refresh was awaited when neither happened. The message names
 * what the option belongs to, so the next call is correct.
 */
function irrelevantOptionRefusal(args: Record<string, unknown>): string | null {
  const history = args.history === true
  const refreshRequested = args.refresh === true || args.force === true
  const completeCensus = args.freshness === "complete"
  if (args.limit !== undefined && !history) {
    return "bb_health: limit is the analysis-history page size and is only read with history=true — pass history=true, or omit limit"
  }
  if (args.wait !== undefined && !refreshRequested) {
    return "bb_health: wait only applies to a refresh — pass refresh=true (or force=true), or omit wait"
  }
  if (args.sampleSize !== undefined && completeCensus) {
    return 'bb_health: sampleSize sizes the SAMPLED freshness check, while freshness="complete" checks every indexed file — omit sampleSize, or use freshness="sampled"'
  }
  if (history && Number(args.limit) === 0) {
    return "bb_health: limit must be at least 1 when history=true — 0 returns an empty history page that is indistinguishable from a project with no runs; omit limit for the default 20"
  }
  return null
}

export const handler: ToolHandler = async (args, { projectId, projectPath }) => {
  const refusal = irrelevantOptionRefusal(args)
  if (refusal) return textResult(refusal, true)

  const refreshRequested = args.refresh === true || args.force === true
  const report = await getUnifiedHealth(projectId, projectPath, {
    refresh: refreshRequested,
    force: args.force === true,
    wait: args.wait !== false,
    freshness: args.freshness === "complete" ? "complete" : "sampled",
    sampleSize: args.sampleSize != null ? Number(args.sampleSize) : undefined,
    integrity: args.integrity === true,
    includeAnalysisRuns: args.includeAnalysisRuns === true,
    checkUnindexed: args.checkUnindexed === true,
    paths: Array.isArray(args.paths) ? args.paths.map((p: unknown) => String(p)) : undefined,
    verbose: args.verbose === true,
    logger: { log: (..._a: any[]) => {}, write: (_s: string) => {} },
  })
  const healthy = !report.warnings.some((w) => w.severity === "error")

  if (args.history === true) {
    const history = await getAnalysisHistory(projectId, undefined, Number(args.limit ?? 20))
    // The JSON branch carries `healthy` INSIDE the payload as well as on the
    // result: a consumer that parses the text has a first-class channel for "the
    // report contains an error", and the tool result keeps it for clients that
    // read the result object.
    return {
      ...textResult(JSON.stringify({ health: report, history, healthy }, null, 2)),
      healthy,
    }
  }

  // A broken index is the ANSWER, not a tool failure, so an error-severity
  // finding does not set isError: `isError` means "the tool could not do its
  // job", and reporting that the index is broken IS its job. `healthy:false` is
  // the machine-readable form of that answer; every error-severity warning is
  // also rendered in the text.
  return { ...textResult(formatUnifiedHealth(report)), healthy }
}
