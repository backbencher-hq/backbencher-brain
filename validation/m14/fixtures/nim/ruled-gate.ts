/**
 * PROOF RUNNER for `script/m14/nim-ruled.ts` — runs the shared arbiter against
 * this lane's ruling table WITHOUT editing the shared file.
 *
 * ## Why this exists
 *
 * `script/m14/ontology-coverage-gate.ts` is supervisor-owned (workstream §8) and
 * its `RULED_BY_LANG` is a literal, so the table in `script/m14/nim-ruled.ts`
 * cannot be exercised by running the gate. A table that has never been run is a
 * claim; this runner is the difference between the two. It copies the gate to
 * /tmp, applies EXACTLY the two lines the supervisor's permanent change needs,
 * and runs the copy. The patches are printed, so the change can be applied by
 * hand without re-deriving it.
 *
 * ## What it prints
 *
 * 1. The patches, and `shared file on disk: UNTOUCHED`.
 * 2. The gate's own table and exit code over the whole admitted corpus.
 * 3. `NIM_IMPLEMENTS_EXAMINED` — what the probe WALKED, so the `implements` row
 *    can be seen to have examined the corpus rather than to be a probe that
 *    cannot fire. A probe that examined nothing and a probe that examined 216
 *    concepts and found 0 refinements print the same `occurrences: 0`, and only
 *    the second one is evidence.
 *
 * ## Two knobs, both about this machine rather than about the measurement
 *
 *   BB_NIM_RULED_SKIP_GATE=1   write the patched copy and stop, so the gate run
 *                              can be repeated directly when the box is saturated
 *                              and a child process keeps getting OOM-killed
 *                              (15 GB shared by seven concurrent lanes).
 *   BB_NIM_RULED_WORKERS=n     the gate admits the corpus through 8 concurrent
 *                              `parseFile` calls; on a saturated box that is what
 *                              gets killed. The patch changes the fan-out and
 *                              nothing else — the admitted file list, the
 *                              instrument, the verdicts and the exit code are the
 *                              gate's.
 *
 * Run: npx tsx validation/m14/fixtures/nim/ruled-gate.ts
 */
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { NIM_IMPLEMENTS_EXAMINED, NIM_RULED } from "../../../../script/m14/nim-ruled"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const GATE = path.join(ROOT, "script/m14/ontology-coverage-gate.ts")
const TABLE = path.join(ROOT, "script/m14/nim-ruled.ts")
const OUT_DIR = "/tmp/opencode/nim-ruled-proof"
const ANALYZER = path.join(ROOT, "src/ast/real-nim-analyzer.ts")
const TABLE_SHA = createHash("sha256").update(readFileSync(TABLE)).digest("hex")
const GATE_SHA = createHash("sha256").update(readFileSync(GATE)).digest("hex")

// The copy runs from /tmp, where there is no package.json saying `type: module`,
// so tsx would compile it as CommonJS and reject the gate's top-level await.
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(path.join(OUT_DIR, "package.json"), JSON.stringify({ type: "module" }))

// ---------------------------------------------------------------- patch the COPY
//
// TWO patches, and two only. nim's own spec
// (`script/m14/spec/nim-completeness.json`) carries NIMD3, a `status: RULED`
// decision about `implements` in the `resolution` field the gate reads, so unlike
// TOML (whose spec writes `ruling` and carries no ontology decision) the gate
// finds a written ruling without a temporary spec. The gate at HEAD also checks
// the ruling TABLE before the spec, and this row is in the table — so the run below
// measures the table and not the spec, which is the point.
const original = readFileSync(GATE, "utf8")

// The registration this runner exists to prove LANDED on the aggregate, so at
// HEAD patches 1 and 2 are no-ops: the gate already imports `NIM_RULED` and
// already lists `nim:` in `RULED_BY_LANG`. They are kept here anyway, and the
// runner now DETECTS which state the gate is in rather than demanding a state
// that no longer exists.
//
// Before this, the runner exited 2 with "PATCH DID NOT APPLY — patch 1" on a
// gate that is correctly wired. That is the worst shape for a proof runner: the
// thing being proved is TRUE, the runner cannot see it, and its exit code says
// the proof failed. A runner that reports failure when the fact holds trains its
// reader to ignore it.
const alreadyRegistered = /import\s*\{\s*NIM_RULED\s*\}/.test(original)
const alreadyInMap = /RULED_BY_LANG[\s\S]{0,600}?\bnim:\s*NIM_RULED\b/.test(original)

