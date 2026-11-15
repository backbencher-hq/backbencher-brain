/**
 * PROOF RUNNER for `script/m14/xml-ruled.ts` — runs the shared arbiter against this
 * lane's ruling table WITHOUT editing the shared file.
 *
 * ## Why this exists
 *
 * `script/m14/ontology-coverage-gate.ts` is supervisor-owned (lane brief §8) and its
 * `RULED_BY_LANG` is a literal, so the table in `script/m14/xml-ruled.ts` cannot be
 * exercised by running the gate. A table that has never been run is a claim. This
 * runner copies the gate to /tmp, applies EXACTLY the changes the supervisor's
 * permanent edit needs, runs the copy, and prints the patches so the change can be
 * applied by hand without re-deriving it.
 *
 * ## The four patches
 *
 *   1. `import { XML_RULED } from "<abs path>"` — the table.
 *   2. `RULED_BY_LANG = { …, xml: XML_RULED }` — the map entry.
 *   3. `specPath` HONOURS `BB_RULED_GATE_SPEC`, defaulting to the real spec.
 *   4. the gate's worker count is read from `BB_XML_WORKERS` (default 1) — a
 *      WORKAROUND for a shared-engine defect, NOT part of the permanent edit.
 *   5. the instrument-B loop REPORTS how many files each B probe walked.
 *
 * Only 1–3 are the supervisor's permanent change. 4 and 5 exist because this runner
 * has to produce a verdict that is measured rather than asserted, and at the gate's
 * own 8 workers the run cannot finish at all (patch 4's header).
 *
 * Patch 3 was load-bearing once and no longer is, which is worth recording rather than
 * deleting. `rulingFor()` reads `dec.status === "RULED"` and `dec.resolution`, and
 * xml's completeness spec had EITHER: its decisions carried `concept`/`ruling`/
 * `measured` and no `status` and no `resolution`, so every ruled row reported
 * RULED-UNJUSTIFIED — a verdict about the spec's FIELD NAMES rather than about the
 * table. The first version of this runner therefore wrote a temp spec carrying the
 * rulings in the fields the gate reads, which measured the TABLE but not the SPEC.
 *
 * The spec is DERIVED by `script/m14/emit-xml-completeness.ts` (lane-owned), and that
 * emitter now reads `script/m14/xml-ruled.ts` and emits one `status: "RULED"` decision
 * per entry with the entry's own `resolution`. So the real spec now carries the
 * rulings, the default run below measures the SPEC AND THE TABLE together, and the
 * temp-spec path survives only as an override. `BB_RULED_GATE_SPEC=<file>` selects a
 * different spec; leaving it unset runs the committed one.
 *
 * The remaining half of that change is supervisor-visible and reported as such:
 * regenerating the spec changes `validation/m14/results/M14.0.SPEC*.json`, which is
 * supervisor-owned.
 *
 * ## What it prints
 *
 * The gate's own output and exit code, the verdict rows it printed, and
 * `XML_B_PROBE_WALK` — one line per instrument-B probe carrying the number of files
 * that probe actually walked, so a RULED-SOUND 0 can be told apart from a probe that
 * never ran. The distinction matters for this lane in particular, because the lane's
 * own census probe for `overrides` DID fire, on a key that counted named templates as
 * competing ones, and `overrides` is now EMITTED with its `XML_RULED` entry deleted.
 * See `script/m14/xml-ruled.ts`'s header.
 *
 * ## REPRODUCIBILITY — a run that reports [BB-HANG] has NO quotable counts
 *
 * `src/ast/engine.ts:1442` calls `process.exit(1)` after 120 s on one file, and the
 * engine prints `[BB-HANG] parser stuck 120s on <path>`. This happens on this corpus
 * often enough to be a property of the corpus, not bad luck: measured over four runs of
 * the 11,456-file admitted population it named FOUR DIFFERENT files —
* `bulma/…/umbrella-beach.svg`, `bulma/…/square-root-variable.svg`,
 * `dbeaver/…/tidblake.ui/pom.xml`, `dbeaver/…/sql_console.svg` — each preceded by a
 * `[BB-PARSE-ERR] … memory access out of bounds` on the same path, so the trigger is a
 * wasm memory fault in the XML grammar rather than a large document.
 *
 * WHERE it fires decides what the run is worth, and both positions occur:
 *
 *   before the verdict loop -> no table at all                (measured at 4 workers)
 *   after  the verdict loop -> a COMPLETE table, UNDERCOUNTED (measured at 2 workers)
 *
 * The second is the one to fear. `observed` is accumulated from the worker pool, so a
 * worker killed mid-file contributes none of its edges while every other row still
 * prints. Same corpus, same gate, same ten rows, same summary line:
 *
 *   contains     185,919 edges   <- run that reported [BB-HANG]
 *   contains     185,979 edges   <- clean run of the same corpus     (-60)
 *   references    10,405 edges   <- run that reported [BB-HANG]
 *   references    10,411 edges   <- clean run of the same corpus      (-6)
 *
 * Nothing inside the table marks the run as short, which is why this runner prints
 * `RUN WAS SHORT, COUNTS UNDERCOUNTED` beside the rows and why the numbers quoted in
 * `docs/analyzers/xml.md` are the CLEAN run's. Lower `BB_XML_WORKERS`
 * until the `[BB-HANG]` line is absent; that is the only signal that the counts are
 * whole — and it is NOT a sufficient one, which the current numbers below now prove.
 *
 *   BB_XML_WORKERS=1, BEFORE the `references` re-base (commit c0502b14f, corpus 11,456):
 *     exit 0, no [BB-HANG], contains 185,979 / references 10,411 / imports 464 /
 *     calls 548 / extends 438 / overrides 3
 *
 *   BB_XML_WORKERS=1, AFTER the re-base (HEAD, corpus 11,464 then 11,473), two runs:
 *     exit 0 both, 0 [BB-PARSE-ERR], 0 [BB-HANG] both,
 *     contains 186,270 / references 11,094 / imports 465 / calls 402 /
 *     extends 1,429 / overrides 3 — identical across both runs
 *
 * so 1 is the setting to quote from. The fault is per-file rather than per-worker, and
 * lowering the count is what keeps a run alive long enough to finish, not a cure.
 *
 * THE ZERO ERROR MARKERS ARE NOT A SUFFICIENT SIGNAL FOR WHOLENESS, and this is the
 * measured reason. `84970cf3d` published `contains 185,957` with 0 [BB-PARSE-ERR] and 0
 * [BB-HANG] set, and two later clean runs print 186,270 — 313 higher — with the same two
 * markers absent. A silent short walk and a complete one are indistinguishable from
 * inside the run, so the doc now quotes a number two consecutive runs agree on rather
 * than a number one run produced. See `docs/analyzers/xml.md`, section
 * "`contains 185,957` did not reproduce".
 *
 *   npx tsx validation/m14/fixtures/xml/ruled-gate.ts
 *
 * READ-ONLY with respect to TRACKED files. It writes under /tmp, and it stages ONE
 * extra file INSIDE the repository: `script/m14/.ontology-coverage-gate.xmlproof.ts`.
 *
 * That is not a choice, it is forced by the gate's own imports. The gate resolves
 * `./xml-ruled` and `../../src/ast/...` RELATIVE to its own file, so a copy placed
 * anywhere outside the tree cannot import anything and dies before it walks a single
 * file. This header used to claim "Writes only under /tmp", which was false — the file
 * was in the repository the whole time and the claim is what hid it.
 *
 * Two consequences a reader should not have to discover by looking:
 *
 *   - the staged file is DOT-PREFIXED and UNTRACKED, so `git status --short` shows it as
 *     `?? script/m14/.ontology-coverage-gate.xmlproof.ts` and no lane can commit it by
 *     accident. It is removed on exit, including on the failure paths, so a completed run
 *     leaves the tree exactly as it found it. A KILLED run leaves it behind; the next run
 *     overwrites it.
 *   - it lands in `script/m14/`, which lane brief §8 calls supervisor-owned shared
 *     machinery. It is a dot-file that no gate, census or runner enumerates — every one
 *     of those names files explicitly or filters on `-ruled.ts` — so it is inert to the
 *     other lanes. If that ever stops being true, the fix is to give the gate's imports a
 *     resolution root rather than to keep the staging inside the tree.
 */
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { XML_RULED } from "../../../../script/m14/xml-ruled"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const GATE = path.join(ROOT, "script/m14/ontology-coverage-gate.ts")
const SPEC = path.join(ROOT, "script/m14/spec/xml-completeness.json")
const OUT_DIR = "/tmp/opencode/xml-ruled-proof"

