// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_migrate: parses the request (names, symbol
//   ids, paths, target language), calls the migration engine, and adds the
//   freshness verdict for every source file a plan cites.
// WHICH TOOL IT SERVES — bb_migrate (mutability read, requiresIndex true, modes: plan).
// WHY IT IS SHAPED THIS WAY — a plan is a claim about CURRENT code, so each plan's
//   own source file is resolved and flagged stale (or missing) up front; the JSON
//   form carries the registered freshness envelope and the text form carries the
//   notice and footer. Inputs are validated here so a blank name, a blank path, a
//   blank target or a legacy alias mixed with its modern spelling cannot silently
//   narrow the request: every requested component either gets a plan, a typed
//   refusal, or a named request-level error.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_migrate.md, docs/BB_MIGRATE.md,
//   validation/tools/bb_migrate/**; gates: npx tsx script/m13/verify-migrate-accuracy.ts,
//   bun run script/m13/verify-migrate-e2e-corpus.ts, bun run script/m65/verify-migrate-latency.ts,
//   npx tsx script/tools/verify-regex-policy.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — descriptor.ts (schema/refusal contract),
//   src/intelligence/migration/** (engine + bounded loader), the gates above,
//   docs/BB_MIGRATE.md, and the regex/no-regex policy.
// CONTRACTS IT MUST NOT BREAK — byte-read-only index access, named refusals for
//   invalid input (isError through the MCP door), declared freshness (stale/missing
//   plans are visible, never silent), manual-only repair instructions (this tool
//   never auto-refreshes), and the no-regex policy.
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolHandler, ToolResult } from "../shared"
import { textResult } from "../shared"
import { FRESHNESS_REMEDIATION_MANUAL_ONLY, buildStalenessEnvelope, resolveRowsFreshnessDetailed } from "../../../brain/freshness"
import path from "node:path"
import { BrainDatabase } from "../../../brain/database"
import { generateMigrationPlans, formatMigrationPlans } from "../../../intelligence/migration/migration-engine"

/** Trimmed, non-empty strings from an array option; blank entries are refused by name. */
function nonBlankEntries(option: string, value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`bb_migrate: ${option} must be an array of strings`)
  const entries = value.map((item) => String(item ?? ""))
  const blank = entries.map((entry, index) => (entry.trim() ? null : index)).filter((index): index is number => index !== null)
  if (blank.length > 0) {
    throw new Error(
      `bb_migrate: ${option} contains ${blank.length} blank entr${blank.length === 1 ? "y" : "ies"} (position${blank.length === 1 ? "" : "s"} ${blank.join(", ")}) — a blank entry names no component and would silently narrow the request; remove it or pass the component you mean`,
    )
  }
  return entries.map((entry) => entry.trim())
}

