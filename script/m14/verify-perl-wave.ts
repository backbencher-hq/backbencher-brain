#!/usr/bin/env bun
// M14.6 perl wave — the lane record's PRODUCER, now a gate in the tree.
//
// WHY THIS FILE EXISTS (2026-10-08, M49 evidence-identity + evidence-lineage).
//
// `validation/m14/results/M14.6.perl.json` is the perl lane's evidence record, and
// it had no producer that two other gates could see:
//
//   * M49 verify-evidence-identity discovers a producer by an `emitEvidence(`
//     anchor inside a `.ts` file under `script/` — and skips any directory named
//     `tmp`. The perl lane's instruments live in `script/m14/tmp/` (they are
//     TRACKED files, but the directory name is the one the gate skips), and the
//     generator that wrote the committed record was a bash script there, so the
//     artifact was an ORPHAN in the gate's own terms: a file in the results
//     directory that no gate can be shown to produce.
//   * M49 verify-evidence-lineage requires `regeneratedAt`/`regeneratedAtCommit` on
//     every artifact, and the committed record carried neither, so the lane also
//     held the last two lineage failures in the results directory.
//
// This producer is the fix, and it is deliberately a RE-MEASUREMENT, not a copy:
// every row below is produced by running the gate that owns it, exactly as
// `script/m14/tmp/perl-evidence.sh` did, and the numbers cannot go stale without the
// instrument that produced them failing first. What it does NOT carry is the
// seven-corpus `censusTotals` block the wave's record had: those figures came from
// `perl-census.mts`/`perl-lineless.mts` (both still named in `reproduce`), and copying
// a number from an older run into a fresh artifact is the transcription this project
// forbids — the limitation below says so instead of quietly keeping the figure.
//
// The claim set mirrors the committed record's checks one for one (its ids are kept,
// so a reader comparing the two artifacts sees the same rows), with TWO exceptions,
// and both are 2026-10-12 corrections rather than a change of standard:
//
//   * `no-canonical-f5-row` / `no-canonical-perf-row` asserted that #419 sections E
//     and F could NOT close — true while merge 16075a5a1 had the perl oracle out of
//     the tree, and false now that it is restored and the two rows are pinned at 0/0.
//     They are replaced by `canonical-f5-row-present` / `canonical-perf-row-present`,
//     which assert the rows are there and clean, plus `floor-draw-is-canonical`, which
//     keeps the pin comparable to the sweep it is the floor for.
//   * the PERLD12 limitation said the lane emits no `uses`/`references` edge. Its
//     analyzer does now (PERL-MR15), so the artifact declares those two labels as an
//     OPEN GAP in this lane's F5 coverage instead of denying they exist.
//
// Usage: bun script/m14/verify-perl-wave.ts            (writes the artifact)
//        bun script/m14/verify-perl-wave.ts --dry-run  (prints rows, writes nothing)
// Env:   BB_PERL_OUT — where the receiver instrument writes its JSON (default /tmp)
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { emitEvidence, type Check, type EvidenceInput } from "./evidence-harness"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const DRY = process.argv.includes("--dry-run")
const BUN = process.env.BB_BUN ?? "bun"
const TSC_BIN = path.join(ROOT, "node_modules", "typescript", "bin", "tsc")
const DIFFERENTIAL_BASELINE = path.join(ROOT, "validation/m14/differential-baseline.json")
/** The sweep's draw size. `differential.ts` defaults to 60 with no `--sample`. */
const CANONICAL_DRAW = 60
const FIXTURE_DIR = path.join(ROOT, "validation/m14/fixtures/perl")

interface Ran { out: string; status: number | null }
function run(cmd: string, args: string[], env: Record<string, string> = {}): Ran {
  const p = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    env: {
      ...process.env,
      // The lane's instruments are bun programs; the wave's bash put bun first on
      // PATH and this does the same thing explicitly rather than trusting the caller.
      PATH: `${path.join(process.env.HOME ?? "", ".bun", "bin")}:${process.env.PATH ?? ""}`,
      ...env,
    },
  })
  return { out: `${p.stdout ?? ""}${p.stderr ?? ""}`, status: p.status }
}
const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length

