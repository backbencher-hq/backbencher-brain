// FS039 — the `overrides` rows both sides emit, side by side.
//
// 18 unexplained `overrides` and 10 `implements` remain, and they look like one question:
// a qualified type USE is published under which name. The R10 spelling rule says the leaf,
// with the qualified form kept in `metadata.qualifiedType`; a differential disagreement on a
// qualified target is therefore either a rule disagreement or a rule not applied. This
// prints both spellings, so the answer is visible rather than inferred from a total.
import * as fs from "fs"
import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { deriveFsharpEdges } = await import(path.join(ROOT, "script/m14/fsharp-truth-oracle.ts"))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
if (!P.__init) {
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  ;(P as any).__init = true
}
const file = process.argv[2]!
const src = fs.readFileSync(file, "utf8")
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
const r: any = await ASTEngine.parseFile(file, src)
const truth = deriveFsharpEdges(parser.parse(src).rootNode, r.symbols ?? [])
const LBL = process.argv[3] ?? "overrides"
const A = (r.relationships ?? []).filter((x: any) => String(x.type) === LBL)
const T = truth.filter((e: any) => e.label === LBL)
console.log(`${path.basename(file)}  ${LBL}: analyzer ${A.length}, truth ${T.length}`)
const tset = new Set(T.map((e: any) => `${e.from}|${e.to}`))
for (const x of A) {
  const q = (x.metadata ?? {}).qualifiedType
  const hit = tset.has(`${x.source}|${x.target}`)
  console.log(`  ${hit ? "AGREE" : "A-ONLY"}  ${String(x.source).slice(0, 40).padEnd(40)} -> ${String(x.target).padEnd(28)}${q ? `   (qualifiedType: ${q})` : ""}`)
}
for (const e of T) if (!A.some((x: any) => x.source === e.from && x.target === e.to)) {
  console.log(`  T-ONLY  ${String(e.from).slice(0, 40).padEnd(40)} -> ${e.to}`)
}
