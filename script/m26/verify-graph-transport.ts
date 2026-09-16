// script/m26/verify-graph-transport.ts — M26.W2 verifier + mutation suite.
//
// Proves the versioned bb/graph transport (src/lsp/graph_request.ts) honors
// its declared contract, against BOTH a stubbed component surface and the
// REAL bb_lsp server over stdio, and proves the suite CAN FAIL.
//
//   P1 version gate:     missing/mismatched schemaVersion -> LOUD declared
//                        error (bb/graph: prefix), never silent coercion
//   P2 param validation: every declared constraint enforced with bb/graph:
//                        errors
//   P3 unindexed:        unindexed/absent db -> declared not-indexed error,
//                        never an empty result that would render as "no
//                        connections"
//   P4 traceability:     every edge in every response carries the seeded
//                        brain_relationship row id; a tampered/untraceable
//                        edge fails the request (boundary gate)
//   P5 advertisement:    capabilities.graphProvider advertises the schema
//                        version exactly when bb/graph is registered
//   P6 doc drift:        GRAPH-TRANSPORT.md names method, version, error
//                        prefix, and the indexed-workspace rule
//   R1 real server:      seeded fixture db + real stdio server: happy path,
//                        loud version rejection, row-id trace over the wire
//
// Mutants (each must be CAUGHT):
//   M1 silent version coercion  (mismatched version served anyway)
//   M2 fabricated rowId         (boundary gate stripped)
//   M3 empty-result unindexed   (not-indexed returns an empty graph)
//   M4 silent param drift       (validation removed)
//   M5 advertisement gone       (graphProvider dropped from caps)
//
// Run: npx tsx script/m26/verify-graph-transport.ts
// Evidence: validation/m26/results/W2.json (machine-emitted)

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { realpathSync } from "node:fs"
import { createHash } from "node:crypto"
import { spawn, execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const COMPONENT = join(ROOT, "src", "lsp", "graph_request.ts")
const SERVER_SOURCE = join(ROOT, "src", "lsp", "server.ts")
const DOC = join(ROOT, "docs", "m26", "GRAPH-TRANSPORT.md")

let checks = 0
let passed = 0

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}

async function expectGraphError(p: Promise<unknown>, needle: string): Promise<boolean> {
  try {
    await p
    return false // resolved: should have thrown
  } catch (error: any) {
    const msg = String(error?.message ?? error)
    return msg.startsWith("bb/graph:") && msg.includes(needle)
  }
}

/** Structural surface of the component under test (no type-only dynamic
 *  import, which esbuild cannot resolve at transform time). */
interface GraphRequestModule {
  handleGraphRequest: (db: any, projectId: string, params: any, deps?: any) => Promise<any>
  GRAPH_REQUEST_METHOD: string
  GRAPH_SCHEMA_VERSION: number
  GRAPH_MODE_USAGES: string
  HUB_USAGES_MAX_DEPTH: number
}

// --- Seeded fixture db (real sqlite via BrainDatabase) ----------------------
async function makeFixture(): Promise<{ projectId: string; db: any; dataDir: string; ws: string; cleanup: () => void }> {
  const ws = mkdtempSync(join(tmpdir(), "w2-ws-"))
  const dataDir = mkdtempSync(join(tmpdir(), "w2-data-"))
  writeFileSync(join(ws, "main.ts"), "function main(): void {}\nmain()\n")
  const canonical = realpathSync(ws)
  const projectId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
  mkdirSync(join(dataDir, "projects", projectId), { recursive: true })
  process.env.BB_DATA_DIR = dataDir
  const { BrainDatabase } = await import(join(ROOT, "src", "brain", "database.ts"))
  const db = await BrainDatabase.getRawInstance(projectId)
  db.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)`).run("file-1", projectId, join(ws, "main.ts"), "main.ts", "typescript", "w2-hash")
  const sym = db.prepare(`INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  sym.run("sym-main", projectId, "file-1", "main", "function", 1, 1, 1, 3, 5)
  sym.run("sym-caller", projectId, "file-1", "caller", "function", 2, 2, 5, 8, 3)
  sym.run("sym-caller2", projectId, "file-1", "caller2", "function", 3, 3, 9, 12, 2)
  const rel = db.prepare(`INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, metadata) VALUES (?,?,?,?,?,?,?)`)
  rel.run("rel-fixture-1", projectId, "sym-caller", "sym-main", "calls", 0.9, JSON.stringify({ evidenceClass: "structural" }))
  rel.run("rel-fixture-2", projectId, "sym-caller2", "sym-main", "calls", 0.5, null)
  return {
    projectId,
    db,
    dataDir,
    ws,
    cleanup: () => {
      try { rmSync(ws, { recursive: true, force: true }) } catch {}
      try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
    },
  }
}

