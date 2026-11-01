// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — (E1): one verifier of the bb_edit release battery, run
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

// script/m13/verify-edit-boundary.ts — (E1).
//
// Proves bb_edit enforces mode-specific required fields and rejects
// mode-irrelevant fields at the single validateToolArguments boundary, and that
// this one path is wired into BOTH the compiled CLI and the real MCP server
// (so neither transport can silently drop or ignore an invalid request).
//
// - unit: per-mode required-field enforcement + irrelevant-field rejection
// - transport: compiled `bb tool bb_edit` and real MCP stdio both reject the
// same invalid request and accept the same valid dry-run.

import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { TOOL_DESCRIPTORS, toMcpToolList } from "../../src/mcp/tool-registry"
import { EDIT_OPTIONS_BY_MODE, validateToolArguments } from "../../src/mcp/tool-validation"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.06",
  code: "E1",
  tool: "bb_edit",
  title: "bb_edit: enforce mode-specific required fields at the boundary",
  layers: ["unit", "e2e"],
  decisions: {
    authority: "src/mcp/tool-validation.ts validateEditArguments, called by validateToolArguments (single path)",
    requiredByMode: {
      write: "filePath + (content|newContent)",
      update: "symbolName + (newContent|content)",
      insert: "targetSymbolName + (newContent|content); position enum [before|after|inside-top|inside-bottom]",
      delete: "symbolName",
      refactor: "symbolName + newName",
    },
    irrelevantRejected: "known schema fields that do not apply to the requested mode are rejected, not silently ignored",
    positionEnum: "enforced by validateProperty against the registry schema enum",
  },
  limitations: [
    "This verifies the boundary contract only; engine semantics (AST identity rename, per-language masking, rollback) are E2-E6.",
    "The compiled CLI path requires a fresh build (bin/bb); the MCP path under Bun executes src/mcp/server.ts directly.",
  ],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-edit-boundary-"))
const projectId = getProjectId(root)
const editDescriptor = TOOL_DESCRIPTORS.find((d) => d.name === "bb_edit")!
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function boundaryTarget(): string { return 'ok' }\n")

const ok = (args: Record<string, unknown>): boolean => {
  try {
    validateToolArguments(editDescriptor, args)
    return true
  } catch {
    return false
  }
}
const errOf = (args: Record<string, unknown>): string => {
  try {
    validateToolArguments(editDescriptor, args)
    return ""
  } catch (e) {
    return String(e)
  }
}

// ── write ─────────────────────────────────────────────────────────────────
harness.check("write accepts filePath + content", ok({ mode: "write", filePath: "src/new.ts", content: "export const x = 1\n" }))
harness.check("write accepts filePath + newContent", ok({ mode: "write", filePath: "src/new.ts", newContent: "export const x = 1\n" }))
harness.rejects("write rejects missing filePath", () => validateToolArguments(editDescriptor, { mode: "write", content: "x" }), "requires filePath")
harness.rejects("write rejects missing content/newContent", () => validateToolArguments(editDescriptor, { mode: "write", filePath: "src/new.ts" }), "requires content or newContent")
harness.rejects("write rejects empty filePath", () => validateToolArguments(editDescriptor, { mode: "write", filePath: "  ", content: "x" }), "requires filePath")
harness.rejects("write rejects mode-irrelevant symbolName", () => validateToolArguments(editDescriptor, { mode: "write", filePath: "src/a.ts", content: "x", symbolName: "nope" }), "does not accept: symbolName")

// ── update ────────────────────────────────────────────────────────────────
harness.check("update accepts symbolName + newContent", ok({ mode: "update", symbolName: "boundaryTarget", newContent: "export function boundaryTarget() { return 'x' }\n" }))
harness.rejects("update rejects missing symbolName", () => validateToolArguments(editDescriptor, { mode: "update", newContent: "x" }), "requires symbolName")
harness.rejects("update rejects missing content/newContent", () => validateToolArguments(editDescriptor, { mode: "update", symbolName: "boundaryTarget" }), "requires newContent or content")
harness.rejects("update rejects mode-irrelevant position", () => validateToolArguments(editDescriptor, { mode: "update", symbolName: "a", newContent: "x", position: "after" }), "does not accept: position")

