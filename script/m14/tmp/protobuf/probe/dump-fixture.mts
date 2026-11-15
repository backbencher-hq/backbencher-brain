/**
 * Dump one fixture's analyzer output — symbols with ids and lines, relationships
 * with roles, imports with modifiers. Used to WRITE expectations; every value is
 * then checked back against the .proto source and the protobuf specification
 * before it goes into an expectation file.
 *
 * Usage: tsx dump-fixture.mts <fixture.proto>
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { ROOT, WASM } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(readFileSync(WASM)))
const { RealProtobufAnalyzer } = await import(path.join(ROOT, "src/ast/real-protobuf-analyzer.ts"))

const name = process.argv[2]
const file = path.join(ROOT, "validation/m14/fixtures/protobuf", name)
const content = readFileSync(file, "utf8")
const res: any = await new RealProtobufAnalyzer().analyze(parser.parse(content).rootNode, content, name)

console.log("--- source with line numbers ---")
content.split("\n").forEach((l, i) => console.log(String(i + 1).padStart(3) + " | " + l))
console.log("\n--- metadata ---")
console.log(JSON.stringify({ ...res.metadata, visitedNodes: undefined }, null, 1))
console.log("\n--- symbols ---")
for (const s of res.symbols ?? []) {
  console.log(
    `L${String(s.range?.startLine).padStart(3)} ${String(s.kind).padEnd(11)} name=${String(s.name).padEnd(22)} id=${String(s.metadata?.id)}` +
      ` owner=${s.ownerName ?? "-"}` +
      (s.metadata?.oneof ? ` oneof=${s.metadata.oneof}` : "") +
      (s.metadata?.viaExtension ? " viaExtension" : "") +
      (s.metadata?.isGroup ? " isGroup" : "") +
      (s.metadata?.isGroupType ? " isGroupType" : "") +
      (s.metadata?.clientStreaming !== undefined ? ` clientStreaming=${s.metadata.clientStreaming} serverStreaming=${s.metadata.serverStreaming}` : "") +
      (s.metadata?.reserved ? ` reserved=${JSON.stringify(s.metadata.reserved)}` : "") +
      (s.metadata?.extensions ? ` extensions=${JSON.stringify(s.metadata.extensions)}` : ""),
  )
}
console.log("\n--- relationships ---")
for (const r of res.relationships ?? []) {
  console.log(`L${String(r.line_number).padStart(3)} ${String(r.type).padEnd(9)} ${String(r.source).padEnd(34)} -> ${String(r.target).padEnd(34)} role=${r.metadata?.role ?? "-"} member=${r.metadata?.member ?? "-"} conf=${r.confidence}`)
}
console.log("\n--- imports ---")
for (const i of res.imports ?? []) console.log(`L${i.range?.startLine} ${JSON.stringify(i.module)} modifier=${i.metadata?.modifier ?? "-"}`)
