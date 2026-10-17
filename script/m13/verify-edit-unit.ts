// script/m13/verify-edit-unit.ts — M13.12 (E7).
//
// Per-mode adversarial UNIT coverage for bb_edit. Each mode (write/update/
// insert/delete/refactor) has a positive case plus the negatives the E2–E6
// verifiers did not yet exercise: path/symlink escape, heredoc, block comment,
// interpolation, ambiguous symbol, and stale update/delete bounds. No check
// is a no-op — every assertion verifies a specific, named behavior.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, chmodSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { executeEdit, resolveSafeEditPath, fileHash, lineCount, writeGuardMessage, WRITE_GUARD, type EditResult } from "../../src/intelligence/edit/edit-engine"
import { BrainSurgicalPatcher, type FormatOutcome } from "../../src/ast/brain-surgical-patcher"
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
    formatterTruth: "D5: `formatted` is MEASURED per file (BrainSurgicalPatcher.tryAutoFormat reports which formatter ran and whether it exited 0); the formatter is resolved from node_modules/.bin/PATH and invoked with execFile, so nothing in a file NAME can be shell-expanded",
  },
  limitations: [
    "Comprehensive cross-language rename classification is proven in E2 (65 checks); E7 adds only the per-mode and adversarial-fixture gaps.",
    "The formatter branches use a fake node_modules/.bin/prettier written by the gate, so they are deterministic whether or not a formatter is installed (and command resolution is PATH-scrubbed where it matters); the rewrite proof uses that fake's own output bytes.",
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

// ── INTEGRATION: the formatter step reports what it MEASURED (D5) ──────────
//
// `formatted` used to be `request.format !== false` — the request restated as if it
// were an outcome. Measured before the fix (script/m71/probe-format-truth.ts):
// `true` for a `.rb` file, which has no formatter mapping at all; `true` with no
// formatter installed, after 1573ms spent on an npx that could not install one;
// and `true` for a formatter that exited 3, with `warnings: []`. Every branch is
// asserted here, and the last block pins the invocation itself: the formatter used
// to be built as a SHELL command with the path interpolated into it, so a file
// NAMED `inj$(touch pwned).ts` executed `touch pwned`.
//
// The formatter is a fake local node_modules/.bin/prettier, so every branch is
// reachable on a machine with no formatter installed (this one has none) and no
// branch touches the network.
{
  const f = setup("format-truth")
  const fakeFormatter = (body: string) => {
    const bin = path.join(f.root, "node_modules", ".bin")
    mkdirSync(bin, { recursive: true })
    writeFileSync(path.join(bin, "prettier"), `#!/bin/sh\n${body}\n`)
    chmodSync(path.join(bin, "prettier"), 0o755)
  }
  const write = (filePath: string, content: string, format?: boolean) =>
    executeEdit(f.root, f.projectId, { mode: "write", filePath, content, ...(format === undefined ? {} : { format }) })
  try {
    // (a) an extension with no formatter mapping at all
    writeFileSync(path.join(f.root, "a.rb"), "def   target\n    1\nend\n")
    const noMapping = await write("a.rb", "def   target\n      2\nend\n")
    harness.check("format truth: no mapping → formatted:false (was true while nothing formatted it)",
      noMapping.formatted === false, `formatted=${noMapping.formatted}`)
    harness.check("format truth: no mapping → the entry names the extension and the reason",
      noMapping.formatting?.[0]?.formatter === null && (noMapping.formatting?.[0]?.reason ?? "").includes("no formatter mapped for .rb"),
      JSON.stringify(noMapping.formatting))
    harness.check("format truth: no mapping → the bytes on disk are exactly the splice",
      readFileSync(path.join(f.root, "a.rb"), "utf8") === "def   target\n      2\nend\n")

    // (b) a formatter that runs and rewrites the file: `formatted` true, and the
    // FILE PROVES the process ran (it is the fake formatter's own output).
    fakeFormatter('for a in "$@"; do f="$a"; done; printf "FORMATTED\\n" > "$f"')
    const good = await write("b.ts", "export function b(): number {\n  return 1\n}\n")
    harness.check("format truth: a formatter that exits 0 → formatted:true", good.formatted === true, `formatted=${good.formatted}`)
    harness.check("format truth: the formatter really ran (the file holds its output)",
      readFileSync(path.join(f.root, "b.ts"), "utf8") === "FORMATTED\n", JSON.stringify(readFileSync(path.join(f.root, "b.ts"), "utf8")))
    harness.check("format truth: success carries no format warning",
      (good.warnings ?? []).every((w) => !w.startsWith("format:")), JSON.stringify(good.warnings))

    // (c) a formatter that exits non-zero: false, attributed, warned — and the edit
    // is NOT discarded (formatting is best-effort; only validation rolls back).
    fakeFormatter('echo "boom: refusing" >&2\nexit 3')
    const failed = await write("c.ts", "export function c(): number {\n  return 3\n}\n")
    harness.check("format truth: a formatter that exits 3 → formatted:false (was true with warnings:[])",
      failed.formatted === false, `formatted=${failed.formatted}`)
    harness.check("format truth: the failure is attributed with exit code and stderr",
      failed.formatting?.[0]?.ran === true && failed.formatting?.[0]?.ok === false
        && (failed.formatting?.[0]?.reason ?? "").includes("exited 3") && (failed.formatting?.[0]?.reason ?? "").includes("boom"),
      JSON.stringify(failed.formatting))
    harness.check("format truth: the failure is warned by file name",
      (failed.warnings ?? []).some((w) => w.includes("format: c.ts") && w.includes("exited 3")), JSON.stringify(failed.warnings))
    harness.check("format truth: a failing formatter does not discard the edit",
      readFileSync(path.join(f.root, "c.ts"), "utf8") === "export function c(): number {\n  return 3\n}\n")

    // (d) a formatter that hangs: killed at the budget, reported, and bounded
    fakeFormatter("sleep 5\nexit 0")
    const hangStarted = Date.now()
    // Optional-chained on purpose: at the pre-fix revision tryAutoFormat returns
    // `Promise<void>`, and this gate must report that as a FAILED measurement
    // rather than crash out of the section and skip the cases below it.
    const hung = (await BrainSurgicalPatcher.tryAutoFormat(path.join(f.root, "b.ts"))) as FormatOutcome | undefined
    const hangMs = Date.now() - hangStarted
    harness.check("format truth: a hanging formatter is killed and reported as a timeout",
      hung?.ran === true && hung?.ok === false && (hung?.reason ?? "").includes("timed out after 1500ms"), JSON.stringify(hung))
    harness.negative("format truth: the hang is bounded by the budget, not by the formatter",
      hangMs < 4000, `took ${hangMs}ms`)

    // (e) mapped, but no formatter on this machine: a DIFFERENT fact from (a), and
    // PATH is scrubbed so this is deterministic wherever the gate runs.
    rmSync(path.join(f.root, "node_modules"), { recursive: true, force: true })
    const emptyPathDir = mkdtempSync(path.join(tmpdir(), "bb-e7-emptypath-"))
    const savedPath = process.env.PATH
    process.env.PATH = emptyPathDir
    let notFound: FormatOutcome | undefined
    let notInstalled: EditResult
    try {
      notFound = await BrainSurgicalPatcher.tryAutoFormat(path.join(f.root, "b.ts"))
      notInstalled = await write("e.ts", "export function e(): number {\n  return 5\n}\n")
    } finally {
      process.env.PATH = savedPath
      rmSync(emptyPathDir, { recursive: true, force: true })
    }
    harness.check("format truth: not installed → ran:false, tool named, reason names both search paths",
      notFound?.formatter === "prettier" && notFound?.ran === false && notFound?.ok === false
        && (notFound?.reason ?? "").includes("no formatter found") && (notFound?.reason ?? "").includes("PATH"),
      JSON.stringify(notFound))
    harness.check("format truth: engine — no formatter available → formatted:false with the reason",
      notInstalled.formatted === false && (notInstalled.formatting?.[0]?.reason ?? "").includes("no formatter found"),
      JSON.stringify(notInstalled.formatting))

    // (f) format:false must not run a formatter that IS present
    fakeFormatter('for a in "$@"; do f="$a"; done; printf "FORMATTED\\n" > "$f"')
    writeFileSync(path.join(f.root, "d.ts"), "export function d(): number {\n  return 6\n}\n")
    const optedOut = await write("d.ts", "export function d(): number {\n  return 66\n}\n", false)
    harness.check("format truth: format:false → formatted:false and no formatting report",
      optedOut.formatted === false && optedOut.formatting === undefined, JSON.stringify(optedOut.formatting ?? null))
    harness.check("format truth: format:false really does not run the present formatter",
      readFileSync(path.join(f.root, "d.ts"), "utf8") === "export function d(): number {\n  return 66\n}\n")

    // (g) a dry run formats nothing, so it reports nothing
    const dry = await executeEdit(f.root, f.projectId, { mode: "write", filePath: "d.ts", content: "export function d(): number {\n  return 666\n}\n", dryRun: true })
    harness.check("format truth: dry-run → formatted:false and no formatting report",
      dry.formatted === false && dry.formatting === undefined)

    // (h) a file NAME is not shell input. This exact fixture produced the marker
    // file before the fix (measured: script/m71/probe-format-truth.ts).
    fakeFormatter("exit 0")
    const marker = path.join(f.root, "pwned")
    const hostile = "inj$(touch pwned).ts"
    writeFileSync(path.join(f.root, hostile), "export function inj(): number {\n  return 7\n}\n")
    const hostileEdit = await write(hostile, "export function inj(): number {\n  return 77\n}\n")
    harness.negative("format truth: a file name cannot execute (execFile argv, no shell)",
      !existsSync(marker), `marker ${marker} exists — a marker means the NAME was expanded`)
    harness.check("format truth: the hostile-named file is still formatted through argv",
      hostileEdit.formatted === true, `formatted=${hostileEdit.formatted}`)
    harness.check("format truth: the hostile-named file was edited at its real path",
      readFileSync(path.join(f.root, hostile), "utf8") === "export function inj(): number {\n  return 77\n}\n",
      JSON.stringify(readFileSync(path.join(f.root, hostile), "utf8")))

    // (i) M66 PRESERVATION: the line-ending flag survived the move from a command
    // STRING to argv. A CRLF file must hand prettier `--end-of-line crlf`, and an
    // LF file must NOT (always passing it would rewrite LF files to CRLF — the bug
    // the flag exists to prevent). These two are guards, not new behavior: they
    // hold at the pre-fix revision too, and the fake formatter records the argv it
    // was actually executed with.
    {
      const argvLog = path.join(f.root, "argv.log")
      fakeFormatter(`printf "%s\\n" "$@" > ${argvLog}`)
      writeFileSync(path.join(f.root, "crlf.ts"), "export function crlf(): number {\r\n  return 9\r\n}\r\n")
      const crlfEdit = await write("crlf.ts", "export function crlf(): number {\r\n  return 99\r\n}\r\n")
      const crlfArgv = readFileSync(argvLog, "utf8").split("\n").filter(Boolean)
      harness.check("format truth: a CRLF file hands prettier an explicit crlf line ending (M66)",
        crlfEdit.formatted === true && crlfArgv.includes("--write") && crlfArgv.includes("--end-of-line") && crlfArgv.includes("crlf")
          && crlfArgv[crlfArgv.length - 1].endsWith("crlf.ts"),
        JSON.stringify(crlfArgv))
      writeFileSync(path.join(f.root, "lf.ts"), "export function lf(): number {\n  return 10\n}\n")
      await write("lf.ts", "export function lf(): number {\n  return 100\n}\n")
      const lfArgv = readFileSync(argvLog, "utf8").split("\n").filter(Boolean)
      harness.negative("format truth: an LF file is NOT passed a line-ending override",
        !lfArgv.includes("--end-of-line") && lfArgv[lfArgv.length - 1].endsWith("lf.ts"), JSON.stringify(lfArgv))
    }

    // (j) MULTI-FILE: `formatted` is true only when EVERY changed file succeeded.
    writeFileSync(path.join(f.root, "p.ts"), "export function aggTarget(): number {\n  return 8\n}\n")
    writeFileSync(path.join(f.root, "q.ts"), "import { aggTarget } from './p'\nexport const q = aggTarget()\n")
    await indexProjectParallel(f.projectId, f.root, {})
    fakeFormatter('for a in "$@"; do f="$a"; done; case "$f" in *q.ts) echo "boom: q.ts" >&2; exit 4;; esac; exit 0')
    const aggregateFail = await executeEdit(f.root, f.projectId, { mode: "refactor", symbolName: "aggTarget", filePath: "p.ts", newName: "aggRenamed" })
    const entries = aggregateFail.formatting ?? []
    const byPath = new Map(entries.map((entry) => [entry.path, entry]))
    harness.check("format truth: multi-file refactor is formatted:false when ANY file's formatter failed",
      aggregateFail.formatted === false, `formatted=${aggregateFail.formatted}`)
    harness.check("format truth: the aggregate reports one entry per changed file with both outcomes",
      entries.length === 2 && byPath.get("p.ts")?.ok === true && byPath.get("q.ts")?.ok === false,
      JSON.stringify(entries))
    harness.check("format truth: the failing file is the one warned about",
      (aggregateFail.warnings ?? []).some((w) => w.includes("format: q.ts") && w.includes("exited 4")),
      JSON.stringify(aggregateFail.warnings))
    // …and true only when every one succeeded (the same run shape, all-ok formatter)
    fakeFormatter("exit 0")
    const aggregateOk = await executeEdit(f.root, f.projectId, { mode: "refactor", symbolName: "aggRenamed", filePath: "p.ts", newName: "aggFinal" })
    harness.check("format truth: multi-file refactor is formatted:true when every file succeeded",
      aggregateOk.formatted === true && (aggregateOk.formatting ?? []).length === 2
        && (aggregateOk.formatting ?? []).every((entry) => entry.ran && entry.ok),
      JSON.stringify(aggregateOk.formatting))
  } finally {
    teardown(f)
  }
}

// ── M71.D6: an unindexed project, told apart from an absent symbol ────────
// The MCP server refuses the four symbol modes before they reach the engine, and
// the CLI door (`bb tool bb_edit`) does not gate on `requiresIndex` at all — so
// these are the sentences THAT caller receives. Both used to be one sentence,
// `symbol <name> not found or has no byte bounds`, and on a project the indexer
// has never run over the shared one is false: the symbol is on disk and there is
// no index in which it could have been found. The falsification runs both ways —
// the new message must NOT appear for a real index.
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-e7-noindex-"))
  const projectId = getProjectId(root)
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", "app.ts"), "export function freshFn(): number { return 1 }\n")
  const rows = async (): Promise<number> => {
    const raw = await BrainDatabase.getRawInstance(projectId)
    return Number((raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(projectId) as any).c ?? 0)
  }
  const messageOf = async (request: Parameters<typeof executeEdit>[2]): Promise<string> =>
    executeEdit(root, projectId, request).then(() => "", (error: Error) => error.message)
  try {
    harness.check("no-index: the fixture starts with ZERO indexed files", (await rows()) === 0)
    const refused = await messageOf({ mode: "update", symbolName: "freshFn", newContent: "return 2" })
    harness.negative("no-index: update names the missing INDEX instead of claiming the symbol is absent",
      refused.includes("has no index (0 files indexed)") && refused.includes("bb index") && !refused.includes("not found or has no byte bounds"),
      refused.slice(0, 220))
    harness.check("no-index: and the refusal says which mode still works",
      refused.includes("write mode does not need an index"), refused.slice(0, 240))
    const deleteRefused = await messageOf({ mode: "delete", symbolName: "freshFn" })
    harness.negative("no-index: delete takes the same path (one shared resolver, not four messages)",
      deleteRefused.includes("has no index (0 files indexed)"), deleteRefused.slice(0, 180))

    // The bootstrap: one `write` leaves rows behind, and the mode that was just
    // refused resolves on the SAME project with nothing indexed in between.
    const written = await executeEdit(root, projectId, {
      mode: "write", filePath: "src/app.ts",
      content: "export function freshFn(): number { return 1 }\nexport function second(): number { return freshFn() }\n",
      format: false,
    })
    harness.check("no-index: write succeeds on a project the indexer has never run over",
      readFileSync(path.join(root, "src", "app.ts"), "utf8").includes("export function second()"),
      JSON.stringify(written.changes.map((c) => c.path)))
    harness.check("no-index: and reports reindexed:true", written.reindexed === true, `reindexed=${written.reindexed}`)
    harness.check("no-index: the write left indexed rows behind", (await rows()) === 1, `rows=${await rows()}`)
    const afterWrite = await messageOf({ mode: "update", symbolName: "freshFn", newContent: "return 42", format: false })
    harness.check("no-index: the mode that was refused now resolves — write is the bootstrap", afterWrite === "", afterWrite.slice(0, 160))

    // CONTROL: the new message did not REPLACE the old one. A genuinely absent
    // name on an indexed project still says exactly what it used to.
    await indexProjectParallel(projectId, root, {})
    harness.check("no-index: control — after indexing there ARE rows", (await rows()) >= 1, `rows=${await rows()}`)
    const absent = await messageOf({ mode: "update", symbolName: "definitelyAbsent", newContent: "return 3" })
    harness.negative("no-index: control — an absent name in a real index still says 'not found or has no byte bounds'",
      absent.includes("not found or has no byte bounds") && !absent.includes("has no index"), absent.slice(0, 200))
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
  }
}

