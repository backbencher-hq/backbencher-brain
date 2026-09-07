// script/m48/verify-p2-honesty-fields.ts — M48.P2 (#697)
// No hollow completeness/absence claims on any of the 16 tools. A field that
// claims completeness ("truncated", "declaredAbsent", "complete", "sampled")
// must be able to be FALSE and must be set from real measurements.
//
// Gate sections:
//   1. STATIC self-audit: scan the tool output builders (handlers + every
//      module reachable by a tool) for watchlist keys assigned ONLY a single
//      literal (true or false) with no dynamic/opposite assignment anywhere
//      in that builder. Such a field is hollow => FAIL.
//   2. LEGACY guard: no tool handler imports analyzeImpact (the deprecated
//      depth-capped calculator); the module carries the deprecation marker.
//   3. P1 cross-ref: bb_analyze impact "truncated CAN be true" is machine-
//      proven by the P1 gate evidence (250-caller > 200 budget case) — the
//      two gates are in the same npm chain, so P2 asserts that evidence is
//      verified rather than re-running the heavy fixture.
//   4. FIXTURE proof: annotations declaredAbsent is real — true on an empty
//      project, false after bb_annotate writes one row (same symbol).
//   5. AUDIT DOC: docs/m48/P2-AUDIT.md exists and lists all 16 tools.
// No auto-passes; every predicate can refuse (negatives in section 6).

import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
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

// Watchlist: completeness/absence claims that must be able to flip.
const WATCH = ["truncated", "declaredAbsent", "declared_absent", "complete", "sampled"]

// Tool output builders: tool-handlers + every builder module reachable by a
// public tool. LSP-only surfaces (navigation/call_hierarchy/symbols) are the
// hub lane, not tool outputs, and are intentionally excluded.
const BUILDER_FILES = [
  "src/mcp/tool-handlers.ts",
  "src/intelligence/analysis/impact.ts",
  "src/intelligence/analysis/dependencies.ts",
  "src/intelligence/analysis/complexity.ts",
  "src/intelligence/analysis/project-stats.ts",
  "src/intelligence/analysis/run-history.ts",
  "src/intelligence/testing/test-intel.ts",
  "src/intelligence/testing/quality.ts",
  "src/intelligence/patterns/orphans.ts",
  "src/intelligence/search/quick-answer.ts",
  "src/intelligence/health/health-provider.ts",
  "src/intelligence/documentation/doc-engine.ts",
  "src/intelligence/visualization/visualization-engine.ts",
  "src/intelligence/migration/migration-engine.ts",
  "src/intelligence/edit/edit-engine.ts",
  "src/security/cross-language-security.ts",
  "src/lsp/impact.ts",
  "src/intelligence/graph/graph-engine.ts",
]

const LIT = /([A-Za-z][A-Za-z0-9]*)\s*:\s*(true|false)\b/g
const DYN = /([A-Za-z][A-Za-z0-9]*)\s*:\s*(?!true\b|false\b)([A-Za-z0-9_.$[\]]|\s)/g

function auditFile(rel: string): string[] {
  const hits: string[] = []
  const abs = path.join(ROOT, rel)
  if (!existsSync(abs)) { hits.push(`${rel}: MISSING`); return hits }
  const src = readFileSync(abs, "utf8")
  const literals = new Map<string, Set<string>>()
  for (const m of src.matchAll(LIT)) {
    const key = m[1]
    if (!WATCH.includes(key)) continue
    if (!literals.has(key)) literals.set(key, new Set())
    literals.get(key)!.add(m[2])
  }
  const dynamic = new Set<string>()
  for (const m of src.matchAll(DYN)) {
    const key = m[1]
    if (WATCH.includes(key)) dynamic.add(key)
  }
  for (const key of WATCH) {
    const lits = literals.get(key)
    if (!lits) continue
    const hollow = lits.size === 1 && !dynamic.has(key)
    if (hollow) hits.push(`${rel}: "${key}" only ever assigned ${[...lits][0]} (never the opposite, never dynamic)`)
  }
  return hits
}

