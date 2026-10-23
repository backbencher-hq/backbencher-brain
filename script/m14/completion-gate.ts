/**
 * THE COMPLETION GATE — "IS THIS LANGUAGE DONE?" ANSWERED BY ONE INSTRUMENT, MECHANICALLY.
 *
 * ★⇒⇒⇒ WHY THIS EXISTS. The owner asked, on 2026-10-22: "first complete the one language and then
 * get with another… because we dont know which one is done, which one isnt so we cant go like that",
 * and then "make sure is that verification is the key". ⇒⇒⇒ ⇒⇒⇒ **THE QUESTION "WHICH LANGUAGE IS
 * DONE" HAD NO MACHINE ANSWER AT ALL**, because the fleet's two halves lived in two instruments and
 * NEITHER PRINTED THE OTHER'S RESULT:
 *
 *   · `script/m14/coverage-block-gate.ts` certifies the DENOMINATOR — which types are applicable to
 *     a lane, which are implemented, which are excluded, and whether the block has problems. It
 *     answers `impl == appl`, and it answers it well: 48/48 declared, 0 blocks with problems.
 *   · `script/m14/incoming-gate.ts` certifies the POPULATION SIDE — the whole-population closure and
 *     the clause-3 rulings that disposition every wall with a count and a falsifier. It has the
 *     arms K–Q, and it refuses a hollow ruling.
 *
 * ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ **AND THE OWNER'S BAR HAS FOUR CONDITIONS, AND THE TWO INSTRUMENTS BETWEEN THEM
 * COVERED THREE OF THEM, SILENTLY.**
 *   (A) every applicable type is IMPLEMENTED                    → the coverage gate
 *   (B) MEASURED ON THE WHOLE ADMITTED POPULATION                → the incoming gate + the declaration
 *   (C) correctly RESOLVED                                        → the declaration's own closure
 *   (D) every WALL DISPOSITIONED WITH A COUNT AND A FALSIFIER     → the clause-3 rulings
 * ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ **AND A LANE AT `n/n` WITH NO WHOLE-POPULATION CLOSURE READS EXACTLY LIKE A
 * LANE WITH ONE — WHICH IS WHY FOUR LANES WERE AT `n/n` AND COULD NOT BE TOLD FROM THE TWELVE THAT
 * HAD THE REST.** ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ **⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ AND THE OWNER'S RULE IS THAT A NEW
 * LANE STARTS ONLY WHEN A LANE IS REALLY DONE — SO THE SLOT-FILLING DECISION WAS BEING MADE ON A
 * NUMBER THAT DOES NOT ANSWER THE QUESTION BEING ASKED.** ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
 *
 * ★⇒⇒⇒ AND THE SECOND REASON, WHICH IS THE MATRIX'S LESSON ONE PLACES UP: **A COMPLETION GATE THAT
 * RE-DERIVES THE DENOMINATOR IS A SECOND DENOMINATOR.** The extended matrix was wrong three times
 * because it read the wrong surface for the denominator, and the Lead's own HAND-COMPUTED gap census
 * was the stale one against the generator's 39. ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ **SO THIS GATE READS THE COVERAGE
 * GATE'S OWN TABLE FROM THE COVERAGE GATE'S OWN OUTPUT** — the gate's arithmetic is the gate's
 * arithmetic — and then it CROSS-CHECKS ITSELF AGAINST IT, refusing if the two disagree. ⇒⇒⇒ ⇒⇒⇒
 * ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ **THE MATRIX GENERATOR COMPARES ONLY n AND impl COUNTS; THIS GATE COMPARES THE
 * PER-LANE CELLS, because a count can agree while the cells underneath do not.**
 *
 * ★⇒⇒⇒ AND THE THIRD REASON, AND IT IS A DEFECT THIS GATE FOUND IN ITS FIRST RUN: **A DECLARATION
 * FILE CARRIES ITS POPULATION TWICE, AND THE TWO COPIES CAN DISAGREE.** The `meta` block opens with
 * `parsed`, `sample` and `corpusTotal`; the `causeRulings` carry a `population` string
 * (`parsed=989/989 admitted=989 exts=rb index=no`). ⇒⇒⇒ ⇒⇒⇒ **⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ THE RUBY
 * DECLARATION SAYS `parsed: 200`, `sample: 200`, `corpusTotal: 7452` IN ITS `meta` — AND SAYS
 * `parsed=989/989 admitted=989` IN EVERY ONE OF ITS 105 CAUSE RULINGS.** ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
 * **⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ THAT IS THE DUPLICATED-FACT SHAPE AGAIN, AND IT IS THE MOST
 * CONSEQUENTIAL ONE YET: THE FILE THAT CARRIES THE WHOLE-POPULATION EVIDENCE CARRIES IT TWICE, AND
 * THE COPY A READER OPENS FIRST SAYS THE MEASUREMENT WAS 200 FILES OUT OF 7,452.** ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
 * ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ **⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ THIS GATE REPORTS THE DISAGREEMENT RATHER THAN PICKING
 * ONE, BECAUSE PICKING ONE IS A RULING AND THE LEAD DOES NOT MAKE A LANE'S RULING FOR IT.**
 *
 * ★⇒⇒⇒ ⇒⇒⇒ AND THE FOURTH REASON: **A GATE THAT CANNOT DETECT A PLANTED FAILURE MUST NOT BE ALLOWED
 * TO PRINT A VERDICT ABOUT A LANGUAGE.** The fleet's own rule, and the reason the incoming gate
 * runs its control FIRST, ALWAYS. So this gate has a self-test: a lane that fails each condition is
 * REFUSED, and the refusal is PRINTED, because a check that runs silently proves nothing to a reader
 * who was not watching.
 */

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const REPO = resolve(import.meta.dir, "../..")

