// F12 closure, the store round-trip. A new relationship that survives the
// analyzer but not the store is not a fix, and the symbol key's owner-blindness
// (measured earlier) means the component-owned half must be checked too.
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const TMP = "/tmp/opencode/vue-f12-store"

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))

  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(TMP, { recursive: true })
  const file = `${TMP}/Widget.vue`
  const src = `<script lang="ts">
const optionProps = { optionA: String, optionB: Number }
export default { name: 'Widget', props: optionProps }
</script>

<script setup lang="ts">
import type { RemoteProps } from './remote'
const bound = { boundA: String }
const b1 = defineProps(bound)
const r1 = defineProps<RemoteProps>()
</script>

<template><div/></template>
`
  fs.writeFileSync(file, src)
  fs.writeFileSync(`${TMP}/remote.ts`, `export interface RemoteProps { remoteA: string; remoteB: number }\n`)

  const projectId = getProjectId(TMP)
  const db = await BrainDatabase.getRawInstance(projectId)
  await indexProjectParallel(projectId, TMP, {
    // `conflictMode: "replace"` was removed (2026-10-16): it is declared by nobody,
    // and script/m62/verify-reindex-replaces.ts measured that re-indexing already
    // replaces a file's rows through the brain_file cascade.
    files: [file, `${TMP}/remote.ts`], skipDiscovery: true,
    logger: { log: () => {}, write: () => {} },
  } as any)

  console.log("=== SYMBOLS persisted for Widget.vue ===")
  const syms = db.prepare(`
    SELECT s.name, s.symbol_type AS kind, s.line_start AS line,
           (SELECT s2.name FROM brain_symbol s2 WHERE s2.id = s.owner_symbol_id) AS owner
    FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
    WHERE f.path LIKE '%.vue' ORDER BY s.line_start, s.name`).all() as any[]
  for (const s of syms) console.log(`  ${String(s.kind).padEnd(9)} ${String(s.name).padEnd(14)} owner=${String(s.owner ?? "-").padEnd(10)} line=${s.line}`)

  console.log("\n=== the CONTRACT edge persisted? ===")
  const rels = db.prepare(`
    SELECT r.relationship_type AS type, r.line_number AS line, r.metadata AS md,
           (SELECT s2.name FROM brain_symbol s2 WHERE s2.id = r.target_symbol_id) AS tgt,
           r.target_external AS ext
    FROM brain_relationship r JOIN brain_file f ON f.id = (
      SELECT file_id FROM brain_symbol WHERE id = r.source_symbol_id)
    WHERE f.path LIKE '%.vue' AND r.relationship_type = 'references'`).all() as any[]
  for (const r of rels) {
    let md: any = null
    try { md = JSON.parse(r.md ?? "null") } catch { md = r.md }
    console.log(`  references -> ${String(r.tgt ?? r.ext ?? "?").padEnd(14)} line=${r.line} isPropContract=${md?.isPropContract} contractModule=${md?.contractModule ?? "-"} unresolved=${md?.unresolved ?? false}`)
  }

  console.log("\n=== THE QUESTION THE FIX EXISTS TO ANSWER ===")
  const q = db.prepare(`
    SELECT s.name AS target, s.symbol_type AS kind
    FROM brain_relationship r
    JOIN brain_symbol s ON s.id = r.target_symbol_id
    WHERE r.relationship_type = 'references'
      AND r.source_symbol_id IN (
        SELECT id FROM brain_symbol WHERE name = 'Widget' AND symbol_type = 'class')
      AND r.metadata LIKE '%isPropContract%'`).all() as any[]
  console.log(`  "what props does Widget accept?" -> ${JSON.stringify(q)}`)
  console.log(`  reachable? ${q.length > 0 ? "YES — the contract is answerable from the component symbol" : "NO"}`)

  const lost = syms.length === 0
  console.log(`\n  no symbol loss: ${!lost} (${syms.length} rows)`)
  const propSyms = syms.filter((s) => ["optionA", "optionB", "boundA"].includes(s.name))
  console.log(`  the component-owned half persisted: ${JSON.stringify(propSyms.map((s) => s.name))} (${propSyms.length}/3)`)
}
main()
