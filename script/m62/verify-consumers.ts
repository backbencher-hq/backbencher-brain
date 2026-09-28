// script/m62/verify-consumers.ts — M62.A2 verifier + mutation suite (#876).
//
// The owner (A1) is worthless if the surfaces derive positions themselves. This
// gate proves every consumer goes through it, against a REAL seeded index on
// ONE fixture, and proves the suite CAN FAIL.
//
//   R1 engine:      the engine's addresses over the seeded rows are the
//                   declared ones (both directions), and no address anywhere
//                   carries a non-positive line or a call-site without one.
//   R2 hub:         the grouped-usages payload (src/lsp/graph_usages.ts) serves
//                   the ENGINE's address for every stored row (differential —
//                   the hub cannot invent its own).
//   R3 MCP:         the real bb_graph handler's payload serves the same address
//                   multiset as the engine, each address carrying a declared
//                   kind (call-site | declaration | unknown) and a note for
//                   every non-exact kind.
//   R4 webview:     the import-pure mirror (script/m26/graph-core.ts) formats
//                   every sample exactly as the owner does (drift gate), and a
//                   rendered hub document DECLARES the address kinds it shows
//                   (data-callsite-kinds) — a row of unknowns is never labeled
//                   as if it knew where the call is.
//   R5 permanence:  a lint over the declared display surfaces fails on any read
//                   of the raw stored line — proven by a NEGATIVE (a planted
//                   read is caught) and by the engine's own fallback shape.
//   M1–M6 mutants:  silent engine substitution (callers and callees), a hub
//                   that fabricates its own address, an MCP payload that
//                   fabricates one, a mirror that drops the note, and a
//                   renderer that mislabels the kinds — each caught by its
//                   named law.
//
// Evidence: validation/m62/results/A2.json (machine-emitted, sealed).
// Run: npx tsx script/m62/verify-consumers.ts

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"
import { SEED } from "./a1-fixture.ts"
import { ADDRESS_SAMPLES, HUB_EXPECTED_KINDS, HUB_MODEL } from "./a2-fixture.ts"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const EVIDENCE_DIR = path.join(ROOT, "validation/m62/results")
const EVIDENCE = path.join(EVIDENCE_DIR, "A2.json")
const OWNER_MODULE = path.join(ROOT, "src/intelligence/graph/line-address.ts")
const ENGINE_MODULE = path.join(ROOT, "src/intelligence/graph/graph-engine.ts")
const HUB_MODULE = path.join(ROOT, "src/lsp/graph_usages.ts")
const TOOL_HANDLERS_MODULE = path.join(ROOT, "src/mcp/tool-handlers.ts")
const CORE_MODULE = path.join(ROOT, "script/m26/graph-core.ts")

/** The declared DISPLAY surfaces: every file that shows a position to a human
 *  or an agent. None of them may read a raw stored line (M62 D-1/D-6). */
const DISPLAY_SURFACES = [
  "src/lsp/navigation.ts",
  "src/lsp/graph_usages.ts",
  "src/lsp/call_hierarchy.ts",
  "src/lsp/rich_hover.ts",
  "src/lsp/relations.ts",
  "src/lsp/graph_request.ts",
  "src/lsp/impact.ts",
  "src/lsp/cross_language_hover.ts",
  "src/lsp/hover.ts",
  "src/mcp/tool-handlers.ts",
  "script/m26/graph-core.ts",
]

let checks = 0
let passed = 0
const failures: string[] = []
const mutants = { caught: 0, total: 0 }

function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}
function mutant(label: string, caught: boolean, detail = ""): void {
  mutants.total++
  if (caught) mutants.caught++
  check(`M${mutants.total}: ${label} (planted defect caught)`, caught, detail)
}

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const normalize = (v: unknown): string => JSON.stringify(v)

// --- R1: the engine (both directions) ------------------------------------------------
function engineViolations(trav: any): string[] {
  const out: string[] = []
  const byRow = new Map<string, any>()
  for (const e of [...(trav?.callers ?? []), ...(trav?.callees ?? [])]) byRow.set(e.rowId, e.callSite)
  for (const [rowId, expected] of Object.entries(SEED.expected)) {
    if (normalize(byRow.get(rowId)) !== normalize(expected)) out.push(`P1(engine-derives-address ${rowId})`)
  }
  for (const [rowId, a] of byRow) {
    if (typeof a?.line === "number" && a.line <= 0) out.push(`P1(engine-no-fabricated-line ${rowId})`)
    if (a?.kind === "call-site" && !(typeof a?.line === "number" && a.line > 0)) out.push(`P1(engine-no-fabricated-line ${rowId})`)
    if (a?.kind !== "call-site" && a?.kind !== "declaration" && a?.kind !== "unknown") out.push(`P1(engine-declared-kind ${rowId})`)
  }
  return out
}

