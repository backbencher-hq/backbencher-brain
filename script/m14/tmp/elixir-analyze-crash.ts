/** Reproduce the F5 lane's exact call (`analyzer.analyze(root, content, relPath)`)
 *  and PRINT the exception the harness's `catch { continue }` swallows. */
import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = "/home/sano/ishaq/backbencher-brain"
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const REPO = arg("repo") ?? "elixir"
const LIMIT = Number(arg("limit") ?? "20")
function walk(d: string, out: string[] = []): string[] { let e: fs.Dirent[]; try { e = fs.readdirSync(d,{withFileTypes:true}) } catch { return out }
  for (const x of e) { if ([".git","_build","deps","node_modules"].includes(x.name)) continue; const p = path.join(d,x.name)
    if (x.isDirectory()) walk(p,out); else if (x.name.endsWith(".ex")||x.name.endsWith(".exs")) out.push(p) } return out }
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts; const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
  const p = new P(); p.setLanguage(g)
  const { RealElixirAnalyzer } = await import(path.join(ROOT, "src/ast/real-elixir-analyzer.ts"))
  const a: any = new RealElixirAnalyzer()
  const files = walk(path.join(CORPUS_ROOT, REPO)).slice(0, LIMIT)
  let ok = 0, bad = 0
  for (const f of files) {
    const content = fs.readFileSync(f, "utf8")
    const root = p.parse(content).rootNode
    try { const r = a.analyze(root, content, path.relative(CORPUS_ROOT, f)); ok++; void r }
    catch (e: any) { bad++; if (bad <= 3) console.log(`THROW ${path.relative(CORPUS_ROOT, f)}\n  ${e?.constructor?.name}: ${e?.message}\n  ${String(e?.stack).split("\n").slice(1, 4).join("\n  ")}`) }
  }
  console.log(`ok=${ok} threw=${bad} of ${files.length}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
