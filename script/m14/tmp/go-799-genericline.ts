// go (round 3) — decisive test on the REAL file: is the package-scope generic
// instantiation `var _ = slices.Backward[[]int]` what costs Lock/Unlock?
//
// Run: bun script/m14/tmp/go-799-genericline.ts
import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"

const REAL = "/home/ishaq2321/bb_tests/repositories/go-tools/go/analysis/passes/modernize/testdata/src/slicesbackward/slicesbackward.go"
const real = fs.readFileSync(REAL, "utf8")

const stripGeneric = real
  .split("\n")
  .filter((l) => !l.includes("slices.Backward[[]int]"))
  .join("\n")

const parser = await ASTEngine.getParser("go" as any)
const analyzer = new RealGoAnalyzer()

async function report(label: string, src: string) {
  const tree: any = parser.parse(src)
  const res: any = await analyzer.analyze(tree.rootNode, src, label)
  const calls = (res.relationships ?? [])
    .filter((r: any) => String(r.type) === "calls")
    .map((r: any) => `${String(r.target)}@${r.line_number ?? r.metadata?.line ?? "?"}`)
  const inst = (res.relationships ?? [])
    .filter((r: any) => String(r.type) === "instantiates")
    .map((r: any) => `${String(r.target)}@${r.line_number ?? r.metadata?.line ?? "?"}`)
  const byType: Record<string, number> = {}
  for (const r of res.relationships ?? []) {
    const t = String(r.type)
    byType[t] = (byType[t] ?? 0) + 1
  }
  const hasLock = calls.some((c) => c.startsWith("Lock"))
  const hasUnlock = calls.some((c) => c.startsWith("Unlock"))
  console.log(`${label}: calls=${calls.length} Lock=${hasLock} Unlock=${hasUnlock} instantiates=${JSON.stringify(inst.slice(0, 5))}`)
  console.log(`   byType=${JSON.stringify(byType)}`)
  return { calls, hasLock, hasUnlock }
}

await report("real file", real)
await report("real file MINUS the generic instantiation line", stripGeneric)

// Synthetic confirmation: does an unrelated package-scope generic instantiation
// suppress a later, unrelated function's member call on an IMPORTED type?
const SYN: Array<[string, string]> = [
  [
    "synthetic: no generic line",
    `package p\n\nimport (\n\t"sync"\n)\n\nfunc caller(s []sync.Mutex) {\n\ts[0].Lock()\n}\n\nfunc helper() string { return "" }\n`,
  ],
  [
    "synthetic: generic line + local generic func",
    `package p\n\nimport (\n\t"sync"\n)\n\nfunc Id[T any](x T) T { return x }\n\nvar _ = Id[[]int](nil)\n\nfunc caller(s []sync.Mutex) {\n\ts[0].Lock()\n}\n\nfunc helper() string { return "" }\n`,
  ],
]
for (const [label, src] of SYN) {
  const tree: any = parser.parse(src)
  const res: any = await analyzer.analyze(tree.rootNode, src, "syn.go")
  const calls = (res.relationships ?? []).filter((r: any) => String(r.type) === "calls").map((r: any) => `${String(r.target)}`)
  const inst = (res.relationships ?? []).filter((r: any) => String(r.type) === "instantiates").map((r: any) => `${String(r.target)}`)
  console.log(`${label}: calls=${JSON.stringify(calls)} instantiates=${JSON.stringify(inst)}`)
}
