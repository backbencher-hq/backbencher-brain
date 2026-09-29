/**
 * M14.0 Honesty Gate
 *
 * Runs LAST-in-spirit checks that block release when any M14 artifact smells
 * of self-certification (docs/M14-HONESTY-CONTRACT.md §5.8):
 *   1. banned-vocabulary lint over docs/, plans/, validation/m14/ artifacts
 *   2. evidence files present + schema-valid for every claimed foundation issue
 *   3. L4/L5 claims backed by >=3 mutationLog entries (deep-checked here again)
 *   4. baselines present (grammar, fixtures, differential) — no gate may run
 *      unbaselined
 *   5. corpus pins present in differential evidence
 *
 * CLI: bun run script/m14/verify-honesty.ts   (exit non-zero blocks release)
 */
import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const M14 = path.join(ROOT, "validation", "m14")

const REQUIRED_EVIDENCE = ["M14.0.F1", "M14.0.F2", "M14.0.F3", "M14.0.F4", "M14.0.F5", "M14.0.F6", "M14.0.F7", "M14.0.F8", "M14.0.F9"]
const REQUIRED_BASELINES = [
  "grammar-audit-baseline.json",
  "fixture-baseline.json",
  "differential-baseline.json",
]
// Contract §1 terms — checked over artifact prose (not code identifiers).
const BANNED = [
  /\bperfect(ion)?\b/i, /\bcomplete[d]?\b/i, /\bproduction-ready\b/i,
  /\bbulletproof\b/i, /\brock-solid\b/i, /\bbattle-tested\b/i,
  /\bextensively tested\b/i, /\bthoroughly reviewed\b/i,
  /\bshould work\b/i, /\bexpected to pass\b/i,
]

let failures = 0
function fail(msg: string) { console.error(`HONESTY-GATE FAIL: ${msg}`); failures++ }
function pass(msg: string) { console.log(`ok   ${msg}`) }

// 1. banned vocabulary in M14 prose artifacts
function collectProse(dir: string, out: string[] = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collectProse(p, out)
    else if (/\.(md|json)$/.test(e.name)) out.push(p)
  }
  return out
}
for (const file of collectProse(M14).concat(collectProse(path.join(ROOT, "docs")).filter(f => f.includes("M14")))) {
  // The contract itself quotes banned terms to define them, and the ledger
  // title ("Completeness Ledger") is a proper noun naming the specification,
  // not a verdict claim — both exempted by design.
  if (file.endsWith("M14-HONESTY-CONTRACT.md")) continue
  if (file.endsWith("M14-COMPLETENESS-LEDGER.md")) continue
  const text = fs.readFileSync(file, "utf8")
  for (const re of BANNED) {
    const m = text.match(re)
    if (m) fail(`banned term "${m[0]}" in ${path.relative(ROOT, file)}`)
  }
}
pass("banned-vocabulary lint over validation/m14 + M14 docs")

// 2+3. evidence files valid and deep-checked
for (const id of REQUIRED_EVIDENCE) {
  const p = path.join(M14, "results", `${id}.json`)
  if (!fs.existsSync(p)) { fail(`missing evidence file for ${id}`); continue }
  let ev: any
  try { ev = JSON.parse(fs.readFileSync(p, "utf8")) } catch { fail(`${id}: unparseable`); continue }
  if (ev.schemaVersion !== 2) fail(`${id}: not schema v2`)
  if ((ev.claimLevel === "L4" || ev.claimLevel === "L5") && (ev.mutationLog?.length ?? 0) < 3)
    fail(`${id}: L4/L5 without >=3 mutationLog`)
  if (!ev.limitations?.length && !ev.data?.limitationsJustification)
    fail(`${id}: empty limitations without justification`)
}
pass("evidence presence/schema/mutation-backing for F1-F6")

