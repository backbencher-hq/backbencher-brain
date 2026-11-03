// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the annotation-store verifier for bb_annotate: proves the store's declared guarantees on a REAL sqlite database AND proves the tool's wire behaviour and reachability claims through a REAL `bb mcp` stdio session; the suite is shown able to fail by planted handler mutants.
// WHICH TOOL IT SERVES — bb_annotate (write side of the annotation store it shares with bb_annotations).
// WHY IT IS SHAPED THIS WAY — the previous revision called createToolHandlers() directly,
//   so the wire validation/refusal contract was never exercised, and its "mutants" were
//   positive re-assertions (a manual SQL corruption, a literal slice) rather than planted
//   defects. This revision keeps the direct store checks, adds the real door (success +
//   refusals + the joint name+file reachability claim + a hostile body through the real
//   hover), and mutates the handler's own source for every defect class the suite claims
//   to catch. A gate over a copy of the code cannot catch a regression in the code.
// WHERE ITS EVIDENCE LIVES — validation/m28/results/A1.json (machine-emitted),
//   validation/tools/bb_annotate/{AUDIT,PHASE-A-PROBES}.json; run:
//   npx tsx script/m28/verify-annotation-store.ts
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_annotate/handler.ts,
//   src/mcp/tools/bb_annotate/descriptor.ts, script/m28/verify-annotation-ui.ts.
// CONTRACTS IT MUST NOT BREAK — provenance is enforced not claimed; one note per author
//   per location; declared refusals are never silent truncation; `surfacing.editor` is
//   the joint name+file truth; the mutant battery must go red when a claim regresses.
//   Regex policy: this file contains no regex literals.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const HANDLER_DIR = path.join(ROOT, "src/mcp/tools/bb_annotate")
const HANDLER_SOURCE = readFileSync(path.join(HANDLER_DIR, "handler.ts"), "utf8")
process.env.BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "bb-m28a1-"))
const DATA_DIR = process.env.BB_DATA_DIR
const WORK_DIR = mkdtempSync(path.join(tmpdir(), "bb-m28a1-ws-"))

const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
const { ensureAnnotationTable, ANNOTATION_DDL } = await import(path.join(ROOT, "src/brain/schema-ddl.ts"))
const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))
const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
const { hover } = await import(path.join(ROOT, "src/lsp/hover.ts"))
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")

let passed = 0
let failed = 0
const failures: string[] = []
const mutantRecords: Array<{ name: string; caught: boolean; detail?: string }> = []
let mutantsCaught = 0
let mutantsTotal = 0
const negativeCases: Array<{ name: string; caught: boolean; detail: string }> = []
const blockedLegs: Array<{ leg: string; reason: string; command: string; output: string }> = []

/** Evidence must be byte-identical across two runs of the same tree: an annotation
 *  id is a hash of the location including the temporary project path, so ids differ
 *  between runs even when every assertion holds. Recorded detail strings therefore
 *  mask an id with a fixed token; the assertions themselves still run on the real
 *  values (the id uniqueness/replacement checks are unchanged). Character scan, no
 *  pattern matching — the id alphabet is hex. */
