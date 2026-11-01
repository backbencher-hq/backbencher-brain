// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_doc: it validates the request, calls the
//   documentation engine, repairs stale cited files within the shared budget,
//   enforces the output budget on the payload the caller receives, and shapes the
//   MCP result.
// WHICH TOOL IT SERVES — bb_doc (mutability read, requiresIndex true, modes:
//   symbol, file, module, feature, api, project, coverage).
// WHY IT IS SHAPED THIS WAY — the engine measures its own object; the wire payload
//   is larger (freshness envelope, auto-refresh line, indentation), so the budget
//   is enforced on the decorated payload and reported there. Refusals are named so
//   a caller can act on them; the inline repair is bounded and always declared.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_doc.md (generated from
//   script/tool-docs/curation/bb_doc.ts), docs/BB_DOC.md,
//   validation/tools/bb_doc/**, gates: script/m13/verify-doc-facts.ts,
//   script/m13/verify-doc-modes.ts, script/m13/verify-doc-docs.ts,
//   script/m15/verify-doc-deep.ts, script/m20/verify-doc-*.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_doc/descriptor.ts,
//   script/tool-docs/curation/bb_doc.ts, docs/BB_DOC*.md, and the gates above.
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness
//   flags, the read/write boundary (the only write is the bounded reindex of
//   files the document already cites), and the no-regex policy
//   (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolHandler } from "../shared"
import { derivedStaleness, textResult } from "../shared"
import { BrainDatabase } from "../../../brain/database"
import { FRESHNESS_REMEDIATION, FRESHNESS_REMEDIATION_MANUAL_ONLY, buildStalenessEnvelope, resolveRowsFreshnessDetailed } from "../../../brain/freshness"
import { collectStaleFiles, maybeAutoRefresh, autoRefreshLine } from "../../../ast/auto-refresh"
import {
  DEFAULT_TOKEN_BUDGET,
  MAX_TOKEN_BUDGET,
  MAX_EVIDENCE_LIMIT,
  DocRequestError,
  formatDocumentation,
  generateDocumentation,
  type DocRequest,
} from "../../../intelligence/documentation/doc-engine"

const MODES = ["symbol", "file", "module", "feature", "api", "project", "coverage"] as const
/** Modes whose document renders indexed test evidence. */
const TEST_MODES = ["symbol", "feature"]
/** How many repair rounds the inline refresh may take (each one is a reindex). */
const MAX_REPAIR_ROUNDS = 2
const PLACEHOLDER_TOKENS = 999_999

interface Generated {
  result: any
  derived: ReturnType<typeof derivedStaleness>
  rows: Array<{ fileId: string | null }>
  statuses: Map<string, string>
  autoRefreshLine?: string
}

function citedFiles(result: any): string[] {
  const paths: string[] = (result.citations ?? [])
    .map((citation: any) => citation.path)
    .filter((p: any): p is string => typeof p === "string" && p.length > 0)
  return [...new Set(paths)]
}

/** The file rows whose freshness the envelope reports: one per cited path. */
function derivedRows(raw: any, projectId: string, relPaths: string[]): Array<{ fileId: string | null }> {
  const relToId = new Map<string, string>()
  if (relPaths.length) {
    try {
      for (const row of raw.prepare(`SELECT id, relative_path FROM brain_file WHERE project_id = ? AND relative_path IN (${relPaths.map(() => "?").join(",")})`).all(projectId, ...relPaths) as Array<{ id: string; relative_path: string }>) {
        relToId.set(row.relative_path, row.id)
      }
    } catch {
      /* a project without brain_file rows cannot resolve a citation to a file id */
    }
  }
  return relPaths.map((relPath) => ({ fileId: relToId.get(relPath) ?? null }))
}

function derivedStatuses(raw: any, projectId: string, rows: Array<{ fileId: string | null }>): Map<string, string> {
  if (rows.length === 0) return new Map()
  return resolveRowsFreshnessDetailed(raw, projectId, rows).statuses
}

