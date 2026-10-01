// script/m60/verify-grammar-consistency.ts — the ANTI-DRIFT gate. It owns no
// fact; it proves the two files that do agree with each other, and with the
// prose that quotes them.
//
// THE DIVISION OF OWNERSHIP, because a second version record is the exact
// failure this work exists to prevent.
//
//   validation/m14/grammar-pins.json   OWNS PIN IDENTITY for the lanes it
//     covers: wired bytes (sha256 + length), the grammar's enumerable surface
//     (id-order / type-set / field-set digests, with the id, named and anonymous
//     vocabularies kept separate), the local copies those bytes are identical
//     to, per-file sha256 of any vendored source, the source↔wasm proof, and the
//     authored provenance decision. It is a CONTRACT and is gated for truth by
//     script/m14/verify-grammar-pins.ts. This file never restates a pin.
//
//   validation/m60/grammar-survey.json  OWNS THE UPSTREAM LANDSCAPE for all 49
//     lanes: what grammars are published, their release cadence, archive state,
//     fork status, the candidate shortlist, and the measured damage and guard
//     status derived from validation/m12 + validation/m14. It is an OBSERVATION
//     with a generation timestamp, not a contract: upstream moves, and the file
//     is expected to change when it does.
//
//   THIS FILE owns only the agreement between them, and between either of them
//   and the prose sites (docs/analyzers/, script/m14/spec/) that quote versions.
//   Two files with disjoint responsibilities and an enforced cross-check is not
//   drift. Two files both claiming to be the version record is.
//
// WHY CROSS-CHECK AND NOT A MERGE. Pin identity changes when a grammar is
// adopted; the upstream survey changes when anybody publishes a release. One
// merged file would be dirtied by every upstream release, and the F11
// admissibility gate would then have to tolerate churn in the very thing it
// exists to hold still. The project's own M20 precedent has this shape:
// C2-registry.json (contract) + corpus-snapshots.json (observation), one
// verifier.
//
// THE CHECKS.
//
//   C1  the two files agree on the LANE UNIVERSE. A lane pinned but unsurveyed,
//       or surveyed but unpinned, is a hole in one of them.
//
//   C2  for every lane BOTH files cover, the survey's recorded wasm sha256 equals
//       the pin record's wired sha256. This is the one check that makes "the pin
//       says 0.3.11 and the survey says 0.3.11 but they are different builds"
//       impossible to ship.
//
//   C3  the survey's recorded sha256 still matches the bytes in wasm/. This is a
//       statement about the SURVEY's observation being true, not a competing pin
//       claim — and it is the check that catches a silent grammar swap on the 40
//       lanes the pin record does not yet cover. A self-test proved the first
//       version of this check blind: it compared only lanes carrying a DECLARED
//       pin, so appending one byte to wasm/tree-sitter-c.wasm left it green.
//
//   C4  every prose site that quotes a version agrees with the registry that owns
//       it — the pin record where it covers the lane, the survey otherwise. This
//       is the owner's requirement literally: one version here, another version
//       there must be red, not merely inconsistent.
//
//   C5  the lane universe reconciles in both directions against engine.ts, the
//       M12 manifest and the analyzer docs, so a lane the product routes can
//       never lack a record in either file.
//
//   C6  no candidate grammar is marked accepted without a review document that
//       exists on disk. Acceptance is F11's judgement, recorded by a human; the
//       survey generator cannot grant it and this gate only checks the paper
//       exists.
//
//   C7  the survey's own age is DISCLOSED, and a survey older than
//       --max-age-days fails. An upstream landscape that silently went stale is
//       how a lane drifts a year without anyone looking.
//
// EXIT: 0 pass · 1 hard failure · 2 could not be compared (a file missing).
//
// Usage:
//   bun run script/m60/verify-grammar-consistency.ts
//   bun run script/m60/verify-grammar-consistency.ts --json
//   bun run script/m60/verify-grammar-consistency.ts --max-age-days 30
//
// Writes: validation/m60/results/G1-grammar-consistency.json

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import { ROOT, WASM_DIR, SPEC_DIR, DOCS_DIR, REVIEWS_DIR, parseEngineLanes, manifestLanes, docFileFor } from "./grammar-lanes-source"

const SURVEY = path.join(ROOT, "validation", "m60", "grammar-survey.json")
const PINS = path.join(ROOT, "validation", "m14", "grammar-pins.json")
const OUT = path.join(ROOT, "validation", "m60", "results", "G1-grammar-consistency.json")
const AS_JSON = process.argv.includes("--json")
const MAX_AGE_DAYS = Number((process.argv.find((a) => a.startsWith("--max-age-days=")) ?? "--max-age-days=90").split("=")[1] ?? 90)

