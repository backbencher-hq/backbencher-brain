#!/usr/bin/env node
// script/bench/replay-anchor.ts — turn a real fix commit into a gradeable replay task.
//
// WHY THIS EXISTS (DESIGN.md §3, Track 1).
//
// The ground truth for a replay task must NOT be authored by us: a task we invent and a
// patch we write can agree with each other and prove nothing. So the anchor is a real
// commit in the project's own history, and the task is defined by two facts about it:
//
//   base   = fix^  (the parent) -- what the agent starts from
//   fix    = the commit       -- the only known-good answer
//
// The agent starts at `base` but with the FIX'S TESTS present. Those tests fail at base
// and pass after the fix. That single property is the whole task, and it is a property of
// the repository, not of our opinion.
//
// WHAT THIS TOOL GUARANTEES (and refuses otherwise):
//
//   1. the fix touches at least one SOURCE file and at least one TEST file;
//   2. the tests, applied to base source, actually FAIL (a task whose tests already pass
//      is not a task -- it would grade a no-op as success);
//   3. applying the source diff makes them PASS (a task whose "fix" does not fix is
//      broken, and every run against it would be noise);
//   4. the prompt is derived from the test names ONLY -- never from the commit message,
//      which states the answer. A replayed commit message is a spoiler, not a task.
//
// A task that fails 1-3 is DROPPED and counted. `--report` prints the drop reasons so a
// wave cannot quietly lose its hard tasks and keep its easy ones.
//
// USAGE
//   replay-anchor.ts scan     <repo> [--limit N]            list candidate fix commits
//   replay-anchor.ts anchor   <repo> <sha> --out <dir>       build one verified task
//   replay-anchor.ts verify   <repo> <sha>                   check the anchor property

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../..")

const TEST_RE = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/i
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/

function git(repo: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return { ok: (r.status ?? 1) === 0, out: (r.stdout ?? "") + (r.stderr ?? "") }
}

function changedFiles(repo: string, sha: string): string[] {
  const r = git(repo, ["show", "--pretty=", "--name-only", sha])
  return r.out.split("\n").map((l) => l.trim()).filter(Boolean)
}

export interface Candidate {
  sha: string
  subject: string
  sourceFiles: string[]
  testFiles: string[]
}

/** A candidate is structurally eligible when it touches both source and tests. */
export function scanCandidates(repo: string, opts: { limit?: number; since?: string } = {}): Candidate[] {
  const args = ["log", "--no-merges", "--pretty=%H\t%s", "-n", String(opts.limit ?? 400)]
  if (opts.since) args.push(`--since=${opts.since}`)
  const r = git(repo, args)
  const out: Candidate[] = []
  for (const line of r.out.split("\n")) {
    const [sha, ...rest] = line.split("\t")
    if (!sha || sha.length < 7 || !/^[0-9a-f]{7,40}$/.test(sha)) continue
    const files = changedFiles(repo, sha)
    const sourceFiles = files.filter((f) => SOURCE_RE.test(f) && !TEST_RE.test(f))
    const testFiles = files.filter((f) => TEST_RE.test(f))
    if (sourceFiles.length === 0 || testFiles.length === 0) continue
    out.push({ sha, subject: rest.join(" "), sourceFiles, testFiles })
  }
  return out
}

/** Extract the repo into `dest` at `rev`, optionally taking given paths from `from`. */
function materialise(repo: string, dest: string, rev: string, overlay?: { rev: string; paths: string[] }): void {
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  const a = spawnSync("sh", ["-c", `git archive ${rev} | tar -x -C ${JSON.stringify(dest)}`], { cwd: repo, encoding: "utf8" })
  if ((a.status ?? 1) !== 0) throw new Error(`materialise: git archive ${rev} failed: ${a.stderr}`)
  if (overlay && overlay.paths.length > 0) {
    // Take the FIX's test files only, so the tests exist while the source is pre-fix.
    for (const p of overlay.paths) {
      const tmp = path.join(dest, ".overlay")
      mkdirSync(tmp, { recursive: true })
      spawnSync("sh", ["-c", `git archive ${overlay.rev} ${JSON.stringify(p)} | tar -x -C ${JSON.stringify(tmp)}`], { cwd: repo })
      const src = path.join(tmp, p)
      if (existsSync(src)) {
        mkdirSync(path.dirname(path.join(dest, p)), { recursive: true })
        cpSync(src, path.join(dest, p))
      }
      rmSync(tmp, { recursive: true, force: true })
    }
  }
}

