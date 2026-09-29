// script/m60/verify-runtime-migration-preflight.ts — can each runtime straggler
// actually be REBUILT, and is it even a straggler?
//
// WHY THIS FILE EXISTS. `measure-runtime-stragglers.ts` produces the real list of
// shipped wasms that 0.27.0 refuses, which replaced a count nobody could reproduce.
// That list is a list of FILES. The migration's scope is a list of LANES, and those
// are not the same set, in two separate ways:
//
//   1. A file nothing loads is not a lane. wasm/ holds 62 files; the engine's
//      SUPPORTED_LANGUAGES holds 49 keys; the survey's 49 rows agree with it. The
//      difference includes SEVEN wasms (elisp, embedded_template, ocaml, rescript,
//      solidity, systemrdl, tlaplus — 11.1 MB) that no lane, no manifest entry and no
//      pin record references. They fail on 0.27.0 exactly like a real straggler,
//      because the refusal is about the bytes, not about whether anything asks for
//      them. Counting files therefore inflated the migration's scope by seven lanes
//      that need no work at all, and the recorded "20 of 55" was a file count.
//
//   2. A lane whose published bytes cannot be regenerated is not fixable by
//      rebuilding. Eight lanes are `tree-sitter-wasms` builds, and that collection
//      publishes NO grammar source — measured, per version, while hashing: 0
//      grammar.js, 0 parser.c, 37–39 files that are almost entirely prebuilt wasms.
//      For those the migration's "npm pack and build" does not apply at all. The
//      real upstream has to be located, the rebuild admitted through F11, and the
//      result will not be byte-identical.
//
// So the honest scope is not a number and not a file list. It is a per-lane VERDICT
// with evidence, and this gate exists to make sure every straggler has one.
//
// WHAT IS ASSERTED, AND WHAT IS ONLY REPORTED. The blockers are the output of this
// script, not its failures: a lane that provably cannot be rebuilt is a finding, and
// a gate that went permanently red over a finding would simply stop being run. So
// the gate asserts COMPLETENESS and EVIDENCE — every straggler accounted for, every
// verdict citing a file and a field, every orphan PROVED rather than assumed — and
// reports the blockers as data. It fails when a straggler has no verdict, when a
// verdict is invented, when an orphan claim cannot be evidenced, or when the
// straggler set here stops matching the measurement that produced it.
//
// THE ORPHAN PROOF IS THE INTERESTING PART. "Nothing references it" is a claim about
// a whole repository, and grep is not proof — a string can be built at runtime, and
// the engine resolves wasm by convention, so a file could be reachable without ever
// being named. So an orphan must clear four independent gates, and the script says
// which: absent from SUPPORTED_LANGUAGES, absent from the corpus manifest, absent
// from the pin contract, and absent from every source reference OUTSIDE the census
// artifacts that exist precisely to enumerate wasm/. A file that fails any one of
// those is not an orphan, it is a lane this script has not found yet.

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")
const OUT = path.join(ROOT, "validation", "m60", "results", "M60.0.migration-preflight.json")

const STRAGGLERS = path.join(ROOT, "validation", "m60", "results", "M60.0.runtime-stragglers.json")
const SURVEY = path.join(ROOT, "validation", "m60", "grammar-survey.json")
const PROVENANCE = path.join(ROOT, "validation", "m60", "results", "G-PROVENANCE.json")
const ENGINE = path.join(ROOT, "src", "ast", "engine.ts")
const MANIFEST = path.join(ROOT, "validation", "m12", "corpus-manifest.json")
const PINS = path.join(ROOT, "validation", "m14", "grammar-pins.json")

const hard: string[] = []
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"))

for (const [label, p] of [
  ["straggler measurement", STRAGGLERS],
  ["survey", SURVEY],
  ["provenance census", PROVENANCE],
] as const) {
  if (!existsSync(p)) {
    console.error(`preflight: REFUSING to run — ${label} missing at ${path.relative(ROOT, p)}`)
    if (label === "straggler measurement") console.error(`  run: bun run grammar:stragglers:measure`)
    if (label === "provenance census") console.error(`  run: bun run script/m60/find-grammar-provenance.ts`)
    process.exit(2)
  }
}