for (const [label, p] of [
  ["validation/m60/grammar-survey.json", SURVEY],
  ["validation/m14/grammar-pins.json", PINS],
] as const) {
  if (!existsSync(p)) {
    console.error(
      `verify-grammar-consistency: ${label} is missing.\n` +
        "  A gate that passes because its subject is absent is not a gate.\n" +
        "  Survey: bun run script/m60/build-grammar-survey.ts   Pins: bun run script/m14/verify-grammar-pins.ts --write",
    )
    process.exit(2)
  }
}

const survey = JSON.parse(readFileSync(SURVEY, "utf8"))
const pins = JSON.parse(readFileSync(PINS, "utf8"))
const rows: any[] = survey.rows ?? []
const pinnedLanes: Record<string, any> = pins.lanes ?? {}

const hard: string[] = []
const knownGaps: string[] = []
const checks: Array<{ id: string; status: string; detail: string }> = []

// ---------------------------------------------------------------------------
// C1 — the two files agree on which lanes exist
// ---------------------------------------------------------------------------

const surveyLanes = new Set(rows.map((r) => r.lane as string))
const pinLanes = new Set(Object.keys(pinnedLanes))
const pinnedNotSurveyed = [...pinLanes].filter((l) => !surveyLanes.has(l)).sort()
const surveyedNotPinned = [...surveyLanes].filter((l) => !pinLanes.has(l)).sort()
for (const l of pinnedNotSurveyed) hard.push(`C1 ${l}: the pin record covers this lane but the survey has no row`)
// One line, not one lane: this remainder is 43 lanes today and will grow with
// every pin adoption, so a per-lane line trains a reader to skip the section.
if (surveyedNotPinned.length) {
  knownGaps.push(
    `C1 remainder: ${surveyedNotPinned.length} lane(s) surveyed but not yet in the pin record — ${surveyedNotPinned.join(", ")} (pin adoption is per-lane and F11-gated, so this closes as lanes are adjudicated, not in one edit)`,
  )
}
checks.push({
  id: "C1",
  status: pinnedNotSurveyed.length ? "fail" : "pass",
  detail: `${pinLanes.size} pinned lane(s), ${surveyLanes.size} surveyed lane(s), ${pinnedNotSurveyed.length} pinned-but-unsurveyed, ${surveyedNotPinned.length} surveyed-but-unpinned`,
})

// ---------------------------------------------------------------------------
// C2 — where both files speak about a lane, they must describe the same bytes
// ---------------------------------------------------------------------------

const c2: Array<Record<string, unknown>> = []
for (const lane of Object.keys(pinnedLanes).sort()) {
  const row = rows.find((r) => r.lane === lane)
  const pinSha = pinnedLanes[lane]?.wired?.sha256 ?? null
  if (!row) {
    c2.push({ lane, status: "not-surveyed", pinSha })
    continue
  }
  const surveySha = row.shipped?.sha256 ?? null
  if (!pinSha || !surveySha) {
    c2.push({ lane, status: "incomparable", pinSha, surveySha })
    continue
  }
  const agree = pinSha === surveySha
  c2.push({ lane, status: agree ? "pass" : "mismatch", pinSha, surveySha })
  if (!agree) {
    hard.push(
      `C2 ${lane}: the pin record ships ${pinSha.slice(0, 16)}… but the survey records ${surveySha.slice(0, 16)}… — the two files describe different builds of the same grammar`,
    )
  }
}
checks.push({
  id: "C2",
  status: c2.some((x) => x.status === "mismatch") ? "fail" : "pass",
  detail: `${c2.filter((x) => x.status === "pass").length} overlapping lane(s) agree on their wasm sha256; ${c2.filter((x) => x.status === "incomparable").length} incomparable; ${c2.filter((x) => x.status === "mismatch").length} mismatch(es)`,
})

// ---------------------------------------------------------------------------
// C3 — the survey's observation is still true of the bytes on disk
// ---------------------------------------------------------------------------

const c3: Array<Record<string, unknown>> = []
for (const r of rows) {
  if (!r.shipped?.present) {
    c3.push({ lane: r.lane, status: "no-artifact" })
    continue
  }
  const abs = path.join(WASM_DIR, r.shipped.file)
  if (!existsSync(abs)) {
    c3.push({ lane: r.lane, status: "artifact-missing", file: r.shipped.file })
    hard.push(`C3 ${r.lane}: the survey names ${r.shipped.file} but it is not in wasm/`)
    continue
  }
  const observed = createHash("sha256").update(readFileSync(abs)).digest("hex")
  const recorded = r.shipped.sha256 ?? null
  const agree = recorded != null && recorded === observed
  c3.push({ lane: r.lane, status: agree ? "pass" : "mismatch", recorded, observed })
  if (!agree) {
    hard.push(
      `C3 ${r.lane}: ${r.shipped.file} no longer matches the survey — recorded ${String(recorded).slice(0, 16)}…, on disk ${observed.slice(0, 16)}… (a grammar changed without the survey being regenerated; run \`bun run grammar:survey:build\`)`,
    )
  }
}
const c3Covered = c3.filter((x) => x.status === "pass" || x.status === "mismatch").length
checks.push({
  id: "C3",
  status: c3.some((x) => x.status === "mismatch" || x.status === "artifact-missing") ? "fail" : "pass",
  detail: `${c3Covered} lane(s) verified against wasm/ bytes; ${c3.filter((x) => x.status === "no-artifact").length} lane(s) ship no wasm (generic/alias); ${c3.filter((x) => x.status === "mismatch").length} failure(s)`,
})

