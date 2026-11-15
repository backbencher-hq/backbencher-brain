/**
 * GraphQL ANALYZER DUMP — every emitted fact, one per line, with the source
 * line it claims. This is the instrument used to HAND-AUDIT the analyzer's
 * output against the spec and to build the differential ground truth. It prints
 * the source line next to each fact so an auditor can check both at once.
 *
 *   tsx analyzer-dump.mts                 # every fixture
 *   tsx analyzer-dump.mts path/to/file   # one file
 */
import * as fs from "fs"
import * as path from "path"
import { GQL, ROOT } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const language: any = await Language.load(fs.readFileSync(process.env.GQL_WASM ?? path.join(ROOT, "wasm/tree-sitter-graphql.wasm")))
const parser = new ParserClass()
parser.setLanguage(language)
const mod: any = await import(path.join(ROOT, "src/ast/real-graphql-analyzer.ts"))

const args = process.argv.slice(2)
const files = args.length
  ? args
  : fs.readdirSync(path.join(GQL, "fixtures")).filter((f) => f.endsWith(".graphql")).sort().map((f) => path.join(GQL, "fixtures", f))

for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const lines = src.split("\n")
  const tree = parser.parse(src)
  const res: any = new mod.RealGraphqlAnalyzer().analyze(tree.rootNode, src, f)
  console.log(`\n################ ${path.basename(f)} ################`)
  console.log(`# grammar hasError=${tree.rootNode.hasError}  analyzer errors=${res.errors.length}`)
  console.log(`# symbols=${res.symbols.length} relationships=${res.relationships.length} exports=${res.exports.length} imports=${res.imports.length}`)
  console.log(`# --- SYMBOLS ---`)
  for (const s of res.symbols) {
    const r = s.range
    const srcLine = (lines[r.startLine - 1] ?? "").trim().slice(0, 62)
    const extra = [
      s.ownerName ? `owner=${s.ownerName}` : "",
      s.returnType ? `ret=${s.returnType}` : "",
      s.parameters && s.parameters.length ? `params=[${s.parameters.map((p: any) => `${p.name}${p.isOptional ? "?" : "!"}:${p.type ?? "?"}`).join(",")}]` : "",
      s.docstring ? `doc=${JSON.stringify(s.docstring.slice(0, 34))}` : "",
      s.scope ? `scope=${s.scope}` : "",
    ].filter(Boolean).join(" ")
    console.log(`  ${String(r.startLine).padStart(3)}:${String(r.startColumn).padStart(2)}-${String(r.endColumn).padStart(2)}  ${String(s.kind).padEnd(11)} ${s.name.padEnd(28)} | ${srcLine.padEnd(62)} | ${extra}`)
  }
  console.log(`# --- RELATIONSHIPS ---`)
  for (const rel of res.relationships) {
    console.log(`  ${String(rel.type).padEnd(10)} ${String(rel.source).padEnd(28)} -> ${String(rel.target).padEnd(28)} ${rel.metadata?.relationshipRole ?? ""}`)
  }
  console.log(`# --- EXPORTS ---`)
  for (const e of res.exports) console.log(`  ${e.kind.padEnd(11)} ${e.name}`)
}
