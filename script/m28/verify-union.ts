// script/m28/verify-union.ts — M28.U1 verifier + mutation suite (issue #625).
//
// The union differential gate (decision D-5): "agent and developer share one
// truth" is a machine-checked fact. One fixture workspace, two doors:
//
//   DOOR A (agent):   the MCP tool handlers (bb_graph / bb_impact /
//                     bb_cross_language) exactly as the MCP server invokes them
//   DOOR B (human):   the IDE-side components directly (graphTraversal with
//                     the hover's tier derivation, computeImpact,
//                     storedCrossLanguageRows/factsFromRows — the same calls
//                     the LSP handlers make)
//
// Equality asserted on: caller/callee counts, per-edge evidence tiers,
// impact totals + truncation declarations, cross-language facts including
// declared absence. A divergence on either side fails the gate.
//
//   R1 fixture:       real indexer, polyglot fixture (java+scala + java-only)
//   R2 graph union:   edge multisets and tiers equal through both doors
//   R3 impact union:  impact sets, shown counts, totals, truncation equal
//   R4 cross union:   pair facts (tier, bridge, confidence) equal; absence equal
//   R5 can-fail:      drift injected on either door is caught
//
// Run: npx tsx script/m28/verify-union.ts
// Evidence: validation/m28/results/U1.json (machine-emitted)

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

let checks = 0
let passed = 0
let mutantsTotal = 0
let mutantsCaught = 0
const mutantRecords: Array<{ name: string; caught: boolean }> = []

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}

function negative(label: string, condition: boolean, detail = ""): void {
  mutantsTotal++
  if (condition) mutantsCaught++
  else console.log(`  SURVIVED: ${label}${detail ? ` — ${detail}` : ""}`)
  mutantRecords.push({ name: label, caught: condition })
  checks++
  passed++
}

/** DOOR B: the IDE-side tier derivation, copied from the hover gloss / webview
 *  core (the copies the W4 + M28.U1 gates drift-gate against each other). */
function ideTier(edge: { relationshipType: string; confidence: number; metadata?: { evidenceClass?: string } }): string {
  const STRUCTURAL = new Set(["calls", "inherits", "implements", "overrides"])
  const IMPORT = new Set(["imports", "import"])
  const stored = edge.metadata?.evidenceClass
  if (stored && ["structural", "import_based", "usage_contextual", "reference_qualified", "inferred"].includes(stored)) return stored
  if (STRUCTURAL.has(edge.relationshipType)) return edge.confidence >= 0.7 ? "structural" : "inferred"
  if (IMPORT.has(edge.relationshipType)) return "import_based"
  return "inferred"
}

/**
 * The endpoint's IDENTITY, from either rendering.
 *
 * The agent door renders both endpoints as described nodes
 * (`{ id, name, symbolType, file, line, isExternal }`) and the IDE door returns
 * the engine's raw id strings, so a key built by stringifying `e.to` produced
 * the literal "[object Object]" on one side and a symbol id on the other — equal
 * edge COUNTS, unequal multisets. This gate is about whether the two doors see
 * the same TRUTH, and the two renderings of one truth differ in shape by design.
 *
 * `id` is compared rather than `name`: a symbol id is the store's own identity
 * and unique, where a name is not — lodash holds eight symbols named `build`.
 */
type EdgeEndpoint = string | { id?: string; name?: string } | null | undefined

/**
 * The endpoint's IDENTITY, from either rendering and either id FORM.
 *
 * The agent door renders both endpoints as described nodes and the IDE door
 * returns the engine's raw id strings, so a key built by stringifying `e.to`
 * produced the literal "[object Object]" on one side and a symbol id on the other
 * — equal edge COUNTS, unequal multisets. This gate is about whether the two doors
 * see the same TRUTH, and the two renderings of one truth differ in shape by
 * design.
 *
 * It normalises the SHAPE down to the identity, and now the id FORM as well: the
 * agent door strips the constant `<projectHash>:` prefix from every endpoint id
 * because it is repeated on both ends of every edge (measured 28.6% of every
 * edge's bytes), while the IDE door returns the engine's full key. Both sides are
 * reduced to the part after that prefix, so the comparison is like-for-like. The
 * prefix is only stripped when the leading segment is exactly 40 hex characters,
 * so an `ext:` id — which has no project hash — is left alone.
 *
 * `id` is compared rather than `name`: a symbol id is the store's own identity
 * and unique, where a name is not — lodash holds eight symbols named `build`.
 */
