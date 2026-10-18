// JAVASCRIPT EDGE-DELTA PROBE — explains a row-count difference between the analyzer's RAW output
// and the PRODUCTION pipeline, exactly. The binding claim re-spells a target; any pipeline step that
// keys on the target STRING can then treat the same logical row differently. The fleet advisory
// (solidity W8) says such a step can SPLIT rows whose dedupe key includes the target. The JS
// analyzer emits no relationship dedupe of its own, so the only production step that can change a
// row's fate with its target string is pool-worker's DROPPED-SYMBOL INVARIANT (an edge whose
// endpoint string equals a symbol identity `keepSymbol` dropped is dropped with it).
//
// This probe replicates the production path per file:
//   raw    = analyzer.analyze(...)                       (current HEAD)
//   before = the same rows with every binding claim re-spelled back to its bare leaf
//   kept   = keepSymbol + identityOf + the dropped-endpoint filter + filterNoiseRelationships
// and prints, for the whole admitted population, (a) the before/after row counts, (b) every row that
// the claim ADDS or REMOVES, named by file/source/target/line. That is the evidence for the +N in the
// whole-population arm, and it distinguishes a genuine newly-surfaced edge from a dedupe split.
//
// USAGE: export BB_CORPUS_ROOT=$PWD/.corpus
//        bun run script/m14/js-edge-delta-probe.ts [--limit=N]
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { keepSymbol, filterNoiseRelationships } from "../../src/ast/pool-worker"
import { BINDING_SEP } from "../../src/ast/types"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.slice("--limit=".length) ?? 0)
const EXTENSIONS = ["js", "jsx", "mjs", "cjs"]
const SIZE_CAP = 1024 * 1024
function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name)
    let st
    try { st = statSync(abs) } catch { continue }
    if (st.isDirectory()) { walk(abs, out); continue }
    const dot = name.lastIndexOf(".")
    if (dot < 0) continue
    if (!EXTENSIONS.includes(name.slice(dot + 1).toLowerCase())) continue
    if (st.size > SIZE_CAP) continue
    out.push(abs)
  }
}
const files: string[] = []
const fileListArg = process.argv.find((a) => a.startsWith("--files="))?.slice("--files=".length)
if (fileListArg) {
  // TARGETED MODE: an explicit file list (newline/pipe separated), used to price a small class
  // without re-walking the population (a full walk is heavy and the box is shared).
  for (const f of readFileSync(fileListArg, "utf8").split(/\r?\n/)) {
    const t = f.trim()
    if (t) files.push(path.isAbsolute(t) ? t : path.join(process.cwd(), t))
  }
} else {
  walk(CR, files)
  files.sort()
  if (LIMIT > 0) files.length = Math.min(files.length, LIMIT)
}

const { RealJavaScriptAnalyzer } = await import("../../src/ast/real-javascript-analyzer")
const analyzer = new (RealJavaScriptAnalyzer as any)()
const identityOf = (s: any): string[] => {
  const out: string[] = []
  if (s?.name) out.push(String(s.name))
  if (s?.qualifiedName) out.push(String(s.qualifiedName))
  if (typeof s?.metadata?.fqn === "string" && s.metadata.fqn) out.push(String(s.metadata.fqn))
  if (s?.name) out.push(s.qualifiedName || s.metadata?.fqn || (s.scope ? `${s.scope}.${s.name}` : String(s.name)))
  return out
}
type Row = { source: string; target: string; type: string; line: number | undefined; meta: any }
const rowsOf = (rels: any[]): Row[] => (rels ?? []).map((r) => ({
  source: String(r?.source ?? r?.from ?? ""),
  target: String(r?.target ?? r?.to ?? ""),
  type: String(r?.type ?? r?.relationshipType ?? ""),
  line: r?.line_number ?? r?.line ?? undefined,
  meta: r?.metadata ?? {},
}))
const leafOf = (target: string): string => {
  const at = target.lastIndexOf(BINDING_SEP)
  return at >= 0 ? target.slice(at + BINDING_SEP.length) : target
}
// LOGICAL IDENTITY — the claim RE-SPELLS a row, it does not create a new logical edge, so the
// before/after comparison must use the same identity for both (the BARE leaf, never the raw target).
const keyOf = (r: Row): string => `${r.source}\u0000${r.type}\u0000${leafOf(r.target)}\u0000${r.line ?? ""}`

