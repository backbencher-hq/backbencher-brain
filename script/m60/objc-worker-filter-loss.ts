// script/m60/objc-worker-filter-loss.ts — how many Objective-C edges does the
// shared `filterNoiseRelationships` delete, and why?
//
// WHY THIS IS A SEPARATE INSTRUMENT. The oracle audit
// (script/m60/objc-oracle-audit.ts) compares the analyzer's output, read through
// the PRODUCTION entry `parseFile`, against an independent derivation from the
// tree. It found 36 `contains` edges the tree declares and production does not
// deliver. `src/ast/pool-worker.ts` is not this lane's, so the finding is measured
// here and REPORTED rather than fixed — but "the analyzer emits it and the worker
// eats it" and "the analyzer never emits it" are different defects with different
// owners, so the split has to be a number.
//
// The drop is measured by running the analyzer DIRECTLY (no worker filter) and
// comparing the two edge sets, then attributing each drop to the filter rule that
// made it. The rules are read from the production filter's own source through
// `nameTheSymbolRule`-style reasoning written out here — no regex.
//
// NO REGEX (lane rule 1).
//
// Usage: bun script/m60/objc-worker-filter-loss.ts
// Writes: validation/m60/results/objc-worker-filter-loss.json
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { loadWebTreeSitter, resolveWasmAsset } from "../../src/util/wasm"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { RealObjectiveCAnalyzer } from "../../src/ast/real-objective-c-analyzer"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS_ROOT = "$HOME/fixtures/repositories/objc"
const OUT = path.join(ROOT, "validation/m60/results/objc-worker-filter-loss.json")

/** The worker's own leaf rule, restated: the last NON-EMPTY `:`-separated segment,
 *  then the last `.`-separated part of that. Kept identical to pool-worker.ts's
 *  `extractLeaf` because the attribution below must name the rule that fired. */
function workerLeaf(name: string): string {
  let noLine = name
  // strip a trailing `:<digits>` line marker the way the worker does
  let cut = noLine.length
  while (cut > 0 && noLine[cut - 1] >= "0" && noLine[cut - 1] <= "9") cut--
  if (cut > 0 && noLine[cut - 1] === ":" && cut < noLine.length) noLine = noLine.slice(0, cut - 1)
  const segments: string[] = []
  for (const s of noLine.split(":")) if (s.length > 0) segments.push(s)
  const last = segments.length > 0 ? segments[segments.length - 1] : ""
  const dotParts = last.split(".")
  return dotParts.length > 0 ? dotParts[dotParts.length - 1] : ""
}

/** Which production rule, in `filterNoiseRelationships`, would drop this target.
 *  Returns "" when no rule would. Mirrors the order the worker applies them in. */
const TEST_LIFECYCLE = new Set(["setUp", "tearDown", "setUpBeforeClass", "tearDownAfterClass", "beforeEach", "afterEach"])

function dropRule(target: string): string {
  if (target.length === 0) return ""
  if (target.length > 200) return "target over 200 chars (garbage-target guard)"
  const leaf = workerLeaf(target)
  if (leaf.length > 80) return "LEAF OVER 80 CHARS"
  if (leaf.length < 1) return "empty leaf"
  if (TEST_LIFECYCLE.has(leaf)) return "NOISE_TARGETS test-lifecycle list (declared framework boilerplate — intended)"
  return ""
}

async function main(): Promise<void> {
  const files: string[] = []
  const walk = (dir: string): void => {
    let entries: any[]
    try { entries = readdirSync(dir, { withFileTypes: true }) as any[] } catch { return }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      const ext = path.extname(e.name).toLowerCase()
      if (ext !== ".m" && ext !== ".mm" && ext !== ".h") continue
      if (statSync(p).size > 1024 * 1024) continue
      let src = ""
      try { src = readFileSync(p, "utf8") } catch { continue }
      if (detectLanguageFromPath(p, src) === "objective-c") files.push(p)
    }
  }
  walk(CORPUS_ROOT)
  files.sort()

  await ASTEngine.getParser("objective-c")
  const mod: any = await loadWebTreeSitter()
  const lang = await mod.Language.load(readFileSync(resolveWasmAsset("tree-sitter-objc.wasm")))
  const parser = new mod.Parser()
  parser.setLanguage(lang)

  const byRule = new Map<string, number>()
  const byType = new Map<string, number>()
  let rawTotal = 0, deliveredTotal = 0
  const samples: Array<Record<string, unknown>> = []
  const perFile: Array<Record<string, unknown>> = []

  for (const f of files) {
    const src = readFileSync(f, "utf8")
    const raw: any = (new RealObjectiveCAnalyzer() as any).analyze(parser.parse(src).rootNode, src, f)
    const prod: any = await parseFile(f, src)
    rawTotal += (raw.relationships ?? []).length
    deliveredTotal += (prod?.relationships ?? []).length
    const delivered = new Set<string>((prod?.relationships ?? []).map((x: any) => `${x.type}|${x.source}->${x.target}`))
    let fileDrops = 0
    for (const x of raw.relationships ?? []) {
      const key = `${x.type}|${x.source}->${x.target}`
      if (delivered.has(key)) continue
      fileDrops++
      const rule = dropRule(String(x.target ?? ""))
      byRule.set(rule || "(delivered under a different dedup, rule unknown)", (byRule.get(rule || "(delivered under a different dedup, rule unknown)") ?? 0) + 1)
      byType.set(x.type, (byType.get(x.type) ?? 0) + 1)
      if (samples.length < 40) samples.push({ file: f.slice(CORPUS_ROOT.length + 1), line: x.line_number, type: x.type, edge: `${x.source}->${x.target}`, leafLength: workerLeaf(String(x.target ?? "")).length, rule: rule || "(rule unknown)" })
    }
    if (fileDrops > 0) perFile.push({ file: f.slice(CORPUS_ROOT.length + 1), dropped: fileDrops })
  }

  const payload = {
    instrument: "script/m60/objc-worker-filter-loss.ts",
    corpus: CORPUS_ROOT,
    admission: "detectLanguageFromPath(filePath, content) === objective-c",
    files: files.length,
    question: "how many Objective-C relationships does src/ast/pool-worker.ts filterNoiseRelationships delete between analyze() and parseFile()?",
    owner: "src/ast/pool-worker.ts is the master agent's — measured and reported, not fixed here",
    analyzerEmittedEdges: rawTotal,
    productionDeliveredEdges: deliveredTotal,
    dropped: rawTotal - deliveredTotal,
    byRule: Object.fromEntries([...byRule].sort((a, b) => b[1] - a[1])),
    byType: Object.fromEntries([...byType].sort((a, b) => b[1] - a[1])),
    samples,
    perFile: perFile.sort((a: any, b: any) => (b.dropped as number) - (a.dropped as number)),
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2))
  console.log(`objc worker filter loss  files ${files.length}`)
  console.log(`  analyzer emitted ${rawTotal} edges · production delivered ${deliveredTotal} · DROPPED ${rawTotal - deliveredTotal}`)
  console.log(`  by rule: ${JSON.stringify(payload.byRule)}`)
  console.log(`  by type: ${JSON.stringify(payload.byType)}`)
  for (const s of samples.slice(0, 10)) console.log(`   ${s.file}:${s.line}  ${s.type} ${s.edge}  leafLen=${s.leafLength}  ${s.rule}`)
  console.log(`wrote ${OUT}`)
}
await main()
