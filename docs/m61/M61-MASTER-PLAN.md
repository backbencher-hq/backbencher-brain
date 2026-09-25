# M61: Verifier Truth — the machinery that watches the machinery

GitHub milestone: `61`
Lane: `script/*`, `validation/*` only — **no co-agent files** (M14/M37/M59/M60 lanes untouched).
Governing contract: [IDE Honesty Contract](../IDE-HONESTY-CONTRACT.md)

## Motivation (evidence, not instinct)

Our lane has been burned three times by verifiers themselves:

1. **The TDZ staleness bug (M29, this session)** — a dynamic import placed below
   its first use made the wave gate report *every* leg stale. We almost re-ran
   the whole program on a false alarm. Caught by pain, not by machinery.
2. **The I1 cap bug (M29)** — the protocol runner hardcoded S5 as "blocked",
   capping fully-verified languages at I1 *forever* while the gate said verified.
   The ledgers believed it for weeks.
3. **The receipt self-staling loop (M53)** — a byte-gated doc embedded the live
   HEAD; the commit recording it re-staled it. Every "red" that afternoon was
   this loop, and the fix was local, not structural.

And the two structural holes that remain open at HEAD `eec76d37`:

- **Evidence is never sealed.** Only `sourceFingerprint` exists (hash of a
  component's source, pinned inside evidence). No evidence file carries a
  content hash any gate cross-checks. A clobbered, hand-edited, or half-written
  record is believed by every downstream gate.
- **34 evidence files are written by 2+ distinct gates** (PRECISION-LEDGER.json
  by six, R3.json by four). The concurrent-run cascade that cost an afternoon
  was fixed procedurally (run things sequentially), not mechanically.

## Decisions

- **D-1 (seal at write):** every evidence JSON write goes through one library
  that records a sha256 of the record content. Gates verify seal-vs-content
  before trusting any record. Hand edits fail loudly. **Migration rule:** a
  one-shot migration re-seals the ~690 legacy records; during the declared
  transition window gates WARN on unsealed legacy records and FAIL on unsealed
  new ones — never the reverse, never silent.
- **D-2 (lock per results dir):** gate scripts take a declared lock on their
  results dir. A concurrent run waits (bounded) or refuses with reason. The
  clobber cascade becomes structurally impossible.
- **D-3 (reproduce, don't trust):** a reproducibility auditor re-executes the
  recorded commands of a sample of stored evidence and diffs against the stored
  result. Evidence that no longer reproduces is surfaced, never silently aged.
  **Distinguishing rule:** the auditor separates "command failed" from "the
  harness killed it" (timeout/signal) — a kill is re-run/blocked-with-reason,
  never recorded as non-reproducibility (the m53 RC=124 lesson, made machinery).
- **D-4 (a gate that cannot fail is not evidence):** a verifier lint requires
  every gate to declare outputs, relevant inputs, and carry can-fail mutants.
  A gate without a can-fail proof fails the lint. **Wiring rule:** every gate
  is declared in exactly one execution tier (CI fast / nightly / on-demand);
  a gate wired nowhere fails the lint — unwired gates rot silently.
  **Skip-mode rule:** every skip env-var is declared in the lint (skip modes
  are audited surface, not folklore).
- **D-5 (claims are re-derived):** every numeric claim in README/website/docs
  is machine-re-derived from the evidence it cites. Prose numbers drift no more.
  **Gate-internal facts rule:** facts embedded in gate code (e.g. the launch
  set listed inline in script/m24/verify-server.ts) must derive from the
  authority record (approval files, library constants) — an inline literal
  duplicating an authority is a lint failure.
- **D-6 (bug-class extinction):** every verifier-bug class this program has hit
  (TDZ import, silent cap, self-staling byte-gate, concurrent clobber, dynamic
  import below first use) becomes a permanent mutant in the relevant gate.
- **D-7 (lane discipline):** M61 touches `script/*` and `validation/*` only.
  Co-agent files are read-only. The lane-protection hook already guards this.

## Issues / Issue groups

| # | Code | Title | Acceptance (summary) |
|---|------|-------|----------------------|
| [#842](https://github.com/backbencher-hq/backbencher-brain/issues/842) | V1 | Evidence sealing library + adoption in the IDE-lane gates | one write path, sha256 seal, seal-vs-content check in G1-class gates, mutants prove tamper/clobber detection |
| [#843](https://github.com/backbencher-hq/backbencher-brain/issues/843) | V2 | Gate serialization lock | declared lock per results dir, bounded wait, loud refusal, concurrent-run mutant |
| [#844](https://github.com/backbencher-hq/backbencher-brain/issues/844) | V3 | Reproducibility auditor | re-executes recorded commands of a sampled evidence set, diffs, blocked-with-reason on missing runtime |
| [#845](https://github.com/backbencher-hq/backbencher-brain/issues/845) | V4 | Verifier lint | every gate declares outputs/inputs/mutants; lint fails gates without can-fail proofs |
| [#846](https://github.com/backbencher-hq/backbencher-brain/issues/846) | V5 | Claim pins | README/website/docs numbers re-derived from evidence; byte-gated regeneration |
| [#847](https://github.com/backbencher-hq/backbencher-brain/issues/847) | V6 | Bug-class extinction pack | permanent mutants for every historical verifier-bug class in their gates |
| [#848](https://github.com/backbencher-hq/backbencher-brain/issues/848) | G1 | Governance | master plan authority, machine ledger, closure gate, bar re-audit |
| [#849](https://github.com/backbencher-hq/backbencher-brain/issues/849) | X1 | Program-closure audit | M61 + full-lane re-audit at HEAD |

## Review record (2026-09-15, fresh-eyes pass before work began)

Four gaps found and folded in: (1) gate-internal duplicated facts (launch set
hardcoded inline in verify-server.ts:235) — added to D-5/V5; (2) 357 of 372
gates wired to no declared execution tier — added to D-4/V4; (3) harness
timeout-kill vs command failure distinction for the auditor — added to
D-3/V3; (4) no migration rule for the 690 unsealed legacy evidence records —
added to D-1/V1. Skip modes verified already declared (m55 only).

## Completion bar

- All six themes landed fixture-first with can-fail mutants.
- G1 verifies the ledger and re-audits the bar on every run.
- X1 audits M61 and the lane at HEAD, 5/5 mutants.
- Owner verdict per IDE Honesty Contract §8.5 (spot-check pack).
