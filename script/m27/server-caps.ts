// script/m27/server-caps.ts — the SINGLE owner of wire-level capability reads
// (J1/H1 rule). Spawns the real dist server over stdio, sends the real
// initialize, and resolves the advertised capabilities map from the actual
// response. No hardcoded fallbacks — a server that stops advertising a
// capability fails every gate that uses this module.

import { spawn } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

/** Spawn the REAL dist server over stdio and read its advertised
 *  capabilities from the actual initialize response (wire truth, no stubs).
 *  Resolves null when the server is unreachable or times out. */
export function fetchServerCapabilities(): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const child = spawn("node", [path.join(ROOT, "dist", "lsp", "server.js"), "--dir", ROOT], {
      stdio: ["pipe", "pipe", "ignore"],
    })
    let buffer = ""
    const timer = setTimeout(() => {
      child.kill()
      resolve(null)
    }, 30_000)
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8")
      const match = /Content-Length:\s*(\d+)\r?\n\r\n/.exec(buffer)
      if (match) {
        const bodyStart = match.index + match[0].length
        const body = buffer.slice(bodyStart, bodyStart + Number(match[1]))
        try {
          const msg = JSON.parse(body)
          const caps = msg?.result?.capabilities
          clearTimeout(timer)
          child.kill()
          resolve(caps && typeof caps === "object" ? (caps as Record<string, unknown>) : null)
        } catch {
          // wait for more data
        }
      }
    })
    child.on("error", () => {
      clearTimeout(timer)
      resolve(null)
    })
    const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: {} } })
    child.stdin.write(`Content-Length: ${Buffer.byteLength(init)}\r\n\r\n${init}`)
  })
}
