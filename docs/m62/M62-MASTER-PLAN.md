# M62: Address Truth — nothing shows a position it does not know

GitHub milestone: `62`
Lane: the IDE lane — `src/lsp/*`, `src/intelligence/graph/*`,
`src/intelligence/contracts.ts`, `src/mcp/tool-handlers.ts`,
`script/m26/graph-core.ts`, plus `script/m62/*`, `validation/m62/*`,
`docs/m62/*`. **Co-agent lanes (M14/M37/M58/M59/M60) are read-only.**
Governing contract: [IDE Honesty Contract](../IDE-HONESTY-CONTRACT.md)
Parent program: [IDE Program Decision Record](../IDE-PROGRAM-DECISIONS.md)

## Motivation (measured, not instinct)

The IDE lane shows call-site positions on three surfaces and owns the
derivation of all of them:

- `bb_graph` (MCP, agent-facing) — `callSite` per edge (`src/mcp/tool-handlers.ts`)
- `bb/graph` usages mode (hub payload) — `rows[].callSite` (`src/lsp/graph_usages.ts`)
- hover usages / graph nodes — positions rendered by
  `src/lsp/rich_hover.ts` and `script/m26/graph-core.ts`

At HEAD, `src/intelligence/graph/graph-engine.ts:177` derives a caller edge's
position as `line: row.lineNumber || node.line` — and `:264` as
`line: row.lineNumber || 0`. Measured on this machine: **3,034 stored
relationship rows across 67 indexes carry `line_number = 0`; 0 carry a real
line.** The literal `0` is written for every row by the indexer
(`src/ast/parallel-indexer.ts`), so `row.lineNumber || node.line` substitutes
**the calling symbol's declaration line and presents it as the call site**.
The value is typed non-nullable (`src/intelligence/contracts.ts:81,178:
callSite: { file: string; line: number }`), so *unknown is unrepresentable*.

M59 (Call-Site Truth) changes the store: a real analyzer line, or `NULL`.
M60.P1 (`issue #873`) added the payload's second line base. Those are
co-agent lanes and land on their own schedule. **The consumption contract is
ours, and it must land first**: today a `NULL` or a legacy `0` renders as a
position that looks real, on surfaces an agent and a developer both read.

## Decisions

- **D-1 (one address owner):** exactly one module derives a stored line into a
  typed address and exactly one formatter renders it:
  `src/intelligence/graph/line-address.ts` (pure; no fs, no clock) with the
  type in `src/intelligence/contracts.ts`. No consumer may read
  `brain_relationship.line_number` for display. Enforced by lint + mutants.
- **D-2 (states, declared):** `real` (`> 0`), `legacy-placeholder` (`=== 0`,
  the indexer's literal), `not-stored` (`null`/`undefined`/absent — the M59 A2
  state), and `unusable` (present but not a positive integer: negative,
  fractional, NaN, Infinity). `unusable` was split out during A1's authoring
  because the first draft reported a *present* corrupt value as *absent* — the
  fixture caught it, the correction is in the owner, and the bug class is now a
  permanent mutant (A1 M4, M61 D-6). A non-positive, non-integer, or
  non-finite stored line is never a position.
- **D-3 (substitutes are labeled or absent):** where a position must be shown
  and the stored line is one of the store's DECLARED unknown states (the legacy
  literal, or NULL), the **calling symbol's own declaration** may be shown only
  as `kind: "declaration"` with a declared note. A bare `file:line` may only
  ever be produced for `kind: "call-site"`. Where no substitute exists — and
always for an `unusable` store, which must never be quietly degraded into a
  substitute — the address is `kind: "unknown"` with `line: null`: never `0`,
  never `1`.
- **D-4 (the contract is compile-enforced):** `GraphEdge.callSite` becomes the
  address union, so `tsc` enumerates every consumer; a consumer that wants a
  position must narrow the kind first. The union is the drift gate the old
  `line: number` never had.
- **D-5 (arrival, not rework):** the M59 store change is absorbed for free:
  the same code starts emitting `kind: "call-site"` the moment a real line is
  stored. `script/m62/verify-arrival.ts` seeds all three states in one real
  index and asserts each surface — this is the M59-arrival acceptance hook.
- **D-6 (permanence):** the rule is not a one-off fix — a lint fails any
  display-side read of a raw stored line, and the arrival hook is permanent in
  `npm run verify`.
