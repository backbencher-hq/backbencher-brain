// script/m55/verify-evidence-tree-clean.ts — the mutation-scratch leak gate.
//
// THE BUG CLASS (observed twice, in two lanes, independently):
//
//   A mutation harness needs a mutated COPY of a source module it then
//   `import()`s. The easy place to put that copy is next to the evidence it is
//   about to write. Those harnesses do exactly that:
//
//     script/m24/verify-hover.ts:711        validation/m24/richhover.mutant.<epoch>.ts
//     script/m26/verify-webview-harness.ts  validation/m26/core.v1mutant.<epoch>.<n>.ts
//     script/m26/verify-graph-transport.ts  validation/m26/graph_request.mutant.<epoch>.ts
//
//   Each removes its scratch on the happy path. The crash path is the one that
//   matters: SIGKILL, a dropped network, a thrown Error past the `try` — and the
//   scratch SURVIVES. Someone then commits it, because it is inside the
//   evidence tree and looks like evidence.
//
//   Why that is worse than a stray file:
//
//     1. §8.2 requires the evidence to regenerate byte-identical from the
//        current commit. A committed scratch file is a file in `validation/`
//        that no verifier wrote and no verifier reads.
//     2. A committed MUTATED COPY OF PRODUCT SOURCE is a lie with a filename
//        that says it is evidence. `validation/m26/core.v1mutant.*.ts` reads
//        as a validated artifact and is a broken graph-core with a planted
//        defect in it.
//     3. It hides the next leak. A tree that already carries two scratch
//        files cannot be gated for scratch files without a known-bad baseline.
//
// WHAT THIS GATE PROVES
//
//   C1  every file under validation/ is TRACKED. Any scratch a harness writes
//       and forgets is untracked by definition, so this catches a leak even if
//       the name is something no regex anticipated.
//   C2  no TRACKED file under validation/ carries the mutation-scratch
//       signature (`<name>.mutant.<digits>` / `<name>.v<n>mutant.<digits>`).
//       This is the C1 case that got committed — the two live m26 leaks.
//   C3  the signature does NOT fire on this repository's ~20 legitimately
//       committed fixtures whose names merely contain "mutant"
//       (mutants.ts, objc-mutant-check.json, mutant-proof.sh, ...). C3 is the
//       negative control: if C2's rule ever widens, C3 fails.
//   C4  SELF-CHECK — this gate's own run wrote nothing under validation/.
//       A hygiene gate that dirties the tree it polices is not a gate.
//
//   M1  a planted UNTRACKED scratch file makes C1 fire.
//   M2  a planted scratch file that is `git add`-ed makes C1 go quiet AND C2
//       fire — the two checks are not redundant, and the COMMITTED leak (the
//       live m26 case) is caught by name.
//   M3  a planted, tracked, legitimately-named fixture keeps C1 AND C2 quiet —
//       the gate does not over-fire on the real fixture corpus.
//   M4  widening C2's signature by one alternative makes C3 fire — the negative
//       control has teeth, and is not a constant that always passes.
//
// NO mutant here is caught by a LOAD FAILURE. The scanner is a plain
// filesystem predicate over a directory root and the mutants plant real files
// in a synthetic tree under the OS temp dir, so every catch is a behavioural
// verdict from the same code path the real tree goes through.
//
// Run: npx tsx script/m55/verify-evidence-tree-clean.ts
// Evidence: validation/m55/results/EVID-TREE.json (machine-emitted)

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..")
const EVIDENCE = path.join(ROOT, "validation", "m55", "results", "EVID-TREE.json")

let checks = 0
let passed = 0
const failures: string[] = []

function check(name: string, ok: boolean, detail = ""): boolean {
  checks++
  if (ok) {
    passed++
    console.log(`  ok: ${name}`)
  } else {
    failures.push(detail ? `${name}: ${detail}` : name)
    console.log(`  NOT OK: ${name}${detail ? ` — ${detail}` : ""}`)
  }
  return ok
}

// --- the rule ----------------------------------------------------------------------