// ── insert ────────────────────────────────────────────────────────────────
harness.check("insert accepts targetSymbolName + newContent + position", ok({ mode: "insert", targetSymbolName: "boundaryTarget", position: "inside-top", newContent: "const s = true\n" }))
harness.rejects("insert rejects missing targetSymbolName", () => validateToolArguments(editDescriptor, { mode: "insert", newContent: "x" }), "requires targetSymbolName")
harness.rejects("insert rejects missing content/newContent", () => validateToolArguments(editDescriptor, { mode: "insert", targetSymbolName: "a" }), "requires newContent or content")
harness.rejects("insert rejects invalid position enum", () => validateToolArguments(editDescriptor, { mode: "insert", targetSymbolName: "a", newContent: "x", position: "middle" }), "position must be one of")
harness.rejects("insert rejects mode-irrelevant symbolName", () => validateToolArguments(editDescriptor, { mode: "insert", targetSymbolName: "a", newContent: "x", symbolName: "b" }), "does not accept: symbolName")

// ── delete ────────────────────────────────────────────────────────────────
harness.check("delete accepts symbolName", ok({ mode: "delete", symbolName: "boundaryTarget" }))
harness.rejects("delete rejects missing symbolName", () => validateToolArguments(editDescriptor, { mode: "delete" }), "requires symbolName")
harness.rejects("delete rejects mode-irrelevant newContent", () => validateToolArguments(editDescriptor, { mode: "delete", symbolName: "a", newContent: "x" }), "does not accept: newContent")

// ── refactor ──────────────────────────────────────────────────────────────
harness.check("refactor accepts symbolName + newName", ok({ mode: "refactor", symbolName: "boundaryTarget", newName: "renamed" }))
harness.rejects("refactor rejects missing newName", () => validateToolArguments(editDescriptor, { mode: "refactor", symbolName: "a" }), "requires newName")
harness.rejects("refactor rejects mode-irrelevant position", () => validateToolArguments(editDescriptor, { mode: "refactor", symbolName: "a", newName: "b", position: "after" }), "does not accept: position")

// ── shared negatives ──────────────────────────────────────────────────────
harness.rejects("bb_edit rejects unknown fields", () => validateToolArguments(editDescriptor, { mode: "write", filePath: "a", content: "x", bogus: true }), "unknown or irrelevant options")
harness.rejects("bb_edit rejects invalid mode", () => validateToolArguments(editDescriptor, { mode: "explode" }), "mode must be one of")

