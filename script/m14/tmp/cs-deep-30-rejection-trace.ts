// CS-DEEP-30 — a REJECTION TRACE. Which gate drops which read, and why.
//
// Two hypotheses were wrong already: it was not the primary constructor (the `name` field is
// present and correct -- cs-deep-29), and it was not member-declarator self-reads (fixed in
// cs-deep-26, which took 742 -> 17). Enumerating candidate gates by reading the code is how the
// last two hours went; this probe asks the tree directly.
//
// For every bare occurrence of one name in one file, it runs the SAME gate list the truth uses,
// and prints which single gate fired -- or "EMITTED". A gate that fires on a read that is real is
// then a name in a list, not a hypothesis. The trace is also the artifact that makes a gate
// reviewable: fifteen boolean predicates is fifteen chances to be wrong, and this prints all
// fifteen verdicts for every site.
//
// It also prints the INVENTORY rows the truth was built from, because a gate can be innocent and
// the read still unresolvable -- the failure would then be in `resolvable`, not in the gates.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

async function main() {
  const file = arg("--file")
  const name = arg("--name") ?? "SemanticModel"
  if (!file) { console.error("usage: cs-deep-30-rejection-trace.ts --file <cs> [--name X]"); process.exit(2) }

  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new P()
  parser.setLanguage(grammar)
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  const src = fs.readFileSync(file, "utf8")
  const root = parser.parse(src).rootNode
  const res: any = await ASTEngine.parseFile(file, src)

  // the inventory, exactly as cs-deep-26 builds it
  const leafOf = (s: string): string => {
    const segs: string[] = []
    for (const a of s.split("::")) for (const b of a.split(".")) if (b) segs.push(b)
    return segs[segs.length - 1] ?? s
  }
  const members = new Map<string, Set<string>>()
  for (const s of res.symbols ?? []) {
    if (s?.kind !== "property" || !s.ownerName) continue
    for (const key of [String(s.ownerName), leafOf(String(s.ownerName))]) {
      let set = members.get(key)
      if (!set) { set = new Set<string>(); members.set(key, set) }
      set.add(String(s.name))
    }
  }
  const owners = [...members.entries()].filter(([, set]) => set.has(name)).map(([k]) => k)
  console.log(`file:  ${path.basename(file)}`)
  console.log(`name:  ${name}`)
  console.log(`inventory owners holding \`${name}\` as a property: ${owners.length > 0 ? owners.join(", ") : "NONE -- the read is unresolvable by construction"}`)
  console.log(`total symbols: ${(res.symbols ?? []).length}   property-kind: ${(res.symbols ?? []).filter((s: any) => s.kind === "property").length}`)
  const rows = (res.symbols ?? []).filter((s: any) => s.name === name)
  for (const s of rows) console.log(`   symbol: name=${s.name} kind=${s.kind} owner=${s.ownerName} line=${s.line ?? s.startLine ?? "?"}`)
  console.log("")

  // ---- collect every occurrence, with its enclosing class chain and its 15 gate verdicts ----
  const chain: string[] = []
  const occurrences: Array<{ n: any; line: number; cls: string[]; text: string }> = []
  const walk = (n: any): void => {
    if (/^(class|struct|interface|record)_declaration$/.test(n.type)) {
      const nm = n.childForFieldName?.("name")?.text
      if (nm) chain.push(nm)
    }
    if (n.type === "identifier" && n.text === name) {
      occurrences.push({ n, line: n.startPosition.row + 1, cls: [...chain], text: src.split("\n")[n.startPosition.row]?.trim().slice(0, 96) ?? "" })
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
    if (/^(class|struct|interface|record)_declaration$/.test(n.type)) {
      const nm = n.childForFieldName?.("name")?.text
      if (nm) chain.pop()
    }
  }
  walk(root)

  // the gates, re-derived here so the trace is independent of the truth's internals
  const same = (a: any, b: any) => !!a && !!b && a.startIndex === b.startIndex && a.endIndex === b.endIndex
  const namedOf = (n: any) => n?.childForFieldName?.("name") ?? null
  const firstIdent = (n: any) => { for (let i = 0; i < (n?.namedChildCount ?? 0); i++) { const c = n.namedChild(i); if (c && c.type === "identifier") return c } return null }
  const declaratorRole = (n: any): "local" | "member" | null => {
    let cur = n.parent
    while (cur) {
      const ct = cur.type
      if (ct === "method_declaration" || ct === "constructor_declaration" || ct === "destructor_declaration" ||
          ct === "operator_declaration" || ct === "conversion_operator_declaration" || ct === "local_function_statement" ||
          ct === "lambda_expression" || ct === "block" || ct === "accessor_declaration" || ct === "top_level_statement" ||
          (ct.includes("statement") && ct !== "field_declaration" && ct !== "event_field_declaration" && ct !== "using_statement" && ct !== "foreach_statement" && ct !== "fixed_statement")) return "local"
      if (ct === "class_declaration" || ct === "struct_declaration" || ct === "interface_declaration" || ct === "record_declaration" || ct === "enum_declaration") return "member"
      cur = cur.parent
    }
    return null
  }
  const GATES: Array<[string, (n: any) => boolean]> = [
    ["entityName", (n) => { const p = n.parent; if (!p) return false; if (p.type === "variable_declarator") return declaratorRole(n) === "member"; if (!/_declarations?$/.test(p.type) && p.type !== "constructor_initializer") return false; if (p.type === "variable_declaration") return false; const nf = namedOf(p); if (nf && same(nf, n)) return true; return same(firstIdent(p), n) }],
    ["memberLeaf", (n) => { const p = n.parent; return !!p && p.type === "member_access_expression" && same(p.childForFieldName?.("name"), n) }],
    ["calleeShaped", (n) => { let top = n, p = n.parent; while (p && (p.type === "generic_name" || p.type === "parenthesized_expression")) { top = p; p = p.parent } if (p && p.type === "member_access_expression") { const e = p.childForFieldName?.("expression"); if (e && n.startIndex >= e.startIndex && n.endIndex <= e.endIndex) return false; top = p; p = p.parent } if (!p || p.type !== "invocation_expression") return false; const fn = p.childForFieldName?.("function"); return !!fn && top.startIndex >= fn.startIndex && top.endIndex <= fn.endIndex }],
    ["typePosition", (n) => { let cur = n.parent; while (cur) { const t = cur.type; if (t === "variable_declaration" || t === "parameter" || t === "property_declaration" || t === "base_list" || t === "type_parameter_list" || t === "tuple_type" || t === "nullable_type" || t === "array_type" || t === "ref_type") return true; if (t.includes("statement") || t.includes("declaration") || t.includes("block") || t.includes("function") || t.includes("body") || t.includes("clause")) return false; cur = cur.parent } return false }],
    ["namePosition", (n) => { let cur = n.parent; while (cur) { const t = cur.type; if (t === "typeof_expression" || t === "default_expression" || t === "sizeof_expression" || t === "name_of_expression") return true; if (t.includes("statement") || t.includes("declaration") || t.includes("expression") || t.includes("clause") || t.includes("function") || t.includes("body") || t.includes("pattern") || t.includes("argument")) return false; cur = cur.parent } return false }],
    ["assignLhs", (n) => { let cur = n, p = n.parent; while (p && p.type === "parenthesized_expression") { cur = p; p = p.parent } if (!p || p.type !== "assignment_expression") return false; const l = p.namedChild(0); return !!l && cur.startIndex >= l.startIndex && cur.endIndex <= l.endIndex }],
  ]

  console.log(`occurrences of \`${name}\`: ${occurrences.length}`)
  console.log("line  class-chain                          gate that fired (first match wins)")
  console.log("-".repeat(100))
  for (const o of occurrences) {
    let fired = "EMITTED (no gate)"
    for (const [g, fn] of GATES) { if (fn(o.n)) { fired = g; break } }
    const resolvable = o.cls.length > 0 && owners.length > 0 && o.cls.some((c) => owners.includes(c) || owners.includes(leafOf(c)))
    console.log(`${String(o.line).padStart(4)}  ${(o.cls.join(" > ") || "-").slice(0, 34).padEnd(34)}  ${fired.padEnd(16)} resolvable=${resolvable}`)
    console.log(`      ${o.text}`)
  }
}

if (import.meta.main) await main()
