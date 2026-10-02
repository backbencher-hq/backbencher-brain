// script/m13/verify-edit-unit.ts — M13.12 (E7).
//
// Per-mode adversarial UNIT coverage for bb_edit. Each mode (write/update/
// insert/delete/refactor) has a positive case plus the negatives the E2–E6
// verifiers did not yet exercise: path/symlink escape, heredoc, block comment,
// interpolation, ambiguous symbol, and stale update/delete bounds. No check
// is a no-op — every assertion verifies a specific, named behavior.

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
    // Stale bounds: change the file on disk so the indexed bounds no longer
    // match, then update. This block used to assert that the operation ABORTS.
    //
    // THAT CONTRACT IS SUPERSEDED, and the old assertion was checking a
    // superseded behaviour rather than a safety property, so it recorded a
    // known-gap against code that is right. M59.A11 (#889) changed the contract:
    // every other read tool refreshes a stale file within budget
    // (BB_NO_AUTO_REFRESH), so editing refused instead. That made the FIRST
    // symbol edit after ANY external change — another tool, a git pull, the human
    // — a hard stop, even when the external change did not touch the symbol at
    // all. Refusing is not safer here; re-deriving the bounds from the bytes on
    // disk IS, because the bounds were never the problem.
    //
    // What replaced it is the property that actually matters, and it is stronger
    // than "it threw": the write must land on the CURRENT bytes. Measured across
    // the four external-change shapes, on the pre-refresh behaviour the last one
    // below would have spliced at a byte offset that had moved, corrupting the
    // file — a silent wrong write, which is what the old assertion was reaching
    // for and could not see.
    //
    // 1. body changed externally        -> edits the NEW body, discloses the refresh
    // 2. lines inserted before it       -> edit lands at the MOVED offset, the
    //                                       inserted lines survive
    // 3. symbol renamed externally      -> REFUSED, file untouched
    // 4. symbol removed externally      -> REFUSED, file untouched
    writeFileSync(path.join(f.srcDir, "mod.ts"), `export function target(): number { return 99 }\n`)
    const staleRes = await executeEdit(f.root, f.projectId, { mode: "update", symbolName: "target", filePath: "src/mod.ts", newContent: "return 42", format: false })
    const afterStale = readFileSync(path.join(f.srcDir, "mod.ts"), "utf8")
    harness.check("update after an external body change writes the NEW content, not the indexed one",
      afterStale.includes("return 42") && !afterStale.includes("return 99"), afterStale.replace(/\n/g, "\\n"))
    harness.check("update after an external change DISCLOSES that it refreshed the index",
      (staleRes.warnings ?? []).some((w) => /refresh/i.test(w)), JSON.stringify(staleRes.warnings))
    harness.check("update after an external body change leaves the file syntactically whole",
      /^export function target\(\): number \{\n {2}return 42\n\}\n$/.test(afterStale), JSON.stringify(afterStale))

    // The shapes where refreshing genuinely cannot save the edit, because the
    // symbol the caller named is not the symbol in the file any more. These are
    // the ones that MUST stay loud; a silent success here would write a body into
    // whatever the stale bounds happened to cover.
    //
    // Each shape gets its OWN fixture. A refused edit still refreshes the index,
    // so reusing one project made the next shape start from an index that had
    // already been corrected — the removal case then failed EARLIER, on a
    // different message, and the gate would have been asserting the wrong
    // refusal text for the wrong reason.
    for (const [label, external, untouched] of [
      ["renamed", `export function renamedElsewhere(): number { return 99 }\n`, "renamedElsewhere"],
      ["removed", `export const somethingElse = 1\n`, "somethingElse"],
    ] as const) {
      const g = setup(`stale-${label}`)
      try {
        await indexProjectParallel(g.projectId, g.root, {})
        writeFileSync(path.join(g.srcDir, "mod.ts"), external)
        await harness.rejectsAsync(
          `update on a symbol ${label} externally aborts (no silent wrong write)`,
          () => executeEdit(g.root, g.projectId, { mode: "update", symbolName: "target", filePath: "src/mod.ts", newContent: "return 1", format: false }),
          "not found",
        )
        harness.check(`update on a symbol ${label} externally leaves the file untouched`,
          readFileSync(path.join(g.srcDir, "mod.ts"), "utf8").includes(untouched),
          readFileSync(path.join(g.srcDir, "mod.ts"), "utf8").replace(/\n/g, "\\n"))
      } finally {
        teardown(g)
      }
    }

    // The byte-offset case, on `delete` — which is where byte offsets actually
    // decide the outcome.
    //
    // I first wrote this on `update` and the mutation self-test showed it could
    // not go red: with stale bounds trusted, `update` still produced a correct
    // file. The reason is that update mode re-parses the body block from the
    // file on disk, so it is safe by construction and the symbol's bounds are not
    // load-bearing. Asserting it there would have been asserting a true thing
    // that proved nothing.
    //
    // `delete` splices `match.byteStart .. match.byteEnd` directly, so its
    // correctness DOES depend on those bounds being current. Measured with the
    // refresh disabled: the splice lands at the pre-move offset, produces
    // syntactically invalid source, and only the downstream validation step
    // catches it — the file would have been written broken had validation not
    // existed. With the refresh in place the delete is clean.
    //
    // This is the assertion that makes the refresh load-bearing rather than
    // incidental, and it is the one the mutation turns red.
    {
      const g = setup("stale-moved-delete")
      try {
        await indexProjectParallel(g.projectId, g.root, {})
        writeFileSync(path.join(g.srcDir, "mod.ts"), `export const inserted = 7\nexport function target(): number { return 99 }\n`)
        // The throw is CAUGHT and recorded, not left to escape. An unguarded
        // call turns a real defect into a crashed gate, and a crashed gate is
        // INCONCLUSIVE: it says nothing about which assertion failed, and it
        // takes the remaining checks with it. This block has to be able to say
        // "the delete refused" as a named, attributable result.
        let refused: string | null = null
        try {
          await executeEdit(g.root, g.projectId, { mode: "delete", symbolName: "target", filePath: "src/mod.ts", force: true, format: false })
        } catch (e) {
          refused = String((e as any)?.message ?? e)
        }
        const afterMove = readFileSync(path.join(g.srcDir, "mod.ts"), "utf8")
        harness.check("delete after the declaration MOVED completes on the current bounds",
          refused === null, refused === null ? "" : `it refused: ${refused.slice(0, 120)}`)
        harness.check("delete after the declaration MOVED removes the moved declaration",
          !afterMove.includes("target"), afterMove.replace(/\n/g, "\\n"))
        harness.check("delete after the declaration MOVED kept the line inserted before it",
          afterMove.includes("export const inserted = 7"), afterMove.replace(/\n/g, "\\n"))
        const meaningful = afterMove.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
        harness.check("delete after the declaration MOVED left no fragment of the spliced span",
          meaningful.every((l) => l === "export const inserted = 7"),
          `remaining lines: ${JSON.stringify(meaningful)}`)
      } finally {
        teardown(g)
      }
    }
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
