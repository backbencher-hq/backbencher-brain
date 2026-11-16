// #841 round 14: which site did the tightened args pre-check (comma-separated
// identifier runs) exclude that the old token-split test accepted? Confirm it
// is NOT a typed closure parameter list.
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
          const oldArgsOk = argText.length > 0 && argText.split(/[\s,]+/).every((t) => t.length === 0 || /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(t))
          const newArgsOk = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*(\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*$/.test(argText)
          if (nameOk && oldArgsOk && !newArgsOk) {
            const line = node.startPosition.row + 1
            console.log(`${rel}:${line}  juxt=${JSON.stringify(node.text)} args=${JSON.stringify(argText)}`)
            console.log(`    src: ${(src.split("\n")[line - 1] ?? "").trim().slice(0, 120)}`)
            const tail = src.slice(node.endIndex, node.endIndex + 60)
            console.log(`    tail: ${JSON.stringify(tail)}`)
          }
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) inspect(c) }
    }
    inspect(tree.rootNode)
  }
}