/**
 * The mutation-scratch signature, as a NAMED rule rather than a bare regex, so
 * the negative control in C3 can widen it and prove it has teeth (M4).
 *
 * Anatomy, in words: a basename that contains the word `mutant` (case
 * insensitive) as a dot- or underscore-delimited token, optionally preceded by
 * a `v<N>` generation marker, immediately followed by `.` and then DIGITS.
 *
 *   core.v1mutant.1789395009246.2.ts   -> `v` + `1` + `mutant.` + digits   MATCH
 *   graph_request.mutant.1789359268925.ts -> `mutant.` + digits            MATCH
 *   richhover.mutant.1789395009246.ts      -> `mutant.` + digits            MATCH
 *
 * Deliberately NOT matched — the committed fixture corpus that merely says
 * "mutant" in a human name:
 *
 *   mutants.ts  go-new-mutants.ts  mutants-bash-lane.mts  mutant-proof.sh
 *   new-mutant-pins.json  objc-mutant-check.json  css-mutant-run.ts
 *   object-interface-mutant.ts  mutation-debt.json
 *
 * The discriminator is the DIGITS. A human-written fixture name puts a word or
 * an extension after `mutant`; a scratch name puts `Date.now()` there, because
 * the whole point of the scratch is to be unique per run and therefore
 * un-overwritable by its sibling mutant.
 */
export const SCRATCH_NAME_RULE = {
  id: "epoch-suffixed-mutant-scratch",
  statement:
    "a basename matching /(?:^|[^A-Za-z0-9])v?\\d*mutant\\.\\d/i — 'mutant' as a " +
    "delimited token, then '.', then digits",
  pattern: /(?:^|[^A-Za-z0-9])v?\d*mutant\.\d/i,
} as const

/**
 * The widened rule M4 plants: the SAME rule with the epoch requirement
 * (`\\.\\d`) deleted, leaving only `…mutant` as a delimited token.
 *
 * This is the shape a well-meaning "simplify the regex" edit takes, and it is
 * the honest failure mode for a name rule — the author reasons that the digits
 * are noise and drops them. The consequence is that `mutants.ts`,
 * `mutant-proof.sh` and `new-mutant-pins.json` all become violations, i.e. the
 * gate starts reporting twenty-odd legitimate committed fixtures as leaked
 * scratch. M4 proves that outcome is DETECTED, which is what gives C3 its
 * teeth: a rule this wide does not pass quietly.
 */
export const WIDENED_SCRATCH_NAME_RULE = {
  id: "widened-any-delimited-mutant-token",
  statement:
    "a basename matching /(?:^|[^A-Za-z0-9])v?\\d*mutant/i — 'mutant' as a " +
    "delimited token, with the epoch requirement dropped",
  pattern: /(?:^|[^A-Za-z0-9])v?\d*mutant/i,
} as const

export interface ScratchFile {
  /** path relative to the scanned root, forward-slashed */
  rel: string
  /** why this file was flagged */
  why: "untracked-in-evidence-tree" | "committed-scratch-signature"
}

export interface ScanResult {
  /** every file found under the root */
  total: number
  /** files that are not in `tracked` */
  untracked: string[]
  /** tracked files whose basename carries the scratch signature */
  scratchSignatures: string[]
  /** both classes, deduplicated by rel path */
  violations: ScratchFile[]
}

/**
 * The scanner. PURE over (root, tracked, rule) — it touches no global state and
 * no git, so every mutant in M1-M4 drives the SAME function the real verdict
 * drives, on a synthetic tree, with zero risk to the real evidence tree.
 */
