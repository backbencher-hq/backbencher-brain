/**
 * MULTI-VALUE DOCUMENT A/B — what production `parseFile` publishes when a file holds
 * more than one top-level JSON value.
 *
 * ## Why this is separate from `top-level-siblings.ts`
 *
 * That probe derives its population from the PARSE TREE. This one reads what production
 * published, so it is the instrument that says whether the analyzer actually emits the
 * duplicates the tree admits. The two disagreeing is the finding worth having.
 *
 * It also separates the two causes of a duplicate qualified name, because they have
 * different owners and different fixes:
 *
 *   MULTI-TOP-LEVEL-VALUE   a `document` node with more than one VALUE child (two
 *                           concatenated objects, an object and a trailing scalar). The
 *                           analyzer pushes every named child of `document` under ONE
 *                           parentPath, so sibling 2's keys are addressed as if they were
 *                           sibling 1's. A container with N siblings needs to give them N
 *                           positions — the same rule the top-level-array fix applied.
 *   DUPLICATE-KEY-IN-ONE-OBJECT  two `pair`s with the same key inside ONE object. That is
 *                           the `overrides` case and it already carries its own edge; the
 *                           duplicate qualified NAME is inherent to the shape (a JSON key
 *                           is not a name) and no position exists that would separate them
 *                           without hiding the override.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/json/multi-value-ab.ts --out <file.json> [--json]
 */
import { parseFile } from "../../../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const argOf = (k: string, d: string): string => {
  const i = argv.indexOf(k)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const JSON_OUT = argv.includes("--json")
const IN = argOf("--out", "")

const VALUE_TYPES = new Set(["object", "array", "string", "number", "true", "false", "null"])

type Row = {
  file: string
  dir: string
  topLevelValues: number
  symbols: number
  distinctPaths: number
  duplicatePaths: number
  duplicateNames: number
  kindsDisagree: number
  symbolOccurrencesInDuplicates: number
  duplicateKeyPaths: number
  edges: number
  containsResolved: number
  containsTotal: number
  edgesByType: Record<string, number>
  duplicateExamples: string[]
  noPathSymbols: number
}

async function main(): Promise<void> {
  const rows: Row[] = []
  const abs = IN
  const dir = abs.slice(0, abs.lastIndexOf("/") + 1)
  const r: any = await parseFile(abs, dir)
  const symbols: any[] = r.symbols ?? []
  const rels: any[] = r.relationships ?? []
  const byPath = new Map<string, any[]>()
  for (const s of symbols) {
    const p = String(s.qualifiedName ?? "")
    const list = byPath.get(p)
    if (list) list.push(s)
    else byPath.set(p, [s])
  }
  let duplicatePaths = 0
  let duplicateNames = 0
  let kindsDisagree = 0
  let occurrences = 0
  const examples: string[] = []
  for (const [p, list] of byPath) {
    if (list.length <= 1) continue
    duplicatePaths++
    duplicateNames++
    occurrences += list.length
    const kinds = new Set(list.map((s) => s.kind))
    if (kinds.size > 1) kindsDisagree++
    if (examples.length < 12) examples.push(`${p} x${list.length} kinds=[${[...kinds].join(",")}] lines=[${list.map((s) => s.range?.startLine).join(",")}]`)
  }
  const paths = new Set(byPath.keys())
  let containsResolved = 0
  let containsTotal = 0
  const edgesByType: Record<string, number> = {}
  for (const e of rels) {
    edgesByType[e.type] = (edgesByType[e.type] ?? 0) + 1
    if (e.type !== "contains") continue
    containsTotal++
    if (paths.has(String(e.source)) && paths.has(String(e.target))) containsResolved++
  }
  const row: Row = {
    file: abs,
    dir,
    topLevelValues: -1,
    symbols: symbols.length,
    distinctPaths: byPath.size,
    duplicatePaths,
    duplicateNames,
    kindsDisagree,
    symbolOccurrencesInDuplicates: occurrences,
    duplicateKeyPaths: -1,
    edges: rels.length,
    containsResolved,
    containsTotal,
    edgesByType,
    duplicateExamples: examples,
    noPathSymbols: symbols.filter((s) => String(s.qualifiedName ?? "") === "").length,
  }
  rows.push(row)

  if (JSON_OUT) {
    console.log(JSON.stringify({ rows }, null, 2))
    return
  }
  for (const r2 of rows) {
    console.log(`file                     : ${r2.file}`)
    console.log(`symbols published        : ${r2.symbols}`)
    console.log(`symbols with no path     : ${r2.noPathSymbols}`)
    console.log(`DISTINCT qualified paths : ${r2.distinctPaths}`)
    console.log(`duplicate qualified paths: ${r2.duplicatePaths}`)
    console.log(`  of those, KINDS DISAGREE: ${r2.kindsDisagree}`)
    console.log(`symbol occurrences in them: ${r2.symbolOccurrencesInDuplicates}`)
    console.log(`edges                    : ${r2.edges}  ${JSON.stringify(r2.edgesByType)}`)
    console.log(`contains resolved both   : ${r2.containsResolved} of ${r2.containsTotal}`)
    for (const e of r2.duplicateExamples) console.log(`  dup: ${e}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})