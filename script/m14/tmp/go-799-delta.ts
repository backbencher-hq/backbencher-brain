// go (round 3) — delta-debug the suppression.
//
// The real file suppresses `calls -> Lock`/`Unlock`; every hand-built reduction I
// tried does not. So reduce mechanically: remove top-level declaration blocks and
// KEEP a removal only when the calls stay absent. What remains is the minimal
// context, and what it contains is the mechanism.
//
// Run: bun script/m14/tmp/go-799-delta.ts
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
for (let i = 0; i < starts.length; i++) {
  blocks.push({ start: starts[i], end: starts[i + 1] ?? lines.length, first: lines[starts[i]].trim().slice(0, 60) })
}
const header = lines.slice(0, blocks[0].start).join("\n")

const parser = await ASTEngine.getParser("go" as any)
const analyzer = new RealGoAnalyzer()

const text = (keep: number[]) => header + "\n" + keep.map((i) => lines.slice(blocks[i].start, blocks[i].end).join("\n")).join("\n") + "\n"

async function suppresses(keep: number[]): Promise<boolean> {
  const src = text(keep)
  let tree: any
  try {
    tree = parser.parse(src)
  } catch {
    return false
  }
  const res: any = await analyzer.analyze(tree.rootNode, src, "delta.go")
  const calls = (res.relationships ?? []).filter((r: any) => String(r.type) === "calls").map((r: any) => String(r.target))
  const has = calls.includes("Lock") && calls.includes("Unlock")
  return !has
}

// blocks must keep: package(0), imports(1), and the target function's block.
const target = lines.findIndex((l) => l.includes("func indexExprMethodCall"))
const targetBlock = blocks.findIndex((b) => b.start <= target && target < b.end)
const required = [0, 1, targetBlock]
let keep = blocks.map((_, i) => i)
console.log(`blocks=${blocks.length} targetBlock=${targetBlock} full-file suppresses=${await suppresses(keep)}`)

// 1) remove trailing blocks greedily (skip required)
for (let i = blocks.length - 1; i >= 0; i--) {
  if (required.includes(i)) continue
  const candidate = keep.filter((x) => x !== i)
  if (await suppresses(candidate)) keep = candidate
}
console.log(`after trailing removal: keep=${JSON.stringify(keep)}`)

// 2) remove any remaining non-required blocks
let changed = true
while (changed) {
  changed = false
  for (const i of [...keep]) {
    if (required.includes(i)) continue
    const candidate = keep.filter((x) => x !== i)
    if (await suppresses(candidate)) {
      keep = candidate
      changed = true
    }
  }
}

console.log(`\nMINIMAL suppressing text keeps ${keep.length} block(s):`)
for (const i of keep) console.log(`  block ${i} lines ${blocks[i].start + 1}-${blocks[i].end}: ${blocks[i].first}`)
console.log("\n--- minimal text ---")
console.log(text(keep))
console.log("--- does removing only the target keep it absent? (sanity) ---")
const withoutTarget = keep.filter((x) => x !== targetBlock)
console.log("  suppresses without the target:", await suppresses(withoutTarget.length ? withoutTarget : [0, 1]))
