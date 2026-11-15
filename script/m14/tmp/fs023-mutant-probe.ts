// FS023 — run ONE mutant against its own lane's fixtures through the SAME entry the
// mutation harness uses, and print what the transform changed. A surviving mutant is
// debugged here instead of tolerated.
import * as fs from "fs"
import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const { MUTANTS } = await import(path.join(ROOT, "script/m14/mutate-analyzer.ts"))
const { LANGS } = await import(path.join(ROOT, "script/m14/run-fixtures.ts"))
const id = process.argv[2]
const m = (MUTANTS as any[]).find((x) => x.id === id)
if (!m) { console.error(`no mutant ${id}`); process.exit(2) }
const cfg: any = (LANGS as any)[m.language]
const dir = path.join(ROOT, "validation/m14/fixtures", m.language)
const exts = String(cfg.ext).split(",")
const files = fs.readdirSync(dir).filter((f: string) => exts.includes(path.extname(f).slice(1)))
// load the analyzer + grammar the way runLang does
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const mod: any = await import(path.join(ROOT, "src/ast", `${cfg.analyzerFile}.ts`))
const Cls = mod[cfg.className]
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), "utf8")
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm))))
  const tree = parser.parse(src)
  const r: any = new Cls().analyze(tree.rootNode, src, `fixtures/${m.language}/${f}`)
  const out: any = m.transform(r, src)
  const s0 = (r.symbols ?? []).length, s1 = (out?.symbols ?? []).length
  const r0 = (r.relationships ?? []).length, r1 = (out?.relationships ?? []).length
  const e0 = (r.exports ?? []).length, e1 = (out?.exports ?? []).length
  // A MAP-shaped transform changes CONTENT without changing COUNTS, so vacuity must
  // be decided on the rows, not the totals — the first version of this probe reported
  // four live mutants as vacuous for exactly that reason.
  const rowSig = (x: any) => JSON.stringify({ s: (x.symbols ?? []), r: (x.relationships ?? []), e: (x.exports ?? []) })
  const vacuous = rowSig(r) === rowSig(out)
  console.log(`${f}: symbols ${s0}->${s1}  rels ${r0}->${r1}  exports ${e0}->${e1}${vacuous ? "   <-- VACUOUS (transform changed nothing)" : ""}`)
  if (true) {
    const n0 = (r.symbols ?? []).map((s: any) => `${s.name}/${s.kind}`).join(" ")
    const n1 = (out.symbols ?? []).map((s: any) => `${s.name}/${s.kind}`).join(" ")
    console.log(`   names before: ${n0.slice(0, 300)}`)
    console.log(`   names after : ${n1.slice(0, 300)}`)
  }
  if (r1 !== r0) console.log(`   rels after: ${(out.relationships??[]).slice(0,4).map((x:any)=>x.type+"["+(x.source??x.from)+"->"+(x.target??x.to)+"]").join(" ")}`)
}
