// go (round 3) — WHICH pass emits `instantiates -> s` for a package-scope generic
// instantiation, and with what metadata. Runs the minimal case and prints the
// full edge JSON plus the symbol table.
//
// Run: bun script/m14/tmp/go-799-bogus-inst.ts
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"

const SRC = `package p

import (
\t"slices"
\t"sync"
)

var _ = slices.Backward[[]int]

func caller(s []sync.Mutex) {
\ts[0].Lock()
\ts[0].Unlock()
}

func helper() string { return "" }
`

const parser = await ASTEngine.getParser("go" as any)
const analyzer = new RealGoAnalyzer()
const tree: any = parser.parse(SRC)
const res: any = await analyzer.analyze(tree.rootNode, SRC, "probe.go")

console.log("=== symbols ===")
for (const s of res.symbols ?? []) {
  console.log(" ", JSON.stringify({ name: s.name, kind: s.kind, owner: s.ownerName, line: s.startLine }))
}
console.log("=== instantiates edges (full) ===")
for (const r of res.relationships ?? []) {
  if (String(r.type) !== "instantiates") continue
  console.log(" ", JSON.stringify(r))
}
console.log("=== all edges ===")
for (const r of res.relationships ?? []) {
  console.log(` ${String(r.type)} ${String(r.source)} -> ${String(r.target)} line=${r.line_number ?? r.metadata?.line ?? "?"} md=${JSON.stringify(r.metadata ?? {})}`)
}
console.log("=== same file WITHOUT the generic line ===")
const SRC2 = SRC.split("\n").filter((l) => !l.includes("slices.Backward")).join("\n")
const t2: any = parser.parse(SRC2)
const res2: any = await analyzer.analyze(t2.rootNode, SRC2, "probe.go")
for (const r of res2.relationships ?? []) {
  console.log(` ${String(r.type)} ${String(r.source)} -> ${String(r.target)}`)
}
