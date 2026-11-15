// CS-DEEP-21 — does the new field-access `uses` truth AGREE with the analyzer, and what is
// left over?
//
// A new truth is not correct because it compiles. This is the dry run: derive the truth for a
// corpus, compare against the analyzer's OWN `uses` edges, and print EVERY row on both sides
// that has no twin — so the remaining gap is a measured number with named shapes in it, not an
// assumption that the label "just works".
//
// It separates the two halves of the class, because they are different problems:
//   csharp_field_access  (confidence 0.7) member reads — the truth above derives these
//   identifier_usage     (confidence 1.0) bare-identifier value reads — NOT yet derived
//
// The expectation going in: the first half reconciles and the second half is the whole of the
// remainder. If the first half does NOT reconcile, the truth is wrong and the gate stays off.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

async function main() {
  const listFile = arg("--list")
  if (!listFile) { console.error("usage: cs-deep-21-uses-reconcile.ts --list <paths> [limit]"); process.exit(2) }
  const limit = Number(arg("--limit") ?? 200)
  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)

  // The truth needs a TREE, and `ASTEngine.parseFile` does not hand one back — so this
  // instrument owns a parser. (The first version of it called an async parseRoot without
  // awaiting, handed the oracle a Promise, and reported "0 truth edges / 3890 unexplained"
  // for a truth that reconciles perfectly. The lesson is the one this repo keeps restating:
  // an instrument that reports a defect has to be checked against a control before its
  // number is believed.)
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new P()
  parser.setLanguage(grammar)
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const mod: any = await import(path.join(ROOT, "script/m14/differential.ts"))
  const derive = mod.deriveCSharpFieldAccessUses
  if (typeof derive !== "function") { console.error("deriveCSharpFieldAccessUses is not exported"); process.exit(3) }

  let fieldAccessTruth = 0
  let fieldAccessAnalyzer = 0
  let bareTruth = 0
  let bareAnalyzer = 0
  let faOnlyTruth = 0
  let faOnlyAnalyzer = 0
  const faOnlyTruthRows: string[] = []
  const faOnlyAnalyzerRows: string[] = []
  const bareSample: string[] = []
  const filesWithMismatch = new Set<string>()

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    let res: any
    try { res = await ASTEngine.parseFile(f, src) } catch { continue }
    const truth = derive(parser.parse(src).rootNode)
    const truthSet = new Set(truth.map((t: any) => `${t.from}|${t.target}`))
    const uses = (res.relationships ?? []).filter((r: any) => (r.type ?? r.relationshipType) === "uses")
    const faSet = new Set<string>()
    const bareSet = new Set<string>()
    for (const r of uses) {
      const k = `${r.source}|${r.target}`
      if (String((r.metadata ?? {}).relationshipType) === "identifier_usage") bareSet.add(k)
      else { faSet.add(k); fieldAccessAnalyzer++ }
    }
    fieldAccessTruth += truth.length
    bareAnalyzer += bareSet.size
    for (const k of faSet) if (!truthSet.has(k)) { faOnlyAnalyzer++; if (faOnlyAnalyzerRows.length < 15) faOnlyAnalyzerRows.push(`${path.basename(f)}  ANALYZER-only  ${k.replace("|", " -> ")}`) }
    for (const t of truth) {
      const k = `${t.from}|${t.target}`
      if (!faSet.has(k)) { faOnlyTruth++; if (faOnlyTruthRows.length < 15) faOnlyTruthRows.push(`${path.basename(f)}  TRUTH-only    ${k.replace("|", " -> ")}`) }
    }
    for (const k of bareSet) { bareTruth++; if (bareSample.length < 12) bareSample.push(`${path.basename(f)}  ${k.replace("|", " -> ")}`) }
    if (faOnlyTruth || faOnlyAnalyzer) filesWithMismatch.add(f)
  }

  console.log(`files: ${files.length}   files with a field-access mismatch: ${filesWithMismatch.size}`)
  console.log(`\nfield-access half (confidence 0.7, marker csharp_field_access):`)
  console.log(`   truth edges:    ${fieldAccessTruth}`)
  console.log(`   analyzer edges: ${fieldAccessAnalyzer}`)
  console.log(`   TRUTH-only  (truth derives, analyzer does not emit): ${faOnlyTruth}`)
  console.log(`   ANALYZER-only (analyzer emits, truth does not derive): ${faOnlyAnalyzer}`)
  if (faOnlyTruthRows.length) { console.log(`   truth-only rows:`); for (const r of faOnlyTruthRows) console.log(`      ${r}`) }
  if (faOnlyAnalyzerRows.length) { console.log(`   analyzer-only rows:`); for (const r of faOnlyAnalyzerRows) console.log(`      ${r}`) }

  console.log(`\nbare-identifier half (confidence 1.0, marker identifier_usage) — NOT yet derived:`)
  console.log(`   analyzer edges: ${bareAnalyzer}  (sample)`)
  for (const r of bareSample) console.log(`      ${r}`)
  console.log(`\nVERDICT: field-access half is ${faOnlyTruth === 0 && faOnlyAnalyzer === 0 ? "RECONCILED — the label can join the compared set" : "NOT reconciled — investigate before wiring"}`)
}

if (import.meta.main) await main()
