// script/bench/lib/npm.ts — the ONE install policy for every bench script.
//
// WHY THIS IS CENTRALISED. `npm install` is invoked in three places (materialise a pin,
// anchor a candidate, grade a submission). They must agree, because a tree that installs for
// the anchor and not for the grader is a task that can never score -- and the failure looks
// like a product result ("the agent fixed nothing") rather than an environment error.
//
// THE MEASURED CASE. `immer` pins a root `vitest@^3.2.6` alongside `@vitest/coverage-v8@2.1.9`,
// whose peer requirement is `vitest@2.1.9`. npm's default strict peer resolution refuses the
// whole tree, so EVERY immer task was dropped with "npm install failed at base" -- six
// candidates lost before anyone noticed the cause was a version-skew bug in the project's own
// devDependencies, not anything about the task.
//
// `--legacy-peer-deps` installs a tree that RUNS (verified: 1232 packages, tests pass). It is
// the right choice here because a peer warning in a devDependency cannot change what the
// source does; the alternative -- refusing every project with modern npm metadata -- would
// silently bias the benchmark toward repositories that happen to have tidy devDependencies.
//
// The policy is recorded per run so a reader can see which resolution produced the tree.

import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * Cache root, resolved from THIS module so it is stable regardless of process.cwd().
 *
 * NOT taken from `process.env.npm_config_cache`. npm EXPORTS that variable to every child
 * process it starts, so by the time a bench script runs it is already set -- to npm's default
 * `/home/<user>/.npm`, outside the sandbox. Trusting it reproduced exactly the failure this
 * module exists to prevent, while looking correct in the source. An explicit override must be
 * opt-in under a name npm does not touch.
 */
const CACHE_DIR =
  process.env.BENCH_NPM_CACHE ??
  path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../..",
    "benchmarks",
    ".work",
    "npmcache",
  );

/** Extra flags every bench install uses. Order is stable so logs diff cleanly. */
export const NPM_INSTALL_ARGS: readonly string[] = [
  "install",
  "--no-audit",
  "--no-fund",
  // CACHE AND LOGS GO ON THE COMMAND LINE, NOT IN THE ENVIRONMENT.
  // Measured: with only `npm_config_cache`/`npm_config_logs_dir` set, `npm config get` reports
  // the right values but `npm install` STILL writes its log to ~/.npm/_logs (outside the
  // sandbox) and then fails with "Log files were not written due to an error writing to the
  // directory" -- while having actually installed the packages. Passing --cache/--logs-dir
  // explicitly is honoured (verified: 1 package installed, exit 0).
  "--cache",
  CACHE_DIR,
  "--logs-dir",
  path.join(CACHE_DIR, "_logs"),
  // peer-dependency conflicts in a project's own devDependencies are common and are not a
  // property of the code under test. See the module comment for the measured case.
  "--legacy-peer-deps",
  "--loglevel=error",
];

export interface NpmInstallResult {
  ok: boolean;
  /** Tail of stderr, for the drop reason. Trimmed so a task file stays readable. */
  detail: string;
}

/** Install a tree at `cwd`. Never throws: the caller decides whether to drop or fail. */
export function npmInstall(cwd: string, timeoutMs = 900_000): NpmInstallResult {
  const r = spawnSync("npm", [...NPM_INSTALL_ARGS], {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    env: {
      ...process.env,
      // A cache outside the sandbox is the ENOENT-rooted failure mode; keep it inside.
      // The cache MUST be inside the workspace. npm's default is ~/.npm, which is outside the
      // sandbox, and the failure is not a clean permission error -- npm reports
      // "not written due to an error writing to the directory" while ALSO succeeding at the
      // install, so the exit code can be 0 and the caller still sees an error line. Resolve
      // from this module, never from process.cwd() (which is the run's workspace in a spawn).
      // BOTH must move. `npm_config_cache` redirects the package cache but NOT the log
      // directory, which stays at ~/.npm/_logs -- outside the sandbox -- so npm printed
      // "Log files were not written due to an error writing to the directory: /home/.../.npm/_logs"
      // and the install was reported as failed even when it succeeded.
      // Belt and braces: the flags above are what npm actually honours, these keep any nested
      // npm invocation (postinstall scripts) pointed at the same cache.
      npm_config_cache: CACHE_DIR,
      npm_config_update_notifier: "false",
    },
  });
  if ((r.status ?? 1) === 0) return { ok: true, detail: "" };
  const tail = `${r.stderr ?? ""}`
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .slice(-3)
    .join(" ")
    .slice(0, 300);
  return {
    ok: false,
    detail: tail || `npm install exited ${String(r.status)}`,
  };
}
