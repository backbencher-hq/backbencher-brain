// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — (E13): one verifier of the bb_edit release battery, run
//   against its own fixture projects (never this repo, never the shared index).
// WHICH TOOL IT SERVES — bb_edit (mutability write, requiresIndex true, modes:
//   write, update, insert, delete, refactor, batch).
// WHY IT IS SHAPED THIS WAY — a release gate is evidence only if it can go RED:
//   every check asserts a property the engine must hold, and every negative case
//   pins a refusal the tool must make (a successful edit where a refusal is
//   required is the defect class this battery exists to catch). The run writes its
//   verdict to validation/m13/results/<code>.json so the evidence validator and the docs gate
//   read the same numbers, and the denominator counts positives AND negatives.
// WHERE ITS EVIDENCE LIVES — validation/m13/results/<code>.json for this run; the gate runner
//   keeps the log beside it, and every failing assertion prints its name and the
//   measured detail.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/intelligence/edit/edit-engine.ts,
//   src/mcp/tools/bb_edit/descriptor.ts, src/mcp/tools/bb_edit/handler.ts,
//   docs/BB_EDIT.md, docs/tools/bb_edit.md, and script/m13/verify-edit-docs.ts.
// CONTRACTS IT MUST NOT BREAK — one verdict per run; every negative counted; exit
//   non-zero on any failure; the evidence file's issue/code/tool fields identify
//   this gate; a fixture mutation never escapes its temp project.
// ─────────────────────────────────────────────────────────────────────────────

// script/m13/verify-edit-batch.ts — (E13).
//
// bb_edit mode=batch: one edit across many files, or several edits in one call,
// as ONE atomic call. What is proven here, in the order the claims are made:
//
// 1. the two shapes the mode exists for — a fan-out (`files`) and a list of
// different edits (`edits`) — plan and apply;
// 2. ONE cycle: one `formatting` array and one `derived` block for the whole
// batch, where N single calls each carry their own;
// 3. the plan→commit pre-image check reads the WHOLE batch before the first
// write — a target that moved refuses the call with nothing written, even
// though another entry's plan was fine;
// 4. a refusal anywhere in planning writes nothing, and two entries resolving
// to one file are refused rather than silently losing one of them;
// 5. the per-change rollback envelope: a failure AFTER every write restores
// every file byte-for-byte, and the envelope says so per file;
// 6. the same thing over the wire, through the real MCP server, because that
// is the interface a caller uses.
//
// The boundaries (`edits`/`files` shape, per-entry mode contract, the entry cap)
// are read from `expandBatchRequest` — the same function the engine expands a
// batch with — so this gate cannot pass against a copy of the rules that differs
// from the enforced ones. Its wiring into the MCP surface is E1's business.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import {
  executeEdit,
  expandBatchRequest,
  MAX_BATCH_EDITS,
  BATCH_ENTRY_MODES,
  type EditRequest,
  type EditEnvelope,
} from "../../src/intelligence/edit/edit-engine"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.66",
  code: "E13",
  tool: "bb_edit",
  title: "bb_edit: batch mode — one plan, one cycle, one rollback envelope",
  layers: ["unit", "integration", "e2e"],
  decisions: {
    onePlan: "every entry is planned into ONE plan whose pre-image record is shared, so the commit's pre-image check (D9) covers the whole batch at once; `commitPlan` is the same function the single modes use, not a batch-specific copy",
    oneCycle: "formatting, validation and reindexing run once for the call — asserted structurally (one `formatting` array and one `derived` block for N targets)",
    atomicity: "a failure in any entry's PLAN writes nothing (planning never writes); a failure after the writes is rolled back per file and reported per file in `envelope` (planned/committed/restored + byte sizes)",
    duplicateTargets: "two entries resolving to one file are refused by entry index — both are planned from that file's pre-edit bytes, so applying both would discard one",
    entryContract: "an entry is validated by the SAME per-mode rule as the single-mode call it mirrors (E1 reads the same constant); `dryRun`/`format`/`edits`/`files` are refused inside an entry because the batch previews, formats and reindexes once",
    indexRule: "`batch` requires an index at the MCP gate (`indexFreeModes` is `write` alone): the mode cannot promise of a list what a single entry's plan proves",
  },
  limitations: [
    "The reindex is one `reindexFilesParallel` call for the batch; that it is ONE call is asserted structurally (one `derived` block) and not counted at the call site — the module is imported as a binding, so a probe cannot wrap it.",
    "The fan-out form names its files explicitly; no glob or directory expansion is offered, so the caller decides the list.",
    "Two entries may not compose on one file: the second is refused. Sequential calls are the composition mechanism, and that is stated in the refusal.",
    "The plan→commit window is narrowed, not closed: the pre-image check runs immediately before the write loop, and a concurrent writer landing between that check and the per-file `renameSync` is still not detected (the same residue E9 records for the single modes).",
    "The batch's result carries every target's before/after text, so a large batch is a large answer; the entry cap (`MAX_BATCH_EDITS`) is the only bound on that.",
  ],
})

