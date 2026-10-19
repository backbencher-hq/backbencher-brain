// JAVASCRIPT RAW GLOBAL-NAME SYMBOL PROBE — the JS half of the shared-pipeline keepSymbol question.
//
// `pool-worker.keepSymbol` drops any JS-family symbol whose NAME is in a 11-name JS_GLOBALS set
// (window, document, console, process, global, __dirname, __filename, module, exports, default,
// globalThis). The set exists to remove SYNTHETIC global-reference symbols; but a real DECLARATION may
// also carry one of those names (a class method `process()`, a property `global`, a const `module`),
// and the name-only rule would delete it. The TS lane measured 19/19 denylisted RAW symbols as
// declaration-shaped with zero phantoms — but TS's raw output cannot speak for JS. This probe runs the
// discriminator on the JS analyzer's RAW output (analyzer.analyze directly, NOT parseFile, which
// filters) over a bounded sample of the gate's admitted population and classifies each denylisted
// symbol: DECLARATION-SHAPED (a real kind with a real non-zero span) vs SYNTHETIC/PHANTOM (no range,
// zero width, invalid lines, sentinel scope, or a synthetic kind).
//
// USAGE
//   export BB_CORPUS_ROOT=$PWD/.corpus
//   bun run script/m14/js-raw-global-symbol-probe.ts --cap=300 --out=validation/m14/verification/javascript-raw-global-symbols.json
// It is a MEASUREMENT: parses only (bounded, light), changes nothing. The output JSON is the committed
// artifact the record cites.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const CAP = Number(process.argv.find((a) => a.startsWith("--cap="))?.slice("--cap=".length) ?? 300)
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? ""
const EXTENSIONS = ["js", "jsx", "mjs", "cjs"]
const SIZE_CAP = 1024 * 1024
// THE EXACT SET pool-worker.keepSymbol uses for the javascript language family.
const JS_GLOBAL_NAMES = new Set([
  "window", "document", "console", "process", "global",
  "__dirname", "__filename", "module", "exports", "default", "globalThis",
])

function repoNames(): string[] {
  try {
    return readdirSync(CR).filter((n) => { try { return statSync(path.join(CR, n)).isDirectory() } catch { return false } }).sort()
  } catch { return [] }
}
function admitByExtension(rel: string): boolean {
  const dot = rel.lastIndexOf(".")
  const ext = dot >= 0 ? rel.slice(dot + 1).toLowerCase() : ""
  if (EXTENSIONS.includes(ext)) return true
  return EXTENSIONS.includes(path.basename(rel))
}
const found: string[] = []
const repos = new Set<string>()
for (const name of repoNames()) {
  const dir = path.join(CR, name)
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!admitByExtension(rel)) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    found.push(abs); repos.add(name)
  }
}
found.sort()
// FRAME MODE: `--files=<list>` restricts to an explicit (sorted) candidate list — used for the
// DECLARATION-CONTEXT frame, where a cheap text filter proposes files that could declare a denylisted
// name, so the enumeration is complete over that frame instead of relying on a random draw.
const filesArg = process.argv.find((a) => a.startsWith("--files="))?.slice("--files=".length)
let frameFiles: string[] = found
let frameName = "admitted-stride"
if (filesArg) {
  frameFiles = readFileSync(filesArg, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).sort()
  frameName = "declaration-context-candidates"
}
const stride = Math.max(1, Math.floor(frameFiles.length / CAP))
const files: string[] = []
for (let i = 0; i < frameFiles.length && files.length < CAP; i += stride) files.push(frameFiles[i])

const { RealJavaScriptAnalyzer } = await import("../../src/ast/real-javascript-analyzer")
const analyzer = new (RealJavaScriptAnalyzer as any)()
const SYNTHETIC_KINDS = new Set(["", "unknown", "reference", "global", "placeholder", "phantom"])

