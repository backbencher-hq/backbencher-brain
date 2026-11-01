// script/verify-index-report-truth.ts — the run report must describe the database the run just built
//
// THE DEFECT THIS PINS. `bb index` read its counts BEFORE awaiting the background embedding drain, and the
// in-run health battery graded Embedding Coverage before the vectors were written. Measured 2026-11-01:
//   · a demo project printed "0 embeddings" and then held 12 embedding rows; apollo-server printed 568
//     and held 1,117 (the drain kept writing after the numbers were read);
//   · the same run printed "❌ Embedding Coverage: … holds no vectors, so semantic search is
//     keyword-only" — an error-level claim about a table that was about to hold vectors, while a later
//     `bb health` reported them.
// The report now drains first, re-reads every count, and grades health on the drained table.
//
// The check is deterministic: the CLI runs from a cwd with no bb.json and with embedding env vars stripped,
// so the built-in local word vectors are used (offline, no provider, no network).
//
// Run: npx tsx script/verify-index-report-truth.ts   (also runs under bun)
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import path from "node:path"
import Database from "better-sqlite3"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const CLI = path.join(ROOT, "src/cli/index.ts")
const TSX_LOADER = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href

let checks = 0
let failed = 0
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) console.log(`  ok: ${label}`)
  else {
    failed++
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

/** First integer appearing in `text` at/after `marker`, or null. Plain string scan (no regex). */
function numberAfter(text: string, marker: string): number | null {
  const at = text.indexOf(marker)
  if (at < 0) return null
  const tail = text.slice(at + marker.length)
  let digits = ""
  for (const ch of tail) {
    if (ch >= "0" && ch <= "9") digits += ch
    else if (digits.length > 0) break
    else if (ch === " " || ch === ":" || ch === "=") continue
    else if (digits.length === 0 && (ch === "-" || ch === ",")) continue
    else break
  }
  if (digits.length === 0) return null
  return Number(digits)
}

const tmp = mkdtempSync(path.join(tmpdir(), "bb-report-"))
const project = path.join(tmp, "proj")
const dataDir = path.join(tmp, "data")
mkdirSync(path.join(project, "src"), { recursive: true })
mkdirSync(dataDir, { recursive: true })
for (let i = 1; i <= 6; i++) {
  writeFileSync(
    path.join(project, `src/mod${i}.ts`),
    `export class Widget${i} { render(n: number): number { return n + ${i} } }\n` +
      `export function helper${i}(n: number): number { return n * ${i} }\n` +
      `export interface Shape${i} { side: number }\n`,
  )
}
writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "report-fixture", version: "1.0.0" }))

// Strip embedding configuration from the child env so the LOCAL fallback (offline) is used: the check must
// not depend on a network provider or on this machine's secrets.
const childEnv: Record<string, string> = {}
for (const [k, v] of Object.entries(process.env)) {
  if (k.startsWith("BB_EMBEDDING") || k === "BB_CONFIG_FILE") continue
  if (v !== undefined) childEnv[k] = v
}
childEnv.BB_DATA_DIR = dataDir

function runCli(args: string[], cwd: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, ["--import", TSX_LOADER, CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: childEnv,
    timeout: 300_000,
  })
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

const { getProjectId } = await import("../src/util/project-id")
const pid = getProjectId(project)
const dbPath = path.join(dataDir, "projects", pid, "brain.db")

try {
  const run = runCli(["index", ".", "--force", "--no-setup"], project)
  check("index exits 0", run.status === 0, `status=${run.status}\n${run.out.slice(-400)}`)

  const db = new Database(dbPath, { readonly: true })
  let dbCount = 0
  let dbModels: string[] = []
  try {
    dbCount = (db.prepare("SELECT COUNT(*) AS n FROM brain_semantic_embedding").get() as any).n
    dbModels = (db.prepare("SELECT DISTINCT embedding_model AS m FROM brain_semantic_embedding").all() as Array<{ m: string }>).map((r) => r.m)
  } finally {
    db.close()
  }
  check("the fixture actually produced embeddings (the check has signal)", dbCount > 0, `dbCount=${dbCount}`)

  // Reported count == DB count. The summary is the line a user reads: "✓ indexed N files, …, K embeddings".
  const summaryLine = run.out.split("\n").find((l) => l.includes("✓ indexed ")) ?? ""
  const reported = numberAfter(summaryLine, "relationships, ")
  check("the summary's embedding count equals the database's", reported === dbCount, `reported=${reported} db=${dbCount} :: ${summaryLine.trim()}`)

  // No false "keyword-only" claim once vectors exist.
  check("the run does not claim the embedding table is empty", !run.out.includes("holds no vectors"), run.out.slice(-400))

  // The post-drain health verdict exists and its coverage is not an error.
  check("the run prints the authoritative post-drain health verdict", run.out.includes("index health (after embeddings)"), run.out.slice(-400))
  check("the post-drain verdict does not grade coverage as ❌", !run.out.includes("❌ Embedding Coverage"), run.out.slice(-400))

  // The models line names the model the DB holds.
  const modelLine = run.out.split("\n").find((l) => l.trimStart().startsWith("embeddings:")) ?? ""
  check("the summary's model line names the database's model", dbModels.length === 1 && modelLine.includes(dbModels[0]), `models=${JSON.stringify(dbModels)} line=${modelLine.trim()}`)

  // Sibling commands must agree on the same fact.
  const stats = runCli(["stats", project], tmp)
  const statsCount = numberAfter(stats.out, "embeddings ")
  check("bb stats reports the same embedding count", statsCount === dbCount, `stats=${statsCount} db=${dbCount} :: ${stats.out.split("\n").find((l) => l.includes("embeddings")) ?? ""}`)

  const health = runCli(["health", project], tmp)
  const healthCount = numberAfter(health.out, "embeddings: ")
  check("bb health reports the same embedding count", healthCount === dbCount, `health=${healthCount} db=${dbCount}`)
  check("bb health reports the embedding coverage as a number of rows, not zero", healthCount !== null && healthCount > 0, health.out.slice(0, 400))
} finally {
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {}
}

console.log(`\nREPORT TRUTH: ${failed === 0 ? "PASS" : "FAIL"} — ${checks - failed}/${checks} checks`)
process.exit(failed === 0 ? 0 : 1)
