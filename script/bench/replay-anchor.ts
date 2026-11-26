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

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  cpSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { npmInstall } from "./lib/npm.ts";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");

const TEST_RE =
  /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function git(repo: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    ok: (r.status ?? 1) === 0,
    out: (r.stdout ?? "") + (r.stderr ?? ""),
  };
}

function changedFiles(repo: string, sha: string): string[] {
  const r = git(repo, ["show", "--pretty=", "--name-only", sha]);
  return r.out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export interface Candidate {
  sha: string;
  subject: string;
  sourceFiles: string[];
  testFiles: string[];
}

/** A candidate is structurally eligible when it touches both source and tests. */
export function scanCandidates(
  repo: string,
  opts: { limit?: number; since?: string } = {},
): Candidate[] {
  const args = [
    "log",
    "--no-merges",
    "--pretty=%H\t%s",
    "-n",
    String(opts.limit ?? 400),
  ];
  if (opts.since) args.push(`--since=${opts.since}`);
  const r = git(repo, args);
  const out: Candidate[] = [];
  for (const line of r.out.split("\n")) {
    const [sha, ...rest] = line.split("\t");
    if (!sha || sha.length < 7 || !/^[0-9a-f]{7,40}$/.test(sha)) continue;
    const files = changedFiles(repo, sha);
    const sourceFiles = files.filter(
      (f) => SOURCE_RE.test(f) && !TEST_RE.test(f),
    );
    const testFiles = files.filter((f) => TEST_RE.test(f));
    if (sourceFiles.length === 0 || testFiles.length === 0) continue;
    out.push({ sha, subject: rest.join(" "), sourceFiles, testFiles });
  }
  return out;
}

/** Extract the repo into `dest` at `rev`, optionally taking given paths from `from`. */
function materialise(
  repo: string,
  dest: string,
  rev: string,
  overlay?: { rev: string; paths: string[] },
): void {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const a = spawnSync(
    "sh",
    ["-c", `git archive ${rev} | tar -x -C ${JSON.stringify(dest)}`],
    { cwd: repo, encoding: "utf8" },
  );
  if ((a.status ?? 1) !== 0)
    throw new Error(`materialise: git archive ${rev} failed: ${a.stderr}`);
  if (overlay && overlay.paths.length > 0) {
    // Take the FIX's test files only, so the tests exist while the source is pre-fix.
    for (const p of overlay.paths) {
      const tmp = path.join(dest, ".overlay");
      mkdirSync(tmp, { recursive: true });
      spawnSync(
        "sh",
        [
          "-c",
          `git archive ${overlay.rev} ${JSON.stringify(p)} | tar -x -C ${JSON.stringify(tmp)}`,
        ],
        { cwd: repo },
      );
      const src = path.join(tmp, p);
      if (existsSync(src)) {
        mkdirSync(path.dirname(path.join(dest, p)), { recursive: true });
        cpSync(src, path.join(dest, p));
      }
      rmSync(tmp, { recursive: true, force: true });
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
const RUNNER_RE =
  /\b(node\s+(?:--?\S+\s+)*--test\b|vitest|jest|mocha|ava|tap|uvu|jasmine)\b/;

/**
 * Remove coverage/instrumentation wrappers from a test command.
 *
 * MEASURED, and it silently broke every execa anchor: `c8 --merge-async node --test ...`
 * runs the tests but writes NO TAP lines to stdout (c8 captures and rewrites the stream,
 * emitting a coverage table instead). The anchor then sees 0 tests, concludes "no test
 * moves", and DROPS a perfectly good commit. The fix is to run the runner itself; coverage
 * is irrelevant to whether a test failed.
 */
const WRAPPER_PREFIXES = [
  "c8",
  "nyc",
  "npx c8",
  "npx nyc",
  "cross-env",
  "dotenv",
  "tsx",
];

/**
 * Make a test command emit TAP.
 *
 * The anchor's ground truth is "is the name X in the pass set or the fail set", which is read
 * from TAP. Two runners do not emit TAP by default:
 *   * `node --test` does (it is TAP-13 native);
 *   * `vitest` does NOT -- it prints a human reporter, so the parser saw zero names and every
 *     immer candidate was dropped with "test command produced no TAP results", which reads
 *     like a broken suite rather than a wrong flag.
 *
 * Adding `--reporter=tap` is a REPORTING change only: it cannot make a failing test pass.
 */
function ensureTap(cmd: string): string {
  // A runner installed as a devDependency lives in node_modules/.bin, which is NOT on PATH
  // in the anchor's shell -- `vitest run` fails with "sh: 1: vitest: not found" and the empty
  // output is then reported as "no TAP results", i.e. as a broken suite. `npx` resolves it.
  // Only bare invocations are rewritten; an explicit path or an existing npx stays as-is.
  if (
    !/--reporter/.test(cmd) &&
    /(^|[\s&|;])vitest\b/.test(cmd) &&
    !/npx\s/.test(cmd) &&
    !/\.bin\/vitest/.test(cmd)
  ) {
    cmd = cmd.replace(/(^|[\s&|;])vitest\b/, "$1npx vitest");
  }
  if (!/\bvitest\b/.test(cmd) || /--reporter/.test(cmd)) return cmd;
  // POSITION MATTERS, and getting it wrong is silent: `vitest --reporter=tap run` makes
  // vitest treat `run` as a FILE FILTER, so it matches nothing and emits an empty TAP stream
  // -- which the anchor reports as "test command produced no TAP results", i.e. a broken
  // suite rather than a misplaced flag. `vitest run --reporter=tap` is the correct form
  // (verified against immer 1..25 with nested subtests).
  if (/\bvitest\s+run\b/.test(cmd))
    return cmd.replace(/\bvitest\s+run\b/, "vitest run --reporter=tap");
  // No explicit subcommand: vitest defaults to watch mode, so `run` must be added too.
  return cmd.replace(
    /\bvitest\b(?![\s\S]*?\brun\b)/,
    "vitest run --reporter=tap",
  );
}

function stripInstrumentation(cmd: string): string {
  let out = cmd.trim();
  // 1. remove wrapper program names.
  let changed = true;
  while (changed) {
    changed = false;
    for (const w of WRAPPER_PREFIXES) {
      if (out.startsWith(w + " ")) {
        out = out.slice(w.length + 1).trim();
        changed = true;
      }
    }
  }
  // 2. remove the wrapper's own FLAGS, which are left stranded in front of the runner.
  //    MEASURED: `c8 --merge-async node --test ...` stripped only the program name, leaving
  //    `--merge-async node --test ...` as the command to execute -- which runs nothing, emits
  //    no TAP, and drops every candidate with "no test results". Drop leading dash-flags
  //    until the first non-flag token, which is the runner itself.
  const tokens = out.split(/\s+/);
  let i = 0;
  while (i < tokens.length && tokens[i].startsWith("-")) i++;
  // Guard: only strip flags that appear BEFORE a known runner. If the flags came after it,
  // they belong to the runner and must stay.
  const firstRunner = tokens.findIndex(
    (tok) => RUNNER_RE.test(tok) || tok === "node" || tok === "npx",
  );
  if (firstRunner > 0 && i >= firstRunner) {
    out = tokens.slice(i).join(" ");
  }
  return out;
}

function detectTestCommand(
  dir: string,
  depth = 0,
  seen = new Set<string>(),
): string | null {
  const pkgPath = path.join(dir, "package.json");
  if (!existsSync(pkgPath) || depth > 4) return null;
  let scripts: Record<string, string>;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    scripts = pkg.scripts ?? {};
  } catch {
    return null;
  }
  const resolve = (fragment: string): string | null => {
    const f = fragment.trim();
    if (f.length === 0) return null;
    // Direct runner.
    if (RUNNER_RE.test(f)) return stripInstrumentation(f);
    // `npm run <name>` / `npm run-script <name>` indirection.
    const m =
      /^(?:npm|pnpm|yarn)\s+(?:run\s+|run-script\s+)?([A-Za-z0-9:_-]+)$/.exec(
        f,
      );
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      const inner = scripts[m[1]];
      if (typeof inner === "string") {
        for (const piece of inner.split("&&")) {
          const got = resolve(piece);
          if (got) return got;
        }
      }
    }
    // `npm run a && npm run b` etc. handled by the caller's split; also try bare script names.
    if (!seen.has(f) && typeof scripts[f] === "string") {
      seen.add(f);
      return resolve(scripts[f]);
    }
    return null;
  };
  const test = scripts.test;
  if (typeof test === "string") {
    for (const piece of test.split("&&")) {
      const got = resolve(piece);
      if (got) return got;
    }
  }
  // No usable `test` script: fall back to a conventional one that names a runner.
  for (const key of ["unit", "tests", "test:unit"]) {
    const s = scripts[key];
    if (typeof s !== "string") continue;
    for (const piece of s.split("&&")) {
      const got = resolve(piece);
      if (got) return got;
    }
  }
  return null;
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
export const DEFAULT_MODEL_CUTOFF = "2025-06-01";

/**
 * Load the reviewed exclusion list of tests whose own outcome is not reproducible.
 *
 * This is the honest alternative to pretending a flaky test is a criterion. Exclusions are
 * EVIDENCED (each entry records how it was observed) and VISIBLE (they land in
 * `anchor.unstable_tests`), and the file is reviewed rather than derived, because a derived
 * list can grow to exclude whatever is inconvenient.
 */
function loadFlakyPatterns(): string[] {
  const f = path.join(REPO_ROOT, "benchmarks", "spec", "flaky-tests.json");
  if (!existsSync(f)) return [];
  try {
    const d = JSON.parse(readFileSync(f, "utf8")) as {
      patterns?: { match?: string }[];
    };
    return (d.patterns ?? [])
      .map((p) => p.match ?? "")
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

export interface AnchorResult {
  ok: boolean;
  /** Why it was dropped, when !ok. */
  reason: string | null;
  /** The sha as the caller named it (may be short). */
  sha: string;
  /** The resolved 40-hex fix commit -- what a task must record. */
  fixSha: string;
  base: string;
  testFiles: string[];
  sourceFiles: string[];
  /** Commit date of the fix, ISO day. */
  fixDate: string | null;
  /** Model cutoff the anchor was checked against. */
  modelCutoff: string;
  /** True when fixDate >= modelCutoff, i.e. post-cutoff and therefore not memorisable. */
  postCutoff: boolean;
  /** Test names that fail at base and pass after the fix, CONFIRMED stable on a retry. */
  movedTests: string[];
  /** Moved once but not on retry: load-sensitive, dropped from grading. */
  unstableTests: string[];
  /** Tests that pass at base too (pass-to-pass, used for regression). */
  stableTests: string[];
  testCommand: string | null;
  sourceDiff: string;
  /** The diff of TEST files between base and fix; the grader must apply it. */
  testDiff: string;
  promptBody: string;
}

function runTests(
  dir: string,
  command: string,
  timeoutMs = 1_800_000,
): { names: Map<string, boolean>; raw: string; timedOut: boolean } {
  // TIMEOUT, AND WHY IT WAS A SILENT BUG. This was hardcoded to 600s. The execa suite takes
  // ~696s on this machine, so the second run was KILLED, produced no output, and the anchor
  // reported "test command produced no TAP results" -- three execa commits were dropped as
  // "does not constitute a task" when they were perfectly good tasks whose suite simply ran
  // longer than the limit. A timeout must never be reported as a property of the CODE.
  const r = spawnSync(command, {
    cwd: dir,
    encoding: "utf8",
    timeout: timeoutMs,
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  const raw = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const timedOut =
    r.error !== undefined &&
    /ETIMEDOUT|timed?\s?out/i.test(
      String(r.error.message ?? (r.error as { code?: string }).code ?? ""),
    );
  const names = new Map<string, boolean>();
  for (const line of raw.split("\n")) {
    // INDENTED TAP IS STILL TAP. vitest indents nested subtests by their depth:
    //     1..25
    //     ok 1 - __tests__/array-methods-filter-length.js {
    //         1..4
    //         ok 1 - filter length: plugin=false ...
    // An anchored /^(not ok|ok)/ therefore saw only the TOP-LEVEL file entries, whose names
    // are file paths -- so a source fix that flips an individual test appeared to move
    // nothing, and every immer candidate was dropped as "no TAP results". Allowing leading
    // whitespace (and an optional `- ` TAP directive) reads the real names.
    const m = /^\s*(not ok|ok)\s+\d+\s*-\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    // Strip the trailing TAP syntax so a name compares against a task's expected string:
    //   "name # time=12ms {"  ->  "name"
    //   "name # SKIP ..."     ->  "name"
    //
    // ONLY AN UNESCAPED `#` IS A COMMENT. TAP escapes a literal `#` inside a test name as
    // `\#`, and a real p-queue test is named "intervalCap should be respected with high
    // concurrency (issue #126)". Stripping at the first `#` truncated that to
    // "... (issue \" -- a name that matches nothing, so the task's must_pass entry could never
    // be satisfied and the task was silently unpassable.
    const name = m[2]
      .replace(/\s+#(?![^\\]*\\#).*$/, "") // an unescaped `#` starts a comment
      .replace(/\\#/g, "#") // unescape a literal `#`
      .replace(/\s*\{$/, "")
      .trim();
    if (name.length === 0) continue;
    // A name seen both ok and not-ok is a failure (a suite can report a parent aggregate).
    const prev = names.get(name);
    names.set(name, m[1] === "ok" && prev !== false);
  }
  return { names, raw, timedOut };
}

/**
 * Build and VERIFY a replay anchor. This is the gate that makes a replay task real: it
 * installs dependencies twice (base tests, then fixed source) and asserts the failing set
 * moves. Expensive on purpose -- a task admitted without this is a guess.
 */
export function anchor(
  repo: string,
  sha: string,
  opts: { work: string; install?: boolean; modelCutoff?: string },
): AnchorResult {
  const fixSha = git(repo, ["rev-parse", `${sha}^{commit}`]).out.trim();
  const base = git(repo, ["rev-parse", `${fixSha}^`]).out.trim();
  const modelCutoff = opts.modelCutoff ?? DEFAULT_MODEL_CUTOFF;
  const fixDate =
    git(repo, ["log", "-1", "--format=%cs", fixSha]).out.trim() || null;
  const postCutoff = fixDate !== null && fixDate >= modelCutoff;
  const files = changedFiles(repo, sha);
  const testFiles = files.filter((f) => TEST_RE.test(f));
  const sourceFiles = files.filter(
    (f) => SOURCE_RE.test(f) && !TEST_RE.test(f),
  );

  const fail = (
    reason: string,
    extra: Partial<AnchorResult> = {},
  ): AnchorResult => ({
    ok: false,
    reason,
    sha,
    fixSha,
    base,
    fixDate,
    modelCutoff,
    postCutoff,
    testFiles,
    sourceFiles,
    movedTests: [],
    unstableTests: [],
    stableTests: [],
    testCommand: null,
    sourceDiff: "",
    testDiff: "",
    promptBody: "",
    ...extra,
  });

  if (testFiles.length === 0) return fail("no test file in the fix");
  if (sourceFiles.length === 0) return fail("no source file in the fix");

  const sourceDiff = git(repo, [
    "diff",
    base,
    fixSha,
    "--",
    ...sourceFiles,
  ]).out;
  // THE FIX'S OWN TEST CHANGES, kept separately.
  //
  // The anchor proves a task by overlaying the fix's tests on the base tree: at base they
  // fail, after the source fix they pass. The GRADER then evaluates a submission in that same
  // tree -- but it used to use the BASE tests, which can encode the OLD behaviour.
  //
  // Measured: p-queue 48586f4's own test asserts "The setter does not validate, so the next
  // `.add()` rejects instead", which the fix deliberately inverts. Graded against base tests,
  // the GOLDEN PATCH ITSELF scored 0 -- and every arm failed identically, which reads like
  // four agents being bad at the task rather than a broken task.
  const testDiff = git(repo, ["diff", base, fixSha, "--", ...testFiles]).out;
  if (sourceDiff.trim().length === 0) return fail("empty source diff");

  const baseDir = path.join(opts.work, "base");
  materialise(repo, baseDir, base, { rev: sha, paths: testFiles });

  const detected = detectTestCommand(baseDir);
  if (detected === null) return fail("no test command in package.json");
  // Isolate the TEST RUNNER from its chain. `immer` chains
  // `vitest run && yarn test:build && yarn test:flow`, where the last two are packaging
  // checks that need yarn and a build artefact and cannot fail for a source-level fix.
  //
  // It must be the first segment that IS a runner, not simply the first segment: p-queue
  // chains `xo && node --import=tsx/esm --test ...`, and taking segment zero would run the
  // linter and call it a test suite. A linter's exit code is not a test outcome.
  const segments = detected
    .split("&&")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const runnerSegment = segments.find((s) => RUNNER_RE.test(s)) ?? detected;
  const cmd = ensureTap(runnerSegment);

  if (opts.install !== false) {
    const inst = npmInstall(baseDir);
    if (!inst.ok) return fail(`npm install failed at base: ${inst.detail}`);
  }

  // 1. at base + fix tests: the fix's tests must FAIL.
  const before = runTests(baseDir, cmd);
  if (before.timedOut)
    return fail(
      `the suite did not finish within the timeout at base; this is a runner limit, not a task property (command: ${cmd})`,
    );
  if (before.names.size === 0)
    return fail(`test command produced no TAP results (command: ${cmd})`);

  // 2. apply the source diff and they must PASS.
  const pf = path.join(baseDir, ".anchor.patch");
  writeFileSync(pf, sourceDiff);
  const ap = spawnSync("patch", ["-p1", "-s", "--forward", "-i", pf], {
    cwd: baseDir,
    encoding: "utf8",
  });
  if ((ap.status ?? 1) !== 0)
    return fail(
      `source patch did not apply to base: ${(ap.stderr ?? "").slice(0, 200)}`,
    );
  const after = runTests(baseDir, cmd);
  if (after.timedOut)
    return fail(
      `the suite did not finish within the timeout after the fix; this is a runner limit, not a task property (command: ${cmd})`,
    );

  const moved: string[] = [];
  const stable: string[] = [];
  for (const [name, passedBefore] of before.names) {
    const passedAfter = after.names.get(name);
    if (passedAfter === undefined) continue;
    if (!passedBefore && passedAfter) moved.push(name);
    else if (passedBefore && passedAfter) stable.push(name);
  }
  rmSync(pf, { force: true });

  if (moved.length === 0) {
    return fail(
      "no test moves from fail->pass, so this commit does not constitute a task",
    );
  }

  // CONFIRM STABILITY BY TWO-RUN AGREEMENT, not by one retry.
  //
  // A test that fails at base can "move" for two different reasons: the fix really fixed it,
  // or it is TIMING-SENSITIVE and happened to fail because the machine was busy. The second
  // poisons the task: the test lands in `must_pass` and then fails intermittently, so a
  // CORRECT submission scores 0 whenever the box is loaded. Measured on p-queue 48586f4:
  // "intervalCap should be respected with high concurrency (issue #126)" moved into must_pass
  // for a TIMEOUT fix that cannot affect it, then failed under load and passed 5/5 alone.
  //
  // A single retry is NOT enough -- it caught that one flake and then six of six tasks still
  // failed the golden gate on "interval should be maintained when using await between adds",
  // which passes alone and fails under load. One sample cannot tell "stable" from "quiet
  // that second".
  //
  // So the fixed-source suite runs a second time and only tests that AGREE across two
  // identical runs are gradeable, in either direction. A test whose own outcome is not
  // reproducible cannot be a correctness criterion for anyone. Disagreements leave both
  // must_pass and must_not_break and are named in `unstable_tests`, so an exclusion is
  // visible rather than looking like the commit simply did less.
  const unstable = new Set<string>();
  // 1. Reviewed exclusions (timing-dependent tests observed to disagree).
  const flaky = loadFlakyPatterns();
  for (const name of [...moved, ...stable]) {
    if (flaky.some((pat) => name.includes(pat))) unstable.add(name);
  }
  // 2. Two-run agreement, catching anything the reviewed list has not met yet.
  const after2 = runTests(baseDir, cmd);
  if (!after2.timedOut) {
    for (const name of [...moved, ...stable]) {
      const a = after.names.get(name);
      const b = after2.names.get(name);
      if (a === undefined || b === undefined || a !== b) unstable.add(name);
    }
  }
  const confirmed = moved.filter((n) => !unstable.has(n));
  if (confirmed.length === 0) {
    return fail(
      `all ${moved.length} moved test(s) disagreed between two identical runs (load-sensitive, not fixed by this commit); this commit does not constitute a task`,
    );
  }
  const stableMoved = confirmed;
  const stableKept = stable.filter((n) => !unstable.has(n));

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
  ].join("\n");

  return {
    ok: true,
    reason: null,
    sha,
    fixSha,
    base,
    fixDate,
    modelCutoff,
    postCutoff,
    testFiles,
    sourceFiles,
    movedTests: stableMoved,
    unstableTests: [...unstable],
    stableTests: stableKept,
    testCommand: cmd,
    sourceDiff,
    testDiff,
    promptBody,
  };
}

/** Emit the task + project files for a verified anchor. */
export function emit(
  results: { anchor: AnchorResult; projectId: string; taskId: string },
  outDir: string,
): void {
  const a = results.anchor;
  mkdirSync(path.join(outDir, "tasks"), { recursive: true });
  mkdirSync(path.join(outDir, "prompts"), { recursive: true });
  mkdirSync(path.join(outDir, "golden"), { recursive: true });
  writeFileSync(
    path.join(outDir, "prompts", `${results.taskId}.md`),
    a.promptBody,
  );
  writeFileSync(
    path.join(outDir, "golden", `${results.taskId}.patch`),
    a.sourceDiff,
  );
  writeFileSync(
    path.join(outDir, "golden", `${results.taskId}.tests.patch`),
    a.testDiff,
  );
  const task = {
    id: results.taskId,
    track: "rewind",
    project: results.projectId,
    origin: {
      kind: "history",
      base_revision: a.base,
      fix_revision: a.fixSha,
      inject_seed: null,
    },
    prompt: `prompts/${results.taskId}.md`,
    golden: {
      files: a.sourceFiles,
      patch: `golden/${results.taskId}.patch`,
      // The fix's test changes. The grader MUST apply these, because grading against base
      // tests can be impossible: a fix that changes its own tests leaves assertions behind
      // that demand the OLD behaviour. See the testDiff comment above.
      tests_patch: `golden/${results.taskId}.tests.patch`,
      needle: null,
    },
    stratification: "hot",
    budget: { max_steps: 80, max_tokens: 400000, max_wall_s: 900 },
    // ALL stable tests, not the first 40.
    //
    // This was `slice(0, 40)` -- a cap that looked harmless and was not: it silently threw
    // away up to 700 regression checks per task (immer and execa each verified 660-790 stable
    // tests), so "did not break anything" was being graded on 5% of the suite. A capped
    // list is also invisible in the artifact: every task showed exactly 40 and nothing said
    // why. The full set is cheap to carry as strings and is the actual claim.
    grade: { must_pass: a.movedTests, must_not_break: a.stableTests },
    // Provenance a reader can re-derive: the anchor property was MEASURED, not asserted.
    anchor: {
      verified: true,
      // Tests that moved once but were not stable on retry. Recorded so an exclusion is
      // visible rather than looking like the commit simply did less.
      unstable_tests: a.unstableTests,
      fix_date: a.fixDate,
      model_cutoff: a.modelCutoff,
      // Post-cutoff tasks are the only ones that can show tool value rather than memory.
      // A pre-cutoff task is ADMITTED but flagged, so a report can separate the two.
      post_cutoff: a.postCutoff,
      moved_tests: a.movedTests.length,
      stable_tests: a.stableTests.length,
      test_command: a.testCommand,
    },
  };
  writeFileSync(
    path.join(outDir, "tasks", `${results.taskId}.json`),
    JSON.stringify(task, null, 2) + "\n",
  );
}

// ── cli ───────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode, repoArg, shaArg] = process.argv.slice(2);
  const repo = repoArg ? path.resolve(repoArg) : "";
  if (!mode || !repo) {
    console.error(
      "replay-anchor: usage: replay-anchor.ts <scan|anchor|verify> <repo> [sha] [--out dir]",
    );
    process.exit(2);
  }
  if (mode === "scan") {
    const cands = scanCandidates(repo);
    console.log(
      `# ${cands.length} structurally eligible fix commits (source + tests)`,
    );
    for (const c of cands.slice(0, 40)) {
      console.log(
        `${c.sha.slice(0, 9)}  src=${c.sourceFiles.length} test=${c.testFiles.length}  ${c.subject.slice(0, 90)}`,
      );
    }
    process.exit(0);
  }
  if (mode === "anchor" || mode === "verify") {
    if (!shaArg) {
      console.error("replay-anchor: a commit sha is required");
      process.exit(2);
    }
    const outIdx = process.argv.indexOf("--out");
    const outDir = outIdx >= 0 ? path.resolve(process.argv[outIdx + 1]) : null;
    const work = path.join(
      REPO_ROOT,
      "benchmarks",
      ".work",
      "anchor",
      shaArg.slice(0, 9),
    );
    const r = anchor(repo, shaArg, { work });
    if (!r.ok) {
      console.error(`DROPPED ${shaArg}: ${r.reason}`);
      process.exit(1);
    }
    const cut = r.postCutoff
      ? "POST-cutoff"
      : `PRE-cutoff (fix ${r.fixDate} < model ${r.modelCutoff})`;
    console.log(
      `ANCHORED ${shaArg.slice(0, 9)}: base=${r.base.slice(0, 9)} moved=${r.movedTests.length} stable=${r.stableTests.length} src=${r.sourceFiles.length} [${cut}]`,
    );
    if (!r.postCutoff) {
      // Not a refusal: a pre-cutoff task is still a real task. But it must be FLAGGED at
      // admission, because a wave that quietly fills up with pre-cutoff tasks is measuring
      // memorised fixes and would be unable to tell anyone.
      console.error(
        `  WARNING: fix date ${r.fixDate} is before the model cutoff ${r.modelCutoff}; this task can be solved from memory. It is admitted and flagged, not silently pooled with post-cutoff tasks.`,
      );
    }
    for (const m of r.movedTests.slice(0, 6)) console.log(`  + ${m}`);
    if (mode === "anchor" && outDir) {
      const projIdx = process.argv.indexOf("--project");
      const projectId =
        projIdx >= 0 ? process.argv[projIdx + 1] : path.basename(outDir);
      emit(
        { anchor: r, projectId, taskId: `t1-rewind-${r.fixSha.slice(0, 7)}` },
        outDir,
      );
      console.log(`wrote task to ${path.relative(REPO_ROOT, outDir)}`);
    }
    process.exit(0);
  }
  console.error(`replay-anchor: unknown mode "${mode}"`);
  process.exit(2);
}