let parsedFiles = 0, skipped = 0
const added: Array<Row & { file: string; reason: string }> = []
const removed: Array<Row & { file: string; reason: string }> = []
let beforeTotal = 0, afterTotal = 0
for (const abs of files) {
  let content: string
  try { content = readFileSync(abs, "utf8") } catch { skipped++; continue }
  let result: any
  try {
    const parser: any = await getParser("javascript" as any)
    const tree = parser.parse(content)
    result = await analyzer.analyze(tree.rootNode, content, abs)
    tree.delete?.()
  } catch { skipped++; continue }
  parsedFiles++
  const raw = rowsOf(result.relationships)
  const symbols = result.symbols ?? []
  // --- replicate pool-worker's kept/dropped symbol split ---
  const keptSymbols: any[] = []
  const keptNames = new Set<string>()
  const notKept: any[] = []
  for (const s of symbols) {
    if (keepSymbol(s, "javascript")) { keptSymbols.push(s); for (const id of identityOf(s)) keptNames.add(id) }
    else notKept.push(s)
  }
  const droppedNames = new Set<string>()
  for (const s of notKept) for (const id of identityOf(s)) if (!keptNames.has(id)) droppedNames.add(id)
  const declaredNames = new Set<string>(keptSymbols.map((s: any) => String(s?.name ?? "")).filter(Boolean))
  const runPipeline = (rows: Row[]): Row[] => {
    const dropped = droppedNames.size
      ? rows.filter((r) => !droppedNames.has(r.source) && !droppedNames.has(r.target))
      : rows
    return rowsOf(filterNoiseRelationships(dropped as any[], "javascript", declaredNames))
  }
  const beforeRows = raw.map((r) => r.meta?.localBinding === true && r.target.includes(BINDING_SEP)
    ? { ...r, target: r.target.slice(r.target.lastIndexOf(BINDING_SEP) + BINDING_SEP.length) }
    : r)
  const before = runPipeline(beforeRows)
  const after = runPipeline(raw)
  beforeTotal += before.length
  afterTotal += after.length
  const beforeKeys = new Map<string, number>()
  for (const r of before) beforeKeys.set(keyOf(r), (beforeKeys.get(keyOf(r)) ?? 0) + 1)
  const afterKeys = new Map<string, number>()
  for (const r of after) afterKeys.set(keyOf(r), (afterKeys.get(keyOf(r)) ?? 0) + 1)
  const afterByIdentity = new Map<string, Row>()
  for (const r of after) afterByIdentity.set(keyOf(r), r)
  for (const [k, have] of afterKeys) {
    const had = beforeKeys.get(k) ?? 0
    if (have > had) {
      const r = afterByIdentity.get(k)!
      added.push({ ...r, file: path.relative(CR, abs), reason: droppedNames.has(leafOf(r.target)) ? "target-equals-dropped-symbol" : "survives-filter" })
    }
  }
  for (const [k, have] of beforeKeys) {
    const now = afterKeys.get(k) ?? 0
    if (have > now) {
      const r = before.find((row) => keyOf(row) === k)!
      removed.push({ ...r, file: path.relative(CR, abs), reason: droppedNames.has(leafOf(r.target)) ? "target-equals-dropped-symbol" : "other" })
    }
  }
}
console.log(JSON.stringify({
  probe: "js-edge-delta-probe",
  command: "bun run script/m14/js-edge-delta-probe.ts",
  population: { corpusFiles: files.length, parsed: parsedFiles, skipped },
  rawVersusProduction: {
    beforeRows: beforeTotal,
    afterRows: afterTotal,
    delta: afterTotal - beforeTotal,
    addedRows: added.length,
    removedRows: removed.length,
  },
  added: added.slice(0, 40).map((r) => ({ file: r.file, type: r.type, source: r.source, target: r.target, line: r.line, reason: r.reason, localBinding: r.meta?.localBinding === true })),
  removed: removed.slice(0, 20).map((r) => ({ file: r.file, type: r.type, source: r.source, target: r.target, line: r.line, reason: r.reason })),
  note: "BEFORE rows are the SAME analyzer output with each binding claim re-spelled back to its bare leaf; the production pipeline is replicated exactly (keepSymbol -> identityOf -> dropped-endpoint filter -> filterNoiseRelationships). A row in `added` is one the claim SURFACES; inspect reason: target-equals-dropped-symbol means the bare target was dropped with a keepSymbol-filtered symbol identity.",
}, null, 1))
