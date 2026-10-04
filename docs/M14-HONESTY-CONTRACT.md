# M14 — Honesty Contract: Vocabulary, Claim Levels, and Lie Catchers

Status: **RATIFIED — this document governs all M14 work. Every M14 issue, evidence
file, commit message, and summary MUST comply with it. No exception without a
written amendment in this file.**

## 0. Why this exists

The M13 retrospective found that agents (including AI agents) had claimed tools were
"verified", "green", and "complete" when the underlying suites proved less than the
words implied — fixtures stayed green regardless of behavior, aspirational modes were
advertised as executable, and success language outran evidence. The failure was not
technical; it was **governance**: the same agent wrote the code, wrote the test,
wrote the evidence, and then reported the verdict.

This contract makes honesty a property of the pipeline, not a promise from an agent.
An agent cannot produce "green". Only the harness can, from oracles the agent does not
control, under tests proven capable of failing.

Scope: all analyzer-layer work in M14 (`src/ast/real-*-analyzer.ts`, engine wiring,
parallel indexer, cross-language consumers, taints, brain DB integrity).

---

## 1. Banned vocabulary

The following words are **banned** in all M14 artifacts (code, docs, evidence JSON,
commit messages, PRs, agent summaries) because they are verdicts no artifact can
honestly carry:

| Banned | Why |
| --- | --- |
| perfect / perfection | Unfalsifiable. Nothing is proven free of all defects. |
| complete / fully done | Hides scope. Claims are scoped or they are false. |
| production-ready | A release decision, not an evidence result. |
| bulletproof / rock-solid / battle-tested | Marketing, not measurement. |
| extensively tested / thoroughly reviewed | Unquantified. Counts or it didn't happen. |
| should work / expected to pass | Prediction dressed as result. |
| green (as a standalone claim by an agent) | Only the harness emits pass/fail. Agents quote it with a path to the evidence file. |
| 100% coverage / fully verified (unscoped) | Coverage of what, measured how? Either name the denominator or don't say it. |

Using a banned term in an M14 artifact is itself a gate failure
(`script/verify-honesty.ts` lints for these terms in `docs/`, `plans/`,
`validation/m14/`, and evidence files).

---

## 2. The only allowed claim levels

Every statement about any analyzer must use exactly one of these machine-defined
levels. Each level has a mechanical precondition enforced by the harness — saying the
word without the precondition being true makes the artifact fail verification:

### L0 — UNVERIFIED
Default state of everything. No evidence file, or stale evidence (evidence commit ≠
current HEAD). An L0 item may be worked on; it may not be relied upon, documented as
working, or shipped behind a "verified" label.

### L1 — FIXTURE-PASSED
Analyzer output matches expectations on named fixture files.
Precondition: evidence lists each fixture with input hash, expectation source, and
result. Fixtures alone can never exceed L1.

### L2 — ORACLE-CONFORMANT
All node-type/syntax references in the analyzer are validated against the language's
real grammar definition (`node-types.json` / `grammar.json`), parsed fresh at verify
time — not against a hand-maintained list.
Precondition: `script/audit-analyzer-grammar.ts` passes for the language with zero
unknown node types and zero dead branches (branches whose predicate can never match
per the grammar).

### L3 — DIFFERENTIALLY-CHECKED
On pinned real repositories (fixtures corpus), sampled symbols/relationships were
compared against an independent second opinion (tree-sitter CLI query dumps or
hand-audited samples recorded with reviewer = human or a different agent than the fix
author).
Precondition: differential run stored, sampling rate stated, discrepancies either
fixed or filed as issues. Sampling may never be zero.

### L4 — MUTATION-HARDENED
Deliberately injected defects (relationship mislabeling, dropped node type, swapped
predicate) caused the suite to fail.
Precondition: mutation log present per analyzer: which mutant, where, and which check
caught it. If a mutant survives, the suite fails — not the mutant.

### L5 — SCOPED-VERIFIED  ← highest attainable level
L2 ∧ L3 ∧ L4 ∧ evidence fresh at current commit ∧ limitations declared non-empty-or-
justified. **This is the only state that may be described as "verified", and always
with its scope attached**: "L5-verified against tree-sitter-java vX.Y.Z, corpus:
<repos>, limitations: <list>".

There is no level above L5. Anyone tempted to invent one should reread §1.

---

## 3. Limitations are mandatory

Every analyzer's evidence file contains a `limitations` array. An empty array requires
a written justification field explaining why the language has no dynamic semantics
(e.g. json/yaml qualify). For all Turing-complete languages, blank limitations are
treated as **dishonesty, not excellence**: if you found nothing uncertain, you did not
look.

Known limitation classes that must be declared where applicable:
- dynamic dispatch / metaprogramming resolution (ruby, python, groovy, ruby-on-rails DSLs)
- heuristic call-edge inference (confidence < 1.0 edges, incl. PascalCase-instantiation heuristics)
- macro/template expansion boundaries (c, cpp, rust, hcl)
- grammar-version drift exposure (any analyzer referencing grammar internals)

---

## 4. Confidence honesty rule

Any relationship or symbol emitted with `confidence < 1.0` must:
1. carry a machine-readable reason code (not just a number),
2. never flow into a consumer that treats it as ground truth without an explicit
   threshold decision recorded in that consumer's code,
