/**
 * WHICH FILE STOPS THE GATE — locate the poison file the checkpoint cannot record.
 *
 * ## The defect this exists to name
 *
 * `resumable-walk.ts` marks a bad file by REJECTING: the `catch` around
 * `await opts.run(i)` appends `!<path>`, so a re-run skips it. That works for a parse
 * ERROR, which rejects. It cannot work for a HANG, and a hang is the case the whole
 * file was written for — its own header says `parser.parse()` is synchronous WASM and
 * "the event loop is blocked so a timer cannot interrupt it", so the 120s guard answers
 * by calling `process.exit()`.
 *
 * `process.exit()` unwinds NOTHING. `opts.run(i)` does not return and does not reject, so
 * the `catch` never runs, so no line is appended — and because the append-only log is
 * written BEFORE the next file starts, the file is not marked. The next run offers the
 * same file first, and dies on it identically. Forever.
 *
 * The measured consequence on this lane is recorded in `docs/analyzers/dart.md`:
 * the gate "advanced 0 checkpoint lines in 40 minutes". That is not slowness. It is a
 * file that cannot be recorded, re-attempted on every run, each attempt costing the full
 * 120s guard before the process dies.
 *
 * So this probe computes the gate's OWN file list, in the gate's OWN order, against the
 * gate's OWN checkpoint, and reports the first files the gate will actually attempt.
 * Those are the candidates. No parse happens here — locating the hang and diagnosing it
 * are separate questions, and conflating them is how a lane reports "parser
 * robustness" for what is really "this one file is always index 0".
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { readCheckpoint } from "../../../../script/m14/resumable-walk"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "dart"
const CHECKPOINT = `validation/m14/measurements/walk-${LANG}.txt`

const files: { abs: string; rel: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
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
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ abs, rel })
  }
}

const { done, bad } = readCheckpoint(CHECKPOINT)
const doneSet = new Set([...done, ...bad])
const todo = files.filter((f) => !doneSet.has(f.abs))

console.log(`gate corpus population   ${files.length} admitted dart files`)
console.log(`checkpoint records       ${done.length} done, ${bad.length} marked bad`)
console.log(`already covered          ${files.length - todo.length}`)
console.log(`gate would attempt       ${todo.length}\n`)
console.log(`first 20 the gate attempts, in gate order:`)
for (const f of todo.slice(0, 20)) {
  let size = -1
  try {
    size = statSync(f.abs).size
  } catch {}
  console.log(`  ${String(size).padStart(8)}  ${f.abs}`)
}