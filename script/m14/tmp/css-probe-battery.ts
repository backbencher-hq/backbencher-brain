// Review instrument (NOT a gate): CSS defect-class probe battery.
//
//   bun script/m14/tmp/css-probe-battery.ts [--out <path>]
//
// Method is the M60 adversarial-round method: reconstruct corpus-ABSENT
// constructs through the production parseFile pipeline and apply the #841
// two-question form to every one —
//   Q1  grammar error?  (a construct the pinned wasm cannot represent is a
//       grammar limitation, not an analyzer defect)
//   Q2  extraction loss?  (a construct that parses cleanly and still produces
//       no symbol / no edge / a wrong edge IS an analyzer defect)
//
// Every probe prints the ANSWER, never a verdict about the repo. The artifact
// is the BEFORE/AFTER pin for the CSS lane: every defect class fixed in the
// waves must turn its own probe row, and no other row may move.


import { ASTEngine } from "../../../src/ast/engine"

interface Probe {
  id: string
  hypothesis: string
  src: string
}

const P = (id: string, hypothesis: string, src: string): Probe => ({ id, hypothesis, src })

const PROBES: Probe[] = [
  // --- media query shapes: the analyzer's findChild list is a literal union ---
  P("media-feature", "a plain feature_query media query is scoped (baseline behaviour)", "@media (max-width: 700px) { .a { color: red; } }\n"),
  P("media-keyword", "a bare keyword_query media query (@media print) is scoped", "@media print { .a { color: red; } }\n"),
  P("media-binary", "a binary_query media query is scoped", "@media (400px <= width <= 700px) { .a { color: red; } }\n"),
  P("media-unary-NOT", "@media not (...) is a unary_query — is the scope still recorded?", "@media not print { .a { color: red; } }\n"),
  P("media-selector-query", "@media selector(.a) is a selector_query — is the scope recorded?", "@media selector(.a) { .b { color: red; } }\n"),
  P("media-nested", "a nested @media composes the outer scope with ' and '", "@media screen { @media (min-width: 700px) { .a { color: red; } } }\n"),
  P("media-nested-in-not", "a nested @media inside a unary_query @media", "@media not print { @media (min-width: 700px) { .a { color: red; } } }\n"),

  // --- @container identity ---
  P("container-plain", "@container (min-width: 400px) — what is the scope symbol named?", "@container (min-width: 400px) { .a { color: red; } }\n"),
  P("container-named", "@container card (min-width: 400px) — scope symbol name?", "@container card (min-width: 400px) { .a { color: red; } }\n"),
  P("container-TWO-in-one-file", "two @container blocks in one file — do the scope symbols collide?", "@container (min-width: 400px) { .a { color: red; } }\n@container (min-width: 900px) { .b { color: blue; } }\n"),
  P("container-style-query", "@container style(--x: 1) — scope symbol name?", "@container style(--x: 1) { .a { color: red; } }\n"),

  // --- @layer identity ---
  P("layer-named", "@layer base — a resolvable scope symbol", "@layer base { .a { color: red; } }\n"),
  P("layer-anon-block", "@layer { .a { color: red; } } — anonymous layer block", "@layer { .a { color: red; } }\n"),
  P("layer-TWO-same-name", "two @layer base blocks — symbol collision?", "@layer base { .a { color: red; } }\n@layer base { .b { color: blue; } }\n"),

  // --- @supports ---
  P("supports-simple", "@supports is emitted as a symbol (interface)", "@supports (display: grid) { .a { display: grid; } }\n"),
  P("supports-selector-fn", "@supports selector(:has(a))", "@supports selector(:has(a)) { .a { color: red; } }\n"),
  P("supports-and", "@supports (a: b) and (c: d) — symbol name", "@supports (display: grid) and (color: red) { .a { color: red; } }\n"),
  P("supports-not", "@supports not (display: grid) — symbol name", "@supports not (display: grid) { .a { color: red; } }\n"),
  P("supports-nested", "@supports inside @media — does the media scope survive?", "@media print { @supports (display: grid) { .a { color: red; } } }\n"),

  // --- keyframes / animation ---
  P("keyframes-plain", "@keyframes name is a symbol", "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }\n"),
  P("keyframes-quoted", "@keyframes \"fade\" (quoted name)", "@keyframes \"fade\" { from { opacity: 0; } to { opacity: 1; } }\n"),
  P("keyframes-pct", "@keyframes with 0%/50% selectors", "@keyframes f { 0% { opacity: 0; } 100% { opacity: 1; } }\n"),
  P("animation-ref", "animation: f resolves to the keyframes symbol", "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }\n.a { animation: fade 1s; }\n"),
  P("animation-ref-quoted", "animation: \"fade\" (quoted) resolves?", "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }\n.a { animation: \"fade\" 1s; }\n"),
  P("animation-name-list", "animation-name: a, b (comma list) resolves both?", "@keyframes a { from { opacity: 0; } to { opacity: 1; } }\n@keyframes b { from { opacity: 0; } to { opacity: 1; } }\n.x { animation-name: a, b; }\n"),
  P("animation-none", "animation: none 1s — a keyword, must NOT fabricate an edge", ".x { animation: none 1s; }\n"),
  P("keyframes-forward-ref", "animation used BEFORE the @keyframes declaration", ".x { animation: fade 1s; }\n@keyframes fade { from { opacity: 0; } to { opacity: 1; } }\n"),

  // --- custom properties / var() ---
  P("custom-prop", "--x is a variable symbol contained by its selector", ":root { --x: 1px; }\n"),
  P("custom-prop-var-ref", "var(--x) emits a references edge that resolves", ":root { --x: 1px; }\n.a { color: var(--x); }\n"),
  P("custom-prop-nested-var", "var(--a) where --a: var(--b) — is the transitive edge seen?", ":root { --b: 1px; --a: var(--b); }\n.x { color: var(--a); }\n"),
  P("custom-prop-fallback", "var(--x, #fff) — the fallback must not become a target", ":root { --x: 1px; }\n.a { color: var(--x, #fff); }\n"),
  P("custom-prop-undefined", "var(--never-declared) — a dangling reference is honest", ".a { color: var(--never-declared); }\n"),
  P("custom-prop-two-selectors", "--x declared twice in different scopes", ":root { --x: 1px; }\n.card { --x: 2px; }\n"),
  P("custom-prop-shorthand", "--x in a shorthand declaration", ":root { --pad: 4px; }\n.a { padding: var(--pad); }\n"),

  // --- scss / less / postcss: the declared-gap claim ---
  P("scss-mixin", "@mixin in a .css file — symbol + mixinNames", "@mixin card { border: 1px; }\n"),
  P("scss-include", "@include in a .css file — emits a uses edge to @mixin X?", "@mixin card { border: 1px; }\n.a { @include card; }\n"),
  P("scss-include-undeclared", "@include of an undeclared mixin", ".a { @include nope; }\n"),
  P("scss-var", "$x: 1 — is an SCSS variable symbol emitted?", "$x: 1px;\n.a { color: $x; }\n"),
  P("less-var", "@x: 1 — is a LESS variable symbol emitted?", "@x: 1px;\n.a { color: @x; }\n"),
  P("postcss-custom-selector", "@custom-selector :--h h1", "@custom-selector :--heading h1, h2;\n"),

  // --- at-rules the whitelist never names ---
  P("at-font-face", "@font-face — is the declared font family a symbol?", "@font-face { font-family: Inter; src: url(i.woff2); }\n"),
  P("at-property", "@property --x — is the custom-property REGISTRATION seen?", "@property --x { syntax: '<length>'; inherits: false; initial-value: 0px; }\n"),
  P("at-scope", "@scope (.a) to (.b) — a scoping construct with no case", "@scope (.a) to (.b) { .c { color: red; } }\n"),
  P("at-namespace", "@namespace svg url(...) — a URL reference", "@namespace svg url(http://www.w3.org/2000/svg);\n"),
  P("at-charset", "@charset", "@charset \"utf-8\";\n"),
  P("at-page", "@page :first", "@page :first { margin: 1in; }\n"),
  P("at-starting-style", "@starting-style", "@starting-style { .a { opacity: 0; } }\n"),
  P("at-position-try", "@position-try --x", "@position-try --x { top: 0; }\n"),
  P("at-tailwind-apply", "@apply — does @apply become a symbol?", ".a { @apply flex; }\n"),
  P("at-tailwind-theme", "@theme { --brand: red }", "@theme { --brand: red; }\n"),
  P("at-config", "@config", "@config \"./tailwind.config.js\";\n"),
  P("at-use-forward", "@use / @forward (sass module system)", "@use \"sass:math\";\n@forward \"src/list\";\n"),
  P("at-unknown-generic", "an unknown at-rule must not crash or fabricate", "@totally-unknown foo { .a { color: red; } }\n"),

  // --- imports ---
  P("import-url", "@import url(\"a.css\") — import + references edge", "@import url(\"a.css\");\n"),
  P("import-bare-string", "@import \"a.css\"", "@import \"a.css\";\n"),
  P("import-media", "@import \"a.css\" print", "@import \"a.css\" print;\n"),
  P("import-layer-supports", "@import url(a.css) layer(base) supports(display:grid) screen", "@import url(a.css) layer(base) supports(display: grid) screen;\n"),
  P("import-TWO-same-file", "two @imports of the same file — duplicate edge?", "@import url(\"a.css\");\n@import url(\"a.css\");\n"),
  P("import-remote", "@import url(https://x/y.css)", "@import url(\"https://fonts.example/y.css\");\n"),
  P("import-tailwind", "@import \"tailwindcss\" — framework detection", "@import \"tailwindcss\";\n"),

  // --- selectors: chain identity, kinds, reset suppression ---
  P("sel-chain-tag", "`.a .b` — does the chain edge resolve to real symbols?", ".a .b { color: red; }\n"),
  P("sel-chain-id", "`.a #b` — the id branch of the chain", ".a #b { color: red; }\n"),
  P("sel-chain-universal", "`.a *` — the universal branch of the chain", ".a * { color: red; }\n"),
  P("sel-chain-combinator", "`.a > .b` — child combinator chain", ".a > .b { color: red; }\n"),
  P("sel-chain-attr", "`.a [href]` — attribute branch of the chain", ".a [href] { color: red; }\n"),
  P("sel-comma-group", "`.a, .b { }` — one symbol or two?", ".a, .b { color: red; }\n"),
  P("sel-reset-mixed", "reset + real selector in one group — is the real one kept?", "*, .real { color: red; }\n"),
  P("sel-reset-comma-real", "`.real, * { }` — reset suppression must not eat .real", ".real, * { color: red; }\n"),
  P("sel-nested-amp-suffix", "`.a { &:hover { } }` — the '&' suffix form", ".a { &:hover { color: red; } }\n"),
  P("sel-nested-amp-bare", "`.a { & { } }` — a bare nested '&'", ".a { & { color: red; } }\n"),
  P("sel-nested-multi-parent", "`.a, .b { & .c { } }` — two parents × one child", ".a, .b { & .c { color: red; } }\n"),
  P("sel-css-module-local", ":local(.a) — isCssModule detection", ":local(.a) { color: red; }\n"),
  P("sel-css-module-composes", "composes: b — a composition edge", ".a { composes: b; }\n"),
  P("sel-important", "!important — pattern + maintainability penalty", ".a { color: red !important; }\n"),
  P("sel-deep-nest", "four levels of nesting", ".a { .b { .c { .d { color: red; } } } }\n"),

  // --- values / functions ---
  P("fn-calc", "calc() with var()", ".a { width: calc(var(--x) * 2); }\n"),
  P("fn-url", "url() in a value — is it an import/reference?", ".a { background: url(img.png); }\n"),
  P("fn-color-mix", "color-mix()", ".a { color: color-mix(in srgb, red, blue); }\n"),
  P("fn-nested-var-in-fn", "var() nested inside another function", ".a { width: calc(var(--x) * 2px); }\n"),
  P("fn-unknown", "an unknown function in a value", ".a { transform: frobnicate(3); }\n"),
  P("value-multi-comma", "a multi-value declaration", ".a { font-family: a, b, c; }\n"),

  // --- cross-cutting: what the analyzer calls "exports" ---
  P("exports-everything", "top-level selectors become exports — what is exported?", ".a { color: red; }\n.b { color: blue; }\n"),
  P("exports-nested", "is a nested selector exported?", ".a { .b { color: red; } }\n"),
  P("empty-stylesheet", "an empty file", ""),
  P("comment-only", "a comment-only file", "/* just a comment */\n"),
  P("no-rules", "a file with only @charset", "@charset \"utf-8\";\n"),
]