const patches: { find: string; replace: string; note: string }[] = []
if (alreadyRegistered && alreadyInMap) {
  patches.push({
    find: "(already present in the shared gate)",
    replace: "(nothing to do)",
    note: "patches 1+2 SKIPPED — the shared gate already imports NIM_RULED and already maps nim: NIM_RULED. This runner is now proving the table's BEHAVIOUR, not the two lines that wire it",
  })
} else {
  patches.push(
    {
      find: 'import { LANGS } from "./differential"',
      replace: `import { LANGS } from "${path.join(ROOT, "script/m14/differential")}"\nimport { NIM_RULED } from "${TABLE}"`,
      note: "patch 1 — the table",
    },
    {
      // Matched on the PREFIX so the patch survives the two lanes that have already
      // been wired (lua, toml) instead of demanding an exact string that changes
      // every time another lane lands. If the supervisor applies this to a gate whose
      // map has grown, the same edit applies.
      find: "const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED,",
      replace: "const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED, nim: NIM_RULED,",
      note: "patch 2 — the map entry (prefix-matched, so it applies to the gate as it stands at HEAD)",
    },
  )
}

let patched = original
for (const p of patches) {
  // A patch whose `find` is the skip marker is a RECORD of a patch not applied.
  if (p.find.startsWith("(already present")) continue
  if (!patched.includes(p.find)) {
    console.error(`nim-ruled-gate: PATCH DID NOT APPLY — ${p.note}\n  looking for: ${p.find}`)
    process.exit(2)
  }
  patched = patched.replace(p.find, p.replace)
}
// The copy lives outside the repo, so the source imports it makes relative must
// become absolute, and `web-tree-sitter` must resolve from the repo's own
// node_modules. That is a consequence of running from /tmp, not a change in what
// the gate measures. A DIRECTORY specifier is not a legal ES module import, so
// the package's resolved entry is used.
patched = patched
  .replace('from "../../src/ast/language-detection"', `from "${path.join(ROOT, "src/ast/language-detection")}"`)
  .replace('from "../../src/ast/pool-worker"', `from "${path.join(ROOT, "src/ast/pool-worker")}"`)
  .replace('await import("web-tree-sitter")', `await import(${JSON.stringify(path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.cjs"))})`)
  // Every lane table the gate already imports is RELATIVE (`./lua-ruled`), so the
  // copy cannot resolve them from /tmp. The first attempt at this proof died with
  // ERR_MODULE_NOT_FOUND on `lua-ruled` three seconds in — before the corpus admit,
  // so before anything was measured. Rewriting them by pattern rather than by name
  // means the fix survives the next lane being wired.
  .replace(/from "\.\/([a-z0-9-]+-ruled)"/g, (_m, mod: string) => `from ${JSON.stringify(path.join(ROOT, "script/m14", mod))}`)
  // `./resumable-walk` is a DYNAMIC import and the lane-table pattern above does not
  // match it (it is not a static `from "..."`). The gate calls it by that relative name,
  // so a copy living in /tmp cannot resolve it and the proof dies with
  // ERR_MODULE_NOT_FOUND before the corpus is admitted — before anything is measured.
  // Found by running it: the gate gained a resumable walk and this runner had not
  // caught up, so the failure surfaced as a patch error rather than as an import error
  // and sent the reader looking in the wrong file.
  .replace('await import("./resumable-walk")', `await import(${JSON.stringify(path.join(ROOT, "script/m14/resumable-walk"))})`)
  // `./differential` is the same problem on a STATIC import, and the lane-table pattern
  // above deliberately does not match it — it requires a `-ruled` suffix so it cannot
  // rewrite a module it has not enumerated. `differential` is 1.3 MB and is not a lane
  // table, so it needs its own rewrite, and the failure is the same class: the proof
  // dies with ERR_MODULE_NOT_FOUND before the corpus is admitted, so nothing is measured
  // and the reader is sent looking at a gate that is wired correctly. Both of these were
  // found by RUNNING the proof, not by reading the gate, which is the argument for
  // running it after every shared-gate merge rather than trusting the patch list.
  .replace('from "./differential"', `from ${JSON.stringify(path.join(ROOT, "script/m14/differential"))}`)

