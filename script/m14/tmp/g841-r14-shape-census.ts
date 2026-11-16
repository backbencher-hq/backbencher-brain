// #841 round 14: census of EVERY juxt_function_call whose name is type-cased
// and whose args are identifier-only tokens — the raw population the
// suppression guard selects from. Classify by composition so the guard is
// defined by measurement:
//   "lambda-sibling"  juxt followed by a lambda_expression sibling (current)
//   "closure-first"   juxt is the FIRST named child of a closure
//   "other"           neither — inspect these; none may be a misparse the
//                     guard silently misses (or a real call the guard would hit)
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CORPUS = "<corpus-root>/bb_tests/repositories"
const REPOS = ["grails-core", "geb"]

function walk(dir: string, out: string[] = []): string[] {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "build" || e.name === "target") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith(".groovy")) out.push(p)
  }
  return out
}

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const parser = await ASTEngine.getParser("groovy" as any)

let total = 0
const byClass: Record<string, number> = { "lambda-sibling": 0, "closure-first": 0, other: 0 }
const samples: string[] = []
const otherSamples: string[] = []
const REALJUXT_RE = /\{/

for (const repo of REPOS) {
  const files = walk(path.join(CORPUS, repo)).sort()
  for (const f of files) {
    let src: string
    try { src = readFileSync(f, "utf8") } catch { continue }
    const tree = parser.parse(src)
    const rel = path.relative(CORPUS, f)
    const inspect = (node: any) => {
      if (node.type === "juxt_function_call") {
        const nameNode = node.childForFieldName("name")
        const args = node.childForFieldName("args")
        if (nameNode && args) {
          const nameText = nameNode.text.trim()
          const argText = args.text.trim()
          const nameOk = /^[A-Z][A-Za-z0-9_]*(\.[A-Z][A-Za-z0-9_]*)*$/.test(nameText)
          const argsOk = argText.length > 0 && argText.split(/[\s,]+/).every((t) => t.length === 0 || /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(t))
          if (nameOk && argsOk) {
            total++
            const parent = node.parent
            let cls = "other"
            if (parent) {
              const kids: any[] = []
              for (let i = 0; i < parent.namedChildCount; i++) { const c = parent.namedChild(i); if (c) kids.push(c) }
              const idx = kids.findIndex((k) => k.id === node.id)
              const next = idx >= 0 ? kids[idx + 1] : null
              if (next && next.type === "lambda_expression") cls = "lambda-sibling"
              else if (parent.type === "closure" && idx === 0) cls = "closure-first"
            }
            byClass[cls]++
            const line = node.startPosition.row + 1
            const srcLine = (src.split("\n")[line - 1] ?? "").trim()
            if (cls === "other" && otherSamples.length < 60) otherSamples.push(`${rel}:${line}  parent=${parent?.type} juxt=${nameText} ${JSON.stringify(argText)}  src=${srcLine.slice(0, 110)}`)
            else if (cls === "closure-first" && samples.length < 60) samples.push(`${rel}:${line}  ${srcLine.slice(0, 110)}`)
          }
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) inspect(c) }
    }
    inspect(tree.rootNode)
  }
}
void REALJUXT_RE
console.log(`total type-cased identifier-arg juxt nodes: ${total}`)
console.log(JSON.stringify(byClass))
console.log("\n--- closure-first samples ---")
for (const s of samples) console.log(s)
console.log("\n--- other samples (must be inspected: none may be a missed misparse) ---")
for (const s of otherSamples) console.log(s)