async function run(p: Probe) {
  const tmp = `/tmp/opencode/css-probe/${p.id}.css`
  const { writeFileSync, mkdirSync } = await import("fs")
  mkdirSync("/tmp/opencode/css-probe", { recursive: true })
  writeFileSync(tmp, p.src)
  let res: any
  let thrown: string | null = null
  try {
    res = await ASTEngine.parseFile(tmp, p.src)
  } catch (e) { thrown = String(e).slice(0, 160) }
  if (thrown) return { id: p.id, hypothesis: p.hypothesis, crashed: thrown }
  const syms = (res.symbols ?? []).map((s: any) => `${s.kind}:${JSON.stringify(s.name)}${s.scope ? ` scope=${JSON.stringify(s.scope)}` : ""}`)
  const rels = (res.relationships ?? []).map((r: any) => `${r.type} ${JSON.stringify(r.source)} -> ${JSON.stringify(r.target)}`)
  const symNames = new Set((res.symbols ?? []).map((s: any) => s.name))
  const resolved = rels.filter((r: string) => {
    const m = /"((?:[^"\\]|\\.)*)" -> "((?:[^"\\]|\\.)*)"$/.exec(r)
    if (!m) return false
    return symNames.has(JSON.parse(`"${m[1]}"`))
  }).length
  return {
    id: p.id,
    hypothesis: p.hypothesis,
    grammarError: (res.errors?.length ?? 0) > 0 ? res.errors.length : 0,
    symbols: syms,
    relationships: rels,
    resolvedTargets: `${resolved}/${rels.length}`,
    exports: (res.exports ?? []).map((e: any) => e.name),
    imports: (res.imports ?? []).map((i: any) => i.module),
    patterns: res.metadata?.patterns ?? [],
    frameworks: res.metadata?.detectedFrameworks ?? [],
  }
}

