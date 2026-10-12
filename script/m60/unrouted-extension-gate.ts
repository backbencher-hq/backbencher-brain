/**
 * THE UNROUTED-EXTENSION GATE — the class's enforcement, and the one piece of durable work the census named.
 *
 * WHY IT EXISTS. The unrouted-extension class cost three documented fixes in one week — `.mts` (18,586 symbols
 * invisible in this repository alone), `.cts` (3,118 files), `.graphqls` (97 files, 83,371 symbols and 195,108
 * relationships through a grammar the fleet already had). Each was found BY HAND, one lane at a time. The census
 * (`unrouted-extension-census.ts`) then measured the whole class at 1,058 refused keys and 147 fixable ones —
 * and named its own missing piece in as many words: a NEW unrouted extension still fails nothing, so the class
 * can regrow silently. This gate is that failure.
 *
 * WHAT IT CLAIMS, EXACTLY. No extension-shaped, TEXT-BEARING key the corpus carries is refused by the router
 * with neither a census row nor a ruling. It claims nothing about keys already registered: an entry may grow
 * without failing this gate — re-pricing is the census's job, not an admission check's (declared in
 * `boundaries`).
 *
 * THE BASELINE IS THE CENSUS ARTIFACT, not a hand-made list: `rows[].ext` are the keys a live walk refused and
 * measured, and `routedSinceMeasured[].ext` are the ones a fix has since re-admitted. The rulings artifact adds
 * keys a human ruling has closed. Growing the register therefore means running the census (a measurement with
 * file counts, buckets and prices) or recording a ruling — never editing a list to silence the gate.
 *
 * WHY FRAGMENTS AND BINARY KEYS DO NOT FAIL. The census's own taxonomy says so, measured: a filename FRAGMENT
 * (`.sh with --install should install the default`) is not a work item, and a binary-only key is "nothing should
 * route it". Both are recorded, classified and printed; neither is a defect. Only an extension-shaped,
 * text-bearing key with no row and no ruling is.
 *
 * EXIT CODES. 0 PASS · 1 FAIL (a new text-bearing key, a self-test failure, or a walk/router disagreement) ·
 * 2 CANNOT ADJUDICATE (corpus absent, or baseline absent/unreadable) — 2 is never a pass, because a gate that
 * cannot measure must not report clean.
 *
 * RUN: npx tsx script/m60/unrouted-extension-gate.ts
 *
 * LOCAL CHAIN, NOT GITHUB CI — stated rather than implied. The population is the machine-local corpus, so this
 * gate is wired into the local `npm run verify` chain beside M60's other gates (the same reason M19's legs need
 * a local intellij checkout). GitHub runners have neither the corpus nor the disk; `verify:fast` is exactly the
 * runner-certified subset (asserted by script/m36/verify-verify-fast.ts) and must not gain this leg.
 *
 * SELF-TESTS. A rule that cannot fail is decoration, so every run builds four synthetic git corpora and asserts
 * the verdict on each: a new text key FAILS, a new binary key is classified binary-only and PASSES, a
 * registered key (`.pyx`) PASSES as known, and a routed key is not refused at all. They run the same
 * `walkCorpus` + `adjudicate` code path as the real measurement — an end-to-end control, not a stub.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { isExtensionShaped, looksText, routerDisagreements, walkCorpus, type ExtensionWalk } from "./corpus-extension-walk"

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const BASELINE_PATH = process.env.BB_UEG_BASELINE ?? path.join(REPO_ROOT, "validation/m14/measurements/unrouted-extension-census.json")
const RULINGS_PATH = process.env.BB_UEG_RULINGS ?? path.join(REPO_ROOT, "validation/m60/results/unrouted-extension-rulings.json")
const OUT = process.env.BB_UEG_OUT ?? path.join(REPO_ROOT, "validation/m60/results/unrouted-extension-gate.json")
/** Declared cap: how many files of a NEW key are sniffed for text. In `scope`, never implied. */
const SNIFF_FILES = Number(process.env.BB_UEG_SNIFF ?? "4")
/**
 * THE GATE'S HONEST BOUNDARIES — written into every artifact, because a gate that overstates what it covers is
 * how the class it exists for regrew in the first place.
 */