// 2b. F6 fixture-coverage: every per-language check must be a pass — a fail
// here means a spec type has zero fixture evidence or a dead analyzer literal
// shipped (the relative_scope bug class).
{
  const f6 = path.join(M14, "results", "M14.0.F6.json")
  if (!fs.existsSync(f6)) fail("missing evidence file for M14.0.F6")
  else {
    const ev = JSON.parse(fs.readFileSync(f6, "utf8"))
    const bad = (ev.checks ?? []).filter((c: any) => c.status !== "pass")
    if (bad.length) fail(`M14.0.F6 has ${bad.length} non-passing language check(s): ${bad.map((c: any) => c.id).join(", ")}`)
    else if (!ev.checks?.length) fail("M14.0.F6 carries zero per-language checks — coverage never ran")
    else pass(`fixture-coverage all-green (${ev.checks.length} languages)`)
  }
}

// 2c. F7/F8/F9 (strengthened-gate set): all-green deep-check AND IDENTITY.
//   F7 analyzer-hygiene: no dead code classes in any gated analyzer
//   F8 corpus-census: every real-corpus parse-tree type spec-classified
//   F9 probe battery: historical defect classes asserted on analyzer AND oracle
//
// M49 W8 (2026-09-12). The all-green deep-check below was satisfied by the
// WRONG artifacts for waves. Two other gates per id also emitted
// `issueId: "M14.0.F7"/"F8"/"F9"` — pipeline e2e, web-cluster e2e and
// systems-cluster e2e — and those three ARE in the battery while the three
// strengthened gates were not, so every full run overwrote the hygiene / census
// / probe-battery evidence with unrelated content. This loop then deep-checked
// whichever file happened to be there and reported the strengthened gates green.
// The gate believed it was verifying three gates and was verifying none of them.
//
// So identity is asserted, not assumed: each artifact's `layers` is its own
// statement of which gate produced it. A collision (or any future re-labelling)
// fails here loudly instead of passing vacuously. The three cluster/pipeline
// gates now carry their own ids (M14.0.PIPE / WC1 / SC1) and are checked as
// themselves in 2d.
const STRENGTHENED_GATES: { id: string; layer: string; what: string }[] = [
  { id: "M14.0.F7", layer: "hygiene", what: "analyzer-hygiene gate" },
  { id: "M14.0.F8", layer: "census", what: "corpus-census gate" },
  { id: "M14.0.F9", layer: "probes", what: "defect-class probe battery" },
]
for (const gate of STRENGTHENED_GATES) {
  const p = path.join(M14, "results", `${gate.id}.json`)
  if (!fs.existsSync(p)) { fail(`missing evidence file for ${gate.id} (${gate.what})`); continue }
  const ev = JSON.parse(fs.readFileSync(p, "utf8"))
  const layers: string[] = ev.layers ?? []
  if (!layers.includes(gate.layer)) {
    fail(`${gate.id} was NOT produced by the ${gate.what}: its layers are [${layers.join(", ")}], expected to include "${gate.layer}" — another gate overwrote its evidence (evidence-identity collision)`)
    continue
  }
  const bad = (ev.checks ?? []).filter((c: any) => c.status !== "pass")
  if (bad.length) fail(`${gate.id} has ${bad.length} non-passing check(s): ${bad.map((c: any) => c.id).join(", ")}`)
  else if (!ev.checks?.length) fail(`${gate.id} carries zero checks — the gate never ran`)
  else pass(`${gate.id} all-green (${ev.checks.length} checks)`)
}

// 2d. Cluster / pipeline e2e gates, on their own identities.
// M14.0.CENSUS is here for the same reason and with the same shape: a gate whose
// artifact is never read by the honesty gate is a gate whose failure nobody is
// told about, and a carrier census nobody reads is exactly the gate that would
// have caught the six carriers that were missing from BOTH tables at once.
for (const id of ["M14.0.PIPE", "M14.0.WC1", "M14.0.SC1", "M14.0.CENSUS", "M14.0.TOML-CENSUS", "M14.0.SVELTE-CENSUS"]) {
  const p = path.join(M14, "results", `${id}.json`)
  if (!fs.existsSync(p)) { fail(`missing evidence file for ${id}`); continue }
  const ev = JSON.parse(fs.readFileSync(p, "utf8"))
  const bad = (ev.checks ?? []).filter((c: any) => c.status !== "pass")
  if (bad.length) fail(`${id} has ${bad.length} non-passing check(s): ${bad.map((c: any) => c.id).join(", ")}`)
  else if (!ev.checks?.length) fail(`${id} carries zero checks — the gate never ran`)
  else pass(`${id} all-green (${ev.checks.length} checks)`)
}

