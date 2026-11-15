// CS-DEEP-47 — does the CS-D9 precedence fix actually resolve the disagreement, measured the way
// the failure appeared: with `c1` PRESENT in the corpus interface set, which is the condition
// that produced the 3 MISSING rows. An empty set is the easy case and would have passed before
// the fix too, so it proves nothing.
import * as fs from "fs"
import * as path from "path"
const ROOT = process.cwd()
const file = "/home/sano/ishaq/bb_tests/repositories/roslyn/src/Compilers/Test/Resources/Core/PerfTests/CSPerfTest.cs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
const p = new P(); p.setLanguage(g)
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const mod: any = await import(path.join(ROOT, "script/m14/differential.ts"))
const src = fs.readFileSync(file, "utf8")
const root = p.parse(src).rootNode
const res: any = await ASTEngine.parseFile(file, src)
const labels = new Set(["implements", "extends"])
const an = (res.relationships ?? []).filter((r: any) => labels.has(r.type ?? r.relationshipType))
const anKeys = new Set(an.map((r: any) => `${r.type ?? r.relationshipType}:${r.target}`))
// The exact condition from F5: c1 declared as an interface elsewhere in the corpus.
const poisoned = new Set(["c1"])
for (const [name, set] of [["empty set (the easy case)", new Set<string>()], ["with c1 (the failing case)", poisoned]] as Array<[string, Set<string>]>) {
  const truth = (mod.deriveCSharpEdges(root, set) ?? []).filter((e: any) => labels.has(e.label))
  const tKeys = new Set(truth.map((e: any) => `${e.label}:${e.target}`))
  const missing = [...tKeys].filter((k) => !anKeys.has(k))
  const unexplained = [...anKeys].filter((k) => !tKeys.has(k))
  console.log(`  ${name}:`)
  console.log(`     truth extends/implements: ${tKeys.size}   analyzer: ${anKeys.size}`)
  console.log(`     TRUTH-only (the MISSING direction): ${missing.length}${missing.length ? "  " + missing.slice(0,4).join("  ") : ""}`)
  console.log(`     ANALYZER-only:                      ${unexplained.length}${unexplained.length ? "  " + unexplained.slice(0,4).join("  ") : ""}`)
}
