// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the MCP stdout-purity gate: `bb mcp` must write JSON-RPC
//   messages and NOTHING ELSE to stdout, including when a tool call starts the
//   indexer's worker pool or the relationship resolver.
// WHICH TOOL IT SERVES — every public tool, through its actual transport.
// WHY IT IS SHAPED THIS WAY — stdout is the protocol channel. A progress banner
//   between two JSON-RPC messages is not cosmetic: strict clients reject it. The
//   gate exercises the mutation-driving call (`bb_index`) that used to print the
//   worker-pool banner and the resolver's bounded-resolution summary, reads the
//   raw stream, and classifies every line. It also asserts the logs still exist,
//   on stderr, so a silent suppression cannot pass as a fix.
// WHERE ITS EVIDENCE LIVES — validation/m28/results/mcp-stdout.json.
// EDIT TOGETHER WHEN THIS CHANGES — src/mcp/server.ts, bin/bb, README (MCP section).
// CONTRACTS IT MUST NOT BREAK — a green run must mean: two live tool answers over
//   real stdio, zero non-JSON stdout lines, and at least one engine log line
//   observed on stderr (noise was moved, not deleted).
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const BIN = path.join(ROOT, "bin", "bb")
const RESULTS = path.join(ROOT, "validation", "m28", "results")

let checks = 0
let passed = 0
let failed = 0
function ck(label: string, condition: boolean, detail = "") {
  checks++
  if (condition) passed++
  else {
    failed++
    console.log("  FAIL: " + label + (detail ? " — " + detail : ""))
  }
}

/**
 * Classify stdout exactly the way a client must: every non-empty line has to be a
 * JSON-RPC object. Returns the offending lines. Kept pure so the gate can feed it
 * injected noise and prove the classifier is not a tautology.
 */
function classifyNonProtocolLines(text: string): string[] {
  const noise: string[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (!parsed || typeof parsed !== "object" || typeof parsed.jsonrpc !== "string") noise.push(trimmed)
    } catch {
      noise.push(trimmed)
    }
  }
  return noise
}

function makeFixture(): { root: string; dataDir: string; home: string; scratch: string } {
  const scratch = mkdtempSync(path.join(tmpdir(), "bb-mcp-stdout-"))
  const root = path.join(scratch, "repo")
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", "module.ts"), "export function gateProbe(value: number): number {\n  return value + 1\n}\n")
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "bb-mcp-stdout-fixture", private: true, type: "module" }, null, 2))
  return { root, scratch, dataDir: path.join(scratch, "data"), home: path.join(scratch, "home") }
}

interface CallResult {
  answered: boolean
  isError: boolean
  text: string
  stdout: string
  stderr: string
}

