/**
 * P2-4 gate — index-health honesty.
 *
 * Defects (triage ISSUE-11, PLAN P2-4):
 *  (a) `bb health` prints `status=complete` on the same line as
 *      `indexedFiles=1972/1973 — INCOMPLETE` (bettercap). `status` is decided
 *      only from errorFiles/missingAfterRecovery, so a run that recorded
 *      `skippedFiles=1` still stores "complete".
 *  (b) the INCOMPLETE remedy says `force=true to rebuild from scratch`; the one
 *      missing bettercap file is a >5 MB size-tier SKIP
 *      (parallel-indexer.ts:1005-1013), which a forced rebuild skips again.
 *  (c) 24 style-sheet syntax errors are all reported as one undifferentiated
 *      blob (16 are `.less` on the CSS grammar, 8 are `.scss` on their own lane).
 *  (d) the coverage line reports one overall percentage and never says the
 *      configured model's space is empty / backfill is pending.
 *
 * Method: a real fixture index in a temp BB_DATA_DIR. The brain_index_status row
 * is then set to the measured bettercap counters (complete/1973/1972,
 * skippedFiles=1) and files are marked as style-sheet syntax errors. Health is
 * rendered through the real formatter. Control leg: an un-fabricated complete
 * fixture still reports `status=complete` with no INCOMPLETE/SKIPPED warning.
 *
 * RED before the fix: status=complete prints beside the shortfall, the force
 * remedy is present, syntax errors are not grouped, coverage names one space.
 */

import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const scratch = mkdtempSync(path.join(ROOT, ".tools", "triage-fix", "embeddings-health", "health-gate-"))
process.env.BB_DATA_DIR = path.join(scratch, "data")

const configuredModel = "test/configured-embed"
let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const homeConfig = path.join(process.env.HOME ?? "", ".bb", "config.json")
const configBefore = existsSync(homeConfig) ? createHash("sha256").update(readFileSync(homeConfig)).digest("hex") : null

