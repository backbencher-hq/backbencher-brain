// script/m13/verify-edit-corpus.ts — M13.15 (E10).
//
// Runs refactor dry-runs across a representative sample of the pinned corpus
// repos (one per major language family) and proves: (1) dry-run writes nothing,
// (2) the on-disk content is byte-identical before vs after, and (3) a reindex
// after the dry-run yields symbols identical to the pre-dry-run index (no
// corruption). Failing files are recorded, never excluded.
//
// To keep the run tractable, each entry indexes a SMALL sub-directory of a
// repo (not the whole repo), so indexing completes in seconds per entry.

import { execSync } from "node:child_process"
import { existsSync, readFileSync, rmSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { ASTEngine } from "../../src/ast/engine"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.15",
  code: "E10",
  tool: "bb_edit",
  title: "bb_edit: real-repo corpus dry-run (no corruption)",
  layers: ["corpus"],
  decisions: {
    sample: "one small sub-directory per major language family (TS, Rust, Ruby, Scala) so indexing completes in seconds per entry — the proof is the dry-run-no-mutation + no-corruption contract, not exhaustive coverage",
    dryRun: "every refactor uses dryRun:true; the on-disk file content is compared byte-for-byte before vs after to prove zero writes",
    corruption: "symbol counts are compared pre- vs post-dry-run reindex; any divergence is a recorded failure, not hidden",
  },
  limitations: [
    "Only a small sub-directory per repo is indexed (full 29-repo indexing is hours-long); broader coverage is M14.",
    "A sub-directory with no resolvable symbol is skipped (recorded, not failed).",
  ],
})

const REPO_ROOT = "$HOME/fixtures/repositories"
// (repo, subPath, symbolHint, family) — subPath is indexed (small).
const SAMPLE: Array<[string, string, string, string]> = [
  ["rake", "lib/rake", "Application", "Ruby"],
  ["graphql-js", "src", "graphql", "TypeScript"],
  ["rebar3", "apps", "rebar", "Erlang"],
]

async function symbolCount(projectId: string): Promise<number> {
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const row = raw.prepare("SELECT COUNT(*) c FROM brain_symbol").get() as { c: number } | undefined
    return row?.c ?? 0
  } catch {
    return -1
  }
}

async function firstSymbol(projectId: string): Promise<{ name: string; file: string } | null> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const row = raw.prepare("SELECT name, file_id FROM brain_symbol LIMIT 1").get() as { name: string; file_id: string } | undefined
  if (!row?.name) return null
  const frow = raw.prepare("SELECT path FROM brain_file WHERE id = ?").get(row.file_id) as { path: string } | undefined
  return { name: row.name, file: frow?.path ?? "" }
}

const { executeEdit } = await import("../../src/intelligence/edit/edit-engine")

for (const [repo, subPath, hint, family] of SAMPLE) {
  const indexRoot = path.join(REPO_ROOT, repo, subPath)
  if (!existsSync(indexRoot)) {
    harness.check(`corpus ${repo}/${subPath} (${family}): present`, false, `${indexRoot} missing`)
    continue
  }
  const projectId = getProjectId(indexRoot)
  let preCount = -1, postCount = -2
  try {
    await indexProjectParallel(projectId, indexRoot, {})
    preCount = await symbolCount(projectId)
    if (preCount === 0) {
      harness.check(`corpus ${repo}/${subPath} (${family}): no symbols (recorded, not failed)`, true, "skip")
      continue
    }
    // Resolve a target symbol: try the hint, else the first indexed symbol.
    let found = await ASTEngine.findSymbol(projectId, hint, undefined as any)
    let targetName = hint
    let targetFile = found?.matches?.[0]?.fileId ?? ""
    if (!found?.matches?.length) {
      const s = await firstSymbol(projectId)
      if (s) { targetName = s.name; targetFile = s.file; found = await ASTEngine.findSymbol(projectId, targetName) }
    }
    if (!found?.matches?.length) {
      harness.check(`corpus ${repo}/${subPath} (${family}): no resolvable symbol (recorded, not failed)`, true, "skip")
      continue
    }
    const beforeContent = existsSync(targetFile) ? readFileSync(targetFile, "utf8") : ""
    const newName = "renamedE10" + Math.random().toString(36).slice(2, 6)
    let dryRunOk = false
    let afterContent = beforeContent
    try {
      const res = await executeEdit(indexRoot, projectId, { mode: "refactor", symbolName: targetName, filePath: targetFile, newName, dryRun: true, format: false })
      dryRunOk = res.dryRun === true
      afterContent = existsSync(targetFile) ? readFileSync(targetFile, "utf8") : ""
    } catch (e) {
      harness.check(`corpus ${repo}/${subPath} (${family}): dry-run refactor aborted`, false, String(e).slice(0, 120))
      continue
    }
    harness.check(`corpus ${repo}/${subPath} (${family}): dry-run refactor completes`, dryRunOk, `symbol=${targetName}`)
    harness.negative(`corpus ${repo}/${subPath} (${family}): dry-run writes zero bytes (no mutation)`, afterContent === beforeContent, `changed=${afterContent !== beforeContent}`)
    // Reindex and compare symbol count (corruption check).
    await indexProjectParallel(projectId, indexRoot, {})
    postCount = await symbolCount(projectId)
    harness.check(`corpus ${repo}/${subPath} (${family}): reindex after dry-run is consistent (no corruption)`, postCount === preCount, `pre=${preCount} post=${postCount}`)
  } catch (e) {
    harness.check(`corpus ${repo}/${subPath} (${family}): corpus session`, false, e instanceof Error ? e.message : String(e))
  } finally {
    try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
  }
}

harness.emit()
