// script/m14/tmp/php-dt-measure.ts — prototype the php declared-type leaf walk against
// validation/m14/fixtures/php/declared-type-graph.php and print the candidate edges
// (source, target, line, position) BEFORE the rule goes into the analyzer. php's shapes,
// from the tree dump: property_declaration.type, method_declaration.return_type,
// simple_parameter.type, property_promotion_parameter.type, wrapped in
// optional_type / union_type / intersection_type, with named_type carrying a `name`
// field (a `name` node or a `qualified_name`).
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const FILE = path.join(ROOT, "validation/m14/fixtures/php/declared-type-graph.php")

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const LANG: any = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-php.wasm")))
const p = new P()
p.setLanguage(LANG)
const src = readFileSync(FILE, "utf8")
const root = p.parse(src).rootNode

/** The relative types the lane already resolves for `new` (probe-verified 2026-09-01). */
const RELATIVE = new Set(["self", "static", "parent"])

/** The leaf `name` node of a written type: the published target's own token. */
function leafNode(n: any): any {
  if (!n) return null
  if (n.type === "name") return n
  const nm = n.childForFieldName?.("name")
  if (nm) return leafNode(nm)
  // qualified_name(namespace_name(...), name) — the trailing name is the leaf
  for (let i = n.namedChildCount - 1; i >= 0; i--) {
    const c = leafNode(n.namedChild(i))
    if (c) return c
  }
  return null
}

/**
 * `ownerType` is the enclosing CLASS — the resolution of a relative type.
 *
 * Measured, not assumed: the first prototype passed the ATTRIBUTION source instead, so
 * `public function copy(): self` published `copy -> copy`.
 */
function leaves(typeRoot: any, ownerType: string, base: string | undefined, acc: any[]): void {
  const walk = (n: any): void => {
    if (!n) return
    switch (n.type) {
      case "primitive_type":
        return // int/string/void/... name no declared dependency
      case "named_type": {
        const leaf = leafNode(n)
        const text = String(leaf?.text ?? "").trim()
        if (!text) return
        if (RELATIVE.has(text)) {
          // self/static -> the enclosing CLASS; parent -> its DECLARED base, or nothing
          // (the lane's own probe-verified `new self()` rule, applied to type positions).
          if (text === "parent") { if (base) acc.push({ node: leaf, target: base }); return }
          if (ownerType) acc.push({ node: leaf, target: ownerType })
          return
        }
        acc.push({ node: leaf, target: text })
        return
      }
      default:
        for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
  }
  walk(typeRoot)
}

/** The nearest enclosing declaration that NAMES the dependency's owner. */
function enclosing(node: any, kinds: Set<string>): string {
  let cur = node?.parent
  while (cur) {
    if (kinds.has(cur.type)) {
      const nm = cur.childForFieldName?.("name")?.text
      if (nm) return nm
    }
    cur = cur.parent
  }
  return ""
}

const TYPES = new Set(["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"])

const out: any[] = []
const stack = [root]
while (stack.length) {
  const n = stack.pop()!
  const line = n.startPosition.row + 1
  switch (n.type) {
    case "property_declaration": {
      const owner = enclosing(n, TYPES)
      const acc: any[] = []
      leaves(n.childForFieldName?.("type"), owner, undefined, acc)
      for (const l of acc) out.push({ line, source: owner, target: l.target, declaredOn: "property_declaration" })
      break
    }
    case "method_declaration":
    case "function_definition": {
      const owner = n.childForFieldName?.("name")?.text ?? enclosing(n, TYPES)
      const acc: any[] = []
      leaves(n.childForFieldName?.("return_type"), enclosing(n, TYPES), undefined, acc)
      for (const l of acc) out.push({ line, source: owner, target: l.target, declaredOn: n.type === "function_definition" ? "return_type" : "method_declaration" })
      break
    }
    case "simple_parameter":
    case "variadic_parameter":
    case "property_promotion_parameter": {
      const owner = enclosing(n, new Set(["method_declaration", "function_definition"]))
      const acc: any[] = []
      leaves(n.childForFieldName?.("type"), enclosing(n, TYPES), undefined, acc)
      for (const l of acc) out.push({ line, source: owner, target: l.target, declaredOn: n.type })
      break
    }
  }
  for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
}

console.log(`${out.length} candidate declared-type edges:`)
for (const r of out.sort((a, b) => a.line - b.line)) {
  console.log(`  L${String(r.line).padStart(3)}  ${String(r.source).padEnd(13)} -> ${String(r.target).padEnd(6)} ${r.declaredOn.padEnd(30)} ${src.split("\n")[r.line - 1].trim().slice(0, 60)}`)
}
const silent = out.filter((r) => ["int", "string", "void", "mixed", "parent"].includes(r.target))
console.log(`\nsilent-shape violations: ${silent.length}`)
for (const s of silent) console.log("  !!", JSON.stringify(s))
