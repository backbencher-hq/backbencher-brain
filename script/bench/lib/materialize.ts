// script/bench/lib/materialize.ts — put a pinned repository into a run workspace.
//
// WHY THIS IS A SEPARATE STEP. benchmarks/spec/SCHEMA.md rule: `benchmarks/` holds TEXT
// ONLY -- no cloned repositories, no binaries. Licensing of repositories we do not own, plus
// the 2 GB-per-language-clone trap that `.corpus*/`-style directories create. So a run never
// copies a committed tree; it materialises the pin at run time from a cached bare clone.
//
// THE TWO REVISIONS ARE DIFFERENT AND BOTH MATTER (Track 1, replay):
//   project.revision -- the pin every run starts from (the repository's current tip)
//   task.origin.base_revision -- the commit JUST BEFORE the fix (fix^), which is where the
//                                agent must start for the task to be a task
// Starting at `project.revision` instead of `fix^` would hand the agent code that already
// contains the fix, and the task would grade a no-op as success. That is the single most
// likely silent error in a replay benchmark, so `materializeTask` refuses to run when the
// base revision is missing or is not an ancestor of the pinned revision.
//
// THE TESTS COME FROM THE FIX COMMIT. At `fix^` the fix's tests do not exist yet, so the
// task would be "make nothing pass". The tests are overlaid from the fix commit, which is
// what makes the anchor property (tests fail at base, pass after the fix) real.

import { mkdirSync, existsSync, rmSync, cpSync, statSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

export interface ProjectPin {
  id: string
  remote: string
  revision: string
  tarball_sha256?: string
}

export interface TaskOrigin {
  base_revision: string | null
  fix_revision: string | null
}

function sh(cmd: string, cwd: string, timeoutMs = 600_000): { ok: boolean; out: string } {
  const r = spawnSync("sh", ["-c", cmd], { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 })
  return { ok: (r.status ?? 1) === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

/** A bare cache clone, so materialising many tasks does not clone the network each time. */
export function ensureCache(remote: string, cacheRoot: string): string {
  const slug = remote.replace(/^https?:\/\/github\.com\//, "").replace(/[^A-Za-z0-9._-]+/g, "_")
  const dir = path.join(cacheRoot, slug)
  if (existsSync(path.join(dir, "HEAD"))) {
    // Best-effort refresh; a run must not fail because the network is down when the cache
    // already has the pin.
    sh(`git fetch --quiet origin '+refs/heads/*:refs/remotes/origin/*' '+refs/tags/*:refs/tags/*' 2>/dev/null || true`, dir, 300_000)
    return dir
  }
  mkdirSync(cacheRoot, { recursive: true })
  const r = sh(`git clone --bare --filter=blob:none --quiet ${JSON.stringify(remote)} ${JSON.stringify(dir)}`, cacheRoot, 900_000)
  if (!r.ok) throw new Error(`materialize: clone of ${remote} failed: ${r.out.slice(-300)}`)
  return dir
}

/** Verify a revision exists in the cache and return its full sha. */
export function resolveRevision(cache: string, rev: string): string {
  const r = sh(`git rev-parse --verify ${JSON.stringify(rev)}^{commit}`, cache)
  if (!r.ok) throw new Error(`materialize: revision ${rev} not found in cache`)
  return r.out.trim()
}

/** True when `a` is an ancestor of (or equal to) `b`. */
export function isAncestor(cache: string, a: string, b: string): boolean {
  return sh(`git merge-base --is-ancestor ${a} ${b}`, cache).ok
}

export interface MaterializeOptions {
  cacheDir: string
  project: ProjectPin
  task: { origin: TaskOrigin; golden: { files: string[] }; _testFiles?: string[] }
  /** Files to overlay from the fix commit (the fix's own tests). */
  testFiles: string[]
  dest: string
}

/**
 * Materialise the task's starting tree at `fix^`, with the fix's tests overlaid.
 * Throws on any condition that would silently produce an already-solved task.
 */
export function materializeTask(opts: MaterializeOptions): { baseSha: string; pinnedSha: string } {
  const { cacheDir, project, task, testFiles, dest } = opts
  const cache = ensureCache(project.remote, cacheDir)
  const pinnedSha = resolveRevision(cache, project.revision)
  const fix = task.origin.fix_revision
  // DERIVE the base from the fix rather than trusting a stored revision.
  //
  // MEASURED BUG, caught by this guard: a hand-typed `base_revision` pointed at the wrong
  // commit after the history was rebased, and the materialised tree silently contained the
  // fix -- the task would have graded a no-op as success. `fix^` is a fact about the commit;
  // a stored sha is a claim about it, and the claim can rot. The stored value is used only
  // as a CROSS-CHECK: if it disagrees with fix^, that is a stale task definition and the
  // build refuses rather than picking one.
  if (!fix) {
    throw new Error(
      "materialize: task has no origin.fix_revision. A replay task is defined by a real fix commit; without it there is no ground truth.",
    )
  }
  const fixSha = resolveRevision(cache, fix)
  const derivedBase = resolveRevision(cache, `${fixSha}^`)
  if (task.origin.base_revision) {
    const claimed = resolveRevision(cache, task.origin.base_revision)
    if (claimed !== derivedBase) {
      throw new Error(
        `materialize: task claims base ${claimed.slice(0, 9)} but ${fixSha.slice(0, 9)}^ is ${derivedBase.slice(0, 9)}. The task definition is stale (rebase? re-anchor?) -- re-anchor it instead of guessing which revision is right.`,
      )
    }
  }
  const baseSha = derivedBase

  // Guard: the base must be reachable from the pin. If it is not, the task belongs to a
  // different history and the module's other assertions mean nothing.
  if (!isAncestor(cache, baseSha, pinnedSha)) {
    throw new Error(`materialize: task base ${baseSha.slice(0, 9)} is not an ancestor of pinned ${pinnedSha.slice(0, 9)}; refusing to build a task from a foreign history`)
  }
  // Guard: the base must NOT already contain the fix -- that is the whole property.
  if (fix && isAncestor(cache, fix, baseSha)) {
    throw new Error(`materialize: base ${baseSha.slice(0, 9)} already contains the fix ${fix.slice(0, 9)}; the task would be pre-solved`)
  }

  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  const ex = sh(`git archive ${baseSha} | tar -x -C ${JSON.stringify(dest)}`, cache)
  if (!ex.ok) throw new Error(`materialize: extract of ${baseSha.slice(0, 9)} failed: ${ex.out.slice(-200)}`)

  // Overlay the fix's test files so the anchor property exists in the workspace.
  if (fix && testFiles.length > 0) {
    const tmp = path.join(dest, ".bench-overlay")
    mkdirSync(tmp, { recursive: true })
    for (const f of testFiles) {
      const got = sh(`git archive ${fix} ${JSON.stringify(f)} | tar -x -C ${JSON.stringify(tmp)}`, cache)
      if (!got.ok) continue
      const src = path.join(tmp, f)
      if (!existsSync(src)) continue
      const out = path.join(dest, f)
      mkdirSync(path.dirname(out), { recursive: true })
      cpSync(src, out, { recursive: statSync(src).isDirectory() })
    }
    rmSync(tmp, { recursive: true, force: true })
  }
  return { baseSha, pinnedSha }
}