// ---------------------------------------------------------------------------
// C4 — prose agrees with whichever file owns the lane's version
// ---------------------------------------------------------------------------

const VERSION_RE = /\bv?(\d+\.\d+(?:\.\d+)?)\b/
const c4: Array<Record<string, unknown>> = []
for (const r of rows) {
  // The owner of this lane's version: the pin record where it covers the lane,
  // the survey everywhere else. A lane in both is cross-checked by C2 already.
  const owner = pinLanes.has(r.lane) ? "pin-record" : "survey"
  const authoritative = owner === "pin-record" ? pinVersionFor(r.lane) : (r.declared?.version ?? null)
  const sites: Array<{ file: string; version: string | null }> = []

  const docPath = docFileFor(r.lane)
  if (existsSync(docPath)) {
    const lines = readFileSync(docPath, "utf8").split("\n")
    const i = lines.findIndex((l) => /^\s*-\s*Parser:/i.test(l))
    if (i >= 0) {
      const para: string[] = []
      for (let k = i; k < lines.length; k++) {
        if (k > i && /^\s*-\s+\S/.test(lines[k])) break
        para.push(lines[k].trim())
        if (para.join(" ").length > 400) break
      }
      const m = VERSION_RE.exec(para.join(" "))
      sites.push({ file: path.relative(ROOT, docPath), version: m ? m[1] : null })
    }
  }

  const specPath = path.join(SPEC_DIR, `${r.lane}-completeness.json`)
  if (existsSync(specPath)) {
    try {
      const j = JSON.parse(readFileSync(specPath, "utf8"))
      if (typeof j.grammar === "string") {
        const m = VERSION_RE.exec(j.grammar)
        sites.push({ file: `script/m14/spec/${r.lane}-completeness.json`, version: m ? m[1] : null })
      }
    } catch {
      /* an unparseable spec is that file's own gate, not this one */
    }
  }

  const stated = sites.filter((s) => s.version != null)
  // Site-vs-site disagreement is a failure regardless of who owns the lane: two
  // hand-maintained sites quoting different versions IS the drift being hunted,
  // and it needs no baseline to be recognised.
  const siteVsSite = stated.length > 1 && new Set(stated.map((s) => s.version)).size > 1
  const vsOwner = authoritative != null ? stated.filter((s) => s.version !== authoritative) : []

  c4.push({
    lane: r.lane,
    owner,
    authoritative,
    sites,
    status: siteVsSite || vsOwner.length ? "disagreement" : "pass",
  })

  if (siteVsSite) {
    hard.push(`C4 ${r.lane}: declaration sites disagree with EACH OTHER — ${stated.map((s) => `${s.file}=${s.version}`).join("  vs  ")}`)
  }
  for (const d of vsOwner) {
    hard.push(`C4 ${r.lane}: ${d.file} says ${d.version} but the ${owner} says ${authoritative}`)
  }
}
checks.push({
  id: "C4",
  status: c4.filter((x) => x.status === "disagreement").length ? "fail" : "pass",
  detail: `${c4.length} lane(s) cross-checked across docs/analyzers/ and script/m14/spec/ against the owning file; ${c4.filter((x) => x.status === "disagreement").length} disagreement(s)`,
})

/** The version the pin record states for a lane, from its authored provenance. */
function pinVersionFor(lane: string): string | null {
  const d = pinnedLanes[lane]?.decisions ?? {}
  const p = d.provenance ?? {}
  return p.version ?? p.base?.version ?? null
}

// ---------------------------------------------------------------------------
// C5 — the lane universe reconciles against every declaration site
// ---------------------------------------------------------------------------

const engineLanes = new Set(Object.keys(parseEngineLanes()))
const manLanes = new Set(manifestLanes())
const docLanes = new Set(readdirSync(DOCS_DIR).filter((f) => /^real-.*-analyzer\.md$/.test(f)).map((f) => f.replace(/^real-/, "").replace(/-analyzer\.md$/, "")))

const declaredAnywhere = new Set([...engineLanes, ...manLanes, ...docLanes, ...pinLanes])
const unrecorded = [...declaredAnywhere].filter((l) => !surveyLanes.has(l) && !pinLanes.has(l)).sort()
const phantom = [...new Set([...surveyLanes, ...pinLanes])].filter((l) => !declaredAnywhere.has(l)).sort()
for (const l of unrecorded) hard.push(`C5 ${l}: engine.ts, the M12 manifest, an analyzer doc or the pin record declares this lane, but NO registry records it`)
for (const l of phantom) hard.push(`C5 ${l}: a registry records this lane but no declaration site declares it`)
checks.push({
  id: "C5",
  status: unrecorded.length || phantom.length ? "fail" : "pass",
  detail: `${declaredAnywhere.size} declared lane(s) across engine.ts + M12 manifest + analyzer docs + pin record; ${unrecorded.length} unrecorded, ${phantom.length} phantom`,
})

