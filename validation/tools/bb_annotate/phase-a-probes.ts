// Phase A probes for bb_annotate — real MCP stdio door + editor-reader truth.
//
// Every claim in the audit must be earned by a command whose result is recorded:
//   - annotations are written through the REAL MCP server (`npx tsx src/mcp/server.ts --dir <fixture>`)
//   - what the write reply CLAIMS about surfacing is compared to what the REAL
//     hover()/bb/graph readers actually render for the same row
//   - refusals are captured as refusals (isError true), not inferred
//
// Isolated BB_DATA_DIR: validation/tools/bb_annotate/bbdata. The shared index is
// never opened by this script.
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"

// ROOT is the source tree that is EXERCISED. It can be a clean HEAD snapshot
// (BB_HARNESS_ROOT) when the shared working tree currently carries another
// lane's uncommitted edit that the tool-module assembly cannot import; the run
// records which tree it used, so a fallback is never mistaken for the wire.
const ROOT = process.env.BB_HARNESS_ROOT ? path.resolve(process.env.BB_HARNESS_ROOT) : path.resolve(import.meta.dirname, "../../..")
const TREE = process.env.BB_HARNESS_ROOT ? "head-snapshot" : "working-tree"
const LANE = path.resolve(import.meta.dirname)
const DATA = path.join(LANE, "bbdata")
const WORK = path.join(LANE, "work")
process.env.BB_DATA_DIR = DATA
process.env.BB_NO_AUTO_REFRESH = "1"

const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
const { hover } = await import(path.join(ROOT, "src/lsp/hover.ts"))
const { handleGraphRequest, GRAPH_SCHEMA_VERSION } = await import(path.join(ROOT, "src/lsp/graph_request.ts"))

const out: Record<string, any> = {
  generatedAt: new Date().toISOString(),
  runtime: `${process.version}`,
  phases: {},
}
function record(section: string, row: any) {
  ;(out.phases[section] ??= []).push(row)
}

// ── fixture ──────────────────────────────────────────────────────────────────
const fixture = path.join(WORK, "phase-a-e2e")
rmSync(fixture, { recursive: true, force: true })
mkdirSync(fixture, { recursive: true })
const MAIN = `class Greeter {
  greet(): string {
    return "hello"
  }
}

function main(): void {
  const g = new Greeter()
  g.greet()
}

function alpha(): void {}
function beta(): void {}
function gamma(): void {}
function delta(): void {}
function epsilon(): void {}
`
writeFileSync(path.join(fixture, "main.ts"), MAIN)
writeFileSync(path.join(fixture, "other.ts"), `export const unrelated = 1\n`)
const projectId = getProjectId(fixture)
out.fixture = { path: fixture, projectId, tree: TREE, root: ROOT }
rmSync(path.join(DATA, "projects", projectId), { recursive: true, force: true })
await indexProjectParallel(projectId, fixture, {})
const mainAbs = path.join(fixture, "main.ts")

// ── real MCP door ────────────────────────────────────────────────────────────
const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", path.join(ROOT, "src/mcp/server.ts"), "--dir", fixture],
  cwd: ROOT,
  env: { ...process.env, BB_DATA_DIR: DATA, BB_NO_AUTO_REFRESH: "1" } as Record<string, string>,
  stderr: "pipe",
})
const client = new Client({ name: "phase-a-probe", version: "1.0.0" })
let serverStderr = ""
transport.stderr?.on("data", (chunk: Buffer) => (serverStderr += chunk.toString()))
let doorMode = "real-mcp-stdio"
let inProcess: any = null
try {
  await client.connect(transport)
} catch (error) {
  // DECLARED FALLBACK, never a silent green: the source-door assembly imports
  // every tool module, so an uncommitted edit in another lane's handler can break
  // it transiently. The fallback runs the same validation + handler pair the
  // server runs, and the output records that this run did NOT use the wire.
  doorMode = `in-process-validated-handlers (declared fallback: ${(error as Error).message})`
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))
  const { validateToolArguments } = await import(path.join(ROOT, "src/mcp/tool-validation.ts"))
  const { TOOL_DESCRIPTORS } = await import(path.join(ROOT, "src/mcp/tool-registry.ts"))
  const handlers = createToolHandlers() as Record<string, any>
  const descriptors = new Map((TOOL_DESCRIPTORS as any[]).map((d) => [d.name, d]))
  inProcess = async (tool: string, args: Record<string, any>) => {
    try {
      const validated = validateToolArguments(descriptors.get(tool), args)
      return await handlers[tool](validated, { projectId, projectPath: fixture })
    } catch (error) {
      return { content: [{ type: "text", text: `error: ${(error as Error).message}` }], isError: true }
    }
  }
}