interface Fixture { root: string; projectId: string; srcDir: string }
function setup(label: string): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), `bb-e13-${label}-`))
  const srcDir = path.join(root, "src")
  mkdirSync(srcDir, { recursive: true })
  return { root, projectId: getProjectId(root), srcDir }
}
function teardown(f: Fixture): void {
  rmSync(f.root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(f.projectId)), { recursive: true, force: true })
}
const at = (f: Fixture, rel: string): string => path.join(f.root, rel)
const bytesAt = (f: Fixture, rel: string): string => createHash("sha256").update(readFileSync(at(f, rel))).digest("hex")
const textAt = (f: Fixture, rel: string): string => readFileSync(at(f, rel), "utf8")
const seeded = (name: string, value: number): string =>
  `export function ${name}(): number {\n  return ${value}\n}\n`
/** A three-module project: one exported function per file, distinct names. */
function seedThree(f: Fixture): void {
  writeFileSync(at(f, "src/alpha.ts"), seeded("alpha", 1))
  writeFileSync(at(f, "src/beta.ts"), seeded("beta", 2))
  writeFileSync(at(f, "src/gamma.ts"), seeded("gamma", 3))
}
//
// The rollback envelope needs a failure that happens AFTER every write, and the
// only post-write refusal the engine has is `validateFile` rejecting a file that
// no longer parses. Python is the fixture for that because its grammar reports
// `def (` as a syntax error reliably (the trigger E6 uses); the TypeScript
// grammar is far more error-tolerant, so a "broken" TS file is often legal.
const seededPy = (name: string, value: number): string => `def ${name}():\n    return ${value}\n`
function seedThreePy(f: Fixture): void {
  writeFileSync(at(f, "src/alpha.py"), seededPy("alpha", 1))
  writeFileSync(at(f, "src/beta.py"), seededPy("beta", 2))
  writeFileSync(at(f, "src/gamma.py"), seededPy("gamma", 3))
}
const errOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try { await fn(); return "" } catch (e) { return String((e as Error)?.message ?? e) }
}