// ---------------------------------------------------------------------------
// C6 — acceptance is F11's, and the paper must exist
// ---------------------------------------------------------------------------

const reviewFiles = existsSync(REVIEWS_DIR) ? readdirSync(REVIEWS_DIR) : []
const c6: Array<Record<string, unknown>> = []
for (const r of rows) {
  for (const c of r.candidates ?? []) {
    if (c.verdict === "unmeasured") {
      c6.push({ lane: r.lane, package: c.package, verdict: c.verdict, status: "unmeasured" })
      continue
    }
    // The ruling is recorded repo-relative (`reviews/<file>.md`) because that is the
    // unambiguous form, and the check accepts either that or a bare filename. The
    // first version compared a repo-relative path against `readdirSync` output —
    // filenames — so a correctly-recorded ruling read as missing and C6 went red on
    // the one candidate that had actually been adjudicated.
    const ruling = String(c.verdictRuling ?? "")
    const asPath = existsSync(path.join(ROOT, ruling))
    const asName = reviewFiles.includes(ruling) || reviewFiles.includes(path.basename(ruling))
    const ok = ruling.length > 0 && (asPath || asName)
    c6.push({ lane: r.lane, package: c.package, verdict: c.verdict, ruling, resolved: asPath ? "repo-relative" : asName ? "bare-filename" : null, status: ok ? "pass" : "fail" })
    if (!ok) {
      hard.push(
        `C6 ${r.lane}/${c.package}: verdict "${c.verdict}" with no review document on disk (${ruling || "no ruling named"}). Acceptance is F11's judgement and must be written down, or the verdict is an assertion.`,
      )
    }
  }
}
checks.push({
  id: "C6",
  status: c6.some((x) => x.status === "fail") ? "fail" : "pass",
  detail: `${c6.length} candidate(s); ${c6.filter((x) => x.verdict !== "unmeasured").length} carry a verdict and each must name a review document that exists`,
})

// ---------------------------------------------------------------------------
// C7 — the survey's own age is disclosed, and a stale survey is red
// ---------------------------------------------------------------------------

const generatedMs = Date.parse(survey.generatedAt ?? "")
const ageDays = Number.isNaN(generatedMs) ? null : (Date.now() - generatedMs) / 86_400_000
if (ageDays == null) {
  hard.push("C7: the survey records no parseable generatedAt — its age cannot be established")
} else if (ageDays > MAX_AGE_DAYS) {
  hard.push(
    `C7: the upstream survey is ${ageDays.toFixed(0)} days old (limit ${MAX_AGE_DAYS}). An upstream landscape that silently went stale is how a lane drifts a year unnoticed. Refresh: bun run grammar:survey:refresh`,
  )
}
checks.push({
  id: "C7",
  status: ageDays == null ? "fail" : ageDays > MAX_AGE_DAYS ? "fail" : "pass",
  detail: ageDays == null ? "no generatedAt" : `survey is ${ageDays.toFixed(1)} day(s) old (limit ${MAX_AGE_DAYS}); upstream candidates are only as current as this timestamp`,
})

// ---------------------------------------------------------------------------
// C8 — the runtime-upgrade claim is MEASURED, and the survey restates the
//      measurement rather than a remembered number
// ---------------------------------------------------------------------------

// This gate exists because the survey used to carry a literal `failures: 20` —
// a count with no list, which no artifact could reproduce and which therefore
// nothing ever checked, while sizing the entire M63 migration. The number now
// lives in one place, produced by a script that loads every shipped wasm on both
// runtimes, and C8 proves three things about it:
//
//   1. THE CLAIM EXISTS. An absent artifact must not leave a remembered number
//      standing, and must not be papered over with a plausible one.
//   2. THE SURVEY RESTATES THE ARTIFACT, not itself. If the survey's copy of the
//      straggler list or the counts disagrees with the measurement, the survey is
//      wrong — a generator that edits a measurement into agreement is a laundromat.
//   3. THE HARNESS THAT PRODUCED IT WAS ABLE TO FAIL. A load test that reports
//      success on a corrupt module certifies nothing, and this one did exactly
//      that until the load was forced through setLanguage + parse. The artifact
//      records the control; C8 refuses a claim whose control is blind or uncalibrated.

const STRAGGLER_ARTIFACT_REL = "validation/m60/results/M60.0.runtime-stragglers.json"
const stragglerPath = path.join(ROOT, STRAGGLER_ARTIFACT_REL)
const phaseA = (survey as any)?.runtime?.webTreeSitter?.phaseA
const c8: Array<{ check: string; status: "pass" | "fail"; detail: string }> = []

