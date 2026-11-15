// CS-DEEP-27 — the LAST slice: does the bare-identifier `uses` truth agree with the analyzer?
//
// This is the dry run for `deriveCSharpBareUses` (cs-deep-26). It is the same shape as
// cs-deep-21, and it is the last class in the lane with no second answer: 617 rows / 2.4% of
// output, marker `identifier_usage`, confidence 1.0.
//
// The two halves of the report are DIFFERENT KINDS OF FINDING and must not be conflated:
//
//   TRUTH-only    the tree really does have a bare read the analyzer failed to emit -> a real
//                 defect, and a MISSING-counted one. Every row is a hole in the graph.
//   ANALYZER-only the analyzer emitted a read the tree does not support -> either a spurious
//                 edge, or a place the truth's re-implementation of a gate is too coarse.
//                 This direction is the one that is allowed to cost me work on the TRUTH, and
//                 the direction that CANNOT be waved away: a fabricated edge is a wrong fact
//                 about the code, published at confidence 1.0.
//
// Agreement is therefore the only outcome that lets the label join the compared set. Anything
// else keeps the exclusion and gets adjudicated row by row, which is the expensive path and the
// point of the exercise.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

async function main() {
  const listFile = arg("--list")
  if (!listFile) { console.error("usage: cs-deep-27-bare-uses-reconcile.ts --list <paths> [--limit N]"); process.exit(2) }
  const limit = Number(arg("--limit") ?? 200)
  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)

  // The truth needs a TREE, and `ASTEngine.parseFile` does not hand one back -- so this
  // instrument owns a parser. (cs-deep-21's own note records the cost of getting that wrong:
  // an un-awaited parseRoot handed the oracle a Promise and produced "0 truth edges, 3890
  // unexplained" for a truth that reconciles perfectly. An instrument that reports a defect is
  // not believed until it has been checked against a control.)
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new P()
  parser.setLanguage(grammar)
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const mod: any = await import(path.join(ROOT, "script/m14/tmp/cs-deep-26-bare-uses-truth.ts"))
  const derive = mod.deriveCSharpBareUses
  if (typeof derive !== "function") { console.error("deriveCSharpBareUses is not exported"); process.exit(3) }

  let truthTotal = 0
  let analyzerTotal = 0
  let truthOnly = 0
  let analyzerOnly = 0
  let both = 0
  let parseFailures = 0
  const truthOnlyRows: string[] = []
  const analyzerOnlyRows: string[] = []
  const badFiles = new Set<string>()

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    let res: any
    let root: any
    try {
      res = await ASTEngine.parseFile(f, src)
      root = parser.parse(src).rootNode
    } catch { parseFailures++; continue }
    if (!root) { parseFailures++; continue }

    const truth = derive(root, res.symbols ?? [])
    const truthSet = new Set(truth.map((t: any) => `${t.from}|${t.target}`))
    const analyzerSet = new Set<string>()
    for (const r of res.relationships ?? []) {
      if ((r.type ?? r.relationshipType) !== "uses") continue
      if (String((r.metadata ?? {}).relationshipType) === "identifier_usage") analyzerSet.add(`${r.source}|${r.target}`)
    }

    truthTotal += truth.length
    analyzerTotal += analyzerSet.size
    let fileDirty = false
    for (const k of analyzerSet) {
      if (!truthSet.has(k)) {
        analyzerOnly++
        fileDirty = true
        if (analyzerOnlyRows.length < 60) analyzerOnlyRows.push(`${path.basename(f)}\n      ANALYZER-only  ${k.replace("|", " -> ")}`)
      } else both++
    }
    for (const t of truth) {
      const k = `${t.from}|${t.target}`
      if (!analyzerSet.has(k)) {
        truthOnly++
        fileDirty = true
        if (truthOnlyRows.length < 60) truthOnlyRows.push(`${path.basename(f)}\n      TRUTH-only    ${k.replace("|", " -> ")}`)
      }
    }
    if (fileDirty) badFiles.add(path.basename(f))
  }

  console.log(`files: ${files.length}   parsed: ${files.length - parseFailures}   parse failures skipped: ${parseFailures}`)
  console.log(`\nbare-identifier \`uses\` (confidence 1.0, marker identifier_usage)`)
  console.log(`   truth edges:             ${truthTotal}`)
  console.log(`   analyzer edges:          ${analyzerTotal}`)
  console.log(`   agreed (both sides):     ${both}`)
  console.log(`   TRUTH-only   (analyzer dropped a real read):  ${truthOnly}`)
  console.log(`   ANALYZER-only (analyzer emitted an unsupported read): ${analyzerOnly}`)
  console.log(`   files with a disagreement: ${badFiles.size}`)
  if (truthOnlyRows.length) { console.log(`\n   --- TRUTH-only (defects in the analyzer) ---`); for (const r of truthOnlyRows) console.log(`      ${r}`) }
  if (analyzerOnlyRows.length) { console.log(`\n   --- ANALYZER-only (spurious edge, or a truth gate too coarse) ---`); for (const r of analyzerOnlyRows) console.log(`      ${r}`) }
  const ok = truthOnly === 0 && analyzerOnly === 0
  console.log(`\nVERDICT: ${ok ? "RECONCILED -- the label can join the compared set" : "NOT reconciled -- adjudicate before wiring"}`)
  if (!ok) {
    console.log(`\n   ratio: ${(analyzerTotal / Math.max(1, truthTotal)).toFixed(3)} analyzer/truth. Far above 1.0 means the`)
    console.log(`   analyzer is publishing reads that are not in the tree; far below 1.0 means it is`)
    console.log(`   dropping them. Neither is a statement about the code -- both are statements about a gap.`)
  }
}

if (import.meta.main) await main()
