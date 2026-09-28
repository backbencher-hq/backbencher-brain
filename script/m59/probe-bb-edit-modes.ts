// script/m59/probe-bb-edit-modes.ts — M59.EDIT
//
// Does `bb_edit` work at all, per mode, through the REAL tool surface?
// The user reports it "not working at all". This probe does not argue: it
// indexes a tiny fixture project (one per case, isolated), calls the actual
// MCP handler exactly as an agent's client does, and records what came back
// plus the bytes on disk afterwards.
//
// Cases mirror how an agent actually uses the tool:
//   1  update: FULL method declaration, TS class method (no `function` keyword)
//   2  update: FULL free function declaration
//   3  update: BODY FRAGMENT only ("return 5")
//   4  update: `content` used instead of `newContent`
//   5  update: ambiguous name with no filePath  → must refuse, naming the fix
//   6  update: ambiguous name WITH filePath
//   7  insert: inside-top on a class method
//   8  insert: after a free function
//   9  delete: a free function
//   10 write:  create a new file
//   11 update: after the file was changed OUTSIDE bb (native editor / other tool)
//              — the situation every agent is in
//   12 update: dryRun preview must not touch the file
//   13 refactor: rename a free function
//   14 arg hygiene: `position` passed to update mode
//   15 the engine's `allowStaleIndex` escape hatch, sent on the wire
//   16 the documented remediation for 11: bb_index then bb_edit
//   17 two edits in a row on the same file (each reindexes)
//
// WIRE-FAITHFUL: the call path mirrors `src/mcp/server.ts` exactly —
// `validateToolArguments(descriptor, args)` BEFORE the handler. Calling the
// handler alone bypasses parameter validation, which is a different tool.
//
// Every case records: ok | error message, the file bytes after, and whether a
// reindex was reported.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const DATA_ROOT = mkdtempSync(path.join(tmpdir(), "m59-edit-data-"))
process.env.BB_DATA_DIR = DATA_ROOT

const SHAPES = `export function helper(): number {
  return 1
}

export function oneline(): number { return 3 }

export function empty(): void {}

export class Calculator {
  private annotationLine(value: number): number {
    return value + 1
  }

  public total(): number {
    let sum = 0
    return sum
  }
}
`

const TWIN = `export function helper(): number {
  return 99
}
`

const OTHER = `export function caller(): number {
  return helper()
}
`

type Case = {
  name: string
  args: Record<string, unknown>
  /** mutate the tree AFTER indexing, before the call (the stale-index case) */
  afterIndex?: (proj: string) => void
  /** extra calls to run before the audited one (e.g. the bb_index remediation) */
  prelude?: Array<{ tool: string; args: Record<string, unknown> }>
  /** the file we inspect afterwards */
  inspect: string
  expect: (after: string) => string | null
  /** when set, the CORRECT outcome is a refusal whose message matches this */
  expectRefusal?: string
}

