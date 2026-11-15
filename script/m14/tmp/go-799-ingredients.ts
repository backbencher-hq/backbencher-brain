// go (round 3) — the ingredients, one at a time.
//
// Case 4/5 of the previous matrix ("no `slices` import + no `var _ = slices.Backward[[]int]`,
// or an ungrouped single import") emit the calls, while the control does not. This
// separates the two candidate ingredients and checks whether a suppressed call
// turns into a `uses`/`references` edge instead of vanishing.
//
// Run: bun script/m14/tmp/go-799-ingredients.ts
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"

const CALLER = `func caller(s []sync.Mutex) {\n\tfor i := len(s) - 1; i >= 0; i-- {\n\t\ts[i].Lock()\n\t\ts[i].Unlock()\n\t}\n}\n\n`

const CASES: Array<[string, string]> = [
  ["A two imports (slices+sync) + generic var line", `package p\n\nimport (\n\t"slices"\n\t"sync"\n)\n\nvar _ = slices.Backward[[]int]\n\n${CALLER}func helper() string { return "" }\n`],
  ["B two imports (slices+sync), NO var line", `package p\n\nimport (\n\t"slices"\n\t"sync"\n)\n\n${CALLER}func helper() string { return "" }\n`],
  ["C two imports (fmt+sync) + non-generic var line", `package p\n\nimport (\n\t"fmt"\n\t"sync"\n)\n\nvar _ = fmt.Sprint("x")\n\n${CALLER}func helper() string { return "" }\n`],
  ["D grouped import, sync only, NO var line", `package p\n\nimport (\n\t"sync"\n)\n\n${CALLER}func helper() string { return "" }\n`],
  ["E grouped import, sync only, WITH var line", `package p\n\nimport (\n\t"sync"\n)\n\nvar _ = sync.Once{}\n\n${CALLER}func helper() string { return "" }\n`],
  ["F no imports at all, local type, later helper", `package p\n\ntype T struct{}\n\nfunc caller(s []T) {\n\ts[0].Lock()\n\ts[0].Unlock()\n}\n\nfunc helper() string { return "" }\n`],
]

const parser = await ASTEngine.getParser("go" as any)
const analyzer = new RealGoAnalyzer()
for (const [name, src] of CASES) {
  const tree: any = parser.parse(src)
  const res: any = await analyzer.analyze(tree.rootNode, src, "probe.go")
  const rels = res.relationships ?? []
  const calls = rels.filter((r: any) => String(r.type) === "calls").map((r: any) => String(r.target))
  const others = rels.filter((r: any) => String(r.type) !== "calls").map((r: any) => `${String(r.type)}->${String(r.target)}`)
  const byType: Record<string, number> = {}
  for (const r of rels) byType[String(r.type)] = (byType[String(r.type)] ?? 0) + 1
  console.log(`${name}\n   calls=${JSON.stringify(calls)}\n   byType=${JSON.stringify(byType)}\n   nonCall=${JSON.stringify(others.slice(0, 10))}`)
}
