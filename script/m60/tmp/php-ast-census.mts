/**
 * PHP MASTER REVIEW — AST-side construct census (read-only probe; writes no artifact).
 *
 * The companion half of php-master-review.mts. The analyzer's OUTPUT cannot
 * distinguish "the language has no such construct here" from "the rule cannot
 * fire" — a label that reads 0 is ambiguous. This half asks the TREE instead:
 * for every relationship label and every symbol kind the lane claims, how many
 * times does the grammar's own node type occur in the two pinned corpora?
 *
 * Run: bun script/m60/tmp/php-ast-census.mts [--full]
 */
import { readFileSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"
import * as path from "node:path"

const ROOT = "$HOME/backbencher-brain"
const CORPORA = [
  { name: "phpunit", dir: "$HOME/fixtures/repositories/phpunit" },
  { name: "phpmyadmin", dir: "$HOME/fixtures/repositories/phpmyadmin" },
].filter((c) => existsSync(c.dir))
const FULL = process.argv.includes("--full")

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const grammar = await (wts as any).Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-php.wasm")))
const parser = new P()
parser.setLanguage(grammar)

/** Every node type the grammar declares — the universe, not a hand-picked list. */
const universe = new Set<string>()
for (let i = 0; i < (grammar as any).nodeTypeCount; i++) universe.add((grammar as any).nodeTypeForId(i))
for (const t of (grammar as any).nodeTypeInfo ?? []) if (t?.named) universe.add(t.type)

const counts = new Map<string, number>()
const perCorpus: Record<string, Record<string, number>> = {}
let files = 0
// the two facts the `overrides` rule actually depends on
let classesWithBase = 0
const sameFileBase = new Map<string, string[]>()   // file -> [ "cls extends base" ]
const sameFileInheritance = new Map<string, string>()

const ALL = process.argv.includes("--all") ? [...universe] : null

for (const c of CORPORA) {
  const all = execSync(`git ls-files -z -- '*.php'`, { cwd: c.dir, maxBuffer: 1 << 28 })
    .toString().split("\0").filter(Boolean).sort()
  const seen = new Map<string, number>()
  perCorpus[c.name] = {}
  for (const f of all) {
    let root: any
    try {
      const p = path.join(c.dir, f)
      root = parser.parse(readFileSync(p, "utf8")).rootNode
    } catch { continue }
    files++
    const fileClasses = new Set<string>()
    const fileBases = new Map<string, string>()
    const stack: any[] = [root]
    while (stack.length) {
      const n = stack.pop()!
      seen.set(n.type, (seen.get(n.type) ?? 0) + 1)
      if (n.type === "class_declaration" || n.type === "interface_declaration" || n.type === "trait_declaration" || n.type === "enum_declaration") {
        let nm: string | undefined
        for (let i = 0; i < n.namedChildCount; i++) { const x = n.namedChild(i); if (x?.type === "name") { nm = x.text; break } }
        if (nm) fileClasses.add(nm)
        if (n.type === "class_declaration") {
          for (let i = 0; i < n.namedChildCount; i++) {
            const x = n.namedChild(i)
            if (x?.type !== "base_clause") continue
            classesWithBase++
            const b = x.namedChild(0)?.text
            if (b) fileBases.set(nm ?? "?", b.includes("\\") ? b.slice(b.lastIndexOf("\\") + 1) : b)
            break
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const x = n.namedChild(i); if (x) stack.push(x) }
    }
    for (const [cls, base] of fileBases) {
      if (fileClasses.has(base)) {
        const key = `${path.relative(c.dir, path.join(c.dir, f))}: ${cls} extends ${base}`
        sameFileInheritance.set(key, c.name)
      }
    }
  }
  for (const [k, v] of seen) { counts.set(k, (counts.get(k) ?? 0) + v); perCorpus[c.name][k] = v }
}

const PROBES: Record<string, string> = {
  "extends (class base_clause)": "base_clause",
  "extends (interface base_clause)": "base_clause",
  "implements (class_interface_clause)": "class_interface_clause",
  "implements (enum clause)": "class_interface_clause",
  "uses (trait use_declaration)": "use_declaration",
  "uses (insteadof)": "trait_precedence",
  "uses (member_access_expression)": "member_access_expression",
  "uses (scoped_property_access)": "scoped_property_access_expression",
  "uses (class_constant_access)": "class_constant_access_expression",
  "uses (subscript_expression)": "subscript_expression",
  "uses (anonymous_function_use_clause)": "anonymous_function_use_clause",
  "uses (encapsed_string)": "encapsed_string",
  "uses (bare variable_name)": "variable_name",
  "uses (bare name)": "name",
  "uses (tear-off variadic_placeholder)": "variadic_placeholder",
  "calls (function_call_expression)": "function_call_expression",
  "calls (member_call_expression)": "member_call_expression",
  "calls (nullsafe_member_call)": "nullsafe_member_call_expression",
  "calls (scoped_call_expression)": "scoped_call_expression",
  "instantiates (object_creation_expression)": "object_creation_expression",
  "instantiates (relative_scope new)": "relative_scope",
  "imports (namespace_use_clause)": "namespace_use_clause",
  "imports (grouped namespace_use_group)": "namespace_use_group",
  "imports (include_expression)": "include_expression",
  "imports (require_expression)": "require_expression",
  "imports (include_once)": "include_once_expression",
  "imports (require_once)": "require_once_expression",
  "references (property_declaration)": "property_declaration",
  "references (simple_parameter)": "simple_parameter",
  "references (variadic_parameter)": "variadic_parameter",
  "references (property_promotion_parameter)": "property_promotion_parameter",
  "references (method return_type)": "method_declaration",
  "overrides (method_declaration)": "method_declaration",
  "contains (any owned symbol)": "class_declaration",
  "symbol namespace": "namespace_definition",
  "symbol class": "class_declaration",
  "symbol interface": "interface_declaration",
  "symbol trait": "trait_declaration",
  "symbol enum": "enum_declaration",
  "symbol enum_member": "enum_case",
  "symbol method": "method_declaration",
  "symbol function": "function_definition",
  "symbol property": "property_declaration",
  "symbol constant": "const_declaration",
  "symbol promoted property": "property_promotion_parameter",
}

console.log(`files=${files}  universe=${universe.size}  classesWithBase=${classesWithBase}`)
console.log("\n=== node-type occurrence (both corpora) ===")
const rows: Array<[string, string, number, number, number]> = []
for (const [label, node] of Object.entries(PROBES)) {
  const total = counts.get(node) ?? 0
  rows.push([label, node, total, perCorpus["phpunit"]?.[node] ?? 0, perCorpus["phpmyadmin"]?.[node] ?? 0])
}
for (const [label, node, total, a, b] of rows) {
  const flag = total === 0 ? "   <-- ZERO" : ""
  console.log(`  ${label.padEnd(46)} ${String(node).padEnd(36)} ${String(total).padStart(8)}  (phpunit ${a} / pma ${b})${flag}`)
}
console.log(`\n=== overrides reachability ===`)
console.log(`  classes with a base_clause:        ${classesWithBase}`)
console.log(`  ... whose base is declared IN THE SAME FILE: ${sameFileInheritance.size}`)
for (const [k, v] of [...sameFileInheritance.entries()].slice(0, 20)) console.log(`     [${v}] ${k}`)

console.log(`\n=== every grammar node type with ZERO corpus occurrences (${[...universe].filter((t) => !(counts.get(t) ?? 0)).length}) ===`)
console.log("  " + [...universe].filter((t) => !(counts.get(t) ?? 0)).sort().join(", "))
process.exit(0)