async function main(): Promise<void> {
  mkdirSync(path.join(scratch, "project", "src"), { recursive: true })
  const root = path.join(scratch, "project")
  writeFileSync(path.join(root, "src", "one.ts"), "export function one(): number { return 1 }\n")
  writeFileSync(path.join(root, "src", "two.ts"), "export function two(): number { return one() }\n")

  const { getProjectId } = await import("../src/cli/index")
  const { indexProjectParallel } = await import("../src/ast/parallel-indexer")
  const { BrainDatabase } = await import("../src/brain/database")
  const { getUnifiedHealth, formatUnifiedHealth } = await import("../src/intelligence/health/health-provider")

  const projectId = getProjectId(root)
  // Index with an unreachable provider: the index writes local word-vector rows
  // and leaves the configured model space empty (the bettercap embedding state).
  process.env.BB_EMBEDDING_BASE_URL = "http://127.0.0.1:9/v1"
  process.env.BB_EMBEDDING_MODEL = configuredModel
  process.env.BB_EMBEDDING_API_KEY = "gate-only-not-a-secret"
  await indexProjectParallel(projectId, root, {})

  // ── control first: the un-fabricated fixture must still read healthy ───────
  const clean = await getUnifiedHealth(projectId, root, { freshness: "complete" })
  const cleanText = formatUnifiedHealth(clean)
  check("C1 (control): a genuinely complete run still reports status=complete", /status=complete\b/.test(cleanText), cleanText.split("\n").find((l) => l.startsWith("index:")) ?? "")
  check("C2 (control): no INCOMPLETE_INDEX on a complete run", !clean.warnings.some((w) => w.code === "INCOMPLETE_INDEX"), JSON.stringify(clean.warnings.map((w) => w.code)))

  // ── fabricate the bettercap last-run counters on this fixture ─────────────
  const raw: any = await BrainDatabase.getRawInstance(projectId)
  const perf = {
    schemaVersion: 1,
    runs: [{
      generatedAt: Date.now(),
      mode: "worker-pool",
      noop: false,
      counts: { totalFiles: 1973, processedFiles: 1973, successFiles: 1972, timeoutFiles: 0, errorFiles: 0, skippedFiles: 1, workerCount: 7, parsedFiles: 1972 },
    }],
  }
  raw.prepare("UPDATE brain_index_status SET status = ?, total_files = ?, indexed_files = ?, performance_stats = ? WHERE project_id = ?")
    .run("complete", 1973, 1972, JSON.stringify(perf), projectId)
  // one `.less` (routed to the css language) and one `.scss` syntax-error file
  const files = raw.prepare("SELECT id FROM brain_file WHERE project_id=? ORDER BY relative_path").all(projectId) as any[]
  raw.prepare("UPDATE brain_file SET relative_path=?, language=?, has_syntax_errors=1 WHERE id=?")
    .run("assets/_variables.less", "css", files[0].id)
  raw.prepare("UPDATE brain_file SET relative_path=?, language=?, has_syntax_errors=1 WHERE id=?")
    .run("assets/_mixins.scss", "scss", files[1].id)

  const report = await getUnifiedHealth(projectId, root, { freshness: "complete" })
  const text = formatUnifiedHealth(report)
  const indexLine = text.split("\n").find((l) => l.startsWith("index:")) ?? ""
  const embLine = text.split("\n").find((l) => l.startsWith("embeddings:")) ?? ""
  const codes = report.warnings.map((w) => w.code)
  const incomplete = report.warnings.find((w) => w.code === "INCOMPLETE_INDEX")
  const skipped = report.warnings.filter((w) => /SKIP/i.test(w.code))
  const syntaxWarn = report.warnings.find((w) => w.code === "SYNTAX_ERRORS")
  console.log(`  (index line: ${indexLine})`)
  console.log(`  (embeddings line: ${embLine})`)
  console.log(`  (warning codes: ${codes.join(",")})`)

  // R1: never print a bare status=complete beside a count shortfall.
  const shortfallLine = /indexedFiles=\d+\/\d+/.test(indexLine) && /1972\/1973|INCOMPLETE/.test(indexLine)
  check("R1: shortfall is still detected on the line", shortfallLine, indexLine)
  check("R2: bare `status=complete` never prints beside the shortfall", !/status=complete\b/.test(indexLine), indexLine)
  check("R3: the derived status names the shortfall", /status=(incomplete|partial)/.test(indexLine), indexLine)

  // R4: remedy names the real cause (a deliberate skip), not `force` only.
  check("R4: no `force=true to rebuild from scratch` remedy on a deliberate-skip shortfall",
    !(incomplete?.message ?? "").includes("force=true to rebuild from scratch"), incomplete?.message ?? "no INCOMPLETE_INDEX warning")
  const skipWarning = skipped[0] ?? incomplete
  check("R5: a warning explains the skip (size tier / deliberate skip), so force is not implied to fix it",
    /\bskip/i.test(skipWarning?.message ?? "") && /(size|5 ?MB|deliberate|rule)/i.test(skipWarning?.message ?? ""),
    skipWarning?.message ?? "no skip warning")
  check("R6: incomplete/skip warning names the skipped count", /1\b/.test(skipWarning?.message ?? ""), skipWarning?.message ?? "")

  // R7: syntax errors are split by language (16 css/.less vs 8 .scss in bettercap).
  const syntaxMsg = syntaxWarn?.message ?? ""
  check("R7: syntax warning groups attribution by language", /less/.test(syntaxMsg) && /scss/.test(syntaxMsg), syntaxMsg)
  check("R8: syntax grouping states a count per language", /(less[^0-9]{0,24}\d)|(\d[^0-9]{0,24}less)/i.test(syntaxMsg) &&
    /(scss[^0-9]{0,24}\d)|(\d[^0-9]{0,24}scss)/i.test(syntaxMsg), syntaxMsg)

  // R9/R10: coverage line states configured-space vs library and pending backfill.
  check("R9: embeddings line names the configured model and its coverage", embLine.includes(configuredModel), embLine)
  check("R10: backfill-pending state is declared for the under-covered configured space",
    codes.some((c) => /BACKFILL/.test(c)) || /backfill/i.test(text), `codes=${codes.join(",")}`)
  check("R11: embeddings line distinguishes library-wide from configured-space coverage",
    /library/i.test(embLine) && /configured/i.test(embLine), embLine)

  const configAfter = existsSync(homeConfig) ? createHash("sha256").update(readFileSync(homeConfig)).digest("hex") : null
  check("C3 (control): user embedding config was not mutated", configBefore === configAfter)
}

try {
  await main()
} catch (error) {
  failures++
  console.log(`  FAIL: gate crashed — ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

console.log(failures === 0 ? "\nHEALTH HONESTY: PASS" : `\nHEALTH HONESTY: ${failures} FAILURE(S)`)
process.exit(failures > 0 ? 1 : 0)