// The fan-out patch, and it MOVED because the gate moved — twice, in two directions.
//
// The first target was `Array.from({ length: 8 }, () => worker())`, a hand-rolled worker
// pool in the gate's own body. The gate now hands the walk to `resumableWalk`, so that
// string no longer exists and this runner exited 2 with "worker patch did not apply" on
// a gate that is correctly wired — the same failure mode this file already documents for
// patches 1 and 2, in a third place.
//
// So the patch matches the CURRENT knob, `concurrency: 8` in the `resumableWalk` options,
// and DETECTS rather than demands: if the gate has already been rewired again the runner
// reports the state it found and says what it would patch, instead of exiting 2 with a
// factually wrong "the proof failed". A proof runner that reports failure when the fact
// holds trains its reader to ignore it, which is the argument that produced the
// `alreadyRegistered` branch above.
const WORKERS = process.env.BB_NIM_RULED_WORKERS
if (WORKERS) {
  const n = Number(WORKERS)
  if (!Number.isInteger(n) || n < 1) {
    console.error(`nim-ruled-gate: BB_NIM_RULED_WORKERS=${WORKERS} is not a positive integer`)
    process.exit(2)
  }
  const candidates = [
    { find: "concurrency: 8,", replace: `concurrency: ${n},` },
    // Kept because the gate may still be on the hand-rolled pool at some other ref, and a
    // runner that silently stops patching is worse than one that tries two spellings.
    { find: "Array.from({ length: 8 }, () => worker())", replace: `Array.from({ length: ${n} }, () => worker())` },
  ]
  const hit = candidates.find((c) => patched.includes(c.find))
  if (!hit) {
    console.error(`nim-ruled-gate: fan-out patch found NO known knob in the gate copy.`)
    console.error(`  Looked for: ${candidates.map((c) => JSON.stringify(c.find)).join("  and  ")}`)
    console.error(`  The gate's walk may have been rewired again. This runner CANNOT prove the`)
    console.error(`  fan-out it was asked for; the verdict table below is unaffected by it.`)
    process.exit(2)
  }
  patched = patched.replace(hit.find, hit.replace)
  patches.push({
    find: hit.find,
    replace: hit.replace,
    note: `patch 3 — corpus fan-out to ${n} via BB_NIM_RULED_WORKERS (matched ${JSON.stringify(hit.find)}), because 8 concurrent parseFile calls were OOM-killed on a saturated box`,
  })
}

