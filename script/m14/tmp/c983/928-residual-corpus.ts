// #985 subsumes #928 on the fixture's shape, so the #928 mutant SURVIVES its own
// fixture. Before deciding whether to retire it, measure what the predicate
// alone still guards: revert ONLY `fieldDeclarationHasDeclarator(field) &&`
// (with the #985 skip list in place) and diff the whole corpus.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..", "..", "..")
const ANALYZER = path.join(ROOT, "src/ast/real-c-analyzer.ts")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const { RealCAnalyzer: Fixed } = await import(ANALYZER)

const text = fs.readFileSync(ANALYZER, "utf8")
const anchor = "fieldDeclarationHasDeclarator(field) &&"
const hits = text.split(anchor).length - 1
if (hits !== 2) throw new Error(`anchor found ${hits}x, expected 2`)
const tmp = path.join("/tmp/opencode", "c985-no928.ts")
fs.writeFileSync(tmp, text.replaceAll(anchor, "true &&").replace(`from "./engine"`, `from ${JSON.stringify(path.join(ROOT, "src/ast/engine.ts"))}`))
const { RealCAnalyzer: Reverted } = await import(tmp)

const CORPUS = "/home/sano/ishaq/bb_tests/repositories"
function collectC(dir: string, out: string[], cap: number): string[] {
  if (out.length >= cap) return out
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (out.length >= cap) return out
    if (e.name === ".git" || e.name === "node_modules") continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collectC(full, out, cap)
    else if (e.name.endsWith(".c") || e.name.endsWith(".h")) out.push(full)
  }
  return out
}
const LIMIT = Number(process.env.N ?? "4000")
const files: string[] = []
for (const repo of ["curl", "libgit2", "redis", "zig"]) collectC(path.join(CORPUS, repo), files, LIMIT)

const key = (r: any): string => `${r.type}|${r.source}|${r.target}`
let filesParsed = 0
let diffSymbols = 0
let diffEdges = 0
const rows: string[] = []

for (const file of files) {
  let src: string
  try { src = fs.readFileSync(file, "utf8") } catch { continue }
  if (src.length > 400_000) continue
  let root: any
  try { root = parser.parse(src).rootNode } catch { continue }
  filesParsed++
  let a: any, b: any
  try { a = new Fixed().analyze(root, src, file); b = new Reverted().analyze(root, src, file) } catch { continue }
  const symKey = (s: any): string => `${s.kind}|${s.name}|${s.ownerName ?? ""}|${s.scope ?? ""}`
  const sa = new Set((a.symbols ?? []).map(symKey))
  const sb = new Set((b.symbols ?? []).map(symKey))
  const ea = new Set((a.relationships ?? []).map(key))
  const eb = new Set((b.relationships ?? []).map(key))
  for (const s of sb) if (!sa.has(s)) { diffSymbols++; if (rows.length < 30) rows.push(`  +sym  ${path.relative(CORPUS, file)}  ${s}`) }
  for (const s of sa) if (!sb.has(s)) { diffSymbols++; if (rows.length < 30) rows.push(`  -sym  ${path.relative(CORPUS, file)}  ${s}`) }
  for (const e of eb) if (!ea.has(e)) { diffEdges++; if (rows.length < 60) rows.push(`  +rel  ${path.relative(CORPUS, file)}  ${e}`) }
  for (const e of ea) if (!eb.has(e)) { diffEdges++; if (rows.length < 60) rows.push(`  -rel  ${path.relative(CORPUS, file)}  ${e}`) }
}
console.log(`files parsed ${filesParsed} of ${files.length}`)
console.log(`#928 predicate alone, with #985's skip list in place:`)
console.log(`  symbols differing:      ${diffSymbols}`)
console.log(`  relationships differing: ${diffEdges}`)
for (const r of rows) console.log(r)
