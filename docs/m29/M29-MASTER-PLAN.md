# M29: Precision Waves (IDE Program v5)

Status: `open`
GitHub milestone: `29` (IDE program v5 — "Precision Waves")
Parent program: [IDE Program Decision Record](../IDE-PROGRAM-DECISIONS.md)
Governing contract: [IDE Honesty Contract](../IDE-HONESTY-CONTRACT.md)
Prerequisite: M28 completion bar met (verified by G1).

Name note: "Precision", not the banned P-word — renamed at planning time; the
ambition is unchanged, the vocabulary is governed.

## Purpose

Turn the extension rule (contract §9) into a standing machine: per-language
precision waves (M14-style) whose results flow into the IDE; language N+1
onboarding as a routine gated wave; giant-repo latency budgets measured
in-editor (M19 corpora as the stress set); and a published precision ledger —
per language, per feature, per claim level — because publishing measured
precision is the differentiator no incumbent matches.

## Issue groups

| Code | Issue | Deliverable |
|------|-------|-------------|
| G1 | Governance + v4-bar check | ledger; closure gate; M28 bar still green |
| R1 | Wave protocol | the repeatable onboarding protocol: analyzer #419 conformance → position gate → freshness gate → IDE fixtures → mutants → latency budget → claim-level assignment; protocol documented as a checklist a new language walks |
| R2 | Wave 1 execution | onboard the next languages by the R1 protocol (candidates by ledger state: javascript INVENTORY-DONE, vue NOT-STARTED — actual set chosen by #419 ledger at execution time, owner-approved) |
| R3 | Giant-repo budgets | hover/navigation latency on M19-scale corpora (intellij-community subsets etc.), in-editor where feasible; results recorded with machine + corpus revision |
| R4 | Precision ledger | published per-language/per-feature precision table: claim level, evidence path, differential sampling results, known limitations; regeneration script; staleness policy |
| R5 | Precision improvements | evidence-driven precision work surfaced by R4 (e.g. heuristic-edge reduction feeding the inferred-tier ratio); each fix lands fixture-first with a mutant (F7 rule) |
| V1 | Verifier harness | wave gate runner (one command runs the full R1 checklist for a language); precision-ledger generator + drift gate |
| D1 | Docs | the published ledger (docs + marketplace listing update), wave protocol docs |
| X1 | Gate | closure gate; program-level closure audit across M24–M29 |

## Protocol

Same as prior milestones, plus:

1. A language's IDE claim level may never exceed its analyzer's evidence
   level (#419 state) — the R1 checklist enforces the binding mechanically.
2. The precision ledger is machine-generated; hand-edits reopen the gate.
3. Program closure (X1) requires the full ladder audit: every version's
   completion bar re-verified at current HEAD, every claim level re-checked,
   every limitation still declared.

## Completion bar for v5 (program closure)

1. R1 protocol documented and executed for at least one new language beyond
   the launch five, end to end, with the wave gate green.
2. Giant-repo latency budgets measured and recorded; any miss is a filed
   defect, not a footnote.
3. Precision ledger published, regenerable, drift-gated.
4. Program-level audit (X1) green across M24–M29 at current HEAD.
5. Owner spot-checks (contract §8.5) recorded for the wave.

## Negative list

- No language onboarded by shortcut around the R1 checklist.
- No precision number published that is not machine-regenerable.
- No claim level above the analyzer's evidence level, ever.
- The program does not declare the idea "achieved" — the owner does, on the
  evidence, per the spot-check ritual.
