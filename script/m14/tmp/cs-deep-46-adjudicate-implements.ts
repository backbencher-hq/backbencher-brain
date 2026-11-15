// CS-DEEP-46 — adjudicate the 3 MISSING rows: `implements c2->c1`, `c4->c2`, `c5->c3`.
//
// Reproducing F5's rotating sample is not needed to decide this, and trying to is how the
// previous two rounds of this file went wrong. The question is answerable on the ONE file the
// MISSING rows name: does the tree support `implements` for these three, or is it `extends`?
//
// The source says, at the three sites:
//     62:   public class c1 : c0                                    // c1 is a CLASS
//     460:  public class c2<T> : c1                                // -> extends c1
//     903:  public class c4 : c2<string>                           // -> extends c2
//     1096:     public class c5 : c3<string, c1>                   // -> extends c3 (and c1)
//
// So the tree supports EXTENDS for all three. If the truth emits `implements` for any of them,
// the truth is wrong — and the mechanism is named in the deriveCSharpEdges source: the label is
// `knownIface || looksLikeInterface || (i > 0 && !declaredKind)`, and `knownIface` is tested
// BEFORE the file's own `declaredKind`. A corpus-wide regex set of `interface NAME` therefore
// outranks what THIS file declares. That is the D4 class (a name-keyed kind companion) in a form
// D4's fix did not cover: D4 excluded AMBIGUOUS names from the companion, but the precedence
// that lets the companion beat a local declaration is a separate rule and it is unchecked.
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
const truth = (mod.deriveCSharpEdges(root, new Set<string>()) ?? []).filter((e: any) => labels.has(e.label))
const an = (res.relationships ?? []).filter((r: any) => labels.has(r.type ?? r.relationshipType))

console.log(`  ${"edge".padEnd(22)} ${"truth".padEnd(12)} analyzer`)
for (const key of ["c2|c1", "c4|c2", "c5|c3", "c1|c0", "c3|c0", "c5|c1"]) {
  const [f, t] = key.split("|")
  const tLab = truth.filter((e: any) => e.from === f && e.target === t).map((e: any) => e.label)
  const aLab = an.filter((r: any) => r.source === f && r.target === t).map((r: any) => r.label ?? r.relationshipType)
  console.log(`  ${key.padEnd(22)} ${(tLab.join(",") || "-").padEnd(12)} ${aLab.join(",") || "-"}`)
}
console.log(`\n  truth implements edges on this file: ${truth.filter((e:any)=>e.label==="implements").length}`)
console.log(`  analyzer implements edges:         ${an.filter((r:any)=>(r.type??r.relationshipType)==="implements").length}`)
const ti = truth.filter((e:any)=>e.label==="implements")
for (const e of ti) console.log(`     TRUTH   implements ${e.from} -> ${e.target}`)
for (const r of an.filter((r:any)=>(r.type??r.relationshipType)==="implements")) console.log(`     ANALYZER implements ${r.source} -> ${r.target}`)
