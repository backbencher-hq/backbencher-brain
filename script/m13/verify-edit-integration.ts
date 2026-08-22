// script/m13/verify-edit-integration.ts — M13.13 (E8).
//
// Proves the edit → reindex → freshness loop is consistent across languages:
// after a successful edit the index reflects the new content (fresh), and after
// a failed edit the index is left consistent (unchanged / still fresh to the
// untouched files). Exercises TS + Python + Java (three language families).

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { executeEdit } from "../../src/intelligence/edit/edit-engine"
import { ASTEngine } from "../../src/ast/engine"
import { checkFileFreshness } from "../../src/brain/freshness"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.13",
  code: "E8",
  tool: "bb_edit",
  title: "bb_edit: integration tests (edit + index + freshness + reindex)",
  layers: ["integration"],
  decisions: {
    loop: "executeEdit writes -> validateFile -> reindexFilesParallel; a successful edit must leave the index fresh and reflecting the new name",
    failConsistency: "a failed edit (validation error) rolls back files; the index is not reindexed, so the pre-edit index stays consistent with the rolled-back files",
  },
  limitations: [
    "The loop is verified at the brain_file/brain_symbol freshness level; full embedding regeneration is async and verified separately in M10.",
  ],
})

interface Fixture { root: string; projectId: string; srcDir: string }
function setup(label: string, files: Array<[string, string]>): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), `bb-e8-${label}-`))
  const srcDir = path.join(root, "src")
  mkdirSync(srcDir, { recursive: true })
  for (const [name, content] of files) writeFileSync(path.join(srcDir, name), content)
  return { root, projectId: getProjectId(root), srcDir }
}
function teardown(f: Fixture): void {
  rmSync(f.root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(f.projectId)), { recursive: true, force: true })
}
async function fileIdFor(f: Fixture, relPath: string): Promise<string> {
  const raw = await BrainDatabase.getRawInstance(f.projectId)
  const abs = path.join(f.srcDir, path.basename(relPath))
  const row = raw.prepare("SELECT id FROM brain_file WHERE path = ?").get(abs) as { id: string } | undefined
  return row?.id ?? ""
}

// ── TS: successful edit leaves the index fresh and reflecting the new name ─
{
  const f = setup("ts", [["mod.ts", "export function target(): number { return 1 }\nexport function caller(): number { return target() }\n"]])
  try {
    await indexProjectParallel(f.projectId, f.root, {})
    const fid = await fileIdFor(f, "mod.ts")
    const raw0 = await BrainDatabase.getRawInstance(f.projectId)
    harness.check("TS: pre-edit file is fresh", checkFileFreshness(raw0, fid)?.status === "fresh")
    await executeEdit(f.root, f.projectId, { mode: "refactor", symbolName: "target", filePath: "src/mod.ts", newName: "renamedTarget", format: false })
    const raw = await BrainDatabase.getRawInstance(f.projectId)
    harness.check("TS: post-edit file is fresh (reindexed)", checkFileFreshness(raw, fid)?.status === "fresh")
    const oldFound = await ASTEngine.findSymbol(f.projectId, "target", "src/mod.ts")
    const newFound = await ASTEngine.findSymbol(f.projectId, "renamedTarget", "src/mod.ts")
    harness.check("TS: old symbol no longer resolves post-rename", (oldFound?.matches?.length ?? 0) === 0, `matches=${oldFound?.matches?.length ?? 0}`)
    harness.check("TS: new symbol resolves post-rename", (newFound?.matches?.length ?? 0) === 1, `matches=${newFound?.matches?.length ?? 0}`)
    harness.check("TS: on-disk content has the new name", readFileSync(path.join(f.srcDir, "mod.ts"), "utf8").includes("renamedTarget"))
  } finally {
    teardown(f)
  }
}