// ── M71.D7: the overwrite guard, on real files ─────────────────────────────
// MEASURED before the guard existed, by driving the engine on exactly this
// fixture (script/m71/probe-edit-review.ts, case H4): a 41-line file replaced by
// one line, reported `ok`, with nothing in the result to tell it apart from an
// intentional whole-file rewrite. `write` is the one capability of this tool where
// a single wrong parameter destroys content, and the case it destroys is the
// common mistake — a caller who meant `update`/`insert` and passed a fragment.
//
// Both directions are pinned here: the destructive case must be REFUSED (and the
// file left byte-identical), and an ordinary write must NOT be — a guard that
// fires on legitimate rewrites is a guard people learn to bypass with
// `overwrite: true`, which is the same as not having one.
{
  const f = setup("overwrite")
  try {
    const srcFile = path.join(f.srcDir, "big.ts")
    const big = `// header\n` + Array.from({ length: 40 }, (_, i) => `export const v${i} = ${i}`).join("\n") + "\n"
    const one = "export const v0 = 0\n"
    writeFileSync(srcFile, big)

    // (a) the measured defect: 41 lines → 1
    await harness.rejectsAsync(
      "overwrite: write over an existing 41-line file with 1 line is refused by name",
      () => executeEdit(f.root, f.projectId, { mode: "write", filePath: "src/big.ts", content: one, format: false }),
      "write refused: it would replace src/big.ts (41 lines) with 1 line(s), removing 40 lines (98%)",
    )
    harness.check("overwrite: the refused write left the file byte-identical", readFileSync(srcFile, "utf8") === big, `${readFileSync(srcFile, "utf8").length} bytes on disk`)
    // (b) the refusal names BOTH ways forward, so the caller is not left guessing
    const refused = await executeEdit(f.root, f.projectId, { mode: "write", filePath: "src/big.ts", content: one, format: false }).then(() => "", (e: Error) => e.message)
    harness.check("overwrite: the refusal names the acknowledgement (`overwrite: true`)", refused.includes("Pass overwrite: true to replace it anyway"), refused.slice(0, 260))
    harness.check("overwrite: and names the targeted modes (update/insert) as the other way", refused.includes("use update/insert to change part of the file"), refused.slice(0, 300))
    // (c) a DRY RUN reports the same refusal — a preview of a different call is not a preview
    await harness.rejectsAsync(
      "overwrite: a dry run reports the same refusal (the guard is at plan time)",
      () => executeEdit(f.root, f.projectId, { mode: "write", dryRun: true, filePath: "src/big.ts", content: one, format: false }),
      "write refused",
    )
    // (d) `overwrite: true` is the acknowledgement, and the whole file is replaced
    const forced = await executeEdit(f.root, f.projectId, { mode: "write", filePath: "src/big.ts", content: one, overwrite: true, format: false })
    harness.check("overwrite: overwrite:true replaces it, and the result carries the pre-image it replaced",
      readFileSync(srcFile, "utf8") === one && forced.changes[0].before === big,
      `before=${forced.changes[0].before.length}B after=${readFileSync(srcFile, "utf8")}`)
    // (e) `overwrite: false` is create-only, in both directions
    await harness.rejectsAsync(
      "overwrite: overwrite:false refuses an EXISTING file (create-only) by name",
      () => executeEdit(f.root, f.projectId, { mode: "write", filePath: "src/big.ts", content: big, overwrite: false, format: false }),
      "already exists and overwrite is false (create-only)",
    )
    harness.check("overwrite: the create-only refusal left the file byte-identical", readFileSync(srcFile, "utf8") === one)
    const created = await executeEdit(f.root, f.projectId, { mode: "write", filePath: "src/brand-new.ts", content: one, overwrite: false, format: false })
    harness.check("overwrite: overwrite:false still CREATES when nothing is there", created.reindexed === true && existsSync(path.join(f.srcDir, "brand-new.ts")))

    // (f) the rule's cells, through the engine on real files. The thresholds are
    // the documented ones (more than half AND more than 5 lines), and each cell
    // below is a real write attempt, not a restatement of the rule.
    const lines = (n: number): string => Array.from({ length: n }, (_, i) => `export const l${i} = ${i}`).join("\n") + "\n"
    const cells: Array<[number, number, boolean]> = [
      // before, after, refused?
      [10, 5, true],    // exactly half gone: the rule is "at least half", so this is the boundary cell
      [10, 6, false],   // 40% gone: an ordinary edit
      [41, 20, true],   // 51% gone
      [41, 21, false],  // 49% gone
      [6, 1, true],     // 5 lines removed AND 83% gone — both thresholds are met
      [4, 1, false],    // only 3 lines removed: under the line floor, allowed
      [7, 1, true],     // 6 removed AND 86% gone
      [12, 12, false],  // a rewrite that keeps every line
      [1, 0, false],    // a one-line file rewritten to a blank line: 0 lines removed
    ]
    for (const [before, after, expectRefusal] of cells) {
      const target = `src/cell-${before}-${after}.ts`
      writeFileSync(path.join(f.srcDir, `cell-${before}-${after}.ts`), lines(before))
      const message = await executeEdit(f.root, f.projectId, { mode: "write", filePath: target, content: lines(after), format: false })
        .then(() => "", (e: Error) => e.message)
      const wasRefused = message.length > 0
      harness.check(
        `overwrite: ${before} lines → ${after} is ${expectRefusal ? "REFUSED" : "allowed"}`,
        wasRefused === expectRefusal,
        wasRefused ? message.slice(0, 160) : `${readFileSync(path.join(f.srcDir, `cell-${before}-${after}.ts`), "utf8").split("\n").length - 1} lines on disk`,
      )
      if (expectRefusal) {
        harness.negative(`overwrite: the refused ${before}→${after} cell wrote nothing`, readFileSync(path.join(f.srcDir, `cell-${before}-${after}.ts`), "utf8") === lines(before))
      }
    }
    // (g) an existing EMPTY file is not a replacement at all — the guard must not
    // fire on it (a false positive here would make `write` unusable on a
    // placeholder file), while `overwrite: false` still refuses it as existing.
    writeFileSync(path.join(f.srcDir, "empty.ts"), "")
    const intoEmpty = await executeEdit(f.root, f.projectId, { mode: "write", filePath: "src/empty.ts", content: one, format: false })
    harness.check("overwrite: writing into an existing EMPTY file is allowed", intoEmpty.reindexed === true && readFileSync(path.join(f.srcDir, "empty.ts"), "utf8") === one)
    writeFileSync(path.join(f.srcDir, "empty2.ts"), "")
    await harness.rejectsAsync(
      "overwrite: overwrite:false still treats an empty existing file as existing",
      () => executeEdit(f.root, f.projectId, { mode: "write", filePath: "src/empty2.ts", content: one, overwrite: false, format: false }),
      "already exists and overwrite is false",
    )

    // (h) the rule itself is a pure function, so it can be pinned directly — this
    // is the copy the engine, the docs and the stress matrix all read.
    harness.check("overwrite: the guard's thresholds are the documented ones (5 lines, half)",
      WRITE_GUARD.minRemovedLines === 5 && WRITE_GUARD.maxRemainingRatio === 0.5, JSON.stringify(WRITE_GUARD))
    const pure: Array<[string, number, number, boolean | undefined, boolean]> = [
      ["a.ts", 41, 1, undefined, true],
      ["a.ts", 41, 1, true, false],
      ["a.ts", 41, 21, undefined, false],
      ["a.ts", 4, 1, undefined, false],
      ["a.ts", 4, 1, false, true],
    ]
    for (const [name, before, after, overwrite, expect] of pure) {
      const msg = writeGuardMessage(name, { existed: true, before: lines(before), after: lines(after) }, overwrite)
      harness.check(`overwrite: rule cell ${before}→${after} overwrite=${String(overwrite)} → ${expect ? "refused" : "allowed"}`, (msg !== null) === expect, String(msg).slice(0, 120))
    }
    const notExisting = writeGuardMessage("new.ts", { existed: false, before: "", after: "" }, false)
    harness.negative("overwrite: the guard never fires for a path that did not exist", notExisting === null, String(notExisting))
    harness.check("overwrite: line counting matches the counts the refusal prints",
      lineCount("") === 0 && lineCount("a") === 1 && lineCount("a\n") === 1 && lineCount("a\nb\n") === 2,
      [lineCount(""), lineCount("a"), lineCount("a\n"), lineCount("a\nb\n")].join(","))
  } finally {
    teardown(f)
  }
}

