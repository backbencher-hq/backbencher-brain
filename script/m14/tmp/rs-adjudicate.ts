import fs from "node:fs"
import path from "node:path"
import { deriveRustContainsTruth } from "../oracles/rust-contains"
import { LANGS } from "../differential"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "<corpus-root>/bb_tests/repositories"
function walk(dir: string, exts: string[], cap: number): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length && out.length <= cap) {
    const cur = stack.pop()!
    let es: fs.Dirent[]
    try { es = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
    for (const e of es) {
      if ([".git", "node_modules", "target"].includes(e.name)) continue
      const p = path.join(cur, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
    }
  }
  out.sort()
  if (out.length <= cap) return out
  const stride = Math.max(1, Math.floor(out.length / cap))
  const picked: string[] = []
  for (let i = 0; i < out.length && picked.length < cap; i += stride) picked.push(out[i])
  return picked
}
async function main(): Promise<void> {
  const corpus = process.argv[2] ?? "ripgrep"
  const per = Number(process.argv[3] ?? 50)
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const cfg: any = (LANGS as any).rust
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
  const parser = new P(); parser.setLanguage(gl)
  const mod = await import(path.join(ROOT, "src/ast", `${cfg.analyzerFile}.ts`))
  const analyzer = new (mod as any)[cfg.className]()
  const files = walk(path.join(CORPUS, corpus), [".rs"], per)
  let truthN = 0, agreed = 0, aOnly = 0, tOnly = 0
  const aEx: string[] = [], tEx: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    let res: any
    try { res = analyzer.analyze(parser.parse(src).rootNode, src, f) } catch { continue }
    const root = parser.parse(src).rootNode
    const truth = deriveRustContainsTruth(root)
    truthN += truth.length
    const rels = (res.relationships ?? []).filter((r: any) => String(r.type) === "contains")
    const relT = new Set(rels.map((r: any) => String(r.target)))
    for (const t of truth) { if (relT.has(t.target)) agreed++; else { tOnly++; if (tEx.length < 10) tEx.push(`${t.target}   ${path.relative(path.join(CORPUS, corpus), f)}`) } }
    const trT = new Set(truth.map((t) => t.target))
    for (const r of rels) { if (!trT.has(String(r.target))) { aOnly++; if (aEx.length < 10) aEx.push(`${String(r.target)}   ${path.relative(path.join(CORPUS, corpus), f)}`) } }
  }
  console.log(`# rust contains — ${files.length} files from ${corpus}\n`)
  console.log(`- truth rows: ${truthN}`)
  console.log(`- **agreed: ${agreed} (${truthN ? ((agreed / truthN) * 100).toFixed(1) : "0"}%)**`)
  console.log(`- analyzer-only: ${aOnly}`)
  console.log(`- truth-only: ${tOnly}`)
  if (aEx.length) { console.log(`\n## analyzer-only`); for (const e of aEx) console.log(`  ${e}`) }
  if (tEx.length) { console.log(`\n## truth-only`); for (const e of tEx) console.log(`  ${e}`) }
}
main().catch((e) => { console.error(e); process.exit(1) })