/**
 * The gate's verdict vocabulary, matched by SUBSTRING rather than by the
 * `/\b(EMITTED|RULED-SOUND|FALSIFIED|RULED-UNJUSTIFIED)\b/` this line used to carry.
 *
 * Zero regex is the lane's hard rule and this is a census script, so the rule applies
 * here as much as in the analyzer. The substitution is safe for the job being done:
 * every one of these four words contains either a hyphen or a non-letter, so no verdict
 * word can be produced by a longer identifier that merely starts with the same letters
 * — `RULED-SOUND` and `RULED-UNJUSTIFIED` are not prefixes of one another, and the two
 * bare words cannot appear inside any of the hyphenated ones. That is a claim about
 * these four constants, not a general licence to substring-match, which is why they
 * are named here instead of inlined at the call site.
 */
const VERDICT_WORDS = ["EMITTED", "RULED-SOUND", "FALSIFIED", "RULED-UNJUSTIFIED"]

mkdirSync(OUT_DIR, { recursive: true })

// ---------------------------------------------------------------- patch 3: the spec path
//
// Default: the COMMITTED spec, which now carries the four rulings because
// script/m14/emit-xml-completeness.ts emits them from script/m14/xml-ruled.ts. This
// runner asserts that rather than assuming it — a spec that had lost them would report
// every row RULED-UNJUSTIFIED and the failure would look like a table problem.
const specToUse = process.env.BB_RULED_GATE_SPEC ?? SPEC
{
  const spec = JSON.parse(readFileSync(specToUse, "utf8"))
  const carried = new Set(
    (spec?.design_decision?.decisions ?? [])
      .filter((d: any) => d?.status === "RULED" && typeof d?.resolution === "string" && d.resolution.length > 0)
      .map((d: any) => String(d.relationship)),
  )
  const missing = XML_RULED.filter((r) => !carried.has(r.type)).map((r) => r.type)
  console.log(`spec in use: ${specToUse}`)
  console.log(`  RULED decisions with a non-empty resolution: ${[...carried].sort().join(", ") || "(none)"}`)
  if (missing.length > 0) {
    console.error(`\nruled-gate: REFUSING TO REPORT. The spec carries no RULED resolution for: ${missing.join(", ")}`)
    console.error(`  Every one of those rows would report RULED-UNJUSTIFIED, which is a verdict about the`)
    console.error(`  SPEC's field names and not about the table. Regenerate it:`)
    console.error(`    bun run script/m14/emit-xml-completeness.ts`)
    process.exit(2)
  }
}

