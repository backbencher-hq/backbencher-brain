// Review instrument (NOT a gate): read the PINNED tree-sitter-css wasm and ask it
// the questions the F1 dead-literal register says must be answered from the
// grammar, not from reading the analyzer.
//
//   bun script/m14/tmp/css-grammar-repayment.ts
//
// Three questions per literal in validation/m14/grammar-audit-baseline.json
// -> literals.css:
//   (1) is the literal in the grammar's raw node-type enumeration?
//   (2) can a targeted source that exercises the construct produce it?
//   (3) what DOES the grammar produce for that construct?

import { loadWebTreeSitter, Language } from "web-tree-sitter"
import { Parser } from "web-tree-sitter"
import { readFileSync } from "fs"

const WASM = "wasm/tree-sitter-css.wasm"

const LITERALS = [
  "media_query_list", "keyword_query", "binary_query", "feature_query",
  "parenthesized_query", "mixin_statement", "include_statement", "postcss_statement",
  "variable_name", "property_name", "keyframes_name", "keyframes_statement",
  "supports_statement", "import_statement", "media_statement", "rule_set",
  "selectors", "id_selector", "class_name", "tag_name", "universal_selector",
  "attribute_selector", "pseudo_class_selector", "pseudo_element_selector",
  "nesting_selector", "child_selector", "sibling_selector", "adjacent_sibling_selector",
  "descendant_selector", "declaration", "plain_value", "string_value",
  "call_expression", "function_name", "arguments", "integer_value", "float_value",
  "grid_value", "color_value", "at_keyword", "at_rule", "block", "comment",
  "important", "keyframes_statement", "page_statement", "font_face_statement",
  "charset_statement", "namespace_statement", "scope_statement", "starting_style",
  "position_try_statement", "property_value", "single_value", "keyframe_block",
  "keyframe_selector", "grid", "units", "ratio", "tag", "hex_color", "color_hash",
  "id", "class", "pseudo", "integer", "float", "string", "escape", "ident",
]

const TARGETED: { label: string; source: string }[] = [
  { label: "media query (screen and (min-width: 100px))", source: "@media screen and (min-width: 100px) { .a { color: red; } }\n" },
  { label: "media query (max-width: 768px)", source: "@media (max-width: 768px) { .a { color: red; } }\n" },
  { label: "media query (prefers-color-scheme: dark)", source: "@media (prefers-color-scheme: dark) { .a { color: red; } }\n" },
  { label: "media query with bare feature", source: "@media print { .a { color: red; } }\n" },
  { label: "@layer base", source: "@layer base { .a { color: red; } }\n" },
  { label: "@layer a, b", source: "@layer a, b;\n" },
  { label: "@container (min-width: 400px)", source: "@container (min-width: 400px) { .a { color: red; } }\n" },
  { label: "@container name (min-width: 400px)", source: "@container card (min-width: 400px) { .a { color: red; } }\n" },
  { label: "@supports (display: grid)", source: "@supports (display: grid) { .a { color: red; } }\n" },
  { label: "@keyframes fade", source: "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }\n" },
  { label: "@import url(\"a.css\")", source: "@import url(\"a.css\");\n" },
  { label: "@import \"a.css\" print", source: "@import \"a.css\" print;\n" },
  { label: "@import url(a.css) layer(x)", source: "@import url(a.css) layer(base) supports(display: grid) screen;\n" },
  { label: "custom property --x", source: ":root { --x: 1px; }\n" },
  { label: "scss $x variable", source: "$primary: #fff;\n.a { color: $primary; }\n" },
  { label: "scss @mixin", source: "@mixin card { border: 1px; }\n" },
  { label: "scss @include", source: ".a { @include card; }\n" },
  { label: "less @x variable", source: "@primary: #fff;\n.a { color: @primary; }\n" },
  { label: "postcss @custom-selector :--h", source: "@custom-selector :--heading h1, h2;\n" },
  { label: "@tailwind base", source: "@tailwind base;\n" },
  { label: "@apply flex", source: ".a { @apply flex; }\n" },
  { label: "@theme { --c: red; }", source: "@theme { --brand: red; }\n" },
  { label: "@font-face", source: "@font-face { font-family: X; src: url(x.woff2); }\n" },
  { label: "@page :first", source: "@page :first { margin: 1in; }\n" },
  { label: "@property --x", source: "@property --x { syntax: '<length>'; inherits: false; initial-value: 0px; }\n" },
  { label: "@scope (.a) to (.b)", source: "@scope (.a) to (.b) { .c { color: red; } }\n" },
  { label: "@starting-style", source: "@starting-style { .a { opacity: 0; } }\n" },
  { label: "@position-try --x", source: "@position-try --x { top: 0; }\n" },
  { label: "@namespace url()", source: "@namespace svg url(http://www.w3.org/2000/svg);\n" },
  { label: "@charset \"utf-8\"", source: "@charset \"utf-8\";\n" },
  { label: "var() reference", source: ".a { color: var(--x); }\n" },
  { label: "var() with fallback", source: ".a { color: var(--x, #fff); }\n" },
  { label: "url() in value", source: ".a { background: url(img.png); }\n" },
  { label: "nesting &", source: ".a { color: red; & .b { color: blue; } }\n" },
  { label: "composes (css modules)", source: ".a { composes: b; }\n" },
  { label: "universal reset", source: "*, *::before, *::after { box-sizing: border-box; }\n" },
  { label: "!important", source: ".a { color: red !important; }\n" },
  { label: "attribute selector i-flag", source: "p[type='B' i] { color: red; }\n" },
  { label: "unicode escape selector", source: "#\\31 .x { color: red; }\n" },
  { label: "special chars in string value", source: ".a::after { content: \"{};[]\"; }\n" },
  { label: "html comment wrapper", source: "<!-- /* c */ -->\n.a { color: red; }\n" },
  { label: "combinators", source: ".a > .b + .c ~ .d .e { color: red; }\n" },
  { label: "pseudo class + element", source: ".a:hover::before { color: red; }\n" },
  { label: "css modules :local", source: ":local(.a) { color: red; }\n" },
  { label: "calc with var", source: ".a { padding: calc(var(--x) * 2); }\n" },
  { label: "grid value", source: ".a { grid-template-columns: repeat(2, 1fr); }\n" },
  { label: "keyframe percentage selector", source: "@keyframes f { 0% { opacity: 0; } 50%, 75% { opacity: .5; } 100% { opacity: 1; } }\n" },
  { label: "animation shorthand", source: ".a { animation: fade 300ms ease; }\n" },
  { label: "animation-name list", source: ".a { animation-name: a, b; }\n" },
]

