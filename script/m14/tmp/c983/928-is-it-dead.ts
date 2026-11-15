// Is `fieldDeclarationHasDeclarator` now dead code? #985's skip list may have
// made it unobservable. This instruments the predicate to count how often it
// REFUSES a field, over the corpora, with the current analyzer.
import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = "/home/sano/ishaq/backbencher-brain"
const ANALYZER = path.join(ROOT, "src/ast/real-c-analyzer.ts")
let text = fs.readFileSync(ANALYZER, "utf8")
const anchor = "function fieldDeclarationHasDeclarator(field: Node): boolean {"
if (text.split(anchor).length - 1 !== 1) throw new Error("anchor moved")
text = text.replace(anchor, anchor + "\n  ; (globalThis as any).__c928 = ((globalThis as any).__c928 ?? 0) + 1")
text = text.replace(
  "        if (\n          field &&\n          field.type === \"field_declaration\" &&\n          fieldDeclarationHasDeclarator(field) &&",
  "        if (\n          field &&\n          field.type === \"field_declaration\" &&\n          ((globalThis as any).__c928ref = ((globalThis as any).__c928ref ?? 0) + (fieldDeclarationHasDeclarator(field) ? 0 : 1), fieldDeclarationHasDeclarator(field)) &&",
)
fs.writeFileSync("/tmp/opencode/c928-counted.ts", text.replace(`from "./engine"`, `from ${JSON.stringify(path.join(ROOT, "src/ast/engine.ts"))}`))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const p = new P(); p.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const mod: any = await import("/tmp/opencode/c928-counted.ts")
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
const LIMIT = Number(process.env.N ?? "1500")
const files: string[] = []
for (const repo of ["curl", "libgit2", "redis", "zig"]) collectC(path.join(CORPUS, repo), files, LIMIT)
let parsed = 0
for (const f of files) {
  let src: string
  try { src = fs.readFileSync(f, "utf8") } catch { continue }
  if (src.length > 400_000) continue
  let root: any
  try { root = p.parse(src).rootNode } catch { continue }
  try { new mod.RealCAnalyzer().analyze(root, src, f) } catch { continue }
  parsed++
}
console.log(`files parsed ${parsed}`)
console.log(`fieldDeclarationHasDeclarator called: ${(globalThis as any).__c928 ?? 0}`)
console.log(`...of which it REFUSED (returned false): ${(globalThis as any).__c928ref ?? 0}`)