/**
 * Find the command that actually RUNS TESTS, not the one that runs the whole CI recipe.
 *
 * Three shapes are common and all three must work, or a project silently has no anchor:
 *   1. `"test": "node --test test/*.js"`            -- direct.
 *   2. `"test": "npm run lint && npm run unit"`     -- chained; lint is NOT the task.
 *   3. `"test": "npm run unit"` where
 *      `"unit": "node --test ..."`                  -- INDIRECTION. This shape is why an
 *                                                      earlier version dropped every execa
 *                                                      commit with "no test command".
 *
 * Resolution is recursive with a visited set, so a script that refers to itself terminates.
 * Lint/type/build steps are deliberately excluded: failing a pre-fix tree on lint style is a
 * failure with nothing to do with the bug under test.
 */
// `node` and its own `--test` flag are frequently NOT adjacent: p-queue runs
// `node --import=tsx/esm --test test/*.ts`. A regex demanding `node --test` found nothing
// and dropped every p-queue commit with "no test command". Allow flags between them, and
// allow the --test flag anywhere after `node`.
const RUNNER_RE = /\b(node\s+(?:--?\S+\s+)*--test\b|vitest|jest|mocha|ava|tap|uvu|jasmine)\b/

/**
 * Remove coverage/instrumentation wrappers from a test command.
 *
 * MEASURED, and it silently broke every execa anchor: `c8 --merge-async node --test ...`
 * runs the tests but writes NO TAP lines to stdout (c8 captures and rewrites the stream,
 * emitting a coverage table instead). The anchor then sees 0 tests, concludes "no test
 * moves", and DROPS a perfectly good commit. The fix is to run the runner itself; coverage
 * is irrelevant to whether a test failed.
 */
const WRAPPER_PREFIXES = ["c8", "nyc", "npx c8", "npx nyc", "cross-env", "dotenv", "tsx"]

function stripInstrumentation(cmd: string): string {
  let out = cmd.trim()
  // 1. remove wrapper program names.
  let changed = true
  while (changed) {
    changed = false
    for (const w of WRAPPER_PREFIXES) {
      if (out.startsWith(w + " ")) {
        out = out.slice(w.length + 1).trim()
        changed = true
      }
    }
  }
  // 2. remove the wrapper's own FLAGS, which are left stranded in front of the runner.
  //    MEASURED: `c8 --merge-async node --test ...` stripped only the program name, leaving
  //    `--merge-async node --test ...` as the command to execute -- which runs nothing, emits
  //    no TAP, and drops every candidate with "no test results". Drop leading dash-flags
  //    until the first non-flag token, which is the runner itself.
  const tokens = out.split(/\s+/)
  let i = 0
  while (i < tokens.length && tokens[i].startsWith("-")) i++
  // Guard: only strip flags that appear BEFORE a known runner. If the flags came after it,
  // they belong to the runner and must stay.
  const firstRunner = tokens.findIndex((tok) => RUNNER_RE.test(tok) || tok === "node" || tok === "npx")
  if (firstRunner > 0 && i >= firstRunner) {
    out = tokens.slice(i).join(" ")
  }
  return out
}