// 4. baselines exist and are non-empty
for (const b of REQUIRED_BASELINES) {
  const p = path.join(M14, b)
  if (!fs.existsSync(p)) { fail(`missing baseline: ${b}`); continue }
  const parsed = JSON.parse(fs.readFileSync(p, "utf8"))
  if (!Object.keys(parsed).length) fail(`empty baseline: ${b}`)
}
pass("regression baselines present (grammar, fixtures, differential)")

// 5. corpus pins
const f5 = path.join(M14, "results", "M14.0.F5.json")
if (fs.existsSync(f5)) {
  const f5Payload = JSON.parse(fs.readFileSync(f5, "utf8"))
  const pins = f5Payload?.data?.corpusPins ?? {}
  const pinsValid = Object.entries(pins).every(([, sha]: any) => /^[0-9a-f]{40}$/.test(sha))
  if (!pinsValid || !Object.keys(pins).length) fail("differential evidence lacks valid corpus commit pins")
  else pass(`corpus pins present (${Object.keys(pins).join(", ")})`)

  // M49 W16: pins answer "which corpus content", and for the same reason the
  // artifact must answer "which CODE". It names a commit in `regeneratedAtCommit`
  // while the rows come from the working tree, so a sweep over uncommitted
  // analyzers produced numbers that were true of no commit — observed live: the
  // W16 F5 carried a 479-line uncommitted dart analyzer edit behind a 50.6%
  // unexplained dart lane, while the committed analyzer on the same pinned
  // corpus measures 0%. The harness now records the dirt it read.
  const codeInputsVerdict = (payload: any): string | null => {
    const ci = payload?.data?.codeInputs
    if (!ci || typeof ci !== "object") return "the artifact does not declare the code inputs it measured"
    if (ci.clean !== true) return `measured over uncommitted code (${Array.isArray(ci.dirty) ? ci.dirty.length : "?"} input(s))`
    // Clean is not enough: code can be clean at a DIFFERENT commit than the one
    // the artifact names (measured in one checkout, landed from another), which
    // is the same lie one step subtler. The head it read must be the lineage.
    const lineage = payload?.regeneratedAtCommit
    if (typeof lineage === "string" && lineage !== "__LEGACY__" && ci.head !== lineage) {
      return `measured code at ${String(ci.head).slice(0, 10)} but names ${lineage.slice(0, 10)}`
    }
    return null
  }
  const verdict = codeInputsVerdict(f5Payload)
  if (verdict) fail(`differential evidence ${verdict} — regenerate from a clean tree`)
  else pass("differential evidence declares its code inputs clean at the commit it names")
  // The rule has to be able to fail, or it is decoration: the three shapes it
  // must separate are an artifact that says nothing, one that admits dirt, and
  // one that declares clean inputs.
  const A = "a".repeat(40), B = "b".repeat(40)
  if (codeInputsVerdict({ data: {} }) === null) fail("code-input rule cannot fail on an artifact that declares nothing")
  if (codeInputsVerdict({ data: { codeInputs: { clean: false, dirty: ["src/ast/x.ts"] } } }) === null) fail("code-input rule cannot fail on declared dirt")
  if (codeInputsVerdict({
    regeneratedAtCommit: A,
    data: { codeInputs: { clean: true, dirty: [], head: B } },
  }) === null) fail("code-input rule cannot fail on clean code from another commit")
  if (codeInputsVerdict({
    regeneratedAtCommit: A,
    data: { codeInputs: { clean: true, dirty: [], head: A } },
  }) !== null) fail("code-input rule rejects clean code at the named commit")
  // A legacy artifact predates the rule and declares no head; it must not be
  // failed for the absence of a field the harness did not yet write.
  if (codeInputsVerdict({
    regeneratedAtCommit: "__LEGACY__",
    data: { codeInputs: { clean: true, dirty: [] } },
  }) !== null) fail("code-input rule rejects a legacy declaration")
}

