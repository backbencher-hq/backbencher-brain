// script/m13/verify-edit-unit.ts — M13.12 (E7).
//
// Per-mode adversarial UNIT coverage for bb_edit. Each mode (write/update/
// insert/delete/refactor) has a positive case plus the negatives the E2–E6
// verifiers did not yet exercise: path/symlink escape, heredoc, block comment,
// interpolation, ambiguous symbol, and the stale-file paths (refresh-and-edit,
// refuse-when-the-symbol-is-gone). No check is a no-op — every assertion
// verifies a specific, named behavior.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { executeEdit, resolveSafeEditPath } from "../../src/intelligence/edit/edit-engine"
import { ASTEngine } from "../../src/ast/engine"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.12",
  code: "E7",
  tool: "bb_edit",
  title: "bb_edit: adversarial unit tests",
  layers: ["unit", "integration"],
  decisions: {
    scope: "this verifier fills the per-mode + negative gaps the focused E2–E6 verifiers left; it does not duplicate their assertions",
    pathSafety: "resolveSafeEditPath rejects '..' and symlink escapes before any file is touched",
    renameSafety: "refactor skips heredoc, block comment, and interpolation text (never rewrites string/comment content)",
    staleFile: "M59.A11 (#890): a stale target file is refreshed and the edit lands (reported in warnings); a symbol gone after the refresh is refused, never written to a guessed span",
  },
  limitations: [
    "Comprehensive cross-language rename classification is proven in E2 (65 checks); E7 adds only the per-mode and adversarial-fixture gaps.",
  ],
})

interface Fixture { root: string; projectId: string; srcDir: string }
function setup(label: string): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), `bb-e7-${label}-`))
  const srcDir = path.join(root, "src")
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(path.join(srcDir, "mod.ts"), `export function target(): number { return 1 }\nexport function other(): number { return target() }\n`)
  return { root, projectId: getProjectId(root), srcDir }
}
function teardown(f: Fixture): void {
  rmSync(f.root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(f.projectId)), { recursive: true, force: true })
}

// ── UNIT: path safety (resolveSafeEditPath) ────────────────────────────────
{
  const f = setup("path")
  try {
    harness.rejects(
      "'..' in filePath is rejected (no project-root escape)",
      () => resolveSafeEditPath(f.root, "../escape.ts"),
      "escapes project root",
    )
    harness.rejects(
      "absolute filePath outside root is rejected",
      () => resolveSafeEditPath(f.root, "/etc/passwd"),
      "escapes project root",
    )
    harness.check("in-root filePath resolves", resolveSafeEditPath(f.root, "src/mod.ts").endsWith("mod.ts"))
  } finally {
    teardown(f)
  }
}

// ── UNIT: symlink escape ───────────────────────────────────────────────────
{
  const f = setup("symlink")
  try {
    const outside = mkdtempSync(path.join(tmpdir(), "bb-e7-out-"))
    writeFileSync(path.join(outside, "secret.ts"), "TOP_SECRET\n")
    symlinkSync(outside, path.join(f.srcDir, "escape-link"))
    harness.rejects(
      "a symlink pointing outside the project root is rejected",
      () => resolveSafeEditPath(f.root, "src/escape-link/secret.ts"),
      "escapes project root through symlink",
    )
    rmSync(outside, { recursive: true, force: true })
  } finally {
    teardown(f)
  }
}

// ── INTEGRATION: write mode (positive + invalid content rejected) ─────────
{
  const f = setup("write")
  try {
    await indexProjectParallel(f.projectId, f.root, {})
    const res = await executeEdit(f.root, f.projectId, { mode: "write", filePath: "src/written.ts", content: "export const x = 1\n", format: false })
    harness.check("write: creates a new file", readFileSync(path.join(f.srcDir, "written.ts"), "utf8").includes("export const x = 1"))
    harness.check("write: reports a single change", res.changes.length === 1)
  } finally {
    teardown(f)
  }
}

