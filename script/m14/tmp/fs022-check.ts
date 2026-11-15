import * as fs from "fs"; import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const wts: any = await import("web-tree-sitter")
const L = wts.Language ?? wts.default?.Language
const P = wts.Parser ?? wts.default ?? wts
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm")))
const names = new Set<string>()
for (let i = 0; i < g.nodeTypeCount; i++) { const n = g.nodeTypeForId(i); if (n != null) names.add(n) }
for (const t of ["argument_type", "member_modifier", "member_signature", "type_declaration", "type_extension", "attributes", "type_attributes", "access_modifier", "argument_name_spec", "curried_spec", "arguments_spec", "argument_spec", "paren_pattern", "argument_patterns", "value_declaration", "identifier_pattern", "long_identifier_or_op", "type_argument", "type_arguments", "type_argument_defn", "type_name", "union_type_field", "union_type_defn", "record_type_defn", "record_field", "class_inherits_decl", "interface_implementation", "type_abbrev_defn", "simple_type", "postfix_type", "generic_type", "list_type", "function_type", "paren_type", "compound_type", "atomic_type", "nullable_type", "struct_type", "static_type", "byref_type", "flexible_type", "types", "object_expression", "active_pattern", "exception_definition", "module_val_declaration", "compiler_directive_decl", "import_decl", "application_expression", "prefixed_expression", "additional_constr_defn", "method_or_prop_defn", "property_or_ident", "const", "identifier"])
  console.log(`${names.has(t) ? "YES" : "NO "}  ${t}`)