// ── the WHOLE mode × option matrix, in both directions ───────────
// The block above pins one refusal per mode. This pins every CELL: for each mode,
// each schema option it accepts must pass the boundary, and each option it does
// not accept must be refused BY NAME with the accepted set spelled out — the
// message states both what was wrong and what the mode does accept (`bb_edit update mode does not
// accept: position`) and left the mode contract in the documentation.
//
// Both directions matter, and they fail differently: a table that wrongly
// ACCEPTS an option silently ignores what the caller sent, and a table that
// wrongly REFUSES one makes a valid call impossible. The sets are read from
// `EDIT_OPTIONS_BY_MODE`, the constant the rejection itself throws from, so this
// cannot pass against a copy of the contract that differs from the enforced one.
{
  const base: Record<string, Record<string, unknown>> = {
    write: { mode: "write", filePath: "src/matrix.ts", content: "export const matrix = 1\n" },
    update: { mode: "update", symbolName: "boundaryTarget", newContent: "export function boundaryTarget() { return 'x' }\n" },
    insert: { mode: "insert", targetSymbolName: "boundaryTarget", newContent: "const inserted = true" },
    delete: { mode: "delete", symbolName: "boundaryTarget" },
    refactor: { mode: "refactor", symbolName: "boundaryTarget", newName: "matrixRenamed" },
 // `batch` is a mode in the same matrix, so both directions are
 // pinned for it too — every option it accepts must pass, and every option it
 // does not accept must be refused BY NAME with its own accepted set stated.
 // Its base carries one entry and no `files`, so the fan-out form can be added
 // on top (`files` supplies filePath, so the base entry deliberately omits it).
    batch: { mode: "batch", edits: [{ mode: "update", symbolName: "boundaryTarget", newContent: "export function boundaryTarget() { return 'x' }\n" }] },
  }
  const sample: Record<string, unknown> = {
    dryRun: true, filePath: "src/a.ts", symbolName: "boundaryTarget", lineStart: 1,
    content: "x", newContent: "x", targetSymbolName: "boundaryTarget", position: "after",
    newName: "n", force: true, format: false, overwrite: true,
    edits: [{ mode: "update", symbolName: "boundaryTarget", newContent: "export function boundaryTarget() { return 'x' }\n" }],
    files: ["src/app.ts"],
  }
  const schemaOptions = Object.keys(editDescriptor.inputSchema.properties ?? {})
  let acceptedCells = 0
  let refusedCells = 0
  for (const [mode, accepted] of Object.entries(EDIT_OPTIONS_BY_MODE)) {
    for (const option of accepted) {
      if (option === "mode") continue
      acceptedCells++
      const error = errOf({ ...base[mode], [option]: sample[option] })
      harness.check(`matrix: ${mode} accepts ${option}`, error === "", error.slice(0, 140))
    }
    for (const option of schemaOptions) {
      if (accepted.includes(option)) continue
      refusedCells++
      const error = errOf({ ...base[mode], [option]: sample[option] })
      harness.check(
        `matrix: ${mode} refuses ${option} by name AND names the accepted set`,
        error.includes(`does not accept: ${option}`) && error.includes(`— accepted for ${mode}: ${accepted.join(", ")}`),
        error.slice(0, 220),
      )
    }
  }
 // `mode` is the discriminator: it is in every accepted set, and it is the one
 // option the accepted-side loop skips (adding it to itself proves nothing).
  const modes = Object.keys(EDIT_OPTIONS_BY_MODE)
  const declaredCells = Object.values(EDIT_OPTIONS_BY_MODE).reduce((n, options) => n + options.length, 0)
  const expectedAccepted = declaredCells - modes.length
  const expectedRefused = modes.length * schemaOptions.length - declaredCells
  harness.check(
    "matrix: every mode × schema-option cell is covered",
    acceptedCells === expectedAccepted && refusedCells === expectedRefused,
    `accepted=${acceptedCells}/${expectedAccepted} refused=${refusedCells}/${expectedRefused}`,
  )
 // An "accepted" option that is not in the schema is unreachable — it would be
 // refused earlier by the unknown-option check, so the set would advertise an
 // option no caller can use in that mode.
  const phantom = Object.values(EDIT_OPTIONS_BY_MODE).flat().filter((option) => !schemaOptions.includes(option))
  harness.check("matrix: the accepted sets name only real schema options", phantom.length === 0, phantom.join(","))
 // The hint: a misplaced option that exactly one other mode accepts says which
 // (this is the round-trip the message exists to save)…
  const misplaced = errOf({ ...base.update, position: "after" })
  harness.check("matrix: a misplaced option names the mode that accepts it (update + position)",
    misplaced.includes("(position is accepted for insert)"), misplaced.slice(0, 220))
 // …and is WITHHELD when several modes accept it, rather than implying one home.
  const ambiguousHome = errOf({ ...base.write, lineStart: 1 })
  harness.negative("matrix: no hint is invented when several modes accept the option (write + lineStart)",
    !ambiguousHome.includes("lineStart is accepted for"), ambiguousHome.slice(0, 220))
}

