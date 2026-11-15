// go (round 4) — WHY the package-scope call pass stops at line 217 of
// slicesbackward.go while it emits line 231/238 of the same recovery region.
//
// The analyzer's package-scope walk (`analyzeGoPackageScopeCalls`) does
// `continue` on `function_declaration`/`method_declaration` subtrees because
// findGoFunctionCalls is supposed to cover them — but that pass runs off
// SYMBOLS, and a declaration that exists only as parse-recovery debris never
// becomes one (the file yields 1 symbol total, none of them a function). This
// prints the node skeleton of a line window so the debris-wrapped declaration
// is read off the tree.
//
// Run: bun script/m14/tmp/go-799-region-tree.ts <file> <fromLine> <toLine>
import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

const file =
  process.argv[2] ??
  "/home/ishaq2321/bb_tests/repositories/go-tools/go/analysis/passes/modernize/testdata/src/slicesbackward/slicesbackward.go"
const from = Number(process.argv[3] ?? 205)
const to = Number(process.argv[4] ?? 245)
const src = fs.readFileSync(file, "utf8")
const parser = await ASTEngine.getParser("go" as any)
const root: any = parser.parse(src).rootNode

const walk = (n: any, depth: number) => {
  const s = n.startPosition.row + 1
  const e = n.endPosition.row + 1
  if (e < from || s > to) return
  const text = n.text.replace(/\s+/g, " ").slice(0, 52)
  const flag = n.type === "ERROR" || n.isMissing ? " <== RECOVERY" : ""
  console.log(`  ${"  ".repeat(depth)}${n.type} [${s}-${e}] ${JSON.stringify(text)}${flag}`)
  for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), depth + 1)
}
console.log(`=== ${file} lines ${from}-${to} ===`)
walk(root, 0)
