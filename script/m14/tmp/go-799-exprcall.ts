// go (round 3) — the `s[i].M()` shape, isolated.
//
// The full-extent lane (script/m14/tmp/go-799-surface.ts) reports exactly two
// `calls` MISSING rows on go-tools, both in
// go/analysis/passes/modernize/testdata/src/slicesbackward/slicesbackward.go:
// `s[i].Lock()` and `s[i].Unlock()` — member calls whose RECEIVER is an index
// expression and whose statement is an expression statement. The same file's
// `_ = s[i].String()` (an assignment RHS) DOES match, so the question is which
// position/statement shape loses the call.
//
// Run: bun script/m14/tmp/go-799-exprcall.ts
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
import { deriveGoEdges, deriveGoImplements, deriveTreeEdges } from "../differential"

const SRC = `package p

import "sync"

type T struct{}
type I interface{ M() error }

func (t T) M() error { return nil }

func exprStatement(s []T, m []sync.Mutex) {
	s[0].M()
	m[0].Lock()
}

func assignRHS(s []T) {
	_ = s[0].M()
}

func condition(s []T) {
	if s[0].M() != nil {
	}
}

func plainStatement(t T) {
	t.M()
}

func plainAssign(t T) {
	_ = t.M()
}

func chained(s []T) {
	s[0].M().Error()
}

func viaPointer(p *T) {
	p.M()
}

func inGoRoutine(s []T) {
	go s[0].M()
}

func deferred(s []T) {
	defer s[0].M()
}

func explicitSliceIndex(s []T, i int) {
	s[i].M()
}
`

const parser = await ASTEngine.getParser("go" as any)
const analyzer = new RealGoAnalyzer()
const tree: any = parser.parse(SRC)
const res: any = await analyzer.analyze(tree.rootNode, SRC, "probe.go")

const fmt = (e: any) => `${e.type ?? e.label} -> ${JSON.stringify(e.target ?? e.to)}`
console.log("=== analyzer edges (calls/uses/implements/instantiates) ===")
for (const r of res.relationships ?? []) {
  const t = String(r.type ?? "")
  if (!["calls", "uses", "implements", "instantiates", "extends"].includes(t)) continue
  console.log(" ", fmt(r), "line:", r.line_number ?? r.metadata?.line ?? "?")
}

const truth: any[] = [
  ...deriveTreeEdges(tree.rootNode, "go"),
  ...deriveGoEdges(tree.rootNode),
  ...deriveGoImplements(tree.rootNode),
]
console.log("=== truth edges ===")
for (const r of truth) console.log(" ", `${r.label} -> ${JSON.stringify(r.target)} from=${r.from}`)

// Which function bodies did the analyzer see a call in?
const lines = SRC.split("\n")
const callsByLine = new Map<number, string[]>()
for (const r of res.relationships ?? []) {
  if (String(r.type) !== "calls") continue
  const ln = Number(r.line_number ?? r.metadata?.line ?? 0)
  callsByLine.set(ln, [...(callsByLine.get(ln) ?? []), String(r.target)])
}
console.log("=== the source lines that call M, with what the analyzer emitted there ===")
lines.forEach((l, i) => {
  if (!/\.(M|Lock|Error)\(\)/.test(l)) return
  const ln = i + 1
  console.log(`  line ${ln}: ${l.trim().padEnd(24)} -> ${JSON.stringify(callsByLine.get(ln) ?? [])}`)
})
