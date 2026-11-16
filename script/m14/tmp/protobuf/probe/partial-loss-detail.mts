/**
 * PARTIAL-LOSS DETAIL — which symbols does production publish fewer of, and why?
 *
 * ## Why this file exists
 *
 * `lost-file-discovery.mts` walks the derived corpus population and reports, per
 * production pass, the files where production published FEWER symbols than this
 * lane's analyzer read from the same bytes. Two populations came out of it:
 *
 *   - files lost WHOLE, 3 of 3,284 file-parses, a different file in each of three
 *     repositories, each printing `[BB-PARSE-ERR] … memory access out of bounds`.
 *     Those are the shared-runtime fault passes 7/10/11 bounded.
 *   - ONE file short on EVERY pass — `boundary/internal/proto/controller/
 *     custom_options/v1/options.proto`, 4 of 4. A whole-file loss that recurs on
 *     every run is not the random fault; it is a deterministic property, and
 *     deterministic is a different finding with a different fix.
 *
 * This file takes that one file and answers the question the discovery probe
 * cannot: WHICH symbols, and what in the pipeline drops them.
 *
 * ## How the identity is established
 *
 * By id correspondence, not by name. The analyzer publishes
 * `metadata.id`; pool-worker's symbol projection does not carry per-symbol
 * metadata, so the product's id is re-derived as `ownerName + "." + name` — the
 * same re-derivation `protobuf-census.ts` uses and the reason it reports two id
 * sets side by side. Both spellings are tried, and a symbol is counted missing
 * only when NEITHER spelling is in the product's set. The reference is computed
 * through the analyzer, never through `parseFile`, so a production-side loss
 * cannot hide inside the yardstick it is measured against.
 *
 * ## What it cannot see
 *
 * If the loss is in `keepSymbol` noise filtering, the dropped symbols are named
 * here but the REASON is not derivable from this file — that needs the shared
 * pipeline stage's own predicate, which is not this lane's to read as a
 * conclusion. What this file can say is whether the drop is a filter decision
 * (the id is absent, and the symbol is otherwise ordinary) or a parse fault (a
 * `[BB-PARSE-ERR]` was logged for the file), and those are opposite findings.
 *
 * ## Usage
 *
 *   npx tsx script/m14/tmp/protobuf/probe/partial-loss-detail.mts [<file>]
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"
import { RealProtobufAnalyzer } from "../../../../../src/ast/real-protobuf-analyzer"

const DEFAULT_TARGET =
  "<corpus-root>/bb_tests/repositories/boundary/internal/proto/controller/custom_options/v1/options.proto"
const TARGET = process.argv[2] ?? DEFAULT_TARGET
const ATTEMPTS = Number((process.argv.find((a) => a.startsWith("--attempts=")) ?? "--attempts=5").slice(11))

const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const LanguageClass = wts.Language ?? wts.default?.Language
await ParserClass.init({
  locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const grammar = await LanguageClass.load(
  readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")),
)

const content = readFileSync(TARGET, "utf8")
const parser = new ParserClass()
parser.setLanguage(grammar)
const refTree = parser.parse(content)
const ref: any = new RealProtobufAnalyzer().analyze(refTree.rootNode, content, TARGET)
const REF = ref.symbols ?? []
const refIds = REF.map((s: any) => String(s.metadata?.id ?? s.name))
const refKinds = new Map<string, number>()
for (const s of REF) {
  const k = String(s.kind ?? "")
  refKinds.set(k, (refKinds.get(k) ?? 0) + 1)
}
const refByType = new Map<string, number>()
for (const r of ref.relationships ?? []) {
  const t = String(r.type)
  refByType.set(t, (refByType.get(t) ?? 0) + 1)
}

console.log(`file        ${TARGET}`)
console.log(`bytes       ${content.length}`)
console.log(`analyzer    ${REF.length} symbols / ${(ref.relationships ?? []).length} edges  {${[...refByType].sort().map(([k, v]) => `${k}=${v}`).join(",")}}`)
console.log(`kinds       {${[...refKinds].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k || "(empty)"}:${v}`).join(",")}}`)

const outcomes = new Map<string, number>()
const missingTally = new Map<string, { kind: string; n: number }>()
for (let i = 0; i < ATTEMPTS; i++) {
  const prod: any = await parseFile(TARGET, path.dirname(TARGET))
  const prodSyms = prod.symbols ?? []
  const prodIds = new Set<string>()
  for (const s of prodSyms) {
    prodIds.add(s.ownerName ? `${s.ownerName}.${s.name}` : s.name)
    prodIds.add(s.qualifiedName ?? s.name)
    prodIds.add(s.name)
  }
  const missing: string[] = []
  for (const id of refIds) if (!prodIds.has(id)) missing.push(id)
  for (const m of missing) {
    const idx = refIds.indexOf(m)
    const kind = String(REF[idx]?.kind ?? "?")
    const prev = missingTally.get(m) ?? { kind, n: 0 }
    prev.n++
    missingTally.set(m, prev)
  }
  const prodTypes = new Map<string, number>()
  for (const r of prod.relationships ?? []) {
    const t = String(r.type)
    prodTypes.set(t, (prodTypes.get(t) ?? 0) + 1)
  }
  const key = `${prodSyms.length} syms / ${(prod.relationships ?? []).length} edges missing=${missing.length} {${[...prodTypes].sort().map(([k, v]) => `${k}=${v}`).join(",")}}`
  outcomes.set(key, (outcomes.get(key) ?? 0) + 1)
}

console.log(`attempts    ${ATTEMPTS}\n`)
console.log(`distinct production outcomes: ${outcomes.size}`)
for (const [k, v] of [...outcomes].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)} x  ${k}`)

console.log(`\nsymbols the analyzer published that production did NOT, by id:`)
if (missingTally.size === 0) console.log("  (none)")
for (const [id, v] of [...missingTally].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))) {
  console.log(`  ${String(v.n).padStart(3)}/${ATTEMPTS} attempts  kind=${v.kind.padEnd(10)} ${id}`)
}
const always = [...missingTally.entries()].filter(([, v]) => v.n === ATTEMPTS)
console.log(`\ndeterministic (absent on all ${ATTEMPTS} attempts): ${always.length} of ${missingTally.size} missing ids`)
console.log(`per-type analyzer vs production (best attempt):`)
{
  const best = [...outcomes.keys()].sort((a, b) => Number(b.slice(0, b.indexOf(" "))) - Number(a.slice(0, a.indexOf(" "))))[0]
  console.log(`  analyzer   {${[...refByType].sort().map(([k, v]) => `${k}=${v}`).join(",")}}`)
  console.log(`  production ${best.slice(best.indexOf("{") )}`)
}