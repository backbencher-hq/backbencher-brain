// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_visualize: it validates and folds the
//   request's filter values against the index vocabulary, refuses what the tool
//   cannot mean, calls the visualization engine, attaches per-node freshness and
//   shapes the text, JSON or self-contained HTML answer.
// WHICH TOOL IT SERVES — bb_visualize (mutability read, requiresIndex true,
//   modes: project, file, module, symbol, feature).
// WHY IT IS SHAPED THIS WAY — a filter value is checked against the index BEFORE
//   it is applied, because a value the index does not contain must be a named
//   error rather than a plausible empty graph; a bound is refused rather than
//   clamped, because a returned page must mean the page that was asked for. The
//   handler never opens the index read-write: a read answer must not migrate or
//   heal the database it is reporting on. Everything the engine declares
//   (totalNodesAvailable, the page cursor, the exclusion attribution) rides all
//   three output formats, then the freshness envelope is added to text/JSON and
//   to the HTML payload so no format answers with less evidence than another.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_visualize.md, docs/BB_VISUALIZE.md,
//   validation/tools/bb_visualize/** (probe.ts drives the real MCP stdio door);
//   gates: script/m13/verify-visualize-*.ts,
//   script/m15/verify-visualize-migrate-deep.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_visualize/descriptor.ts,
//   src/intelligence/visualization/visualization-engine.ts, the generated page
//   (script/tool-docs/curation/bb_visualize.ts), and the gates above.
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, declared
//   vocabulary (a value the index lacks is refused, never silently zero),
//   freshness flags, the read-only index boundary, and the no-regex policy.
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolHandler } from "../shared"
import { textResult } from "../shared"
import { resolveRowsFreshnessDetailed, buildStalenessEnvelope, FRESHNESS_REMEDIATION_MANUAL_ONLY } from "../../../brain/freshness"
import { BrainDatabase } from "../../../brain/database"
import { visualizeProject, formatVisualization, renderVisualizationStudio, type VisualizationRequest, type VisualizationScope, type VisualizationLayout, type VisualizationResult } from "../../../intelligence/visualization/visualization-engine"

/** The scopes the tool draws. Any other value is refused by name. */
const SCOPES = ["project", "file", "module", "symbol", "feature"] as const
/** The bound ceilings. Out-of-range values are refused, never clamped. */
const VIZ_MAX_NODES = 2000
const VIZ_MAX_LINKS = 20000
/** What the index stores, so a caller's value is folded to it or refused. */
const VOCABULARY_SQL = {
  languages: "SELECT DISTINCT language AS v FROM brain_file WHERE project_id=? AND language IS NOT NULL AND language<>'' ORDER BY v",
  relationshipTypes: "SELECT DISTINCT relationship_type AS v FROM brain_relationship WHERE project_id=? AND relationship_type IS NOT NULL AND relationship_type<>'' ORDER BY v",
  symbolKinds: "SELECT DISTINCT symbol_type AS v FROM brain_symbol WHERE project_id=? AND symbol_type IS NOT NULL AND symbol_type<>'' ORDER BY v",
} as const

