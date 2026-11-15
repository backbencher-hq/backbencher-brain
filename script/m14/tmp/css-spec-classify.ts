// Build instrument: enumerate the pinned wasm's node-type enumeration and, for
// each type, MEASURE how the analyzer treats it — which of the four spec buckets
// it belongs in. Run from the repo root:
//
//   bun script/m14/tmp/css-spec-classify.ts > /tmp/opencode/css-spec-raw.json
//
// The point is that the classification is not an opinion about a type's NAME. For
// every type the script asks three questions of the production pipeline:
//   handled_verified — does a source that exercises it produce a symbol, an edge,
//                      or a pattern?  (and is the shape the analyzer relies on)
//   internal_silent  — does it produce nothing, and is that correct?
//   gap              — does it parse cleanly and STILL produce nothing that a CSS
//                      author would expect?
// and it records the evidence, so the spec file is a set of measurements with the
// odd judgement in `design_decision` written out rather than assumed.

import { Parser, Language } from "web-tree-sitter"
import { readFileSync, mkdirSync, writeFileSync } from "fs"
import { ASTEngine } from "../../../src/ast/engine"

await Parser.init()
const lang = await Language.load(readFileSync("wasm/tree-sitter-css.wasm"))
const p = new Parser()
p.setLanguage(lang)

const ALL: string[] = []
for (let i = 0; i < lang.nodeTypeCount; i++) ALL.push(lang.nodeTypeForId(i))

/** A source that exercises each type, where the grammar can reach it. */
const EXERCISE: Record<string, string> = {
  stylesheet: '.a { color: red; }\n',
  rule_set: '.a { color: red; }\n',
  selectors: '.a { color: red; }\n',
  block: '.a { color: red; }\n',
  declaration: '.a { color: red; }\n',
  property_name: '.a { color: red; }\n',
  plain_value: '.a { color: red; }\n',
  integer_value: '.a { width: 1px; }\n',
  float_value: '.a { line-height: 1.5; }\n',
  unit: '.a { width: 1px; }\n',
  string_value: '.a { content: "x"; }\n',
  string_content: '.a { content: "x"; }\n',
  call_expression: '.a { width: calc(1px + 2px); }\n',
  function_name: '.a { width: calc(1px); }\n',
  arguments: '.a { width: calc(1px); }\n',
  binary_expression: '.a { width: calc(1px + 2px); }\n',
  important: '.a { color: red !important; }\n',
  important_value: '.a { color: red !important; }\n',
  comment: '/* c */\n.a { color: red; }\n',
  js_comment: '/* c */\n.a { color: red; }\n',
  class_selector: '.a { color: red; }\n',
  class_name: '.a { color: red; }\n',
  identifier: '.a { color: red; }\n',
  id_selector: '#a { color: red; }\n',
  id_name: '#a { color: red; }\n',
  tag_name: 'a { color: red; }\n',
  universal_selector: '* { box-sizing: border-box; }\n',
  attribute_selector: 'a[href] { color: red; }\n',
  attribute_name: 'a[href] { color: red; }\n',
  pseudo_class_selector: '.a:hover { color: red; }\n',
  pseudo_class_arguments: '.a:not(.b) { color: red; }\n',
  pseudo_element_selector: '.a::before { content: ""; }\n',
  nesting_selector: '.a { & .b { color: red; } }\n',
  child_selector: '.a > .b { color: red; }\n',
  descendant_selector: '.a .b { color: red; }\n',
  sibling_selector: '.a ~ .b { color: red; }\n',
  adjacent_sibling_selector: '.a + .b { color: red; }\n',
  namespace_selector: 'svg|a { color: red; }\n',
  keyframes_statement: '@keyframes f { from { opacity: 0; } }\n',
  keyframes_name: '@keyframes f { from { opacity: 0; } }\n',
  keyframe_block_list: '@keyframes f { from { opacity: 0; } }\n',
  keyframe_block: '@keyframes f { from { opacity: 0; } }\n',
  keyframe_selector: '@keyframes f { 0% { opacity: 0; } }\n',
  from: '@keyframes f { from { opacity: 0; } }\n',
  to: '@keyframes f { to { opacity: 1; } }\n',
  media_statement: '@media print { .a { color: red; } }\n',
  keyword_query: '@media print { .a { color: red; } }\n',
  binary_query: '@media screen and (min-width: 1px) { .a { color: red; } }\n',
  feature_query: '@media (min-width: 1px) { .a { color: red; } }\n',
  parenthesized_query: '@media (min-width: 1px) { .a { color: red; } }\n',
  parenthesized_value: '.a { filter: alpha(opacity=1); }\n',
  unary_query: '@media not print { .a { color: red; } }\n',
  selector_query: '@media selector(.a) { .b { color: red; } }\n',
  feature_name: '@media (min-width: 1px) { .a { color: red; } }\n',
  supports_statement: '@supports (display: grid) { .a { display: grid; } }\n',
  import_statement: '@import "a.css";\n',
  at_rule: '@layer base { .a { color: red; } }\n',
  at_keyword: '@layer base { .a { color: red; } }\n',
  charset_statement: '@charset "utf-8";\n',
  namespace_statement: '@namespace svg url(http://www.w3.org/2000/svg);\n',
  namespace_name: '@namespace svg url(x);\n',
  scope_statement: '@scope (.a) { .b { color: red; } }\n',
  postcss_statement: '@custom-media --n (min-width: 1px);\n',
  grid_value: '.a { grid-template-columns: [a] 1px [b] 1px; }\n',
  color_value: '.a { color: #ff0000; }\n',
  escape_sequence: '.a\\:b { color: red; }\n',
  // Reached only after reading the grammar, not by guessing: `of` belongs to
  // nth-child's selector list (`nth-child(odd of .b)`), and the `2n of .a, .b`
  // spelling that reads more naturally does NOT parse clean in this grammar.
  of: '.a:nth-child(odd of .b) { color: red; }\n',
  // `important_value` is the non-standard-`!foo` fallback. It is only ever
  // produced INSIDE an error subtree — recorded with grammarClean:false rather
  // than hidden, because "reachable" and "usable" are different claims.
  important_value: '.a { color: red !urgent; }\n',
  // Reached by the reach probe but absent here, so its parent was never observed;
  // without this row it could only be filed as unexamined.
  parenthesized_value: '.a { width: calc((1px + 2px) * 3); }\n',
}