// 6. evidence freshness: an artifact is current iff the inputs it asserts
//    about have not changed since it was regenerated.
//
// The rule used to be "the artifact's commit must be among the last 5 HEAD
// commits". That is both too strong and too weak. Too strong: unrelated
// commits (docs, other milestones, another agent's wave) push a perfectly
// current artifact out of the window and turn the gate permanently red —
// measured at 5c0808ec, eight of nine required artifacts failed while nothing
// they measure had moved, which is exactly how a gate teaches its readers to
// ignore it. Too weak: an artifact keeps PASSING while its own analyzer is
// edited, until the window happens to lapse.
//
// Content dependence is what an artifact actually claims. Each id declares the
// paths whose change invalidates it; freshness is decided by `git diff
// <lineage>..HEAD` restricted to those paths, so unrelated commits are silent
// and a real edit fails immediately with the offending files named. HEAD-anchored
// (committed range only), matching the census gates: a dirty working tree does
// not invalidate an artifact that is true of HEAD.
const EVIDENCE_INPUTS: Record<string, string[]> = {
  "M14.0.F1": ["src/ast/", "wasm/", "script/m14/audit-analyzer-grammar.ts"],
  "M14.0.F2": ["script/m14/", "validation/m14/fixtures/"],
  "M14.0.F3": ["src/ast/", "validation/m14/fixtures/", "script/m14/run-fixtures.ts"],
  "M14.0.F4": ["src/ast/", "validation/m14/fixtures/", "script/m14/mutate-analyzer.ts"],
  "M14.0.F5": ["src/ast/", "script/m14/differential.ts", "script/m14/verify-differential-evidence.ts"],
  "M14.0.F6": ["src/ast/", "validation/m14/fixtures/", "script/m14/spec/", "script/m14/verify-fixture-coverage.ts"],
  "M14.0.F7": ["src/ast/", "script/m14/verify-analyzer-hygiene.ts"],
  // M49 W14: these three named the WRONG producer (see the producer-coverage
  // rule below). F8 is emitted by the corpus census, not the probe battery;
  // F9 is emitted by the probe battery, not the spec/completeness path; SPEC
  // is emitted by completeness-inventory, not by its verifier.
  //
  // M49 W8 follow-up (2026-09-25): F8 also READS the two things its claimed
  // content depends on and did not declare. The census parses with the pinned
  // grammars in `wasm/` and classifies against `script/m14/spec/<lang>-completeness.json`;
  // neither path was an input, so the M60 objc grammar wave (f2a20b62) rebuilt a
  // wasm and added two node types the spec never ruled, and the census went red
  // while its artifact stayed "fresh" — the gate caught the defect, the freshness
  // rule could not have. An input set that omits what the artifact reads is the
  // same defect the producer rule above fixes, one step out.
  "M14.0.F8": ["src/ast/", "wasm/", "script/m14/spec/", "script/m14/verify-corpus-census.ts"],
  "M14.0.F9": ["src/ast/", "script/m14/verify-probe-battery.ts"],
  "M14.0.SPEC": ["script/m14/spec/", "wasm/", "script/m14/completeness-inventory.ts", "script/m14/verify-completeness.ts"],
  "M14.CC1": ["src/ast/"],
  "M14.0.PIPE": ["src/ast/", "validation/m14/fixtures/", "script/m14/verify-pipeline-e2e.ts"],
  "M14.0.WC1": ["src/ast/", "validation/m14/fixtures/", "script/m14/verify-web-cluster-e2e.ts"],
  "M14.0.SC1": ["src/ast/", "validation/m14/fixtures/", "script/m14/verify-systems-cluster-e2e.ts"],
  // The census reads the corpora and the analyzer, not the fixture files, so the
  // lineage prefixes name what can actually move its verdict.
  "M14.0.CENSUS": ["src/ast/real-html-analyzer.ts", "script/m14/verify-carrier-census.ts"],
  // The toml census reads the corpora and the grammar, and consults neither the
  // analyzer nor the oracle — that is the whole point of it — so naming the
  // analyzer here would be a false lineage claim. The census script and the wasm
  // are what can move its verdict.
  "M14.0.TOML-CENSUS": ["script/m14/verify-toml-census.ts", "wasm/tree-sitter-toml.wasm"],
  // The svelte census reads the corpus and consults NEITHER the svelte analyzer nor
  // the F5 oracle — that is the whole point of it, since a differential cannot see a
  // construct both sides forgot. Naming the analyzer here would be a false lineage
  // claim of exactly the kind the gate exists to catch. The census script and the
  // svelte wasm are what can move its verdict.
  "M14.0.SVELTE-CENSUS": ["script/m14/verify-svelte-census.ts", "wasm/tree-sitter-svelte.wasm"],
}

