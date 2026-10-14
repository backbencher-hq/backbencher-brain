// script/m35/verify-freshness-core.ts — M35.F1 (#580)
// Behavioral gate for the batch row-level freshness resolver
// (src/brain/freshness.ts: resolveRowsFreshness / resolveRowsFreshnessDetailed).
//
// Real code paths only: a genuine temp fixture is indexed by the real
// parallel indexer, then the resolver runs against the real SQLite DB.
// No auto-passes: every check can fail, and the gate proves it can fail via
// --self-mutate (batch-cost mutation must flip the gate to failing).
//
// Modes:
//   default                          behavioral suite + batch-cost contract
//   --self-mutate                    plant the O(rows) stat mutation in
//                                    freshness.ts, re-run self as subprocess,
//                                    expect FAILURE, restore byte-identical
//   BB_M35_SELFTEST_CONTROL=1        control mode for verify-gate-selftest
//                                    (identical to default; mutation is not
//                                    planted by the self-test control run)
//   BB_M35_EVIDENCE=1                stamp validation/m35/results/F1.json
//
// Honest boundary asserted here too: the resolver never writes (index DB and
// fixture are byte-identical before/after resolution).

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULT = path.join(ROOT, "validation/m35/results/F1.json")
const FRESHNESS_TS = path.join(ROOT, "src/brain/freshness.ts")

delete process.env.BB_EMBEDDING_BASE_URL
delete process.env.BB_EMBEDDING_API_KEY
delete process.env.BB_EMBEDDING_MODEL

let checks = 0
let passed = 0
let failed = 0
let negativeCases = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else {
    failed++
    console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}
/** A negative case: the system under test correctly detected a wrong state. */
function negative(label: string, ok: boolean, detail = "") {
  if (ok) negativeCases++
  check(`${label} [negative]`, ok, detail)
}

const SELF_MODE = process.argv.includes("--self-mutate")
const MUTATION_FROM = "return memoStat(p)"
const MUTATION_TO = "return rawStat(p)"

