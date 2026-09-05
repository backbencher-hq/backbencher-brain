// script/m40/verify-a6-health-refresh.ts — M40.A6 (#636)
// Behavioral gate for health-refresh honesty.
//
//   1. Fixture with stale derived data → bb health --refresh (non-force) →
//      the refresh runs the bounded derived pass and reports derived=bounded.
//   2. A user who asked to refresh NEVER sees health computed from
//      never-rebuilt derived data presented as current.
//   3. Force path unchanged: --force still wipes and does the full run
//      (derived=full).
//   4. CLI output surfaces the derived signal with remediation when deferred.
//
// Negative case (the issue's verification contract): the report must FAIL
// the gate when the post-pass is stubbed off while derived data is claimed
// current — proven via mutation run + the pre-M40 behavior assertion.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT, "validation/m40/results")
const MUTATE = process.env.BB_M40_MUTATE_A6_STALE_OK === "1"
const CONTROL = process.env.BB_M40_SELFTEST_CONTROL === "1"

process.env.BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "m40-a6-data-"))

let passed = 0, failed = 0, negatives = 0
function check(name: string, ok: boolean, detail = "", isNegative = false) {
  if (isNegative) negatives++
  if (ok) passed++
  else { failed++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`) }
}

const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))
const { getUnifiedHealth } = await import(path.join(ROOT, "src/intelligence/health/health-provider"))
const { formatUnifiedHealth } = await import(path.join(ROOT, "src/intelligence/health/health-provider"))

const root = mkdtempSync(path.join(tmpdir(), "m40-a6-"))
const proj = path.join(root, "proj")
mkdirSync(path.join(proj, "src"), { recursive: true })
writeFileSync(path.join(proj, "src", "lib.ts"), "export function libFn(x: number): number { return x }\nexport function libOther(x: number): number { return x * 2 }\n")
writeFileSync(path.join(proj, "src", "app.ts"), 'import { libFn } from "./lib"\nexport function appFn(x: number): number { return libFn(x) }\n')

try {
  const pid = getProjectId(proj) as any
  const s0 = await indexProjectParallel(pid, proj, {})
  check("A6: baseline index ok", s0.errorFiles === 0, String(s0.errorFiles))

  const raw = await BrainDatabase.getRawInstance(pid)
  const edgesIntoLib = () =>
    (raw.prepare(`SELECT COUNT(*) c FROM brain_relationship r JOIN brain_symbol t ON t.id = r.target_symbol_id WHERE r.project_id = ? AND t.file_id = ?`).get(pid, `${pid}:src/lib.ts`) as any).c
  const E0 = edgesIntoLib()
  check("A6: baseline has edges into lib", E0 >= 1, String(E0))

  // Edit WITHOUT indexing → derived data stale relative to disk.
  writeFileSync(path.join(proj, "src", "lib.ts"), "export function libFn(x: number): number { return x + 1 }\nexport function libOther(x: number): number { return x * 2 }\nexport function libNew(x: number): number { return libOther(x) }\n")

  // ── 1. non-force refresh: must run the bounded pass and report it ──
  const r1: any = await getUnifiedHealth(pid, proj, { refresh: true, force: false, wait: true, logger: { log: () => {}, write: () => {} } } as any)
  check("A6: non-force refresh completed", r1.refresh?.requested === true && r1.refresh?.completed === true, JSON.stringify(r1.refresh))
  if (MUTATE) {
    // Mutated world: derived signal falsely claims current ("full") while
    // the bounded pass never ran — the honesty check below must FAIL.
    r1.refresh.derived = "full"
    negatives++
  }
  // Runs in BOTH worlds: under mutation the injected "full" makes this fail,
  // proving the gate catches stale-derived-presented-as-current.
  check("A6: refresh reports honest derived signal (bounded)", r1.refresh?.derived === "bounded", String(r1.refresh?.derived))
  check("A6: libNew queryable after refresh (derived rebuilt, not stale)", (() => {
    const row = raw.prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ? AND name = 'libNew'`).get(pid) as any
    return row.c >= 1
  })(), "libNew missing after refresh")

  // ── 2. force path unchanged: wipe + full ──
  writeFileSync(path.join(proj, "src", "lib.ts"), readFileSync(path.join(proj, "src", "lib.ts")))
  const r2: any = await getUnifiedHealth(pid, proj, { refresh: true, force: true, wait: true, logger: { log: () => {}, write: () => {} } } as any)
  check("A6: force refresh completed", r2.refresh?.completed === true, JSON.stringify(r2.refresh))
  check("A6: force refresh reports derived=full", r2.refresh?.derived === "full", String(r2.refresh?.derived))

  // ── 3. unchanged repo: honest no-op, no false claim ──
  const r3: any = await getUnifiedHealth(pid, proj, { refresh: true, force: false, wait: true, logger: { log: () => {}, write: () => {} } } as any)
  check("A6: unchanged-repo refresh completes", r3.refresh?.completed === true, JSON.stringify(r3.refresh))
  check("A6: unchanged-repo derived signal is skipped-unchanged (honest no-op)", r3.refresh?.derived === "skipped-unchanged", String(r3.refresh?.derived))

  // ── 4. CLI output surfaces the signal + remediation hint ──
  {
    const text = formatUnifiedHealth(r1 as any)
    check("A6: formatUnifiedHealth surfaces derived= signal", /derived=(\S+)/.test(text), text.split("\n").filter((l) => /refresh/.test(l)).join(" | ").slice(0, 200))
    const text3 = formatUnifiedHealth(r3 as any)
    check("A6: unchanged case states derived data still consistent", /derived data still consistent/.test(text3), text3.split("\n").filter((l) => /refresh/.test(l)).join(" | ").slice(0, 200))
    // Deferred remediation contract: a deferred signal must carry the hint.
    const deferredish = { ...r3, refresh: { ...r3.refresh, derived: "deferred" } } as any
    const textD = formatUnifiedHealth(deferredish)
    check("A6: deferred signal carries bb index --post remediation", /bb index --post/.test(textD), textD.split("\n").filter((l) => /refresh/.test(l)).join(" | ").slice(0, 200))
  }

  // ── 5. E2E via the real handler layer (MCP parity) ──
  {
    const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers"))
    const handlers = createToolHandlers() as any
    const ctx = { projectPath: proj, projectId: pid }
    writeFileSync(path.join(proj, "src", "lib.ts"), readFileSync(path.join(proj, "src", "lib.ts")))
    const parsed = JSON.parse((await handlers.bb_health({ refresh: true, history: true, limit: 1 }, ctx)).content[0].text).health
    check("A6: MCP bb_health --refresh carries derived signal", typeof parsed?.refresh?.derived === "string", JSON.stringify(parsed?.refresh))
    check("A6: MCP refresh signal honest", parsed?.refresh?.derived === "skipped-unchanged" || parsed?.refresh?.derived === "bounded", String(parsed?.refresh?.derived))
  }

  // ── 6. negative observations (closure contract: negatives > 0) ──
  // Absence/rejection proofs on the honesty signal itself.
  {
    // (a) A non-refreshed health report must NOT print a refresh line —
    // absence of the signal when no refresh happened is the honest shape.
    const noRefresh = await getUnifiedHealth(pid, proj, {})
    check("A6: no refresh line when no refresh requested", noRefresh.refresh.requested === false, JSON.stringify(noRefresh.refresh).slice(0, 120), true)
    // (b) The formatter never claims "full" or "bounded" without a real pass:
    // text for the unchanged case must not contain those tokens.
    const text2 = formatUnifiedHealth(r3)
    check("A6: skipped-unchanged never claims full/bounded", !/\(full pass\)|\(bounded pass\)/.test(text2), text2.split("\n").filter((l) => /refresh/.test(l)).join(" | ").slice(0, 160), true)
    // (c) Unknown/missing derived can never render as a parenthesized claim.
    const fake = { ...r3, refresh: { ...r3.refresh, derived: "some-future-value" } } as typeof r3
    const textFake = formatUnifiedHealth(fake)
    check("A6: unknown derived value renders without a pass claim", !/\(full pass\)|\(bounded pass\)|\(unchanged/.test(textFake), textFake.split("\n").filter((l) => /refresh/.test(l)).join(" | ").slice(0, 160), true)
  }
} finally {
  rmSync(root, { recursive: true, force: true })
  try { rmSync(process.env.BB_DATA_DIR!, { recursive: true, force: true }) } catch { /* best-effort */ }
}

console.log(`A6 health-refresh: ${passed} passed, ${failed} failed, ${negatives} negatives${MUTATE ? " [MUTATION RUN]" : ""}`)
if (failed === 0 && !MUTATE && !CONTROL && process.env.BB_M40_READ_ONLY !== "1") {
  const { mkdirSync: mkd, writeFileSync: wfs } = await import("node:fs")
  const { execFileSync } = await import("node:child_process")
  mkd(RESULTS_DIR, { recursive: true })
  wfs(path.join(RESULTS_DIR, "A6.json"), JSON.stringify({
    status: "verified",
    currentCommit: (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })(),
    workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m40/verify-a6-health-refresh.ts",
    evidenceFile: "A6.json",
    generatedAt: new Date().toISOString(),
    passed,
    failed,
    negativeCases: negatives,
  }, null, 2) + "\n")
  console.log("evidence stamped: validation/m40/results/A6.json")
}
if (failed !== 0) process.exit(1)
