// Z41 probe: which node turns `@"progress_normal {d}"` -- a FORMAT STRING passed
// as a call argument -- into a `uses` edge, and is the same path what makes
// `@"my type"` a real name in a declaration?
import * as fs from "fs"
import { init, parser, analyzer } from "./zigw-harness"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const f = `${CORPUS}/zig/lib/std/Progress.zig`
const src = fs.readFileSync(f, "utf8")

await init()
const tree = parser().parse(src)
const res = analyzer().analyze(tree.rootNode, src, f) as any

for (const r of res.relationships ?? []) {
  if (!String(r.target ?? "").includes("progress_normal")) continue
  console.log(`EDGE  ${r.type}  ${r.source} -> ${JSON.stringify(r.target)}  line ${r.line_number}`)
  console.log(`      metadata ${JSON.stringify(r.metadata)}`)
}

// The node the edge must have come from: whatever sits on that line.
const row = 1247
const at: any[] = []
const walk = (n: any): void => {
  if (n.startPosition.row === row && (n.type === "string" || n.type === "field_expression" || n.type === "identifier" || n.type === "call_expression" || n.type === "builtin_function" || n.type === "spread_element" || n.type === "array_expression" || n.type === "struct_expression" || n.type === "anonymous_struct_expression" || n.type === "ERROR")) {
    at.push(`${n.type} [${n.startPosition.row + 1}:${n.startPosition.column}]-${n.endPosition.row + 1}:${n.endPosition.column} ${JSON.stringify(n.text.slice(0, 44))}`)
  }
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
}
walk(tree.rootNode)
console.log(`\nNODES on source line ${row + 1}:`)
for (const n of at) console.log("  " + n)

// The control: a quoted identifier that IS a real name.
const g = `${CORPUS}/zig/build.zig`
const gsrc = fs.readFileSync(g, "utf8")
const gtree = parser().parse(gsrc)
const gres = analyzer().analyze(gtree.rootNode, gsrc, g) as any
const quoted = (gres.relationships ?? []).filter((r: any) => /^\s|@/.test(String(r.target ?? "")))
console.log(`\nCONTROL build.zig edges whose target carries a space or an @: ${quoted.length}`)
for (const r of quoted.slice(0, 6)) console.log(`  ${r.type} ${r.source} -> ${JSON.stringify(r.target)} line ${r.line_number}`)
gtree.delete()
tree.delete()