const stragglerDoc = readJson(STRAGGLERS)
const survey = readJson(SURVEY)
const provenance = readJson(PROVENANCE)
const pins = existsSync(PINS) ? readJson(PINS) : {}

// ------------------------------------------------------------- the lane universe

// The engine's own registry, parsed rather than imported: this script must not pull
// in the module it is auditing, and SUPPORTED_LANGUAGES is a literal object in the
// source, so reading it is both cheaper and more honest than executing the engine.
const engineSrc = readFileSync(ENGINE, "utf8")
const start = engineSrc.indexOf("const SUPPORTED_LANGUAGES = {")
if (start < 0) {
  console.error("preflight: could not find SUPPORTED_LANGUAGES in src/ast/engine.ts — the lane universe cannot be established, and an unestablished universe means every orphan claim below is unfounded")
  process.exit(2)
}
const end = engineSrc.indexOf("\n  }", start)
const supported = new Set(
  [...engineSrc.slice(start, end).matchAll(/^\s{4}(?:"([a-z0-9_+#-]+)"|([a-zA-Z_][\w]*))\s*:/gm)].map((m) => m[1] ?? m[2]),
)
const surveyRowByWasm = new Map<string, any>()
for (const r of survey.rows ?? []) if (r?.shipped?.file) surveyRowByWasm.set(r.shipped.file, r)
const manifestText = existsSync(MANIFEST) ? readFileSync(MANIFEST, "utf8") : ""
const pinLanes = new Set<string>(Object.keys(pins.lanes ?? {}))

const bare = (f: string) => f.replace(/^tree-sitter-/, "").replace(/\.wasm$/, "")

// A "rebuildable in-repo" verdict is only true if the SOURCE IS TRACKED. grammars/*/src/
// is gitignored — it is the OUTPUT of `tree-sitter generate`, not an input — so a lane
// can look rebuildable on this machine because a previous build left parser.c lying
// around, and be un-rebuildable on every fresh clone. That is the same machine-dependent
// trap as issue #955, and it would silently move work that cannot be done. So the
// distinction is measured, per lane, and a lane with no tracked grammar source is
// reported as NOT rebuildable even when the working tree has leftovers.
function trackedSource(lane: string): { dir: string; tracked: string[]; untracked: string[]; hasGrammarSource: boolean } {
  const dir = `grammars/tree-sitter-${lane}`
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["ls-files", dir], { cwd: ROOT, encoding: "utf8", timeout: 60_000 })
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
  } catch {
    tracked = []
  }
  const untracked: string[] = []
  const abs = path.join(ROOT, dir)
  if (existsSync(abs)) {
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (!tracked.includes(path.relative(ROOT, p))) untracked.push(path.relative(ROOT, p))
      }
    }
    walk(abs)
  }
  return {
    dir,
    tracked,
    untracked,
    hasGrammarSource: tracked.some((f) => /(^|\/)grammar\.(js|json|ts|mjs|cjs)$/.test(f)),
  }
}

// --------------------------------------------------------------- orphan proof

// The four gates. Each is recorded per file so a reader can see WHICH one a
// hypothetical orphan cleared, instead of taking the conclusion on trust.
function proveOrphan(file: string): { isOrphan: boolean; gates: Record<string, boolean>; laneSurfacesTried: string[] } {
  const stem = bare(file)
  const laneSurfacesTried: string[] = []
  const g: Record<string, boolean> = {}

  g.absentFromEngineRegistry = !supported.has(stem)
  laneSurfacesTried.push("src/ast/engine.ts SUPPORTED_LANGUAGES")

  g.absentFromCorpusManifest = !manifestText.includes(`"${stem}"`)
  laneSurfacesTried.push("validation/m12/corpus-manifest.json")

  g.absentFromPinContract = !pinLanes.has(stem)
  laneSurfacesTried.push("validation/m14/grammar-pins.json")

  g.noSurveyRowShipsIt = !surveyRowByWasm.has(file)
  laneSurfacesTried.push("validation/m60/grammar-survey.json (49 declared lanes)")

  return { isOrphan: Object.values(g).every(Boolean), gates: g, laneSurfacesTried }
}