// The parseBomb shim, and it is disclosed rather than folded into the other
// patches because it changes a SAFETY MECHANISM.
//
// `ASTEngine` arms a 120 s self-destruct timer around every `parser.parse()`
// (`src/ast/engine.ts:1440-1445`) and calls `process.exit(1)` when it fires,
// because a WASM parse is synchronous C code that no timer can interrupt. On this
// corpus the arbiter never reaches its verdict table: it prints the corpus-admit
// line and then dies.
//
// The cause is not a slow FILE. The files that trip it move between runs —
// `ossymlinks.nim` (7,828 B) on one run, `tempfiles.nim` (6,792 B) on another —
// and every one of them logs `[BB-PARSE-ERR] … memory access out of bounds` first,
// which is the tree-sitter WASM running out of its fixed heap under memory
// pressure. With seven lanes sharing 8 cores the box runs at load 16-25, so which
// files trap is a property of the machine at that moment, not of the corpus.
// A corpus verdict that depends on which files happen to be slow is not
// reproducible, and reproducibility is the point of a census.
//
// The first attempt at this shim patched the gate COPY for a `parseBomb` string,
// which does not exist there: the timer lives in `src/ast/engine.ts`, which the
// gate imports unmodified. Patching the copy of the gate could never have reached
// it. The shim below works from the only place this file owns — the gate copy's
// own module body — and neutralises the timer by wrapping the global `setTimeout`
// for the 120,000 ms case only. `src/ast/engine.ts` is NOT edited; `clearTimeout`
// on the dummy id is harmless.
//
// What this changes is the arbiter's ability to REACH its verdict. The admitted
// file list, the instrument, the verdicts and the exit code are the gate's. What
// it costs is the protection against a genuinely infinite parse: with the shim on,
// such a parse hangs the run instead of ending it, and the operator — not this
// script — decides whether to wait.
const HANG_SHIM = `
// ── nim-ruled-gate PROOF SHIM (not part of the gate) ────────────────────────────
// ASTEngine arms a 120s parse self-destruct that calls process.exit(1), which kills
// the arbiter before it prints a verdict when one file exhausts the tree-sitter WASM
// heap. Neutralised here for the proof run only; engine.ts is untouched. Disable with
// BB_NIM_RULED_NO_HANG_SHIM=1 to reproduce the shared behaviour exactly.
if (process.env.BB_NIM_RULED_NO_HANG_SHIM !== "1") {
  const __realSetTimeout = globalThis.setTimeout
  ;(globalThis as any).setTimeout = function (fn: any, ms?: any, ...rest: any[]): any {
    if (ms === 120000) return 0
    return __realSetTimeout(fn, ms, ...rest)
  }
}
// ── end PROOF SHIM ─────────────────────────────────────────────────────────────
`
if (process.env.BB_NIM_RULED_NO_HANG_SHIM !== "1") {
  patched = HANG_SHIM + patched
  patches.push({
    find: "<module body of the gate copy>",
    replace: "a PROOF SHIM that neutralises the 120,000 ms parse self-destruct",
    note: "patch 4 — DISABLE the engine's 120s parse self-destruct, from the COPY's module body only (engine.ts untouched). SAFETY MECHANISM, NOT A FAN-OUT: without it one WASM-heap trap kills the arbiter before it prints a verdict, and WHICH file traps moves between runs on a saturated box",
  })
}

// The epilogue, and it is a fix rather than a convenience.
//
// `NIM_IMPLEMENTS_EXAMINED` is module state inside `script/m14/nim-ruled.ts`, so
// the gate COPY mutates its OWN instance of it in the child process. Reading the
// same export in this parent process printed all zeros next to a verdict the child
// had just computed — four zeros that looked like a probe that examined nothing,
// on a run that had in fact walked 4,555 files. A counter read from the wrong
// process is worse than no counter, because it contradicts the row it annotates.
//
// So the copy is given an epilogue and the numbers come from the run that produced
// the verdict. It is appended AFTER the gate's own last statement, which sets
// `process.exitCode` rather than calling `process.exit`, so the epilogue runs.
const EPILOGUE = `
// ── nim-ruled-gate EPILOGUE (not part of the gate) ─────────────────────────────
// NIM_IMPLEMENTS_EXAMINED is module state, and the gate copy mutated its own
// instance in THIS process — so it is printed HERE, from the run that produced the
// verdict above, rather than read in the parent.
import { NIM_IMPLEMENTS_EXAMINED as __examined, NIM_RULED as __rows } from ${JSON.stringify(TABLE)}
console.log("")
console.log("== NIM_IMPLEMENTS_EXAMINED (from THIS run) ==")
if (__rows.length === 0) {
  // The vacuous-zero case, and it has to be labelled rather than printed as a
  // measurement. With no rows in the table the gate consults no probe, so these
  // counters are UNREAD — not walked-and-empty. Printing them bare beside a
  // computed verdict is exactly the "0 with no denominator" reading this whole
  // instrument exists to prevent: a reader would take four zeros for a probe that
  // examined the corpus and found nothing, when in fact nothing examined anything.
  // The row that used to need them was withdrawn as FALSIFIED; the corpus-wide
  // numbers now live in validation/m14/fixtures/nim/nim-ruled-probe.ts.
  console.log("  NOT RUN — the table has 0 rows, so the gate consulted no probe this walk.")
  console.log("  These four counters are therefore UNREAD, which is not the same as 0.")
  console.log("  For the corpus-wide figures run: npx tsx validation/m14/fixtures/nim/nim-ruled-probe.ts")
} else {
  for (const [k, v] of Object.entries(__examined)) console.log("  " + String(k).padEnd(34) + v)
  console.log("  refinements is the number that would have made the row above print FALSIFIED.")
  console.log("  conceptsExamined > 0 with refinements = 0 is the difference between a probe")
  console.log("  that examined the corpus and one that examined nothing.")
}
// ── end EPILOGUE ───────────────────────────────────────────────────────────────
`
patched = patched + EPILOGUE
patches.push({
  find: "<end of the gate copy>",
  replace: "an EPILOGUE printing NIM_IMPLEMENTS_EXAMINED from this process",
  note: "patch 5 — append an epilogue so the probe's counters come from the run that produced the verdict. Without it this runner printed four ZEROS beside a computed row: the export is module state and the child mutated its own instance",
})