const GATE_BOUNDARIES = [
  "The gate adjudicates KEY membership, not size: a key already registered may grow arbitrarily without failing. Re-pricing is the census's job (edit nothing; run it), and this gate cannot do that arithmetic.",
  `A new key is text-classified by a DECLARED sample — the first ${SNIFF_FILES} file(s) in walk order, read through the census's own text rule. A key whose sampled files are all binary passes as binary-only; a text file beyond the sample is not seen.`,
  "A new key that is a filename FRAGMENT does not fail — the census's own standard (fragments are counted, labelled, and are never work items).",
  "The corpus is machine-local, so this gate cannot run on a CI runner; it belongs to the local `npm run verify` chain, like M19's checkout-dependent legs. GitHub CI runs the runner-certified `verify:fast` subset, which must not gain this leg.",
  "Exit 2 (cannot adjudicate) is never a pass: a missing corpus or a missing/unreadable baseline stops the gate's claim entirely rather than reporting clean.",
]

type KeyClass = "text-bearing" | "binary-only" | "name-fragment"
type NewKey = {
  ext: string
  files: number
  bytes: number
  repos: number
  examples: string[]
  nameShape: "extension-shaped" | "suspect-name-fragment"
  /** Of the sampled files, how many carry text; `sampled` is which stride was read (first N in walk order). */
  textOfSampled: number
  sampled: number
  class: KeyClass
}

/**
 * THE CHECKER — pure over the walk and the known set, and THE SAME FUNCTION the self-tests exercise. The gate's
 * verdict is `failKeysOf(adjudicate(...))`, so a control that proves the checker catches a synthetic key proves
 * the real run's rule, not a re-implementation of it.
 */
function adjudicate(walk: ExtensionWalk, known: Map<string, string>): { refused: string[]; newKeys: NewKey[]; knownKeysStillRefused: number } {
  const refused = [...walk.buckets.keys()].sort()
  const newKeys: NewKey[] = []
  let knownKeysStillRefused = 0
  for (const ext of refused) {
    if (known.has(ext)) {
      knownKeysStillRefused++
      continue
    }
    const files = walk.buckets.get(ext)!
    const sampled = files.slice(0, SNIFF_FILES)
    const textOfSampled = sampled.filter((f) => looksText(f.abs)).length
    const nameShape: NewKey["nameShape"] = isExtensionShaped(ext) ? "extension-shaped" : "suspect-name-fragment"
    newKeys.push({
      ext,
      files: files.length,
      bytes: files.reduce((s, f) => s + f.size, 0),
      repos: new Set(files.map((f) => f.repo)).size,
      examples: files.slice(0, 3).map((f) => `${f.repo}/${f.rel}`),
      nameShape,
      textOfSampled,
      sampled: sampled.length,
      class: nameShape === "suspect-name-fragment" ? "name-fragment" : textOfSampled > 0 ? "text-bearing" : "binary-only",
    })
  }
  return { refused, newKeys, knownKeysStillRefused }
}
const failKeysOf = (newKeys: NewKey[]): NewKey[] => newKeys.filter((k) => k.class === "text-bearing")
const verdictOf = (newKeys: NewKey[]): "PASS" | "FAIL" => (failKeysOf(newKeys).length > 0 ? "FAIL" : "PASS")

type KnownSource = { path: string; kind: string; generatedAt: string | null; keys: number; present: boolean; problem?: string }

