// script/verify-cli-index-flags.ts — the index-command flags a script actually depends on
//
// Covers the surface added 2026-11-01 after the review found docs claiming `--exclude` and no
// machine-readable output at all:
//   1. `bb index --help` lists --exclude and --concurrency (a flag nobody can discover is not a flag)
//   2. `--exclude` is NON-DESTRUCTIVE: an excluded file keeps rows an earlier run wrote (only a genuinely
//      deleted file is purged), while a --force run with the exclusion does not index it at all
//   3. `--concurrency <n>` is honoured by the pool (status reports n workers) and rejects out-of-range values
//   4. `stats --json` / `status --json` / `projects --json` emit parseable JSON whose counts match the DB
//   5. `bb tool <name> '<json>'` (a stray positional) is REFUSED instead of silently running with empty args
//
// Deterministic/offline: the CLI runs from the fixture directory with embedding env stripped, so the
// built-in local word vectors are used and no provider/network is touched.
//
// Run: npx tsx script/verify-cli-index-flags.ts
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

function jsonOf(text: string): any {
  const at = text.indexOf("{")
  if (at < 0) return null
  try {
    return JSON.parse(text.slice(at))
  } catch {
    return null
  }
}

const tmp = mkdtempSync(path.join(tmpdir(), "bb-cli-flags-"))
const project = path.join(tmp, "proj")
const dataDir = path.join(tmp, "data")
mkdirSync(path.join(project, "src"), { recursive: true })
mkdirSync(path.join(project, "skip"), { recursive: true })
mkdirSync(path.join(project, "keep"), { recursive: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(path.join(project, "src/a.ts"), "export function alpha(n: number): number { return n + 1 }\n")
writeFileSync(path.join(project, "src/b.ts"), "export function beta(n: number): number { return n - 1 }\n")
writeFileSync(path.join(project, "keep/c.ts"), "export class Gamma { run(n: number): number { return n * 2 } }\n")
writeFileSync(path.join(project, "skip/c.ts"), "export function skippedOne(): number { return 1 }\n")
writeFileSync(path.join(project, "skip/d.ts"), "export function skippedTwo(): number { return 2 }\n")
writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "cli-flags-fixture", version: "1.0.0" }))
// src/a.ts, src/b.ts, keep/c.ts, skip/c.ts, skip/d.ts, package.json
const INDEXABLE = 6

const childEnv: Record<string, string> = {}
for (const [k, v] of Object.entries(process.env)) {
  if (k.startsWith("BB_EMBEDDING") || k === "BB_CONFIG_FILE") continue
  if (v !== undefined) childEnv[k] = v
}
childEnv.BB_DATA_DIR = dataDir

function runCli(args: string[], cwd = project): { status: number | null; out: string } {
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
function fileRows(): Array<{ relative_path: string }> {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.prepare("SELECT relative_path FROM brain_file ORDER BY relative_path").all() as Array<{ relative_path: string }>
  } finally {
    db.close()
  }
}

try {
  // ── 1. discoverability ───────────────────────────────────────────────────────────────────────────
  const help = runCli(["index", "--help"], tmp)
  check("index --help lists --exclude", help.out.includes("--exclude"))
  check("index --help lists --concurrency", help.out.includes("--concurrency"))

  // ── 2. exclude is non-destructive, and a fresh run does not index excluded files ────────────────
  const full = runCli(["index", ".", "--force", "--no-setup"])
  check("baseline full index succeeds", full.status === 0, `status=${full.status}`)
  check("baseline indexes all files", fileRows().length === INDEXABLE, JSON.stringify(fileRows().map((r) => r.relative_path)))

  const changedExcluded = runCli(["index", ".", "--changed", "--no-setup", "--exclude", "skip/**"])
  check("--changed --exclude succeeds", changedExcluded.status === 0, `status=${changedExcluded.status}\n${changedExcluded.out.slice(-300)}`)
  const afterChanged = fileRows()
  check(
    "--exclude is non-destructive: excluded files keep rows from an earlier run",
    afterChanged.length === INDEXABLE && afterChanged.some((r) => r.relative_path === "skip/c.ts") && afterChanged.some((r) => r.relative_path === "skip/d.ts"),
    JSON.stringify(afterChanged.map((r) => r.relative_path)),
  )

  const forced = runCli(["index", ".", "--force", "--no-setup", "--exclude", "skip/**"])
  check("--force --exclude succeeds", forced.status === 0, `status=${forced.status}`)
  const afterForce = fileRows()
  check(
    "a fresh run with --exclude does not index excluded files",
    afterForce.length === INDEXABLE - 2 && !afterForce.some((r) => r.relative_path?.startsWith("skip/") || r.relative_path === "skip/c.ts"),
    JSON.stringify(afterForce.map((r) => r.relative_path)),
  )

  // ── 3. concurrency is validated and honoured ────────────────────────────────────────────────────
  const badConc = runCli(["index", ".", "--changed", "--no-setup", "--concurrency", "0"])
  check("--concurrency 0 is refused", badConc.status === 1 && badConc.out.includes("1-64"), `status=${badConc.status} ${badConc.out.slice(-200)}`)
  const conc1 = runCli(["index", ".", "--force", "--no-setup", "--concurrency", "1"])
  check("--concurrency 1 index succeeds", conc1.status === 0, `status=${conc1.status}`)
  const statusJson = jsonOf(runCli(["status", project, "--json"], tmp).out)
  check("status --json parses", statusJson !== null)
  check("status --json reports 1 worker for --concurrency 1", statusJson?.lastRun?.workerCount === 1, JSON.stringify(statusJson?.lastRun ?? null))
  check("status --json dbStats.files matches the DB", statusJson?.dbStats?.files === fileRows().length, `${statusJson?.dbStats?.files} vs ${fileRows().length}`)

  // ── 4. stats/projects JSON ──────────────────────────────────────────────────────────────────────
  const stats = runCli(["stats", project, "--json"], tmp)
  const statsJson = jsonOf(stats.out)
  check("stats --json parses", statsJson !== null && statsJson.hasIndex === true)
  check(
    "stats --json counts match the DB",
    statsJson?.files === fileRows().length && typeof statsJson?.symbols === "number" && typeof statsJson?.relationships === "number" && typeof statsJson?.embeddings === "number",
    JSON.stringify(statsJson),
  )
  const projects = runCli(["projects", "--json"], tmp)
  const projectsJson = jsonOf(projects.out)
  check("projects --json parses", projectsJson !== null && Array.isArray(projectsJson.projects))
  check(
    "projects --json includes this project by id",
    Array.isArray(projectsJson?.projects) && projectsJson.projects.some((p: any) => p.id === pid),
    JSON.stringify(projectsJson?.projects ?? []).slice(0, 300),
  )

  // ── 5. a stray positional to `bb tool` is refused, the correct form still works ─────────────────
  const stray = runCli(["tool", "bb_search", '{"query":"alpha"}'], tmp)
  check("bb tool refuses a positional JSON argument", stray.status === 1 && stray.out.includes("unexpected argument"), `status=${stray.status} ${stray.out.slice(-200)}`)
  const proper = runCli(["tool", "bb_search", "--dir", project, "--args", '{"query":"alpha"}'], tmp)
  check("bb tool --args still works", proper.status === 0 && proper.out.includes("alpha"), `status=${proper.status} ${proper.out.slice(-300)}`)
} finally {
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {}
}

console.log(`\nCLI INDEX FLAGS: ${failed === 0 ? "PASS" : "FAIL"} — ${checks - failed}/${checks} checks`)
process.exit(failed === 0 ? 0 : 1)
