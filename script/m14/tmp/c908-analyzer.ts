// #908: what does the ANALYZER actually emit for YY_INITIAL_VALUE in jq's
// src/parser.c? Production entry (parseFile), not the direct analyze() trap.
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

const FILE = "<corpus-root>/bb_tests/repositories/jq/src/parser.c"
const res: any = await ASTEngine.parseFile(FILE, readFileSync(FILE, "utf8"))
const rels: any[] = res?.relationships ?? res?.result?.relationships ?? []
console.log(`relationships: ${rels.length}`)
const hits = rels.filter((r: any) => (r.targetName ?? r.target ?? "") === "YY_INITIAL_VALUE")
console.log(`rows targeting YY_INITIAL_VALUE: ${hits.length}`)
for (const h of hits) {
  console.log(`  ROW: ${JSON.stringify(h)}`)
}
console.log(`\nrow keys: ${JSON.stringify(Object.keys(rels[0] ?? {}))}`)
console.log(`sample row: ${JSON.stringify(rels[0])}`)
const syms: any[] = res?.symbols ?? res?.result?.symbols ?? []
console.log(`symbols: ${syms.length}; YY_INITIAL_VALUE symbol: ${syms.filter((s: any) => s.name === "YY_INITIAL_VALUE").map((s: any) => `${s.kind}@${s.line ?? s.range?.startLine}`).join(", ") || "(none)"}`)