// ── 1. expandBatchRequest: the shape rules, read from the enforcing function ──
{
  const fan = expandBatchRequest({ mode: "batch", edits: [{ mode: "update", symbolName: "x", newContent: "y" }], files: ["a.ts", "b.ts"] })
  harness.check("expand: one entry × two files is two planned edits", fan.length === 2 && fan.every((e) => e.entry === 0 && e.request.filePath !== undefined), `${fan.length} entries`)
  harness.check("expand: the fan-out SUPPLIES filePath to the entry", fan[0].request.filePath === "a.ts" && fan[1].request.filePath === "b.ts")
  const list = expandBatchRequest({ mode: "batch", edits: [{ mode: "write", filePath: "a.ts", content: "x" }, { mode: "delete", symbolName: "z" }] })
  harness.check("expand: several edits keep their own order and targets", list.length === 2 && list[1].mode === "delete" && list[1].request.filePath === undefined)
  harness.check("expand: the entry modes are the five single-file modes", BATCH_ENTRY_MODES.join(",") === "write,update,insert,delete,refactor")

  harness.rejects("expand: an empty edits array is refused", () => expandBatchRequest({ mode: "batch", edits: [] }), "batch requires a non-empty")
  harness.rejects("expand: a missing edits array is refused", () => expandBatchRequest({ mode: "batch" }), "batch requires a non-empty")
  harness.rejects("expand: an entry with no mode is refused (it would pass every per-mode branch silently)",
    () => expandBatchRequest({ mode: "batch", edits: [{ newContent: "x" } as any] }), "batch entry 0 requires a mode of")
  harness.rejects("expand: a nested batch is refused",
    () => expandBatchRequest({ mode: "batch", edits: [{ mode: "batch", edits: [] } as any] }), "must not itself be a batch")
  harness.rejects("expand: a per-entry dryRun is refused (a batch previews ONCE)",
    () => expandBatchRequest({ mode: "batch", edits: [{ mode: "update", symbolName: "a", newContent: "x", dryRun: true }] }), "must not set dryRun")
  harness.rejects("expand: a per-entry format is refused (a batch formats ONCE)",
    () => expandBatchRequest({ mode: "batch", edits: [{ mode: "update", symbolName: "a", newContent: "x", format: false }] }), "must not set format")
  harness.rejects("expand: an entry naming its own filePath while `files` supplies them is refused",
    () => expandBatchRequest({ mode: "batch", edits: [{ mode: "write", filePath: "a.ts", content: "x" }], files: ["b.ts"] }), "must not also name one")
  harness.rejects("expand: a repeated path in `files` is refused",
    () => expandBatchRequest({ mode: "batch", edits: [{ mode: "update", symbolName: "a", newContent: "x" }], files: ["a.ts", "a.ts"] }), "repeats a.ts")
  harness.rejects("expand: a blank path in `files` is refused",
    () => expandBatchRequest({ mode: "batch", edits: [{ mode: "update", symbolName: "a", newContent: "x" }], files: ["  "] }), "must be a non-empty project-relative path")
  harness.rejects("expand: an empty `files` array is refused",
    () => expandBatchRequest({ mode: "batch", edits: [{ mode: "update", symbolName: "a", newContent: "x" }], files: [] }), "must be a non-empty array")
 // The cap, on a request that is otherwise perfectly valid — 201 files, one
 // entry. Nothing here touches the disk: the expansion is refused before any
 // plan is attempted, which is the point of checking it in this function.
  const many = Array.from({ length: MAX_BATCH_EDITS + 1 }, (_, i) => `src/f${i}.ts`)
  harness.rejects(`expand: ${MAX_BATCH_EDITS + 1} planned edits exceed the cap of ${MAX_BATCH_EDITS}`,
    () => expandBatchRequest({ mode: "batch", edits: [{ mode: "update", symbolName: "a", newContent: "x" }], files: many }),
    `exceeds the limit of ${MAX_BATCH_EDITS}`)
  harness.check("expand: exactly the cap is allowed",
    expandBatchRequest({ mode: "batch", edits: [{ mode: "update", symbolName: "a", newContent: "x" }], files: many.slice(0, MAX_BATCH_EDITS) }).length === MAX_BATCH_EDITS)
}

// ── 2. the fan-out shape, planned then applied ─────────────────────────────
{
  const f = setup("fanout")
  try {
 // The realistic fan-out: the SAME symbol name in two modules, which is what
 // makes a fan-out meaningful — `files` supplies the filePath, so the entry
 // resolves `shared` separately in each. A third file is the untouched control.
    writeFileSync(at(f, "src/a.ts"), seeded("shared", 1))
    writeFileSync(at(f, "src/b.ts"), seeded("shared", 2))
    writeFileSync(at(f, "src/other.ts"), seeded("other", 3))
    await indexProjectParallel(f.projectId, f.root, {})
    const request: EditRequest = {
      mode: "batch",
      edits: [{ mode: "insert", targetSymbolName: "shared", position: "after", newContent: "export const stamp = 1\n" }],
      files: ["src/a.ts", "src/b.ts"],
      format: false,
    }
    const preview = await executeEdit(f.root, f.projectId, { ...request, dryRun: true })
    harness.check("fan-out preview: 2 targets planned", preview.changes.length === 2 && preview.dryRun === true)
    harness.check("fan-out preview: the envelope reports 2 planned files, nothing committed",
      preview.envelope?.entries.length === 2 && preview.envelope.entries.every((e) => e.planned && !e.committed && !e.restored) && preview.envelope.committed === 0,
      JSON.stringify(preview.envelope?.entries.map((e) => `${e.path}:${e.planned}/${e.committed}`)))
    harness.check("fan-out preview: the pre-edit byte sizes come from the plan's own read",
      preview.envelope!.entries[0].bytesBefore === statSync(at(f, "src/a.ts")).size, String(preview.envelope!.entries[0].bytesBefore))
    harness.check("fan-out preview: nothing was written", textAt(f, "src/a.ts") === seeded("shared", 1))

    const before = { a: bytesAt(f, "src/a.ts"), b: bytesAt(f, "src/b.ts"), other: bytesAt(f, "src/other.ts") }
    const res = await executeEdit(f.root, f.projectId, request)
    harness.check("fan-out: the one edit landed in BOTH files",
      textAt(f, "src/a.ts").includes("export const stamp = 1") && textAt(f, "src/b.ts").includes("export const stamp = 1"),
      "a.ts/b.ts both carry the inserted line")
    harness.negative("fan-out: a file NOT in `files` is untouched", bytesAt(f, "src/other.ts") === before.other)
    harness.check("fan-out: the batch report maps entry 0 to the two files it touched",
      res.batch?.length === 1 && res.batch[0].entry === 0 && res.batch[0].files.length === 2 && res.batch[0].mode === "insert",
      JSON.stringify(res.batch))
    harness.check("fan-out: reindexed and validated", res.reindexed === true && res.validated === true)
    harness.check("fan-out: the envelope reports both files committed, none restored, with measured post sizes",
      res.envelope?.committed === 2 && res.envelope.restored === 0 && res.envelope.entries.every((e) => e.committed && !e.restored && e.bytesAfter === statSync(at(f, e.path)).size),
      JSON.stringify(res.envelope?.entries.map((e) => `${e.path} ${e.bytesBefore}->${e.bytesAfter}`)))
  } finally { teardown(f) }
}

