// script/m21/verify-embedding-provider.ts — M21.E3
// Uses a local HTTP server only. This measures client behavior and local mock
// latency; it does not claim latency for any external provider.

import { createServer, type Server } from "node:http"
import { writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
let checks = 0
let passed = 0
let negatives = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function negative(label: string, ok: boolean, detail = "") {
  negatives++
  check(`${label} [negative]`, ok, detail)
}
function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve((server.address() as any).port))
  })
}
function close(server: Server): Promise<void> { return new Promise((resolve) => server.close(() => resolve())) }
async function request(baseURL: string, mode: string, apiKey: string) {
  const { embedOpenAICompatible } = await import("../../src/brain/semantic/openai-embed")
  const started = performance.now()
  try {
    const vectors = await embedOpenAICompatible(["alpha", "beta"], { baseURL: `${baseURL}/${mode}`, apiKey, model: "mock-model" })
    return { status: "success", elapsedMs: performance.now() - started, vectorCount: vectors.length }
  } catch (error) {
    return { status: "error", elapsedMs: performance.now() - started, error: String(error).replace(apiKey, "[REDACTED]") }
  }
}

const server = createServer(async (req, res) => {
  const body: string[] = []
  req.on("data", (chunk) => body.push(String(chunk)))
  await new Promise<void>((resolve) => req.on("end", () => resolve()))
  const mode = new URL(req.url ?? "/", "http://127.0.0.1").pathname.split("/").filter(Boolean)[0]
  if (mode === "slow") { await new Promise((resolve) => setTimeout(resolve, 80)) }
  if (mode === "rate") { res.writeHead(429, { "content-type": "application/json" }); res.end('{"error":"rate limited"}'); return }
  if (mode === "malformed") { res.writeHead(200, { "content-type": "application/json" }); res.end('{"data":[{"embedding":[1,2]}]}'); return }
  res.writeHead(200, { "content-type": "application/json" })
  res.end(JSON.stringify({ data: [{ embedding: [1, 0, 0] }, { embedding: [0, 1, 0] }] }))
})
let result: any
try {
  const port = await listen(server)
  const base = `http://127.0.0.1:${port}`
  const secret = "m21-e3-secret-not-for-evidence"
  const ok = await request(base, "ok", secret)
  check("E3 successful mock request returns the full batch", ok.status === "success" && ok.vectorCount === 2 && Number.isFinite(ok.elapsedMs), JSON.stringify(ok))
  check("E3 successful request records finite latency", ok.status === "success" && ok.elapsedMs >= 0)
  const rate = await request(base, "rate", secret)
  check("E3 rate-limit response is classified as an error", rate.status === "error" && /embedding API 429/.test(rate.error), JSON.stringify(rate))
  const malformed = await request(base, "malformed", secret)
  check("E3 malformed vector count is rejected", malformed.status === "error" && /returned 1 vectors for 2 inputs/.test(malformed.error), JSON.stringify(malformed))
  const slow = await request(base, "slow", secret)
  check("E3 slow local provider still returns within the bounded mock test", slow.status === "success" && slow.elapsedMs < 5000, JSON.stringify(slow))
  negative("E3 API secret is absent from captured errors", ![rate.error, malformed.error, slow.error].some((v) => v?.includes(secret)))
  negative("E3 rate-limit response is not treated as success", rate.status !== "success")
  negative("E3 malformed response is not treated as success", malformed.status !== "success")
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()
  result = {
    issue: "M21.E3", code: "E3", milestone: "M21",
    status: passed === checks && negatives >= 3 ? "verified" : "known-gap",
    checks, passed, failed: checks - passed, negativeCases: negatives,
    currentCommit: commit, workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m21/verify-embedding-provider.ts",
    evidenceFile: "E3.json", generatedAt: new Date().toISOString(),
    corpus: { kind: "local-http-mock", host: "127.0.0.1", revision: null },
    timings: { successMs: ok.elapsedMs, slowMockMs: slow.elapsedMs },
    outcomes: { success: ok.status, rateLimit: rate.status, malformed: malformed.status },
    redaction: { secretRecorded: false, placeholder: "[REDACTED]" },
    limitations: [
      "Local mock timing is client-path evidence only; it is not external provider latency.",
      "The current production client exposes errors but does not persist structured request timing or retry/rate-limit counters; E2/E3 production telemetry remains open."
    ]
  }
} catch (error) {
  check("E3 mock server session completes", false, String(error))
  result = { issue: "M21.E3", code: "E3", milestone: "M21", status: "known-gap", checks, passed, failed: checks - passed, negativeCases: negatives, currentCommit: "unknown", workingTreeRelevantChanges: [], verifierCommand: "bun run script/m21/verify-embedding-provider.ts", evidenceFile: "E3.json", generatedAt: new Date().toISOString(), limitations: [String(error)] }
} finally { await close(server).catch(() => undefined) }
mkdirSync(path.join(ROOT, "validation/m21/results"), { recursive: true })
writeFileSync(path.join(ROOT, "validation/m21/results/E3.json"), JSON.stringify(result, null, 2) + "\n")
console.log(`E3: ${result.status.toUpperCase()} (${result.passed}/${result.checks}, ${result.negativeCases} negative)`)
process.exit(result.status === "verified" ? 0 : 1)
