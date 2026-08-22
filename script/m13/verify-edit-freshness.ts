// script/m13/verify-edit-freshness.ts — M13.10 (E5).
//
// Proves a cross-file refactor freshness-checks EVERY caller file/span before
// renaming anything, and that a stale/shrunk/missing caller aborts the whole
// operation (declaration file left untouched) instead of silently skipping the
// stale span and reporting success.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { executeEdit } from "../../src/intelligence/edit/edit-engine"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.10",
  code: "E5",
  tool: "bb_edit",
  title: "bb_edit: cross-file caller freshness (fail loud, no silent partial)",
  layers: ["unit", "integration"],
  decisions: {
    freshnessSource: "brain_file.file_hash (SHA-256 16-hex) vs on-disk content, checked via assertFreshFiles on every caller fileId before any rename",
    spanGuard: "each caller byte span is validated to lie inside the current file; a corrupt/out-of-bounds span throws instead of being silently clamped/skipped",
    atomicAbort: "planEdit resolves the full plan (freshness + spans) before executeEdit writes anything, so a stale caller aborts with zero writes",
  },
  limitations: [
    "allowStaleIndex only bypasses the declaration file's freshness gate; caller freshness is always enforced (safer, never a silent partial rename).",
    "Cross-file import specifiers are not renamed (imports live in brain_import, not calls/references) — unchanged from E2, tracked separately.",
  ],
})

const TARGET = `export function target(): number { return 1 }\n`
const CALLER = (fn: string) => `import { target } from "./target"\n${fn}\n`
const CALLER_BODY = `export function caller(): number { return target() }\n`

interface Fixture {
  root: string
  projectId: string
  targetPath: string
  callerPath: string
}
function setupFixture(label: string, callers: Array<{ file: string; body: string }> = [{ file: "src/caller.ts", body: CALLER_BODY }]): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), `bb-e5-${label}-`))
  mkdirSync(path.join(root, "src"), { recursive: true })
  const targetPath = path.join(root, "src", "target.ts")
  writeFileSync(targetPath, TARGET)
  const callerPath = path.join(root, callers[0].file)
  for (const c of callers) {
    const p = path.join(root, c.file)
    mkdirSync(path.dirname(p), { recursive: true })
    writeFileSync(p, CALLER(c.body))
  }
  const projectId = getProjectId(root)
  return { root, projectId, targetPath, callerPath }
}
function teardown(f: Fixture): void {
  rmSync(f.root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(f.projectId)), { recursive: true, force: true })
}

// ── POSITIVE CONTROL: fresh cross-file refactor renames both sides ──────────
{
  const f = setupFixture("fresh")
  try {
    await indexProjectParallel(f.projectId, f.root, {})
    const res = await executeEdit(f.root, f.projectId, { mode: "refactor", symbolName: "target", filePath: "src/target.ts", newName: "renamedTarget", format: false })
    harness.check("fresh caller: refactor succeeds", !res.dryRun && res.reindexed === true, JSON.stringify(res.changes.map((c) => c.path)))
    harness.check("fresh caller: declaration renamed", readFileSync(f.targetPath, "utf8").includes("renamedTarget"), readFileSync(f.targetPath, "utf8"))
    harness.check("fresh caller: call site renamed", readFileSync(f.callerPath, "utf8").includes("renamedTarget()"), readFileSync(f.callerPath, "utf8"))
  } finally {
    teardown(f)
  }
}

// ── REGRESSION: shrink caller file → abort, declaration untouched ───────────
{
  const f = setupFixture("shrink")
  try {
    await indexProjectParallel(f.projectId, f.root, {})
    // Shrink the caller: replace the calling body so the indexed byte span is now past EOF.
    writeFileSync(f.callerPath, `import { target } from "./target"\nexport function caller(): number { return 1 }\n`)
    const before = readFileSync(f.targetPath, "utf8")
    await harness.rejectsAsync(
      "shrunk caller file aborts (no silent skip)",
      () => executeEdit(f.root, f.projectId, { mode: "refactor", symbolName: "target", filePath: "src/target.ts", newName: "renamedTarget", format: false }),
      "not fresh",
    )
    harness.check("shrunk caller: declaration NOT renamed (no partial)", readFileSync(f.targetPath, "utf8") === before, readFileSync(f.targetPath, "utf8"))
  } finally {
    teardown(f)
  }
}

