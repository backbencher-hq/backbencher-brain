import * as path from "node:path"
import { readFileSync } from "node:fs"
import { getParser } from "../../../../../src/ast/engine"
import { deriveCInstantiates } from "../../../../../script/m14/differential"
const ROOT = path.resolve(import.meta.dirname, "../../../../..")
const rel = process.argv[2]
const src = readFileSync(path.join(ROOT, ".corpus", rel), "utf8")
const parser: any = await getParser("c")
const tree = parser.parse(src)
const edges = deriveCInstantiates(tree.rootNode, src)
console.log("truth rows:", edges.length)
for (const e of edges.slice(0, 20)) console.log(" ", e.label, e.from, "->", e.target)
const mod: any = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))
const a = new mod.RealCAnalyzer()
const ctor: any = a.constructor
if (typeof ctor.setGrammar === "function") { try { ctor.setGrammar(parser.language, parser.constructor) } catch {} }
const r: any = await a.analyze(tree.rootNode, src, rel)
for (const e of r.relationships ?? []) if (String(e.type) === "instantiates") console.log("an:", e.source, "->", e.target, "@", e.line_number)