async function main() {
  await ASTEngine.init?.()
  const out: any[] = []
  for (const p of PROBES) {
    out.push(await run(p))
  }
  const artifact = {
    instrument: "css-probe-battery",
    method:
      "M60 adversarial-round method. Every construct is reconstructed through the production ASTEngine.parseFile pipeline. The #841 two-question form separates a grammar limitation (Q1: the pinned wasm cannot represent it) from an analyzer defect (Q2: it parses cleanly and the analyzer still loses or fabricates).",
    wasm: "wasm/tree-sitter-css.wasm",
    probeCount: PROBES.length,
    summary: {
      crashed: out.filter((r) => r.crashed).length,
      grammarError: out.filter((r) => !r.crashed && r.grammarError > 0).length,
      cleanParse: out.filter((r) => !r.crashed && r.grammarError === 0).length,
      zeroSymbols: out.filter((r) => !r.crashed && r.symbols.length === 0).length,
      withRelationships: out.filter((r) => !r.crashed && r.relationships.length > 0).length,
    },
    probes: out,
  }
  const text = JSON.stringify(artifact, null, 2)
  const outPath = process.argv[process.argv.indexOf("--out") + 1]
  if (outPath && outPath !== "undefined") {
    const { writeFileSync } = await import("fs")
    writeFileSync(outPath, text + "\n")
    process.stderr.write(`wrote ${outPath}\n`)
  }
  console.log(text)
}

main().catch((e) => { console.error(e); process.exit(1) })
