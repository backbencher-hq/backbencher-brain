// script/m24/mutant-anchor-gate.ts — the ANCHOR-DRIFT class gate.
//
// The defect class this exists to catch, stated from what actually happened in
// this repository rather than hypothetically:
//
//   A mutation is a source-text REPLACEMENT. `from` must be present in the file
//   the mutant claims to mutate; `to` is what replaces it. When `from` has
//   drifted out of the file (a reword, a reformat, a moved guard), the
//   replacement matches nothing, the mutant NEVER RUNS, and a harness that
//   counts "no assertion observed the defect" reports SURVIVED — or, worse, a
//   harness that skips the unrunnable mutant reports nothing at all.
//
//   Two mutants on the merged LSP tree died exactly that way and had to be
//   found by reading the survivors: m24/verify-hover.ts's
//   "content: usage count off by one" and "content: wrong tier label", each of
//   which this file's header names as previously SILENTLY SKIPPING. A gate that
//   silently stops testing a thing is worse than no gate, because it reports
//   coverage.
//
// §8.3: silence is guilt; a skip is not a pass. §8.7: the fixture that cannot
// fail is the standing red-team target.
//
// WHAT IS CHECKED, and why each is a distinct class:
//
//   anchor-absent                `from` is not in the target file. The mutant
//                                 cannot run. LOUD FAILURE, never a skip.
//   replacement-changes-nothing  `source.replace(from, to) === source`. The
//                                 mutant is written, loaded, probed, and
//                                 changes not one byte — the most deceptive
//                                 shape of all, because every harness step
//                                 reports success. This is the SOUND form of
//                                 the no-op class: it is decided by performing
//                                 the replacement, not by guessing whether `to`
//                                 "looks like it is already there". An earlier
//                                 draft of this file tested `source.includes(to)`
//                                 and produced five false positives on the
//                                 FIRST run against the real suite — e.g. the
//                                 mutant whose `to` is `caps.hoverProvider =
//                                 true` is a SUFFIX of its own `from`, so the
//                                 check flagged a mutant that plants correctly.
//                                 A gate that cries wolf on five working
//                                 mutants gets ignored on the sixth, which is
//                                 the survivor this file exists to prevent.
//   empty-anchor                 `from` is "" — `String.replace("")` inserts at
//                                 position 0 and plants something unrelated.
//   unreadable-target            the file the mutant claims cannot be read.
//                                 Drift, not a crash: aborting the verifier
//                                 here would hide every other finding.
//
// REPORTED BUT NOT A FAILURE: `ambiguous-anchor`. When `from` occurs more
// than once, `String.replace` plants at the FIRST occurrence, which is not
// necessarily the site the mutant names. That is a real hazard and it is
// recorded per run so it cannot be forgotten silently — but several mutants
// in this milestone legitimately share an anchor prefix, and failing on
// multiplicity would push authors to invent unique anchors instead of gating
// the ones they already reasoned about.
//
// WHY IT IS A SEPARATE MODULE and not a block inside one verifier: the same
// class bit two verifiers in this milestone (m24 L1 and L2), and a gate that
// exists twice is a gate that drifts twice. One implementation, imported by
// both, with `anchorGateSelfTest()` called by both so the gate's own ability to
// fail is exercised on every run — never only when someone remembers to.

/** One source-text replacement, as a mutation suite declares it. */
export interface AnchoredMutation {
  /** Identifies the mutant in the gate's report. */
  name: string
  /** The text that must be present in the target file. */
  from: string
  /** The text that replaces `from`. Must NOT already be in the target file. */
  to: string
}

export type AnchorDriftKind =
  | "anchor-absent"
  | "replacement-changes-nothing"
  | "empty-anchor"
  | "unreadable-target"

/** Not a failure — recorded per run so a shared-anchor hazard stays visible. */
export interface AmbiguousAnchor {
  name: string
  occurrences: number
}

export interface AnchorDrift {
  name: string
  kind: AnchorDriftKind
  /** Human-readable statement of what is wrong. Names the target. */
  detail: string
}

export interface AnchorDriftReport {
  /** Every finding that must FAIL the suite. Empty is the only pass. */
  drift: AnchorDrift[]
  /** Recorded, not failed: anchors occurring more than once. */
  ambiguous: AmbiguousAnchor[]
}

