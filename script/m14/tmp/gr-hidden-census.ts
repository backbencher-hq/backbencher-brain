// What did the lane's 4,000-file discovery cap actually hide? For every groovy
// file the capped scan never admitted, this counts (a) the truth's anonymous-body
// `overrides` rows — the shape the pre-fix analyzer could not emit at all — and
// (b) the analyzer's own edges, so the cap's cost is a number rather than an
// argument. Pair: script/m14/tmp/gr-scan-cap.ts (the cap), this (its cost).
import * as fs from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { deriveTreeEdges, deriveGroovyEdges } from "../differential"
import { ASTEngine } from "../../../src/ast/engine"

const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const REPO = process.argv[2] ?? "grails-core"
const EXT = "groovy,gradle"
const repoDir = path.join(CORPUS, REPO)

const capped: string[] = []
const capScan = (d: string): void => {
  if (capped.length > 4000) return
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|build|target)/.test(e.name)) capScan(p) }
    else if (EXT.split(",").some((x) => e.name.endsWith("." + x))) capped.push(p)
  }
}
capScan(repoDir)
const inPool = new Set(capped)
const hidden: string[] = []
const walk = (d: string): void => {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|build|target)/.test(e.name)) walk(p) }
    else if (EXT.split(",").some((x) => e.name.endsWith("." + x)) && !inPool.has(p)) hidden.push(p)
  }
}
walk(repoDir)
hidden.sort()

const parser = await ASTEngine.getParser("groovy" as any)
const analyzer: any = new (await import("../../../src/ast/real-groovy-analyzer")).RealGroovyAnalyzer()

let truthAnonOverride = 0
let analyzerAnonOverride = 0
let analyzerEdges = 0
let filesWithRows = 0
const examples: string[] = []
const conf = new Map<number, number>()
for (const f of hidden) {
  const rel = path.relative(repoDir, f)
  let content: string
  try { content = fs.readFileSync(f, "utf8") } catch { continue }
  const tree = parser.parse(content)
  const root = tree.rootNode
  const truth = [...(deriveTreeEdges(root, "groovy") as any[]), ...deriveGroovyEdges(root, content)]
  const tAnon = truth.filter((e: any) => e.label === "overrides" && String(e.from ?? "").startsWith("anonymous_"))
  truthAnonOverride += tAnon.length
  const res: any = await analyzer.analyze(root, content, rel)
  const rels = res.relationships ?? []
  analyzerEdges += rels.length
  const aAnon = rels.filter((r: any) => String(r.type) === "overrides" && String(r.source ?? "").startsWith("anonymous_"))
  analyzerAnonOverride += aAnon.length
  for (const r of aAnon) conf.set(r.confidence, (conf.get(r.confidence) ?? 0) + 1)
  if (tAnon.length > 0) {
    filesWithRows++
    if (examples.length < 6) examples.push(`${rel} :: ${tAnon.map((t: any) => `${t.from} -> ${t.target}`).join(", ")}`)
  }
}
console.log(`\n=== ${REPO}: files the cap hid = ${hidden.length}`)
console.log(`  truth anonymous-body overrides on those files : ${truthAnonOverride} (across ${filesWithRows} files)`)
console.log(`  analyzer rows of the same shape (fix live)    : ${analyzerAnonOverride}`)
console.log(`  analyzer edges on those files                 : ${analyzerEdges}`)
console.log(`  confidence split of the analyzer rows          : ${[...conf.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`)
console.log(`  examples:`)
for (const e of examples) console.log(`    ${e}`)
process.exit(0)
