// FS014 — the LEADING-BAR discriminator, tested: `union_type_cases` in the grammar is
// `seq(optional("|"), union_type_case, repeat(seq(optional(_newline), "|", union_type_case)))`.
// A REAL F# discriminated union writes its first case with the bar; a type abbreviation
// written on one line (`type X = SomeType`) has no bar. If the optional `|` is a
// readable child token of `union_type_cases`, the alias is separable from a one-case DU
// by AST alone — no resolution, no text read.
//
// This is the load-bearing question for the alias fix, so it is tested both ways: the
// proposed read, and the CONTROL that must fail to match (a later case's own bar must
// not be mistaken for the leading one).
//
// Run: bun script/m14/tmp/fs014-leading-bar.ts
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "../../..")

const CASES: Array<[string, string, boolean]> = [
  ["alias, one line",              "type X = Original",                false],
  ["alias, lowercase rhs",         "type x = original",                false],
  ["alias, builtin rhs",           "type X = int",                      false],
  ["one-case DU, no bar",          "type X = A",                        true],
  ["one-case DU, leading bar",     "type X =\n  | A",                   true],
  ["one-case DU, bar then member", "type X =\n  | A\n      member this.M = 1", true],
  ["two cases",                    "type X =\n  | A\n  | B",           true],
  ["two cases, first no bar",      "type X = A | B",                    true],
  ["case with payload",            "type X =\n  | A of int",            true],
  ["real enum",                    "type X = A = 0 | B = 1",            true],
  ["nested: a DU inside a record", "type R = { A: int }\ntype X = Y",    false],
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))

  const firstChildIsBar = (cases: any): boolean => {
    for (let i = 0; i < cases.childCount; i++) {
      const c = cases.child(i)
      if (c.isNamed) return false          // the first NAMED child is the case itself
      if (c.type === "|") return true      // an anonymous bar BEFORE the first case
      if (c.type.trim() !== "") return false
    }
    return false
  }

  let pass = 0, fail = 0
  console.log("FS014 — can the alias be separated from a one-case DU by the leading bar?\n")
  for (const [label, body, expectDU] of CASES) {
    const src = `module M\n${body}\n`
    const tree = parser.parse(src)
    const udd: any[] = []
    const st: any[] = [tree.rootNode]
    while (st.length) { const n = st.pop(); if (n.type === "union_type_cases") udd.push(n); for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) } }
    if (udd.length !== 1) { console.log(`  SKIP  ${label.padEnd(30)} (${udd.length} union_type_cases — not the ambiguous shape)`); continue }
    const gotBar = firstChildIsBar(udd[0])
    const judgedDU = gotBar
    const ok = judgedDU === expectDU
    if (ok) pass++; else fail++
    console.log(`  ${ok ? "PASS " : "FAIL "}  ${label.padEnd(30)} leadingBar=${String(gotBar).padEnd(5)} judgedDU=${String(judgedDU).padEnd(5)} expectedDU=${expectDU}`)
    // show the children so the read is auditable
    const kids: string[] = []
    for (let i = 0; i < udd[0].childCount; i++) { const c = udd[0].child(i); kids.push(`${c.isNamed ? "" : "·"}${c.type}`) }
    console.log(`          union_type_cases children: ${kids.join(" ")}`)
  }
  console.log(`\n${pass} pass, ${fail} fail`)
  console.log(fail === 0
    ? "\nVERDICT: the leading bar IS a readable child token, so `type X = SomeType` (no bar)"
    + "\nis separable from a one-case DU (bar) by AST alone. A fix can therefore be"
    + "\nstructural — no in-file resolution, no source-text read."
    : "\nVERDICT: the leading bar does NOT separate the two shapes. Any fix would have to")
    ; console.log(fail === 0 ? "be ruled a declared limitation instead." : "resolve names, which single-file analysis cannot do.")
  process.exit(fail === 0 ? 0 : 1)
}
void main()
