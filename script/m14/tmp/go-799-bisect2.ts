// go (round 3) — forward bisect: the target function emits Lock/Unlock with every
// PRECEDING block kept, so the suppressor must be a LATER declaration. This adds
// trailing blocks one at a time until the calls disappear.
//
// Run: bun script/m14/tmp/go-799-bisect2.ts
import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"

const REAL = "<corpus-root>/bb_tests/repositories/go-tools/go/analysis/passes/modernize/testdata/src/slicesbackward/slicesbackward.go"
const lines = fs.readFileSync(REAL, "utf8").split("\n")
const starts: number[] = []
lines.forEach((l, i) => {
  if (/^(func|type|var|const|import|package)\b/.test(l)) starts.push(i)
})
const blocks: { start: number; end: number; first: string }[] = []
for (let i = 0; i < starts.length - 1; i++) {
  blocks.push({ start: starts[i], end: starts[i + 1], first: lines[starts[i]].trim().slice(0, 70) })
}
const last = lines.slice(blocks[blocks.length - 1].start).join("\n")
blocks[blocks.length - 1].end = lines.length
void last

const target = lines.findIndex((l) => l.includes("func indexExprMethodCall"))
const targetBlock = blocks.findIndex((b) => b.start <= target && target < b.end)
const pkg = lines.slice(0, blocks[0].start).join("\n")

const parser = await ASTEngine.getParser("go" as any)
const analyzer = new RealGoAnalyzer()

async function callsFor(text: string): Promise<string[]> {
  const tree: any = parser.parse(text)
  const res: any = await analyzer.analyze(tree.rootNode, text, "bisect.go")
  return (res.relationships ?? [])
    .filter((r: any) => String(r.type) === "calls")
    .map((r: any) => `${String(r.target)}@${r.line_number ?? r.metadata?.line ?? "?"}`)
}

const textFor = (indices: number[]) => pkg + "\n" + indices.map((i) => lines.slice(blocks[i].start, blocks[i].end).join("\n")).join("\n") + "\n"

const withTarget = Array.from({ length: targetBlock + 1 }, (_, i) => i)
console.log(`baseline (0..${targetBlock}):`, JSON.stringify(await callsFor(textFor(withTarget))))

for (let i = targetBlock + 1; i < blocks.length; i++) {
  const text = textFor([...withTarget, i])
  const got = await callsFor(text)
  const has = got.some((c) => c.startsWith("Lock")) && got.some((c) => c.startsWith("Unlock"))
  console.log(`plus block ${i} (${blocks[i].first.slice(0, 46)}): Lock/Unlock present=${has}  calls=${JSON.stringify(got.slice(0, 6))}`)
  if (!has) {
    console.log(`  -> SUPPRESSOR: block ${i}: ${blocks[i].first}`)
    break
  }
}
console.log("\nblocks:")
blocks.forEach((b, i) => console.log(` ${i} lines ${b.start + 1}-${b.end} ${b.first}`))