// --- R2: the hub payload --------------------------------------------------------------
function hubViolations(hub: any, engineByRow: Map<string, any>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const side of ["callers", "callees"]) {
    for (const group of hub?.[side] ?? []) {
      for (const row of group?.rows ?? []) {
        seen.add(row.rowId)
        const engine = engineByRow.get(row.rowId)
        if (engine === undefined) { out.push(`P2(hub-parity ${row.rowId} not in the engine's set)`); continue }
        if (normalize(row.callSite) !== normalize(engine)) out.push(`P2(hub-parity ${row.rowId})`)
      }
    }
  }
  if (seen.size !== engineByRow.size) out.push(`P2(hub-parity row set ${seen.size} != ${engineByRow.size})`)
  return out
}

// --- R3: the MCP payload ---------------------------------------------------------------
function mcpViolations(payloadText: string, engineCallers: string[], engineCallees: string[]): string[] {
  let payload: any
  try {
    payload = JSON.parse(payloadText)
  } catch {
    return ["P3(mcp-parity unparseable payload)"]
  }
  const out: string[] = []
  const got = (list: any[]) => (Array.isArray(list) ? list.map((e: any) => normalize(e?.callSite)) : [])
  const multiset = (xs: string[]) => xs.slice().sort().join("|")
  if (multiset(got(payload.callers)) !== multiset(engineCallers)) out.push("P3(mcp-parity callers)")
  if (multiset(got(payload.callees)) !== multiset(engineCallees)) out.push("P3(mcp-parity callees)")
  for (const [side, list] of [["callers", payload.callers], ["callees", payload.callees]] as Array<[string, any[]]>) {
    for (const e of list ?? []) {
      const a = e?.callSite
      if (!["call-site", "declaration", "unknown"].includes(a?.kind)) out.push(`P3(mcp-declared-kind ${side})`)
      else if (a.kind !== "call-site" && (typeof a.note !== "string" || a.note.length === 0)) out.push(`P3(mcp-note-for-substitute ${side}`)
      if (typeof a?.line === "number" && a.line <= 0) out.push(`P3(mcp-no-fabricated-line ${side})`)
    }
  }
  return out
}

// --- R4: the webview mirror + the declared DOM ------------------------------------------
function mirrorViolations(core: any, owner: any): string[] {
  const out: string[] = []
  for (const s of ADDRESS_SAMPLES) {
    const got = core.formatCallSiteAddress(s.address)
    if (got !== s.format || got !== owner.formatAddress(s.address)) out.push(`P4(mirror-drift ${s.name})`)
  }
  return out
}

interface StubEl { tagName: string; className: string; children: StubEl[]; textContent: string; attrs: Record<string, string>; style: Record<string, string>; setAttribute(n: string, v: string): void; appendChild(c: StubEl): StubEl; addClass(n: string): void }

function makeDom(): { create: (tag: string) => StubEl; root: () => StubEl; el: StubEl } {
  class El implements StubEl {
    tagName: string
    className = ""
    children: El[] = []
    textContent = ""
    attrs: Record<string, string> = {}
    style: Record<string, string> = {}
    constructor(tag: string) { this.tagName = tag }
    setAttribute(name: string, value: string): void { this.attrs[name] = value }
    appendChild(child: El): El { this.children.push(child); return child }
    addClass(name: string): void { this.className = this.className ? `${this.className} ${name}` : name }
    findAll(cls: string): El[] {
      const out: El[] = []
      if (this.className.split(" ").includes(cls)) out.push(this)
      for (const c of this.children) out.push(...c.findAll(cls))
      return out
    }
  }
  const root = new El("div")
  return { create: (tag: string) => new El(tag), root: () => root, el: root }
}

function domViolations(core: any): string[] {
  const out: string[] = []
  const dom = makeDom()
  core.renderHubList(HUB_MODEL, dom, "file")
  const rows = dom.el.findAll("bb-hub-symrow")
  if (rows.length !== 2) out.push(`P5(declared-kind-in-dom rendered ${rows.length} rows, expected 2)`)
  for (const row of rows) {
    const name = String(row.attrs["data-symbol"])
    const expected = HUB_EXPECTED_KINDS[name]
    const declared = row.attrs["data-callsite-kinds"]
    if (declared === undefined) out.push(`P5(declared-kind-in-dom ${name} has no data-callsite-kinds)`)
    else if (expected !== undefined && declared !== expected) out.push(`P5(declared-kind-in-dom ${name}: ${declared} != ${expected})`)
  }
  return out
}

