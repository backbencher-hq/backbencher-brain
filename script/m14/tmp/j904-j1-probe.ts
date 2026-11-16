// #904 follow-up: J_1.java (`B extends A<Object,Object>`, B.putAll annotated
// @Override, A.putAll(Map<? extends K, ? extends V>)) — which tier emits the
// override edge, and what does the heritage edge look like?
//
// Run: bun script/m14/tmp/j904-j1-probe.ts
import { parseFile } from "../../../src/ast/pool-worker"

const FILE = "<corpus-root>/bb_tests/repositories/scala3/tests/pos-java-interop-separate/java-object-any-unification-1/J_1.java"
const ROOT = "<corpus-root>/bb_tests/repositories/scala3"

const r: any = await parseFile(FILE, ROOT)
console.log("=== symbols ===")
for (const s: any of r.symbols ?? []) console.log(`${s.name} kind=${s.kind} owner=${s.ownerName} params=${JSON.stringify((s.parameters ?? []).map((p: any) => p.type))}`)
console.log("\n=== relationships ===")
for (const x: any of r.relationships ?? []) console.log(`${x.type}  ${x.source} -> ${x.target}  conf=${x.confidence} ${JSON.stringify(x.metadata)}`)
