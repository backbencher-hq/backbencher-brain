/**
 * Per-case grammar conformance runner.
 *
 * A case PASSES only when its tree carries zero ERROR and zero MISSING nodes.
 * That is the grammar's own contract, so the runner needs no per-case oracle:
 * a language-dominant .vb file that parses without ERROR is what the analyzer
 * gets to work with, and a case that does not is a named, re-runnable defect.
 *
 * `--tree <file>` dumps the tree instead of scoring, for reading a shape.
 */
import { readFileSync, existsSync } from "node:fs"
const REPO = process.env.BB_REPO ?? "/home/ishaq2321/backbencher-brain"
const { Parser, Language } = await import(`${REPO}/node_modules/web-tree-sitter/tree-sitter.js`)
import { readVbSource } from "./vb-source"

const CORE_WASM = process.env.BB_CORE_WASM ?? `${REPO}/wasm/tree-sitter.wasm`
const GRAMMAR_WASM = process.env.VB_WASM ?? `${REPO}/wasm/tree-sitter-vbnet.wasm`

function badNodes(tree: any): any[] {
  const out: any[] = []
  const rec = (node: any): boolean => {
    if (node.type === "ERROR" || node.type === "_ERROR" || node.isMissing) { out.push(node); return true }
    for (let i = 0; i < node.namedChildCount; i++) rec(node.namedChild(i))
    return false
  }
  rec(tree.rootNode)
  return out
}

function sexp(node: any, depth = 0, maxDepth = 4): string {
  if (depth > maxDepth) return "..."
  const parts: string[] = []
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (!c.isNamed) continue
    const label = node.fieldNameForChild(i)
    parts.push(`${label ? label + ": " : ""}(${c.type} ${sexp(c, depth + 1, maxDepth)})`)
  }
  return parts.join(" ")
}

await Parser.init({ locateFile: () => CORE_WASM, wasmBinary: readFileSync(CORE_WASM) })
const lang = await Language.load(GRAMMAR_WASM)
const parser = new Parser()
parser.setLanguage(lang)

const files = process.argv.slice(2)
let pass = 0, fail = 0
const failures: string[] = []

for (const f of files) {
  if (!existsSync(f)) { console.log(`  ?? missing ${f}`); fail++; failures.push(f); continue }
  const src = readVbSource(f).text
  const tree = parser.parse(src)
  const bad = badNodes(tree)
  const name = f.split("/").pop()!
  if (bad.length === 0) {
    pass++
    const lines = src.split(/\r?\n/)
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    failures.push(name)
    const first = bad[0]
    const row = first.startPosition.row + 1
    const text = (src.split(/\r?\n/)[row - 1] ?? "").trim()
    console.log(`  FAIL  ${name}  (${bad.length} topmost bad node${bad.length === 1 ? "" : "s"})`)
    console.log(`          first @ line ${row}: ${text.slice(0, 100)}`)
    console.log(`          span ${first.startIndex}..${first.endIndex}  type ${first.type}`)
    if (process.argv.includes("--tree")) console.log(`          ${sexp(tree.rootNode, 0, 3).slice(0, 400)}`)
  }
  tree.delete()
}
parser.delete()

console.log("")
console.log(`cases: ${pass} pass / ${fail} fail  (of ${files.length})`)
if (failures.length) console.log(`failing: ${failures.join(" ")}`)
process.exit(fail > 0 ? 1 : 0)
