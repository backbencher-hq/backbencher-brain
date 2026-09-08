// script/m48/l1-hub-smoke.ts — M48.L1 (#704) hub-smoke runner.
//
// Two honest legs, both against the REAL server:
//   A. The M24 LSP harness (script/m24/lsp_harness.ts) — full lifecycle +
//      L1-L5 features, real protocol client, seeded brain.db. Evidence →
//      validation/m48/results/L1-smoke.json.
//   B. A bb/graph leg (this file's own minimal stdio client): exercises the
//      hub's graph-panel path — which flows through the shared graph engine
//      M48.C1 changed — plus a schema-mismatch negative. Evidence →
//      validation/m48/results/L1-smoke-graph.json.
//
// Honesty contract (issue addendum): if a leg cannot run, evidence records
// status blocked/failed with the reason — never a fabricated pass.

import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execSync } from "node:child_process"
import { spawn, type ChildProcess } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUT_DIR = path.join(ROOT, "validation", "m48", "results")

async function main() {
  const results: any = {}
  // Leg A — the M24 harness (best-effort: any throw is recorded, not hidden).
  try {
    const { runHarness } = await import(path.join(ROOT, "script/m24/lsp_harness.ts"))
    const run = await runHarness({ runtime: "node-source" })
    results.harness = run
    console.log(
      `L1 hub smoke A (M24 harness): status=${run.status} checks=${run.checks.filter((c: any) => c.ok).length}/${run.checks.length} features=${run.features.filter((f: any) => f.passed).length}/${run.features.length}`,
    )
  } catch (e: any) {
    results.harness = { status: "blocked", reason: `harness threw: ${e?.message ?? String(e)}` }
    console.log(`L1 hub smoke A (M24 harness): BLOCKED — ${e?.message}`)
  }

  // Leg B — bb/graph over the wire (the shared-engine path).
  results.graph = await runGraphLeg()

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(path.join(OUT_DIR, "L1-smoke.json"), JSON.stringify(results.harness, null, 2) + "\n")
  writeFileSync(path.join(OUT_DIR, "L1-smoke-graph.json"), JSON.stringify(results.graph, null, 2) + "\n")

  const okA = results.harness?.status === "verified"
  const okB = results.graph?.status === "verified"
  console.log(`L1 hub smoke B (bb/graph): status=${results.graph.status} checks=${results.graph.checks?.filter((c: any) => c.ok).length}/${results.graph.checks?.length}`)
  if (!okA || !okB) process.exitCode = 1
}

// --- Minimal stdio LSP client (protocol-shaped, same framing as the M24 harness) ---

class GraphClient {
  private child: ChildProcess
  private buffer = Buffer.alloc(0)
  private pending = new Map<number, { resolve: (m: any) => void; reject: (e: Error) => void }>()
  private nextId = 1
  stderr = ""

