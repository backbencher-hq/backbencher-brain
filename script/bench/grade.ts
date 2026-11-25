#!/usr/bin/env node
// script/bench/grade.ts — grade ONE submission, blind to the arm.
//
// WHY BLIND. The grader is handed a run directory. It reads the submission patch, the
// task definition and the project definition -- and deliberately does NOT read the arm,
// the model or the trace. If it did, a grader bug could correlate with an arm and turn
// into a finding. The arm label is joined back only in report.ts.
//
// WHAT IT CHECKS, in order of weight:
//   1. must_pass     -- the tests the fix has to move. Failure here is the headline fail.
//   2. must_not_break-- pass-to-pass. A fix that breaks something is not a fix.
//   3. golden files  -- did the submission touch the files the task is about?
//   4. needle        -- comprehension track only: was the answer-bearing file cited?
//
// A grade is BINARY for the primary endpoint (score 0 or 1). Partial credit exists only
// in `localization`, and is reported, never averaged into the headline.

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../..")

interface TaskDef {
  id: string
  track: string
  prompt: string
  golden: { files: string[]; patch: string; needle: string | null }
  grade: { must_pass: string[]; must_not_break: string[] }
}
interface ProjectDef {
  id: string
  source: string
  test: string[]
}

export interface Grade {
  schemaVersion: 1
  task_id: string
  tests: {
    must_pass: { ran: number; passed: number; failures: string[] }
    must_not_break: { ran: number; passed: number; failures: string[] }
  }
  golden: { files_expected: number; files_hit: number; localization: "exact" | "partial" | "none"; applied: boolean }
  needle: { required: boolean; found: boolean | null }
  regressions: { files_outside_golden: number }
  success: boolean
  score: 0 | 1
  reason: string
}

/**
 * Run the project's test command and parse TAP-ish node:test output.
 *
 * `project.test` is an array of COMMAND STRINGS (`benchmarks/spec/SCHEMA.md` §1), i.e.
 * `["npx tsc --noEmit", "node --test \"test/*.test.js\""]` -- not argv arrays. Each string
 * is run through a shell so quoting and globs behave as the project author intended.
 * This is why it is `shell: true`: an earlier version exec'd the whole string as a binary
 * name and every test "failed" silently.
 */
function runTests(cwd: string, cmd: string[]): { ok: boolean; pass: string[]; fail: string[]; raw: string } {
  const rawParts: string[] = []
  let anyFail = false
  let lastStatus = 0
  for (const command of cmd) {
    const r = spawnSync(command, { cwd, encoding: "utf8", timeout: 300_000, shell: true })
    rawParts.push(r.stdout ?? "", r.stderr ?? "")
    lastStatus = r.status ?? 1
    if (lastStatus !== 0) anyFail = true
  }
  const status = anyFail ? lastStatus : 0
  const raw = rawParts.join("\n")
  const pass: string[] = []
  const fail: string[] = []
  // node:test prints "ok N - <name>" / "not ok N - <name>".
  for (const line of raw.split("\n")) {
    const m = /^(not ok|ok)\s+\d+\s+-\s+(.+?)\s*$/.exec(line.trim())
    if (!m) continue
    const name = m[2]
    if (m[1] === "not ok") fail.push(name)
    else pass.push(name)
  }
  // A test command can fail without emitting a single `not ok` line (a crash, a missing
  // file). That is still a failure: exit status is authoritative, TAP only adds names.
  return { ok: fail.length === 0 && status === 0, pass, fail, raw }
}

function parsePatchFiles(patch: string): string[] {
  const out = new Set<string>()
  for (const line of patch.split("\n")) {
    const m = /^\+\+\+\s+(?:b\/)?(.+?)(?:\t.*)?$/.exec(line)
    if (!m) continue
    let f = m[1].trim()
    if (f === "/dev/null") continue
    // --no-index emits full paths; keep the workspace-relative tail.
    const marker = "/workspace/"
    const i = f.indexOf(marker)
    if (i >= 0) f = f.slice(i + marker.length)
    else {
      const j = f.lastIndexOf("/src/")
      if (j >= 0) f = f.slice(j + 1)
    }
    out.add(f)
  }
  return [...out]
}

/** Does a test name satisfy a required assertion? Exact first, then containment, because
 *  a suite may prefix its names with a file or describe() label. Ambiguity is resolved
 *  toward FAILURE: a required test that did not visibly pass is a failure, not a maybe. */
function satisfied(required: string, passed: string[], failed: string[]): boolean {
  const norm = (s: string) => s.trim().toLowerCase()
  const r = norm(required)
  if (failed.some((f) => norm(f) === r || norm(f).includes(r))) return false
  return passed.some((p) => norm(p) === r || norm(p).includes(r))
}

