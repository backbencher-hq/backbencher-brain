#!/usr/bin/env bun
/**
 * The lane's fast invariant check: run the analyzer directly over a set of
 * sources and assert the properties the lane is measured on. This is NOT a
 * substitute for `solidity-surface-measure.ts` (which measures a pinned corpus
 * draw through the production `parseFile`) — it is the loop that makes an edit
 * cheap to check, and it fails on the same invariants so a fast check and a slow
 * check cannot disagree.
 *
 *   bun run script/m60/solidity-analyzer-selfcheck.ts
 *   bun run script/m60/solidity-analyzer-selfcheck.ts <file.sol>...
 */
import * as fs from "node:fs"
import * as path from "node:path"
import * as WTS from "web-tree-sitter"
import { RealSolidityAnalyzer } from "../../src/ast/real-solidity-analyzer"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")

const ONTOLOGY = [
  "calls", "extends", "implements", "instantiates", "uses",
  "references", "contains", "overrides", "exports", "imports",
]
/** Kinds the lane must EMIT. `imports` is deliberately modelled as an
 *  import-annotated `references` edge — the settled house convention — so it is
 *  checked through `metadata.import`, not as its own kind. */
const REQUIRED = ONTOLOGY.filter((k) => k !== "imports")

await WTS.Parser.init()
const lang = await WTS.Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-solidity.wasm")))
const parser = new WTS.Parser()
parser.setLanguage(lang)

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error("usage: bun run script/m60/solidity-analyzer-selfcheck.ts <file.sol>...")
  process.exit(2)
}

const analyzer = new RealSolidityAnalyzer()
const kinds: Record<string, number> = {}
const tiers: Record<string, number> = {}
let symbols = 0
let rels = 0
let withLine = 0
const failures: string[] = []
const unknown: string[] = []
const dupes: string[] = []
const importEdges: any[] = []

for (const rel of files) {
  const abs = path.resolve(rel)
  const text = fs.readFileSync(abs, "utf8")
  const tree = parser.parse(text)
  const r: any = analyzer.analyze(tree.rootNode as any, text, abs)

  const names = new Set<string>()
  for (const s of r.symbols) {
    names.add(s.name)
    symbols++
    // SOL-1/SOL-2 — a top-level declaration's owner must be the file's module
    // symbol. `global` is refused by isIndexArtifactName, so a synthetic global
    // scope would make every file-scope edge unresolvable.
    if (s.name !== r.symbols[0].name && !s.ownerName) {
      failures.push(`${rel}: symbol '${s.name}' has no ownerName`)
    }
    if (s.ownerName === "global") failures.push(`${rel}: ownerName 'global' is refused by the store`)
  }
  const seen = new Set<string>()
  for (const s of r.symbols) {
    const k = `${rel}|${s.ownerName ?? ""}|${s.name}|${s.kind}`
    if (seen.has(k)) dupes.push(`${k} x2`)
    seen.add(k)
  }
  for (const x of r.relationships) {
    rels++
    const t = String(x.type)
    kinds[t] = (kinds[t] ?? 0) + 1
    tiers[String(x.metadata?.evidenceClass)] = (tiers[String(x.metadata?.evidenceClass)] ?? 0) + 1
    if (typeof x.line_number === "number" && x.line_number > 0) withLine++
    else failures.push(`${rel}: ${t} -> ${x.target} has NO positive line_number`)
    const meta = x.metadata ?? {}
    if (meta.import === true) importEdges.push({ ...x, file: rel })
    // Same resolvability rule as the PowerShell surface measure: only kinds
    // whose BOTH ends are locally declared by definition.
    if (t === "contains" || t === "overrides" || t === "extends" || t === "implements" || t === "exports") {
      const target = String(x.target)
      if (target && !names.has(target)) unknown.push(`${rel}:${x.line_number} ${t} -> ${target}`)
    }
  }
}

console.log(`files=${files.length} symbols=${symbols} rels=${rels} line=${withLine}/${rels} (${rels ? ((withLine / rels) * 100).toFixed(2) : "n/a"}%)`)
console.log(`kinds: ${JSON.stringify(kinds)}`)
console.log(`tiers: ${JSON.stringify(tiers)}`)
console.log(`import-annotated references edges: ${importEdges.length}`)
const missingKinds = REQUIRED.filter((k) => !kinds[k])
console.log(`missing kinds: ${missingKinds.length ? missingKinds.join(", ") : "none"}`)
if (unknown.length) console.log(`unknownTargets: ${unknown.length}\n  ${unknown.slice(0, 15).join("\n  ")}`)
if (dupes.length) console.log(`dupKeys: ${dupes.length}\n  ${dupes.slice(0, 15).join("\n  ")}`)
for (const f of failures.slice(0, 20)) console.log(`FAIL ${f}`)
if (failures.length > 20) console.log(`... and ${failures.length - 20} more`)

parser.delete()
const bad = failures.length > 0 || unknown.length > 0 || dupes.length > 0 || missingKinds.length > 0
console.log(bad ? "\nFAIL" : "\nPASS")
process.exit(bad ? 1 : 0)