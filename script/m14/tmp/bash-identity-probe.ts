/**
 * READ-ONLY PROBE — bash lane identity census.
 *
 * Two questions the lane's own artifacts do not answer:
 *
 *  1. UNKNOWN SYMBOLS (lane-audit formula §5). Over the production parseFile
 *     output: empty/unknown names, unknown kinds, members with no ownerName,
 *     symbol-free files, and — the one the lane never measures — relationship
 *     endpoints that are NOT symbols in the file. A `source` that no symbol
 *     declares is a phantom endpoint: the graph cannot resolve it, so
 *     bb_graph / bb_impact on that edge is silently empty.
 *
 *  2. RELATIONSHIP ONTOLOGY (formula §7). Which of the 10 relationship type
 *     values the engine defines the lane can emit, which it does emit, and
 *     which the language's semantics allow — with the count per type, and the
 *     count of edges carrying a site line.
 *
 * Writes nothing.
 */
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { parseFile } from "../../../src/ast/pool-worker"

const CORPUS = process.env.BB_BASH_CORPUS ?? "/home/ishaq2321/bb_tests/repositories/fsharp"
const ROOT = process.cwd()

const ALL_TYPES = [
  "calls", "extends", "implements", "uses", "imports",
  "exports", "contains", "references", "overrides", "instantiates",
]
const ALL_KINDS = new Set(Object.values(ASTEngine.SymbolKind).map(String))

const files = execFileSync("git", ["-C", CORPUS, "ls-files", "*.sh", "*.bash"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()

const typeCounts = new Map<string, number>()
const kindCounts = new Map<string, number>()
let totalSyms = 0, totalRels = 0
let emptyName = 0, unknownKind = 0, memberNoOwner = 0
let relsWithLine = 0, relsTotal = 0
let srcNotSymbol = 0, tgtNotSymbol = 0, bothNotSymbol = 0
const srcNotSymbolNames = new Map<string, number>()
const tgtNotSymbolNames = new Map<string, number>()
const phantomSamples: string[] = []
const symbolFreeFiles: { file: string; lines: number }[] = []
const relPerFile: { file: string; rels: number; unlined: number }[] = []
const noLineFiles: string[] = []

for (const file of files) {
  const res = await parseFile(path.join(CORPUS, file), ROOT)
  const syms = res.symbols ?? []
  const rels = res.relationships ?? []
  totalSyms += syms.length
  totalRels += rels.length

  const declared = new Set<string>()
  for (const s of syms) {
    const key = `${s.scope ?? ""}|${s.name}`
    declared.add(key)
    declared.add(s.name)
  }
  const byName = new Set(syms.map((s: any) => s.name))

  for (const s of syms as any[]) {
    if (!s.name || String(s.name).trim() === "") emptyName++
    if (!ALL_KINDS.has(String(s.kind))) { unknownKind++; kindCounts.set(String(s.kind), (kindCounts.get(String(s.kind)) ?? 0) + 1) }
    if (s.ownerName === undefined && (s.kind === "variable" || s.kind === "constant")) memberNoOwner++
    kindCounts.set(String(s.kind), (kindCounts.get(String(s.kind)) ?? 0) + 1)
  }

  let unlined = 0
  for (const r of rels as any[]) {
    const t = String(r.type ?? r.relationshipType ?? "")
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1)
    relsTotal++
    const hasLine = typeof r.line_number === "number" && r.line_number > 0
    if (hasLine) relsWithLine++
    else unlined++
    const src = String(r.source ?? r.from ?? "")
    const tgt = String(r.target ?? r.to ?? "")
    const sOk = byName.has(src)
    const tOk = byName.has(tgt)
    if (!sOk) { srcNotSymbol++; srcNotSymbolNames.set(src, (srcNotSymbolNames.get(src) ?? 0) + 1) }
    if (!tOk) { tgtNotSymbol++; tgtNotSymbolNames.set(tgt, (tgtNotSymbolNames.get(tgt) ?? 0) + 1) }
    if (!sOk && !tOk) bothNotSymbol++
    if (phantomSamples.length < 25 && !sOk) phantomSamples.push(`${file}: ${t} ${src} -> ${tgt}`)
  }
  relPerFile.push({ file, rels: rels.length, unlined })
  if (rels.length > 0 && unlined === rels.length) noLineFiles.push(file)
  if (syms.length === 0) {
    const text = execFileSync("git", ["-C", CORPUS, "show", `HEAD:${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    symbolFreeFiles.push({ file, lines: text.split("\n").length })
  }
}

const top = (m: Map<string, number>, n = 12) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)

console.log("=== bash identity census ===")
console.log("corpus:", CORPUS, "files:", files.length)
console.log(JSON.stringify({
  symbols: totalSyms,
  relationships: totalRels,
  symbolFreeFiles: symbolFreeFiles.length,
  emptyName,
  unknownKind,
  memberVariableOrConstantWithoutOwner: memberNoOwner,
  relationshipsWithLineNumber: relsWithLine,
  relationshipsTotal: relsTotal,
  filesWhereEveryEdgeIsUnlined: noLineFiles.length,
  edgeSourcesThatAreNotASymbolInTheFile: srcNotSymbol,
  edgeTargetsThatAreNotASymbolInTheFile: tgtNotSymbol,
  edgesWithNeitherEndpointASymbol: bothNotSymbol,
}, null, 2))

console.log("\n=== relationship types: engine-defined vs emitted ===")
for (const t of ALL_TYPES) {
  const n = typeCounts.get(t) ?? 0
  console.log(`${t.padEnd(14)} ${String(n).padStart(6)}  ${n === 0 ? "NOT EMITTED" : ""}`)
}
console.log("extra types not in the engine enum:", [...typeCounts.keys()].filter((k) => !ALL_TYPES.includes(k)))

console.log("\n=== symbol kinds ===")
for (const [k, n] of top(kindCounts, 40)) console.log(`${k.padEnd(16)} ${String(n).padStart(6)}  ${ALL_KINDS.has(k) ? "" : "NOT IN ENUM"}`)

console.log("\n=== top non-symbol edge SOURCES (phantom sources) ===")
for (const [k, n] of top(srcNotSymbolNames)) console.log(`${String(n).padStart(6)}  ${k}`)

console.log("\n=== top non-symbol edge TARGETS ===")
for (const [k, n] of top(tgtNotSymbolNames)) console.log(`${String(n).padStart(6)}  ${k}`)

console.log("\n=== symbol-free files ===")
for (const f of symbolFreeFiles) console.log(`${f.lines} lines  ${f.file}`)
