// go (round 3) — bisect: which declaration BEFORE indexExprMethodCall makes the
// analyzer stop emitting `calls -> Lock` / `calls -> Unlock`?
//
// The exact function analyzed on its own in the same file's imports DOES emit
// them (script/m14/tmp/go-799-lockcall.ts), so the suppressor is context. This
// walks the real file's top-level declarations and analyzes growing prefixes.
//
// Run: bun script/m14/tmp/go-799-bisect.ts
import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"

const REAL = "/home/ishaq2321/bb_tests/repositories/go-tools/go/analysis/passes/modernize/testdata/src/slicesbackward/slicesbackward.go"
const src = fs.readFileSync(REAL, "utf8")
const lines = src.split("\n")

// Top-level declaration starts: column-0 `func `, `type `, `var `, `import`, `package`, or a comment block.
const starts: number[] = []
lines.forEach((l, i) => {
  if (/^(func|type|var|const|import|package)\b/.test(l)) starts.push(i)
})

const target = lines.findIndex((l) => l.includes("func indexExprMethodCall"))
const targetDecl = starts.filter((s) => s <= target).pop()!
const targetEnd = starts.find((s) => s > target) ?? lines.length

const parser = await ASTEngine.getParser("go" as any)
const analyzer = new RealGoAnalyzer()

async function run(prefixIdx: number[]): Promise<string[]> {
  const keep = lines.slice(0, targetDecl + 1) // package + imports + comments so far
  // gather the contiguous declaration blocks selected by prefixIdx
  let out = lines.slice(0, targetDecl).join("\n") // everything before the target decl
  const body = lines.slice(targetDecl, targetEnd).join("\n")
  void keep
  void prefixIdx
  out = out + "\n" + body + "\n"
  const tree: any = parser.parse(out)
  const res: any = await analyzer.analyze(tree.rootNode, out, "bisect.go")
  return (res.relationships ?? [])
    .filter((r: any) => String(r.type) === "calls")
    .map((r: any) => String(r.target))
}

// 1) target function alone, but keeping the real file's package + import block
const importEnd = starts.find((s) => s >= targetDecl)!
void importEnd
const headerEnd = starts[1] ?? 0
void headerEnd

const declBlocks: { start: number; end: number; first: string }[] = []
for (let i = 0; i < starts.length - 1; i++) {
  declBlocks.push({ start: starts[i], end: starts[i + 1], first: lines[starts[i]].trim().slice(0, 60) })
}
const targetBlock = declBlocks.findIndex((b) => b.start <= target && target < b.end)

console.log(`target decl block index ${targetBlock} of ${declBlocks.length}`)

for (let k = 0; k <= (targetBlock ?? 0); k++) {
  // keep package + import block + every block from the first import to k
  const firstImport = declBlocks.findIndex((b) => /^import\b/.test(b.first) || /^import \(/.test(b.first))
  const keepFrom = firstImport === -1 ? 0 : firstImport - 1
  const selected = declBlocks
    .slice(keepFrom, k + 1)
    .map((b) => lines.slice(b.start, b.end).join("\n"))
  // ensure the package clause
  const pkg = lines.slice(0, declBlocks[0].start).join("\n")
  const text = pkg + "\n" + selected.join("\n") + "\n"
  const calls = await run([])
  void calls
  const tree: any = parser.parse(text)
  const res: any = await analyzer.analyze(tree.rootNode, text, "bisect.go")
  const got = (res.relationships ?? [])
    .filter((r: any) => String(r.type) === "calls")
    .map((r: any) => String(r.target))
  const has = got.includes("Lock") && got.includes("Unlock")
  console.log(
    `keep 0..${k}${k === targetBlock ? " (TARGET)" : ""}: calls=${JSON.stringify(got)}  Lock/Unlock present=${has}`,
  )
  if (!has && k === targetBlock) {
    console.log("  -> the suppressor is in the selection; narrow with the block list above")
  }
}
console.log("\ndeclaration blocks:")
declBlocks.forEach((b, i) => console.log(` ${i} lines ${b.start + 1}-${b.end} ${b.first}`))