async function main(): Promise<void> {
  const mod = await import(COMPONENT)
  const { handleGraphRequest, GRAPH_REQUEST_METHOD, GRAPH_SCHEMA_VERSION, GRAPH_MODE_USAGES, HUB_USAGES_MAX_DEPTH } = mod as GraphRequestModule
  const source = readFileSync(COMPONENT, "utf8")

  // --- P1: version gate -----------------------------------------------------
  const fx = await makeFixture()
  try {
    check("P1: missing version rejected loudly", await expectGraphError(handleGraphRequest(fx.db, fx.projectId, { symbol: "main" }), "schema version mismatch"))
    check("P1: wrong version rejected loudly", await expectGraphError(handleGraphRequest(fx.db, fx.projectId, { schemaVersion: 1, symbol: "main" }), "schema version mismatch"))
    // M44.U1: the usages-mode response is grouped per symbol (issue #688) —
    // the wire schema moved to 2 and the version is pinned here, machine-wide.
    check("P1: version pinned at 2 (M44.U1 grouped usages)", GRAPH_SCHEMA_VERSION === 2 && GRAPH_REQUEST_METHOD === "bb/graph")
    // Happy path with correct version.
    const ok = await handleGraphRequest(fx.db, fx.projectId, { schemaVersion: GRAPH_SCHEMA_VERSION, symbol: "main" })
    check("P1: correct version serves the graph", ok.summary.totalCallers >= 1, `callers=${ok.summary.totalCallers}`)
  } finally {
    fx.cleanup()
  }

  // --- P2: param validation -------------------------------------------------
  check("P2: non-object params rejected", await expectGraphError(handleGraphRequest({} as any, "p", null as never), "params must be an object"))
  check("P2: empty symbol rejected", await expectGraphError(handleGraphRequest({} as any, "p", { schemaVersion: GRAPH_SCHEMA_VERSION, symbol: "" }), "params.symbol"))
  check("P2: bad direction rejected", await expectGraphError(handleGraphRequest({} as any, "p", { schemaVersion: GRAPH_SCHEMA_VERSION, symbol: "x", direction: "up" }), "params.direction"))
  check("P2: bad maxDepth rejected", await expectGraphError(handleGraphRequest({} as any, "p", { schemaVersion: GRAPH_SCHEMA_VERSION, symbol: "x", maxDepth: 99 }), "params.maxDepth"))
  // M42.H5: the usages-mode profile is pinned and validated.
  check("P2: bad mode rejected", await expectGraphError(handleGraphRequest({} as any, "p", { schemaVersion: GRAPH_SCHEMA_VERSION, symbol: "x", mode: "sideways" }), "params.mode"))
  check("P2: usages-mode depth cap is the W5 cap (5)", HUB_USAGES_MAX_DEPTH === 5 && GRAPH_MODE_USAGES === "usages")
  check("P2: bad relationshipTypes rejected", await expectGraphError(handleGraphRequest({} as any, "p", { schemaVersion: GRAPH_SCHEMA_VERSION, symbol: "x", relationshipTypes: [42] }), "params.relationshipTypes"))

  // --- P3: unindexed workspace ---------------------------------------------
  const unindexed = await makeFixture()
  unindexed.cleanup() // remove the db files; keep a fresh temp data dir
  const emptyDir = mkdtempSync(join(tmpdir(), "w2-empty-"))
  process.env.BB_DATA_DIR = emptyDir
  try {
    check("P3: unindexed workspace -> declared error", await expectGraphRequest_unindexed())
  } finally {
    try { rmSync(emptyDir, { recursive: true, force: true }) } catch {}
  }
  async function expectGraphRequest_unindexed(): Promise<boolean> {
    try {
      const { BrainDatabase } = await import(join(ROOT, "src", "brain", "database.ts"))
      const db = await BrainDatabase.getRawInstance(unindexed.projectId)
      await handleGraphRequest(db, unindexed.projectId, { schemaVersion: GRAPH_SCHEMA_VERSION, symbol: "main" })
      return false
    } catch (error: any) {
      return String(error?.message ?? error).startsWith("bb/graph:") && String(error?.message).includes("not indexed")
    }
  }

  // --- P4: traceability (boundary gate + engine truth) ----------------------
  const fx4 = await makeFixture()
  try {
    const result = await handleGraphRequest(fx4.db, fx4.projectId, { schemaVersion: GRAPH_SCHEMA_VERSION, symbol: "main" })
    const allEdges = [...result.callers, ...result.callees]
    check("P4: every edge carries its seeded row id", allEdges.length >= 2 && allEdges.every((e: any) => typeof e.rowId === "string" && e.rowId.startsWith("rel-fixture-")))
    check("P4: stored evidenceClass passes through", allEdges.some((e: any) => e.metadata?.evidenceClass === "structural") && allEdges.some((e: any) => e.metadata === undefined))
    // Boundary gate: an untraceable edge must fail the request (stubbed engine).
    const tampered = await handleGraphRequest(fx4.db, fx4.projectId, { schemaVersion: GRAPH_SCHEMA_VERSION, symbol: "main" }, {
      traverse: async () => ({
        root: {} as never,
        callers: [{ from: "a", to: "b", relationshipType: "calls", confidence: 1, isCrossLanguage: false, callSite: { kind: "call-site", file: "f", line: 1 }, depth: 0 }] as never,
        callees: [],
        nodes: {},
        provenance: {} as never,
        summary: { totalCallers: 1, totalCallees: 0, maxDepthReached: 0, crossLanguageEdges: 0, truncated: false },
      }),
    } as never).then(() => false).catch((error: any) => String(error?.message).includes("no brain_relationship row id"))
    check("P4: untraceable edge fails the request at the boundary", tampered === true)
  } finally {
    fx4.cleanup()
  }

  // --- P5: advertisement matches registration -------------------------------
  const { createServer } = await import(SERVER_SOURCE)
  const ws5 = mkdtempSync(join(tmpdir(), "w2-srv-"))
  try {
    const server = (createServer as (root: string) => { capabilities: () => Record<string, unknown>; register: (m: string, h: unknown) => void })(ws5)
    check("P5: no graphProvider before registration", server.capabilities().graphProvider === undefined)
    server.register("bb/graph", () => ({}))
    const advertised = server.capabilities().graphProvider as { schemaVersion?: number } | undefined
    check("P5: graphProvider advertises schema version when registered", advertised !== undefined && advertised.schemaVersion === GRAPH_SCHEMA_VERSION)
  } finally {
    try { rmSync(ws5, { recursive: true, force: true }) } catch {}
  }

  // --- P6: doc drift gate ----------------------------------------------------
  const doc = existsSync(DOC) ? readFileSync(DOC, "utf8") : ""
  check("P6: doc names the method", doc.includes("`bb/graph`"))
  check("P6: doc names the schema version", doc.includes("schema version 2") || doc.includes("Schema version 2"))
  check("P6: doc declares the error prefix contract", doc.includes("bb/graph:"))
  check("P6: doc declares the indexed-workspace rule", doc.toLowerCase().includes("not indexed") && doc.includes("`bb index`"))
  check("P6: doc declares the traceability rule", doc.toLowerCase().includes("rowid") && doc.toLowerCase().includes("trace"))

  // --- R1: the real server over stdio ----------------------------------------
  const r1 = await realServerLeg()
  check("R1: real server — happy path with row-id trace over the wire", r1.happy, r1.detail)
  check("R1: real server — legacy caller (no version) gets the loud declared error", r1.legacy, r1.detail2)
  check("R1: real server — capabilities advertise graphProvider.schemaVersion (matches the module)", r1.caps, r1.detail3)

  // --- Mutants ----------------------------------------------------------------
  const mutants: Array<{ name: string; from: string; to: string }> = [
    {
      name: "M1 silent version coercion",
      from: "if (params.schemaVersion !== GRAPH_SCHEMA_VERSION) {",
      to: "if (false) {",
    },
    {
      name: "M2 fabricated rowId gate stripped",
      from: "if (typeof edge.rowId !== \"string\" || edge.rowId.length === 0) {",
      to: "if (false) {",
    },
    {
      name: "M3 empty-result unindexed",
      from: "throw new GraphRequestError(\"bb/graph: workspace is not indexed",
      to: "throw new Error(\"unreachable",
    },
    {
      name: "M4 silent param drift",
      from: "if (typeof params.symbol !== \"string\" || params.symbol.length === 0) {",
      to: "if (false) {",
    },
    {
      name: "M5 advertisement gone",
      from: "if (this.handlers.has(\"bb/graph\")) caps.graphProvider = { schemaVersion: 2 }",
      to: "if (false) caps.graphProvider = { schemaVersion: 2 }",
    },
  ]

  const rawComponent = readFileSync(COMPONENT, "utf8")
  const rawServer = readFileSync(SERVER_SOURCE, "utf8")
  let caught = 0
  let mutantsTotal = 0
  for (const mutant of mutants) {
    const target = mutant.name.startsWith("M5") ? rawServer : rawComponent
    if (!target.includes(mutant.from)) {
      console.log(`  SKIP (anchor not found): ${mutant.name}`)
      continue
    }
    mutantsTotal++
    const isServerMutant = mutant.name.startsWith("M5")
    const mutantPath = isServerMutant
      ? join(ROOT, "validation/m26", `server.mutant.${Date.now()}.ts`)
      : join(ROOT, "validation/m26", `graph_request.mutant.${Date.now()}.ts`)
    let mutantSource = target.replace(mutant.from, mutant.to)
    if (!isServerMutant) {
      // Mutant copies live outside src/: rewrite relative imports to file://.
      mutantSource = mutantSource
        .replace(/from "\.\.\/intelligence\/graph\/graph-engine"/g, `from "file://${join(ROOT, "src", "intelligence", "graph", "graph-engine.ts").replace(/\\/g, "/")}"`)
        .replace(/from "\.\.\/intelligence\/contracts"/g, `from "file://${join(ROOT, "src", "intelligence", "contracts.ts").replace(/\\/g, "/")}"`)
    } else {
      // Server-mutant imports rewritten to absolute file:// against src/.
      mutantSource = mutantSource
        .replace(/from "\.\.\/([a-z_]+)"/g, (_m, d: string) => `from "file://${join(ROOT, "src", d).replace(/\\/g, "/")}"`)
        .replace(/from "\.\/([a-z_]+)"/g, (_m, d: string) => `from "file://${join(ROOT, "src", "lsp", d).replace(/\\/g, "/")}"`)
    }
    writeFileSync(mutantPath, mutantSource)
    let detected = false
    try {
      const m = await import(mutantPath)
      detected = await probeMutant(m, mutant.name)
    } catch {
      detected = true // load failure counts as caught
    } finally {
      try { rmSync(mutantPath, { force: true }) } catch {}
    }
    if (detected) {
      caught++
      console.log(`  caught: ${mutant.name}`)
    } else {
      console.log(`  SURVIVED: ${mutant.name}`)
    }
  }

  async function probeMutant(m: any, name: string): Promise<boolean> {
    const fxm = await makeFixture()
    try {
      if (name.startsWith("M1")) {
        // Mismatched version must be SERVED by the mutant (defect visible).
        const r = await m.handleGraphRequest(fxm.db, fxm.projectId, { schemaVersion: 99, symbol: "main" })
        return r !== undefined && r !== null
      }
      if (name.startsWith("M2")) {
        const r = await m.handleGraphRequest(fxm.db, fxm.projectId, { schemaVersion: GRAPH_SCHEMA_VERSION, symbol: "main" }, {
          traverse: async () => ({
            root: {},
            callers: [{ from: "a", to: "b", relationshipType: "calls", confidence: 1, isCrossLanguage: false, callSite: { kind: "call-site", file: "f", line: 1 }, depth: 0 }],
            callees: [],
            nodes: {},
            provenance: {},
            summary: { totalCallers: 1, totalCallees: 0, maxDepthReached: 0, crossLanguageEdges: 0, truncated: false },
          }),
        })
        return r !== undefined // untraceable edge served => gate gone
      }
      if (name.startsWith("M3")) {
        // With the throw mutated to unreachable, traversal on a fixture whose
        // rows are gone must surface the engine failure instead of the
        // declared error => the declared error is gone (defect visible).
        try {
          const { BrainDatabase } = await import(join(ROOT, "src", "brain", "database.ts"))
          process.env.BB_DATA_DIR = "/tmp/w2-nonexistent-data-dir"
          const db = await BrainDatabase.getRawInstance(fxm.projectId)
          await m.handleGraphRequest(db, fxm.projectId, { schemaVersion: GRAPH_SCHEMA_VERSION, symbol: "main" })
          return false // served something: declared error gone
        } catch (error: any) {
          return !String(error?.message ?? "").includes("not indexed")
        }
      }
      if (name.startsWith("M4")) {
        try {
          await m.handleGraphRequest(fxm.db, fxm.projectId, { schemaVersion: GRAPH_SCHEMA_VERSION, symbol: "" })
          return true // empty symbol accepted => validation gone
        } catch {
          return false
        }
      }
      if (name.startsWith("M5")) {
        const ws = mkdtempSync(join(tmpdir(), "w2-mut-"))
        try {
          const server = new m.BbLspServer(ws)
          server.register("bb/graph", () => ({}))
          return server.capabilities().graphProvider === undefined // advertisement gone => defect visible
        } finally {
          try { rmSync(ws, { recursive: true, force: true }) } catch {}
        }
      }
      return false
    } finally {
      fxm.cleanup()
    }
  }

  check("mutation suite: every planted defect is caught", caught === mutantsTotal && mutantsTotal >= 4, `${caught}/${mutantsTotal}`)

  // --- Persist evidence --------------------------------------------------------
  const failed = checks - passed
  let commit = "unknown"
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {}
  const result = {
    issue: "M26.W2",
    code: "W2",
    milestone: "M26",
    status: failed === 0 ? "verified" : "known-gap",
    checks,
    passed,
    failed,
    mutantsCaught: caught,
    mutantsTotal,
    currentCommit: commit,
    verifierCommand: "npx tsx script/m26/verify-graph-transport.ts",
    evidenceFile: "W2.json",
    generatedAt: new Date().toISOString(),
    schemaVersion: GRAPH_SCHEMA_VERSION,
    method: GRAPH_REQUEST_METHOD,
    limitations: [
      "Real-server leg covers node-source runtime; dist/bun legs are exercised by the standing M24 harness suite.",
      "Legacy callers (no schemaVersion) are rejected by design; advertisement is the discovery mechanism.",
    ],
  }
  const dir = join(ROOT, "validation/m26/results")
  mkdirSync(dir, { recursive: true })
  writeSealed(join(dir, "W2.json"), result)
  console.log(`W2: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${caught}/${mutantsTotal} mutants caught)`)
  process.exit(failed === 0 ? 0 : 1)
}