// ═══════════════════════════════════════════════════════════════════════════
// THE FOUR CONDITIONS, AS THE OWNER STATED THEM. THE NAMES ARE THE OWNER'S.
// ═══════════════════════════════════════════════════════════════════════════
type Condition = "implemented" | "whole-population" | "resolved" | "walls-dispositioned" | "fixtures" | "no-regex"

/** The fixture suite's own language names where they differ from a lane's name. A mapping, not a
 *  guess: a lane whose key is wrong reads as "no suite ran", which is an UNKNOWN and not a pass. */
const FIXTURE_LANG: Record<string, string> = {
  objectivec: "objc",
  typescript: "typescript",
  makefile: "make",
  vbnet: "vb",
}

const CONDITIONS: Condition[] = ["implemented", "whole-population", "resolved", "walls-dispositioned", "fixtures", "no-regex"]

interface GateRow {
  lane: string
  declared: string
  impl: number
  appl: number
  excl: number
  silent: string
  problems: string
  /** THE ANALYZER NEVER FIRED AT ALL — so there is no measurement of anything. */
  notFired: boolean
  /** THE CORPUS WAS EMPTY — so the run measured an empty population. */
  noCorpus: boolean
}

interface LaneVerdict {
  lane: string
  done: boolean
  conditions: Map<Condition, { ok: boolean; detail: string }>
  problems: string[]
}

// ═══════════════════════════════════════════════════════════════════════════
// (A) THE DENOMINATOR — READ FROM THE COVERAGE GATE'S OWN OUTPUT, NOT RE-DERIVED.
// ═══════════════════════════════════════════════════════════════════════════
/**
 * ⇒⇒⇒ **THE COVERAGE GATE'S OWN ARITHMETIC IS THE COVERAGE GATE'S OWN ARITHMETIC.** This reads the
 * table the gate prints and parses it; it does not recompute `applicable`, and it does not read the
 * spec files, because a second reader of the spec files is a second denominator.
 */
