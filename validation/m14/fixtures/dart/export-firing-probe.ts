/**
 * Why `firing-check.ts` reported `exports: 0` on two files that HAVE an export.
 *
 * The probe that found it: `export-population-probe.ts`. It reproduced the
 * arbiter's own sample and found 2 of its 120 files carrying a `library_export`
 * node, so "exports is too rare to fire at n=120" was FALSE — and the
 * explanation had to be in the analyzer or in the pipeline.
 *
 * This file runs the PRODUCTION entry point (`parseFile`, src/ast/pool-worker.ts)
 * on each of those files and prints every relationship it returns, so the answer
 * is read off a real parse rather than inferred.
 *
 *   npx tsx validation/m14/fixtures/dart/export-firing-probe.ts
 */
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const TARGETS = [
  "flutter-packages/packages/video_player/video_player_avfoundation/lib/video_player_avfoundation.dart",
  "dart-sdk/pkg/front_end/testcases/dartdevc/unresolved_dart_library/vm_package/lib/export_vm_lib.dart",
]

for (const rel of TARGETS) {
  const abs = `${CR}/${rel}`
  const repo = rel.split("/")[0]
  const r: any = await parseFile(abs, `${CR}/${repo}`)
  const rels: any[] = r?.relationships ?? []
  const byType = new Map<string, number>()
  for (const x of rels) {
    const t = String(x.type ?? x.relationshipType ?? "?")
    byType.set(t, (byType.get(t) ?? 0) + 1)
  }
  console.log(`\n=== ${rel}`)
  console.log(`  bytes ${r?.bytes ?? "?"}  symbols ${(r?.symbols ?? []).length}  relationships ${rels.length}`)
  console.log(`  by type: ${JSON.stringify(Object.fromEntries([...byType].sort((a, b) => b[1] - a[1])))}`)
  console.log(`  parseErrors: ${JSON.stringify(r?.parseErrors ?? null)?.slice(0, 200)}`)
  const exports = rels.filter(x => String(x.type ?? x.relationshipType) === "exports")
  const imports = rels.filter(x => String(x.type ?? x.relationshipType) === "imports")
  console.log(`  exports rows (${exports.length}):`)
  for (const e of exports.slice(0, 8)) {
    console.log(`    ${e.source ?? e.from} -> ${e.target ?? e.to}  conf=${e.confidence}`)
  }
  console.log(`  imports rows (${imports.length}):`)
  for (const e of imports.slice(0, 8)) {
    console.log(`    ${e.source ?? e.from} -> ${e.target ?? e.to}  conf=${e.confidence}`)
  }
}