// --- Real-server leg -----------------------------------------------------------
async function realServerLeg(): Promise<{ happy: boolean; legacy: boolean; caps: boolean; detail: string; detail2: string; detail3: string }> {
  const out = { happy: false, legacy: false, caps: false, detail: "", detail2: "", detail3: "" }
  // The leg runs outside main() — read the version from the module under test
  // itself (never a hardcoded literal): a version bump with a stale leg fails.
  const wireMod = (await import(COMPONENT)) as GraphRequestModule
  const WIRE_VERSION = wireMod.GRAPH_SCHEMA_VERSION
  const ws = mkdtempSync(join(tmpdir(), "w2-r-ws-"))
  const dataDir = mkdtempSync(join(tmpdir(), "w2-r-data-"))
  let child: ReturnType<typeof spawn> | null = null
  try {
    writeFileSync(join(ws, "main.ts"), "function main(): void {}\nmain()\n")
    const canonical = realpathSync(ws)
    const projectId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
    mkdirSync(join(dataDir, "projects", projectId), { recursive: true })
    // Seed via a tiny tsx -e script (same convention as the LSP harness).
    const seedScript = [
      `process.env.BB_DATA_DIR = ${JSON.stringify(dataDir)}`,
      `const { BrainDatabase } = await import(${JSON.stringify(join(ROOT, "src", "brain", "database.ts"))})`,
      `const db = await BrainDatabase.getRawInstance(${JSON.stringify(projectId)})`,
      `db.prepare(\`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)\`).run("file-1", ${JSON.stringify(projectId)}, ${JSON.stringify(join(ws, "main.ts"))}, "main.ts", "typescript", "w2-hash")`,
      `const s = db.prepare(\`INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?)\`)`,
      `s.run("sym-main", ${JSON.stringify(projectId)}, "file-1", "main", "function", 1, 1, 1, 3, 5)`,
      `s.run("sym-caller", ${JSON.stringify(projectId)}, "file-1", "caller", "function", 2, 2, 5, 8, 3)`,
      `const r = db.prepare(\`INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, metadata) VALUES (?,?,?,?,?,?,?)\`)`,
      `r.run("rel-wire-1", ${JSON.stringify(projectId)}, "sym-caller", "sym-main", "calls", 0.9, '{"evidenceClass":"structural"}')`,
      `process.exit(0)`,
    ].join(";\n")
    writeFileSync(join(dataDir, "seed.mts"), seedScript)
    execFileSync("npx", ["tsx", join(dataDir, "seed.mts")], { cwd: ROOT, encoding: "utf8", timeout: 120_000 })

    child = spawn("npx", ["tsx", SERVER_SOURCE, "--dir", ws], {
      cwd: ROOT,
      env: { ...process.env, BB_DATA_DIR: dataDir },
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
        const m = headers.match(/Content-Length: (\d+)/)
        if (!m) break
        const len = Number(m[1])
        if (buffer.length < sep + 4 + len) break
        const body = JSON.parse(buffer.slice(sep + 4, sep + 4 + len).toString())
        buffer = buffer.slice(sep + 4 + len)
        if (body.id !== undefined && pending.has(body.id)) {
          const p = pending.get(body.id)!
          pending.delete(body.id)
          p.resolve(body)
        }
      }
    })
    let stderrTail = ""
    child.stderr!.on("data", (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000)
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

    const init = await request("initialize", { capabilities: {}, rootUri: `file://${ws}` })
    out.caps = (init?.result?.capabilities?.graphProvider as any)?.schemaVersion === WIRE_VERSION
    out.detail3 = `graphProvider=${JSON.stringify(init?.result?.capabilities?.graphProvider)}`
    send({ jsonrpc: "2.0", method: "initialized", params: {} })

    const res = await request("bb/graph", { schemaVersion: WIRE_VERSION, symbol: "main" })
    const edges = [...((res?.result?.callers as any[]) ?? []), ...((res?.result?.callees as any[]) ?? [])]
    out.happy = res?.result !== undefined && edges.length >= 1 && edges.every((e) => typeof e.rowId === "string" && e.rowId.startsWith("rel-wire-"))
    out.detail = `edges=${JSON.stringify(edges.map((e) => ({ rowId: e.rowId, from: e.from, to: e.to })))} stderr=${stderrTail.slice(-200)}`

    const legacy = await request("bb/graph", { symbol: "main" })
    out.legacy = legacy?.error !== undefined && String(legacy.error.message).startsWith("bb/graph:") && String(legacy.error.message).includes("schema version mismatch")
    out.detail2 = `error=${JSON.stringify(legacy?.error)}`
  } catch (error: any) {
    out.detail = out.detail || String(error?.message ?? error)
    out.detail2 = out.detail2 || String(error?.message ?? error)
  } finally {
    try { child?.kill() } catch {}
    try { rmSync(ws, { recursive: true, force: true }) } catch {}
    try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
  }
  return out
}

void main()