/** Reads the source text of the file a mutant claims to mutate. */
export type SourceReader = (mutant: AnchoredMutation) => string

/**
 * Every anchored mutant whose anchor has drifted, plus the shared-anchor
 * advisory. `report.drift` must be EMPTY for the suite to pass; any entry is a
 * loud gate failure in the caller.
 *
 * `readTarget` is passed the mutant so a suite with several target files
 * (verify-server mutates server.ts and launch_languages.ts) resolves each
 * mutant against the file it actually claims.
 */
export function anchorDriftReport(
  mutations: ReadonlyArray<AnchoredMutation>,
  readTarget: SourceReader,
): AnchorDriftReport {
  const drift: AnchorDrift[] = []
  const ambiguous: AmbiguousAnchor[] = []
  for (const mutant of mutations) {
    let source: string
    try {
      source = readTarget(mutant)
    } catch (error) {
      drift.push({
        name: mutant.name,
        kind: "unreadable-target",
        detail: `the target file this mutant claims could not be read: ${String((error as Error)?.message ?? error).slice(0, 120)}`,
      })
      continue
    }
    if (mutant.from.length === 0) {
      drift.push({
        name: mutant.name,
        kind: "empty-anchor",
        detail: "`from` is the empty string; String.replace would insert at position 0 and plant something unrelated to the named defect",
      })
      continue
    }
    if (!source.includes(mutant.from)) {
      drift.push({
        name: mutant.name,
        kind: "anchor-absent",
        detail: `the anchor text is absent from the file this mutant claims to mutate, so the mutant never ran (${JSON.stringify(mutant.from.slice(0, 72))})`,
      })
      continue
    }
    // The sound no-op test: perform the replacement and ask whether the text
    // moved. Decided by the actual operation, not by a guess about `to`.
    if (source.replace(mutant.from, mutant.to) === source) {
      drift.push({
        name: mutant.name,
        kind: "replacement-changes-nothing",
        detail: "`from` and `to` are the same text; the mutant is written, loaded and probed while changing not one byte of the target",
      })
      continue
    }
    let occurrences = 0
    for (let at = source.indexOf(mutant.from); at !== -1; at = source.indexOf(mutant.from, at + 1)) occurrences++
    if (occurrences > 1) ambiguous.push({ name: mutant.name, occurrences })
  }
  return { drift, ambiguous }
}

export interface SelfTestLeg {
  label: string
  ok: boolean
  detail: string
}

/**
 * The gate's own can-fail proof (contract §8.7 / F7). Run on EVERY verifier
 * invocation, so a future edit that weakens `anchorDrift` is itself caught on
 * the next run instead of at the next review.
 *
 * The stimulus is an in-memory stand-in for a target file, so these legs
 * exercise the gate's LOGIC and not the filesystem. The end-to-end proof — a
 * planted stale anchor in a real suite, observed by a real verifier — lives in
 * the verifiers themselves, because that is the shape of the actual defect.
 */
