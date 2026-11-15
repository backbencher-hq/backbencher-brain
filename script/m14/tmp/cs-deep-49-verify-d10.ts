// CS-DEEP-49 — does CS-D10 remove the paren-named base types, on the two files that produced
// them? Compared the way F5 does (label + target), and deliberately WITHOUT the corpus interface
// set, because D10 is about which children of `base_list` are types and has nothing to do with
// the D9 kind precedence — testing both together would let one fix mask the other.
import * as fs from "fs"
import * as path from "path"
const ROOT = process.cwd()
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
const p = new P(); p.setLanguage(g)
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const mod: any = await import(path.join(ROOT, "script/m14/differential.ts"))
const files = [
  "/home/sano/ishaq/bb_tests/repositories/roslyn/src/Compilers/CSharp/Test/Syntax/Parsing/LambdaParameterParsingTests.cs",
  "/home/sano/ishaq/bb_tests/repositories/roslyn/src/Compilers/CSharp/Test/Symbol/Symbols/DefaultInterfaceImplementationTests.cs",
]
let bad = 0
for (const f of files) {
  if (!fs.existsSync(f)) { console.log(`  (absent) ${path.basename(f)}`); continue }
  const src = fs.readFileSync(f, "utf8")
  const res: any = await ASTEngine.parseFile(f, src)
  const truth = (mod.deriveCSharpEdges(p.parse(src).rootNode, new Set<string>()) ?? [])
    .filter((e: any) => e.label === "implements" || e.label === "extends")
  const an = (res.relationships ?? []).filter((r: any) => (r.type ?? r.relationshipType) === "implements" || (r.type ?? r.relationshipType) === "extends")
  const tKeys = new Set(truth.map((e: any) => `${e.label}:${e.target}`))
  const aKeys = new Set(an.map((r: any) => `${r.type ?? r.relationshipType}:${r.target}`))
  const paren = [...tKeys].filter((k) => /[(].*[)]/.test(k))
  const missing = [...tKeys].filter((k) => !aKeys.has(k))
  const unexp = [...aKeys].filter((k) => !tKeys.has(k))
  bad += paren.length
  console.log(`  ${path.basename(f)}`)
  console.log(`     paren-named base types in the truth: ${paren.length}${paren.length ? "  " + paren.join(" ") : ""}`)
  console.log(`     TRUTH-only: ${missing.length}   ANALYZER-only: ${unexp.length}`)
}
console.log(`\n  paren-named base types remaining across both files: ${bad}`)

// The residual on the 2.7 MB file: the engine truncates to 1 MiB, so the truth (which parses the
// whole file) sees declarations the analyzer never received. Print the row and its line number
// against the file's length to show it falls in the truncated TAIL.
const big = files[1]
if (fs.existsSync(big)) {
  const src = fs.readFileSync(big, "utf8")
  const res: any = await ASTEngine.parseFile(big, src)
  const truth = (mod.deriveCSharpEdges(p.parse(src).rootNode, new Set<string>()) ?? [])
    .filter((e: any) => e.label === "implements" || e.label === "extends")
  const an = (res.relationships ?? []).filter((r: any) => (r.type ?? r.relationshipType) === "implements" || (r.type ?? r.relationshipType) === "extends")
  const aKeys = new Set(an.map((r: any) => `${r.type ?? r.relationshipType}:${r.target}`))
  console.log(`\n  ${path.basename(big)}  size ${src.length} bytes; the engine truncates at 1048576`)
  for (const e of truth) {
    if (aKeys.has(`${e.label}:${e.target}`)) continue
    const idx = src.indexOf(e.target)
    console.log(`     residual: ${e.label} -> ${e.target}   first occurrence at byte ${idx} (${idx > 1048576 ? "PAST the truncation point" : "within the truncated head"})`)
  }
}