// ---------------------------------------------------------------- patches 1 and 2
const patchedGatePath = path.join(OUT_DIR, "ontology-coverage-gate.patched.ts")
const src = readFileSync(GATE, "utf8")

const IMPORT_ANCHOR = 'import { FSHARP_RULED } from "./fsharp-ruled"'
if (!src.includes(IMPORT_ANCHOR)) {
  console.error(`ruled-gate: PATCH FAILED — import anchor not found in ${GATE}:`)
  console.error(`  ${IMPORT_ANCHOR}`)
  console.error(`  The gate's import list changed. Re-derive the patch; do not skip it.`)
  process.exit(2)
}
const MAP_ANCHOR = 'const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED, lua: LUA_RULED, toml: TOML_RULED, fsharp: FSHARP_RULED }'
//
// Patches 1–2 were the runner's ORIGINAL purpose: xml was NOT in `RULED_BY_LANG`, so the
// only way to exercise `script/m14/xml-ruled.ts` was to apply those two lines to a copy.
// xml IS now registered (the round brief's deliverable 3, applied as the same two-line
// convention css/zig/protobuf/nim/fsharp/lua/json already write through), so patches 1–2
// are no longer a proof obligation — they are a no-op, and pretending otherwise would
// re-derive what the shared file already says.
//
// The runner survives anyway, and the reason is NOT that patches 1–2 are still wanted.
// Running the REGISTERED gate at its production worker count of 8 over the full 11,456-file
// admitted population cannot finish: `parseFile`'s per-file self-destruct timer
// (src/ast/engine.ts:1442) fires at 120 s and calls `process.exit(1)`, so the run ends with
// NO verdict table. Patches 4 and 5 are what remain load-bearing — patch 4 makes the run
// finish at all, patch 5 makes an instrument-B 0 attributable to a walk rather than to a
// probe that never ran. Deleting the runner on registration would delete the only
// instrument that produces a MEASURED verdict for this lane.
//
// So: `alreadyWired` gates patches 1–2 only, and the printed patch list says which
// actually applied rather than listing five lines when three ran.
const alreadyWired = src.includes("xml: XML_RULED")
if (!alreadyWired && !src.includes(MAP_ANCHOR)) {
  console.error(`ruled-gate: PATCH FAILED — RULED_BY_LANG anchor not found, and xml is not wired either:`)
  console.error(`  ${MAP_ANCHOR}`)
  console.error(`  Neither shape is present: the gate's map literal has been rewritten. Re-derive, do not skip.`)
  process.exit(2)
}
const WORKER_ANCHOR = "await Promise.all(Array.from({ length: 8 }, () => worker()))"
const BPROBE_ANCHOR = `  treeHits.set(r.type, { occurrences: hits.length, files: hitFiles.size, examples: hits.slice(0, 3) })`
const BPROBE_WALK_ANCHOR = `    if (t) { r.countOnTree(t.rootNode, \`\${f.repo}/\${f.rel}\`, hits); t.delete?.() }`
const BPROBE_HEAD_ANCHOR = `  const hitFiles = new Set<string>()`
const SPEC_ANCHOR = 'const specPath = `script/m14/spec/${LANG}-completeness.json`'
if (!src.includes(SPEC_ANCHOR)) {
  console.error(`ruled-gate: PATCH FAILED — specPath anchor not found:`)
  console.error(`  ${SPEC_ANCHOR}`)
  process.exit(2)
}
if (!src.includes(WORKER_ANCHOR)) {
  console.error(`ruled-gate: PATCH FAILED — worker anchor not found or already changed:`)
  console.error(`  ${WORKER_ANCHOR}`)
  console.error(`  If the gate's worker count is already configurable, drop patch 4 and pass the env var.`)
  process.exit(2)
}
if (!src.includes(BPROBE_ANCHOR) || !src.includes(BPROBE_WALK_ANCHOR) || !src.includes(BPROBE_HEAD_ANCHOR)) {
  console.error(`ruled-gate: PATCH FAILED — instrument-B probe anchors not found:`)
  console.error(`  ${BPROBE_ANCHOR}`)
  console.error(`  ${BPROBE_WALK_ANCHOR}`)
  console.error(`  ${BPROBE_HEAD_ANCHOR}`)
  console.error(`  If the gate's B loop has been rewritten, patch 5 (the walk measurement) must be re-derived.`)
  process.exit(2)
}

