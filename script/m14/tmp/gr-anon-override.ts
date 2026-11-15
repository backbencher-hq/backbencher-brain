// Who is right about `overrides anonymous_IdentityTypeDecoder.bsonType ->
// IdentityTypeDecoder.bsonType`? The F5 oracle emits it, the analyzer does not
// (the lane's only two MISSING rows at full extent, both in .groovy files, so
// they were exposed by the full extent rather than by the .gradle universe).
//
// Prints both sides' `overrides` edges for the file so the disagreement can be
// read rather than argued.
import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const REPO = "/home/ishaq2321/bb_tests/repositories/grails-core"

const files = [
  "grails-data-mongodb/bson/src/main/groovy/org/grails/datastore/bson/codecs/decoders/IdentityDecoder.groovy",
  "grails-data-mongodb/bson/src/main/groovy/org/grails/datastore/bson/codecs/decoders/SimpleDecoder.groovy",
]

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-groovy.wasm")))
const amod: any = await import(path.join(ROOT, "src/ast/real-groovy-analyzer"))
const dmod: any = await import(path.join(ROOT, "script/m14/differential.ts"))

for (const rel of files) {
  const p = path.join(REPO, rel)
  const src = fs.readFileSync(p, "utf8")
  const parser = new P()
  parser.setLanguage(lang)
  const tree: any = parser.parse(src)
  console.log(`\n===== ${path.basename(rel)}  (hasError=${tree.rootNode.hasError}) =====`)

  const res: any = await new amod.RealGroovyAnalyzer().analyze(tree.rootNode, src, path.basename(rel))
  const aEdges = (res.relationships ?? []).filter((r: any) => String(r.type) === "overrides")
  console.log(`ANALYZER overrides (${aEdges.length}):`)
  for (const r of aEdges) console.log(`   ${r.source} -> ${r.target}   (line ${(r as any).line_number})`)

  // The harness's groovy truth is deriveTreeEdges + deriveGroovyEdges (line
  // ~12999); an oracle probe that calls only the mirror sees none of the
  // shared tree-truth rows — which is how the first version of this probe
  // reported the two sides agreeing when the differential says MISSING=2.
  const treeTruth: any[] = dmod.deriveTreeEdges(tree.rootNode, "groovy").filter((t: any) => t.label === "overrides")
  const mirror: any[] = dmod.deriveGroovyEdges(tree.rootNode, src).filter((t: any) => t.label === "overrides")
  const truth: any[] = [...treeTruth, ...mirror]
  console.log(`ORACLE overrides (${truth.length}) — treeTruth=${treeTruth.length} mirror=${mirror.length}:`)
  for (const t of truth) console.log(`   ${t.from ?? "?"} -> ${t.target}`)

  const aKey = new Set(aEdges.map((r: any) => `${r.source} -> ${r.target}`))
  const tKey = new Set(truth.map((t: any) => `${t.from} -> ${t.target}`))
  console.log(`MISSING (oracle only):`)
  for (const k of tKey) if (!aKey.has(k)) console.log(`   ${k}`)
  console.log(`UNEXPLAINED (analyzer only):`)
  for (const k of aKey) if (!tKey.has(k)) console.log(`   ${k}`)
}
process.exit(0)
