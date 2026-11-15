import * as path from "node:path"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { getParser } from "../../../../../src/ast/engine"
import { deriveCInstantiates } from "../../../../../script/m14/differential"
const ROOT = path.resolve(import.meta.dirname, "../../../../..")
const CR = path.join(ROOT, ".corpus")
const repo = process.argv[2] ?? "sqlite"
const repoRoot = path.join(CR, repo)
const files: string[] = []
const walk = (d: string): void => { for (const e of readdirSync(d, { withFileTypes: true }) as any) { if (e.name === ".git") continue; const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith(".c") && statSync(f).size <= 1024 * 1024) files.push(f) } }
walk(repoRoot)
const parser: any = await getParser("c")
const mod: any = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))
const a = new mod.RealCAnalyzer()
const ctor: any = a.constructor
if (typeof ctor.setGrammar === "function") { try { ctor.setGrammar(parser.language, parser.constructor) } catch {} }
let unexplained = 0, missing = 0
for (const abs of files.sort()) {
  const src = readFileSync(abs, "utf8")
  const tree = parser.parse(src)
  const truth = deriveCInstantiates(tree.rootNode, src)
  const r: any = await a.analyze(tree.rootNode, src, path.relative(repoRoot, abs))
  const tset = new Set(truth.map((e: any) => e.target))
  for (const e of r.relationships ?? []) if (String(e.type) === "instantiates" && !tset.has(String(e.target))) {
    unexplained++
    if (unexplained <= 25) console.log(`UNEXPLAINED ${path.relative(repoRoot, abs)}:${e.line_number} ${e.source} -> ${e.target}`)
  }
  const aset = new Set((r.relationships ?? []).filter((e: any) => String(e.type) === "instantiates").map((e: any) => String(e.target)))
  for (const t of tset) if (!aset.has(String(t))) { missing++; if (missing <= 10) console.log(`MISSING ${path.relative(repoRoot, abs)}: truth ${t}`) }
}
console.log(`\n${repo}: files ${files.length} · instantiates unexplained ${unexplained} · missing ${missing}`)
