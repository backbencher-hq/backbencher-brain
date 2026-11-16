import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/bb-lanes/graphql"
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default?.Parser
const LanguageClass = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const files = [
  "<corpus-root>/bb_tests/repositories/gql-graphql-core/tests/fixtures/schema_kitchen_sink.graphql",
  "<corpus-root>/bb_tests/repositories/gql-absinthe/test/support/fixtures/language/kitchen-sink.graphql",
  "<corpus-root>/bb_tests/repositories/hasura-engine/v3/crates/graphql/lang-graphql/tests/query_testdata/ok/0001_simple_query.graphql",
]
for (const wasm of ["tree-sitter-bash.wasm", "tree-sitter-graphql.wasm"]) {
  const p = new ParserClass()
  p.setLanguage(await LanguageClass.load(readFileSync(path.join(ROOT, "wasm", wasm))))
  const types = new Set<string>()
  let n = 0
  for (const f of files) {
    let src = ""
    try { src = readFileSync(f, "utf8") } catch { continue }
    const t = p.parse(src)
    if (!t) continue
    const v = (nd: any) => { types.add(nd.type); n++; for (let i = 0; i < nd.childCount; i++) v(nd.child(i)) }
    v(t.rootNode); t.delete?.()
  }
  console.log(`${wasm}: distinct node types over ${files.length} GraphQL files = ${types.size}, nodes = ${n}`)
}
