// script/m15/verify-health-deep.ts — M15.H1-H8 (bb_health) GENUINE deep redo.
//
// Replacement for the scaffolded batch1 evidence. Every check exercises a real
// code path (getUnifiedHealth, formatUnifiedHealth, real refresh, real
// integrity check, real DB) or a real measurement. No auto-pass assertions.
//
//   H1 classification: counts/freshness/warnings on a real indexed project
//   H2 regex census:   regex-literal audit of health-provider.ts
//   H3 cross-file:     per-language breakdown & fresh/stale across files
//   H4 complexity:     measured wall-clock on two project sizes
//   H5 real-repo e2e:  real repo on disk (zig) with integrity + verbose
//   H6 docs honesty:   registry block ↔ doc ↔ handler ↔ impl agree
//   H7 gate:           all H-evidence present + self-audit + cleanup guard

import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getUnifiedHealth, formatUnifiedHealth } from "../../src/intelligence/health/health-provider"

let checks = 0, passed = 0, failed = 0, negatives = 0, negativePassed = 0
function ck(label: string, cond: boolean, detail?: string) { checks++; if (cond) passed++; else { failed++; console.log("  FAIL: " + label + (detail ? " — " + detail : "")) } }
function nk(label: string, cond: boolean, detail?: string) { negatives++; if (cond) negativePassed++; else { failed++; console.log("  FAIL: " + label + " (negative)" + (detail ? " — " + detail : "")) } }

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m15/results")
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

async function emit(code: string, issue: string, tool: string, title: string, file: string, extra?: any) {
  const total = passed + negativePassed
  const e = { issue, code, tool, title, verified: failed === 0, checks, passed: total, failed, negatives, generatedAt: new Date().toISOString(), ...(extra || {}) }
  writeFileSync(path.join(RESULTS_DIR, file), JSON.stringify(e, null, 2) + "\n")
  console.log(code + ": " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + total + "/" + checks + " passed, " + negatives + " negatives)")
}
async function reset() { checks = passed = failed = negatives = negativePassed = 0 }

// Cleanup that can never destroy a real project (see A-series regression).
function cleanup(root: string, projectId: string) {
  const isTmp = root.startsWith(tmpdir())
  if (isTmp) { try { rmSync(root, { recursive: true, force: true }) } catch (_) {} }
  try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch (_) {}
}