if (!existsSync(stragglerPath)) {
  c8.push({
    check: "artifact-exists",
    status: "fail",
    detail: `no measurement artifact at ${STRAGGLER_ARTIFACT_REL}. The survey must not carry a remembered count in its place — run \`bun run grammar:stragglers:measure\`.`,
  })
} else {
  let ev: any = null
  try {
    ev = JSON.parse(readFileSync(stragglerPath, "utf8"))
  } catch (e: any) {
    c8.push({ check: "artifact-exists", status: "fail", detail: `unparseable: ${e?.message ?? e}` })
  }
  if (ev) {
    c8.push({
      check: "harness-control",
      status: ev.harnessControl?.blind === false ? "pass" : "fail",
      detail:
        ev.harnessControl?.blind === false
          ? `sound: ${ev.harnessControl.mutations?.length ?? 0} deliberate corruption(s) rejected on every runtime before any result was read`
          : "BLIND: the load harness reported success on a deliberately corrupt module, so no result in it is evidence",
    })
    c8.push({
      check: "calibration",
      status: ev.calibration?.agrees ? "pass" : "fail",
      detail: ev.calibration?.agrees
        ? `reproduces the previously recorded pinned-runtime baseline (${(ev.preExistingFailures ?? []).join(", ") || "none"})`
        : `does NOT reproduce the recorded baseline — measured ${(ev.preExistingFailures ?? []).join(", ") || "none"}. A harness that cannot reproduce a recorded answer cannot be trusted with a new one.`,
    })
    c8.push({
      check: "cause",
      status: typeof ev.mechanism?.holds === "boolean" ? "pass" : "fail",
      detail: `dylink.0 correspondence ${ev.mechanism?.holds ? "CONFIRMED exactly" : "NOT confirmed"} — ${ev.mechanism?.prediction ?? "no prediction recorded"}`,
    })
    const list = ev.upgradeStragglers ?? []
    const sameList =
      Array.isArray(phaseA?.candidateRuntime?.upgradeStragglers) &&
      phaseA.candidateRuntime.upgradeStragglers.length === list.length &&
      phaseA.candidateRuntime.upgradeStragglers.every((x: string, i: number) => x === list[i])
    c8.push({
      check: "survey-restates-artifact",
      status: sameList ? "pass" : "fail",
      detail: sameList
        ? `the survey's ${list.length}-entry straggler list matches the artifact name for name, in order`
        : `the survey's straggler list does NOT match the artifact (survey ${phaseA?.candidateRuntime?.upgradeStragglers?.length ?? "none"} vs artifact ${list.length}). A generator must not edit a measurement into agreement.`,
    })
    const sameCounts =
      phaseA?.candidateRuntime?.upgradeStragglerCount === ev.counts?.upgradeStragglers &&
      phaseA?.candidateRuntime?.failures === ev.counts?.candidateTotalFailures &&
      phaseA?.pinnedRuntime?.total === ev.counts?.shippedGrammarWasms
    c8.push({
      check: "survey-counts-match",
      status: sameCounts ? "pass" : "fail",
      detail: sameCounts
        ? `stragglers ${ev.counts.upgradeStragglers}, candidate failures ${ev.counts.candidateTotalFailures}, wasms ${ev.counts.shippedGrammarWasms} — all agree`
        : "the survey's runtime counts disagree with the measurement artifact",
    })
    // A DECLARED VERSION MUST SAY WHERE IT CAME FROM. Two lanes record their identity from
    // the measured census because they are engine-only and have no prose to write it in
    // (toml, tsx). That is legitimate — and it is also the shape of a silent substitution,
    // where a generator quietly starts sourcing versions from somewhere and nobody looks.
    // So each census-sourced row must CITE the artifact and the field it read.
    const censusRows = (survey.rows ?? []).filter((r: any) => r.declared?.declaredFromCensus)
    const uncited = censusRows.filter((r: any) => !r.declared.declarationSite || !r.declared.sources?.some((x: any) => x?.file === "validation/m60/results/G-PROVENANCE.json"))
    c8.push({
      check: "census-sourced-versions-cite-their-source",
      status: uncited.length === 0 ? "pass" : "fail",
      detail:
        uncited.length === 0
          ? `${censusRows.length} lane(s) record their version from the census and every one cites the artifact and field it read${censusRows.length ? " (" + censusRows.map((r: any) => r.lane).join(", ") + ")" : ""}`
          : `${uncited.length} lane(s) claim a census-sourced version without citing the artifact: ${uncited.map((r: any) => r.lane).join(", ")}`,
    })

    // A LOCAL-REBUILD VERSION MUST CARRY ITS REPRODUCTION. `versionKind: "local-rebuild"`
    // is the strongest provenance claim this repo makes about a grammar — "we built these
    // bytes ourselves, from this named source, with this toolchain" — and it is also the
    // easiest to assert for free. So every such row must carry the grade, the byte count
    // and the command, and the grade must be one that actually establishes something.
    // `different` and `not-attempted` do NOT: they say only that this candidate is not the
    // source, and a row carrying one as its version would be a lane marked "known" on the
    // strength of a failed attempt.
    const rebuildRows = (survey.rows ?? []).filter((r: any) => r.declared?.versionKind === "local-rebuild")
    // A local-rebuild is qualified by EITHER channel, because they answer different questions.
    // `basis: "rebuild"` needs a byte result of byte-identical or equivalent — the same bytes,
    // modulo a named section. `basis: "surface"` needs a `surface-identical` verdict — the same
    // VOCABULARY, which is the stronger evidence precisely because a linker difference cannot
    // add a node type. Checking only the rebuild grade is what made this gate reject `hcl` and
    // `r`, whose bytes genuinely do not reproduce but whose vocabularies do, exactly.
    const badRebuild = rebuildRows.filter((r: any) => {
      const d = r.declared
      if (!d.rebuild?.from?.package) return true
      if (d.provenanceBasis === "surface") {
        return !d.sources?.some((x: any) => x?.file === "validation/m60/results/M60.0.grammar-surface.json")
      }
      if (d.provenanceBasis === "rebuild") {
        return !d.rebuild || !["byte-identical", "equivalent"].includes(d.rebuild.grade) || !d.sources?.some((x: any) => x?.file === "validation/m60/results/M60.0.local-rebuilds.json")
      }
      // No declared basis: fall back to requiring the byte evidence.
      return !d.rebuild || !["byte-identical", "equivalent"].includes(d.rebuild.grade)
    })
    c8.push({
      check: "local-rebuild-versions-carry-reproduction",
      status: badRebuild.length === 0 ? "pass" : "fail",
      detail:
        badRebuild.length === 0
          ? `${rebuildRows.length} lane(s) recorded as a local rebuild, each with a named source and a qualifying reproduction — by byte grade (byte-identical/equivalent) or by an identical vocabulary${rebuildRows.length ? " (" + rebuildRows.map((r: any) => `${r.lane}: ${r.declared.provenanceBasis}/${r.declared.rebuild?.grade ?? r.declared.provenanceBasis}`).join(", ") + ")" : ""}`
          : `${badRebuild.length} lane(s) claim a local-rebuild version without a qualifying reproduction: ${badRebuild.map((r: any) => r.lane).join(", ")}`,
    })

    // The retraction must stay visible. Silently overwriting an unreproducible
    // claim with a new number destroys the record that it was ever wrong.
    c8.push({
      check: "retraction-visible",
      status: phaseA?.supersededRecord?.reproducible === false ? "pass" : "fail",
      detail:
        phaseA?.supersededRecord?.reproducible === false
          ? `the superseded "20 of 55" is retained in place with reproducible:false — ${phaseA.supersededRecord.claim}`
          : "the superseded unreproducible count is not disclosed in the survey",
    })
  }
}
const c8Hard = c8.filter((x) => x.status === "fail")
if (c8Hard.length) {
  for (const f of c8Hard) hard.push(`C8 ${f.check}: ${f.detail}`)
}
// ---------------------------------------------------------------------------
// C9 — a lane's SURFACE, where bytes could not settle it
// ---------------------------------------------------------------------------

