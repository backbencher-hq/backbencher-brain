// #841 round 14: call the REAL guard on all 962 candidate sites. Cross-reference
// with the strict verification (source tail = parameter-list material then arrow
// AND node text = Type name list). Fired-but-unverified sites are the
// false-positive surface: each must be inspected by hand.
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
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
const { RealGroovyAnalyzer } = await import(path.join(ROOT, "src/ast/real-groovy-analyzer.ts"))
const parser = await ASTEngine.getParser("groovy" as any)
const analyzer = new RealGroovyAnalyzer()

let sites = 0, fired = 0, firedVerified = 0
const falsePositives: string[] = []
const misses: string[] = []

for (const repo of REPOS) {
  for (const f of walk(path.join(CORPUS, repo)).sort()) {
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
          // guard's arg pre-check (mirrors the implementation)
          const argsOk = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*(\s*,\s*[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*)*$/.test(argText)
          if (nameOk && argsOk) {
            sites++
            const line = node.startPosition.row + 1
            const didFire = (analyzer as any).looksLikeTypedClosureMisparse(node, nameNode, src)
            // strict verification
            const tail = src.slice(node.endIndex, node.endIndex + 160)
            const arrowIdx = tail.indexOf("->")
            const between = arrowIdx >= 0 ? tail.slice(0, arrowIdx) : ""
            const arrowOk = arrowIdx >= 0 && /^[\s,.<>\[\]A-Za-z0-9_]*$/.test(between)
            const fragOk = /^[A-Z][A-Za-z0-9_.]*(\s*<[^>]*>)?(\s*\[\s*\])*\s+[A-Za-z_]\w*(\s*,\s*(?:[A-Za-z_][\w.]*(\s*<[^>]*>)?(\s*\[\s*\])*\s+)?[A-Za-z_]\w*)*$/.test(node.text.trim())
            const verified = arrowOk && fragOk
            if (didFire) {
              fired++
              if (verified) firedVerified++
              else falsePositives.push(`${rel}:${line} juxt=${JSON.stringify(node.text)} args=${JSON.stringify(argText)} parent=${node.parent?.type} next=${node.nextSibling?.type} src=${(src.split("\n")[line - 1] ?? "").trim().slice(0, 120)}`)
            } else if (verified) {
              misses.push(`${rel}:${line} juxt=${JSON.stringify(node.text)}`)
            }
          }
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) inspect(c) }
    }
    inspect(tree.rootNode)
  }
}

console.log(`sites=${sites}  guardFired=${fired}  firedAndVerified=${firedVerified}  misses(verified but not fired)=${misses.length}`)
console.log(`\nFIRED BUT UNVERIFIED (false-positive candidates): ${falsePositives.length}`)
for (const fp of falsePositives.slice(0, 40)) console.log(`  ${fp}`)
console.log(`\nMISSES (verified param list the guard does not fire on): ${misses.length}`)
for (const m of misses.slice(0, 20)) console.log(`  ${m}`)