async function indexProject(root: string) {
  const projectId = getProjectId(root)
  await indexProjectParallel(projectId, root, {})
  return projectId
}
async function timing<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = Date.now(); const value = await fn(); return { value, ms: Date.now() - t0 }
}

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // H1: classification — counts, freshness, warnings on a real index
  // ═══════════════════════════════════════════════════════════════════
  {
    const root = mkdtempSync(path.join(tmpdir(), "bb-h1-"))
    writeFileSync(path.join(root, "a.ts"), "export function alpha(): number { return 1 }\n")
    writeFileSync(path.join(root, "b.ts"), "import { alpha } from './a'\nexport function beta(): number { return alpha() }\n")
    writeFileSync(path.join(root, "broken.ts"), "const = ;\nfunction { ( }\n")
    const projectId = await indexProject(root)
    try {
      const report = await getUnifiedHealth(projectId, root, { freshness: "complete" })
      ck("H1: counts files=3", report.counts.files === 3, "files=" + report.counts.files)
      ck("H1: counts symbols >= 2", report.counts.symbols >= 2, "symbols=" + report.counts.symbols)
      ck("H1: counts imports >= 1", report.counts.imports >= 1, "imports=" + report.counts.imports)
      ck("H1: freshness.complete checked=3", report.freshness.mode === "complete" && report.freshness.checked === 3, "mode=" + report.freshness.mode + " checked=" + report.freshness.checked)
      // A file changed since index must be reported stale after we modify it
      // (index carries the ORIGINAL content hash; touching a.ts makes it stale)
      writeFileSync(path.join(root, "a.ts"), "export function alpha(): number { return 1 }\n// touched line\n")
      const stale = await getUnifiedHealth(projectId, root, { freshness: "complete" })
      ck("H1: modified file reported stale", stale.freshness.stale >= 1, "stale=" + stale.freshness.stale + " (files=" + stale.freshness.checked + ")")
      ck("H1: stale file name surfaced", stale.freshness.staleFiles.some((f: string) => f.endsWith("a.ts")), stale.freshness.staleFiles.join(","))
      // Format function renders a multi-line report
      const text = formatUnifiedHealth(stale)
      ck("H1: formatUnifiedHealth renders counts line", text.includes("files=3 symbols=") && text.includes("freshness:"), text.split("\n")[2]?.slice(0, 40))
      nk("H1: stale file surfaced in report (not hidden)", stale.freshness.staleFiles.some((f: string) => f.endsWith("a.ts")), stale.freshness.staleFiles.join(",") || "none")
    } catch (e: any) {
      ck("H1: setup", false, (e?.message || String(e)).slice(0, 120))
    } finally {
      cleanup(root, projectId)
    }
  }
  await emit("H1", "M15.H1", "bb_health", "classification — real counts/freshness/warnings", "h1.json")
  await reset()

  // ═══════════════════════════════════════════════════════════════════
  // H2: regex census — audit regex literals in health-provider.ts
  // ═══════════════════════════════════════════════════════════════════
  {
    const src = readFileSync(path.join(ROOT_DIR, "src/intelligence/health/health-provider.ts"), "utf8")
    const relits = src.match(/[A-Za-z_.]+\(\s*\/[^\n]*?\//g) || []
    const cleanRelits = relits.filter((r: string) => !r.startsWith("import"))
    nk("H2: health-provider has NO regex literals (DB queries + arithmetic only)", cleanRelits.length === 0, cleanRelits.join(" | ") || "")
  }
  await emit("H2", "M15.H2", "bb_health", "regex census", "h2.json")
  await reset()

  // ═══════════════════════════════════════════════════════════════════
  // H3: cross-file — per-language breakdown across two languages
  // ═══════════════════════════════════════════════════════════════════
  {
    const root = mkdtempSync(path.join(tmpdir(), "bb-h3-"))
    writeFileSync(path.join(root, "a.ts"), "export function tsFn(): number { return 1 }\n")
    writeFileSync(path.join(root, "b.py"), "def py_fn():\n    return 1\n")
    const projectId = await indexProject(root)
    try {
      const report = await getUnifiedHealth(projectId, root, {})
      const langs = report.languages
      ck("H3: per-language breakdown has both languages", langs.some((l) => l.language === "typescript") && langs.some((l) => l.language === "python"), langs.map((l) => l.language + ":" + l.files).join(","))
      const tsLang = langs.find((l) => l.language === "typescript")
      ck("H3: TS file counted once", tsLang ? tsLang.files === 1 : false, tsLang ? "files=" + tsLang.files : "missing ts")
      // verbose flag is reported in the report and gated in the formatter.
      // M64: this asserted the literal "languages: typescript:1f", which
      // assumed typescript is the FIRST language printed. The formatter's
      // documented order is files DESC then language ASC, and here both
      // languages have 1 file — so "python:1f/1s" legitimately comes first and
      // the assertion was order-dependent for a reason that has nothing to do
      // with the thing being checked. Assert each language's own cell instead.
      const verboseText = formatUnifiedHealth({ ...report, verbose: true })
      ck("H3: verbose format includes the languages section", /(^|\n)languages: /.test(verboseText), verboseText.split("\n").find((l) => l.startsWith("languages:")) ?? "absent")
      ck("H3: verbose languages section names both languages with their counts", verboseText.includes("typescript:1f/1s") && verboseText.includes("python:1f/1s"), verboseText.split("\n").find((l) => l.startsWith("languages:")) ?? "absent")
    } catch (e: any) {
      ck("H3: setup", false, (e?.message || String(e)).slice(0, 120))
    } finally {
      cleanup(root, projectId)
    }
  }
  await emit("H3", "M15.H3", "bb_health", "cross-file per-language correctness", "h3.json")
  await reset()

  // ═══════════════════════════════════════════════════════════════════
  // H4: time complexity — measured wall-clock on small vs larger project
  // ═══════════════════════════════════════════════════════════════════
  {
    const small = mkdtempSync(path.join(tmpdir(), "bb-h4s-"))
    writeFileSync(path.join(small, "s.ts"), "export function s(): number { return 1 }\n")
    const big = mkdtempSync(path.join(tmpdir(), "bb-h4b-"))
    for (let f = 0; f < 40; f++) {
      let body = ""
      for (let i = 0; i < 15; i++) body += "export function fn" + f + "_" + i + "(x: number): number { return x + 1 }\n"
      writeFileSync(path.join(big, "f" + f + ".ts"), body)
    }
    const pS = await indexProject(small)
    const pB = await indexProject(big)
    try {
      const s = await timing(() => getUnifiedHealth(pS, small, { freshness: "complete" }))
      const b = await timing(() => getUnifiedHealth(pB, big, { freshness: "complete" }))
      ck("H4: big project has more files", b.value.counts.files > s.value.counts.files, b.value.counts.files + " vs " + s.value.counts.files)
      ck("H4: wall-clock big/small ratio <= 8x", b.ms <= s.ms * 8 + 50, "small=" + s.ms + "ms big=" + b.ms + "ms")
    } catch (e: any) {
      ck("H4: setup", false, (e?.message || String(e)).slice(0, 120))
    } finally {
      cleanup(small, pS); cleanup(big, pB)
    }
  }
  await emit("H4", "M15.H4", "bb_health", "measured time complexity", "h4.json")
  await reset()

  // ═══════════════════════════════════════════════════════════════════
  // H5: real-repo e2e — real repo on disk (zig) with integrity + verbose
  // ═══════════════════════════════════════════════════════════════════
  {
    const realRepo = "$HOME/fixtures/repositories/zig/src"
    if (existsSync(realRepo)) {
      const projectId = await indexProject(realRepo)
      try {
        const report = await getUnifiedHealth(projectId, realRepo, { integrity: true, verbose: true })
        ck("H5: real repo has files", report.counts.files > 0, "files=" + report.counts.files)
        ck("H5: real repo has symbols", report.counts.symbols > 0, "symbols=" + report.counts.symbols)
        ck("H5: integrity check ran (no throw)", report.integrity !== null, report.integrity ? "overall=" + report.integrity.overallHealth : "null")
        ck("H5: verbose languages section populated", report.verbose && report.languages.length > 0, "langs=" + report.languages.length)
      } catch (e: any) {
        ck("H5: setup", false, (e?.message || String(e)).slice(0, 120))
      } finally {
        cleanup(realRepo, projectId)
      }
    } else {
      ck("H5: real repo present on disk", false, "missing " + realRepo)
    }
  }
  await emit("H5", "M15.H5", "bb_health", "real-repo e2e (zig/src)", "h5.json")
  await reset()

  // ═══════════════════════════════════════════════════════════════════
  // H6: docs honesty — registry block ↔ doc ↔ handler ↔ impl agree
  // ═══════════════════════════════════════════════════════════════════
  {
    const reg = readFileSync(path.join(ROOT_DIR, "src/mcp/tool-registry.ts"), "utf8")
    const doc = readFileSync(path.join(ROOT_DIR, "docs/tools/bb_health.md"), "utf8")
    const hnd = readFileSync(path.join(ROOT_DIR, "src/mcp/tool-handlers.ts"), "utf8")
    const impl = readFileSync(path.join(ROOT_DIR, "src/intelligence/health/health-provider.ts"), "utf8")

    const block = reg.split('name: "bb_health"')[1].split(/name: "/)[0]
    ck("H6: registry lists bb_health", reg.includes("bb_health"))
    ck("H6: registry modes status+refresh", block.includes('"status"') && block.includes('"refresh"'))
    ck("H6: registry requiresIndex=false", block.includes("requiresIndex: false"))
    ck("H6: registry mutability=read", block.includes('mutability: "read"'))
    ck("H6: doc modes match registry", doc.includes("Modes: `status`, `refresh`"))
    ck("H6: doc advertises integrity flag", doc.includes("integrity"))
    ck("H6: doc advertises verbose flag", doc.includes("verbose"))
    ck("H6: handler calls getUnifiedHealth", hnd.includes("getUnifiedHealth(projectId"))
    ck("H6: handle passes wait/freshness/sampleSize/integrity/verbose", hnd.includes("freshness:") && hnd.includes("sampleSize:") && hnd.includes("integrity:") && hnd.includes("verbose:"))
    ck("H6: impl implements refresh queue", impl.includes("queueRefresh") && impl.includes("indexProjectParallel"))
    ck("H6: impl implements integrity", impl.includes("runIndexHealthCheck"))
    ck("H6: impl warns on stale files", impl.includes("STALE_FILES"))
  }
  await emit("H6", "M15.H6", "bb_health", "docs honesty", "h6.json")
  await reset()

  // ═══════════════════════════════════════════════════════════════════
  // H7: evidence + gate + self-audit + cleanup guard
  // ═══════════════════════════════════════════════════════════════════
  {
    for (const f of ["h1.json", "h2.json", "h3.json", "h4.json", "h5.json", "h6.json"]) {
      try {
        const d = JSON.parse(readFileSync(path.join(RESULTS_DIR, f), "utf8"))
        ck("H7: " + f + " present and verified", d.verified === true && d.failed === 0, "verified=" + d.verified + " failed=" + d.failed)
      } catch {
        ck("H7: " + f + " present", false, "missing or invalid")
      }
    }
    const self = readFileSync(new URL(import.meta.url).pathname, "utf8").split("H7: evidence")[0].replace(/\/\/[^\n]*/g, "")
    const autoPass = new RegExp("\\b(?:ck|nk)\\([^)]*,\\s*true\\s*[,)]")
    nk("H7: verifier has no auto-pass assertions", !autoPass.test(self), autoPass.test(self) ? "auto-pass found" : "clean")
    nk("H7: cleanup refuses non-tmp roots", readFileSync(new URL(import.meta.url).pathname, "utf8").includes("root.startsWith(tmpdir())"), "structural guard in cleanup()")
  }
  await emit("H7", "M15.H7", "bb_health", "evidence + gate + closure", "h7.json")
  await reset()

  // ═══════════════════════════════════════════════════════════════════
  // H8: mode coverage — status, refresh(wait), refresh(async) all real
  // ═══════════════════════════════════════════════════════════════════
  {
    const root = mkdtempSync(path.join(tmpdir(), "bb-h8-"))
    writeFileSync(path.join(root, "a.ts"), "export function alpha(): number { return 1 }")
    const projectId = await indexProject(root)
    try {
      // status mode (no refresh requested)
      const status = await getUnifiedHealth(projectId, root, {})
      ck("H8: status mode reports no refresh requested", status.refresh.requested === false, "requested=" + status.refresh.requested)

      // refresh mode (wait): real reindex runs and completes
      writeFileSync(path.join(root, "b.ts"), "export function beta(): number { return 2 }")
      const refreshed = await getUnifiedHealth(projectId, root, { refresh: true, wait: true })
      ck("H8: refresh(wait) completes and reindexes", refreshed.refresh.completed === true, "completed=" + refreshed.refresh.completed)
      ck("H8: refresh processed files >= 2", (refreshed.refresh.processedFiles ?? 0) >= 2, "processed=" + refreshed.refresh.processedFiles)
      ck("H8: new file visible after refresh", refreshed.counts.files === 2, "files=" + refreshed.counts.files)

      // refresh mode (async): snapshot returned, refresh started warning
      const asyncr = await getUnifiedHealth(projectId, root, { refresh: true, wait: false })
      ck("H8: refresh(async) returns snapshot with warning", asyncr.warnings.some((w) => w.code === "REFRESH_STARTED"), asyncr.warnings.map((w) => w.code).join(",") || "no warnings")
    } catch (e: any) {
      ck("H8: setup", false, (e?.message || String(e)).slice(0, 120))
    } finally {
      cleanup(root, projectId)
    }
  }
  await emit("H8", "M15.H8", "bb_health", "mode coverage — status + refresh modes", "h8.json")

  process.exit(failed > 0 ? 1 : 0)
})().catch((e: any) => { console.error("FATAL", e); process.exit(2) })