async function serveAndCall(fixture: ReturnType<typeof makeFixture>): Promise<CallResult> {
  mkdirSync(fixture.dataDir, { recursive: true })
  mkdirSync(fixture.home, { recursive: true })
  // The shipped entry is Node-only (bin/bb has a node shebang; better-sqlite3 is the
  // Node binding). Spawn Node explicitly so a bun-run gate measures the real product.
  const nodeBin = process.env.BB_MCP_NODE ?? "node"
  const child = spawn(nodeBin, [BIN, "mcp", "--dir", fixture.root], {
    cwd: fixture.root,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      BB_DATA_DIR: fixture.dataDir,
      HOME: fixture.home,
      BB_NO_AUTO_REFRESH: "1",
      NO_COLOR: "1",
    },
  })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })

  const pending = new Map<number, (value: any) => void>()
  let buffer = ""
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString()
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      try {
        const message = JSON.parse(line)
        if (typeof message.id === "number" && pending.has(message.id)) {
          const resolve = pending.get(message.id)!
          pending.delete(message.id)
          resolve(message)
        }
      } catch {
        /* the gate classifies the raw stream after the exchange */
      }
    }
  })

  let nextId = 0
  const request = (method: string, params: Record<string, unknown>) =>
    new Promise<any>((resolve, reject) => {
      const id = ++nextId
      pending.set(id, resolve)
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(`${method} timed out`))
        }
      }, 60_000)
    })

  try {
    const init = await request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "bb-mcp-stdout-gate", version: "1" },
    })
    ck("initialize answers with a server identity", typeof init?.result?.serverInfo?.name === "string", JSON.stringify(init?.result?.serverInfo ?? null))
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")

    // The mutation-driving call is the one that used to print the indexer banner.
    const indexCall = await request("tools/call", { name: "bb_index", arguments: { path: ".", mode: "dir" } })
    const indexText = indexCall?.result?.content?.[0]?.text ?? ""
    ck("bb_index answers through the MCP door", typeof indexCall?.result === "object" && String(indexText).length > 0, String(indexText).slice(0, 120))

    const healthCall = await request("tools/call", { name: "bb_health", arguments: {} })
    const healthText = healthCall?.result?.content?.[0]?.text ?? ""
    ck("the same server still answers a read afterwards", typeof healthCall?.result === "object" && String(healthText).length > 0, String(healthText).slice(0, 120))

    return {
      answered: true,
      isError: indexCall?.result?.isError === true || healthCall?.result?.isError === true,
      text: String(indexText) + "\n" + String(healthText),
      stdout,
      stderr,
    }
  } finally {
    child.kill()
    await new Promise((resolve) => child.once("exit", resolve))
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

const fixture = makeFixture()
let result: CallResult | null = null
try {
  result = await serveAndCall(fixture)
} catch (error) {
  ck("the MCP exchange completes without an exception", false, error instanceof Error ? error.message : String(error))
} finally {
  try { rmSync(fixture.scratch, { recursive: true, force: true }) } catch {}
}

if (result) {
  const noise = classifyNonProtocolLines(result.stdout)
  const engineLogLines = result.stderr.split("\n").filter((line) => /\[brain\]|worker pool|bounded: resolved|\[WARN\]|\[INFO\]/.test(line)).length
  ck("stdout carries at least the handshake and two tool answers", result.stdout.split("\n").filter((line) => line.trim().startsWith("{")).length >= 3, `lines=${result.stdout.split("\n").length}`)
  ck("stdout is protocol-only: zero non-JSON-RPC lines", noise.length === 0, JSON.stringify(noise.slice(0, 3)))
  ck("the engine logs still exist, on stderr (moved, not deleted)", engineLogLines >= 1, `stderrLogLines=${engineLogLines} sample=${JSON.stringify(result.stderr.slice(0, 300))}`)

  // Falsifiability: the classifier must flag injected noise, or the green above is a tautology.
  const injected = classifyNonProtocolLines(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }) + "\n" + "[brain] injected banner\n")
  ck("negative: the purity classifier flags an injected noise line", injected.length === 1, JSON.stringify(injected))
}

mkdirSync(RESULTS, { recursive: true })
const evidence = {
  tool: "shared/mcp",
  gate: "script/m28/verify-mcp-stdout.ts",
  checks,
  passed,
  failed,
  negativeCases: 1,
  stdoutLines: result ? result.stdout.split("\n").filter((line) => line.trim().length > 0).length : 0,
  stdoutNoiseLines: result ? classifyNonProtocolLines(result.stdout).length : -1,
  stderrLogLines: result ? result.stderr.split("\n").filter((line) => /\[brain\]|worker pool|bounded: resolved|\[WARN\]|\[INFO\]/.test(line)).length : -1,
  verified: failed === 0,
  generatedAt: new Date().toISOString(),
}
writeFileSync(path.join(RESULTS, "mcp-stdout.json"), JSON.stringify(evidence, null, 2) + "\n")

console.log(`\nMCP STDOUT PURITY: ${failed === 0 ? `PASS (${passed}/${checks})` : `${failed} FAILURES of ${checks}`}`)
process.exit(failed === 0 ? 0 : 1)
