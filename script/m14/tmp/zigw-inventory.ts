// Z41 probe part 2: `@"progress_normal {d}"` reaches the read rule only if
// `fileValues` holds that name, so the question is not the read rule -- it is
// what put a FORMAT STRING into the file-scope value inventory in the first
// place. An inventory that admits a string literal is a defect twice over: the
// read that follows it is fabricated, and every later lookup on that name is
// answering against a symbol that does not exist.
import * as fs from "fs"
import { init, parser, analyzer } from "./zigw-harness"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const f = `${CORPUS}/zig/lib/std/Progress.zig`
const src = fs.readFileSync(f, "utf8")

await init()
const tree = parser().parse(src)
const res = analyzer().analyze(tree.rootNode, src, f) as any

const syms = (res.symbols ?? []).filter((s: any) => String(s.name ?? "").includes("progress_normal"))
console.log(`symbols matching 'progress_normal': ${syms.length}`)
for (const s of syms) {
  console.log(`  name=${JSON.stringify(s.name)} kind=${s.kind} scope=${s.scope} owner=${JSON.stringify(s.owner ?? null)} line=${s.line ?? s.line_number ?? "?"} meta=${JSON.stringify(s.metadata ?? {})}`)
}

// Which nodes does the grammar call an `identifier` while their text is really a
// quoted literal, and how does each one sit in the tree?
const shapes = new Map<string, number>()
const samples = new Map<string, string>()
const walk = (n: any): void => {
  if (n.type === "identifier" && /^@"/.test(String(n.text ?? ""))) {
    let hasString = false
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === "string") { hasString = true; break } }
    if (hasString) {
      const key = `parent=${n.parent?.type ?? "(root)"} grandparent=${n.parent?.parent?.type ?? "(root)"}`
      shapes.set(key, (shapes.get(key) ?? 0) + 1)
      if (!samples.has(key)) samples.set(key, `line ${n.startPosition.row + 1}: ${JSON.stringify(n.text.slice(0, 50))}`)
    }
  }
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
}
walk(tree.rootNode)
console.log(`\nquoted-literal identifiers in this file, by position: ${shapes.size} shape(s)`)
for (const [k, n] of [...shapes].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}x  ${k}\n        ${samples.get(k)}`)
tree.delete()
