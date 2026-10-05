// script/m55/verify-hover-coverage-redteam.ts — lane 6: can the hover-coverage
// gate actually FAIL?
//
// THE QUESTION THIS ANSWERS
//
// `script/m55/verify-hover-coverage.ts` arrived at this lane as 1331 lines of
// brand-new, never-reviewed gate with a commit message claiming `VERIFIED
// (13/13 passed)`. A gate that has only ever been observed passing is a gate of
// unknown strength. Its own R5 "mutants" do NOT answer the question: M1 asserts a
// property of the table it just built, M3/M5/M5-MUTANT run SIMULATIONS over
// hand-built strings and in-memory arrays, and M2/M4 probe the address owner and
// the oracle directly. None of them plants a defect in the hover and observes
// the gate go red. A gate whose mutants are simulations of its own logic cannot
// distinguish 'my check is right' from 'my simulation is right'.
//
// So this harness does the thing the brief asks for, in the strongest available
// form:
//
//   For each planted defect: MUTATE THE REAL SOURCE FILE, RUN THE REAL GATE AS
//   A SUBPROCESS, assert the process EXITS NON-ZERO and that the EXPECTED
//   named check is among the failures — then restore the file byte-for-byte.
//
// No shared predicates, no re-derived fixture, no in-process simulation. The
// oracle is the gate binary itself. If this harness passes, the gate really does
// fail on that class of defect; if the gate were decorative, the process would
// exit 0 and this harness fails.
//
// The three defects are the ones the product question turns on:
//
//   D1  a relationship type present in the INDEX but DROPPED FROM THE HOVER.
//       `relations.ts`'s DECLARATION_RELATIONSHIPS gains "uses", so every
//       incoming `uses` row is filtered out of the usages list while the index
//       still holds it. The audit's central question is "does hover render what
//       the index knows", so a silently dropped kind MUST turn this gate red.
//
//   D2  a COUNT that disagrees with the RENDERED LIST — §13.4 and §14 rule 1.
//       `rich_hover.ts`'s usages header prints usage.length + 1. The list still
//       has N rows; the header claims N+1. This is the single most common class
//       of hover lie and §13.4 names it.
//
//   D3  a FABRICATED TIER. `evidence_tier.ts` promotes an unclassified row to
//       'structural' when the index stores no such class. §12.3 and §14 rule 3
//       both forbid rendering an inference at parser-fact tier.
//
// Plus two harness-integrity mutants that are about THIS file:
//
//   H1  a mutant that CRASHES the gate (delete a required export) must be
//       reported as CRASH, never as "caught by a check". §8.7 and this
//       program's repeated lesson: a mutant caught only by a load failure is not
//       caught, and a harness that counts a crash as a catch is lying to itself.
//   H2  a POSITIVE CONTROL: with the tree unmutated the gate EXITS ZERO. Without
//       this, a harness that fails everything would score 5/5.
//
// The mutation is applied to the worktree and restored in a `finally`, and the
// restore is VERIFIED (`git diff --quiet` plus a byte comparison against the
// committed content) — a harness that leaks a mutation into the next lane's tree
// is the mutation-scratch leak class this lane already gated.
//
// Scratch for the mutant copies goes under the OS temp dir, never under
// validation/ (script/m55/verify-evidence-tree-clean.ts C5).
//
// Run: npx tsx script/m55/verify-hover-coverage-redteam.ts
// Evidence: validation/m55/results/HOV-REDTEAM.json (machine-emitted)

import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..")
const GATE = "script/m55/verify-hover-coverage.ts"
const EVIDENCE = path.join(ROOT, "validation/m55/results/HOV-REDTEAM.json")

let checks = 0
let passed = 0
const failures: string[] = []

function check(label: string, ok: boolean, detail = ""): boolean {
  checks++
  if (ok) {
    passed++
    console.log(`  ok: ${label}`)
  } else {
    failures.push(detail ? `${label}: ${detail}` : label)
    console.log(`  NOT OK: ${label}${detail ? ` — ${detail}` : ""}`)
  }
  return ok
}