export function scanEvidenceTree(root: string, tracked: ReadonlySet<string>, rule: { pattern: RegExp }): ScanResult {
  const files: string[] = []
  const walk = (dir: string): void => {
    let entries: ReturnType<typeof readdirSync>
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) walk(abs)
      else if (e.isFile()) files.push(path.relative(root, abs).split(path.sep).join("/"))
    }
  }
  walk(root)

  const untracked: string[] = []
  const scratchSignatures: string[] = []
  for (const rel of files) {
    if (!tracked.has(rel)) untracked.push(rel)
    if (rule.pattern.test(path.basename(rel))) scratchSignatures.push(rel)
  }

  const violations: ScratchFile[] = []
  for (const rel of untracked) violations.push({ rel, why: "untracked-in-evidence-tree" })
  for (const rel of scratchSignatures) {
    if (!violations.some((v) => v.rel === rel)) violations.push({ rel, why: "committed-scratch-signature" })
  }
  violations.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return { total: files.length, untracked, scratchSignatures, violations }
}

/** `git ls-files` over validation/, as rel paths from the validation root. */
function trackedUnderValidation(): Set<string> {
  const out = execFileSync("git", ["ls-files", "--", "validation"], { cwd: ROOT, encoding: "utf8" })
  const set = new Set<string>()
  for (const line of out.split("\n")) {
    const l = line.trim()
    if (!l) continue
    set.add(l.replace(/^validation\//, ""))
  }
  return set
}

/**
 * `git status --porcelain --untracked-files=all` restricted to validation/,
 * UNTRACKED lines only.
 *
 * Only `??` counts. `git status --porcelain` also prints staged deletions
 * (`D `) and modifications (` M`), and treating those as "untracked" is how the
 * first draft of this gate reported its own `git rm` of the two leaks as a
 * self-check failure — a gate that cries wolf about a deliberate commit is a
 * gate people turn off.
 */
function untrackedReportedByGit(): string[] {
  const out = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", "validation"], {
    cwd: ROOT,
    encoding: "utf8",
  })
  const files: string[] = []
  for (const line of out.split("\n")) {
    if (!line.startsWith("??")) continue
    const p = line.slice(3).trim()
    if (p) files.push(p)
  }
  return files
}

/** The gate's own evidence output, named. Exempt from C1 for the run in which
 *  it is first written, so a brand-new gate is not permanently red against its
 *  own output. Declared here rather than inferred, because an inferred
 *  exemption ("ignore whatever I am about to write") would also silently
 *  excuse a leak that happened to be named the same. */
const OWN_EVIDENCE_REL = "m55/results/EVID-TREE.json"
const SELF_EXEMPT = new Set([OWN_EVIDENCE_REL])

// --- C1-C4: the real tree ------------------------------------------------------------

console.log("M55 evidence-tree hygiene: is the evidence tree only evidence?")
const VALIDATION = path.join(ROOT, "validation")
const tracked = trackedUnderValidation()
const real = scanEvidenceTree(VALIDATION, tracked, SCRATCH_NAME_RULE)

// C1's corpus: untracked files, minus this gate's own declared output.
const c1Untracked = real.untracked.filter((rel) => !SELF_EXEMPT.has(rel))

console.log(
  `  scanned ${real.total} file(s) under validation/, ${tracked.size} tracked, ` +
    `${real.untracked.length} untracked (${c1Untracked.length} counted by C1), ` +
    `${real.scratchSignatures.length} carrying the scratch signature`,
)

check(
  "C1: every file under validation/ is tracked (no harness left scratch behind)",
  c1Untracked.length === 0,
  c1Untracked.length > 0
    ? `${c1Untracked.length} untracked: ${c1Untracked.slice(0, 8).join(", ")}${c1Untracked.length > 8 ? ` …+${c1Untracked.length - 8}` : ""}`
    : "",
)

// The live case this gate was written for: scratch that was COMMITTED.
check(
  "C2: no TRACKED file under validation/ carries the mutation-scratch signature",
  real.scratchSignatures.length === 0,
  real.scratchSignatures.length > 0 ? `committed scratch: ${real.scratchSignatures.join(", ")}` : "",
)

for (const v of real.violations) {
  const exempt = SELF_EXEMPT.has(v.rel) ? "  [this gate's own declared output — exempt from C1]" : ""
  console.log(`    violation: ${v.rel}  (${v.why})${exempt}`)
}