// ── `overwrite` is a write-only option, and a typed one ───────────
// The guard itself is engine behavior (E7 measures it against real files); this
// block pins the boundary half: the option belongs to exactly one mode, it is
// refused by name elsewhere WITH the mode that takes it, and a non-boolean value
// is refused rather than coerced — `overwrite: "yes"` must not read as false and
// silently mean "create-only".
{
  harness.check("overwrite: write accepts overwrite:true (replace whatever is there)",
    ok({ mode: "write", filePath: "src/a.ts", content: "x", overwrite: true }))
  harness.check("overwrite: write accepts overwrite:false (create-only)",
    ok({ mode: "write", filePath: "src/a.ts", content: "x", overwrite: false }))
  harness.check("overwrite: write accepts it on a dry run (the guard is reported by the plan)",
    ok({ mode: "write", dryRun: true, filePath: "src/a.ts", content: "x", overwrite: true }))
  const wrongType = errOf({ mode: "write", filePath: "src/a.ts", content: "x", overwrite: "yes" })
  harness.rejects("overwrite: a non-boolean overwrite is refused, not coerced",
    () => validateToolArguments(editDescriptor, { mode: "write", filePath: "src/a.ts", content: "x", overwrite: "yes" }),
    "overwrite must be boolean")
  harness.negative("overwrite: the refusal does not read as an accepted write", !wrongType.includes("does not accept"), wrongType.slice(0, 200))
  const misplacedOverwrite = errOf({ mode: "refactor", symbolName: "a", newName: "b", overwrite: true })
  harness.check("overwrite: another mode refuses it by name and names the mode that takes it",
    misplacedOverwrite.includes("does not accept: overwrite") && misplacedOverwrite.includes("(overwrite is accepted for write)"),
    misplacedOverwrite.slice(0, 220))
}

// ── `batch` — the mode contract for entries and for the batch itself
// A batch is validated by the SAME per-mode rule as the single call it mirrors
// (`validateBatchArguments` calls this function on each entry), so the checks
// here and the checks above cannot disagree: an entry's accepted set IS its
// mode's accepted set.
{
  const entry = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    mode: "batch",
    edits: [{ mode: "update", symbolName: "boundaryTarget", newContent: "export function boundaryTarget() { return 'x' }\n", ...extra }],
  })
  harness.check("batch: accepts a list of entries with no files (each names its own target)",
    ok(entry()), "")
  harness.check("batch: accepts the fan-out form (files supplies filePath)",
    ok({ mode: "batch", edits: [{ mode: "update", symbolName: "boundaryTarget", newContent: "x" }], files: ["src/app.ts", "src/b.ts"] }), "")
  harness.check("batch: accepts a dry run of the whole call", ok({ ...entry(), dryRun: true, format: false }), "")
  harness.check("batch: accepts a write entry (no index needed by that ENTRY's plan)",
    ok({ mode: "batch", edits: [{ mode: "write", filePath: "src/new.ts", content: "export const n = 1\n" }] }), "")
  harness.rejects("batch: rejects a missing edits array", () => validateToolArguments(editDescriptor, { mode: "batch" }), "requires a non-empty")
  harness.rejects("batch: rejects an empty edits array", () => validateToolArguments(editDescriptor, { mode: "batch", edits: [] }), "requires a non-empty")
  harness.rejects("batch: rejects an entry with no mode (it would pass every per-mode branch silently)",
    () => validateToolArguments(editDescriptor, { mode: "batch", edits: [{ symbolName: "x", newContent: "y" }] }), "batch entry 0 requires a mode of")
  harness.rejects("batch: rejects a nested batch",
    () => validateToolArguments(editDescriptor, { mode: "batch", edits: [{ mode: "batch", edits: [] }] }), "must not itself be a batch")
  harness.rejects("batch: rejects a per-entry dryRun (the batch previews ONCE)",
    () => validateToolArguments(editDescriptor, { mode: "batch", edits: [{ mode: "update", symbolName: "x", newContent: "y", dryRun: true }] }), "must not set dryRun")
  harness.rejects("batch: rejects a per-entry format (the batch formats ONCE)",
    () => validateToolArguments(editDescriptor, { mode: "batch", edits: [{ mode: "update", symbolName: "x", newContent: "y", format: false }] }), "must not set format")
  harness.rejects("batch: rejects an entry naming its own filePath while files supplies them",
    () => validateToolArguments(editDescriptor, { mode: "batch", edits: [{ mode: "write", filePath: "a.ts", content: "x" }], files: ["b.ts"] }), "must not also name one")
  harness.rejects("batch: rejects a repeated path in files",
    () => validateToolArguments(editDescriptor, { mode: "batch", edits: [{ mode: "update", symbolName: "x", newContent: "y" }], files: ["a.ts", "a.ts"] }), "repeats a.ts")
  harness.rejects("batch: rejects a top-level symbolName (a batch carries no per-file options)",
    () => validateToolArguments(editDescriptor, { mode: "batch", edits: [{ mode: "update", symbolName: "x", newContent: "y" }], symbolName: "x" }), "does not accept: symbolName")
  harness.rejects("batch: rejects a top-level content",
    () => validateToolArguments(editDescriptor, { mode: "batch", edits: [{ mode: "update", symbolName: "x", newContent: "y" }], content: "x" }), "does not accept: content")
 // An entry is refused by the SAME per-mode rule, and the refusal carries the
 // entry index — otherwise a caller with six entries has to bisect their own list.
  const entryIrrelevant = errOf({ mode: "batch", edits: [{ mode: "update", symbolName: "x", newContent: "y", position: "after" }] })
  harness.check("batch: an entry's irrelevant option is refused BY NAME, with the entry index",
    entryIrrelevant.includes("batch entry 0") && entryIrrelevant.includes("does not accept: position"), entryIrrelevant.slice(0, 220))
  harness.rejects("batch: an entry missing a field its own mode requires is refused (write needs content)",
    () => validateToolArguments(editDescriptor, { mode: "batch", edits: [{ mode: "write", filePath: "a.ts" }] }), "requires content or newContent")
  harness.negative("batch: the entry-index refusal does not read as a top-level mode error",
    !/^bb_edit batch mode requires/.test(entryIrrelevant), entryIrrelevant.slice(0, 160))
 // And the fan-out satisfies the entry's own filePath requirement: `files` IS
 // the filePath, so a `write` entry with no filePath is valid while fanned out —
 // and refused when it is not.
  harness.check("batch: a write entry with no filePath is valid under files",
    ok({ mode: "batch", edits: [{ mode: "write", content: "export const n = 1\n" }], files: ["src/n.ts"] }), "")
  harness.rejects("batch: the same write entry without files is refused (its mode requires filePath)",
    () => validateToolArguments(editDescriptor, { mode: "batch", edits: [{ mode: "write", content: "x" }] }), "requires filePath")
}