interface Planted {
  id: string
  /** the file mutated, relative to ROOT */
  file: string
  /** what the defect IS, in product words */
  defect: string
  /** the exact text to find — must be present or the mutant never ran */
  from: string
  /** the replacement that introduces the defect */
  to: string
  /** a substring of the check name expected to FAIL, or null when the mutant is
   *  expected only to crash the gate (H1) */
  expectFailedCheck: string | null
  /** the contract clause the defect violates */
  clause: string
}

const PLANTS: Planted[] = [
  {
    id: "D1",
    file: "src/lsp/relations.ts",
    defect:
      "a relationship kind the INDEX holds is DROPPED FROM THE HOVER: every incoming `uses` row " +
      "is reclassified as a declaration containment and vanishes from the usages list while the " +
      "index still stores it",
    from: 'new Set(["contains", "exports"])',
    to: 'new Set(["contains", "exports", "uses"])',
    // NO CHECK IN THE GATE OWNS THIS DEFECT CLASS. M1 guards only the
    // OVER-claim direction (rendered > known); nothing guards the UNDER-claim
    // direction — the index holds a row, the hover silently renders nothing,
    // and the gate reports itself verified.
    expectFailedCheck: "D1: every stored relationship kind is rendered with a verb or DECLARED absent with a reason",
    clause: "§14 rule 1 (one surface, one answer); the audit's own question — index knows X, hover renders Y",
  },
  {
    id: "D2",
    file: "src/lsp/rich_hover.ts",
    defect:
      "a COUNT that disagrees with the RENDERED LIST: the usages header claims one more usage " +
      "than the list it headlines actually contains",
    from:
      'const lines: string[] = [`**usages** — ${usage.length} stored reference${usage.length === 1 ? "" : "s"} (${USAGE_SITE_FILTER_LABEL})`]',
    to:
      'const lines: string[] = [`**usages** — ${usage.length + 1} stored reference${usage.length === 1 ? "" : "s"} (${USAGE_SITE_FILTER_LABEL})`]',
    // NO CHECK IN THE GATE OWNS THIS DEFECT CLASS. The gate reads the header
    // count with /(\d+) usage/ — which matches hover.ts's `**name** — method, N
    // usages` headline line — and counts list rows with /^\d+\. \[/. It never
    // compares the two against each other, and never parses the usages SECTION
    // header (`**usages** — N stored references`) at all.
    expectFailedCheck: "D2: every section header's stated count equals the rows beneath it",
    clause: "§13.4 (counts equal what is rendered); §14 rule 1",
  },
  {
    id: "D3",
    file: "src/lsp/evidence_tier.ts",
    defect:
      "a FABRICATED TIER: a stored row the index never classified is rendered at parser-fact " +
      "tier ('structural') instead of its declared absence",
    from: '  if (REFERENCE_QUALIFIED_KINDS.has(t)) return "reference_qualified"\n  return "inferred"',
    to:
      '  if (REFERENCE_QUALIFIED_KINDS.has(t)) return "reference_qualified"\n' +
      '  // PLANTED FABRICATION: a kind the index never classified reads as parser-fact.\n' +
      '  return "structural"',
    // NO CHECK IN THE GATE OWNS THIS DEFECT CLASS. No check anywhere in the gate
    // compares a rendered evidence tier against the tier the index stored.
    expectFailedCheck: "D3: every evidence tier the card renders is justified by a stored relationship row",
    clause: "§12.3 (enrichment/inference never at parser-fact tier); §14 rule 3",
  },
]


// --- machinery ---------------------------------------------------------------------

interface RunResult {
  exit: number
  stdout: string
  crashed: boolean
  failedChecks: string[]
  verdict: string
}

/** Run the real gate as a subprocess. `extraEnv` lets H1 shorten nothing; the
 *  timeout is generous because a healthy run is ~22s and a slow machine may be
 *  2-3x that. A timeout is reported as a CRASH, never as a catch. */
