import * as fs from "fs"
import { execSync } from "child_process"
import * as WTS from "web-tree-sitter"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load(`${ROOT}/wasm/tree-sitter-typescript.wasm`)
  const files = execSync("git ls-files '*.ts' | rg -v '^node_modules/|^dist/|^wasm/|^script/m14/tmp/' | head -1000", { encoding: "utf8", cwd: ROOT }).trim().split("\n").filter(Boolean)
  let falseEdges = 0, filesWith = 0
  const samples: string[] = []
  for (const f of files) {
    if (!fs.existsSync(`${ROOT}/${f}`)) continue
    const src = fs.readFileSync(`${ROOT}/${f}`, "utf8")
    const p = new P(); p.setLanguage(lang); const tree = p.parse(src)
    let r: any
    try { r = await new (await import(`${ROOT}/src/ast/real-typescript-analyzer`)).RealTypeScriptAnalyzer().analyze(tree.rootNode, src, `${ROOT}/${f}`) } catch { continue }
    const declared = new Set((r.symbols ?? []).map((s: any) => s.name))
    // param names of every function-like node that is NOT a named declaration
    const arrowParams = new Map<string, string[]>()
    const st: any[] = [tree.rootNode]
    while (st.length) {
      const n = st.pop()!
      if (["arrow_function","function_expression","generator_function"].includes(n.type)) {
        const fp = n.childForFieldName?.("parameters")
        const names: string[] = []
        if (fp) for (const pnode of (fp.namedChildren ?? [])) {
          const pat = pnode.childForFieldName?.("pattern") ?? (pnode.type === "identifier" ? pnode : null)
          const walk = (x: any): void => { if (!x) return; if (x.type === "identifier") names.push(x.text); for (let i=0;i<x.namedChildCount;i++) walk(x.namedChild(i)) }
          if (pat) walk(pat)
        }
        arrowParams.set(String(n.startIndex), names)
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
    }
    if (arrowParams.size === 0) continue
    // a reference edge is false if its target equals a param of an arrow that LEXICALLY encloses the mention
    const hits: string[] = []
    for (const e of (r.relationships ?? []).filter((x: any) => x.type === "references")) {
      if (!declared.has(e.target)) continue
      if (e.source === e.target) continue
      // find the mention site by line
      const line = e.line_number
      const st2: any[] = [tree.rootNode]
      while (st2.length) {
        const n = st2.pop()!
        if ((n.type === "identifier" || n.type === "type_identifier") && n.text === e.target && n.startPosition.row + 1 === line) {
          // climb: is an enclosing arrow a param binder of this name?
          let cur: any = n.parent; let shadowed = false
          while (cur) {
            const names = arrowParams.get(String(cur.startIndex))
            if (names && names.includes(e.target)) { shadowed = true; break }
            cur = cur.parent
          }
          if (shadowed) hits.push(`${e.source}->${e.target}`)
          break
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st2.push(c) }
      }
    }
    if (hits.length) { filesWith++; falseEdges += hits.length; if (samples.length < 8) samples.push(`${f}  ${hits.slice(0,3).join(", ")}`) }
  }
  console.log(`files scanned=1000  files with an arrow/function-expression param that shadows a declared name=${filesWith}`)
  console.log(`FALSE references edges from an unshadowed arrow/function-expression parameter = ${falseEdges}`)
  for (const s of samples) console.log("  " + s)
}
main()
