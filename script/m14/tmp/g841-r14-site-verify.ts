// #841 round 14: verify ALL sites (no sampling) before extending the guard.
// For every juxt node with type-cased name + identifier-only args, check the
// SOURCE: the characters immediately after the node must be optional space then
// `->` (a typed closure parameter list), and the node's own text must be a
// `Type name[, name]*` fragment. Any site failing this is NOT a misparse and
// must be dumped — the guard may only select sites where this holds.
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
const parser = await ASTEngine.getParser("groovy" as any)

const base: Record<string, { symbols: string[]; rels: string[] }> = JSON.parse(readFileSync("/tmp/g841-r14-base.json", "utf8"))
const after: Record<string, { symbols: string[]; rels: string[] }> = JSON.parse(readFileSync("/tmp/g841-r14-after.json", "utf8"))

let sites = 0, verified = 0
let baseEdgesAtSites = 0, afterEdgesAtSites = 0
const failed: string[] = []

for (const repo of REPOS) {
  for (const f of walk(path.join(CORPUS, repo)).sort()) {
    let src: string
    try { src = readFileSync(f, "utf8") } catch { continue }
    const tree = parser.parse(src)
    const rel = `groovy|${path.relative(CORPUS, f)}`
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
            sites++
            const line = node.startPosition.row + 1
            // the new guard: arrow in the 160-char tail, only parameter-list
            // material before it
            const tail = src.slice(node.endIndex, node.endIndex + 160)
            const arrowIdx = tail.indexOf("->")
            const between = arrowIdx >= 0 ? tail.slice(0, arrowIdx) : ""
            const arrowOk = arrowIdx >= 0 && /^[\s,.<>\[\]A-Za-z0-9_]*$/.test(between)
            // parameter-list shape: `Type name[, Type name]*` — names after the
            // first type token may be bare or type-qualified
            const fragOk = /^[A-Z][A-Za-z0-9_.]*(\s*<[^>]*>)?(\s*\[\s*\])*\s+[A-Za-z_]\w*(\s*,\s*(?:[A-Za-z_][\w.]*(\s*<[^>]*>)?(\s*\[\s*\])*\s+)?[A-Za-z_]\w*)*$/.test(node.text.trim())
            if (arrowOk && fragOk) verified++
            else failed.push(`${rel}:${line} arrow=${arrowOk} frag=${fragOk} juxt=${JSON.stringify(node.text)} between=${JSON.stringify(between)} src=${(src.split("\n")[line - 1] ?? "").trim().slice(0, 100)}`)
            // count calls edges at this line in base/after
            const bEdges = (base[rel]?.rels ?? []).filter((r) => r.startsWith("R|calls|") && r.split("|")[4] === String(line) && r.split("|")[3] === nameText)
            const aEdges = (after[rel]?.rels ?? []).filter((r) => r.startsWith("R|calls|") && r.split("|")[4] === String(line) && r.split("|")[3] === nameText)
            baseEdgesAtSites += bEdges.length
            afterEdgesAtSites += aEdges.length
          }
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) inspect(c) }
    }
    inspect(tree.rootNode)
  }
}

console.log(`sites (type-cased, identifier-only args): ${sites}`)
console.log(`verified as typed closure parameters (arrow immediately after): ${verified}`)
console.log(`FAILED VERIFICATION: ${failed.length}`)
for (const f of failed.slice(0, 40)) console.log(`  ${f}`)
console.log(`calls->Type edges at those lines: base=${baseEdgesAtSites} after=${afterEdgesAtSites}`)