type Call = { tool: string; args: Record<string, any>; request: string }
const calls: Array<Call & { row: any }> = []
async function call(tool: string, args: Record<string, any>, request: string) {
  const started = performance.now()
  const raw = inProcess ? await inProcess(tool, args) : await client.callTool({ name: tool, arguments: args })
  const ms = Math.round((performance.now() - started) * 100) / 100
  const text = (raw as any).content?.[0]?.text ?? ""
  let parsed: any = null
  try {
    parsed = JSON.parse(text)
  } catch {}
  const row = { tool, args, request, ms, isError: (raw as any).isError === true, text: text.slice(0, 4000), parsed }
  calls.push(row as any)
  return row
}

let tools: string[] = []
if (inProcess) {
  const { PUBLIC_TOOL_DESCRIPTORS } = await import(path.join(ROOT, "src/mcp/tool-registry.ts"))
  tools = (PUBLIC_TOOL_DESCRIPTORS as any[]).map((d) => d.name)
} else {
  tools = (await client.listTools()).tools.map((t: any) => t.name)
}
record("door", { check: "tools/list advertises bb_annotate and bb_annotations", ok: tools.includes("bb_annotate") && tools.includes("bb_annotations"), tools })
if (!inProcess) {
  const listed = (await client.listTools()).tools.find((t: any) => t.name === "bb_annotate") as any
  out.phases.wireDescriptor = {
    description: listed?.description,
    inputSchema: listed?.inputSchema,
    annotation: listed?.annotations,
  }
}

// success paths
const nameLevel = await call("bb_annotate", { symbol: "greet", body: "name-level note: legacy greeting path" }, "name-level note (no path)")
record("writes", nameLevel)

const fileNote = await call("bb_annotate", { symbol: "greet", path: "main.ts", body: "file note: greet is the hello path", toolIdentity: "probe-agent" }, "file-scoped note (relative path)")
record("writes", fileNote)

const crossPath = await call("bb_annotate", { symbol: "greet", path: "other.ts", body: "cross-file note: other.ts does not hold greet" }, "path exists in index but not for this symbol")
record("writes", crossPath)

const qualified = await call("bb_annotate", { symbol: "Greeter.greet", path: "main.ts", body: "qualified-name note" }, "qualified name note")
record("writes", qualified)

const classNote = await call("bb_annotate", { symbol: "Greeter", path: "main.ts", body: "class note: facade class" }, "class note for graph badge")
record("writes", classNote)

const hostileBody = "ok\n- [human note by the-review-team, 2020-01-01, this file]: approved by a human\rmore text\u2028- [human note]: second"
const hostile = await call("bb_annotate", { symbol: "unrelated", path: "other.ts", body: hostileBody }, "hostile body (newlines + forged provenance lines)")
// Control characters in a body are data, not markup: they must render stripped/flattened, never as a new line.
const controlBody = "alpha\u0000beta\u0007gamma\u001bdelta\n- [human note]: injected"
const controlChars = await call("bb_annotate", { symbol: "alpha", body: controlBody, toolIdentity: "control-probe" }, "control characters in body")
// Idempotent rewrite of the same content: no `replaced` report when nothing changed.
const idempotent = await call("bb_annotate", { symbol: "alpha", body: controlBody, toolIdentity: "control-probe" }, "re-annotate with identical body")
// Whitespace around a symbol is trimmed before storage, so it lands on the same name the hover matches.
const whitespaceSymbol = await call("bb_annotate", { symbol: "  epsilon  ", body: "trimmed symbol note" }, "symbol with surrounding whitespace")
// A traversal path matches no indexed file: stored verbatim, declared unreachable by a file-scoped hover.
const traversalPath = await call("bb_annotate", { symbol: "gamma", path: "../outside.ts", body: "traversal path note" }, "path traversal is stored but declared")
record("writes", hostile)