export const handler: ToolHandler = async (args, { projectId, projectPath }) => {
  const mode = String(args.mode ?? "")
  if (!(MODES as readonly string[]).includes(mode)) return textResult(`bb_doc requires mode: ${MODES.join("|")}`, true)
  if (["symbol", "file", "module", "feature"].includes(mode) && !args.target) return textResult(`bb_doc ${mode} mode requires target`, true)

  // Ranges are refused, never clamped: a page that is not the page asked for is a
  // wrong answer, and a zero budget silently becoming the default is the same
  // defect wearing a different hat.
  const limitGiven = args.limit !== undefined && args.limit !== null
  const limit = limitGiven ? Number(args.limit) : undefined
  if (limitGiven && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_EVIDENCE_LIMIT)) {
    return textResult(`bb_doc limit must be a whole number between 1 and ${MAX_EVIDENCE_LIMIT} (default 20) — got ${String(args.limit)}. It is refused rather than clamped because the document would not be the one requested.`, true)
  }
  const maxTokensGiven = args.maxTokens !== undefined && args.maxTokens !== null
  const requestedMaxTokens = maxTokensGiven ? Number(args.maxTokens) : DEFAULT_TOKEN_BUDGET
  if (maxTokensGiven && (!Number.isInteger(requestedMaxTokens) || requestedMaxTokens < 1 || requestedMaxTokens > MAX_TOKEN_BUDGET)) {
    return textResult(`bb_doc maxTokens must be a whole number between 1 and ${MAX_TOKEN_BUDGET} (default ${DEFAULT_TOKEN_BUDGET}) — got ${String(args.maxTokens)}. Raise it or narrow the target; there is no larger ceiling.`, true)
  }
  // A silent no-op option teaches a caller that it worked. Modes that render no
  // test evidence refuse it instead.
  if (args.includeTests !== undefined && !TEST_MODES.includes(mode)) {
    return textResult(`bb_doc includeTests is accepted for ${TEST_MODES.join(" and ")} modes only — ${mode} mode renders no test evidence, so the option would do nothing.`, true)
  }

  const request: DocRequest = {
    mode: mode as DocRequest["mode"],
    target: args.target ? String(args.target) : undefined,
    format: args.format === "json" ? "json" : "markdown",
    audience: args.audience as DocRequest["audience"],
    detail: args.detail as DocRequest["detail"],
    includeExamples: args.includeExamples === true,
    includeDiagrams: args.includeDiagrams === true,
    // Tri-state: omit when the caller did not pass it, so the engine applies the
    // mode's own default instead of the handler flattening it to false.
    includeTests: args.includeTests === undefined ? undefined : args.includeTests === true,
    limit,
    maxTokens: requestedMaxTokens,
  }

  // One generation plus the freshness of exactly the files it cites. A repair
  // regenerates, because answering from the rows a refresh just replaced is the
  // one thing a documentation tool must not do; a second (bounded) round catches
  // citations the regenerated document introduced.
  const generate = async (engineBudget: number, allowRepair: boolean): Promise<Generated> => {
    let result = await generateDocumentation(projectId, projectPath, { ...request, maxTokens: engineBudget })
    const rawDb = await BrainDatabase.getRawInstance(projectId as any)
    let derived = derivedStaleness(rawDb, projectId as any, citedFiles(result))
    let rows = derivedRows(rawDb, projectId as any, citedFiles(result))
    let statuses = derivedStatuses(rawDb, projectId as any, rows)
    const lines: string[] = []
    for (let round = 0; allowRepair && round < MAX_REPAIR_ROUNDS; round++) {
      const stale = collectStaleFiles(await BrainDatabase.getRawInstance(projectId as any), rows, statuses)
      if (stale.length === 0) break
      const decision = await maybeAutoRefresh(projectId, projectPath, stale, { perCallOptOut: args.refresh === false })
      const line = autoRefreshLine(decision)
      if (line) lines.push(line)
      if (decision.action !== "refreshed") break
      result = await generateDocumentation(projectId, projectPath, { ...request, maxTokens: engineBudget })
      derived = derivedStaleness(rawDb, projectId as any, citedFiles(result))
      rows = derivedRows(rawDb, projectId as any, citedFiles(result))
      statuses = derivedStatuses(rawDb, projectId as any, rows)
    }
    return { result, derived, rows, statuses, autoRefreshLine: lines.length ? lines.join("; ") : undefined }
  }

  // The freshness envelope has a file scope only when the document cites exactly
  // one file; the registered constants carry a different remediation string for
  // that case, and the generated page documents both branches.
  const envelope = (generated: Generated) => {
    const files = citedFiles(generated.result)
    return files.length === 1
      ? buildStalenessEnvelope(generated.derived.summary, { kind: "file", path: files[0] })
      : buildStalenessEnvelope(generated.derived.summary, { kind: "dir" })
  }
  const stalenessFooter = (generated: Generated): string => {
    const summary = generated.derived.summary
    const staleish = summary.stale + summary.missing
    if (staleish === 0) return ""
    const files = citedFiles(generated.result)
    const declinedDisabled = (generated.autoRefreshLine ?? "").startsWith("auto-refresh disabled")
    // The footer's scope must agree with the envelope's: one cited file names that
    // file's own reindex command, several name the project command.
    const remediation = files.length === 1
      ? (declinedDisabled ? FRESHNESS_REMEDIATION_MANUAL_ONLY.file : FRESHNESS_REMEDIATION.file).replace("<file>", files[0])
      : (declinedDisabled ? FRESHNESS_REMEDIATION_MANUAL_ONLY.dir : FRESHNESS_REMEDIATION.dir)
    return `${summary.stale} stale, ${summary.missing} missing of ${summary.fresh + staleish} cited file(s) — ${remediation}`
  }
  const render = (generated: Generated, budget: { passed: boolean; estimatedTokens: number; maxTokens: number }): string => {
    const result = generated.result
    result.quality.budget = budget
    if (request.format === "json") {
      const parsed = JSON.parse(formatDocumentation(result, "json"))
      parsed.freshness = envelope(generated)
      if (generated.autoRefreshLine) parsed.autoRefresh = generated.autoRefreshLine
      return JSON.stringify(parsed, null, 2)
    }
    const parts = [formatDocumentation(result, request.format)]
    if (generated.autoRefreshLine) parts.push(generated.autoRefreshLine)
    if (generated.rows.length === 0) parts.push("Freshness not applicable: this document cites no file, so there is no source to be stale.")
    else {
      const footer = stalenessFooter(generated)
      if (footer) parts.push(`---\n${footer}`)
    }
    return parts.join("\n\n")
  }

  // The budget is enforced on the payload the caller receives, not on the engine
  // object: `estimatedTokens * 4` is what a caller budgets from, so that number
  // must not be smaller than what was sent. Each attempt that is still over
  // re-runs the engine with the difference removed; the loop is hard-bounded.
  let generated: Generated
  try {
    generated = await generate(requestedMaxTokens, true)
  } catch (error: any) {
    if (error instanceof DocRequestError) return textResult(error.message, true)
    throw error
  }
  const compactTokens = (value: unknown): number => Math.ceil(JSON.stringify(value).length / 4)
  let engineBudget = requestedMaxTokens
  let objectTokens = compactTokens(generated.result)
  let text = render(generated, { passed: true, estimatedTokens: PLACEHOLDER_TOKENS, maxTokens: requestedMaxTokens })
  let measuredLast = Math.ceil(text.length / 4)
  for (let attempt = 0; attempt < 6; attempt++) {
    measuredLast = Math.ceil(text.length / 4)
    if (measuredLast <= requestedMaxTokens) break
    // The engine measures its compact object; the caller receives the decorated,
    // indented payload. Subtracting the measured DECORATION overhead from the
    // caller's budget turns the engine's own trim into a trim of the payload.
    const overhead = Math.max(0, measuredLast - objectTokens)
    let nextBudget = Math.max(1, requestedMaxTokens - overhead)
    if (nextBudget >= engineBudget) nextBudget = Math.max(1, engineBudget - Math.max(50, measuredLast - requestedMaxTokens))
    if (nextBudget === engineBudget) break
    engineBudget = nextBudget
    try {
      generated = await generate(engineBudget, false)
    } catch (error: any) {
      if (error instanceof DocRequestError) return textResult(error.message, true)
      throw error
    }
    objectTokens = compactTokens(generated.result)
    text = render(generated, { passed: true, estimatedTokens: PLACEHOLDER_TOKENS, maxTokens: requestedMaxTokens })
    // The engine has already reached its smallest honest rendering: trimming
    // further would drop a required section or its explanation. Declare the
    // shortfall instead of spending more generations on a floor.
    if (generated.result.quality.budget.passed === false) break
  }
  // Keep the reported figure an over-count: a rewrite can move the payload by a
  // character, and `estimatedTokens * 4` must never be smaller than the payload.
  let finalTokens = Math.max(measuredLast, Math.ceil(text.length / 4))
  let passed = finalTokens <= requestedMaxTokens
  text = render(generated, { passed, estimatedTokens: finalTokens, maxTokens: requestedMaxTokens })
  const rewritten = Math.ceil(text.length / 4)
  if (rewritten > finalTokens) {
    finalTokens = rewritten
    passed = finalTokens <= requestedMaxTokens
    text = render(generated, { passed, estimatedTokens: finalTokens, maxTokens: requestedMaxTokens })
  }
  return textResult(text)
}
