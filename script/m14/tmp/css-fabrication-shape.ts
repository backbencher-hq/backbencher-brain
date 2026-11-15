// Review instrument (NOT a gate): dump the exact tree for a construct the
// analyzer fabricates symbols from, so the suppression rule is written against
// the tree's real shape and not against an assumption about it.
//
//   bun script/m14/tmp/css-fabrication-shape.ts
//
// The case: `@keyframes "fade" { from {…} to {…} }` is a GRAMMAR ERROR under the
// pinned wasm, and the analyzer emitted three symbols from it —
// `class:"\"fade\""` plus one per `from`/`to` block — with quote characters baked
// into names that are written on no valid line of the file. The first attempt at
// a suppression rule ("skip the subtree of any node that IS an error") did not
// fire, because the broken region is not shaped the way that assumed. This
// instrument shows what it actually is.

import { Parser, Language } from "web-tree-sitter"
import { readFileSync } from "fs"

await Parser.init()
const lang = await Language.load(readFileSync("wasm/tree-sitter-css.wasm"))
const p = new Parser()
p.setLanguage(lang)

const CASES: { label: string; src: string }[] = [
  { label: 'keyframes with a QUOTED name (grammar ERROR)', src: '@keyframes "fade" { from { opacity: 0; } to { opacity: 1; } }\n' },
  { label: 'keyframes unquoted (control — must stay extractable)', src: "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }\n" },
  { label: 'spaced-equals value (grammar ERROR)', src: "X { foo: a = b; }\n" },
  { label: 'spaced-equals inside a bigger rule', src: "body { margin: 0; filter: progid:DXImageTransform.Microsoft.gradient(startColorStr = '#aaa'); color: red; }\n" },
  { label: 'import with an unreadable qualifier (ERROR is a CHILD)', src: '@import "a.css" layer(base);\n' },
  { label: 'attr case flag (grammar ERROR)', src: "p[type='B' i] { color: red; }\n" },
]

for (const c of CASES) {
  const t = p.parse(c.src)
  console.log(`\n${"=".repeat(76)}\n${c.label}`)
  console.log(`  src: ${JSON.stringify(c.src)}`)
  console.log(`  root.hasError = ${t.rootNode.hasError}`)
  const walk = (n: any, d = 0) => {
    const flags = [
      n.type === "ERROR" ? "IS-ERROR" : "",
      n.isMissing ? "IS-MISSING" : "",
      n.hasError ? "hasError" : "",
    ].filter(Boolean).join(" ")
    console.log(`  ${"  ".repeat(d)}${n.type}${n.isNamed ? "" : " (anon)"}  ${flags ? "[" + flags + "]" : ""}  ${JSON.stringify(n.text.length > 44 ? n.text.slice(0, 44) + "…" : n.text)}`)
    if (d < 6) for (let i = 0; i < n.childCount; i++) { const k = n.child(i); if (k) walk(k, d + 1) }
  }
  walk(t.rootNode)

  // What the suppression rule needs to know: which node types does the analyzer
  // extract from, and is any of them reachable only through a broken region?
  const extractable = new Set(["rule_set", "keyframes_statement", "supports_statement", "at_rule", "import_statement", "declaration", "call_expression", "media_statement", "postcss_statement"])
  const reachable: { type: string; viaBroken: boolean; text: string }[] = []
  const w2 = (n: any, viaBroken: boolean) => {
    const broken = viaBroken || n.type === "ERROR" || n.isMissing === true
    if (extractable.has(n.type)) reachable.push({ type: n.type, viaBroken: broken, text: n.text.slice(0, 40) })
    for (let i = 0; i < n.childCount; i++) { const k = n.child(i); if (k) w2(k, broken) }
  }
  w2(t.rootNode, false)
  const onlyBroken = reachable.filter((r) => r.viaBroken)
  console.log(`  extractable nodes: ${reachable.length}, of which ONLY reachable through a broken region: ${onlyBroken.length}`)
  for (const r of onlyBroken) console.log(`      ${r.type}  ${JSON.stringify(r.text)}`)
  t.delete?.()
}
p.delete?.()
