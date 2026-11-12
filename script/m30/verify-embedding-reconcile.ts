// script/m30/verify-embedding-reconcile.ts — provider change repairs vectors.
//
// The failure this gate exists for: changing the embedding model via `bb setup`
// left the existing index untouched. An unchanged index parses no files, so the
// incremental path queued no symbols and every stored vector still belonged to
// the old model; `bb index` said "nothing to index" and the summary printed the
// stale model. This runs the real index + reconcile functions in-process:
//
//   index with local vectors -> change provider -> reconcile
//     -> every stored symbol is re-embedded under the new model, old rows for
//        those symbols are gone, and a second reconcile is a no-op.
//
// Deterministic: temp project + temp data dir + a loopback mock provider.
//
// Run: npx tsx script/m30/verify-embedding-reconcile.ts

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"

let checks = 0
let passed = 0
let failed = 0
const failures: string[] = []

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else {
    failed++
    failures.push(label + (detail ? ` — ${detail}` : ""))
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "m30-reconcile-"))
const root = path.join(tmp, "proj")
const dataDir = path.join(tmp, "data")
mkdirSync(path.join(root, "src"), { recursive: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(
  path.join(root, "src", "a.ts"),
  "export function alpha(x: number): number { return x + 1 }\n" +
    "export function beta(x: number): number { return alpha(x) * 2 }\n",
)
writeFileSync(
  path.join(root, "src", "b.ts"),
  'import { beta } from "./a"\nexport function gamma(x: number): number { return beta(x) + 3 }\n',
)
// More than two 250-symbol reconcile batches: the rate-limited pass must stop
// after two empty batches instead of walking the whole corpus.
writeFileSync(
  path.join(root, "src", "many.ts"),
  Array.from({ length: 600 }, (_, i) => `export function fn${i}(x: number): number { return x + ${i} }`).join("\n"),
)
process.env.BB_DATA_DIR = dataDir
delete process.env.BB_EMBEDDING_BASE_URL
delete process.env.BB_EMBEDDING_API_KEY
delete process.env.BB_EMBEDDING_MODEL
delete process.env.BB_EMBEDDING_DIMENSION
delete process.env.BB_EMBEDDING_DISABLED
process.chdir(root)

const { getProjectId } = await import("../../src/cli/index")
const { indexProjectParallel, flushBackgroundEmbeddings, reconcileEmbeddingModel } = await import("../../src/ast/parallel-indexer")
const { BrainDatabase } = await import("../../src/brain/database")
const { SemanticEngine } = await import("../../src/brain/semantic/engine")
const { validateKey } = await import("../../src/setup/setup-wizard")

const projectId = getProjectId(root)
const db = await BrainDatabase.getRawInstance(projectId)
const models = (): Array<{ model: string; dimension: number; count: number }> =>
  db
    .prepare(
      `SELECT embedding_model AS model, vector_dimension AS dimension, COUNT(*) AS count
         FROM brain_semantic_embedding GROUP BY embedding_model, vector_dimension ORDER BY count DESC`,
    )
    .all() as Array<{ model: string; dimension: number; count: number }>

try {
  // --- 1. Local index: stored vectors are the local model. -------------------
  await indexProjectParallel(projectId, root, {})
  await flushBackgroundEmbeddings()
  const local = models()
  check("local index stores local-word-vectors-v3", local.length === 1 && local[0].model === "local-word-vectors-v3", JSON.stringify(local))
  const symbolCount = Number((db.prepare("SELECT COUNT(*) AS c FROM brain_symbol").get() as any)?.c ?? 0)
  check("fixture has symbols to re-embed", symbolCount > 0, String(symbolCount))

  // --- 2. Provider configured: reconcile replaces every stored vector. ------
  let dim = 4
  let failing = true
  let providerCalls = 0
  const server = createServer((req, res) => {
    let raw = ""
    req.on("data", (chunk) => (raw += chunk))
    req.on("end", () => {
      providerCalls++
      let body: any = {}
      try {
        body = JSON.parse(raw)
      } catch {}
      if (failing) {
        res.writeHead(429, { "content-type": "application/json", "retry-after": "1" })
        res.end(JSON.stringify({ error: "rate limited" }))
        return
      }
      const inputs = Array.isArray(body.input) ? body.input : [body.input]
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          model: body.model,
          data: inputs.map((_: unknown, index: number) => ({
            embedding: Array.from({ length: dim }, (_, i) => (i + 1) / 10),
            index,
          })),
        }),
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as any).port
  process.env.BB_EMBEDDING_BASE_URL = `http://127.0.0.1:${port}/v1`
  process.env.BB_EMBEDDING_API_KEY = "test-key"
  process.env.BB_EMBEDDING_MODEL = "mock/embed-4d"

  let started: any = null
  // --- 2a. Provider rate-limited: keep every old vector, report the remainder.
  const failedRun = await reconcileEmbeddingModel(projectId, root, {
    onStart: (info) => {
      started = info
    },
  })
  check("a rate-limited pass reports the remaining symbols", failedRun.status === "reconciled" && failedRun.remaining === symbolCount, JSON.stringify(failedRun))
  check("a rate-limited pass converts nothing", failedRun.embedded === 0, JSON.stringify(failedRun))
  check("a rate-limited pass STOPS instead of churning every batch", failedRun.stoppedEarly === true, JSON.stringify(failedRun))
  check("the circuit breaker made at most two provider calls", providerCalls <= 2, `${providerCalls} calls`)
  check("a rate-limited pass does NOT overwrite good vectors with local fallback", models().length === 1 && models()[0].model === "local-word-vectors-v3", JSON.stringify(models()))
  check("onStart names the old and new provider models", started?.configuredModel === "mock/embed-4d" && started?.storedModels?.some((m: any) => m.model === "local-word-vectors-v3"), JSON.stringify(started))

  // --- 2b. Retry (after the 1s Retry-After window) only the missing symbols.
  failing = false
  await new Promise((resolve) => setTimeout(resolve, 1600))
  const first = await reconcileEmbeddingModel(projectId, root)
  check("reconcile reports a model change", first.status === "reconciled", JSON.stringify(first))
  check("reconcile counted every pending symbol", first.symbols === symbolCount, `${first.symbols} vs ${symbolCount}`)
  check("retry embeds every pending symbol", first.embedded === symbolCount && first.remaining === 0, JSON.stringify(first))
  const after = models()
  check(
    "stored vectors now belong only to the configured model",
    after.length === 1 && after[0].model === "mock/embed-4d" && after[0].dimension === dim,
    JSON.stringify(after),
  )

  // --- 3. A second run is a no-op (no needless re-embedding). ---------------
  const second = await reconcileEmbeddingModel(projectId, root)
  check("same provider is in-sync", second.status === "in-sync", JSON.stringify(second))

  // --- 4. Changing again re-embeds again and leaves no old model rows. -----
  dim = 6
  process.env.BB_EMBEDDING_MODEL = "mock/embed-6d"
  const third = await reconcileEmbeddingModel(projectId, root)
  check("a second model change reconciles", third.status === "reconciled" && third.embedded === symbolCount, JSON.stringify(third))
  const final = models()
  check(
    "only the newest model remains after the second change",
    final.length === 1 && final[0].model === "mock/embed-6d" && final[0].dimension === 6,
    JSON.stringify(final),
  )

  server.close()

  // --- 5. Asymmetric models: input_type is chosen per side and per provider. ---
  check(
    "NVIDIA Nemotron 3.5 passages use input_type=passage",
    SemanticEngine.embeddingInputType(
      { baseURL: "https://integrate.api.nvidia.com/v1", model: "nvidia/nemotron-3.5-embed-8b" },
      "passage",
    ) === "passage",
  )
  check(
    "NVIDIA Nemotron 3.5 queries use input_type=query",
    SemanticEngine.embeddingInputType(
      { baseURL: "https://integrate.api.nvidia.com/v1", model: "nvidia/nemotron-3.5-embed-8b" },
      "query",
    ) === "query",
  )
  check(
    "symmetric NVIDIA models get no input_type",
    SemanticEngine.embeddingInputType(
      { baseURL: "https://integrate.api.nvidia.com/v1", model: "nvidia/nemotron-3-embed-1b" },
      "passage",
    ) === undefined,
  )
  check(
    "non-NVIDIA providers get no input_type",
    SemanticEngine.embeddingInputType(
      { baseURL: "https://openrouter.ai/api/v1", model: "nvidia/nemotron-3.5-embed-8b:free" },
      "passage",
    ) === undefined,
  )

  // The setup probe must carry the same field, or a valid NVIDIA 3.5 model is
  // rejected as a 400 during `bb setup`.
  let setupBody: any = null
  const setupValidation = await validateKey(
    "https://integrate.api.nvidia.com/v1",
    "test-key",
    "nvidia/nemotron-3.5-embed-8b",
    (async (_url: any, init: any) => {
      setupBody = JSON.parse(String(init?.body ?? "{}"))
      return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch,
  )
  check("setup validation sends input_type=passage for NVIDIA 3.5", setupBody?.input_type === "passage", JSON.stringify(setupBody))
  check("setup validation accepts the asymmetric model", setupValidation.dimension === 4, JSON.stringify(setupValidation))
} finally {
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {}
}

console.log("")
console.log(`  checks: ${passed}/${checks} passed`)
if (failed > 0) {
  console.log("VERDICT: FAIL")
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exit(1)
}
console.log("VERDICT: PASS")
