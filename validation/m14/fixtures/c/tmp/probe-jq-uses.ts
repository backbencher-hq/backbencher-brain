import * as path from "node:path"
import { readFileSync } from "node:fs"
import { getParser } from "../../../../../src/ast/engine"
import { deriveCCalls, normTarget } from "../../../../../script/m14/differential"
const ROOT = path.resolve(import.meta.dirname, "../../../../..")
const rel = "jq/src/jv_dtoa.c"
const src = readFileSync(path.join(ROOT, ".corpus", rel), "utf8")
const parser: any = await getParser("c")
const tree = parser.parse(src)
const truth = deriveCCalls(tree.rootNode, src)
console.log("truth rows", truth.length)
const mod: any = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))
const a = new mod.RealCAnalyzer()
const ctor: any = a.constructor
if (typeof ctor.setGrammar === "function") { try { ctor.setGrammar(parser.language, parser.constructor) } catch {} }
const r: any = await a.analyze(tree.rootNode, src, rel)
const rels = (r.relationships ?? []).map((e: any) => ({ label: String(e.type), target: String(e.target), source: String(e.source), line: e.line_number }))
for (const e of rels) {
  const hit = truth.some((te: any) => te.label === e.label && (normTarget(te.target) === normTarget(e.target) || String(te.target).includes(normTarget(e.target))))
  if (!hit && Number(e.label === "uses")) console.log(`UNEXPLAINED ${e.label} ${e.source} -> ${e.target} @${e.line}`)
}
