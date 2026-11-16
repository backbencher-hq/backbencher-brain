// go (round 3) — WHY `s[i].Lock()` / `s[i].Unlock()` are truth-only in
// go-tools/go/analysis/passes/modernize/testdata/src/slicesbackward/slicesbackward.go.
//
// Run: bun script/m14/tmp/go-799-lockcall.ts
import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
import { deriveGoEdges, deriveGoImplements, deriveTreeEdges } from "../differential"

const REAL = "<corpus-root>/bb_tests/repositories/go-tools/go/analysis/passes/modernize/testdata/src/slicesbackward/slicesbackward.go"

const SNIPPET = `package slicesbackward

import "sync"

func indexExprMethodCall(s []sync.Mutex) {
	for i := len(s) - 1; i >= 0; i-- {
		s[i].Lock()
		s[i].Unlock()
	}
}
`

const analyzer = new RealGoAnalyzer()
const parser = await ASTEngine.getParser("go" as any)

async function dump(label: string, src: string) {
  const tree: any = parser.parse(src)
  const res: any = await analyzer.analyze(tree.rootNode, src, label)
  const calls = (res.relationships ?? [])
    .filter((r: any) => String(r.type) === "calls")
    .map((r: any) => `${String(r.target)}@${r.line_number ?? r.metadata?.line ?? "?"}`)
  const truth = [
    ...deriveTreeEdges(tree.rootNode, "go"),
    ...deriveGoEdges(tree.rootNode),
    ...deriveGoImplements(tree.rootNode),
  ].filter((e: any) => e.label === "calls")
  console.log(`--- ${label}`)
  console.log(`  analyzer calls: ${JSON.stringify(calls)}`)
  console.log(`  truth calls:    ${JSON.stringify(truth.map((t: any) => `${t.target} from=${t.from}`))}`)
  const lines = src.split("\n")
  lines.forEach((l, i) => {
    if (!/(Lock|Unlock)\(\)/.test(l)) return
    console.log(`  line ${i + 1}: ${l.trim()}`)
  })
}

await dump("snippet.go", SNIPPET)
await dump(REAL, fs.readFileSync(REAL, "utf8"))
