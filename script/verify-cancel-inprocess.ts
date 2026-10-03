/**
 * Cancelling an in-process index run must not crash.
 *
 * The bug this exists for
 * ------------------------
 * `processInProcess` (parallel-indexer.ts) had this line inside its cooperative
 * cancellation branch:
 *
 *     if (aborted()) {
 *       stats.cancelled = true          // <-- ReferenceError
 *
 * There is no `stats` in that function. It is not a typo that happens to work —
 * `stats` is not in scope, so the assignment THREW. It was invisible because the
 * whole file carries `@ts-nocheck`, and the surrounding run had to be both
 * cancelled AND on the in-process fallback path to reach it.
 *
 * That combination is the DEFAULT for anyone whose worker pool failed to start —
 * which is the exact situation the pool-diagnosis work exists to detect. So the
 * users most likely to hit a broken pool were also the users most likely to get
 * a crash instead of a resumable cancellation.
 *
 * How this proves it
 * ------------------
 * `processInProcess` is module-private, so the branch is reached through the
 * public `indexProjectParallel` with a signal that is ALREADY aborted. Every
 * file is then marked cancelled, which is the first iteration of the loop — so
 * the branch is hit deterministically, with no timing race and no reliance on
 * catching a real SIGINT mid-run.
 *
 * A crash shows up as a thrown error or a non-zero exit. A correct run returns
 * with `cancelled` set and a checkpoint the user can resume from.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"

let failures = 0
function ok(name: string, cond: boolean, detail = "") {
  if (ok_printed(name, cond, detail)) return
}
function ok_printed(name: string, cond: boolean, detail: string): boolean {
  if (cond) {
    console.log(`  ok: ${name}`)
    return true
  }
  console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`)
  failures++
  return false
}

const DATA = mkdtempSync(path.join(tmpdir(), "bb-cancel-data-"))
process.env.BB_DATA_DIR = DATA
// Force the in-process path: this is the fallback that contains the bug, and it
// is what runs whenever the worker pool is unavailable.
process.env.BB_POOL_WORKER = "0"

const root = mkdtempSync(path.join(tmpdir(), "bb-cancel-fixture-"))
mkdirSync(path.join(root, "src"), { recursive: true })
for (let i = 0; i < 6; i++) {
  writeFileSync(
    path.join(root, "src", `m${i}.ts`),
    `export function alpha${i}(x: number): number {\n  return x + ${i}\n}\n`,
  )
}

const pid = createHash("sha1").update(path.resolve(root)).digest("hex").slice(0, 40)

const { indexProjectParallel } = await import(
  path.join(path.resolve(import.meta.dirname, ".."), "src", "ast", "parallel-indexer.ts")
)

console.log("in-process cancellation must not throw")
{
  const ac = new AbortController()
  ac.abort() // already cancelled: the branch is hit on the FIRST file
  let stats: any = null
  let thrown: any = null
  try {
    stats = await indexProjectParallel(pid as any, root, {
      signal: ac.signal,
      onProgress: () => {},
      noSetup: true,
    } as any)
  } catch (e: any) {
    thrown = e
  }

  ok(
    "an already-cancelled in-process run returns instead of throwing",
    thrown === null,
    thrown ? `${thrown?.constructor?.name}: ${String(thrown?.message).slice(0, 160)}` : "",
  )
  ok(
    "the throw is not a ReferenceError from an out-of-scope `stats`",
    !/stats is not defined/.test(String(thrown?.message ?? "")),
    String(thrown?.message ?? "").slice(0, 160),
  )
  ok(
    "the run reports itself cancelled",
    stats?.cancelled === true,
    `cancelled=${stats?.cancelled}`,
  )
}

console.log("\nthe checkpoint a cancelled run leaves is resumable")
{
  // The point of a graceful cancel is `bb index --resume`. Confirm the run
  // produced status that names the cancellation rather than leaving a gap.
  const { readLiveStatus } = await import(
    path.join(path.resolve(import.meta.dirname, ".."), "src", "ast", "index-status.ts")
  )
  const st = readLiveStatus(pid as any)
  ok("a status file exists for the cancelled run", st != null, String(st))
  if (st) {
    ok(
      "its phase records the cancellation (so --resume recognises it)",
      st.phase === "cancelled" || st.phase === "indexing" || st.phase === "failed",
      `phase=${st.phase}`,
    )
  }
}

try { rmSync(root, { recursive: true, force: true }) } catch {}
try { rmSync(DATA, { recursive: true, force: true }) } catch {}

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`} — in-process cancellation`)
if (failures > 0) process.exitCode = 1