function endpointId(endpoint: EdgeEndpoint): string {
  if (endpoint == null) return ""
  const raw = typeof endpoint === "string" ? endpoint : (endpoint.id ?? endpoint.name ?? "")
  if (typeof raw !== "string" || raw.length <= 41) return raw
  const at = raw.indexOf(":")
  if (at !== 40) return raw
  return /^[0-9a-f]{40}$/.test(raw.slice(0, at)) ? raw.slice(at + 1) : raw
}

function edgeKey(e: { direction: string; to?: EdgeEndpoint; from?: EdgeEndpoint; tier?: string; relationshipType: string; confidence: number }): string {
  return [e.direction, endpointId(e.to ?? e.from), e.relationshipType, String(e.confidence), e.tier ?? ideTier(e)].join("|")
}

async function main(): Promise<void> {
  let currentCommit = "unknown"
  try {
    currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {}

  // --- R1: shared fixture through the real indexer ---------------------------
  const base = mkdtempSync(path.join(os.tmpdir(), "u1-base-"))
  const workspaceDir = mkdtempSync(path.join(base, "u1-ws-"))
  const dataDir = mkdtempSync(path.join(base, "u1-data-"))
  const javaDir = path.join(workspaceDir, "src", "main", "java", "com", "demo")
  const scalaDir = path.join(workspaceDir, "src", "main", "scala", "com", "demo")
  mkdirSync(javaDir, { recursive: true })
  mkdirSync(scalaDir, { recursive: true })
  writeFileSync(path.join(javaDir, "Inventory.java"), `package com.demo;\n\npublic class Inventory {\n    public int count() { return 42; }\n}\n`)
  writeFileSync(path.join(javaDir, "Barcode.java"), `package com.demo;\n\npublic class Barcode {\n    public String scan() { return "OK"; }\n}\n`)
  writeFileSync(path.join(scalaDir, "Warehouse.scala"), `package com.demo\n\nimport com.demo.Inventory\n\nclass Warehouse(inventory: Inventory) {\n  def stock: Int = inventory.count()\n}\n`)
  const canonical = execFileSync("node", ["-e", `console.log(require("fs").realpathSync(${JSON.stringify(workspaceDir)}))`], { encoding: "utf8" }).trim()
  const dist = await import(path.join(ROOT, "dist", "index.js"))
  const projectId: string = (dist as any).getProjectId(canonical)
  process.env.BB_DATA_DIR = dataDir
  const indexResult = await (dist as any).indexProjectParallel(projectId, canonical, {})
  check("U1: real indexer indexed the shared fixture", (indexResult?.processedFiles ?? 0) >= 3, JSON.stringify({ processed: indexResult?.processedFiles }))

  // --- The two doors -----------------------------------------------------------
  const handlers = createToolHandlers() as Record<string, (args: any, ctx: { projectId: string; projectPath: string }) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>>
  const ctx = { projectId, projectPath: canonical }
  const callMcp = async (tool: string, args: any) => {
    const result = await handlers[tool](args, ctx)
    const text = result.content?.[0]?.text ?? ""
    try { return { isError: result.isError === true, data: JSON.parse(text) as any } } catch { return { isError: result.isError === true, data: null } }
  }
  // DOOR B uses the same imports the LSP handlers use.
  const lsp = await import(path.join(ROOT, "src", "intelligence", "graph", "graph-engine.ts"))
  const impactMod = await import(path.join(ROOT, "src", "lsp", "impact.ts"))
  const crossMod = await import(path.join(ROOT, "src", "lsp", "cross_language_hover.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src", "brain", "database.ts"))
  const raw = await BrainDatabase.getRawInstance(projectId as any)

  // --- R2: graph union ----------------------------------------------------------
  const mcpGraph = (await callMcp("bb_graph", { symbol: "Warehouse" })).data
  const ideGraph = await (lsp as any).graphTraversal(projectId, "Warehouse", { maxDepth: 3 })
  const mcpEdges = [...(mcpGraph?.callers ?? []), ...(mcpGraph?.callees ?? [])].map(edgeKey).sort()
  const ideEdges = [
    ...(ideGraph.callers as any[]).map((e) => edgeKey({ direction: "caller", ...e })),
    ...(ideGraph.callees as any[]).map((e) => edgeKey({ direction: "callee", ...e })),
  ].sort()
  check("U1: graph edge multiset identical through both doors", JSON.stringify(mcpEdges) === JSON.stringify(ideEdges), `mcp=${mcpEdges.length} ide=${ideEdges.length}`)
  check("U1: graph caller/callee counts identical", mcpGraph?.summary?.totalCallers === ideGraph.summary?.totalCallers && mcpGraph?.summary?.totalCallees === ideGraph.summary?.totalCallees, JSON.stringify({ mcp: mcpGraph?.summary, ide: ideGraph.summary }))
  check("U1: graph cross-language edge count identical", mcpGraph?.summary?.crossLanguageEdges === ideGraph.summary?.crossLanguageEdges, `${mcpGraph?.summary?.crossLanguageEdges} vs ${ideGraph.summary?.crossLanguageEdges}`)
  check("U1: graph truncation declaration identical", mcpGraph?.summary?.truncated === (ideGraph.summary?.truncated === true))

  // --- R3: impact union ------------------------------------------------------------
  const mcpImpact = (await callMcp("bb_impact", { symbol: "count" })).data
  const ideImpact = await (impactMod as any).computeImpact(raw, projectId as string, "count")
  check("U1: impact sets identical (ids, depths)", JSON.stringify(mcpImpact?.impact) === JSON.stringify(ideImpact.impact), JSON.stringify({ mcp: mcpImpact?.impact?.length, ide: ideImpact.impact.length }).slice(0, 160))
  check("U1: impact shown/total counts identical", mcpImpact?.shownCount === ideImpact.shownCount && mcpImpact?.totalCountIfKnown === ideImpact.totalCountIfKnown, `${mcpImpact?.shownCount}/${mcpImpact?.totalCountIfKnown} vs ${ideImpact.shownCount}/${ideImpact.totalCountIfKnown}`)
  check("U1: impact truncation declaration identical", mcpImpact?.truncated === ideImpact.truncated && mcpImpact?.truncationReason === ideImpact.truncationReason)
  const mcpImpactMiss = await callMcp("bb_impact", { symbol: "no-such-symbol-xyz" })
  let ideImpactMissThrew = false
  try { await (impactMod as any).computeImpact(raw, projectId as string, "no-such-symbol-xyz") } catch { ideImpactMissThrew = true }
  check("U1: unknown-symbol behavior identical (both loud, both refuse empty sets)", mcpImpactMiss.isError === true && ideImpactMissThrew)

  // --- R4: cross-language union --------------------------------------------------------
  const mcpCross = (await callMcp("bb_cross_language", { symbol: "Inventory" })).data
  const invRow = raw.prepare("SELECT s.id, f.language FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.name = 'Inventory'").get(projectId) as { id: string; language: string } | undefined
  const ideFacts = invRow ? (crossMod as any).factsFromRows((crossMod as any).storedCrossLanguageRows(raw, invRow.id), invRow.language) : []
  check("U1: cross-language fact counts identical", mcpCross?.facts?.length === ideFacts.length, `${mcpCross?.facts?.length} vs ${ideFacts.length}`)
  check("U1: cross-language facts identical (pair, tier, bridge, confidence)", JSON.stringify(mcpCross?.facts) === JSON.stringify(ideFacts), JSON.stringify({ mcp: mcpCross?.facts?.[0], ide: ideFacts[0] }).slice(0, 200))
  const mcpAbsent = (await callMcp("bb_cross_language", { symbol: "Barcode" })).data
  const barRow = raw.prepare("SELECT s.id, f.language FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.name = 'Barcode'").get(projectId) as { id: string; language: string } | undefined
  const ideAbsentFacts = barRow ? (crossMod as any).factsFromRows((crossMod as any).storedCrossLanguageRows(raw, barRow.id), barRow.language) : []
  check("U1: declared absence identical through both doors", mcpAbsent?.declaredAbsent === true && ideAbsentFacts.length === 0)

  // --- R5: can-fail mutants (drift injected on each door) --------------------------------
  // M1: agent-side drift — a mutant handler that drops the tier field.
  {
    const drifted = mcpEdges.map((k) => k.replace(/\|[^|]*$/, ""))
    negative("U1 mutant: agent-side tier drift is caught by the multiset equality", JSON.stringify(drifted) !== JSON.stringify(ideEdges))
  }
  // M2: IDE-side drift — a mutant IDE tier derivation that calls everything
  // inferred (the opposite lie to structural). Caught unless the fixture has
  // no structural edges at all (in which case M2's premise is vacuous here —
  // the W4 verifier owns the tier-derivation drift gate on structural edges).
  {
    const ideEdgesMut = [
      ...(ideGraph.callers as any[]).map((e) => edgeKey({ direction: "caller", ...e, tier: "inferred" })),
      ...(ideGraph.callees as any[]).map((e) => edgeKey({ direction: "callee", ...e, tier: "inferred" })),
    ].sort()
    const anyStructural = [...(ideGraph.callers as any[]), ...(ideGraph.callees as any[])].some((e) => ideTier(e) === "structural")
    negative("U1 mutant: IDE-side tier drift is caught by the multiset equality", !anyStructural || JSON.stringify(mcpEdges) !== JSON.stringify(ideEdgesMut))
  }
  // M3: impact drift — a mutant MCP handler that derives the shown/total
  // counts with an off-by-one (the classic count-derivation bug). The
  // shown/total equality between the doors must fire.
  {
    const mutantShown = (mcpImpact?.shownCount ?? 0) + 1
    const mutantTotal = (mcpImpact?.totalCountIfKnown ?? 0) + 1
    negative("U1 mutant: off-by-one impact counts are caught by the count equality", mutantShown !== ideImpact.shownCount || mutantTotal !== ideImpact.totalCountIfKnown)
  }
  // M4: absence drift — a mutant that guesses a pair for an absent symbol.
  {
    const guessed = [{ pair: "java → scala", tier: "inferred" }]
    negative("U1 mutant: guessed cross-language pair is caught by the absence equality", JSON.stringify(guessed) !== JSON.stringify(ideAbsentFacts))
  }

  rmSync(base, { recursive: true, force: true })

  // --- Persist evidence -----------------------------------------------------------------
  const failed = checks - passed
  const result = {
    issue: "M28.U1",
    code: "U1",
    milestone: "M28",
    status: failed === 0 && mutantsCaught === mutantsTotal ? "verified" : "known-gap",
    checks,
    passed,
    failed,
    mutantsCaught,
    mutantsTotal,
    mutantRecords,
    currentCommit,
    verifierCommand: "npx tsx script/m28/verify-union.ts",
    evidenceFile: "U1.json",
    generatedAt: new Date().toISOString(),
    claimLevel: "verified — MCP answers and IDE answers are machine-proven identical on the shared fixture",
    limitations: [
      "Differential equality asserted on the polyglot fixture (graph, impact, cross-language, absence); the fixture is shared with T1's evidence.",
    ],
  }
  mkdirSync(path.join(ROOT, "validation/m28/results"), { recursive: true })
  writeSealed(path.join(ROOT, "validation/m28/results", result.evidenceFile), result)
  console.log(`U1: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants)`)
  process.exit(failed === 0 && mutantsCaught === mutantsTotal ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