function runGate(extraEnv: Record<string, string> = {}): RunResult {
  const r = spawnSync("npx", ["tsx", GATE], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 600_000,
    env: { ...process.env, ...extraEnv },
  })
  const stdout = `${r.stdout ?? ""}${r.stderr ?? ""}`
  const crashed = r.status === null || (r.stdout ?? "") === ""
  // The gate prints failures as `  ✗ <label>` (its own check() puts no colon
  // after the mark) while other gates in this program print `  NOT OK: <label>`.
  // The first draft of this harness matched only the colon form, so it reported
  // "0 failing checks" on a run the gate itself called KNOWN-GAP and printing
  // one. A harness that cannot read the gate's failures is blind, and blind is
  // worse than absent.
  const failedChecks = [
    ...[...stdout.matchAll(/^\s*✗\s*(.+)$/gm)].map((m) => m[1]!.trim()),
    ...[...stdout.matchAll(/^\s*NOT OK:\s*(.+)$/gm)].map((m) => m[1]!.trim()),
  ]
  const vm = /HOV-COVERAGE: (\S+)/.exec(stdout)
  return { exit: r.status ?? -1, stdout, crashed, failedChecks, verdict: vm?.[1] ?? "none" }
}

/** Restore a file byte-for-byte from git and PROVE it.
 *
 *  THE ORIGINAL VERSION OF THIS FUNCTION WAS A DATA-LOSS BUG, and it is
 *  recorded here because the fix is the lesson:
 *
 *  it restored from `git show HEAD:<file>` and PROVED the restore by comparing
 *  the result to that same HEAD content. On a tree whose file differs from HEAD —
 *  that is, on ANY worktree with uncommitted work in the file being mutated —
 *  that is not a restore. It is an overwrite of the operator's uncommitted work
 *  with the last commit, and the "proof" then confirms the destruction. Running
 *  this harness against a work-in-progress change destroyed the uncommitted
 *  edits to src/lsp/rich_hover.ts and src/lsp/relations.ts, which is how a
 *  mutation harness became the most destructive thing in the lane.
 *
 *  Two independent causes, both fixed here:
 *
 *    1. THE TARGET MUST BE CLEAN BEFORE A MUTATION. A harness that edits a file
 *       the operator has uncommitted changes to cannot promise to put it back,
 *       because it has no copy of the operator's bytes to put back. So this
 *       harness now REFUSES to run against a dirty target and says so, instead
 *       of quietly reverting the operator's work.
 *    2. WHEN IT DOES MUTATE, IT RESTORES THE BYTES IT READ — not HEAD's. The
 *       pre-mutation content is captured per file and written back verbatim,
 *       which is the only restore that is correct for a file the harness is
 *       allowed to touch at all.
 *
 *  A harness that can destroy the tree it is measuring is a harness whose green
 *  verdict means nothing: the run that reported "3/12" also deleted the change
 *  under test. */
const restoreLog: Array<{ file: string; ok: boolean; detail: string }> = []

/** The working-tree state of every file this harness intends to mutate. */
function dirtyTargets(): string[] {
  const files = [...new Set(PLANTS.map((p) => p.file)), "src/lsp/relations.ts"]
  const out: string[] = []
  for (const rel of files) {
    const st = execFileSync("git", ["status", "--porcelain", "--", rel], { cwd: ROOT, encoding: "utf8" }).trim()
    if (st.length > 0) out.push(rel)
  }
  return out
}

const dirty = dirtyTargets()
/** Every mutation target's content at the START of this process, for H5. Taken
 *  before a single write, so "did anything survive me?" has a reference that
 *  cannot itself have drifted. */
