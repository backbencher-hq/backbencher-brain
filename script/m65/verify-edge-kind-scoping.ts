// script/m65/verify-edge-kind-scoping.ts — the all-kinds DEFAULT vs a KIND claim.
//
// THE DEFECT CLASS THIS GATE PINS DOWN
// The graph engine's default covers every stored relationship kind — deliberately,
// and documented (`src/intelligence/graph/graph-engine.ts` DEFAULT_REL_TYPES; the
// bb_graph page states it as "Default: EVERY kind the index stores …"). That is
// right for a general graph question and wrong for every consumer that makes a
// claim about ONE kind: the set it receives is then mostly NOT the thing it
// names. Two measured examples, both from this repository's own code paths:
//
//   * `contains` is the parent -> member edge. An INBOUND `contains` row says the
//     target is a member of the source — the opposite of "the source depends on
//     the target". A class therefore reported its own methods as dependents
//     affected by a change to itself.
//   * `uses` / `references` / `imports` are lexical and module-level evidence,
//     not dependency edges; `src/lsp/impact.ts` already measured the consequence
//     for its own surface (`GraphQLList` declared 57 reverse dependencies of
//     which 8 are dependency rows) and fixed it by handing BOTH its walks the one
//     declared kind list `IMPACT_REL_TYPES`.
//
// WHAT WAS STILL UNFIXED WHEN THIS GATE WAS WRITTEN (three consumers, all in
// `src/`, all reading the caller set with no kind filter and all naming it):
//   `src/intelligence/testing/test-intel.ts`  — a depth-0 row from a test file
//       was published as a DIRECT test, whatever kind it was, so a test class
//       that CONTAINS the symbol under test answered as a test that depends on
//       it (and `testSuggestions` stamped that `direct_call` at 0.85 confidence).
//   `src/intelligence/testing/suggestions.ts` — `blastRadius`, labelled "caller
//       closure", counted containment and lexical rows, and it feeds
//       `priorityFor`, so structure inflated a priority.
//   `src/intelligence/analysis/impact.ts`     — the deprecated calculator fitted
//       every kind into `directSymbols` / `affectedFiles`.
//
// WHAT THIS GATE VERIFIES, AND HOW IT CAN FAIL
//   A. INVENTORY (static): every `graphTraversal(` / `traverseGraph(` call site in
//      `src/` either passes `relationshipTypes` or is a DECLARED all-kinds door
//      with a stated reason. The engine itself is exempt as the owner. A mutation
//      strips the filter from a real consumer's source and asserts the audit
//      REPORTS it — the predicate is shown to be able to fail.
//   B. DIFFERENTIAL (fixture): one indexed project whose store carries, from the
//      real analyzer, both a `calls` row into each target and an inbound
//      `contains` row into the same target. The gate asserts that the UNSCOPED
//      walk returns both (so the defect was live in the data), that the consumer
//      returns only the dependency row, and that deleting the dependency row
//      moves the consumer's number while the structural row stays — the answer
//      tracks the store rather than the constant.
//   C. THE DEFAULT IS NOT THE DEFECT: the unscoped walk must still return every
//      kind. The fix belongs at each consumer; narrowing the engine would break
//      the class-hierarchy descent the default exists for.
//
// Usage: npx tsx script/m65/verify-edge-kind-scoping.ts

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
process.env.BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "m65-kind-scope-data-"))

type Check = { id: string; pass: boolean; detail: string }
const checks: Check[] = []
const check = (id: string, pass: boolean, detail: string) => checks.push({ id, pass, detail })

// ── A. the static inventory ──────────────────────────────────────────────────
/**
 * The call sites allowed to consume the graph WITHOUT a kind filter, each with
 * the reason it may. A declaration is a review surface; a silent one is not.
 */
const DECLARED_ALL_KINDS_DOORS: Record<string, string> = {
  // The split moved the agent door out of the 2,892-line tool-handlers.ts into
  // one module per tool. bb_graph is NOT listed: its call always forwards the
  // `relationshipTypes` option (including `undefined`, which is the engine's
  // documented all-kinds default), so the inventory below sees it as carrying
  // the option; the disclosure a reader needs is on its own page and gate.
  "src/mcp/tools/bb_analyze/handler.ts":
    "the bb_analyze graph modes' door: their all-kinds default is DOCUMENTED (docs/tools/bb_analyze.md), " +
    "the answer publishes its composition and the kinds searched, and a caller can pass relationshipTypes; " +
    "mode `impact` walks the declared dependency kinds instead",
  "src/mcp/tools/shared.ts":
    "the shared graph-walk helper behind the analyze modes: it forwards the caller's relationshipTypes " +
    "unchanged and takes the engine default when none is given, which is the documented all-kinds policy " +
    "of the modes that call it",
  "src/ast/graph.ts":
    "legacy BFS helper: it does not default at all — it passes Object.values(RelationshipType) explicitly, " +
    "so the full kind set is NAMED at the call site rather than inherited",
}

