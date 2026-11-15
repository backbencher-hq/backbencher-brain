// F12 fix design, the collision question: if the component ALSO owns a Property
// named localA (pointing at the interface key), what does the STORE do with the
// interface's own `localA`? If it collapses them, Stage 1 destroys information.
import * as fs from "fs"
import * as path from "path"
import { vue, names } from "./harness"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const TMP = "/tmp/opencode/vue-store-probe"

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(TMP, { recursive: true })

  // 1. the ANALYZER level: two symbols, same name, different owners
  const src = `<template><p/></template>
<script setup lang="ts">
interface LocalProps { localA: string; localB: number }
const p = defineProps<LocalProps>()
</script>`
  const r = await vue(src, `${TMP}/Widget.vue`)
  console.log("=== F12 design, level 1: the analyzer's own output ===")
  for (const s of r.symbols ?? []) {
    console.log(`  ${String(s.kind).padEnd(9)} ${String(s.name).padEnd(8)} owner=${s.ownerName ?? "-"} L${s.range?.startLine} md=${JSON.stringify(s.metadata)}`)
  }

  // 2. the STORE level: does persisting two same-named properties lose one?
  console.log("\n=== F12 design, level 2: what the STORE keeps ===")
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const projectId = getProjectId(TMP)
  const db = await BrainDatabase.getRawInstance(projectId)
  const file = `${TMP}/Widget.vue`
  fs.writeFileSync(file, src)
  const parsed = await ASTEngine.parseFile(file, src)
  const { persistParseResult } = await import(path.join(ROOT, "src/ast/index.ts")).catch(() => ({ persistParseResult: null as any }))
  console.log(`  persistParseResult export: ${typeof persistParseResult}`)
  if (persistParseResult) {
    // `conflictMode` was removed (2026-10-16): declared by nobody. Re-indexing already
    // replaces a file's rows (script/m62/verify-reindex-replaces.ts measures it).
    await persistParseResult(projectId, file, parsed as any, {} as any)
    const rows = db.prepare(`SELECT s.name, s.symbol_kind AS kind, s.owner_name AS owner, f.path AS path FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE f.path LIKE '%.vue'`).all() as any[]
    console.log(`  brain_symbol rows for .vue: ${rows.length}`)
    for (const x of rows) console.log(`    ${x.kind.padEnd(9)} ${String(x.name).padEnd(10)} owner=${x.owner ?? "-"}`)
  } else {
    console.log("  (no direct persist export; using indexProjectParallel instead)")
    const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
    await indexProjectParallel(projectId, TMP, { files: [file], skipDiscovery: true, logger: { log: () => {}, write: () => {} } } as any)
    const rows = db.prepare(`SELECT s.name, s.symbol_kind AS kind, s.owner_name AS owner FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE f.path LIKE '%.vue'`).all() as any[]
    console.log(`  brain_symbol rows for .vue: ${rows.length}`)
    for (const x of rows) console.log(`    ${x.kind.padEnd(9)} ${String(x.name).padEnd(10)} owner=${x.owner ?? "-"}`)
  }

  // 3. the schema itself: is (name, kind, owner) the key?
  const schema = db.prepare(`SELECT sql FROM sqlite_master WHERE name='brain_symbol'`).get() as any
  console.log(`\n=== brain_symbol schema ===\n${(schema?.sql ?? "").split("\n").filter((l: string) => /UNIQUE|PRIMARY|owner|name|kind/i.test(l)).join("\n")}`)
  const idx = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='brain_symbol'`).all() as any[]
  console.log("  indexes:")
  for (const i of idx) console.log(`    ${i.name}: ${(i.sql ?? "").replace(/\s+/g, " ")}`)
}
main()
