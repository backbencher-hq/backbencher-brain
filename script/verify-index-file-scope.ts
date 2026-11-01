// script/verify-index-file-scope.ts — the scoped-file path contract, end to end
//
// THE DEFECT THIS PINS. `bb index <dir> --file src/a.ts` passed the argument through untouched.
// A project-relative spelling was stored verbatim in `brain_file.path`; the NEXT run, from any other
// working directory, asked `purgeDeletedFiles()` whether that path exists (against the process cwd) and
// deleted the live file's symbols/relationships/embeddings. Reproduced 2026-11-01: 11 files → 10, exit 0.
// A path that did not resolve at all was a SILENT no-op ("nothing to index", exit 0) — success-shaped
// output for a request that did nothing.
//
// The contract now: one resolver (`src/ast/scoped-path.ts`) decides, EVERY writer enforces it, the store
// only ever sees absolute paths, and a refusal is an error the user can act on.
//
// Checks, in order:
//   1. resolver verdicts: relative-inside, absolute, missing, directory, outside, symlink escape
//   2. a relative scoped reindex stores an ABSOLUTE path
//   3. the purge pass that follows (from another cwd) does NOT delete the live file
//   4. the API refuses an unresolvable scoped override instead of silently indexing nothing
//   5. the CLI refuses a missing/outside `--file` with exit 1 and a message naming the resolved path
//   6. the CLI accepts a project-relative `--file` invoked from OUTSIDE the project
//
// Run: npx tsx script/verify-index-file-scope.ts   (also runs under bun)
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import Database from "better-sqlite3"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const CLI = path.join(ROOT, "src/cli/index.ts")
// Load the TypeScript CLI from an ABSOLUTE loader URL: `--import tsx` resolves from the child's cwd, and
// these checks deliberately run the CLI from a cwd outside the checkout (and outside the project).
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

const tmp = mkdtempSync(path.join(tmpdir(), "bb-scope-"))
process.env.BB_DATA_DIR = path.join(tmp, "data")
const project = path.join(tmp, "proj")
mkdirSync(path.join(project, "src"), { recursive: true })
writeFileSync(path.join(project, "src/a.ts"), "export function alpha(n: number): number { return n + 1 }\n")
writeFileSync(path.join(project, "src/b.ts"), "export function beta(n: number): number { return n - 1 }\n")
writeFileSync(path.join(project, "README.md"), "# scope fixture\n")
const outsideDir = path.join(tmp, "outside")
mkdirSync(outsideDir, { recursive: true })
writeFileSync(path.join(outsideDir, "secret.ts"), "export const secret = 1\n")
// A symlink INSIDE the project pointing at a file OUTSIDE it: realpath containment must refuse it.
symlinkSync(path.join(outsideDir, "secret.ts"), path.join(project, "escape.ts"))

const projectReal = realpathSync.native(project)

const { resolveScopedProjectFile } = await import("../src/ast/scoped-path")
const { indexProjectParallel, purgeDeletedFiles } = await import("../src/ast/parallel-indexer")
const { getProjectId } = await import("../src/util/project-id")
const pid = getProjectId(project)
const dbPath = path.join(tmp, "data", "projects", pid, "brain.db")

function readFileRows(): Array<{ relative_path: string; path: string }> {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.prepare("SELECT relative_path, path FROM brain_file ORDER BY relative_path").all() as Array<{ relative_path: string; path: string }>
  } finally {
    db.close()
  }
}

function runCli(args: string[], cwd: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, ["--import", TSX_LOADER, CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, BB_DATA_DIR: path.join(tmp, "data") },
    timeout: 240_000,
  })
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

