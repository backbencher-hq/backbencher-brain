/**
 * CONTROL PROBE — are the files `ontology-coverage-gate.ts` flags actually defective?
 *
 * ## WHY THIS EXISTS
 *
 * The shared arbiter reports corpus files it could not handle:
 *
 *   [BB-PARSE-ERR] zig | <path> | memory access out of bounds
 *   [BB-HANG]      parser stuck 120s on <path> — exiting
 *
 * Both messages name a FILE, which reads as a fact about that file. It is not one. This probe
 * takes the exact paths a real gate run printed and re-parses each one ALONE, five times, through
 * production `parseFile`, and prints the wall clock for every run beside the symbols and
 * relationships it produced.
 *
 * ## WHAT IT DECIDES
 *
 * If a flagged file parses cleanly, repeatably, and fast on its own, then the flag is a
 * property of the RUN — the shared wasm instance under concurrent fan-out — and not of the
 * corpus. That distinction decides whether the arbiter's own output can be read as a
 * measurement of an analyzer (it can) or as a measurement of a mixture that includes
 * concurrency artefacts (it cannot). It also decides whether chasing the named file is worth
 * anyone's time: it is not, if the file is 244 bytes and parses in 24 ms.
 *
 * ## WHAT IT CANNOT SEE
 *
 * It cannot reproduce the failure, and it does not try: five sequential runs of a file that a
 * concurrent run choked on is not evidence that the concurrent run was wrong — it is evidence
 * that the file is not the variable. The arithmetic that closes the gap is printed with the
 * numbers (the 120 s guard against this file's own slowest sequential parse), so the claim is
 * a ratio the reader can check rather than an adjective.
 *
 * It inherits the pinned wasm, so a file that genuinely traps would show up here as a throw or
 * a `fallback: true` on every run. None of the four does, on any of five runs.
 *
 * ## POPULATION — the rule this probe was violating, and the fix
 *
 * The subjects stayed literals on purpose: a control that re-derives its own subjects is not a
 * control. That argument is right about the SUBJECTS and was being used to excuse the
 * POPULATION, which is a different thing. The probe printed `-> 0 of 4 flagged files show any
 * defect` where `4` was the length of a hand-typed array — a number about the wrong population,
 * which is the shape a reader takes for a finding about the corpus.
 *
 * So the subjects remain literals and the population becomes declared and CHECKED. `--from`
 * takes a captured run of the instrument that produced the flags; this probe parses the flagged
 * set out of it, parses the admitted count out of it, and then compares. Three outcomes:
 *
 *   every literal is in the derived flagged set  -> the count is the whole flagged population
 *   some flagged file is not a literal          -> it prints `K of M` and EXITS NON-ZERO,
 *                                                  because a partial draw reported as a whole
 *                                                  is the defect the rule names
 *   no `--from`                                 -> it prints `population UNVERIFIED` and says so
 *                                                  in the summary line rather than implying 4
 *
 * The log is identified by path, size and sha256 prefix, so a stale log cannot silently certify
 * a fresh claim. Line parsing is by string operations, not regex, per the lane's no-regex rule.
 *
 * ## USAGE
 *
 *   npx tsx validation/m14/fixtures/zig/gate-flagged-files.ts --from <captured gate log>
 *   npx tsx validation/m14/fixtures/zig/gate-flagged-files.ts --file /path/to/x.zig --runs 9
 */
import { createHash } from "node:crypto"
import { readFileSync, statSync } from "node:fs"
import { parseFile } from "../../../../src/ast/pool-worker"

const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}

// The paths below are the ones the REAL, supervisor-owned arbiter printed on 2026-10-04 at its
// hardcoded fan-out of 8 — `npx tsx script/m14/ontology-coverage-gate.ts zig` from the main
// checkout, exit 1, no verdict table. Kept as literals on purpose: a control that re-derives
// its own subjects is not a control. The POPULATION they claim to cover is not taken on trust —
// it is read out of a captured run with `--from` and compared, below.
const DEFAULT_FILES = [
  `${CORPUS}/ghostty/src/lib/types.zig`,
  `${CORPUS}/ghostty/src/lib/tinyio/windows.zig`,
  `${CORPUS}/ghostty/src/lib/struct.zig`,
  `${CORPUS}/zig/doc/langref/test_opaque.zig`,
]

