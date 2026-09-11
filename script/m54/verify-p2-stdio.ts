// script/m54/verify-p2-stdio.ts — M54.P2 (#728) gate.
// Permanent regression gate for the PRODUCTION MCP stdio shape:
//   spawn `node bin/bb mcp` (compiled dist, plain node — exactly what users
//   run) → initialize handshake → tools/list → expect the real tool count.
//
// Background (M52 finding, now encoded): the stdio server is event-loop
// sensitive — under tsx/src it historically drained and exited before the
// handshake; the production shape (dist under node) was verified working in
// M52's follow-up smoke test. This gate makes that fact PERMANENT: any future
// packaging/runtime change that breaks stdio fails here, loudly.
//
// Honesty rules:
//   - A dead/failed child FAILS with captured stderr/stdout — never a silent
//     hang, never a "skip" (M52's own probe died silently once; never again).
//   - Hard timeout: a server that never answers is a failure, not a wait.
//   - Mutation mode (`--self-mutation`): runs the SAME handshake against a
//     server that exits immediately and asserts the probe FAILS — proving the
//     gate can fail. A gate that cannot fail is not a gate.

import { spawn } from "node:child_process"
import { existsSync, rmSync, mkdtempSync } from "node:fs"
import path from "node:path"
import os from "node:os"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const BIN = path.join(ROOT, "bin", "bb")
const EXPECTED_MIN_TOOLS = 16
const HANDSHAKE_TIMEOUT_MS = 60_000

const mutation = process.argv.includes("--self-mutation")

function handshake(cmd: string, args: string[], label: string): Promise<{ ok: boolean; detail: string; tools?: number }> {
  return new Promise((resolve) => {
    if (cmd.includes("/") && !existsSync(cmd)) {
      resolve({ ok: false, detail: `${label}: binary missing: ${cmd} (run npm run build)` })
      return
    }
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: {
        ...process.env,
        // Deterministic + never touches the user's real data dir or the live
        // MCP server's DB: the handshake needs no index content.
        BB_DATA_DIR: mkdtempSync(path.join(os.tmpdir(), "m54-stdio-")),
      },
      stdio: ["pipe", "pipe", "pipe"],
    })
    let buf = ""
    let err = ""
    let tools: number | undefined
    let done = false
    const finish = (ok: boolean, detail: string) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { child.kill("SIGKILL") } catch {}
      resolve({ ok, detail, tools })
    }
    const timer = setTimeout(() => finish(false, `${label}: TIMEOUT after ${HANDSHAKE_TIMEOUT_MS}ms (stdout so far: ${buf.slice(0, 300)})`), HANDSHAKE_TIMEOUT_MS)
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString()
      for (const line of buf.split("\n")) {
        if (done) break
        try {
          const msg = JSON.parse(line)
          if (msg.id === 1 && msg.result?.serverInfo) {
            // initialize answered — send the initialized notification, then tools/list
            child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")
            child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n")
          }
          if (msg.id === 2 && msg.result?.tools) {
            tools = msg.result.tools.length
            finish(tools >= EXPECTED_MIN_TOOLS, `${label}: handshake OK, ${tools} tools served (expected >= ${EXPECTED_MIN_TOOLS})`)
          }
        } catch { /* partial line — keep buffering */ }
      }
    })
    child.stderr.on("data", (d: Buffer) => { err += d.toString() })
    child.on("error", (e) => finish(false, `${label}: spawn error: ${e.message}`))
    child.on("close", (code) => finish(false, `${label}: child exited early (code ${code}) BEFORE completing handshake. stdout: ${buf.slice(0, 300)} stderr: ${err.slice(0, 300)}`))
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "m54-gate", version: "0" } } }) + "\n")
  })
}

if (mutation) {
  // Mutation: a "server" that exits immediately. The probe MUST fail — that
  // is the proof this gate can detect silent child death.
  const fake = path.join(os.tmpdir(), `m54-fake-server-${Date.now()}.mjs`)
  const { writeFileSync } = await import("node:fs")
  writeFileSync(fake, "process.exit(0)\n")
  const r = await handshake("node", [fake], "mutation(fake-server)")
  rmSync(fake, { force: true })
  if (r.ok) {
    console.log(`❌ P2.MUTATION: fake server PASSED the handshake (${r.detail}) — the gate cannot fail, it is not a gate`)
    process.exit(1)
  }
  console.log(`✅ P2.MUTATION: fake server correctly FAILED: ${r.detail}`)
  console.log("=== M54.P2 mutation mode: gate detection proven ===")
  process.exit(0)
}

const prod = await handshake("node", [BIN, "mcp"], "production(node bin/bb mcp)")
console.log(`${prod.ok ? "✅" : "❌"} P2.stdio-handshake: ${prod.detail}`)
console.log(`\n=== M54.P2 GATE: ${prod.ok ? "PASS" : "FAIL"} ===`)
{
  const { execSync } = await import("node:child_process")
  const { mkdirSync, writeFileSync } = await import("node:fs")
  const commit = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim()
  mkdirSync(path.join(ROOT, "validation/m54/results"), { recursive: true })
  writeFileSync(path.join(ROOT, "validation/m54/results/P2.json"), JSON.stringify({
    gate: "M54.P2", issue: 728, milestone: "M54", at: new Date().toISOString(), commit,
    checks: 1, passed: prod.ok ? 1 : 0, failed: prod.ok ? 0 : 1,
    verifierCommand: "npx tsx script/m54/verify-p2-stdio.ts",
    status: prod.ok ? "verified" : "known-gap",
    shape: { command: "node bin/bb mcp", toolsServed: prod.tools, minExpected: EXPECTED_MIN_TOOLS },
  }, null, 2) + "\n")
}
process.exit(prod.ok ? 0 : 1)
