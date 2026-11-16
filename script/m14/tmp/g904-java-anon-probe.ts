// #904 residual probe (java): scala3 tests/untried/pos/t3943/Outer_1.java —
// the oracle derives `anonymous_Inner.foo -> Inner.foo`; the lane reported it
// MISSING. Record what the analyzer actually emits so the gap is registered
// with evidence rather than a sentence.
//
// Run: bun script/m14/tmp/g904-java-anon-probe.ts
import { parseFile } from "../../../src/ast/pool-worker"

const FILE = "<corpus-root>/bb_tests/repositories/scala3/tests/untried/pos/t3943/Outer_1.java"
const ROOT = "<corpus-root>/bb_tests/repositories/scala3"

const r: any = await parseFile(FILE, ROOT)
console.log("=== symbols ===")
for (const s: any of r.symbols ?? []) {
  console.log(`${s.name}  kind=${s.kind} owner=${s.ownerName} line=${s.range?.startLine} meta=${JSON.stringify({ superTypes: s.metadata?.superTypes, isOverride: s.metadata?.isOverride, anon: s.metadata?.isAnonymous })}`)
}
console.log("\n=== all relationships ===")
for (const x: any of r.relationships ?? []) {
  console.log(`${x.type}  ${x.source} -> ${x.target}  conf=${x.confidence} ${JSON.stringify(x.metadata)}`)
}