export const handler: ToolHandler = async (args, { projectId, projectPath }): Promise<ToolResult> => {
  // ── the request ────────────────────────────────────────────────────────────
  // `symbolName` is the legacy single-symbol spelling of `symbolNames`. Both are
  // accepted in one call and UNIONED: a caller that passes both asked for both, so
  // dropping one is a lost component, not a shortcut. The engine de-duplicates by
  // resolved symbol identity, so naming one component through both spellings still
  // plans it exactly once.
  let symbolNames: string[]
  let symbolIds: string[]
  let cohortPaths: string[]
  try {
    const modern = nonBlankEntries("symbolNames", args.symbolNames)
    if (args.symbolName !== undefined && typeof args.symbolName !== "string") throw new Error("bb_migrate: symbolName must be a string")
    const legacy = typeof args.symbolName === "string" && args.symbolName.trim() ? [args.symbolName.trim()] : []
    if (typeof args.symbolName === "string" && args.symbolName && !args.symbolName.trim()) throw new Error("bb_migrate: symbolName is blank — a blank name names no component")
    symbolNames = [...new Set([...modern, ...legacy])]
    symbolIds = nonBlankEntries("symbolIds", args.symbolIds)
    const paths = nonBlankEntries("paths", args.paths)
    // A path inside the project is accepted however the caller spells it: an agent
    // holding an absolute path is not wrong, and the project boundary lives in the
    // resolver, not in the spelling.
    const projectRoot = path.resolve(String(projectPath ?? "."))
    cohortPaths = paths.map((raw) => {
      const value = String(raw ?? "").trim().split("\\").join("/")
      if (!value) return value
      const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(projectRoot, value)
      const relative = path.relative(projectRoot, absolute).split("\\").join("/")
      return relative === "" ? "." : relative.startsWith("..") ? value : relative
    })
  } catch (error) {
    return textResult(error instanceof Error ? error.message : String(error), true)
  }
  const targetLanguage = String(args.targetLanguage ?? "").trim()
  if (!targetLanguage) {
    return textResult("bb_migrate: targetLanguage must be a non-empty language name (for example rust, go, python)", true)
  }
  if (!symbolNames.length && !symbolIds.length && !cohortPaths.length) {
    return textResult("bb_migrate requires one of symbolNames (or symbolName), symbolIds, or paths, and targetLanguage", true)
  }

  const result = await generateMigrationPlans(projectId, { symbolNames, symbolIds, paths: cohortPaths, targetLanguage })
  const unmatchedIds = (result.unsupported ?? []).filter((entry: any) => entry.unsupportedReason === "missing-symbol").map((entry: any) => entry.symbolName)
  // ANY unmatched id refuses: a partially-resolved request reads like a complete
  // answer otherwise, and an id is the only unambiguous selector — a typo must be
  // named, not absorbed.
  if (symbolIds.length && unmatchedIds.length > 0) {
    return textResult(`bb_migrate: no indexed symbol carries the id(s) ${unmatchedIds.map((id: string) => `"${id}"`).join(", ")}. Ids come from an earlier result's plans or from an ambiguity refusal's candidates.`, true)
  }
  if (cohortPaths.length && result.cohort?.pathsUnmatched?.length) {
    return textResult(`bb_migrate: no indexed file matches ${result.cohort.pathsUnmatched.map((file: string) => `"${file}"`).join(", ")}. Paths are project-relative; check the spelling against the project root.`, true)
  }

  // ── freshness of the plans' OWN source files ──────────────────────────────
  // A plan is a claim about current code. The file comes from the plan's own
  // symbol (the planner records it), never from a second name-based lookup that
  // could resolve elsewhere when two symbols share a name. A plan whose source
  // file cannot be resolved counts as missing, not fresh.
  const raw = await BrainDatabase.getRawInstance(projectId as any, { readonly: true })
  const planFiles = new Set<string>()
  for (const plan of result.plans as any[]) {
    const file = typeof plan.sourceFile === "string" ? plan.sourceFile : ""
    if (file && file !== "unknown") planFiles.add(file)
  }
  const migrationFiles = [...planFiles]
  const relativeToId = new Map<string, string>()
  if (migrationFiles.length) {
    for (const row of raw
      .prepare(`SELECT id, relative_path FROM brain_file WHERE project_id = ? AND relative_path IN (${migrationFiles.map(() => "?").join(",")})`)
      .all(projectId, ...migrationFiles) as Array<{ id: string; relative_path: string }>) {
      relativeToId.set(row.relative_path, row.id)
    }
  }
  const freshnessRows = migrationFiles.map((file) => ({ fileId: relativeToId.get(file) ?? null }))
  const freshnessDetail = freshnessRows.length ? resolveRowsFreshnessDetailed(raw, projectId as any, freshnessRows) : null
  const statuses = freshnessDetail?.statuses ?? new Map<string, string>()
  const statusOf = (relative: string | undefined) => (relative ? statuses.get(relativeToId.get(relative) ?? "") ?? "missing" : "missing")
  for (const plan of result.plans as any[]) {
    plan.stale = statusOf(typeof plan.sourceFile === "string" ? plan.sourceFile : undefined) === "stale"
  }
  const unresolvedPlans = (result.plans as any[]).filter((plan) => !plan.sourceFile || plan.sourceFile === "unknown").length
  const summary = {
    fresh: freshnessRows.filter((row) => statuses.get(row.fileId ?? "") === "fresh").length,
    stale: freshnessRows.filter((row) => statuses.get(row.fileId ?? "") === "stale").length,
    missing: freshnessRows.filter((row) => statuses.get(row.fileId ?? "") !== "fresh" && statuses.get(row.fileId ?? "") !== "stale").length + unresolvedPlans,
  }
  const envelopeSource = { ...summary, staleRatio: freshnessRows.length ? (summary.stale + summary.missing) / freshnessRows.length : 0, freshnessMode: "complete" as const }
  const stalePlans = (result.plans as any[]).filter((plan) => plan.stale).length

  if (args.format === "json") {
    const parsed = JSON.parse(formatMigrationPlans(result, "json"))
    // `autoRefresh:false` is the truth for this tool: it never reindexes on a read and
    // has no `refresh` option, so the repair instruction must be the manual one.
    parsed.freshness = buildStalenessEnvelope(envelopeSource, { kind: "dir", autoRefresh: false })
    return textResult(JSON.stringify(parsed, null, 2))
  }
  const text = formatMigrationPlans(result, "text")
  const notice = stalePlans > 0 ? `⚠ ${stalePlans} of ${result.plans.length} plans reference files changed since the last index — reindex before acting on these plans.\n\n` : ""
  const staleish = summary.stale + summary.missing
  const footer = staleish > 0 ? `\n\n${summary.stale} stale, ${summary.missing} missing of ${freshnessRows.length} plan files — ${FRESHNESS_REMEDIATION_MANUAL_ONLY.dir}` : ""
  return textResult(notice + text + footer)
}