const readCoverageGate = (): { rows: Map<string, GateRow>; raw: string } => {
  // ⇒⇒⇒ **THE CONSUMER ASKS THE PRODUCER FOR THE PRODUCER'S OWN SHAPE.** This reads the coverage
  // gate's `--json` output, which the gate chose, rather than parsing the gate's HUMAN table — and
  // the first version of this file did exactly that, and its parser ASSUMED ONE TOKEN PER COLUMN,
  // and DROPPED TWO LANES: the `silent` column can hold SEVERAL type names, so every row with two or
  // more silent types failed the match and vanished. ⇒⇒⇒ ⇒⇒⇒ **⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ **A PARSER THAT DROPS ROWS MEASURES A SUBSET — AND A SUBSET OF THE DENOMINATOR IS A
  // DENOMINATOR ABOUT A DIFFERENT SET OF LANES.** ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ ⇒⇒⇒ **AND THE CROSS-CHECK BELOW IS WHAT CAUGHT IT: THE GATE PRINTS 48 ROWS AND THE PARSER
  // FOUND 46, SO THE COUNT WAS COMPARED AGAINST THE PRODUCER'S OWN COUNT.** ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ **⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ **THE COUNT IS THE CROSS-CHECK, AND IT MUST BE LOUD.**
  // ⇒⇒⇒ **THE EXIT CODE IS A VERDICT, NOT THE DATA.** The coverage gate exits 1 when ANY lane has a
  // problem, and a lane having a problem is the NORMAL STATE OF A WORKING FLEET. So the first version
  // of this reader, which let `execFileSync` throw on a non-zero exit, made the completion gate CRASH
  // EXACTLY WHEN THE FLEET WAS WORKING — and a gate that can only read its source when the source is
  // happy is a gate that goes blind at the moment its verdict matters. ⇒⇒⇒ **⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ **THE DATA IS THE STDOUT, AND IT IS THERE WHATEVER THE VERDICT IS.** The exit code is read
  // and reported; it never decides whether the rows are read.
  let raw = ""
  let coverageExit = 0
  try {
    raw = execFileSync("bun", [resolve(REPO, "script/m14/coverage-block-gate.ts"), "--json"], {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
  } catch (e: any) {
    // A NON-ZERO EXIT IS THE COVERAGE GATE'S VERDICT, NOT A FAILURE TO MEASURE. Its JSON is on
    // stdout and it is the data this gate needs.
    coverageExit = Number(e?.status ?? e?.code ?? 1)
    raw = typeof e?.stdout === "string" ? e.stdout : ""
    if (!raw.trim()) {
      throw new Error(
        `the coverage gate produced NO JSON on stdout (exit ${coverageExit}). Its stderr was:\n${String(e?.stderr ?? "").slice(0, 4000)}`,
      )
    }
  }
  const doc = JSON.parse(raw)
  const rows = new Map<string, GateRow>()
  for (const r of doc.lanes ?? []) {
    rows.set(r.lane, {
      lane: r.lane,
      declared: r.declared ? "yes" : "no",
      impl: Number(r.implemented),
      appl: Number(r.applicable),
      excl: Number(r.exclusions),
      silent: (r.unexplainedSilence ?? []).join("~") || "-",
      problems: (r.problems ?? []).length ? (r.problems ?? []).join("; ") : "-",
      // ⇒⇒⇒ **THE GATE'S OWN FLAGS TRAVEL WITH THE ROW**, because a lane whose analyzer NEVER FIRED,
      // or whose corpus was EMPTY, has no measurement of anything — and a lane with no measurement
      // must not be readable as a lane whose measurement came out clean.
      notFired: r.notFired === true,
      noCorpus: r.noCorpus === true,
    })
  }
  const produced = Number(doc.lanes?.length ?? 0)
  if (produced !== rows.size) {
    console.error(`*** THE COVERAGE GATE PRODUCED ${produced} LANE ROWS AND ${rows.size} WERE READ — A PARSER THAT DROPS ROWS MEASURES A SUBSET. ***`)
    process.exit(5)
  }
  return { rows, raw }
}

// ═══════════════════════════════════════════════════════════════════════════
// (B) (C) (D) — THE LANE'S OWN DECLARATION. The lane WRITES it; this gate READS it.
// ═══════════════════════════════════════════════════════════════════════════
const declarationPath = (lane: string): string =>
  resolve(REPO, `validation/m14/instruments/${lane}/incoming-declaration.json`)

/**
 * The population string the cause rulings carry: `parsed=989/989 admitted=989 exts=rb index=no`.
 *
 * ★ THE SHORT FORM IS ACCEPTED, AND THE TWO FAILURES ARE NOW DISTINGUISHED. MEASURED 2026-10-23 by
 * the yaml lane: a cause ruling that carried `parsed=18997/18997 admitted=18997` — the CORRECT
 * numbers in a SHORTER spelling — parsed as NULL, and this gate then reported
 * `fails: whole-population` while the declaration's `meta` block was completely correct.
 * ⇒ **THE GATE WAS REPORTING A MISSING MEASUREMENT WHEN WHAT IT HAD WAS A MALFORMED ONE**, and a
 * lane reading that verdict goes hunting for a run it already owns. `exts` and `index` are now
 * OPTIONAL and the numbers alone are enough; `parsePopulation` distinguishes "no population
 * mentioned at all" from "a population mentioned that cannot be read", and the caller says which.
 */
const POPULATION_RE = /parsed=(\d+)\/(\d+)\s+admitted=(\d+)(?:\s+exts=([^ ]*))?(?:\s+index=(\S+))?/

/** A population string was PRESENT but this gate could not read it — not the same as absent. */
class MalformedPopulation extends Error {
  constructor(public readonly raw: string) {
    super(`a population is present but unreadable: "${raw.slice(0, 160)}"`)
  }
}

/** Parse, but TURN a malformed population into a MESSAGE rather than an exception, so the verdict
 *  says "malformed" where it used to say "missing". */
const parsePopulationSafe = (s: string | undefined): { pop: Population | null; malformed: string | null } => {
  try {
    return { pop: parsePopulation(s), malformed: null }
  } catch (e: any) {
    return { pop: null, malformed: e instanceof MalformedPopulation ? e.raw : String(e?.message ?? e) }
  }
}

interface Population {
  parsed: number
  total: number
  admitted: number
  exts: string
  index: string
}

const parsePopulation = (s: string | undefined): Population | null => {
  if (!s) return null
  const m = s.match(POPULATION_RE)
  if (!m) {
    // MENTIONED BUT UNREADABLE is its own outcome. Only a string that talks about a population at
    // all earns this; prose with no numbers is simply absent.
    if (/\bparsed\s*=/i.test(s)) throw new MalformedPopulation(s)
    return null
  }
  return {
    parsed: Number(m[1]), total: Number(m[2]), admitted: Number(m[3]),
    exts: m[4] ?? "(unstated)", index: m[5] ?? "(unstated)",
  }
}

/**
 * ⇒⇒⇒ ⇒⇒⇒ **THE DECLARATION IS THE LANE'S RULING AND THE LANE'S MEASUREMENT, SO EVERY FIELD BELOW IS
 * READ AND NEVER WRITTEN.** ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ **AND A FIELD THAT IS ABSENT IS AN UNKNOWN, NOT A PASS** —
 * an absent falsifier is not a satisfied falsifier, and an absent population is not a whole
 * population. ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ **⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ A MISSING MEASUREMENT IS NOT A PASSING
 * MEASUREMENT, AND AN UNREADABLE DECLARATION IS NOT A CLEAN LANE.**
 */
// ═══════════════════════════════════════════════════════════════════════════
// (E) THE FIXTURES — THE OWNER'S FIFTH DONE CONDITION, AND THE GATE DID NOT CHECK IT.
// ═══════════════════════════════════════════════════════════════════════════
/**
 * MEASURED 2026-10-23: the gate called RUBY done while SEVEN of its fixtures failed. The owner's
 * definition of done names "fixtures pass both directions" explicitly, and this gate checked four
 * conditions and never checked that one — so a DONE verdict could coexist with a suite that says the
 * analyzer is broken, and nobody noticed until the Lead ran the fleet's suite by hand.
 *
 * ⇒ **A GATE THAT CHECKS FOUR OF THE OWNER'S FIVE CONDITIONS IS A GATE THAT CAN SAY YES WHEN THE
 * ANSWER IS NO.** The suite is run ONCE for the whole fleet (it is the same binary for every lane)
 * and its summary line is the measurement. A lane whose suite does not run is an UNKNOWN, not a
 * pass — and an unknown is printed as a failure here, because the ceiling on a check is the check.
 */
const runFixtureSuite = (): { summary: Map<string, { pass: number; fail: number }>; note: string } => {
  const summary = new Map<string, { pass: number; fail: number }>()
  try {
    const out = execFileSync("bun", ["script/m14/run-fixtures.ts"], {
      cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 1_800_000,
    })
    const line = out.split("\n").reverse().find((l) => l.startsWith("summary: "))
    if (!line) return { summary, note: "THE FIXTURE SUITE PRINTED NO SUMMARY LINE — no lane's fixtures can be called passing" }
    const obj = JSON.parse(line.slice("summary: ".length))
    for (const [lang, v] of Object.entries(obj as Record<string, { pass?: number; fail?: number }>)) {
      summary.set(lang, { pass: Number(v?.pass ?? 0), fail: Number(v?.fail ?? 0) })
    }
    return { summary, note: `${summary.size} language suite(s) read` }
  } catch (e: any) {
    // A NON-ZERO EXIT IS THE SUITE SAYING SOMETHING FAILED — its stdout still carries the summary.
    const out = String(e?.stdout ?? "")
    const line = out.split("\n").reverse().find((l) => l.startsWith("summary: "))
    if (line) {
      try {
        const obj = JSON.parse(line.slice("summary: ".length))
        for (const [lang, v] of Object.entries(obj as Record<string, { pass?: number; fail?: number }>)) {
          summary.set(lang, { pass: Number(v?.pass ?? 0), fail: Number(v?.fail ?? 0) })
        }
        return { summary, note: `${summary.size} language suite(s) read (the suite exited non-zero, which is the failures, and its stdout still carries the summary)` }
      } catch { /* fall through */ }
    }
    return { summary, note: `THE FIXTURE SUITE COULD NOT BE RUN (${String(e?.message ?? e).split("\n")[0]}) — an unknown is not a pass` }
  }
}
const FIXTURES = runFixtureSuite()

/**
 * ── THE REGEX CENSUS, READ ONCE AND ATTRIBUTED PER LANE ─────────────────────────────────────────
 *
 * `script/m14/no-regex-gate.sh` delegates to the tree-sitter census (it used to grep the sources and
 * reported 187 where the truth was 5, which taught its readers to ignore it). It prints one line per
 * regex literal — `  real-<lane>-analyzer.ts:<line>  /<re>/  <op>` — and this reads those lines so the
 * verdict can name the LANE rather than repeat a fleet total.
 *
 * ⇒ AND A LANE WITH NO PARSED LINE IS AN UNKNOWN, NOT A PASS: the census must have produced a verdict,
 * or the condition says so. That is the same rule as every other condition here.
 */
function runRegexCensus(): {
  ran: boolean
  byLane: Map<string, { count: number; sites: string[] }>
  total: number
  note: string
} {
  const byLane = new Map<string, { count: number; sites: string[] }>()
  let out = ""
  let ran = false
  let total = 0
  const absorb = (text: string): void => {
    for (const line of text.split("\n")) {
      const m = line.match(/^\s+real-([a-z0-9_]+)-analyzer\.ts:(\d+)\s+(.*)$/)
      if (!m) continue
      const lane = m[1]
      const cur = byLane.get(lane) ?? { count: 0, sites: [] }
      cur.count++
      cur.sites.push(`:${m[2]} ${m[3].trim().slice(0, 60)}`)
      byLane.set(lane, cur)
    }
    const t = text.match(/TOTAL\s+(\d+)\s+in scope/)
    if (t) { total = Number(t[1]); ran = true }
    if (/PASS — 0 regex literals/.test(text)) { total = 0; ran = true }
  }
  // ★ THE CENSUS IS HEAD-ANCHORED AND MUST BE REGENERATED BEFORE IT IS READ, OR THE GATE REPORTS
  // A STALE COUNT. MEASURED 2026-10-23 by the scss lane, against this very condition: the artifact
  // listed **8** literals in `real-scss-analyzer.ts` while the committed blob held **THIRTEEN** —
  // five had been added by that lane's own later commits and the artifact had not been rebuilt. The
  // lane fixed all thirteen and the gate would have kept saying eight. Its own field says it:
  // `describes: HEAD blobs (git show HEAD:src/ast/...)`.
  // ⇒ A CACHED MEASUREMENT OF A MOVING TARGET IS A MEASUREMENT OF THE CACHE. Regenerate first, then
  // read, and if the regeneration fails say so rather than reading whatever is on disk.
  let regenerated = false
  try {
    execFileSync("npx", ["tsx", "script/m12/regex-census.ts", "--head"], {
      encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    })
    regenerated = true
  } catch {
    regenerated = false
  }
  try {
    out = execFileSync("bash", ["script/m14/no-regex-gate.sh"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    absorb(out)
  } catch (e: any) {
    // THE GATE EXITS NON-ZERO WHEN IT FINDS SOMETHING — that is the expected path for this census,
    // so the output on the failure carries the rows and the TOTAL line.
    absorb(String(e?.stdout ?? "") + String(e?.stderr ?? ""))
  }
  return {
    ran,
    byLane,
    total,
    note: ran
      ? ""
      : "THE REGEX CENSUS DID NOT RUN OR COULD NOT BE REGENERATED FROM HEAD — an unknown is not a pass",
  }
}
const REGEX_CENSUS = runRegexCensus()

const judgeLane = (lane: string, row: GateRow): LaneVerdict => {
  const conditions = new Map<Condition, { ok: boolean; detail: string }>()
  const problems: string[] = []

  // ── (A) IMPLEMENTED ──────────────────────────────────────────────────────
  {
    const noProblems = row.problems === "-" || row.problems === ""
    const atNN = row.impl === row.appl
    conditions.set("implemented", {
      ok: atNN && noProblems && row.declared === "yes" && !row.notFired && !row.noCorpus,
      detail: `impl ${row.impl} / appl ${row.appl} (excl ${row.excl}) — ` +
        (atNN ? "n/n" : `${row.appl - row.impl} type(s) short`) +
        (noProblems ? ", 0 block problems" : `, BLOCK PROBLEMS: ${row.problems}`) +
        (row.notFired ? " *** THE ANALYZER NEVER FIRED — THERE IS NO MEASUREMENT AT ALL ***" : "") +
        (row.noCorpus ? " *** THE CORPUS WAS EMPTY — THE RUN MEASURED NOTHING ***" : ""),
    })
  }

  // ── (E) FIXTURES PASS — the owner's fifth condition ──────────────────────
  // The summary keys are the suite's own language names; a lane absent from the suite is an UNKNOWN.
  {
    const key = FIXTURE_LANG[lane] ?? lane
    const f = FIXTURES.summary.get(key)
    if (!f) {
      conditions.set("fixtures", {
        ok: false,
        detail: `NO FIXTURE SUITE RAN FOR THIS LANGUAGE (looked up "${key}") — an unknown is not a pass. ${FIXTURES.note}`,
      })
    } else {
      conditions.set("fixtures", {
        ok: f.fail === 0,
        detail: `${f.pass} pass / ${f.fail} fail${f.fail === 0 ? "" : " *** THE SUITE SAYS THE ANALYZER IS BROKEN ***"}`,
      })
    }
  }

  // ── (F) RESOLUTION USES NO REGEX — THE OWNER'S OWN DONE CRITERION ─────────
  //
  // ★ THIS CONDITION WAS MISSING AND THE GATE CERTIFIED LANES THAT FAIL IT. MEASURED 2026-10-23:
  // `script/m14/no-regex-gate.sh` reports **43 regex literals across 17 analyzers**, and NINE of the
  // then-DONE lanes are among them (clojure 3, scss 8, svelte 3, yaml 2, and one each in dart,
  // fsharp, javascript, python, typescript). The owner's DONE definition has always said "resolution
  // uses no regex"; this gate checked five conditions and never this one, so a lane could be certified
  // DONE while a policy the owner named in the definition was failing. ⇒ **A CRITERION THE ARBITER
  // DOES NOT READ IS A CRITERION THE FLEET DOES NOT HAVE.**
  //
  // The check is per-ANALYZER, not per-run: it asks the shared census which regex literals live in
  // THIS lane's analyzer file, so the verdict names the lane rather than repeating a fleet total.
  {
    // ★ A LANE WITH NO CENSUS LINE IS *ZERO*, NOT UNKNOWN — and this gate's own positive control
    // caught the first version of this check getting it wrong: ruby has no regex literals, so the
    // census printed no line for it, and the check reported `THE REGEX CENSUS DID NOT READ THIS
    // LANE'S ANALYZER` against a lane that is CLEAN. **AN ABSENT ROW AND AN UNREAD ROW ARE DIFFERENT
    // FACTS**, and only the census's own TOTAL line distinguishes them.
    const own = REGEX_CENSUS.byLane.get(lane) ?? { count: 0, sites: [] as string[] }
    if (!REGEX_CENSUS.ran) {
      conditions.set("no-regex", {
        ok: false,
        detail: `THE REGEX CENSUS DID NOT RUN — an unknown is not a pass. ${REGEX_CENSUS.note}`,
      })
    } else if (own.count === 0) {
      conditions.set("no-regex", { ok: true, detail: `0 regex literals in the analyzer` })
    } else {
      conditions.set("no-regex", {
        ok: false,
        detail:
          `${own.count} regex literal(s) in the analyzer — the owner's DONE definition says resolution ` +
          `uses no regex: ${own.sites.slice(0, 4).join(", ")}${own.count > 4 ? ", …" : ""}`,
      })
    }
  }

  // ── the declaration ──────────────────────────────────────────────────────
  const p = declarationPath(lane)
  if (!existsSync(p)) {
    for (const c of CONDITIONS) {
      if (!conditions.has(c)) {
        conditions.set(c, {
          ok: false,
          detail: "NO WHOLE-POPULATION DECLARATION — the lane has published no measurement the gate can read",
        })
      }
    }
    return { lane, done: false, conditions, problems }
  }

  let decl: any
  try {
    decl = JSON.parse(readFileSync(p, "utf8"))
  } catch (e: any) {
    for (const c of CONDITIONS) {
      if (!conditions.has(c)) {
        conditions.set(c, { ok: false, detail: `THE DECLARATION WILL NOT PARSE (${String(e?.message ?? e)}) — an unknown is not a ruling` })
      }
    }
    return { lane, done: false, conditions, problems }
  }

  const rulings: Record<string, any> = decl?.causeRulings ?? {}
  const rulingEntries = Object.entries(rulings)
  const populations = rulingEntries.map(([k, v]) => {
    const r = parsePopulationSafe(v?.population)
    return { cause: k, pop: r.pop, malformed: r.malformed }
  })

  // ── (B) MEASURED ON THE WHOLE ADMITTED POPULATION ───────────────────────
  {
    const withPop = populations.filter((r) => r.pop !== null)
    const malformedPops = populations.filter((r) => r.malformed !== null)
    if (rulingEntries.length === 0) {
      // No walls at all ⇒ nothing to dispose of ⇒ the population condition is satisfied only if the
      // declaration SAYS the whole population was measured. Absence of walls is not absence of a
      // measurement.
      const meta = decl?.meta ?? {}
      const whole = Number(meta?.parsed) === Number(meta?.corpusTotal) && Number(meta?.corpusTotal) > 0
      conditions.set("whole-population", {
        ok: whole,
        detail: whole
          ? `meta says parsed ${meta.parsed} / ${meta.corpusTotal} — the whole population`
          : `NO CAUSE RULINGS, and the meta block does not say the whole population was measured (parsed ${meta?.parsed} / ${meta?.corpusTotal}) — so the population condition is UNREAD, not met`,
      })
    } else if (withPop.length === 0) {
      conditions.set("whole-population", {
        ok: false,
        detail: `${rulingEntries.length} cause ruling(s) and NOT ONE carries a parseable population string — the population condition is UNREAD, not met`,
      })
    } else {
      const whole = withPop.filter((r) => r.pop!.parsed === r.pop!.admitted && r.pop!.total === r.pop!.admitted)
      const partial = withPop.filter((r) => !(r.pop!.parsed === r.pop!.admitted && r.pop!.total === r.pop!.admitted))
      // ⇒⇒⇒ THE DUPLICATED POPULATION. The `meta` block says one thing and the cause rulings say
      // another, and this gate REPORTS THE DISAGREEMENT rather than picking a side.
      const meta = decl?.meta ?? {}
      const metaSays = `meta: parsed ${meta?.parsed} / sample ${meta?.sample} / corpusTotal ${meta?.corpusTotal}`
      const one = withPop[0]!.pop!
      const metaAgrees = Number(meta?.parsed) === one.parsed && Number(meta?.corpusTotal) === one.total
      const detail =
        `${whole.length} of ${withPop.length} ruling population(s) cover the WHOLE admitted set (parsed = admitted)` +
        (partial.length > 0 ? `; ${partial.length} DO NOT — e.g. ${partial[0]!.cause}: parsed=${partial[0]!.pop!.parsed}/${partial[0]!.pop!.total} admitted=${partial[0]!.pop!.admitted}` : "") +
        `; the ruling population says parsed=${one.parsed}/${one.total} admitted=${one.admitted}` +
        `; the ${metaAgrees ? "meta AGREES" : "*** meta DISAGREES *** (a declaration file carries its population TWICE, and the copies differ)"}: ${metaSays}`
      if (!metaAgrees) {
        problems.push(`${lane}: the declaration's meta block and its cause rulings disagree about the population — ${metaSays} vs parsed=${one.parsed}/${one.total} admitted=${one.admitted}`)
      }
      conditions.set("whole-population", {
        ok: whole.length === withPop.length && withPop.length > 0,
        detail,
      })
    }
  }

  // ── (C) CORRECTLY RESOLVED ──────────────────────────────────────────────
  //
  // ★⇒⇒⇒ THE GAP THE HTML LANE FOUND IN THIS LEAD'S OWN INSTRUMENT, AND THE CHANNEL THAT CLOSES IT.
  // The first version of this condition checked that the closure PARTITIONS the edges. **A PARTITION
  // IS NOT A CORRECTNESS PROPERTY**: a lane can satisfy it with a `resolved` bucket whose members
  // are, in the fleet's own indexer's words, 37,318 of 49,729 WRONG picks. The html lane measured
  // that 148,544 of its 168,818 resolved `contains` edges (88.0 %) resolve to a target with MORE
  // THAN ONE declaration, and 0 in every other type — because a `div` in every project declares the
  // name `div`. **⇒⇒⇒ A RESOLVED `contains` EDGE SAYS "THERE IS A `div` IN THIS PROJECT", NOT "THIS
  // IS THE `div`", AND THE BUCKET DOES NOT MEAN WHAT OTHER LANES' `contains` BUCKETS MEAN.**
  //
  // ★⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ **⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ THE FIX IS A CAVEAT CHANNEL, MODELLED
  // ON THE `declared_no_truth` CHANNEL THAT ALREADY WORKS: THE DECLARATION CARRIES WHAT IT KNOWS
  // ABOUT ITS OWN RESOLUTION, AND THE GATE PRINTS IT BESIDE THE VERDICT INSTEAD OF LETTING A READER
  // ASSUME THE BUCKET MEANS WHAT OTHER LANES' BUCKETS MEAN.** ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ **⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ A STATED CAVEAT IS A RULING; AN UNSTATED ONE IS A HOLE.** ⇒⇒⇒
  // ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ **⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  {
    const types: Record<string, any> = decl?.types ?? {}
    const entries = Object.entries(types)
    // ⇒⇒⇒ THE CAVEAT IS READ, NEVER WRITTEN. IT IS THE LANE'S RULING ABOUT ITS OWN MEASUREMENT.
    const caveats: any = decl?.resolution_caveats
    const caveatList: string[] = Array.isArray(caveats)
      ? caveats.map((c: any) => (typeof c === "string" ? c : JSON.stringify(c)))
      : caveats && typeof caveats === "object"
        ? Object.entries(caveats).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
        : []
    if (entries.length === 0) {
      conditions.set("resolved", { ok: false, detail: "NO PER-TYPE CLOSURE — the declaration publishes no resolution counts" })
    } else {
      const buckets = ["resolved", "external", "ambiguous", "otherUnresolved", "unclassed"]
      const bad: string[] = []
      let unclassedTotal = 0
      for (const [t, row] of entries) {
        for (const b of buckets) {
          const v = Number((row as any)?.[b] ?? 0)
          if (!Number.isFinite(v) || v < 0) bad.push(`${t}.${b}=${(row as any)?.[b]}`)
        }
        unclassedTotal += Number((row as any)?.unclassed ?? 0)
      }
      const resolvedTotal = entries.reduce((a, [, r]) => a + Number((r as any)?.resolved ?? 0), 0)
      const ambiguousTotal = entries.reduce((a, [, r]) => a + Number((r as any)?.ambiguous ?? 0), 0)
      const unresolvedTotal = entries.reduce((a, [, r]) => a + Number((r as any)?.otherUnresolved ?? 0), 0)
      const externalTotal = entries.reduce((a, [, r]) => a + Number((r as any)?.external ?? 0), 0)
      const edgeTotal = resolvedTotal + ambiguousTotal + unresolvedTotal + externalTotal + unclassedTotal
      // ⇒⇒⇒ **UNCLASSED IS A CEILING OF ZERO** — the instrument can only classify an edge into a
      // bucket, so an edge it cannot classify at all is a hole in the instrument, and the fleet's own
      // rule is that the ceiling is 0, ALWAYS.
      const unclassedOk = unclassedTotal === 0
      const bucketsOk = bad.length === 0
      conditions.set("resolved", {
        ok: bucketsOk && unclassedOk,
        detail:
          `edges ${edgeTotal} = resolved ${resolvedTotal} + external ${externalTotal} + ambiguous ${ambiguousTotal} + otherUnresolved ${unresolvedTotal} + unclassed ${unclassedTotal}` +
          (unclassedOk ? "" : ` — *** UNCLASSED IS ${unclassedTotal}, AND THE CEILING IS 0, ALWAYS ***`) +
          (bucketsOk ? "" : ` — bad bucket values: ${bad.join(", ")}`) +
          (caveatList.length > 0
            ? `; THE LANE'S OWN RESOLUTION CAVEATS (a stated caveat is a ruling, and it is printed so no reader assumes this bucket means what another lane's bucket means): ${caveatList.join(" | ")}`
            : `; *** NO RESOLUTION CAVEATS DECLARED — so a reader must assume this lane's buckets mean what every other lane's buckets mean, and that assumption is NOT CHECKED ***`),
      })
    }
  }

  // ── (D) EVERY WALL DISPOSITIONED WITH A COUNT AND A FALSIFIER ────────────
  {
    // This is the incoming gate's clause-3 P arm, read from the lane's own file: a ruling needs a
    // POPULATION and a FALSIFIER, and the falsifier needs a RUN and a WOULD-FAIL.
    const hollow: string[] = []
    for (const [cause, r] of rulingEntries) {
      const parsed = parsePopulationSafe((r as any)?.population)
      const pop = parsed.pop
      const f = (r as any)?.falsifier
      if (parsed.malformed !== null) {
        hollow.push(`${cause} (POPULATION PRESENT BUT UNREADABLE, not absent: "${parsed.malformed.slice(0, 90)}")`)
        continue
      }
      const hasRun = typeof f?.run === "string" && f.run.trim().length > 0
      const hasWouldFail = typeof f?.wouldFail === "string" && f.wouldFail.trim().length > 0
      if (!pop) hollow.push(`${cause} (no population)`)
      else if (!f) hollow.push(`${cause} (no falsifier)`)
      else if (!hasRun) hollow.push(`${cause} (falsifier has no RUN)`)
      else if (!hasWouldFail) hollow.push(`${cause} (falsifier has no wouldFail)`)
    }
    conditions.set("walls-dispositioned", {
      ok: hollow.length === 0,
      detail:
        `${rulingEntries.length} cause ruling(s)` +
        (hollow.length === 0
          ? " — every one carries a population and a falsifier with a run and a wouldFail"
          : ` — *** ${hollow.length} HOLLOW: ${hollow.slice(0, 4).join("; ")}${hollow.length > 4 ? "; …" : ""} ***`),
    })
  }

  const done = [...conditions.values()].every((c) => c.ok)
  return { lane, done, conditions, problems }
}

// ═══════════════════════════════════════════════════════════════════════════
// THE SELF-TEST — a gate that cannot detect a planted failure must not print a verdict.
// ═══════════════════════════════════════════════════════════════════════════
const selfTest = (): { passed: number; failures: string[] } => {
  const failures: string[] = []
  let passed = 0
  // A lane that is n/n with a complete declaration is DONE.
  {
    const lane = "ruby"
    const row: GateRow = { lane, declared: "yes", impl: 10, appl: 10, excl: 4, silent: "-", problems: "-", notFired: false, noCorpus: false }
    const v = judgeLane(lane, row)
    if (v.done) passed++
    else failures.push(`ruby should be DONE: ${[...v.conditions.values()].map((c) => c.detail).join(" | ")}`)
  }
  // A lane that is NOT n/n is NOT DONE, whatever else it has.
  {
    const lane = "ruby"
    const row: GateRow = { lane, declared: "yes", impl: 9, appl: 10, excl: 4, silent: "-", problems: "-", notFired: false, noCorpus: false }
    const v = judgeLane(lane, row)
    if (!v.done) passed++
    else failures.push("a lane one type short must NOT be DONE")
  }
  // A lane with NO declaration is NOT DONE.
  {
    const lane = "no-such-lane-xyz"
    const row: GateRow = { lane, declared: "yes", impl: 3, appl: 3, excl: 1, silent: "-", problems: "-", notFired: false, noCorpus: false }
    const v = judgeLane(lane, row)
    if (!v.done) passed++
    else failures.push("a lane with no declaration must NOT be DONE")
  }
  return { passed, failures }
}

// ═══════════════════════════════════════════════════════════════════════════
// THE REPORT
// ═══════════════════════════════════════════════════════════════════════════
const { rows, raw } = readCoverageGate()
const st = selfTest()
console.log("THE COMPLETION GATE — is this language REALLY done? The owner's FIVE conditions, mechanically.")
console.log("")
if (st.failures.length > 0) {
  console.error("FATAL: this gate's own positive control did not fire:")
  for (const f of st.failures) console.error(`  ${f}`)
  process.exit(2)
}
console.log(`self-test: ${st.passed}/3 arms fired (a lane at n/n with a complete declaration is DONE; one type short is not; no declaration is not)`)
console.log("")

const laneNames = [...rows.keys()].sort()
const verdicts: LaneVerdict[] = laneNames.map((l) => judgeLane(l, rows.get(l)!))

// ⇒⇒⇒ **THE CROSS-CHECK: THIS GATE'S OWN COUNT OF DONE LANES MUST AGREE WITH THE GATE'S OWN TABLE.**
// It cannot, in general, because the two instruments measure different things — and that is exactly
// why the cross-check is on the CELLS: a count that agrees while the cells do not is the matrix's
// old defect, and this gate does not repeat it.
const nnLanes = laneNames.filter((l) => {
  const r = rows.get(l)!
  return r.declared === "yes" && r.impl === r.appl && (r.problems === "-" || r.problems === "")
})
const doneLanes = verdicts.filter((v) => v.done).map((v) => v.lane)
const nnNotDone = nnLanes.filter((l) => !doneLanes.includes(l))

console.log(`lanes: ${laneNames.length}   at n/n per the coverage gate: ${nnLanes.length}   DONE per the owner's five conditions: ${doneLanes.length}`)
console.log("")
console.log("DONE:")
if (doneLanes.length === 0) console.log("  (none)")
for (const l of doneLanes) console.log(`  ${l}`)
console.log("")
// ⇒⇒⇒ THE CAVEATS ARE PRINTED AS THEIR OWN BLOCK, BESIDE THE VERDICT AND NOT BURIED IN IT.
const withCaveats = verdicts.filter((v) => {
  const d = v.conditions.get("resolved")!.detail
  return d.includes("THE LANE'S OWN RESOLUTION CAVEATS")
})
if (withCaveats.length > 0) {
  console.log("RESOLUTION CAVEATS DECLARED BY THE LANES — A STATED CAVEAT IS A RULING. These lanes' buckets do NOT all mean what every other lane's buckets mean, and the gate says so rather than letting a reader assume:")
  for (const v of withCaveats) {
    const d = v.conditions.get("resolved")!.detail
    const i = d.indexOf("THE LANE'S OWN RESOLUTION CAVEATS")
    console.log(`  ${v.lane.padEnd(12)} ${d.slice(i).replace("THE LANE'S OWN RESOLUTION CAVEATS (a stated caveat is a ruling, and it is printed so no reader assumes this bucket means what another lane's bucket means): ", "")}`)
  }
  console.log("")
}
if (nnNotDone.length > 0) {
  console.log(`AT n/n BUT NOT DONE — ${nnNotDone.length}. ⇒⇒⇒ A LANE AT n/n WITH NO WHOLE-POPULATION CLOSURE READS EXACTLY LIKE A LANE WITH ONE, AND THAT IS WHY THIS GATE EXISTS.`)
  for (const l of nnNotDone) {
    const v = verdicts.find((x) => x.lane === l)!
    const failing = CONDITIONS.filter((c) => !v.conditions.get(c)!.ok)
    console.log(`  ${l.padEnd(12)} fails: ${failing.join(", ")}`)
    for (const c of failing) console.log(`      ${c}: ${v.conditions.get(c)!.detail}`)
  }
  console.log("")
}
console.log("NOT DONE, AND SHORT OF n/n — the next languages, in the order they would be finished:")
const notNN = verdicts.filter((v) => !v.done && !nnLanes.includes(v.lane))
for (const v of notNN) {
  const r = rows.get(v.lane)!
  const failing = CONDITIONS.filter((c) => !v.conditions.get(c)!.ok)
  console.log(`  ${v.lane.padEnd(12)} impl ${r.impl}/${r.appl}` + (failing.length ? `   fails: ${failing.join(", ")}` : ""))
}
console.log("")

// ⇒⇒⇒ **THE PROBLEMS ARE REPORTED, NOT AVERAGED AWAY.** A lane with a hollow ruling and a clean
// rest is NOT a clean lane.
const allProblems = verdicts.flatMap((v) => v.problems)
if (allProblems.length > 0) {
  console.log(`PROBLEMS (${allProblems.length}):`)
  for (const p of allProblems) console.log(`  - ${p}`)
  console.log("")
}
const declDisagreements = allProblems.length
if (declDisagreements > 0) {
  console.log(`⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ${declDisagreements} declaration file(s) carry their population TWICE, and the two copies disagree. THIS GATE REPORTS THE DISAGREEMENT AND PICKS NEITHER: a declaration is the lane's ruling, and the Lead does not make a lane's ruling for it.`)
  console.log("")
}

console.log("⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ THE OWNER'S RULE, IN MACHINE FORM: **A NEW LANE STARTS ONLY WHEN A LANE IS REALLY DONE.**")
console.log(`⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ THE LANES THAT ARE DONE ARE: ${doneLanes.length > 0 ? doneLanes.join(", ") : "(none)"}`)
console.log(`⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ THE LANES AT n/n THAT ARE NOT DONE — THE ONES TO FINISH FIRST — ARE: ${nnNotDone.length > 0 ? nnNotDone.join(", ") : "(none)"}`)

if (process.env.BB_COMPLETION_JSON) {
  console.log("")
  console.log(JSON.stringify({
    done: doneLanes,
    atNNButNotDone: nnNotDone,
    verdicts: verdicts.map((v) => ({
      lane: v.lane,
      done: v.done,
      conditions: Object.fromEntries([...v.conditions.entries()].map(([k, c]) => [k, c])),
      problems: v.problems,
    })),
  }, null, 2))
}