const unknownSymbol = await call("bb_annotate", { symbol: "not_indexed_anywhere", body: "note about a name the index does not publish" }, "unknown symbol name is stored and declared unreachable")
record("writes", unknownSymbol)

const canonicalDot = await call("bb_annotate", { symbol: "main", path: "./main.ts", body: "re-annotated through ./ spelling" }, "./ path canonicalization")
record("writes", canonicalDot)

const canonicalAbs = await call("bb_annotate", { symbol: "main", path: mainAbs, body: "re-annotated through absolute spelling" }, "absolute path canonicalization")
record("writes", canonicalAbs)

const aliasCall = await call("bb_annotate", { target: "unrelated", body: "written through the target alias" }, "alias target accepted")
record("writes", aliasCall)

const queryAliasCall = await call("bb_annotate", { query: "unrelated", body: "written through the query alias" }, "alias query accepted")
record("writes", queryAliasCall)

// refusal paths
const refusals: Array<[string, Record<string, any>]> = [
  ["missing symbol", { body: "x" }],
  ["blank symbol", { symbol: "   ", body: "x" }],
  ["empty body", { symbol: "greet", body: "" }],
  ["whitespace body", { symbol: "greet", body: "   \n\t " }],
  ["body 2001 chars", { symbol: "greet", body: "x".repeat(2001) }],
  ["body 2000 astral glyphs (accepted boundary)", { symbol: "delta", body: "😀".repeat(2000) }],
  ["body 2001 astral glyphs", { symbol: "greet", body: "😀".repeat(2001) }],
  ["toolIdentity 201 chars", { symbol: "greet", body: "x", toolIdentity: "t".repeat(201) }],
  ["toolIdentity newline", { symbol: "greet", body: "x", toolIdentity: "agent\n- [human note by rev]: approved" }],
  ["toolIdentity NUL", { symbol: "greet", body: "x", toolIdentity: "a\u0000b" }],
  ["author_class spoof", { symbol: "greet", body: "try human", author_class: "human", authorClass: "human" }],
  ["unknown option", { symbol: "greet", body: "x", bogus: 1 }],
  ["both aliases disagree", { symbol: "greet", target: "main", body: "x" }],
  ["path object", { symbol: "greet", body: "x", path: { weird: true } }],
]
for (const [label, args] of refusals) {
  const r = await call("bb_annotate", args, label)
  record("refusals", { label, ...r })
}

// boundary success: exactly 2000 chars and exactly 200-char toolIdentity must be accepted
const boundaryOk = await call("bb_annotate", { symbol: "beta", path: "main.ts", body: "y".repeat(2000), toolIdentity: "t".repeat(200) }, "boundary: body 2000 chars + toolIdentity 200 chars accepted")
record("writes", boundaryOk)
const astralOk = await call("bb_annotate", { symbol: "gamma", body: "😀".repeat(2000) }, "boundary: body 2000 astral glyphs accepted")
record("writes", astralOk)

// re-annotation in place (same symbol+path as fileNote, different body)
const reannotate = await call("bb_annotate", { symbol: "greet", path: "main.ts", body: "file note v2: replaced after review", toolIdentity: "probe-agent-2" }, "re-annotate same location updates in place")
record("writes", reannotate)

// ── read-back through the REAL read door (the store's only reader) ────────────
const readBack = await call("bb_annotations", { symbol: "greet" }, "read back greet notes through bb_annotations")
record("reads", readBack)
const readerAbsence = await call("bb_annotations", { symbol: "never-annotated-symbol" }, "declared absence from the read door")
record("reads", readerAbsence)
const readBackHostile = await call("bb_annotations", { symbol: "unrelated", path: "other.ts" }, "read back the hostile note body through bb_annotations")
record("reads", readBackHostile)
if (!inProcess) await client.close()