// ── 3. several different edits, one call, ONE cycle ────────────────────────
{
  const f = setup("mixed")
  try {
    seedThree(f)
    writeFileSync(at(f, "src/delta.ts"), `export function delta(): number {\n  return 4\n}\n`)
    await indexProjectParallel(f.projectId, f.root, {})
    const res = await executeEdit(f.root, f.projectId, {
      mode: "batch",
      edits: [
        { mode: "update", filePath: "src/alpha.ts", symbolName: "alpha", newContent: "return 11" },
        { mode: "insert", filePath: "src/beta.ts", targetSymbolName: "beta", position: "inside-top", newContent: "const flagged = true" },
        { mode: "delete", filePath: "src/delta.ts", symbolName: "delta" },
      ],
    })
    harness.check("mixed: all three edits applied in one call",
      textAt(f, "src/alpha.ts").includes("return 11") && textAt(f, "src/beta.ts").includes("const flagged = true") && !textAt(f, "src/delta.ts").includes("function delta"),
      [textAt(f, "src/alpha.ts").includes("return 11"), textAt(f, "src/beta.ts").includes("const flagged = true"), !textAt(f, "src/delta.ts").includes("function delta")].join(","))
    harness.check("mixed: the report names each entry's mode and file",
      res.batch?.length === 3 && res.batch.map((b) => `${b.entry}:${b.mode}`).join(" ") === "0:update 1:insert 2:delete" && res.batch.every((b) => b.files.length === 1),
      JSON.stringify(res.batch))
 // ONE cycle, asserted structurally: a single formatting array covering every
 // target, and a single derived-data block. N single calls produce N of each.
    harness.check("mixed: ONE formatting pass covers all three targets",
      res.formatting !== undefined && res.formatting.length === 3 && res.formatting.length === res.changes.length,
      JSON.stringify(res.formatting?.map((c) => c.path)))
    harness.check("mixed: ONE derived-data block for the whole call",
      res.derived !== undefined && !Array.isArray(res.derived) && typeof res.derived.pass === "string",
      JSON.stringify(res.derived?.pass))
    harness.check("mixed: the envelope carries one entry per FILE, not per mode",
      res.envelope?.entries.length === 3 && res.envelope.committed === 3 && res.envelope.failed.length === 0)

 // The control that names the alternative: the same three edits as three
 // separate calls each carry their own formatting array and derived block —
 // which is exactly the per-call cost the batch does not pay three times.
    const singles = [
      await executeEdit(f.root, f.projectId, { mode: "update", filePath: "src/alpha.ts", symbolName: "alpha", newContent: "return 12", format: false }),
      await executeEdit(f.root, f.projectId, { mode: "update", filePath: "src/beta.ts", symbolName: "beta", newContent: "return 22", format: false }),
    ]
    harness.negative("mixed: N single calls produce N cycles (each has its own derived block) — the shape the batch does not have",
      singles.every((r) => r.derived !== undefined) && singles.length === 2, `${singles.length} separate calls`)
  } finally { teardown(f) }
}