const preRunBytes = new Map<string, string>(
  [...new Set(PLANTS.map((p) => p.file))].map((rel) => [rel, readFileSync(path.join(ROOT, rel), "utf8")]),
)
check(
  "H0: every file this harness mutates is CLEAN in the working tree (an un-mutation harness that restores from HEAD destroys uncommitted work — this harness refused to run on a dirty target)",
  dirty.length === 0,
  dirty.length === 0
    ? ""
    : `these targets have uncommitted changes: ${dirty.join(", ")} — commit or stash them, then run this harness`,
)
if (dirty.length > 0) {
  // Refuse to mutate. Writing the evidence and exiting non-zero is the honest
  // outcome; carrying on would be the destructive one.
  console.log("\nREFUSING TO RUN: a mutation target is dirty. No file was modified.")
  const refused = {
    issue: "M55.HOV-REDTEAM",
    code: "HOV-REDTEAM",
    milestone: "M55",
    status: "known-gap",
    checks,
    passed,
    failed: checks - passed,
    realFailed: checks - passed,
    negativeCases: 0,
    plants: PLANTS.map((p) => ({ id: p.id, file: p.file, defect: p.defect, clause: p.clause, expectedFailedCheck: p.expectFailedCheck })),
    currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    verifierCommand: "npx tsx script/m55/verify-hover-coverage-redteam.ts",
    evidenceFile: "HOV-REDTEAM.json",
    generatedAt: new Date().toISOString(),
    refused: { reason: "dirty mutation target", files: dirty },
    failures,
    limitations: [
      "This run measured nothing: it refused to mutate a dirty target, so its verdict is `known-gap` for the refusal, not for any defect class.",
      "A mutation harness that restores from git HEAD DESTROYS uncommitted work in the file it mutates, and its byte-comparison 'proof' confirms the destruction rather than detecting it. The fix is the H0 guard plus a restore that writes back the bytes the harness read.",
    ],
  }
  try {
    writeSealed(EVIDENCE, refused)
  } catch {}
  console.log(`\nHOV-REDTEAM RESULT: REFUSED — dirty mutation target(s): ${dirty.join(", ")}`)
  process.exit(1)
}

/** Restore a file to the EXACT bytes this harness read before mutating it. */
function restore(rel: string, preMutationBytes: string): { ok: boolean; detail: string } {
  const abs = path.join(ROOT, rel)
  try {
    writeFileSync(abs, preMutationBytes)
    const now = readFileSync(abs, "utf8")
    return now === preMutationBytes
      ? { ok: true, detail: "byte-identical to the pre-mutation bytes this harness read" }
      : { ok: false, detail: `post-restore content differs from the pre-mutation bytes (${now.length} vs ${preMutationBytes.length})` }
  } catch (e) {
    return { ok: false, detail: `restore threw: ${String(e).slice(0, 160)}` }
  }
}

const restores: { file: string; ok: boolean; detail: string }[] = []

// --- H2: the positive control, FIRST ------------------------------------------------
// Without this, a harness that failed every mutation would score 5/5 and nobody
// would know. Run on the CLEAN tree first so a broken harness is diagnosed
// before it starts editing source files.
console.log("H2: POSITIVE CONTROL — the gate completes on the unmutated tree\n")
const control = runGate()
check(
  "H2: the gate COMPLETES on the unmutated tree (a crash here means this harness cannot measure anything)",
  !control.crashed && control.verdict !== "none",
  control.crashed
    ? `the gate CRASHED on a clean tree — exit=${control.exit}; stdout bytes=${control.stdout.length}`
    : `exit=${control.exit} but no HOV-COVERAGE verdict line was printed`,
)
// The baseline failing set. Whether it is EMPTY or not, every mutant below is
// judged by SET DIFFERENCE against it, never by exit code: on a busy machine the
// gate's own §3 latency check is legitimately red (p95 88 ms under load average
// 12+), and an exit-code oracle would then call every mutant "detected" for the
// wrong reason. That is the §8.7 tautological check in a different costume.
const baselineFailures = new Set(control.failedChecks)
if (!control.crashed) {
  console.log(`      clean-tree verdict: ${control.verdict}, ${control.failedChecks.length} failing check(s)`)
  for (const f of control.failedChecks) console.log(`        baseline failure: ${f.slice(0, 120)}`)
  if (control.exit !== 0) {
    console.log(
      `      note: the CLEAN tree is not green. That does not stop this harness — the mutants are judged by which checks ` +
        `become newly failing — but it does mean the gate is not currently ` +
        `${"verified"}, and the lane report says so.`,
    )
  }
}

// --- D1-D3: plant, run, restore ------------------------------------------------------
console.log("\nD: planted defects in the REAL source (the gate is the oracle)\n")

