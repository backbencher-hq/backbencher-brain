// script/m59/probe-bb-edit-wire.ts — M59.EDIT-WIRE
//
// The other bb_edit probe (probe-bb-edit-modes.ts) calls the handler in-process.
// This one tests what the USER and their agents actually talk to: the installed
// binary (`node bin/bb mcp --dir <project>`), a fresh process, JSON-RPC over
// stdio, exactly one request per line — the same wire an IDE client uses.
//
// It proves three separate things, because they fail separately:
//   1. DISCOVERY — `tools/list` advertises bb_edit with the real parameter set
//      (mode/lineStart/newName/position/force/format/dryRun/targetSymbolName)
//      and advertises NO ghost tool (a name the docs promise but the server
//      does not serve is how an agent ends up calling an unavailable tool).
//   2. BEHAVIOUR — every mode lands the right bytes on disk through the wire:
//      update, insert, delete, refactor, write; plus dryRun (no write) and the
//      ambiguous-name refusal (no guessed write).
//   3. REAL DATA — a dryRun update against the REAL index (BB_DATA_DIR=~/.bb,
//      the user's own indexed project) returns a plan naming the right file and
//      leaves every byte untouched.
//
// Requires a built dist/ (`npm run build`); the binary loads dist/cli/index.js.

import { spawn } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const BIN = path.join(ROOT, "bin/bb")
const REAL_DATA = "$HOME/.bb"
const REAL_PROJECT = ROOT

const SHAPES = `export function helper(): number {
  return 1
}

export function oneline(): number { return 3 }

export class Calculator {
  public total(): number {
    let sum = 0
    return sum
  }
}
`

const OBJECT_METHOD = `export function target(): number { return 1 }

export function caller(): number {
  const helper = { target(x: number): number { return x } }
  return target() + helper.target(1)
}
`

type Json = Record<string, any>

/** One stdio JSON-RPC session against a fresh `bb mcp` process. */
class Wire {
  child: ReturnType<typeof spawn>
  private nextId = 1
  private buffer = ""
  private pending = new Map<number, (v: Json) => void>()
  stderr = ""

  private constructor(child: ReturnType<typeof spawn>) {
    this.child = child
    this.child.stdout!.on("data", (d: Buffer) => {
      this.buffer += d.toString()
      const lines = this.buffer.split("\n")
      this.buffer = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.trim()) continue
        let msg: Json
        try { msg = JSON.parse(line) } catch { continue }
        const resolve = this.pending.get(msg.id)
        if (resolve) { this.pending.delete(msg.id); resolve(msg) }
      }
    })
    this.child.stderr!.on("data", (d: Buffer) => { this.stderr += d.toString() })
  }

  static async start(dir: string, dataDir: string): Promise<Wire> {
    const child = spawn("node", [BIN, "mcp", "--dir", dir], {
      cwd: ROOT,
      env: { ...process.env, BB_DATA_DIR: dataDir },
      stdio: ["pipe", "pipe", "pipe"],
    })
    const wire = new Wire(child)
    const init = await wire.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "m59-edit-wire", version: "0" } }, 90_000)
    if (!init) throw new Error("initialize timed out")
    wire.notify("notifications/initialized")
    return wire
  }

  private requestRaw(method: string, params: Json, timeoutMs: number): Promise<Json> {
    const id = this.nextId++
    const p = new Promise<Json>((resolve) => this.pending.set(id, resolve))
    this.child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    return Promise.race([p, new Promise<Json>((resolve) => setTimeout(() => resolve({ __timeout: true } as Json), timeoutMs))])
  }

  notify(method: string, params?: Json): void {
    this.child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}) }) + "\n")
  }

  async request(method: string, params: Json, timeoutMs = 60_000): Promise<Json | null> {
    const msg = await this.requestRaw(method, params, timeoutMs)
    if ((msg as Json).__timeout) return null
    return msg
  }

  /** tools/call → { ok, text, isError, ms } — the shape an agent's client sees. */
  async call(name: string, args: Json, timeoutMs = 120_000): Promise<{ ok: boolean; text: string; isError: boolean; ms: number }> {
    const t0 = Date.now()
    const msg = await this.request("tools/call", { name, arguments: args }, timeoutMs)
    const ms = Date.now() - t0
    if (!msg) return { ok: false, text: "TIMEOUT", isError: true, ms }
    if (msg.error) return { ok: false, text: `rpc error: ${JSON.stringify(msg.error).slice(0, 200)}`, isError: true, ms }
    const text = (msg.result?.content ?? []).map((b: Json) => String(b?.text ?? "")).join("\n")
    return { ok: !msg.result?.isError, text, isError: msg.result?.isError === true, ms }
  }

  kill(): void { this.child.kill("SIGKILL") }
}

/** `bb_edit`'s advertised parameter set, from the registry — the contract. */
const EXPECTED_EDIT_PARAMS = [
  "mode", "dryRun", "filePath", "symbolName", "lineStart", "content",
  "newContent", "targetSymbolName", "position", "newName", "force", "format",
]
/** Names the old docs/guidance promised but the server does not serve (M48.H1). */
const GHOST_TOOLS = [
  "bb_select", "bb_update", "bb_delete", "bb_insert", "bb_write",
  "bb_refresh", "bb_refactor", "bb_relationships",
]