export const handler: ToolHandler = async (args, { projectId }) => {
  // No silent scope/target fallback: a scoped request without a target used to
  // render a project-wide graph, which is a different question than the one asked.
  // The validation layer refuses the blank/missing case first; this check is the
  // backstop for a direct caller of the handler.
  const scope = String(args.scope ?? "project")
  if (!(SCOPES as readonly string[]).includes(scope)) return textResult(`bb_visualize: unknown scope: ${scope}`, true)
  if (scope !== "project" && !args.target) return textResult(`bb_visualize scope=${scope} requires a target`, true)

  // A BOUND IS REFUSED, NEVER QUIETLY RAISED. `maxNodes: 0` used to return one
  // node and echo `truncation.maxNodes: 1` — the caller asked for no nodes and was
  // handed one — and a caller asking for more than the ceiling would have received
  // a different page than the one it asked for. The refusal names the accepted
  // range so the next call is correct.
  const boundRefusal = (name: "maxNodes" | "maxLinks", raw: unknown, ceiling: number, fallback: number): string | null => {
    if (raw == null) return null
    const asked = Number(raw)
    if (!Number.isInteger(asked) || asked < 1 || asked > ceiling) {
      return `bb_visualize: ${name} must be an integer between 1 and ${ceiling} (received ${JSON.stringify(raw)}) — a returned page must mean the page that was asked for, so an out-of-range budget is refused rather than clamped; omit ${name} for the default ${fallback}`
    }
    return null
  }
  const nodeRefusal = boundRefusal("maxNodes", args.maxNodes, VIZ_MAX_NODES, 200)
  if (nodeRefusal) return textResult(nodeRefusal, true)
  const linkRefusal = boundRefusal("maxLinks", args.maxLinks, VIZ_MAX_LINKS, 5000)
  if (linkRefusal) return textResult(linkRefusal, true)

  // A PAGE CURSOR is held to the same rule as a bound: whole and non-negative,
  // refused rather than normalised — a page that is not the page the caller asked
  // for is exactly the defect `offset` exists to remove.
  if (args.offset != null) {
    const asked = Number(args.offset)
    if (!Number.isInteger(asked) || asked < 0) {
      return textResult(`bb_visualize: offset must be a whole number >= 0 (received ${JSON.stringify(args.offset)}) — a page must mean the page that was asked for; omit offset to start at the first symbol`, true)
    }
  }

  // A FILTER VALUE IS CHECKED AGAINST THE INDEX AND FOLDED. Measured before this
  // rule: `languages: ["TypeScript"]` returned 0 nodes and declared the project had
  // none while the index stored `typescript`, and a relationshipTypes typo left the
  // nodes in place and emptied the edge set with nothing naming the filter. The
  // sibling tools state the same rule — case-insensitive matching, an unknown value
  // is an error rather than zero results — so all three agree.
  //
  // The vocabulary read is byte-read-only: a read answer must not migrate the index.
  const raw = await BrainDatabase.getRawInstance(projectId as any, { readonly: true })
  const storedVocabulary = (key: keyof typeof VOCABULARY_SQL): string[] =>
    (raw.prepare(VOCABULARY_SQL[key]).all(projectId) as any[]).map((row) => String(row.v))
  const storedLanguages = storedVocabulary("languages")
  const storedRelationshipTypes = storedVocabulary("relationshipTypes")
  const storedSymbolKinds = storedVocabulary("symbolKinds")
  const foldFilter = (label: string, values: unknown, stored: string[]): { folded?: string[]; refusal?: string } => {
    if (!Array.isArray(values) || values.length === 0) return {}
    const storedByLower = new Map(stored.map((value) => [value.toLowerCase(), value]))
    const folded: string[] = []
    const unknown: string[] = []
    for (const asked of values.map(String)) {
      const storedForm = storedByLower.get(asked.toLowerCase())
      if (!storedForm) unknown.push(asked)
      else if (!folded.includes(storedForm)) folded.push(storedForm)
    }
    if (unknown.length > 0) {
      return {
        refusal: `bb_visualize: unknown ${label}: ${unknown.join(", ")} — this index stores ${stored.length > 0 ? stored.join(", ") : "(no values recorded yet; index the project first)"}. ${label} are matched case-insensitively, and a value the index does not contain is reported as an error rather than as zero results.`,
      }
    }
    return { folded }
  }
  const languageFilter = foldFilter("languages", args.languages, storedLanguages)
  if (languageFilter.refusal) return textResult(languageFilter.refusal, true)
  const relationshipFilter = foldFilter("relationshipTypes", args.relationshipTypes, storedRelationshipTypes)
  if (relationshipFilter.refusal) return textResult(relationshipFilter.refusal, true)
  // A kind the index does not contain is refused like every other filter value;
  // without this the tool could only return whatever the ranking put first — on
  // this repository that is 124 of 200 nodes `constant`/`property` and one class,
  // so "the architecture map" was a map of string constants with nothing saying so.
  const symbolKindFilter = foldFilter("symbolKinds", args.symbolKinds, storedSymbolKinds)
  if (symbolKindFilter.refusal) return textResult(symbolKindFilter.refusal, true)

  // The dependency graph is the only picture this tool draws. An unknown view is
  // refused rather than silently answered as the graph.
  if (args.view != null && String(args.view) !== "graph") {
    return textResult(`bb_visualize draws only the dependency graph: unknown view ${JSON.stringify(String(args.view))}. Omit view or pass view "graph".`, true)
  }

  // EVERY published option reaches the engine. A filter the caller believes scopes
  // results, and which does not, is worse than a rejection: this request literal
  // used to omit `excludePatterns` and `includeTests`, so a caller who passed them
  // received a bigger, differently selected graph than asked for.
  const request: VisualizationRequest = {
    scope: scope as VisualizationScope,
    target: args.target ? String(args.target) : undefined,
    format: ["text", "json", "html"].includes(String(args.format)) ? args.format : "text",
    view: "graph",
    layout: ["regions", "force"].includes(String(args.layout)) ? (String(args.layout) as VisualizationLayout) : "regions",
    maxNodes: args.maxNodes == null ? undefined : Number(args.maxNodes),
    maxLinks: args.maxLinks == null ? undefined : Number(args.maxLinks),
    offset: args.offset == null ? undefined : Number(args.offset),
    relationshipTypes: relationshipFilter.folded,
    languages: languageFilter.folded,
    symbolKinds: symbolKindFilter.folded,
    excludePatterns: Array.isArray(args.excludePatterns) ? args.excludePatterns.map(String) : undefined,
    includeTests: typeof args.includeTests === "boolean" ? args.includeTests : undefined,
  }
  const result = await visualizeProject(projectId, request)

  // Freshness, per node and inherited by links. A link is stale when EITHER
  // endpoint's file changed since the index (the edge crosses changed code on one
  // side), and truncation is untouched so truncated AND stale are both visible.
  const freshnessRaw = await BrainDatabase.getRawInstance(projectId as any, { readonly: true })
  const graphFiles = [...new Set((result.nodes as any[]).map((node) => node.filePath).filter((file: unknown): file is string => typeof file === "string" && file.length > 0 && file !== "unknown"))]
  const relToId = new Map<string, string>()
  if (graphFiles.length) {
    for (const row of freshnessRaw.prepare(`SELECT id, relative_path FROM brain_file WHERE project_id = ? AND relative_path IN (${graphFiles.map(() => "?").join(",")})`).all(projectId, ...graphFiles) as Array<{ id: string; relative_path: string }>) {
      relToId.set(row.relative_path, row.id)
    }
  }
  const freshnessRows = graphFiles.map((file) => ({ fileId: relToId.get(file) ?? null }))
  const freshnessDetail = freshnessRows.length ? resolveRowsFreshnessDetailed(freshnessRaw, projectId as any, freshnessRows) : null
  const statuses = freshnessDetail?.statuses ?? new Map<string, string>()
  const statusOf = (relativePath: string | undefined) => (relativePath ? statuses.get(relToId.get(relativePath) ?? "") ?? "missing" : "missing")
  const freshnessSummary = {
    fresh: freshnessRows.filter((row) => statuses.get(row.fileId ?? "") === "fresh").length,
    stale: freshnessRows.filter((row) => statuses.get(row.fileId ?? "") === "stale").length,
    missing: freshnessRows.filter((row) => statuses.get(row.fileId ?? "") !== "fresh" && statuses.get(row.fileId ?? "") !== "stale").length,
  }
  for (const node of result.nodes as any[]) node.stale = statusOf(node.filePath) === "stale"
  const nodeById = new Map((result.nodes as any[]).map((node) => [node.id, node]))
  for (const link of result.links as any[]) {
    const source = nodeById.get(link.source)
    const target = nodeById.get(link.target)
    link.stale = (!!source && statusOf(source.filePath) === "stale") || (!!target && statusOf(target.filePath) === "stale")
  }
  // The envelope describes THE INDEX, and says so; the scope is the caller's, and
  // `autoRefresh: false` selects the manual-only wording because this read path
  // never refreshes (it does not even open the index read-write).
  const envelopeSource = { ...freshnessSummary, staleRatio: freshnessRows.length ? (freshnessSummary.stale + freshnessSummary.missing) / freshnessRows.length : 0, freshnessMode: "complete" as const }
  const envelopeScope = scope === "file"
    ? { kind: "file" as const, path: request.target, autoRefresh: false as const }
    : { kind: "dir" as const, autoRefresh: false as const }
  const envelope = buildStalenessEnvelope(envelopeSource, envelopeScope)

  if (request.format === "json") {
    const parsed = JSON.parse(formatVisualization(result))
    parsed.freshness = envelope
    return textResult(JSON.stringify(parsed, null, 2))
  }
  if (request.format === "html") {
    // The HTML payload carries the same freshness facts as the JSON envelope, so
    // the artifact is auditable on its own rather than only when a JSON call is
    // made next to it.
    ;(result as VisualizationResult & { freshness?: unknown }).freshness = envelope
    return textResult(renderVisualizationStudio({ graph: formatVisualization(result) }))
  }
  const text = formatVisualization(result)
  const footer = freshnessSummary.stale + freshnessSummary.missing > 0
    ? `\n\n${freshnessSummary.stale} stale, ${freshnessSummary.missing} missing of ${freshnessRows.length} graph files — ${(scope === "file" ? FRESHNESS_REMEDIATION_MANUAL_ONLY.file.replace("<file>", request.target ?? "this file") : FRESHNESS_REMEDIATION_MANUAL_ONLY.dir)}`
    : ""
  return textResult(text + footer)
}