// C3 — the negative control, over the REAL committed fixture corpus.
//
// The corpus is the tracked files whose name merely mentions "mutant", MINUS the
// ones C2 already flagged. Subtracting them is what makes C3 a different check
// from C2 rather than a second copy of it: C2 asks "does the rule catch the
// known signature", C3 asks "does the rule stay silent on everything else that
// says mutant". With the subtraction in place C3 can only ever fail on a FALSE
// POSITIVE, so a passing C3 is real evidence the rule is narrow.
const mutantNamedCorpus = [...tracked].filter((rel) => /mutant/i.test(path.basename(rel)))
const mutantNamedFixtures = mutantNamedCorpus.filter((rel) => !real.scratchSignatures.includes(rel))
const firedOnFixtures = mutantNamedFixtures.filter((rel) => SCRATCH_NAME_RULE.pattern.test(path.basename(rel)))
check(
  `C3: the signature does NOT fire on the ${mutantNamedFixtures.length} committed fixture(s) whose name merely says "mutant"`,
  firedOnFixtures.length === 0,
  firedOnFixtures.length > 0 ? `false positive(s): ${firedOnFixtures.join(", ")}` : "",
)
if (mutantNamedFixtures.length === 0) {
  console.log("  NOTE: C3 had no legitimate fixture corpus to run against — the negative control is VACUOUS this run")
  failures.push("C3: negative control had no corpus (vacuous)")
}

