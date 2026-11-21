// script/m13/verify-index-exits-when-provider-limits.ts
//
// THE DEFECT THIS EXISTS FOR, reported by the owner on bettercap (1,972 files):
//
//   "last but not least when the index completes, it is stuck there, i don't know
//    why, but i had to press ctrl c after at least 2 minutes of waiting"
//
// — with the run's own output ending at `consistency: every internal relationship is
// attached to a symbol`. So the INDEX finished and the PROCESS did not exit.
//
// The CLI sets `process.exitCode` rather than calling `process.exit()`, so anything
// still holding the event loop keeps the process alive forever after the work is done.
// The reported run also had a rate-limited embedding provider, and a rate-limited
// provider is the one path that makes the embedding queue retry instead of finishing.
//
// This gate drives a REAL index against a provider that ALWAYS answers 429, then
// asserts the process exits on its own. It runs the index in a child process and
// kills it at a hard deadline, because the failure mode is an infinite wait: a
// test that waits is not a test.
//
// RED control: reinstate an unbounded flush (or a provider retry with no deadline)
// and the child is killed at the deadline with exit !== 0.

import { createServer } from "node:http"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { spawn } from "node:child_process"
import * as path from "node:path"

let failures = 0
let checks = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const ROOT = path.resolve(import.meta.dirname, "../..")
const SCRATCH = path.join(ROOT, ".tools/index-exit")
const SRC = path.join(SCRATCH, "proj")
const DATA = path.join(SCRATCH, "data")

console.log("M13 index exits after finishing (rate-limited provider)\n")
rmSync(SCRATCH, { recursive: true, force: true })
mkdirSync(path.join(SRC, "src"), { recursive: true })

// Enough symbols that the embedding queue actually batches, plus imports so the
// derived phases run — the phases that printed LAST in the reported hang.
const FILES = 24
for (let i = 0; i < FILES; i++) {
  const n = String(i).padStart(2, "0")
  const prev = i > 0 ? `import { fn${String(i - 1).padStart(2, "0")} } from "./f${String(i - 1).padStart(2, "0")}"\n` : ""
  writeFileSync(path.join(SRC, "src", `f${n}.ts`), `${prev}export function fn${n}(a: number): number { return a + ${i} }\n`)
}
writeFileSync(path.join(SRC, "package.json"), '{"name":"index-exit","version":"1.0.0"}\n')

// A provider that ALWAYS rate-limits. This is what makes the queue retry.
let calls = 0
const server = createServer((req, res) => {
  if (req.method !== "POST") { res.writeHead(404); return res.end() }
  calls++
  let raw = ""
  req.on("data", (d) => (raw += d))
  req.on("end", () => {
    res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "1" })
    res.end(JSON.stringify({ error: { message: "rate limited" } }))
  })
})
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
const addr = server.address()
const port = typeof addr === "object" && addr ? addr.port : 0

const CLI = path.join(ROOT, "bin", "bb")
const HARD_DEADLINE_MS = 240_000

const started = Date.now()
let childOutput = ""
const child = spawn(CLI, ["index", "."], {
  cwd: SRC,
  env: {
    ...process.env,
    BB_DATA_DIR: DATA,
    BB_EMBEDDING_BASE_URL: `http://127.0.0.1:${port}`,
    BB_EMBEDDING_API_KEY: "test-key",
    BB_EMBEDDING_MODEL: "mock/embed-4d",
    BB_EMBEDDING_DIMENSION: "4",
    // Keep the run short: the point is that the process EXITS, not how long it works.
    BB_EMBEDDING_TIMEOUT_MS: "2000",
  },
  stdio: ["ignore", "pipe", "pipe"],
})
child.stdout.on("data", (d) => { childOutput += d })
child.stderr.on("data", (d) => { childOutput += d })

const outcome = await new Promise<{ code: number | null; signalled: boolean; timedOut: boolean }>((resolve) => {
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try { child.kill("SIGKILL") } catch {}
  }, HARD_DEADLINE_MS)
  child.on("exit", (code, signal) => {
    clearTimeout(timer)
    resolve({ code, signalled: signal !== null, timedOut })
  })
})
server.close()
const elapsedMs = Date.now() - started

const finished = /consistency:|breakdown:|Index health|derived:/i.test(childOutput)
const reportedProgress = calls > 0 ? `${calls} provider call(s)` : "no provider call"

check("THE REPORTED DEFECT: the index run FINISHED (it printed its summary)", finished, childOutput.slice(-300))
check("THE REPORTED DEFECT: the process then EXITED on its own", !outcome.timedOut, `killed at the ${HARD_DEADLINE_MS}ms deadline after ${Math.round(elapsedMs / 1000)}s (${reportedProgress})`)
check("the rate-limited provider was actually exercised", calls > 0, reportedProgress)
check("it exited successfully rather than being signalled", outcome.code === 0 && !outcome.signalled, `code=${outcome.code} signalled=${outcome.signalled}`)
check("it did not burn the whole deadline", elapsedMs < HARD_DEADLINE_MS, `${Math.round(elapsedMs / 1000)}s`)

rmSync(SCRATCH, { recursive: true, force: true })
console.log(`\n${checks - failures}/${checks} passed`)
console.log(failures === 0 ? "INDEX EXIT: PASS" : `INDEX EXIT: FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
