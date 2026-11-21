// script/m13/verify-backfill-completes-on-422.ts
//
// THE DEFECT THIS EXISTS FOR, reported on the 0.1.9 build the owner installed:
//
//   "Backfill still stops on repeated provider 422 (400 embedded, 55,185 missing);
//    it reports pending but does not skip rejected inputs."
//
// It was still broken after 0.1.9 because the fix was MIS-WIRED: the reconcile path
// caught a 422 from `embedMany`, but `embedMany` swallowed the 422 and returned `[]`
// (its catch logs at debug and, with allowLocalFallback:false, returns empty). The
// catch never fired, so the tolerated bisection never ran — a unit test of the
// bisection proved the ALGORITHM worked while the WIRING was dead.
//
// So this gate drives the REAL reconcile pass against a REAL HTTP provider that
// refuses certain inputs with 422, and asserts the run completes with the healthy
// symbols embedded and the refused ones counted — the observable the owner sees,
// not a unit property of a helper.
//
// RED control: reintroduce the swallow (remove the `throw e` in embedMany's 422
// branch) and this gate fails with embedded=0 and the run stalling.

import { createServer } from "node:http"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import * as path from "node:path"

let failures = 0
let checks = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const ROOT = path.resolve(import.meta.dirname, "../..")
const SCRATCH = path.join(ROOT, ".tools/backfill-422")
const SRC = path.join(SCRATCH, "src")
const DATA = path.join(SCRATCH, "data")

console.log("M13 backfill completes through a repeated 422\n")
rmSync(SCRATCH, { recursive: true, force: true })
mkdirSync(SRC, { recursive: true })

// Enough symbols that a batch-level failure cannot be mistaken for a small sample,
// and a poison marker that will sit inside exactly one of them.
const SYMBOLS = 12
for (let i = 0; i < SYMBOLS; i++) {
  const name = `fn${String(i).padStart(2, "0")}`
  // The marker must be inside the SYMBOL's own source text, because that is what the
  // reconcile embeds — a marker in a separate declaration never reaches a snippet,
  // which is how the first version of this gate embedded all 16 symbols cleanly and
  // proved nothing about the 422 path.
  const body = i === 6 ? ' const s = "POISON-CONTENT-SAFETY"; return n + s.length + ' + i : ` return n + ${i}`
  writeFileSync(path.join(SRC, `${name}.ts`), `export function ${name}(n: number): number {${body} }\n`)
}
writeFileSync(path.join(SRC, "package.json"), '{"name":"backfill-422","version":"1.0.0"}\n')

process.env.BB_DATA_DIR = DATA
const { getProjectId } = await import("../../src/util/project-id")
const { indexProjectParallel } = await import("../../src/ast/parallel-indexer")
const projectId = getProjectId(SRC)
await indexProjectParallel(projectId, SRC, {})

// ── drive the REAL reconcile pass against a REAL 422 provider ────────────────
//
// The provider lives INSIDE the child, and the parent only starts it. A first
// version of this gate put the server in the parent and used spawnSync — which
// blocks the parent's event loop, so the server could never answer the child's
// HTTP request and every call timed out at 60s. That looked exactly like a product
// defect (embedded=0, failed=16) and was a test defect. Keeping the server in the
// same process as the client removes the class of mistake.
const FIXTURE = `
import { createServer } from "node:http"
import { reconcileEmbeddingModel } from ${JSON.stringify(path.join(ROOT, "src/ast/parallel-indexer.ts"))}

let calls = 0
let refusedCalls = 0
const server = createServer((req, res) => {
  if (req.method !== "POST") { res.writeHead(404); return res.end() }
  calls++
  let raw = ""
  req.on("data", (d) => (raw += d))
  req.on("end", () => {
    let inputs: string[] = []
    try { const b = JSON.parse(raw); inputs = Array.isArray(b.input) ? b.input : [b.input] } catch {}
    if (inputs.some((t) => typeof t === "string" && t.includes("POISON-CONTENT-SAFETY"))) {
      refusedCalls++
      res.writeHead(422, { "Content-Type": "application/json" })
      return res.end(JSON.stringify({ error: { message: "input rejected by content safety screening" } }))
    }
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({
      model: "mock/embed-4d",
      data: inputs.map((_, i) => ({ embedding: [0.25, 0.5, 0.75, 1.0], index: i })),
      usage: { total_tokens: inputs.length },
    }))
  })
})
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const addr = server.address()
const base = "http://127.0.0.1:" + (typeof addr === "object" && addr ? addr.port : 0)
process.env.BB_EMBEDDING_BASE_URL = base
process.env.BB_EMBEDDING_API_KEY = "test-key"
process.env.BB_EMBEDDING_MODEL = "mock/embed-4d"
process.env.BB_EMBEDDING_DIMENSION = "4"

const r = await reconcileEmbeddingModel(process.env.PID_CODE, process.env.PROJ_PATH, {})
server.close()
console.log("JSON:" + JSON.stringify({ result: r, calls, refusedCalls }))
process.exit(0)
`
const scriptPath = path.join(SCRATCH, "drive.ts")
writeFileSync(scriptPath, FIXTURE)

const run = spawnSync(process.execPath, [path.join(ROOT, "node_modules/.bin/tsx"), scriptPath], {
  cwd: ROOT,
  encoding: "utf8",
  timeout: 300_000,
  env: { ...process.env, BB_DATA_DIR: DATA, PID_CODE: projectId, PROJ_PATH: SRC },
})

const line = (run.stdout || "").split("\n").find((l) => l.startsWith("JSON:"))
if (!line) {
  console.log(`  FAIL: the reconcile pass produced no result (exit ${run.status})`)
  console.log((run.stdout || "").slice(-1200))
  console.log((run.stderr || "").slice(-1200))
  failures++
} else {
  const parsed = JSON.parse(line.slice(5))
  const r = parsed.result
  console.log("  DEBUG result:", JSON.stringify({ ...r, calls: parsed.calls, refusedCalls: parsed.refusedCalls }))
  check("THE REPORTED DEFECT: the reconcile pass COMPLETES instead of stalling", r.status === "reconciled", JSON.stringify({ status: r.status, embedded: r.embedded, remaining: r.remaining }))
  check("the provider was actually called (the path was exercised)", parsed.calls > 0, `calls=${parsed.calls}`)
  check("the provider really refused (the 422 branch ran)", parsed.refusedCalls > 0, `refusedCalls=${parsed.refusedCalls}`)
  check("healthy symbols were embedded", r.embedded > 0, `embedded=${r.embedded} of ${r.totalSymbols}`)
  check("the refused input did NOT fail every symbol", r.failed < r.totalSymbols, `failed=${r.failed} of ${r.totalSymbols}`)
  check("the refused input is counted, not silently dropped", (r.rejected ?? 0) > 0, `rejected=${r.rejected}`)
  check("the run did not stop early", r.stoppedEarly === false, String(r.stoppedEarly))
}

rmSync(SCRATCH, { recursive: true, force: true })
console.log(`\n${checks - failures}/${checks} passed`)
console.log(failures === 0 ? "BACKFILL 422: PASS" : `BACKFILL 422: FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
