import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const dumpA = (n: any, dp: number, max: number): void => {
    if (!n || dp > max) return
    console.log("  ".repeat(dp) + (n.isNamed ? n.type : `"${n.type}"`) + " :: " + JSON.stringify((n.text ?? "").slice(0, 24)))
    for (let i = 0; i < (n.childCount ?? 0); i++) dumpA(n.child(i), dp + 1, max)
  }
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (!n) return out
    if (pred(n)) out.push(n)
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) findAll(n.namedChild(i), pred, out)
    return out
  }
  {
    const root = p.parse(`class A { int P { get { return 1; } set { } } event System.Action E { add { } remove { } } }`).rootNode
    for (const a of findAll(root, (x) => x.type === "accessor_declaration")) { console.log("--- accessor:"); dumpA(a, 1, 1) }
  }
  {
    const root = p.parse(`class A { bool M(object o) { return o is Point; } }`).rootNode
    const isp = findAll(root, (x) => x.type === "is_pattern_expression")[0]
    console.log("--- is typeless:"); dumpA(isp, 1, 2)
  }
  {
    // grammar node-type inventory for the literals my pass references
    const want = ["name_of_expression","is_expression","as_expression","join_into_clause","query_continuation","into_clause","switch_expression_arm","subpattern","with_initializer","declaration_pattern","declaration_expression","implicit_parameter","parenthesized_expression","using_statement","catch_clause","attribute_argument","anonymous_object_creation_expression","extern_alias_directive","query_expression","lambda_expression","local_function_statement","conditional_access_expression","member_binding_expression","generic_name","preproc_if","labeled_statement","goto_statement","assignment_expression","tuple_expression","argument","parameter","parameter_list","variable_declarator","field_declaration","qualified_name","member_access_expression","invocation_expression","constant_pattern","typeof_expression","default_expression","sizeof_expression","type_parameter_list"]
    const count = (LANG as any).nodeTypeCount as number
    const found = new Set<string>()
    for (let id = 0; id < count; id++) {
      try {
        const t = (LANG as any).nodeTypeForId(id)
        const nm = typeof t === "string" ? t : t?.type
        if (nm) found.add(nm)
      } catch { /* ignore */ }
    }
    console.log("nodeTypeCount:", count, "sampled:", found.size)
    for (const w of want) console.log(`  ${w}: ${found.has(w) ? "DEFINED" : "ABSENT?"}`)
  }
}
main()