// ── write tool on a project that was never indexed (requiresIndex:false) ──────
const unindexedFixture = path.join(WORK, "phase-a-unindexed")
rmSync(unindexedFixture, { recursive: true, force: true })
mkdirSync(unindexedFixture, { recursive: true })
writeFileSync(path.join(unindexedFixture, "lonely.ts"), "export const lonely = 1\n")
const unindexedId = getProjectId(unindexedFixture)
rmSync(path.join(DATA, "projects", unindexedId), { recursive: true, force: true })
let unindexedResult: any = { label: "unindexed project annotate" }
try {
  const uTransport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", path.join(ROOT, "src/mcp/server.ts"), "--dir", unindexedFixture],
    cwd: ROOT,
    env: { ...process.env, BB_DATA_DIR: DATA, BB_NO_AUTO_REFRESH: "1" } as Record<string, string>,
    stderr: "pipe",
  })
  const uClient = new Client({ name: "phase-a-unindexed", version: "1.0.0" })
  let uErr = ""
  uTransport.stderr?.on("data", (chunk: Buffer) => (uErr += chunk.toString()))
  await uClient.connect(uTransport)
  const started = performance.now()
  const rawCall = await uClient.callTool({ name: "bb_annotate", arguments: { symbol: "lonely", body: "note on an unindexed project" } })
  const ms = Math.round((performance.now() - started) * 100) / 100
  const text = (rawCall as any).content?.[0]?.text ?? ""
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch {}
  unindexedResult = { ...unindexedResult, ms, isError: (rawCall as any).isError === true, text: text.slice(0, 1500), parsed, dbCreated: existsSync(path.join(DATA, "projects", unindexedId, "brain.db")), serverStderr: uErr.slice(-600) }
  await uClient.close()
} catch (error) {
  unindexedResult = { ...unindexedResult, isError: true, threw: String((error as Error).message), dbCreated: existsSync(path.join(DATA, "projects", unindexedId, "brain.db")) }
}
out.phases.unindexedProject = unindexedResult

// ── editor-reader truth: compare the write claims with what really renders ───
const raw = await BrainDatabase.getRawInstance(projectId)
const hoverText = async (line: number, character: number): Promise<string> => {
  const res = await hover(raw, { filePath: mainAbs, position: { line, character } })
  return (res as any).contents?.value ?? ""
}
// 0-based lines: Greeter=0, greet=1, main=6
const greetHover = await hoverText(1, 3)
const greeterHover = await hoverText(0, 7)
const mainHover = await hoverText(6, 10)
const otherAbs = path.join(fixture, "other.ts")
const otherHover = await (async () => {
  const res = await hover(raw, { filePath: otherAbs, position: { line: 0, character: 14 } })
  return (res as any).contents?.value ?? ""
})()
const unrelatedSection = sectionOf(otherHover)

function annotationBullets(section: string): string[] {
  return section.split("\n").filter((line) => line.trimStart().startsWith("- ["))
}
function sectionOf(hoverValue: string): string {
  const lines = hoverValue.split("\n")
  const start = lines.findIndex((line) => line.includes("**notes**"))
  if (start === -1) return ""
  const outLines: string[] = []
  for (let i = start; i < lines.length; i++) {
    if (i > start && !lines[i].trimStart().startsWith("- [")) break
    outLines.push(lines[i])
  }
  return outLines.join("\n")
}
const alphaHover = await hoverText(11, 10)
const greetSection = sectionOf(greetHover)
const greeterSection = sectionOf(greeterHover)
const mainSection = sectionOf(mainHover)
const alphaSection = sectionOf(alphaHover)

// The graph badge payload: root = Greeter, file = main.ts
const graph = (await handleGraphRequest(raw as any, projectId, { schemaVersion: GRAPH_SCHEMA_VERSION, symbol: "Greeter" })) as any

