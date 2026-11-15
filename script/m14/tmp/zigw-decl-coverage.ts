// Z47, stated as a COVERAGE question rather than a tree-shape question.
//
// Two attempts at an invariant failed before this one, and the failures are the
// useful part:
//
//   1. "no declaration may sit under an expression" reported 452 files and 28,140
//      declarations. The first sample refuted it: `return struct { items: []T }`
//      puts `container_field`s under a `return_expression` LEGITIMATELY, because
//      that expression produces a struct. `return struct { ... }` is Zig's
//      dominant idiom, so the wide version was measuring the language.
//   2. "no `function_declaration` may sit under an expression" still reported 289
//      files -- and it is also wrong, because `fn outer() type { return struct
//      { pub fn inner() void {} }; }` is valid Zig and `inner`'s ancestor chain
//      passes through that same `return_expression`.
//
// Both were me guessing at the grammar's internal shape. What actually matters is
// not where the tree put a declaration but whether a declaration was LOST, and
// that can be measured against something outside the tree entirely: the SOURCE
// TEXT. A top-level `fn`/`pub fn` is unambiguous in the text (column 0), and the
// analyzer publishes one function symbol per one it can see.
//
// So: count file-scope `fn` declarations in the text, count file-scope function
// symbols published, and report the gap per file. A file that declares 40
// functions and publishes 2 has lost 38, whatever the tree claims.
import * as fs from "fs"
import { stripZigQuoting } from "../../../src/ast/real-zig-analyzer"
import { init, parser, analyzer } from "./zigw-harness"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const REPOS = ["zig", "zls", "ghostty"]

function collect(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) collect(p, out)
    else if (e.name.endsWith(".zig")) out.push(p)
  }
}

interface Acc { textDecls: number; published: number; gap: number }
await init()
const files: string[] = []
for (const r of REPOS) collect(`${CORPUS}/${r}`, files)

const perRepo: Record<string, { files: number; affected: number; text: number; pub: number }> = {}
const worst: Array<{ f: string; text: number; pub: number; missing: string[] }> = []
let affectedFiles = 0
let totalText = 0
let totalPub = 0

for (const f of files) {
  const repo = f.slice(`${CORPUS}/`.length).split("/")[0]
  perRepo[repo] ??= { files: 0, affected: 0, text: 0, pub: 0 }
  perRepo[repo].files++
  const src = fs.readFileSync(f, "utf8")
  // FILE SCOPE FROM THE GRAMMAR, not from a source-column heuristic.
  //
  // Two earlier versions of this metric were wrong, and the corpus caught both:
  //   - counting REGEX matches for column-0 `fn` against ownerless function symbols
  //     reported 103% coverage, because the two populations are different sets;
  //   - then comparing the source's column-0 `fn` NAMES against published symbols
  //     reported 18 files losing 164 declarations, which looked decisive and was
  //     not: `aro/Builtins/*.zig` carries `// zig fmt: off`, so the members of a
  //     `return struct { ... }` sit at column 0 and LOOK like file-scope
  //     declarations. They are members of the returned anonymous struct, which Z22
  //     rules owns nothing, so publishing no symbol for them is CORRECT. The
  //     instrument was counting a formatting artefact as a lost declaration, and
  //     `zig fmt: off` is exactly the kind of thing that makes a source-text
  //     heuristic unsafe on a corpus that is not uniformly formatted.
  //
  // The grammar knows the answer: a declaration is file-scope when walking up from
  // it reaches `source_file` without first passing through another function body
  // or a statement. That is the same question the analyzer's own `inFunction` flag
  // answers, derived independently from tree structure.
  const tree = parser().parse(src)
  const SCOPE_BARRIERS = new Set([
    "function_declaration", "block", "if_statement", "if_expression", "for_statement",
    "for_expression", "while_statement", "while_expression", "switch_statement",
    "switch_expression", "catch_expression", "defer_statement", "expression_statement",
    "test_declaration", "comptime_statement", "errdefer_statement",
    // A CONTAINER is a barrier too, and omitting it was the third version's bug:
    // a struct member's chain is `function_declaration < struct_declaration <
    // source_file`, which hits no statement barrier, so the eight-space-indented
    // `jsonParse` methods inside a file-scope struct were counted as FILE-SCOPE
    // declarations and reported as six lost. They are members, published under
    // their owner, and the metric was reading indentation as scope.
    "struct_declaration", "enum_declaration", "union_declaration",
    "container_field", "container_declaration",
  ])
  const names: string[] = []
  const scopeWalk = (n: any): void => {
    if (n.type === "function_declaration") {
      let nm = ""
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === "identifier") { nm = stripZigQuoting(String(c.text ?? "")); break } }
      if (nm) {
        let q = n.parent
        let fileScope = true
        let guard = 0
        while (q && guard++ < 40) {
          if (SCOPE_BARRIERS.has(q.type)) { fileScope = false; break }
          q = q.parent
        }
        if (fileScope) names.push(nm)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) scopeWalk(c) }
  }
  scopeWalk(tree.rootNode)
  if (names.length === 0) { tree.delete(); continue }
  const res = analyzer().analyze(tree.rootNode, src, f) as any
  const symNames = new Set<string>((res.symbols ?? []).map((s: any) => stripZigQuoting(String(s.name ?? ""))))
  const missing = names.filter((n) => !symNames.has(n))
  tree.delete()
  const textDecls = names.length
  const published = textDecls - missing.length
  totalText += textDecls
  totalPub += published
  perRepo[repo].text += textDecls
  perRepo[repo].pub += published
  if (published < textDecls) {
    affectedFiles++
    perRepo[repo].affected++
    worst.push({ f: f.slice(`${CORPUS}/`.length), text: textDecls, pub: published, missing })
  }
}

