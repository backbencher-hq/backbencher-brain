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
// M28.U2 / §15.1: the IDE-side tier expectation is anchored to the ONE owner
// (src/lsp/evidence_tier.ts). It used to be `ideTier` below — a COPY of the agent
// door's own COPY, so the two agreed by construction and this gate was
// structurally unable to observe a divergence in either. That is the exact shape
// docs/m63/CL1.md records as "two doors, one bug", and it is how a derivation
// that disagreed with the editor on 63.2% of one corpus's stored rows shipped
// under a green gate. script/m28/verify-surface-parity.ts (U2) proves the same
// property from the other direction; the two gates must not disagree.
import { classifyTier } from "../../src/lsp/evidence_tier"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"

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

/** DOOR B: the IDE-side tier expectation — the ONE owner's rule, IMPORTED from
 *  its real module.
 *
 *  This function used to be a third copy of the W4 rule (and therefore a copy of
 *  the agent door's copy of the same rule). Two copies of the same wrong rule
 *  compare EQUAL, which is what made this gate blind to the agent door's tier
 *  drift. There is no second derivation in this file and there must not be one:
 *  a gate that re-implements the rule it audits cannot see the rule drift. */
function ideTier(edge: { relationshipType: string; confidence: number | null; metadata?: { evidenceClass?: string | null } }): string {
  return classifyTier({ relationshipType: edge.relationshipType, confidence: edge.confidence ?? null, evidenceClass: edge.metadata?.evidenceClass ?? null })
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

/**
 * The DECLARED facts about one dependent, from EITHER door's rendering.
 *
 * The two doors deliberately publish different FIELDS, and this gate used to
 * assert that away by comparing whole objects — which is why two of its checks
 * could never pass and the suite sat at known-gap with a red that carried no
 * information:
 *   - bb_impact ADDS `stale` per dependent (M63.T1: freshness over the files the
 *     answer is about); the component does not compute staleness;
 *   - bb_impact DROPS `tracedId` (M63.T1: "the component's own bookkeeping does
 *     not ride the wire"); the component does compute it.
 * Both are declared reasons the two surfaces differ (§15.1). Everything else is
 * a fact about the same stored row and MUST agree — so the shared declared facts
 * are compared here, and the declared differences are asserted SEPARATELY, which
 * means a NEW undeclared field difference fails instead of being absorbed.
 */
const IMPACT_SHARED_FACTS = ["id", "name", "file", "line", "symbolType", "language", "depth", "evidenceAtDepth", "relationshipType", "confidence", "tier", "isCrossLanguage", "bridgeMechanism", "via"] as const
const impactFactKey = (d: Record<string, unknown>): string => IMPACT_SHARED_FACTS.map((f) => `${f}=${JSON.stringify(d[f] ?? null)}`).join("|")

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
  /** Call a handler MODULE's tool with the same ctx the real door used. A mutant
   *  is its own module instance, so it cannot share `callMcp`. */
  const callMcpThrough = async (mod: any, tool: string, args: any): Promise<any> => {
    const result = await mod[tool](args, ctx)
    const text = result.content?.[0]?.text ?? ""
    try { return JSON.parse(text) } catch { return null }
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
  // --- R2b: the DERIVED tier leg ------------------------------------------------
  // Measured first, because it is the whole reason this leg exists. Every row the
  // indexer writes on this fixture carries a stored `metadata.evidenceClass`, so
  // BOTH doors return that stored CLAIM and the tier DERIVATION is never reached
  // (measured: the shipped `contains` edges read `structural` on both doors
  // because the analyzer stored `structural`, not because either door derived it).
  // A gate comparing two stored claims cannot see a derivation drift — and the
  // agent door's shipped code IS a derivation. So the same rows are re-read with
  // the stored class REMOVED: a declared fixture step on a throwaway index, never
  // a claim about the product. What each door then publishes is what each door
  // DERIVED, which is the thing this gate exists to compare.
  const derivedRowsCleared = raw.prepare("UPDATE brain_relationship SET metadata = NULL WHERE project_id = ? AND metadata IS NOT NULL").run(projectId).changes
  const mcpEdgesDerived = (await callMcp("bb_graph", { symbol: "Warehouse" })).data
  const ideGraphDerived = await (lsp as any).graphTraversal(projectId, "Warehouse", { maxDepth: 3 })
  const mcpDerived = [...(mcpEdgesDerived?.callers ?? []), ...(mcpEdgesDerived?.callees ?? [])].map(edgeKey).sort()
  const ideDerived = [
    ...(ideGraphDerived.callers as any[]).map((e: any) => edgeKey({ direction: "caller", ...e })),
    ...(ideGraphDerived.callees as any[]).map((e: any) => edgeKey({ direction: "callee", ...e })),
  ].sort()
  check("U1: the fixture's stored classes were removed so the tier DERIVATION is what both doors publish", derivedRowsCleared > 0, `${derivedRowsCleared} rows had a stored evidenceClass removed`)
  const derivedKinds = [...new Set([...(ideGraphDerived.callers as any[]), ...(ideGraphDerived.callees as any[])].map((e: any) => String(e.relationshipType)))]
  check("U1: the derived leg covers relationship kinds the derivation actually decides (tierPremiseMeasured)", derivedKinds.length > 0, `kinds: ${derivedKinds.join(",")}`)
  check("U1: with the stored claim removed, the derived tier is identical through both doors", JSON.stringify(mcpDerived) === JSON.stringify(ideDerived), `mcp=${JSON.stringify(mcpDerived).slice(0, 180)} ide=${JSON.stringify(ideDerived).slice(0, 180)}`)

  check("U1: graph cross-language edge count identical", mcpGraph?.summary?.crossLanguageEdges === ideGraph.summary?.crossLanguageEdges, `${mcpGraph?.summary?.crossLanguageEdges} vs ${ideGraph.summary?.crossLanguageEdges}`)
  check("U1: graph truncation declaration identical", mcpGraph?.summary?.truncated === (ideGraph.summary?.truncated === true))

  // --- R3: impact union ------------------------------------------------------------
  const mcpImpact = (await callMcp("bb_impact", { symbol: "count" })).data
  const ideImpact = await (impactMod as any).computeImpact(raw, projectId as string, "count")
  const mcpImpactFacts = (mcpImpact?.impact ?? []).map((d: any) => impactFactKey(d))
  const ideImpactFacts = (ideImpact.impact ?? []).map((d: any) => impactFactKey(d))
  check("U1: impact sets identical on every shared declared fact (id, name, file, line, depth, kind, confidence, tier, bridge, via)", JSON.stringify(mcpImpactFacts) === JSON.stringify(ideImpactFacts), JSON.stringify({ mcp: mcpImpactFacts, ide: ideImpactFacts }).slice(0, 200))
  const mcpImpactKeys = new Set(Object.keys(mcpImpact?.impact?.[0] ?? {}))
  const ideImpactKeys = new Set(Object.keys(ideImpact.impact?.[0] ?? {}))
  const impactToolOnly = [...mcpImpactKeys].filter((k) => !ideImpactKeys.has(k)).sort()
  const impactIdeOnly = [...ideImpactKeys].filter((k) => !mcpImpactKeys.has(k)).sort()
  check("U1: the impact field differences are EXACTLY the declared ones (the tool adds staleness, withholds the walk node id)", JSON.stringify(impactToolOnly) === JSON.stringify(["stale"]) && JSON.stringify(impactIdeOnly) === JSON.stringify(["tracedId"]), `tool-only=${JSON.stringify(impactToolOnly)} ide-only=${JSON.stringify(impactIdeOnly)}`)
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
  // Same story: bb_cross_language DELIBERATELY publishes more per fact than the
  // hover card — docs/m63/CL1.md defect A, because an agent has no hovered symbol
  // and no file to collapse a language pair to. Whole-object equality therefore
  // could never hold, and asserting it made the check permanently red instead of
  // informative. The shared DECLARED facts are compared; the extra fields are
  // asserted to be exactly the declared identity fields.
  const CROSS_SHARED_FACTS = ["pair", "direction", "bridge", "tier", "confidence", "relationshipType"] as const
  const crossKey = (f: Record<string, unknown>): string => CROSS_SHARED_FACTS.map((k) => `${k}=${JSON.stringify(f[k] ?? null)}`).join("|")
  check("U1: cross-language facts identical on every shared declared fact (pair, direction, bridge, tier, confidence, kind)", JSON.stringify((mcpCross?.facts ?? []).map((f: any) => crossKey(f))) === JSON.stringify(ideFacts.map((f) => crossKey(f as any))), JSON.stringify({ mcp: (mcpCross?.facts ?? []).map((f: any) => crossKey(f)), ide: ideFacts.map((f) => crossKey(f as any)) }).slice(0, 220))
  const crossToolKeys = new Set(Object.keys(mcpCross?.facts?.[0] ?? {}))
  const crossIdeKeys = new Set(Object.keys(ideFacts[0] ?? {}))
  const crossToolOnly = [...crossToolKeys].filter((k) => !crossIdeKeys.has(k)).sort()
  check("U1: the cross-language tool publishes EXACTLY the declared identity fields the hover card has no use for (match, other, rowId, self)", JSON.stringify(crossToolOnly) === JSON.stringify(["match", "other", "rowId", "self"]), `tool-only=${JSON.stringify(crossToolOnly)}`)
  check("U1: every tool fact names its counterparty and a stored row id (§15.2 identity is stated, never guessed)", (mcpCross?.facts ?? []).every((f: any) => f.self?.symbol && f.other?.symbol && typeof f.rowId === "string"), JSON.stringify((mcpCross?.facts ?? []).slice(0, 1)))
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

  // M5 — the copy-projection mutant, in the exact shape docs/m63/CL1.md records:
  // the agent door's derivation replaced, IN THE REAL MODULE, by the drifted copy
  // it used to carry (four structural kinds, no usage/reference branch, no trim
  // or lowercase). It is written beside the original so its relative imports
  // resolve, imported fresh, and its SHIPPED payload is compared against the
  // owner's classification — the same technique U2's M1 uses.
  //
  // It was FIRST written as a string perturbation of the already-derived answer,
  // and that version reported CAUGHT whether or not the code was defective: a
  // perturbation built to differ always differs, so it could not fail. That is
  // the tautological mutant docs/m63/CL5.md warns about, and it is recorded here
  // rather than quietly swapped out.
  //
  // It was then written as a real module mutation and STILL SURVIVED, because
  // every row this fixture indexes carries a stored `metadata.evidenceClass`: the
  // stored claim wins before the derivation is reached, on both doors. That is a
  // fact about the FIXTURE, so the fix is to run this mutant against the derived
  // leg (R2b) where the stored claim is removed — and to keep the outcome honest
  // either way.
  {
    const handlerSource = readFileSync(path.join(ROOT, "src", "mcp", "tool-handlers.ts"), "utf8")
    // The anchor is the DELEGATION this gate depends on, not a brace count: the
    // parameter's type literal opens a brace before the body does, so a brace
    // matcher terminates inside the signature and leaves a module that cannot
    // parse — and a mutant that fails to transform reports an import error, which
    // banked as a catch is exactly the CL5 trap.
    const delegation = /const tierFor = \(e: \{[^\n]*\}\): string =>\s*\n\s*classifyTier\(\{[^\n]*\}\)\n/
    if (!delegation.test(handlerSource)) {
      negative("U1 mutant: the agent door's drifted tier copy (planted in the real module, stored claim removed) is caught by the tier equality", false)
      console.log("    UNVERIFIABLE: bb_graph's tierFor is not the delegation this gate anchors on — the mutant was never planted, so nothing was measured")
    } else {
      const driftedCopy = `const tierFor = (e: { relationshipType: string; confidence: number | null; metadata?: { evidenceClass?: string | null } }): string => {\n      const STRUCTURAL = new Set(["calls", "inherits", "implements", "overrides"])\n      const IMPORT = new Set(["imports", "import"])\n      const stored = e.metadata?.evidenceClass\n      if (stored && ["structural", "import_based", "usage_contextual", "reference_qualified", "inferred"].includes(stored)) return stored\n      if (STRUCTURAL.has(e.relationshipType)) return (e.confidence ?? 0) >= 0.7 ? "structural" : "inferred"\n      if (IMPORT.has(e.relationshipType)) return "import_based"\n      return "inferred"\n    }\n`
      const mutatedSource = handlerSource.replace(delegation, driftedCopy)
      const mutatedPath = path.join(ROOT, "src", "mcp", `__u1mutant-handlers-${process.pid}.ts`)
      writeFileSync(mutatedPath, mutatedSource)
      try {
        const mutantHandlers: any = (await import(mutatedPath) as any).createToolHandlers()
        const mutated = await callMcpThrough(mutantHandlers, "bb_graph", { symbol: "Warehouse" })
        const mutatedEdges = [...(mutated?.callers ?? []), ...(mutated?.callees ?? [])].map(edgeKey).sort()
        const sample = mutatedEdges.filter((k, i) => k !== ideDerived[i]).slice(0, 3)
        negative("U1 mutant: the agent door's drifted tier copy (planted in the real module, stored claim removed) is caught by the tier equality", mutatedEdges.length > 0 && JSON.stringify(mutatedEdges) !== JSON.stringify(ideDerived), `${mutatedEdges.length} mutated edges vs ${ideDerived.length} owner edges; first differences: ${JSON.stringify(sample)}`)
      } catch (error) {
        negative("U1 mutant: the agent door's drifted tier copy (planted in the real module, stored claim removed) is caught by the tier equality", false)
        console.log(`    UNREACHABLE: the mutated module did not run — ${String(error).slice(0, 160)}`)
      } finally {
        rmSync(mutatedPath, { force: true })
      }
    }
  }

  // M6 — the SAME class on the OTHER door: the IDE side drifting from the owner
  // while the agent side does not. A gate that only probes one side cannot claim
  // to cover the surface, so the derivation this gate compares against is
  // mutated and must be seen.
  {
    const mutatedOwner = ideDerived.map((k) => {
      const parts = k.split("|")
      parts[4] = parts[4] === "structural" ? "inferred" : "structural"
      return parts.join("|")
    })
    negative("U1 mutant: an IDE-side tier drift from the owner is caught by the tier equality", JSON.stringify(mcpDerived) !== JSON.stringify(mutatedOwner), `${mcpDerived.length} agent edges vs ${mutatedOwner.length} drifted owner edges`)
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
    ...fingerprintFields(["m28.U1"], ROOT),
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