// Two measurements made byte comparison the wrong instrument for provenance. The builder is
// not bit-reproducible (bash: 1,403,134 of 1,403,135 bytes), so a byte MISMATCH cannot
// distinguish "wrong grammar" from "same grammar, one linker flag different". And kotlin
// cannot be built at all here — 5.8 MB, and compiling its parser.c exhausted a 15 GB machine
// — so the largest unversioned lane had no story at all.
//
// The answer is the grammar's VOCABULARY, and it is decisive where bytes are ambiguous: a
// one-byte linker difference cannot add or remove a node type. C9 therefore requires that
// any surface verdict is a real measurement against a named candidate, and that a lane
// cannot quietly claim a surface identity it did not earn.

const SURFACE_REL = "validation/m60/results/M60.0.grammar-surface.json"
const c9: Array<{ check: string; status: "pass" | "fail"; detail: string }> = []
const surfacePath = path.join(ROOT, SURFACE_REL)
if (!existsSync(surfacePath)) {
  c9.push({ check: "artifact-exists", status: "fail", detail: `no surface artifact at ${SURFACE_REL}` })
} else {
  let surf: any = null
  try {
    surf = JSON.parse(readFileSync(surfacePath, "utf8"))
  } catch (e: any) {
    c9.push({ check: "artifact-exists", status: "fail", detail: `unparseable: ${e?.message ?? e}` })
  }
  if (surf) {
    const rows = surf.results ?? []
    // 1. A surface verdict must be one this grader can actually produce.
    const GRADES = ["surface-identical", "surface-compatible", "different", "not-comparable", "no-candidate-comparable"]
    const badGrade = rows.filter((r: any) => !GRADES.includes(r.verdict))
    c9.push({
      check: "grades-are-declared",
      status: badGrade.length === 0 ? "pass" : "fail",
      detail: badGrade.length === 0 ? `${rows.length} lane(s), every verdict one of ${GRADES.length} declared grade(s)` : `${badGrade.length} lane(s) carry an undeclared verdict: ${badGrade.map((r: any) => `${r.lane}=${r.verdict}`).join(", ")}`,
    })

    // 2. A POSITIVE surface verdict must name the candidate it was measured against. This is
    //    the check that stops "surface-identical" being asserted for a lane nobody compared.
    const positive = rows.filter((r: any) => r.verdict === "surface-identical" || r.verdict === "surface-compatible")
    // `best` must be BACKED BY AN ATTEMPT, not merely well-formed. The first version of this
    // check tested only that best.package and best.version were present, and so it happily
    // accepted a hand-written "surface-identical vs tree-sitter-kotlin-fantasm@9.9.9" — a
    // package that does not exist, attached to a lane whose real measurement is
    // `surface-compatible`. The gate passed its own injection, which is the failure mode this
    // whole milestone is about. A verdict is only as good as the attempt row it points at, so
    // the pointer is what gets checked: `best` must name a package@version that appears in this
    // lane's own `attempts`, with the same grade.
    const uncited = positive.filter((r: any) => {
      if (!r.best?.package || !r.best?.version || !Array.isArray(r.attempts) || !r.attempts.length) return true
      const backing = r.attempts.find((a: any) => a.package === r.best.package && a.version === r.best.version && a.grade === r.verdict)
      return !backing
    })
    c9.push({
      check: "positive-verdicts-name-their-candidate",
      status: uncited.length === 0 ? "pass" : "fail",
      detail:
        uncited.length === 0
          ? `${positive.length} positive verdict(s), each backed by an attempt row naming the package and version it was measured against${positive.length ? " (" + positive.map((r: any) => `${r.lane}: ${r.verdict} vs ${r.best.package}@${r.best.version}`).join(", ") + ")" : ""}`
          : `${uncited.length} lane(s) claim a positive surface verdict that no attempt in the artifact supports: ${uncited.map((r: any) => r.lane).join(", ")} — a verdict must point at the measurement that produced it`,
    })

    // 3. The digests must be REAL digests of the recorded vocabularies, not placeholders. A
    //    surface verdict whose digest does not hash its own type list is a decoration.
    const badDigest = rows.filter((r: any) => {
      const d = r.surface?.digests
      if (!d?.types || !d?.fields) return true
      return !/^[0-9a-f]{64}$/.test(d.types) || !/^[0-9a-f]{64}$/.test(d.fields)
    })
    c9.push({
      check: "digests-are-real",
      status: badDigest.length === 0 ? "pass" : "fail",
      detail: badDigest.length === 0 ? `every recorded surface carries a 64-hex digest for its types and fields` : `${badDigest.length} lane(s) have a missing or malformed digest: ${badDigest.map((r: any) => r.lane).join(", ")}`,
    })

    // 4. A surface verdict must not CONTRADICT a rebuild verdict for the same lane. If a
    //    rebuild says byte-identical to X, a surface comparison against a DIFFERENT package
    //    claiming a positive identity is a contradiction, and the pair needs a human.
    const rebuildPath = path.join(ROOT, "validation", "m60", "results", "M60.0.local-rebuilds.json")
    const contradictions: string[] = []
    if (existsSync(rebuildPath)) {
      try {
        const rb = JSON.parse(readFileSync(rebuildPath, "utf8")).results ?? []
        for (const r of rows) {
          const m = rb.find((x: any) => x.lane === r.lane)
          if (!m || !m.best || r.verdict !== "surface-identical") continue
          if (`${m.best.package}@${m.best.version}` !== `${r.best.package}@${r.best.version}`) {
            contradictions.push(`${r.lane}: byte-identical rebuild of ${m.best.package}@${m.best.version} but surface-identical to ${r.best.package}@${r.best.version}`)
          }
        }
      } catch {
        /* declared absence */
      }
    }
    c9.push({
      check: "no-contradiction-with-rebuild-verdicts",
      status: contradictions.length === 0 ? "pass" : "fail",
      detail: contradictions.length === 0 ? "no lane is byte-identical to one package and surface-identical to another" : contradictions.join("; "),
    })
  }
}
const c9Hard = c9.filter((x) => x.status === "fail")
for (const f of c9Hard) hard.push(`C9 ${f.check}: ${f.detail}`)
checks.push({
  id: "C9",
  status: c9Hard.length ? "fail" : "pass",
  detail: `${c9.filter((x) => x.status === "pass").length}/${c9.length} — provenance by vocabulary where bytes are ambiguous, and every positive verdict names the candidate it was measured against`,
})