/** The engine owns the default; its internal calls thread the caller's options
 *  through unchanged, so there is nothing of its own to scope. */
const ENGINE_OWNER = "src/intelligence/graph/graph-engine.ts"

type CallSite = { file: string; line: number; scoped: boolean; text: string }

/** Every `graphTraversal(...)` / `traverseGraph(...)` CALL in a source text, with
 *  whether its own argument text carries a `relationshipTypes` filter. Definitions
 *  are not call sites. */
export function callSitesIn(file: string, source: string): CallSite[] {
  const out: CallSite[] = []
  const re = /\b(graphTraversal|traverseGraph)\s*\(/g
  for (const m of source.matchAll(re)) {
    const at = m.index ?? 0
    const head = source.slice(Math.max(0, at - 40), at)
    if (/function\s+$/.test(head) || /function\s+\w*\s*$/.test(head)) continue
    const open = source.indexOf("(", at + m[1].length)
    let depth = 0
    let close = -1
    for (let i = open; i < source.length; i++) {
      const c = source[i]
      if (c === "(") depth++
      else if (c === ")") {
        depth--
        if (depth === 0) {
          close = i
          break
        }
      }
    }
    if (close < 0) continue
    const text = source.slice(open, close + 1)
    out.push({
      file,
      line: source.slice(0, at).split("\n").length,
      scoped: /relationshipTypes/.test(text),
      text: text.replace(/\s+/g, " ").slice(0, 120),
    })
  }
  return out
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...sourceFiles(p))
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p)
  }
  return out
}

