/**
 * P2-3 gate — embedding provider lifecycle: a configured model space that is
 * under-covered must NOT hard-filter the scan to near-empty; the read path must
 * fall back to the most populated dense space WITH a declared fallback and a
 * declared pending-backfill state.
 *
 * Defect (triage ISSUE-09, PLAN P2-3): bettercap's configured
 * `nvidia/nemotron-3.5-embed-8b` space holds 1/55,785 vectors while
 * `local-word-vectors-v3` holds 23,924. `semanticVectorSearch` embeds the query
 * into the configured space and then hard-filters
 * (`WHERE embedding_model = ? AND vector_dimension = ?`,
 * src/intelligence/search/semantic-search.ts:329-333), so the populated space is
 * invisible and the answer degrades to an undeclared keyword fallback.
 *
 * Method: a real fixture index in a temp BB_DATA_DIR (never ~/.bb, never the
 * user's config) + a local mock OpenAI-compatible embedding endpoint. The same
 * fixture is queried twice:
 *   leg A ("provider switched"): 1 configured-model row vs many local rows
 *          -> REQUIRED: vector answer from the populated local space with
 *             queryModel=local-word-vectors-v3, fallbackReason declared,
 *             pending-backfill named.
 *   leg B (control, "configured space backfilled"): all symbols have
 *          configured-model rows -> REQUIRED: vector answer in the configured
 *          space, NO fallback reason (the positive control).
 *
 * This gate is RED before the fix: leg A returns method=keyword-fallback.
 */

import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const scratch = mkdtempSync(path.join(ROOT, ".tools", "triage-fix", "embeddings-health", "gate-"))
process.env.BB_DATA_DIR = path.join(scratch, "data")

const CONFIGURED_MODEL = "test/configured-embed"
const LOCAL_MODEL = "local-word-vectors-v3"
const DIM = 4096

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const homeConfig = path.join(process.env.HOME ?? "", ".bb", "config.json")
const configBefore = existsSync(homeConfig) ? createHash("sha256").update(readFileSync(homeConfig)).digest("hex") : null

/** Deterministic unit-ish vector for a text, so the mock is reproducible. */
function vecFor(text: string): number[] {
  const h = createHash("sha256").update(text).digest()
  const v: number[] = []
  for (let i = 0; i < DIM; i++) v.push((h[i % h.length] / 255) * 2 - 1 + (i % 7) * 1e-6)
  return v
}

/** OpenAI-compatible /embeddings mock (the provider the gate "configures"). */
async function startMock(): Promise<{ server: Server; baseURL: string }> {
  const server = createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.endsWith("/embeddings")) {
      res.writeHead(404); res.end("not found"); return
    }
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body)
        const inputs: string[] = Array.isArray(parsed.input) ? parsed.input : [String(parsed.input)]
        const data = inputs.map((text, index) => ({ object: "embedding", index, embedding: vecFor(text) }))
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ object: "list", data, model: CONFIGURED_MODEL }))
      } catch (e: any) {
        res.writeHead(400); res.end(String(e?.message ?? e))
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address() as { port: number }
  return { server, baseURL: `http://127.0.0.1:${addr.port}/v1` }
}

