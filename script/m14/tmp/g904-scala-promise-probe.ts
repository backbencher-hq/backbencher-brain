// #904: why is `Transformation.submitWithValue -> DefaultPromise.submitWithValue`
// MISSING at 200-file depth on scala3? Dump the symbols that own it and every
// override edge the analyzer emits for them, plus their metadata superTypes.
//
// Run: bun script/m14/tmp/g904-scala-promise-probe.ts
import { parseFile } from "../../../src/ast/pool-worker"

const FILE = "<corpus-root>/bb_tests/repositories/scala3/library/src/scala/concurrent/impl/Promise.scala"
const ROOT = "<corpus-root>/bb_tests/repositories/scala3"

const r: any = await parseFile(FILE, ROOT)
const syms = (r.symbols ?? []).filter((s: any) => String(s.name).includes("submitWithValue") || /Transformation|DefaultPromise/.test(String(s.ownerName ?? "")))
console.log("=== symbols (submitWithValue / owners Transformation|DefaultPromise) ===")
for (const s of syms.slice(0, 40)) {
  console.log(`${s.name}  kind=${s.kind} owner=${s.ownerName} line=${s.range?.startLine} meta=${JSON.stringify({ superTypes: s.metadata?.superTypes, isOverride: s.metadata?.isOverride, isPhantom: s.metadata?.isPhantom })}`)
}
console.log("\n=== override edges touching submitWithValue or those owners ===")
const ovr = (r.relationships ?? []).filter((x: any) => String(x.type) === "overrides")
for (const o of ovr) {
  if (/submitWithValue|Transformation|DefaultPromise/.test(`${o.source} ${o.target}`)) {
    console.log(`${o.source} -> ${o.target} conf=${o.confidence} ${JSON.stringify(o.metadata)}`)
  }
}
console.log(`\ntotal overrides edges in file: ${ovr.length}`)
