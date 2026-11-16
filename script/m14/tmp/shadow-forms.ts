import * as fs from "fs"
import { execSync } from "child_process"
import * as WTS from "web-tree-sitter"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
type Form = "catch" | "for-of/in" | "function-param"
async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load(`${ROOT}/wasm/tree-sitter-typescript.wasm`)
  const files = execSync("git ls-files '*.ts' | rg -v '^node_modules/|^dist/|^wasm/|^script/m14/tmp/' | head -900", { encoding: "utf8", cwd: ROOT }).trim().split("\n").filter(Boolean)
  const falseEdges = new Map<Form, number>()
  const samples = new Map<Form, string[]>()
  const bump = (f: Form, s: string) => { falseEdges.set(f, (falseEdges.get(f) ?? 0) + 1); const a = samples.get(f) ?? []; if (a.length < 5) { a.push(s); samples.set(f, a) } }
  for (const f of files) {
    const src = fs.readFileSync(`${ROOT}/${f}`, "utf8")
    const p = new P(); p.setLanguage(lang); const tree = p.parse(src)
    let r: any
    try { r = await new (await import(`${ROOT}/src/ast/real-typescript-analyzer`)).RealTypeScriptAnalyzer().analyze(tree.rootNode, src, `${ROOT}/${f}`) } catch { continue }
    const declared = new Set((r.symbols ?? []).map((s: any) => s.name))
    const refs = (r.relationships ?? []).filter((x: any) => x.type === "references" && x.source !== x.target)
    if (refs.length === 0) continue
    // map each reference target -> is some non-file-level binding of that name in scope?
    const bindings = new Map<string, Form>()
    const st: any[] = [tree.rootNode]
    while (st.length > 0) {
      const n = st.pop()!
      if (n.type === "catch_clause") {
        const first = n.namedChild(0)
        if (first && first.type !== "statement_block") collect(first, "catch")
      }
      if (n.type === "for_in_statement") {
        const lhs = n.namedChild(0)
        if (lhs && lhs.type === "variable_declarator") collect(lhs, "for-of/in")
        else if (lhs) collect(lhs, "for-of/in")
      }
      if (n.type === "formal_parameters") collect(n, "function-param")
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
    }
    function collect(x: any, form: Form) {
      const walk = (y: any): void => {
        if (!y) return
        if (y.type === "identifier") { const t = y.text; if (declared.has(t) && !bindings.has(t)) bindings.set(t, form) }
        for (let i = 0; i < y.namedChildCount; i++) walk(y.namedChild(i))
      }
      if (x.type === "formal_parameters") { for (let i = 0; i < x.namedChildCount; i++) collect(x.namedChild(i), form) }
      else if (x.type === "variable_declarator") { const nm = x.childForFieldName("name"); if (nm) walk(nm) }
      else if (x.type === "identifier") walk(x)
      else walk(x)
    }
    for (const rel of refs) {
      const t = rel.target as string
      if (!bindings.has(t)) continue
      // already-correct forms (R12 handles function params) are reported for contrast
      bump(bindings.get(t)!, `${f}  ${rel.source} -> ${rel.target}   (shadowed by a ${bindings.get(t)} binding)`)
    }
  }
  console.log(`files scanned = ${files.length}`)
  for (const form of ["function-param", "catch", "for-of/in"] as Form[]) {
    console.log(`\n${form}: ${falseEdges.get(form) ?? 0} references edge(s) whose target is shadowed`)
    for (const s of samples.get(form) ?? []) console.log("  " + s)
  }
}
main()