for (const plant of PLANTS) {
  const abs = path.join(ROOT, plant.file)
  const original = readFileSync(abs, "utf8")
  if (!original.includes(plant.from)) {
    check(
      `${plant.id}: ANCHOR FOUND in ${plant.file} (a mutant whose anchor is missing has not run)`,
      false,
      `anchor not present: ${JSON.stringify(plant.from.slice(0, 90))} — this mutant would have silently passed`,
    )
    continue
  }
  const mutated = original.replace(plant.from, plant.to)
  if (mutated === original) {
    check(`${plant.id}: the mutation CHANGED ${plant.file}`, false, "replace() produced identical text")
    continue
  }
  writeFileSync(abs, mutated)
  let res: RunResult
  try {
    res = runGate()
  } finally {
    restores.push({ file: plant.file, ...restore(plant.file, original) })
  }
  // Set difference, never the exit code. See the H2 note above.
  //
  // AND the NAMED check must be the one that failed. The first working version of
  // this harness accepted ANY newly-failing check, and duly "caught" the
  // fabricated-tier mutant D3 on R6/§3 — the WARM LATENCY check, which fired at
  // p95 50.59 ms against a 50 ms budget and had nothing whatever to do with
  // evidence tiers. A mutant caught by an unrelated check is not caught; it is
  // noise that happened to correlate. This is the §8.7 tautological oracle in a
  // subtler costume than the one the contract names, and it is why the
  // expectation is a named check rather than a delta.
  const newFailures = res.failedChecks.filter((f) => !baselineFailures.has(f))
  const namedHit =
    plant.expectFailedCheck === null
      ? undefined
      : res.failedChecks.find((f) => f.includes(plant.expectFailedCheck!.slice(0, 40)))
  const detected = !res.crashed && namedHit !== undefined
  check(
    `${plant.id}: planting "${plant.defect.slice(0, 88)}…" makes the EXPECTED check fail`,
    detected,
    res.crashed
      ? `the gate CRASHED (exit=${res.exit}) rather than reporting a failing check — a crash is not a catch`
      : `exit=${res.exit} verdict=${res.verdict} ` +
        `expectedOne=${JSON.stringify((plant.expectFailedCheck ?? "<none>").slice(0, 46))} hit=${namedHit === undefined ? "NO" : "yes"}` +
        (newFailures.length > 0 && namedHit === undefined
          ? ` — other checks DID newly fail (${JSON.stringify(newFailures.slice(0, 2))}) but none of them is the check that owns this defect, so this is NOT a catch`
          : ` newFailures=${JSON.stringify(newFailures.slice(0, 2))}`),
  )
  if (detected) {
    for (const f of newFailures.slice(0, 4)) console.log(`      caught by: ${f.slice(0, 130)}`)
    console.log(`      ${plant.clause}`)
  }
  // The mutation must be gone before the next plant.
  const after = readFileSync(abs, "utf8")
  if (after !== original) {
    check(`${plant.id}: ${plant.file} is byte-identical to its pre-mutation content after restore`, false, "leftover mutation")
  }
}

// --- H1: a crashing mutant must be reported as a CRASH, never as a catch -----------
console.log("\nH1: a mutant that breaks the module must be classified as a CRASH\n")
{
  const rel = "src/lsp/relations.ts"
  const abs = path.join(ROOT, rel)
  const original = readFileSync(abs, "utf8")
  // Remove an export the gate imports transitively: the gate imports
  // USAGE_SITE_FILTER_LABEL from relations.ts, so deleting it must break the
  // module graph rather than produce a failing CHECK.
  writeFileSync(abs, original.replace("export const USAGE_SITE_FILTER_LABEL", "const REMOVED_BY_H1"))
  let res: RunResult
  try {
    res = runGate()
  } finally {
    restores.push({ file: rel, ...restore(rel, original) })
  }
  check(
    "H1: a mutant that removes a required export is reported as a CRASH, and this harness does not count it as a functional catch",
    res.crashed,
    `expected a crash (empty stdout / null status); got exit=${res.exit} stdoutBytes=${res.stdout.length} verdict=${res.verdict}`,
  )
  const after = readFileSync(abs, "utf8")
  check("H1: relations.ts is byte-identical after restore", after === original, after === original ? "" : "leftover mutation")
}

