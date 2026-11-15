// go (round 3) — the hypothesis: a file-wide method inventory acts as a FILTER
// only when it is non-empty, so declaring any method anywhere in a file drops
// every selector call whose leaf is not a declared method (an imported type's
// method like `sync.Mutex.Lock`).
//
// Run: bun script/m14/tmp/go-799-knownmethod.ts
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"

const CASES: Array<[string, string]> = [
  [
    "1: no method declared anywhere -> is Lock emitted?",
    `package p
import "sync"
func f(s []sync.Mutex) { s[0].Lock() }
`,
  ],
  [
    "2: one method declared AFTER the call -> is Lock emitted?",
    `package p
import "sync"
func f(s []sync.Mutex) { s[0].Lock() }
type T struct{}
func (x T) M() {}
`,
  ],
  [
    "3: one method declared BEFORE the call -> is Lock emitted?",
    `package p
import "sync"
type T struct{}
func (x T) M() {}
func f(s []sync.Mutex) { s[0].Lock() }
`,
  ],
  [
    "4: local method call AND imported method call, method declared first",
    `package p
import "sync"
type T struct{}
func (x T) M() {}
func (x T) N() {}
func f(t *T, s []sync.Mutex) { t.M(); s[0].Lock() }
`,
  ],
  [
    "5: same as 4 but the local method declared AFTER the call site",
    `package p
import "sync"
func f(t *T, s []sync.Mutex) { t.M(); s[0].Lock() }
type T struct{}
func (x T) M() {}
`,
  ],
]

const parser = await ASTEngine.getParser("go" as any)
const analyzer = new RealGoAnalyzer()
for (const [name, src] of CASES) {
  const tree: any = parser.parse(src)
  const res: any = await analyzer.analyze(tree.rootNode, src, "probe.go")
  const calls = (res.relationships ?? [])
    .filter((r: any) => String(r.type) === "calls")
    .map((r: any) => `${String(r.target)}@${r.line_number ?? r.metadata?.line ?? "?"}`)
  console.log(`${name}\n   calls=${JSON.stringify(calls)}  symbols=${JSON.stringify((res.symbols ?? []).map((s: any) => `${s.name}|${s.kind}`).slice(0, 10))}`)
}
