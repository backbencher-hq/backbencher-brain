// The `contains` delta attributable to #985 alone, on ONE fixed file set, with
// the pre-fix analyzer generated from the same source. The census cannot show
// it: the corpus pins have moved under the lane, so its file set is not the one
// the documented numbers were measured on.
import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = "/home/sano/ishaq/backbencher-brain"
const ANALYZER = path.join(ROOT, "src/ast/real-c-analyzer.ts")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const text = fs.readFileSync(ANALYZER, "utf8")
const anchor = 'const MACRO_TYPE_NODES = ["macro_type_specifier", "macro_prefixed_type_specifier"]'
if (text.split(anchor).length - 1 !== 1) throw new Error("anchor moved")
fs.writeFileSync("/tmp/opencode/c985-prefix.ts", text.replace(anchor, "const MACRO_TYPE_NODES: string[] = []").replace(`from "./engine"`, `from ${JSON.stringify(path.join(ROOT, "src/ast/engine.ts"))}`))
const After: any = (await import(ANALYZER)).RealCAnalyzer
const Before: any = (await import("/tmp/opencode/c985-prefix.ts")).RealCAnalyzer
const CORPUS = "/home/sano/ishaq/bb_tests/repositories"
function collectC(dir: string, out: string[], cap: number): string[] {
  if (out.length >= cap) return out
  let es: fs.Dirent[] = []
  try { es = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of es) {
    if (out.length >= cap) return out
    if (e.name === ".git" || e.name === "node_modules") continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collectC(full, out, cap)
    else if (e.name.endsWith(".c") || e.name.endsWith(".h")) out.push(full)
  }
  return out
}
const LIMIT = Number(process.env.N ?? "1200")
const files: string[] = []
for (const repo of ["curl", "libgit2", "redis", "zig"]) collectC(path.join(CORPUS, repo), files, LIMIT)
files.sort()
const tally = (r: any): Record<string, number> => {
  const t: Record<string, number> = {}
  for (const x of r.relationships ?? []) t[String(x.type)] = (t[String(x.type)] ?? 0) + 1
  return t
}
const before: Record<string, number> = {}
const after: Record<string, number> = {}
let parsed = 0
for (const f of files) {
  let src: string
  try { src = fs.readFileSync(f, "utf8") } catch { continue }
  if (src.length > 400_000) continue
  let root: any
  try { root = parser.parse(src).rootNode } catch { continue }
  parsed++
  let a: any, b: any
  try { a = new Before().analyze(root, src, f); b = new After().analyze(root, src, f) } catch { continue }
  for (const [k, v] of Object.entries(tally(a))) before[k] = (before[k] ?? 0) + v
  for (const [k, v] of Object.entries(tally(b))) after[k] = (after[k] ?? 0) + v
}
console.log(`files measured: ${parsed} (one fixed set, same corpus pins for both sides)`)
console.log(`  ${"rel".padEnd(14)} ${"before".padStart(9)} ${"after".padStart(9)} ${"delta".padStart(8)}`)
for (const k of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
  const bv = before[k] ?? 0, av = after[k] ?? 0
  console.log(`  ${k.padEnd(14)} ${String(bv).padStart(9)} ${String(av).padStart(9)} ${(av - bv >= 0 ? "+" : "") + (av - bv)}`)
}
