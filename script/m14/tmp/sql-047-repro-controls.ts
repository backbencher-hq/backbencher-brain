// PROBE — cited by reviews/m60-sql-grammar-l1xnan-047-refused.md §6.
//
// Read-only. Six SQL constructs with CONTROLS, parsed under the pinned grammar and
// the @l1xnan 0.4.7 candidate. Run:
//   bun script/m14/tmp/sql-047-repro-controls.ts
//
// Kills the "the candidate lost dollar-quote support" hypothesis: the two grammars
// are IDENTICAL on all six cases, including the dollar-quoted ones. A hypothesis
// with a control that parses under both grammars is not the mechanism.

import { readFileSync } from "node:fs"
const W = await import("<corpus-root>/mcp/backbencher-brain/node_modules/web-tree-sitter/tree-sitter.cjs")
const wts = W.default ?? W
const init = wts.Parser.init ?? wts.init
await init.call(wts.Parser, { locateFile: () => "<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter.wasm" })
const grammars = {
  "pinned  0.3.11": "<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-sql.wasm",
  "cand    0.4.7": "/tmp/opencode/grammars/sql-l1xnan-047.wasm",
}
const cases = {
  "A  dollar-quoted body ($$)": `CREATE OR REPLACE FUNCTION f(a TEXT) RETURNS VOID AS $$\nBEGIN\n  PERFORM 1;\nEND;\n$$ LANGUAGE plpgsql;\n`,
  "B  CONTROL: no dollar-quote, plain body": `CREATE OR REPLACE FUNCTION f(a TEXT) RETURNS VOID AS 'x'\nLANGUAGE sql;\n`,
  "C  dollar-quote, empty body":   `CREATE OR REPLACE FUNCTION f() RETURNS void AS $$\n$$ LANGUAGE sql;\n`,
  "D  CONTROL: bare SELECT":       `SELECT 1;\n`,
  "E  dollar-quoted DO block":     `DO $$\nBEGIN\n  PERFORM 1;\nEND\n$$;\n`,
  "F  tagged dollar-quote ($fn$)": `CREATE FUNCTION f() RETURNS int AS $fn$ SELECT 1; $fn$ LANGUAGE sql;\n`,
}
const langs = {}
for (const [name, p] of Object.entries(grammars)) langs[name] = await wts.Language.load(readFileSync(p))
console.log("case".padEnd(34), Object.keys(grammars).map((n) => n.padEnd(16)).join(""))
for (const [label, src] of Object.entries(cases)) {
  const row = []
  for (const name of Object.keys(grammars)) {
    const p = new wts.Parser(); p.setLanguage(langs[name])
    const t = p.parse(src)
    let errs = 0, missing = 0
    const st = [t.rootNode]
    while (st.length) { const n = st.pop(); if (n.type === "ERROR") errs++; if (n.isMissing) missing++
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) } }
    row.push(`err=${errs} miss=${missing}`)
  }
  console.log(label.padEnd(34), row.map((r) => r.padEnd(16)).join(""))
}