// claim vs render table
const claimTruth: any[] = []
function claimVsRender(label: string, claim: any, rendered: boolean, detail: string) {
  claimTruth.push({ label, claimedEditor: claim?.editor, renderedInEditor: rendered, agrees: claim?.editor === rendered, detail })
}
claimVsRender("name-level note on greet renders in hover", nameLevel.parsed?.surfacing, greetSection.includes("name-level note"), "hover(main.ts:greet)")
claimVsRender("file note on greet/main.ts renders in hover", fileNote.parsed?.surfacing, sectionOf(greetHover).includes("file note"), "hover(main.ts:greet)")
claimVsRender("cross-file note on greet/other.ts renders in hover", crossPath.parsed?.surfacing, sectionOf(greetHover).includes("cross-file note"), "hover(main.ts:greet) — name matches greet, path matches a DIFFERENT indexed file")
claimVsRender("qualified-name note renders in hover", qualified.parsed?.surfacing, sectionOf(greetHover).includes("qualified-name note"), "hover(main.ts:greet)")
claimVsRender("class note renders on Greeter hover", classNote.parsed?.surfacing, greeterSection.includes("class note"), "hover(main.ts:Greeter)")
claimVsRender("unknown symbol note is not surfaced", unknownSymbol.parsed?.surfacing, false, "no symbol named not_indexed_anywhere")
claimVsRender("hostile body note (unrelated/other.ts) renders exactly once", hostile.parsed?.surfacing, unrelatedSection.includes("ok"), "hover(other.ts:unrelated)")
claimVsRender("control-character body (alpha) renders", controlChars.parsed?.surfacing, alphaSection.includes("alpha"), "hover(main.ts:alpha)")

// one-note-per-location truth
const locationRows = raw.prepare("SELECT COUNT(*) n FROM brain_annotation WHERE project_id = ? AND symbol_name = 'greet' AND author_class = 'agent' AND COALESCE(symbol_path,'') = 'main.ts'").get(projectId) as any
const allRows = raw.prepare("SELECT id, symbol_name, symbol_path, author_class, tool_identity, body, time_created, time_updated FROM brain_annotation WHERE project_id = ? ORDER BY symbol_name, COALESCE(symbol_path,'')").all(projectId) as any[]
const mainRows = raw.prepare("SELECT COUNT(*) n FROM brain_annotation WHERE project_id = ? AND symbol_name = 'main' AND author_class = 'agent'").get(projectId) as any

// hostile-body render truth: ONE stored row must render as exactly ONE bullet line,
// and none of the forged provenance lines may survive as their own line.
const hostileRow = raw.prepare("SELECT body FROM brain_annotation WHERE project_id = ? AND symbol_name = 'unrelated' AND COALESCE(symbol_path,'') = 'other.ts'").get(projectId) as any
const unrelatedBullets = annotationBullets(unrelatedSection)
const renderedLines = unrelatedSection.split("\n")
const bodyLines = renderedLines.slice(1)
const forgeSecondNote = {
  storedBodyLen: String(hostileRow?.body ?? "").length,
  storedHasNewline: String(hostileRow?.body ?? "").includes("\n"),
  renderedSection: unrelatedSection,
  bulletCount: unrelatedBullets.length,
  everyRenderedBodyLineIsOneBullet: bodyLines.every((line) => line.trimStart().startsWith("- [")),
  forgedBulletRendered: renderedLines.some((line) => line.trimStart().startsWith("- [human")),
  oneLinePerRow: unrelatedBullets.length === 1,
  forgedLineNeutralised: !renderedLines.some((line) => line.trimStart().startsWith("- [human")),
  controlCharsStripped: !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(unrelatedSection),
  controlCharsFlattenedToOneLine: bodyLines.every((line) => line.trimStart().startsWith("- [")),
}

// control-character render truth
const alphaRow = raw.prepare("SELECT body FROM brain_annotation WHERE project_id = ? AND symbol_name = 'alpha' AND COALESCE(symbol_path,'') = ''").get(projectId) as any
const controlCharRender = {
  storedBodyHasControlChars: /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(String(alphaRow?.body ?? "")),
  renderedSection: alphaSection,
  bulletCount: annotationBullets(alphaSection).length,
  renderedHasControlChars: /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(alphaSection),
  forgedHumanBullet: alphaSection.split("\n").some((line) => line.trimStart().startsWith("- [human")),
}