console.log(`files with a file-scope fn: ${worst.length + (files.length - worst.length)} scanned`)
console.log(`file-scope fn declarations in SOURCE TEXT: ${totalText}`)
console.log(`file-scope function symbols PUBLISHED:     ${totalPub}`)
// NOT rounded: `toFixed(2)` printed 100.00% on the same run that reported
  // `files with lost file-scope declarations: 1`, which is the Z46 case — a ratio
  // that rounds a real loss to perfection is worse than no ratio, because it is
  // read as an all-clear. Four of this lane's figures have been wrong by being
  // faithful to something other than the question; this one was wrong by being
  // faithful to a rounding rule.
  const coverage = totalText === 0 ? 0 : (totalPub / totalText) * 100
  const pct = totalText === 0 ? "n/a" : `${coverage.toFixed(4)}%${coverage < 100 ? "  <-- NOT 100%" : ""}`
  console.log(`coverage: ${pct}`)
console.log(`\nper repo:`)
for (const [r, v] of Object.entries(perRepo)) {
  console.log(`  ${r.padEnd(9)} ${v.affected}/${v.files} files short   text ${String(v.text).padStart(6)}  published ${String(v.pub).padStart(6)}  ${v.text === 0 ? "" : `${((v.pub / v.text) * 100).toFixed(1)}%`}`)
}
worst.sort((a, b) => (a.pub - a.text) - (b.pub - b.text))
console.log(`\nfiles with lost file-scope declarations: ${worst.length}`)
for (const w of worst) console.log(`  ${String(w.text - w.pub).padStart(4)} lost of ${String(w.text).padStart(3)}  ${w.f}\n        missing: ${w.missing.slice(0, 6).join(", ")}${w.missing.length > 6 ? ", ..." : ""}`)

// A GATE, not a report: file-scope declaration coverage must be exactly 100%, so
// the exit status is the verdict. It reached 100% only after three wrong
// versions of the QUESTION (452 files, then 99.16%, then 99.88%) and the third
// was wrong for a different reason than the first two — it read eight-space
// indentation as scope. Worth stating plainly: this lane has now produced four
// coverage-shaped numbers in one sitting, three of them wrong, and the reason
// each was caught is the same — the corpus was read before the count was
// believed. A number that survives only because nobody looked at a sample is
// not a measurement.
process.exit(totalText === totalPub ? 0 : 1)
