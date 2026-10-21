/**
 * PERL CONTAINS SHAPE — one file, both oracles, the analyzer's rows beside the oracle's.
 *
 * ## WHY THIS FILE EXISTS
 *
 * The lane's own truth runner says the `contains` comparison is 2,033 analyzer edges against
 * 1,742 oracle rows, with 279 of the analyzer's rows unexplained. The parity probe says the
 * 279 split as 236 "member-like" names and 43 ALL-CAPS names, and the samples name
 * `has reactor => sub {…}` (mojo/lib/Mojo/IOLoop.pm:19) and `has description => 'No
 * description'` (mojo/lib/Mojolicious/Command.pm:11) — which LOOK like the two rules the
 * oracle is missing (the UNQUOTED `has` form, and `use constant`).
 *
 * **BUT A LOOKING LIKE IS NOT A MEASUREMENT ✓✓, and this lane's whole discipline is that a
 * number has a population and a source attached to it.** So: one file, the analyzer's
 * `contains` rows, the lane oracle's `contains` rows, the differential oracle's `contains`
 * rows, and the EXACT set difference — with the source line each difference comes from.
 *
 * ## WHAT IT DOES NOT DO
 *
 * It does not fix anything and it does not change any instrument. It answers ONE question:
 * **which rows does the analyzer publish that the oracle does not, and what is written in the
 * source at those places ✓✓.** The answer decides the edit; this file only supplies it.
 *
 * Usage:
 *   bun script/m14/perl-contains-shape.mts <file> [<file> ...]
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const files = process.argv.slice(2)
if (files.length === 0) {
  console.error("usage: bun script/m14/perl-contains-shape.mts <file> [...]")
  process.exit(2)
}

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
    if (String(r.type ?? "") !== "contains") continue
    analyzer.add(`${r.source ?? ""}|${r.target ?? ""}`)
  }
  const lane = new Set<string>()
  for (const t of derivePerlTruth(tree.rootNode) as any[]) {
    if (t.label !== "contains") continue
    lane.add(`${t.from ?? ""}|${t.target}`)
  }
  const diff = new Set<string>()
  for (const t of derivePerlEdges(tree.rootNode) as any[]) {
    if (t.label !== "contains") continue
    diff.add(`${t.from ?? ""}|${t.target}`)
  }

  // THE PARSE SHAPE of every `has`/`use constant` statement — because the oracle's
  // branch is keyed on a NODE TYPE, and the node type of the UNQUOTED form is the
  // whole question (script/m14/perl-oracle-parity.mts found 236 `contains` rows the
  // analyzer derives and this oracle did not, and the samples are all `has`).
  const shapes: string[] = []
  const walk = (n: any): void => {
    const t = String(n.text ?? "").split("\n")[0].trim()
    if (/^(has|use\s+constant)\b/.test(t)) {
      const kids: string[] = []
      for (let i = 0; i < (n.childCount ?? 0); i++) {
        const c = n.child(i)
        kids.push(`${c.type}${n.fieldNameForChild(i) ? `(${n.fieldNameForChild(i)})` : ""}`)
      }
      shapes.push(`    ${n.type}  <<${t.slice(0, 40)}>>  children: ${kids.join(" ")}`)
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  walk(tree.rootNode)
  console.log(`\n=== ${path.relative(ROOT, abs)}`)
  console.log("  THE PARSE SHAPE OF EVERY `has` / `use constant`:")
  for (const sh of shapes.slice(0, 8)) console.log(sh)
  console.log(`  analyzer ${analyzer.size} · lane oracle ${lane.size} · differential oracle ${diff.size}`)
  const onlyAnalyzer = [...analyzer].filter((k) => !lane.has(k))
  console.log(`  IN THE ANALYZER, NOT IN THE LANE ORACLE (${onlyAnalyzer.length}):`)
  for (const k of onlyAnalyzer.slice(0, 14)) {
    const member = k.split("|")[1] ?? ""
    // The SOURCE line: find the member name in the file, and show that line.
    const re = new RegExp(`\\b${member.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
    const line = src.split("\n").find((l) => re.test(l))?.trim().slice(0, 110) ?? "(not found)"
    console.log(`    ${k}   <-- ${line}`)
  }
  const onlyLane = [...lane].filter((k) => !analyzer.has(k))
  console.log(`  IN THE LANE ORACLE, NOT IN THE ANALYZER (${onlyLane.length}):`)
  for (const k of onlyLane.slice(0, 8)) console.log(`    ${k}`)
  const onlyDiff = [...diff].filter((k) => !analyzer.has(k))
  console.log(`  IN THE DIFFERENTIAL ORACLE, NOT IN THE ANALYZER (${onlyDiff.length}):`)
  for (const k of onlyDiff.slice(0, 8)) console.log(`    ${k}`)
  const diffNotLane = [...diff].filter((k) => !lane.has(k))
  console.log(`  IN THE DIFFERENTIAL ORACLE, NOT IN THE LANE ORACLE (${diffNotLane.length}):`)
  for (const k of diffNotLane.slice(0, 8)) console.log(`    ${k}`)
}