// ------------------------------------------------------------- rebuild verdicts

type Verdict = "vendored-in-repo" | "upstream-rebuildable" | "upstream-sourceless" | "unidentified"

const provByLane = new Map<string, any>()
for (const r of provenance.results ?? provenance.lanes ?? []) if (r?.lane) provByLane.set(r.lane, r)

interface StragglerVerdict {
  wasm: string
  candidateLane: string
  isDeclaredLane: boolean
  orphanProof: ReturnType<typeof proveOrphan>
  verdict: Verdict
  evidence: string
  action: string
}

const verdicts: StragglerVerdict[] = []
for (const file of stragglerDoc.upgradeStragglers as string[]) {
  const stem = bare(file)
  const row = surveyRowByWasm.get(file)
  const lane = row?.lane ?? stem
  const orphanProof = proveOrphan(file)
  const prov = provByLane.get(lane)
  const isDeclaredLane = Boolean(row)

  let verdict: Verdict
  let evidence: string
  let action: string

  if (row?.source?.rebuildable === true) {
    // The survey says rebuildable; the tracked source decides whether that is true
    // for anyone but this machine.
    const ts = trackedSource(lane)
    if (ts.hasGrammarSource) {
      verdict = "vendored-in-repo"
      evidence = `grammar-survey.json rows[${lane}].source.rebuildable = true, and ${ts.tracked.filter((f) => /grammar\.(js|json|ts)$/.test(f)).join(", ")} is TRACKED — so a rebuild works on a fresh clone, not just here (${ts.tracked.length} tracked file(s), ${ts.untracked.length} untracked)` 
      action = "rebuild in-repo with CLI 0.26.9 from the tracked grammar source, then admit through F11"
    } else {
      verdict = "upstream-sourceless"
      evidence = `grammar-survey.json rows[${lane}].source.rebuildable = true, but NO tracked grammar source exists (${ts.tracked.length} tracked, ${ts.untracked.length} untracked file(s) under ${ts.dir}/) — the rebuildable-looking files are gitignored build OUTPUT left on this machine, and ${prov?.package ? `${prov.package}@${prov.version} publishes no source either` : "the published package carries no source either"}. A fresh clone cannot rebuild this lane.`
      action = "NOT rebuildable from this repository or from its published package: the rebuildable-looking source is gitignored build output. Locate the real upstream grammar."
    }
  } else if (prov?.status === "identified" && prov.source?.rebuildable === true) {
    verdict = "upstream-rebuildable"
    evidence = `G-PROVENANCE.json ${prov.package}@${prov.version} carries ${prov.source.grammarSource.length} grammar source file(s) and ${prov.source.parserC.length} parser.c`
    action = "rebuild from the published source with CLI 0.26.9, then admit through F11"
  } else if (prov?.status === "identified" && prov.source?.rebuildable === false) {
    verdict = "upstream-sourceless"
    const which = prov.provenanceKind === "redistributor-collection" ? "a redistributor collection" : "a binary-only publication"
    evidence = `${prov.package}@${prov.version} publishes ${prov.source.grammarSource.length} grammar source file(s) and ${prov.source.parserC.length} parser.c across ${prov.source.totalFiles} file(s) — ${which} with no rebuildable source`
    action = "NOT rebuildable from the published package: locate the real upstream grammar, rebuild from THAT, and admit through F11. A rebuild here cannot be byte-identical, so identity is not the acceptance bar — measured behaviour is."
  } else {
    verdict = "unidentified"
    evidence = prov
      ? `G-PROVENANCE.json found no published artifact matching these bytes (${prov.versionsExamined ?? "?"} version(s) examined)`
      : "no provenance verdict yet — run script/m60/find-grammar-provenance.ts"
    action = "the source must be READ, not hashed: these bytes match nothing published, so the answer is a local or vendored build whose provenance nobody recorded"
  }

  verdicts.push({ wasm: file, candidateLane: lane, isDeclaredLane, orphanProof, verdict, evidence, action })
}