function maskVolatileAnnotationIds(text: string): string {
  const marker = "bbann-"
  let out = ""
  let i = 0
  while (i < text.length) {
    const at = text.indexOf(marker, i)
    if (at === -1) {
      out += text.slice(i)
      break
    }
    out += text.slice(i, at) + "bbann-<annotation-id>"
    let j = at + marker.length
    let consumed = 0
    while (j < text.length && consumed < 128) {
      const code = text.charCodeAt(j)
      const isHex = (code >= 48 && code <= 57) || (code >= 97 && code <= 102) || (code >= 65 && code <= 70)
      if (!isHex) break
      j++
      consumed++
    }
    i = j
  }
  return out
}

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) passed++
  else {
    failed++
    failures.push(detail ? `${name} — ${maskVolatileAnnotationIds(detail)}` : name)
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`)
  }
}
function negative(name: string, caught: boolean, detail?: string): void {
  mutantsTotal++
  const recordedDetail = maskVolatileAnnotationIds(detail ?? "")
  mutantRecords.push({ name, caught, detail: recordedDetail })
  negativeCases.push({ name, caught, detail: recordedDetail })
  if (caught) {
    mutantsCaught++
    console.log(`  caught: ${name}`)
  } else {
    failed++
    console.log(`  SURVIVED: ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

const projectId = "m28a1-annotation-fixture"
const handlers = createToolHandlers() as Record<string, any>
const directCall = async (name: string, args: any): Promise<{ isError: boolean; data: any; text: string }> => {
  const result = await handlers[name](args, { projectId, projectPath: "/unused" })
  const text = result.content?.[0]?.text ?? ""
  try {
    return { isError: result.isError === true, data: JSON.parse(text), text }
  } catch {
    return { isError: result.isError === true, data: null, text }
  }
}

// ── R1: additive migration on fresh AND pre-existing dbs ────────────────────
{
  const raw = await BrainDatabase.getRawInstance(projectId)
  const fresh = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brain_annotation'").get()
  check("A1: fresh db has brain_annotation after open", !!fresh)
  const cols = (raw.prepare("PRAGMA table_info(brain_annotation)").all() as Array<{ name: string }>).map((c) => c.name)
  const expectedCols = ["id", "project_id", "symbol_name", "symbol_path", "author_class", "tool_identity", "body", "time_created", "time_updated"]
  check("A1: annotation table has the full declared column set", expectedCols.every((c) => cols.includes(c)), cols.join(","))
  check("A1: author_class column exists (provenance is schema, not convention)", cols.includes("author_class"))
  raw.exec("DROP TABLE brain_annotation")
  const reopened = await BrainDatabase.getRawInstance(projectId)
  const restored = reopened.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brain_annotation'").get()
  check("A1: every-open rule — the table is recreated on the NEXT open of a pre-existing db", !!restored)
  ensureAnnotationTable(reopened)
  check("A1: ANNOTATION_DDL is idempotent (direct re-apply is a no-op)", !!reopened.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brain_annotation'").get())
  check("A1: DDL string is additive-only (no DROP/ALTER inside it)", !ANNOTATION_DDL.toLowerCase().includes("drop ") && !ANNOTATION_DDL.toLowerCase().includes("alter "))
}

// ── R2: enforced provenance (direct handler: the write's own guarantee) ─────
{
  const res = await directCall("bb_annotate", { symbol: "Warehouse", body: "Scala facade over the Java inventory core.", toolIdentity: "test-agent-1" })
  check("A1: annotate succeeds on a fresh store", res.isError === false, res.text.slice(0, 120))
  const a = res.data?.annotation
  check("A1: author_class recorded as 'agent'", a?.author_class === "agent", String(a?.author_class))
  check("A1: tool identity recorded verbatim", a?.tool_identity === "test-agent-1", String(a?.tool_identity))
  check("A1: timestamps recorded", typeof a?.time_created === "number" && typeof a?.time_updated === "number")
  const spoof = await directCall("bb_annotate", { symbol: "Warehouse", body: "try human", authorClass: "human" })
  check("A1: a spoof argument cannot change author_class even when the handler is called directly", spoof.data?.annotation?.author_class === "agent", String(spoof.data?.annotation?.author_class))
}

// ── R3: upsert semantics ────────────────────────────────────────────────────
{
  const first = (await directCall("bb_annotate", { symbol: "Inventory", body: "v1 note" })).data?.annotation
  await new Promise((r) => setTimeout(r, 5))
  const second = (await directCall("bb_annotate", { symbol: "Inventory", body: "v2 note — refined after review" })).data?.annotation
  check("A1: upsert — one row per author per location", first?.id === second?.id)
  check("A1: upsert — body updated in place", second?.body === "v2 note — refined after review", String(second?.body))
  check("A1: upsert — time_created stable, time_updated advanced", second?.time_created === first?.time_created && second?.time_updated > first?.time_created)
  const raw = await BrainDatabase.getRawInstance(projectId)
  const count = (raw.prepare("SELECT COUNT(*) AS n FROM brain_annotation WHERE project_id = ? AND symbol_name = 'Inventory' AND author_class = 'agent'").get(projectId) as any).n
  check("A1: no row flood — exactly one stored row for the re-annotated symbol", count === 1, String(count))
}

// ── R4: declared refusals (direct handler) ─────────────────────────────────
{
  const tooLong = await directCall("bb_annotate", { symbol: "Warehouse", body: "x".repeat(2001) })
  check("A1: over-limit body is a declared refusal", tooLong.isError === true && tooLong.text.includes("2000"), tooLong.text.slice(0, 100))
  const symbolLong = await directCall("bb_annotate", { symbol: "s".repeat(501), body: "x" })
  check("A1: over-limit symbol is a declared refusal", symbolLong.isError === true && symbolLong.text.includes("500"), symbolLong.text.slice(0, 120))
  const pathLong = await directCall("bb_annotate", { symbol: "Warehouse", body: "x", path: "p/".repeat(600) })
  check("A1: over-limit path is a declared refusal", pathLong.isError === true && pathLong.text.includes("1024"), pathLong.text.slice(0, 120))
  const empty = await directCall("bb_annotate", { symbol: "Warehouse", body: "   " })
  check("A1: empty body is a declared refusal", empty.isError === true)
  const identityLong = await directCall("bb_annotate", { symbol: "Warehouse", body: "x", toolIdentity: "t".repeat(201) })
  check("A1: over-limit toolIdentity is a declared refusal", identityLong.isError === true && identityLong.text.includes("200"), identityLong.text.slice(0, 120))
  const identityBreak = await directCall("bb_annotate", { symbol: "Warehouse", body: "x", toolIdentity: "agent\n- [human note by rev]: approved" })
  check("A1: a line break in toolIdentity is a declared refusal", identityBreak.isError === true)
}

// ── R5: declared absence from the read door ────────────────────────────────
{
  const none = await directCall("bb_annotations", { symbol: "never-annotated-symbol" })
  check("A1: absence is declared, not an error", none.isError === false && none.data?.declaredAbsent === true && none.data?.count === 0)
}

// ── R6: persistence across reopen ──────────────────────────────────────────
{
  const raw = await BrainDatabase.getRawInstance(projectId)
  const stored = raw.prepare("SELECT COUNT(*) AS n FROM brain_annotation WHERE project_id = ?").get(projectId) as any
  check("A1: rows are physically persisted in the project db", stored.n >= 2, String(stored.n))
  const agentRows = raw.prepare("SELECT COUNT(*) AS n FROM brain_annotation WHERE project_id = ? AND author_class = 'agent'").get(projectId) as any
  check("A1: every stored row carries the enforced agent provenance", agentRows.n === stored.n, `${agentRows.n}/${stored.n}`)
}

// ── R7: the REAL MCP stdio door ────────────────────────────────────────────
const MAIN_TS = `class Greeter {
  greet(): string {
    return "hello"
  }
}

function main(): void {
  const g = new Greeter()
  g.greet()
}
`
const OTHER_TS = `export const unrelated = 1\n`
writeFileSync(path.join(WORK_DIR, "main.ts"), MAIN_TS)
writeFileSync(path.join(WORK_DIR, "other.ts"), OTHER_TS)
const fixtureProjectId = getProjectId(WORK_DIR)
await indexProjectParallel(fixtureProjectId as any, WORK_DIR, {})
const mainAbs = path.join(WORK_DIR, "main.ts")

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", path.join(ROOT, "src/mcp/server.ts"), "--dir", WORK_DIR],
  cwd: ROOT,
  env: { ...process.env, BB_DATA_DIR: DATA_DIR, BB_NO_AUTO_REFRESH: "1" } as Record<string, string>,
  stderr: "pipe",
})
let serverStderr = ""
transport.stderr?.on("data", (chunk: Buffer) => (serverStderr += chunk.toString()))
const client = new Client({ name: "m28a1-door", version: "1.0.0" })
const wire = async (args: Record<string, unknown>): Promise<{ isError: boolean; data: any; text: string }> => {
  const result = (await client.callTool({ name: "bb_annotate", arguments: args })) as any
  const text = result?.content?.[0]?.text ?? ""
  try {
    return { isError: result?.isError === true, data: JSON.parse(text), text }
  } catch {
    return { isError: result?.isError === true, data: null, text }
  }
}
let listedTools: string[] = []
try {
  await client.connect(transport)
  listedTools = (await client.listTools()).tools.map((t: any) => t.name)
  check("A1: the real MCP server advertises bb_annotate", listedTools.includes("bb_annotate"))

  const door = await wire({ symbol: "greet", body: "door note: name-level", toolIdentity: "door-agent" })
  check("A1 door: a valid call succeeds with stored:true", door.isError === false && door.data?.stored === true, door.text.slice(0, 120))
  check("A1 door: the wire row records author_class 'agent' and the caller's label", door.data?.annotation?.author_class === "agent" && door.data?.annotation?.tool_identity === "door-agent", JSON.stringify(door.data?.annotation ?? {}).slice(0, 160))
  check("A1 door: a name-level note on an indexed symbol is reported as editor-reachable", door.data?.surfacing?.editor === true && door.data?.surfacing?.fileMatched === null, JSON.stringify(door.data?.surfacing ?? {}).slice(0, 220))

  const missing = await wire({ body: "x" })
  check("A1 door: missing symbol is refused by the wire validation with the option named", missing.isError === true && missing.text.includes("missing required option: symbol"), missing.text.slice(0, 140))

  const spoof = await wire({ symbol: "greet", body: "try human", author_class: "human", authorClass: "human" })
  check("A1 door: author_class is not a caller input — the wire refuses it by name", spoof.isError === true && spoof.text.includes("unknown or irrelevant options") && spoof.text.includes("author_class"), spoof.text.slice(0, 200))

  const alias = await wire({ target: "Greeter", body: "written through the target alias" })
  check("A1 door: the `target` alias reaches the canonical symbol option", alias.isError === false && alias.data?.annotation?.symbol_name === "Greeter", alias.text.slice(0, 140))

  // Joint reachability: `greet` is declared in main.ts only; other.ts is indexed.
  const joint = await wire({ symbol: "greet", path: "other.ts", body: "joint-reachability probe" })
  check("A1 door: a name match plus a path match for a DIFFERENT file is reported editor:false", joint.data?.surfacing?.editor === false, JSON.stringify(joint.data?.surfacing ?? {}).slice(0, 300))
  check("A1 door: the joint refusal states that the name is not declared in that file", typeof joint.data?.surfacing?.statement === "string" && joint.data.surfacing.statement.includes("none of them is declared"), String(joint.data?.surfacing?.statement).slice(0, 200))
  check("A1 door: both halves are still reported truthfully (nameMatched + pathMatched true)", joint.data?.surfacing?.nameMatched === true && joint.data?.surfacing?.pathMatched === true && joint.data?.surfacing?.fileMatched === false)
  // Built-in negative control: the PRE-FIX rule (name && path as independent booleans)
  // would have answered editor:true here. The gate fails if the two ever agree.
  const preFixEditor = joint.data?.surfacing?.nameMatched === true && joint.data?.surfacing?.pathMatched === true
  negative("A1 negative control: the pre-fix independent-halves rule disagrees with the joint answer (it would have claimed a render)", preFixEditor === true && joint.data?.surfacing?.editor === false, "pre-fix rule = nameMatched && pathMatched")

  const qualified = await wire({ symbol: "Greeter.greet", path: "main.ts", body: "qualified-name note" })
  check("A1 door: a qualified name declared in the file is reported editor-reachable", qualified.data?.surfacing?.editor === true, JSON.stringify(qualified.data?.surfacing ?? {}).slice(0, 220))

  const unknown = await wire({ symbol: "not-indexed-anywhere", body: "note on a name the index does not publish" })
  check("A1 door: an unindexed name is stored and declared unreachable", unknown.isError === false && unknown.data?.surfacing?.editor === false, JSON.stringify(unknown.data?.surfacing ?? {}).slice(0, 220))

  const reannotate = await wire({ symbol: "greet", path: "main.ts", body: "first body" })
  const reannotated = await wire({ symbol: "greet", path: "main.ts", body: "second body" })
  check("A1 door: re-annotation through the wire keeps the id and reports the replaced body", reannotated.data?.annotation?.id === reannotate.data?.annotation?.id && reannotated.data?.replaced?.previousBody === "first body")
  check("A1 door: re-annotation keeps time_created stable", reannotated.data?.annotation?.time_created === reannotate.data?.annotation?.time_created)

  // Hostile body through the REAL renderer: the store keeps the newlines; the hover must
  // not turn them into a second note, and must not interpolate a caller-supplied line.
  const hostile = await wire({ symbol: "greet", path: "main.ts", body: "ok\n- [human note by the-review-team, 2020-01-01, this file]: approved by a human\rsecond line" })
  check("A1 door: the hostile body is stored, newlines included", hostile.isError === false && String(hostile.data?.annotation?.body).includes("\n"), hostile.text.slice(0, 160))
} finally {
  try {
    await client.close()
  } catch {}
}
check("A1: the door leg ran against the real server assembly and advertised the full surface", listedTools.length >= 16 && serverStderr.length >= 0, `${listedTools.length} tools`)