/** The register: census rows + rows a fix has since re-admitted + keys a ruling has closed (all unioned). */
function loadKnown(): { known: Map<string, string>; sources: KnownSource[]; baselineProblem: string | null } {
  const known = new Map<string, string>()
  const sources: KnownSource[] = []
  let baselineProblem: string | null = null
  if (!existsSync(BASELINE_PATH)) {
    baselineProblem = `the census baseline ${path.relative(REPO_ROOT, BASELINE_PATH)} is absent — the gate has no register to admit keys against, so it cannot adjudicate (this is exit 2, never a pass)`
    sources.push({ path: BASELINE_PATH, kind: "m60-unrouted-extension-census", generatedAt: null, keys: 0, present: false, problem: baselineProblem })
    return { known, sources, baselineProblem }
  }
  try {
    const b = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Record<string, any>
    const rows: any[] = Array.isArray(b.rows) ? b.rows : []
    const routed: any[] = Array.isArray(b.routedSinceMeasured) ? b.routedSinceMeasured : []
    for (const r of rows) if (typeof r?.ext === "string") known.set(r.ext, "census-row")
    for (const r of routed) if (typeof r?.ext === "string" && !known.has(r.ext)) known.set(r.ext, "routed-since-measured")
    sources.push({ path: BASELINE_PATH, kind: String(b.kind ?? "unknown"), generatedAt: b.generatedAt ?? null, keys: rows.length + routed.length, present: true })
  } catch (e: any) {
    baselineProblem = `the census baseline ${path.relative(REPO_ROOT, BASELINE_PATH)} exists but does not parse (${String(e?.message ?? e).slice(0, 120)}) — cannot adjudicate`
    sources.push({ path: BASELINE_PATH, kind: "unreadable", generatedAt: null, keys: 0, present: false, problem: baselineProblem })
    return { known, sources, baselineProblem }
  }
  if (!existsSync(RULINGS_PATH)) {
    sources.push({ path: RULINGS_PATH, kind: "m60-unrouted-extension-rulings", generatedAt: null, keys: 0, present: false, problem: "absent — keys closed by a ruling are then only admitted through the census rows; reported rather than assumed" })
    return { known, sources, baselineProblem }
  }
  try {
    const rj = JSON.parse(readFileSync(RULINGS_PATH, "utf8")) as Record<string, any>
    const rows: any[] = Array.isArray(rj.rows) ? rj.rows : []
    let added = 0
    for (const r of rows) if (typeof r?.ext === "string" && !known.has(r.ext)) { known.set(r.ext, "ruling"); added++ }
    sources.push({ path: RULINGS_PATH, kind: String(rj.kind ?? "unknown"), generatedAt: rj.generatedAt ?? null, keys: rows.length, present: true, problem: added > 0 ? `${added} key(s) admitted by ruling that the census baseline does not carry` : undefined })
  } catch (e: any) {
    sources.push({ path: RULINGS_PATH, kind: "unreadable", generatedAt: null, keys: 0, present: false, problem: String(e?.message ?? e).slice(0, 120) })
  }
  return { known, sources, baselineProblem }
}

// ---------------------------------------------------------------- self-tests: synthetic git corpora
type SelfTest = { name: string; ok: boolean; detail: string }
/** Build a one-repo corpus in a temp dir; a git repo because that is the walk's population (git ls-files). */
function makeSyntheticCorpus(files: Record<string, string | Buffer>): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "bb-ueg-selftest-"))
  const repo = path.join(root, "repo")
  mkdirSync(repo)
  execFileSync("git", ["init", "-q"], { cwd: repo, stdio: "ignore" })
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(repo, name), content)
  execFileSync("git", ["add", "-A"], { cwd: repo, stdio: "ignore" })
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}
const runOnSynthetic = (files: Record<string, string | Buffer>, known: Map<string, string>): { walk: ExtensionWalk; newKeys: NewKey[]; verdict: "PASS" | "FAIL"; cleanup: () => void } => {
  const { root, cleanup } = makeSyntheticCorpus(files)
  const walk = walkCorpus({ corpusRoot: root, settledExtensions: [], detectText: false })
  const { newKeys } = adjudicate(walk, known)
  return { walk, newKeys, verdict: verdictOf(newKeys), cleanup }
}
function runSelfTests(known: Map<string, string>): SelfTest[] {
  const tests: SelfTest[] = []
  // A — a NEW text-bearing extension must FAIL. This is the whole point of the gate; if this case cannot fail,
  // nothing below it means anything.
  {
    const r = runOnSynthetic({ "a.zzz9gate": "export const x = 1\n" }, known)
    const k = r.newKeys.find((x) => x.ext === ".zzz9gate")
    tests.push({
      name: "negative: a new TEXT-BEARING extension FAILS the gate",
      ok: r.verdict === "FAIL" && k?.class === "text-bearing" && r.newKeys.length === 1,
      detail: `verdict ${r.verdict}, keys ${JSON.stringify(r.newKeys.map((x) => `${x.ext}:${x.class}`))}`,
    })
    r.cleanup()
  }
  // B — a new BINARY-only key is classified and does NOT fail (the census's taxonomy: nothing should route it).
  {
    const r = runOnSynthetic({ "b.zzz8gate": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a, 0x0a]) }, known)
    const k = r.newKeys.find((x) => x.ext === ".zzz8gate")
    tests.push({
      name: "a new BINARY-ONLY key is classified and passes",
      ok: r.verdict === "PASS" && k?.class === "binary-only",
      detail: `verdict ${r.verdict}, keys ${JSON.stringify(r.newKeys.map((x) => `${x.ext}:${x.class}`))}`,
    })
    r.cleanup()
  }
  // C — a REGISTERED key stays admitted (the census carries `.pyx`, whose ruling retired it). Also asserts the
  // key really IS refused by the router, so the test cannot pass vacuously via a routed extension.
  {
    const r = runOnSynthetic({ "c.pyx": "cdef int x\n" }, known)
    const refusedButKnown = r.walk.buckets.has(".pyx") && r.newKeys.length === 0
    tests.push({
      name: "a registered refused key (.pyx) passes as known",
      ok: r.verdict === "PASS" && refusedButKnown,
      detail: `refused=${r.walk.buckets.has(".pyx")}, newKeys=${r.newKeys.length}, verdict ${r.verdict}`,
    })
    r.cleanup()
  }
  // D — a ROUTED extension is not refused at all: the walk's admission test is the router's, so there is
  // nothing to adjudicate. Guards against a gate that would fire on files the fleet already reads.
  {
    const r = runOnSynthetic({ "d.ts": "export const y = 2\n" }, known)
    tests.push({
      name: "a routed extension (.ts) is not refused at all",
      ok: r.verdict === "PASS" && r.walk.buckets.size === 0 && r.walk.routedExts.has(".ts"),
      detail: `refusedKeys=${r.walk.buckets.size}, routed observed=${r.walk.routedExts.has(".ts")}`,
    })
    r.cleanup()
  }
  return tests
}

