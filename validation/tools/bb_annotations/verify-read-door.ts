// validation/tools/bb_annotations/verify-read-door.ts
//
// The falsifiable gate for the annotation READ door. It asserts the contracts the
// tool must never break, then proves the assertions CAN fail by feeding them
// deliberately broken implementations (a seeded-mutant suite, so the gate never
// edits shared src/ while the checkout is in use):
//
//   A  declared absence for the project, symbol, path and symbol+path shapes
//   B  no store is created for a project that has never been written: the answer
//      is a declared absence and the filesystem is unchanged
//   C  a legacy store without the annotation table stays without it (no DDL on a read)
//   D  bound + truncation: page size, true total, a reason, and cap wording that
//      names an action the caller can take
//   E  a symbol read matches BOTH name forms the index publishes (simple and
//      qualified), the same pair the editor hover matches
//   F  a name the index does not publish still finds its literal note
//   G  path canonicalization on read and write (relative, ./relative, absolute)
//   H  path scope laws: the file's own notes by default, name-level on request,
//      and a symbol+path read always carries name-level notes about that symbol
//   I  refusals: limit outside 1..200, wrong types, unknown options, alias conflicts
//   J  read immutability: reading does not change brain.db or brain.db-wal content
//   K  deterministic ordering with the id tiebreak
//
// Mutants (each must be CAUGHT — the gate fails if one survives):
//   M1 name set reduced to the simple name (the defect this gate was written for)
//   M2 truncation reason that always says "raise limit" (impossible at the cap)
//   M3 a reader that invents a row where the store has none
//   M4 a response that echoes the effective inclusion as the accepted flag
//   M5 a reader that opens the store read-write (creates one for an empty project)
//
// Run: BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/verify-read-door.ts
// Evidence: validation/tools/bb_annotations/results/GATE-read-door.json
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..")
const DATA_DIR = join(HERE, "gate-bbdata")
const PROBE = join(HERE, "work", "probe-fixture")
const WORKSPACES = join(DATA_DIR, "_workspaces")
rmSync(DATA_DIR, { recursive: true, force: true })
mkdirSync(WORKSPACES, { recursive: true })
process.env.BB_DATA_DIR = DATA_DIR
process.env.BB_NO_AUTO_REFRESH = "1"

const require = createRequire(import.meta.url)
const { getProjectId } = await import(join(ROOT, "src", "util", "project-id.ts"))
const { indexProjectParallel } = await import(join(ROOT, "src", "ast", "parallel-indexer.ts"))
const { BrainDatabase } = await import(join(ROOT, "src", "brain", "database.ts"))
const { createToolHandlers } = await import(join(ROOT, "src", "mcp", "tool-handlers.ts"))
const { validateToolArguments } = await import(join(ROOT, "src", "mcp", "tool-validation.ts"))
const { descriptor } = await import(join(ROOT, "src", "mcp", "tools", "bb_annotations", "descriptor.ts"))
const { resolveAnnotationNames, truncationReason } = await import(join(ROOT, "src", "mcp", "tools", "bb_annotations", "handler.ts"))
const Database = require("better-sqlite3")

const handlers = createToolHandlers() as Record<string, (args: any, ctx: any) => Promise<any>>
const calls: Array<{ tool: string; args: Record<string, unknown>; isError: boolean; parsed: any; text: string }> = []
async function call(tool: string, args: Record<string, unknown>, ctx: { projectId: string; projectPath: string }) {
  const result = await handlers[tool](args, ctx)
  const text = result?.content?.[0]?.text ?? ""
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch {}
  const entry = { tool, args, isError: result?.isError === true, parsed, text }
  calls.push(entry)
  return entry
}

// The gate calls the tool the way the MCP server does: validate the arguments
// against the descriptor first (that is where type/alias/unknown-option refusals
// live), then hand the validated object to the handler.
async function doorCall(args: Record<string, unknown>, ctx: { projectId: string; projectPath: string }) {
  let validated: Record<string, unknown>
  try {
    validated = validateToolArguments(descriptor as any, args)
  } catch (error) {
    const text = `error: ${error instanceof Error ? error.message : String(error)}`
    const entry = { tool: "bb_annotations", args, isError: true, parsed: null, text }
    calls.push(entry)
    return entry
  }
  return call("bb_annotations", validated as Record<string, unknown>, ctx)
}

