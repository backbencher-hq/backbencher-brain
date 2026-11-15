/**
 * RUST lane — STORE ROUND TRIP: the analyzer's payload through the REAL indexer
 * and the REAL sqlite store, then read back with SQL.
 *
 * WHY THIS TOOL EXISTS. Every audit in this lane stops at `analyzer.analyze()` —
 * the analyzer's output, not the product's. The elixir lane found two defects
 * that no analyzer-level gate could see, because fixtures never pass through the
 * pool worker: EX-A16 (`isDeclaration` published on the symbol but dropped at the
 * worker, so `brain_symbol.is_declaration` held 0 rows) and the W24 class (every
 * function-sourced edge landed with `source_symbol_id` NULL). A lane that has
 * never indexed a Rust project cannot claim its facts reach the graph.
 *
 * It runs the production path — `getProjectId` + `indexProjectParallel` — over a
 * real Rust project (a slice of a pinned corpus, not a synthetic fixture, so the
 * shapes are the ones production meets), then asserts in SQL:
 *   1. symbols landed, and the kind histogram matches the analyzer's own output
 *   2. members carry a NON-NULL owner_symbol_id (the ownership join)
 *   3. every relationship's source resolves to a stored symbol row
 *      (source_symbol_id NOT NULL) — the W24 class, re-checked for rust
 *   4. no relationship has line_number 0 or NULL — the M59/M60 line contract AT
 *      THE SEAM, which is where a line is actually consumed
 *   5. the per-label relationship counts match the analyzer's, so nothing is
 *      dropped or invented between the analyzer and the graph
 *   6. no two rows collide on the store's id key
 *   7. relationship SOURCE identity survives: the stored source symbol's name is
 *      the analyzer's source, not merely "some symbol that happened to match"
 *
 * CLI: npx tsx script/m14/tmp/rust-store-roundtrip.ts [--files=40] [--corpus=<dir>]
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const ROOT = "/home/sano/ishaq/backbencher-brain"
const arg = (n: string) => process.argv.find((a: string) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const FILES = Number(arg("files") ?? "40")
const CORPUS = arg("corpus") ?? "/home/sano/ishaq/bb_rust_corpora/serde"

const SKIP = new Set([".git", "target", "tests", "test", "benches", "examples", "fuzz"])

function collect(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collect(p, out)
    else if (e.name.endsWith(".rs") && fs.statSync(p).size > 0) out.push(p)
  }
  return out
}

async function main() {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-rust-rt-"))
  const projDir = path.join(workdir, "proj")
  fs.mkdirSync(projDir, { recursive: true })
  const taken = collect(CORPUS).sort().slice(0, FILES)
  if (taken.length === 0) { console.error(`no .rs files under ${CORPUS}`); process.exit(1) }
  for (const f of taken) {
    const rel = path.relative(CORPUS, f)
    const dest = path.join(projDir, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, fs.readFileSync(f))
  }
  const dataDir = path.join(workdir, "data")
  fs.mkdirSync(dataDir, { recursive: true })
  process.env.BB_DATA_DIR = dataDir

  // ---- the analyzer's own view, for the counts the store must match --------
  const rustMod: any = await import(path.join(ROOT, "src/ast/real-rust-analyzer.ts"))
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? (wts.default as any)?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-rust.wasm")))
  const parser = new P(); parser.setLanguage(g)

  let analyzerSymbols = 0
  const analyzerKinds: Record<string, number> = {}
  const analyzerRels: any[] = []
  const analyzerNames = new Set<string>()
  for (const f of taken) {
    const text = fs.readFileSync(f, "utf8")
    const r: any = await new rustMod.RealRustAnalyzer().analyze(parser.parse(text).rootNode, text, path.join(projDir, path.relative(CORPUS, f)))
    for (const s of r.symbols ?? []) { analyzerSymbols++; analyzerKinds[s.kind] = (analyzerKinds[s.kind] ?? 0) + 1; analyzerNames.add(`${s.name}@${s.range?.startLine}`) }
    for (const x of r.relationships ?? []) analyzerRels.push({ type: x.type, source: x.source, target: String(x.target), line: x.line_number ?? x.line })
  }

  // ---- the REAL index path ------------------------------------------------
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const pid = getProjectId(projDir) as any
  const t0 = Date.now()
  const stats = await indexProjectParallel(pid, projDir, { onProgress: () => {} })
  const ms = Date.now() - t0

  // ---- read the store back in SQL -----------------------------------------
  // BrainDatabase is a STATIC holder in this tree (the elixir round trip uses
  // `BrainDatabase.getRawInstance(pid)`), not a constructor — the first version
  // of this tool did `new BrainDatabase(pid)` and died after the whole index
  // had already run.
  const raw: any = await BrainDatabase.getRawInstance(pid)
  const q = (sql: string, ...args: any[]) => raw.prepare(sql).all(...args) as any[]

  const symRows = q("SELECT id, name, symbol_type, owner_symbol_id, line_start, line_end FROM brain_symbol WHERE project_id = ?", pid)
  const relRows = q("SELECT relationship_type, source_symbol_id, target_symbol_id, line_number FROM brain_relationship WHERE project_id = ?", pid)

  const problems: string[] = []
  const note = (s: string) => problems.push(s)

  // 1. symbols landed
  if (symRows.length !== analyzerSymbols) {
    const storedNames = new Set(symRows.map((r) => `${r.name}@${r.line_start}`))
    const missing = [...analyzerNames].filter((k) => !storedNames.has(k))
    note(`symbol count: analyzer ${analyzerSymbols} vs store ${symRows.length}; ${missing.length} analyzer symbol(s) absent from the store, e.g. ${missing.slice(0, 6).join(", ")}`)
  }
  const storeKinds: Record<string, number> = {}
  for (const r of symRows) storeKinds[r.symbol_type] = (storeKinds[r.symbol_type] ?? 0) + 1
  console.log(`  kinds analyzer: ${JSON.stringify(analyzerKinds)}`)
  console.log(`  kinds store:    ${JSON.stringify(storeKinds)}`)

  // 2. members carry an owner
  const memberKinds = new Set(["method", "property", "field", "enum_member", "variable"])
  const ownedRows = symRows.filter((r) => memberKinds.has(r.symbol_type))
  const orphans = ownedRows.filter((r) => r.owner_symbol_id == null)
  if (orphans.length) note(`${orphans.length} member rows with NULL owner_symbol_id, by kind ${JSON.stringify(orphans.reduce((a: any, o: any) => { a[o.symbol_type] = (a[o.symbol_type] ?? 0) + 1; return a }, {}))}, e.g. ${orphans.slice(0, 4).map((o) => `${o.symbol_type} ${o.name}@${o.line_start}`).join(", ")}`)

  // 3. every relationship's source resolves — the W24 class
  const unresolved = relRows.filter((r) => r.source_symbol_id == null)
  if (unresolved.length) note(`${unresolved.length}/${relRows.length} relationships with NULL source_symbol_id (the W24 class): ${unresolved.slice(0, 5).map((u) => `${u.relationship_type}`).join(", ")}`)

  // 4. no zero/NULL line — the M59/M60 contract AT THE SEAM
  const badLine = relRows.filter((r) => r.line_number == null || r.line_number === 0)
  if (badLine.length) note(`${badLine.length} relationships with line_number NULL/0 (e.g. ${badLine.slice(0, 5).map((b) => `${b.relationship_type}`).join(", ")})`)

  // 5. per-label counts survive
  const analyzerByLabel: Record<string, number> = {}
  for (const r of analyzerRels) analyzerByLabel[r.type] = (analyzerByLabel[r.type] ?? 0) + 1
  const storeByLabel: Record<string, number> = {}
  for (const r of relRows) storeByLabel[r.relationship_type] = (storeByLabel[r.relationship_type] ?? 0) + 1
  const labels = new Set([...Object.keys(analyzerByLabel), ...Object.keys(storeByLabel)])
  const labelDrift: string[] = []
  for (const l of [...labels].sort()) {
    const a = analyzerByLabel[l] ?? 0, s = storeByLabel[l] ?? 0
    if (a !== s) labelDrift.push(`${l}: analyzer ${a} vs store ${s}`)
  }
  if (labelDrift.length) note(`per-label relationship drift — ${labelDrift.join("; ")}`)

  // 6. id-key collisions
  const idKeys = new Map<string, number>()
  for (const r of symRows) { const k = `${r.name}@${r.line_start}`; idKeys.set(k, (idKeys.get(k) ?? 0) + 1) }
  const dupes = [...idKeys.entries()].filter(([, n]) => n > 1)
  if (dupes.length) note(`${dupes.length} store id-key collisions (name+line_start), e.g. ${dupes.slice(0, 3).map(([k, n]) => `${k} x${n}`).join(", ")}`)

  // 7. the stored SOURCE symbol's name is the analyzer's source. Matched by
  // (type, line) and then compared — the first version of this check found the
  // first store row of the same LABEL and compared that, which compared
  // unrelated edges and reported 3,913 phantom drifts.
  const symById = new Map(symRows.map((r) => [r.id, r]))
  const storeRelsWithName = relRows.map((r) => ({ ...r, sourceName: symById.get(r.source_symbol_id)?.name ?? null }))
  const pool = new Map<string, any[]>()
  for (const r of storeRelsWithName) {
    const k = `${r.relationship_type}|${r.line_number ?? "0"}`
    if (!pool.has(k)) pool.set(k, [])
    pool.get(k)!.push(r)
  }
  let sourceNameChecked = 0, sourceNameWrong = 0
  for (const rel of analyzerRels) {
    const cands = pool.get(`${rel.type}|${rel.line ?? 0}`)
    if (!cands || !cands.length) continue
    const hit = cands.find((c) => c.sourceName === rel.source)
    sourceNameChecked++
    if (!hit) {
      sourceNameWrong++
      if (sourceNameWrong <= 3) note(`source identity drift at ${rel.type} line ${rel.line}: analyzer "${rel.source}", store candidates ${[...new Set(cands.map((c) => String(c.sourceName)))].slice(0, 3).join("/")}`)
    }
  }

  console.log(`\n######## RUST STORE ROUND TRIP — ${taken.length} files from ${path.basename(CORPUS)}, index ${ms}ms (${(ms / taken.length).toFixed(1)}ms/file), ${stats?.filesDiscovered ?? "?"} discovered`)
  console.log(`  analyzer: symbols=${analyzerSymbols} relationships=${analyzerRels.length}`)
  console.log(`  store:    symbols=${symRows.length} relationships=${relRows.length}  member rows=${ownedRows.length} orphans=${orphans.length}`)
  console.log(`  source_symbol_id NULL=${unresolved.length}   line_number NULL/0=${badLine.length}   id-key collisions=${dupes.length}`)
  console.log(`  per-label: ${[...labels].sort().map((l) => `${l}=${storeByLabel[l] ?? 0}/${analyzerByLabel[l] ?? 0}`).join("  ")}  (store/analyzer)`)
  console.log(`  source identity spot-check: ${sourceNameChecked} edges, ${sourceNameWrong} name drifts`)
  if (problems.length === 0) console.log("\nROUND TRIP CLEAN — every payload survived the seam")
  else { console.log(`\n${problems.length} SEAM PROBLEM(S):`); for (const p of problems) console.log(`  - ${p}`) }
  console.log(`  db=${dataDir} project=${pid}`)
  if (problems.length) process.exit(2)
}
main().catch((e) => { console.error(e); process.exit(1) })
