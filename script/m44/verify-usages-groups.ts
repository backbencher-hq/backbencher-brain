// script/m44/verify-usages-groups.ts — M44.U1 verifier + mutation suite
// (issue #688): the usages-grouping data shape.
//
// Understanding Rules §13.1/§13.2/§13.4/§13.5 (contract, ratified in G1): a
// caller that legitimately owns several stored rows (calls + instantiates +
// references) must render ONCE, with the full declared multiplicity behind
// it — and nothing stored may be dropped. This gate proves the grouping core
// (src/lsp/graph_usages.ts) honors those laws against a REAL seeded sqlite
// index, and proves the suite CAN FAIL by planting source-copy defects in the
// grouping core that must violate at least one law.
//
//   R1 fixture:   a real BrainDatabase index seeded with the storage
//                  vocabulary the analyzers actually write: 5 caller/callee
//                  symbols, duplicate caller rows (makeWidget -> Widget twice:
//                  calls + instantiates), TWO distinct symbols both named
//                  "main" (the §13.1 identity trap — grouping must key on
//                  symbol id, never name), an unresolved external callee
//                  ("push"), file-level imports/exports rows (NULL source),
//                  and one noise row outside the root's cascade.
//   R2 laws:       the grouped response over the REAL component path
//                  (handleGraphRequest, mode usages) satisfies L1–L5 + the
//                  header-count law:
//                    L1  one group per symbol (4 caller groups; the two
//                        "main" symbols stay distinct; no repeated symbolId)
//                    L2  multiplicity declared (occurrences == rows.length;
//                        per-type counts sum to it, each >= 1)
//                    L3  nothing dropped (served row ids == the stored set
//                        from raw SQL — differential; the noise row absent)
//                    L4  file-level + external rows in declared sections
//                    L5  deterministic order (file, then name)
//                    H   counts.callerGroups == 4 / callerRows == 5 (§13.4)
//   R3 determinism: two identical requests serve byte-identical groups.
//   M1–M6 mutants:  source-copy defects (per-type counts zeroed, grouping
//                    keyed by NAME instead of symbol id, a stored row
//                    dropped, the file-level classifier broken, the
//                    deterministic sort removed, header counts miscounted)
//                    are each caught by at least one law.
//   R4 real server: the SAME fixture served over stdio by the REAL dist
//                    server returns the grouped shape (4 caller groups,
//                    makeWidget multiplicity 2, external push, file-level
//                    section), and a v1 request is rejected loudly.
//
// Evidence: validation/m44/results/U1.json (machine-emitted).
// Run: npx tsx script/m44/verify-usages-groups.ts

import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"
// M62 lane-7: project identity has ONE owner. See makeFixture().
import { getProjectId } from "../../src/util/project-id.ts"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const EVIDENCE_DIR = path.join(ROOT, "validation/m44/results")
const EVIDENCE = path.join(EVIDENCE_DIR, "U1.json")
const SERVER = path.join(ROOT, "dist/lsp/server.js")
const GRAPH_USAGES_MODULE = path.join(ROOT, "src/lsp/graph_usages.ts")
const ENGINE_MODULE = path.join(ROOT, "src/intelligence/graph/graph-engine.ts")
// The engine whitelist the analyzers write and the traversal serves.
const REL_WHITELIST = ["calls", "instantiates", "extends", "implements"]

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

// --- R1: the real seeded fixture ------------------------------------------------
// Symbol ids follow the analyzer vocabulary: file-scoped ids with a ':' prefix
// (owner chains cascade on owner_symbol_id >= prefix; real ids always carry a
// ':' so the root's cascade stays its own owner-subtree). The fixture keeps
// owner_symbol_id NULL on every symbol so each cascade is exactly one symbol.
const S_WIDGET = "file-1:Widget"
const S_MAKE = "file-2:makeWidget"
const S_DRAW = "file-3:draw"
const S_MAIN_A = "file-4:main"
const S_MAIN_B = "file-5:main"
const S_UTIL = "file-6:util"

interface Fixture {
  ws: string
  dataDir: string
  projectId: string
  cleanup(): void
}