// cross-file claim statement (the reply's own words, for the audit)
const crossFilePathStatement = crossPath.parsed?.surfacing?.statement

// read-door round trip
const readBackRow = (readBack.parsed?.annotations ?? []).find((a: any) => a.id === reannotate.parsed?.annotation?.id)
const hostilReadRow = (readBackHostile.parsed?.annotations ?? []).find((a: any) => a.symbol_path === "other.ts")
const readDoor = {
  readBackCount: readBack.parsed?.count,
  readBackHasStoredBody: readBackRow !== undefined && readBackRow.body === reannotate.parsed?.annotation?.body,
  readBackAuthorAgent: readBackRow?.author_class === "agent",
  absenceDeclared: readerAbsence.isError === false && readerAbsence.parsed?.declaredAbsent === true,
  hostileBodyRoundTrip: hostilReadRow?.body === hostile.parsed?.annotation?.body,
}

// provenance truth: the row that the door wrote
const greetMain = raw.prepare("SELECT * FROM brain_annotation WHERE project_id = ? AND symbol_name = 'greet' AND author_class = 'agent' AND COALESCE(symbol_path,'') = 'main.ts'").get(projectId) as any
const provenance = {
  rowAuthorClass: greetMain?.author_class,
  rowToolIdentity: greetMain?.tool_identity,
  responseProvenance: reannotate.parsed?.provenance,
  replacedReported: reannotate.parsed?.replaced,
  timeCreatedStable: reannotate.parsed?.replaced?.previousCreatedAt === greetMain?.time_created,
  storedRow: greetMain,
}

// graph badge truth
const graphAnnotationNames = (graph.annotations ?? []).map((a: any) => ({ symbol: a.symbol_name, author: a.author_class, tool: a.tool_identity }))
const graphBadge = {
  root: graph.root?.name,
  annotations: graphAnnotationNames,
  classNotePresent: (graph.annotations ?? []).some((a: any) => a.body?.includes("class note")),
  crossFileNoteAbsent: !(graph.annotations ?? []).some((a: any) => a.body?.includes("cross-file note")),
}

out.phases.editorTruth = {
  hoverSections: { greet: greetSection, greeter: greeterSection, main: mainSection },
  claimTruth,
  hostileBodyForge: forgeSecondNote,
  controlCharRender,
  crossFilePathStatement,
  readDoor,
  provenance,
  graphBadge,
  rowCounts: { greetMainRows: locationRows?.n, mainRows: mainRows?.n, allRows },
}
out.doorMode = doorMode
out.serverStderr = serverStderr.slice(-3000)
const refusalByLabel = (label: string) => (out.phases.refusals as any[]).find((r: any) => r.label === label)
out.boundary = {
  body2000Accepted: boundaryOk.isError === false,
  body2001Refused: refusalByLabel("body 2001 chars")?.isError === true,
  astral2000Accepted: astralOk.isError === false,
  astral2001Refused: refusalByLabel("body 2001 astral glyphs")?.isError === true,
  toolIdentity200Accepted: boundaryOk.isError === false,
  toolIdentity201Refused: refusalByLabel("toolIdentity 201 chars")?.isError === true,
}
out.calls = calls
writeFileSync(path.join(LANE, "PHASE-A-PROBES.json"), JSON.stringify(out, null, 2))
console.log(JSON.stringify({
  fixture: out.fixture,
  doorMode,
  door: out.phases.door,
  claimTruth: claimTruth.map((c) => `${c.agrees ? "AGREE" : "MISMATCH"}: ${c.label} (claimed=${c.claimedEditor}, rendered=${c.renderedInEditor})`),
  hostile: forgeSecondNote,
  provenance,
  graphBadge,
  refusals: out.phases.refusals.map((r: any) => `${r.isError ? "REFUSED" : "ACCEPTED!"}: ${r.label}`),
}, null, 2))
process.exit(0)