const GATE_COPY = path.join(OUT_DIR, "ontology-coverage-gate.nim-proof.ts")
writeFileSync(GATE_COPY, patched)

console.log(`nim-ruled-gate: ${patches.length} patch(es) applied to a COPY of script/m14/ontology-coverage-gate.ts`)
for (const p of patches) {
  console.log(`  ${p.note}`)
  console.log(`    - ${p.find.length > 92 ? `${p.find.slice(0, 92)}…` : p.find}`)
  console.log(`    + ${p.replace.length > 92 ? `${p.replace.slice(0, 92)}…` : p.replace}`)
}
console.log(`  (plus: the copy's two relative src/ imports and its web-tree-sitter import rewritten to absolute paths, because the copy runs from ${OUT_DIR})`)
console.log(`  shared file on disk: UNTOUCHED — ${path.relative(ROOT, GATE)}`)
console.log(`  table rows: ${NIM_RULED.length} (${NIM_RULED.map((r) => r.type).join(", ")})`)
console.log(`  table sha256    : ${TABLE_SHA.slice(0, 16)}  (script/m14/nim-ruled.ts)`)
console.log(`  gate sha256     : ${GATE_SHA.slice(0, 16)}  (script/m14/ontology-coverage-gate.ts, the shared file the copy was made from)`)
console.log("")