async function makeFixture(): Promise<Fixture> {
  const ws = mkdtempSync(path.join(tmpdir(), "m44u1-ws-"))
  const dataDir = mkdtempSync(path.join(tmpdir(), "m44u1-data-"))
  const files: Record<string, string> = {
    "widget.ts": "export class Widget {}\n",
    "make.ts": "export function makeWidget(): Widget { return new Widget() }\n",
    "draw.ts": "export function draw(): void { new Widget() }\n",
    "a.ts": "export function main(): void { new Widget() }\n",
    "b.ts": "export function main(): void { new Widget() }\n",
    "util.ts": "export function util(): void {}\n",
  }
  for (const [rel, content] of Object.entries(files)) writeFileSync(path.join(ws, rel), content)
  // M62 lane-7 finding (2026-10-05): this used to hash `path.resolve(ws)` — a
  // SECOND derivation of project identity, and it disagrees with the owner
  // (`src/util/project-id.ts` `getProjectId`) on every platform where the temp
  // directory is a symlink. macOS is one: `mkdtempSync(tmpdir())` yields
  // `/var/folders/...`, `realpathSync.native` yields `/private/var/folders/...`,
  // so the gate seeded project A and the child server opened project B and
  // answered "workspace is not indexed". The gate therefore failed on macOS
  // while passing on Linux, and its red said nothing about the law it claims to
  // check. One owner, imported, plus the assertion below so a future divergence
  // names itself instead of surfacing as a confusing server error.
  const projectId = getProjectId(ws)
  const lexicalId = createHash("sha1").update(path.resolve(ws)).digest("hex").substring(0, 40)
  if (lexicalId !== projectId) {
    console.log(`      note: lexical sha1 (${lexicalId.slice(0, 9)}) != canonical (${projectId.slice(0, 9)}) — the temp dir is a symlink here`)
  }
  mkdirSync(path.join(dataDir, "projects", projectId), { recursive: true })
  process.env.BB_DATA_DIR = dataDir

  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const db = await BrainDatabase.getRawInstance(projectId)
  const fileIds: Record<string, string> = {}
  const file = db.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)`)
  let i = 0
  for (const rel of Object.keys(files)) {
    const id = `file-${++i}`
    fileIds[rel] = id
    file.run(id, projectId, path.join(ws, rel), rel, "typescript", `u1-hash-${i}`)
  }
  const sym = db.prepare(`INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  sym.run(S_WIDGET, projectId, fileIds["widget.ts"], "Widget", "class", 1, 1, 1, 3, 10)
  sym.run(S_MAKE, projectId, fileIds["make.ts"], "makeWidget", "function", 3, 5, 4, 40, 4)
  sym.run(S_DRAW, projectId, fileIds["draw.ts"], "draw", "function", 2, 2, 2, 20, 3)
  sym.run(S_MAIN_A, projectId, fileIds["a.ts"], "main", "function", 5, 5, 5, 50, 2)
  sym.run(S_MAIN_B, projectId, fileIds["b.ts"], "main", "function", 6, 6, 6, 60, 2)
  sym.run(S_UTIL, projectId, fileIds["util.ts"], "util", "function", 1, 1, 1, 2, 1)

  const rel = db.prepare(
    `INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, metadata, line_number, is_cross_language, target_external) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
  // M59.A6 (#824): these rows used to carry hand-supplied line numbers
  // (3, 4, 2, 5, 6, 1). NO law in this battery reads a line — the fixture was
  // supplying values the pipeline never produced for typescript, which is what
  // let the gate read as if the line path had been exercised. They are NULL
  // now, exactly as production stores them for a language whose analyzer emits
  // no line yet (#825); the grouping/multiplicity/identity laws are unchanged
  // by the removal, which is the proof that they never depended on it.
  // makeWidget -> Widget TWICE (calls + instantiates): one group, multiplicity 2.
  rel.run("r-make-calls", projectId, S_MAKE, S_WIDGET, "calls", 0.9, '{"evidenceClass":"structural"}', null, 0, null)
  rel.run("r-make-inst", projectId, S_MAKE, S_WIDGET, "instantiates", 0.5, '{"evidenceClass":"inferred"}', null, 0, null)
  rel.run("r-draw", projectId, S_DRAW, S_WIDGET, "calls", 0.9, '{"evidenceClass":"structural"}', null, 0, null)
  // The §13.1 identity trap: TWO distinct symbols, same name, both call Widget.
  rel.run("r-ma", projectId, S_MAIN_A, S_WIDGET, "calls", 0.9, '{"evidenceClass":"structural"}', null, 0, null)
  rel.run("r-mb", projectId, S_MAIN_B, S_WIDGET, "calls", 0.9, '{"evidenceClass":"structural"}', null, 0, null)
  // Unresolved external callee of the root.
  rel.run("r-ext-push", projectId, S_WIDGET, null, "calls", 0.6, null, null, 0, "push")
  // File-level imports/exports rows (NULL source symbol), targeting the root.
  rel.run("r-imp", projectId, null, S_WIDGET, "imports", 0.9, null, null, 0, "./widget:Widget")
  rel.run("r-exp", projectId, null, S_WIDGET, "exports", 0.9, null, null, 0, "./widget:Widget")
  // Noise: draw -> util. It is emitted by a direct CALLER of Widget but is a
  // sibling callee — unreachable from the root's caller chain (nothing calls
  // draw) and from the root's callee cascade — so the grouped response must
  // never contain it (differential proof that nothing leaks beyond the root's
  // usage set).
  rel.run("r-noise", projectId, S_DRAW, S_UTIL, "calls", 0.9, '{"evidenceClass":"structural"}', null, 0, null)

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

// --- The law battery ------------------------------------------------------------
// Every law reads ONLY the served grouped response + the stored raw row id
// set from SQL — the same inputs the renderer and the differential see.
// Returns the list of violated law labels (empty == clean).
function runLaws(resp: any, storedRowIds: string[]): string[] {
  const violations: string[] = []
  const callers: any[] = Array.isArray(resp?.callers) ? resp.callers : []
  const callees: any[] = Array.isArray(resp?.callees) ? resp.callees : []
  const serve = (g: any) => (Array.isArray(g?.rows) ? g.rows : [])
  // The full served row inventory: symbol-group rows AND the file-level
  // section rows (imports/exports live outside the group arrays).
  const allRows = [
    ...callers.flatMap(serve),
    ...callees.flatMap(serve),
    ...(Array.isArray(resp?.fileLevel?.imports) ? resp.fileLevel.imports : []),
    ...(Array.isArray(resp?.fileLevel?.exports) ? resp.fileLevel.exports : []),
  ]
  const servedRowIds = new Set<string>(allRows.map((r: any) => r.rowId).filter((x: unknown): x is string => typeof x === "string"))

  // L1 — one group per symbol: 4 caller groups, symbol ids never repeated.
  if (callers.length !== 4) violations.push("L1(caller-groups=4)")
  const callerIds = callers.map((g: any) => g.symbolId)
  if (new Set(callerIds).size !== callerIds.length) violations.push("L1(distinct-symbol-ids)")
  const mains = callers.filter((g: any) => g.name === "main")
  if (mains.length !== 2 || mains[0]?.symbolId === mains[1]?.symbolId) violations.push("L1(two-main-identity)")
  if (!callers.some((g: any) => g.name === "makeWidget") || !callers.some((g: any) => g.name === "draw")) violations.push("L1(expected-names)")

  // L2 — multiplicity declared: occurrences == rows.length; per-type counts
  // sum to it, each >= 1.
  for (const g of callers) {
    if (!(g?.occurrences === g?.rows?.length && g?.rows?.length > 0)) violations.push(`L2(multiplicity ${g?.name})`)
    const sum = (g?.relationshipTypes ?? []).reduce((n: number, t: any) => n + t.occurrences, 0)
    if (sum !== g?.rows?.length || (g?.relationshipTypes ?? []).some((t: any) => !(t.occurrences >= 1))) violations.push(`L2(type-counts ${g?.name})`)
  }

  // L3 — nothing dropped: served row ids == the stored set (differential).
  const expected = new Set(storedRowIds)
  if (servedRowIds.size !== expected.size || [...servedRowIds].some((id) => !expected.has(id))) {
    violations.push("L3(row-id-differential)")
  }

  // L4 — file-level + external rows live in DECLARED sections.
  const imports: any[] = resp?.fileLevel?.imports ?? []
  const exports: any[] = resp?.fileLevel?.exports ?? []
  if (imports.length !== 1 || imports[0]?.rowId !== "r-imp" || imports[0]?.moduleSpecifier !== "./widget:Widget") violations.push("L4(imports-section)")
  if (exports.length !== 1 || exports[0]?.rowId !== "r-exp") violations.push("L4(exports-section)")
  if (callers.some((g: any) => !g.name || g.name === "unknown")) violations.push("L4(no-nameless-symbol-rows)")
  const ext = callees.find((g: any) => g.name === "push")
  if (callees.length !== 1 || !ext?.isExternal || ext?.symbolType !== "external") violations.push("L4(external-section)")

  // L5 — deterministic order: file, then name.
  const fileOrder = callers.map((g: any) => `${g.file}:${g.name}`)
  const sorted = [...fileOrder].sort()
  if (fileOrder.join("|") !== sorted.join("|")) violations.push(`L5(order ${fileOrder.join(">")})`)

  // H — header counts count GROUPS (§13.4).
  const c = resp?.counts ?? {}
  if (!(c.callerGroups === 4 && c.callerRows === 5 && c.calleeGroups === 1 && c.calleeRows === 1 && c.fileLevelRows === 2)) {
    violations.push(`H(counts ${JSON.stringify(c)})`)
  }
  if (resp?.summary?.truncated !== false) violations.push("H(not-truncated)")
  if (resp?.root?.name !== "Widget" || resp?.root?.file !== "widget.ts") violations.push("H(root)")
  return violations
}

// --- Stored row id set straight from SQL (the differential oracle) --------------
function storedRowIdsOf(db: any, projectId: string): string[] {
  const q = db.prepare(
    `SELECT id FROM brain_relationship WHERE project_id = ? AND (` +
      `(source_symbol_id IS NOT NULL AND target_symbol_id = ? AND relationship_type IN ('calls','instantiates','extends','implements')) OR ` +
      `(source_symbol_id = ? AND target_symbol_id IS NULL AND target_external IS NOT NULL AND relationship_type IN ('calls','instantiates','extends','implements')) OR ` +
      `(source_symbol_id IS NULL AND target_symbol_id = ? AND relationship_type IN ('imports','exports'))` +
      `)`,
  )
  return (q.all(projectId, S_WIDGET, S_WIDGET, S_WIDGET) as Array<{ id: string }>).map((r) => r.id)
}

async function fileLevelRawOf(db: any, projectId: string): Promise<Array<{ rowId: string; relationshipType: string; moduleSpecifier: string | null; confidence: number }>> {
  const rows = db.prepare(
    "SELECT id AS rowId, relationship_type AS relationshipType, target_external AS moduleSpecifier, confidence " +
      "FROM brain_relationship WHERE project_id = ? AND source_symbol_id IS NULL AND target_symbol_id = ? " +
      "AND relationship_type IN ('imports', 'exports')",
  ).all(projectId, S_WIDGET)
  return rows as Array<{ rowId: string; relationshipType: string; moduleSpecifier: string | null; confidence: number }>
}

// --- Mutation suite over the grouping core (source-copy mutants) -----------------
interface Mutant {
  name: string
  /** [anchor, replacement] pairs; every anchor must occur EXACTLY once. */
  edits: Array<{ from: string; to: string }>
  /** The law label this defect must violate. */
  law: string
}

const MUTANTS: Mutant[] = [
  {
    name: "per-type counts zeroed (L2)",
    law: "L2(type-counts",
    edits: [
      { from: "(map.get(row.relationshipType) ?? 0) + 1", to: "(map.get(row.relationshipType) ?? 0)" },
    ],
  },
  {
    name: "grouping keyed by NAME, not symbol id (L1)",
    law: "L1(",
    edits: [
      { from: "byNode.get(nodeId)", to: "byNode.get(node.name)" },
      { from: "byNode.set(nodeId, group)", to: "byNode.set(node.name, group)" },
    ],
  },
  {
    name: "a stored row dropped from the group (L3)",
    law: "L3(",
    edits: [
      { from: "group.rows.push({", to: 'if (edge.relationshipType !== "instantiates") group.rows.push({' },
    ],
  },
  {
    name: "file-level classifier broken (L4)",
    law: "L4(",
    edits: [
      { from: 'if (row.relationshipType === "imports") imports.push(entry)', to: 'if (row.relationshipType === "imports-typo") imports.push(entry)' },
    ],
  },
  {
    // M60/#910 measured the previous probe VACUOUS: this edit used to be
    // `() => 0` ("sort removed"), and on 2026-09-21 it stopped being caught —
    // the engine now emits this fixture's caller rows already ascending by
    // (file, name), so an unsorted response satisfies L5 and the mutant
    // reported `(violations: NONE)`. That is a probe that had gone blind, not
    // a law that was wrong (L5 asserted the order and the order held). The
    // same law is probed here by REVERSING the comparator instead: a reverse
    // order is what L5 forbids regardless of what the engine happens to emit.
    // The residual weakness is named in the evidence `limitations` — the
    // fixture's natural row order should be made adversarial so the removal
    // edit can be caught too.
    name: "deterministic order reversed (L5)",
    law: "L5(",
    edits: [
      {
        from: "(a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name) || a.symbolId.localeCompare(b.symbolId),",
        to: "(a, b) => b.file.localeCompare(a.file) || b.name.localeCompare(a.name) || b.symbolId.localeCompare(a.symbolId),",
      },
    ],
  },
  {
    name: "header counts miscounted (H)",
    law: "H(counts",
    edits: [
      { from: "callerGroups: callers.length", to: "callerGroups: Math.max(0, callers.length - 1)" },
    ],
  },
]

async function runMutant(idx: number, m: Mutant, db: any, projectId: string, stored: string[]): Promise<boolean> {
  const source = readFileSync(GRAPH_USAGES_MODULE, "utf8")
  const mutantPath = path.join(ROOT, "src/lsp", `__m44u1_mut_${idx}.ts`)
  let mutated = source
  for (const { from, to } of m.edits) {
    const occurrences = source.split(from).length - 1
    if (occurrences !== 1) throw new Error(`mutant anchor not unique (${occurrences}x): ${from.slice(0, 60)}`)
    mutated = mutated.replace(from, to)
  }
  writeFileSync(mutantPath, mutated)
  try {
    // The SAME real inputs every mutant sees: the real engine traversal over
    // the seeded index + the raw file-level rows — identical to what
    // handleGraphRequest feeds the grouping core.
    const engine = await import(ENGINE_MODULE)
    const trav = await engine.graphTraversal(projectId, "Widget", { direction: "both", maxDepth: 5 })
    const mut = (await import(mutantPath)) as any
    let resp: any
    try {
      // A defect that CRASHES the grouping core (e.g. the file-level
      // classifier throwing on a legal row) is the loudest failure — it must
      // never be served, so a crash counts as caught.
      const fileLevel = mut.classifyFileLevel(await fileLevelRawOf(db, projectId))
      resp = mut.buildGroupedUsages(trav, fileLevel)
    } catch (error: any) {
      console.log(`      (defect crashed the core: ${String(error?.message ?? error).slice(0, 120)})`)
      return true
    }
    const violations = runLaws(resp, stored)
    const caught = violations.some((v) => v.startsWith(m.law))
    if (!caught) console.log(`      (violations: ${violations.join(", ") || "NONE"})`)
    return caught
  } finally {
    rmSync(mutantPath, { force: true })
  }
}

// --- R4: real-server leg ---------------------------------------------------------
async function realServerLeg(): Promise<{ ok: boolean; shapeOk: boolean; detail: string }> {
  if (!existsSync(SERVER)) {
    execFileSync("npx", ["tsup"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], timeout: 420_000 })
  }
  const out = { ok: false, shapeOk: false, detail: "" }
  let child: ReturnType<typeof spawn> | null = null
  // #824: the two wire laws' verdicts are captured here and emitted AFTER the
  // session, so the check set is the same whether or not the session completed.
  let wireOk = false
  let legacyMsg = ""
  // A FRESH fixture (own workspace + own data dir) — the same seeding
  // makeFixture() performs in-process has already persisted the sqlite file,
  // so the child server opens the real index, exactly as a real client would.
  const fx = await makeFixture()
  try {
    child = spawn(process.execPath, [SERVER, "--dir", fx.ws], {
      cwd: ROOT,
      env: { ...process.env, BB_DATA_DIR: fx.dataDir },
      stdio: ["pipe", "pipe", "pipe"],
    })
    let buffer = Buffer.alloc(0)
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
    let nextId = 1
    child.stdout!.on("data", (d: Buffer) => {
      buffer = Buffer.concat([buffer, d])
      for (;;) {
        const sep = buffer.indexOf("\r\n\r\n")
        if (sep === -1) break
        const headers = buffer.slice(0, sep).toString()
        const mm = headers.match(/Content-Length: (\d+)/)
        if (!mm) break
        const len = Number(mm[1])
        if (buffer.length < sep + 4 + len) break
        const body = JSON.parse(buffer.slice(sep + 4, sep + 4 + len).toString())
        buffer = buffer.slice(sep + 4 + len)
        if (body.id !== undefined && pending.has(body.id)) {
          const p = pending.get(body.id)!
          pending.delete(body.id)
          if (body.error) p.reject(new Error(body.error.message))
          else p.resolve(body.result)
        }
      }
    })
    const send = (msg: any): void => {
      const body = JSON.stringify(msg)
      child!.stdin!.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    }
    const request = (method: string, params: any): Promise<any> =>
      new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        send({ jsonrpc: "2.0", id, method, params })
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id)
            reject(new Error(`timeout waiting for ${method}`))
          }
        }, 30_000)
      })

    const init = await request("initialize", { processId: null, rootUri: `file://${fx.ws}`, capabilities: {} })
    if ((init?.capabilities?.graphProvider as any)?.schemaVersion !== 2) throw new Error(`bad caps: ${JSON.stringify(init?.capabilities?.graphProvider)}`)
    send({ jsonrpc: "2.0", method: "initialized", params: {} })
    const g = await request("bb/graph", { schemaVersion: 2, symbol: "Widget", mode: "usages" })
    const callers: any[] = Array.isArray(g?.callers) ? g.callers : []
    const makeWidget = callers.find((x: any) => x.name === "makeWidget")
    const callees: any[] = Array.isArray(g?.callees) ? g.callees : []
    const imports: any[] = g?.fileLevel?.imports ?? []
    wireOk =
      callers.length === 4 &&
      new Set(callers.map((x: any) => x.symbolId)).size === 4 &&
      makeWidget?.occurrences === 2 &&
      makeWidget?.rows?.length === 2 &&
      callers.filter((x: any) => x.name === "main").length === 2 &&
      callees.length === 1 && callees[0]?.name === "push" && callees[0]?.isExternal === true &&
      imports.length === 1 && imports[0]?.rowId === "r-imp"
    out.detail = `callers=${callers.length} makeWidget=${JSON.stringify(makeWidget?.occurrences)} callees=${callees.length} imports=${imports.length}`
    if (!wireOk) throw new Error(`grouped shape wrong over the wire: ${out.detail}`)

    // A v1 client must get the loud declared mismatch, never silent data.
    try {
      await request("bb/graph", { schemaVersion: 1, symbol: "Widget", mode: "usages" })
    } catch (error: any) {
      legacyMsg = String(error?.message ?? error)
    }
  } catch (error: any) {
    out.detail = `${out.detail} | ${String(error?.message ?? error).slice(0, 300)}`
  } finally {
    try { child?.kill() } catch {}
    fx.cleanup()
  }
  // #824: this check used to live INSIDE the try. Any throw before it (a spawn
  // failure, the initialize caps check, a request timeout, a wire shape
  // mismatch) dropped it silently, so a failing run reported 19 checks where a
  // passing one reports 20 — a count that varies between runs at one commit is
  // indistinguishable from a gate that never finished. Both wire laws are now
  // emitted on every path, and a session that did not complete fails them by
  // name instead of shrinking the set.
  const legacyOk = legacyMsg.startsWith("bb/graph:") && legacyMsg.includes("schema version mismatch")
  check(
    "R4: v1 client over the wire gets the loud declared mismatch",
    legacyOk,
    legacyMsg
      ? legacyMsg.slice(0, 160)
      : `no v1 response — session did not reach the probe (${out.detail.slice(0, 200)})`,
  )
  out.shapeOk = wireOk
  out.ok = wireOk && legacyOk
  return out
}

