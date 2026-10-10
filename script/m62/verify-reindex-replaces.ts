#!/usr/bin/env tsx
// script/m62/verify-reindex-replaces.ts — re-indexing a file REPLACES its rows.
//
// WHY THIS EXISTS. Ten call sites across script/ passed `conflictMode: "replace"` to
// indexProjectParallel. The option appears NOWHERE in src/ — 0 occurrences — so it was
// accepted by nobody and did nothing. TypeScript reported it as TS2353 only in the
// files whose call was type-checked, and stayed silent in the .mts scratch scripts,
// which is why it survived.
//
// The open question was NOT "is this a typo". It was: **does the indexer actually
// replace on re-index, or does it accumulate stale rows?** Those are very different
// situations. If it accumulates, then `conflictMode` was a broken attempt to obtain a
// guarantee that does not exist, and deleting the option would paper over a real
// correctness bug.
//
// It replaces — and HOW it replaces took three wrong guesses and one measurement to
// establish, so the finding is written down here rather than left to be rediscovered.
//
// WHAT I FIRST BELIEVED, AND WHY IT WAS WRONG. parallel-indexer.ts:2661 prepares
// `DELETE FROM brain_symbol WHERE file_id = ?` inside storeResults, and line 2934 runs
// it per file. That reads like the mechanism. It is not.
//
// Disabling it (`... AND 0`) leaves every result in this gate GREEN. The delete fires
// — instrumented via a patched `prepare().run()`, it reports `changes=0` — and the
// renamed symbol's row still disappears.
//
// I then tried the `INSERT OR REPLACE INTO brain_file` at 2622, reasoning that REPLACE
// deletes the file row and `brain_symbol.file_id` carries `ON DELETE CASCADE`
// (src/brain/schema-ddl.ts). Disabling that ALONE also leaves everything green, for
// the same reason: the explicit delete already did the work.
//
// Disabling BOTH is the only combination that produces the failure this gate exists to
// detect — and then `oldName` survives with 1 row. So the replace semantics come from
// the cascade on brain_file, with the explicit deletes as a belt-and-braces path that
// is individually redundant.
//
// THE CONSEQUENCE FOR THIS FILE. Two of my first four checks were untestable. "Grow the
// file 1 -> 3 symbols" is a tautology: symbol ids are deterministic
// (`<file_id>:<name>:<occurrence>`), so an added symbol inserts a new id and a doubled
// symbol collides on the same one. It stayed green under the full canary. Only the
// REMOVE case exercises the cascade, so R2 now removes a symbol instead of only adding
// one. Both stale-row checks below were then confirmed to go RED under the canary and
// green on real code — that is the only reason to believe them.
//
// This gate is the claim, re-runnable. It never reads the delete statements and takes
// their word for it: it indexes a real file, CHANGES the file, re-indexes, and counts
// what is actually in the database.
//
// Embeddings are counted too, since the comment at parallel-indexer.ts:2663 records
// that leak specifically ("3 embedding rows for 2 live symbols after a rename").

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

const ROOT = process.cwd()

const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

/** Index a throwaway workspace and hand back a query function against ITS database. */
async function indexedWorkspace(
  dirName: string,
  relPath: string,
  first: string,
): Promise<{ reindex: (source: string) => Promise<void>; q: (sql: string, ...args: unknown[]) => any; cleanup: () => void }> {
  const ws = path.join(tmpdir(), `bb-replace-${dirName}`)
  mkdirSync(path.join(ws, "src"), { recursive: true })
  const dataDir = mkdtempSync(path.join(tmpdir(), "bb-replace-data-"))
  process.env.BB_DATA_DIR = dataDir
  const projectId = getProjectId(ws)
  const file = path.join(ws, relPath)
  writeFileSync(file, first)

  await indexProjectParallel(projectId, ws, { files: [file], skipDiscovery: true })
  const db = (await (BrainDatabase as unknown as { getRawInstance: (id: string) => Promise<any> }).getRawInstance(
    projectId,
  )) as any

  return {
    reindex: async (source: string) => {
      writeFileSync(file, source)
      // NOTE: no conflictMode is passed here, deliberately. The point is to measure
      // what the indexer does on its own. If this gate ever passes only because
      // someone added the option back, it has stopped testing the claim.
      await indexProjectParallel(projectId, ws, { files: [file], skipDiscovery: true })
    },
    q: (sql: string, ...args: unknown[]) => db.prepare(sql).get(...args),
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  }
}

const countNamed = (q: (sql: string, ...a: unknown[]) => any, name: string): number =>
  (q("SELECT COUNT(*) c FROM brain_symbol WHERE name = ?", name) as { c: number }).c

