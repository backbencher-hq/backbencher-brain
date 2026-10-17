// script/m59/verify-call-site-dedupe.ts — M59 (#895 + #854 consumer option)
//
// Pins BOTH tool-layer collapses in src/intelligence/graph/graph-engine.ts by
// fixture, each with a mutation that proves the checks can fail.
//
//   #895  the owner-cascade re-fetches one brain_relationship row once per
//         traced symbol whose prefix-range covers the target (measured depths
//         [0,2,3] on cats-effect: 72 callers reported from 31 rows). Fix: one
//         row emits at most one edge per direction. The MECHANISM evidence is
//         the committed probe run (validation/m59/results/probe-rel-identity.json:
//         sameRowRepeated 41 → 0 on the real index, before/after the fix); this
//         gate pins the CODE: the rowId-uniqueness invariant on a live
//         traversal, plus a presence guard so reverting the guard fails here.
//
//   #854  the same call site + same RESOLVED target stored under different
//         spellings (`Async` vs `cekernel.Async`) — distinct rowIds, so row-level
//         dedupe cannot see them. Fix (consumer option): collapse by site key
//         (type, source symbol, resolved target, file, line) — first spelling
//         wins, the collapse is DECLARED in summary.dedupedAtToolLayer. The
//         collapse is LINE-GUARDED: a NULL line cannot prove two rows name one
//         site (measured: the YAML `contains` groups are 15 distinct keypaths,
//         not copies of one fact), and check D pins that exemption.
//
// WHAT IS COUNTED, AND WHY IT IS THE `calls` SUBSET. The traversal's default
// covers every stored kind (graph-engine.ts DEFAULT_REL_TYPES), and this
// analyzer stores MORE THAN ONE row per mention — `await callee()` writes a
// `calls` row and a `references` row for the same identifier on the same line,
// so a correct default answer carries one edge per row. Checks B/C/D/E assert
// CALL-SITE facts, so they count `calls` edges; check G then pins that every
// non-call callee is a stored row of this project and that an explicit
// `relationshipTypes:["calls"]` scope returns the identical call set, so the
// scoping cannot be used to hide an extra CALL edge.
//
// Mutations (the gate must be able to fail):
//   C  inserts a same-site/different-spelling row — the tool MUST still emit one
//      edge; removing the site-collapse guard makes this check red.
//   D  a NULL-line same-target row must NOT collapse (two call edges expected).
//   G  has no collapse to exercise, so it fails on a count change instead: it
//      ties the emitted call set to an independently scoped traversal and ties
//      every other edge to a stored row, so a fabricated or dropped edge is red.
//   F  asserts the dedupe guards exist in the shipped engine source — reverting
//      either fix turns this red even if behavior masks it.
//
// Usage: npx tsx script/m59/verify-call-site-dedupe.ts

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
process.env.BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "m59-dedupe-data-"))

const FIXTURE = [
  "// dedupe-fixture.ts — intentionally plain: one call site, one resolved target",
  "export async function site(): Promise<void> {",
  "  await callee()",
  "}",
  "export function callee(): void {}",
  "",
].join("\n")

