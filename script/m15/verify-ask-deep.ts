// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the deep behavioural gate for bb_ask, in eight measured sections:
//   classification/routing, the no-regex census plus the page-size behaviour, comment and
//   string safety, cross-file evidence, measured scaling, a real-repository run, registry/
//   page/handler agreement, and a self-audit that refuses auto-pass assertions.
// WHICH TOOL IT SERVES — bb_ask (read, requiresIndex true, modes: answer).
// WHY IT IS SHAPED THIS WAY — every section judges BEHAVIOUR or a measured quantity, not
//   the shape of the source: the old census asserted that specific implementation strings
//   existed, which is how a check passes when the implementation breaks. The one static
//   claim left — "this path contains no regex" — is a policy assertion with a red mutant.
// WHERE ITS EVIDENCE LIVES — validation/m15/results/a1..a8.json and
//   validation/tools/bb_ask/gates/.
// EDIT TOGETHER WHEN THIS FILE CHANGES — the engines it calls, docs/BB_ASK.md,
//   validation/tools/bb_ask/work/run-gates.mjs.
// CONTRACTS IT MUST NOT BREAK — no auto-pass assertions; a missing corpus is a declared
//   block, not a pass; every section emits before the next runs.
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, statSync, appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { quickAnswer, ASK_LIMIT_REFUSAL } from "../../src/intelligence/search/quick-answer"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { resolveCorpusRoot } from "../lib/corpus-root.ts"

let checks = 0, passed = 0, failed = 0, negatives = 0, negativePassed = 0
function ck(label: string, cond: boolean, detail?: string) { checks++; if (cond) passed++; else { failed++; console.log("  FAIL: " + label + (detail ? " — " + detail : "")) } }
function nk(label: string, cond: boolean, detail?: string) { negatives++; if (cond) negativePassed++; else { failed++; console.log("  FAIL: " + label + " (negative)" + (detail ? " — " + detail : "")) } }

const ROOT_DIR = path.resolve(import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url)), "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation", "m15", "results")
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

async function emit(code: string, issue: string, tool: string, title: string, file: string, extra?: any) {
  const total = passed + negativePassed
  const e = { issue, code, tool, title, verified: failed === 0, checks, passed: total, failed, negatives, generatedAt: new Date().toISOString(), ...(extra || {}) }
  writeFileSync(path.join(RESULTS_DIR, file), JSON.stringify(e, null, 2) + "\n")
  console.log(code + ": " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + total + "/" + checks + " passed, " + negatives + " negatives)")
}
async function reset() { checks = passed = failed = negatives = negativePassed = 0 }

async function indexProject(root: string) {
  const projectId = getProjectId(root)
  await indexProjectParallel(projectId, root, {})
  await flushBackgroundEmbeddings()
  return projectId
}
// Cleanup that can never destroy a real project: only temp roots we created and the
// project database directory are removed.
function cleanup(root: string, projectId: string) {
  if (root.startsWith(tmpdir())) { try { rmSync(root, { recursive: true, force: true }) } catch {} }
  try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
}
async function timing<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = Date.now()
  const value = await fn()
  return { value, ms: Date.now() - t0 }
}