3. be countable: evidence reports the ratio heuristic/deterministic edges per corpus
   repo, so "how much of this graph is guesswork" is a queryable number, never a vibe.

---

## 5. The lie catchers (enforcement mechanisms)

These are the mechanisms that make self-certification structurally impossible:

1. **Machine-emitted evidence.** Evidence JSON in `validation/m14/results/` is written
   only by verifier scripts. Agents edit code/fixtures, never results. Drift test:
   evidence content must regenerate byte-identical from the current commit.
2. **Independent oracles.** Grammar conformance reads the grammar package's own
   node-types data at verify time. Fixture expectations are authored before observing
   analyzer output (expectation files carry their own authorship/timestamp metadata).
3. **Mutation testing (test-the-tests).** Each wave injects known defects and requires
   the suite to go red. Surviving mutants fail the build.
4. **Silence is guilt.** No skip/pending/todo states in harnesses. Skipped check =
   failed check. Missing fixture = failed. Empty result over a non-empty corpus =
   failed.
5. **Separation of duties.** Where feasible, the author of a fix is not the author of
   the only check covering it; cross-review (including by the co-agent working other
   layers) is logged in evidence `reviewers` fields.
6. **Human spot-check ritual.** Per wave, the owner re-executes N randomly drawn
   claims by hand (index a repo, query edges, compare). Results — including any
   discrepancies — are appended to the wave evidence. Discrepancies are findings, not
   embarrassments; hiding one is a contract violation.
7. **Red-team duty.** Each wave reserves effort for adversarial review of our own
   gates: find the tautological check, the trivially-true fixture, the oracle that
   shares a bug with the analyzer. Red-team findings are filed as issues like any
   other.
8. **The honesty gate.** `script/verify-honesty.ts` runs last in `npm run verify`:
   evidence freshness, banned-term lint, mutation-proof presence, limitations
   populated, no hand-edited artifacts, corpus commits pinned. Release is blocked on
   any failure.

---

## 6. What "done" means in M14

A wave or the milestone is done when — and only when:
- every in-scope analyzer has an evidence file at **L5**, regenerated at current HEAD;
- every declared limitation is either accepted in writing by the project owner or
  converted into a filed issue;
- the honesty gate passes on a clean checkout;
- the wave summary quotes evidence file paths, never adjectives.

Done is a property of evidence. Everything else is commentary.

## Dual-lens acceptance regime (2026-09-04, binding)

Gates alone are NOT acceptance for any analyzer. The csharp wave (issue #264)
proved 10 real defect classes can pass every gate for weeks; only the
line-by-line read plus corpus census catches what nobody encoded.

Every analyzer claiming "done" from 2026-09-04 onward — including all M14
languages not yet started (clean, clojure, elixir, erlang, fsharp,
powershell, bash, lua, r, makefile, sql, graphql, json, yaml, xml, hcl,
html, css, markdown) — must pass:

1. Line-by-line read of the analyzer source (dead code, unconnected logic,
   asymmetries noted).
2. Corpus census + differential on real repositories (F8 + F5; one 200+-file
   run per family).
3. Probe-verified fixes only — parse-level evidence both directions.
4. Fixture pins/forbids authored from re-probed emission + regression mutants.
5. Full F1–F9 battery + SPEC + CC1 + honesty, all green at HEAD.
6. Commit with evidence on the language's tracking issue.

Method and ordering: M34 tracking issue #593. Precedents: #264 (csharp),
#271 (haskell, dart gates). The 18 gated-done analyzers receive this pass
under M34 before M14's remaining languages begin.

## Rule: an instrument must declare the population it covered

Three separate findings in this programme were the *same* defect, and none of them
was a wrong number — each was a **correct number about the wrong population**, which
is the most dangerous shape a number can take because every downstream reader treats
it as a finding.

| Where | Printed | Actually covered | Truth |
|---|---|---|---|
| `incoming-check` per-type table | `imports  0 edges` | 0 of the labels the store emits | 253 (zig), 153 (clean), 55 (haskell) |
| `probe-bash-no-regex.mts` | `0 regex literals across 0 of 16 files` | 16 of the lane's 25 files | 1 regex, in a file never scanned |
| dart census, documented command | 43,042 `calls` | 1,250 of 2,735 files | 22,436 |

The dart row is the sharpest, because the number and the command that produced it
were printed **side by side** and still disagreed by half. Nothing detects this except
someone re-running the command and comparing.

**The rule.** Any instrument that prints a count must also print the population it
counted over, and that population must be *derived* rather than hand-written — a
hard-coded file list rots silently and no reviewer diffs it against the directory. A
hand-written `FILES = [...]` array is a defect the moment a file is added beside it,
and the instrument will keep reporting `0` with total confidence.

Two consequences that are now programme-wide:

1. **A count of zero is a claim that needs its population attached.** "0 regexes" and
   "0 regexes across 16 of 25 files" are not the same statement, and only the second
   is true.
2. **Where the population is a list, derive it** (`readdir`, a glob, the registry) so
   it cannot drift. If it cannot be derived, the instrument must fail loudly when the
   list is shorter than the subject, rather than printing a smaller `N` as though it
   were the whole.

This generalises beyond regexes: it is the same rule that makes a sampled coverage
number report its sample size, and that makes a project-wide percentage state its
denominator.