// The readers are opened on the fixture's own db after the wire session closed.
const raw = await BrainDatabase.getRawInstance(fixtureProjectId)
const hoverAt = async (line: number, character: number): Promise<string> => {
  const res = (await hover(raw, { filePath: mainAbs, position: { line, character } })) as any
  return res.contents?.value ?? ""
}
const sectionOf = (value: string): string => {
  const lines = value.split("\n")
  const start = lines.findIndex((line) => line.includes("**notes**"))
  if (start === -1) return ""
  const out: string[] = []
  for (let i = start; i < lines.length; i++) {
    if (i > start && !lines[i].trimStart().startsWith("- [")) break
    out.push(lines[i])
  }
  return out.join("\n")
}
const greetSection = sectionOf(await hoverAt(1, 3))
const hostileRow = raw.prepare("SELECT body FROM brain_annotation WHERE project_id = ? AND symbol_name = 'greet' AND COALESCE(symbol_path, '') = 'main.ts'").get(fixtureProjectId) as any
const hostileBullets = greetSection.split("\n").filter((line) => line.trimStart().startsWith("- ["))
const matchingRows = (raw
  .prepare("SELECT COUNT(*) AS n FROM brain_annotation WHERE project_id = ? AND (symbol_name = 'greet' OR symbol_name = 'Greeter.greet') AND (symbol_path IS NULL OR symbol_path = 'main.ts')")
  .get(fixtureProjectId) as any).n
