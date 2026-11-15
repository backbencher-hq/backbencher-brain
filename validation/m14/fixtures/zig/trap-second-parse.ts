/**
 * ZIG PASS-15 — is the `[BB-HANG]` file the SAME FILE as the `[BB-PARSE-ERR]` file?
 *
 * ## THE OBSERVATION THIS TESTS
 *
 * Two runs of the shared arbiter on 2026-10-04, at the hardcoded fan-out of 8, over the whole
 * zig corpus. In BOTH, the file named in the hang guard is the file named in the parse-error
 * line emitted a few minutes earlier in the SAME process:
 *
 *   run A, full root, 3,834 files:
 *     [BB-PARSE-ERR] zig | .../zig/doc/langref/test_optional_type.zig | memory access out of bounds
 *     [BB-HANG] parser stuck 120s on .../zig/doc/langref/test_optional_type.zig — exiting
 *
 *   run B, bounded root, 1,200 files:
 *     [BB-PARSE-ERR] zig | .../zig/test/cases/compile_errors/undef_shifts_are_illegal.zig | memory access out of bounds
 *     [BB-HANG] parser stuck 120s on .../zig/test/cases/compile_errors/undef_shifts_are_illegal.zig — exiting
 *
 * Two of two, and the pairing is WITHIN one file. Pass 14 attributed the rotation to concurrent
 * fan-out over a shared wasm instance — a CROSS-file account. A cross-file account does not say
 * anything about a file pairing with itself, so it does not explain this.
 *
 * ## WHAT IS ACTUALLY TRUE IN THE CODE, read not guessed
 *
 *   `src/ast/engine.ts:1440-1448`  the guard is PER PARSE CALL, not per file and not per process:
 *       const parseBomb = setTimeout(() => { ...[BB-HANG] on `filePath`... process.exit(1) }, 120000)
 *       const tree = parser.parse(content)
 *       clearTimeout(parseBomb)
 *     so the name in `[BB-HANG]` is the file whose `parser.parse()` blocked, and it says nothing
 *     about what ran before it.
 *
 *   `src/ast/pool-worker.ts:1196-1210` the catch that prints `[BB-PARSE-ERR]` RETURNS
 *     `extractFallback(...)`. It does not re-parse and it does not rethrow, so a trap on file X
 *     cannot by itself re-enter the parser on file X.
 *
 * Together those two say the two messages are emitted by DIFFERENT parses, and the gate's worker
 * loop takes each file index exactly once (`const i = idx++`, synchronous). So either the same
 * file is parsed twice by something this lane does not own, or the pairing is coincidence at
 * n = 2. **This probe cannot see which**, because the engine prints no instance identity and no
 * file index (§8 item 21). What it CAN do is measure the thing that would make the pairing
 * mechanical: whether a file that traps ONCE traps again on a SECOND parse in the same process.
 *
 * ## WHAT IT DECIDES
 *
 * If the second parse of a trapping file also traps or hangs, the trap leaves the wasm instance
 * unusable and the pairing needs no second explanation — the guard then fires on whichever file
 * the poisoned instance is handed next, and the fact that it was the SAME file twice is the
 * signal, not the cause. If the second parse is clean and fast, the instance recovers, the
 * pairing is unexplained by anything in this lane's reach, and n = 2 stands as coincidence.
 *
 * ## WHAT IT CANNOT SEE
 *
 * It runs SEQUENTIALLY, one file per child process, so it cannot reproduce the concurrent
 * interleaving that both observed runs had. A clean result here is evidence that the file is not
 * the variable (as `gate-flagged-files.ts` already shows over 6 files) and is NOT evidence that
 * concurrency is innocent. That is the same limitation, stated in the same direction, as the
 * control it sits beside.
 *
 * ## USAGE
 *
 *   npx tsx validation/m14/fixtures/zig/trap-second-parse.ts <file.zig> [more.zig ...]
 *   npx tsx validation/m14/fixtures/zig/trap-second-parse.ts --list   # the paths both runs named
 *
 * One child process per file, because the hang guard is `process.exit(1)`: the first hang ends
 * the process, so a second attempt has to be a second process for the answer to mean anything.
 */
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** The two files the runs of 2026-10-04 named, both runs, verbatim from the logs. */
const OBSERVED: { run: string; file: string; bytes: number }[] = [
  {
    run: "A full root, 3,834 files",
    file: "/home/ishaq2321/bb_tests/repositories/zig/doc/langref/test_optional_type.zig",
    bytes: 368,
  },
  {
    run: "B bounded root, 1,200 files",
    file: "/home/ishaq2321/bb_tests/repositories/zig/test/cases/compile_errors/undef_shifts_are_illegal.zig",
    bytes: 193934,
  },
]

/**
 * Run one child: `trap-second-parse-child.ts <file>` in ITS OWN process, because the hang guard
 * is `process.exit(1)` — a first hang ends the process, so a second attempt has to be a second
 * process for the answer to mean anything. The child is a file rather than a `-e` eval string
 * because `tsx` picks CJS-vs-ESM from the nearest package.json to the FILE, and this one needs
 * the repo's `"type": "module"` for its top-level `await`.
 */
const CHILD = path.join(HERE, "trap-second-parse-child.ts")
const REPO = path.resolve(HERE, "../../../..")

function runChild(file: string): { out: string; code: number | null } {
  try {
    const out = execFileSync("npx", ["tsx", CHILD, file], {
      encoding: "utf8",
      timeout: 300000,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: REPO,
    })
    return { out, code: 0 }
  } catch (e: any) {
    // The hang guard is process.exit(1); the child's stderr is where both messages land.
    const out = `${e?.stdout ?? ""}${e?.stderr ?? ""}`
    return { out, code: typeof e?.status === "number" ? e.status : null }
  }
}

const argv = process.argv.slice(2)
if (argv.includes("--list")) {
  for (const o of OBSERVED) console.log(`${o.bytes}\t${o.file}\t${o.run}`)
  process.exit(0)
}

const files = argv.length ? argv : OBSERVED.map((o) => o.file)
let paired = 0
for (const file of files) {
  const meta = OBSERVED.find((o) => o.file === file)
  console.log(`\n=== ${file}`)
  if (meta) console.log(`    named by run ${meta.run} (${meta.bytes} bytes on disk)`)
  const { out, code } = runChild(file)
  const firstErr = /BB-PARSE-ERR[^\n]*/.exec(out)?.[0] ?? null
  const hang = /BB-HANG[^\n]*/.exec(out)?.[0] ?? null
  const attempts = out.split("\n").filter((l) => l.startsWith("attempt "))
  for (const l of attempts) console.log("    " + l)
  if (firstErr) console.log("    first parse reported: " + firstErr)
  if (hang) console.log("    guard fired:          " + hang)
  if (attempts.length === 0 && !hang) console.log("    (no attempt line and no guard: the child died before its first print)")
  if (firstErr && hang) paired++
  console.log(`    child exit ${code}`)
}
console.log(`\nfiles where a trap and a hang paired in ONE child: ${paired} of ${files.length}`)
console.log(
  paired === files.length
    ? "READING: the trap leaves the instance unusable — the guard fires on the next parse handed to it."
    : "READING: the instance RECOVERS from a trap; the pairing seen in 2 of 2 concurrent runs is unexplained by this lane.",
)