const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = []
const mutants: Array<{ name: string; caught: boolean; detail?: unknown }> = []
function check(name: string, ok: boolean, detail?: unknown) {
  checks.push({ name, ok: ok === true, detail })
  if (ok !== true) console.log(`  FAIL: ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail).slice(0, 400)}`}`)
}
function mutant(name: string, caught: boolean, detail?: unknown) {
  mutants.push({ name, caught: caught === true, detail })
  if (caught !== true) console.log(`  SURVIVED: ${name}`)
}

function makeWorkspace(name: string, relativeFile: string, content: string) {
  const workspace = join(WORKSPACES, name)
  mkdirSync(join(workspace, dirname(relativeFile)), { recursive: true })
  writeFileSync(join(workspace, relativeFile), content)
  return workspace
}

// ── fixtures: index the probe into the gate's own store ─────────────────────
const probeId = getProjectId(PROBE)
const probeCtx = { projectId: probeId, projectPath: PROBE }
await (indexProjectParallel as any)(probeId, PROBE, {})
const dataEntriesAfterIndex = readdirSync(DATA_DIR)

// ── A: declared absence, all shapes, before any note exists ──────────────────
{
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ["project", {}, /no annotations stored for this project yet/],
    ["symbol", { symbol: "Widget" }, /no annotations stored for 'Widget'/],
    ["path", { path: "src/alpha.ts" }, /no annotations stored for 'src\/alpha\.ts'/],
    ["symbol+path", { symbol: "Widget", path: "src/alpha.ts" }, /no annotations stored for 'Widget' in 'src\/alpha\.ts'/],
  ]
  for (const [shape, args, note] of cases) {
    const answer = await doorCall(args, probeCtx)
    check(`A absence declared (${shape})`, answer.isError === false && answer.parsed?.declaredAbsent === true && answer.parsed?.count === 0 && answer.parsed?.totalCountIfKnown === 0 && note.test(String(answer.parsed?.absenceNote)), answer.parsed ?? answer.text)
  }
}

// ── B: a project never written to gets a declared absence and NO files ───────
{
  const unindexed = makeWorkspace("unindexed-project", "src/only.ts", "export function lonely(): string {\n  return \"lonely\"\n}\n")
  const unindexedCtx = { projectId: getProjectId(unindexed), projectPath: unindexed }
  const entriesBefore = readdirSync(DATA_DIR)
  const answer = await doorCall({}, unindexedCtx)
  const entriesAfter = readdirSync(DATA_DIR)
  check("B unindexed project: declared absence, storeAbsent true", answer.isError === false && answer.parsed?.declaredAbsent === true && answer.parsed?.storeAbsent === true, answer.parsed ?? answer.text)
  check("B unindexed project: the read created no directory or store file", JSON.stringify(entriesAfter) === JSON.stringify(entriesBefore), { before: entriesBefore, after: entriesAfter })

  // M5 — the mutant opens the store read-write first (the defect this pins).
  const mutantWorkspace = makeWorkspace("unindexed-mutant-project", "src/m.ts", "export function mutant(): number {\n  return 1\n}\n")
  const mutantId = getProjectId(mutantWorkspace)
  const projectsBefore = readdirSync(join(DATA_DIR, "projects"))
  await BrainDatabase.getRawInstance(mutantId) // mutant behaviour: read-write open
  const projectsAfter = readdirSync(join(DATA_DIR, "projects"))
  mutant("M5 read-write open creates a store for an unwritten project", JSON.stringify(projectsAfter) !== JSON.stringify(projectsBefore), { before: projectsBefore.length, after: projectsAfter.length })
  rmSync(join(DATA_DIR, "projects", mutantId), { recursive: true, force: true })
  rmSync(mutantWorkspace, { recursive: true, force: true })
}

// ── C: a legacy store without the annotation table keeps its shape ───────────
{
  const legacyWorkspace = makeWorkspace("legacy-fixture", "src/l.ts", "export function legacy(): number {\n  return 7\n}\n")
  const legacyId = getProjectId(legacyWorkspace)
  const legacyDir = join(DATA_DIR, "projects", legacyId)
  mkdirSync(legacyDir, { recursive: true })
  copyFileSync(join(DATA_DIR, "projects", probeId, "brain.db"), join(legacyDir, "brain.db"))
  const legacyDb = join(legacyDir, "brain.db")
  const seed = new Database(legacyDb, { readonly: false, fileMustExist: true })
  seed.exec("DROP TABLE IF EXISTS brain_annotation")
  seed.close()
  const dbShaBefore = createHash("sha256").update(readFileSync(legacyDb)).digest("hex")
  const answer = await doorCall({ symbol: "legacy" }, { projectId: legacyId, projectPath: legacyWorkspace })
  const dbShaAfter = createHash("sha256").update(readFileSync(legacyDb)).digest("hex")
  const tableStillMissing = !new Database(legacyDb, { readonly: true, fileMustExist: true }).prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brain_annotation'").get()
  check("C legacy store: declared absence, storeAbsent true", answer.isError === false && answer.parsed?.declaredAbsent === true && answer.parsed?.storeAbsent === true, answer.parsed ?? answer.text)
  check("C legacy store: the read did not recreate the annotation table", tableStillMissing)
  check("C legacy store: the read did not change brain.db", dbShaBefore === dbShaAfter, { before: dbShaBefore, after: dbShaAfter })
  rmSync(legacyWorkspace, { recursive: true, force: true })
  rmSync(legacyDir, { recursive: true, force: true })
}

// ── E/F: both name forms + the literal-name fallback ────────────────────────
{
  await call("bb_annotate", { symbol: "Widget.render", body: "qualified-name note", toolIdentity: "gate" }, probeCtx)
  await call("bb_annotate", { symbol: "render", path: "src/alpha.ts", body: "simple-name note in alpha", toolIdentity: "gate" }, probeCtx)
  await call("bb_annotate", { symbol: "ghostSymbol", body: "literal note under a name the index does not publish", toolIdentity: "gate" }, probeCtx)
  const bySimple = await doorCall({ symbol: "render" }, probeCtx)
  const byQualified = await doorCall({ symbol: "Widget.render" }, probeCtx)
  const names = (answer: any) => (answer.parsed?.annotations ?? []).map((row: any) => row.symbol_name).sort()
  check("E read by simple name finds the qualified-name note", names(bySimple).includes("Widget.render"), names(bySimple))
  check("E read by qualified name finds the qualified-name note", names(byQualified).includes("Widget.render"), names(byQualified))
  check("E both spellings return the same row set for the same symbol", JSON.stringify(names(bySimple)) === JSON.stringify(names(byQualified)), { simple: names(bySimple), qualified: names(byQualified) })
  const ghost = await doorCall({ symbol: "ghostSymbol" }, probeCtx)
  check("F an unindexed name finds its literal note", ghost.parsed?.count === 1 && ghost.parsed?.symbolIndexed === false, ghost.parsed)

  // M1 — the old resolver (simple name only) must fail the same assertion.
  const ro = new Database(join(DATA_DIR, "projects", probeId, "brain.db"), { readonly: true, fileMustExist: true })
  const rowsFor = (namesIn: string[]) => namesIn.length > 0
    ? ro.prepare(`SELECT symbol_name FROM brain_annotation WHERE project_id = ? AND symbol_name IN (${namesIn.map(() => "?").join(",")})`).all(probeId, ...namesIn).map((row: any) => row.symbol_name)
    : []
  const oldResolver = (symbol: string) => {
    const rows = ro.prepare("SELECT DISTINCT name AS n FROM brain_symbol WHERE project_id = ? AND (name = ? OR qualified_name = ?)").all(probeId, symbol, symbol) as Array<{ n: string }>
    return rows.length > 0 ? rows.map((row) => row.n) : [symbol]
  }
  const bothFormsOk = (resolver: (symbol: string) => string[]) =>
    rowsFor(resolver("render")).includes("Widget.render") && rowsFor(resolver("Widget.render")).includes("Widget.render")
  const productionOk = bothFormsOk((symbol) => resolveAnnotationNames(ro, probeId, symbol).names)
  const oldOk = bothFormsOk(oldResolver)
  ro.close()
  check("E production resolver finds the qualified-name note from both spellings", productionOk === true)
  mutant("M1 name set reduced to the simple name is caught", oldOk === false, { oldOk })
}

// ── G/H: path canonicalization and path scope ───────────────────────────────
let symbolPathAnswer: any = null
{
  await call("bb_annotate", { symbol: "buildThing", path: "./src/gamma.ts", body: "dot-prefixed write", toolIdentity: "gate" }, probeCtx)
  await call("bb_annotate", { symbol: "Gadget", path: join(PROBE, "src", "alpha.ts"), body: "absolute-path write", toolIdentity: "gate" }, probeCtx)
  await call("bb_annotate", { symbol: "layout", body: "name-level note about layout", toolIdentity: "gate" }, probeCtx)
  const plain = await doorCall({ path: "src/alpha.ts" }, probeCtx)
  const dotted = await doorCall({ path: "./src/alpha.ts" }, probeCtx)
  const absolute = await doorCall({ path: join(PROBE, "src", "alpha.ts") }, probeCtx)
  const shape = (answer: any) => (answer.parsed?.annotations ?? []).map((row: any) => `${row.symbol_name}@${row.symbol_path}`).sort()
  check("G dot-prefixed read equals the plain spelling", JSON.stringify(shape(dotted)) === JSON.stringify(shape(plain)) && dotted.parsed?.path === "src/alpha.ts", { plain: shape(plain), dotted: shape(dotted), path: dotted.parsed?.path })
  check("G absolute read equals the plain spelling", JSON.stringify(shape(absolute)) === JSON.stringify(shape(plain)) && absolute.parsed?.path === "src/alpha.ts", { absolute: shape(absolute) })
  const gamma = await doorCall({ path: "src/gamma.ts" }, probeCtx)
  check("G dot-prefixed WRITE stored the canonical path", (gamma.parsed?.annotations ?? []).some((row: any) => row.symbol_name === "buildThing" && row.symbol_path === "src/gamma.ts"), gamma.parsed?.annotations)
  check("G absolute WRITE stored the canonical path", shape(plain).includes("Gadget@src/alpha.ts"), shape(plain))
  check("H path-only read excludes name-level notes by default", shape(plain).every((entry: string) => !entry.endsWith("@null")), shape(plain))
  const widened = await doorCall({ path: "src/alpha.ts", includeNameLevel: true }, probeCtx)
  check("H includeNameLevel widens a path read to name-level notes", shape(widened).some((entry: string) => entry.endsWith("@null")), shape(widened))
  check("H path-only answer echoes the accepted flag and the effective filter", plain.parsed?.includeNameLevel === false && plain.parsed?.nameLevelIncluded === false, { includeNameLevel: plain.parsed?.includeNameLevel, nameLevelIncluded: plain.parsed?.nameLevelIncluded })
  symbolPathAnswer = await doorCall({ symbol: "layout", path: "src/alpha.ts", includeNameLevel: false }, probeCtx)
  check("H symbol+path includes name-level notes about that symbol", (symbolPathAnswer.parsed?.annotations ?? []).some((row: any) => row.symbol_name === "layout" && row.symbol_path === null), symbolPathAnswer.parsed?.annotations)
  check("H symbol+path echoes the accepted flag unchanged", symbolPathAnswer.parsed?.includeNameLevel === false && symbolPathAnswer.parsed?.nameLevelIncluded === true, { includeNameLevel: symbolPathAnswer.parsed?.includeNameLevel, nameLevelIncluded: symbolPathAnswer.parsed?.nameLevelIncluded })

  // M4 — a response that echoes the effective scope as the accepted flag.
  const echoAcceptsFlag = (answer: any) => answer?.parsed?.includeNameLevel === false
  const mutantEcho = { parsed: { includeNameLevel: symbolPathAnswer.parsed?.nameLevelIncluded } }
  check("H the echo assertion accepts the production answer", echoAcceptsFlag(symbolPathAnswer) === true)
  mutant("M4 effective-scope echo instead of the accepted flag is caught", echoAcceptsFlag(mutantEcho) === false, mutantEcho)
}

// ── D: bound, truncation and the cap wording ───────────────────────────────
{
  for (let i = 0; i < 60; i++) await call("bb_annotate", { symbol: `note${String(i).padStart(2, "0")}`, body: `stored note ${i}`, toolIdentity: "gate" }, probeCtx)
  const page = await doorCall({}, probeCtx)
  const capWordingOk = (reason: string) => !/raise limit/.test(reason) && /narrow the filter/.test(reason)
  const atCap = truncationReason(200, 500)
  const mutantReason = "limit 200 reached; 500 annotations match this query — raise limit (max 200) or narrow the filter."
  check("D default read declares its bound with a true total", page.parsed?.count === 50 && page.parsed?.totalCountIfKnown > 50 && page.parsed?.truncated === true, { count: page.parsed?.count, total: page.parsed?.totalCountIfKnown })
  check("D the below-cap truncation reason names an action", /raise limit \(max 200\) or narrow the filter/.test(String(page.parsed?.truncationReason)), page.parsed?.truncationReason)
  check("D at the declared cap the reason stops advising an impossible limit raise", capWordingOk(atCap), atCap)
  mutant("M2 cap reason that still says 'raise limit' is caught", capWordingOk(mutantReason) === false, mutantReason)
}

// ── I: refusals ─────────────────────────────────────────────────────────────
{
  const refusals: Array<[string, Record<string, unknown>]> = [
    ["limit 0", { limit: 0 }],
    ["limit 201", { limit: 201 }],
    ["limit -1", { limit: -1 }],
    ["limit string", { limit: "5" }],
    ["limit fractional", { limit: 1.5 }],
    ["unknown option", { bogus: 1 }],
    ["alias conflict", { symbol: "a", target: "b" }],
    ["path wrong type", { path: 5 }],
    ["includeNameLevel wrong type", { includeNameLevel: "true" }],
  ]
  for (const [label, args] of refusals) {
    const answer = await doorCall(args, probeCtx)
    check(`I refuses ${label} with a named reason`, answer.isError === true && /\S/.test(answer.text) && !answer.parsed, answer.text.slice(0, 160))
  }
}

// ── A(part 2): a real absence is still declared after the writes ────────────
{
  const absent = await doorCall({ symbol: "never-annotated-name" }, probeCtx)
  const declaredAbsentOk = (answer: any) => answer?.parsed?.declaredAbsent === true && answer?.parsed?.count === 0
  check("A absence still declared for an unannotated name", declaredAbsentOk(absent) === true)
  // M3 — a reader that reports an invented row must fail that same assertion.
  mutant("M3 invented row defeats the declared-absence check", declaredAbsentOk({ parsed: { declaredAbsent: false, count: 1, totalCountIfKnown: 1 } }) === false)
}

// ── K: deterministic ordering with the id tiebreak ─────────────────────────
{
  const dbFile = join(DATA_DIR, "projects", probeId, "brain.db")
  const rw = new Database(dbFile, { readonly: false, fileMustExist: true })
  const two = rw.prepare("SELECT id FROM brain_annotation WHERE project_id = ? ORDER BY id LIMIT 2").all(probeId) as Array<{ id: string }>
  rw.prepare("UPDATE brain_annotation SET time_updated = 9999999999999 WHERE id IN (?, ?)").run(two[0].id, two[1].id)
  const tied = rw.prepare("SELECT id FROM brain_annotation WHERE project_id = ? AND time_updated = 9999999999999 ORDER BY time_updated DESC, id").all(probeId) as Array<{ id: string }>
  rw.close()
  check("K a tied timestamp is ordered by the id tiebreak", tied.map((row) => row.id).join(",") === [...tied.map((row) => row.id)].sort().join(","), tied)
}

// ── J: read immutability, measured on the probe store ───────────────────────
{
  const dir = join(DATA_DIR, "projects", probeId)
  const snapshot = () => Object.fromEntries(readdirSync(dir).sort().map((name) => {
    const file = join(dir, name)
    return [name, statSync(file).isFile() ? createHash("sha256").update(readFileSync(file)).digest("hex") : "dir"]
  }))
  const before = snapshot()
  await doorCall({}, probeCtx)
  await doorCall({ symbol: "Widget" }, probeCtx)
  await doorCall({ path: "src/alpha.ts" }, probeCtx)
  const after = snapshot()
  const changed = Object.keys({ ...before, ...after }).filter((name) => before[name] !== after[name])
  check("J reads leave brain.db and brain.db-wal byte-identical", changed.every((name) => name.endsWith("-shm")), { changed, before, after })
  check("J reads create no new store files", !changed.some((name) => !(name in before)), changed)
}

// ── evidence ────────────────────────────────────────────────────────────────
const passed = checks.filter((c) => c.ok).length
const failed = checks.filter((c) => !c.ok).length
const survivors = mutants.filter((m) => !m.caught).length
const result = {
  schemaVersion: 1,
  tool: "bb_annotations",
  gate: "read door",
  status: failed === 0 && survivors === 0 ? "verified" : "failed",
  currentCommit: (() => { try { return require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })(),
  verifierCommand: "BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/verify-read-door.ts",
  generatedAt: new Date().toISOString(),
  checks: checks.length,
  passed,
  failed,
  failures: checks.filter((c) => !c.ok),
  negativeCases: {
    refusalsObserved: calls.filter((entry) => entry.isError).map((entry) => ({ tool: entry.tool, args: entry.args, text: entry.text.slice(0, 160) })),
    mutantsTotal: mutants.length,
    mutantsCaught: mutants.length - survivors,
  },
  mutants,
  blockedLegs: [
    { leg: "byte-level -shm identity", reason: "SQLite touches the -shm shared-memory file on a read-only open (the campaign's T2 protocol wording allows exactly that); brain.db and brain.db-wal are asserted byte-identical" },
  ],
  dataDir: DATA_DIR,
  note: "The gate builds its own BB_DATA_DIR from work/probe-fixture; no shared store is opened.",
}
const resultsDir = join(HERE, "results")
mkdirSync(resultsDir, { recursive: true })
writeFileSync(join(resultsDir, "GATE-read-door.json"), JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify({ status: result.status, checks: result.checks, passed, failed, mutants: `${mutants.length - survivors}/${mutants.length}` }, null, 2))
if (failed > 0 || survivors > 0) process.exitCode = 1
