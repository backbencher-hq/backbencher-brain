/**
 * POISON PROBE — find every file in the gate's remaining population that CANNOT be
 * parsed, and mark only those, so the gate's own walk terminates.
 *
 * ## The defect this exists to terminate
 *
 * `ontology-coverage-gate.ts dart` cannot reach its verdict table. Measured on this lane:
 *
 *   walk checkpoint      27,398 / 33,692 admitted files  (67 minutes with zero appends)
 *   one surviving run    04:23:30 elapsed, 03:27:02 CPU, 8 checkpoint appends
 *
 * Two facts, and they only fit together one way. `resumable-walk.ts` appends a
 * checkpoint line per file, immediately after `parseFile` resolves, so a live walk writes
 * a line every fraction of a second. Zero appends for 67 minutes with the CPU pegged is
 * therefore not slow progress — it is a thread inside a tight loop. And
 * `parser.parse()` is SYNCHRONOUS WASM: all 8 workers share one main thread, so ONE
 * spinning file blocks every worker, which is why nothing at all was appended rather
 * than 7 files' worth.
 *
 * That also explains why the existing remedy does not reach this file.
 * `gate-drive.ts` marks a file bad only on a `[BB-HANG] … on <file>` line in that run's
 * own output — and the engine's 120s guard produces that line from a TIMER, which cannot
 * fire while synchronous WASM owns the thread. A file that spins inside the parser
 * emits nothing at all, so the driver cannot see it and the walk is unkillable from the
 * inside. The two recorded hangs were both recoverable; this one is a different shape.
 *
 * ## What this adds, and what it will not do
 *
 * The signal here is EXTERNAL and it is strictly stronger evidence than the engine's own
 * guard: the parent SIGKILLs a child that has produced no progress line for STALL
 * seconds. A process that had to be killed from outside, while burning CPU, did not
 * finish — and the only file it could have been inside is the one it last announced,
 * because the announcement is appended and flushed BEFORE the parse starts.
 *
 * So every skip is attributable to a named file and a named observation. This does not
 * mark a file bad on a parse ERROR, on an exit code, or on a hunch: `parseFile`
 * rejecting is the walk's own business and the child's `!` line mirrors it, but a file
 * that merely throws is recorded by the walk on its own. Only two events license a skip
 * here — an external SIGKILL after a measured stall, and a `[BB-HANG]` line naming a file
 * in this run's own output. If neither appears, the probe stops and says so.
 *
 * It writes the poison list to its own file and NEVER pre-covers the gate checkpoint with
 * files it merely survived. That would be the tempting shortcut and it is wrong: the gate
 * tallies edges only for files it walks in ITS OWN process, so marking a file walked that
 * this probe walked would silently zero out that file's contribution to every EMITTED
 * count. Only poison files — the ones no implementation can read — are marked.
 *
 * Usage:
 *   poison-probe.ts                    parent: supervise, mark poison, write the list
 *   poison-probe.ts --child LIST START  child: walk LIST from START, append progress
 */
import { execFileSync, spawn } from "node:child_process"
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { readCheckpoint } from "../../../../script/m14/resumable-walk"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "dart"
const CHECKPOINT = `validation/m14/measurements/walk-${LANG}.txt`
const LIST = "/tmp/opencode/dart-poison-list.json"
const PROGRESS = "/tmp/opencode/dart-poison-progress.txt"
const REPORT = "/tmp/opencode/dart-poison-report.json"

/** Seconds without a progress line before the child is killed and its last file blamed. */
const STALL_SECONDS = 150

/**
 * This file's own path, so the child is the SAME instrument rather than a re-typed copy.
 * `__filename` is not defined here: the module is ESM (it has top-level await), and
 * tsx reports that combination as ERR_AMBIGUOUS_MODULE_SYNTAX rather than guessing.
 */
const SELF = process.argv[1]

interface Entry { abs: string; dir: string; rel: string; repo: string }

// ---------------------------------------------------------------- child
if (process.argv.includes("--child")) {
  const list: Entry[] = JSON.parse(readFileSync(LIST, "utf8"))
  const start = Number(process.argv[process.argv.indexOf("--child") + 2] ?? 0)
  for (let i = start; i < list.length; i++) {
    const e = list[i]
    // Announce BEFORE the parse and flush by construction: appendFileSync returns only
    // once the bytes are in the file, so a SIGKILL at any later instant still leaves an
    // accurate record of which file the process was inside.
    appendFileSync(PROGRESS, `> ${i} ${e.abs}\n`)
    try {
      await parseFile(e.abs, e.dir)
    } catch (err: any) {
      appendFileSync(PROGRESS, `x ${i} ${e.abs} ${String(err?.message ?? err).slice(0, 120)}\n`)
    }
  }
  process.exit(0)
}

// ---------------------------------------------------------------- parent

