import * as fs from "fs"; import * as path from "path"
const ROOT = process.cwd()
const files = process.argv.slice(2)
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts; const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT,"node_modules","web-tree-sitter","tree-sitter.wasm") })
const g = await L.load(fs.readFileSync(path.join(ROOT,"wasm","tree-sitter-c_sharp.wasm")))
const p = new P(); p.setLanguage(g)
const { ASTEngine } = await import(path.join(ROOT,"src/ast/engine.ts"))
const mod: any = await import(path.join(ROOT,"script/m14/differential.ts"))
for (const f of files) {
  const src = fs.readFileSync(f,"utf8")
  const r: any = await ASTEngine.parseFile(f, src)
  const truth = new Map<string, number[]>()
  for (const t of mod.deriveCSharpFieldAccessUses(p.parse(src).rootNode)) {
    const k = `${t.from}|${t.target}`
    truth.set(k, [...(truth.get(k) ?? []), 0])
  }
  const lan = new Map<string, number>()
  for (const rel of r.relationships ?? []) {
    if ((rel.type ?? rel.relationshipType) !== "uses") continue
    if ((rel.metadata ?? {}).relationshipType !== "csharp_field_access") continue
    lan.set(`${rel.source}|${rel.target}`, rel.line_number)
  }
  console.log(`\n=== ${path.basename(f)}  truth=${truth.size} analyzer=${lan.size}`)
  let n = 0
  for (const [k] of truth) if (!lan.has(k) && n++ < 12) {
    const line = src.split("\n").find((l:string)=>l.includes(k.split("|")[1])) ?? ""
    console.log(`   TRUTH-only  ${k.replace("|","->")}   ${line.trim().slice(0,95)}`)
  }
  n = 0
  for (const [k,v] of lan) if (!truth.has(k) && n++ < 6) console.log(`   ANALYZER-only ${k.replace("|","->")}@${v}`)
}