type Entry = {
  file: string
  name: string
  kind: string
  scope: string
  qualifiedName: string | null
  ownerName: string | null
  ownerKind: string | null
  range: any
  span: { startIndex: number | null; endIndex: number | null; width: number | null; startLine: number | null; endLine: number | null } | null
  metadataKeys: string[]
  duplicateIndexInFile: number
  verdict: "declared-shaped" | "synthetic"
  reasons: string[]
}
const entries: Entry[] = []
let parsed = 0, skipped = 0
const filesWithDenylistedNames = new Set<string>()
const perFileNameCounts = new Map<string, number>()
for (const abs of files) {
  let content: string
  try { content = readFileSync(abs, "utf8") } catch { skipped++; continue }
  let res: any
  try {
    const parser: any = await getParser("javascript" as any)
    const tree = parser.parse(content)
    res = await analyzer.analyze(tree.rootNode, content, abs)
    tree.delete?.()
  } catch { skipped++; continue }
  parsed++
  for (const sym of res.symbols ?? []) {
    const name = String(sym?.name ?? "")
    if (!JS_GLOBAL_NAMES.has(name)) continue
    const kind = String(sym?.kind ?? "")
    const r = sym?.range ?? {}
    const sI = typeof r.startIndex === "number" ? r.startIndex : null
    const eI = typeof r.endIndex === "number" ? r.endIndex : null
    const sL = typeof r.startLine === "number" ? r.startLine : null
    const eL = typeof r.endLine === "number" ? r.endLine : null
    const width = sI !== null && eI !== null ? eI - sI : null
    const span = { startIndex: sI, endIndex: eI, width, startLine: sL, endLine: eL }
    const reasons: string[] = []
    // DECLARATION-SHAPED requires a real kind AND a real, non-zero, coherent span.
    const realSpan = sI !== null && eI !== null && eI > sI && sL !== null && eL !== null && eL >= sL && sL >= 1
    if (SYNTHETIC_KINDS.has(kind.toLowerCase())) reasons.push(`synthetic-kind(${kind || "<empty>"})`)
    if (sI === null || eI === null) reasons.push("range-absent-or-non-numeric")
    else if (eI <= sI) reasons.push("zero-or-negative-width")
    if (sL === null || eL === null) reasons.push("line-absent")
    else if (eL < sL || sL < 1) reasons.push("invalid-line-span")
    const key = `${abs}\u0000${name}`
    const dup = (perFileNameCounts.get(key) ?? 0) + 1
    perFileNameCounts.set(key, dup)
    filesWithDenylistedNames.add(abs)
    entries.push({
      file: path.relative(CR, abs),
      name, kind,
      scope: String(sym?.scope ?? ""),
      qualifiedName: typeof sym?.qualifiedName === "string" ? sym.qualifiedName : null,
      ownerName: typeof sym?.ownerName === "string" ? sym.ownerName : (typeof sym?.metadata?.ownerName === "string" ? sym.metadata.ownerName : null),
      ownerKind: typeof sym?.ownerKind === "string" ? sym.ownerKind : null,
      range: r,
      span,
      metadataKeys: Object.keys(sym?.metadata ?? {}),
      duplicateIndexInFile: dup,
      verdict: reasons.length === 0 ? "declared-shaped" : "synthetic",
      reasons,
    })
  }
}
const declared = entries.filter((e) => e.verdict === "declared-shaped")
const synthetic = entries.filter((e) => e.verdict === "synthetic")
const count = (arr: Entry[], f: (e: Entry) => string): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const e of arr) { const k = f(e); out[k] = (out[k] ?? 0) + 1 }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]))
}
const report = {
  probe: "js-raw-global-symbol-probe",
  command: `bun run script/m14/js-raw-global-symbol-probe.ts --cap=${CAP}`,
  question: "Are JS-family JS_GLOBAL-named RAW symbols declaration-shaped or synthetic? (keepSymbol's name-only drop. RAW = analyzer.analyze, not parseFile.)",
  frame: { name: frameName, frameFiles: frameFiles.length },
  population: { admittedTotal: found.length, repos: repos.size, sampled: files.length, parsed, skipped },
  denylist: [...JS_GLOBAL_NAMES],
  totals: {
    denylistedSymbols: entries.length,
    filesWithDenylistedNames: filesWithDenylistedNames.size,
    declaredShaped: declared.length,
    synthetic: synthetic.length,
    withGlobalSentinelQualifier: entries.filter((e) => String(e.qualifiedName ?? "").startsWith("__global__")).length,
  },
  declaredShaped: {
    byName: count(declared, (e) => e.name),
    byKind: count(declared, (e) => e.kind),
    withRealSpan: declared.length,
  },
  synthetic: {
    byName: count(synthetic, (e) => e.name),
    byKind: count(synthetic, (e) => e.kind),
    byReasons: count(synthetic, (e) => e.reasons.join("+")),
    entries: synthetic.slice(0, 50),
  },
  declaredSamples: declared.slice(0, 25),
  allEntries: entries,
  note: "Bounded sample of the gate's admitted population; RAW analyzer output. `declared-shaped` = a real kind with a non-zero, coherent span. `synthetic` = the union of the reasons listed on each entry. The recommended guard is in the page note; the pool-worker change is the Lead's.",
}
const out = JSON.stringify(report, null, 1) + "\n"
if (OUT) writeFileSync(OUT, out)
console.log(out.slice(0, 4000))
console.log(`\n--- artifact: ${OUT || "(stdout only)"} ---`)