const RUNS = Number(arg("runs", "5"))
const HANG_GUARD_MS = 120_000

// `--subjects derived` switches the subjects from the literals to the flagged set read out of the
// log. It exists because of what the check below found: the literals are from ONE run, and a
// later run flagged a file none of them names. The control keeps its literals as the default; this
// is how a run tests the population that run actually produced.
const SUBJECTS = arg("subjects", "literals")

// ---------------------------------------------------------------- population, derived
//
// The log is the instrument's own stdout. Two facts are read out of it and neither is typed here:
// the admitted-file count the instrument printed, and the flagged set it named. String operations
// only — a regex here would be the lane's no-regex defect in the one instrument whose whole job
// is to be trustworthy about a count.
function readPopulation(logPath: string): { admitted: number; flagged: string[]; id: string } | null {
  let text: string
  try {
    text = readFileSync(logPath, "utf8")
  } catch {
    return null
  }
  const sha = createHash("sha256").update(text).digest("hex").slice(0, 16)
  const id = `${logPath} (${statSync(logPath).size} bytes, sha256:${sha})`

  let admitted = 0
  const a = text.indexOf("admitted files")
  if (a > 0) {
    // skip whitespace back over the gap, then walk the digits that precede "admitted files"
    let i = a - 1
    while (i >= 0 && (text[i] === " " || text[i] === "\t")) i--
    const end = i + 1
    while (i >= 0 && text[i] >= "0" && text[i] <= "9") i--
    const digits = text.slice(i + 1, end).trim()
    if (digits.length > 0) admitted = Number(digits)
  }

  // Deduplicated in first-seen order: one file can be named twice in a single run (once as
  // BB-PARSE-ERR, once as the BB-HANG that follows it), and a population that counts the same
  // file twice is the exact defect this instrument exists to catch.
  const seen = new Set<string>()
  const flagged: string[] = []
  for (const line of text.split("\n")) {
    let p = ""
    if (line.startsWith("[BB-PARSE-ERR]")) {
      const parts = line.split("|")
      if (parts.length >= 2) p = parts[1].trim()
    } else if (line.indexOf("[BB-HANG]") >= 0) {
      const on = line.indexOf(" on ")
      const dash = line.indexOf(" — ")
      if (on >= 0 && dash > on) p = line.slice(on + 4, dash).trim()
    }
    if (p.length > 0 && !seen.has(p)) {
      seen.add(p)
      flagged.push(p)
    }
  }
  return { admitted, flagged, id }
}

const fromPath = arg("from", "")
const pop = fromPath ? readPopulation(fromPath) : null

// A `--from` that cannot be read is an error, not a silent fall-back to the literals: the whole
// point is that an unverifiable population must not certify a count.
if (fromPath && !pop) {
  console.error(`gate-flagged-files: cannot read --from ${fromPath}`)
  process.exit(2)
}
if (SUBJECTS === "derived" && !pop) {
  console.error(`gate-flagged-files: --subjects derived requires --from <log>`)
  process.exit(2)
}

const singleFile = arg("file", "")
// The gate prints corpus-absolute paths, so a flagged entry is used as it stands; only a
// corpus-relative one is joined onto CORPUS.
const flaggedAbs = (p: string) => (p.startsWith("/") ? p : `${CORPUS}/${p}`)
const files: string[] =
  SUBJECTS === "derived" && pop ? pop.flagged.map(flaggedAbs) : singleFile ? [singleFile] : DEFAULT_FILES

const relOf = (f: string) => (f.startsWith(`${CORPUS}/`) ? f.slice(CORPUS.length + 1) : f)