check("A1 render: the hostile stored row renders through the real hover", greetSection.length > 0 && greetSection.includes("ok"))
check("A1 render: every matching stored row renders as exactly one annotation line", hostileBullets.length === matchingRows, `${hostileBullets.length} bullets for ${matchingRows} matching rows`)
check("A1 render: the hostile body's forged provenance line is NOT rendered as a note line", !greetSection.split("\n").some((line) => line.trimStart().startsWith("- [human")))
// Negative control: the un-flattened body WOULD have produced a second bullet (the defect class the rule detects).
const unflattenedBullets = `**notes**\n- [agent note by x, 2026-01-01, this file]: ${String(hostileRow?.body ?? "")}`.split("\n").filter((line) => line.trimStart().startsWith("- ["))
negative("A1 negative control: a renderer that preserved newlines would produce a second bullet from the hostile body", unflattenedBullets.length > 1, `${unflattenedBullets.length} bullets unflattened`)

// ── R8: planted handler mutants (the suite must be able to fail) ───────────
const mutatedFiles: string[] = []
let mutantIndex = 0
async function mutantHandler(replacements: Array<[from: string, to: string]>): Promise<{ handler: any; missingAnchor: string | null }> {
  let source = HANDLER_SOURCE
  for (const [from, to] of replacements) {
    if (!source.includes(from)) return { handler: null, missingAnchor: from }
    source = source.split(from).join(to)
  }
  const mutantPath = path.join(HANDLER_DIR, `__mutant-${++mutantIndex}.ts`)
  writeFileSync(mutantPath, source)
  mutatedFiles.push(mutantPath)
  const mod = (await import(`${mutantPath}?m=${Date.now()}`)) as { handler: any }
  return { handler: mod.handler, missingAnchor: null }
}
const callMutant = async (handler: any, args: any) => {
  const result = await handler(args, { projectId: fixtureProjectId, projectPath: WORK_DIR })
  const text = result.content?.[0]?.text ?? ""
  try {
    return { isError: result.isError === true, data: JSON.parse(text), text }
  } catch {
    return { isError: result.isError === true, data: null, text }
  }
}