function commitOk(rev: string): boolean {
  try { execSync(`git cat-file -e ${rev}^{commit}`, { cwd: ROOT, stdio: "pipe" }); return true } catch { return false }
}
function changedInputs(rev: string, prefixes: string[]): string[] {
  const out: string[] = []
  for (const pre of prefixes) {
    let files: string[] = []
    try {
      files = execSync(`git diff --name-only ${rev}..HEAD -- ${JSON.stringify(pre)}`, { cwd: ROOT, encoding: "utf8" })
        .toString().trim().split("\n").filter(Boolean)
    } catch { files = [] }
    out.push(...files)
  }
  return [...new Set(out)].sort()
}

let freshCount = 0
for (const id of REQUIRED_EVIDENCE) {
  const p = path.join(M14, "results", `${id}.json`)
  if (!fs.existsSync(p)) continue
  const ev = JSON.parse(fs.readFileSync(p, "utf8"))
  const lineage = ev.regeneratedAtCommit === "__LEGACY__" ? ev.commit : (ev.regeneratedAtCommit ?? ev.commit)
  if (typeof lineage !== "string" || !/^[0-9a-f]{7,40}$/.test(lineage) || !commitOk(lineage)) {
    fail(`${id}: lineage ${JSON.stringify(lineage)} is not a commit in this repository — refresh the artifact`)
    continue
  }
  const inputs = EVIDENCE_INPUTS[id] ?? ["src/", "script/", "validation/", "wasm/"]
  const changed = changedInputs(lineage, inputs)
  if (changed.length) {
    fail(`${id}: ${changed.length} declared input(s) changed since ${lineage.slice(0, 10)} — regenerate (${changed.slice(0, 4).join(", ")}${changed.length > 4 ? ", …" : ""})`)
  } else freshCount++
}
pass(`evidence freshness: ${freshCount} artifact(s) current against their declared inputs`)

// A declared input set is only a claim about the right thing if it names the
// file that EMITS the artifact. Three of them did not: M14.0.F8 (emitted by
// `verify-corpus-census.ts`) declared the probe battery, M14.0.F9 (emitted by
// the probe battery) declared the spec + completeness verifier, and
// M14.0.SPEC (emitted by `completeness-inventory.ts`) declared only its
// verifier. Two consequences, and the second is the serious one: editing the
// probe battery failed F8's freshness over work F8 does not depend on, while
// editing F8's REAL producer left F8 passing — a stale artifact that cannot be
// told from a current one, which is this check's entire job.
//
// The producers are derived from the source rather than declared a second
// time, so this map cannot drift from the code it describes.
const PRODUCER_DIR = path.join(ROOT, "script", "m14")
const producerSources = fs.readdirSync(PRODUCER_DIR).filter((f) => f.endsWith(".ts"))
  .map((f) => ({ rel: `script/m14/${f}`, src: fs.readFileSync(path.join(PRODUCER_DIR, f), "utf8") }))