// ── the sentence a CLIENT is shown, not only the ones in the docs ──
// The registry description is the only part of this contract an MCP client sees
// before it has a schema or a documentation page — `toMcpToolList` publishes
// exactly {name, description, inputSchema}. A mode-aware gate whose rule appears
// nowhere in that string is a rule the caller has to discover by being refused.
{
  const published: any = toMcpToolList(TOOL_DESCRIPTORS).find((tool) => tool.name === "bb_edit")
  const description = String(published?.description ?? "")
  harness.check(
    "wire description: the published description states the per-mode index rule",
    /`write` plans from the request and the disk, resolves no symbol/.test(description),
    description.slice(-200),
  )
  harness.check(
    "wire description: and names the modes that DO resolve through the index",
    /`update`, `insert`, `delete` and `refactor` resolve their target through the index/.test(description),
    description.slice(-200),
  )
 // the guard is part of the contract a caller must know BEFORE it is
 // refused — the same argument as the index rule above. A client that cannot see
 // it in the published description discovers the guard by losing a write to it.
  harness.check(
    "wire description: the published description states the overwrite guard",
    /a replacement that removes at least half of a file's lines \(and at least 5 lines\) is refused as a probable mistake unless `overwrite: true` is passed/.test(description),
    description.slice(-260),
  )
  harness.check(
    "wire description: and states what `overwrite: false` means",
    /`overwrite: false` makes the write create-only/.test(description),
    description.slice(-200),
  )
 // the plan-to-commit re-check, which is the difference between refusing
 // a moved file and silently overwriting content the plan never read.
  harness.check(
    "wire description: the published description states the plan-to-commit pre-image check",
    /bytes each target had when the edit was PLANNED are re-checked immediately before the write/.test(description),
    description.slice(-300),
  )
 // batch is a capability a client must be able to discover from the
 // published description: that several edits (or one across several files) go in
 // one atomic call, that the two-on-one-file case is refused, and that the answer
 // is per file. Each of those is a rule a caller would otherwise meet by being
 // refused, or — worse, for the duplicate case — never meet at all.
  harness.check(
    "wire description: the published description states what `batch` does and that it is atomic",
    /`batch` applies several edits, or one edit across several files, as ONE atomic call/.test(description),
    description.slice(-420),
  )
  harness.check(
    "wire description: …that a refusal anywhere writes nothing",
    /every entry is planned before anything is written \(so a refusal anywhere writes nothing\)/.test(description),
    description.slice(-420),
  )
  harness.check(
    "wire description: …that two entries on one file are refused",
    /Two entries may not resolve to the same file/.test(description),
    description.slice(-420),
  )
  harness.check(
    "wire description: …and that the answer is per file (the envelope)",
    /Every answer carries a per-file `envelope`/.test(description),
    description.slice(-420),
  )
}