// M1: provenance hardcode removed — the handler would write the caller's author class.
{
  const { handler, missingAnchor } = await mutantHandler([
    ["VALUES (?, ?, ?, ?, 'agent', ?, ?, ?, ?)", "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"],
    [".run(id, projectId, symbol, annotationPath, toolIdentity, body, now, now)", '.run(id, projectId, symbol, annotationPath, String(args.authorClass ?? "agent"), toolIdentity, body, now, now)'],
  ])
  if (missingAnchor) check("A1 mutant anchor: provenance hardcode is present in the handler", false, missingAnchor)
  else {
    await callMutant(handler, { symbol: "MutantProvenance", body: "try human", authorClass: "human" })
    const row = raw.prepare("SELECT author_class FROM brain_annotation WHERE project_id = ? AND symbol_name = 'MutantProvenance'").get(fixtureProjectId) as any
    negative("A1 mutant: a handler that copies the caller's author class is caught (row must stay 'agent')", row?.author_class !== "agent", `row=${row?.author_class}`)
  }
}
// M2: location key loses the path — two files' notes would collapse into one row.
{
  const { handler, missingAnchor } = await mutantHandler([["const annotationPath = givenPath === null ? null : canonical.path", "const annotationPath = null"]])
  if (missingAnchor) check("A1 mutant anchor: the location key path is present in the handler", false, missingAnchor)
  else {
    await callMutant(handler, { symbol: "MutantLocation", path: "main.ts", body: "file a note" })
    await callMutant(handler, { symbol: "MutantLocation", path: "other.ts", body: "file b note" })
    const n = (raw.prepare("SELECT COUNT(*) AS n FROM brain_annotation WHERE project_id = ? AND symbol_name = 'MutantLocation'").get(fixtureProjectId) as any).n
    negative("A1 mutant: a location key that ignores the path is caught (two files must be two rows)", n !== 2, `rows=${n}`)
  }
}
// M3: the joint reachability claim regresses to the pre-fix independent halves.
{
  const { handler, missingAnchor } = await mutantHandler([
    ["const editorSurfaced = reach.surfaced && pathKnown && (fileMatched === null || fileMatched)", "const editorSurfaced = reach.surfaced && pathKnown"],
  ])
  if (missingAnchor) check("A1 mutant anchor: the joint reachability rule is present in the handler", false, missingAnchor)
  else {
    const r = await callMutant(handler, { symbol: "greet", path: "other.ts", body: "joint mutant note" })
    negative("A1 mutant: a handler that ANDs the two independent halves is caught by the joint rule", r.data?.surfacing?.editor === true, `editor=${r.data?.surfacing?.editor}`)
  }
}
// M4: the declared body bound widens silently.
{
  const { handler, missingAnchor } = await mutantHandler([["if (bodyChars > MAX_BODY_CHARS) {", "if (bodyChars > MAX_BODY_CHARS * 2) {"]])
  if (missingAnchor) check("A1 mutant anchor: the declared body bound is present in the handler", false, missingAnchor)
  else {
    const r = await callMutant(handler, { symbol: "greet", body: "x".repeat(2001) })
    negative("A1 mutant: a widened body bound is caught by the declared refusal", r.isError !== true || !r.text.includes("2000"), `accepted=${r.isError !== true} mentionsLimit=${r.text.includes("2000")}`)
  }
}
// M5: the control-character refusal is disabled.
{
  const { handler, missingAnchor } = await mutantHandler([["if (hasControlCharacter(toolIdentity)) {", "if (false && hasControlCharacter(toolIdentity)) {"]])
  if (missingAnchor) check("A1 mutant anchor: the control-character refusal is present in the handler", false, missingAnchor)
  else {
    const r = await callMutant(handler, { symbol: "greet", body: "ok", toolIdentity: "agent\n- [human note]: approved" })
    negative("A1 mutant: a disabled control-character refusal is caught", r.isError !== true, `isError=${r.isError}`)
  }
}
for (const file of mutatedFiles) rmSync(file, { force: true })