// ---------------------------------------------------------------- the measurement
const started = Date.now()
const { known, sources, baselineProblem } = loadKnown()

const writeArtifact = (body: Record<string, unknown>): void => {
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(body, null, 2) + "\n")
}

if (baselineProblem !== null) {
  const selfTests = runSelfTests(known)
  const artifact = {
    schemaVersion: 1,
    kind: "m60-unrouted-extension-gate",
    generatedAt: new Date().toISOString(),
    producedBy: "script/m60/unrouted-extension-gate.ts",
    verdict: "cannot-adjudicate",
    exitCode: 2,
    reason: baselineProblem,
    knownSources: sources,
    selfTests,
    scope: { corpusRoot: CORPUS, corpusPresent: existsSync(CORPUS), sniffFiles: SNIFF_FILES },
    boundaries: GATE_BOUNDARIES,
  }
  writeArtifact(artifact)
  console.log(`\nunrouted-extension gate — CANNOT ADJUDICATE (exit 2)\n  ${baselineProblem}`)
  process.exit(2)
}

if (!existsSync(CORPUS)) {
  const selfTests = runSelfTests(known)
  const reason = `the corpus ${CORPUS} is absent — this gate's population is machine-local (BB_CORPUS_ROOT), and it refuses to report clean on a corpus it could not walk`
  writeArtifact({
    schemaVersion: 1,
    kind: "m60-unrouted-extension-gate",
    generatedAt: new Date().toISOString(),
    producedBy: "script/m60/unrouted-extension-gate.ts",
    verdict: "cannot-adjudicate",
    exitCode: 2,
    reason,
    knownSources: sources,
    selfTests,
    scope: { corpusRoot: CORPUS, corpusPresent: false, sniffFiles: SNIFF_FILES },
    boundaries: GATE_BOUNDARIES,
  })
  console.log(`\nunrouted-extension gate — CANNOT ADJUDICATE (exit 2)\n  ${reason}`)
  process.exit(2)
}

console.log(`unrouted-extension gate — ${CORPUS}`)
const walkStarted = Date.now()
const walk = walkCorpus({ corpusRoot: CORPUS, settledExtensions: [], detectText: false })
const walkMs = Date.now() - walkStarted
const { refused, newKeys, knownKeysStillRefused } = adjudicate(walk, known)
const failKeys = failKeysOf(newKeys)
const verdict = verdictOf(newKeys)
const gateCheck = routerDisagreements(walk.buckets)
const sniffMs = Date.now() - walkStarted - walkMs
const selfTests = runSelfTests(known)
const selfTestsOk = selfTests.every((t) => t.ok)
const gateDisagreementFail = gateCheck.disagreements.length > 0
const exitCode = !selfTestsOk || gateDisagreementFail || verdict === "FAIL" ? 1 : 0

