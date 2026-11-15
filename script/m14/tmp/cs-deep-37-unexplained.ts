// CS-DEEP-37 — the LAST unexplained analyzer edge. F5 reports `unexplained=1` (0%) over 120
// roslyn files now that both halves of `uses` are truth; the harness does not print the row, and
// an unexplained ANALYZER row is the one direction that cannot be waved away -- it is either a
// fabricated fact published at confidence 0.7-1.0, or a truth gate that is too coarse.
//
// The comparison is on TARGET, not (source, target), deliberately: the harness matches
// label+target, so a row whose target is real but whose source attribution differs is EXPLAINED
// there. Keying this probe on target therefore isolates the strictly stronger question -- is any
// published name not derivable from the tree at all?
import * as fs from "fs"; import * as path from "path"
const ROOT = process.cwd()
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts; const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
const p = new P(); p.setLanguage(g)
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const diff: any = await import(path.join(ROOT, "script/m14/differential.ts"))
const files = fs.readFileSync(process.argv[2], "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, Number(process.argv[3] ?? 250))
let n = 0
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  let res: any, root: any
  try { res = await ASTEngine.parseFile(f, src); root = p.parse(src).rootNode } catch { continue }
  const truthTargets = new Set<string>()
  for (const e of diff.deriveCSharpFieldAccessUses(root) ?? []) truthTargets.add(e.target)
  for (const e of diff.deriveCSharpBareUses(root, res.symbols ?? []) ?? []) truthTargets.add(e.target)
  for (const r of res.relationships ?? []) {
    if ((r.type ?? r.relationshipType) !== "uses") continue
    if (truthTargets.has(r.target)) continue
    n++
    const m = (r.metadata ?? {})
    const ln = Number(r.line_number)
    console.log(`${path.basename(f)}  ${r.source} -> ${r.target}  marker=${m.relationshipType} line=${ln}`)
    console.log(`      | ${(src.split("\n")[ln - 1] ?? "?").trim().slice(0, 100)}`)
  }
}
console.log(`\nunexplained analyzer \`uses\` targets over ${files.length} files: ${n}`)