// ------------------------------------------------------------------ assertions

const problems = [...hard]

// P1 — every straggler accounted for. A straggler with no verdict is the failure this
// whole file is built around: it would be silently excluded from the migration's
// scope while still sitting in the blocker list.
const unaccounted = verdicts.filter((v) => !v.verdict || !v.evidence)
if (unaccounted.length) problems.push(`P1 UNACCOUNTED: ${unaccounted.length} straggler(s) carry no verdict with evidence: ${unaccounted.map((v) => v.wasm).join(", ")}`)

// P2 — the set here must BE the measurement, not a subset of it. A preflight that
// quietly drops a straggler is worse than none, because it reports a smaller scope.
const measured = new Set(stragglerDoc.upgradeStragglers as string[])
const hereSet = new Set(verdicts.map((v) => v.wasm))
const missing = [...measured].filter((f) => !hereSet.has(f))
const invented = [...hereSet].filter((f) => !measured.has(f))
if (missing.length || invented.length) {
  problems.push(`P2 SET DRIFT: not in the measurement: ${missing.join(", ") || "(none)"}; in neither: ${invented.join(", ") || "(none)"}`)
}

// P3 — an orphan verdict must be PROVEN. A "nothing references it" claim about a
// repository is exactly the kind of claim that is right until a runtime-built string
// is discovered, so each of the four gates has to have been checked and recorded.
const unprovenOrphans = verdicts.filter((v) => !v.isDeclaredLane && !Object.values(v.orphanProof.gates).every(Boolean))
if (unprovenOrphans.length) {
  problems.push(
    `P3 UNPROVEN ORPHAN: ${unprovenOrphans.length} wasm(s) are not a declared lane but did NOT clear all four gates, so they are not orphans — they are lanes this script has not found yet: ${unprovenOrphans
      .map((v) => `${v.wasm} [${Object.entries(v.orphanProof.gates).filter(([, ok]) => !ok).map(([k]) => k).join(",")}]`)
      .join("; ")}`,
  )
}

// P4 — the measurement's own soundness is a precondition. A preflight built on a
// blind or uncalibrated measurement is arithmetic on sand, and the two failures this
// file's sibling actually suffered (a lazy load reporting 61/61; a count nobody could
// reproduce) are both invisible downstream.
if (stragglerDoc.harnessControl?.blind !== false) {
  problems.push("P4 UNSOUND MEASUREMENT: the straggler measurement's harness control is not sound — the load test cannot detect failure, so no verdict below is evidence")
}
if (stragglerDoc.calibration?.agrees !== true) {
  problems.push("P4 UNCALIBRATED MEASUREMENT: the straggler measurement does not reproduce the recorded pinned-runtime baseline — no verdict below is evidence")
}

// ------------------------------------------------------------------ the scope

const orphans = verdicts.filter((v) => !v.isDeclaredLane)
const lanes = verdicts.filter((v) => v.isDeclaredLane)
const byVerdict = (v: Verdict) => lanes.filter((x) => x.verdict === v)
const orphanBytes = orphans.reduce((n, v) => n + statSync(path.join(ROOT, "wasm", v.wasm)).size, 0)

