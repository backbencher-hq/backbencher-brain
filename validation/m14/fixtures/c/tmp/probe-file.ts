import * as path from "node:path"
import { readFileSync } from "node:fs"
import { getParser } from "../../../../../src/ast/engine"
const ROOT = path.resolve(import.meta.dirname, "../../../../..")
const file = path.isAbsolute(process.argv[2]) ? process.argv[2] : path.join(ROOT, process.argv[2])
const parser: any = await getParser("c")
const src = readFileSync(file, "utf8")
const tree = parser.parse(src)
if (process.argv.includes("--tree")) {
  const walk = (n: any, depth: number): void => {
    console.log(`${"  ".repeat(depth)}${n.type}${n.isNamed ? "" : "(anon)"} [${n.startPosition.row + 1}] ${JSON.stringify(n.text.slice(0, 50))}`)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i), depth + 1)
  }
  walk(tree.rootNode, 0)
} else {
  const mod: any = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))
  const a = new mod.RealCAnalyzer()
  const ctor: any = a.constructor
  if (typeof ctor.setGrammar === "function") { try { ctor.setGrammar(parser.language, parser.constructor) } catch {} }
  const r: any = await a.analyze(tree.rootNode, src, "fixtures/c/probe-file")
  for (const e of r.relationships ?? []) if (String(e.type) === "contains") console.log(`contains ${e.source} -> ${e.target} @${e.line_number}`)
}