// ═══════════════════════════════════════════════════════════════════════════
// A1: classification — routing, cross-language counts, no-index honesty
// ═══════════════════════════════════════════════════════════════════════════
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-ask-a1-"))
  writeFileSync(path.join(root, "a.ts"), "export function helper(): number { return 1 }\nexport function targetFn(): number { return helper() }\n")
  writeFileSync(path.join(root, "b.ts"), "import { targetFn } from './a'\nexport function caller(): number { return targetFn() }\n")
  const projectId = await indexProject(root)
  try {
    const howMany = await quickAnswer(projectId, "how many functions are in this project?")
    ck("A1: 'how many functions' routes to the aggregate path", howMany.answer.startsWith("There are ") && /functions/.test(howMany.answer) && howMany.route === "aggregate", howMany.answer.slice(0, 60))
    ck("A1: aggregate confidence kind is exact-aggregate and >= 0.9", howMany.confidenceKind === "exact-aggregate" && howMany.confidence >= 0.9, `${howMany.confidenceKind}/${howMany.confidence}`)
    ck("A1: aggregate declares bounds and an index snapshot", !!howMany.bounds && (!!howMany.indexSnapshot || howMany.provenance.limitations.length > 0), JSON.stringify(howMany.bounds))
    const handler = createToolHandlers().bb_ask
    const wire: any = await handler({ query: "how many functions are in this project?" }, { projectId, projectPath: root } as any)
    const wireText = (wire?.content ?? []).map((c: any) => c.text ?? "").join("\n")
    nk("A1: aggregate wire answer never gets a 'no matches' footer", !wireText.includes("no matches for"), wireText.slice(0, 140))

    const sym = await quickAnswer(projectId, "targetFn")
    ck("A1: an exact symbol name resolves to the symbol", sym.sources.length >= 1 && (sym.retrieval?.method === "exact-name" || sym.answer.includes("`targetFn`")), `sources=${sym.sources.length} method=${sym.retrieval?.method}`)

    // Cross-language: a method-first language must not report 0 functions.
    const rubyRoot = mkdtempSync(path.join(tmpdir(), "bb-ask-a1rb-"))
    writeFileSync(path.join(rubyRoot, "mod.rb"), "module Foo\n  def helper(a)\n    a + 1\n  end\n  def target(b)\n    helper(b)\n  end\nend\n")
    const rubyId = await indexProject(rubyRoot)
    try {
      const rubyCount = await quickAnswer(rubyId, "how many functions are in this project?")
      const match = rubyCount.answer.match(/There are (\d+) functions/)
      ck("A1: Ruby 'how many functions' counts methods (>0, not 0)", match !== null && parseInt(match[1], 10) > 0, rubyCount.answer.slice(0, 60))
      const most = await quickAnswer(rubyId, "what is the most complex function?")
      ck("A1: Ruby 'most complex function' finds a method", /most complex function is/.test(most.answer), most.answer.slice(0, 60))
    } finally { cleanup(rubyRoot, rubyId) }

    const emptyRoot = mkdtempSync(path.join(tmpdir(), "bb-ask-a1e-"))
    const emptyId = getProjectId(emptyRoot)
    const guard = await quickAnswer(emptyId, "how many functions?")
    nk("A1: a missing index returns an explicit unknown, not a fabricated count", /no index/i.test(guard.answer) && guard.route === "no-index", guard.answer.slice(0, 60))
    cleanup(emptyRoot, emptyId)

    const nonsense = await quickAnswer(projectId, "qqzzxx nothing here")
    ck("A1: a nonsense query returns a shaped result without throwing", typeof nonsense.answer === "string" && Number.isFinite(nonsense.confidence) && !!nonsense.bounds, `conf=${nonsense.confidence}`)
  } catch (e: any) {
    ck("A1: setup", false, (e?.message || String(e)).slice(0, 160))
  } finally { cleanup(root, projectId) }
}
await emit("A1", "bb_ask classification and aggregate routing", "bb_ask", "classification — stat routing + cross-language + honesty guard", "a1.json")
await reset()

