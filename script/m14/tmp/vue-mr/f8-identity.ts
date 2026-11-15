// F8 design: two Class symbols for one component, with DISJOINT edge sets.
// The fix depends on what the STORE does with each, so measure that first:
// does the file-stem class have any rows at all, and do the delegated edges
// resolve to a symbol or fall through to `source_external`?
import * as fs from "fs"
import * as path from "path"
import { vue, rels, syms } from "./harness"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const TMP = "/tmp/opencode/vue-f8-store"

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))

  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(TMP, { recursive: true })
  const file = `${TMP}/WidgetFile.vue`
  const src = `<template>
  <MyChild :label="lab" />
</template>
<script>
import { ref } from 'vue'
import Child from './Child.vue'
export default {
  name: 'ActualName',
  props: { lab: String },
  methods: { go() { return 1 } },
}
</script>
`
  fs.writeFileSync(file, src)

  const r: any = await ASTEngine.parseFile(file, src)
  console.log("=== the analyzer's two Class symbols ===")
  for (const s of r.symbols ?? []) {
    if (s.kind === "class") console.log(`  ${s.name.padEnd(12)} md=${JSON.stringify(s.metadata)} L${s.range?.startLine}`)
  }
  console.log("\n=== which symbol do the edges source from? ===")
  const bySource = new Map<string, number>()
  for (const rel of r.relationships ?? []) bySource.set(String(rel.source), (bySource.get(String(rel.source)) ?? 0) + 1)
  for (const [s, n] of bySource) console.log(`  ${s.padEnd(12)} ${n} edge(s) source it`)
  console.log(`\n  edge SOURCES: ${JSON.stringify([...bySource.keys()])}`)
  console.log(`  class symbols: ${JSON.stringify((r.symbols ?? []).filter((s: any) => s.kind === "class").map((s: any) => s.name))}`)
  console.log(`  → is either class ever an edge TARGET? ${JSON.stringify((r.symbols ?? []).filter((s: any) => s.kind === "class").map((s: any) => `${s.name}:${(r.relationships ?? []).some((x: any) => x.target === s.name)}`))}`)

  console.log("\n=== the STORE: do the edges resolve to a symbol? ===")
  const projectId = getProjectId(TMP)
  const db = await BrainDatabase.getRawInstance(projectId)
  // `conflictMode: "replace"` was removed (2026-10-16): declared by nobody, and re-indexing
  // already replaces a file's rows (script/m62/verify-reindex-replaces.ts measures it).
  await indexProjectParallel(projectId, TMP, { files: [file], skipDiscovery: true, logger: { log: () => {}, write: () => {} } } as any)
  const syms2 = db.prepare(`SELECT s.name, s.symbol_type kind, s.line_start line FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE f.path LIKE '%.vue'`).all() as any[]
  for (const s of syms2) console.log(`  SYM ${String(s.kind).padEnd(9)} ${s.name} @${s.line}`)
  const rels2 = db.prepare(`SELECT relationship_type t, source_symbol_id si, source_external se, target_external te, line_number l FROM brain_relationship`).all() as any[]
  const nameOf = (id: string | null) => syms2.find((s) => id && id.endsWith(`:${(s as any).name}:${(s as any).line}`))?.name
  for (const e of rels2) {
    const src = e.si ? (nameOf(e.si) ?? `<unresolved ${e.si.split(":").slice(-2).join(":")}>`) : `EXTERNAL "${e.se}"`
    console.log(`  REL ${String(e.t).padEnd(11)} from ${src.padEnd(26)} -> ${String(e.te ?? "").padEnd(14)} @${e.l}`)
  }
  const unresolved = rels2.filter((e) => !e.si)
  console.log(`\n  edges with NO resolvable source symbol: ${unresolved.length} of ${rels2.length}`)
  if (unresolved.length) console.log(`  their source_external values: ${JSON.stringify([...new Set(unresolved.map((e) => e.se))])}`)
}
main()