  constructor(wsDir: string, dataDir: string) {
    this.child = spawn("npx", ["tsx", path.join(ROOT, "src/lsp/server.ts"), "--dir", wsDir], {
      cwd: ROOT,
      env: { ...process.env, BB_DATA_DIR: dataDir },
      stdio: ["pipe", "pipe", "pipe"],
    })
    this.child.stdout?.on("data", (d: Buffer) => this.onData(d))
    this.child.stderr?.on("data", (d: Buffer) => { this.stderr += d.toString() })
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n")
      if (headerEnd === -1) return
      const header = this.buffer.subarray(0, headerEnd).toString("utf8")
      const match = /Content-Length:\s*(\d+)/i.exec(header)
      if (!match) { this.buffer = this.buffer.subarray(headerEnd + 4); continue }
      const length = parseInt(match[1]!, 10)
      if (this.buffer.length < headerEnd + 4 + length) return
      const body = this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf8")
      this.buffer = this.buffer.subarray(headerEnd + 4 + length)
      let msg: any
      try { msg = JSON.parse(body) } catch { continue }
      if (msg && typeof msg.id === "number" && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!
        this.pending.delete(msg.id)
        p.resolve(msg)
      }
    }
  }

  request(method: string, params: any): Promise<any> {
    const id = this.nextId++
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
    this.child.stdin!.write(`Content-Length: ${body.length}\r\n\r\n`)
    this.child.stdin!.write(body)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout waiting for ${method}`)) }, 15000)
      this.pending.set(id, { resolve: (m) => { clearTimeout(timer); resolve(m) }, reject: (e) => { clearTimeout(timer); reject(e) } })
    })
  }

  notify(method: string, params: any) {
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", method, params }))
    this.child.stdin!.write(`Content-Length: ${body.length}\r\n\r\n`)
    this.child.stdin!.write(body)
  }

  async close() {
    try { this.child.stdin!.end() } catch {}
    await new Promise((r) => {
      const t = setTimeout(() => { this.child.kill("SIGKILL"); r(null) }, 3000)
      this.child.on("exit", () => { clearTimeout(t); r(null) })
    })
  }
}

async function runGraphLeg(): Promise<any> {
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = []
  const check = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail })
  const wsDir = mkdtempSync(path.join(tmpdir(), "bblsp-graph-ws-"))
  const dataDir = mkdtempSync(path.join(tmpdir(), "bblsp-graph-data-"))
  const commit = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim()

  try {
    // Seed the same fixture shape the M24 harness uses (real brain.db rows).
    const { createHash } = await import("node:crypto")
    const { realpathSync, writeFileSync, mkdirSync } = await import("node:fs")
    const { join } = await import("node:path")
    const canonical = realpathSync.native(wsDir)
    const projectId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
    const dbDir = join(dataDir, "projects", projectId)
    mkdirSync(dbDir, { recursive: true })
    writeFileSync(join(wsDir, "main.ts"), `class Greeter {\n  greet(): string {\n    return "hello"\n  }\n}\n\nfunction main(): void {\n  const g = new Greeter()\n  g.greet()\n}\n`)
    process.env.BB_DATA_DIR = dataDir
    const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
    const raw = await BrainDatabase.getRawInstance(projectId)
    const fpath = join(wsDir, "main.ts")
    raw.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)`)
      .run("file-1", projectId, fpath, "main.ts", "typescript", "fixture-hash-1")
    const sym = raw.prepare(`INSERT INTO brain_symbol (id, project_id, file_id, name, qualified_name, symbol_type, line_start, line_end, byte_start, byte_end, owner_symbol_id, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    sym.run("sym-greeter", projectId, "file-1", "Greeter", null, "class", 1, 3, 7, 2, null, 10)
    sym.run("sym-greet", projectId, "file-1", "greet", "Greeter.greet", "method", 2, 2, 3, 8, "sym-greeter", 7)
    sym.run("sym-main", projectId, "file-1", "main", null, "function", 7, 10, 10, 2, null, 5)
    raw.prepare(`INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence) VALUES (?,?,?,?,?,?)`)
      .run("rel-1", projectId, "sym-main", "sym-greet", "calls", 1.0)

    const client = new GraphClient(wsDir, dataDir)
    const init = await client.request("initialize", { capabilities: {} })
    check("bb/graph leg: initialize succeeds", !!init?.result?.capabilities)
    client.notify("initialized", {})

    // Positive: graph mode, exact symbol name — goes through graph-engine.
    const g = await client.request("bb/graph", { schemaVersion: 2, symbol: "greet", mode: "graph", direction: "both", maxDepth: 3 })
    check("bb/graph: root resolves to greet", g?.result?.root?.name === "greet", JSON.stringify(g?.result?.root))
    check("bb/graph: callers found (main→greet)", (g?.result?.callers ?? []).length >= 1)
    check("bb/graph: callees present", Array.isArray(g?.result?.callees))

    // Negative: schema mismatch must be a LOUD declared error, never silence.
    const bad = await client.request("bb/graph", { schemaVersion: 1, symbol: "greet", mode: "graph" })
    check("bb/graph: schema mismatch is a declared error", /bb\/graph: schema version mismatch/.test(bad?.error?.message ?? ""), JSON.stringify(bad?.error))

    await client.close()
  } catch (e: any) {
    check("bb/graph leg: no unexpected throw", false, `${e?.message ?? String(e)} | server stderr: ${client?.stderr?.slice(-600) ?? "(no client)"}`)
  } finally {
    try { rmSync(wsDir, { recursive: true, force: true }) } catch {}
    try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
  }

  const ok = checks.every((c) => c.ok)
  return { status: ok ? "verified" : "failed", commit, checks, fixtureStats: { files: 1, symbols: 3, relationships: 1 } }
}

main()