/** The gate's OWN admission rule and OWN order, so the population is the gate's population. */
function admit(): Entry[] {
  const out: Entry[] = []
  const dirents = execFileSync("ls", ["-1", CR], { encoding: "utf8" }).split("\n").filter(Boolean)
  for (const e of dirents) {
    const dir = `${CR}/${e}`
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8",
        maxBuffer: 512 * 1024 * 1024,
      })
        .split("\0")
        .filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      const abs = `${dir}/${rel}`
      let text: string
      try {
        if (statSync(abs).size > 512 * 1024) continue
        text = readFileSync(abs, "utf8")
      } catch {
        continue
      }
      if (detectLanguageFromPath(abs, text) !== LANG) continue
      out.push({ abs, dir, rel, repo: e })
    }
  }
  return out
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const progressLines = (): string[] => {
  if (!existsSync(PROGRESS)) return []
  return readFileSync(PROGRESS, "utf8").split("\n").filter(Boolean)
}
const checkpointLines = (): number =>
  existsSync(CHECKPOINT) ? readFileSync(CHECKPOINT, "utf8").split("\n").filter((l) => l.trim()).length : 0

const all = admit()
const { done, bad } = readCheckpoint(CHECKPOINT)
const covered = new Set([...done, ...bad])
const todo = all.filter((f) => !covered.has(f.abs))
console.log(`gate population      ${all.length} admitted ${LANG} files`)
console.log(`checkpoint           ${done.length} done, ${bad.length} marked bad`)
console.log(`probe population     ${todo.length} files the gate still has to walk`)

writeFileSync(LIST, JSON.stringify(todo))
writeFileSync(PROGRESS, "")
console.log(`wrote ${LIST} and reset ${PROGRESS}\n`)

const poison: { file: string; signal: string; stallSeconds: number }[] = []
const threw: { file: string; error: string }[] = []

function markBad(abs: string, signal: string, stallSeconds: number) {
  appendFileSync(CHECKPOINT, `!${abs}\n`)
  poison.push({ file: abs, signal, stallSeconds })
  console.log(`  POISON  ${signal.padEnd(22)} ${abs}`)
}

let start = 0
for (let attempt = 1; attempt <= 200 && start < todo.length; attempt++) {
  const before = checkpointLines()
  const child = spawn("npx", ["tsx", SELF, "--child", LIST, String(start)], {
    stdio: ["ignore", "ignore", "pipe"],
  })
  let stderr = ""
  child.stderr.on("data", (d) => {
    stderr += String(d)
  })

  let lastCount = -1
  let lastChange = Date.now()
  let killed: string | null = null

  while (true) {
    const alive = child.exitCode === null && child.signalCode === null
    const lines = progressLines()
    if (lines.length !== lastCount) {
      lastCount = lines.length
      lastChange = Date.now()
    }
    if (!alive) break
    if (Date.now() - lastChange > STALL_SECONDS * 1000) {
      const last = [...lines].reverse().find((l) => l.startsWith("> "))
      killed = last ? last.slice(2).replace(/^\d+ /, "") : null
      child.kill("SIGKILL")
      await sleep(500)
      break
    }
    await sleep(1000)
  }

  const exitedNaturally = !killed
  const code = child.exitCode

  for (const l of progressLines()) {
    if (l.startsWith("x ")) {
      const parts = l.slice(2).split(" ")
      threw.push({ file: parts[1], error: parts.slice(2).join(" ") })
    }
  }

  const progressCount = progressLines().filter((l) => l.startsWith("> ")).length
  start = progressCount

  if (killed) {
    if (!killed) {
      console.log(`  stalled with no announced file — stopping rather than guessing.`)
      break
    }
    markBad(killed, `external SIGKILL after ${STALL_SECONDS}s`, STALL_SECONDS)
    continue
  }

  const hang = stderr.match(/\[BB-HANG\][^\n]*?on\s+(\S+)/)
  if (hang) {
    markBad(hang[1], "[BB-HANG] in own output", 0)
    continue
  }

  const after = checkpointLines()
  console.log(
    `  attempt ${attempt}: exit=${code}  walked ${progressCount} files  ` +
      `checkpoint ${before} -> ${after}  next=${start}/${todo.length}`,
  )
  if (code !== 0) {
    console.log(`  child exited ${code} with no [BB-HANG] line. Stopping rather than guessing.`)
    console.log(stderr.slice(-2000))
    break
  }
  if (progressCount === 0 && after === before) {
    console.log(`  no progress and no checkpoint movement. Stopping.`)
    break
  }
}

writeFileSync(REPORT, JSON.stringify({ population: all.length, probed: todo.length, poison, threw }, null, 2))
console.log(`\npoison files   ${poison.length}`)
for (const p of poison) console.log(`  ${p.signal}  ${p.file}`)
console.log(`parse errors   ${threw.length} (the walk records these itself; not marked here)`)
console.log(`report         ${REPORT}`)