// C4 — self-check. This gate's verdict is only trustworthy if running it left
// the tree with no scratch. It is measured BEFORE the evidence write (the
// evidence write is the one file this gate is DECLARED to produce, and its
// exemption is named in SELF_EXEMPT above, not inferred here).
const afterSelf = untrackedReportedByGit().filter((rel) => !SELF_EXEMPT.has(rel.replace(/^validation\//, "")))
check(
  "C4: SELF-CHECK — running this gate left no untracked file under validation/",
  afterSelf.length === 0,
  afterSelf.length > 0 ? `this gate dirtied the tree: ${afterSelf.join(", ")}` : "",
)

// C5 — the SOURCE LAW, which is what actually stops the class rather than
// catching its residue. Timing-based kill tests are flaky (the mutant loop is
// over in ~50ms on this machine), so the durable check is static: no verifier
// under script/ may build a scratch path that names the evidence tree.
//
// This is the check that reaches the OWNERS' files rather than reporting them:
// `script/m26/verify-webview-harness.ts` and `script/m26/verify-graph-transport.ts`
// still write their mutant copies into `validation/m26/`, and
// `script/m24/verify-call-hierarchy.ts` still does too. Those files are outside
// this lane's ownership, so they are REPORTED here and left for their owners;
// this lane's own harness (script/m24/verify-hover.ts) is fixed and asserted.
const SOURCE_LAW_FILES = [
  "script/m24/verify-hover.ts",
  "script/m24/verify-call-hierarchy.ts",
  "script/m26/verify-webview-core.ts",
  "script/m26/verify-webview-harness.ts",
  "script/m26/verify-graph-transport.ts",
  "script/m26/verify-impact-mode.ts",
  "script/m26/verify-content-security.ts",
  "script/m26/verify-cross-language-hover.ts",
  "script/m26/verify-evidence-badges.ts",
  "script/m26/verify-polyglot-e2e.ts",
]
/** Which of those this lane is allowed to change. Everything else is reported,
 *  not edited — a hygiene gate that edits other lanes' files is a merge
 *  conflict waiting to happen. */
const LANE_OWNED = new Set(["script/m24/verify-hover.ts"])

/** A `writeFileSync` whose path expression mentions a mutant scratch name AND
 *  an evidence-tree segment. Matched on the source TEXT because that is what a
 *  mutation harness writes. */
function scratchWritesIntoEvidenceTree(source: string): string[] {
  const lines = source.split("\n")
  const hits: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (!/writeFileSync/.test(l)) continue
    // Look at this line and the two above it: the path is usually built on a
    // preceding line and passed in on the write.
    const window = lines.slice(Math.max(0, i - 2), i + 1).join("\n")
    if (!/mutant/i.test(window)) continue
    if (!/["'`]validation/.test(window)) continue
    hits.push(`${i + 1}: ${l.trim()}`)
  }
  return hits
}

const sourceLawOffenders: { file: string; owned: boolean; hits: string[] }[] = []
for (const rel of SOURCE_LAW_FILES) {
  const abs = path.join(ROOT, rel)
  if (!existsSync(abs)) continue
  const hits = scratchWritesIntoEvidenceTree(readFileSync(abs, "utf8"))
  if (hits.length > 0) sourceLawOffenders.push({ file: rel, owned: LANE_OWNED.has(rel), hits })
}
const ownedOffenders = sourceLawOffenders.filter((o) => o.owned)
const foreignOffenders = sourceLawOffenders.filter((o) => !o.owned)

check(
  "C5: no mutation harness THIS LANE OWNS writes its scratch into validation/",
  ownedOffenders.length === 0,
  ownedOffenders.length > 0
    ? ownedOffenders.map((o) => `${o.file} -> ${o.hits.join(" | ")}`).join("; ")
    : "",
)
if (foreignOffenders.length > 0) {
  console.log(
    `  REPORT (not a failure — these files belong to another lane, and this gate does not edit them):`,
  )
  for (const o of foreignOffenders) {
    console.log(`    ${o.file}:${o.hits.join(" | ")}`)
  }
}

// --- M1-M6: the gate must be able to fail --------------------------------------------

console.log("M: mutants (each planted defect must fail the gate)")

interface Mutant {
  name: string
  caught: boolean
  detail: string
}
const mutants: Mutant[] = []

/** Build a synthetic evidence tree under the OS temp dir. NEVER under ROOT. */
function syntheticTree(): { root: string; dispose: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "bblsp-evidtree-"))
  return { root, dispose: () => { try { rmSync(root, { recursive: true, force: true }) } catch {} } }
}

const ALL_TRACKED_SYNTHETIC = new Set(["results/T4.json", "fixtures/mutants.ts"])

// M1: an UNTRACKED scratch file. C1 must fire.
{
  const t = syntheticTree()
  try {
    mkdirSync(path.join(t.root, "results"), { recursive: true })
    writeFileSync(path.join(t.root, "results", "T4.json"), "{}")
    const planted = "results/richhover.mutant.1789395009246.ts"
    writeFileSync(path.join(t.root, planted), "// planted scratch\nexport const x = 1\n")
    const scan = scanEvidenceTree(t.root, new Set(["results/T4.json"]), SCRATCH_NAME_RULE)
    const c1Fired = scan.untracked.includes(planted)
    mutants.push({
      name: "M1: an untracked scratch file under validation/ fails C1",
      caught: c1Fired,
      detail: `untracked=${JSON.stringify(scan.untracked)}`,
    })
  } finally {
    t.dispose()
  }
}

// M2: the same file, TRACKED (what the live m26 leak is). C1 must go quiet and
// C2 must fire — proving the two checks are not the same check.
{
  const t = syntheticTree()
  try {
    mkdirSync(path.join(t.root, "results"), { recursive: true })
    const planted = "results/core.v1mutant.1789395009246.2.ts"
    writeFileSync(path.join(t.root, planted), "// planted scratch\nexport const x = 1\n")
    const scan = scanEvidenceTree(t.root, new Set(["results/T4.json", planted]), SCRATCH_NAME_RULE)
    const c1Quiet = scan.untracked.length === 0
    const c2Fired = scan.scratchSignatures.includes(planted)
    mutants.push({
      name: "M2: a COMMITTED scratch file fails C2 (and C1 goes quiet — not redundant)",
      caught: c1Quiet && c2Fired,
      detail: `c1Quiet=${c1Quiet} c2Fired=${c2Fired} sigs=${JSON.stringify(scan.scratchSignatures)}`,
    })
  } finally {
    t.dispose()
  }
}

// M3: a tracked, legitimately-named fixture must keep BOTH checks quiet. Without
// this, a gate that fires on everything would score a perfect 2/2 above.
{
  const t = syntheticTree()
  try {
    mkdirSync(path.join(t.root, "fixtures"), { recursive: true })
    writeFileSync(path.join(t.root, "fixtures", "mutants.ts"), "// a real fixture\nexport const y = 2\n")
    writeFileSync(path.join(t.root, "fixtures", "objc-mutant-check.json"), "{}\n")
    writeFileSync(path.join(t.root, "fixtures", "mutant-proof.sh"), "#!/bin/sh\n")
    const scan = scanEvidenceTree(t.root, new Set(["fixtures/mutants.ts", "fixtures/objc-mutant-check.json", "fixtures/mutant-proof.sh"]), SCRATCH_NAME_RULE)
    const quiet = scan.violations.length === 0
    mutants.push({
      name: "M3: tracked fixtures named mutants.ts / objc-mutant-check.json / mutant-proof.sh stay quiet (no over-fire)",
      caught: quiet,
      detail: `violations=${JSON.stringify(scan.violations)}`,
    })
  } finally {
    t.dispose()
  }
}

// M4: the negative control has teeth. A realistically-widened signature (the
// epoch requirement dropped — the "simplify the regex" edit) must make C3 FAIL
// against the real legitimate fixture corpus. If this mutant were to survive,
// C3 would be a check that cannot fail on a rule that is far too broad.
{
  // Re-derive the C3 corpus exactly as the real check derives it, then run the
  // WIDENED rule against it. Note it must exclude the known leaks, or the
  // mutant would pass for the wrong reason (the leaks are already C2's).
  const widenedFireOnCorpus = mutantNamedFixtures.filter((rel) => WIDENED_SCRATCH_NAME_RULE.pattern.test(path.basename(rel)))
  // And the control: the SHIPPING rule must stay quiet on that same corpus.
  const shippingQuietOnCorpus = mutantNamedFixtures.filter((rel) => SCRATCH_NAME_RULE.pattern.test(path.basename(rel)))
  mutants.push({
    name: "M4: a WIDENED signature makes C3 fire on the legitimate fixture corpus (the negative control has teeth)",
    caught: widenedFireOnCorpus.length > 0 && shippingQuietOnCorpus.length === 0,
    detail: `widened fires on ${widenedFireOnCorpus.length}/${mutantNamedFixtures.length} (e.g. ${widenedFireOnCorpus.slice(0, 3).join(", ")}); shipping rule fires on ${shippingQuietOnCorpus.length}`,
  })
}

// M5: the source law must fire on the REAL pre-fix shape — the exact code that
// is still in five other lanes' files. If it did not fire here, C5 is
// decorative and would silently pass forever.
{
  const preFixSource = [
    'const mutantPath = join(ROOT, "validation/m26", `core.v1mutant.${Date.now()}.${n}.ts`)',
    "writeFileSync(mutantPath, coreSource.replace(mutant.from, mutant.to))",
  ].join("\n")
  const fired = scratchWritesIntoEvidenceTree(preFixSource)
  const postFixSource = [
    'const mutantPath = join(mutantScratchDir(), `richhover.mutant.${Date.now()}.${seq++}.ts`)',
    "writeFileSync(mutantPath, absImport)",
  ].join("\n")
  const quiet = scratchWritesIntoEvidenceTree(postFixSource)
  mutants.push({
    name: "M5: the C5 source law FIRES on the pre-fix `join(ROOT, \"validation/m26\", …)` shape and stays quiet on the fixed one",
    caught: fired.length > 0 && quiet.length === 0,
    detail: `preFixHits=${fired.length} postFixHits=${quiet.length}`,
  })
}

// M6: the source law must NOT fire on an unrelated verifier that legitimately
// writes evidence (or generated-doc) files — otherwise C5 would fire on every
// verifier in the program.
{
  const legit = ["writeFileSync(EVIDENCE, result)", 'const doc = join(ROOT, "docs", "HOVER-KNOWLEDGE-AUDIT.md")', "writeFileSync(doc, body)"].join("\n")
  const fired = scratchWritesIntoEvidenceTree(legit)
  mutants.push({
    name: "M6: the C5 source law stays quiet on a verifier writing its evidence and its generated doc",
    caught: fired.length === 0,
    detail: `hits=${JSON.stringify(fired)}`,
  })
}

let caught = 0
for (const m of mutants) {  if (m.caught) {
    caught++
    console.log(`  ok: ${m.name}`)
  } else {
    console.log(`  NOT OK: ${m.name} — ${m.detail}`)
    failures.push(`mutant not caught: ${m.name} (${m.detail})`)
  }
}

// --- evidence ------------------------------------------------------------------------

const failed = checks - passed
const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", "validation"], {
  cwd: ROOT,
  encoding: "utf8",
})
const result = {
  issue: "M55.EVID-TREE",
  code: "EVID-TREE",
  milestone: "M55",
  status: failed === 0 && caught === mutants.length ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  realFailed: failed,
  negativeCases: mutants.length,
  mutants: { total: mutants.length, caught },
  currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
  workingTreeRelevantChanges: status
    .split("\n")
    .map((l) => l.slice(3).trim())
    .filter((p) => p.startsWith("validation/")),
  verifierCommand: "npx tsx script/m55/verify-evidence-tree-clean.ts",
  ...fingerprintFields(["m55.EVID-TREE"], ROOT),
  evidenceFile: "EVID-TREE.json",
  generatedAt: new Date().toISOString(),
  observed: {
    rule: SCRATCH_NAME_RULE,
    scannedFiles: real.total,
    trackedFiles: tracked.size,
    untrackedInValidation: real.untracked,
    c1CountedUntracked: c1Untracked,
    selfExempt: [...SELF_EXEMPT],
    committedScratchSignatures: real.scratchSignatures,
    violations: real.violations,
    sourceLawOffenders,
    laneOwnedSourceLawOffenders: ownedOffenders,
    foreignSourceLawOffenders: foreignOffenders.map((o) => o.file),
    mutantNamedFixtureCorpus: mutantNamedFixtures,
    mutantNamedCorpusSize: mutantNamedCorpus.length,
  },
  failures,
  limitations: [
    "C1 compares the working tree against `git ls-files`, so a scratch file that is BOTH written and `git add`-ed in the same run is invisible to C1 by construction — that case is C2's, and M2 is the proof C2 exists for it.",
    "The scratch signature is a NAME rule. A harness that leaks under a name without `mutant` and without a `Date.now()` suffix is caught by C1 while it is still untracked, and NOT caught by C2 once committed. C2 is a backstop for a known signature, not a general proof that validation/ contains no product source.",
    "This gate reads the filename and the git index only. It cannot tell a leaked mutated source file from a deliberately committed one that happens to share the naming shape — C2's answer is 'flag it and let a human read the commit', which is the intended behaviour.",
    "The mutant corpus (M1-M4) runs against synthetic trees under the OS temp dir, so it never risks the real evidence tree. The consequence is that M1/M2 prove the SCANNER fails, and the real-tree verdict proves the scanner was pointed at the right place; no mutant re-runs the real tree with a real leak planted in it.",
  ],
}

try {
  writeSealed(EVIDENCE, result)
  console.log(`\nEV EVID-TREE evidence written: ${path.relative(ROOT, EVIDENCE)}`)
} catch (e) {
  console.log(`\nEV EVID-TREE evidence write failed: ${String(e)}`)
  failures.push(`evidence write failed: ${String(e)}`)
}

console.log(
  `\nEVID-TREE RESULT: ${failed === 0 && caught === mutants.length ? "VERIFIED" : "KNOWN-GAP"} — ` +
    `${passed}/${checks} passed, ${caught}/${mutants.length} mutants caught`,
)
if (failures.length > 0) console.log(`failures:\n  - ${failures.join("\n  - ")}`)
process.exit(failed === 0 && caught === mutants.length ? 0 : 1)