async function main(): Promise<void> {
  mkdirSync(path.join(scratch, "project", "src"), { recursive: true })
  const root = path.join(scratch, "project")
  // Enough symbols that ONE configured-model row is <5% coverage (bettercap's
  // measured ratio is 1/55,785 = 0.0018%): with only 3 symbols, 1/3 = 33% would
  // sit ABOVE the floor and the gate would not exercise the under-covered path.
  // Every body carries the query's vocabulary so the LOCAL space can produce a
  // vector answer above its 0.5 floor — that is the populated space the fix must
  // fall back to.
  for (let n = 0; n < 24; n++) {
    writeFileSync(path.join(root, "src", `handler${n}.ts`),
      `export function requestHandler${n}(request: string, rate: number): string { ` +
      `const limited = request + "handled"; return limited + rate } // retry session startup modules\n`)
  }

  const { getProjectId } = await import("../src/cli/index")
  const { indexProjectParallel, flushBackgroundEmbeddings } = await import("../src/ast/parallel-indexer")
  const { BrainDatabase } = await import("../src/brain/database")
  const { semanticVectorSearch } = await import("../src/intelligence/search/semantic-search")

  const projectId = getProjectId(root)

  // Phase 1: index while the provider is unreachable -> the indexer writes local
  // word-vector rows for every symbol (the measured degradation path).
  process.env.BB_EMBEDDING_BASE_URL = "http://127.0.0.1:9/v1"
  process.env.BB_EMBEDDING_MODEL = "test/unreachable-embed"
  process.env.BB_EMBEDDING_API_KEY = "gate-only-not-a-secret"
  await indexProjectParallel(projectId, root, {})
  await flushBackgroundEmbeddings()

  let raw: any = await BrainDatabase.getRawInstance(projectId)
  const symbolCount = Number((raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(projectId) as any)?.c ?? 0)
  const localRows = Number((raw.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id=? AND embedding_model=?").get(projectId, LOCAL_MODEL) as any)?.c ?? 0)
  console.log(`  (fixture: ${symbolCount} symbols, ${localRows} local-word-vector rows)`)
  check("fixture has a populated local space", localRows > 0, `localRows=${localRows}`)

  // Phase 2: "provider switched" — the mock answers, configured model = mock.
  const mock = await startMock()
  process.env.BB_EMBEDDING_BASE_URL = mock.baseURL
  process.env.BB_EMBEDDING_MODEL = CONFIGURED_MODEL
  process.env.BB_EMBEDDING_API_KEY = "gate-only-not-a-secret"

  // Exactly ONE row in the configured space (bettercap: 1/55,785).
  const { encodeVectorBlob } = await import("../src/brain/semantic/vector-binary")
  const oneSymbol = raw.prepare("SELECT id FROM brain_symbol WHERE project_id=? LIMIT 1").get(projectId) as any
  const oneVec = vecFor("core/options.go:ParseOptions:26")
  raw.prepare(
    `INSERT OR REPLACE INTO brain_semantic_embedding
     (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, embedding_blob, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(`${oneSymbol.id}:embed`, projectId, oneSymbol.id, "symbol", CONFIGURED_MODEL, "", encodeVectorBlob(oneVec), DIM,
    "gate", "{}", 0.7, Date.now(), Date.now(), Date.now())

  const legA = await semanticVectorSearch(projectId as any, "request handler request handled rate limited retry session startup modules", { maxResults: 5 })
  console.log(`  leg A: method=${legA.metadata.method} queryModel=${legA.metadata.queryModel} fallbackReason=${(legA.metadata as any).fallbackReason ?? "none"} comparable=${legA.comparison.comparableEmbeddings}/${legA.comparison.comparableSymbols}`)
  const configuredSpaceNamed = legA.provenance.unknowns.some((u) => u.includes(CONFIGURED_MODEL) && /\b1\/24\b/.test(u))
  check("A1: the under-covered configured space (1/24) is measured and named", configuredSpaceNamed, JSON.stringify(legA.provenance.unknowns))
  check("A2: read path does NOT hard-filter to the near-empty configured space", legA.metadata.method === "vector", `method=${legA.metadata.method}`)
  check("A3: answered from the populated local space", legA.metadata.queryModel === LOCAL_MODEL, `queryModel=${legA.metadata.queryModel}`)
  check("A4: fallback is DECLARED", (legA.metadata as any).fallbackReason === "configured-model-space-under-covered",
    `fallbackReason=${(legA.metadata as any).fallbackReason ?? "none"}`)
  check("A5: pending backfill is named with the configured model", legA.provenance.unknowns.some((u) => u.includes(CONFIGURED_MODEL) && /backfill/i.test(u)),
    JSON.stringify(legA.provenance.unknowns))
  check("A6: provenance records the fallback evidence class/unknown", legA.provenance.unknowns.length > 0)

  // leg B — positive control: configured space backfilled for every symbol.
  const symbols = raw.prepare("SELECT id FROM brain_symbol WHERE project_id=?").all(projectId) as any[]
  const fill = raw.prepare(
    `INSERT OR REPLACE INTO brain_semantic_embedding
     (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, embedding_blob, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  // Every symbol gets the vector the mock returns for the query text -> cosine 1.
  const queryText = "request handler request handled rate limited retry session startup modules"
  const qvec = vecFor(queryText)
  raw.transaction((rows: any[]) => {
    for (const s of rows) {
      fill.run(`${s.id}:embed`, projectId, s.id, "symbol", CONFIGURED_MODEL, "", encodeVectorBlob(qvec), DIM,
        "gate", "{}", 0.7, Date.now(), Date.now(), Date.now())
    }
  })(symbols)
  raw = await BrainDatabase.getRawInstance(projectId)
  const legB = await semanticVectorSearch(projectId as any, queryText, { maxResults: 5 })
  console.log(`  leg B: method=${legB.metadata.method} queryModel=${legB.metadata.queryModel} fallbackReason=${(legB.metadata as any).fallbackReason ?? "none"} comparable=${legB.comparison.comparableEmbeddings}/${legB.comparison.comparableSymbols}`)
  check("B1 (control): backfilled configured space answers with vectors", legB.metadata.method === "vector", `method=${legB.metadata.method}`)
  check("B2 (control): the configured model produced the query vector", legB.metadata.queryModel === CONFIGURED_MODEL, `queryModel=${legB.metadata.queryModel}`)
  check("B3 (control): no fallback is declared when the configured space is populated",
    (legB.metadata as any).fallbackReason === undefined || String((legB.metadata as any).fallbackReason).length === 0,
    `fallbackReason=${(legB.metadata as any).fallbackReason ?? "none"}`)
  check("B4 (control): results exist in the configured space", legB.results.length > 0)

  // No config mutation: the user's real ~/.bb/config.json is byte-identical.
  const configAfter = existsSync(homeConfig) ? createHash("sha256").update(readFileSync(homeConfig)).digest("hex") : null
  check("C1 (control): user embedding config was not mutated", configBefore === configAfter)

  await new Promise<void>((resolve) => mock.server.close(() => resolve()))
}

try {
  await main()
} catch (error) {
  failures++
  console.log(`  FAIL: gate crashed — ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

console.log(failures === 0 ? "\nEMBEDDING LIFECYCLE: PASS" : `\nEMBEDDING LIFECYCLE: ${failures} FAILURE(S)`)
process.exit(failures > 0 ? 1 : 0)