type Check = { id: string; pass: boolean; detail: string }
const checks: Check[] = []
const check = (id: string, pass: boolean, detail: string) => checks.push({ id, pass, detail })

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const { graphTraversal } = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))

  const project = mkdtempSync(path.join(tmpdir(), "m59-dedupe-proj-"))
  mkdirSync(path.join(project, "src"), { recursive: true })
  writeFileSync(path.join(project, "src", "dedupe-fixture.ts"), FIXTURE)

  const pid = getProjectId(project) as any
  await indexProjectParallel(pid, project, {})
  const db: any = await BrainDatabase.getRawInstance(pid)

  const rowsFor = () =>
    db
      .prepare(
        `SELECT id, source_symbol_id, target_symbol_id, source_external, target_external,
                relationship_type, confidence, line_number, is_cross_language, is_cross_file
         FROM brain_relationship WHERE relationship_type = 'calls' AND line_number IS NOT NULL`,
      )
      .all() as any[]

  const baseline = rowsFor()
  const r1 = baseline.find((r) => r.line_number === 3)
  check(
    "A-fixture-stores-one-call-row",
    baseline.length === 1 && !!r1 && !!r1.source_symbol_id && !!r1.target_symbol_id,
    baseline.length === 1 && r1
      ? `baseline: 1 'calls' row (id=${r1.id}, line=${r1.line_number}, tgt=${r1.target_external ?? r1.target_symbol_id})`
      : `expected exactly 1 resolvable 'calls' row with a line; got ${baseline.length} — fixture or analyzer changed, re-derive before trusting this gate`,
  )

  if (r1 && baseline.length === 1) {
    const traverse = async () =>
      graphTraversal(pid, "site", { direction: "callees", maxDepth: 2 } as any)

    // THE CALLEE SET IS NOT THE CALL-SITE SET. A default traversal covers every
    // stored kind, and this analyzer emits MORE THAN ONE row per mention: an
    // `await callee()` stores a `calls` row AND a `references` row for the same
    // identifier on the same line. So the answer carries one edge per row by
    // design, and the old checks — written against "edges" while reading as
    // "call sites" — compared 3 edges (1 call + 2 references) to a 1-row store and
    // failed on a traversal that had collapsed the call exactly right. The claim
    // under test is about CALL SITES, so the counts below are scoped to `calls`.
    // The other edges are asserted, not ignored: check G pins that every non-call
    // callee is a stored row of this project and that an explicit calls-only scope
    // returns the identical call set (so an extra CALL edge cannot hide in them).
    const callCallees = (t: any) => (t.callees ?? []).filter((e: any) => e.relationshipType === "calls")

    // ── B: the #895 invariant on a live traversal ────────────────────────────
    const t0 = await traverse()
    const allEdges = [...t0.callers, ...t0.callees]
    const rowIds = allEdges.map((e) => e.rowId)
    const uniqueRowIds = new Set(rowIds).size === rowIds.length
    const kinds = [...new Set(t0.callees.map((e: any) => e.relationshipType))]
    check(
      "B-rowid-uniqueness-invariant",
      uniqueRowIds && callCallees(t0).length === 1,
      uniqueRowIds
        ? `traversal emitted ${allEdges.length} edge(s), all distinct rowIds; ${callCallees(t0).length} of ${t0.callees.length} callee edge(s) are \`calls\` (kinds: ${JSON.stringify(kinds)})`
        : `the same rowId was emitted more than once (${rowIds.length - new Set(rowIds).size} repeat(s)) — this is the #895 defect shape`,
    )

    // ── C: MUTATION — same site, different spelling, one edge ───────────────
    const dupId = r1.id + ":spelling-variant"
    db.prepare(
      `INSERT INTO brain_relationship
         (id, project_id, source_symbol_id, target_symbol_id, source_external, target_external,
          relationship_type, confidence, line_number, is_cross_language, is_cross_file)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      dupId,
      pid,
      r1.source_symbol_id,
      r1.target_symbol_id,
      r1.source_external,
      `ns.${r1.target_external ?? "callee"}`,
      r1.relationship_type,
      r1.confidence,
      r1.line_number,
      r1.is_cross_language,
      r1.is_cross_file,
    )
    const afterRows = rowsFor()
    const t1 = await traverse()
    const t1Edges = [...t1.callers, ...t1.callees]
    const t1RowIds = t1Edges.map((e) => e.rowId)
    check(
      "C-spelling-variant-collapses-to-one-edge",
      afterRows.length === 2 && callCallees(t1).length === 1 && new Set(t1RowIds).size === t1RowIds.length,
      `store holds ${afterRows.length} same-site rows (2 spellings); tool emitted ${callCallees(t1).length} \`calls\` callee edge(s) — ` +
        (callCallees(t1).length === 1
          ? `collapsed, declared spellingVariantsCollapsed=${t1.summary.dedupedAtToolLayer.spellingVariantsCollapsed}; first spelling wins (rowId=${callCallees(t1)[0]?.rowId})`
          : `NOT collapsed — the site-collapse guard is missing or broken (this is how #854 inflates agent-visible counts)`),
    )

    // ── D: the NULL-line exemption is real (the measured YAML guard) ─────────
    const nullId = r1.id + ":null-line"
    db.prepare(
      `INSERT INTO brain_relationship
         (id, project_id, source_symbol_id, target_symbol_id, source_external, target_external,
          relationship_type, confidence, line_number, is_cross_language, is_cross_file)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      nullId,
      pid,
      r1.source_symbol_id,
      r1.target_symbol_id,
      r1.source_external,
      `yaml.${r1.target_external ?? "callee"}`,
      r1.relationship_type,
      r1.confidence,
      null,
      r1.is_cross_language,
      r1.is_cross_file,
    )
    const t2 = await traverse()
    check(
      "D-null-line-rows-are-not-collapsed",
      callCallees(t2).length === 2,
      `with a NULL-line same-target row present, the tool emits ${callCallees(t2).length} \`calls\` callee edge(s) (expected 2) — a NULL line cannot prove two rows name one site, so they pass through untouched; spellingVariantsCollapsed=${t2.summary.dedupedAtToolLayer.spellingVariantsCollapsed} (the line-3 pair still collapsed exactly once)`,
    )

    // ── E: cleanup law — the counters track the store, no caching lies ──────
    db.prepare(`DELETE FROM brain_relationship WHERE id IN (?, ?)`).run(dupId, nullId)
    const t3 = await traverse()
    check(
      "E-removing-rows-restores-the-baseline",
      rowsFor().length === 1 && callCallees(t3).length === 1 && t3.summary.dedupedAtToolLayer.spellingVariantsCollapsed === 0,
      `after deleting the inserted rows: store=1, tool emits ${callCallees(t3).length} \`calls\` callee edge(s), collapsed=0 — the declared numbers track the store`,
    )

    // ── G: the non-call edges are the store's own rows, and the scoped answer
    //       is exactly the call set (an extra CALL edge cannot ride along) ────
    const scoped = (await graphTraversal(pid, "site", {
      direction: "callees",
      maxDepth: 2,
      relationshipTypes: ["calls"],
    } as any)) as any
    const scopedIds = scoped.callees.map((e: any) => e.rowId)
    const callIds = callCallees(t0).map((e: any) => e.rowId)
    const nonCalls = t0.callees.filter((e: any) => e.relationshipType !== "calls")
    const storeHasEveryNonCallRow = nonCalls.every((e: any) => {
      const row = db.prepare(`SELECT relationship_type AS t FROM brain_relationship WHERE id = ?`).get(e.rowId) as any
      return !!row && row.t === e.relationshipType
    })
    check(
      "G-non-call-callees-are-stored-rows-and-scoping-agrees",
      nonCalls.length > 0 && storeHasEveryNonCallRow && scopedIds.join(",") === callIds.join(","),
      `${nonCalls.length} non-call callee edge(s) ${JSON.stringify([...new Set(nonCalls.map((e: any) => e.relationshipType))])} — every one resolves to a stored row of the matching type (${storeHasEveryNonCallRow}); ` +
        `an explicit relationshipTypes:["calls"] scope returns the same ${scopedIds.length} rowId(s) as the default answer's \`calls\` subset`,
    )

    // ── F: MUTATION — the guards must exist in the shipped engine ───────────
    const engine = readFileSync(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"), "utf8")
    const guards = [
      ["#895 caller rowId guard", "emittedCallerRows.has(row.rowId)"],
      ["#895 callee rowId guard", "emittedCalleeRows.has(row.rowId)"],
      ["#854 caller site guard", "emittedCallerSites.has(siteKey)"],
      ["#854 callee site guard", "emittedCalleeSites.has(calleeKey)"],
      ["declared collapse counter", "spellingVariantsCollapsed"],
    ] as const
    const missing = guards.filter(([, needle]) => !engine.includes(needle))
    check(
      "F-dedupe-guards-present-in-engine",
      missing.length === 0,
      missing.length === 0
        ? `all 5 guards present in graph-engine.ts — reverting either fix fails this gate`
        : `MISSING in graph-engine.ts: ${missing.map(([n]) => n).join(", ")} — a dedupe was removed; the collapse is no longer enforced`,
    )
  }

  console.log("=== checks ===")
  for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.id}\n        ${c.detail}`)
  const ok = checks.every((c) => c.pass)
  console.log(
    ok
      ? "\nAll checks passed — one row emits one edge (#895) and same-site spelling variants collapse declared (#854), with the NULL-line exemption intact."
      : "\nFAILED — see the checks above.",
  )
  if (!ok) process.exitCode = 1
}

main().catch((e) => {
  console.error("VERIFY ERROR:", e?.stack ?? e)
  process.exitCode = 2
})
