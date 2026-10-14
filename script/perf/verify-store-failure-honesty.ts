#!/usr/bin/env npx tsx
/**
 * verify-store-failure-honesty.ts — does a run that could not store its files say so?
 *
 * Why this exists
 * ---------------
 * A store batch can roll back (a constraint violation, a full disk) and be skipped. The
 * indexer then re-processes whatever is missing from `brain_file`, which usually rescues
 * the run — and when it could NOT, nothing said so: the CLI printed the same
 * `✓ indexed N files` as a clean run and the persisted status read `complete`. The user's
 * only clue that files were missing was that search did not find them.
 *
 * The three scenarios below separate the cases that must not be conflated — "we lost
 * files", "we lost files and got them back", and "nothing went wrong":
 *
 *   control      no injected fault → exit 0, status complete, every file stored
 *   fail-once    the first batch rolls back and recovery re-processes it → every file IS
 *                stored, status stays complete, and the run reports the rollback it
 *                survived (a success must not be turned into a false failure either)
 *   fail-always  every batch rolls back, so recovery cannot save the run → the index is
 *                genuinely incomplete: the CLI must say INCOMPLETE, exit non-zero, and
 *                the persisted status must read partial
 *
 * The fault is injected by the product's own documented hook (BB_TEST_FAIL_STORE_ONCE /
 * BB_TEST_FAIL_STORE_ALWAYS, next to the existing BB_WORKER_CRASH_ON_BATCH), so the gate
 * exercises the real store path rather than a mock of it.
 *
 * Usage: npx tsx script/perf/verify-store-failure-honesty.ts [--keep]
 * Exit:  0 all contracts hold, 1 otherwise.
 */
import { spawn } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"

const REPO = process.cwd()
const SCRATCH = path.join(REPO, ".store-honesty")
const keep = process.argv.includes("--keep")
const FILE_COUNT = 12

let failures = 0
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures++
}

function buildProject(root: string) {
  mkdirSync(root, { recursive: true })
  for (let i = 0; i < FILE_COUNT; i++) {
    writeFileSync(
      path.join(root, `mod${String(i).padStart(2, "0")}.ts`),
      `export interface S${i} { id: number }\nexport class C${i} implements S${i} {\n  id = ${i}\n  run(): string { return helper${i}("x") }\n}\nexport function helper${i}(s: string): string { return s.trim() }\n`,
    )
  }
}

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

function runIndex(projectDir: string, dataDir: string, env: Record<string, string>): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", "src/cli/index.ts", "index", projectDir, "--no-setup"], {
      cwd: REPO,
      env: { ...process.env, BB_DATA_DIR: dataDir, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d) => { stdout += d.toString() })
    child.stderr.on("data", (d) => { stderr += d.toString() })
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

function readState(dataDir: string): { files: number; status: string | null } {
  const projectsRoot = path.join(dataDir, "projects")
  const projectDir = path.join(projectsRoot, readdirSync(projectsRoot)[0])
  const db = new Database(path.join(projectDir, "brain.db"), { readonly: true })
  const files = (db.prepare("SELECT COUNT(*) c FROM brain_file").get() as any).c as number
  let status: string | null = null
  try {
    // `brain_index_status` carries a `__schema__` sentinel row whose status is NULL, and
    // `LIMIT 1` returned THAT row — so the first version of this gate read "status: null"
    // for every scenario and reported the product as broken when the gate was. The
    // project's own row is the one that is not the sentinel.
    const row = db
      .prepare("SELECT status FROM brain_index_status WHERE project_id != '__schema__' ORDER BY time_updated DESC LIMIT 1")
      .get() as any
    status = (row?.status ?? null) as string | null
  } catch {}
  db.close()
  return { files, status }
}

async function main() {
  console.log(`\nSTORE FAILURE HONESTY — ${FILE_COUNT} files, injected rollbacks, real runs\n`)
  rmSync(SCRATCH, { recursive: true, force: true })
  const project = path.join(SCRATCH, "project")
  buildProject(project)

  console.log("── control: nothing injected")
  {
    const dataDir = path.join(SCRATCH, "data-control")
    const r = await runIndex(project, dataDir, {})
    const st = readState(dataDir)
    check("the run succeeds", r.code === 0, `exit ${r.code}`)
    check("it prints the ordinary success line", r.stdout.includes("✓ indexed"), r.stdout.split("\n").find((l) => l.includes("indexed"))?.trim() ?? "")
    check("every discovered file is stored", st.files === FILE_COUNT, `${st.files}/${FILE_COUNT}`)
    check("the status is complete", st.status === "complete", String(st.status))
    check("no incompleteness warning", !r.stdout.includes("INCOMPLETE") && !r.stdout.includes("could NOT be stored"))
  }

  console.log("\n── fail-once: a rollback that recovery rescues")
  {
    const dataDir = path.join(SCRATCH, "data-once")
    const r = await runIndex(project, dataDir, { BB_TEST_FAIL_STORE_ONCE: "1" })
    const st = readState(dataDir)
    check("recovery still stores every file", st.files === FILE_COUNT, `${st.files}/${FILE_COUNT}`)
    check("so the status is complete, not partial", st.status === "complete", String(st.status))
    check("the run exits 0 — a recovered run is a success", r.code === 0, `exit ${r.code}`)
    check(
      "and it SAYS a batch rolled back and was recovered",
      r.stdout.includes("rolled back and were recovered"),
      r.stdout.split("\n").find((l) => l.includes("rolled back"))?.trim() ?? "not printed",
    )
    check("without claiming the index is incomplete", !r.stdout.includes("INCOMPLETE"))
  }

  console.log("\n── fail-always: the full-disk case, where recovery cannot save it")
  {
    const dataDir = path.join(SCRATCH, "data-always")
    const r = await runIndex(project, dataDir, { BB_TEST_FAIL_STORE_ALWAYS: "1" })
    const st = readState(dataDir)
    // The honest message travels the CLI's ERROR path (this run cannot proceed to
    // derive anything), and that path writes to stderr — an earlier version of this
    // gate checked stdout only and reported the product as silent when it was not.
    const combined = r.stdout + r.stderr
    check("no files could be stored", st.files === 0, `${st.files}/${FILE_COUNT}`)
    check(
      "the run says the index is INCOMPLETE",
      /INCOMPLETE/.test(combined) && /could NOT be stored/.test(combined),
      combined.split("\n").find((l) => l.includes("could NOT be stored"))?.trim().slice(0, 120) ?? "not printed",
    )
    check("and names the cause and the remedy", /free disk space/.test(combined))
    check("the run exits non-zero", r.code === 1, `exit ${r.code}`)
    check("the persisted status is partial, not complete", st.status === "partial", String(st.status))
    check("it does NOT print the ordinary success line", !/✓ indexed/.test(combined))
  }

  console.log(
    failures === 0 ? `\nSTORE FAILURE HONESTY: ALL PASS\n` : `\nSTORE FAILURE HONESTY: ${failures} FAILURE(S)\n`,
  )
  if (!keep) rmSync(SCRATCH, { recursive: true, force: true })
  else console.log(`scratch kept at ${SCRATCH}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("harness error:", e)
  process.exit(1)
})
