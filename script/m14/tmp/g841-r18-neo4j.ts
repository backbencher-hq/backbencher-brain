import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const SNIPPETS: [string, string][] = [
  ["S1 ternary + interp call", `class C { void m(def params) {\n  String skip = params.offset ? " SKIP \${Integer.valueOf(params.offset.toString())}" : ''\n} }\n`],
  ["S2 triple-quoted WHERE", `class C { void m(def fromEntity) {\n  String query = """MATCH (from)-[r]-(to)\nWHERE \${fromEntity.formatId(RelationshipPersistentEntity.FROM)} = \\$start AND \${toEntity.formatId(RelationshipPersistentEntity.TO)} = \\$end\nRETURN DISTINCT(r)"""\n} }\n`],
  ["S3 generic cast call", `class C { void m(def q) {\n  List<org.neo4j.driver.types.Relationship> results = (List<org.neo4j.driver.types.Relationship>) executeQuery(q, [start:1])\n} }\n`],
  ["S4 for-in qualified", `class C { void m(def results) {\n  for(org.neo4j.driver.types.Relationship neoRel in results) { }\n} }\n`],
  ["S5 interp call simple", `class C { void m(def e) {\n  String s = "x \${e.formatId(FROM)} y"\n} }\n`],
  ["S6 interp dotted-const arg", `class C { void m(def e) {\n  String s = "x \${e.formatId(RelationshipPersistentEntity.FROM)} y"\n} }\n`],
]
for (const wasm of process.argv.slice(2)) {
  const lang = await L.load(fs.readFileSync(wasm))
  const parser = new P(); parser.setLanguage(lang)
  console.log(`=== ${wasm.replace(/^.*\//, '')}`)
  for (const [name, src] of SNIPPETS) {
    const t = parser.parse(src)
    const errs: string[] = []
    const walk = (x: any) => { if (x.type === "ERROR" || x.isMissing) errs.push(`${x.type}[${x.startPosition.row+1}:${x.startPosition.column+1}]`); for (let i = 0; i < x.childCount; i++) walk(x.child(i)) }
    walk(t.rootNode)
    console.log(`  ${errs.length ? "BROKEN " + JSON.stringify(errs.slice(0,3)) : "clean  "} | ${name}`)
  }
}
