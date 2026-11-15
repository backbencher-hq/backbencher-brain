import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id.ts"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer.ts"
import { ASTEngine } from "../../../../src/ast/engine.ts"
import { parseForSafety } from "../../../../src/ast/safety-primitives.ts"
import { readFileSync } from "node:fs"
const root = path.resolve("validation/tools/bb_edit/work/run/tiers/t0-polyglot")
const id = getProjectId(root)
for (const name of ["total","basePrice","getStock"]) {
  const f = await ASTEngine.findSymbol(id, name)
  console.log(name, "matches:", f.matches.length, f.matches.map(m=>({file:m.fileId, bs:m.byteStart, be:m.byteEnd, ls:m.lineStart})))
}
const ts = path.resolve(root, "ts-js/src/checkout.ts")
const p = await parseForSafety(ts, readFileSync(ts,"utf8"))
console.log("bodyRanges:", p.bodyRanges)
console.log("declaredNames:", p.declaredNames.map(d=>({t:d.text,s:d.declarationStart,e:d.declarationEnd,type:d.declarationType})))