function produces(id: string, file: { rel: string; src: string }): boolean {
  return new RegExp(`issueId:\\s*"${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(file.src)
}
const coversProducer = (inputs: string[], rel: string) => inputs.some((pre) => rel.startsWith(pre))
let producerChecked = 0
for (const id of REQUIRED_EVIDENCE) {
  const inputs = EVIDENCE_INPUTS[id]
  if (!inputs) continue // the default set already spans script/
  const owners = producerSources.filter((f) => produces(id, f)).map((f) => f.rel)
  if (!owners.length) { fail(`${id}: no producer under script/m14/ emits this id`); continue }
  if (!owners.some((o) => coversProducer(inputs, o))) {
    fail(`${id}: declared inputs do not cover its producer — emitted by ${owners.join(", ")}, declared ${inputs.join(" ")}`)
    continue
  }
  producerChecked++
}
pass(`every declared input set covers its artifact's producer (${producerChecked} artifact(s))`)
// The rule must discriminate in both directions, from the real producers:
// F9's own producer is covered by F9's inputs, and F8's producer is NOT covered
// by F9's inputs (so the predicate can fail, rather than passing for every set).
const f9ProducerCovered = producerSources.filter((f) => produces("M14.0.F9", f)).some((f) => coversProducer(EVIDENCE_INPUTS["M14.0.F9"], f.rel))
const f8ProducerInF9Set = producerSources.filter((f) => produces("M14.0.F8", f)).some((f) => coversProducer(EVIDENCE_INPUTS["M14.0.F9"], f.rel))
if (!f9ProducerCovered) fail("producer coverage is vacuous: F9's own producer is not covered by F9's declared inputs")
else if (f8ProducerInF9Set) fail("producer coverage cannot fail: F8's producer passes under F9's inputs")
else pass("producer coverage discriminates (F9's own producer covered, F8's producer not covered by F9's inputs)")

// The rule must discriminate in both directions, proven from this repository's
// own history rather than by stubbing the predicate: against the ROOT commit
// every declared input set must show changes, and against each artifact's own
// lineage it must show none for the artifacts just counted fresh.
const rootCommit = execSync("git rev-list --max-parents=0 HEAD", { cwd: ROOT }).toString().trim().split("\n").pop() as string
const probePrefixes = EVIDENCE_INPUTS["M14.0.F3"] ?? []
if (probePrefixes.length && rootCommit) {
  const sinceRoot = changedInputs(rootCommit, probePrefixes)
  if (!sinceRoot.length) fail("freshness rule is vacuous: no input registers as changed since the root commit")
  else pass(`freshness rule discriminates (${sinceRoot.length} input(s) changed since ${rootCommit.slice(0, 7)})`)
}
if (freshCount === 0) fail("freshness rule flags every artifact — it cannot distinguish current from stale")

// 7. completeness ledger present and alive
const LEDGER = path.join(ROOT, "docs", "M14-COMPLETENESS-LEDGER.md")
if (!fs.existsSync(LEDGER)) {
  fail("completeness ledger missing: docs/M14-COMPLETENESS-LEDGER.md")
} else {
  const ledger = fs.readFileSync(LEDGER, "utf8")
  for (const section of ["Matrix 1", "Matrix 2", "Matrix 3", "Matrix 4", "Matrix 5", "Standing rules"]) {
    if (!ledger.includes(section)) fail(`ledger missing section: ${section}`)
  }
  const pendingCount = (ledger.match(/PENDING/g) ?? []).length
  if (pendingCount === 0) fail("ledger shows zero PENDING cells — either complete (implausible) or dishonestly edited")
  // Every PENDING cell must cite its tracking issue (#NNN) nearby on the same line
  const lines = ledger.split("\n")
  const uncited = lines.filter(l => l.includes("PENDING") && !l.includes("#") && !l.includes("M15") && !l.includes("cells tracked") && l.trim().startsWith("|"))
  if (uncited.length > 0) {
    for (const u of uncited.slice(0, 5)) fail(`PENDING cell without issue citation: ${u.trim().slice(0, 90)}`)
  }
  pass(`completeness ledger present (${pendingCount} PENDING cells tracked)`)
}

if (failures > 0) {
  console.error(`\nhonesty gate: ${failures} failure(s) — release blocked`)
  process.exit(6)
}
console.log("\nhonesty gate: all checks passed")