// ── Grown caller file (append) → abort ──────────────────────────────────────
{
  const f = setupFixture("grow")
  try {
    await indexProjectParallel(f.projectId, f.root, {})
    appendFileSync(f.callerPath, "\n// stale change\n")
    const before = readFileSync(f.targetPath, "utf8")
    await harness.rejectsAsync(
      "grown caller file aborts",
      () => executeEdit(f.root, f.projectId, { mode: "refactor", symbolName: "target", filePath: "src/target.ts", newName: "renamedTarget", format: false }),
      "not fresh",
    )
    harness.check("grown caller: declaration NOT renamed", readFileSync(f.targetPath, "utf8") === before, readFileSync(f.targetPath, "utf8"))
  } finally {
    teardown(f)
  }
}

// ── Missing caller file → abort (named as not fresh) ────────────────────────
{
  const f = setupFixture("missing")
  try {
    await indexProjectParallel(f.projectId, f.root, {})
    rmSync(f.callerPath, { force: true })
    const before = readFileSync(f.targetPath, "utf8")
    await harness.rejectsAsync(
      "missing caller file aborts",
      () => executeEdit(f.root, f.projectId, { mode: "refactor", symbolName: "target", filePath: "src/target.ts", newName: "renamedTarget", format: false }),
      "not fresh",
    )
    harness.check("missing caller: declaration NOT renamed", readFileSync(f.targetPath, "utf8") === before, readFileSync(f.targetPath, "utf8"))
  } finally {
    teardown(f)
  }
}

// ── Multiple callers, one stale → abort before ANY rename ───────────────────
{
  const f = setupFixture("multi", [
    { file: "src/caller1.ts", body: CALLER_BODY.replace("caller", "caller1") },
    { file: "src/caller2.ts", body: CALLER_BODY.replace("caller", "caller2") },
  ])
  try {
    await indexProjectParallel(f.projectId, f.root, {})
    // Stale caller2 only.
    appendFileSync(path.join(f.root, "src", "caller2.ts"), "\n// stale\n")
    const targetBefore = readFileSync(f.targetPath, "utf8")
    const caller1Before = readFileSync(path.join(f.root, "src", "caller1.ts"), "utf8")
    await harness.rejectsAsync(
      "one stale caller among several aborts the whole refactor",
      () => executeEdit(f.root, f.projectId, { mode: "refactor", symbolName: "target", filePath: "src/target.ts", newName: "renamedTarget", format: false }),
      "not fresh",
    )
    harness.check("multi: declaration NOT renamed", readFileSync(f.targetPath, "utf8") === targetBefore, readFileSync(f.targetPath, "utf8"))
    harness.check("multi: fresh caller1 NOT renamed (no partial across files)", readFileSync(path.join(f.root, "src", "caller1.ts"), "utf8") === caller1Before, readFileSync(path.join(f.root, "src", "caller1.ts"), "utf8"))
  } finally {
    teardown(f)
  }
}

// ── Defense-in-depth: corrupt caller span on a FRESH file → abort ───────────
{
  const f = setupFixture("span")
  try {
    await indexProjectParallel(f.projectId, f.root, {})
    // Keep the file hash matching (file untouched) but corrupt the caller's byte span.
    const raw = await BrainDatabase.getRawInstance(f.projectId)
    const callerFile = raw.prepare("SELECT id FROM brain_file WHERE path = ?").get(f.callerPath) as { id: string } | undefined
    if (!callerFile) throw new Error("caller file row not found")
    const callerSym = raw.prepare("SELECT id FROM brain_symbol WHERE file_id = ? AND name = 'caller'").get(callerFile.id) as { id: string } | undefined
    if (!callerSym) throw new Error("caller symbol not found")
    raw.prepare("UPDATE brain_symbol SET byte_start = 99999999, byte_end = 99999999 WHERE id = ?").run(callerSym.id)
    await harness.rejectsAsync(
      "out-of-bounds caller span aborts (never silently clamped/skipped)",
      () => executeEdit(f.root, f.projectId, { mode: "refactor", symbolName: "target", filePath: "src/target.ts", newName: "renamedTarget", format: false }),
      "caller span out of bounds",
    )
    harness.check("span: declaration NOT renamed", readFileSync(f.targetPath, "utf8") === TARGET, readFileSync(f.targetPath, "utf8"))
  } finally {
    teardown(f)
  }
}

harness.emit()