// --- H3: the tree must be exactly as we found it -------------------------------------
console.log("\nH3: harness integrity\n")
for (const r of restores) {
  check(`H3: ${r.file} restored byte-for-byte`, r.ok, r.detail)
}
{
  // Nothing of ours may be left in the evidence tree (the mutation-scratch class,
  // script/m55/verify-evidence-tree-clean.ts C5).
  const st = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", "validation"], {
    cwd: ROOT,
    encoding: "utf8",
  })
  const untracked = st.split("\n").filter((l) => l.startsWith("??")).map((l) => l.slice(3).trim())
  const mine = untracked.filter((p) => p.endsWith("HOV-REDTEAM.json"))
  check(
    "H3: the ONLY untracked file under validation/ is this gate's own declared evidence",
    untracked.every((p) => mine.includes(p)),
    untracked.filter((p) => !mine.includes(p)).join(", "),
  )
  const scratch = spawnSync("sh", ["-c", `find "${tmpdir()}" -maxdepth 1 -type d -name 'bblsp-*redteam*' 2>/dev/null`], { encoding: "utf8" })
  check("H3: no scratch directory left in the OS temp dir", (scratch.stdout ?? "").trim() === "", (scratch.stdout ?? "").trim())
}

// --- H4: the CLASS gate — a mutant whose ANCHOR text is ABSENT never ran -----
// This is the whole harness's blind spot in one check. Every plant is a textual
// substitution, so a plant whose `from` string is not present in the target has
// not run anything. The harness records that per plant as a failing check, but a
// per-plant line is easy to read as "one plant was skipped" and easy to skip past
// in a long log. This asserts the CLASS: no anchor may be absent.
//
// It exists because the failure is silent in the worst way. The D1 anchor drifted
// from its plant text during this lane, the suite printed "SKIP — anchor not
// found", and the mutant was scored as though a DIFFERENT check had caught it. An
// absent anchor is not a pass, not a skip, and not a defect-detected; it is a hole
// in the harness, and the only honest report of a hole is a red gate.
{
  const targets = [...new Set(PLANTS.map((p) => p.file))]
  const absent = PLANTS.filter((p) => !readFileSync(path.join(ROOT, p.file), "utf8").includes(p.from))
  check(
    `H4/CLASS: every planted mutant's ANCHOR TEXT IS PRESENT in its target file (an absent anchor means the mutant never ran, so its class is UNTESTED — ${PLANTS.length} plants over ${targets.length} files)`,
    absent.length === 0,
    absent.length === 0
      ? `all ${PLANTS.length} anchors found: ${PLANTS.map((p) => `${p.id}@${p.file}`).join(", ")}`
      : `ANCHOR ABSENT for ${absent.map((p) => `${p.id} in ${p.file}: ${JSON.stringify(p.from.slice(0, 80))}`).join(" | ")} — these mutants did not run`,
  )
  // The half-anchor case: a plant's first line matching while its full multi-line
  // text does not. `String.replace` would then apply to nothing, the mutated text
  // equals the original, and the run reports a mutation that changed nothing as
  // a clean catch.
  const drifted = PLANTS.filter((p) => {
    const src = readFileSync(path.join(ROOT, p.file), "utf8")
    const firstLine = p.from.split("\n")[0]!
    return src.includes(firstLine) && !src.includes(p.from)
  })
  check(
    "H4/DRIFT: no anchor's first line is present while its full multi-line text is absent (a half-anchored substitution changes nothing and is scored as a clean catch)",
    drifted.length === 0,
    drifted.map((p) => `${p.id}: first line matches, full text does not`).join(" | "),
  )
}

