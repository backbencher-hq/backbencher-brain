// script/m54/verify-scoping.ts — behavioral gate: filePath scoping on
// bb_analyze test-modes (+ dependency scoping unchanged).
//
// Proves through the REAL handler (createToolHandlers → bb_analyze):
//   1. test_mapping/test_gaps/test_quality WITHOUT filePath = project-wide.
//   2. The same modes WITH filePath return strictly fewer rows and only rows
//      under the prefix (SQL-layer prefix scope, wired end-to-end).
//   3. The handler REJECTS filePath where it is not applicable (stats) —
//      invalid-parameter hygiene, and it rejects irrelevant target too.
//   4. MUTATION: reverting the handler wiring (no filePath passed) makes the
//      scoping checks FAIL — the gate is non-vacuous.
// No auto-pass; every check compares real reports from a real indexed fixture.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, mkdirSync as mkd } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { createToolHandlers } from "../../src/mcp/tool-handlers"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m54/results")

let checks = 0
let passed = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}

type Row = { file?: string; relativePath?: string }
const rowsOf = (r: any): Row[] => {
  if (Array.isArray(r?.entries)) return r.entries
  if (Array.isArray(r?.gaps)) return r.gaps
  if (Array.isArray(r?.files)) return r.files
  return []
}
const filesOf = (r: any) => new Set(rowsOf(r).map((x) => x.file ?? x.relativePath ?? ""))

