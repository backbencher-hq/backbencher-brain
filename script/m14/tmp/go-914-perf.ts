// go #914 — where the implements stage spends its time, analyzer vs oracle.
// Run: bun script/m14/tmp/go-914-perf.ts <file.go>
import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
import { deriveGoImplements } from "../differential"

const file = process.argv[2]
const src = fs.readFileSync(file, "utf8")
const parser = await ASTEngine.getParser("go" as any)
let t0 = performance.now()
const tree = parser.parse(src)
let t1 = performance.now()
const a: any = new RealGoAnalyzer()
const res: any = await a.analyze(tree.rootNode, src, file)
let t2 = performance.now()
const o = deriveGoImplements(tree.rootNode)
let t3 = performance.now()
const ifaces = (res.symbols ?? []).filter((s: any) => s.metadata?.isInterface).length
const methods = (res.symbols ?? []).filter((s: any) => String(s.kind) === "method").length
const recv = new Set((res.symbols ?? []).filter((s: any) => String(s.kind) === "method").map((s: any) => s.metadata?.receiverType ?? s.metadata?.receiver?.typeName).filter(Boolean))
console.log(JSON.stringify({
  file, bytes: src.length, parse_ms: Math.round(t1 - t0), analyze_ms: Math.round(t2 - t1),
  oracle_ms: Math.round(t3 - t2), ifaces, methods, receiverTypes: recv.size,
  analyzerImpls: (res.relationships ?? []).filter((r: any) => String(r.type) === "implements").length,
  oracleImpls: o.length,
}, null, 1))
