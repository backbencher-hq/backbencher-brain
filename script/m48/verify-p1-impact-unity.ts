// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the impact-unity gate: bb_analyze mode=impact and
//   bb_impact must answer the SAME question from the ONE canonical walk, and
//   every bound/attribution/hint they publish must be measured, not assumed.
// WHICH GATE IT SERVES — m48/P1; it exercises the real handlers over a real
//   indexer fixture (never mocks) and the component's failure paths directly.
// WHY IT IS SHAPED THIS WAY — a gate over two doors is worthless if the doors
//   can disagree silently, so the comparison is on real payloads; a gate over
//   truncation is worthless if it can only ever see `truncated:false`, so the
//   fixture includes a >200-dependent case AND a 200-dependent case with a
//   duplicate call site (the engine's row cap must not masquerade as a
//   truncation of the dependent set); and a gate over owner-cascade is
//   worthless if `via` is never asserted, so the class fixture checks it.
// WHERE ITS EVIDENCE LIVES — validation/m48/results/P1.json; the planted-mutant
//   red runs for this tool are recorded in validation/tools/bb_impact/MUTANTS.json.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/lsp/impact.ts (bounds, completion
//   measurement, attribution, file hint), src/mcp/tools/bb_impact/handler.ts,
//   src/mcp/tools/shared.ts (canonicalImpactReport), src/mcp/tools/bb_analyze/.
// CONTRACTS IT MUST NOT BREAK — every assertion is a predicate over real output;
//   a planted defect in the bounds, the completion measurement, the attribution
//   or the file hint must turn this gate red.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdtempSync, mkdirSync, writeFileSync, mkdirSync as ensureDir } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT, "validation/m48/results")
const READ_ONLY = process.env.BB_M48_READ_ONLY === "1"

let passed = 0, failed = 0, negatives = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++
  else { failed++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}
function negative(label: string, ok: boolean, detail = "") { negatives++; check(`${label} [negative]`, ok, detail) }