// ── 4. a refusal in ANY entry writes nothing ───────────────────────────────
{
  const f = setup("refuse")
  try {
    seedThree(f)
    await indexProjectParallel(f.projectId, f.root, {})
    const before = { alpha: bytesAt(f, "src/alpha.ts"), beta: bytesAt(f, "src/beta.ts") }
    const error = await errOf(() => executeEdit(f.root, f.projectId, {
      mode: "batch",
      edits: [
        { mode: "update", filePath: "src/alpha.ts", symbolName: "alpha", newContent: "return 99" },
        { mode: "update", filePath: "src/beta.ts", symbolName: "noSuchSymbol", newContent: "return 100" },
      ],
      format: false,
    }))
    harness.check("refusal: the failing entry is NAMED in the error", error.includes("batch entry 1"), error.slice(0, 200))
    harness.check("refusal: the error still says why the entry failed", /could not be resolved|not found|no index/i.test(error), error.slice(0, 200))
    harness.negative("refusal: nothing was written — not even the entry that planned cleanly",
      bytesAt(f, "src/alpha.ts") === before.alpha && bytesAt(f, "src/beta.ts") === before.beta)
  } finally { teardown(f) }
}

// ── 5. two entries on ONE file are refused, and the refusal is not silent ──
{
  const f = setup("dupe")
  try {
    seedThree(f)
    await indexProjectParallel(f.projectId, f.root, {})
    const beforeAlpha = bytesAt(f, "src/alpha.ts")
    const error = await errOf(() => executeEdit(f.root, f.projectId, {
      mode: "batch",
      edits: [
        { mode: "update", filePath: "src/alpha.ts", symbolName: "alpha", newContent: "return 7" },
        { mode: "insert", filePath: "src/alpha.ts", targetSymbolName: "alpha", position: "inside-bottom", newContent: "const second = true" },
      ],
      format: false,
    }))
    harness.check("duplicate target: refused BY INDEX, naming both entries and the file",
      error.includes("batch entries 0 and 1 both resolve to") && error.includes("alpha.ts") && error.includes("wrote nothing"),
      error.slice(0, 220))
    harness.negative("duplicate target: the file is untouched", bytesAt(f, "src/alpha.ts") === beforeAlpha)
 // The composition mechanism, shown rather than asserted: two SEQUENTIAL calls
 // do exactly what one batch of two entries on a file cannot, because the
 // second call re-reads the file the first one wrote.
    await executeEdit(f.root, f.projectId, { mode: "update", filePath: "src/alpha.ts", symbolName: "alpha", newContent: "return 7", format: false })
    await executeEdit(f.root, f.projectId, { mode: "insert", filePath: "src/alpha.ts", targetSymbolName: "alpha", position: "inside-bottom", newContent: "const second = true", format: false })
    harness.check("duplicate target: the two sequential calls compose (this is the stated way forward)",
      textAt(f, "src/alpha.ts").includes("return 7") && textAt(f, "src/alpha.ts").includes("const second = true"))
  } finally { teardown(f) }
}

