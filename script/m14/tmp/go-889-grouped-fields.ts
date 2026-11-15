// go (round 3) — #889 "grouped field declaration keeps only the first name", and
// whether the differential oracle mirrors the bogus `instantiates` edge that the
// grammar's error region produces.
//
// Run: bun script/m14/tmp/go-889-grouped-fields.ts
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
import { deriveGoEdges, deriveTreeEdges } from "../differential"

const SRC = `package p

type S struct {
	A, B int
	C, D, E string
	F float64
	g, h *S
}

func f(s S) int {
	var x, y int
	x = s.A + s.B
	y = x
	_ = y
	return x
}

func g(a, b int) (p, q int) {
	p = a
	q = b
	return p, q
}
`

const parser = await ASTEngine.getParser("go" as any)
const analyzer = new RealGoAnalyzer()
const tree: any = parser.parse(SRC)
const res: any = await analyzer.analyze(tree.rootNode, SRC, "probe.go")

console.log("=== symbols (kind: name) ===")
for (const s of res.symbols ?? []) {
  console.log(`  ${s.kind}: ${s.name}${s.ownerName ? `  owner=${s.ownerName}` : ""}`)
}
const fieldNames = (res.symbols ?? []).filter((s: any) => ["property", "field", "variable"].includes(String(s.kind))).map((s: any) => String(s.name))
console.log(`\n  field/variable names published: ${JSON.stringify(fieldNames)}`)
console.log(`  A=${fieldNames.includes("A")} B=${fieldNames.includes("B")} C=${fieldNames.includes("C")} D=${fieldNames.includes("D")} E=${fieldNames.includes("E")} F=${fieldNames.includes("F")} g=${fieldNames.includes("g")} h=${fieldNames.includes("h")}`)

console.log("\n=== the shape in the tree ===")
const dump = (n: any, d: number) => {
  if (d > 6) return
  if (n.type === "field_declaration" || n.type === "field_identifier" || n.type === "var_spec" || n.type === "parameter_declaration" || n.type === "identifier") {
    console.log("  ".repeat(d) + `${n.type}: ${JSON.stringify(String(n.text).slice(0, 40))}` + (n.isMissing ? "  MISSING" : ""))
  }
  for (let i = 0; i < n.namedChildCount; i++) dump(n.namedChild(i), d + 1)
}
dump(tree.rootNode, 0)

// The oracle's view of the grammar-error region (minimal generic-instantiation case).
const GEN = `package p\n\nimport (\n\t"slices"\n)\n\nvar _ = slices.Backward[[]int]\n\nfunc caller(s []int) {\n\t_ = s\n}\n`
const t2: any = parser.parse(GEN)
console.log(`\n=== grammar-error case: does the ORACLE also emit the bogus edge?`)
const truth = [...deriveTreeEdges(t2.rootNode, "go"), ...deriveGoEdges(t2.rootNode)]
for (const e of truth) console.log(`  truth ${(e as any).label} -> ${JSON.stringify((e as any).target)}`)
const res2: any = await analyzer.analyze(t2.rootNode, GEN, "gen.go")
for (const r of res2.relationships ?? []) {
  console.log(`  analyzer ${String(r.type)} -> ${JSON.stringify(String(r.target))} md=${JSON.stringify(r.metadata?.relationshipType ?? "")}`)
}
console.log(`  root.hasError=${t2.rootNode.hasError}`)
