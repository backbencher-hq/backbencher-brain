// Probe the fixture's actual analysis to author honest expectations.
// Uses the same call convention as script/m14/run-fixtures.ts.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"

const f = "validation/m14/fixtures/groovy/grammar-rebuild-constructs.groovy"
const content = fs.readFileSync(f, "utf8")
await WTS.Parser.init()
const Lang = await WTS.Language.load(path.join(process.cwd(), "wasm/tree-sitter-groovy.wasm"))
const p = new WTS.Parser()
p.setLanguage(Lang)
const tree = p.parse(content)
const a: any = new RealGroovyAnalyzer()
const r = await a.analyze(tree.rootNode, content, `fixtures/groovy/${path.basename(f)}`)
console.log("PARSE ERROR:", tree.rootNode.hasError)
console.log("SYMBOLS:", (r.symbols ?? []).map((s: any) => `${s.kind}:${s.name}`).join("  "))
console.log("RELATIONSHIPS:")
for (const x of (r.relationships ?? [])) console.log(`   ${x.type} ${x.source} -> ${x.target} ${JSON.stringify(x.metadata ?? {})}`)
console.log("WARNINGS:", JSON.stringify(r.warnings ?? []).slice(0, 300))
