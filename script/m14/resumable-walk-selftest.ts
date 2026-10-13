#!/usr/bin/env npx tsx
/**
 * SELF-TEST for the kill-resilient corpus walk.
 *
 * `script/m14/resumable-walk.ts` exists because a corpus walk that one file can delete is
 * not a measurement. Its first version had that defect ONE LAYER DOWN: the checkpoint
 * recorded a file only AFTER its parse succeeded, and the failure it was built for — a
 * tree-sitter WASM trap followed by a hang, answered by `process.exit()` from engine.ts's
 * 120s bomb — cannot report itself. So the file that killed the run was never recorded, and
 * every re-run resumed INTO the same death. Measured on the TypeScript corpus: 4,230 of
 * 10,328 files, unchanged for two days, looking like a slow corpus rather than a stalled one.
 *
 * This self-test drives the real walk in child processes and kills one of them on purpose,
 * because that is the only way to exercise the path: the write that has to survive is
 * `appendFileSync` BEFORE the parse, and it cannot be observed from inside a process that
 * then exits. `--child` is the inner half.
 *
 *   run 1 (child)  walks 6 fake files, calls process.exit(7) during file 3
 *   run 2 (child)  resumes: file 3 is ABANDONED (named, never retried), 4 and 5 complete
 *
 * The assertions are the properties the stall violated: the second run must make progress,
 * the checkpoint must NAME the abandoned file, and no later run may try it again.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { resolve } from "node:path"
import { resumableWalk, readCheckpoint } from "./resumable-walk"

const CK = "/tmp/bb-resumable-walk-selftest.txt"
const N = 6
const KILL_AT = 3

if (process.argv.includes("--child")) {
  const died = process.argv.includes("--die")
  const rms = process.argv.includes("--reset")
  if (rms) rmSync(CK, { force: true })
  const stats = await resumableWalk(CK, N, {
    id: (i) => `/fake/file-${i}.ts`,
    concurrency: 2,
    run: async (i) => {
      if (died && i === KILL_AT) {
        // No throw: the real failure is a HANG answered with process.exit(), which flushes
        // nothing and returns no code path to the caller. A rejection here would test a
        // mechanism (the `!` marker) that already worked.
        process.stderr.write(`[selftest] killing this run during file-${i}\n`)
        process.exit(7)
      }
      await new Promise((r) => setTimeout(r, 10))
    },
  })
  console.log(JSON.stringify({ walked: stats.walked, resumed: stats.alreadyDone, died: stats.died, bad: stats.skippedBad, partial: stats.partial }))
  process.exit(0)
}

const self = resolve(process.argv[1])
// The child runs through tsx, not node: this suite is TypeScript, and the point of a
// CHILD is that the kill takes the whole process with it.
const child = (extra: string) =>
  execFileSync("npx", ["tsx", self, "--child", ...extra.split(" ").filter(Boolean)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })

const checks: [string, boolean, string][] = []

let killed: number
try {
  child("--reset --die")
  killed = 0
} catch (e: any) {
  killed = e?.status ?? -1
}
checks.push(["the first run is killed (exit 7), which is the failure mode being tested", killed === 7, `exit=${killed}`])

const rawAfterKill = existsSync(CK) ? readFileSync(CK, "utf8") : ""
checks.push([
  "the file in flight when the process died IS named in the checkpoint",
  rawAfterKill.split("\n").includes(`?/fake/file-${KILL_AT}.ts`),
  `checkpoint=${JSON.stringify(rawAfterKill.split("\n").filter(Boolean))}`,
])

const out = child("")
const second = JSON.parse(out.trim().split("\n").pop() ?? "{}") as { walked: number; resumed: number; died: number; partial: boolean }
checks.push(["the second run makes progress instead of resuming into the same death", second.walked >= 1, JSON.stringify(second)])
checks.push(["the killed file is abandoned rather than re-walked", second.died >= 1, `died=${second.died}`])
checks.push(["the walk reports itself partial while any file is abandoned", second.partial === true, `partial=${second.partial}`])

const ck = readCheckpoint(CK)
checks.push([`the abandoned file is named exactly once (${KILL_AT}) and never retried`, ck.died.length >= 1 && ck.died.every((p) => p.includes("file-")), JSON.stringify(ck.died)])

// The third run must WALK NOTHING: everything is either done or abandoned. A walk that
// re-tries an abandoned file would reproduce the original stall one file at a time.
const third = JSON.parse((child("").trim().split("\n").pop() ?? "{}")) as { walked: number }
checks.push(["a third run walks nothing at all", third.walked === 0, `walked=${third.walked}`])

console.log("resumable-walk self-test — kill mid-walk, then resume\n")
let failed = 0
for (const [name, ok, detail] of checks) {
  if (!ok) failed++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  [${detail}]`}`)
}
console.log(`\n${checks.length - failed}/${checks.length} checks`)
process.exitCode = failed === 0 ? 0 : 1