export function gradeRun(runDir: string, taskPath: string, projectPath: string, workOut?: string): Grade {
  const task = JSON.parse(readFileSync(taskPath, "utf8")) as TaskDef
  const project = JSON.parse(readFileSync(projectPath, "utf8")) as ProjectDef
  const projectSrc = path.isAbsolute(project.source) ? project.source : path.resolve(REPO_ROOT, project.source)

  const patchPath = path.join(runDir, "submission.patch")
  const patch = existsSync(patchPath) ? readFileSync(patchPath, "utf8") : ""
  const filesTouched = parsePatchFiles(patch)

  // Grade in a throwaway copy: the pinned source + the submission applied. Never grade
  // the run's own workspace, which the agent could have left in any state.
  const sandbox = workOut ?? path.join(runDir, ".grade-sandbox")
  rmSync(sandbox, { recursive: true, force: true })
  cpSync(projectSrc, sandbox, { recursive: true })
  let applied = true
  if (patch.trim().length > 0) {
    // --no-index patches carry absolute paths; normalise to the sandbox.
    const rewritten = patch
      .split("\n")
      .map((l) => (l.startsWith("--- ") || l.startsWith("+++ ")) ? l.replace(/^((?:---|\+\+\+)\s+)(?:\S*\/)(?=(?:a|b)\/)/, "$1").replace(/(a|b)\/(?:.*\/workspace\/)/, "$1/") : l)
      .join("\n")
    const pf = path.join(sandbox, ".submission.patch")
    writeFileSync(pf, rewritten)
    const r = spawnSync("patch", ["-p1", "-s", "--forward", "-i", pf], { cwd: sandbox, encoding: "utf8" })
    applied = (r.status ?? 1) === 0
    if (!applied) {
      // A patch that does not apply is a failed submission, not a grader error.
      const g: Grade = {
        schemaVersion: 1, task_id: task.id,
        tests: { must_pass: { ran: task.grade.must_pass.length, passed: 0, failures: task.grade.must_pass }, must_not_break: { ran: 0, passed: 0, failures: [] } },
        golden: { files_expected: task.golden.files.length, files_hit: 0, localization: "none", applied: false },
        needle: { required: task.golden.needle !== null, found: null },
        regressions: { files_outside_golden: 0 },
        success: false, score: 0, reason: "patch does not apply",
      }
      return g
    }
  }

  const tests = runTests(sandbox, project.test)
  const mustPassOk = task.grade.must_pass.filter((t) => satisfied(t, tests.pass, tests.fail))
  const mustNotBreakOk = task.grade.must_not_break.filter((t) => satisfied(t, tests.pass, tests.fail))

  const goldenHit = task.golden.files.filter((g) => filesTouched.some((f) => f.endsWith(g) || g.endsWith(f)))
  const localization: Grade["golden"]["localization"] =
    goldenHit.length === 0 ? "none" : goldenHit.length === task.golden.files.length ? "exact" : "partial"

  const needleRequired = task.golden.needle !== null
  const needleFound = needleRequired ? patch.includes(task.golden.needle as string) : null

  const outside = filesTouched.filter((f) => !task.golden.files.some((g) => f.endsWith(g) || g.endsWith(f))).length

  const passAll = mustPassOk.length === task.grade.must_pass.length
  const keptAll = mustNotBreakOk.length === task.grade.must_not_break.length
  const needleOk = needleFound === null || needleFound === true
  const success = applied && passAll && keptAll && needleOk

  const reason = success
    ? "ok"
    : !applied ? "patch does not apply"
    : !passAll ? `must_pass failed: ${task.grade.must_pass.filter((t) => !mustPassOk.includes(t)).join("; ")}`
    : !keptAll ? `must_not_break failed: ${task.grade.must_not_break.filter((t) => !mustNotBreakOk.includes(t)).join("; ")}`
    : "needle not found"

  return {
    schemaVersion: 1,
    task_id: task.id,
    tests: {
      must_pass: { ran: task.grade.must_pass.length, passed: mustPassOk.length, failures: task.grade.must_pass.filter((t) => !mustPassOk.includes(t)) },
      must_not_break: { ran: task.grade.must_not_break.length, passed: mustNotBreakOk.length, failures: task.grade.must_not_break.filter((t) => !mustNotBreakOk.includes(t)) },
    },
    golden: { files_expected: task.golden.files.length, files_hit: goldenHit.length, localization, applied },
    needle: { required: needleRequired, found: needleFound },
    regressions: { files_outside_golden: outside },
    success,
    score: success ? 1 : 0,
    reason,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runDir = process.argv[2]
  const taskPath = process.argv[3]
  const projectPath = process.argv[4]
  if (!runDir || !taskPath || !projectPath) {
    console.error("grade: usage: grade.ts <run-dir> <task.json> <project.json>")
    process.exit(2)
  }
  const g = gradeRun(path.resolve(runDir), path.resolve(taskPath), path.resolve(projectPath))
  mkdirSync(path.resolve(runDir), { recursive: true })
  writeFileSync(path.join(path.resolve(runDir), "grade.json"), JSON.stringify(g, null, 2) + "\n")
  console.log(`graded: ${g.task_id} success=${g.success} score=${g.score} (${g.reason})`)
  process.exit(0)
}
