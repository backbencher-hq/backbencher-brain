// The 7 files from zigw-parse-errors.ts that are neither intentionally-invalid
// compile_errors nor inline asm: the only population where the grammar's blindness
// can hide a relationship the analyzer should have published. Each one gets its
// ERROR shape and the source line, so the answer is per file rather than a
// population-wide shrug.
import * as fs from "fs"
import { init, parser } from "./zigw-harness"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const FILES = [
  "zig/doc/langref/Assembly Syntax Explained.zig",
  "zig/doc/langref/var_must_be_initialized.zig",
  "zig/lib/std/Io.zig",
  "zls/src/features/semantic_tokens.zig",
  "ghostty/src/Surface.zig",
  "ghostty/src/global.zig",
  "ghostty/src/main_c.zig",
]

await init()
for (const rel of FILES) {
  const f = `${CORPUS}/${rel}`
  if (!fs.existsSync(f)) {
    console.log(`\n### ${rel}\n  (not on disk at this path)`)
    continue
  }
  const src = fs.readFileSync(f, "utf8")
  const tree = parser().parse(src)
  const errs: any[] = []
  const walk = (n: any): void => {
    if (n.type === "ERROR") errs.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  walk(tree.rootNode)
  const hasAsm = /(^|[^A-Za-z_])asm([^A-Za-z_]|$)/m.test(src)
  console.log(`\n### ${rel}`)
  console.log(`  ERROR nodes: ${errs.length}   contains asm: ${hasAsm}`)
  for (const n of errs.slice(0, 4)) {
    const chain: string[] = []
    let q = n.parent
    let hops = 0
    while (q && hops++ < 3) { chain.push(q.type); q = q.parent }
    const line = n.startPosition.row + 1
    const text = src.slice(n.startIndex, n.endIndex)
    console.log(`  L${line}  ${chain.join(" < ")}`)
    console.log(`        ${JSON.stringify(text.length > 90 ? `${text.slice(0, 90)}...` : text)}`)
    console.log(`        line: ${JSON.stringify(src.split("\n")[line - 1]?.trim().slice(0, 92))}`)
  }
  tree.delete()
}