// ═══════════════════════════════════════════════════════════════════════════
// A2: no regex in the read path + the page-size behaviour the regex policy
//     comment used to stand in for
// ═══════════════════════════════════════════════════════════════════════════
{
  // A regex literal is a `/…/` sequence in a member-call position, ignoring comments
  // and imports. This detector is allowed to use a regex: it lives in a GATE, not in
  // the tool's read path, which is exactly the distinction the policy gate audits.
  const ASK_PATH = [
    "src/intelligence/search/quick-answer.ts",
    "src/intelligence/search/semantic-search.ts",
    "src/mcp/tools/bb_ask/handler.ts",
    "src/mcp/tools/bb_ask/descriptor.ts",
  ]
  const found: string[] = []
  for (const rel of ASK_PATH) {
    const source = readFileSync(path.join(ROOT_DIR, rel), "utf8").replace(/\/\/[^\n]*/g, "")
    const relits = source.match(/[A-Za-z_.]+\(\s*\/[^\n]*?\//g) || []
    for (const literal of relits) if (!literal.startsWith("import")) found.push(`${rel}: ${literal}`)
  }
  nk("A2: the bb_ask read path contains no regex literal", found.length === 0, `found: ${found.join(" | ")}`)

  const root = mkdtempSync(path.join(tmpdir(), "bb-ask-a2-"))
  writeFileSync(path.join(root, "a.ts"), "export function alphaOne(): number { return 1 }\n")
  writeFileSync(path.join(root, "b.rb"), "def beta_two\n  2\nend\n")
  const projectId = await indexProject(root)
  try {
    const ts = await quickAnswer(projectId, "how many typescript files are in this project?")
    ck("A2: a language-scoped count answers with that language's count", /There are 1 typescript files/.test(ts.answer), ts.answer.slice(0, 80))
    const all = await quickAnswer(projectId, "how many files are in this project?")
    ck("A2: an unscoped count answers with the whole-project count", /There are 2 files/.test(all.answer), all.answer.slice(0, 80))
    const short = await quickAnswer(projectId, "how many ts files are in this project?")
    ck("A2: a short language spelling routes to the same language", /There are 1 typescript files/.test(short.answer), short.answer.slice(0, 80))

    for (const bad of [0, 101]) {
      const refused = await quickAnswer(projectId, "request handler", { limit: bad })
      nk(`A2: limit=${bad} is refused with the page-size sentence and does no retrieval`, refused.answer === ASK_LIMIT_REFUSAL && refused.sources.length === 0, refused.answer.slice(0, 100))
    }
    const one = await quickAnswer(projectId, "alphaOne beta_two", { limit: 1 })
    const three = await quickAnswer(projectId, "alphaOne beta_two", { limit: 3 })
    ck("A2: limit bounds the returned sources", one.sources.length <= 1, `limit=1 returned ${one.sources.length}`)
    ck("A2: a larger limit can return more results", three.sources.length >= one.sources.length, `limit=1 → ${one.sources.length}, limit=3 → ${three.sources.length}`)
    ck("A2: bounds declare the page size that was applied", one.bounds.returned === one.sources.length && typeof one.bounds.totalMatches !== "undefined", JSON.stringify(one.bounds))
  } finally { cleanup(root, projectId) }
}
await emit("A2", "bb_ask no-regex census and page-size behaviour", "bb_ask", "regex census and page-size behaviour", "a2.json")
await reset()

// ═══════════════════════════════════════════════════════════════════════════
// A3: comment/string safety — answers never leak comment or string text as
//     cited evidence
// ═══════════════════════════════════════════════════════════════════════════
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-ask-a3-"))
  writeFileSync(path.join(root, "secrets.ts"), "// SECRET_TOKEN = 'xyzzy'\nconst apiKey = \"hw_sk_abcd1234\"\nconst realToken = compute('v')\n")
  const projectId = await indexProject(root)
  try {
    const result = await quickAnswer(projectId, "apiKey")
    ck("A3: query does not crash on a file with comments and strings", typeof result.answer === "string")
    const leaked = ["xyzzy", "hw_sk_abcd1234"].filter((secret) => result.answer.includes(secret))
    nk("A3: comment/string content is not echoed as answer evidence", leaked.length === 0, "leaked: " + leaked.join(","))
  } catch (e: any) {
    ck("A3: setup", false, (e?.message || String(e)).slice(0, 120))
  } finally { cleanup(root, projectId) }
}
await emit("A3", "bb_ask comment and string safety", "bb_ask", "comment/string safety", "a3.json")
await reset()

// ═══════════════════════════════════════════════════════════════════════════
// A4: cross-file correctness — evidence resolves to the declaration
// ═══════════════════════════════════════════════════════════════════════════
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-ask-a4-"))
  writeFileSync(path.join(root, "a.ts"), "export function alpha(): number { return 1 }\n")
  writeFileSync(path.join(root, "b.ts"), "import { alpha } from './a'\nexport function beta(): number { return alpha() }\n")
  const projectId = await indexProject(root)
  try {
    const sym = await quickAnswer(projectId, "alpha", { limit: 1 })
    ck("A4: cross-file exact lookup resolves alpha()", sym.sources.length >= 1, "sources=" + sym.sources.length)
    const source = sym.sources[0]
    ck("A4: source points at the declaration file a.ts", source.file.endsWith("a.ts"), source.file)
    ck("A4: source has a declaration line", source.line >= 1, "line=" + source.line)
  } catch (e: any) {
    ck("A4: setup", false, (e?.message || String(e)).slice(0, 120))
  } finally { cleanup(root, projectId) }
}
await emit("A4", "bb_ask cross-file symbol evidence", "bb_ask", "cross-file symbol evidence", "a4.json")
await reset()