function collectTypes(node: any, out: Set<string>, fieldNames: Set<string>, depth = 0): void {
  if (!node || depth > 60) return
  out.add(node.type)
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) collectTypes(c, out, fieldNames, depth + 1)
  }
}

async function main() {
  await Parser.init()
  const lang = await Language.load(readFileSync(WASM))
  const nodeTypes = new Set<string>()
  for (let i = 0; i < lang.nodeTypeCount; i++) nodeTypes.add(lang.nodeTypeForId(i))

  console.log("=== PINNED WASM ===")
  console.log(`nodeTypeCount=${lang.nodeTypeCount} fieldCount=${lang.fieldCount}`)
  console.log(`field names: ${lang.fieldCount === 0 ? "(NONE — fieldless)" : [...Array(lang.fieldCount)].map((_, i) => lang.fieldNameForId(i)).join(", ")}`)

  console.log("\n=== LITERAL ADJUDICATION (F1 register) ===")
  const registered = ["media_query_list", "mixin_statement", "include_statement", "variable_name"]
  for (const lit of registered) {
    const present = nodeTypes.has(lit)
    console.log(`  ${lit.padEnd(22)} inGrammar=${present ? "YES" : "NO "}  ${present ? "<-- register is STALE" : "register CORRECT (dead branch)"}`)
  }
  console.log("\n  Other analyzer literals vs grammar:")
  for (const lit of LITERALS) {
    if (registered.includes(lit)) continue
    console.log(`    ${lit.padEnd(28)} ${nodeTypes.has(lit) ? "present" : "ABSENT"}`)
  }

  console.log("\n=== TARGETED SOURCES: what the grammar really produces ===")
  const parser = new Parser()
  parser.setLanguage(lang)
  const seen = new Set<string>()
  for (const t of TARGETED) {
    const tree = parser.parse(t.source)
    const types = new Set<string>()
    collectTypes(tree.rootNode, types, new Set())
    for (const ty of types) seen.add(ty)
    const errs: string[] = []
    const walk = (n: any) => {
      if (n.type === "ERROR" || n.isMissing) errs.push(`line ${n.startPosition.row + 1}: ${n.type}`)
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
    }
    walk(tree.rootNode)
    console.log(`\n  [${t.label}]`)
    console.log(`    src: ${JSON.stringify(t.source.slice(0, 70))}`)
    console.log(`    types: ${[...types].sort().join(" ")}`)
    if (errs.length) console.log(`    ERRORS: ${errs.join("; ")}`)
    tree.delete?.()
  }
  parser.delete?.()

  console.log("\n=== NODE TYPES THE GRAMMAR HAS THAT NO TARGETED SOURCE REACHED ===")
  const missed = [...nodeTypes].filter((t) => !seen.has(t) && !t.endsWith("_literal") && !t.startsWith("_")).sort()
  console.log(`  ${missed.join(" ")}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