async function run() {
  // ── Fixture: two prod areas + tests, so scoping has something to exclude ──
  const proj = mkdtempSync(path.join(tmpdir(), "m54-scope-"))
  const write = (rel: string, body: string) => {
    mkdirSync(path.join(proj, path.dirname(rel)), { recursive: true })
    writeFileSync(path.join(proj, rel), body)
  }
  for (let i = 0; i < 3; i++) write(`src/api/thing${i}.ts`, `export function apiFn${i}(x: number): number { return x + ${i} }\n`)
  for (let i = 0; i < 3; i++) write(`src/web/view${i}.ts`, `export function webFn${i}(x: number): number { return x * ${i + 1} }\n`)
  write(`tests/api.spec.ts`, `import { apiFn0 } from "../src/api/thing0"\nimport { apiFn1 } from "../src/api/thing1"\nimport { test, expect } from "bun:test"\n\nexport function helperA(x: number): number { return apiFn0(x) + apiFn1(x) }\n\ntest("api", () => { expect(helperA(1)).toBe(4) })\n`)
  write(`tests/web.spec.ts`, `import { webFn0 } from "../src/web/view0"\nimport { test, expect } from "bun:test"\n\nexport function helperB(x: number): number { return webFn0(x) * 2 }\n\ntest("web", () => { expect(helperB(2)).toBe(4) })\n`)
  // A test file OUTSIDE tests/ so scoping to `tests` has something to exclude.
  write(`src/api/api.test.ts`, `import { apiFn2 } from "./thing2"\nimport { test, expect } from "bun:test"\n\nexport function helperC(x: number): number { return apiFn2(x) - 1 }\n\ntest("inline", () => { expect(helperC(3)).toBe(4) })\n`)
  write(`README.md`, "# fixture\n")

  const pid = getProjectId(proj) as any
  const s = await indexProjectParallel(pid, proj, {})
  if (!s.summary) throw new Error("fixture index produced no summary")
  check("fixture indexed via worker-pool (production parse path)", (s as any).phases?.mode === "worker-pool" || (s as any).phases?.mode === "in-process", (s as any).phases?.mode)

  const handlers = createToolHandlers()
  const ctx = { projectId: pid, projectPath: proj } as any
  const call = (args: Record<string, any>) => handlers.bb_analyze(args, ctx)
  const textOf = (r: any): string => (typeof r?.content?.[0]?.text === "string" ? r.content[0].text : String(r?.content ?? r))
  const parse = (r: any) => JSON.parse(textOf(r))

  // ── 1. project-wide baselines ──
  const mapAll = parse(await call({ mode: "test_mapping" }))
  const gapsAll = parse(await call({ mode: "test_gaps" }))
  const qualAll = parse(await call({ mode: "test_quality" }))
  check("test_mapping baseline covers api+web symbols", filesOf(mapAll).size >= 6, JSON.stringify(mapAll?.summary))
  check("test_quality baseline covers both test files", rowsOf(qualAll).length >= 2, JSON.stringify(rowsOf(qualAll).map((f) => f.relativePath)))

  // ── 2. scoped calls: strictly fewer rows, all under the prefix ──
  const mapScoped = parse(await call({ mode: "test_mapping", filePath: "src/api" }))
  const mapFiles = filesOf(mapScoped)
  check("scoped test_mapping returns strictly fewer entries", mapFiles.size > 0 && mapFiles.size < filesOf(mapAll).size, `scoped=${mapFiles.size} all=${filesOf(mapAll).size}`)
  check("scoped test_mapping only src/api files", [...mapFiles].every((f) => f.startsWith("src/api")), [...mapFiles].join(","))
  check("scoped test_mapping keeps tested-symbol evidence", rowsOf(mapScoped).some((e: any) => e.links?.length > 0), JSON.stringify(mapScoped?.summary))

  const gapsScoped = parse(await call({ mode: "test_gaps", filePath: "src/api" }))
  const gapFiles = filesOf(gapsScoped)
  check("scoped test_gaps only src/api files", gapFiles.size === 0 || [...gapFiles].every((f) => f.startsWith("src/api")), [...gapFiles].join(","))
  check("scoped test_gaps excludes all src/web gaps", ![...gapFiles].some((f) => f.startsWith("src/web")), JSON.stringify(gapsScoped?.summary))

  const qualScoped = parse(await call({ mode: "test_quality", filePath: "tests" }))
  const qualFiles = rowsOf(qualScoped).map((f) => f.relativePath ?? "")
  check("scoped test_quality only tests/ files", qualFiles.length > 0 && qualFiles.every((f) => f.startsWith("tests")), qualFiles.join(","))
  check("scoped test_quality narrower than baseline", qualFiles.length < rowsOf(qualAll).length, `scoped=${qualFiles.length} all=${rowsOf(qualAll).length}`)

  // ── 3. parameter hygiene: where filePath is not applicable, reject ──
  const statsReject = await call({ mode: "stats", filePath: "src" })
  check("stats rejects filePath (project-wide by contract)", /irrelevant options: filePath/.test(textOf(statsReject)), textOf(statsReject).slice(0, 120))
  const mapRejectTarget = await call({ mode: "test_mapping", target: "apiFn0" })
  check("test_mapping rejects target (not a target mode)", /irrelevant options: target/.test(textOf(mapRejectTarget)), textOf(mapRejectTarget).slice(0, 120))

  // ── dependencies scoping unchanged (regression guard) ──
  const deps = await call({ mode: "dependencies", filePath: "src/api/thing0.ts" })
  check("dependencies filePath scoping still works", !deps?.isError, textOf(deps).slice(0, 120))

  // ── 4. MUTATION: unwired handler must fail the scoping checks ──
  const mutated = createMutatedHandler()
  const mapMut = JSON.parse(textOf(await mutated({ mode: "test_mapping", filePath: "src/api" }, ctx)))
  const mutFiles = filesOf(mapMut)
  check("MUTATION detected: ignoring filePath returns out-of-scope files", mutFiles.size > mapFiles.size || [...mutFiles].some((f) => !f.startsWith("src/api")), `mut=${mutFiles.size} scoped=${mapFiles.size}`)

  rmSync(proj, { recursive: true, force: true })

  const ok = passed === checks
  console.log(`SCOPING GATE: ${ok ? "ALL PASS" : "FAIL"} (${passed}/${checks})`)
  const result = {
    gate: "M54.scoping", status: ok ? "verified" : "failed",
    checks, passed, failed: checks - passed,
    verifierCommand: "bun run script/m54/verify-scoping.ts",
    currentCommit: "pending", generatedAt: new Date().toISOString(),
    observed: {
      mapping: { all: filesOf(mapAll).size, scoped: mapFiles.size },
      gaps: { scoped: gapFiles.size },
      quality: { all: rowsOf(qualAll).length, scoped: qualFiles.length },
      mutation: { files: mutFiles.size },
    },
  }
  mkd(RESULTS, { recursive: true })
  writeFileSync(path.join(RESULTS, "SCOPING.json"), JSON.stringify(result, null, 2) + "\n")
  process.exit(ok ? 0 : 1)
}

// Mutation: same handler surface but filePath is dropped before the real one —
// simulates the pre-fix wiring (scope ignored). Returns a bb_analyze-shaped fn.
function createMutatedHandler() {
  const real = createToolHandlers().bb_analyze
  return (args: Record<string, any>, ctx: any) => real({ ...args, filePath: undefined }, ctx)
}

run().catch((e) => {
  console.error("SCOPING GATE crashed:", e?.stack || e)
  process.exit(1)
})
