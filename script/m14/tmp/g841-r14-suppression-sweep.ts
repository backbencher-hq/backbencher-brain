// #841 round 14: corpus-wide suppression audit.
// Every `calls` edge in the BASE dump whose target is type-cased and which is
// ABSENT from the after dump must be explained by the typed-closure misparse
// shape at its line (juxt_function_call(name: TypeHead, args: identifiers) with
// an adjacent lambda_expression sibling). Anything unexplained is a genuine
// loss and fails the round.
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CORPUS = "<corpus-root>/bb_tests/repositories"

const base: Record<string, { symbols: string[]; rels: string[] }> = JSON.parse(readFileSync("/tmp/g841-r14-base.json", "utf8"))
const after: Record<string, { symbols: string[]; rels: string[] }> = JSON.parse(readFileSync("/tmp/g841-r14-after.json", "utf8"))

// collect base type-cased calls edges absent from after
const missing: Array<{ file: string; key: string; line: number; target: string }> = []
for (const k of Object.keys(base)) {
  const a = after[k]
  if (!a) continue
  const aSet = new Set(a.rels)
  for (const r of base[k].rels) {
    if (!r.startsWith("R|calls|")) continue
    const p = r.split("|")
    const target = p[3]
    const line = Number(p[4])
    if (!/^[A-Z]/.test(target)) continue
    if (aSet.has(r)) continue
    missing.push({ file: k, key: r, line, target })
  }
}
console.log(`type-cased calls edges in base absent from after: ${missing.length}`)

// group by file, parse once, evaluate the guard's shape at the line
const byFile = new Map<string, typeof missing>()
for (const m of missing) {
  const arr = byFile.get(m.file) ?? []
  arr.push(m)
  byFile.set(m.file, arr)
}

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { RealGroovyAnalyzer } = await import(path.join(ROOT, "src/ast/real-groovy-analyzer.ts"))
const parser = await ASTEngine.getParser("groovy" as any)
const analyzer = new RealGroovyAnalyzer()

let explained = 0
let movedCount = 0
const unexplained: string[] = []

for (const [file, items] of byFile) {
  const rel = file.split("|").slice(1).join("|")
  const fsPath = path.join(CORPUS, rel)
  let src: string
  try { src = readFileSync(fsPath, "utf8") } catch { unexplained.push(`UNREADABLE ${file}`); continue }
  const tree = parser.parse(src)
  // gather all misparse sites by line using the analyzer's own predicate
  const sites = new Map<number, string>()
  const walk = (node: any) => {
    if (node.type === "juxt_function_call") {
      const nameNode = node.childForFieldName("name")
      if (nameNode && (analyzer as any).looksLikeTypedClosureMisparse(node, nameNode, src)) {
        sites.set(node.startPosition.row + 1, nameNode.text.trim())
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) { const ch = node.namedChild(i); if (ch) walk(ch) }
  }
  walk(tree.rootNode)
  const afterSet = new Set(after[file].rels)
  for (const it of items) {
    const siteName = sites.get(it.line)
    if (siteName) { explained++; continue }
    // Re-parenting move: the same target still called at the same line, only
    // the source scope changed. That is an ownership recovery, not a loss.
    const p = it.key.split("|")
    const moved = after[file].rels.some((x) => {
      const q = x.split("|")
      return q[1] === "calls" && q[3] === p[3] && q[4] === p[4] && q[2] !== p[2]
    })
    if (moved) { movedCount++; continue }
    void afterSet
    unexplained.push(`${it.file}  ${it.key}  (no misparse site at L${it.line}; sites at: ${[...sites.keys()].join(",")})`)
  }
  // report sites whose suppression is NOT in the missing set -> would mean the
  // guard fired but no base edge was removed there (inert) — informational.
}

console.log(`explained by the misparse shape: ${explained}`)
console.log(`explained as re-parenting moves:  ${movedCount}`)
console.log(`UNEXPLAINED: ${unexplained.length}`)
for (const u of unexplained.slice(0, 40)) console.log(`  ${u}`)