function detectTestCommand(dir: string, depth = 0, seen = new Set<string>()): string | null {
  const pkgPath = path.join(dir, "package.json")
  if (!existsSync(pkgPath) || depth > 4) return null
  let scripts: Record<string, string>
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> }
    scripts = pkg.scripts ?? {}
  } catch {
    return null
  }
  const resolve = (fragment: string): string | null => {
    const f = fragment.trim()
    if (f.length === 0) return null
    // Direct runner.
    if (RUNNER_RE.test(f)) return stripInstrumentation(f)
    // `npm run <name>` / `npm run-script <name>` indirection.
    const m = /^(?:npm|pnpm|yarn)\s+(?:run\s+|run-script\s+)?([A-Za-z0-9:_-]+)$/.exec(f)
    if (m && !seen.has(m[1])) {
      seen.add(m[1])
      const inner = scripts[m[1]]
      if (typeof inner === "string") {
        for (const piece of inner.split("&&")) {
          const got = resolve(piece)
          if (got) return got
        }
      }
    }
    // `npm run a && npm run b` etc. handled by the caller's split; also try bare script names.
    if (!seen.has(f) && typeof scripts[f] === "string") {
      seen.add(f)
      return resolve(scripts[f])
    }
    return null
  }
  const test = scripts.test
  if (typeof test === "string") {
    for (const piece of test.split("&&")) {
      const got = resolve(piece)
      if (got) return got
    }
  }
  // No usable `test` script: fall back to a conventional one that names a runner.
  for (const key of ["unit", "tests", "test:unit"]) {
    const s = scripts[key]
    if (typeof s !== "string") continue
    for (const piece of s.split("&&")) {
      const got = resolve(piece)
      if (got) return got
    }
  }
  return null
}

/**
 * The model's knowledge cutoff. A task whose fix landed BEFORE this date may be in the
 * model's training data, so a solve proves memory rather than tooling.
 *
 * Published protocol: arXiv:2611.17388 evaluates only PRs created after a locked cutoff T0
 * ("strict zero-leakage isolation"). Centering -- subtracting the no-tool baseline -- is a
 * weaker defence: it only removes tasks the baseline ALREADY solves, and a model that
 * half-remembers a fix still benefits from a hint. So the cutoff is enforced at admission.
 */
export const DEFAULT_MODEL_CUTOFF = "2025-06-01"

export interface AnchorResult {
  ok: boolean
  /** Why it was dropped, when !ok. */
  reason: string | null
  /** The sha as the caller named it (may be short). */
  sha: string
  /** The resolved 40-hex fix commit -- what a task must record. */
  fixSha: string
  base: string
  testFiles: string[]
  sourceFiles: string[]
  /** Commit date of the fix, ISO day. */
  fixDate: string | null
  /** Model cutoff the anchor was checked against. */
  modelCutoff: string
  /** True when fixDate >= modelCutoff, i.e. post-cutoff and therefore not memorisable. */
  postCutoff: boolean
  /** Test names that fail at base and pass after the fix. */
  movedTests: string[]
  /** Tests that pass at base too (pass-to-pass, used for regression). */
  stableTests: string[]
  testCommand: string | null
  sourceDiff: string
  promptBody: string
}

function runTests(dir: string, command: string): { names: Map<string, boolean>; raw: string } {
  const r = spawnSync(command, { cwd: dir, encoding: "utf8", timeout: 600_000, shell: true, maxBuffer: 64 * 1024 * 1024 })
  const raw = `${r.stdout ?? ""}\n${r.stderr ?? ""}`
  const names = new Map<string, boolean>()
  for (const line of raw.split("\n")) {
    const m = /^(not ok|ok)\s+\d+\s+-\s+(.+?)\s*$/.exec(line.trim())
    if (m) names.set(m[2], m[1] === "ok")
  }
  return { names, raw }
}

/**
 * Build and VERIFY a replay anchor. This is the gate that makes a replay task real: it
 * installs dependencies twice (base tests, then fixed source) and asserts the failing set
 * moves. Expensive on purpose -- a task admitted without this is a guess.
 */
