/**
 * IS THE PRODUCTION PARSE DETERMINISTIC FOR ONE FILE?
 *
 * ## Why this exists
 *
 * The first protobuf census run of the 2026-10-04 session reported
 * `symbols through parseFile 41945 / edges through parseFile 54930`, and the
 * three runs after it reported `41955 / 54939`. Same worktree, same commit,
 * same corpus, same pinned wasm (`wasm/tree-sitter-protobuf.wasm`,
 * sha256 4624eb6d…, verified against `script/m14/tmp/protobuf/pin.json`). The
 * ANALYZER's own totals were identical in all four runs — 41,956 symbols and
 * 55,941 edges — so the difference is on the production side of the boundary
 * and not in this lane's extractor.
 *
 * The bad run logged exactly two lines the good runs did not:
 *
 *   [BB-PARSE-ERR] protobuf | …/pb-googleapis/google/api/expr/v1beta1/source.proto
 *                  | memory access out of bounds
 *   [BB-HANG] parser stuck 120s on …/source.proto — exiting
 *
 * and `source.proto` is 62 lines with two messages and no construct the rest of
 * the corpus lacks. The census counted that file `ok`: `parseFile` catches the
 * wasm fault internally and RETURNS, so `filesOk++` still runs and the census
 * printed `821 ok / 0 fail` on all four runs. A file that silently loses
 * 10 symbols and 9 `contains` edges is therefore invisible to a file-level
 * ok/fail counter — it shows up only as a delta between two totals.
 *
 * ## What this measures
 *
 * Repeated IDENTICAL attempts at ONE file. There is no oracle here and none is
 * needed: if the same bytes parsed twice produce two different symbol counts,
 * the parse is not deterministic, and every count derived from it inherits
 * that. The probe reports the distinct outcomes it observed rather than a mean,
 * because the interesting fact is that there is more than one.
 *
 * Two regimes, because the census runs 8 workers concurrently and a sequential
 * loop would not reproduce the condition:
 *
 *   sequential  one attempt at a time, N attempts
 *   concurrent  N attempts in flight at once, the census's own width
 *
 * CLI: npx tsx script/m14/tmp/protobuf/probe/parse-variance.mts [--n 40]
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"
import { RealProtobufAnalyzer } from "../../../../../src/ast/real-protobuf-analyzer"

const N = Number((process.argv.find((a) => a.startsWith("--n=")) ?? "--n=40").slice(4))
const TARGET = "<corpus-root>/bb_tests/repositories/pb-googleapis/google/api/expr/v1beta1/source.proto"

const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const LanguageClass = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await LanguageClass.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")))
const analyzer = new RealProtobufAnalyzer()

// The analyzer's own reading of the file, once. It is the fixed reference the
// production counts are compared against, and it is computed through the
// analyzer — not through parseFile — so a production-side loss cannot hide
// inside it.
const content = readFileSync(TARGET, "utf8")
const refParser = new ParserClass()
refParser.setLanguage(grammar)
const refTree = refParser.parse(content)
const ref: any = analyzer.analyze(refTree.rootNode, content, TARGET)
const REF_SYMS = (ref.symbols ?? []).length
const REF_EDGES = (ref.relationships ?? []).length
const byType = new Map<string, number>()
for (const r of ref.relationships ?? []) byType.set(String(r.type), (byType.get(String(r.type)) ?? 0) + 1)

type Outcome = { syms: number; edges: number; perType: Map<string, number> }
async function attempt(): Promise<Outcome> {
  const prod: any = await parseFile(TARGET, path.dirname(TARGET))
  const perType = new Map<string, number>()
  for (const r of prod.relationships ?? []) perType.set(String(r.type), (perType.get(String(r.type)) ?? 0) + 1)
  return { syms: (prod.symbols ?? []).length, edges: (prod.relationships ?? []).length, perType }
}

const key = (o: Outcome) => `${o.syms} syms / ${o.edges} edges {${[...o.perType].sort().map(([k, v]) => `${k}=${v}`).join(",")}}`
const tally = new Map<string, number>()
function record(o: Outcome): void { tally.set(key(o), (tally.get(key(o)) ?? 0) + 1) }

// ---- sequential
for (let i = 0; i < N; i++) record(await attempt())

// ---- concurrent, at the census's own width
const batch = await Promise.all(Array.from({ length: N }, () => attempt()))
for (const o of batch) record(o)

console.log(`\nfile        ${TARGET}`)
console.log(`bytes       ${content.length}`)
console.log(`analyzer    ${REF_SYMS} symbols / ${REF_EDGES} edges  {${[...byType].sort().map(([k, v]) => `${k}=${v}`).join(",")}}`)
console.log(`attempts    ${N} sequential + ${N} concurrent (width 8, as protobuf-census.ts runs)`)
console.log(`\ndistinct production outcomes observed: ${tally.size}`)
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)} x  ${k}${v === N * 2 ? "" : "   <-- NOT the majority"}`)
}
const top = [...tally].sort((a, b) => b[1] - a[1])[0]
const spread = tally.size > 1
console.log(`\ndeterministic: ${spread ? "NO" : "yes (one outcome across all attempts)"}`)
if (spread) {
  console.log(`majority outcome loses ${REF_SYMS - Number(top[0].split(" ")[0])} symbols and ${REF_EDGES - Number(top[0].split(" edges")[0].split(" ")[2])} edges against the analyzer's own reading of the same bytes.`)
}
