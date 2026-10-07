// Controlled A/B for the OC-ONT edge additions: does the analyzer get slower, or is
// the +30% on the scaling probe's single-shot corpus half machine drift?
//
// METHOD. Both analyzer versions are loaded INTO ONE PROCESS (HEAD's source is
// written to a sibling module and imported alongside the working tree's), the trees
// are parsed ONCE, and `analyze()` is then timed in INTERLEAVED order A,B,A,B... so
// any monotone drift in machine load lands on both arms equally. Each arm reports
// the MINIMUM over its reps, which is the estimator script/m60/objc-scaling-probe.ts
// already uses and defends ("a series that goes backwards is measuring the machine").
//
// It also counts the thing the benchmark cannot argue about: the relationship COUNT,
// which is deterministic and is the payload the budget is actually written against.
//
// Usage: bun run script/m60/objc-ontology-ab.ts [--reps 9]
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { RealObjectiveCAnalyzer } from "../../src/ast/real-objective-c-analyzer"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories/objc"
const reps = Number(process.argv[process.argv.indexOf("--reps") + 1]) || 9

// --- the HEAD analyzer, as a second module in the same process --------------
const TMP = path.join(ROOT, "script/m60/tmp-objc-ab")
mkdirSync(TMP, { recursive: true })
const headSrc = execFileSync("git", ["show", "HEAD:src/ast/real-objective-c-analyzer.ts"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
const headPath = path.join(TMP, "analyzer-head.ts")
writeFileSync(headPath, headSrc.replace(/from "\.\/engine"/g, `from "${path.join(ROOT, "src/ast/engine").replace(/\\/g, "/")}"`))
const { RealObjectiveCAnalyzer: HeadAnalyzer } = await import(headPath)

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-objc.wasm"))))

const files: Array<{ label: string; abs: string; text: string; tree: any }> = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "ls-files", "-z"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "objective-c") continue
    const tree = parser.parse(text)
    if (tree) files.push({ label: `${e}/${rel}`, abs, text, tree })
  }
}
console.log(`corpus ${CR}: ${files.length} admitted files, trees parsed once`)

const timeArm = (Klass: any): { ms: number; cpuMs: number; symbols: number; rels: number; edges: Map<string, Set<string>> } => {
  const t0 = performance.now()
  const c0 = process.cpuUsage()
  let symbols = 0, rels = 0
  const edges = new Map<string, Set<string>>()
  for (const f of files) {
    const r: any = new Klass().analyze(f.tree.rootNode, f.text, f.abs)
    symbols += (r.symbols ?? []).length
    rels += (r.relationships ?? []).length
    for (const x of r.relationships ?? []) {
      const t = String(x.type ?? "")
      let s = edges.get(t)
      if (!s) { s = new Set(); edges.set(t, s) }
      s.add(`${f.label}:${x.line_number ?? 0} ${x.source} -> ${x.target}`)
    }
  }
  const c1 = process.cpuUsage(c0)
  return { ms: performance.now() - t0, cpuMs: (c1.user + c1.system) / 1000, symbols, rels, edges }
}

// Warm both arms once so neither pays first-call JIT on its measured rep.
timeArm(HeadAnalyzer); timeArm(RealObjectiveCAnalyzer)