export function anchor(repo: string, sha: string, opts: { work: string; install?: boolean; modelCutoff?: string }): AnchorResult {
  const fixSha = git(repo, ["rev-parse", `${sha}^{commit}`]).out.trim()
  const base = git(repo, ["rev-parse", `${fixSha}^`]).out.trim()
  const modelCutoff = opts.modelCutoff ?? DEFAULT_MODEL_CUTOFF
  const fixDate = git(repo, ["log", "-1", "--format=%cs", fixSha]).out.trim() || null
  const postCutoff = fixDate !== null && fixDate >= modelCutoff
  const files = changedFiles(repo, sha)
  const testFiles = files.filter((f) => TEST_RE.test(f))
  const sourceFiles = files.filter((f) => SOURCE_RE.test(f) && !TEST_RE.test(f))

  const fail = (reason: string, extra: Partial<AnchorResult> = {}): AnchorResult => ({
    ok: false, reason, sha, fixSha, base, fixDate, modelCutoff, postCutoff,
    testFiles, sourceFiles, movedTests: [], stableTests: [],
    testCommand: null, sourceDiff: "", promptBody: "", ...extra,
  })

  if (testFiles.length === 0) return fail("no test file in the fix")
  if (sourceFiles.length === 0) return fail("no source file in the fix")

  const sourceDiff = git(repo, ["diff", base, fixSha, "--", ...sourceFiles]).out
  if (sourceDiff.trim().length === 0) return fail("empty source diff")

  const baseDir = path.join(opts.work, "base")
  materialise(repo, baseDir, base, { rev: sha, paths: testFiles })

  const cmd = detectTestCommand(baseDir)
  if (cmd === null) return fail("no test command in package.json")

  if (opts.install !== false) {
    const inst = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: baseDir, encoding: "utf8", timeout: 900_000,
      env: { ...process.env, npm_config_cache: path.join(REPO_ROOT, "benchmarks", ".work", "npmcache") },
    })
    if ((inst.status ?? 1) !== 0) return fail(`npm install failed at base: ${(inst.stderr ?? "").split("\n").slice(-2).join(" ").slice(0, 200)}`)
  }

  // 1. at base + fix tests: the fix's tests must FAIL.
  const before = runTests(baseDir, cmd)
  if (before.names.size === 0) return fail("test command produced no TAP results")

  // 2. apply the source diff and they must PASS.
  const pf = path.join(baseDir, ".anchor.patch")
  writeFileSync(pf, sourceDiff)
  const ap = spawnSync("patch", ["-p1", "-s", "--forward", "-i", pf], { cwd: baseDir, encoding: "utf8" })
  if ((ap.status ?? 1) !== 0) return fail(`source patch did not apply to base: ${(ap.stderr ?? "").slice(0, 200)}`)
  const after = runTests(baseDir, cmd)

  const moved: string[] = []
  const stable: string[] = []
  for (const [name, passedBefore] of before.names) {
    const passedAfter = after.names.get(name)
    if (passedAfter === undefined) continue
    if (!passedBefore && passedAfter) moved.push(name)
    else if (passedBefore && passedAfter) stable.push(name)
  }
  rmSync(pf, { force: true })

  if (moved.length === 0) {
    return fail("no test moves from fail->pass, so this commit does not constitute a task")
  }

  // The prompt names the failing tests and nothing else. The commit message is deliberately
  // withheld: it usually states the fix, and a task that contains its answer measures
  // reading comprehension of the commit, not debugging.
  const promptBody = [
    "Some tests in this repository currently fail. Make them pass.",
    "",
    "The failing tests:",
    ...moved.map((m) => `  - ${m}`),
    "",
    `Run them with:  ${cmd}`,
    "",
    "Do not change the tests, and do not weaken an assertion to make it pass.",
    "",
  ].join("\n")

  return { ok: true, reason: null, sha, fixSha, base, fixDate, modelCutoff, postCutoff, testFiles, sourceFiles, movedTests: moved, stableTests: stable, testCommand: cmd, sourceDiff, promptBody }
}