export function anchorGateSelfTest(): SelfTestLeg[] {
  const TARGET = [
    "  let range;",
    "  try {",
    "    range = mapper.indexRangeToLsp({",
    "      start: { line: startCol.line, column: startCol.column },",
    "    })",
    "  } catch (error) {",
    "    return { location: null, absence: null };",
    "  }",
  ].join("\n")
  // Two occurrences of one line, so the ambiguity advisory has something real
  // to find and is exercised on every run.
  const DUPLICATED = `${TARGET}\n${TARGET}`
  const reader: SourceReader = () => TARGET

  const legs: SelfTestLeg[] = []

  // 1. A STALE anchor — the class that produced both survivors. It must be
  //    reported, with the mutant named, and reported as anchor-absent.
  {
    const planted = anchorDriftReport(
      [{ name: "planted: stale anchor", from: "  } catch (unroutable) {\n    throw unroutable\n  }", to: "  } catch (unroutable) {" }],
      reader,
    ).drift
    legs.push({
      label: "detects a STALE anchor (the class that produced both survivors)",
      ok: planted.length === 1 && planted[0]?.kind === "anchor-absent" && planted[0]?.name === "planted: stale anchor",
      detail: `expected exactly one anchor-absent finding, got ${JSON.stringify(planted)}`,
    })
  }

  // 2. The NO-OP mutant: `from === to`. Written, loaded, probed — and it
  //    changes nothing. Invisible to a "did `from` match?" check.
  {
    const planted = anchorDriftReport(
      [{ name: "planted: no-op replacement", from: "  let range;", to: "  let range;" }],
      reader,
    ).drift
    legs.push({
      label: "detects a NO-OP mutant (`from` === `to`) — written, loaded, probed, changing nothing",
      ok: planted.length === 1 && planted[0]?.kind === "replacement-changes-nothing",
      detail: JSON.stringify(planted),
    })
  }

  // 3. THE CONTROL AGAINST CRYING WOLF. The first draft of this gate tested
  //    `source.includes(to)` and reported five false positives on its FIRST
  //    run against the real suite, because a mutant's `to` is often a SUFFIX of
  //    its own `from`. A well-formed mutant whose replacement text already
  //    occurs elsewhere in the file must NOT be reported — the replacement
  //    still changes the anchor's own site, and `String.replace` is
  //    first-occurrence, so it lands where the author meant.
  {
    const planted = anchorDriftReport(
      [{ name: "control: `to` is a suffix of `from`", from: "  let range;\n  try {", to: "  let range;" }],
      reader,
    ).drift
    legs.push({
      label: "CONTROL — a mutant whose replacement text already occurs in the target is NOT reported (no false positive on a working mutant)",
      ok: planted.length === 0,
      detail: `the gate reported ${JSON.stringify(planted)} — it cries wolf, and a gate that cries wolf is ignored on the survivor`,
    })
  }

  // 4. An EMPTY anchor — `String.replace("", to)` inserts at position 0.
  {
    const planted = anchorDriftReport([{ name: "planted: empty anchor", from: "", to: "false" }], reader).drift
    legs.push({
      label: "detects an EMPTY anchor",
      ok: planted.length === 1 && planted[0]?.kind === "empty-anchor",
      detail: JSON.stringify(planted),
    })
  }

  // 5. An UNREADABLE target is drift, not a crash: a mutant whose target file
  //    moved is exactly the failure mode, and throwing here would abort the
  //    verifier instead of reporting.
  {
    const planted = anchorDriftReport([{ name: "planted: unreadable target", from: "x", to: "y" }], () => {
      throw new Error("ENOENT: no such file or directory")
    }).drift
    legs.push({
      label: "reports an UNREADABLE target file as drift instead of throwing",
      ok: planted.length === 1 && planted[0]?.kind === "unreadable-target",
      detail: JSON.stringify(planted),
    })
  }

  // 6. THE CONTROL. A well-formed anchored mutant must NOT be reported. Without
  //    this the gate could pass by flagging everything — the classic
  //    sensitive-but-not-specific check.
  {
    const report = anchorDriftReport(
      [{ name: "control: a real anchored mutant", from: "  let range;", to: "  let range = null;" }],
      reader,
    )
    legs.push({
      label: "CONTROL — a well-formed anchored mutant is NOT reported",
      ok: report.drift.length === 0,
      detail: `the gate reported ${JSON.stringify(report.drift)}`,
    })
  }

  // 7. The ambiguity ADVISORY is computed and is not a failure — so it must be
  //    shown working, or it is decoration.
  {
    const report = anchorDriftReport(
      [{ name: "shared anchor", from: "  let range;", to: "  let range = null;" }],
      () => DUPLICATED,
    )
    legs.push({
      label: "a SHARED anchor (occurs more than once) is recorded as an advisory, not a failure",
      ok: report.drift.length === 0 && report.ambiguous.length === 1 && report.ambiguous[0]?.occurrences === 2,
      detail: `drift=${JSON.stringify(report.drift)} ambiguous=${JSON.stringify(report.ambiguous)}`,
    })
  }

  return legs
}

/** One line per finding, for a caller that records failures into its log. */
export function describeAnchorDrift(drift: ReadonlyArray<AnchorDrift>): string {
  return drift.map((d) => `${d.name}: ${d.kind} — ${d.detail}`).join(" | ")
}

/** One line per advisory, so a shared-anchor hazard is stated rather than implied. */
export function describeAmbiguousAnchors(ambiguous: ReadonlyArray<AmbiguousAnchor>): string {
  return ambiguous.map((a) => `${a.name}: ${a.occurrences} occurrences`).join(" | ")
}