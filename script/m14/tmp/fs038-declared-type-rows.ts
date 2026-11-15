// FS038 — the analyzer's `declared_type` rows against the truth oracle's, side by side.
//
// 125 of the lane's 174 unexplained rows are `declared_type`, and a total with no row in it
// is a number rather than a finding. This prints, for one file, every `declared_type` edge
// each side derives — keyed the way the differential keys them, so the difference printed IS
// the residual rather than an approximation of it — grouped by the position marker
// (`parameter`, `local_annotation`, `return_type`, `record_field`, `class_field`), because
// the marker is where a disagreement about POSITION would show up.
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
const only = process.argv[3] ?? null
const src = fs.readFileSync(file, "utf8")
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
const r: any = await ASTEngine.parseFile(file, src)
const truth = deriveFsharpEdges(parser.parse(src).rootNode, r.symbols ?? [])

const A = new Map<string, { n: number; on: string }>()
for (const x of (r.relationships ?? [])) {
  if (x.type !== "references" || (x.metadata ?? {}).relationshipType !== "declared_type") continue
  const on = String((x.metadata ?? {}).declaredOn)
  if (only && on !== only) continue
  const k = `${x.source}|${x.target}`
  A.set(k, { n: (A.get(k)?.n ?? 0) + 1, on })
}
const T = new Map<string, { n: number; on: string }>()
for (const e of truth) {
  if (e.label !== "references" || !e.declaredOn) continue
  if (only && e.declaredOn !== only) continue
  const k = `${e.from}|${e.to}`
  T.set(k, { n: (T.get(k)?.n ?? 0) + 1, on: String(e.declaredOn) })
}
const onlyA = [...A].filter(([k]) => !T.has(k))
const onlyT = [...T].filter(([k]) => !A.has(k))
console.log(`${path.basename(file)}  marker=${only ?? "ALL"}`)
console.log(`  analyzer-only: ${onlyA.length}   truth-only: ${onlyT.length}   agreed: ${[...A].filter(([k]) => T.has(k)).length}`)
for (const [k, v] of onlyA.slice(0, 10)) console.log(`  A  ${k.padEnd(44)} [${v.on}]`)
for (const [k, v] of onlyT.slice(0, 10)) console.log(`  T  ${k.padEnd(44)} [${v.on}]`)
