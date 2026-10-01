// Does the Lua differential actually WORK, or does it merely agree?
//
// Every number this lane reports is an agreement between the analyzer and an
// oracle. An instrument that cannot fail produces the same artifact as one that
// cannot detect anything, and the two are indistinguishable from the output
// alone. This is the check that separates them: seed a defect into the analyzer —
// a real one, drawn from the classes this lane has actually hit — and require the
// differential to go RED on REAL CODE, then restore the source byte-for-byte.
//
// Source mutation is legitimate here and was not in the earlier gate-level
// harnesses: those ran in-process, where the engine's module cache meant every
// mutant re-measured the unmutated analyzer (4 planted, 0 caught). Each mutant
// here gets its OWN PROCESS via execFileSync, which is the only reason a
// source-level mutation can bite at all. That failure is why the gate-level
// suites corrupt the OUTPUT instead.
//
// The slice is `--sample N` of the real kong corpus, not a fixture: a gate that
// only ever sees a file it was written for has not been tested against the world.
import { readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"

const REPO = "$HOME/backbencher-brain"
const SRC = join(REPO, "src/ast/real-lua-analyzer.ts")
const ORACLE = join(REPO, "script/m60/lua-truth-oracle.ts")
const SAMPLE = process.argv.includes("--sample") ? Number(process.argv[process.argv.indexOf("--sample") + 1]) : 60
// --files <path> : run against a targeted list instead of the first N. The
// positional slice is alphabetical, so it contained no call-on-call and no
// literal-index call in 1,309 files' worth of trying, and the mutants for LUA-29
// and LUA-30 were untestable there. A harness pointed at a slice without the
// construct reports INCONCLUSIVE, which is honest, and a slice with the construct
// is what actually answers the question.
const FILES_ARG = process.argv.includes("--files") ? process.argv[process.argv.indexOf("--files") + 1] : undefined
const ENV = { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` }
const MUTANT_OUT = join("/tmp", `lua-mutant-oracle-${process.pid}.json`)

const original = readFileSync(SRC, "utf8")

interface Mutant {
  id: string
  what: string
  find: string
  replace: string
  /** Which signal must move for the mutant to count as caught. */
  signal: "analyzer-missing" | "unexplained" | "line" | "exports"
  /**
   * A source pattern that MUST occur in the corpus slice, or the mutant has no
   * trigger and its result is INCONCLUSIVE rather than SURVIVING.
   *
   * Without this the harness reported "survived" for mutants that could not
   * possibly fire: the first 25 kong files contain no call-on-call and no
   * literal-index call, so LUA-29 and LUA-30 were untestable there. Calling that
   * a survival is the harness grading itself on a test it never ran — the same
   * error as the no-op control, in the other direction.
   */
  trigger?: RegExp
}

// Every mutant is a defect this lane has REALLY committed and fixed. Re-introducing
// them is the honest test: a harness that can only catch invented bugs is not
// evidence about the bugs that happened.
const MUTANTS: Mutant[] = [
  {
    id: "M1",
    trigger: /\breturn\b|\blocal\s+function\b/,
    what: "LUA-01 again: a relationship's line is omitted entirely",
    find: "if (nameNode) relationship.line_number = nameNode.startPosition.row + 1",
    replace: "if (nameNode) relationship.line_number = undefined as any",
    signal: "line",
  },
  {
    id: "M2",
    trigger: /\breturn\b|\blocal\s+function\b/,
    what: "LUA-01 again: 0-based lines (off by one)",
    find: "if (nameNode) relationship.line_number = nameNode.startPosition.row + 1",
    replace: "if (nameNode) relationship.line_number = nameNode.startPosition.row",
    signal: "line",
  },
  // M3 (LUA-19, nested-function scoping) was REMOVED rather than kept. Two
  // successive versions of it were reported as survivors and in both cases the
  // MUTANT was wrong, not the instrument: `opts?.symbolRange` is passed only for
  // synthesized `contains` edges so the `??` fell straight back, and
  // `node.type === "function_declaration"` is not the pre-LUA-19 test either. A
  // mutant that cannot fail is the M0 problem in a different hat. The class is not
  // uncovered — verify-lua-member-identity plants exactly this regression as its
  // fifth mutant and catches it (6/6, verified) — so the corpus harness does not
  // need a second copy of a check that already exists and fires.
  {
    id: "M4",
    trigger: /^\s*return\s*\{/m,
    what: "LUA-09 again: the returned-table export branch is gone",
    find: 'if (target.type === "table_constructor") {',
    replace: "if (false) {",
    signal: "exports",
  },
  {
    id: "M5",
    trigger: /^\s*return\s/m,
    what: "LUA-20 again: an in-function return is published as a file export",
    find: "    if (frame.inFunction) return",
    replace: "    // mutant: guard removed",
    signal: "exports",
  },
  {
    id: "M6",
    trigger: /\)\s*\(\s*\)/,
    what: "LUA-29 again: a call on a call publishes the whole call as its target",
    find: 'if (functionNode.type === "function_call" || functionNode.type === "table_constructor" ||',
    replace: "if (false ||",
    signal: "unexplained",
  },
  {
    id: "M7",
    trigger: /\[\s*["'][^"']+["']\s*\]\s*\(/,
    what: "LUA-30 again: a literal string index publishes nothing",
    find: 'if (field?.type !== "string") return undefined',
    replace: 'if (field?.type !== "string") return undefined; return undefined',
    signal: "analyzer-missing",
  },
  {
    id: "M8",
    trigger: /^\s*local\s+function/m,
    what: "LUA-15 again: a member is filed as a member of nothing (the contains edge is dropped)",
    find: "if (owner && owner !== symbol.name) {",
    replace: "if (false) {",
    signal: "analyzer-missing",
  },
]

// ── pre-flight: EVERY anchor must exist before a single mutant runs ───────────
// The first version of this harness carried `line_number: line,` as M1's anchor.
// It has zero occurrences in the analyzer, the mutant was reported SKIPPED, and
// the run still ended with a confident-looking summary. A harness that skips
// silently is indistinguishable from one that passed, which is the same failure
// as a gate that cannot fail. Missing anchors are now fatal.
{
  const missing = MUTANTS.filter((m) => !original.includes(m.find))
  if (missing.length) {
    console.error("PRE-FLIGHT FAILED — these anchors do not exist in the analyzer, so the mutant would silently skip:")
    for (const m of missing) console.error(`  ${m.id}: ${JSON.stringify(m.find)}`)
    console.error("\nRefusing to run. A skipped mutant is reported like a caught one unless this is fatal.")
    process.exit(2)
  }
  const dupes = MUTANTS.filter((m, i) => MUTANTS.findIndex((o) => o.id === m.id) !== i)
  if (dupes.length) {
    console.error(`PRE-FLIGHT FAILED — duplicate mutant ids: ${dupes.map((d) => d.id).join(", ")}`)
    process.exit(2)
  }
}

// The oracle EXITS 1 when it finds analyzer-attributable missing edges — which is
// the detection working. The first version of this harness called a non-zero exit
// "the analyzer did not even run" and reported those mutants as ERRORS, i.e. it
// read its own success signal as a crash. Both stdout and the throw are handled so
// a detection and a genuine crash are distinguishable: a crash has no parseable
// MISSING line, a detection always does.
interface OracleRun {
  analyzerMissing: number
  unexplained: number
  lineAccuracy: number
  lineWrong: number
  exportMissed: number
  exportSpurious: number
  exportTruth: number
}

const runOracle = (): OracleRun => {
  let out = ""
  try {
    // --out into a temp file, ALWAYS. Without it every one of these ~10 narrowed
    // passes wrote to validation/m60/results/lua-truth-oracle-kong.json and the
    // last one — a 14-file slice from a MUTATED analyzer — became the committed
    // "corpus" evidence. A harness that mutates the thing it measures must never
    // write to the measured thing's canonical artifact.
    const argv = [ORACLE, "--repo", "kong", "--out", MUTANT_OUT]
    if (FILES_ARG) argv.push("--files", FILES_ARG)
    else argv.push("--sample", String(SAMPLE))
    out = execFileSync("bun", argv, {
      cwd: REPO, encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (e: any) {
    const so = e?.stdout ?? ""
    if (typeof so === "string" && so.includes("MISSING=")) out = so
    else {
      const msg = `${e?.message ?? e}\n${String(e?.stderr ?? "")}`.trim()
      // A mutant that does not COMPILE is a bad mutant, not a gap in the
      // instrument, and conflating the two is how a broken harness gets to report
      // a clean run. The first M3 replaced `nameNode` with `node`, which is not
      // in scope inside addRelationship — TypeScript refused it and the harness
      // correctly said the analyzer did not run. The lesson recorded is that the
      // MUTANT was wrong, and the distinction is now explicit in the output.
      throw new Error(/SyntaxError|ReferenceError|not defined|Unexpected/.test(msg) ? `MUTANT-DID-NOT-COMPILE: ${msg.slice(0, 160)}` : msg || "oracle produced no output")
    }
  }
  const m = out.match(/MISSING=\d+ \(analyzer=(\d+),[^)]*\) UNEXPLAINED=(\d+)/)
  const l = out.match(/lines: checked=\d+ exact=\d+ wrong=(\d+) accuracy=(\S+)/)
  // The DIRECT-path export comparison. Added after M4 and M5 — both export
  // mutants — survived a harness that was already watching three signals: the
  // oracle had begun to exit 1 on an export defect and the harness never read the
  // number that moved. A detector nobody reads is not a detector. This line was
  // also the second silent no-op replacement in this file, which is why every
  // edit to it is now made with the edit tool rather than a script.
  const x = out.match(/exports \(DIRECT path, (\d+) files\): truth=(\d+) hit=(\d+) missed=(\d+) spurious=(\d+)/)
  return {
    analyzerMissing: m ? Number(m[1]) : -1,
    unexplained: m ? Number(m[2]) : -1,
    lineWrong: l ? Number(l[1]) : -1,
    lineAccuracy: l ? Number(l[2]) : -1,
    exportTruth: x ? Number(x[2]) : -1,
    exportMissed: x ? Number(x[4]) : -1,
    exportSpurious: x ? Number(x[5]) : -1,
  }
}

// ---- baseline. Refuse to mutate anything unless the unmutated lane is clean on
// the signals the mutants are supposed to move; otherwise "caught" would be
// indistinguishable from "already broken".
// The exact file list the oracle will read, so trigger presence is checked against
// the same set and not against an approximation of it.
const sliceFiles: string[] = (() => {
  // The oracle lists files with `git -C <repoRoot> ls-files`, and repoRoot is the
  // PER-REPO clone directory, not the repositories/ parent — the parent is not a
  // git repository, which is what the first version of this helper discovered the
  // hard way.
  const REPOS = "$HOME/fixtures/repositories/kong"
  const out = execFileSync("bun", ["-e", `
    const { execFileSync } = require("node:child_process")
    const { readFileSync } = require("node:fs")
    const list = execFileSync("git", ["-C", "${REPOS}", "ls-files", "*.lua", "*.luau"], { encoding: "utf8", maxBuffer: 1<<28 })
    const all = list.split("\\n").filter(Boolean)
    const want = ${JSON.stringify(FILES_ARG ?? null)}
    const chosen = want ? readFileSync(want, "utf8").split("\\n").map(s=>s.trim()).filter(Boolean) : all.slice(0, ${SAMPLE})
    process.stdout.write(chosen.join("\\n"))
  `], { encoding: "utf8", env: ENV })
  return out.split("\n").filter(Boolean).map((f) => `${REPOS}/${f}`)
})()

const base = runOracle()
console.log(`baseline (unmutated, kong --sample ${SAMPLE}):`)
console.log(`  analyzer-attributable missing: ${base.analyzerMissing}`)
console.log(`  unexplained:                   ${base.unexplained}`)
console.log(`  line accuracy:                 ${base.lineAccuracy}  (wrong ${base.lineWrong})`)
console.log(`  direct-path exports missed:    ${base.exportMissed}  (spurious ${base.exportSpurious}, of ${base.exportTruth} truth)`)
if (base.lineAccuracy !== 1) {
  console.error("refusing to mutate: the baseline is not line-clean, so a line mutant proves nothing")
  process.exit(2)
}
console.log()

let survived = 0
let skipped = 0
let inconclusive = 0
const results: string[] = []
try {
  for (const m of MUTANTS) {
    if (!original.includes(m.find)) {
      skipped++
      results.push(`  ${m.id.padEnd(4)} SKIPPED  anchor not found — the analyzer moved on; fix the harness`)
      continue
    }
    if (m.trigger) {
      let fired = false
      for (const f of sliceFiles) {
        if (m.trigger.test(readFileSync(f, "utf8"))) { fired = true; break }
      }
      if (!fired) {
        inconclusive++
        results.push(`  ${m.id.padEnd(4)} INCONCLUSIVE  the slice contains no ${m.trigger} — the mutant has no trigger here, which is not the same as surviving`)
        continue
      }
    }
    writeFileSync(SRC, original.replace(m.find, m.replace))
    let r: ReturnType<typeof runOracle>
    try {
      r = runOracle()
    } catch (e: any) {
      writeFileSync(SRC, original)
      results.push(`  ${m.id.padEnd(4)} ERROR    the analyzer did not even run: ${String(e.stderr ?? e).slice(0, 120)}`)
      survived++
      continue
    }
    writeFileSync(SRC, original)

    let caught = false
    let how = ""
    if (m.signal === "line") {
      caught = r.lineAccuracy !== 1 || r.lineWrong > 0
      how = `line accuracy ${base.lineAccuracy} -> ${r.lineAccuracy} (wrong ${r.lineWrong})`
    } else if (m.signal === "analyzer-missing") {
      caught = r.analyzerMissing > base.analyzerMissing
      how = `analyzer-attributable ${base.analyzerMissing} -> ${r.analyzerMissing}`
    } else if (m.signal === "exports") {
      caught = r.exportMissed > base.exportMissed || r.exportSpurious > base.exportSpurious
      how = `direct-path exports missed ${base.exportMissed} -> ${r.exportMissed}, spurious ${base.exportSpurious} -> ${r.exportSpurious}`
    } else {
      caught = r.unexplained > base.unexplained
      how = `unexplained ${base.unexplained} -> ${r.unexplained}`
    }
    if (!caught) survived++
    results.push(`  ${m.id.padEnd(4)} ${caught ? "caught  " : "SURVIVED"}  ${how}   ${m.what}`)
  }
} finally {
  writeFileSync(SRC, original)
}

for (const line of results) console.log(line)

// ---- the harness must also prove IT can fail: a mutant that changes nothing
// observable has to be reported as surviving, not quietly counted as caught.
{
  // A no-op that is SYNTACTICALLY INERT. The first version appended a comment
  // INSIDE a method signature (`private callee( // no-op`), which is not a no-op —
  // it changes the parse, so the "mutant" moved the numbers and the harness
  // reported it CAUGHT, which is the harness congratulating itself for detecting
  // its own typo. A control that cannot be distinguished from a real mutant is not
  // a control.
  const noopAnchor = "  private callee(functionNode: Node): { name: string; nameNode: Node } | undefined {"
  if (!original.includes(noopAnchor)) {
    console.error("  M0    ERROR    the no-op anchor is gone; the harness cannot prove it can tell a no-op from a mutant")
    survived++
  } else {
  const noop: Mutant = { id: "M0", what: "a no-op: the harness must report this as SURVIVING", find: noopAnchor, replace: noopAnchor + "\n    // harness no-op", signal: "analyzer-missing" }
  writeFileSync(SRC, original.replace(noop.find, noop.replace))
  const r = runOracle()
  writeFileSync(SRC, original)
  const noopSurvived = r.analyzerMissing === base.analyzerMissing && r.unexplained === base.unexplained && r.lineAccuracy === 1 && r.exportMissed === base.exportMissed && r.exportSpurious === base.exportSpurious
  console.log()
  console.log(`  M0    ${noopSurvived ? "SURVIVED" : "caught"}    a no-op mutant ${noopSurvived ? "correctly reported as surviving — the harness does not call everything caught" : "WRONGLY REPORTED CAUGHT — the harness is broken"}`)
  if (!noopSurvived) survived++
  }
}

const restored = readFileSync(SRC, "utf8")
console.log()
console.log(`analyzer restored byte-for-byte: ${restored === original ? "YES" : "NO — INVESTIGATE"}`)
// The canonical corpus artifact is never this file's business.
console.log(`mutant runs wrote only to ${MUTANT_OUT}; validation/m60/results/lua-truth-oracle-kong.json untouched`)
console.log(`${MUTANTS.length - skipped - inconclusive} run, ${inconclusive} inconclusive (no trigger in the slice), ${skipped} skipped, ${survived} survived`)
console.log(`A survivor is a real gap in the instrument. An INCONCLUSIVE is a gap in the SLICE — widen it with --sample or --files.`)
process.exit(survived === 0 && restored === original ? 0 : 1)
