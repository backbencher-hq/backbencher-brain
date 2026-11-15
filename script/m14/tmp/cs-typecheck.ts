import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const count = (LANG as any).nodeTypeCount as number
  const found = new Set<string>()
  for (let id = 0; id < count; id++) {
    try {
      const t = (LANG as any).nodeTypeForId(id)
      const nm = typeof t === "string" ? t : t?.type
      if (nm) found.add(nm)
    } catch { /* ignore */ }
  }
  for (const w of ["is_expression","as_expression","name_of_expression","join_into_clause","query_continuation","into_clause","for_statement","using_statement","block","argument_list","equals_value_clause","arrow_expression_clause"]) {
    console.log(`${w}: ${found.has(w) ? "DEFINED" : "ABSENT"}`)
  }
}
main()