function main(): number {
  const checks: Check[] = []
  const add = (id: string, description: string, ok: boolean, detail: string) =>
    checks.push({ id, description, status: ok ? "pass" : "fail", detail })

  // ---- typecheck, scoped to perl on purpose ------------------------------------
  // A co-agent's mid-edit analyzer must not turn this row red, and a row that
  // cannot tell whose error it is flaps every time anyone works.
  const tsc = run(process.execPath, [TSC_BIN, "--noEmit", "-p", "tsconfig.json", "--pretty", "false"])
  const perlDiagnostics = count(tsc.out, /error TS\d+.*real-perl/g)
  const totalDiagnostics = count(tsc.out, /error TS\d+/g)
  add("typecheck", "tsc --noEmit reports no diagnostic in the perl analyzer", perlDiagnostics === 0,
    `perl diagnostics: ${perlDiagnostics}; project-wide (other lanes' WIP, not perl's): ${totalDiagnostics}`)

  // ---- M12 pinned ground truth -------------------------------------------------
  const truth = run(BUN, ["script/m14/tmp/perl-truth.mts"])
  let truthPass = -1, truthFail = -1, truthLines = -1
  try {
    const t = JSON.parse(truth.out) as { pass: number; fail: number; lineMismatches: unknown[] }
    truthPass = t.pass; truthFail = t.fail; truthLines = t.lineMismatches.length
  } catch { /* refused below, as a failure rather than an exception */ }
  add("m12-pinned-truth", "M12's 32 pinned perl facts still hold, with zero line mismatches",
    truthPass === 32 && truthFail === 0 && truthLines === 0,
    truthPass < 0 ? "the truth instrument did not print JSON — see `bun script/m14/tmp/perl-truth.mts`"
      : `${truthPass}/32 pass, ${truthFail} fail, ${truthLines} line mismatches`)

  // ---- fixtures, counted from the directory rather than from a constant ---------
  const expectedFixtures = fs.existsSync(FIXTURE_DIR)
    ? fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".expectation.json")).length : 0
  const fixtures = run(BUN, ["script/m14/run-fixtures.ts", "--lang", "perl"])
  const fxPass = count(fixtures.out, /^PASS {2}perl\//gm)
  const fxFail = count(fixtures.out, /^FAIL {2}perl\//gm)
  add("fixtures", `all ${expectedFixtures} perl fixtures pass`, fxFail === 0 && fxPass === expectedFixtures,
    `${fxPass} pass, ${fxFail} fail (${expectedFixtures} expectation file(s) on disk)`)

  // ---- mutation, ditto: the population is read from the registry ---------------
  const mutantRegistry = fs.readFileSync(path.join(ROOT, "script/m14/mutate-analyzer.ts"), "utf8")
  const expectedMutants = count(mutantRegistry, /id: "perl\//g)
  const mutants = run(BUN, ["script/m14/mutate-analyzer.ts"], { BB_MUTANT_ONLY: "perl/" })
  const muCaught = count(mutants.out, /^CAUGHT {2}perl\//gm)
  const muSurvived = count(mutants.out, /^SURVIVED {2}perl\//gm)
  add("mutation", "every perl mutant is caught, so the lane can fail",
    muSurvived === 0 && muCaught === expectedMutants,
    `${muCaught} caught, ${muSurvived} survived (${expectedMutants} perl mutant(s) registered)`)

  // ---- the zero-regex contract, by AST scan ------------------------------------
  const zerorex = run(BUN, ["script/m14/tmp/perl-zero-regex.mts"])
  const zrRows = [...zerorex.out.matchAll(/^(PASS|FAIL) +(\S+) +(.*)$/gm)]
  if (zrRows.length === 0) add("zero-regex", "the zero-regex instrument printed its checks", false,
    "no PASS/FAIL row came back from script/m14/tmp/perl-zero-regex.mts")
  for (const [, status, name, detail] of zrRows)
    add(`zero-regex-${name}`, `zero-regex contract: ${name}`, status === "PASS", detail.trim())

  // ---- the committed tree, not just this worktree ------------------------------
  // The head gate checks HEAD out into a throwaway worktree and runs the lane's own
  // gates there; it has caught silent reverts that every in-place gate called green.
  const headGate = run("bash", ["script/m14/tmp/perl-head-gate.sh"])
  add("head-gate", "the COMMITTED tree passes the lane's own gates, not just this worktree",
    headGate.status === 0,
    headGate.status === 0
      ? `${count(headGate.out, /^ {2}pass /gm)} checks pass against a clean checkout of HEAD`
      : "the committed tree is UNHEALTHY: " + headGate.out.split("\n").filter((l) => l.trim().startsWith("FAIL")).map((l) => l.trim()).join("; ").slice(0, 600))

  // ---- the differential, per pinned perl lane ----------------------------------
  const diff = run(BUN, ["script/m14/differential.ts", "--lang", "perl", "--sample", "100000"])
  const laneRows = new Map<string, Record<string, string | number>>()
  for (const m of diff.out.matchAll(/^\[(mojo|plack)\] perl: files=(\d+) tree-truth=(\d+) covered=(\d+) \(([\d.]+)%\) MISSING=(\d+) \| analyzer-edges=(\d+) unexplained=(\d+) \(([\d.]+)%\).*hash=(\w+)/gm)) {
    laneRows.set(m[1], {
      files: Number(m[2]), truth: Number(m[3]), covered: Number(m[4]), pct: m[5],
      missing: Number(m[6]), analyzerEdges: Number(m[7]), unexplained: Number(m[8]),
      unexplainedPct: m[9], hash: m[10],
    })
  }
  // A row appears exactly when it was MEASURED. When the differential reports no perl
  // lane at all it says so itself (`[lane] SKIP perl: no corpus repo mapped in LANG_REPOS`),
  // and the honest record is ONE red row quoting that refusal — not two red rows blaming
  // the corpora of a lane whose WIRING is the thing that is missing.
  if (laneRows.size === 0) {
    const refusal = diff.out.split("\n").map((l) => l.trim())
      .filter((l) => /^\[lane\] SKIP|no corpus repo mapped|corpus repo missing|^error:/.test(l)).slice(0, 2).join(" | ")
    add("differential-lanes", "the differential measured the perl lanes and reported a row for each",
      false,
      refusal || "the differential printed no perl lane row and no line this producer recognises as a refusal")
  }
  for (const lane of ["mojo", "plack"]) {
    const r = laneRows.get(lane)
    if (r === undefined) continue
    add(`differential-${lane}`, `${lane}: full-corpus-depth truth coverage, 0 missing, 0 unexplained`,
      r.pct === "100" && r.missing === 0 && r.unexplained === 0, JSON.stringify(r))
  }

  // ---- #419 sections E and F: the floor rows, PRESENT and CLEAN ------------------
  // These two rows are the INVERSE of the pair they replace, and the inversion is the point. For
  // three weeks the baseline carried no `mojo:perl` row at all, and the honest record was a red
  // row saying so ("#419 section E cannot close"): the lane's F5 oracle had been dropped by merge
  // 16075a5a1, so `--lang perl` was SKIPPED before it could derive a truth edge and no floor row
  // could exist. The oracle and the scoped `--pin-baseline` are restored
  // (script/m14/restore-perl-oracle.ts), both rows are pinned at 0 missing / 0 unexplained, and an
  // assertion that a row is ABSENT is now the thing that would fail.
  //
  // What these rows may NOT claim is that the canonical 30-language sweep has been run here. They
  // assert the rows a scoped pin wrote, they quote the draw those rows were measured at, and the
  // sweep's own artifact stays the milestone owner's run: a scoped pin writes the floor REGISTRY,
  // never the evidence artifact, which is the one thing differential.ts refuses to do.
  const baseline = JSON.parse(fs.readFileSync(DIFFERENTIAL_BASELINE, "utf8")) as {
    samplePerLang?: number
    counts?: Record<string, { missing?: number; unexplained?: number; perf?: { avgMsPerFile?: number } }>
  }
  const FLOOR_LANES = ["mojo:perl", "plack:perl"] as const
  const floorRows = FLOOR_LANES.map((k) => [k, baseline.counts?.[k]] as const)
  const floorDetail = floorRows.map(([k, r]) => r ? `${k}: missing=${r.missing} unexplained=${r.unexplained}` : `${k}: NO ROW`).join(", ")
  add("canonical-f5-row-present", "the floor registry carries a clean row for BOTH perl lanes, so #419 section E reads them",
    floorRows.every(([, r]) => r !== undefined && (r.missing ?? -1) === 0 && (r.unexplained ?? -1) === 0),
    `${floorDetail} (differential-baseline.json, pinned at samplePerLang=${baseline.samplePerLang ?? "?"})`)
  add("canonical-perf-row-present", "the floor registry records avgMsPerFile for both perl lanes, so #419 section F reads them",
    floorRows.every(([, r]) => (r?.perf?.avgMsPerFile ?? 0) > 0),
    floorRows.map(([k, r]) => `${k}: ${r?.perf?.avgMsPerFile ?? "absent"} ms/file`).join(", "))
  // The floors are only comparable to the canonical sweep while the FILE's draw size is the
  // canonical one, and this row exists because getting that wrong is silent and total: a scoped pin
  // run at `--sample 100000` writes `samplePerLang: 100000`, after which the next 60-file sweep
  // reads "baseline sampled 100000/lang, this run 60/lang — probe mode, not comparable" and SKIPS
  // its whole regression gate — one lane's pin disabling every other lane's floor. Measured: the
  // first pin of these very rows did exactly that, and it was reverted.
  add("floor-draw-is-canonical", "the floor registry's draw size is the canonical one, so the sweep's regression gate still compares",
    baseline.samplePerLang === CANONICAL_DRAW,
    `differential-baseline.json samplePerLang=${baseline.samplePerLang ?? "absent"} (canonical draw is ${CANONICAL_DRAW}; a scoped pin at any other draw must not relabel the registry)`)

  // ---- #419's own sections, as the inventory reports them ----------------------
  // Reported per section rather than as one aggregate: the wave's record carried a
  // single `419-overall` row, and an aggregate hides WHICH section moved when one
  // does.
  const inventory = run(BUN, ["script/m14/completeness-inventory.ts", "--lang", "perl"])
  const sections: Record<string, { status: string; detail: string }> = {}
  for (const m of inventory.out.matchAll(/^\s+(pass|FAIL)\s+(section-[a-h]-[\w-]+)\s+(.*)$/gm)) {
    sections[m[2]] = { status: m[1].toLowerCase(), detail: m[3].trim() }
    add(`419-${m[2]}`, `#419 ${m[2]} for perl`, m[1] === "pass", m[3].trim())
  }
  if (Object.keys(sections).length === 0)
    add("419-sections", "the completeness inventory printed its section rows", false,
      "no section line came back from script/m14/completeness-inventory.ts --lang perl")

  // ---- the artifact -------------------------------------------------------------
  // `issueId` is supplied AT THE EMIT CALL, as a plain literal, and that is not a
  // style choice: M49 verify-evidence-identity discovers a producer by the exact shape
  // `issueId: "M14…"` inside the window after an `emitEvidence(` anchor, so an id
  // carried in a variable leaves the artifact an ORPHAN to that gate — measured here,
  // this file's first version emitted `{ ...artifact }` and the gate still reported
  // `M14.6.perl` as unclaimed.
  const failed = checks.filter((c) => c.status === "fail").map((c) => c.id)
  const base: Omit<EvidenceInput, "issueId"> = {
    title: "M14.6 perl wave — fixture, mutation, spec-completeness and forward-compatibility evidence",
    claimLevel: "L1" as const,
    layers: [
      "pinned grammar (wasm/tree-sitter-perl.wasm), one fresh module per run",
      "M12 pinned ground truth (validation/m12/ground-truth/perl.json), facts checked for presence AND line",
      "fixture pins (validation/m14/fixtures/perl), mutation registry (perl/ ids in mutate-analyzer.ts)",
      "#419 spec completeness sections, as the inventory itself reports them",
      "F5 differential over the two pinned perl lanes (mojo, plack)",
    ],
    checks,
    limitations: [
      "#419 sections E and F are GREEN from a scoped `--pin-baseline` at the canonical 60-file draw (the 2026-10-12 restore), not from the milestone owner's 30-language sweep: the FLOOR REGISTRY (`differential-baseline.json`) is what those sections read, and a scoped pin writes the registry while still writing NO evidence artifact. `floor-draw-is-canonical` is the row that keeps the pin comparable — at any other `--sample` it would relabel the file's `samplePerLang` and make the next canonical sweep skip its regression gate entirely. The milestone-sized claim is therefore still the sweep's to make; what this artifact establishes is that perl's rows are present, 0/0, and measured at the same draw the sweep compares against.",
      "PERL-MR15 (declared, NOT measured): HEAD's analyzer publishes `uses` (`\\&name` code references) and `references` (`->isa`/`->DOES`/`->can` literal queries) — rules that postdate the `bbb895867` commit from which the F5 oracle was recovered — and section B confirms both are emitted (13 pinned kinds, 8 emitted). `derivePerlEdges` derives NEITHER, and they are deliberately absent from the differential's compared-label allowlist: admitting a label with no truth would report every one of those edges as fabrication. So this lane's F5 covers calls/contains/extends/implements/instantiates/overrides and does NOT cover its two newest labels. Closing it means writing two independent oracles for those rules, not widening the allowlist.",
      "`overrides` is the lane's only GUESSED relationship: first-parent chain, confidence 0.5, no source line. A perl class may inherit from several bases and only the first is consulted (PERLD13).",
      "This producer re-measures the gate rows and deliberately does NOT re-derive the seven-corpus census totals the wave's record carried (files/symbols/relationships/imports/exports, symbol-free files, lined relations, unresolved targets). Those come from `script/m14/tmp/perl-census.mts` and `perl-lineless.mts`, which stay named in `reproduce`; a figure transcribed from an older run into a fresh artifact is the kind of number this project does not accept.",
      "`overrides` is the lane's only GUESSED relationship: first-parent chain, confidence 0.5, no source line. A perl class may inherit from several bases and only the first is consulted (PERLD13).",
      "Perl's dependency surface is the `imports` payload plus the Module Includes pattern, not a relationship `imports` edge (PERLD12). NOTE (2026-10-12): the pre-fix reading of this line said the lane emits no `uses` or `references` edge at all, which the analyzer stopped being true of in the PERL-MR15 wave — see the MR15 limitation above, which supersedes it.",
      "`use base` / `use parent` inheritance is read from one file, so an `extends` target can be external to it.",
      "The fixture and mutant populations are read from the tree (expectation files on disk, `perl/` ids in the mutation registry) rather than from a constant, so adding a fixture or a mutant moves this artifact's expectation too; a population that shrinks without the row going red is the failure mode that rule exists to prevent.",
    ],
    data: {
      differential: Object.fromEntries(laneRows),
      completenessSections: sections,
      baselineRows: Object.fromEntries(floorRows.map(([k, r]) => [k, r ?? null])),
      baselineDraw: baseline.samplePerLang ?? null,
      failedChecks: failed,
      reproduce: [
        "bun script/m14/verify-perl-wave.ts",
        "bun script/m14/run-fixtures.ts --lang perl",
        "BB_MUTANT_ONLY=perl/ bun script/m14/mutate-analyzer.ts",
        "bun script/m14/completeness-inventory.ts --lang perl",
        "bun script/m14/differential.ts --lang perl --sample 100000",
        "bun script/m14/differential.ts --lang perl --pin-baseline   # writes ONLY the two perl rows into the floor registry, at the canonical 60-file draw",
        "bun script/m14/tmp/perl-truth.mts",
        "bun script/m14/tmp/perl-zero-regex.mts",
        "bash script/m14/tmp/perl-head-gate.sh",
        "bun script/m14/tmp/perl-census.mts && bun script/m14/tmp/perl-lineless.mts   # the seven-corpus totals, not carried here",
      ],
    },
  }

  for (const c of checks) console.log(`  ${c.status === "pass" ? "PASS" : "FAIL"}  ${c.id}\n        ${c.detail}`)
  console.log(`\nM14.6 perl wave — ${checks.length - failed.length}/${checks.length} checks pass${failed.length ? `; red: ${failed.join(", ")}` : ""}`)
  if (DRY) { console.log("--dry-run: nothing written"); return failed.length === 0 ? 0 : 1 }

  const file = emitEvidence({ ...base, issueId: "M14.6.perl" })
  console.log(`\nwrote ${path.relative(ROOT, file)}`)
  return failed.length === 0 ? 0 : 1
}

const code = main()
process.exit(code)
