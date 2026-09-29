/**
 * Adversarial probe of the powershell F9 completeness spec's internal_silent bucket.
 *
 * The spec asserts, for the 86 internal_silent node types:
 *
 *   "(1) THE EXPRESSION LADDER ... Verified by probe: a file of pure arithmetic
 *    publishes no edges and no symbols."
 *
 * That is the load-bearing sentence for the largest bucket in the lane (86 of 152
 * named types, 56%). This probe tries to FALSIFY it rather than re-assert it, and
 * it is written to be able to report a contradiction as a finding rather than as a
 * pass -- if the claim is stale, the loudest possible output is the right output.
 *
 * The suspicion being tested: the lane's later waves made the analyzer emit `uses`
 * edges for variable READS (command-argument reads, increment/decrement operands,
 * compound-assignment RHS, here-string interpolation). A file of pure arithmetic is
 * full of variable reads. If the probe was written before those waves, "publishes no
 * edges" and "publishes read edges" are both true and the sentence is describing a
 * behaviour the analyzer no longer has.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { RealPowershellAnalyzer } from "../../src/ast/real-powershell-analyzer"

const ROOT = process.cwd()
const TMP = path.join(ROOT, "script/m14/tmp/silent-probe")
mkdirSync(TMP, { recursive: true })

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-powershell.wasm"))))

type Case = { id: string; why: string; source: string }
const CASES: Case[] = [
  {
    id: "pure-arith-no-vars",
    why: "the spec's own probe: literals only, so NO variable read exists and 'no edges' is the right answer",
    source: "$a = 1 + 2\n$b = 3 * 4\n$c = 5 - 6\n$d = 7 / 8\n",
  },
  {
    id: "pure-arith-with-reads",
    why: "same expression ladder, but the operands are VARIABLE reads. The ladder is still a ladder; the READS are not.",
    source: "$p = 10\n$q = 20\n$r = $p + $q\n$s = $p - $q\n$t = $p * $q\n",
  },
  {
    id: "comparison-and-logical",
    why: "the other silent families: comparison_expression, logical_expression, bitwise_expression",
    source: "$m = 1\n$n = 2\n$o = $m -lt $n\n$p = $m -and $n\n$q = $m -band $n\n",
  },
  {
    id: "compound-assign-reads",
    why: "compound assignment reads its target. If the target read is published, a '+=' line is not silent.",
    source: "$acc = 1\n$acc += 2\n$acc *= 3\n",
  },
  {
    id: "range-expression",
    why: "range_expression is in the silent list, but 1..3 enumerates values",
    source: "$xs = 1..3\nforeach ($x in $xs) { $x }\n",
  },
  {
    id: "format-expression",
    why: "format_expression is in the silent list; -f takes a format and arguments",
    source: "$v = 42\n$s = '{0}' -f $v\n",
  },
]

const out: any[] = []
for (const c of CASES) {
  const f = path.join(TMP, `${c.id}.ps1`)
  writeFileSync(f, c.source)
  const content = readFileSync(f, "utf8")
  const tree = parser.parse(content)
  const analyzer = new RealPowershellAnalyzer()
  const r: any = analyzer.analyze(tree.rootNode, content, c.id)
  const syms = r.symbols ?? []
  const rels = r.relationships ?? []
  out.push({
    id: c.id,
    why: c.why,
    source: c.source.replace(/\n/g, " ; "),
    symbols: syms.map((s: any) => `${s.kind}:${s.name}`),
    relationships: rels.map((x: any) => `${(x.kind ?? x.type)}:${x.source ?? x.from}->${x.target ?? x.to}@${x.line_number}`),
    symbolCount: syms.length,
    relationshipCount: rels.length,
    usesEdges: rels.filter((x: any) => (x.kind ?? x.type) === "uses").length,
  })
}

const report = {
  instrument: "powershell-silent-bucket-probe",
  question:
    "Does the F9 spec's internal_silent claim still hold? Specifically: 'a file of pure arithmetic publishes no edges and no symbols'.",
  verdict: "SEE per-case detail; the claim is about the EXPRESSION LADDER being silent, and a ladder that carries VARIABLE READS is not silent",
  cases: out,
}
const dest = path.join(ROOT, "validation/m60/results/powershell-silent-bucket-probe.json")
mkdirSync(path.dirname(dest), { recursive: true })
writeFileSync(dest, JSON.stringify(report, null, 2) + "\n")

for (const c of out) {
  console.log(`\n${c.id}  syms=${c.symbolCount} rels=${c.relationshipCount} uses=${c.usesEdges}`)
  console.log(`  src: ${c.source}`)
  for (const s of c.symbols) console.log(`    sym  ${s}`)
  for (const x of c.relationships) console.log(`    rel  ${x}`)
}
console.log(`\nwrote ${path.relative(ROOT, dest)}`)
