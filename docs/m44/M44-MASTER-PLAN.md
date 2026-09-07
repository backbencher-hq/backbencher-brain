# M44: The Understandable Hub (IDE Program v7)

Status: `open` (filed on GitHub)
GitHub milestone: `44` (free slot confirmed against the live board, 2026-09-06; M43 is the
co-agent's active lane and is not touched)
Parent program: [IDE Program Decision Record](../IDE-PROGRAM-DECISIONS.md)
Governing contract: [IDE Honesty Contract](../IDE-HONESTY-CONTRACT.md) (extended by the
Understanding Rules below)
Prerequisite: M29 + M42 completion bars met — re-audited by G1 on every run (full-ladder
green at the filing commit).

Name note: "The Understandable Hub" — no banned vocabulary. The ambition is that a
developer landing on a usage/hub/graph surface understands, in one second: what this is,
what is clickable, why rows repeat or differ, and what every badge means.

## Why now (evidence, not opinion)

Live demo (`bb-demo-ts`, index `7b21375f…`, 2026-09-06, owner session): the hub for root
`Greeter` reports **9 callers · 1 callee** and renders them as rows that look duplicated
(`main` five times, `makeReport` twice, an `(external) push · one_of_0` row) while the
index actually holds **9 relationship rows from ~4 distinct callers**. Every row is honest;
the *presentation* reads as noise. The user does not know the rows are clickable, and
"Impact analysis" on a constructor answers `bb/impact: symbol "constructor" is not in the
index` even though `constructor` IS indexed (a resolution bug, not missing data). M42 made
the hover a portal; M44 makes what the portal opens *understandable*.

## Understanding Rules (contract extension, gated from G1)

1. **One row per symbol.** Multiplicity is *data on the row*, never repeated rows. A
   caller appearing five times with no new information is a rendering defect.
2. **Multiplicity is declared.** When a symbol relates through several relationship types
   or occurrences, the row states it (`calls + instantiates · 2 sites`) — nothing is
   merged into silence, nothing is dropped.
3. **Interactive is visibly interactive.** Anything clickable renders a click affordance
   (row hover state, link underline, chevron); a row that looks like text but is not a
   link is a defect; a link that does nothing is a defect (M42 rule 1 unchanged).
4. **Counts equal what is rendered.** A header count ("9 callers") counts the groups the
   list shows — never hidden rows, never a number that disagrees with the eye.
5. **Noise is labeled, not hidden.** File-level (`imports`/`exports`) and external rows
   carry declared labels and live in declared sections — never dropped, never dumped as
   indistinguishable symbol rows.
6. **Dead ends are defects.** Any surface that names a symbol/file/usage without a
   working navigation to it is a defect (references fallback included).
7. **The renderer is ONE core, forks banned.** All list/tree/badge rendering comes from
   the M26 W1 core; per-editor forks stay structurally impossible. CSP of the webview
   shell (M26 W6) is unchanged.

## Issue groups

| Code | Issue | Deliverable |
|------|-------|-------------|
| G1 | [#687](https://github.com/backbencher-hq/backbencher-brain/issues/687) Governance + v6-bar check | M44 ledger; closure gate; M29+M42 bars re-audited on every run; Understanding Rules appended to the contract doc and machine-gated |
| U1 | [#688](https://github.com/backbencher-hq/backbencher-brain/issues/688) Usages dedup & grouping (data shape) | `bb/graph` usages mode returns callers/callees grouped per symbol with declared per-group relationship-type and occurrence counts; file-level/external rows separated with declared labels; no data dropped; fixture + mutation proof |
| U2 | [#689](https://github.com/backbencher-hq/backbencher-brain/issues/689) Hub list redesign | `renderHubList`: name-first, one row per symbol, relation chips + counts, click affordance (hover/chevron), group headers; DOM harness positive/negative |
| U3 | [#690](https://github.com/backbencher-hq/backbencher-brain/issues/690) Call tree rework | `renderHubTree`: real expandable tree with per-node counts, labeled leaves, clickable nodes; same harness law |
| U4 | [#691](https://github.com/backbencher-hq/backbencher-brain/issues/691) Header counts + staleness/legend clarity | panel header counts derived from the rendered groups (rule 4); tier/stale badges visually distinct and consistent with the hover legend |
| U5 | [#692](https://github.com/backbencher-hq/backbencher-brain/issues/692) Impact resolution for member/keyword targets | constructors (and member-name targets) resolve through the owning declaration; `constructor` case fixed; declared errors only when the symbol is genuinely absent |
| U6 | [#693](https://github.com/backbencher-hq/backbencher-brain/issues/693) References fallback surface | when the editor's native references surface is unavailable, `show all usages` opens our own usages list instead of a message-only dead end (rule 6) |
| X1 | [#694](https://github.com/backbencher-hq/backbencher-brain/issues/694) Gate + launch bar | M44 closure gate (full-ladder audit at HEAD); in-editor visual leg through E5/E6; every known gap fixed or owner-waived |

### U4 decision (2026-09-07): header counts + the ONE legend

Two laws, gated by `script/m44/verify-legend.ts` (fixture with a duplicated
relationship + real server + 4 mutants) and harness laws AH10/AH11:

- **Header counts are derived from the RENDERED groups** (`hubSummary`),
  never trusted from the server's counts block; the server's group/row
  counts ride as declared `data-server-*` attributes. A fixture where one
  caller holds two stored rows must render "2 callers", never "3"
  (the pre-U1 raw-row bug — now a permanent mutant).
- **ONE legend** (`renderLegend` — graph, hub list, tree, impact: 4 call
  sites in the core) carries the five evidence tiers, the enrichment row,
  and the staleness section (fresh/stale/missing/unknown — cross-checked
  against `src/lsp/freshness.ts`'s marker union). Legend styles ship in the
  ONE hub stylesheet (`script/m26/hub-css.ts`, nonce-bound, W6 unchanged).
  `docs/m44/LEGEND.md` is GENERATED from the live core; the drift gate is
  byte-identical regeneration. The whole-panel stale marker stays a
  hub-panel contract: pinned at source level in U4, asserted live by E5.

### U3 decision (2026-09-07, owner-approved "true nested tree")

The tree nests by the **placement parent** — the parent endpoint of the group's
shallowest stored row (ties: root-first, then parentName, then rowId). Every
symbol renders exactly once per side (a second render double-counts usages,
§13.2); deeper rows whose parent endpoint is itself a rendered same-side group
hang under it; a parent that is not a rendered group is a depth-0 cascade
match (root's class/member — the engine treats `cascade(root)` as root), so
that row folds to the root level with the true parent declared in
data-parent-id/data-parent-name. Children beyond the first level start
collapsed (`bb-hub-collapsed` + `data-expanded=0`) behind an expander control;
expansion is a client toggle in the bridge script (never a postMessage, never
a re-render). Gated by `script/m44/verify-hub-tree.ts` (U3) and harness laws
AH7–AH9; the W2/transport note documents the parent-carrying row.

Parallel tracks (not M44 issues, riding alongside): language waves continue in M37/M14 (the
co-agent lanes); the website lane (M41) is untouched.

## Scope

- **In:** bb/graph usages-mode grouping shape and its verifiers (U1); graph-core
  list/tree/badge rendering and the webview harness (U2/U3/U4); impact root resolution
  (U5); hover-command references fallback (U6); governance + closure (G1/X1).
- **Out:** pixel-exact theming; new editor transports (M27 convention applies to the
  same extension surfaces); completion/diagnostics/rename (contract §7.1 unchanged);
  the analyzer relationship vocabulary itself (that is M14/M37's stored truth — M44 only
  *presents* it understandably and never drops rows from the index).

## Verification discipline (unchanged from v0–v6)

Every issue closes only with machine evidence: a verifier that (a) runs against the real
component and real server legs, (b) carries mutation proofs that it CAN FAIL, and (c)
writes a timestamped record pinned to a commit. Drift gates keep docs/code/ledger
byte-honest. The bottom-up governance chain M24→M42 stays green on every M44 run, and
M44's own bar is re-audited by G1 every time. Nothing closes on prose.