// ── Python: same loop for an indentation-body language ─────────────────────
{
  const f = setup("py", [["mod.py", "def target():\n    return 1\n\ndef caller():\n    return target()\n"]])
  try {
    await indexProjectParallel(f.projectId, f.root, {})
    const fid = await fileIdFor(f, "mod.py")
    await executeEdit(f.root, f.projectId, { mode: "refactor", symbolName: "target", filePath: "src/mod.py", newName: "renamed_target", format: false })
    const raw = await BrainDatabase.getRawInstance(f.projectId)
    harness.check("Python: post-edit file is fresh (reindexed)", checkFileFreshness(raw, fid)?.status === "fresh")
    const newFound = await ASTEngine.findSymbol(f.projectId, "renamed_target", "src/mod.py")
    harness.check("Python: new symbol resolves post-rename", (newFound?.matches?.length ?? 0) === 1, `matches=${newFound?.matches?.length ?? 0}`)
    harness.check("Python: on-disk content has the new name", readFileSync(path.join(f.srcDir, "mod.py"), "utf8").includes("renamed_target"))
  } finally {
    teardown(f)
  }
}

// ── Java: same loop for a brace-body, class-nested language ────────────────
{
  const f = setup("java", [["Mod.java", "class Mod { int target() { return 1; } int caller() { return target(); } }\n"]])
  try {
    await indexProjectParallel(f.projectId, f.root, {})
    const fid = await fileIdFor(f, "Mod.java")
    await executeEdit(f.root, f.projectId, { mode: "refactor", symbolName: "target", filePath: "src/Mod.java", newName: "renamedTarget", format: false })
    const raw = await BrainDatabase.getRawInstance(f.projectId)
    harness.check("Java: post-edit file is fresh (reindexed)", checkFileFreshness(raw, fid)?.status === "fresh")
    const newFound = await ASTEngine.findSymbol(f.projectId, "renamedTarget", "src/Mod.java")
    harness.check("Java: new symbol resolves post-rename", (newFound?.matches?.length ?? 0) === 1, `matches=${newFound?.matches?.length ?? 0}`)
    harness.check("Java: on-disk content has the new name", readFileSync(path.join(f.srcDir, "Mod.java"), "utf8").includes("renamedTarget"))
  } finally {
    teardown(f)
  }
}

// ── Failed edit: index stays consistent with the rolled-back files ──────────
{
  // Python rename to the keyword `class` yields invalid syntax -> validateFile
  // throws AFTER the write loop, so rollback fires and the index is never reindexed.
  const f = setup("fail", [["mod.py", "def target():\n    return 1\n\ndef caller():\n    return target()\n"]])
  try {
    await indexProjectParallel(f.projectId, f.root, {})
    const fid = await fileIdFor(f, "mod.py")
    const before = readFileSync(path.join(f.srcDir, "mod.py"), "utf8")
    await harness.rejectsAsync(
      "failed edit: keyword rename aborts (no half-reindex)",
      () => executeEdit(f.root, f.projectId, { mode: "refactor", symbolName: "target", filePath: "src/mod.py", newName: "class", format: false }),
      "validation failed",
    )
    harness.check("failed edit: file content restored to pre-edit", readFileSync(path.join(f.srcDir, "mod.py"), "utf8") === before, "content mismatch")
    const raw = await BrainDatabase.getRawInstance(f.projectId)
    harness.check("failed edit: index still fresh to the unchanged file", checkFileFreshness(raw, fid)?.status === "fresh")
    const oldFound = await ASTEngine.findSymbol(f.projectId, "target", "src/mod.py")
    harness.check("failed edit: original symbol still resolves (no half-reindex)", (oldFound?.matches?.length ?? 0) >= 1, `matches=${oldFound?.matches?.length ?? 0}`)
  } finally {
    teardown(f)
  }
}

// ── Insert loop: insert then reindex leaves the file fresh ─────────────────
{
  const f = setup("insert", [["mod.ts", "export function target(): number {\n  return 1\n}\n"]])
  try {
    await indexProjectParallel(f.projectId, f.root, {})
    const fid = await fileIdFor(f, "mod.ts")
    await executeEdit(f.root, f.projectId, { mode: "insert", targetSymbolName: "target", filePath: "src/mod.ts", position: "inside-bottom", newContent: "const added = true", format: false })
    const raw = await BrainDatabase.getRawInstance(f.projectId)
    harness.check("insert: post-edit file is fresh (reindexed)", checkFileFreshness(raw, fid)?.status === "fresh")
    harness.check("insert: on-disk content has the inserted line", readFileSync(path.join(f.srcDir, "mod.ts"), "utf8").includes("const added = true"))
  } finally {
    teardown(f)
  }
}

harness.emit()