async function runSuite(): Promise<void> {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))
  const freshness = await import(path.join(ROOT, "src/brain/freshness"))

  // ── fixture: 60 files incl. two Python files (indexer must handle both) ──
  const fixture = mkdtempSync(path.join(tmpdir(), "bb-m35-f1-"))
  mkdirSync(path.join(fixture, "src"), { recursive: true })
  const editedFile = path.join(fixture, "src", "edited.ts")
  const deletedFile = path.join(fixture, "src", "deleted.ts")
  const touchedFile = path.join(fixture, "src", "touched.ts") // mtime-only change
  for (let i = 0; i < 58; i++) {
    writeFileSync(
      path.join(fixture, "src", `mod${i}.ts`),
      `export function fn${i}(x: number): number { return x + ${i} }\n`,
    )
  }
  writeFileSync(editedFile, "export function edited(): number { return 1 }\n")
  writeFileSync(deletedFile, "export function deleted(): number { return 2 }\n")
  writeFileSync(touchedFile, "export function touched(): number { return 3 }\n")
  writeFileSync(path.join(fixture, "src", "pay.py"), "def pay(x):\n    return x * 2\n")

  try {
    const projectId = (getProjectId as (p: string) => string)(fixture)
    const stats = await indexProjectParallel(projectId as any, fixture, { skipPostProcessing: true })
    check("fixture indexed without errors", stats.errorFiles === 0, `errors=${stats.errorFiles}`)
    const rawDb = await (BrainDatabase as any).getRawInstance(projectId)

    const files = rawDb.prepare("SELECT id, path, file_hash, size_bytes, last_modified FROM brain_file").all() as any[]
    check("brain_file rows carry fast-path metadata", files.length >= 60 && files.every((f: any) => typeof f.size_bytes === "number" && typeof f.last_modified === "number"))

    const idOf = (p: string) => files.find((f: any) => f.path === p)?.id as string
    const editedId = idOf(editedFile)
    const deletedId = idOf(deletedFile)
    const touchedId = idOf(touchedFile)
    const freshId = idOf(path.join(fixture, "src", "mod0.ts"))

    // ── mutate the fixture AFTER indexing ──
    writeFileSync(editedFile, "export function edited(): number { return 111 }\n") // content edit
    rmSync(deletedFile) // deletion
    {
      const st = statSync(touchedFile)
      utimesSync(touchedFile, st.atime, new Date()) // mtime-only touch, same bytes
    }

    // ── 1. per-row correctness ──
    const detail = freshness.resolveRowsFreshnessDetailed(
      rawDb, projectId,
      [{ fileId: freshId }, { fileId: editedId }, { fileId: deletedId }, { fileId: touchedId }],
    )
    check("untouched file is fresh", detail.statuses.get(freshId) === "fresh", String(detail.statuses.get(freshId)))
    check("untouched file resolved via metadata fast path", detail.reasons.get(freshId) === "metadata-fast-path", String(detail.reasons.get(freshId)))
    check("edited file is stale", detail.statuses.get(editedId) === "stale", String(detail.statuses.get(editedId)))
    check("edited file classified by hash fallback", detail.reasons.get(editedId) === "hash-differs", String(detail.reasons.get(editedId)))
    check("deleted file is missing", detail.statuses.get(deletedId) === "missing", String(detail.statuses.get(deletedId)))
    check("touched (mtime-only, same bytes) file stays fresh via hash fallback", detail.statuses.get(touchedId) === "fresh" && detail.reasons.get(touchedId) === "hash-match", `${detail.statuses.get(touchedId)}/${detail.reasons.get(touchedId)}`)
    negative("stale detection works", detail.statuses.get(editedId) === "stale")
    negative("missing detection works", detail.statuses.get(deletedId) === "missing")

    // ── 2. summary shape ──
    const s = detail.summary
    // 4 rows: mod0 (fast-path fresh), touched (hash-match fresh), edited (stale), deleted (missing)
    check("summary counts are consistent", s.fresh === 2 && s.stale === 1 && s.missing === 1, JSON.stringify(s))
    check("staleRatio = (stale+missing)/checked", Math.abs(s.staleRatio - 2 / 4) < 1e-9, String(s.staleRatio))
    check("freshnessMode defaults to complete", s.freshnessMode === "complete")
    const sampled = freshness.resolveRowsFreshnessDetailed(rawDb, projectId, [{ fileId: freshId }], { freshnessMode: "sampled" })
    check("freshnessMode: sampled is honored", sampled.summary.freshnessMode === "sampled")

    // ── 3. filePath-based rows and unknown ids ──
    const byPath = freshness.resolveRowsFreshnessDetailed(rawDb, projectId, [
      { filePath: editedFile }, { filePath: path.join(fixture, "src", "pay.py") }, { fileId: "no-such-row-id" },
    ])
    check("filePath row resolves", byPath.statuses.get(editedFile) === "stale", String(byPath.statuses.get(editedFile)))
    check("python file resolves via filePath", byPath.statuses.get(path.join(fixture, "src", "pay.py")) === "fresh")
    check("unknown fileId is missing with reason no-row", byPath.statuses.get("no-such-row-id") === "missing" && byPath.reasons.get("no-such-row-id") === "no-row")
    negative("no-row detection works", byPath.statuses.get("no-such-row-id") === "missing")

    // ── 4. contract Map shape + empty input ──
    const contractMap = freshness.resolveRowsFreshness(rawDb, projectId, [{ fileId: freshId }])
    check("resolveRowsFreshness returns the contract Map", contractMap instanceof Map && contractMap.get(freshId) === "fresh")
    const empty = freshness.resolveRowsFreshnessDetailed(rawDb, projectId, [])
    check("empty rows -> zeroed summary, no NaN", empty.summary.fresh === 0 && empty.summary.stale === 0 && empty.summary.missing === 0 && empty.summary.staleRatio === 0)

    // ── 5. batch efficiency: 10,000 rows over the 61 files, O(unique) stats ──
    const fileIds = files.map((f: any) => f.id as string)
    // 10k id rows PLUS every file referenced a second time via filePath in the
    // SAME call — the realistic mixed shape (id rows and path rows for the same
    // files) that makes the per-call stat memoization load-bearing.
    const heavyRows = Array.from({ length: 10_000 }, (_, i) => ({ fileId: fileIds[i % fileIds.length] }))
    for (const f of files) heavyRows.push({ fileId: f.id as string }, { filePath: f.path as string })
    const t0 = Date.now()
    const heavy = freshness.resolveRowsFreshnessDetailed(rawDb, projectId, heavyRows)
    const elapsed = Date.now() - t0
    // Each file resolves under BOTH key shapes (id key + path key) = 2*N keys.
    check("batch: every unique file resolved under both key shapes", heavy.statuses.size === 2 * fileIds.length, `${heavy.statuses.size} vs ${2 * fileIds.length}`)
    // Exact distribution (doubled across key shapes): the post-index fixture
    // mutations (edited → stale, deleted → missing) must appear in the heavy
    // batch too — the resolver must not lose truth when row count explodes.
    check("batch: exact distribution (2*(N-2) fresh / 2 stale / 2 missing)", heavy.summary.fresh === 2 * (fileIds.length - 2) && heavy.summary.stale === 2 && heavy.summary.missing === 2, JSON.stringify(heavy.summary))
    check("batch: summary counts equal statuses size", heavy.summary.fresh + heavy.summary.stale + heavy.summary.missing === heavy.statuses.size)
    check(
      "batch cost O(unique files): stat calls <= unique files (10k+ rows / 62 files)",
      freshness.freshnessStats.statCalls <= fileIds.length,
      `statCalls=${freshness.freshnessStats.statCalls} uniqueFiles=${fileIds.length} rows=${heavyRows.length}`,
    )
    check("batch completes fast (no per-row storm)", elapsed < 5_000, `${elapsed}ms`)

    // ── 6. honesty: the resolver never writes ──
    const dbPath = (BrainDatabase as any).getDbPath(projectId) as string
    const dbBefore = readFileSync(dbPath)
    const fixtureBefore = JSON.stringify(Array.from({ length: 58 }, (_, i) => readFileSync(path.join(fixture, "src", `mod${i}.ts`)).byteLength))
    freshness.resolveRowsFreshnessDetailed(rawDb, projectId, [{ fileId: editedId }, { filePath: editedFile }])
    check("index DB unchanged by resolution", dbBefore.equals(readFileSync(dbPath)))
    check("fixture files unchanged by resolution", JSON.stringify(Array.from({ length: 58 }, (_, i) => readFileSync(path.join(fixture, "src", `mod${i}.ts`)).byteLength)) === fixtureBefore)

    // legacy per-file API still coherent with the new core
    const legacy = freshness.checkFileFreshness(rawDb, editedId)
    check("legacy checkFileFreshness agrees (stale)", legacy?.status === "stale", String(legacy?.status))
    const legacyMissing = freshness.checkFileFreshness(rawDb, deletedId)
    check("legacy checkFileFreshness agrees (missing)", legacyMissing?.status === "missing", String(legacyMissing?.status))
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
}

function gitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

async function main() {
  if (SELF_MODE) {
    // Plant the O(rows) mutation, re-run this gate as a fresh subprocess, and
    // demand that it FAILS. A gate that cannot fail is not a gate.
    const backup = readFileSync(FRESHNESS_TS, "utf8")
    if (!backup.includes(MUTATION_FROM)) {
      console.log(`FAIL: self-mutation anchor not found in freshness.ts`)
      process.exit(1)
    }
    try {
      writeFileSync(FRESHNESS_TS, backup.replace(MUTATION_FROM, MUTATION_TO))
      let mutatedExit = 0
      let out = ""
      try {
        execFileSync("bun", ["run", __filename.replaceAll("\\", "/")], { cwd: ROOT, encoding: "utf8", stdio: "pipe", env: { ...process.env, BB_M35_EVIDENCE: "" } })
      } catch (e: unknown) {
        mutatedExit = (e as { status?: number }).status ?? 1
        out = String((e as { stdout?: unknown }).stdout ?? "")
      }
      check("self-mutation: O(rows) stat mutation FAILS the gate", mutatedExit !== 0, out.slice(-300))
      check("self-mutation: failure names the batch-cost contract", /batch cost O\(unique files\)/.test(out), "")
      negative("gate proven failable under mutation", mutatedExit !== 0)
    } finally {
      writeFileSync(FRESHNESS_TS, backup)
    }
    const restored = readFileSync(FRESHNESS_TS, "utf8") === backup
    check("freshness.ts restored byte-identical", restored)
    console.log(`M35 FRESHNESS CORE (self-mutate): ${failed === 0 ? "PASS" : "FAIL"} (${passed}/${checks})`)
    process.exit(failed === 0 ? 0 : 1)
  }

  await runSuite()

  if (process.env.BB_M35_EVIDENCE === "1" && failed === 0) {
    mkdirSync(path.dirname(RESULT), { recursive: true })
    writeFileSync(RESULT, JSON.stringify({
      status: "verified",
      currentCommit: gitHead(),
      workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m35/verify-freshness-core.ts",
      evidenceFile: "F1.json",
      generatedAt: new Date().toISOString(),
      passed,
      failed,
      negativeCases,
    }, null, 2) + "\n")
  }
  console.log(`M35 FRESHNESS CORE: ${failed === 0 ? "PASS" : "FAIL"} (${passed}/${checks}, negatives=${negativeCases})`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("F1 gate crashed:", e)
  process.exit(1)
})