try {
  // ── 1. resolver verdicts ──────────────────────────────────────────────────────────────────────────
  const relativeInside = resolveScopedProjectFile(project, "src/a.ts")
  check("resolver accepts a project-relative file inside the project", relativeInside.ok === true && relativeInside.ok && relativeInside.absolute === path.join(projectReal, "src/a.ts"), JSON.stringify(relativeInside))
  const absoluteInside = resolveScopedProjectFile(project, path.join(project, "src/a.ts"))
  check("resolver accepts an absolute file inside the project", absoluteInside.ok === true)
  const missing = resolveScopedProjectFile(project, "src/nope.ts")
  check("resolver refuses a missing file as not-found", missing.ok === false && missing.reason === "not-found", JSON.stringify(missing))
  const directory = resolveScopedProjectFile(project, "src")
  check("resolver refuses a directory as not-a-file", directory.ok === false && directory.reason === "not-a-file", JSON.stringify(directory))
  const outside = resolveScopedProjectFile(project, "../outside/secret.ts")
  check("resolver refuses a path outside the project", outside.ok === false && outside.reason === "outside-project", JSON.stringify(outside))
  const escape = resolveScopedProjectFile(project, "escape.ts")
  check("resolver refuses a symlink that escapes the project", escape.ok === false && escape.reason === "outside-project", JSON.stringify(escape))

  // ── 2. a relative scoped reindex stores an ABSOLUTE path ─────────────────────────────────────────
  await indexProjectParallel(pid as any, project, {})
  const afterFull = readFileRows()
  check("full index stores absolute paths", afterFull.length > 0 && afterFull.every((r) => path.isAbsolute(r.path)), JSON.stringify(afterFull.map((r) => r.path)))

  await indexProjectParallel(pid as any, project, { files: ["src/a.ts"], isIncremental: true })
  const alphaRow = readFileRows().find((r) => r.relative_path === "src/a.ts")
  check("relative scoped reindex stores an ABSOLUTE brain_file.path", !!alphaRow && path.isAbsolute(alphaRow.path), JSON.stringify(alphaRow))

  // ── 3. the purge pass no longer deletes the live file ────────────────────────────────────────────
  const purged = await purgeDeletedFiles(pid as any, project)
  const afterPurge = readFileRows()
  check("purge from another cwd purges nothing while the file exists", purged === 0, `purged=${purged}`)
  check("the scoped file survives the purge pass", afterPurge.some((r) => r.relative_path === "src/a.ts"), JSON.stringify(afterPurge.map((r) => r.relative_path)))

  // The other half of the same contract: a file that is GENUINELY gone must still be purged, or the
  // fix would have traded data loss for permanent ghost rows.
  writeFileSync(path.join(project, "src/deleted-later.ts"), "export const gone = 1\n")
  await indexProjectParallel(pid as any, project, {})
  rmSync(path.join(project, "src/deleted-later.ts"))
  const purgedDeleted = await purgeDeletedFiles(pid as any, project)
  const afterDeleted = readFileRows()
  check("a file that no longer exists IS purged", purgedDeleted === 1, `purged=${purgedDeleted}`)
  check("the deleted file's row is gone", !afterDeleted.some((r) => r.relative_path === "src/deleted-later.ts"), JSON.stringify(afterDeleted.map((r) => r.relative_path)))

  // ── 4. the API refuses an unresolvable scoped override ───────────────────────────────────────────
  let refusal = ""
  try {
    await indexProjectParallel(pid as any, project, { files: ["src/nope.ts"], isIncremental: true })
  } catch (e: any) {
    refusal = String(e?.message ?? e)
  }
  check("API refuses an unresolvable scoped file", refusal.includes("scoped file path refused"), refusal.slice(0, 160))

  // ── 5. the CLI refuses a missing/outside --file with exit 1 ──────────────────────────────────────
  const cliMissing = runCli(["index", project, "--file", "src/nope.ts", "--no-setup"], tmp)
  check("CLI exits 1 for a missing --file", cliMissing.status === 1, `status=${cliMissing.status}`)
  check("CLI names the resolved path and the project root in the refusal", cliMissing.out.includes("--file not found") && cliMissing.out.includes(projectReal), cliMissing.out.slice(-260))

  const cliOutside = runCli(["index", project, "--file", "../outside/secret.ts", "--no-setup"], tmp)
  check("CLI exits 1 for an outside --file", cliOutside.status === 1, `status=${cliOutside.status}`)
  check("CLI says the path is outside the project", cliOutside.out.includes("--file is outside the project"), cliOutside.out.slice(-260))

  // ── 6. a project-relative --file works from OUTSIDE the project ──────────────────────────────────
  writeFileSync(path.join(project, "src/a.ts"), "export function alpha(n: number): number { return n + 2 }\nexport function gamma(n: number): number { return n * 2 }\n")
  const cliOk = runCli(["index", project, "--file", "src/a.ts", "--no-setup"], tmp)
  check("CLI accepts a project-relative --file invoked from another cwd", cliOk.status === 0, `status=${cliOk.status}\n${cliOk.out.slice(-300)}`)
  check("CLI reports the scoped file as parsed", cliOk.out.includes("1 newly parsed"), cliOk.out.slice(-300))
  const alphaAfter = readFileRows().find((r) => r.relative_path === "src/a.ts")
  check("the reindexed file still has an absolute path after the CLI run", !!alphaAfter && path.isAbsolute(alphaAfter.path), JSON.stringify(alphaAfter))
} finally {
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {}
}

console.log(`\nFILE SCOPE: ${failed === 0 ? "PASS" : "FAIL"} — ${checks - failed}/${checks} checks`)
process.exit(failed === 0 ? 0 : 1)