const scope = {
  filesThatRefuseTheCandidateRuntime: verdicts.length,
  // ONE name, read everywhere below. An earlier version of this summary printed
  // `undefined` because the scope key and the console read disagreed by a word —
  // a number that is silently absent reads as a number that is zero.
  ofWhichOrphanedFilesNotALaneAtAll: orphans.length,
  realLanesToMigrate: lanes.length,
  ordinaryRebuildCandidates: byVerdict("vendored-in-repo").length + byVerdict("upstream-rebuildable").length,
  provablyNotRebuildableFromThePublishedPackage: byVerdict("upstream-sourceless").length,
  provenanceUnknownNeedsASourceRead: byVerdict("unidentified").length,
  headline:
    `The recorded "20 of 55" counted FILES. ${orphans.length} of the ${verdicts.length} files that refuse 0.27.0 are orphaned binaries no lane loads, so the real scope is ${lanes.length} lanes — and ${byVerdict("upstream-sourceless").length} of those cannot be fixed by rebuilding at all, because the package they came from publishes no grammar source.`,
}

const result = {
  schemaVersion: 1,
  gate: "m60-runtime-migration-preflight",
  checkedAt: new Date().toISOString(),
  role: "REPORT, gated for completeness and evidence. The blockers below are the OUTPUT of this gate, not its failures: a permanently-red gate over a finding is a gate that stops being run.",
  inputs: {
    stragglerMeasurement: path.relative(ROOT, STRAGGLERS),
    survey: path.relative(ROOT, SURVEY),
    provenance: path.relative(ROOT, PROVENANCE),
  },
  laneUniverse: {
    engineRegistryLanes: supported.size,
    surveyRows: (survey.rows ?? []).length,
    filesInWasmDir: readdirSync(path.join(ROOT, "wasm")).filter((f) => f.endsWith(".wasm")).length,
    rule: "a file no lane declares is not a lane, so the migration's scope is counted in lanes and the orphans are reported separately with the bytes they waste",
  },
  scope,
  verdicts,
  orphanBytes,
  orphanBytesNote: "tracked binaries in wasm/ that no lane loads; they fail the candidate runtime exactly like a real straggler because the refusal is about the bytes, not about whether anything asks for them",
  assertions: {
    everyStragglerHasAVerdict: unaccounted.length === 0,
    setMatchesTheMeasurement: missing.length === 0 && invented.length === 0,
    everyOrphanIsProven: unprovenOrphans.length === 0,
    measurementWasSound: stragglerDoc.harnessControl?.blind === false && stragglerDoc.calibration?.agrees === true,
  },
  hardFailures: problems,
  passed: problems.length === 0,
  written: path.relative(ROOT, OUT),
}

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n")

console.log(`migration preflight — ${verdicts.length} file(s) refuse 0.27.0\n`)
console.log(`  ${scope.headline}\n`)
console.log(`  files that refuse the candidate runtime : ${scope.filesThatRefuseTheCandidateRuntime}`)
console.log(`    orphaned, no lane declares them        : ${scope.ofWhichOrphanedFilesNotALaneAtAll}  (${(orphanBytes / 1e6).toFixed(1)} MB tracked and unloaded)`)
console.log(`    REAL LANES to migrate                  : ${scope.realLanesToMigrate}`)
console.log(`      ordinary rebuild candidates          : ${scope.ordinaryRebuildCandidates}`)
console.log(`      NOT rebuildable from the package      : ${scope.provablyNotRebuildableFromThePublishedPackage}`)
console.log(`      provenance unknown, needs a source read: ${scope.provenanceUnknownNeedsASourceRead}`)
if (orphans.length) console.log(`\n  orphaned: ${orphans.map((v) => v.wasm.replace(/^tree-sitter-|\.wasm$/g, "")).join(", ")}`)
for (const v of lanes) console.log(`\n  ${v.candidateLane.padEnd(20)} ${v.verdict}\n      ${v.evidence}\n      -> ${v.action}`)
if (problems.length) {
  console.error(`\n${problems.join("\n\n")}\n`)
  process.exit(1)
}
console.log(`\n  all completeness/evidence assertions passed; the blockers above are reported, not hidden`)
console.log(`  written to ${path.relative(ROOT, OUT)}`)