let patched = src
if (!alreadyWired) {
  patched = patched.replace(IMPORT_ANCHOR, `${IMPORT_ANCHOR}\nimport { XML_RULED } from "${path.join(ROOT, "script/m14/xml-ruled")}"`)
  patched = patched.replace(MAP_ANCHOR, MAP_ANCHOR.replace("fsharp: FSHARP_RULED }", "fsharp: FSHARP_RULED, xml: XML_RULED }"))
}
patched = patched.replace(SPEC_ANCHOR, `const specPath = process.env.BB_RULED_GATE_SPEC ?? \`script/m14/spec/\${LANG}-completeness.json\``)
// Patch 4: the gate's production worker count, which is a literal 8.
//
// At 8 the gate CANNOT COMPLETE over the full xml admitted population: `parseFile`'s
// per-file self-destruct timer (src/ast/engine.ts:1442) fires at 120 s and calls
// process.exit(1), so one file ends the run with no verdict table printed. That timer
// is not evidence about the file it names — see validation/m14/fixtures/xml/ontology-census.mts's
// BB_XML_WORKERS header for the isolation measurements (raw grammar 22 ms, analyze()
// 7 ms, parseFile alone 1,595 ms on the file it named). Lowering it is honest only
// because it is shown not to change the counts: one fixed 400-file draw at 1 and 4
// workers gave identical per-type rows, probe rows, kind tallies and totals. The
// supervisor's permanent change need NOT include this patch — it is a workaround for a
// shared-engine defect, and it should disappear when that defect is fixed.
const GATE_WORKERS = process.env.BB_XML_WORKERS ?? "1"
patched = patched.replace(WORKER_ANCHOR, `await Promise.all(Array.from({ length: Number(process.env.BB_XML_WORKERS ?? 8) }, () => worker()))`)

