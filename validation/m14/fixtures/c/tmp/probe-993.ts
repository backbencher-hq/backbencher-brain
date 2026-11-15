import * as path from "node:path"
import { readFileSync } from "node:fs"
import { getParser } from "../../../../../src/ast/engine"
const ROOT = path.resolve(import.meta.dirname, "../../../../..")
const file = path.join(ROOT, "validation/m14/fixtures/c/contains-error-beside-declarator-993.c")
const parser: any = await getParser("c")
const src = readFileSync(file, "utf8")
const tree = parser.parse(src)
const mod: any = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))
const a = new mod.RealCAnalyzer()
const ctor: any = a.constructor
if (typeof ctor.setGrammar === "function") { try { ctor.setGrammar(parser.language, parser.constructor) } catch {} }
const r: any = await a.analyze(tree.rootNode, src, "fixtures/c/contains-error-beside-declarator-993.c")
for (const e of r.relationships ?? []) if (String(e.type) === "contains") console.log(`contains ${e.source} -> ${e.target} @${e.line_number}`)
