#!/usr/bin/env python3
"""The §8 tables of reviews/systems-family/family-closure-report.md, printed from
the records themselves — so the report's numbers are a tool's output, not a hand
transcription, and a re-run after any regeneration shows drift immediately.

Assertions it fails loudly on:
  - the old-rule replay must be identical on both arms (every input it reads is
    rule-independent)
  - the after arm must have `spanCandidateDiffersFromStoredSource == 0` and
    `ambiguousSourceDoesNotEncloseChildLine == 0` (the source half's claims)
  - the target half: matches-hint == line-pins-one, and target-in-another-file == 0
    on both arms
  - the after arm's residual gauge must be 0 (text form in the before record, a
    number in the after record)
  - the control set (unique-name edges and their line agreement) must be identical
    on both arms — OR the repo's stored containment population must be shown to
    have MOVED (its index summary differs between the arms) and the repo must be
    listed in INDEX_POPULATION_MOVED with the record that re-measured it. A repo
    whose index is identical on both arms can never be excused: then the control
    set moving is a defect in the rule, not in the run.
  - the rows the exact-line test cannot match (§8.2's 24) must equal the count the
    line-hint gauges imply, must all have been checked against the source text, and
    must all carry the name ON the edge's line — the shape claim is a record, not
    prose.

Two record shapes are read, because two instruments write them:
  - a sweep record:  repos[i].probes[probe].result.<field>
  - a DB probe:      repos[i].result.<field>          (probe name is the record's)

Run: python3 script/m14/tmp/containment-report-tables-612.py [--before <f>] [--after <f>]
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BEFORE = ROOT / "validation/m14/measurements/containment-612.before.json"
AFTER = ROOT / "validation/m14/measurements/containment-612.json"
OWNER_BEFORE = ROOT / "validation/m14/measurements/containment-owner-span-612.before.json"
OWNER_AFTER = ROOT / "validation/m14/measurements/containment-owner-span-612.json"
OLD_BEFORE = ROOT / "validation/m14/measurements/containment-old-rule-612.before.json"
OLD_AFTER = ROOT / "validation/m14/measurements/containment-old-rule-612.json"

# Repos whose stored containment population is not identical on the two arms, with
# the record that re-measured the arm's index on a private pinned copy of the
# checkout. Rationale, measured not assumed: zig's first-pass arms differed (71,951
# vs 80,352 containment edges) and its wall clock and timeout counts differed with
# them (3,930s / 22 timeouts vs 2,275s / 6), while the nine smaller repos came out
# with identical populations. The rule being landed changes source/owner resolution,
# which CAN change the auto-contains dedupe population, so "the rule itself moved
# it" is a hypothesis the records have to exclude, not one to assume away. The audit
# runs both builds against one pinned checkout, back to back, on a private copy.
INDEX_POPULATION_MOVED = {
    "zig": {
        "audit": ROOT / "validation/m14/measurements/containment-zig-before-rerun-612.json",
        "audit_after": ROOT / "validation/m14/measurements/containment-zig-after-rerun-612.json",
        "why": "load-induced parse timeouts: the before arm ran 65 min at load ~12 with 22\n"
               "timeouts + 1 error, the after arm 38 min with 6 timeouts + 0 errors",
    },
}

# Rows where the source half's own test finds a covering candidate and the stored
# source is nonetheless not it. The rule's claim is "the innermost covering
# candidate that is not the edge's own target", so a row whose covering candidate IS
# the target is the refusal working, not a miss — and the probe's samples carry the
# evidence. Verified against the db directly (all three on zig's after arm):
#   __isPlatformVersionAtLeast@37  constant 31-53 contains function 37-43 (the fn is
#   the target; the const is the wrapper the edge belongs to), panic@1210 and
#   getauxval@519 are the same `pub const X = fn(...)` shape. Moving the source onto
#   its own target is the one move the rule must not make.
KNOWN_SELF_EDGE_RESIDUE = {
    "zig": {
        "rows": 3,
        "why": "every covering candidate IS the edge's own target (const-wrapping-fn), verified in the db",
    },
}

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    if not ok:
        failures.append(f"{label}{' — ' + detail if detail else ''}")
        print(f"FAIL {label}{' — ' + detail if detail else ''}")


def load(p: Path) -> dict:
    return json.loads(p.read_text())


def arg(flag: str) -> Path | None:
    return Path(sys.argv[sys.argv.index(flag) + 1]) if flag in sys.argv else None


def entry(rec: dict, repo: str) -> dict:
    return [x for x in rec["repos"] if x["repo"] == repo][0]


def result(rec: dict, repo: str, probe: str | None = None) -> dict:
    """A sweep record keeps each probe's parsed stdout under repos[i].probes;
    a DB-probe record keeps it directly under repos[i].result. Both spellings are
    read here so a consumer never has to know which instrument wrote the file."""
    e = entry(rec, repo)
    r = ((e["probes"].get(probe) or {}).get("result") if "probes" in e else e.get("result")) or {}
    return r


def gauge(rec: dict, repo: str, probe: str, field: str):
    return result(rec, repo, probe).get(field)


def repro(rec: dict, repo: str, probe: str, field: str):
    """The residual probe's before arm recorded its count as TEXT (pre-JSON-output
    driver); both forms are read, and the text form is parsed explicitly."""
    e = entry(rec, repo)
    p = (e["probes"].get(probe) if "probes" in e else {"result": e.get("result")}) or {}
    if p.get("result") is not None:
        return p["result"].get(field)
    text = p.get("unparsed") or ""
    if "residual (rule should have placed it):" in text and field == "residual":
        return int(text.split("residual (rule should have placed it):")[1].split()[0])
    return None


def idx(rec: dict, repo: str) -> dict:
    return entry(rec, repo)["index"]


def indexed(rec: dict, repo: str) -> dict:
    return idx(rec, repo).get("indexed") or {}


def breakdown(rec: dict, repo: str) -> dict:
    return idx(rec, repo).get("breakdown") or {}


def fmt_load(rec: dict, repo: str) -> str:
    la = idx(rec, repo).get("loadAverage") or {}
    if not la:
        return "—"
    return f"{la.get('before')}→{la.get('after')}"


def main() -> int:
    before, after = load(arg("--before") or BEFORE), load(arg("--after") or AFTER)
    owner_before, owner_after = load(OWNER_BEFORE), load(OWNER_AFTER)
    old_before, old_after = load(OLD_BEFORE), load(OLD_AFTER)
    repos = [r["repo"] for r in after["repos"]]

    print(f"before: {before.get('commit','?')[:8]} arm={before.get('arm')} finished={before.get('finishedAt')}"
          f" worktree={before.get('worktree')}")
    print(f"after:  {after.get('commit','?')[:8]} arm={after.get('arm')} finished={after.get('finishedAt')}"
          f" worktree={after.get('worktree')}")
    print(f"replay arms: {old_before.get('commit','?')[:8]} / {old_after.get('commit','?')[:8]}\n")

    # ── §8.2 control set ────────────────────────────────────────────────────
    print("### control set (unique-name edges)")
    print("| repo | lang | unique-name edges | edge line == target's stored line | | |")
    print("|---|---|---|---|---|---|")
    u_total = m_total = 0
    for repo in repos:
        pair = {}
        for arm, rec in (("before", before), ("after", after)):
            tot = gauge(rec, repo, "contains-line-hint-612", "containsEdgesTotal")
            amb = gauge(rec, repo, "contains-line-hint-612", "ambiguousTargetName")
            eq = gauge(rec, repo, "contains-line-hint-612", "edgeLineEqualsTargetLine")
            ambeq = gauge(rec, repo, "contains-line-hint-612", "ambiguousAndEdgeLineEqualsTargetLine")
            pair[arm] = (tot, amb, eq, ambeq)
        identical = pair["before"] == pair["after"]
        if identical:
            check(f"control set identical on both arms ({repo})", True)
        else:
            # The excuse has to be earned: the STORED POPULATION must have moved (files
            # and wall clock always wobble; symbols and relationships are what a moved
            # containment population has to come from), and the repo must carry a
            # re-measurement of both arms.
            ib, ia = indexed(before, repo), indexed(after, repo)
            index_moved = (ib.get("symbols") != ia.get("symbols")
                           or ib.get("relationships") != ia.get("relationships"))
            excused = repo in INDEX_POPULATION_MOVED and index_moved
            # A cited re-measurement has to be a real one: both records present, each
            # carrying the control set for its own arm, each tagged with that arm, and
            # each indexed from a path OTHER than the shared corpus checkout (a re-run
            # of the same directory could not separate the builds' rows from the first
            # pass's). The numbers themselves are printed below, so a reader can falsify
            # the mechanism the report names.
            audit_ok = False
            if repo in INDEX_POPULATION_MOVED:
                m = INDEX_POPULATION_MOVED[repo]
                if m["audit"].exists() and m["audit_after"].exists():
                    ab, aa = load(m["audit"]), load(m["audit_after"])
                    def control_set(rec: dict) -> tuple | None:
                        t = gauge(rec, repo, "contains-line-hint-612", "containsEdgesTotal")
                        a = gauge(rec, repo, "contains-line-hint-612", "ambiguousTargetName")
                        return None if t is None else (t, a)
                    canonical = entry(before, repo)["path"]
                    audit_ok = (
                        ab.get("arm") == "before" and aa.get("arm") == "after"
                        and control_set(ab) is not None and control_set(aa) is not None
                        and entry(ab, repo)["path"] != canonical and entry(aa, repo)["path"] != canonical
                    )
            check(
                f"control set identical on both arms ({repo})",
                excused and audit_ok,
                f"{pair['before']} vs {pair['after']}" + ("" if excused else " — index summaries identical, so this is a RULE difference"),
            )
            if excused:
                print(f"~    {repo}: containment population MOVED ({pair['before'][0]:,} → {pair['after'][0]:,} edges) "
                      f"with its index summary ({indexed(before, repo)} vs {indexed(after, repo)}); "
                      f"re-measured: {INDEX_POPULATION_MOVED[repo]['why'].splitlines()[0]}")
        tot, amb, eq, ambeq = pair["after"]
        u, m = tot - amb, eq - ambeq
        u_total += u
        m_total += m
        lang = entry(after, repo)["lang"]
        print(f"| {repo} | {lang} | {u:,} | {m:,} | {100.0*m/u:.2f}% | |")
    print(f"| **all ten** | | **{u_total:,}** | **{m_total:,}** | **{100.0*m_total/u_total:.2f}%** | |\n")

    # ── §8.4 target half ────────────────────────────────────────────────────
    print("### target half (contains-line-hint-612), after arm")
    cols = ["containsEdgesTotal", "containsTargetInAnotherFile", "ambiguousTargetName",
            "ambiguousHintPinsExactlyOne", "ambiguousHintPinsNone", "ambiguousCurrentChoiceMatchesHint",
            "ambiguousOldChoiceWouldBeWrong"]
    print("| repo | lang | " + " | ".join(cols) + " | residual |")
    print("|---|---|" + "---|" * (len(cols) + 1))
    tot = {c: 0 for c in cols}
    res_total = 0
    for repo in repos:
        vals = {c: gauge(after, repo, "contains-line-hint-612", c) for c in cols}
        for c in cols:
            tot[c] += vals[c]
        res = repro(after, repo, "contains-residual-612", "residual")
        check(f"target-in-another-file is 0 ({repo})", vals["containsTargetInAnotherFile"] == 0)
        check(f"matches-hint == line-pins-1 ({repo})", vals["ambiguousCurrentChoiceMatchesHint"] == vals["ambiguousHintPinsExactlyOne"])
        check(f"residual is 0 ({repo})", res == 0, f"got {res}")
        res_total += res or 0
        lang = entry(after, repo)["lang"]
        print(f"| {repo} | {lang} | " + " | ".join(f"{vals[c]:,}" for c in cols) + f" | {res} |")
    print("| **all ten** | | " + " | ".join(f"**{tot[c]:,}**" for c in cols) + f" | **{res_total}** |\n")

    # ── §8.4 old-rule replay ────────────────────────────────────────────────
    print("### the statement this one replaces, replayed (contains-old-rule-612)")
    rcols = ["containsEdgesWithLine", "oldPickWouldDiffer", "oldPickOffLine", "oldPickInAnotherFile",
             "linePinsOneAndOldPickMissesIt", "linePinsOneAndOldPickEscapesTheFile", "idTierOffLine"]
    print("| repo | lang | " + " | ".join(rcols) + " |")
    print("|---|---|" + "---|" * len(rcols))
    rtot = {c: 0 for c in rcols}
    for repo in repos:
        vb = {c: gauge(old_before, repo, "contains-old-rule-612", c) for c in rcols}
        va = {c: gauge(old_after, repo, "contains-old-rule-612", c) for c in rcols}
        if vb == va:
            check(f"replay identical on both arms ({repo})", True)
        elif repo in INDEX_POPULATION_MOVED:
            # The replay is rule-independent per EDGE, but a repo whose population
            # moved holds a different set of edges, so the totals move with it. What
            # is still arm-invariant, and has to be, is the gauges that do not count
            # over the population: how many edges the old statement sends to ANOTHER
            # FILE, and how many of those its own line already pinned.
            for c in ("oldPickInAnotherFile", "linePinsOneAndOldPickEscapesTheFile"):
                check(f"replay: {c} arm-invariant ({repo})", vb.get(c) == va.get(c), f"{vb.get(c)} vs {va.get(c)}")
            print(f"~    {repo}: replay totals move with the population ({vb['containsEdgesWithLine']:,} → "
                  f"{va['containsEdgesWithLine']:,} edges; would-differ {vb['oldPickWouldDiffer']:,} → "
                  f"{va['oldPickWouldDiffer']:,}); the file-escape gauges do not: "
                  f"{va['oldPickInAnotherFile']} / {va['linePinsOneAndOldPickEscapesTheFile']}")
        else:
            check(f"replay identical on both arms ({repo})", False, f"{vb} vs {va}")
        for c in rcols:
            rtot[c] += va[c]
        lang = entry(after, repo)["lang"]
        print(f"| {repo} | {lang} | " + " | ".join(f"{va[c]:,}" for c in rcols) + " |")
    print("| **all ten** | | " + " | ".join(f"**{rtot[c]:,}**" for c in rcols) + " |\n")

    # ── §8.2's 24 rows: the class the exact-line test cannot match ──────────
    print("### the unique-name edges the exact-line test cannot match (contains-inner-line-samples-612)")
    INNER = ROOT / "validation/m14/measurements/containment-inner-line-samples-612.json"
    check("the inner-line samples record exists", INNER.exists(), str(INNER.relative_to(ROOT)))
    if INNER.exists():
        inner = load(INNER)
        print("| repo | lang | unique-name edges | line disagreements | rows checked in source | name IS on the edge's line | name also elsewhere in the span |")
        print("|---|---|---|---|---|---|---|")
        t_u = t_gap = t_ck = t_on = t_ab = 0
        all_samples: list[dict] = []
        for repo in repos:
            ir = result(inner, repo)
            u = gauge(after, repo, "contains-line-hint-612", "containsEdgesTotal") \
                - gauge(after, repo, "contains-line-hint-612", "ambiguousTargetName")
            agree = gauge(after, repo, "contains-line-hint-612", "edgeLineEqualsTargetLine") \
                - gauge(after, repo, "contains-line-hint-612", "ambiguousAndEdgeLineEqualsTargetLine")
            rows_from_gauges = u - agree
            mis = ir.get("uniqueTargetNameLineMismatches") or 0
            checked = ir.get("textChecked") or 0
            onedge = ir.get("nameOnEdgeLine") or 0
            above = ir.get("nameAboveWithinSpan") or 0
            # The shape record must agree with the count gauges of the OTHER probe:
            # two instruments, one number, or the claim is not measured.
            check(f"inner-line rows equal the disagreement gauge ({repo})", mis == rows_from_gauges,
                  f"{mis} vs {rows_from_gauges}")
            check(f"every inner-line row was checked in the source text ({repo})",
                  checked + (ir.get("textSkipped") or 0) + (ir.get("fileUnreadable") or 0) == mis,
                  f"checked={checked} skipped={ir.get('textSkipped')} unreadable={ir.get('fileUnreadable')} of {mis}")
            check(f"the name is on the edge's line in every checked row ({repo})",
                  onedge == checked == mis, f"{onedge} of {mis}")
            t_u += u; t_gap += rows_from_gauges; t_ck += checked; t_on += onedge; t_ab += above
            all_samples += (ir.get("samples") or [])
            print(f"| {repo} | {entry(after, repo)['lang']} | {u:,} | {rows_from_gauges} | {checked} | {onedge} | {above} |")
        print(f"| **all ten** | | **{t_u:,}** | **{t_gap}** | **{t_ck}** | **{t_on}** | **{t_ab}** |\n")
        check("the class holds 24 rows in total", t_gap == 24, f"got {t_gap}")
        shallow = [s for s in all_samples if (s.get("lineGap") or 0) <= 2]
        check("no row's span starts exactly 3 lines above the name (two shapes, not a gradient)",
              all((s.get("lineGap") or 0) != 3 for s in all_samples),
              str([s.get("at") for s in all_samples if (s.get("lineGap") or 0) == 3]))
        check("the span opens 1-2 lines above the name in 17 rows", len(shallow) == 17, f"got {len(shallow)}")
        check("the report's two named examples are rows of the record",
              any(s.get("name") == "get_decimal_point" and s.get("at", "").endswith("nlohmann/detail/input/lexer.hpp:172")
                  for s in all_samples)
              and any(s.get("name") == "write2digits" and s.get("at", "").endswith("include/fmt/format.h:1210")
                      for s in all_samples))
        print(f"    span opens ≤2 lines above the name: {len(shallow)} rows; further up: {len(all_samples) - len(shallow)} rows")
        print(f"    rows whose name ALSO occurs inside the span above the edge's line: {t_ab} "
              f"({'; '.join(s['at'] for s in all_samples if s.get('nameAboveWithinSpan'))})\n")

    # ── §8.5 source half and owner column ─────────────────────────────────────
    print("### source half, before → after")
    print("| repo | lang | edges before → after | not enclosing before → after | moved by the rule before → after | ambiguous w/o covering candidate (the rule declines) |")
    print("|---|---|---|---|---|---|")
    t_edges = t_ne = t_mv = t_nocand = 0
    a_edges_tot = t_a_ne = t_a_mv = 0
    for repo in repos:
        b_edges = gauge(before, repo, "contains-source-span-delta-612", "containsEdges")
        a_edges = gauge(after, repo, "contains-source-span-delta-612", "containsEdges")
        b_ne = gauge(before, repo, "contains-source-span-delta-612", "storedSourceDoesNotEncloseChildLine")
        a_ne = gauge(after, repo, "contains-source-span-delta-612", "storedSourceDoesNotEncloseChildLine")
        b_mv = gauge(before, repo, "contains-source-span-delta-612", "spanCandidateDiffersFromStoredSource")
        a_mv = gauge(after, repo, "contains-source-span-delta-612", "spanCandidateDiffersFromStoredSource")
        no_cand = gauge(after, repo, "contains-source-hint-612", "spanPinsNone")
        a_amb_ne = gauge(after, repo, "contains-source-span-delta-612", "ambiguousSourceDoesNotEncloseChildLine")
        residue = KNOWN_SELF_EDGE_RESIDUE.get(repo)
        n_samples = len(result(after, repo, "contains-source-span-delta-612").get("samples") or [])
        if a_mv == 0:
            check(f"source half moved nothing left to move ({repo})", True)
        else:
            # A residue is only acceptable when it is ALL of the rows (the samples are
            # capped at 8) and it is the reviewed shape; an unexplained count fails.
            check(f"source half moved nothing left to move ({repo})",
                  bool(residue) and a_mv == residue["rows"] and n_samples == a_mv,
                  f"got {a_mv}, samples {n_samples}" + (f" — {residue['why']}" if residue else ""))
            if residue and a_mv == residue["rows"]:
                print(f"~    {repo}: {a_mv} rows stay on their stored source — {'; '.join(
                    f"{s['sourceName']}@L{s['at'][1:]} ({s['current'].split('@')[0]}) vs {s['spanPick']} "
                    f"(the edge's own target)" for s in (result(after, repo, 'contains-source-span-delta-612').get('samples') or []))}")
        nb = gauge(before, repo, "contains-source-hint-612", "spanPinsNone")
        check(f"ambiguous sources with no covering candidate are arm-invariant ({repo})", nb == no_cand, f"{nb} vs {no_cand}")
        # The residue that KEEPS a non-enclosing source is exactly the rows whose own
        # evidence cannot place it. A row where a covering candidate exists must have
        # been moved (a_mv == 0), so the remaining non-enclosing rows are the ones with
        # no candidate at all — the refusal, counted rather than asserted away.
        check(f"non-enclosing residue == rows with no covering candidate ({repo})",
              a_amb_ne == no_cand, f"{a_amb_ne} vs {no_cand}")
        lang = entry(after, repo)["lang"]
        t_edges += b_edges; a_edges_tot += a_edges; t_ne += b_ne; t_a_ne += a_ne
        t_mv += b_mv; t_a_mv += a_mv; t_nocand += no_cand
        print(f"| {repo} | {lang} | {b_edges:,} → {a_edges:,} | {b_ne:,} → {a_ne:,} | {b_mv:,} → {a_mv:,} | {no_cand} |")
    print(f"| **all ten** | | **{t_edges:,} → {a_edges_tot:,}** | **{t_ne:,} → {t_a_ne:,}** | "
          f"**{t_mv:,} → {t_a_mv:,}** | **{t_nocand:,}** |")
    print()

    print("### owner column, before → after")
    print("| repo | lang | owned before → after | contradicted before → after | covering candidate (rule acts, before) | rows whose owner changes at all |")
    print("|---|---|---|---|---|---|")
    t_owned = t_a_owned = t_con = t_a_con = t_fix = t_diff = 0
    for repo in repos:
        ob = result(owner_before, repo)
        oa = result(owner_after, repo)
        t_owned += ob.get('ownedSymbolsWithLine') or 0; t_a_owned += oa.get('ownedSymbolsWithLine') or 0
        t_con += ob.get('contradictedOwner') or 0; t_a_con += oa.get('contradictedOwner') or 0
        t_fix += ob.get('fixableByOwnName') or 0; t_diff += ob.get('ownerDiffersFromInnermost') or 0
        check(f"owner column residue agrees with the source half ({repo})",
              (oa.get('contradictedOwner') or 0) == gauge(after, repo, "contains-source-span-delta-612", "storedSourceDoesNotEncloseChildLine"),
              f"{oa.get('contradictedOwner')} vs {gauge(after, repo, 'contains-source-span-delta-612', 'storedSourceDoesNotEncloseChildLine')}")
        print(f"| {repo} | {ob.get('lang')} | {ob.get('ownedSymbolsWithLine'):,} → {oa.get('ownedSymbolsWithLine'):,} "
              f"| {ob.get('contradictedOwner'):,} → {oa.get('contradictedOwner'):,} "
              f"| {ob.get('fixableByOwnName'):,} | {ob.get('ownerDiffersFromInnermost'):,} |")
    print(f"| **all ten** | | **{t_owned:,} → {t_a_owned:,}** | **{t_con:,} → {t_a_con:,}** | **{t_fix:,}** | **{t_diff:,}** |")
    print()

    # ── index summaries, and the zig audit ──────────────────────────────────
    print("### index summaries, arm against arm")
    print("| repo | files | symbols | relationships | rel Δ | timeouts/errors | wall s | load | verdict |")
    print("|---|---|---|---|---|---|---|---|---|")
    for repo in repos:
        ib, ia = indexed(before, repo), indexed(after, repo)
        bb, ba = breakdown(before, repo), breakdown(after, repo)
        # The SYMBOL SELECTION is the population the containment probes read (candidate
        # sets are symbols). Relationship totals wobble within a run-to-run band even
        # when every symbol is identical (jq +2, cargo +43, go-tools +45, terraform
        # +502 of 159k-248k, i.e. ≤0.2%, with 0-2 timeouts), so they are shown with the
        # delta and not used as the verdict.
        population_same = ib.get("files") == ia.get("files") and ib.get("symbols") == ia.get("symbols")
        rel_delta = (ia.get("relationships") or 0) - (ib.get("relationships") or 0)
        print(f"| {repo} | {ib.get('files')} → {ia.get('files')} | {ib.get('symbols')} → {ia.get('symbols')} | "
              f"{ib.get('relationships')} → {ia.get('relationships')} | {bb.get('timeouts')}/{bb.get('errors')} → "
              f"{ba.get('timeouts')}/{ba.get('errors')} | {idx(before,repo)['wallSeconds']} → {idx(after,repo)['wallSeconds']} | "
              f"{fmt_load(before,repo)} → {fmt_load(after,repo)} | "
              f"{'+' if rel_delta >= 0 else ''}{rel_delta} | "
              f"{'identical selection' if population_same else 'SELECTION MOVED'} |")
    print()

    audit_paths = [m["audit"] for m in INDEX_POPULATION_MOVED.values()] + [m["audit_after"] for m in INDEX_POPULATION_MOVED.values()]
    present = [p for p in audit_paths if p.exists()]
    if present:
        print("### the moved population, re-measured (both builds, one private pinned checkout)")
        print("| run | record | commit | indexer sha | files | symbols | relationships | timeouts/errors | wall s | load |")
        print("|---|---|---|---|---|---|---|---|---|---|")
        for p in present:
            rec = load(p)
            repo = rec["repos"][0]["repo"]
            ib, bb = indexed(rec, repo), breakdown(rec, repo)
            print(f"| {rec.get('arm')} | {p.name} | {rec.get('commit','?')[:8]} | {rec.get('indexerSha256','?')[:12]} | "
                  f"{ib.get('files')} | {ib.get('symbols')} | {ib.get('relationships')} | "
                  f"{bb.get('timeouts')}/{bb.get('errors')} | {idx(rec,repo)['wallSeconds']} | {fmt_load(rec,repo)} |")
        print()
        # What the audit is FOR: does an arm's re-run land near its first pass, and
        # do the two builds still separate? Printed as the numbers, not a verdict.
        for m in INDEX_POPULATION_MOVED.values():
            if not (m["audit"].exists() and m["audit_after"].exists()):
                continue
            repo = "zig"
            for rec, label in ((before, "first-pass before"), (after, "first-pass after"),
                               (load(m["audit"]), "audit before"), (load(m["audit_after"]), "audit after")):
                r = gauge(rec, repo, "contains-line-hint-612", "containsEdgesTotal")
                amb = gauge(rec, repo, "contains-line-hint-612", "ambiguousTargetName")
                pinned = gauge(rec, repo, "contains-line-hint-612", "ambiguousHintPinsExactlyOne")
                matches = gauge(rec, repo, "contains-line-hint-612", "ambiguousCurrentChoiceMatchesHint")
                print(f"    {label:18} edges={r:,} ambiguous={amb:,} pins1={pinned:,} matches={matches:,} "
                      f"rels={indexed(rec, repo).get('relationships'):,} timeouts={breakdown(rec, repo).get('timeouts')}")
        print()

    print(f"\nchecks failed: {len(failures)}")
    for f in failures:
        print(f"  - {f}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