// ── 6. the pre-image check covers the WHOLE batch, before the first write ──
// The interleave is in-process and deterministic: a microtask queued BEFORE the
// call runs at the batch's first await, which — because entry 0 is a `write`,
// the one mode that reads its target synchronously and awaits nothing — lands
// AFTER that target's pre-image was recorded and BEFORE the commit re-reads it.
// The other entry's plan is unaffected, so the only thing that can stop the call
// is the batch-wide check: if it did not exist, BOTH writes would land.
{
  const f = setup("preimage")
  try {
    const big = `// header\n` + Array.from({ length: 20 }, (_, i) => `export const v${i} = ${i}`).join("\n") + "\n"
    writeFileSync(at(f, "src/target.ts"), big)
    writeFileSync(at(f, "src/other.ts"), seeded("other", 5))
    await indexProjectParallel(f.projectId, f.root, {})
    const before = { target: bytesAt(f, "src/target.ts"), other: bytesAt(f, "src/other.ts") }
    const request: EditRequest = {
      mode: "batch",
      edits: [
        { mode: "write", filePath: "src/target.ts", content: big.replace("// header", "// renamed header") },
        { mode: "update", filePath: "src/other.ts", symbolName: "other", newContent: "return 55" },
      ],
      format: false,
    }
 // Control: with no concurrent writer, the same batch applies.
    const control = await executeEdit(f.root, f.projectId, request)
    harness.check("pre-image control: the batch applies when nothing moves underneath it",
      control.envelope?.committed === 2 && textAt(f, "src/target.ts").includes("// renamed header") && textAt(f, "src/other.ts").includes("return 55"))
 // Restore the pre-edit state, then re-run with the writer queued.
    writeFileSync(at(f, "src/target.ts"), big)
    writeFileSync(at(f, "src/other.ts"), seeded("other", 5))
    await indexProjectParallel(f.projectId, f.root, {})
    const beforeSecond = { target: bytesAt(f, "src/target.ts"), other: bytesAt(f, "src/other.ts") }
    queueMicrotask(() => { writeFileSync(at(f, "src/target.ts"), big + "export const arrivedLate = true\n") })
    const error = await errOf(() => executeEdit(f.root, f.projectId, request))
    harness.check("pre-image: the call is refused, naming the file that moved",
      error.includes("wrote nothing") && error.includes("changed on disk between planning and committing") && error.includes("target.ts"),
      error.slice(0, 260))
    harness.check("pre-image: the refusal reports both hashes for that file", /planned [0-9a-f]{12}, now [0-9a-f]{12}/.test(error), error.slice(0, 260))
    harness.negative("pre-image: the OTHER entry was not written either — the check is batch-wide", bytesAt(f, "src/other.ts") === beforeSecond.other)
    harness.check("pre-image: the file that moved was left exactly as the writer left it (no write happened)",
      bytesAt(f, "src/target.ts") !== beforeSecond.target && textAt(f, "src/target.ts").endsWith("export const arrivedLate = true\n"))
  } finally { teardown(f) }
}

// ── 7. the per-change rollback envelope, from a real mid-commit failure ────
// The failure is a validation error in the LAST file of the batch, so every file
// has already been replaced when it throws: the rollback then has real work to do
// and the envelope has a real answer to give, per file.
{
  const f = setup("rollback")
  try {
    seedThreePy(f)
    await indexProjectParallel(f.projectId, f.root, {})
    const before = { alpha: bytesAt(f, "src/alpha.py"), beta: bytesAt(f, "src/beta.py"), gamma: bytesAt(f, "src/gamma.py") }
    let envelope: EditEnvelope | undefined
    let message = ""
    try {
      await executeEdit(f.root, f.projectId, {
        mode: "batch",
        edits: [
          { mode: "update", filePath: "src/alpha.py", symbolName: "alpha", newContent: seededPy("alpha", 21) },
          { mode: "update", filePath: "src/gamma.py", symbolName: "gamma", newContent: seededPy("gamma", 23) },
 // `def (` is a syntax error, so the post-write validation pass refuses
 // it. It is the LAST entry and therefore the last file in the write
 // order, so all three files are already replaced on disk when it
 // throws — the rollback has real work to do.
          { mode: "write", filePath: "src/beta.py", content: "def (\n" },
        ],
        format: false,
      })
      harness.check("rollback: the invalid entry is refused", false, "executeEdit accepted a syntax-error replacement")
    } catch (e: any) {
      message = String(e?.message ?? e)
      envelope = e?.envelope
    }
    harness.check("rollback: the error is the VALIDATION failure, not the rollback's own", /validation failed/.test(message), message.slice(0, 200))
    harness.check("rollback: no file is reported as unrestorable", !message.includes("ROLLBACK INCOMPLETE") && (envelope?.failed.length ?? -1) === 0, message.slice(0, 200))
    harness.negative("rollback: every file is byte-identical to its pre-edit bytes",
      bytesAt(f, "src/alpha.py") === before.alpha && bytesAt(f, "src/beta.py") === before.beta && bytesAt(f, "src/gamma.py") === before.gamma)
    harness.check("rollback: the envelope says 3 committed and 3 restored",
      envelope?.committed === 3 && envelope.restored === 3 && envelope.entries.length === 3,
      JSON.stringify({ committed: envelope?.committed, restored: envelope?.restored, failed: envelope?.failed }))
    harness.check("rollback: every entry reports planned+committed+restored with the size back where it started",
      envelope?.entries.every((e) => e.planned && e.committed && e.restored && e.bytesAfter === e.bytesBefore) === true,
      JSON.stringify(envelope?.entries.map((e) => `${e.path} ${e.bytesBefore}->${e.bytesAfter} r=${e.restored}`)))
    harness.check("rollback: the entry labels survive the failure (which entry touched which file)",
      envelope?.entries.map((e) => e.entry).join(",") === "0,1,2" && envelope?.entries[2].mode === "write",
      JSON.stringify(envelope?.entries.map((e) => `${e.entry}:${e.mode}`)))
 // A leftover temp is the other half of "the tree is as it was".
    harness.check("rollback: no orphaned .bb-edit-* temp file is left in src",
      leftoverTemps(f).length === 0 && ["src/alpha.py", "src/beta.py", "src/gamma.py"].every((rel) => existsSync(at(f, rel))),
      leftoverTemps(f).join(","))
  } finally { teardown(f) }
}