let uncovered = 0
let covered = 0
let extra = 0
if (pop) {
  // `covered` is counted from the FLAGGED side, so zero overlap reads as 0 rather than as the
  // file-count on the other side — the arithmetic that produced a nonsensical "4 of 1" here.
  covered = pop.flagged.filter(p => files.some(f => relOf(f) === relOf(flaggedAbs(p)))).length
  uncovered = pop.flagged.length - covered
  extra = SUBJECTS === "derived" ? 0 : files.filter(f => !pop.flagged.some(p => relOf(flaggedAbs(p)) === relOf(f))).length
  console.log(`population from ${pop.id}`)
  console.log(
    `  admitted by that run: ${pop.admitted > 0 ? pop.admitted : "NOT STATED IN LOG"}   flagged by that run: ${pop.flagged.length}`,
  )
  console.log(
    `  subjects under test: ${files.length}${SUBJECTS === "derived" ? " (derived from the log)" : " literals"}; ` +
      `${covered} of ${pop.flagged.length} flagged files covered` +
      (extra > 0 ? `, and ${extra} of the ${files.length} literals are NOT in that run's flagged set` : ""),
  )
  if (pop.flagged.length === 0) {
    console.log(`  the log names NO flagged file — a population of 0 cannot certify a count of 0 here`)
  }
  for (const p of pop.flagged) {
    if (!files.some(f => relOf(f) === relOf(flaggedAbs(p)))) console.log(`  NOT COVERED by this probe: ${p}`)
  }
  if (uncovered > 0) console.log(`  -> the literals are STALE for this run. Re-run with --subjects derived.`)
} else if (!singleFile) {
  console.log(`population UNVERIFIED — no --from log given, so the ${files.length} literals below are`)
  console.log(`  an UNCHECKED subset of whatever the instrument flagged. Not a whole-population claim.`)
}
console.log(``)

console.log(`gate-flagged-files: does the arbiter's file-level flag survive the file on its own?`)
console.log(`runs per file: ${RUNS}   engine hang guard: ${HANG_GUARD_MS / 1000}s\n`)

let anyDefect = 0
for (const f of files) {
  const rel = f.startsWith(`${CORPUS}/`) ? f.slice(CORPUS.length + 1) : f
  let size = 0
  try {
    size = statSync(f).size
  } catch {
    console.log(`${rel}\n  GONE FROM DISK — the gate named a file that is not there`)
    anyDefect++
    continue
  }
  const times: number[] = []
  let sym = 0
  let rel2 = 0
  let fallback = false
  let threw = ""
  for (let i = 0; i < RUNS; i++) {
    const t0 = Date.now()
    try {
      const r = (await parseFile(f, "zig")) as any
      times.push(Date.now() - t0)
      sym = r?.symbols?.length ?? 0
      rel2 = r?.relationships?.length ?? 0
      fallback = r?.fallback ?? false
    } catch (e: any) {
      times.push(-1)
      threw = String(e?.message ?? e).slice(0, 80)
    }
  }
  const good = times.filter(t => t >= 0)
  const slowest = good.length ? Math.max(...good) : -1
  const clean = good.length === RUNS && !threw && !fallback && sym > 0
  if (!clean) anyDefect++
  console.log(`${rel}`)
  console.log(`  ${size} bytes, ${good.length}/${RUNS} runs returned, ${times.join("ms, ")}ms`)
  console.log(`  symbols=${sym} relationships=${rel2} fallback=${fallback}${threw ? ` THREW: ${threw}` : ""}`)
  if (slowest > 0) {
    const ratio = HANG_GUARD_MS / slowest
    console.log(
      `  hang guard ${HANG_GUARD_MS / 1000}s vs this file's slowest own parse ${slowest}ms = ` +
        `${ratio >= 1000 ? `${(ratio / 1000).toFixed(1)}k` : ratio.toFixed(0)}x`,
    )
  }
  console.log(`  verdict: ${clean ? "NO DEFECT — parses cleanly and repeatably on its own" : "DEFECT REPRODUCED"}`)
  console.log()
}

const verdict = anyDefect === 0 ? "show any defect alone" : "DID show a defect alone"
if (pop) {
  console.log(
    `-> ${anyDefect} of ${files.length} tested flagged files ${verdict}` +
      (uncovered > 0
        ? `; that is ${files.length} of ${pop.flagged.length} flagged, NOT the whole flagged population.`
        : `, and those ${files.length} ARE the whole flagged population of that run.`),
  )
} else {
  console.log(
    `-> ${anyDefect} of ${files.length} tested files ${verdict}` +
      `; population UNVERIFIED (no --from log), so this is a statement about ${files.length} files, not about the corpus.`,
  )
}

process.exit(pop && uncovered > 0 ? 3 : 0)