const CASES: Case[] = [
  {
    name: "01-update-full-method-decl",
    args: {
      mode: "update",
      symbolName: "annotationLine",
      newContent: `  private annotationLine(value: number): number {\n    return value + 2\n  }`,
    },
    inspect: "src/shapes.ts",
    expect: (a) => (a.includes("return value + 2") && !a.includes("return value + 1") ? null : "replacement not visible on disk"),
  },
  {
    name: "02-update-full-function-decl",
    args: {
      mode: "update",
      symbolName: "helper",
      filePath: "src/shapes.ts",
      newContent: `export function helper(): number {\n  return 7\n}`,
    },
    inspect: "src/shapes.ts",
    expect: (a) => (a.includes("return 7") ? null : "replacement not visible on disk"),
  },
  {
    name: "03-update-body-fragment",
    args: { mode: "update", symbolName: "helper", filePath: "src/shapes.ts", newContent: "return 5" },
    inspect: "src/shapes.ts",
    expect: (a) => (a.includes("return 5") && a.includes("export function helper()") ? null : "fragment update did not keep the declaration"),
  },
  {
    name: "04-update-uses-content-field",
    args: { mode: "update", symbolName: "helper", filePath: "src/shapes.ts", content: "return 11" },
    inspect: "src/shapes.ts",
    expect: (a) => (a.includes("return 11") ? null : "`content` not honoured for update"),
  },
  {
    name: "05-update-ambiguous-no-filePath",
    args: { mode: "update", symbolName: "helper", newContent: "return 2" },
    inspect: "src/shapes.ts",
    expect: (a) => (a.includes("return 1") ? null : "ambiguous name was allowed to edit a file"),
  },
  {
    name: "06-update-ambiguous-with-filePath",
    args: { mode: "update", symbolName: "helper", filePath: "src/twin.ts", newContent: "return 42" },
    inspect: "src/twin.ts",
    expect: (a) => (a.includes("return 42") ? null : "targeted file was not edited"),
  },
  {
    name: "07-insert-inside-top-method",
    args: { mode: "insert", targetSymbolName: "total", position: "inside-top", newContent: "const started = true" },
    inspect: "src/shapes.ts",
    expect: (a) => (a.includes("const started = true") ? null : "insert inside-top did not land"),
  },
  {
    name: "08-insert-after-function",
    args: { mode: "insert", targetSymbolName: "helper", filePath: "src/shapes.ts", position: "after", newContent: "export const extra = 1" },
    inspect: "src/shapes.ts",
    expect: (a) => (a.includes("export const extra = 1") ? null : "insert after did not land"),
  },
  {
    name: "09-delete-function",
    args: { mode: "delete", symbolName: "oneline", filePath: "src/shapes.ts" },
    inspect: "src/shapes.ts",
    expect: (a) => (a.includes("oneline") ? "symbol still present after delete" : null),
  },
  {
    name: "10-write-new-file",
    args: { mode: "write", filePath: "src/fresh.ts", content: "export const fresh = 1\n" },
    inspect: "src/fresh.ts",
    expect: (a) => (a.includes("export const fresh = 1") ? null : "write did not create the file"),
  },
  {
    // M59.A11: the file changed after indexing (another tool / a pull / the
    // human). Every read tool refreshes in this state; the edit must too.
    name: "11-update-after-external-change",
    args: { mode: "update", symbolName: "helper", filePath: "src/shapes.ts", newContent: "return 8" },
    afterIndex: (proj) => {
      const p = path.join(proj, "src/shapes.ts")
      writeFileSync(p, readFileSync(p, "utf8") + "\n// touched by another tool\n")
    },
    inspect: "src/shapes.ts",
    expect: (a) => (a.includes("return 8") ? null : "update refused after an external change"),
  },
  {
    name: "12-update-dry-run",
    args: { mode: "update", symbolName: "helper", filePath: "src/shapes.ts", newContent: "return 13", dryRun: true },
    inspect: "src/shapes.ts",
    expect: (a) => (a.includes("return 1") ? null : "dry run modified the file"),
  },
  {
    name: "13-refactor-rename",
    args: { mode: "refactor", symbolName: "helper", filePath: "src/shapes.ts", newName: "helperRenamed" },
    inspect: "src/shapes.ts",
    expect: (a) => (a.includes("helperRenamed") ? null : "rename did not land"),
  },
  {
    name: "14-update-with-position-arg",
    args: { mode: "update", symbolName: "helper", filePath: "src/shapes.ts", newContent: "return 10", position: "after" },
    inspect: "src/shapes.ts",
    expect: (a) => (a.includes("return 10") ? "irrelevant arg was NOT rejected (silently honoured)" : null),
  },
  {
    // If this succeeds, the escape hatch is reachable from a client; if it is
    // rejected as an unknown option, the ONLY way past a stale file is bb_index.
    // DECLARED, not a defect: `allowStaleIndex` is a legacy adapter field and
    // is deliberately absent from the registry schema, so the wire rejects it.
    // The correct path is the auto-refresh above, which never trusts old bounds.
    name: "15-update-allowStaleIndex-on-wire",
    args: { mode: "update", symbolName: "helper", filePath: "src/shapes.ts", newContent: "return 9", allowStaleIndex: true },
    afterIndex: (proj) => {
      const p = path.join(proj, "src/shapes.ts")
      writeFileSync(p, readFileSync(p, "utf8") + "\n// touched by another tool\n")
    },
    inspect: "src/shapes.ts",
    expectRefusal: "unknown or irrelevant options: allowStaleIndex",
    expect: (a) => (!a.includes("return 9") ? null : "the escape hatch wrote an edit from stale bounds"),
  },
  {
    name: "16-stale-then-index-then-edit",
    args: { mode: "update", symbolName: "helper", filePath: "src/shapes.ts", newContent: "return 6" },
    afterIndex: (proj) => {
      const p = path.join(proj, "src/shapes.ts")
      writeFileSync(p, readFileSync(p, "utf8") + "\n// touched by another tool\n")
    },
    prelude: [{ tool: "bb_index", args: { path: "src/shapes.ts", mode: "file" } }],
    inspect: "src/shapes.ts",
    expect: (a) => (a.includes("return 6") ? null : "index-then-edit did not land"),
  },
  {
    name: "17-two-edits-in-a-row",
    args: { mode: "update", symbolName: "total", newContent: "    let sum = 2\n    return sum" },
    prelude: [{ tool: "bb_edit", args: { mode: "update", symbolName: "helper", filePath: "src/shapes.ts", newContent: "return 4" } }],
    inspect: "src/shapes.ts",
    expect: (a) => (a.includes("let sum = 2") ? null : "second edit in a row refused"),
  },
  {
    // The symbol itself was renamed outside bb: the refresh must NOT edit a
    // guessed span — it must say the symbol is gone.
    name: "18-stale-then-symbol-renamed-outside",
    args: { mode: "update", symbolName: "helper", filePath: "src/shapes.ts", newContent: "return 77" },
    afterIndex: (proj) => {
      const p = path.join(proj, "src/shapes.ts")
      writeFileSync(p, readFileSync(p, "utf8").replace("export function helper()", "export function helperRenamedOutside()"))
    },
    inspect: "src/shapes.ts",
    expectRefusal: "not found after refreshing",
    expect: (a) => (!a.includes("return 77") ? null : "a renamed-away symbol was edited anyway"),
  },
]

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))

  const { PUBLIC_TOOL_DESCRIPTORS } = await import(path.join(ROOT, "src/mcp/tool-registry.ts"))
  const { validateToolArguments } = await import(path.join(ROOT, "src/mcp/tool-validation.ts"))
  const descriptors = new Map<string, any>((PUBLIC_TOOL_DESCRIPTORS as any[]).map((d) => [d.name, d]))
  const handlers: any = createToolHandlers()
  const results: any[] = []
  const fixups: string[] = []

  /** Exactly what src/mcp/server.ts does: validate, then call the handler. */
  const callTool = async (name: string, args: Record<string, unknown>, ctx: any) => {
    const descriptor = descriptors.get(name)
    if (!descriptor) return { raw: `unknown tool: ${name}`, isError: true }
    try {
      const validated = validateToolArguments(descriptor, args)
      const res: any = await handlers[name](validated, ctx)
      const text = (Array.isArray(res?.content) ? res.content : []).map((b: any) => String(b?.text ?? "")).join("\n")
      return { raw: text, isError: res?.isError === true }
    } catch (e: any) {
      return { raw: `error: ${e?.message ?? String(e)}`, isError: true }
    }
  }

  const FILTER = process.env.M59_EDIT_CASES
    ? new Set(process.env.M59_EDIT_CASES.split(",").map((s) => s.trim()))
    : null
  for (const c of CASES) {
    if (FILTER && ![...FILTER].some((f) => c.name.startsWith(f))) continue
    const proj = mkdtempSync(path.join(tmpdir(), "m59-edit-fix-"))
    mkdirSync(path.join(proj, "src"), { recursive: true })
    writeFileSync(path.join(proj, "src/shapes.ts"), SHAPES)
    writeFileSync(path.join(proj, "src/twin.ts"), TWIN)
    writeFileSync(path.join(proj, "src/other.ts"), OTHER)
    writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }))

    const pid = getProjectId(proj) as any
    await indexProjectParallel(pid, proj, {})
    if (c.afterIndex) c.afterIndex(proj)

    const target = path.join(proj, c.inspect)
    const before = existsSync(target) ? readFileSync(target, "utf8") : null

    const ctx = { projectId: pid, projectPath: proj }
    const preludeResults: any[] = []
    for (const step of c.prelude ?? []) {
      const r = await callTool(step.tool, step.args, ctx)
      preludeResults.push({ tool: step.tool, isError: r.isError, head: r.raw.replace(/\s+/g, " ").slice(0, 120) })
    }
    // Re-read `before` after the prelude so changedOnDisk means "this call did it".
    const beforeFinal = existsSync(target) ? readFileSync(target, "utf8") : null

    const call = await callTool("bb_edit", c.args, ctx)
    const raw = call.raw
    const after = existsSync(target) ? readFileSync(target, "utf8") : null
    const parsed = (() => { try { return JSON.parse(raw) } catch { return null } })()

    const refused = call.isError || parsed?.ok === false
    const problem = c.expect(after ?? "")
    const reason = refused
      ? (parsed?.error ? String(parsed.error) : raw).replace(/\s+/g, " ").slice(0, 170)
      : null
    // A case may declare that the CORRECT outcome is a refusal with a specific
    // reason; then "refused" alone is not enough, and neither is a refusal with
    // the wrong reason.
    const refusalProblem = c.expectRefusal
      ? (refused && reason !== null && new RegExp(c.expectRefusal).test(reason)
        ? null
        : `expected a refusal matching /${c.expectRefusal}/, got: ${refused ? reason : "a successful edit"}`)
      : null

    results.push({
      case: c.name,
      toolRefused: refused,
      reason,
      prelude: preludeResults.length ? preludeResults : undefined,
      changedOnDisk: beforeFinal !== after,
      reindexed: parsed?.reindexed ?? null,
      derived: parsed?.derived?.pass ?? null,
      expectationMet: problem === null && refusalProblem === null,
      expectationProblem: problem ?? refusalProblem,
    })
    if (problem ?? refusalProblem) fixups.push(`${c.name}: ${problem ?? refusalProblem}`)
  }

  const out = {
    probe: "M59.EDIT — bb_edit per-mode behavioural probe",
    at: new Date().toISOString(),
    dataDir: DATA_ROOT,
    cases: results.length,
    refused: results.filter((r) => r.toolRefused).length,
    expectationsUnmet: results.filter((r) => !r.expectationMet).length,
    results,
  }
  const OUT = path.join(ROOT, "validation/m59/results/probe-bb-edit-modes.json")
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  if (fixups.length) console.log("\nUNMET:\n" + fixups.join("\n"))
}

main().catch((e) => { console.error(e); process.exit(1) })