/** Any temp artifact the engine failed to scrub out of the fixture's src dir. */
function leftoverTemps(f: Fixture): string[] {
  return readdirSync(f.srcDir).filter((name) => name.includes(".bb-edit-"))
}

// ── 8. the overwrite guard applies per entry, inside a batch ──────────────
{
  const f = setup("guard")
  try {
    const big = `// header\n` + Array.from({ length: 40 }, (_, i) => `export const v${i} = ${i}`).join("\n") + "\n"
    writeFileSync(at(f, "src/big.ts"), big)
    writeFileSync(at(f, "src/small.ts"), "export const s = 1\n")
    await indexProjectParallel(f.projectId, f.root, {})
    const beforeBig = bytesAt(f, "src/big.ts")
    const error = await errOf(() => executeEdit(f.root, f.projectId, {
      mode: "batch",
      edits: [
        { mode: "update", filePath: "src/small.ts", symbolName: "s", newContent: "export const s = 2\n" },
        { mode: "write", filePath: "src/big.ts", content: "export const v0 = 0\n" },
      ],
      format: false,
    }))
    harness.check("guard: the refusal is raised in the PLAN, with the entry named",
      error.includes("batch entry 1") && error.includes("write refused"), error.slice(0, 220))
    harness.negative("guard: the other entry's file is untouched too (the batch is refused whole)",
      bytesAt(f, "src/big.ts") === beforeBig && textAt(f, "src/small.ts").includes("export const s = 1"))
 // The one-word acknowledgement, inside an entry.
    const res = await executeEdit(f.root, f.projectId, {
      mode: "batch",
      edits: [
        { mode: "write", filePath: "src/big.ts", content: "export const v0 = 0\n", overwrite: true },
        { mode: "update", filePath: "src/small.ts", symbolName: "s", newContent: "export const s = 2\n" },
      ],
      format: false,
    })
    harness.check("guard: overwrite:true on the entry replaces it, and both entries land",
      textAt(f, "src/big.ts") === "export const v0 = 0\n" && textAt(f, "src/small.ts").includes("export const s = 2") && res.envelope?.committed === 2)
  } finally { teardown(f) }
}