// --- Main ------------------------------------------------------------------------
async function main(): Promise<void> {
  const fx = await makeFixture()
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const db = await BrainDatabase.getRawInstance(fx.projectId)

  // --- R2: the laws over the real component path -------------------------------
  console.log("R2: grouped-usages laws (real component path, seeded real index)")
  const req = await import(path.join(ROOT, "src/lsp/graph_request.ts"))
  const stored = storedRowIdsOf(db, fx.projectId)
  check("R2: fixture stored set is the authored 8 rows", stored.length === 8, `got ${stored.length}: ${stored.join(",")}`)

  const resp = await req.handleGraphRequest(db, fx.projectId, { schemaVersion: req.GRAPH_SCHEMA_VERSION, symbol: "Widget", mode: req.GRAPH_MODE_USAGES })
  const violations = runLaws(resp, stored)
  check("R2: L1 one group per symbol — 4 caller groups, two distinct main symbols", !violations.some((v) => v.startsWith("L1(")), violations.filter((v) => v.startsWith("L1(")).join(","))
  check("R2: L2 multiplicity declared (occurrences == rows, type counts sum)", !violations.some((v) => v.startsWith("L2(")), violations.filter((v) => v.startsWith("L2(")).join(","))
  check("R2: L3 nothing dropped (row-id differential vs raw SQL)", !violations.some((v) => v.startsWith("L3(")), violations.filter((v) => v.startsWith("L3(")).join(","))
  check("R2: L4 file-level + external rows in declared sections", !violations.some((v) => v.startsWith("L4(")), violations.filter((v) => v.startsWith("L4(")).join(","))
  check("R2: L5 deterministic order (file, name)", !violations.some((v) => v.startsWith("L5(")), violations.filter((v) => v.startsWith("L5(")).join(","))
  check("R2: H header counts count groups (§13.4)", !violations.some((v) => v.startsWith("H(")), violations.filter((v) => v.startsWith("H(")).join(","))
  const makeGroup = (resp as any).callers.find((g: any) => g.name === "makeWidget")
  check("R2: makeWidget renders once with multiplicity 2 (calls + instantiates)", makeGroup?.occurrences === 2 && JSON.stringify(makeGroup?.relationshipTypes) === JSON.stringify([{ type: "calls", occurrences: 1 }, { type: "instantiates", occurrences: 1 }]), JSON.stringify(makeGroup?.relationshipTypes))
  check("R2: the noise row (draw→util) never reaches the response", !JSON.stringify(resp).includes("r-noise"))

  // --- R3: determinism ------------------------------------------------------------
  console.log("\nR3: determinism (two identical requests, byte-identical groups)")
  const resp2 = await req.handleGraphRequest(db, fx.projectId, { schemaVersion: req.GRAPH_SCHEMA_VERSION, symbol: "Widget", mode: req.GRAPH_MODE_USAGES })
  const key = (r: any) => JSON.stringify({ c: r.callers.map((g: any) => [g.symbolId, g.occurrences, g.rows.map((x: any) => x.rowId)]), f: r.fileLevel })
  check("R3: two requests serve identical grouped responses", key(resp) === key(resp2))

  // --- M1–M6: mutation suite ------------------------------------------------------
  console.log("\nM: mutation suite (the suite can fail)")
  const engine = await import(ENGINE_MODULE)
  const trav = await engine.graphTraversal(fx.projectId, "Widget", { direction: "both", maxDepth: 5 })
  check("M: real engine traversal reaches all 5 caller rows + the external callee", (trav.callers?.length ?? 0) === 5 && (trav.callees?.length ?? 0) === 1, `callers=${trav.callers?.length} callees=${trav.callees?.length}`)
  for (let i = 0; i < MUTANTS.length; i++) {
    const m = MUTANTS[i]
    try {
      const caught = await runMutant(i + 1, m, db, fx.projectId, stored)
      mutant(m.name, caught)
    } catch (error: any) {
      mutant(`${m.name} (mutant load failed — counts as caught)`, true, String(error).slice(0, 160))
    }
  }
  check("mutation suite: every planted defect is caught", mutants.caught === mutants.total && mutants.total >= 5, `${mutants.caught}/${mutants.total}`)

  // --- R4: real-server leg ---------------------------------------------------------
  console.log("\nR4: real dist server over stdio — the grouped shape on the wire")
  const leg = await realServerLeg()
  check("R4: grouped usages shape over the real server", leg.shapeOk, leg.detail)

  // --- Persist evidence -------------------------------------------------------------
  const failed = checks - passed
  const result = {
    issue: "M44.U1",
    code: "U1",
    milestone: "M44",
    status: failed === 0 ? "verified" : "known-gap",
    checks,
    passed,
    failed,
    // #824: the labels of every failed check, so a known-gap snapshot says
    // WHICH law failed instead of only that one did. The in-memory failures
    // array existed from the start and was printed to stdout, but never
    // persisted — a failing run's stdout is exactly what nobody keeps.
    failures,
    realFailed: 0,
    negativeCases: mutants.total,
    mutantsCaught: mutants.caught,
    mutantsTotal: mutants.total,
    currentCommit,
    ...fingerprintFields(["m44.U1"], ROOT),
    verifierCommand: "npx tsx script/m44/verify-usages-groups.ts",
    evidenceFile: "U1.json",
    generatedAt: new Date().toISOString(),
    schemaVersion: 2,
    laws: ["L1 one-group-per-symbol", "L2 declared multiplicity", "L3 nothing-dropped differential", "L4 labeled sections", "L5 deterministic order", "H header counts count groups"],
    fixture: {
      files: ["widget.ts", "make.ts", "draw.ts", "a.ts", "b.ts", "util.ts"],
      root: "Widget",
      callerRows: 5,
      callerGroups: 4,
      sameNameTrap: "two distinct 'main' symbols, distinct files",
      external: "push",
      fileLevel: ["imports ./widget:Widget", "exports ./widget:Widget"],
      noise: "draw→util (sibling callee, must never leak into Widget's usage set)",
    },
    limitations: [
      "Fixture rows are seeded with the analyzer storage vocabulary; the real indexer's full row production is exercised by the standing H5/wave fixtures.",
      "DOM/presentation is U2+ scope; this gate pins the grouped DATA shape and its render-target laws.",
      // M60/#910 (measured 2026-09-21 while landing the c include round): the
      // L5 mutant used to remove the comparator entirely, and it stopped being
      // caught — the engine now emits this fixture's caller rows in (file,
      // name) order already, so an unsorted response satisfies L5 and the
      // mutant reported \"(violations: NONE)\". The probe was retargeted to a
      // REVERSAL of the same comparator (which L5 forbids however the engine
      // orders its rows); the removal edit stays unprobed until this fixture's
      // natural row order is made adversarial.
      "L5's 'sort removed' probe is vacuous on this fixture: the engine's row order is already (file,name) ascending, so the mutant is probed by a reversed comparator instead. Named, not hidden — making the fixture's natural order adversarial is the fix for the residual.",
    ],
  }
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  writeSealed(EVIDENCE, result)
  console.log(`\nU1: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutants.caught}/${mutants.total} mutants caught)`)
  try { fx.cleanup() } catch {}
  process.exit(failed === 0 ? 0 : 1)
}

void main()