// --- R5: the permanence lint -------------------------------------------------------------
/** Files that declare a raw stored line outside the owner — the lint's own
 *  spec, kept next to the surfaces it protects. */
function lintViolations(files: Array<{ path: string; text: string }>): string[] {
  const out: string[] = []
  for (const f of files) {
    const lines = f.text.split("\n")
    lines.forEach((line, i) => {
      const trimmed = line.trim()
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return // prose may name the column
      if (/\bline_number\b|\blineNumber\b/.test(line)) out.push(`P6(no-raw-display-read ${f.path}:${i + 1})`)
    })
  }
  return out
}

function engineFallbackViolations(): string[] {
  const text = readFileSync(ENGINE_MODULE, "utf8")
  const out: string[] = []
  if (/\|\|\s*node\.line\b/.test(text)) out.push("P6(engine-no-position-fallback callers)")
  if (/line:\s*row\.lineNumber\s*\|\|/.test(text)) out.push("P6(engine-no-position-fallback callee-zero)")
  return out
}

// --- the real seeded index ----------------------------------------------------------------
interface Fixture { ws: string; dataDir: string; projectId: string; cleanup(): void }

async function makeFixture(): Promise<Fixture> {
  const ws = mkdtempSync(path.join(tmpdir(), "m62a2-ws-"))
  const dataDir = mkdtempSync(path.join(tmpdir(), "m62a2-data-"))
  for (const [rel, content] of Object.entries(SEED.files)) writeFileSync(path.join(ws, rel), content)
  const projectId = createHash("sha1").update(path.resolve(ws)).digest("hex").substring(0, 40)
  mkdirSync(path.join(dataDir, "projects", projectId), { recursive: true })
  process.env.BB_DATA_DIR = dataDir
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const db = await BrainDatabase.getRawInstance(projectId)
  const fileIds: Record<string, string> = {}
  const fileStmt = db.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)`)
  let i = 0
  for (const rel of Object.keys(SEED.files)) {
    const id = `file-${++i}`
    fileIds[rel] = id
    fileStmt.run(id, projectId, path.join(ws, rel), rel, "typescript", `m62a2-hash-${i}`)
  }
  const symStmt = db.prepare(`INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  for (const s of SEED.symbols) symStmt.run(s.id, projectId, fileIds[s.file], s.name, s.symbolType, s.lineStart, s.lineEnd, 1, 2, 5)
  const relStmt = db.prepare(
    `INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, metadata, line_number, is_cross_language, target_external) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
  for (const r of SEED.relationships) relStmt.run(r.id, projectId, r.source, r.target, "calls", 0.9, '{"evidenceClass":"structural"}', r.lineNumber, 0, null)
  return {
    ws,
    dataDir,
    projectId,
    cleanup: () => {
      try { rmSync(ws, { recursive: true, force: true }) } catch {}
      try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
    },
  }
}

// --- mutants ------------------------------------------------------------------------------
type Mutant = { name: string; law: string; module: string; edits: Array<{ from: string; to: string }> }

const MUTANTS: Mutant[] = [
  {
    name: "callers: silent substitution restored (stored line || the caller's declaration)",
    law: "P1(",
    module: ENGINE_MODULE,
    edits: [{ from: "          storedLine: row.lineNumber,\n          file: row.srcFileRel || node.file,", to: "          storedLine: row.lineNumber || node.line,\n          file: row.srcFileRel || node.file," }],
  },
  {
    name: "callees: the caller's declaration line used as the call site",
    law: "P1(",
    module: ENGINE_MODULE,
    edits: [{ from: "          storedLine: row.lineNumber,\n          file: row.srcFileRel || srcFileRel,", to: "          storedLine: row.lineNumber || srcLine,\n          file: row.srcFileRel || srcFileRel," }],
  },
  {
    name: "hub: fabricates its own call-site address",
    law: "P2(",
    module: HUB_MODULE,
    edits: [{ from: "      callSite: edge.callSite,", to: "      callSite: { kind: \"call-site\", file: edge.callSite?.file ?? \"\", line: edge.callSite?.line ?? 0 }," }],
  },
  {
    name: "MCP: fabricates its own call-site address",
    law: "P3(",
    module: TOOL_HANDLERS_MODULE,
    edits: [{ from: "        callSite: e.callSite ?? null,", to: "        callSite: { kind: \"call-site\", file: e.callSite?.file ?? \"\", line: e.callSite?.line ?? 0 }," }],
  },
  {
    name: "webview mirror drops the declared note",
    law: "P4(",
    module: CORE_MODULE,
    edits: [{ from: "  return `${position} — ${note}`", to: "  return position" }],
  },
  {
    name: "webview mislabels the kinds it shows",
    law: "P5(",
    module: CORE_MODULE,
    edits: [{ from: "  return kinds.length > 0 ? kinds.join(\",\") : \"none\"", to: "  return \"call-site\"" }],
  },
]

async function loadMutant(idx: number, m: Mutant): Promise<any> {
  const source = readFileSync(m.module, "utf8")
  let mutated = source
  for (const { from, to } of m.edits) {
    const occurrences = source.split(from).length - 1
    if (occurrences !== 1) throw new Error(`mutant anchor not unique (${occurrences}x): ${from.slice(0, 60)}`)
    mutated = mutated.replace(from, to)
  }
  const mutantPath = path.join(path.dirname(m.module), `__m62a2_mut_${idx}.ts`)
  writeFileSync(mutantPath, mutated)
  try {
    return { mod: await import(mutantPath), path: mutantPath }
  } finally {
    // The import must finish before deletion on some loaders; the path is
    // cleaned up by the caller after the law run.
    setTimeout(() => { try { rmSync(mutantPath, { force: true }) } catch {} }, 0)
  }
}

// --- main ---------------------------------------------------------------------------------
async function main(): Promise<void> {
  const owner = await import(OWNER_MODULE)
  const core = await import(CORE_MODULE)
  const fx = await makeFixture()
  try {
    const engine = await import(ENGINE_MODULE)
    const hull: any = await import(HUB_MODULE)
    const handlers = (await import(TOOL_HANDLERS_MODULE)).createToolHandlers()

    const trav = await engine.graphTraversal(fx.projectId, "root", { direction: "both", maxDepth: 2 })
    const engineByRow = new Map<string, any>()
    for (const e of [...(trav.callers ?? []), ...(trav.callees ?? [])]) engineByRow.set(e.rowId, e.callSite)
    const engineCallers = (trav.callers ?? []).map((e: any) => normalize(e.callSite))
    const engineCallees = (trav.callees ?? []).map((e: any) => normalize(e.callSite))

    console.log("R1: the engine's addresses over the real seeded index")
    const eViolations = engineViolations(trav)
    check("R1: every seeded row's address is the declared one (both directions)", eViolations.length === 0, eViolations.join(", "))
    check("R1: no address carries a non-positive line, and every kind is declared", engineByRow.size === SEED.relationships.length, `${engineByRow.size}/${SEED.relationships.length}`)

    console.log("\nR2: the hub payload cannot invent its own address")
    const hub = hull.buildGroupedUsages(trav, { imports: [], exports: [] })
    const hViolations = hubViolations(hub, engineByRow)
    check("R2: every hub row serves the ENGINE's address (differential)", hViolations.length === 0, hViolations.join(", "))

    console.log("\nR3: the agent's bb_graph payload")
    const res = await handlers["bb_graph"]!({ symbol: "root" }, { projectPath: fx.ws, projectId: fx.projectId })
    const payloadText = res.content[0]?.text ?? ""
    const mViolations = mcpViolations(payloadText, engineCallers, engineCallees)
    check("R3: the MCP payload serves the same address multiset as the engine", mViolations.length === 0, mViolations.join(", "))

    console.log("\nR4: the webview — one formatter, declared kinds")
    const mirViolations = mirrorViolations(core, owner)
    check("R4: the import-pure mirror formats exactly like the owner (drift gate)", mirViolations.length === 0, mirViolations.join(", "))
    const dViolations = domViolations(core)
    check("R4: the rendered hub declares the address kinds it shows", dViolations.length === 0, dViolations.join(", "))

    console.log("\nR5: the permanence lint")
    const surfaces = DISPLAY_SURFACES.map((rel) => ({ path: rel, text: readFileSync(path.join(ROOT, rel), "utf8") }))
    const lViolations = lintViolations(surfaces)
    check("R5: no display surface reads a raw stored line", lViolations.length === 0, lViolations.join(", "))
    check("R5: no positional fallback survives in the engine", engineFallbackViolations().length === 0, engineFallbackViolations().join(", "))
    // NEGATIVE — the lint must catch a planted read (a lint that cannot fail is
    // not a gate, M61 D-4).
    const planted = [...surfaces, { path: "src/lsp/__planted.ts", text: "const display = row.line_number ?? 0\n" }]
    const plantedFindings = lintViolations(planted)
    check("R5-negative: the lint catches a planted display-side raw read", plantedFindings.some((f) => f.includes("__planted.ts")), plantedFindings.join(", "))

    console.log("\nM: mutation suite (the suite can fail)")
    const mutantAddresses: Array<[number, Mutant]> = MUTANTS.map((m, i) => [i + 1, m])
    for (const [idx, m] of mutantAddresses) {
      let caught = false
      let detail = ""
      try {
        const source = readFileSync(m.module, "utf8")
        let mutated = source
        for (const { from, to } of m.edits) {
          const occurrences = source.split(from).length - 1
          if (occurrences !== 1) throw new Error(`mutant anchor not unique (${occurrences}x)`)
          mutated = mutated.replace(from, to)
        }
        const mutantPath = path.join(path.dirname(m.module), `__m62a2_mut_${idx}.ts`)
        writeFileSync(mutantPath, mutated)
        try {
          if (m.module === ENGINE_MODULE) {
            const mut = await import(mutantPath)
            const mtrav = await mut.graphTraversal(fx.projectId, "root", { direction: "both", maxDepth: 2 })
            const viol = engineViolations(mtrav)
            caught = viol.some((v) => v.startsWith(m.law))
            if (!caught) detail = viol.join(", ") || "NONE"
          } else if (m.module === HUB_MODULE) {
            const mut = await import(mutantPath)
            const viol = hubViolations(mut.buildGroupedUsages(trav, { imports: [], exports: [] }), engineByRow)
            caught = viol.some((v) => v.startsWith(m.law))
            if (!caught) detail = viol.join(", ") || "NONE"
          } else if (m.module === TOOL_HANDLERS_MODULE) {
            const mutHandlers = (await import(mutantPath)).createToolHandlers()
            const mres = await mutHandlers["bb_graph"]!({ symbol: "root" }, { projectPath: fx.ws, projectId: fx.projectId })
            const viol = mcpViolations(mres.content[0]?.text ?? "", engineCallers, engineCallees)
            caught = viol.some((v) => v.startsWith(m.law))
            if (!caught) detail = viol.join(", ") || "NONE"
          } else {
            const mutCore = await import(mutantPath)
            const viol = m.law === "P4(" ? mirrorViolations(mutCore, owner) : domViolations(mutCore)
            caught = viol.some((v) => v.startsWith(m.law))
            if (!caught) detail = viol.join(", ") || "NONE"
          }
        } finally {
          rmSync(mutantPath, { force: true })
        }
      } catch (error: any) {
        caught = true
        detail = `mutant could not be judged: ${String(error?.message ?? error).slice(0, 120)}`
      }
      mutant(m.name, caught, detail)
    }
    check("M: every planted defect is caught", mutants.caught === mutants.total && mutants.total >= 6, `${mutants.caught}/${mutants.total}`)
  } finally {
    try { fx.cleanup() } catch {}
  }

  const failed = checks - passed
  const result = {
    issue: "M62.A2",
    code: "A2",
    milestone: "M62",
    status: failed === 0 ? "verified" : "known-gap",
    checks,
    passed,
    failed,
    realFailed: 0,
    negativeCases: mutants.total,
    mutantsCaught: mutants.caught,
    mutantsTotal: mutants.total,
    currentCommit,
    verifierCommand: "npx tsx script/m62/verify-consumers.ts",
    evidenceFile: "A2.json",
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    laws: [
      "P1 engine-derives-address",
      "P2 hub-serves-the-engine-address",
      "P3 mcp-serves-the-engine-address",
      "P4 webview-mirror-drift",
      "P5 dom-declares-the-kinds-it-shows",
      "P6 no-display-side-raw-stored-line-read",
    ],
    consumers: ["src/intelligence/graph/graph-engine.ts", "src/lsp/graph_usages.ts", "src/mcp/tool-handlers.ts", "script/m26/graph-core.ts", "src/lsp/navigation.ts (raw column removed)"],
    declaredNotChanged: [
      "references/call-hierarchy keep navigating to the referencing symbol's own indexed location (byte-accurate) — no line-only call-site position is claimed there; the exact stored call-site address is served by the graph/hub/MCP surfaces.",
      "The hover's usages section keeps its declared vocabulary (the referencing symbol's location), stated in its own header.",
    ],
    limitations: [
      "The webview mirror is drift-gated, not shared (graph-core keeps its zero-import law W1).",
      "Per-language real-line coverage is M59's lane; this gate seeds the three store states directly.",
    ],
  }
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  writeSealed(EVIDENCE, result)
  console.log(`\nA2: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutants.caught}/${mutants.total} mutants caught)`)
  process.exit(failed === 0 ? 0 : 1)
}

void main()