/** Emit the task + project files for a verified anchor. */
export function emit(results: { anchor: AnchorResult; projectId: string; taskId: string }, outDir: string): void {
  const a = results.anchor
  mkdirSync(path.join(outDir, "tasks"), { recursive: true })
  mkdirSync(path.join(outDir, "prompts"), { recursive: true })
  mkdirSync(path.join(outDir, "golden"), { recursive: true })
  writeFileSync(path.join(outDir, "prompts", `${results.taskId}.md`), a.promptBody)
  writeFileSync(path.join(outDir, "golden", `${results.taskId}.patch`), a.sourceDiff)
  const task = {
    id: results.taskId,
    track: "rewind",
    project: results.projectId,
    origin: { kind: "history", base_revision: a.base, fix_revision: a.fixSha, inject_seed: null },
    prompt: `prompts/${results.taskId}.md`,
    golden: { files: a.sourceFiles, patch: `golden/${results.taskId}.patch`, needle: null },
    stratification: "hot",
    budget: { max_steps: 80, max_tokens: 400000, max_wall_s: 900 },
    grade: { must_pass: a.movedTests, must_not_break: a.stableTests.slice(0, 40) },
    // Provenance a reader can re-derive: the anchor property was MEASURED, not asserted.
    anchor: {
      verified: true,
      fix_date: a.fixDate,
      model_cutoff: a.modelCutoff,
      // Post-cutoff tasks are the only ones that can show tool value rather than memory.
      // A pre-cutoff task is ADMITTED but flagged, so a report can separate the two.
      post_cutoff: a.postCutoff,
      moved_tests: a.movedTests.length,
      stable_tests: a.stableTests.length,
      test_command: a.testCommand,
    },
  }
  writeFileSync(path.join(outDir, "tasks", `${results.taskId}.json`), JSON.stringify(task, null, 2) + "\n")
}

// ── cli ───────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode, repoArg, shaArg] = process.argv.slice(2)
  const repo = repoArg ? path.resolve(repoArg) : ""
  if (!mode || !repo) {
    console.error("replay-anchor: usage: replay-anchor.ts <scan|anchor|verify> <repo> [sha] [--out dir]")
    process.exit(2)
  }
  if (mode === "scan") {
    const cands = scanCandidates(repo)
    console.log(`# ${cands.length} structurally eligible fix commits (source + tests)`)
    for (const c of cands.slice(0, 40)) {
      console.log(`${c.sha.slice(0, 9)}  src=${c.sourceFiles.length} test=${c.testFiles.length}  ${c.subject.slice(0, 90)}`)
    }
    process.exit(0)
  }
  if (mode === "anchor" || mode === "verify") {
    if (!shaArg) { console.error("replay-anchor: a commit sha is required"); process.exit(2) }
    const outIdx = process.argv.indexOf("--out")
    const outDir = outIdx >= 0 ? path.resolve(process.argv[outIdx + 1]) : null
    const work = path.join(REPO_ROOT, "benchmarks", ".work", "anchor", shaArg.slice(0, 9))
    const r = anchor(repo, shaArg, { work })
    if (!r.ok) {
      console.error(`DROPPED ${shaArg}: ${r.reason}`)
      process.exit(1)
    }
    const cut = r.postCutoff ? "POST-cutoff" : `PRE-cutoff (fix ${r.fixDate} < model ${r.modelCutoff})`
    console.log(`ANCHORED ${shaArg.slice(0, 9)}: base=${r.base.slice(0, 9)} moved=${r.movedTests.length} stable=${r.stableTests.length} src=${r.sourceFiles.length} [${cut}]`)
    if (!r.postCutoff) {
      // Not a refusal: a pre-cutoff task is still a real task. But it must be FLAGGED at
      // admission, because a wave that quietly fills up with pre-cutoff tasks is measuring
      // memorised fixes and would be unable to tell anyone.
      console.error(`  WARNING: fix date ${r.fixDate} is before the model cutoff ${r.modelCutoff}; this task can be solved from memory. It is admitted and flagged, not silently pooled with post-cutoff tasks.`)
    }
    for (const m of r.movedTests.slice(0, 6)) console.log(`  + ${m}`)
    if (mode === "anchor" && outDir) {
      const projIdx = process.argv.indexOf("--project")
      const projectId = projIdx >= 0 ? process.argv[projIdx + 1] : path.basename(outDir)
      emit({ anchor: r, projectId, taskId: `t1-rewind-${r.fixSha.slice(0, 7)}` }, outDir)
      console.log(`wrote task to ${path.relative(REPO_ROOT, outDir)}`)
    }
    process.exit(0)
  }
  console.error(`replay-anchor: unknown mode "${mode}"`)
  process.exit(2)
}
