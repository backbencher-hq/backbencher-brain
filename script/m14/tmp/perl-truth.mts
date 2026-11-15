/**
 * M12 GROUND-TRUTH CHECK — does the analyzer still satisfy the PINNED perl
 * ground truth (validation/m12/ground-truth/perl.json)?
 *
 * This is the regression gate for the M14.6 perl wave: the M12 truth is a
 * `manual_audit` artifact with per-fact line numbers and is the lane's
 * oldest, hardest promise. Every fact is checked on BOTH axes:
 *   - the fact must be PRESENT in the analyzer's output (recall)
 *   - the analyzer's symbol must be on the fact's LINE (line accuracy)
 *
 * usage: bun perl-truth.mts [--verbose]
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dir, "..", "..", "..")
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-perl.wasm"))))
const { RealPerlAnalyzer } = await import(path.join(ROOT, "src/ast/real-perl-analyzer.ts"))

const truth = JSON.parse(fs.readFileSync(path.join(ROOT, "validation/m12/ground-truth/perl.json"), "utf8"))
const fixtureDir = path.join(ROOT, "validation/m12/fixtures/perl")
const verbose = process.argv.includes("--verbose")

const results: any[] = []
for (const file of fs.readdirSync(fixtureDir).sort()) {
  const src = fs.readFileSync(path.join(fixtureDir, file), "utf8")
  const res: any = new RealPerlAnalyzer().analyze(parser.parse(src).rootNode, src, file)
  results.push({ file, res })
}

let pass = 0
const failures: any[] = []
const lineMismatches: any[] = []

for (const fact of truth.facts) {
  if (fact.kind === "symbol") {
    const hit = results.find((r) => r.file === fact.file)
    if (!hit) {
      failures.push({ id: fact.id, why: `no run for ${fact.file}` })
      continue
    }
    const wantKind = fact.attributes.symbolKind
    const sym = hit.res.symbols.find((s: any) => s.name === fact.attributes.name && s.kind === wantKind)
    if (!sym) {
      failures.push({
        id: fact.id,
        why: `missing symbol ${wantKind}:${fact.attributes.name}`,
        have: hit.res.symbols.map((s: any) => `${s.kind}:${s.name}`),
      })
      continue
    }
    if (sym.range.startLine !== fact.line) {
      lineMismatches.push({ id: fact.id, expected: fact.line, got: sym.range.startLine, name: fact.attributes.name })
      failures.push({ id: fact.id, why: `line ${fact.line} != ${sym.range.startLine} for ${fact.attributes.name}` })
      continue
    }
    pass++
    if (verbose) console.log(`  PASS ${fact.id}`)
  } else if (fact.kind === "relationship") {
    const hit = results.find((r) => r.file === fact.file)
    const rel = hit?.res.relationships.find((r: any) => r.type === fact.attributes.type && r.source === fact.sourceId && r.target === fact.targetId)
    if (!rel) {
      failures.push({
        id: fact.id,
        why: `missing ${fact.attributes.type} ${fact.sourceId} -> ${fact.targetId}`,
        have: hit?.res.relationships.map((r: any) => `${r.type} ${r.source}->${r.target}`).slice(0, 20),
      })
      continue
    }
    pass++
    if (verbose) console.log(`  PASS ${fact.id}`)
  }
}

const total = truth.facts.length
console.log(JSON.stringify({
  total,
  pass,
  fail: total - pass,
  lineMismatches,
  precision: +(pass / total).toFixed(4),
  failures,
}, null, 2))
process.exit(failures.length ? 1 : 0)