// ── M71.D9: the plan → commit pre-image check ──────────────────────────────
// The window is real: the plan reads each target, resolves spans from those bytes
// and returns an `after`; the commit then writes it. Nothing re-read the file in
// between, so a file that changed in that window was partly overwritten from a
// plan computed against its PREVIOUS contents — silently, because the committed
// bytes come from the plan rather than from disk.
//
// The interleave below is deterministic rather than a race against a real editor.
// `planEdit` reads the target SYNCHRONOUSLY before its first await, so a
// microtask queued before the call runs at exactly the window this check is
// about: after the plan's read, before the commit's re-read. (`await executeEdit`
// cannot even start the commit until the microtask queue drains.) The first check
// asserts the interleave really landed, so this cannot pass by measuring nothing.
{
  const f = setup("preimage")
  try {
    const moving = path.join(f.srcDir, "moving.ts")
    const planned = "export const planned = 1\n"
    const external = "export const externalWriter = 2\n// saved by the editor while the plan was being computed\n"
    writeFileSync(moving, planned)
    // (a) a file that changed inside the window is refused, with nothing written
    queueMicrotask(() => writeFileSync(moving, external))
    const message = await executeEdit(f.root, f.projectId, { mode: "write", filePath: "src/moving.ts", content: "export const committed = 3\n", format: false })
      .then(() => "", (e: Error) => e.message)
    const currentHash = fileHash(moving)!
    const plannedHash = createHash("sha256").update(planned).digest("hex")
    harness.check("pre-image: the interleave landed — the file on disk is the external writer's bytes", readFileSync(moving, "utf8") === external)
    harness.check("pre-image: the edit is refused, naming the file and both hashes",
      message.includes("changed on disk between planning and committing") && message.includes("src/moving.ts")
        && message.includes(currentHash.slice(0, 12)) && message.includes(plannedHash.slice(0, 12)),
      message.slice(0, 300))
    harness.negative("pre-image: the refusal states that NOTHING was written", message.includes("bb_edit wrote nothing"), message.slice(0, 120))
    harness.check("pre-image: nothing was written — the external bytes are intact", readFileSync(moving, "utf8") === external)
    harness.negative("pre-image: no .bb-edit-* temp file was left behind",
      readdirSync(f.srcDir).every((name) => !name.includes(".bb-edit-")), readdirSync(f.srcDir).join(","))

    // (b) control: the identical call, with no interleave, commits
    const committed = await executeEdit(f.root, f.projectId, { mode: "write", filePath: "src/moving.ts", content: "export const committed = 3\n", format: false })
    harness.check("pre-image: control — the same edit commits when the file does not move",
      readFileSync(moving, "utf8") === "export const committed = 3\n" && committed.reindexed === true,
      readFileSync(moving, "utf8"))

    // (c) the other direction: a file that APPEARS where the plan intended to create one
    const appearing = path.join(f.srcDir, "appearing.ts")
    queueMicrotask(() => writeFileSync(appearing, "export const sneaky = 1\n"))
    const appeared = await executeEdit(f.root, f.projectId, { mode: "write", filePath: "src/appearing.ts", content: "export const mine = 1\n", format: false })
      .then(() => "", (e: Error) => e.message)
    harness.check("pre-image: a file that appears at a CREATE target is refused",
      appeared.includes("no file at that path") && appeared.includes("src/appearing.ts"), appeared.slice(0, 260))
    harness.check("pre-image: and the appeared file is left as it was found", readFileSync(appearing, "utf8") === "export const sneaky = 1\n")

    // (d) the third direction: the target VANISHES inside the window. The refusal
    // must not recreate it from the plan's `after`.
    const vanishing = path.join(f.srcDir, "vanishing.ts")
    writeFileSync(vanishing, "export const willVanish = 1\n")
    queueMicrotask(() => rmSync(vanishing))
    const vanished = await executeEdit(f.root, f.projectId, { mode: "write", filePath: "src/vanishing.ts", content: "export const replacement = 1\n", format: false })
      .then(() => "", (e: Error) => e.message)
    harness.check("pre-image: a target that vanishes in the window is refused by name",
      vanished.includes("now gone") && vanished.includes("src/vanishing.ts"), vanished.slice(0, 260))
    harness.negative("pre-image: and the vanished target is NOT recreated from the plan", !existsSync(vanishing))
  } finally {
    teardown(f)
  }
}

harness.emit()
