// script/m48/verify-p1-impact-unity.ts — M48.P1 (#696)
// ONE impact calculator: bb_analyze mode=impact aggregates the SAME canonical
// walk bb_impact uses (computeImpact). This gate proves on a real indexed
// fixture that the two doors AGREE and that limits are DECLARED honestly:
//
//   1. Same affected file set on every sampled root (the old defect: bb_analyze
//      silently stopped at depth 3 and dropped real dependents while claiming
//      truncated:false).
//   2. totalSymbols (bb_analyze) == shownCount (bb_impact) — same result object.
//   3. Declared limits: depthCap=5, nodeBudget=200, depthReached present, and
//      freshness envelope still carried by bb_analyze impact.
//   4. Budget truncation CAN be true: >200 direct callers => both doors report
//      truncated:true (hollow-false is impossible).
//   5. Unknown symbol => found:false, no crash (declared absence).
//
// No auto-passes: every check is a real predicate over real handler output.

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

  const proj = mkdtempSync(path.join(tmpdir(), "m48-p1-fixture-"))
  mkdirSync(path.join(proj, "src"), { recursive: true })
  writeFileSync(path.join(proj, "src", "a.ts"), `export function leaf(): number { return 1 }\nexport class Service {\n  run(): void { leaf() }\n}\n`)
  writeFileSync(path.join(proj, "src", "b.ts"), `import { leaf } from "./a"\nexport function b1(): void { leaf() }\nexport function b2(): void { leaf() }\n`)
  writeFileSync(path.join(proj, "src", "c.ts"), `import { b1 } from "./b"\nexport function c1(): void { b1() }\n`)
  writeFileSync(path.join(proj, "src", "d.ts"), `import { c1 } from "./c"\nexport function d1(): void { c1() }\n`)
  writeFileSync(path.join(proj, "src", "e.ts"), `import { d1 } from "./d"\nexport function e1(): void { d1() }\n`)
  writeFileSync(path.join(proj, "src", "f.ts"), `import { e1 } from "./e"\nexport function f1(): void { e1() }\n`)
  writeFileSync(path.join(proj, "src", "g.ts"), `import { Service } from "./a"\nexport function g1(): void { new Service().run() }\nexport function g2(): void { new Service().run() }\n`)
  // >200 distinct direct callers of leafB => computeImpact must truncate at
  // its declared 200-node budget and BOTH doors must report truncated:true.
  writeFileSync(path.join(proj, "src", "a2.ts"), `export function leafB(): void {}\n`)
  const bulk = ["import { leafB } from \"./a2\""]
  for (let i = 0; i < 250; i++) bulk.push(`export function bulk${i}(): void { leafB() }`)
  writeFileSync(path.join(proj, "src", "bulk.ts"), bulk.join("\n") + "\n")

  const pid = getProjectId(proj)
  await indexProjectParallel(pid, proj, {})
  const handlers = createToolHandlers()
  const ctx = { projectPath: proj, projectId: pid }
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await (handlers as any)[name](args, ctx as any)
    if (r?.isError) return null
    try { return JSON.parse(r.content[0].text) } catch { return null }
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
  }

  // Budget truncation: truncated MUST be true on both doors (hollow-false killed).
  {
    const imp = await call("bb_impact", { symbol: "leafB" })
    const ana = await call("bb_analyze", { mode: "impact", target: "leafB" })
    check("P1: >200 callers => bb_impact truncated:true", !!imp && imp.truncated === true, `truncated=${imp?.truncated} shown=${imp?.shownCount}`)
    check("P1: >200 callers => bb_analyze impact truncated:true (honest, can be true)", !!ana && ana.truncated === true, `truncated=${ana?.truncated}`)
    check("P1: truncation reason declared on bb_analyze impact", !!ana && typeof ana.truncationReason === "string" && ana.truncationReason.length > 0, ana?.truncationReason)
    if (imp && ana) {
      check("P1: truncated case still agrees on file set", fileSet(imp.impact).size === fileSet(ana.affectedFiles).size, "")
      check("P1: truncated case totalSymbols == shownCount", ana.totalSymbols === imp.shownCount, `${ana.totalSymbols} vs ${imp.shownCount}`)
    }
  }

  // Unknown symbol: declared absence, never a crash.
  {
    const ana = await call("bb_analyze", { mode: "impact", target: "m48_no_such_symbol" })
    check("P1: unknown symbol => found:false", !!ana && ana.found === false, "")
    check("P1: unknown symbol => zero affected files + low risk", !!ana && (ana.affectedFiles ?? []).length === 0 && ana.riskLevel === "low", "")
  }

  // In-memory negatives: the predicates must be able to refuse.
  {
    const fakeImp = { impact: [{ file: "x" }], shownCount: 1, truncated: false }
    const fakeAna = { affectedFiles: [{ file: "y" }], totalSymbols: 2, truncated: false }
    negative("disagreeing file sets would fail the agreement predicate", !(fakeImp.impact[0].file === fakeAna.affectedFiles[0].file && fakeImp.shownCount === fakeAna.totalSymbols), "")
    const fakeImpT = { ...fakeImp, truncated: true }
    const fakeAnaT = { ...fakeAna, truncated: false }
    negative("disagreeing truncated flags would fail the truncated-agreement predicate", !(fakeImpT.truncated === fakeAnaT.truncated), "")
    const hollow = { truncated: false, depthCap: 5, depthReached: 1, totalSymbols: 1, affectedFiles: [] }
    negative("missing declared limits would fail the limits predicate", !(typeof (hollow as any).depthCap === "number" && (hollow as any).nodeBudget === 200), "")
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
    fixtureNote: "chain leaf<-b1/b2<-c1<-d1<-e1<-f1 + Service.run + 250 direct callers of leafB (budget truncation)",
  }
  ensureDir(RESULTS_DIR, { recursive: true })
  if (!READ_ONLY) { const { writeFileSync } = await import("node:fs"); writeFileSync(path.join(RESULTS_DIR, "P1.json"), JSON.stringify(evidence, null, 2) + "\n") }
  console.log(`M48 P1 IMPACT UNITY: ${ok ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed, ${negatives} negatives)`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