// ---------------------------------------------------------------- run it
const SKIP_GATE = process.env.BB_NIM_RULED_SKIP_GATE === "1"
if (SKIP_GATE) {
  console.log(`BB_NIM_RULED_SKIP_GATE=1 — patched copy written, gate NOT run.`)
  console.log(`  run it with: npx tsx ${GATE_COPY} nim`)
  console.log("")
} else {
  const started = Date.now()
  const analyzerShaBefore = createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")

  /**
   * The gate MUST walk the corpus for this runner's verdict to be a verdict.
   *
   * A proof runner that can inherit a checkpoint reports a verdict about files it
   * never read. Measured here on 2026-10-05, exactly as Limitations 36 describes:
   * the child resumed `validation/m14/measurements/walk-nim.txt` — which is
   * GITIGNORED, so it is not part of the evidence — printed
   * `walk: 6063/6063 files (100.0%)  newly walked 0, resumed 6063` and then
   * **`emitted 0/10  ruled-sound 3  FALSIFIED 0  ruled-without-justification 7`,
   * exit 1**. Every type read zero because nothing was walked, seven of those
   * zeros became RULED-UNJUSTIFIED, and the header still claimed 100% of the
   * corpus. A 100% that reports a population the run did not look at is a
   * fabricated measurement, and here it was the PROOF of the lane's own ruling
   * table rather than the finding it was checking.
   *
   * So `--fresh` is passed to the child by default, and `BB_NIM_RULED_RESUME=1`
   * is the only way to inherit one — for the case where resuming is what you
   * actually want, and where the printed `newly walked 0, resumed 6063` is the
   * signal that the verdict covers nothing.
   */
  const RESUME = process.env.BB_NIM_RULED_RESUME === "1"
  const gateArgs = ["tsx", GATE_COPY, "nim", ...(RESUME ? [] : ["--fresh"])]
  console.log(`child invocation: npx ${gateArgs.join(" ")}`)
  console.log(
    RESUME
      ? `  BB_NIM_RULED_RESUME=1 — the child INHERITS its checkpoint. A verdict from a resumed walk describes only the files an earlier run walked; read its 'newly walked' line before reading its verdict.`
      : `  --fresh passed, so the child's verdict is about the corpus and not about a gitignored checkpoint.`,
  )
  console.log("")

  let out = ""
  let code = 0
  try {
    out = execFileSync("npx", gateArgs, { cwd: ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
  } catch (err: any) {
    out = String(err.stdout ?? "") + String(err.stderr ?? "")
    code = typeof err.status === "number" ? err.status : 1
  }
process.stdout.write(out.replace(/^\[INFO\].*$/gm, ""))
  console.log("")
  const analyzerShaAfter = createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
  console.log(`analyzer sha256 across the child's walk : ${analyzerShaAfter.slice(0, 16)}${analyzerShaAfter === analyzerShaBefore ? "  (unchanged — the verdict above is tied to this analyzer state)" : "  CHANGED DURING THE RUN — the verdict above is a MIXTURE of two analyzer states and are not reproducible"}`)
  console.log(`exit code ${code}  (${((Date.now() - started) / 1000).toFixed(0)}s)`)

  /**
   * The population check, made mechanical. The gate prints its own walk line and
   * this reads it, because a verdict about a population the run did not look at
   * is the failure this runner exists to rule out — and a runner that prints such
   * a verdict in its own output, unremarked, is the same defect one level up.
   *
   * The threshold is zero NEWLY-WALKED files on a corpus of more than one file:
   * anything else means the verdict rests entirely on an inherited, gitignored
   * checkpoint. A walk that covered the corpus with a small tail of bad files is
   * NOT this failure — `partial` covers that and the gate says so.
   */
  const walkLine = /walk:\s+(\d+)\/(\d+) files \(([^)]*)\)\s+newly walked (\d+), resumed (\d+)(.*)/.exec(out)
  if (walkLine) {
    const [, walkedS, totalS, , newlyS, resumedS, tail] = walkLine
    const newly = Number(newlyS)
    const resumed = Number(resumedS)
    console.log("")
    console.log(`POPULATION CHECK — ${walkedS}/${totalS} files, newly walked ${newly}, resumed ${resumed}${tail.trim()}`)
    if (Number(totalS) > 1 && newly === 0) {
      console.log(`  *** THE VERDICT ABOVE COVERS NO FILE THIS RUN WALKED. ***`)
      console.log(`  Every per-type count is 0 because nothing was parsed, and the gate correctly`)
      console.log(`  converted seven of those zeros into RULED-UNJUSTIFIED. This is not a finding about`)
      console.log(`  the lane. Re-run without a checkpoint (the default), or read the verdict above as`)
      console.log(`  unmeasured. The checkpoint is gitignored, so it is not evidence and cannot be shipped.`)
    } else if (Number(totalS) > 1 && resumed > 0) {
      console.log(`  PARTIAL RESUME — ${resumed} of ${walkedS} files came from an inherited, gitignored`)
      console.log(`  checkpoint and ${newly} were walked here. The verdict covers all ${walkedS} files ONLY if`)
      console.log(`  the checkpoint's population was this same corpus; nothing in the tree records that.`)
    } else {
      console.log(`  clean: this run walked every file the gate admitted, so the verdict is about the corpus.`)
    }
  } else {
    console.log("")
    console.log(`  POPULATION CHECK — could not read a walk line from the child's output, so the population`)
    console.log(`  this verdict covers is UNSTATED. The gate prints one; if it is absent the run did not get`)
    console.log(`  as far as the verdict and the exit code above is the whole result.`)
  }
}
console.log("")
console.log("== NIM_IMPLEMENTS_EXAMINED ==")
console.log("  printed by the gate copy's own epilogue (patch 5), from the run that produced the")
console.log("  verdict above. This process reads all zeros and that is CORRECT: the export is")
console.log("  module state inside script/m14/nim-ruled.ts and the child mutated its own instance.")
console.log("  With the table at 0 rows the child ran no probe at all, and its epilogue says so")
console.log("  rather than printing four unread counters as if they were measurements.")
console.log("  For the same walk measured in THIS process, run:")
console.log("    npx tsx validation/m14/fixtures/nim/nim-ruled-probe.ts")
void NIM_IMPLEMENTS_EXAMINED