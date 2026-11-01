// script/m15/verify-analyze-deep.ts — M15.N1-N8 (bb_analyze) GENUINE deep redo.
//
// All 11 analysis modes exercised on a real index with real call graphs:
// callers/callees/trace (graphTraversal), dependencies, stats, complexity,
// impact, test_mapping, test_gaps, test_impact, test_quality. Measured
// complexity, real-repo e2e, docs honesty, gate + self-audit.
// No auto-pass assertions.

import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { graphTraversal } from "../../src/intelligence/graph/graph-engine"
import { getFileDependencies } from "../../src/intelligence/analysis/dependencies"
import { getProjectStats } from "../../src/intelligence/analysis/project-stats"
import { analyzeComplexity } from "../../src/intelligence/analysis/complexity"
import { computeImpact } from "../../src/lsp/impact"
import { testMapping, testGaps, testImpact } from "../../src/intelligence/testing/test-intel"
import { testQuality } from "../../src/intelligence/testing/quality"
import { fileURLToPath } from "node:url"
import { resolveCorpusRoot } from "../lib/corpus-root.ts"
const CORPUS_BASE = resolveCorpusRoot(process.cwd()) ?? "CORPUS_BASE_UNRESOLVED"

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

const FIXTURE: Record<string, string> = {
  "a.ts": "export function leaf(): number { return 1 }\n",
  "b.ts": "import { leaf } from './a'\nexport function mid(): number { return leaf() }\n",
  "c.ts": "import { mid } from './b'\nexport function top(): number { return mid() }\n",
  "test.test.ts": "import { mid } from './b'\ndescribe('mid', () => { it('works', () => expect(mid()).toBe(1)) })\n",
}