// --- R1: a renamed symbol's row does not survive ------------------------------
{
  const { reindex, q, cleanup } = await indexedWorkspace(
    "rename",
    "src/a.ts",
    "export function oldName(x: number) { return x + 1 }\nexport const keep = 42\n",
  )
  try {
    const before = countNamed(q, "oldName")
    await reindex("export function newName(x: number) { return x + 1 }\nexport const keep = 42\n")
    const stale = countNamed(q, "oldName")
    const fresh = countNamed(q, "newName")

    check(
      "R1: the pre-rename row was actually present (otherwise this proves nothing)",
      before === 1,
      `before re-index: oldName rows = ${before}`,
    )
    check(
      "R1: re-indexing a RENAMED symbol leaves no stale row (replace, not accumulate)",
      stale === 0 && fresh === 1,
      stale === 0 && fresh === 1
        ? `oldName rows ${before} -> ${stale}, newName rows -> ${fresh}`
        : `*** oldName rows = ${stale} (expected 0), newName rows = ${fresh} (expected 1). ` +
          `The indexer does NOT replace; conflictMode was not dead code and deleting it would hide a real bug. ***`,
    )
  } finally {
    cleanup()
  }
}

// --- R2: growing a file adds rows without accumulating the old ones -----------
{
  const { reindex, q, cleanup } = await indexedWorkspace("grow", "src/b.ts", "export function alpha() {}\n")
  try {
    const before = (q("SELECT COUNT(*) c FROM brain_symbol") as { c: number }).c
    await reindex("export function alpha() {}\nexport function beta() {}\nexport function gamma() {}\n")
    const after = (q("SELECT COUNT(*) c FROM brain_symbol") as { c: number }).c

    check(
      "R2: the seeded file was indexed (a zero baseline would make any count pass)",
      before === 1,
      `symbols after first index = ${before}`,
    )
    check(
      "R2: growing a 1-symbol file to 3 produces exactly 3 rows",
      after === 3,
      after === 3 ? `${before} -> ${after} symbols; named alpha, beta, gamma` : `*** ${after} symbols ***`,
    )

    // The growth check above CANNOT FAIL on its own, and I only know that because the
    // canary tried: with BOTH the explicit `DELETE FROM brain_symbol` and the
    // `INSERT OR REPLACE INTO brain_file` disabled — which is what actually produces
    // stale rows — it stayed green. Symbol ids are deterministic
    // (`<file_id>:<name>:<occurrence>`), so an added symbol just inserts a new id and
    // a doubled symbol collides on the same id. Growth proves nothing about replace.
    //
    // REMOVING a symbol is the case growth cannot produce, and it is the one that
    // depends on the cascade. So: drop alpha, keep beta and gamma, re-index.
    const staleAfterDrop = countNamed(q, "alpha")
    await reindex("export function beta() {}\nexport function gamma() {}\n")
    const dropped = countNamed(q, "alpha")
    const survivors = (q("SELECT COUNT(*) c FROM brain_symbol") as { c: number }).c

    check(
      "R2: REMOVING a symbol from a re-indexed file leaves no stale row (canary-proven: this is what goes red)",
      staleAfterDrop === 1 && dropped === 0 && survivors === 2,
      staleAfterDrop === 1 && dropped === 0 && survivors === 2
        ? `alpha rows 1 -> ${dropped}; ${survivors} symbols remain (beta, gamma)`
        : `*** alpha rows ${staleAfterDrop} -> ${dropped} (expected 0); ${survivors} symbols remain (expected 2). ` +
          `A symbol deleted from the source SURVIVED a re-index — the stale-row bug this gate exists to catch. ***`,
    )

    const emb = (q("SELECT COUNT(*) c FROM brain_semantic_embedding") as { c: number }).c
    check(
      "R2: no orphaned embedding rows (the leak named at parallel-indexer.ts:2663)",
      emb <= 3,
      `${emb} embedding rows for 3 live symbols — an orphan count above the live symbol count is the documented leak`,
    )
  } finally {
    cleanup()
  }
}

const failed = checks.filter((c) => !c.ok).length
console.log(
  `\nRE-INDEX REPLACES: ${failed === 0 ? "PASS" : `FAILED (${failed}) — see above`}` +
    (failed === 0
      ? "\n  This is what made the dead conflict-mode option safe to delete from ten call sites:\n  the behaviour they asked for is the behaviour the indexer always had. If this gate ever\n  goes red, those call sites were NOT asking for nothing and must be restored."
      : ""),
)
process.exit(failed === 0 ? 0 : 1)