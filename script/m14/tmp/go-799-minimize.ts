// go (round 3) — which ingredient of the minimal repro suppresses the call?
//
// Minimal suppressing text (from script/m14/tmp/go-799-delta.ts):
//
//   package p
//   import ("slices"; "sync")
//   var _ = slices.Backward[[]int]
//   func indexExprMethodCall(s []sync.Mutex) {
//     for i := len(s) - 1; i >= 0; i-- { s[i].Lock(); s[i].Unlock() }
//   }
//   func (stringer) String() string { return "" }   // receiver type is NOT declared anywhere
//
// Run: bun script/m14/tmp/go-799-minimize.ts
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"

const IMPORT = `import (\n\t"slices"\n\t"sync"\n)\n\nvar _ = slices.Backward[[]int]\n\n`
const CALLFN = `func caller(s []sync.Mutex) {\n\tfor i := len(s) - 1; i >= 0; i-- {\n\t\ts[i].Lock()\n\t\ts[i].Unlock()\n\t}\n}\n\n`

const CASES: Array<[string, string]> = [
  ["0 control: minimal repro as found", `package p\n\n${IMPORT}${CALLFN}func (stringer) String() string { return "" }\n`],
  ["1 receiver type DECLARED before", `package p\n\ntype stringer struct{}\n\n${IMPORT}${CALLFN}func (stringer) String() string { return "" }\n`],
  ["2 method renamed String -> Foo", `package p\n\n${IMPORT}${CALLFN}func (stringer) Foo() string { return "" }\n`],
  ["3 receiver type renamed stringer -> Zz", `package p\n\n${IMPORT}${CALLFN}func (Zz) String() string { return "" }\n`],
  ["4 slices import + var dropped", `package p\n\nimport (\n\t"sync"\n)\n\n${CALLFN}func (stringer) String() string { return "" }\n`],
  ["5 single (ungrouped) import", `package p\n\nimport "sync"\n\n${CALLFN}func (stringer) String() string { return "" }\n`],
  ["6 method declaration MOVED before the caller", `package p\n\n${IMPORT}func (stringer) String() string { return "" }\n\n${CALLFN}`],
  ["7 only one call (Lock)", `package p\n\n${IMPORT}func caller(s []sync.Mutex) {\n\ts[0].Lock()\n}\n\nfunc (stringer) String() string { return "" }\n`],
  ["8 callee is an UNKNOWN method of a LOCAL type", `package p\n\n${IMPORT}func caller(s []T) {\n\ts[0].Foo()\n}\n\ntype T struct{}\n\nfunc (stringer) String() string { return "" }\n`],
  ["9 the method DECLARES the same leaf (Lock)", `package p\n\n${IMPORT}${CALLFN}func (stringer) Lock() string { return "" }\n`],
  ["10 the method is on an UNRESOLVABLE receiver, plain func declared instead", `package p\n\n${IMPORT}${CALLFN}func helper() string { return "" }\n`],
]

const parser = await ASTEngine.getParser("go" as any)
const analyzer = new RealGoAnalyzer()
for (const [name, src] of CASES) {
  const tree: any = parser.parse(src)
  const res: any = await analyzer.analyze(tree.rootNode, src, "probe.go")
  const calls = (res.relationships ?? []).filter((r: any) => String(r.type) === "calls").map((r: any) => String(r.target))
  console.log(`${name}\n   calls=${JSON.stringify(calls)}`)
}