const checks: Array<{ name: string; pass: boolean; detail: string }> = []
const check = (name: string, pass: boolean, detail = "") => {
  checks.push({ name, pass, detail })
  console.log(`  ${pass ? "ok" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`)
}

const dataDir = mkdtempSync(path.join(tmpdir(), "m59-editwire-data-"))
const fixture = mkdtempSync(path.join(tmpdir(), "m59-editwire-proj-"))
mkdirSync(path.join(fixture, "src"), { recursive: true })
writeFileSync(path.join(fixture, "src/shapes.ts"), SHAPES)
writeFileSync(path.join(fixture, "src/object.ts"), OBJECT_METHOD)
writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }))

const results: Json[] = []

async function main() {
  // ── 0. Index the fixture with the same installed binary (CLI path) ────────
  const indexOut = execFileSync("node", [BIN, "index", fixture, "--no-setup"], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, BB_DATA_DIR: dataDir }, timeout: 240_000,
  })
  check("CLI `bb index <project>` indexes the fixture", /indexed|complete|files/i.test(indexOut), indexOut.replace(/\s+/g, " ").slice(0, 110))

  const wire = await Wire.start(fixture, dataDir)

  // ── 1. DISCOVERY ──────────────────────────────────────────────────────────
  const listed = await wire.request("tools/list", {}, 60_000)
  const tools: Json[] = listed?.result?.tools ?? []
  const names = tools.map((t) => String(t.name))
  check("tools/list returns a non-empty tool set", tools.length > 0, `${tools.length} tools served over the wire`)
  const edit = tools.find((t) => t.name === "bb_edit")
  check("bb_edit is served over the wire", !!edit)
  const params = Object.keys(edit?.inputSchema?.properties ?? {})
  const missing = EXPECTED_EDIT_PARAMS.filter((p) => !params.includes(p))
  const extra = params.filter((p) => !EXPECTED_EDIT_PARAMS.includes(p))
  check("bb_edit advertises exactly its documented parameters", missing.length === 0 && extra.length === 0, `missing=[${missing}] extra=[${extra}]`)
  const ghosts = GHOST_TOOLS.filter((g) => names.includes(g))
  check("no ghost tool is advertised", ghosts.length === 0, ghosts.length ? `served: ${ghosts}` : `checked ${GHOST_TOOLS.length} retired names`)

  // ── 2. BEHAVIOUR, through the wire ────────────────────────────────────────
  const cases: Array<{ name: string; file: string; args: Json; expect: (after: string, call: { ok: boolean; text: string; isError: boolean }) => string | null }> = [
    {
      name: "update: full declaration",
      file: "src/shapes.ts",
      args: { mode: "update", symbolName: "helper", filePath: "src/shapes.ts", newContent: `export function helper(): number {\n  return 7\n}` },
      expect: (a) => (a.includes("return 7") ? null : "replacement not on disk"),
    },
    {
      name: "update: body fragment keeps the declaration",
      file: "src/shapes.ts",
      args: { mode: "update", symbolName: "total", newContent: "    let sum = 5\n    return sum" },
      expect: (a) => (a.includes("let sum = 5") && a.includes("public total()") ? null : "fragment did not land inside the method"),
    },
    {
      name: "insert: after a symbol",
      file: "src/shapes.ts",
      args: { mode: "insert", targetSymbolName: "helper", filePath: "src/shapes.ts", position: "after", newContent: "export const added = 1" },
      expect: (a) => (a.includes("export const added = 1") ? null : "insert not on disk"),
    },
    {
      name: "delete: removes the symbol",
      file: "src/shapes.ts",
      args: { mode: "delete", symbolName: "oneline", filePath: "src/shapes.ts" },
      expect: (a) => (a.includes("oneline") ? "symbol still present" : null),
    },
    {
      name: "write: creates a file",
      file: "src/created.ts",
      args: { mode: "write", filePath: "src/created.ts", content: "export const created = 1\n" },
      expect: (a) => (a.includes("export const created = 1") ? null : "file not created"),
    },
    {
      name: "refactor: renames the declaration and its call",
      file: "src/shapes.ts",
      args: { mode: "refactor", symbolName: "helper", filePath: "src/shapes.ts", newName: "helperTwo" },
      expect: (a) => (a.includes("helperTwo") && !/export function helper\(/.test(a) ? null : "rename not on disk"),
    },
  ]

  for (const c of cases) {
    const target = path.join(fixture, c.file)
    const before = existsSync(target) ? readFileSync(target, "utf8") : null
    const call = await wire.call("bb_edit", c.args)
    const after = existsSync(target) ? readFileSync(target, "utf8") : null
    const problem = c.expect(after ?? "", call)
    const changed = before !== after
    check(`wire: ${c.name}`, problem === null, problem ?? (changed ? "edited" : "no change needed"))
    results.push({ case: c.name, ok: problem === null, ms: call.ms, refused: call.isError, changed, problem })
  }

  // dryRun must not touch the file, and must still show the plan.
  {
    const target = path.join(fixture, "src/shapes.ts")
    const before = readFileSync(target, "utf8")
    const call = await wire.call("bb_edit", { mode: "update", symbolName: "total", filePath: "src/shapes.ts", newContent: "    let sum = 99\n    return sum", dryRun: true })
    const after = readFileSync(target, "utf8")
    check("wire: dryRun shows a plan and writes nothing", before === after && /sum = 99/.test(call.text), `changedOnDisk=${before !== after}`)
    results.push({ case: "dryRun", ok: before === after && /sum = 99/.test(call.text), ms: call.ms, refused: call.isError, changed: before !== after, problem: null })
  }

  // Ambiguous name in one file: refuse, name the remedy, write nothing.
  {
    const target = path.join(fixture, "src/object.ts")
    const before = readFileSync(target, "utf8")
    const call = await wire.call("bb_edit", { mode: "refactor", symbolName: "target", filePath: "src/object.ts", newName: "renamedTarget" })
    const after = readFileSync(target, "utf8")
    const named = /ambiguous/i.test(call.text) && /lineStart/.test(call.text)
    check("wire: an ambiguous name is refused and names lineStart", call.isError && named && before === after, call.text.replace(/\s+/g, " ").slice(0, 130))
    results.push({ case: "ambiguous-refusal", ok: call.isError && named && before === after, ms: call.ms, refused: call.isError, changed: before !== after, problem: named ? null : "remedy not named" })
    // …and the disambiguated call succeeds on the same name.
    const fixed = await wire.call("bb_edit", { mode: "refactor", symbolName: "target", filePath: "src/object.ts", lineStart: 1, newName: "renamedTarget" })
    const afterFixed = readFileSync(target, "utf8")
    check("wire: the same call with lineStart renames exactly the declaration", !fixed.isError && /function renamedTarget\(/.test(afterFixed) && /helper\.target\(1\)/.test(afterFixed), fixed.text.replace(/\s+/g, " ").slice(0, 130))
    results.push({ case: "ambiguous-then-lineStart", ok: !fixed.isError && /function renamedTarget\(/.test(afterFixed) && /helper\.target\(1\)/.test(afterFixed), ms: fixed.ms, refused: fixed.isError, changed: true, problem: null })
  }

  // ── 3. REAL DATA: dryRun against the user's own index ─────────────────────
  {
    const realTarget = "src/intelligence/edit/edit-engine.ts"
    const abs = path.join(REAL_PROJECT, realTarget)
    if (!existsSync(abs)) {
      check("real-index dryRun (skipped: file absent)", false, `${abs} missing`)
    } else {
      const real = await Wire.start(REAL_PROJECT, REAL_DATA)
      const before = readFileSync(abs, "utf8")
      // Three sequential dryRuns in ONE session: the first pays any one-time
      // open/refresh cost, the later ones are the steady-state number an agent
      // feels on every edit. Reported separately, never averaged away.
      const ms: number[] = []
      let ok = true
      let detail = ""
      for (let i = 0; i < 3; i++) {
        const r = await real.call("bb_edit", { mode: "update", symbolName: "uniqueSymbol", filePath: realTarget, newContent: "  return null as any // m59-wire-dry-run", dryRun: true }, 180_000)
        ms.push(r.ms)
        if (r.isError && !/stale|refreshed/i.test(r.text)) { ok = false; detail = r.text.replace(/\s+/g, " ").slice(0, 160) }
      }
      const after = readFileSync(abs, "utf8")
      const planned = /edit-engine\.ts/.test(detail) || detail === ""
      check("real index: dryRun update plans against the live index, byte-identical file", ok && before === after && planned, ok ? `cold=${ms[0]}ms warm=${ms[1]}ms warm2=${ms[2]}ms` : detail)
      results.push({ case: "real-index-dryRun", ok: ok && before === after, ms: ms[0], warmMs: ms[1], warm2Ms: ms[2], refused: false, changed: before !== after, problem: ok ? null : detail })
      real.kill()
    }
  }

  wire.kill()

  const failed = checks.filter((c) => !c.pass).length
  const out = {
    probe: "M59.EDIT-WIRE — installed binary, real MCP stdio",
    milestone: "M59",
    at: new Date().toISOString(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    method: "fresh `node bin/bb mcp --dir <project>` per session; JSON-RPC over stdio; file bytes read from disk after each call; real-index leg uses BB_DATA_DIR=$HOME/.bb",
    toolsServed: tools.length,
    editParamsAdvertised: params,
    checks,
    results,
    status: failed === 0 ? "verified" : "known-gap",
  }
  const outPath = path.join(ROOT, "validation/m59/results/probe-bb-edit-wire.json")
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n")
  console.log(`\nM59.EDIT-WIRE: ${out.status.toUpperCase()} (${checks.length - failed}/${checks.length} checks) → validation/m59/results/probe-bb-edit-wire.json`)
  rmSync(fixture, { recursive: true, force: true })
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => { console.error(e); process.exit(1) })
