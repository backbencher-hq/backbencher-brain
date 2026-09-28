// script/m59/measure-865-corpus-counts.ts — #865 acceptance item 3.
//
// Indexes a real corpus fresh (default: cats-effect, the index #865 was found
// on) through the production pipeline and reports the post-fix counts:
//   - per analyzer key: rows carrying it (the issue's "before" was 0 for all)
//   - enriched rows (metadata carries inferredAt)
//   - NULL-source rows — the pass's JOIN skips them by construction, so they
//     must carry NO inferredAt: "the 74 unenriched rows unchanged" from the
//     issue, checked rather than assumed.
//
// Run: bun script/m59/measure-865-corpus-counts.ts [--repo=/path/to/repo]
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const REPO_ARG = process.argv.find((a) => a.startsWith("--repo="))?.slice("--repo=".length)
const REPO = REPO_ARG ?? "$HOME/fixtures/repositories/cats-effect"

const ANALYZER_KEYS = [
  "evidenceClass", "phpSpecific", "scalaSpecific", "resolvedReceiver", "isCrossLanguage",
  "syntheticSource", "isOverride", "isContained", "isImportDep", "isJavaImport",
  "relationshipType", "javaCallExpression", "argumentCount", "declaredOn", "isNew",
]

function parseMeta(m: string | null | undefined): Record<string, any> {
  try {
    const v = JSON.parse(m ?? "{}")
    return v !== null && typeof v === "object" ? v : {}
  } catch {
    return {}
  }
}

async function main() {
  const data = mkdtempSync(path.join(tmpdir(), "m59-865-corpus-"))
  process.env.BB_DATA_DIR = data
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

  const t0 = Date.now()
  const pid = getProjectId(REPO) as any
  const stats = await indexProjectParallel(pid, REPO, {})
  const indexSec = ((Date.now() - t0) / 1000).toFixed(1)

  const db = await BrainDatabase.getRawInstance(pid)
  const rows = db
    .prepare(`SELECT id, source_symbol_id, metadata FROM brain_relationship WHERE project_id = ?`)
    .all(pid) as any[]
  const enriched = rows.filter((r) => parseMeta(r.metadata).inferredAt !== undefined)
  const nullSource = rows.filter((r) => !r.source_symbol_id)
  const nullSourceEnriched = nullSource.filter((r) => parseMeta(r.metadata).inferredAt !== undefined)

  const counts = new Map<string, number>()
  for (const k of ANALYZER_KEYS) counts.set(k, 0)
  let analyzerKeyRows = 0
  for (const r of rows) {
    const m = parseMeta(r.metadata)
    let has = false
    for (const k of ANALYZER_KEYS) if (m[k] !== undefined) { counts.set(k, (counts.get(k) ?? 0) + 1); has = true }
    if (has) analyzerKeyRows++
  }

  console.log(`repo          : ${REPO}`)
  console.log(`data dir      : ${data}`)
  console.log(`index         : ${JSON.stringify(stats?.files ?? stats ?? "")} in ${indexSec}s`)
  console.log(`relationships : ${rows.length}`)
  console.log(`enriched (inferredAt): ${enriched.length}`)
  console.log(`NULL-source rows     : ${nullSource.length}, of which enriched: ${nullSourceEnriched.length} (must be 0 — the pass's JOIN skips them, unchanged from the issue's 74)`)
  console.log(`rows carrying >=1 analyzer key: ${analyzerKeyRows} (pre-fix, on the fresh cats-effect index of #865: 7 — all NULL-source)`)
  console.log(`per analyzer key:`)
  for (const [k, n] of counts) console.log(`  ${k}: ${n}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