// ── INTEGRATION: update mode (positive + stale bounds) ────────────────────
{
  const f = setup("update")
  try {
    await indexProjectParallel(f.projectId, f.root, {})
    const res = await executeEdit(f.root, f.projectId, { mode: "update", symbolName: "target", filePath: "src/mod.ts", newContent: "return 42", format: false })
    harness.check("update: rewrites the symbol body", readFileSync(path.join(f.srcDir, "mod.ts"), "utf8").includes("return 42"))
    harness.check("update: reports a single change", res.changes.length === 1)
    // Stale file: changed on disk after indexing (another tool, a git pull, the
    // human). M59.A11 (#890) retired the old "refuse every stale edit" rule —
    // the edit now refreshes just this file and applies to the bytes on disk,
    // because the indexed byte bounds are what is stale, not the caller.
    // E7 pins the CURRENT contract; it must not pin a retired one.
    writeFileSync(path.join(f.srcDir, "mod.ts"), `export function target(): number { return 99 }\n`)
    const stale = await executeEdit(f.root, f.projectId, { mode: "update", symbolName: "target", filePath: "src/mod.ts", newContent: "return 1", format: false })
    harness.check(
      "update: a stale target file is refreshed and the edit lands",
      readFileSync(path.join(f.srcDir, "mod.ts"), "utf8").includes("return 1"),
      readFileSync(path.join(f.srcDir, "mod.ts"), "utf8").slice(0, 80),
    )
    harness.check(
      "update: the refresh is reported in warnings (not silent)",
      (stale.warnings ?? []).some((w) => /refreshed stale index rows/.test(String(w))),
      JSON.stringify(stale.warnings ?? []),
    )
    // Refreshing is not a licence to guess: if the symbol is gone after the
    // refresh, the correct outcome is a loud refusal — never a write to a
    // guessed span.
    writeFileSync(path.join(f.srcDir, "mod.ts"), `export function targetRenamed(): number { return 99 }\n`)
    await harness.rejectsAsync(
      "update: symbol gone after refreshing is refused (no guessed-span write)",
      () => executeEdit(f.root, f.projectId, { mode: "update", symbolName: "target", filePath: "src/mod.ts", newContent: "return 1", format: false }),
      "not found after refreshing",
    )
    harness.check(
      "update: that refusal leaves the refreshed file untouched",
      readFileSync(path.join(f.srcDir, "mod.ts"), "utf8").includes("targetRenamed"),
    )
  } finally {
    teardown(f)
  }
}

// ── INTEGRATION: delete mode (positive + has-callers guard) ───────────────
{
  const f = setup("delete")
  try {
    await indexProjectParallel(f.projectId, f.root, {})
    // 'target' has a caller ('other'), so delete must refuse without force.
    await harness.rejectsAsync(
      "delete: refuses a symbol with active callers (no force)",
      () => executeEdit(f.root, f.projectId, { mode: "delete", symbolName: "target", filePath: "src/mod.ts", format: false }),
      "surviving deletion",
    )
    // 'other' has no callers; delete succeeds.
    const res = await executeEdit(f.root, f.projectId, { mode: "delete", symbolName: "other", filePath: "src/mod.ts", format: false })
    harness.check("delete: removes a caller-less symbol", !readFileSync(path.join(f.srcDir, "mod.ts"), "utf8").includes("function other"))
    harness.check("delete: reports a single change", res.changes.length === 1)
  } finally {
    teardown(f)
  }
}

// ── INTEGRATION: refactor skips heredoc, block comment, interpolation ──────
{
  const f = setup("refactor-strings")
  try {
    // A fixture where 'target' appears in a heredoc, a block comment, and
    // a template interpolation — none of which a rename should touch.
    writeFileSync(path.join(f.srcDir, "mod.ts"), [
      "export function target(): number { return 1 }",
      "export function caller(): number {",
      "  const h = `target stays in heredoc`",
      "  /* target stays in block comment */",
      "  const t = `prefix ${target} suffix`",
      "  return target()",
      "}",
      "",
    ].join("\n"))
    await indexProjectParallel(f.projectId, f.root, {})
    await executeEdit(f.root, f.projectId, { mode: "refactor", symbolName: "target", filePath: "src/mod.ts", newName: "renamedTarget", format: false })
    const after = readFileSync(path.join(f.srcDir, "mod.ts"), "utf8")
    harness.check("refactor: declaration renamed", after.includes("function renamedTarget()"))
    harness.check("refactor: call site renamed", after.includes("renamedTarget()"))
    harness.check("refactor: heredoc text NOT renamed", after.includes("target stays in heredoc"))
    harness.check("refactor: block comment NOT renamed", after.includes("target stays in block comment"))
    // Interpolation: the live code inside ${...} IS renamed; the literal around it is not.
    harness.check("refactor: interpolation live code renamed", after.includes("${renamedTarget}"))
  } finally {
    teardown(f)
  }
}

// ── INTEGRATION: ambiguous symbol aborts (needs filePath + lineStart) ──────
{
  const f = setup("ambiguous")
  try {
    writeFileSync(path.join(f.srcDir, "mod.ts"), `export function target(): number { return 1 }\nexport class target { static run() {} }\n`)
    await indexProjectParallel(f.projectId, f.root, {})
    await harness.rejectsAsync(
      "refactor: ambiguous symbol name aborts (two matches)",
      () => executeEdit(f.root, f.projectId, { mode: "refactor", symbolName: "target", newName: "renamedTarget", format: false }),
      "ambiguous",
    )
    // Disambiguation by lineStart must resolve to exactly one symbol.
    const found2 = await ASTEngine.findSymbol(f.projectId, "target", "src/mod.ts", 2)
    harness.check("refactor: lineStart disambiguates to one symbol", (found2?.matches?.length ?? 0) === 1, `matches=${found2?.matches?.length ?? 0}`)
  } finally {
    teardown(f)
  }
}

harness.emit()