// ═══════════════════════════════════════════════════════════════════════════
// A5: measured time complexity — the aggregate path is flat in project size
// ═══════════════════════════════════════════════════════════════════════════
{
  const rootSmall = mkdtempSync(path.join(tmpdir(), "bb-ask-a5s-"))
  const rootBig = mkdtempSync(path.join(tmpdir(), "bb-ask-a5b-"))
  writeFileSync(path.join(rootSmall, "s.ts"), "export function s(): number { return 1 }\n")
  for (let file = 0; file < 60; file++) {
    let body = ""
    for (let index = 0; index < 20; index++) body += `export function fn${file}_${index}(x: number): number { return x + 1 }\n`
    writeFileSync(path.join(rootBig, `f${file}.ts`), body)
  }
  const pidS = await indexProject(rootSmall)
  const pidB = await indexProject(rootBig)
  try {
    const rS = await quickAnswer(pidS, "how many functions are in this project?")
    const rB = await quickAnswer(pidB, "how many functions are in this project?")
    const nS = Number((rS.answer.match(/There are ([\d,]+)/) || [])[1]?.replace(/,/g, "") || 0)
    const nB = Number((rB.answer.match(/There are ([\d,]+)/) || [])[1]?.replace(/,/g, "") || 0)
    ck("A5: small project count is correct", nS >= 1, "n=" + nS)
    ck("A5: large project count is correct (>= 1000)", nB >= 1000, "n=" + nB)
    ck("A5: counts scale with project size", nB > nS * 100, "small=" + nS + " big=" + nB)
    const ws = await timing(() => quickAnswer(pidS, "how many functions are in this project?"))
    const wb = await timing(() => quickAnswer(pidB, "how many functions are in this project?"))
    ck("A5: aggregate wall-clock does not scale superlinearly (<= 5x + 20 ms)", wb.ms <= ws.ms * 5 + 20, "small=" + ws.ms + "ms big=" + wb.ms + "ms")
  } catch (e: any) {
    ck("A5: setup", false, (e?.message || String(e)).slice(0, 120))
  } finally {
    cleanup(rootSmall, pidS)
    cleanup(rootBig, pidB)
  }
}
await emit("A5", "bb_ask measured aggregate scaling", "bb_ask", "measured time complexity", "a5.json")
await reset()

// ═══════════════════════════════════════════════════════════════════════════
// A6: real-repository run
// ═══════════════════════════════════════════════════════════════════════════
{
  const corpus = resolveCorpusRoot(ROOT_DIR)
  const realRepo = corpus ? path.join(corpus, "rake", "lib") : ""
  if (corpus && realRepo && existsSync(realRepo)) {
    const projectId = await indexProject(realRepo)
    try {
      const stat = await quickAnswer(projectId, "how many functions are in this project?")
      ck("A6: real repo (rake/lib, Ruby) aggregate returns a real number", /There are ([\d,]+) functions/.test(stat.answer), stat.answer.slice(0, 50))
      const symbol = await quickAnswer(projectId, "Rake")
      ck("A6: real repo symbol query returns sources", symbol.sources.length >= 1, "sources=" + symbol.sources.length)
      ck("A6: real repo answer carries bounds and provenance", stat.provenance.evidenceClass === "indexed" && !!stat.bounds, stat.provenance.evidenceClass)
    } finally { cleanup(realRepo, projectId) }
  } else {
    ck("A6: real repo present on disk", false, "corpus not found")
  }
}
await emit("A6", "bb_ask real-repository e2e", "bb_ask", "real-repo e2e (real subpath)", "a6.json")
await reset()

