// Review instrument (NOT a gate): pin the EXACT minimal reproduction for the
// CSS lane's largest residual parse class, after `css-reduce.ts` refuted the
// first attribution (`.a { filter: progid:...; }` parses CLEAN).
//
//   bun script/m14/tmp/css-residue-pinning.ts
//
// What it establishes, one construct at a time: whether the failure needs the
// `progid:` prefix at all, whether it needs the legacy `gradient(` call form, and
// whether the load-bearing character is the SPACE around `=`. A class that can
// be reduced to something ordinary is a much smaller grammar ask than one that
// needs a vendor hack modelled — and sometimes the reduction shows the class is
// not what the histogram said.

import { Parser, Language } from "web-tree-sitter"
import { readFileSync } from "fs"

await Parser.init()
const lang = await Language.load(readFileSync("wasm/tree-sitter-css.wasm"))
const p = new Parser()
p.setLanguage(lang)

const CASES: { id: string; src: string; why: string }[] = [
  { id: "progid-spaced-eq (the REAL form)", src: "X { filter: progid:DXImageTransform.Microsoft.gradient(startColorStr = '#aaa', EndColorStr = '#bbb'); }\n", why: "exactly as it appears in grails-core" },
  { id: "progid-tight-eq", src: "X { filter: progid:DXImageTransform.Microsoft.gradient(startColorStr='#aaa', EndColorStr='#bbb'); }\n", why: "no spaces around `=`" },
  { id: "progid-single-spaced-arg", src: "X { filter: progid:DXImageTransform.Microsoft.gradient(startColorStr = '#aaa'); }\n", why: "one argument, spaces around `=`" },
  { id: "no-progid-spaced-eq", src: "X { filter: gradient(startColorStr = '#aaa', EndColorStr = '#bbb'); }\n", why: "does it need the progid prefix?" },
  { id: "plain-fn-spaced-eq", src: "X { foo: bar(startColorStr = '#aaa'); }\n", why: "does it need `progid`/`gradient` at all?" },
  { id: "plain-value-spaced-eq", src: "X { foo: a = b; }\n", why: "a bare `a = b` in a value position" },
  { id: "fn-arg-plain", src: "X { foo: bar(a, b); }\n", why: "the ordinary call form" },
  { id: "fn-arg-keyword-no-space", src: "X { foo: bar(a=1); }\n", why: "`a=1` with no spaces" },
  { id: "fn-arg-keyword-one-space", src: "X { foo: bar(a =1); }\n", why: "one space before `=`" },
  { id: "fn-arg-keyword-trailing-space", src: "X { foo: bar(a= 1); }\n", why: "one space after `=`" },
  { id: "fn-arg-keyword-both-spaces", src: "X { foo: bar(a = 1); }\n", why: "spaces on both sides" },
  { id: "fn-arg-keyword-spaces-and-comma", src: "X { foo: bar(a = 1, b = 2); }\n", why: "two spaced keywords" },
  { id: "transform-matrix", src: "X { transform: matrix(1, 0, 0, 1, 0, 0); }\n", why: "the ordinary matrix() form" },
  { id: "css-vendor-other", src: "X { -ms-filter: \"progid:DXImageTransform.Microsoft.gradient(startColorStr='#aaa')\"; }\n", why: "the QUOTED legacy form (what most files use)" },
]

function verdict(src: string) {
  const t = p.parse(src)
  let n = 0
  let first = ""
  const lines = src.split("\n")
  const w = (x: any) => {
    if (x.type === "ERROR") { n++; if (!first) first = JSON.stringify(x.text.slice(0, 60)) }
    for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c) w(c) }
  }
  w(t.rootNode)
  const r = { hasError: t.rootNode.hasError, errNodes: n, firstErr: first, firstLine: (lines[0] ?? "").trim().slice(0, 80) }
  t.delete?.()
  return r
}

const rows = CASES.map((c) => ({ ...c, ...verdict(c.src) }))
console.log("=== EXACT minimal reproduction for the largest residual CSS parse class ===\n")
for (const r of rows) {
  console.log(`${r.hasError ? "ERR " : "ok  "} ${r.id.padEnd(34)} ${r.why}`)
  if (r.hasError) console.log(`       first ERROR: ${r.firstErr}`)
}
console.log("\n=== the reduction, stated ===")
const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
const need = (id: string) => (byId[id]?.hasError ? "NEEDS" : "does NOT need")
console.log(`  the legacy \`progid:\` prefix:        ${need("progid-spaced-eq (the REAL form)")} / absent in: ${need("no-progid-spaced-eq")}`)
console.log(`  the \`gradient(\` call form:           ${need("no-progid-spaced-eq")}`)
console.log(`  SPACES around \`=\` inside arguments:   ${need("fn-arg-keyword-both-spaces")} / tight \`a=1\` is: ${need("fn-arg-keyword-no-space")}`)
console.log(`  a bare \`a = b\` in a value position:  ${need("plain-value-spaced-eq")}`)
p.delete?.()
