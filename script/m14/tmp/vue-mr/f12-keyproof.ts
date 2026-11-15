// F12 design, measured: the symbol primary key is `${fileId}:${name}:${startLine}`
// (parallel-indexer.ts:2352/2414) and the insert is INSERT OR REPLACE. Owner is
// NOT in the key. So a component-owned Property at the same name and line as the
// interface's own member is a SILENT OVERWRITE. Measure it, do not reason about it.
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const TMP = "/tmp/opencode/vue-key-probe"

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))

  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(TMP, { recursive: true })

  const file = `${TMP}/Widget.vue`
  const src = `<template><p/></template>
<script setup lang="ts">
interface LocalProps { localA: string; localB: number }
const p = defineProps<LocalProps>()
</script>
`
  fs.writeFileSync(file, src)
  const projectId = getProjectId(TMP)
  const db = await BrainDatabase.getRawInstance(projectId)

  const parsed = await ASTEngine.parseFile(file, src)
  console.log("=== the analyzer's symbols, with the KEYS the store will use ===")
  for (const s of parsed.symbols ?? []) {
    console.log(`  ${String(s.kind).padEnd(9)} ${String(s.name).padEnd(10)} owner=${String(s.ownerName ?? "-").padEnd(10)} startLine=${s.range?.startLine}  ->  key "${s.name}:${s.range?.startLine}"`)
  }

  console.log("\n=== now INJECT a component-owned duplicate (what a naive Stage 1 would emit) ===")
  const dup = {
    ...parsed,
    symbols: [...(parsed.symbols ?? []), {
      name: "localA", kind: "property", range: { startLine: 3, startColumn: 3, endLine: 3, endColumn: 20, startIndex: 0, endIndex: 0 },
      scope: "Widget", ownerName: "Widget", ownerKind: "class", visibility: "public", metadata: { isProp: true },
    }],
  }
  const dbPath = BrainDatabase.getDbPath(projectId)
  // `conflictMode: "replace"` was removed (2026-10-16): declared by nobody, and re-indexing
  // already replaces a file's rows (script/m62/verify-reindex-replaces.ts measures it).
  await indexProjectParallel(projectId, TMP, { files: [file], skipDiscovery: true, logger: { log: () => {}, write: () => {} } } as any)
  let rows = db.prepare(`SELECT name, symbol_type, owner_symbol_id, line_start FROM brain_symbol WHERE file_id IN (SELECT id FROM brain_file WHERE path = ?)`).all(file) as any[]
  console.log(`  after indexing the CLEAN result: ${rows.length} symbol rows`)
  for (const x of rows) console.log(`    ${x.symbol_type.padEnd(9)} ${String(x.name).padEnd(10)} owner_id=${x.owner_symbol_id ?? "-"} line=${x.line_start}`)

  // Now index the DUPLICATED result through the same store path.
  const { storeResults } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  await storeResults(projectId, TMP, [{
    filePath: file, language: "vue", symbols: dup.symbols, relationships: dup.relationships ?? [],
    imports: dup.imports ?? [], exports: dup.exports ?? [], errors: [], metadata: dup.metadata ?? {},
  } as any] as any, {})
  rows = db.prepare(`SELECT name, symbol_type, owner_symbol_id, line_start FROM brain_symbol WHERE file_id IN (SELECT id FROM brain_file WHERE path = ?)`).all(file) as any[]
  console.log(`  after storing the result WITH A DUPLICATE: ${rows.length} symbol rows`)
  for (const x of rows) console.log(`    ${x.symbol_type.padEnd(9)} ${String(x.name).padEnd(10)} owner_id=${x.owner_symbol_id ?? "-"} line=${x.line_start}`)
  const dupes = rows.filter((x) => x.name === "localA")
  console.log(`\n  VERDICT: ${dupes.length === 1 ? "COLLIDES — the duplicate silently REPLACED the interface's member" : `no collision (${dupes.length} rows) — Stage 1's duplicate copy would be safe`}`)
  void dbPath
}
main()