// ═══════════════════════════════════════════════════════════════════════════
// A7: registry / page / handler agreement
// ═══════════════════════════════════════════════════════════════════════════
{
  const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((tool) => tool.name === "bb_ask")!
  const doc = readFileSync(path.join(ROOT_DIR, "docs", "tools", "bb_ask.md"), "utf8")
  const handlerSrc = readFileSync(path.join(ROOT_DIR, "src", "mcp", "tools", "bb_ask", "handler.ts"), "utf8")
  const engineSrc = readFileSync(path.join(ROOT_DIR, "src", "intelligence", "search", "quick-answer.ts"), "utf8")

  ck("A7: registry mutability=read", descriptor.mutability === "read")
  ck("A7: registry requiresIndex=true", descriptor.requiresIndex === true)
  ck("A7: registry modes are exactly [answer]", JSON.stringify(descriptor.modes) === JSON.stringify(["answer"]))
  ck("A7: explain/feature are planned, not executable", (descriptor.plannedModes ?? []).includes("explain") && (descriptor.plannedModes ?? []).includes("feature"))
  ck("A7: descriptor declares the limit range 1..100 and default 5", (descriptor.inputSchema as any).properties?.limit?.minimum === 1 && (descriptor.inputSchema as any).properties?.limit?.maximum === 100 && /default 5/.test((descriptor.inputSchema as any).properties?.limit?.description ?? ""))
  ck("A7: page lists category, mutability, modes and planned modes", doc.includes("Category: `search`") && doc.includes("Mutability: `read`") && doc.includes("Modes: `answer`") && doc.includes("Planned modes (roadmap, not executable): `explain`, `feature`"))
  ck("A7: page states the page-size contract", /1\.\.100/.test(doc) && /refused rather than clamped/.test(doc))
  ck("A7: page states the two freshness markers", doc.includes("STALE — file changed since index") && doc.includes("MISSING — file no longer on disk"))
  ck("A7: handler imports the shared page-size sentence from the engine", handlerSrc.includes("ASK_LIMIT_REFUSAL") && engineSrc.includes("export const ASK_LIMIT_REFUSAL"))
  ck("A7: handler renders provenance and bounds on every answer", handlerSrc.includes("renderBounds") && handlerSrc.includes("renderProvenance"))
  nk("A7: page/guide carry no milestone narrative", !/\bM\d+\.\d+/.test(doc) && !/\bM\d+\.\d+/.test(readFileSync(path.join(ROOT_DIR, "docs", "BB_ASK.md"), "utf8")), "")
}
await emit("A7", "bb_ask registry, page and handler agreement", "bb_ask", "docs honesty", "a7.json")
await reset()

// ═══════════════════════════════════════════════════════════════════════════
// A8: evidence completeness and verifier self-audit
// ═══════════════════════════════════════════════════════════════════════════
{
  const selfSource = readFileSync(fileURLToPath(import.meta.url), "utf8").split("A8: evidence")[0].replace(/\/\/[^\n]*/g, "")
  const autoPass = new RegExp("\\b(?:ck|nk)\\([^)]*,\\s*true\\s*[,)]")
  const hits: string[] = []
  if (autoPass.test(selfSource)) hits.push("auto-pass ck/nk(..., true)")
  if (selfSource.includes("HARDCODED")) hits.push("HARDCODED marker")
  nk("A8: this verifier has no auto-pass or tautological assertion", hits.length === 0, "patterns: " + hits.join(" | "))

  for (const file of ["a1.json", "a2.json", "a3.json", "a4.json", "a5.json", "a6.json", "a7.json"]) {
    try {
      const document = JSON.parse(readFileSync(path.join(RESULTS_DIR, file), "utf8"))
      ck(`A8: ${file} is present and verified`, document.verified === true && document.failed === 0, "verified=" + document.verified + " failed=" + document.failed)
    } catch {
      ck(`A8: ${file} exists`, false, "missing or invalid")
    }
  }
}
await emit("A8", "bb_ask evidence completeness and verifier self-audit", "bb_ask", "evidence + gate self-audit", "a8.json")

process.exit(failed > 0 ? 1 : 0)