// ── 9. the interface a caller actually uses: batch over the wire ───────────
{
  const f = setup("mcp")
  try {
    seedThreePy(f)
    await indexProjectParallel(f.projectId, f.root, {})
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
    const isBun = typeof Bun !== "undefined"
    const serverEntry = isBun ? path.resolve("src/mcp/server.ts") : path.resolve("bin/bb")
    const serverArgs = isBun ? ["--dir", f.root] : ["mcp", "--dir", f.root]
    const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry, ...serverArgs], cwd: process.cwd(), stderr: "pipe", env: { ...process.env } as Record<string, string> })
    const client = new Client({ name: "verify-edit-batch", version: "1.0.0" })
    const call = async (args: Record<string, unknown>): Promise<{ text: string; isError: boolean; json: any }> => {
      const res: any = await client.callTool({ name: "bb_edit", arguments: args })
      const text = (res?.content ?? []).map((c: any) => c.text ?? "").join("\n")
      let json: any = null
      try { json = JSON.parse(text) } catch {}
      return { text, isError: res?.isError ?? false, json }
    }
    try {
      await client.connect(transport)
 // (a) the boundary rule reaches the wire: an entry that names its own
 // filePath while `files` supplies the targets is refused, with the reason.
      const conflict = await call({
        mode: "batch",
        edits: [{ mode: "update", filePath: "src/alpha.py", symbolName: "alpha", newContent: seededPy("alpha", 123) }],
        files: ["src/alpha.py"],
        format: false,
      })
      harness.check("wire: an entry that names its own filePath under `files` is refused with the reason",
        conflict.isError && /must not also name one/.test(conflict.text), conflict.text.slice(0, 200))

 // (b) the fan-out form: `files` supplies the target, so the entry names no
 // file — here a one-file fan-out, which applies.
      const fan = await call({
        mode: "batch",
        edits: [{ mode: "update", symbolName: "alpha", newContent: seededPy("alpha", 123) }],
        files: ["src/alpha.py"],
        format: false,
      })
      harness.check("wire: the fan-out call is accepted and the edit lands",
        !fan.isError && fan.json?.mode === "batch" && textAt(f, "src/alpha.py").includes("return 123"), fan.text.slice(0, 200))
      harness.check("wire: the answer carries the batch report and a committed envelope",
        fan.json?.batch?.[0]?.files?.[0] === "src/alpha.py" && fan.json?.envelope?.committed === 1 && fan.json.envelope.restored === 0,
        JSON.stringify(fan.json?.envelope))

 // (c) a fan-out whose symbol only exists in SOME of the listed files fails,
 // naming the entry AND the file it failed on — the reason a caller can act on.
      const partial = await call({
        mode: "batch",
        edits: [{ mode: "update", symbolName: "alpha", newContent: seededPy("alpha", 999) }],
        files: ["src/alpha.py", "src/gamma.py"],
        format: false,
      })
      harness.check("wire: a fan-out that resolves in one file and not another is refused, naming entry 0 and gamma.py",
        partial.isError && /batch entry 0 \(update src\/gamma\.py\)/.test(partial.text), partial.text.slice(0, 260))
      harness.negative("wire: and the file where it DID resolve was left alone (the whole batch is refused)",
        !textAt(f, "src/alpha.py").includes("return 999"))

 // (d) the failure path over the wire: all files written, then a validation
 // failure, then every file restored — with the per-file envelope in the reply.
      const envelope = await call({
        mode: "batch",
        edits: [
          { mode: "update", filePath: "src/alpha.py", symbolName: "alpha", newContent: seededPy("alpha", 124) },
          { mode: "write", filePath: "src/beta.py", content: "def (\n" },
        ],
        format: false,
      })
      harness.check("wire: the failed batch answers ok:false with rolledBack:true",
        envelope.isError && envelope.json?.ok === false && envelope.json?.rolledBack === true, envelope.text.slice(0, 240))
      harness.check("wire: the same answer carries the per-file envelope with every file restored",
        Array.isArray(envelope.json?.envelope?.entries) && envelope.json.envelope.entries.length === 2
          && envelope.json.envelope.committed === 2 && envelope.json.envelope.restored === 2 && envelope.json.envelope.failed.length === 0,
        JSON.stringify(envelope.json?.envelope?.entries?.map((e: any) => `${e.path} c=${e.committed} r=${e.restored}`)))
      harness.check("wire: the envelope on the wire is per FILE, with sizes that came back to their start",
        envelope.json?.envelope?.entries?.every((e: any) => e.bytesAfter === e.bytesBefore) === true,
        JSON.stringify(envelope.json?.envelope?.entries?.map((e: any) => `${e.bytesBefore}->${e.bytesAfter}`)))
      harness.check("wire: and the file on disk really is back to its pre-edit bytes",
        textAt(f, "src/beta.py") === seededPy("beta", 2) && textAt(f, "src/alpha.py").includes("return 123"),
        JSON.stringify({ beta: textAt(f, "src/beta.py"), alphaHas123: textAt(f, "src/alpha.py").includes("return 123") }))
    } catch (e) {
      harness.check("wire: batch over the real MCP server", false, e instanceof Error ? e.message : String(e))
    } finally {
      try { await client.close() } catch {}
    }
  } finally { teardown(f) }
}

harness.emit()