// Patch 5: COUNT the instrument-B walk, because "the probe found 0" and "the probe
// never ran" print the same verdict row.
//
// The gate runs every instrument-B `countOnTree` over `files` and reports only
// `occurrences` / `files`. A probe that walked 0 files therefore reports 0 occurrences
// and is graded RULED-SOUND on the strength of a walk that never happened — the exact
// failure this block of the runner used to CLAIM to rule out while printing no number
// to rule it out with. The count is taken in the real loop, over the real admitted set,
// so it measures the run rather than re-deriving it from the source.
//
// Two numbers per B probe, because they fail independently:
//   walked — files whose parse tree the probe was actually invoked on
//   unparsed — admitted files whose `parser.parse` returned no tree, so the probe
//              could not see them however many workers are used
//
// The counters are keyed BY TYPE and zeroed at the head of each probe. The first
// version of this patch used bare globals and never reset them, so it reported
// `walked=2286` for the second of two probes over a 1,143-file corpus — the sum of
// both probes' walks, which reads as "this probe visited 2,286 files" and is false.
// A cumulative counter is worse than none here, because it is confidently wrong.
const WALK_TAG = "xmlWalkByType"
patched = patched.replace(
  BPROBE_HEAD_ANCHOR,
  `${BPROBE_HEAD_ANCHOR}\n  ;(globalThis as any).${WALK_TAG} = { walked: 0, unparsed: 0 } // patch 5: reset per probe, never accumulate`,
)
patched = patched.replace(
  BPROBE_WALK_ANCHOR,
  `    if (t) { r.countOnTree(t.rootNode, \`\${f.repo}/\${f.rel}\`, hits); t.delete?.(); (globalThis as any).${WALK_TAG}.walked++ } else { (globalThis as any).${WALK_TAG}.unparsed++ }`,
)
patched = patched.replace(
  BPROBE_ANCHOR,
  `${BPROBE_ANCHOR}\n  console.log(\`XML_B_PROBE_WALK \${r.type} instrument=\${r.instrument} walked=\${(globalThis as any).${WALK_TAG}.walked} unparsed=\${(globalThis as any).${WALK_TAG}.unparsed} occurrences=\${hits.length} hitFiles=\${hitFiles.size}\`)`,
)

// `String.prototype.replace` with a string needle reports NOTHING when the needle is
// absent — it returns the receiver unchanged. The two anchor guards above prove the
// anchors were present in `src` before patching, which is not the same as proving the
// patched copy carries the instrumentation, so the result is checked rather than
// assumed. This is the same failure the block below exists to prevent, one level up: a
// patch that silently did not apply would leave the walk unmeasured and the run
// reporting instrument-B verdicts it had not earned.
if (!patched.includes(WALK_TAG) || patched === src) {
  console.error(`ruled-gate: PATCH 5 FAILED — the instrument-B walk instrumentation is not in the staged copy.`)
  console.error(`  Expected the staged gate to contain ${WALK_TAG}. Anchors were present, so the gate's B loop`)
  console.error(`  has probably been edited; re-derive the patch rather than reporting an unmeasured verdict.`)
  process.exit(2)
}