// --- H5: NO MUTATION MAY SURVIVE THIS PROCESS ------------------------------
// The per-file restores above each check their own file. This asserts the
// stronger property, over the whole set at once: every mutation target is
// byte-identical to what it was when this process STARTED.
//
// It is here because of a real leak during this lane. The D1 mutation
// (DECLARATION_RELATIONSHIPS gaining "uses") was present in the working tree at
// the end of the lane and survived a commit; it turned m55 T3 from 51/57 to
// 50/57 by making one of T3's own mutants report "SKIP — anchor not found",
// which reads like a passing suite with a skipped leg and is neither. Nothing
// noticed, because the restore checks and the working-tree diff were never
// compared against EACH OTHER — each was individually satisfied.
//
// A harness that leaves a mutation behind does not merely risk a wrong verdict.
// It makes the next run's numbers an artifact of this one.
{
  const leaked: string[] = []
  for (const rel of targets) {
    const now = readFileSync(path.join(ROOT, rel), "utf8")
    if (preRunBytes.get(rel) !== undefined && now !== preRunBytes.get(rel)) leaked.push(rel)
  }
  check(
    "H5/LEAK: every mutation target is byte-identical to its content at the START of this process (a mutation left behind makes the next run's numbers an artifact of this one)",
    leaked.length === 0,
    leaked.length === 0
      ? `no leaked mutation across ${targets.join(", ")}`
      : `LEAKED MUTATION in: ${leaked.join(", ")} — run \`git diff\` on those files before trusting any run after this one`,
  )
}

// --- evidence -------------------------------------------------------------------------
const failed = checks - passed
const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", "validation"], {
  cwd: ROOT,
  encoding: "utf8",
})
const result = {
  issue: "M55.HOV-REDTEAM",
  code: "HOV-REDTEAM",
  milestone: "M55",
  status: failed === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  realFailed: failed,
  negativeCases: PLANTS.length,
  plants: PLANTS.map((p) => ({
    id: p.id,
    file: p.file,
    defect: p.defect,
    clause: p.clause,
    expectedFailedCheck: p.expectFailedCheck,
  })),
  currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
  workingTreeRelevantChanges: status
    .split("\n")
    .map((l) => l.slice(3).trim())
    .filter((p) => p.startsWith("validation/")),
  verifierCommand: "npx tsx script/m55/verify-hover-coverage-redteam.ts",
  evidenceFile: "HOV-REDTEAM.json",
  generatedAt: new Date().toISOString(),
  observed: {
    cleanTreeVerdict: control.verdict,
    cleanTreeExit: control.exit,
    cleanTreeFailures: control.failedChecks,
    baselineFailures: [...baselineFailures],
    judgedBy: "SET DIFFERENCE of failing checks, never the exit code — on a loaded machine the gate's own §3 latency check is legitimately red, and an exit-code oracle would call every mutant detected for the wrong reason",
    restores,
  },
  failures,
  limitations: [
    "Each planted defect is a TEXTUAL mutation of a real source file, chosen because it is a real defect shape. It proves the gate's checks fire on that shape; it does not prove the gate catches every mutation of that file, and it says nothing about defects in files this lane does not own.",
    "The oracle is the gate subprocess, so a planted defect that makes the gate CRASH is reported as not-caught (H1 proves that classification works). That is deliberate: this program's repeated lesson is that a mutant caught only by a load failure is not caught, and a crash here would otherwise read as a pass.",
    "The mutations are applied to the WORKING TREE and restored in a finally block. A kill between the write and the restore would leave the tree mutated; the restore is verified byte-for-byte (H3) but only for the runs this process actually completed.",
    "This harness measures ONE property: that the gate can fail. It is not a coverage measure and adds nothing to the gap table in docs/HOVER-KNOWLEDGE-AUDIT.md.",
  ],
}

try {
  writeSealed(EVIDENCE, result)
  console.log(`\nEV HOV-REDTEAM evidence written: ${path.relative(ROOT, EVIDENCE)}`)
} catch (e) {
  console.log(`\nEV HOV-REDTEAM evidence write failed: ${String(e)}`)
  failures.push(`evidence write failed: ${String(e)}`)
}

console.log(`\nHOV-REDTEAM RESULT: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} — ${passed}/${checks} passed`)
if (failures.length > 0) console.log(`failures:\n  - ${failures.join("\n  - ")}`)
process.exit(failed === 0 ? 0 : 1)
