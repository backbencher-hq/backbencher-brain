import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "<corpus-root>/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm")))
  const names = ["formal_parameter", "constructor_param", "super_formal_parameter", "simple_parameter", "variadic_parameter", "property_promotion_parameter", "function_body", "block", "class_body", "label", "labeled_statement", "break_statement", "attribute_argument", "type_alias", "subscript_expression", "pair", "catch_clause", "for_statement", "foreach_statement", "static_variable_declaration", "global_declaration", "list_literal", "field_initializer", "property_element", "namespace_definition", "arrow_function", "anonymous_function", "dynamic_variable_name", "encapsed_string", "heredoc"]
  const types = new Set<string>()
  for (let i = 0; i < LANG.nodeTypeCount; i++) { const n = LANG.nodeTypeForId(i); if (n) types.add(n) }
  for (const t of names) console.log(t, types.has(t) ? "REAL" : "ABSENT");
}
main()