// The gate's corpus walk resolves relative paths against the CWD, and its imports are
// relative to the file, so the copy has to sit at the same depth as the original.
const stagedGate = path.join(ROOT, "script/m14/.ontology-coverage-gate.xmlproof.ts")
writeFileSync(stagedGate, patched)
try {
  console.log("patches applied to a COPY of script/m14/ontology-coverage-gate.ts:")
  if (alreadyWired) {
    console.log(`  1-2. SKIPPED — xml is ALREADY in RULED_BY_LANG in the shared gate, so patches 1-2 would re-derive it.`)
    console.log(`       This runner no longer proves the table is reachable; the shared file does that. What it still`)
    console.log(`       provides is patches 3-5, which are the only route to a MEASURED verdict for this lane.`)
  } else {
    console.log(`  1. import { XML_RULED } from "${path.join(ROOT, "script/m14/xml-ruled")}"`)
    console.log(`  2. RULED_BY_LANG = { …, fsharp: FSHARP_RULED, xml: XML_RULED }`)
  }
  console.log(`  3. specPath honours BB_RULED_GATE_SPEC (default: the committed spec)`)
  console.log(`  4. the gate's production worker count is read from BB_XML_WORKERS (this run: ${process.env.BB_XML_WORKERS ?? "1"}) —`)
  console.log(`     a WORKAROUND for a shared-engine defect, not part of the permanent change. See the header.`)
  console.log(`  5. the instrument-B loop reports files-walked per B probe, so a 0 is attributable.`)
  console.log(`     lane-local instrumentation of the copy; NOT part of the permanent change.`)
  console.log(`\nrunning the patched copy over the full admitted corpus — this parses every admitted xml file, so it takes minutes.\n`)

  const res = spawnSync("npx", ["tsx", stagedGate, "xml"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, BB_RULED_GATE_SPEC: specToUse, BB_XML_WORKERS: GATE_WORKERS },
  })
  const stdout = res.stdout ?? ""
  const stderr = res.stderr ?? ""
  // stderr carries the engine's per-file diagnostics, which are findings and not noise.
  const stderrLines = stderr.split("\n").filter((l) => l.length > 0)
  const parseErrs = stderrLines.filter((l) => l.includes("[BB-PARSE-ERR]"))
  const hangs = stderrLines.filter((l) => l.includes("[BB-HANG]"))
  console.log(stdout)
  if (parseErrs.length) {
    console.log(`\nengine diagnostics during the run — ${parseErrs.length} [BB-PARSE-ERR], ${hangs.length} [BB-HANG]:`)
    for (const l of parseErrs.slice(0, 6)) console.log(`  ${l}`)
    for (const l of hangs) console.log(`  ${l}`)
    if (parseErrs.length > 6) console.log(`  … and ${parseErrs.length - 6} more [BB-PARSE-ERR] line(s)`)
  }
  console.log(`\npatched gate exit status: ${res.status}${res.signal ? ` (signal ${res.signal})` : ""}`)
  const verdictLines = stdout.split("\n").filter((l) => VERDICT_WORDS.some((w) => l.includes(w)))
  if (hangs.length > 0) {
    // The position of the self-destruct is NOT deterministic, and the two positions
    // fail differently, so which one happened decides whether the counts mean anything.
    //
    //   hang BEFORE the verdict loop prints -> no table at all (measured at 4 workers)
    //   hang AFTER  the verdict loop prints -> a COMPLETE table whose counts are
    //     UNDERCOUNTED, because `observed` is accumulated from the worker pool and a
    //     worker killed mid-file never contributes its edges
    //
    // The second case is the dangerous one, because the table looks finished. Measured
    // on this branch, corpus 11,456 admitted files: a run that reported [BB-HANG]
    // printed `contains 185,919` where a clean run of the same corpus prints 185,979
    // (-60), and `references 10,405` against 10,411 (-6). Both tables carry all ten
    // rows and the same summary line, so nothing in the table marks the run as short.
    console.log(`\n>>> [BB-HANG] FIRED — src/ast/engine.ts:1442 calls process.exit(1) after 120 s on one file.`)
    if (verdictLines.length === 0) {
      console.log(`>>> It fired BEFORE the verdict loop, so NO verdict table was printed. There is no result here.`)
    } else {
      console.log(`>>> It fired AFTER the verdict loop, so a COMPLETE table was printed — and its counts are`)
      console.log(`>>> UNDERCOUNTED, because \`observed\` accumulates from the worker pool and a worker killed`)
      console.log(`>>> mid-file contributes nothing. Do NOT quote these edge counts; re-run with a lower`)
      console.log(`>>> BB_XML_WORKERS until this line is absent.`)
    }
  }
  if (verdictLines.length) {
    const clean = hangs.length === 0
    console.log(`\nverdict rows the patched gate printed (${verdictLines.length})${clean ? "" : " — RUN WAS SHORT, COUNTS UNDERCOUNTED, see above"}:`)
    for (const l of verdictLines) console.log(`  ${l.trim()}`)
  } else if (res.status !== 0) {
    // A non-zero exit with NO table and NO [BB-HANG] is a third failure, distinct from
    // both branches above, and this runner used to describe it with silence: the child's
    // stderr was filtered down to [BB-PARSE-ERR] and [BB-HANG] lines and everything else
    // — an unhandled exception, an OOM kill, a thrown assertion, a missing module — was
    // dropped. The parent then printed "patched gate exit status: 1" and moved on, so an
    // unexplained death and a gate that declined to answer looked the same to a reader.
    //
    // That is not hypothetical. Two runs of this exact command on this exact tree, minutes
    // apart, produced exit 1 with no table and exit 0 with a full table; the failing run
    // carried neither diagnostic, so the cause could not be recovered after the fact.
    // The whole stderr is therefore written to the OUT_DIR log and its tail printed, so
    // the next occurrence names itself.
    const logPath = path.join(OUT_DIR, `child-exit${res.status}.log`)
    writeFileSync(logPath, stderr, "utf8")
    console.log(`\n>>> UNEXPLAINED NON-ZERO EXIT (${res.status}) with no verdict table and no [BB-HANG].`)
    console.log(`>>> There is NO RESULT in this run. Full child stderr: ${logPath}`)
    const tail = stderrLines.slice(-25)
    console.log(`>>> last ${tail.length} stderr line(s):`)
    for (const l of tail) console.log(`  ${l}`)
    if (stderrLines.length === 0) {
      console.log(`>>> (stderr was EMPTY. The child died before writing anything, which is the shape an`)
      console.log(`>>>  OOM kill and a signal-terminated worker pool both take.)`)
    }
  }
  // The walk measurement, relayed with the gate's own numbers and not summarised.
  const walkLines = stdout.split("\n").filter((l) => l.includes("XML_B_PROBE_WALK"))
  console.log("\nXML_B_PROBE_WALK — an instrument-B row is RULED-SOUND only if its probe WALKED the corpus.")
  console.log("walked is the count of files whose parse tree the probe was invoked on; unparsed is the count")
  console.log("of admitted files whose parser.parse returned no tree, which the probe cannot see at any worker")
  console.log("count. A probe that walked 0 files and found 0 is indistinguishable from a probe that walked")
  console.log("every file and found none, and both print occurrences=0 — so walked is reported beside every 0.")
  console.log("`overrides` was the case that made this necessary: it is EMITTED now (3 edges in 3 files), its")
  console.log("XML_RULED entry was DELETED when the arbiter falsified it, and the only instrument-B entry left")
  console.log("is `uses`. A block that still claimed to examine `overrides` would be asserting about an entry")
  console.log("that no longer exists. See script/m14/xml-ruled.ts.")
  if (walkLines.length === 0) {
    console.log("  MEASURED: NONE — patch 5 did not fire, so NO walk number exists for any instrument-B probe.")
    console.log("  Every instrument-B RULED verdict in this run is therefore UNCHECKED, not RULED-SOUND.")
  } else {
    for (const l of walkLines) console.log(`  ${l.trim()}`)
  }
} finally {
  // The staged copy must not outlive the run: a file left in script/m14/ looks like a
  // lane edit to the next reader and to the honesty gate's tree scan.
  try { (await import("node:fs")).unlinkSync(stagedGate) } catch { /* already gone */ }
}
