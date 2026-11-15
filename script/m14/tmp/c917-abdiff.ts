// #917 A/B classification: every symbol and edge the recovery changed, sorted
// into recovered / re-attributed / suppressed-function-local / REAL-LOSS.
//   bun script/m14/tmp/c917-abdiff.ts <corpus> <repoDir>
import { readFileSync } from "node:fs"
import path from "node:path"
import { macroWrappedHeadingShape, wrappedBodyAfter } from "../../../src/ast/real-c-analyzer"

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const corpus = process.argv[2]
const repoDir = process.argv[3]
const pre = JSON.parse(readFileSync(`/tmp/c917-ab-pre-${corpus}.json`, "utf8"))
const post = JSON.parse(readFileSync(`/tmp/c917-ab-post-${corpus}.json`, "utf8"))

// Wrapped-body line ranges, computed from the tree with the analyzer's shape rule.
function wrappedBodyRanges(src: string): Array<[number, number, string]> {
  const root = parser.parse(src).rootNode
  const out: Array<[number, number, string]> = []
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()!
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
    if (n.type !== "compound_statement") continue
    let prev = n.previousSibling
    for (let g = 0; prev && g < 2 && (prev.isMissing || prev.type === ";"); g++) prev = prev.previousSibling
    if (!prev || prev.type !== "expression_statement") continue
    const outer = prev.namedChild(0)
    const inner = outer?.childForFieldName?.("function") ?? outer?.namedChild(0)
    if (!outer || outer.type !== "call_expression" || !inner || inner.type !== "call_expression") continue
    out.push([n.startPosition.row + 1, n.endPosition.row + 1, prev.startPosition.row + 1 + ""])
  }
  return out
}

let totSymRemoved = 0, totSymAdded = 0, totEdgeRemoved = 0, totEdgeAdded = 0
const removedSymbolRows: string[] = []
const realLoss: string[] = []
const edgeLoss: string[] = []
const headingNameRows: string[] = []
const leakLocalRows: string[] = []
const edgeMoved = new Map<string, number>()
let filesChanged = 0

for (const rel of Object.keys(pre)) {
  const a = pre[rel], b = post[rel]
  if (!a || !b || a.error || b.error) continue
  const symA = new Set<string>(a.symbols), symB = new Set<string>(b.symbols)
  const relA: string[] = a.rels, relB: string[] = b.rels
  const relSetB = new Set(relB)
  const removedSyms = a.symbols.filter((s: string) => !symB.has(s))
  const addedSyms = b.symbols.filter((s: string) => !symA.has(s))
  const removedRels = relA.filter((r: string) => !relSetB.has(r))
  if (!removedSyms.length && !addedSyms.length && !removedRels.length) continue
  filesChanged++
  const src = readFileSync(path.join(repoDir, rel), "utf8")
  const ranges = wrappedBodyRanges(src)
  const inBody = (line: number) => ranges.some(([s, e]) => line >= s && line <= e)
  // #917: lines that carry a macro-wrapped heading's NAMING occurrence, via the
  // SAME exported shape rule the analyzer and the oracle share (never a
  // re-implementation).
  const headingNameLines = new Set<number>()
  {
    const root = parser.parse(src).rootNode
    const st: any[] = [root]
    while (st.length) {
      const n = st.pop()!
      if (n.type === "expression_statement") {
        const shape = macroWrappedHeadingShape(n)
        if (shape && wrappedBodyAfter(n)) headingNameLines.add(n.startPosition.row + 1)
      }
      for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
    }
  }
  totSymRemoved += removedSyms.length
  totSymAdded += addedSyms.length
  totEdgeRemoved += removedRels.length
  totEdgeAdded += b.rels.filter((r: string) => !new Set(relA).has(r)).length

  // classify removed SYMBOLS
  const prefixPost = new Set(b.symbols.map((s: string) => s.split(":")[2] ?? ""))
  for (const s of removedSyms) {
    const line = Number(s.split(":")[0])
    const name = (s.split(":")[2] ?? "").split("@")[0]
    if (inBody(line)) {
      removedSymbolRows.push(`suppressed-local  ${rel}:${line} ${s}`)
      continue
    }
    if (prefixPost.has(name)) { removedSymbolRows.push(`moved             ${rel}:${line} ${s}`); continue }
    realLoss.push(`${rel}:${line} ${s}`)
    removedSymbolRows.push(`REAL-LOSS         ${rel}:${line} ${s}`)
  }
  // classify removed RELATIONSHIPS
  const targetOf = (r: string) => {
    const m = r.match(/:(?:\w+):[^>]*->(.*?)#/)
    return m ? m[1] : r
  }
  const labelOf = (r: string) => { const m = r.match(/:\w+:(\w+):/) ?? r.match(/:(\w+):/); return m ? m[1] : "?" }
  const postByTarget = new Map<string, string[]>()
  for (const r of relB) {
    const k = labelOf(r) + "|" + targetOf(r)
    if (!postByTarget.has(k)) postByTarget.set(k, [])
    postByTarget.get(k)!.push(r)
  }
  for (const r of removedRels) {
    const k = labelOf(r) + "|" + targetOf(r)
    if ((postByTarget.get(k) ?? []).length > 0) {
      edgeMoved.set(k, (edgeMoved.get(k) ?? 0) + 1)
      continue
    }
    // #917: the heading's NAMING occurrence — the row the recovery turns from a
    // read into a definition (the analyzer declares the name there, and the F5
    // oracle now applies the same shared rule). Classified separately from a
    // loss: the removed edge and the minted symbol are the same occurrence.
    const line = Number(r.split(":")[0])
    if (headingNameLines.has(line)) {
      headingNameRows.push(`${rel}:${line} ${r}`)
      continue
    }
    // Inside a wrapped body: the read/containment half of a local that used to
    // leak to file scope (#917's other half — the body is now function-local,
    // so its enum member is not a file-scope symbol and nothing reads it there).
    if (inBody(line)) {
      leakLocalRows.push(`${rel}:${line} ${r}`)
      continue
    }
    edgeLoss.push(`${rel} ${r}`)
  }
}

console.log(`== ${corpus} ==  files changed: ${filesChanged}`)
console.log(`symbols removed=${totSymRemoved} added=${totSymAdded} | edges removed=${totEdgeRemoved} added=${totEdgeAdded}`)
console.log(`REAL-LOSS symbols: ${realLoss.length}`)
for (const r of realLoss.slice(0, 20)) console.log(`   ${r}`)
console.log(`REAL-LOSS edges: ${edgeLoss.length}`)
for (const r of edgeLoss.slice(0, 20)) console.log(`   ${r}`)
console.log(`heading-name rows (a read that became the definition it named): ${headingNameRows.length}`)
console.log(`leaked-local rows (function-local published at file scope): ${leakLocalRows.length}`)
for (const r of leakLocalRows.slice(0, 3)) console.log(`   ${r}`)
for (const r of headingNameRows.slice(0, 3)) console.log(`   ${r}`)
console.log(`re-attributed (same label+target, new source): ${[...edgeMoved.values()].reduce((a, b) => a + b, 0)} across ${edgeMoved.size} pairs`)
for (const [k, v] of [...edgeMoved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`   ${v}  ${k}`)
console.log(`removed-symbol rows (first 25):`)
for (const r of removedSymbolRows.slice(0, 25)) console.log(`   ${r}`)