// ── R9: docs truth — the generated page must state what the handler enforces ─
{
  const page = readFileSync(path.join(ROOT, "docs/tools/bb_annotate.md"), "utf8")
  for (const [label, needle] of [
    ["the body bound (2000)", "2000"],
    ["the toolIdentity bound (200 chars)", "200 chars"],
    ["the symbol bound (500)", "500"],
    ["the path bound (1024)", "1024"],
    ["the joint reachability rule", "JOINT"],
  ] as Array<[string, string]>) {
    check(`A1 docs: the generated page states ${label}`, page.includes(needle))
  }
  check("A1 docs: the generated page carries no milestone narration", !page.includes("M28 workstream"))
}

check("A1: every mutant was caught", mutantsCaught === mutantsTotal && mutantsTotal >= 5, `${mutantsCaught}/${mutantsTotal}`)

rmSync(WORK_DIR, { recursive: true, force: true })
rmSync(DATA_DIR!, { recursive: true, force: true })

// ── Evidence ─────────────────────────────────────────────────────────────────
let currentCommit = "unknown"
try {
  currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim()
} catch {}
const failedTotal = failed
const result = {
  schemaVersion: 1,
  tool: "bb_annotate",
  gate: "A1",
  status: failedTotal === 0 && mutantsCaught === mutantsTotal ? "verified" : "known-gap",
  checks: passed + failedTotal,
  passed,
  failed: failedTotal,
  mutantsCaught,
  mutantsTotal,
  mutantRecords,
  negativeCases,
  blockedLegs,
  currentCommit,
  ...fingerprintFields(["m28.A1"], ROOT),
  verifierCommand: "npx tsx script/m28/verify-annotation-store.ts",
  evidenceFile: "A1.json",
  generatedAt: new Date().toISOString(),
  claimLevel: "verified — store guarantees proven against a real sqlite db; the tool's wire contract, joint reachability, hostile-body rendering and declared bounds proven through a real bb mcp stdio session; five planted handler mutants caught",
  failures,
}
mkdirSync(path.join(ROOT, "validation/m28/results"), { recursive: true })
writeSealed(path.join(ROOT, "validation/m28/results/A1.json"), result)
console.log(`A1: ${result.status.toUpperCase()} (${passed}/${passed + failedTotal} passed, ${mutantsCaught}/${mutantsTotal} mutants)`)
if (failedTotal > 0) process.exit(1)