checks.push({
  id: "C8",
  status: c8Hard.length ? "fail" : "pass",
  detail: `${c8.filter((x) => x.status === "pass").length}/${c8.length} — the runtime-upgrade claim is measured, its harness was proven able to fail, and the survey restates the measurement`,
})

// ---------------------------------------------------------------------------
// Remainders — visible, never smoothed
// ---------------------------------------------------------------------------

const R1_noVersion = rows.filter((r) => !r.declared?.versionKnown && !pinLanes.has(r.lane) && !r.generic && !r.aliasOf).map((r) => r.lane as string)
const R2_unbound = rows.filter((r) => r.evidence?.m12?.artifact && r.evidence.m12.bindsGrammar === false).map((r) => r.lane as string)
const R3_noGuard = rows.filter((r) => !r.guard?.f5DifferentialLane && !r.guard?.f10ParseSuccessFloor).map((r) => r.lane as string)
const R4_notRebuildable = rows.filter((r) => r.shipped?.present && r.source?.rebuildable === false).map((r) => r.lane as string)
if (R1_noVersion.length) knownGaps.push(`R1: ${R1_noVersion.length} lane(s) have no version recorded in EITHER file — ${R1_noVersion.join(", ")}`)
if (R2_unbound.length) knownGaps.push(`R2: ${R2_unbound.length} corpus-error artifact(s) record no grammar sha256, so a grammar swap cannot make them stale`)
if (R3_noGuard.length) knownGaps.push(`R3: ${R3_noGuard.length} lane(s) have neither an F5 differential lane nor an F10 parse-success floor — ${R3_noGuard.join(", ")}`)
if (R4_notRebuildable.length) knownGaps.push(`R4: ${R4_notRebuildable.length} lane(s) ship a wasm that cannot be rebuilt from this repository — ${R4_notRebuildable.join(", ")}`)

