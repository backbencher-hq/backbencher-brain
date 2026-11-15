/** print what the analyzer produced for one fixture file, for authoring expectations */
import { analyze } from "../../../src/ast/engine"
import { RealScssAnalyzer } from "../../../src/ast/real-scss-analyzer"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../m14/run-fixtures"
const file = process.argv[2]
const abs = path.resolve("validation/m14/fixtures/scss", file)
const parser = await getParser("scss")
const content = readFileSync(abs, "utf8")
const tree = parser.parse(content)
const r: any = new RealScssAnalyzer().analyze(tree!.rootNode, content, abs)
console.log("=== SYMBOLS ===")
for (const s of r.symbols) console.log(`${s.kind}\t${s.name}\tscope=${s.scope ?? ""}\t@${s.range.startLine}${s.metadata?.isScssPlaceholder ? "  [placeholder]" : ""}${s.metadata?.isScssModule ? "  [MODULE]" : ""}`)
console.log("=== RELATIONSHIPS ===")
for (const x of r.relationships) console.log(`${x.type}\t${x.source} -> ${x.target}\t@${x.line_number}${x.metadata?.isScssModuleMember ? "  [module member]" : ""}${x.metadata?.isScssGlobalOverride ? `  [override of line ${x.metadata.overridesLine}]` : ""}`)
console.log("=== EXPORTS ARRAY ===", JSON.stringify((r.exports ?? []).map((e: any) => e.name)))
