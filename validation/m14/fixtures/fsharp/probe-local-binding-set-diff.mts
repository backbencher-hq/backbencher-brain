import { readFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../src/ast/engine"
import { deriveFsharpEdges } from "../script/m14/fsharp-truth-oracle"
import { RealFsharpAnalyzer } from "../src/ast/real-fsharp-analyzer"
const CR = "/home/ishaq2321/bb_tests/repositories", REPO = path.join(CR, "fsharp")
const log = readFileSync("/home/ishaq2321/mcp/backbencher-brain/validation/m14/fixtures/fsharp/measurements/differential-step1-files.txt", "utf8")
const files = (log.match(/\[file\] .*/g) ?? []).map(l => l.slice("[file]".length).trim())
let aRows = 0, tRows = 0
const aSet = new Map<string,string>(), tSet = new Map<string,string>()
for (const rel of files) {
  const abs = path.join(REPO, rel)
  let text: string; try { text = readFileSync(abs, "utf8") } catch { continue }
  const tree: any = await ASTEngine.parseTree(abs, text)
  const res: any = await ASTEngine.parseFile(abs, text)
  for (const e of deriveFsharpEdges(tree.tree.rootNode, res?.symbols ?? [])) {
    if (e.label !== "calls" || !String(e.target).includes("#")) continue
    tRows++; tSet.set(`${e.from}->${e.target}`, rel)
  }
  const a: any = new RealFsharpAnalyzer().analyze(tree.tree.rootNode, text, abs)
  tree.tree.delete?.()
  for (const r of a.relationships ?? []) {
    if (String(r.type) !== "calls" || (r as any).metadata?.localBinding !== true) continue
    aRows++; aSet.set(`${r.source}->${r.target}`, rel)
  }
}
console.log(`analyzer calls edges with localBinding=true: ${aRows}`)
console.log(`oracle  calls truth rows with '#':          ${tRows}`)
const onlyA = [...aSet.keys()].filter(k => !tSet.has(k))
const onlyT = [...tSet.keys()].filter(k => !aSet.has(k))
console.log(`analyzer-only: ${onlyA.length}`)
for (const k of onlyA.slice(0, 12)) console.log(`   A ${k}   [${aSet.get(k)}]`)
console.log(`oracle-only: ${onlyT.length}`)
for (const k of onlyT.slice(0, 12)) console.log(`   T ${k}   [${tSet.get(k)}]`)
process.exit(0)