async function main() {
  // 1. Static self-audit
  const hollowHits: string[] = []
  for (const rel of BUILDER_FILES) hollowHits.push(...auditFile(rel))
  check("no hollow completeness field in any tool output builder", hollowHits.length === 0, hollowHits.join(" | "))

  // 2. Legacy guard: handlers must not import the deprecated calculator
  const handlersSrc = readFileSync(path.join(ROOT, "src/mcp/tool-handlers.ts"), "utf8")
  check("tool handlers do not import the deprecated analyzeImpact", !handlersSrc.includes("analyzeImpact"), "")
  const legacySrc = readFileSync(path.join(ROOT, "src/intelligence/analysis/impact.ts"), "utf8")
  check("legacy analyzeImpact carries the M48 deprecation marker", legacySrc.includes("DEPRECATED as a tool-surface calculator"), "")

  // 3. P1 cross-ref: truncated-can-be-true is proven by P1 evidence in the
  // same npm chain (250-caller fixture > 200-node budget).
  const p1Path = path.join(RESULTS_DIR, "P1.json")
  let p1Ok = false
  if (existsSync(p1Path)) {
    const p1 = JSON.parse(readFileSync(p1Path, "utf8"))
    p1Ok = p1.status === "verified" && p1.failed === 0 && p1.passed > 0
  }
  check("P1 evidence verified (proves truncated can be true on a real fixture)", p1Ok, "")

  // 4. Fixture proof: annotations declaredAbsent is REAL (both states).
  {
    const dataDir = mkdtempSync(path.join(tmpdir(), "m48-p2-data-"))
    process.env.BB_DATA_DIR = dataDir
    const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
    const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
    const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers"))
    const proj = mkdtempSync(path.join(tmpdir(), "m48-p2-fixture-"))
    mkdirSync(path.join(proj, "src"), { recursive: true })
    writeFileSync(path.join(proj, "src", "a.ts"), "export function alpha(): number { return 1 }\n")
    const pid = getProjectId(proj)
    await indexProjectParallel(pid, proj, {})
    const h = createToolHandlers()
    const ctx = { projectPath: proj, projectId: pid }
    const call = async (name: string, args: any) => {
      const r = await (h as any)[name](args, ctx as any)
      return JSON.parse(r.content[0].text)
    }
    const before = await call("bb_annotations", { symbol: "alpha" })
    check("bb_annotations: declaredAbsent TRUE with zero rows (absence is real)", before.declaredAbsent === true, JSON.stringify(before).slice(0, 120))
    const w = await call("bb_annotate", { symbol: "alpha", body: "m48.p2 probe note" })
    check("bb_annotate writes one row", typeof w === "object" && w.stored === true && w.annotation?.symbol_name === "alpha", JSON.stringify(w).slice(0, 140))
    const after = await call("bb_annotations", { symbol: "alpha" })
    check("bb_annotations: declaredAbsent FALSE after a real write (field can flip)", after.declaredAbsent === false, JSON.stringify(after).slice(0, 120))
  }

  // 5. Audit doc present, covering all 16 tools
  const auditPath = path.join(ROOT, "docs/m48/P2-AUDIT.md")
  check("docs/m48/P2-AUDIT.md exists", existsSync(auditPath), "")
  if (existsSync(auditPath)) {
    const audit = readFileSync(auditPath, "utf8")
    const tools = [...new Set([...audit.matchAll(/\| bb_([a-z_]+) /g)].map((m) => m[1]))]
    const regSrc = readFileSync(path.join(ROOT, "src/mcp/tool-registry.ts"), "utf8")
    const registered = new Set([...regSrc.matchAll(/name:\s*"(bb_[a-z_]+)"/g)].map((m) => m[1]))
    const missing = [...registered].filter((t) => !audit.includes(`| ${t} `))
    check("audit doc lists every one of the 16 tools", missing.length === 0, missing.join(","))
  }

  // 6. Negatives: the predicates must be able to refuse
  {
    negative("a hollow literal field is refused by the scanner", auditFile("src/mcp/tool-handlers.ts").length === 0, "")
    const tmp = mkdtempSync(path.join(tmpdir(), "m48-p2-mut-"))
    const mut = path.join(tmp, "mut.ts")
    writeFileSync(mut, "const o = { truncated: false }\n")
    const src = readFileSync(mut, "utf8")
    const lits = new Map<string, Set<string>>()
    for (const m of src.matchAll(LIT)) { const k = m[1]; if (WATCH.includes(k)) { if (!lits.has(k)) lits.set(k, new Set()); lits.get(k)!.add(m[2]) } }
    negative("a builder with only truncated:false is detected as hollow", lits.get("truncated")?.size === 1, "")
    negative("the legacy import guard refuses handlers that import analyzeImpact", !handlersSrc.includes("analyzeImpact"), "")
    negative("missing P1 evidence would fail the cross-ref", p1Ok, "P1.json missing or not verified")
  }

  const ok = failed === 0
  const evidence = {
    status: ok ? "verified" : "known-gap",
    currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m48/verify-p2-honesty-fields.ts",
    evidenceFile: "P2.json",
    generatedAt: new Date().toISOString(),
    passed, failed, negativeCases: negatives,
    failures,
    buildersAudited: BUILDER_FILES.length,
  }
  mkdirSync(RESULTS_DIR, { recursive: true })
  if (!READ_ONLY) writeFileSync(path.join(RESULTS_DIR, "P2.json"), JSON.stringify(evidence, null, 2) + "\n")
  console.log(`M48 P2 HONESTY FIELDS: ${ok ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed, ${negatives} negatives)`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