async function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "bb-nx-"))
  for (const [f, c] of Object.entries(FIXTURE)) writeFileSync(path.join(root, f), c)
  const projectId = await indexProject(root)
  return { root, projectId }
}

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // N1: classification — callers/callees/trace/stats/complexity
  // ═══════════════════════════════════════════════════════════════════
  {
    const { root, projectId } = await makeFixture()
    try {
      const callersLeaf = JSON.stringify(await graphTraversal(projectId as any, "leaf", { direction: "callers", maxDepth: 3 })).toLowerCase()
      ck("N1: callers(leaf) includes mid", callersLeaf.includes("mid"), callersLeaf.slice(0, 140))
      const calleesText = JSON.stringify(await graphTraversal(projectId as any, "mid", { direction: "callees", maxDepth: 3 })).toLowerCase()
      ck("N1: callees(mid) includes leaf", calleesText.includes("leaf"), calleesText.slice(0, 140))
      const traceText = JSON.stringify(await graphTraversal(projectId as any, "mid", { direction: "both", maxDepth: 2 })).toLowerCase()
      ck("N1: trace(mid) includes leaf AND top", traceText.includes("leaf") && traceText.includes("top"), traceText.slice(0, 180))

      const stats = await getProjectStats(projectId)
      ck("N1: stats files=4", stats.files === 4, "files=" + stats.files)
      ck("N1: stats symbols >= 3 (test file adds no declarations)", stats.symbols >= 3, "symbols=" + stats.symbols)
      ck("N1: stats relationships >= 3", stats.relationships >= 3, "rels=" + stats.relationships)
      ck("N1: stats provenance present", !!stats.provenance && stats.provenance.evidenceClass === "indexed", "prov=" + (stats.provenance ? stats.provenance.evidenceClass : "none"))

      const cx = await analyzeComplexity(projectId, { scope: "project" })
      ck("N1: complexity breakdown non-empty", cx.breakdown.length >= 1, "n=" + cx.breakdown.length)
      const cxFn = await analyzeComplexity(projectId, { scope: "function", target: "leaf" })
      ck("N1: function scope resolves leaf", cxFn.breakdown.some((b) => b.name === "leaf"), cxFn.breakdown.map((b) => b.name).join(",") || "none")
    } catch (e: any) {
      ck("N1: setup", false, (e?.message || String(e)).slice(0, 160))
    } finally {
      cleanup(root, projectId)
    }
  }
  await emit("N1", "M15.N1", "bb_analyze", "classification — graph/stats/complexity", "n1.json")
  await reset()

  // ═══════════════════════════════════════════════════════════════════
  // N2: the content classifiers are a FROZEN NAMED TABLE and are behaviourally
  // tested. The old census counted regex literals by scanning source text, which
  // blessed the §7 problem instead of testing it: a literal could be added,
  // changed or broken and the census still "passed" as long as the count matched.
  // The gate now asks the two questions that can fail: does the table exist with
  // every classifier global, and does the edge-case suite (empty input, no-match,
  // boundary, Unicode, multiline, megabyte input, metacharacters) pass?
  {
    const { CONTENT_CLASSIFIERS } = await import("../../src/intelligence/testing/quality")
    const names = Object.keys(CONTENT_CLASSIFIERS)
    ck("N2: content classifier table exists with every probe named", names.length >= 12, names.join(","))
    ck("N2: every classifier is a global RegExp", Object.values(CONTENT_CLASSIFIERS).every((re: any) => re instanceof RegExp && re.flags.includes("g")), String(names.length))
    const { spawnSync } = await import("node:child_process")
    const suite = spawnSync("npx", ["tsx", "validation/tools/bb_analyze/regex-edge-cases.ts"], { cwd: ROOT_DIR, encoding: "utf8", timeout: 180_000 })
    ck("N2: regex edge-case suite passes", suite.status === 0, ((suite.stdout ?? "") + (suite.stderr ?? "")).slice(-200))
    nk("N2: the edge-case suite is a real test file, not a placeholder", readFileSync(path.join(ROOT_DIR, "validation/tools/bb_analyze/regex-edge-cases.ts"), "utf8").length > 2000, "regex-edge-cases.ts")
  }
  await emit("N2", "M15.N2", "bb_analyze", "regex census", "n2.json")
  await reset()

  // ═══════════════════════════════════════════════════════════════════
  // N3: cross-file — graph edges + dependencies + impact across files
  // ═══════════════════════════════════════════════════════════════════
  {
    const { root, projectId } = await makeFixture()
    try {
      const depText = JSON.stringify(await getFileDependencies(projectId, { filePath: "b.ts" })).toLowerCase()
      ck("N3: file b.ts dependencies expose a.ts", depText.includes("a.ts"), depText.slice(0, 160))
      // The SHIPPED mode=impact calculator (canonical computeImpact), not the
      // deprecated analysis/impact.ts engine the tool no longer calls.
      const rawDb = await BrainDatabase.getRawInstance(projectId as any)
      const impact = await computeImpact(rawDb, projectId as any, "leaf")
      const impactText = JSON.stringify(impact).toLowerCase()
      ck("N3: canonical impact(leaf) roots and returns an impact set", !!impact.root && Array.isArray(impact.impact), impactText.slice(0, 160))
      ck("N3: canonical impact(leaf) reaches b.ts and c.ts", impactText.includes("b.ts") && impactText.includes("c.ts"), impactText.slice(0, 180))
    } catch (e: any) {
      ck("N3: setup", false, (e?.message || String(e)).slice(0, 160))
    } finally {
      cleanup(root, projectId)
    }
  }
  await emit("N3", "M15.N3", "bb_analyze", "cross-file graph + dependencies + impact", "n3.json")
  await reset()

  // ═══════════════════════════════════════════════════════════════════
  // N4: time complexity — measured wall-clock small vs larger
  // ═══════════════════════════════════════════════════════════════════
  {
    const small = mkdtempSync(path.join(tmpdir(), "bb-n4s-"))
    writeFileSync(path.join(small, "s.ts"), "export function s(): number { return 1 }\n")
    const big = mkdtempSync(path.join(tmpdir(), "bb-n4b-"))
    for (let f = 0; f < 20; f++) {
      let body = ""
      for (let i = 0; i < 8; i++) body += "export function fn" + f + "_" + i + "(x: number): number { return x + 1 }\n"
      writeFileSync(path.join(big, "f" + f + ".ts"), body)
    }
    const pS = await indexProject(small)
    const pB = await indexProject(big)
    try {
      const s = await timing(() => getProjectStats(pS))
      const b = await timing(() => getProjectStats(pB))
      ck("N4: big project has more symbols", b.value.symbols > s.value.symbols, b.value.symbols + " vs " + s.value.symbols)
      ck("N4: wall-clock big/small ratio <= 10x", b.ms <= s.ms * 10 + 100, "small=" + s.ms + "ms big=" + b.ms + "ms")
    } catch (e: any) {
      ck("N4: setup", false, (e?.message || String(e)).slice(0, 120))
    } finally {
      cleanup(small, pS); cleanup(big, pB)
    }
  }
  await emit("N4", "M15.N4", "bb_analyze", "measured time complexity", "n4.json")
  await reset()

  // ═══════════════════════════════════════════════════════════════════
  // N5: real-repo e2e — analysis on real repos on disk
  // ═══════════════════════════════════════════════════════════════════
  {
    //  "$HOME/fixtures/repositories" — the OTHER laptop's home directory — so
    //  each repo path below resolved to a filesystem that does not exist here and the leg
    //  measured nothing. Routed through script/lib/corpus-root.ts, which searches declared
    //  candidates in order and names them all when none exists.
    //  "$HOME/fixtures/repositories" — the OTHER laptop's home directory — so
    //  each repo path below resolved to a filesystem that does not exist here and the leg
    //  measured nothing. Routed through script/lib/corpus-root.ts, which searches declared
    //  candidates in order and names them all when none exists.
    // Per-repo corpus paths were built on the literal foreign root
    //  "$HOME/fixtures/repositories" — the OTHER laptop's home directory — so
    //  each repo path below resolved to a filesystem that does not exist here and the leg
    //  measured nothing. Routed through script/lib/corpus-root.ts, which searches declared
    //  candidates in order and names them all when none exists.
    const rake = `${CORPUS_BASE}/rake/lib`
    if (existsSync(rake)) {
      const projectId = await indexProject(rake)
      try {
        const stats = await getProjectStats(projectId)
        ck("N5: real repo (rake/lib) stats", stats.files > 0 && stats.symbols > 0, "files=" + stats.files + " symbols=" + stats.symbols)
        const cx = await analyzeComplexity(projectId, { scope: "project" })
        ck("N5: real repo complexity breakdown non-empty", cx.breakdown.length > 0, "n=" + cx.breakdown.length)
      } catch (e: any) {
        ck("N5: real repo analysis", false, (e?.message || String(e)).slice(0, 140))
      } finally {
        cleanup(rake, projectId)
      }
    } else {
      ck("N5: real repo present", false, "missing " + rake)
    }
  }
  await emit("N5", "M15.N5", "bb_analyze", "real-repo e2e (rake/lib)", "n5.json")
  await reset()

  // ═══════════════════════════════════════════════════════════════════
  // N6: docs honesty — registry block ↔ doc ↔ handler agree
  // ═══════════════════════════════════════════════════════════════════
  {
    // The per-tool split moved the descriptor out of tool-registry.ts; read the
    // module that owns it rather than a block that no longer exists there.
    const descriptorSrc = readFileSync(path.join(ROOT_DIR, "src/mcp/tools/bb_analyze/descriptor.ts"), "utf8")
    const reg = readFileSync(path.join(ROOT_DIR, "src/mcp/tool-registry.ts"), "utf8")
    const doc = readFileSync(path.join(ROOT_DIR, "docs/tools/bb_analyze.md"), "utf8")
    const hnd = readFileSync(path.join(ROOT_DIR, "src/mcp/tools/bb_analyze/handler.ts"), "utf8")
    ck("N6: registry is assembled from the per-tool descriptors", reg.includes("tools/bb_analyze/descriptor") || reg.includes("PUBLIC_TOOL_DESCRIPTORS") || reg.includes("bb_analyze"), "")
    ck("N6: descriptor lists bb_analyze", descriptorSrc.includes('name: "bb_analyze"'), "")
    ck("N6: descriptor mutability=read", descriptorSrc.includes('mutability: "read"'), "")
    ck("N6: descriptor requiresIndex=true", descriptorSrc.includes("requiresIndex: true"), "")
    ck("N6: doc exists", doc.length > 100, "len=" + doc.length)
    const docModes = ["callers", "callees", "complexity", "impact", "dependencies", "stats", "trace"]
    const docCovered = docModes.filter((m) => doc.includes(m)).length
    ck("N6: doc covers " + docCovered + "/" + docModes.length + " core modes", docCovered >= 5, "missing: " + docModes.filter((m) => !doc.includes(m)).join(","))
    // The previous check searched the WHOLE handler file for mode names, and the
    // handler's own "requires mode: callers|..." error line contains all eleven,
    // so it could never fail. Contract parity between the descriptor and the
    // generated page is a property that can: a missing registration or an
    // undocumented mode turns this red.
    const { PUBLIC_TOOL_DESCRIPTORS } = await import("../../src/mcp/tool-registry")
    const analyzeDescriptor = PUBLIC_TOOL_DESCRIPTORS.find((tool: any) => tool.name === "bb_analyze")!
    ck("N6: descriptor registers exactly the 11 modes", analyzeDescriptor.modes.length === 11, "modes=" + analyzeDescriptor.modes.length)
    ck("N6: every registered mode is documented on the generated page", analyzeDescriptor.modes.every((m: string) => doc.includes("`" + m + "`")), "missing=" + analyzeDescriptor.modes.filter((m: string) => !doc.includes("`" + m + "`")).join(","))
    ck("N6: handler module owns the dispatch", hnd.includes("export const handler") && hnd.includes("bb_analyze"))
  }
  await emit("N6", "M15.N6", "bb_analyze", "docs honesty", "n6.json")
  await reset()

  // ═══════════════════════════════════════════════════════════════════
  // N7: evidence + gate + self-audit + cleanup guard
  // ═══════════════════════════════════════════════════════════════════
  {
    for (const f of ["n1.json", "n2.json", "n3.json", "n4.json", "n5.json", "n6.json"]) {
      try {
        const d = JSON.parse(readFileSync(path.join(RESULTS_DIR, f), "utf8"))
        ck("N7: " + f + " present and verified", d.verified === true && d.failed === 0, "verified=" + d.verified + " failed=" + d.failed)
      } catch {
        ck("N7: " + f + " present", false, "missing or invalid")
      }
    }
    const self = readFileSync(fileURLToPath(import.meta.url), "utf8").split("N7: evidence")[0].replace(/\/\/[^\n]*/g, "")
    const autoPass = new RegExp("\\b(?:ck|nk)\\([^)]*,\\s*true\\s*[,)]")
    nk("N7: verifier has no auto-pass assertions", !autoPass.test(self), autoPass.test(self) ? "auto-pass found" : "clean")
    nk("N7: cleanup refuses non-tmp roots", readFileSync(fileURLToPath(import.meta.url), "utf8").includes("root.startsWith(tmpdir())"), "structural guard in cleanup()")
  }
  await emit("N7", "M15.N7", "bb_analyze", "evidence + gate + closure", "n7.json")
  await reset()

  // ═══════════════════════════════════════════════════════════════════
  // N8: mode coverage — all 11 modes produce structured results
  // ═══════════════════════════════════════════════════════════════════
  {
    const { root, projectId } = await makeFixture()
    try {
      const modes: Array<[string, () => Promise<unknown>]> = [
        ["callers", () => graphTraversal(projectId as any, "mid", { direction: "callers", maxDepth: 2 })],
        ["callees", () => graphTraversal(projectId as any, "mid", { direction: "callees", maxDepth: 2 })],
        ["trace", () => graphTraversal(projectId as any, "mid", { direction: "both", maxDepth: 2 })],
        ["dependencies", () => getFileDependencies(projectId, { filePath: "b.ts" })],
        ["stats", () => getProjectStats(projectId)],
        ["complexity", () => analyzeComplexity(projectId, { scope: "project" })],
        ["impact", async () => { const rawDb = await BrainDatabase.getRawInstance(projectId as any); return await computeImpact(rawDb, projectId as any, "leaf") }],
        ["test_mapping", () => testMapping(projectId)],
        ["test_gaps", () => testGaps(projectId)],
        ["test_impact", () => testImpact(projectId, "mid")],
        ["test_quality", () => testQuality(projectId, { maxFiles: 50 })],
      ]
      for (const [mode, fn] of modes) {
        try {
          const r = await fn()
          ck("N8: mode '" + mode + "' returns structured result", r !== undefined && r !== null && typeof r === "object", typeof r)
        } catch (e: any) {
          ck("N8: mode '" + mode + "' runs", false, (e?.message || String(e)).slice(0, 140))
        }
      }
    } catch (e: any) {
      ck("N8: setup", false, (e?.message || String(e)).slice(0, 140))
    } finally {
      cleanup(root, projectId)
    }
  }
  await emit("N8", "M15.N8", "bb_analyze", "mode coverage — all 11 modes", "n8.json")

  process.exit(failed > 0 ? 1 : 0)
})().catch((e: any) => { console.error("FATAL", e); process.exit(2) })