// ── wiring: one validation path for both transports ───────────────────────
const serverSrc = readFileSync(path.resolve("src/mcp/server.ts"), "utf8")
const cliSrc = readFileSync(path.resolve("src/cli/index.ts"), "utf8")
harness.check("MCP server routes through validateToolArguments", serverSrc.includes("validateToolArguments"))
harness.check("compiled CLI routes through validateToolArguments", cliSrc.includes("validateToolArguments"))

// ── transport: compiled CLI ───────────────────────────────────────────────
await indexProjectParallel(projectId, root, {})
try {
  const out = execFileSync("node", [path.resolve("bin/bb"), "tool", "bb_edit", "--dir", root, "--args", JSON.stringify({ mode: "write", dryRun: true, filePath: "src/new.ts", content: "export const cliBoundary = true\n" })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
  harness.check("CLI accepts valid write dry-run", out.includes('"dryRun": true'), out.slice(0, 160))
} catch (e: any) {
  harness.check("CLI accepts valid write dry-run", false, `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`.slice(0, 200))
}
try {
  execFileSync("node", [path.resolve("bin/bb"), "tool", "bb_edit", "--dir", root, "--args", JSON.stringify({ mode: "write", content: "x" })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
  harness.check("CLI rejects write without filePath", false)
} catch (e: any) {
  const text = `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`
  harness.check("CLI rejects write without filePath", text.includes("requires filePath"), text.slice(0, 200))
}

// ── transport: real MCP stdio ─────────────────────────────────────────────
{
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const isBun = typeof Bun !== "undefined"
  const serverEntry = isBun ? path.resolve("src/mcp/server.ts") : path.resolve("bin/bb")
  const serverArgs = isBun ? ["--dir", root] : ["mcp", "--dir", root]
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry, ...serverArgs], cwd: process.cwd(), stderr: "pipe" })
  const client = new Client({ name: "verify-edit-boundary", version: "1.0.0" })
  const call = async (args: Record<string, unknown>) => {
    const res: any = await client.callTool({ name: "bb_edit", arguments: args })
    const text = (res?.content ?? []).map((c: any) => c.text ?? "").join("\n")
    return { text, isError: res?.isError ?? false }
  }
  try {
    await client.connect(transport)
    const valid = await call({ mode: "write", dryRun: true, filePath: "src/mcp-new.ts", content: "export const mcpBoundary = true\n" })
    harness.check("MCP accepts valid write dry-run", !valid.isError && valid.text.includes('"dryRun": true'), valid.text.slice(0, 160))
    const invalid = await call({ mode: "write", content: "x" })
    harness.check("MCP rejects write without filePath", invalid.isError && invalid.text.includes("requires filePath"), invalid.text.slice(0, 160))
  } catch (e) {
    harness.check("MCP bb_edit boundary session", false, e instanceof Error ? e.message : String(e))
  } finally {
    try { await client.close() } catch {}
  }
}

rmSync(root, { recursive: true, force: true })
rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })

harness.emit()