- **D-7 (lane discipline):** this milestone touches the IDE lane only.
  Co-agent files are read-only; the lane-protection hook guards pushes.

## Issues / Issue groups

| # | Code | Title | Acceptance (summary) |
|---|------|-------|----------------------|
| [#874](https://github.com/backbencher-hq/backbencher-brain/issues/874) | G1 | Governance | master plan authority, machine ledger, closure gate, bar re-audit; hollow closure/removed issue/lane escape each FAIL |
| [#875](https://github.com/backbencher-hq/backbencher-brain/issues/875) | A1 | The address owner | `CallSiteAddress` contract + pure derivation + one formatter; fixture-first mutants prove every state law can fail |
| [#876](https://github.com/backbencher-hq/backbencher-brain/issues/876) | A2 | Consumer adoption | engine/hub/MCP/webview/hover all render through the owner; no surface shows an unlabeled substitute or a fabricated position; lint + mutants |
| [#877](https://github.com/backbencher-hq/backbencher-brain/issues/877) | A3 | Docs + M59 arrival hook | generated byte-gated `docs/m62/LINE-ADDRESS.md`; real-index three-state arrival verification wired into `npm run verify` |
| [#878](https://github.com/backbencher-hq/backbencher-brain/issues/878) | X1 | Lane closure audit | M62 + full IDE-lane re-audit at one HEAD; closure gate green with can-fail proof |

## Completion bar

- A1–A3 landed fixture-first, each with can-fail mutants.
- No display-side read of a raw stored line remains (lint, with a mutant
  proving the lint catches a planted read).
- A `NULL`/legacy-`0` line is never rendered as a position on any surface;
  a real line is rendered as `kind: "call-site"` with no code change.
- G1 verifies the ledger and re-audits the lane bars on every run.
- X1 re-audits the IDE lane at one HEAD.
- Owner verdict per IDE Honesty Contract §8.5 (spot-check pack).

## Lane findings (closure audit, 2026-09-18)

X1 requires every lane bar verified **and fresh by relevance**. Re-earning them
at one HEAD exposed eight defects in the lane that no single milestone's own gate
could see, plus a ninth found in the pass-7 re-audit that follows. Each is fixed
at its owner; none is a documentation note.

1. **A byte-gated document asserted machine reality** (M26 `D1`/`W3`).
   `docs/m26/GRAPH.md` and `docs/m26/CROSS-LANGUAGE.md` are byte-gated against a
   fresh generation, but their generators embedded `Real project dbs scanned: N`
   and one row per pair read live from the operator's `~/.bb/projects`. Any
   `bb index` on the machine therefore rewrote a committed document → the
   `W3`/`D1` records no longer matched their files (`W3:stale-commit,
   D1:stale-commit`) → the m26 ladder leg exited 1 → **every downstream closure
   bar read red**. Fixed: `script/m26/ambient-reality.ts` is the one owner of
   the scan; machine reality is recorded with its record
   (`machineReality`, `realPairRows`) and the docs carry a stable pointer.
   New invariant, with a negative control: **two different machine realities
   must produce one document** (M26 `G7`; the leaky generator is the mutant).
   A committed, byte-gated artifact may only assert facts the repository can
   reproduce.
2. **Two drift checks could not fail.** `D1` wrote the file and *then* compared
   it to a fresh generation (the write erased the evidence of a hand edit), and
   `W3` compared a value to itself (`const regenerated = first`). Both now read
   the bytes already on disk and compare them before writing: a hand-edited doc
   fails the next run, which regenerates it. First run after a content change
   fails by design; the run after is the proof.
3. **A derived record with no owner** (M44 `U2`). Its acceptance is the m26
   webview harness, so `validation/m44/results/U2.json` was re-pinned by hand,
   which froze its commit and made `U2:stale-commit` unclearable. `U2` is now
   derived and sealed by `script/m44/verify-hub-list.ts` under six declared laws
   (a red source derives a red record; numbers copied, never restated; the pin
   follows the source), wired into the standard and `verify:fast` chains.
   M44's own plan and records are deliberately untouched by this milestone.
4. **A declared machine dependency in the lane's evidence.** `M29.R3`'s live
   probe needs a persistent 59k-file index under the system temp dir. When that
   cache is cleared the gate reports a **declared skip as a failure** (correct —
   a silent pass would be the bug); the re-earn path is
   `npx tsx script/m29/giant-repo-budget.ts --reuse --index-only`, then re-run
   the gate. Recorded here because it is the one lane bar that cannot be re-earned
   from the repository alone.
5. **A byte-gated document embedded a moving commit** (M55 `C3`).
   `docs/m55/VERDICT-PACK.md` is drift-gated against a fresh generation, but its
   generator wrote the audit HEAD into the pack. Since the pack's own gate pins
   the HEAD it runs at, the identity check was unsatisfiable after any commit —
   a run either changed the file it was about to compare or compared the same
   commit to itself. Fixed:   the C3 identity check normalizes exactly **two declared mutable lines** (the
   audit HEAD and the owner's verdict, which §8.5 makes the owner's to write) and proves in-suite that every other line still
   fails on a hand edit. The rule is now *declared mutable surface + a proof the
   rest is immutable*, instead of an assertion that could never hold.
6. **Evidence whose key order was arbitrary per run** (M29 `R1`/`R4`). The
   headless-editor driver's `raw` payload crossed the Lua boundary as a table,
   so the JSON key order of `S6.json` was whatever the interpreter emitted that
   run. Every artifact that hashed it — the M29 precision ledger among them —
   could therefore never reach a fixpoint, and no amount of re-running helped.
   Fixed at the PRODUCER: `canonicalizeKeys` in `script/lib/evidence.ts` sorts
   keys before sealing, so byte-stability is a property of the record, not a
   hope held by each consumer. The same leg also caught a real on-disk
   corruption on one run — the generated `docs/m29/WAVE-PROTOCOL.md` truncated
   to 0 bytes — and reported it as a failure rather than passing a corrupt
   artifact; its mutant-restore path rewrote the honest doc.
7. **A drift gate compared volatile fields** (M29 `R4`). The precision ledger's
   identity check included the run commit and generation time, so it could only
   ever be green on the exact run that produced it. The ledger's drift comparison
   now covers its stable content only; the volatile fields are recorded, not
   compared.
8. **Two self-references in M62's own auditor** (found closing this milestone,
   and the reason the ledger could not close). (a) `X1`'s check asserted its own
   previous record said `verified`, but that record is written by the very run
   that reads it: the run read the last run's `known-gap`, failed, and wrote
   `known-gap` again — closure was unreachable by construction. The labelled
   rule (`read, not judged`) now does what its name says: the self-owned records
   are read for **shape** (sealed, a legal state), while the verdict that closes
   the ledger stays THIS run's own measured result. (b) `script/m62/` was listed
   in the lane-relevance surface, so every edit to the auditor invalidated all
   six lane bars — a record invalidated by its reader. The list now covers what
   a lane record makes claims about (`src/lsp/`, `src/intelligence/`, the MCP
   handler, each lane's own gate scripts); a real regression is still caught.
   Both halves are pinned by negatives, so neither can drift into the other.
9. **A staleness digest over an untracked build output** (M29 `R3`, found in
   the pass-7 lane sweep). The relevant-inputs hash listed
   `dist/lsp/server.js` — an ignored, machine-local file. A clone without
   `dist/` skipped it SILENTLY (the hash loop guarded with `existsSync`), so
   the digest meant different things on different machines and R3 read stale
   on every machine that had not built the exact bundle the record was
   measured with. Fixed: the digest covers the TRACKED inputs that produce the
   bundle (every `.ts` under `src/`, sorted, plus the build config), and the
   built bundle is recorded as an observation with its own sha256 — never
   compared. Two can-fail legs pin the rule: the digest is stable for
   identical inputs and flips when an input's content changes. R3 re-earned
   over the persistent giant index at the fix: 28/28.

## Not in scope (declared)

- Analyzer emission of call-site lines per language (M59.A7) and the store's
  `NULL`-vs-`0` write rule (M59.A2) — co-agent lane.
- Usage-row multiplicity / duplicate-edge collapse (M59.A4/A8): those change
  *what a row is*; when they land the hub model is re-derived in the
  M53-pattern convergence pass, not here.
- References/call-hierarchy exactness where a real line does not exist keeps
  its current declared behavior (M24 L5 / M55.T3 evidence).
