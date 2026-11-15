import { spawn } from "node:child_process"
import path from "node:path"
const ROOT = path.resolve(import.meta.dirname!, "..", "..", "..", "..")
const repo = process.argv[2]!
const args = JSON.parse(process.argv[3] ?? "{}")
const child = spawn("node", ["--import", "tsx", path.join(ROOT, "src/cli/index.ts"), "mcp", "--dir", repo], {
  cwd: ROOT,
  env: { ...process.env, BB_DATA_DIR: path.resolve(import.meta.dirname!, "..", "bbdata"), BB_NO_AUTO_REFRESH: "1" },
  stdio: ["pipe", "pipe", "pipe"],
})
let out = "", err = ""
child.stdout.on("data", (c) => { out += String(c) })
child.stderr.on("data", (c) => { err += String(c) })
const send = (obj: any) => child.stdin.write(JSON.stringify(obj) + "\n")
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "raw", version: "1" } } })
setTimeout(() => {
  send({ jsonrpc: "2.0", method: "notifications/initialized" })
  send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "bb_visualize", arguments: args } })
}, 300)
setTimeout(() => {
  console.log(JSON.stringify({ stdoutBytes: out.length, stderrBytes: err.length, exitCode: child.exitCode, signal: child.signalCode, stderrTail: err.split("\n").filter(Boolean).slice(-6) }, null, 1))
  child.kill()
}, 12000)
child.on("exit", (code, signal) => { console.log(JSON.stringify({ event: "exit", code, signal, stderrTail: err.split("\n").filter(Boolean).slice(-4) })) })