// WALL CLOCK IS NOT THE INSTRUMENT ON A LOADED MACHINE, and this one is loaded: four
// interleaved runs of the same comparison produced min-of-9 values of +6.75%, -2.77%,
// -10.26% and +28.86% — a spread that no code change produces and that the run's own
// `uptime` (load average 10-25 on 8 cores) explains. So CPU TIME is measured beside it.
// `process.cpuUsage` counts the work this process actually did, so a run descheduled by
// another tenant does not inflate it, and the ratio is the number a reader can trust.
// Both are reported; the wall-clock pair is kept because dropping it would hide the
// noise instead of explaining it.
const a: number[] = [], b: number[] = []
const aCpu: number[] = [], bCpu: number[] = []
let aMeta: any, bMeta: any
for (let i = 0; i < reps; i++) {
  const ra = timeArm(HeadAnalyzer)          // A = HEAD
  const rb = timeArm(RealObjectiveCAnalyzer) // B = working tree
  a.push(ra.ms); b.push(rb.ms)
  aCpu.push(ra.cpuMs); bCpu.push(rb.cpuMs)
  aMeta = ra; bMeta = rb
  process.stdout.write(`  rep ${i + 1}/${reps}  HEAD ${ra.ms.toFixed(0)} ms / ${ra.cpuMs.toFixed(0)} cpu   NEW ${rb.ms.toFixed(0)} ms / ${rb.cpuMs.toFixed(0)} cpu\n`)
}
const min = (xs: number[]) => Math.min(...xs)
const med = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]
console.log(`\nfiles                 ${files.length}`)
console.log(`relationships  HEAD ${String(aMeta.rels).padStart(6)}   NEW ${String(bMeta.rels).padStart(6)}   ${(((bMeta.rels - aMeta.rels) / aMeta.rels) * 100).toFixed(2)}%`)
console.log(`symbols        HEAD ${String(aMeta.symbols).padStart(6)}   NEW ${String(bMeta.symbols).padStart(6)}   ${(((bMeta.symbols - aMeta.symbols) / aMeta.symbols) * 100).toFixed(2)}%`)
console.log(`wall min       HEAD ${min(a).toFixed(0)} ms   NEW ${min(b).toFixed(0)} ms   ${(((min(b) - min(a)) / min(a)) * 100).toFixed(2)}%   <- load-sensitive, see the header`)
console.log(`wall median    HEAD ${med(a).toFixed(0)} ms   NEW ${med(b).toFixed(0)} ms   ${(((med(b) - med(a)) / med(a)) * 100).toFixed(2)}%`)
console.log(`CPU  min       HEAD ${min(aCpu).toFixed(0)} ms   NEW ${min(bCpu).toFixed(0)} ms   ${(((min(bCpu) - min(aCpu)) / min(aCpu)) * 100).toFixed(2)}%   <- the load-insensitive one`)
console.log(`CPU  median    HEAD ${med(aCpu).toFixed(0)} ms   NEW ${med(bCpu).toFixed(0)} ms   ${(((med(bCpu) - med(aCpu)) / min(aCpu)) * 100).toFixed(2)}%`)
console.log(`CPU  per-file  HEAD ${(min(aCpu) / files.length).toFixed(3)} ms   NEW ${(min(bCpu) / files.length).toFixed(3)} ms`)
console.log(`\nHEAD wall samples: ${a.map((x) => x.toFixed(0)).join(" ")}`)
console.log(`NEW  wall samples: ${b.map((x) => x.toFixed(0)).join(" ")}`)
console.log(`HEAD cpu  samples: ${aCpu.map((x) => x.toFixed(0)).join(" ")}`)
console.log(`NEW  cpu  samples: ${bCpu.map((x) => x.toFixed(0)).join(" ")}`)

// EDGE-BY-EDGE DIFF. The two counts above say how much changed; this says WHAT. A count
// that drops by 7 does not tell a reader whether 7 fabricated edges went or 7 real ones
// did, and that distinction is the whole question when a rule is narrowed. Every edge is
// keyed by (file, line, source, target) so a row that merely moved a line still shows up.
console.log(`\nEDGE DIFF (HEAD -> NEW), per relationship type`)
console.log("-".repeat(96))
const types = [...new Set([...aMeta.edges.keys(), ...bMeta.edges.keys()])].sort()
for (const t of types) {
  const A = aMeta.edges.get(t) ?? new Set<string>()
  const B = bMeta.edges.get(t) ?? new Set<string>()
  const removed = [...A].filter((x) => !B.has(x))
  const added = [...B].filter((x) => !A.has(x))
  if (!removed.length && !added.length) { console.log(`${t.padEnd(14)} unchanged (${A.size})`); continue }
  console.log(`${t.padEnd(14)} ${A.size} -> ${B.size}   removed=${removed.length} added=${added.length}`)
  for (const r of removed.slice(0, 12)) console.log(`      - ${r}`)
  if (removed.length > 12) console.log(`      … ${removed.length - 12} more removed`)
  for (const r of added.slice(0, 12)) console.log(`      + ${r}`)
  if (added.length > 12) console.log(`      … ${added.length - 12} more added`)
}
console.log("-".repeat(96))

// The mirrored HEAD module is a build artefact of this run, not a source file.
// Left behind it becomes a second copy of the analyzer that nothing indexes and
// nothing lints, which is exactly how a stale duplicate of an analyzer gets
// mistaken for the analyzer.
rmSync(TMP, { recursive: true, force: true })
console.log(`\n(removed the mirrored HEAD module at ${path.relative(ROOT, TMP)})`)