/**
 * script/m60/objc-production-loss-probe.ts — WHAT `parseFile` DISCARDS, AND WHY.
 *
 * WHY THIS FILE EXISTS. Every other objective-C instrument in this lane reads the
 * production entry (`parseFile`), so its counts are the counts a consumer gets. That is
 * the right instrument for a question about the GRAPH, and the wrong one for a question
 * about the ANALYZER: `pool-worker.ts` applies `filterNoiseRelationships` and `keepSymbol`
 * on the way out, so a defect introduced by either is invisible in a census and visible
 * only when the analyzer class is read directly and compared with the production result
 * over the same trees.
 *
 * The first such comparison was a single file:
 *
 *     AFNetworking/Tests/Tests/AFCompoundResponseSerializerTests.m
 *       analyzer class emits 5 `overrides` rows; `parseFile` delivers 3.
 *       the two lost rows are `…Tests.setUp -> AFTestCase.setUp` and `…tearDown -> …`
 *
 * `NOISE_TARGETS` in `src/ast/pool-worker.ts` blocks the leaf `setUp`/`tearDown` — a test
 * lifecycle hook — and its escape hatch is `declaredNames.has(r.target)`, i.e. the FULL
 * target string. The analyzer publishes the QUALIFIED target `AFTestCase.setUp`, the
 * declared name in the file is `setUp`, and the escape misses. So a legitimate
 * `overrides` edge is deleted on the way to the index for every Objective-C test class.
 *
 * `pool-worker.ts` is MASTER's file under the workstream ownership table, so this lane
 * measures the cost and reports it rather than changing the filter. The measurement is the
 * deliverable: an unmeasured report of "the filter drops something" is an opinion, and
 * this workstream has already been burned by one of those.
 *
 * INSTRUMENT. Analyzer-class output and production output over the SAME parse trees, one
 * pass, no sampling. Rows are keyed (type, source, target, line) so a row that merely moved
 * a line still shows as a loss.
 *
 * READ-ONLY. Writes nothing.
 *
 * Usage: bun run script/m60/objc-production-loss-probe.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { RealObjectiveCAnalyzer } from "../../src/ast/real-objective-c-analyzer"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories/objc"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

const files: { label: string; abs: string; dir: string; text: string }[] = []
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
    files.push({ label: `${e}/${rel}`, abs, dir, text })
  }
}

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-objc.wasm"))))

const key = (t: string, s: string, g: string, ln: unknown): string => `${t}|${s}->${g}@${ln ?? 0}`
const classRows = new Map<string, number>()
const classSamp = new Map<string, string[]>()
const prodRows = new Map<string, number>()
const lost = new Map<string, { n: number; samples: string[] }>()

let idx = 0
await Promise.all(Array.from({ length: 6 }, async () => {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const tree = parser.parse(f.text)
    let cls: any = null
    if (tree) {
      cls = (new RealObjectiveCAnalyzer() as any).analyze(tree.rootNode, f.text, f.abs)
      tree.delete?.()
    }
    let prod: any = null
    try { prod = await parseFile(f.abs, f.dir) } catch { continue }
    const prodKeys = new Set<string>()
    for (const x of prod.relationships ?? []) {
      const t = String(x.type ?? "")
      if (!ALL_TYPES.includes(t)) continue
      const k = key(t, String(x.source), String(x.target), x.line_number)
      prodKeys.add(k)
      prodRows.set(t, (prodRows.get(t) ?? 0) + 1)
    }
    for (const x of cls?.relationships ?? []) {
      const t = String(x.type ?? "")
      if (!ALL_TYPES.includes(t)) continue
      const k = key(t, String(x.source), String(x.target), x.line_number)
      classRows.set(t, (classRows.get(t) ?? 0) + 1)
      const sa = classSamp.get(t) ?? []
      if (sa.length < 3) sa.push(`${f.label} ${x.source} -> ${x.target}`)
      classSamp.set(t, sa)
      if (!prodKeys.has(k)) {
        const e = lost.get(k) ?? { n: 0, samples: [] }
        e.n++
        if (e.samples.length < 3) e.samples.push(`${f.label}:${x.line_number ?? 0} ${x.type} ${x.source} -> ${x.target}`)
        lost.set(k, e)
      }
    }
  }
}))

console.log(`OBJECTIVE_C production-loss probe`)
console.log(`  corpus ${CR}: ${files.length} admitted files, analyzer class vs parseFile over the SAME trees\n`)
console.log(`${"type".padEnd(13)} ${"analyzer".padStart(9)} ${"production".padStart(11)}   ${"lost".padStart(5)}`)
console.log("-".repeat(70))
let totalLost = 0
for (const t of ALL_TYPES) {
  const c = classRows.get(t) ?? 0
  const p = prodRows.get(t) ?? 0
  const d = c - p
  totalLost += Math.max(0, d)
  console.log(`${t.padEnd(13)} ${String(c).padStart(9)} ${String(p).padStart(11)}   ${String(d).padStart(5)}`)
}
console.log("-".repeat(70))
console.log(`total analyzer rows dropped by the production entry: ${totalLost}\n`)
console.log(`distinct (type,source,target,line) rows lost, by loss shape:`)
const byShape = new Map<string, number>()
for (const [k, v] of lost) {
  const leaf = k.split("->")[1]!.split("@")[0]!.split(".").pop() ?? ""
  const shape = `${k.split("|")[0]} target-leaf "${leaf}"`
  byShape.set(shape, (byShape.get(shape) ?? 0) + v.n)
}
for (const [k, v] of [...byShape].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)
console.log(`\nsamples:`)
let shown = 0
for (const [k, v] of lost) {
  if (shown++ >= 15) break
  console.log(`  ${v.n}x ${k.split("|")[0]}  ${v.samples[0]}`)
}