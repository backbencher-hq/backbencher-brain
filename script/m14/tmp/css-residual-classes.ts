// Review instrument (NOT a gate): name the CSS lane's RESIDUAL parse-failure
// classes — the rows `css-parse-classes.ts` could not classify — so the residue
// is a closed list rather than a mood.
//
//   bun script/m14/tmp/css-residual-classes.ts
//
// Every class gets a MINIMAL REPRODUCTION and the pinned grammar's measured
// verdict on it. A class whose repro parses cleanly is not a grammar gap and is
// reported as such, because that is the class worth chasing.

import { Parser, Language } from "web-tree-sitter"
import { readFileSync } from "fs"

// `Language.load` needs the core initialised first. Every css instrument in this
// directory got this wrong at least once, and the failure mode is a bare
// `loadWebAssemblyModule is not a function` that says nothing about the cause.
await Parser.init()

const lang = await Language.load(readFileSync("wasm/tree-sitter-css.wasm"))
const p = new Parser()
p.setLanguage(lang)

const CASES: { id: string; src: string; note: string }[] = [
  { id: "css-vars", src: "", note: "read from the corpus file" },
  { id: "custom-pseudo-element", src: "selectedcontent:where(.svelte-xyz) &{ color: green; }\n", note: "an unknown/custom pseudo-element written without `::`" },
  { id: "unicode-identifier-selector", src: "#\\31\\32\\33 .x{ color: green; }\n", note: "an escaped unicode id in a selector" },
  { id: "import-only-file", src: '@import "custom.css";\n', note: "a stylesheet whose only content is an @import" },
  { id: "import-then-rules", src: '@import "custom.css";\n.a { color: red; }\n', note: "an @import followed by rules" },
  { id: "import-layer", src: '@import "a.css" layer(base);\n', note: "CSS Cascade 5 import layer()" },
  { id: "import-supports", src: '@import "a.css" supports(display: grid);\n', note: "CSS Cascade 5 import supports()" },
  { id: "import-media-layer", src: '@import "a.css" screen layer(base);\n', note: "import media + layer together" },
  { id: "import-no-trailing-newline", src: '@import "custom.css";', note: "no trailing newline" },
  { id: "empty-custom-prop", src: ":root { --foo: ; }\n", note: "an empty custom-property value" },
  { id: "progid-filter", src: ".a { filter: progid:DXImageTransform.Microsoft.gradient(startColorStr='#aaa'); }\n", note: "IE vendor hack" },
  { id: "attr-case-flag", src: "p[type='B' i] { color: red; }\n", note: "Selectors 4 case-sensitivity flag" },
  { id: "attr-case-flag-s", src: "p[type='B' s] { color: red; }\n", note: "Selectors 4 case-sensitivity flag (s)" },
  { id: "range-media", src: "@media (width >= 600px) { .a { color: red; } }\n", note: "Media Queries 4 range syntax" },
  { id: "range-media-double", src: "@media (400px <= width <= 1000px) { .a { color: red; } }\n", note: "Media Queries 4 double range" },
  { id: "media-not", src: "@media not print { .a { color: red; } }\n", note: "Media Queries 4 `not`" },
  { id: "media-selector-fn", src: "@media selector(.a) { .b { color: red; } }\n", note: "Media Queries 5 selector()" },
  { id: "named-container", src: "@container test (min-width: 410px) { .a { color: red; } }\n", note: "a NAMED container query" },
  { id: "unnamed-container", src: "@container (min-width: 410px) { .a { color: red; } }\n", note: "an unnamed container query" },
  { id: "container-style-fn", src: "@container style(--x: 1) { .a { color: red; } }\n", note: "container style() query" },
  { id: "page-pseudo", src: "@page :left { margin: 1in; }\n", note: "named pages" },
  { id: "html-comment", src: "<!-- /* c */ -->\n.a { color: red; }\n", note: "legacy HTML comment wrapper" },
  { id: "nesting-amp-amp", src: ".a { & & { color: red; } }\n", note: "`& &` nesting" },
  { id: "nesting-amp-element", src: ".a { &div { color: red; } }\n", note: "`&div` nesting" },
  { id: "nesting-amp-combinator", src: ".a { & > .b { color: red; } }\n", note: "`& >` nesting" },
  { id: "braces-in-content", src: '.a::after { content: "{};[]"; }\n', note: "structural characters in a content string" },
  { id: "double-semicolon", src: ".a { font-family: a, b;; }\n", note: "a stray second `;`" },
  { id: "selectedcontent", src: "::selectedcontent { color: red; }\n", note: "Selectors 4 ::selectedcontent" },
  { id: "picker-pseudo", src: "::picker(select) { color: red; }\n", note: "Selectors 4 ::picker()" },
  { id: "unicode-range-selector", src: "#\\31 { color: red; }\n", note: "an escaped unicode id alone" },
]

const CSS_VARS = "/home/ishaq2321/bb_tests/repositories/svelte/packages/svelte/tests/css/samples/css-vars/expected.css"

function verdict(src: string) {
  const t = p.parse(src)
  let err = 0
  let missing = 0
  const kinds: string[] = []
  const lines = src.split("\n")
  const w = (x: any) => {
    if (x.type === "ERROR") { err++; if (kinds.length < 3) kinds.push(`ERROR@${x.startPosition.row + 1} ${JSON.stringify((lines[x.startPosition.row] ?? "").trim().slice(0, 60))}`) }
    if (x.isMissing) { missing++; if (kinds.length < 3) kinds.push(`MISSING ${x.type}@${x.startPosition.row + 1}`) }
    for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c) w(c) }
  }
  w(t.rootNode)
  const r = { hasError: t.rootNode.hasError, errNodes: err, missingNodes: missing, firstRegion: kinds }
  t.delete?.()
  return r
}

const out: any[] = []
for (const c of CASES) {
  const src = c.id === "css-vars" ? readFileSync(CSS_VARS, "utf8") : c.src
  const v = verdict(src)
  out.push({ ...c, src: c.id === "css-vars" ? "<corpus file>" : JSON.stringify(c.src), ...v, class: v.hasError ? "GRAMMAR-LIMITATION" : "PARSES-CLEAN" })
}

const parseClean = out.filter((r) => !r.hasError)
const limit = out.filter((r) => r.hasError)
console.log(`=== ${out.length} residual candidates: ${limit.length} grammar limitations, ${parseClean.length} parse clean (so NOT a grammar gap) ===\n`)
console.log("GRAMMAR LIMITATION (pinned wasm cannot represent it):")
for (const r of limit) console.log(`  ${r.id.padEnd(30)} err=${r.errNodes} miss=${r.missingNodes}  ${r.note}\n      ${r.firstRegion.join("\n      ")}`)
console.log("\nPARSES CLEAN (a failure on these is not the grammar's fault):")
for (const r of parseClean) console.log(`  ${r.id.padEnd(30)} ${r.note}`)
p.delete?.()
