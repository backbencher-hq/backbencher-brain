// Did the include row's LINE move? Old expression: findChild(string_literal) ??
// findChild(system_lib_string) ?? node. New: pathNode ?? node. Compared on the
// same tree, per preproc_include node, over the two pinned cpp corpora.
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { getParser } from "../m14/run-fixtures"
const ROOTS = ["$HOME/fixtures/repositories/fmt", "$HOME/fixtures/repositories/nlohmann-json"]
const EXTS = [".h", ".hpp", ".hh", ".hxx", ".cpp", ".cc", ".cxx"]
const SKIP = new Set([".git", "build", "node_modules", "docs", "doc", "third_party"])
const parser = await getParser("cpp")
const findChild = (n: any, t: string) => { for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === t) return c } return null }
let nodes = 0, differ = 0
const walk = (d: string, depth = 0) => {
  if (depth > 7) return
  let es: string[] = []; try { es = readdirSync(d) } catch { return }
  for (const e of es) {
    if (SKIP.has(e)) continue
    const p = path.join(d, e); let st: any
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) { walk(p, depth + 1); continue }
    if (!EXTS.some(x => p.endsWith(x))) continue
    const tree = parser.parse(readFileSync(p, "utf8"))
    const visit = (n: any) => {
      if (n.type === "preproc_include") {
        nodes++
        const oldNode = findChild(n, "string_literal") ?? findChild(n, "system_lib_string") ?? n
        let pn = n.childForFieldName?.("path") ?? null
        if (pn && pn.type !== "string_literal" && pn.type !== "system_lib_string") pn = null
        if (!pn) pn = findChild(n, "string_literal") ?? findChild(n, "system_lib_string")
        const newNode = pn ?? n
        if (oldNode.startPosition.row !== newNode.startPosition.row) {
          differ++
          if (differ <= 5) console.log(`  DIFF ${p}: old row ${oldNode.startPosition.row} new ${newNode.startPosition.row} (${n.text.slice(0, 60)})`)
        }
      }
      for (let i = 0; i < n.childCount; i++) visit(n.child(i))
    }
    visit(tree.rootNode)
  }
}
for (const r of ROOTS) walk(r)
console.log(`preproc_include nodes=${nodes} line-choice differences=${differ}`)
