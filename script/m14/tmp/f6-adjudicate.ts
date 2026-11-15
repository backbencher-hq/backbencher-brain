// M49 W9 — F6 dead-literal adjudication.
//
// For every literal F6 reports as dead, answer three questions with evidence:
//   1. is it in the grammar's raw symbol enumeration (including `_`-prefixed)?
//   2. does it occur in the language's FIXTURE corpus (any child, anonymous
//      tokens included — the same collection F6 uses)?
//   3. can a TARGETED source that exercises the construct produce it?
//
// If (1) is false-or-hidden and (3) cannot produce it, the comparison is
// unreachable and the branch is dead. If (2) or (3) produces it, F6's
// enumeration is incomplete and the GATE is wrong, not the analyzer.
import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

const FLAGGED: Record<string, string[]> = {
  java: ["_reserved_identifier", "comment"],
  javascript: ["property_signature"],
  cpp: ["compound_assignment_expression", "template_type_parameter", "template_value_parameter", "typename_specifier"],
  go: ["compound_assignment_statement", "field_expression"],
  zig: ["assignment_statement", "composite_literal", "continue_label", "enum_item", "field_declaration", "field_identifier", "func_literal", "label_name", "mod_item", "package_clause", "qualified_type", "struct_item", "type_identifier", "type_item", "union_item"],
}

const WASM: Record<string, string> = {
  java: "tree-sitter-java.wasm",
  javascript: "tree-sitter-javascript.wasm",
  cpp: "tree-sitter-cpp.wasm",
  go: "tree-sitter-go.wasm",
  zig: "tree-sitter-zig.wasm",
}

// Targeted sources: each deliberately exercises the construct the flagged
// literal names, so "cannot be produced" is a real result rather than a
// corpus-coverage accident.
const PROBES: Record<string, string[]> = {
  java: [
    "class A { void f() { var x = 1; int yield = 2; int record = 3; } }",
    "// line comment\n/* block comment */\nclass B { }",
    "public @interface Ann { String value(); }",
  ],
  javascript: [
    "interface I { x: number }",
    "class C { m() {} }",
    "const o = { m() {}, get g() { return 1 } };",
  ],
  cpp: [
    "template <typename T> struct S { T v; };",
    "template <class T, int N> struct Q {};",
    "void f(){ int a = 0; a += 1; a = a + 1; }",
    "typename S<int>::X y;",
    "struct B { int m; }; void g(){ B b; b.m = 1; }",
  ],
  go: [
    "package p\nfunc f(){ a := 0; a += 1; a = 2; _ = a }",
    "package p\ntype S struct{ f int }\nfunc g(){ s := S{}; _ = s.f; _ = s }",
  ],
  zig: [
    "const S = struct { a: u8, pub fn m() void {} };",
    "const E = enum { a, b };",
    "const U = union { a: u8 };",
    "pub fn main() void { var x: u8 = 0; x += 1; outer: while (true) { continue :outer; } }",
    "const z = @import(\"std\");",
    "test \"t\" { try f(); }",
  ],
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

  const rows: { lang: string; lit: string; raw: boolean; visible: boolean; fixtures: boolean; targeted: boolean }[] = []

  for (const lang of Object.keys(FLAGGED)) {
    const t0 = Date.now()
    const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", WASM[lang])))
    const raw = new Set<string>()
    for (let i = 0; i < grammar.nodeTypeCount; i++) {
      const n = grammar.nodeTypeForId(i)
      if (n) raw.add(n)
    }
    const visible = new Set([...raw].filter((t) => !t.startsWith("_")))

    const parser = new P()
    parser.setLanguage(grammar)

    const observed = (sources: string[]): Set<string> => {
      const out = new Set<string>()
      for (const src of sources) {
        const tree = parser.parse(src)
        const stack = [tree.rootNode]
        while (stack.length) {
          const n = stack.pop()
          out.add(n.type)
          for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i)
            if (c) stack.push(c)
          }
        }
      }
      return out
    }

    const fixtureDir = path.join(ROOT, "validation", "m14", "fixtures", lang)
    const ext: Record<string, string[]> = { java: [".java"], javascript: [".js"], cpp: [".cc", ".cpp", ".h", ".hpp"], go: [".go"], zig: [".zig"] }
    const fixtures = fs.existsSync(fixtureDir)
      ? fs.readdirSync(fixtureDir).filter((f) => ext[lang].some((e) => f.endsWith(e))).map((f) => fs.readFileSync(path.join(fixtureDir, f), "utf8"))
      : []
    const fixtureTypes = observed(fixtures)
    const targetedTypes = observed(PROBES[lang] ?? [])

    for (const lit of FLAGGED[lang]) {
      rows.push({
        lang, lit,
        raw: raw.has(lit),
        visible: visible.has(lit),
        fixtures: fixtureTypes.has(lit),
        targeted: targetedTypes.has(lit),
      })
    }
    console.log(`# ${lang}: raw=${raw.size} visible=${visible.size} fixtures=${fixtures.length} fixtureTypes=${fixtureTypes.size} probeTypes=${targetedTypes.size} (${Date.now() - t0}ms)`)
    // show what the grammar DOES call the shapes the analyzer names
    const show = (label: string, needles: string[]) => {
      const hits = [...visible].filter((t) => needles.some((n) => t.includes(n)))
      if (hits.length) console.log(`    ${label}: ${hits.slice(0, 12).join(", ")}`)
    }
    show("declaration-ish types", ["decl", "declaration", "item", "definition"])
    show("container/field-ish", ["container", "field", "member", "struct", "enum", "union", "type"])
    show("label/loop-ish", ["label", "loop", "continue", "break"])
    show("literal/composite-ish", ["literal", "initializer", "expression_list"])
  }

  console.log("\n=== verdict table ===")
  console.log("lang        literal                            inRaw inVisible inFixtures inProbe  verdict")
  for (const r of rows) {
    const reachable = r.fixtures || r.targeted
    let verdict: string
    if (reachable) verdict = "GATE-WRONG (producible)"
    else if (r.raw && !r.visible) verdict = "DEAD (hidden rule, .type never matches)"
    else if (!r.raw) verdict = "DEAD (not a symbol in the pinned grammar)"
    else verdict = "UNRESOLVED (visible but never produced)"
    console.log(`${r.lang.padEnd(11)} ${r.lit.padEnd(34)} ${String(r.raw).padEnd(5)} ${String(r.visible).padEnd(9)} ${String(r.fixtures).padEnd(10)} ${String(r.targeted).padEnd(8)} ${verdict}`)
  }
}
main()
