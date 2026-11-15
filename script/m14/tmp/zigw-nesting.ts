// Z47: a file can be mis-parsed with NO error marker at all.
//
// `zig/lib/compiler/aro/aro/Attribute/names.zig` opens with a FILE-SCOPE
// `return struct {` \u2014 the "namespace struct" idiom \u2014 and the grammar models that
// as a `return_expression` that never closes, so the following ~1,000 lines of
// declarations end up NESTED INSIDE that expression. The parse reports 0 ERROR
// nodes and 0 MISSING nodes: the tree is confidently wrong rather than
// recoverably broken.
//
// That makes it invisible to the Z42 parse census, which defined "dirty" as
// "carries an ERROR or MISSING node" \u2014 so the census's own conclusion (93 files,
// three named syntaxes, nothing else) was incomplete, and it was my definition
// that was incomplete rather than the grammar being worse than described.
//
// The invariant needs no error markers: a `function_declaration` may not have an
// EXPRESSION anywhere on its ancestor chain. A `function_declaration` reachable
// only by walking up through a `return_expression` is a parse that has gone
// somewhere no valid Zig can go.
import * as fs from "fs"
import { init, parser } from "./zigw-harness"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const REPOS = ["zig", "zls", "ghostty"]
// Node types that can only appear where an EXPRESSION is expected. A declaration
// beneath one of these is structurally impossible.
const EXPRESSIONISH = new Set([
  "return_expression", "if_expression", "switch_expression", "call_expression",
  "binary_expression", "field_expression", "index_expression", "array_expression",
  "struct_expression", "struct_initializer", "anonymous_struct_initializer",
  "block_expression", "catch_expression", "builtin_function", "arguments",
  "switch_case", "else_clause", "for_expression", "while_expression",
  "conditional_expression", "error_union_expression", "try_expression",
  "asm_expression", "comptime_expression", "orelse_expression", "defer_statement",
])

function collect(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) collect(p, out)
    else if (e.name.endsWith(".zig")) out.push(p)
  }
}

await init()
const files: string[] = []
for (const r of REPOS) collect(`${CORPUS}/${r}`, files)

const shapes = new Map<string, { files: number; n: number; sample: string }>()
let dirtyFiles = 0
let lostDecls = 0
const perRepo: Record<string, { total: number; bad: number }> = {}

for (const f of files) {
  const repo = f.slice(`${CORPUS}/`.length).split("/")[0]
  perRepo[repo] ??= { total: 0, bad: 0 }
  perRepo[repo].total++
  const src = fs.readFileSync(f, "utf8")
  const tree = parser().parse(src)
  const found = new Map<string, { n: number; sample: string }>()
  const walk = (n: any, chain: string[]): void => {
    // NARROWED, and the narrowing is the finding. The first version also flagged
    // `container_field`, which reported 452 files and 28,140 declarations — and
    // the very first example refuted it: `return struct { items: []T, len: usize }`
    // inside a generic function puts those fields under a `return_expression`
    // LEGITIMATELY, because that expression produces a struct and the fields are
    // its members. `return struct { … }` is Zig's dominant idiom, so the wide
    // version was measuring the language, not a defect — the same class of
    // manufactured violation as the audit's other two bugs, and this close to
    // believing it that the only reason it survived is that the sample was read
    // before the count was.
    //
    // A FUNCTION DECLARATION under an expression is different in kind: you cannot
    // declare a function inside an expression, so there is no valid Zig that
    // produces that shape. That is the whole invariant.
    if (n.type === "function_declaration") {
      const bad = chain.find((c) => EXPRESSIONISH.has(c))
      if (bad) {
        const key = `${n.type} under a ${bad}`
        const prev = found.get(key)
        if (prev) prev.n++
        else found.set(key, { n: 1, sample: `${f.slice(`${CORPUS}/`.length)}:${n.startPosition.row + 1}` })
        lostDecls++
      }
    }
    const next = chain.length > 8 ? chain : [...chain, n.type]
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walk(c, next)
    }
  }
  walk(tree.rootNode, [])
  if (found.size > 0) {
    dirtyFiles++
    perRepo[repo].bad++
    for (const [k, v] of found) {
      const prev = shapes.get(k)
      if (prev) { prev.files++; prev.n += v.n } else shapes.set(k, { files: 1, n: v.n, sample: v.sample })
    }
  }
  tree.delete()
}

console.log(`files: ${files.length}   declarations nested under an EXPRESSION: ${lostDecls} in ${dirtyFiles} file(s)`)
console.log(`\nper repo:`)
for (const [r, v] of Object.entries(perRepo)) console.log(`  ${r.padEnd(9)} ${v.bad}/${v.total} affected`)
console.log(`\nshapes: ${shapes.size}`)
for (const [k, v] of [...shapes].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${String(v.n).padStart(5)} declarations in ${String(v.files).padStart(3)} file(s)  ${k}`)
  console.log(`         e.g. ${v.sample}`)
}
process.exit(dirtyFiles === 0 ? 0 : 1)
