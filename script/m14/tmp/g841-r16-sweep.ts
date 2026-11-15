// Round 16: whole-corpus extraction snapshot (baseline vs vtie2 arms).
import fs from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const OUT = process.argv[2]
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { RealGroovyAnalyzer } = await import(path.join(ROOT, "src/ast/real-groovy-analyzer.ts"))
const parser = await ASTEngine.getParser("groovy" as any)
const files: string[] = []
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (e.name !== ".git" && e.name !== "node_modules") walk(p) }
    else if (e.name.endsWith(".groovy")) files.push(p)
  }
}
walk(CORPUS)
const snap: Record<string, { symbols: string[]; rels: string[] }> = {}
let n = 0
for (const f of files) {
  const rel = path.relative(CORPUS, f)
  try {
    const src = fs.readFileSync(f, "utf8")
    const t = parser.parse(src)
    const a = new RealGroovyAnalyzer()
    const res: any = await (a as any).analyze(t.rootNode, src, f)
    const symbols = (res.symbols ?? []).map((s: any) => `S|${s.name}|${s.kind}|${s.ownerName ?? "-"}|${s.range?.startLine ?? "?"}`)
    const rels = (res.relationships ?? []).map((r: any) => `R|${r.type}|${r.source}|${r.target}|${r.line_number ?? "?"}`)
    snap[`groovy|${rel}`] = { symbols, rels }
  } catch (e: any) {
    snap[`groovy|${rel}`] = { symbols: [`S|<analyze-error>|error|-|-`], rels: [] }
  }
  if (++n % 1000 === 0) console.error(`  ${n}/${files.length}`)
}
fs.writeFileSync(OUT, JSON.stringify(snap))
console.log(`wrote ${OUT} (${Object.keys(snap).length} files)`)