function collectTypes(src: string): { types: Set<string>; hasError: boolean; errLines: string[]; parents: Map<string, Set<string>> } {
  const t = p.parse(src)
  const types = new Set<string>()
  const parents = new Map<string, Set<string>>()
  const errLines: string[] = []
  const w = (x: any, d = 0) => {
    types.add(x.type)
    if ((x.type === "ERROR" || x.isMissing) && errLines.length < 3) errLines.push(`L${x.startPosition.row + 1}`)
    if (d < 40) for (let i = 0; i < x.childCount; i++) {
      const c = x.child(i)
      if (!c) continue
      if (!parents.has(c.type)) parents.set(c.type, new Set())
      parents.get(c.type)!.add(x.type)
      w(c, d + 1)
    }
  }
  w(t.rootNode)
  const r = { types, hasError: t.rootNode.hasError, errLines, parents }
  t.delete?.()
  return r
}

mkdirSync("/tmp/opencode/css-spec", { recursive: true })

const rows: any[] = []
for (const t of ALL) {
  const src = EXERCISE[t]
  if (src === undefined) {
    rows.push({ type: t, reachable: false, note: "no minimal reproduction in this instrument's table — every other type was reached" })
    continue
  }
  const f = `/tmp/opencode/css-spec/${t.replace(/[^\w]/g, "_")}.css`
  writeFileSync(f, src)
  const tree = collectTypes(src)
  let syms = 0, rels = 0, pats = 0, errs = 0, crash = ""
  try {
    const r: any = await ASTEngine.parseFile(f, src)
    syms = r.symbols?.length ?? 0
    rels = r.relationships?.length ?? 0
    pats = r.metadata?.patterns?.length ?? 0
    errs = r.errors?.length ?? 0
  } catch (e) {
    // A CRASH must not read as "emits nothing" — that is how a type gets filed as
    // internal_silent when the truth is that the pipeline threw on it. Record it
    // as its own field so the spec writer can never mistake silence for silence.
    crash = String((e as Error)?.message ?? e)
  }
  rows.push({
    type: t,
    reachable: tree.types.has(t),
    grammarClean: !tree.hasError,
    crash: crash || null,
    parents: [...(tree.parents.get(t) ?? [])].sort(),
    emits: { symbols: syms, relationships: rels, patterns: pats, errors: errs },
  })
}

const unreachable = rows.filter((r) => !r.reachable)
console.log(JSON.stringify({
  nodeTypeCount: ALL.length,
  named: ALL.filter((t) => /^[a-z_][\w]*$/.test(t)).length,
  anonymous: ALL.filter((t) => !/^[a-z_][\w]*$/.test(t)).length,
  reachedByReproduction: rows.filter((r) => r.reachable).length,
  notReached: unreachable.length,
  notReachedTypes: unreachable.map((r) => r.type),
  rows: rows.filter((r) => r.reachable),
}, null, 2))
p.delete?.()
