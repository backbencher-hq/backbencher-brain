// go (round 3) — the unnamed-receiver repro, minimized.
//
// `func (stringer) String() string` (a receiver with NO name, which is legal Go)
// added to a file makes the file's call edges disappear. This reduces that to the
// smallest input and reports whether `analyze()` throws or returns an empty edge
// list — the two have very different fixes.
//
// Run: bun script/m14/tmp/go-799-unnamed-receiver.ts
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"

const CASES: Array<[string, string]> = [
  [
    "A: named receiver + method, plus a call",
    `package p
import "sync"
type stringer struct{}
func (x stringer) String() string { return "" }
func f(s []sync.Mutex) { s[0].Lock() }
`,
  ],
  [
    "B: UNNAMED receiver + method, plus a call",
    `package p
import "sync"
type stringer struct{}
func (stringer) String() string { return "" }
func f(s []sync.Mutex) { s[0].Lock() }
`,
  ],
  [
    "C: UNNAMED receiver, no call anywhere",
    `package p
type stringer struct{}
func (stringer) String() string { return "" }
`,
  ],
  [
    "D: named receiver, no call anywhere",
    `package p
type stringer struct{}
func (x stringer) String() string { return "" }
`,
  ],
]

const parser = await ASTEngine.getParser("go" as any)
const analyzer = new RealGoAnalyzer()

for (const [name, src] of CASES) {
  const tree: any = parser.parse(src)
  let res: any
  let err: any = null
  try {
    res = await analyzer.analyze(tree.rootNode, src, "probe.go")
  } catch (e: any) {
    err = e
  }
  console.log(`--- ${name}`)
  if (err) {
    console.log(`  THREW: ${err?.message}`)
    continue
  }
  const byType: Record<string, number> = {}
  for (const r of res.relationships ?? []) {
    const t = String(r.type)
    byType[t] = (byType[t] ?? 0) + 1
  }
  console.log(`  symbols=${(res.symbols ?? []).length} relationships=${(res.relationships ?? []).length} byType=${JSON.stringify(byType)}`)
  console.log(`  symbols: ${JSON.stringify((res.symbols ?? []).map((s: any) => `${s.name}|${s.kind}`).slice(0, 12))}`)
}
