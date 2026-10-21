/**
 * PERL CALLS SHAPE — the analyzer's `calls` rows beside the oracle's, on named files.
 *
 * The lane's truth runner leaves 72 MISSING and 24 UNEXPLAINED `calls` rows over the
 * population, and the samples say the disagreement is a SHAPE disagreement: the analyzer
 * files a method call as `calls|<receiver class>|<method>` (`calls|Foo|foreach`) while the
 * oracle files it as `calls|<enclosing scope>|<method>` (`calls|global|foreach`).
 *
 * This probe prints both sides' rows for the named files, with the source line each
 * comes from, so the disagreement is CHARACTERISED rather than inferred — the lane's rule
 * is that a number has a source attached to it, and a shape is a number with a source.
 *
 * Usage: bun script/m14/perl-calls-shape.mts <file> [...]
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const files = process.argv.slice(2)
if (files.length === 0) { console.error("usage: bun script/m14/perl-calls-shape.mts <file> [...]"); process.exit(2) }

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const grammar: any = await Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-perl.wasm")))
const parser = new ParserClass()
parser.setLanguage(grammar)

const { derivePerlTruth } = await import(path.join(ROOT, "script/m14/perl-truth.ts"))
const { derivePerlEdges } = await import(path.join(ROOT, "script/m14/differential.ts"))
const { RealPerlAnalyzer } = await import(path.join(ROOT, "src/ast/real-perl-analyzer.ts"))

for (const f of files) {
  const abs = path.isAbsolute(f) ? f : path.join(ROOT, f)
  const src = readFileSync(abs, "utf8")
  const tree = parser.parse(src)
  const res: any = new RealPerlAnalyzer().analyze(tree.rootNode, src, abs)
  const analyzer = new Set<string>()
  for (const r of res.relationships ?? []) {
    if (String(r.type ?? "") !== "calls") continue
    analyzer.add(`${r.source ?? ""}|${r.target ?? ""}`)
  }
  const lane = new Set<string>()
  for (const t of derivePerlTruth(tree.rootNode) as any[]) {
    if (t.label !== "calls") continue
    lane.add(`${t.from ?? ""}|${t.target}`)
  }
  const diff = new Set<string>()
  for (const t of derivePerlEdges(tree.rootNode) as any[]) {
    if (t.label !== "calls") continue
    diff.add(`${t.from ?? ""}|${t.target}`)
  }
  const lines = src.split("\n")
  const show = (k: string) => {
    const m = k.split("|")
    const needle = m[m.length - 1]
    const line = lines.find((l) => new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(l))?.trim().slice(0, 90) ?? ""
    return `${k}   <-- ${line}`
  }
  console.log(`\n=== ${path.relative(ROOT, abs)}   analyzer ${analyzer.size} · lane ${lane.size} · differential ${diff.size}`)
  const oa = [...analyzer].filter((k) => !lane.has(k))
  console.log(`  ANALYZER ONLY (${oa.length}):`); for (const k of oa.slice(0, 10)) console.log(`    ${show(k)}`)
  const ol = [...lane].filter((k) => !analyzer.has(k))
  console.log(`  LANE ORACLE ONLY (${ol.length}):`); for (const k of ol.slice(0, 10)) console.log(`    ${show(k)}`)
  const od = [...diff].filter((k) => !analyzer.has(k))
  console.log(`  DIFFERENTIAL ORACLE ONLY (${od.length}):`); for (const k of od.slice(0, 6)) console.log(`    ${show(k)}`)
}
