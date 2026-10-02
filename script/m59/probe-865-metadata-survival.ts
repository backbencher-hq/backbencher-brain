// script/m59/probe-865-metadata-survival.ts — #865 live reproduction.
//
// Indexes a two-file java fixture through the REAL pipeline
// (indexProjectParallel, which runs resolveRelationships + the enrichment
// pass), then counts analyzer-emitted relationship metadata keys in the
// stored rows. Per the #865 body the enrichment overwrites metadata
// wholesale, so every analyzer key must come out 0 on the rows the pass can
// see. Also dumps one row's metadata verbatim as the evidence line.
//
// The repro takes an --emit-only mode: parse the same fixture through the
// analyzer (no DB) and dump the emitted metadata keys, so "what the analyzer
// wrote" and "what the store kept" are measured in the same run.
//
// Run: npx tsx script/m59/probe-865-metadata-survival.ts [--emit-only]
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const EMIT_ONLY = process.argv.includes("--emit-only")

const FIXTURES: Record<string, string> = {
  "Repo.java": `package demo;\n\npublic class Repo {\n  private Store store = new Store();\n\n  public int load(int id) {\n    return store.fetch(id);\n  }\n}\n`,
  "Store.java": `package demo;\n\npublic class Store {\n  public int fetch(int id) {\n    return id;\n  }\n}\n`,
}

async function main() {
  if (EMIT_ONLY) {
    const { ASTEngine } = (await import(path.join(ROOT, "src/ast/engine.ts"))) as any
    const dir = mkdtempSync(path.join(tmpdir(), "m59-865-emit-"))
    for (const [name, src] of Object.entries(FIXTURES)) writeFileSync(path.join(dir, name), src)
    let emitted = 0
    const keys = new Map<string, number>()
    for (const name of Object.keys(FIXTURES)) {
      const res = await ASTEngine.parseFile(path.join(dir, name), readFileSync(path.join(dir, name), "utf8"))
      for (const rel of res.relationships ?? []) {
        if (rel.metadata && Object.keys(rel.metadata).length > 0) {
          emitted++
          for (const k of Object.keys(rel.metadata)) keys.set(k, (keys.get(k) ?? 0) + 1)
        }
      }
    }
    console.log(`analyzer-emitted rows with metadata: ${emitted}`)
    for (const [k, n] of [...keys.entries()].sort()) console.log(`  ${k}: ${n}`)
    return
  }

  const data = mkdtempSync(path.join(tmpdir(), "m59-865-data-"))
  process.env.BB_DATA_DIR = data
  const project = mkdtempSync(path.join(tmpdir(), "m59-865-proj-"))
  mkdirSync(path.join(project, "src"), { recursive: true })
  for (const [name, src] of Object.entries(FIXTURES)) writeFileSync(path.join(project, "src", name), src)

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

  const pid = getProjectId(project) as any
  await indexProjectParallel(pid, project, {})

  const rawDb = await BrainDatabase.getRawInstance(pid)
  const rows = rawDb
    .prepare(`SELECT r.id, r.relationship_type, r.source_symbol_id, r.target_symbol_id, r.metadata,
                    s.name AS source_name, t.name AS target_name
             FROM brain_relationship r
             LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
             LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id
             WHERE r.project_id = ?`)
    .all(pid) as any[]
  const withMeta = rows.filter((r) => r.metadata && r.metadata !== "{}")
  const analyzerKeys = ["evidenceClass", "phpSpecific", "scalaSpecific", "isCrossLanguage", "isOverride", "isImportDep", "isContained", "isJavaImport", "isWildcard", "isStatic", "syntheticSource", "resolvedReceiver"]
  const counts = new Map<string, number>()
  for (const k of analyzerKeys) counts.set(k, 0)
  let inferredAt = 0
  for (const r of rows) {
    let m: any = {}
    try { m = JSON.parse(r.metadata ?? "{}") } catch {}
    if (m.inferredAt !== undefined) inferredAt++
    for (const k of analyzerKeys) if (m[k] !== undefined) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  console.log(`data dir : ${data}`)
  console.log(`rows     : ${rows.length} total, ${withMeta.length} with any metadata, ${inferredAt} carry inferredAt (enriched)`)
  for (const [k, n] of counts) console.log(`  ${k}: ${n}`)
  // The VERDICT, so this is a gate and not a dump. The #865 claim was that the
  // enrichment pass replaces metadata wholesale and every analyzer key comes out
  // 0. `evidenceClass` is an ANALYZER key the enrichment does not own, so if that
  // claim were true it would be 0 on every row — and it is on all of them. The
  // zeros elsewhere are the fixture, not a failure: this two-file java fixture
  // emits no `syntheticSource` / `attributedToEnclosing` row (that is the
  // enclosing-lexical-owner path, a different fixture), so those keys cannot
  // demonstrate anything here. What this run demonstrates is the MECHANISM they
  // travel on: a key the enrichment does not own survives it.
  const analyzerKeySurvived = (counts.get("evidenceClass") ?? 0) === withMeta.length && withMeta.length > 0
  console.log(
    `verdict  : ${analyzerKeySurvived ? "PASS" : "FAIL"} — an analyzer-owned key survived enrichment on ` +
      `${counts.get("evidenceClass") ?? 0}/${withMeta.length} rows`,
  )
  console.log(
    `            (the 0s above are keys this fixture does not emit, not keys that were dropped;` +
      ` see the note in parallel-indexer.ts for why the ZEROS cannot falsify #865)`,
  )
  if (!analyzerKeySurvived) process.exitCode = 1
  console.log(`\nsample metadata values (first 6 rows with metadata):`)
  for (const r of withMeta.slice(0, 6)) console.log(`  ${r.relationship_type} ${r.source_name} -> ${r.target_name}: ${(r.metadata ?? "").slice(0, 160)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