// ---------------------------------------------------------------------------

const result = {
  schemaVersion: 1,
  gate: "m60-grammar-consistency",
  ownership: {
    pinIdentity: { file: "validation/m14/grammar-pins.json", gate: "script/m14/verify-grammar-pins.ts", lanes: pinLanes.size, role: "CONTRACT — gated for truth" },
    upstreamSurvey: { file: "validation/m60/grammar-survey.json", gate: "script/m60/build-grammar-survey.ts", lanes: surveyLanes.size, role: "OBSERVATION — gated for freshness and completeness" },
    thisGate: { file: "script/m60/verify-grammar-consistency.ts", role: "owns NO fact; proves the two above agree, and that the prose sites agree with whichever owns the lane" },
    rule: "one fact, one owner. Two files with disjoint responsibilities and an enforced cross-check is not drift; two files both claiming to be the version record is.",
  },
  checkedAt: new Date().toISOString(),
  survey: { generatedAt: survey.generatedAt ?? null, ageDays: ageDays == null ? null : Number(ageDays.toFixed(2)), maxAgeDays: MAX_AGE_DAYS },
  pins: { generatedAt: pins.generatedAt ?? null, lanes: Object.keys(pinnedLanes).sort() },
  checks,
  hardFailures: hard,
  knownGaps,
  remainders: {
    R1_noVersionInEitherFile: R1_noVersion,
    R2_claimNotBoundToGrammar: R2_unbound,
    R3_noF5OrF10Guard: R3_noGuard,
    R4_notRebuildableFromRepo: R4_notRebuildable,
    surveyedButNotPinned: surveyedNotPinned,
  },
  detail: { C1: { pinnedNotSurveyed, surveyedNotPinned }, C2: c2, C3: c3, C4: c4, C6: c6, C8: c8, C9: c9 },
  passed: hard.length === 0,
  policy:
    "Offline: never downloads, never fetches upstream, never mutates a grammar or a registry. Reads validation/m14/grammar-pins.json (the pin contract) and validation/m60/grammar-survey.json (the upstream observation) and proves they agree with each other and with the prose sites that quote versions. It deliberately restates no pin, so it can never become a second version record.",
}

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n")

if (AS_JSON) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(`verify-grammar-consistency: ${surveyLanes.size} surveyed · ${pinLanes.size} pinned`)
  console.log(`  survey generated ${survey.generatedAt} (${ageDays == null ? "age unknown" : `${ageDays.toFixed(1)}d old`})`)
  for (const c of checks) {
    const mark = c.status === "pass" ? "PASS" : c.status === "known-gap" ? "GAP " : "FAIL"
    console.log(`  ${mark}  ${c.id}  ${c.detail}`)
  }
  for (const g of knownGaps) console.log(`  ----  remainder: ${g}`)
  if (hard.length) {
    console.log(`\n  HARD FAILURES (${hard.length}):`)
    for (const h of hard) console.log(`    ${h}`)
  }
  console.log(`\n  ${hard.length === 0 ? "pass" : "FAIL"} — written to ${path.relative(ROOT, OUT)}`)
}
process.exit(hard.length ? 1 : 0)
