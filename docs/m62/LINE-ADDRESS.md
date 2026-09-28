# Call-site addresses in bb_lsp — the three-store contract (M62)

> **GENERATED** by `script/m62/verify-docs.ts` from the live owner
> (`src/intelligence/graph/line-address.ts`), the fixture's declared renderings and
> the M62 ledger. Do not edit — regenerate with
> `npx tsx script/m62/verify-docs.ts --write`. The drift gate is byte-identical
> equality; a hand edit fails it.

## Why this exists

A stored `brain_relationship.line_number` is written by the indexer. For most
languages it is the literal `0` (no call-site line stored); some analyzers store a
real 1-based line, and M59 changes the store to "a real line, or `NULL`". A surface
that renders the raw value therefore shows a position it does not know. This
milestone gives every stored line exactly one interpretation, owned by one module,
and every display surface consumes that interpretation instead of the number.

## The states (derived by running the owner's classifier)

| stored `line_number` | state | may be shown as |
| --- | --- | --- |
| `42` | `real` | an exact call site |
| `1` | `real` | an exact call site |
| `0` | `legacy-placeholder` | a labeled substitute, or a declared unknown |
| `NULL` | `not-stored` | a labeled substitute, or a declared unknown |
| `undefined` (not selected) | `not-stored` | a labeled substitute, or a declared unknown |
| `-3` | `unusable` | nothing (never substituted) |
| `2.5` | `unusable` | nothing (never substituted) |
| `NaN` | `unusable` | nothing (never substituted) |
| `Infinity` | `unusable` | nothing (never substituted) |

## The declared vocabulary

| note | text |
| --- | --- |
| `legacy` | `call site not stored (legacy index: line_number is 0)` |
| `notStored` | `call site not stored (no line_number in the index)` |
| `substitute` | `this is the calling symbol's declaration, not the call site` |
| `unusable` | `call site not stored (unusable line_number in the index)` |

The address kinds are: `call-site`, `declaration`, `unknown`.
A bare `file:line` is produced for `call-site` only; every other kind carries its note.

## The formatter's output (the fixture's declared renderings)

| address | rendered |
| --- | --- |
| `{"kind":"call-site","file":"src/a.ts","line":12}` | `src/a.ts:12` |
| `{"kind":"call-site","file":"","line":7}` | `line 7` |
| `{"kind":"declaration","file":"src/a.ts","line":40,"note":"this is the calling symbol's declaration, not the call site"}` | `src/a.ts:40 — this is the calling symbol's declaration, not the call site` |
| `{"kind":"declaration","file":"","line":3,"note":"this is the calling symbol's declaration, not the call site"}` | `line 3 — this is the calling symbol's declaration, not the call site` |
| `{"kind":"unknown","file":"src/a.ts","line":null,"note":"call site not stored (legacy index: line_number is 0)"}` | `src/a.ts — call site not stored (legacy index: line_number is 0)` |
| `{"kind":"unknown","file":"","line":null,"note":"call site not stored (no line_number in the index)"}` | `call site not stored (no line_number in the index)` |

`addressLine0` returns the 0-based editor line for a `call-site` address and `null`
otherwise; it is drift-gated against the position owner (`src/lsp/positions.ts`,
`indexToLsp`) by `script/m62/verify-address.ts` — one conversion rule, two readers.

## The milestone ledger

The machine record of this milestone's issue states is
`validation/m62/results/manifest.json`, projected from the evidence records by
`script/m62/verify-governance.ts`. This doc deliberately does NOT restate those
states: a restated status is a second place that can drift, and a byte-gated doc
embedding a live fact re-stales itself on every run (the M53/M61 lesson).

## Arrival: what M59 changes, and what it does not

`script/m62/verify-arrival.ts` is the milestone's acceptance for M59 (Call-Site
Truth). It seeds one real index with every store state, drives the real engine, the
hub payload and the agent's `bb_graph` payload, then re-writes the rows with real
lines (what a re-index does) and asserts the SAME surfaces serve exact call sites —
with no code change here. Multiplicity (two rows for one caller) is declared by the
hub's per-group counts, the shape M59.A4/A8 will produce.

## What is NOT claimed

- **Per-language real-line coverage** is not claimed here: which analyzers store a
  real call-site line (and how many rows per language) is measured and published by
  M59's lane (M59.A7). This doc claims the CONTRACT, not the coverage.
- **The store's own write rule** (`NULL` vs `0`, row identity/multiplicity) belongs to
  M59.A2/A4/A8. This milestone only guarantees that whatever the store writes is
  interpreted honestly, today and after M59 lands.
- **References and call hierarchy** keep navigating to the referencing symbol's own
  indexed location (byte-accurate). They do not claim a call-site line; the exact
  stored call-site address is served by the graph, hub and MCP surfaces.