function auditSrc(): CallSite[] {
  const sites: CallSite[] = []
  for (const abs of sourceFiles(path.join(ROOT, "src"))) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/")
    if (rel === ENGINE_OWNER) continue
    sites.push(...callSitesIn(rel, readFileSync(abs, "utf8")))
  }
  return sites
}

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const { graphTraversal } = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))
  const { testImpact, TEST_IMPACT_KINDS } = await import(path.join(ROOT, "src/intelligence/testing/test-intel.ts"))
  const { testSuggestions } = await import(path.join(ROOT, "src/intelligence/testing/suggestions.ts"))

  // ── A. inventory ───────────────────────────────────────────────────────────
  const sites = auditSrc()
  const unscoped = sites.filter((s) => !s.scoped)
  const undeclared = unscoped.filter((s) => !(s.file in DECLARED_ALL_KINDS_DOORS))
  check(
    "A1-every-unscoped-call-site-is-a-declared-door",
    sites.length > 0 && undeclared.length === 0,
    `${sites.length} graph call site(s) in src/, ${sites.length - unscoped.length} scoped; unscoped: ` +
      unscoped.map((s) => `${s.file}:${s.line}`).join(", ") +
      (undeclared.length ? ` — UNDECLARED: ${undeclared.map((s) => `${s.file}:${s.line}`).join(", ")}` : ""),
  )
  const staleDoors = Object.keys(DECLARED_ALL_KINDS_DOORS).filter((f) => !unscoped.some((s) => s.file === f))
  check(
    "A2-no-stale-door-declaration",
    staleDoors.length === 0,
    staleDoors.length ? `declared but never unscoped: ${staleDoors.join(", ")}` : `all ${Object.keys(DECLARED_ALL_KINDS_DOORS).length} declared door(s) still have an unscoped call site`,
  )
  for (const [f, why] of Object.entries(DECLARED_ALL_KINDS_DOORS)) {
    console.log(`  door ${f}: ${why}`)
  }

  const consumers = [
    "src/intelligence/testing/test-intel.ts",
    "src/intelligence/testing/suggestions.ts",
    "src/intelligence/analysis/impact.ts",
  ]
  const consumerSites = consumers.map((f) => ({ f, sites: auditSrc().filter((s) => s.file === f) }))
  check(
    "A3-the-three-repaired-consumers-are-scoped",
    consumerSites.every((c) => c.sites.length > 0 && c.sites.every((s) => s.scoped)),
    consumerSites.map((c) => `${c.f}: ${c.sites.map((s) => (s.scoped ? "scoped" : "UNSCOPED")).join(",") || "none"}`).join(" · "),
  )

  // A4 — MUTATION: the audit must report a consumer whose filter is gone.
  {
    const src = readFileSync(path.join(ROOT, consumers[0]), "utf8")
    const mutant = src.replace(/[ \t]*relationshipTypes:[^\n]*\n/, "")
    const mutantSites = callSitesIn(consumers[0], mutant)
    check(
      "A4-mutation-the-audit-reacts-when-a-filter-is-removed",
      mutant !== src && mutantSites.some((s) => !s.scoped),
      `with the filter line stripped from ${consumers[0]}, the audit reports ${mutantSites.filter((s) => !s.scoped).length} unscoped call site(s) — reverting a consumer's scoping turns A1/A3 red`,
    )
  }

  // ── the fixture ────────────────────────────────────────────────────────────
  const project = mkdtempSync(path.join(tmpdir(), "m65-kind-scope-proj-"))
  mkdirSync(path.join(project, "src"), { recursive: true })
  writeFileSync(
    path.join(project, "src", "prod.ts"),
    [
      "export class Host {",
      "  target(): number {",
      "    return 1",
      "  }",
      "}",
      "",
      "export function consumer(): number {",
      "  const h = new Host()",
      "  return h.target()",
      "}",
      "",
    ].join("\n"),
  )  // A TEST file, so one caller of `nested` is test evidence and the other is its
  // own container. Both rows are the analyzer's own output (premises below).
  writeFileSync(
    path.join(project, "src", "kind.test.ts"),
    [
      "export class TestHost {",
      "  nested(): number {",
      "    return 1",
      "  }",
      "}",
      "",
      "export function realTest(): number {",
      "  return new TestHost().nested()",
      "}",
      "",
    ].join("\n"),
  )
  // A second test caller of the PROD target, so `testSuggestions` has a real
  // affected-test row to carry the kind and tier on (a check that cannot be
  // vacuous).
  writeFileSync(
    path.join(project, "src", "target.test.ts"),
    [
      "import { Host } from \"./prod\"",
      "",
      "export function testTarget(): number {",
      "  return new Host().target()",
      "}",
      "",
    ].join("\n"),
  )

  const pid = getProjectId(project) as any
  await indexProjectParallel(pid, project, {})
  const db: any = await BrainDatabase.getRawInstance(pid)

  const rowQuery = (targetName: string) =>
    db
      .prepare(
        `SELECT r.id AS id, r.relationship_type AS rel, r.line_number AS line,
                ss.name AS srcName, ts.name AS tgtName, ts.id AS tgtId, ss.id AS srcId
           FROM brain_relationship r
           LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
           LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
          WHERE r.project_id = ? AND r.target_external = ?
          ORDER BY r.relationship_type, ss.name`,
      )
      .all(pid, targetName) as any[]

  const nestedRows = rowQuery("nested")
  const targetRows = rowQuery("target")

  const testFileFlag = (rel: string) =>
    Number((db.prepare("SELECT COALESCE(is_test_file,0) tf FROM brain_file WHERE project_id=? AND relative_path=?").get(pid, rel) as any)?.tf ?? -1)

  // ── premises: the fixture is the shape this gate reasons about ─────────────
  check(
    "P1-premises-test-file-flag-is-real",
    testFileFlag("src/kind.test.ts") === 1 && testFileFlag("src/target.test.ts") === 1 && testFileFlag("src/prod.ts") === 0,
    `kind.test.ts is_test_file=${testFileFlag("src/kind.test.ts")}, target.test.ts is_test_file=${testFileFlag("src/target.test.ts")}, prod.ts is_test_file=${testFileFlag("src/prod.ts")}`,
  )
  const has = (rows: any[], rel: string, src: string) => rows.some((r) => r.rel === rel && r.srcName === src && r.tgtName)
  check(
    "P2-premises-the-store-carries-a-DEPENDENCY-row-and-a-CONTAINMENT-row-into-each-target",
    has(nestedRows, "calls", "realTest") &&
      has(nestedRows, "contains", "TestHost") &&
      has(targetRows, "calls", "consumer") &&
      has(targetRows, "contains", "Host"),
    `nested: ${nestedRows.map((r) => `${r.srcName}-${r.rel}`).join(", ")} · target: ${targetRows.map((r) => `${r.srcName}-${r.rel}`).join(", ")} — real analyzer output, nothing seeded`,
  )

  if (!has(nestedRows, "calls", "realTest") || !has(nestedRows, "contains", "TestHost") || !has(targetRows, "calls", "consumer") || !has(targetRows, "contains", "Host")) {
    check("P3-fixture-shape", false, "the fixture stopped producing the rows this gate reasons about — re-derive before trusting the checks below")
  } else {
    const walk = (name: string, scoped: boolean) =>
      graphTraversal(pid, name, {
        direction: "callers",
        maxDepth: 2,
        ...(scoped ? { relationshipTypes: ["calls", "instantiates", "extends", "implements"] } : {}),
      } as any)

    // ── C. the engine's default is the documented all-kinds contract ──────────
    const def = await walk("nested", false)
    const scopedCalls = await walk("nested", true)
    const defKinds = [...new Set(def.callers.map((e: any) => e.relationshipType))].sort()
    const defScope = (def.summary as any)?.relationshipTypesUsed ?? []
    check(
      "C1-the-default-still-covers-every-kind",
      defKinds.includes("contains") && defKinds.includes("calls") && defScope.length >= 10,
      `default callers(nested) kinds=${JSON.stringify(defKinds)}, summary.relationshipTypesUsed=${defScope.length} kind(s) — the fix is at the consumers, NOT a narrowed engine`,
    )

    // ── B. the differential: what the consumer reports vs what the store holds ─
    const defFroms = def.callers.map((e: any) => def.nodes[e.from]?.name).filter(Boolean)
    const defStems = [...new Set(defFroms)].sort()
    check(
      "B1-differential-the-unscoped-walk-returns-BOTH-rows",
      def.callers.length >= 2 && defStems.includes("TestHost") && defStems.includes("realTest"),
      `unscoped callers(nested) = ${JSON.stringify(defFroms)} (distinct ${JSON.stringify(defStems)}) — the containment row IS in the answer an unscoped consumer would receive`,
    )
    check(
      "B2-differential-the-scoped-walk-keeps-the-dependency-row-only",
      scopedCalls.callers.length === 1 && scopedCalls.nodes[scopedCalls.callers[0].from]?.name === "realTest",
      `relationshipTypes:[calls,instantiates,extends,implements] callers(nested) = ${JSON.stringify(scopedCalls.callers.map((e: any) => scopedCalls.nodes[e.from]?.name))}`,
    )

    // testImpact: the consumer that published a `contains` row as a DIRECT test.
    const impact = await testImpact(pid as any, "nested", { maxDepth: 2 })
    const directNames = impact.directTests.map((t: any) => t.testSymbol)
    check(
      "B3-testImpact-does-not-report-the-container-as-a-direct-test",
      impact.directTests.length === 1 && directNames.includes("realTest") && !directNames.includes("TestHost"),
      `directTests = ${JSON.stringify(impact.directTests.map((t: any) => `${t.testSymbol}:${t.relationshipType}/${t.evidence}`))} — TestHost appears in the unscoped walk (B1) and NOT here, because that row is membership`,
    )
    check(
      "B4-every-entry-names-its-own-kind-and-tier",
      impact.directTests.every((t: any) => typeof t.relationshipType === "string" && t.relationshipType.length > 0 && ["direct_call", "reference", "import"].includes(t.evidence)) &&
        impact.directTests[0]?.evidence === "direct_call" &&
        impact.directTests[0]?.relationshipType === "calls",
      `direct[0] = ${JSON.stringify(impact.directTests[0])} (the walk sees only the kinds this engine can classify: ${JSON.stringify(TEST_IMPACT_KINDS)})`,
    )

    // blastRadius: the consumer whose label was "caller closure".
    const targetWalk = await walk("target", false)
    const targetFroms = targetWalk.callers.map((e: any) => targetWalk.nodes[e.from]?.name).filter(Boolean)
    const targetStems = [...new Set(targetFroms)].sort()
    const suggestions = await testSuggestions(pid as any, [{ name: "target", file: "src/prod.ts", kind: "modified" }], { maxDepth: 2 })
    const radius = suggestions.changedSymbols[0]?.blastRadius ?? -1
    check(
      "B5-blastRadius-counts-dependents-not-rows",
      JSON.stringify(targetStems) === JSON.stringify(["Host", "consumer", "testTarget"]) && radius === 2,
      `unscoped callers(target) = ${JSON.stringify(targetStems)} (consumer and testTarget CALL it, Host CONTAINS it) while testSuggestions reports blastRadius=${radius}`,
    )
    const affected = suggestions.affectedExistingTests ?? []
    check(
      "B6-affected-test-rows-carry-the-kind-and-tier",
      affected.length > 0 &&
        affected.every((e: any) => typeof e.relationshipType === "string" && ["direct_call", "reference", "import"].includes(e.evidence)),
      `affectedExistingTests = ${JSON.stringify(affected.map((e: any) => `${e.testSymbol}:${e.relationshipType}/${e.evidence}`))}`,
    )

    // ── mutations: the numbers must track the STORE, not a constant ───────────
    const callRow = targetRows.find((r) => r.rel === "calls" && r.srcName === "consumer")
    db.prepare("DELETE FROM brain_relationship WHERE id = ?").run(callRow.id)
    const afterDelete = await testSuggestions(pid as any, [{ name: "target", file: "src/prod.ts", kind: "modified" }], { maxDepth: 2 })
    const radiusAfter = afterDelete.changedSymbols[0]?.blastRadius ?? -1
    const containsStillThere = rowQuery("target").some((r) => r.rel === "contains")
    check(
      "B7-mutation-removing-the-dependency-row-moves-the-number",
      radiusAfter === radius - 1 && containsStillThere,
      `after deleting the consumer->target \`calls\` row: blastRadius ${radius} -> ${radiusAfter} while the Host->target \`contains\` row is still stored (${containsStillThere}) — the count follows dependents, and the containment row was never evidence`,
    )
    db.prepare(
      `INSERT INTO brain_relationship
         (id, project_id, source_symbol_id, target_symbol_id, source_external, target_external,
          relationship_type, confidence, line_number, is_cross_language, is_cross_file)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      `${pid}:rel:kind-scope-restore`,
      pid,
      callRow.srcId,
      callRow.tgtId,
      "consumer",
      "target",
      "calls",
      0.9,
      callRow.line,
      0,
      0,
    )
    const restored = await testSuggestions(pid as any, [{ name: "target", file: "src/prod.ts", kind: "modified" }], { maxDepth: 2 })
    check(
      "B8-mutation-restoring-the-row-restores-the-number",
      (restored.changedSymbols[0]?.blastRadius ?? -1) === radius,
      `blastRadius back to ${restored.changedSymbols[0]?.blastRadius} after re-inserting the row — the measurement is data, not a constant`,
    )
  }

  // ── source guards: the fix cannot be reverted silently ─────────────────────
  {
    const ti = readFileSync(path.join(ROOT, "src/intelligence/testing/test-intel.ts"), "utf8")
    const sg = readFileSync(path.join(ROOT, "src/intelligence/testing/suggestions.ts"), "utf8")
    const im = readFileSync(path.join(ROOT, "src/intelligence/analysis/impact.ts"), "utf8")
    const ct = readFileSync(path.join(ROOT, "src/intelligence/contracts.ts"), "utf8")
    const guards: Array<[string, boolean]> = [
      ["test-intel passes TEST_IMPACT_KINDS", ti.includes("relationshipTypes: [...TEST_IMPACT_KINDS]")],
      ["test-intel declares TEST_IMPACT_KINDS from the classifier's own sets", /TEST_IMPACT_KINDS[^=]*=\s*\[/.test(ti) && ti.includes("...DIRECT_TYPES")],
      ["test-intel refuses a kind its classifier cannot name", /classify\(String\(edge\.relationshipType\)\)/.test(ti)],
      ["suggestions scopes the blast radius to IMPACT_REL_TYPES", sg.includes("relationshipTypes: [...IMPACT_REL_TYPES]")],
      ["suggestions takes the tier from the row, not from depth", !sg.includes('t.depth === 0 ? "direct_call"')],
      ["legacy impact scopes to IMPACT_REL_TYPES", im.includes("relationshipTypes: [...IMPACT_REL_TYPES]")],
      ["contracts carries the kind and tier on impact and affected-test rows", (ct.match(/relationshipType: string; evidence: TestEvidenceKind/g) ?? []).length >= 2],
    ]
    const missing = guards.filter(([, ok]) => !ok).map(([n]) => n)
    check(
      "S1-source-guards-for-every-repair",
      missing.length === 0,
      missing.length === 0
        ? `all ${guards.length} guards present — reverting any repair fails this gate`
        : `MISSING: ${missing.join(" | ")}`,
    )
  }

  // ── S2/S3: the DOCUMENTED default, checked against the engine's own list ───
  // A doc claim about a kind set rots the moment the default moves, and this one
  // did: docs/GRAPH_ENGINE.md still offered the four-kind M9 default
  // (`calls, instantiates, extends, implements`) while the engine covered ten, so
  // a reader of the engine reference would believe a `callers` set is a call
  // graph. The oracle here is DEFAULT_REL_TYPES itself, parsed from the source, so
  // the check cannot rot in the same way the row did.
  {
    const engineSrc = readFileSync(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"), "utf8")
    // Parse the DECLARATIONS, not the commentary. The first version split the
    // array body on "," and counted comment words as kinds (it read 18 kinds from
    // a 14-kind array), then required a hardcoded 10 — so a correct document and
    // a correct engine could never both pass. The expectation now comes from the
    // array itself, and comment text is removed before anything is counted.
    const body = engineSrc.match(/const DEFAULT_REL_TYPES = \[([\s\S]*?)\]/)?.[1] ?? ""
    const declarative = body
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n")
    const kinds = [...declarative.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!)
    const docRow =
      readFileSync(path.join(ROOT, "docs/GRAPH_ENGINE.md"), "utf8")
        .split("\n")
        .find((l) => l.includes("`relationshipTypes`") && l.trim().startsWith("|")) ?? ""
    const missingKinds = kinds.filter((k) => !docRow.includes(`\`${k}\``))
    check(
      "S2-the-documented-default-is-the-engine's-own-list",
      kinds.length > 0 && docRow !== "" && missingKinds.length === 0,
      `DEFAULT_REL_TYPES holds ${kinds.length} kind(s); docs/GRAPH_ENGINE.md's \`relationshipTypes\` row ` +
        (docRow === ""
          ? "was not found at all"
          : missingKinds.length
            ? `MISSING: ${missingKinds.join(", ")}`
            : "names every one of them"),
    )
    const analyzePage = readFileSync(path.join(ROOT, "docs/tools/bb_analyze.md"), "utf8")
    check(
      "S3-the-bb_analyze-page-discloses-the-kind-set-its-graph-modes-walk",
      analyzePage.includes("Callers/callees/trace answer from the graph engine's DEFAULT kind set") && analyzePage.includes("IMPACT_REL_TYPES"),
      `docs/tools/bb_analyze.md ${analyzePage.includes("DEFAULT kind set") ? "carries" : "does NOT carry"} the all-kinds disclosure and ${analyzePage.includes("IMPACT_REL_TYPES") ? "names" : "does not name"} the dependency rule mode \`impact\` walks (regenerated from script/verify-tool-docs.ts)`,
    )
  }

  console.log("\n=== checks ===")
  for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.id}\n        ${c.detail}`)
  const ok = checks.every((c) => c.pass)
  const failures = checks.filter((c) => !c.pass).map((c) => c.id)

  const { writeSealed } = await import(path.join(ROOT, "script/lib/evidence.ts"))
  const evidencePath = path.join(ROOT, "validation/m65/results/edge-kind-scoping.json")
  mkdirSync(path.dirname(evidencePath), { recursive: true })
  writeSealed(evidencePath, {
    issue: "#65",
    probe: "M65 edge-kind scoping",
    command: "npx tsx script/m65/verify-edge-kind-scoping.ts",
    question: "does every consumer that names a relationship kearn measure that kind, or the engine's all-kinds default?",
    declaredAllKindsDoors: DECLARED_ALL_KINDS_DOORS,
    callSites: sites.map((s) => `${s.file}:${s.line} ${s.scoped ? "scoped" : "all-kinds"}`),
    fixture: { project: path.basename(project), nestedRows: nestedRows.map((r) => `${r.srcName}-${r.rel}->${r.tgtName}`), targetRows: targetRows.map((r) => `${r.srcName}-${r.rel}->${r.tgtName}`) },
    checks,
    failures,
    status: ok ? "verified" : "failing",
  })

  console.log(
    ok
      ? "\nAll checks passed — every consumer that names a kind measures that kind, the engine's default is untouched, and each repair is guarded in source."
      : `\nFAILED (${failures.length}) — see the checks above.`,
  )
  if (!ok) process.exitCode = 1
}

main().catch((e) => {
  console.error("VERIFY ERROR:", e?.stack ?? e)
  process.exitCode = 2
})
