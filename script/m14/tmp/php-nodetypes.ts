import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const L: any = wts.Language ?? wts.default?.Language
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm")))
  for (const t of ["function_body", "compound_statement", "encapsed_string", "dynamic_variable_name", "subscript_expression", "variadic_placeholder", "anonymous_function_use_clause", "scoped_property_access_expression", "class_constant_access_expression", "use_declaration"]) {
    let found = false
    for (let i = 0; i < LANG.nodeTypeCount; i++) { if (LANG.nodeTypeForId(i) === t) { found = true; break } }
    console.log(t, found ? "REAL" : "NOT-IN-GRAMMAR")
  }
}
main()