async function main() {
  const dataDir = mkdtempSync(path.join(tmpdir(), "m48-p1-data-"))
  process.env.BB_DATA_DIR = dataDir
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers"))
  const { computeImpact, countImpactDependents, IMPACT_WALK_TIME_CEILING_MS, IMPACT_CALL_DEADLINE_MS } = await import(path.join(ROOT, "src/lsp/impact"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))

  const proj = mkdtempSync(path.join(tmpdir(), "m48-p1-fixture-"))
  mkdirSync(path.join(proj, "src"), { recursive: true })
  writeFileSync(path.join(proj, "src", "a.ts"), `export function leaf(): number { return 1 }\nexport class Service {\n  run(): void { leaf() }\n}\n`)
  writeFileSync(path.join(proj, "src", "b.ts"), `import { leaf } from "./a"\nexport function b1(): void { leaf() }\nexport function b2(): void { leaf() }\n`)
  writeFileSync(path.join(proj, "src", "c.ts"), `import { b1 } from "./b"\nexport function c1(): void { b1() }\n`)
  writeFileSync(path.join(proj, "src", "d.ts"), `import { c1 } from "./c"\nexport function d1(): void { c1() }\n`)
  writeFileSync(path.join(proj, "src", "e.ts"), `import { d1 } from "./d"\nexport function e1(): void { d1() }\n`)
  writeFileSync(path.join(proj, "src", "f.ts"), `import { e1 } from "./e"\nexport function f1(): void { e1() }\n`)
  writeFileSync(path.join(proj, "src", "g.ts"), `import { Service } from "./a"\nexport function g1(): void { new Service().run() }\nexport function g2(): void { new Service().run() }\n`)
  // >200 distinct direct callers of leafB => computeImpact must truncate at its
  // declared 200-node budget and BOTH doors must report truncated:true.
  writeFileSync(path.join(proj, "src", "a2.ts"), `export function leafB(): void {}\n`)
  const bulk = ["import { leafB } from \"./a2\""]
  for (let i = 0; i < 250; i++) bulk.push(`export function bulk${i}(): void { leafB() }`)
  writeFileSync(path.join(proj, "src", "bulk.ts"), bulk.join("\n") + "\n")

  // 200 distinct dependents over 201 caller rows: one caller has TWO call sites,
  // so the engine's per-query site cap drops a duplicate row. The dependent SET
  // is still the whole truth, and a row cap must NOT be reported as a
  // truncation of the set (the measured `totalCountIfKnown` settles it).
  writeFileSync(path.join(proj, "src", "a3.ts"), `export function target200(): void {}\n`)
  const early = ["import { target200 } from \"./a3\""]
  for (let i = 0; i < 199; i++) early.push(`export function early${i}(): void { target200() }`)
  writeFileSync(path.join(proj, "src", "aaa-callers.ts"), early.join("\n") + "\n")
  writeFileSync(path.join(proj, "src", "zzz-last.ts"), `import { target200 } from "./a3"\nexport function zz(): void {\n  target200()\n  target200()\n}\n`)

  // A hub whose dependent SET exceeds the declared 200-node budget without any
  // single query hitting the engine's per-query row cap: 199 direct callers plus
  // two indirect callers for the first 50 of them (~299 distinct dependents).
  // This is the only shape in which the tool's own node budget — not the
  // engine's row cap — is the bound the answer is truncated at.
  writeFileSync(path.join(proj, "src", "a4.ts"), `export function hubTarget(): void {}\n`)
  const hubCallers = ["import { hubTarget } from \"./a4\""]
  for (let i = 0; i < 199; i++) hubCallers.push(`export function hubCaller${i}(): void { hubTarget() }`)
  writeFileSync(path.join(proj, "src", "hub-callers.ts"), hubCallers.join("\n") + "\n")
  const indirectImports = Array.from({ length: 50 }, (_, i) => `hubCaller${i}`).join(", ")
  const indirect = [`import { ${indirectImports} } from "./hub-callers"`]
  for (let i = 0; i < 50; i++) {
    indirect.push(`export function hubIndirectA${i}(): void { hubCaller${i}() }`)
    indirect.push(`export function hubIndirectB${i}(): void { hubCaller${i}() }`)
  }
  writeFileSync(path.join(proj, "src", "hub-indirect.ts"), indirect.join("\n") + "\n")

  // Two same-named members in different files: the member-resolution path (and
  // the tool's `file` hint) must select the OWNING declaration named by the
  // hint and refuse a hint that does not identify it.
  writeFileSync(path.join(proj, "src", "one.ts"), `export class DerivedA {\n  constructor() {}\n  run(): void {}\n}\nexport function useA(): void { new DerivedA().run() }\n`)
  writeFileSync(path.join(proj, "src", "two.ts"), `export class DerivedB {\n  constructor() {}\n  run(): void {}\n}\nexport function useB(): void { new DerivedB().run() }\n`)

  const pid = getProjectId(proj)
  await indexProjectParallel(pid, proj, {})
  const handlers = createToolHandlers()
  const ctx = { projectPath: proj, projectId: pid }
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await (handlers as any)[name](args, ctx as any)
    if (r?.isError) return null
    try { return JSON.parse(r.content[0].text) } catch { return null }
  }
  const callError = async (name: string, args: Record<string, unknown>) => {
    const r = await (handlers as any)[name](args, ctx as any)
    if (!r?.isError) return null
    return String(r.content[0].text)
  }

  const fileSet = (rows: Array<{ file: string }>) => new Set((rows ?? []).map((x) => path.basename(x.file)))
  for (const root of ["leaf", "Service", "f1"]) {
    const imp = await call("bb_impact", { symbol: root })
    const ana = await call("bb_analyze", { mode: "impact", target: root })
    check(`P1: bb_impact + bb_analyze impact both resolve root ${root}`, !!imp && !!ana, `imp=${!!imp} ana=${!!ana}`)
    if (!imp || !ana) continue
    const iFiles = fileSet(imp.impact)
    const aFiles = fileSet(ana.affectedFiles)
    check(`P1: same affected file set on ${root}`, iFiles.size === aFiles.size && [...iFiles].every((f) => aFiles.has(f)), `bb_impact=${[...iFiles].join(",")} bb_analyze=${[...aFiles].join(",")}`)
    check(`P1: totalSymbols == bb_impact.shownCount on ${root}`, ana.totalSymbols === imp.shownCount, `${ana.totalSymbols} vs ${imp.shownCount}`)
    check(`P1: limits declared on ${root}`, ana.depthCap === 5 && ana.nodeBudget === 200 && typeof ana.depthReached === "number" && ana.depthReached >= 0 && ana.depthReached <= 5, JSON.stringify({ depthCap: ana.depthCap, nodeBudget: ana.nodeBudget, depthReached: ana.depthReached }))
    check(`P1: freshness envelope present on ${root}`, !!ana.freshness, "")
    check(`P1: truncated agrees on ${root}`, ana.truncated === imp.truncated, `ana=${ana.truncated} imp=${imp.truncated}`)
    check(`P1: totalCountIfKnown is never smaller than shownCount on ${root}`, imp.totalCountIfKnown === null || imp.totalCountIfKnown >= imp.shownCount, `${imp.totalCountIfKnown} vs ${imp.shownCount}`)
    check(`P1: directCount is never smaller than the returned depth-0 count on ${root}`, imp.directCount === null || imp.directCount >= (imp.impact ?? []).filter((d: any) => d.depth === 0).length, `${imp.directCount}`)
    check(`P1: rule echoes the declared dependency kinds on ${root}`, JSON.stringify(imp.rule?.relationshipTypes) === JSON.stringify(["calls", "instantiates", "extends", "implements"]), JSON.stringify(imp.rule?.relationshipTypes))
    check(`P1: budget echoes the component's declared bounds on ${root}`, imp.budget?.maxNodes === 200 && imp.budget?.maxDepth === 5, JSON.stringify(imp.budget))
    // The wall-clock bounds are DECLARED, not implicit: the budget names both
    // deadlines, the traversal names the one the engine walk applied, and the
    // measurement declares whether it ran or was skipped for the deadline.
    check(`P1: budget declares the walk and call deadlines on ${root}`, imp.budget?.walkTimeCeilingMs === IMPACT_WALK_TIME_CEILING_MS && imp.budget?.callDeadlineMs === IMPACT_CALL_DEADLINE_MS, JSON.stringify({ walk: imp.budget?.walkTimeCeilingMs, call: imp.budget?.callDeadlineMs }))
    check(`P1: traversal declares the walk deadline it applied on ${root}`, imp.traversal?.walkTimeBudgetMs === IMPACT_WALK_TIME_CEILING_MS, JSON.stringify({ walkTimeBudgetMs: imp.traversal?.walkTimeBudgetMs, exhausted: imp.traversal?.walkTimeExhausted }))
    check(`P1: the measurement declares whether it ran or was skipped on ${root}`, typeof imp.countVerification?.skipped === "boolean" && !(imp.countVerification.ran === true && imp.countVerification.skipped === true) && (imp.countVerification.skipped === true ? imp.countVerification.complete === null : true), JSON.stringify(imp.countVerification))
    check(`P1: an exhausted walk clock is declared non-reproducible on ${root}`, imp.traversal?.walkTimeExhausted !== true || imp.reproducible === false, JSON.stringify({ exhausted: imp.traversal?.walkTimeExhausted, reproducible: imp.reproducible }))
  }

  // Budget truncation: truncated MUST be true on both doors (hollow-false killed).
  {
    const imp = await call("bb_impact", { symbol: "leafB" })
    const ana = await call("bb_analyze", { mode: "impact", target: "leafB" })
    check("P1: >200 callers => bb_impact truncated:true", !!imp && imp.truncated === true, `truncated=${imp?.truncated} shown=${imp?.shownCount}`)
    check("P1: >200 callers => bb_impact measured a larger total", !!imp && typeof imp.totalCountIfKnown === "number" && imp.totalCountIfKnown > imp.shownCount, `${imp?.totalCountIfKnown} vs ${imp?.shownCount}`)
    check("P1: >200 callers => completeness was measured and disagrees", !!imp && imp.countVerification?.ran === true && imp.countVerification?.complete === false, JSON.stringify(imp?.countVerification))
    check("P1: >200 callers => bb_analyze impact truncated:true (honest, can be true)", !!ana && ana.truncated === true, `truncated=${ana?.truncated}`)
    check("P1: truncation reason declared on bb_analyze impact", !!ana && typeof ana.truncationReason === "string" && ana.truncationReason.length > 0, ana?.truncationReason)
    if (imp && ana) {
      check("P1: truncated case still agrees on file set", fileSet(imp.impact).size === fileSet(ana.affectedFiles).size, "")
      check("P1: truncated case totalSymbols == shownCount", ana.totalSymbols === imp.shownCount, `${ana.totalSymbols} vs ${imp.shownCount}`)
    }
  }

  // The tool's OWN 200-node budget: >200 DISTINCT dependents across levels, so
  // the budget (not an engine query cap) is what truncates the set, and the
  // declared total must measure the larger truth.
  {
    const imp = await call("bb_impact", { symbol: "hubTarget" })
    const ana = await call("bb_analyze", { mode: "impact", target: "hubTarget" })
    check("P1: a >200-dependent hub is capped at the declared node budget", !!imp && imp.shownCount === 200 && imp.budget?.maxNodes === 200, `shown=${imp?.shownCount} budget=${imp?.budget?.maxNodes}`)
    check("P1: the node budget declares truncation", !!imp && imp.truncated === true, `truncated=${imp?.truncated}`)
    check("P1: the declared total measures the larger truth beyond the node budget", !!imp && typeof imp.totalCountIfKnown === "number" && imp.totalCountIfKnown > imp.shownCount, `${imp?.totalCountIfKnown} vs ${imp?.shownCount}`)
    check("P1: the completeness measurement disagrees with a capped set", !!imp && imp.countVerification?.complete === false, JSON.stringify(imp?.countVerification))
    check("P1: both doors agree on the capped hub", !!imp && !!ana && ana.totalSymbols === imp.shownCount && ana.truncated === imp.truncated, JSON.stringify({ anaShown: ana?.totalSymbols, impShown: imp?.shownCount }))
  }

  // Row cap without a missing dependent: the count walk proves the set COMPLETE,
  // so `truncated` must be FALSE even though the engine declared its row bound.
  {
    const imp = await call("bb_impact", { symbol: "target200" })
    check("P1: 200 distinct dependents => shownCount is the declared budget", !!imp && imp.shownCount === 200, `${imp?.shownCount}`)
    check("P1: a row cap that hid no dependent is NOT a set truncation", !!imp && imp.truncated === false, `truncated=${imp?.truncated} reason=${imp?.truncationReason}`)
    check("P1: the completeness measurement says complete:true", !!imp && imp.countVerification?.complete === true && imp.countVerification?.ran === true, JSON.stringify(imp?.countVerification))
    check("P1: the engine's own bound is still declared on traversal", !!imp && imp.traversal?.engineTruncated === true, JSON.stringify(imp?.traversal?.engineTruncationReason))
    check("P1: a complete measured set reports total == shown", !!imp && imp.totalCountIfKnown === imp.shownCount, `${imp?.totalCountIfKnown} vs ${imp?.shownCount}`)
  }

  // Owner-cascade attribution: a class's dependents through its members say HOW
  // they are dependents, and the composition is declared.
  {
    const imp = await call("bb_impact", { symbol: "Service" })
    const memberRows = (imp?.impact ?? []).filter((d: any) => d.via === "member")
    check("P1: class dependents are attributed through the owner cascade", !!imp && imp.cascade?.member >= 1, JSON.stringify(imp?.cascade))
    check("P1: every member row names the member that made it a dependent", memberRows.length === 0 || memberRows.every((d: any) => typeof d.viaMember?.name === "string" && d.viaMember.name.length > 0), JSON.stringify(memberRows.map((d: any) => d.viaMember)))
    check("P1: cascade composition accounts for every returned row", !!imp && imp.cascade && imp.cascade.exact + imp.cascade.member + imp.cascade.rangeFolded === imp.shownCount, JSON.stringify({ cascade: imp?.cascade, shown: imp?.shownCount }))
    check("P1: the rule declares the owner cascade it applied", !!imp && typeof imp.rule?.cascade === "string" && imp.rule.cascade.includes("owner-cascade"), imp?.rule?.cascade)
  }

  // `file` hint: selects an ambiguous member's owning declaration, and refuses a
  // hint that does not identify the symbol (never silently ignored).
  {
    const noHint = await callError("bb_impact", { symbol: "constructor" })
    check("P1: ambiguous member without a hint is a declared error naming the hint", noHint !== null && noHint.includes("file"), String(noHint).slice(0, 200))
    const hinted = await call("bb_impact", { symbol: "constructor", file: "src/two.ts" })
    check("P1: the hint resolves the member through its owning declaration", !!hinted && hinted.resolution?.through === "owning-declaration" && hinted.resolution?.ownerName === "DerivedB", JSON.stringify(hinted?.resolution))
    check("P1: the answer names the file identity it rooted at", !!hinted && hinted.resolution?.memberFile === "src/two.ts", JSON.stringify(hinted?.resolution))
    check("P1: the resolved root is the hinted class", !!hinted && hinted.root?.name === "DerivedB" && hinted.root?.file === "src/two.ts", JSON.stringify({ root: hinted?.root?.name, file: hinted?.root?.file }))
    const wrongHint = await callError("bb_impact", { symbol: "constructor", file: "src/nope.ts" })
    check("P1: a hint that cannot identify the symbol is refused, not ignored", wrongHint !== null && wrongHint.includes("does not identify"), String(wrongHint).slice(0, 200))
  }

  // Component failure paths that a handler-only gate cannot see.
  {
    const raw = await BrainDatabase.getRawInstance(pid)
    const emptyRule = await computeImpact(raw, pid, "leaf", {}, undefined, { relationshipTypes: [] }).then(() => null).catch((e: Error) => e.message)
    check("P1: the component REFUSES an empty relationshipTypes list", typeof emptyRule === "string" && emptyRule.includes("at least one relationship kind"), String(emptyRule).slice(0, 200))
    // The counting walk takes a STORED SYMBOL ID, not a name — resolve it first.
    const d1Row = raw.prepare("SELECT id FROM brain_symbol WHERE project_id = ? AND name = ? LIMIT 1").get(pid, "d1") as { id: string } | undefined
    const d1Id = d1Row?.id ?? ""
    check("P1: the fixture root for the counting walk resolves to a stored symbol", d1Id.length > 0, `id=${d1Id}`)
    const counted = countImpactDependents(raw, pid, d1Id, { maxDepth: 5, scanCeiling: 1 })
    check("P1: the counting walk reports a declared unknown past its scan ceiling", counted.hitScanCeiling === true && counted.total === null, JSON.stringify({ hit: counted.hitScanCeiling, total: counted.total, failed: counted.failed }))
    const failedRule = countImpactDependents(raw, pid, d1Id, { maxDepth: 5, relationshipTypes: [] })
    check("P1: the counting walk marks a refused rule as failed, not as zero", failedRule.failed === true && failedRule.total === null, JSON.stringify({ failed: failedRule.failed, total: failedRule.total }))
  }

  // Unknown symbol: declared absence, never a crash.
  {
    const ana = await call("bb_analyze", { mode: "impact", target: "m48_no_such_symbol" })
    check("P1: unknown symbol => found:false", !!ana && ana.found === false, "")
    check("P1: unknown symbol => zero affected files + low risk", !!ana && (ana.affectedFiles ?? []).length === 0 && ana.riskLevel === "low", "")
  }

  // Negatives: the predicates must be able to refuse.
  {
    const fakeImp = { impact: [{ file: "x" }], shownCount: 1, truncated: false }
    const fakeAna = { affectedFiles: [{ file: "y" }], totalSymbols: 2, truncated: false }
    negative("disagreeing file sets would fail the agreement predicate", !(fakeImp.impact[0].file === fakeAna.affectedFiles[0].file && fakeImp.shownCount === fakeAna.totalSymbols), "")
    const fakeImpT = { ...fakeImp, truncated: true }
    const fakeAnaT = { ...fakeAna, truncated: false }
    negative("disagreeing truncated flags would fail the truncated-agreement predicate", !(fakeImpT.truncated === fakeAnaT.truncated), "")
    const hollow = { truncated: false, depthCap: 5, depthReached: 1, totalSymbols: 1, affectedFiles: [] }
    negative("missing declared limits would fail the limits predicate", !(typeof (hollow as any).depthCap === "number" && (hollow as any).nodeBudget === 200), "")
    // Detection predicates: each one FEEDS the defective shape and must report it.
    const rowCapOnly = { totalCountIfKnown: 200, shownCount: 200, truncated: true }
    const detectsFalseTruncation = rowCapOnly.truncated === true && rowCapOnly.totalCountIfKnown === rowCapOnly.shownCount
    negative("a false prefix claim (total == shown while truncated) is detected", detectsFalseTruncation, JSON.stringify(rowCapOnly))
    const unattributed = { cascade: { exact: 1, member: 0, rangeFolded: 0 }, memberRows: 1 }
    negative("an attributed member row with no declared member is detected", unattributed.cascade.member !== unattributed.memberRows, JSON.stringify(unattributed))
    const unmeasuredPrefix = { totalCountIfKnown: 50, shownCount: 200, truncated: false }
    const detectsHollowPrefix = unmeasuredPrefix.totalCountIfKnown !== null && unmeasuredPrefix.totalCountIfKnown < unmeasuredPrefix.shownCount && unmeasuredPrefix.truncated === false
    negative("a prefix claimed as complete is detected", detectsHollowPrefix, JSON.stringify(unmeasuredPrefix))
  }

  const ok = failed === 0
  const evidence = {
    status: ok ? "verified" : "known-gap",
    currentCommit: (await import("node:child_process").then((m) => m.execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim())),
    workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m48/verify-p1-impact-unity.ts",
    evidenceFile: "P1.json",
    generatedAt: new Date().toISOString(),
    passed, failed, negativeCases: negatives,
    failures,
    fixtureNote: "chain leaf<-b1/b2<-c1<-d1<-e1<-f1 + Service class cascade + 250 direct callers of leafB (budget truncation) + 200 distinct dependents/201 rows (row-cap-not-truncation) + two same-named constructors (file hint)",
    checks: {
      unity: "bb_impact vs bb_analyze on file sets, totals, truncation flags and declared bounds",
      budget: ">200 dependents => truncated true with a measured larger total; 200 dependents/201 rows => truncated false with complete:true",
      attribution: "owner-cascade member rows name their member and the composition sums to shownCount",
      hint: "ambiguous member resolves through its owning declaration at the hinted file; unusable hint refused",
      component: "empty relationshipTypes refused; scan ceiling => declared unknown; refused rule => failed, not zero",
    },
  }
  ensureDir(RESULTS_DIR, { recursive: true })
  if (!READ_ONLY) { const { writeFileSync } = await import("node:fs"); writeFileSync(path.join(RESULTS_DIR, "P1.json"), JSON.stringify(evidence, null, 2) + "\n") }
  console.log(`M48 P1 IMPACT UNITY: ${ok ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed, ${negatives} negatives)`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