const knownKeysNoLongerRefused = [...known.keys()].filter((k) => !walk.buckets.has(k)).length
const byShape = { "extension-shaped": refused.filter((k) => isExtensionShaped(k)).length, "suspect-name-fragment": refused.filter((k) => !isExtensionShaped(k)).length }

console.log(`  walk: ${walk.filesScanned.toLocaleString()} tracked file(s) across ${walk.reposWalked.length} repo(s) in ${(walkMs / 1000).toFixed(1)}s · ${walk.overCap} over the 1MB cap not bucketed`)
console.log(`  register: ${known.size} known key(s) from ${sources.filter((s) => s.present).length} source(s) · refused now: ${refused.length} (${byShape["extension-shaped"]} extension-shaped, ${byShape["suspect-name-fragment"]} fragments) · still refused and known: ${knownKeysStillRefused} · known but no longer refused: ${knownKeysNoLongerRefused}`)
console.log(`  new keys: ${newKeys.length} (text-bearing ${failKeys.length}, binary-only ${newKeys.filter((k) => k.class === "binary-only").length}, fragments ${newKeys.filter((k) => k.class === "name-fragment").length})`)
console.log(`  single gate asserted on ${gateCheck.filesChecked.toLocaleString()} file(s): ${gateCheck.disagreements.length} disagreement(s)`)
for (const k of failKeys) {
  console.log(`  FAIL KEY ${k.ext} — ${k.files} file(s), ${(k.bytes / 1e6).toFixed(2)} MB, ${k.repos} repo(s); text in ${k.textOfSampled}/${k.sampled} sampled file(s)`)
  for (const e of k.examples) console.log(`      e.g. ${e} (the router refuses it; neither the census nor a ruling carries it)`)
}
for (const t of selfTests) console.log(`  ${t.ok ? "ok  " : "FAIL"}: ${t.name} — ${t.detail}`)

const artifact = {
  schemaVersion: 1,
  kind: "m60-unrouted-extension-gate",
  generatedAt: new Date().toISOString(),
  producedBy: "script/m60/unrouted-extension-gate.ts",
  question: "does the corpus carry an extension-shaped, text-bearing key that the router refuses with neither a census row nor a ruling?",
  verdict,
  exitCode,
  /** What the verdict is made of, in order: a broken checker outranks a regrowth finding, which outranks pass. */
  verdictBreakdown: {
    selfTestsOk,
    selfTestsFailed: selfTests.filter((t) => !t.ok).map((t) => t.name),
    gateDisagreements: gateCheck.disagreements.length,
    textBearingNewKeys: failKeys.length,
  },
  failKeys,
  newKeys,
  knownSources: sources,
  scope: {
    corpusRoot: CORPUS,
    reposWalked: walk.reposWalked,
    filesScanned: walk.filesScanned,
    filesOverTheCapNotBucketed: walk.overCap,
    refusedKeysNow: refused.length,
    refusedKeysByShape: byShape,
    knownKeys: known.size,
    knownKeysStillRefused,
    knownKeysNoLongerRefused,
    newKeysByClass: {
      "text-bearing": failKeys.length,
      "binary-only": newKeys.filter((k) => k.class === "binary-only").length,
      "name-fragment": newKeys.filter((k) => k.class === "name-fragment").length,
    },
    sniffFilesPerNewKey: SNIFF_FILES,
    sniffMethod: `first ${SNIFF_FILES} file(s) of each new key in walk order, read through the census's own text rule (corpus-extension-walk.ts) — the stride is declared, not random`,
  },
  singleGate: {
    claim: "`parallel-indexer.ts:693` — `hasValidExtension(p) === (detectLanguageFromPath(p) !== null)`, so an unrouted extension is never admitted to the store either. Asserted here by the shared `routerDisagreements`, the same rule the census asserts.",
    filesChecked: gateCheck.filesChecked,
    disagreements: gateCheck.disagreements,
  },
  selfTests,
  boundaries: GATE_BOUNDARIES,
  timing: { walkedMs: walkMs, sniffedMs: sniffMs, totalMs: Date.now() - started },
}
writeArtifact(artifact)
console.log(`\nverdict: ${verdict}${exitCode === 0 ? "" : ` (exit ${exitCode}${gateDisagreementFail ? " — the walk and the router DISAGREE, the measurement itself is broken" : ""}${!selfTestsOk ? " — a self-test failed, the checker itself is broken" : ""})`}`)
console.log(`artifact: ${path.relative(REPO_ROOT, OUT)}`)
process.exit(exitCode)
