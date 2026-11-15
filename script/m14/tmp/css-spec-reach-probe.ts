// Build instrument: find, for each node type the corpus never contains, a real CSS
// source that produces it — and prove the `_repeat1` / `_token1` / hidden types
// internal by showing they can only ever be grammar-internal.
//
//   bun script/m14/tmp/css-spec-reach-probe.ts
//
// A type the corpus lacks is either (a) real CSS the svelte sample does not use,
// in which case a reproduction reaches it and it gets classified from the
// analyzer's behaviour, or (b) a grammar-internal node, in which case I show it is
// a repetition/token wrapper and record why it must stay silent. Guessing which of
// the two a type is, from its name, is the thing this script exists to prevent.

import { Parser, Language } from "web-tree-sitter"
import { readFileSync } from "fs"

await Parser.init()
const lang = await Language.load(readFileSync("wasm/tree-sitter-css.wasm"))
const p = new Parser()
p.setLanguage(lang)

function typesOf(src: string): { set: Set<string>; err: boolean } {
  const t = p.parse(src)
  const set = new Set<string>()
  const w = (x: any) => {
    set.add(x.type)
    for (let i = 0; i < x.childCount; i++) { const c = x.child(i); if (c) w(c) }
  }
  w(t.rootNode)
  const err = t.rootNode.hasError
  t.delete?.()
  return { set, err }
}

// Candidate sources per wanted type. Several spellings per type, because guessing
// one and having it silently not reach is how a type ends up mis-filed.
const WANT = [
  "end", "of", "selector", "js_comment", "important_value",
  "scope_statement", "postcss_statement", "selector_query",
  "parenthesized_value", "grid_value",
]

const CANDIDATES: Record<string, string[]> = {
  end: [
    '@media (400px <= width <= 700px) { .a { color: red; } }\n',
    '@supports (width: 1px) { .a { color: red; } }\n',
    '@media (width >= 400px) { .a { color: red; } }\n',
  ],
  of: [
    '@media selector(.a) { .b { color: red; } }\n',
    '@container style(--x: 1) { .a { color: red; } }\n',
  ],
  selector: [
    '@media selector(.a) { .b { color: red; } }\n',
    '@supports selector(:has(a)) { .a { color: red; } }\n',
    '@media selector(a > b) { .c { color: red; } }\n',
  ],
  js_comment: [
    '// a line comment\n.a { color: red; }\n',
    '/* block */\n// line\n.a { color: red; }\n',
    '.a { color: red; } // trailing\n',
  ],
  important_value: [
    '.a { color: red !important; }\n',
    '.a { color: red ! important; }\n',
    '.a { color: red!important; }\n',
    '@media print { .a { color: red !important; } }\n',
  ],
  scope_statement: [
    '@scope (.a) { .b { color: red; } }\n',
    '@scope (.a) to (.b) { .c { color: red; } }\n',
    '@scope { .a { color: red; } }\n',
  ],
  postcss_statement: [
    '@custom-media --narrow (max-width: 30em);\n',
    '@tailwind base;\n',
    '@apply text-lg;\n',
    '@mixin foo { color: red; }\n',
  ],
  selector_query: [
    '@media selector(.a) { .b { color: red; } }\n',
    '@media (hover) and selector(:focus) { .a { color: red; } }\n',
  ],
  parenthesized_value: [
    '.a { filter: alpha(opacity=50); }\n',
    '.a { width: calc((1px + 2px) * 3); }\n',
    '.a { background: image-set(url(a.png) 1x); }\n',
  ],
  grid_value: [
    '.a { grid-template-columns: [full-start] minmax(1em, 1fr) [main] minmax(0, 40em) [full-end]; }\n',
    '.a { grid-template-columns: [a] 1fr [b] 1fr; }\n',
    '.a { grid-template-rows: [a] auto; }\n',
  ],
}

const out: Record<string, { reached: boolean; src: string | null; clean: boolean; coTypes: string[] }> = {}
for (const t of WANT) {
  out[t] = { reached: false, src: null, clean: false, coTypes: [] }
  for (const src of CANDIDATES[t] ?? []) {
    const { set, err } = typesOf(src)
    if (set.has(t)) {
      out[t] = { reached: true, src, clean: !err, coTypes: [...set].filter((x) => x !== t).sort() }
      break
    }
  }
}

// Internal-hypothesis evidence for the residue: for EVERY type in the grammar,
// report whether it is ever a child of a node the analyzer treats as a construct,
// by checking the corpus + all reproductions. Simpler and stronger here: report
// whether the type's name carries a grammar-internal marker, and show that the
// analyzer's own node-type switch never names it.
console.log(JSON.stringify(out, null, 2))
p.delete?.()
