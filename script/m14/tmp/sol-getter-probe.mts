// Diagnostic probe (tmp): is the synthesised-getter edge dropped by the ANALYZER
// or by the WORKER BOUNDARY? Calls analyze() directly, then parseFile(), same file.
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { RealSolidityAnalyzer } from "../../../src/ast/real-solidity-analyzer"
import { getParser } from "../../../src/ast/engine"
import { parseFile } from "../../../src/ast/pool-worker"

const file = path.resolve(process.argv[2])
const src = readFileSync(file, "utf8")

const parser = await getParser("solidity" as any)
const tree = parser.parse(src)!
const a: any = new (RealSolidityAnalyzer as any)()
const direct: any = a.analyze(tree.rootNode, src, file)
const rels = direct.relationships ?? []
const getterRels = rels.filter((r: any) => r.metadata?.isGetterFor || r.metadata?.isSynthesisedGetter)
const getterSyms = (direct.symbols ?? []).filter((s: any) => s.metadata?.isSynthesisedGetter)
console.log("ANALYZER   rels=%d getterRels=%d getterSyms=%d", rels.length, getterRels.length, getterSyms.length)
for (const r of getterRels) console.log("   ", r.source, r.type, r.target, "@" + r.line_number)

const viaWorker: any = await parseFile(file, path.dirname(file))
const wrels = viaWorker.relationships ?? []
const wget = wrels.filter((r: any) => r.metadata?.isGetterFor || r.metadata?.isSynthesisedGetter)
console.log("PARSEFILE  rels=%d getterRels=%d getterSyms=%d",
  wrels.length, wget.length, (viaWorker.symbols ?? []).filter((s: any) => s.metadata?.isSynthesisedGetter).length)
for (const r of wget) console.log("   ", r.source, r.type, r.target, "@" + r.line_number)
