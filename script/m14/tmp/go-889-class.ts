// go (round 3) — #889 is one surface of a CLASS: "a declaration that names N
// names must publish N symbols". This enumerates every declaration form in Go
// that can name more than one name and prints what the lane publishes for each.
//
// Run: bun script/m14/tmp/go-889-class.ts
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"

const SRC = `package p

import "io"

var G1, G2 int
var G3 = 1
const C1, C2 = 1, 2
const (
	K1, K2 int = 1, 2
)

type S struct {
	A, B int
	io.Reader
	*S2
	C struct{ D, E int }
}

type S2 struct{ Z int }

type Pair[X, Y any] struct {
	First  X
	Second Y
}

func f(a, b int, c string) (x, y int) {
	var v1, v2 int
	const l1, l2 = 1, 2
	_ = v1 + v2 + l1 + l2
	v3, v4 := 1, 2
	_ = v3 + v4
	for i, v := range []int{1} {
		_ = i + v
	}
	return a + b, x + y
}

type I interface {
	M1(a, b int) (c, d int)
	io.Closer
}
`

const parser = await ASTEngine.getParser("go" as any)
const analyzer = new RealGoAnalyzer()
const tree: any = parser.parse(SRC)
const res: any = await analyzer.analyze(tree.rootNode, SRC, "probe.go")

const byKind: Record<string, string[]> = {}
for (const s of res.symbols ?? []) {
  const k = `${s.kind}${s.ownerName ? `@${s.ownerName}` : ""}`
  byKind[k] = [...(byKind[k] ?? []), String(s.name)]
}
console.log("=== published symbols by kind ===")
for (const [k, v] of Object.entries(byKind)) console.log(`  ${k}: ${JSON.stringify(v)}`)

console.log("\n=== function symbols' parameters ===")
for (const s of res.symbols ?? []) {
  if (s.kind !== "function" && s.kind !== "method") continue
  console.log(`  ${s.name}: ${JSON.stringify((s.parameters ?? []).map((p: any) => `${p.name}:${p.type}`))} returnType=${JSON.stringify(s.returnType ?? null)}`)
}

console.log("\n=== expectations ===")
const expect: Array<[string, string[]]> = [
  ["package-scope var G1, G2", ["G1", "G2"]],
  ["package-scope const C1, C2", ["C1", "C2"]],
  ["grouped const block K1, K2", ["K1", "K2"]],
  ["struct S fields A, B", ["A", "B"]],
  ["struct S embedded io.Reader", ["Reader"]],
  ["struct S embedded *S2", ["S2"]],
  ["struct S nested C (field)", ["C"]],
  ["function f params a, b, c", ["a", "b", "c"]],
  ["interface I methods M1, Close (embedded io.Closer)", ["M1", "Close"]],
  ["interface M1 params a, b", ["a", "b"]],
]
const allNames = new Set((res.symbols ?? []).map((s: any) => String(s.name)))
const paramsNames = new Set<string>()
for (const s of res.symbols ?? []) for (const p of s.parameters ?? []) paramsNames.add(String((p as any).name))
for (const [label, names] of expect) {
  const miss = names.filter((n) => !allNames.has(n) && !paramsNames.has(n))
  console.log(`  ${miss.length === 0 ? "OK  " : "MISS"} ${label}${miss.length ? `  missing: ${JSON.stringify(miss)}` : ""}`)
}
