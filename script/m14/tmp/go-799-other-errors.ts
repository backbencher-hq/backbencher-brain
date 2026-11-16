import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
const FILES = [
 "<corpus-root>/bb_tests/repositories/go-tools/go/analysis/passes/modernize/testdata/src/slicescontains/slicescontains.go",
 "<corpus-root>/bb_tests/repositories/go-tools/internal/gcimporter/testdata/genmeth/a.go",
 "<corpus-root>/bb_tests/repositories/go-tools/go/analysis/passes/modernize/testdata/src/slicesbackward/slicesbackward.go",
]
const parser = await ASTEngine.getParser("go" as any)
for (const f of FILES) {
  const src = fs.readFileSync(f, "utf8")
  const tree: any = parser.parse(src)
  console.log(`=== ${f.replace(/.*repositories\//, "")}  hasError=${tree.rootNode.hasError}`)
  const stack: any[] = [tree.rootNode]
  let shown = 0
  while (stack.length && shown < 4) {
    const n = stack.pop()!
    if (n.type === "ERROR") {
      const text = String(n.text)
      console.log(`  ERROR at line ${n.startPosition.row + 1}: ${JSON.stringify(text.split("\n")[0].slice(0, 90))}`)
      console.log(`     spans ${text.split("\n").length} lines; first decl-ish line: ${JSON.stringify(text.split("\n").find((l: string) => /^(func|type|var|const|import)\b/.test(l)) ?? null)}`)
      shown++
      continue
    }
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  }
  // what does the SOURCE say at the region start?
  const lines = src.split("\n")
  const marker = lines.findIndex((l) => l.includes("slices.Contains") || l.includes("generic") || l.includes("func "))
  console.log(`  source around first decl: ${JSON.stringify(lines.slice(Math.max(0, marker), marker + 3).map(l => l.trim().slice(0, 70)))}`)
}
