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

## Not in scope (declared)

- Analyzer emission of call-site lines per language (M59.A7) and the store's
  `NULL`-vs-`0` write rule (M59.A2) — co-agent lane.
- Usage-row multiplicity / duplicate-edge collapse (M59.A4/A8): those change
  *what a row is*; when they land the hub model is re-derived in the
  M53-pattern convergence pass, not here.
- References/call-hierarchy exactness where a real line does not exist keeps
  its current declared behavior (M24 L5 / M55.T3 evidence).
