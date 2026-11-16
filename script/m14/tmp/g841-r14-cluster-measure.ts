// Round 14, step 2: measure the ANALYZER-level loss on the REAL cluster files.
//
// The minimal-shape probe showed no delta (both readings extract identically),
// so the loss must live where the misparse collides with surrounding code into
// ERROR. This walks the census∩oracle-accepted files, finds those whose tree
// contains the misparse shape (juxt_function_call whose name is a bare type-like
// identifier and whose argument list is bare identifiers, directly preceding a
// lambda_expression), and reports what extraction does there.
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CORPUS = "<corpus-root>/bb_tests/repositories/grails-core"

const census = JSON.parse(readFileSync(path.join(ROOT, "validation/m12/results/groovy-corpus-errors.json"), "utf8"))
const oracle = JSON.parse(readFileSync(path.join(ROOT, "validation/m59/results/g841-groovy-oracle.json"), "utf8"))
const accepted = new Set<string>(oracle.acceptedFiles)
const gapFiles = census.errorFileList.filter((e: any) => accepted.has(e.file))
console.log(`census ${census.errorFileList.length} ∩ accepted ${accepted.size} = ${gapFiles.length} genuine gaps`)

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { RealGroovyAnalyzer } = await import(path.join(ROOT, "src/ast/real-groovy-analyzer.ts"))
const parser = await ASTEngine.getParser("groovy" as any)

// tree shape detector (corrected twice):
//   v1 bug: skipped error trees entirely (real misparses collide into ERROR)
//   v2 bug: matched only on `args` text — but round 13's dump shows the TYPE lands
//      in the `name` field: juxt_function_call(name: File, args: (f)) + lambda.
// Correct shape: juxt_function_call whose name is type-cased, whose args are bare
// identifiers (comma-separated names only), with a lambda_expression adjacent.
function findMisparse(node: any): any | null {
  const kids = node.children ?? []
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i]
    if (k.type === "juxt_function_call") {
      const nameNode = k.childForFieldName?.("name")
      const argNode = k.childForFieldName?.("args")
      const nameText = (nameNode?.text ?? "").trim()
      const argText = (argNode?.text ?? "").trim()
      const nameIsTypeCased = /^[A-Z][A-Za-z0-9_]*(\.[A-Z][A-Za-z0-9_]*)*$/.test(nameText)
      const argsAreBareNames = argText === "" || /^[A-Za-z_][A-Za-z0-9_]*(\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*$/.test(argText)
      const next = kids[i + 1]
      if (nameIsTypeCased && argsAreBareNames && next && next.type === "lambda_expression") {
        return { juxt: k, lambda: next, parent: node }
      }
    }
    const deep = findMisparse(k)
    if (deep) return deep
  }
  return null
}

let withShape = 0
const samples: Array<{ file: string; before: any }> = []
let totalJuxt = 0
for (const e of gapFiles) {
  const full = path.join(CORPUS, e.file)
  let src: string
  try { src = readFileSync(full, "utf8") } catch { continue }
  const t = parser.parse(src)
  const hit = findMisparse(t.rootNode)
  if (!hit) continue
  withShape++
  totalJuxt++
  if (samples.length < 8) {
    const a = new RealGroovyAnalyzer()
    const res = await (a as any).analyze(t.rootNode, src, e.file)
    const params = (res.symbols ?? []).filter((s: any) => s.kind === "parameter" || s.kind === "param")
    const badCalls = (res.relationships ?? []).filter((r: any) => {
      const tgt = typeof r.target === "object" ? r.target?.name : r.target
      return /^[A-Z]/.test(String(tgt))
    })
    samples.push({ file: e.file, symbols: res.symbols?.length, rels: res.relationships?.length, params: params.length, typeCasedCallTargets: badCalls.length, hasError: t.rootNode.hasError, errNodes: e.nodes })
  }
}
console.log(`\nerror-tree files containing the juxt+lambda misparse shape: ${withShape} / ${gapFiles.length}`)
for (const s of samples)
  console.log(`  ${s.file}\n    symbols=${s.symbols} rels=${s.rels} params=${s.params} TypeCasedCallTargets=${s.typeCasedCallTargets} errNodes=${s.errNodes}`)
