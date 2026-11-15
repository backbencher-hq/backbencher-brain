# bb_graph — Phase A audit

<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the read-only audit of `bb_graph` (MCP tool 12 of 16)
and the graph engine and evidence-tier code it shares with the editor: the
contract, the mode × option matrix, the per-edge facts, the owner cascade, the
declarations, the docs, the twin door, the gates that are supposed to catch
regressions, and the measured latency on the three campaign tiers.
WHO IT IS FOR — the owner of bb_graph and the campaign Lead. Every claim below
cites a command whose exit code was read, or a file produced by one.
EDIT TOGETHER WHEN THIS CHANGES — validation/tools/bb_graph/LATENCY.json,
validation/tools/bb_graph/probe.ts (the door probe), and the gate scripts.
-->

Phase A is read-only for `src/` and docs. Everything written lives under
`validation/tools/bb_graph/`.

## 0 · Environment and method

| Fact | Value |
|---|---|
| Engine | `backbencher-brain` 0.3.0, HEAD `c43282e92` |
| Split layout | `src/mcp/tools/bb_graph/{descriptor,handler}.ts`, `script/tool-docs/curation/bb_graph.ts` (landed mid-audit) |
| Reference index (T2) | `BB_DATA_DIR=.bb-data`, 3.4 GB, **310,423 symbols / 820,040 stored relationships**, project id `1d3d5710…` |
| Fixtures | T0 `test/fixtures/polyglot`, T1 `.perf-fixtures/bb-scale/n100` (100 files, 2.5 MB) |
| Environment during measurement | shared checkout with the fleet: load average **24–29** on 15 GB, ~1 GB available memory. T2 numbers are measured under that contention and recorded with it. |
| Read-only rule | `BB_NO_AUTO_REFRESH=1` for every measurement read; no indexer, no write tool, no `.bb-data` index run. |

Every measurement is produced by a file in this directory and recorded in
`validation/tools/bb_graph/results/`:

| Evidence | Command |
|---|---|
| Door probe (refusals, invariants, bounds, cascade, twin) | `BB_DATA_DIR=… npx tsx validation/tools/bb_graph/probe.ts <section>` |
| Degree reconnaissance (target selection) | `npx tsx validation/tools/bb_graph/recon.ts` |
| Per-statement timing and plans (read-only handle) | `npx tsx validation/tools/bb_graph/timing.ts`, `plans.ts` |
| Per-statement timing and plans on the handle the TOOL opens | `npx tsx validation/tools/bb_graph/plans-live.ts` |
| Cascade id shape | `npx tsx validation/tools/bb_graph/cascade-shape.ts` |
| T2 latency, warm, 5 runs | `npx tsx validation/tools/bb_graph/latency-t2.ts '[{"id":"leaf-default",…}]'` |
| T0/T1 latency, warm, 5 runs | `npx tsx validation/tools/bb_graph/probe.ts latency-t0t1` |
| Fixture indexing | `npx tsx validation/tools/bb_graph/index-fixtures.ts` (writes only under `validation/tools/bb_graph/bbdata`) |

A protocol note the Lead needs: reading the shared index through the tool chain
is **not byte-read-only**. `BrainDatabase.getRawInstance` runs the additive
migrations and idempotent healers on every open of a pre-existing database
(`src/brain/database.ts` `ensureSchemaIfNew` → `migrateSchemaColumns`,
`ensureHealthIndexes`, `ensurePlannerStats`, `cleanupOrphanedFkRows`, …). The
probe records the database file mtimes before and after, and they move
(`probe-refusals.json` → `dbUnchanged: false`). The tool itself issues only
SELECTs; the writes are the open path. Opening the reference index measured
**18,714 ms** (`results/plans-live.json` → `openMs`) before the first call.

## 1 · Contract surface as shipped

Descriptor (`src/mcp/tools/bb_graph/descriptor.ts`): read-only, requiresIndex
true, mode `graph`, one required option `symbol`, optional `maxDepth`,
`direction`, `relationshipTypes`, `includeCrossLanguage`, `timeBudgetMs`,
`maxEdges`, `edgeLimit`. Aliases `target`/`symbolName`/`query` → `symbol`
(resolved by `src/mcp/tool-validation.ts` `PARAMETER_ALIASES`, before the
required check, so an alias satisfies `required`).

Handler (`src/mcp/tools/bb_graph/handler.ts`) parses, validates the four
numeric/enum options itself, delegates to `graphTraversal`, and renders the
payload: `symbol`, `root`, `callers[]`, `callees[]`, `summary{}`, `provenance`.
Engine (`src/intelligence/graph/graph-engine.ts`) owns root resolution, both
traversal arms, the owner cascade, the noise/cross-language filters, the four
bounds and every declaration. Tiers come from the Lead-owned single owner
`src/lsp/evidence_tier.ts` via `classifyTier`.

## 2 · Mode × option matrix (measured through the door)

`probe.ts refusals` runs 23 argument cases through
`validateToolArguments → handler` — the exact sequence `src/mcp/server.ts`
performs. Result file: `results/probe-refusals.json`.

| Case | Outcome | Latency (T2) |
|---|---|---|
| missing `symbol` | refused: `missing required option: symbol` | 0.7 ms |
| blank `symbol: "   "` | **not refused at the boundary**: engine runs, answers `Symbol '   ' not found` | **10,051 ms** |
| unknown symbol | refused: `Symbol 'no_such_symbol_9f3a' not found` | 5,335 ms |
| `maxDepth: 0` / `11` | refused by the handler, range named | <1 ms |
| `maxDepth: 2.5` | **accepted**, silently floored to 2 | 47,913 ms |
| `maxDepth: "3"` | refused by the schema: `maxDepth must be number` | 0.4 ms |
| `direction: "up"` | refused, accepted set named | 0.1 ms |
| `relationshipTypes: []` | refused (`must name at least one`) | 0.1 ms |
| `relationshipTypes: [""]` | refused by boundary (`non-empty strings`) | 0.2 ms |
| `relationshipTypes: "calls"` / `[7]` | refused by the schema | <0.1 ms |
| `edgeLimit: 0` / `-5` | refused (`positive` / boundary `non-negative`) | <0.1 ms |
| `edgeLimit: 2.5` | refused at the boundary (`whole number`) | <0.1 ms |
| `maxEdges: 0` | refused (`positive`) | <0.1 ms |
| `maxEdges: 2.5` | **accepted**, silently floored to 2 | 29,961 ms |
| `timeBudgetMs: -1` | refused (`non-negative`) | 0.3 ms |
| `includeCrossLanguage: "false"` (string) | refused by the schema (`must be boolean`) | <0.1 ms |
| unknown option (`depth`) | refused, accepted set + aliases named | <0.1 ms |
| `target:` alias | accepted, roots the graph | 87,138 ms |
| `query:` alias | accepted, roots the graph | 52,466 ms |
| `symbol` + `target` disagreeing | refused: `aliases with different values` | 0.1 ms |

Mode combinations that matter and are accepted: `direction` `callers` /
`callees` / `both`; `relationshipTypes` any non-empty list (a filter, not a
bound); `includeCrossLanguage: false`; `edgeLimit` 1…5000 (clamped above);
`maxEdges` 1…5000 (clamped above); `timeBudgetMs` 0 (default, no clock bound) or
positive. `bounds`/`invariants` sections of the probe were started on T2 and
abandoned once a single default call proved to take minutes under the fleet
load (see §7); the same sections run in seconds on T0/T1 and are the Phase B
falsifiable-gate material.

Refusals are named and `isError: true` through the server wrapper
(`src/mcp/server.ts` catch → `{ isError: true }`), which is the protocol shape
the charter requires for wrong input.

## 3 · Per-edge evidence tiers

Rule: `src/lsp/evidence_tier.ts` `classifyTier` — a stored legend-tier
`evidenceClass` wins; otherwise structural kinds at confidence ≥ 0.7 are
`structural`, below the floor `inferred`; `import(s)`/`part_of` →
`import_based`; `reference(s)`/`use(s)`/`usage` → `usage_contextual`;
`references_qualified` → `reference_qualified`; anything else `inferred`.

Handler wiring is correct: `tier: classifyTier({relationshipType, confidence,
evidenceClass: metadata.evidenceClass ?? null})` — one owner, no copy (the
drifted copy was removed before this campaign and the m28 U2 gate anchors the
expectation to the owner).

Findings:

1. **The payload does not publish the stored `evidenceClass` that can override
   the derivation.** The engine parses it into `edge.metadata.evidenceClass`;
   the handler drops `metadata` from the edge projection. So a tier that came
   from a stored claim and a tier derived from kind+confidence are
   indistinguishable in the answer. The descriptor sells "per-edge evidence
   tier" as the headline; the reason for the tier is not auditable from the
   payload. Severity: medium (truthfulness of the declared surface, no wrong
   value).
2. **The caller arm never selects `r.target_basis`.** `EdgeRow.targetBasis` is
   selected only in the callee arms (`r.target_basis AS targetBasis`); the
   caller arm's select list has no such column, so `targetBasis` is `null` for
   every caller edge by construction. The contract type
   (`src/intelligence/contracts.ts` `GraphEdge.targetBasis`) documents the field
   as the stored resolution basis of the target — for a caller edge the target
   is the traced symbol, so the field is meaningful and is presently always
   absent. Severity: low-medium (asymmetry, engine-level).
3. Tier values on the wire are bounded to the legend: the probe recomputes the
   rule independently for every returned edge (`expectedTier`) and reports
   `tierViolationCount` (T0/T1 runs, Phase B). No violation observed in the gate
   suite: `script/m28/verify-surface-parity.ts` (63.2%-disagreement regression
   test) and `script/m55/verify-tiers.ts` are green.

## 4 · Owner-cascade attribution

The store on the reference index has **226,113 symbols with
`owner_symbol_id`**, and `owner_symbol_id` is a *prefix of the member's id* in
only **8** of them (`results/cascade-shape.json`): a member id is
`<hash>:<file>:<member>:<line>` while the owner id is
`<hash>:<file>:<Class>:<line>`. The engine's cascade is therefore a lexical
range on `brain_symbol.owner_symbol_id` (`prefix = tracedId up to its last ':',
upper = prefix + ';'`), which selects exactly the members whose owner id starts
with the class's `…:Class:` prefix — for `OrderService` that is 6 members,
equal to the count of rows whose `owner_symbol_id` is exactly the class id
(`membersByOwnerRange: 6`, `membersByExactOwner: 6`). Semantics are sound; the
cascade is a deliberate class-granularity superset.

Per-edge attribution is correct and reducible: `match` is
`targetMatch ?? sourceMatch`, `matchedMember` names the member the stored row
actually named, and the summary splits `exact*` / `cascaded*` / `deeper*` with
the documented identity `exact + cascaded + deeper = returned`. The gate
`script/m65/verify-graph-blindspots.ts` and the m48 C2 edge-mutation suite are
green on this behaviour.

Finding: **the caller-side `match` value is computed against the traced symbol
at that depth** (`cascadeMatch(row, symbolId)`), which is exactly the documented
convention, but the handler folds both directions into one field named `match`,
and its docs do not state that a *caller-side* `exact` is exact with respect to
the symbol traced at that depth (not the root). The engine's own comment says
this is load-bearing for the depth-0-only `exactCallers` counters; the edge
field has no such restriction. Severity: low (documentation precision).

## 5 · Truncation, bounds and declared absence

Bounds in force (all declared on every answer): `maxDepth` (tool default 3, max
10; engine default 5 for other callers), `edgeLimit` (default 200, max 5000,
per query), `maxEdges` (default 1000, max 5000, whole answer), fan-out budget 50
symbols per direction, `timeBudgetMs` (**default 0 = no clock bound**).

Declarations: `truncated` is true only when a bound fired (filter is NOT a
bound — `filterNarrowed`/`filterReason` carry the request);
`truncationReasons` is the set and `truncationReason` its `+`-join;
`totalCallers`/`totalCallees` are RETURNED counts, with
`callersIfUncapped`/`calleesIfUncapped` (`null` = not counted, never zero) and
`totalsAreLowerBounds`; `cappedQueries` counts site-limit hits; the cap asks for
one row beyond the limit so "exactly at the limit" is not reported truncated.

Filters that leave a number (not a bound): `noiseFiltered`, `crossLanguageExcluded`.
JOIN blind spot: `unattributed` (per direction, `null` when not counted).

Findings:

1. **D-06 (routed from bb_analyze): the declared walk ceiling cannot bound an
   individual statement.** Confirmed independently here — the per-statement
   plans and timings in §7 show single statements of 5–19 s, and
   `timeBudgetMs` is checked only between statements
   (`outOfTime()` at the top of each `traceCallers`/`traceCallees`). A caller
   that passes `timeBudgetMs: 2000` on this index still waits for the statement
   in flight. The docs say this ("the walk can only stop between statements");
   the *budget* it implies (2 s) is not what a caller receives.
2. **`maxDepth`/`maxEdges` fractional values are accepted and silently floored**
   (`2.5 → 2`), while the LSP door refuses non-integers
   (`src/lsp/graph_request.ts` requires an integer in [1,10]) and the MCP
   boundary marks `edgeLimit` whole-number-only but not `maxDepth`/`maxEdges`.
   Two doors of one engine disagree about what a valid request is. Severity:
   low-medium.
3. **Declared absence is by error, not by structured absence.** An unknown
   symbol is `isError: true` with `bb_graph: Symbol 'x' not found`; there is no
   `found: false` object. The near-miss is instead declared on success
   (`root.match` ∈ exact/exact-any-kind/containment, `root.candidates`), which is
   the stronger declaration. Accepted as designed; note that a machine consumer
   must parse the error text to distinguish "not found" from an internal throw.
4. **Blank symbol is not refused** (see §2): `"   "` costs 10 s and returns the
   not-found error echoing the raw blanks. The sibling `bb_analyze` bounds a
   target echo at 200 characters; bb_graph does not bound the echo at all.
   Severity: medium (cost), low (payload).

## 6 · Docs drift

Read: `docs/tools/bb_graph.md` (generated), `docs/GRAPH_ENGINE.md`,
`script/tool-docs/curation/bb_graph.ts`, `src/mcp/tools/bb_graph/descriptor.ts`,
`docs/m28/MCP-SURFACE.md`, `src/intelligence/contracts.ts`.

1. **`docs/GRAPH_ENGINE.md` is stale and a gate is RED because of it**
   (`script/m65/verify-edge-kind-scoping.ts` S2). Its `relationshipTypes` row
   names 10 kinds; `DEFAULT_REL_TYPES` holds 14 (`decorates`, `renders`,
   `mixes_in`, `part_of` are missing). The same file omits the `edgeLimit`,
   `maxEdges` and `timeBudgetMs` options entirely, omits `rowId`, `targetMatch`,
   `sourceMatch`, `matchedMember` and `targetBasis` from `GraphEdge`, omits most
   of the summary's declarations, carries the milestone in its title
   (`(M9.06)`), has no §8 header, and states "MCP graph access is through
   `bb_analyze` callers/callees/trace modes" — false since `bb_graph` exists.
2. **The descriptor's `relationshipTypes` prose is false since the D5 change:**
   "a filter you supply is recorded in the answer's `truncationReason` so a
   filtered answer is never read as the whole graph". The filter is recorded in
   `filterNarrowed`/`filterReason`; `truncationReason` carries bounds only. The
   same prose is what the generated page and `docs/data/public-tools.json` copy.
3. **The descriptor names 10 kinds of a 14-kind default** in the same sentence
   ("Default: EVERY kind the index stores (calls, …, exports)").
4. **`contracts.ts` `GraphTraversalOptions.timeBudgetMs` says "default 2,000; 0
   disables it"** — the default is 0. Shared file (Lead-owned): propose, do not
   edit.
5. Curation performance text carries process history ("It used to default to
   2,000 ms and the measurement is why it does not", "Before M59.A12 (#888)",
   "(M62.A2)", "Before D5") — §9 bans milestone/issue narration; the facts can
   be stated as facts.
6. `docs/tools/bb_graph.md` is generated from the registry + curation and now
   carries the author header; the page-claims gate (`script/verify-tool-page-claims.ts`)
   is green. Every claim in it that the probe contradicts is listed above, in
   the descriptor and curation where the page gets its words from.

## 7 · D-06 — the T2 latency breach, attributed

Measured on the reference index, all reads, `BB_NO_AUTO_REFRESH=1`, fleet load
24–29:

| Measurement | Value | Evidence |
|---|---|---|
| **Open** of the reference index by the tool's own handle | **18,714 ms** | `results/plans-live.json` `openMs` |
| Leaf symbol `likeContains` (2 stored incoming rows), default args, warm, 5 runs | **p50 131,230 ms / p95 168,335 ms** (samples 114,580 / 110,552 / 131,230 / 168,335 / 153,606), 12 edges, ~7 KB | `results/latency-t2.json` |
| Same symbol, default args, single runs while the fleet load rose | 87,138 / 52,466 / 47,913 ms | `results/probe-refusals.json` |
| Cascade materialisation (`SELECT … owner_symbol_id >= ? AND < ?`), 1 row out | 976 ms | `results/plans-live.json` `cascadeOnly` |
| Caller arm, 2 rows out | 4,985 ms | `results/plans-live.json` `callerArm` |
| Unattributed caller count, 1 row out | 10,698 ms | `results/plans-live.json` |
| Root resolution (exact name), 1 row out | 945 ms | `results/plans-live.json` `rootExact` |
| Not-found refusal (unknown symbol) | 5,335 ms | `results/probe-refusals.json` |

Plans (same file), and why they are slow:

```
cascade   CO-ROUTINE casc → SEARCH m USING INDEX brain_symbol_gravity_idx (project_id=?)
          ⇒ the owner range `owner_symbol_id >= ? AND < ?` is NOT seeked: the project's
            310,423 symbols are scanned once per cascade materialisation.
caller    SEARCH r USING INDEX brain_rel_proj_type_idx (project_id=? AND relationship_type=?)
          ⇒ per-kind scan of the project's 820,040 relationship rows instead of a seek on
            brain_rel_proj_type_target_idx (project_id, relationship_type, target_symbol_id),
            which EXISTS on this index.
unattr.   SEARCH r USING INDEX brain_rel_proj_source_idx (project_id=? AND source_symbol_id>?)
          ⇒ range scan for a `source_symbol_id IS NULL` predicate.
```

Contributing facts:

- **Planner statistics are almost absent.** `sqlite_stat1` on this database has
  rows for exactly two indexes (`brain_rel_source_cross_idx`,
  `brain_rel_target_idx`) and **none for `brain_symbol` at all**
  (`results/plans-live.json` `stat1`). `ensurePlannerStats` ANALYZEs only when
  `sqlite_stat1` is entirely absent, so a partially-populated stats table is
  never refreshed. Without selectivity the optimizer prefers the project/type
  index and the gravity index.
- **The cascade is materialised 4–5× per node.** The caller arm, the callee arm
  and the two `countUnattributedRows` scans each build their own `UNION ALL`
  co-routine for the same symbol; a full-depth walk does that for every expanded
  symbol.
- **The unattributed counters run on every call** (depth 0), even though their
  declared purpose is to explain an otherwise-empty set; 10.7 s + ~9–13 s of the
  measured per-statement time.
- **The walk ceiling cannot interrupt a statement** (D-06 as routed). On this
  index a caller that passes `timeBudgetMs: 2000` still pays a 5–19 s statement.
- Root resolution scans the gravity index in gravity order until the name
  matches (`rootExact` 945 ms) although `brain_sym_proj_name_type_idx
  (project_id, name, symbol_type)` exists.

Consequences: the campaign's speed contract (`< 5 s` p95 T2 default calls, 30 s
client timeout) is breached by 26–56× for a **leaf**; a mid or hub symbol at the
default depth did not answer within a 10-minute measurement window (the
`invariants` sections started on T2 were abandoned for that reason, and the same
sections complete in seconds on T0/T1). The engine's own measured baselines in
its comments (2.8–4.8 s for `push` at depth 3 on a 5,651-file index) do not hold
on this 11,440-file/820K-relationship index.

Non-graph contribution to the same T2 number, for the Lead: the 18.7 s open is
`src/brain/database.ts` open-path migrations/healers (Lead-owned), paid by every
tool's first call in a process.

## 8 · Twin `bb/graph` (LSP) agreement rules

Read: `src/lsp/graph_request.ts`, `src/lsp/graph_usages.ts`,
`script/m28/verify-union.ts`, `script/m28/verify-surface-parity.ts`,
`script/m55/verify-live-surface.ts`, `script/m55/verify-tiers.ts`,
`docs/m28/MCP-SURFACE.md`.

The declared rule (M28 D-1/D-2, and the descriptor) is: one engine, two doors,
same tier rules. What is true and what diverges:

1. **Engine and tier owner: shared, verified.** `script/m28/verify-union.ts`
   (A/B doors on one fixture, edge multisets and tiers equal, drift mutants
   caught) and `script/m28/verify-surface-parity.ts` (the 63.2%-disagreement
   regression) are green under `npx tsx`.
2. **Default depth diverges.** MCP `bb_graph` defaults `maxDepth: 3` (handler
   `Number(args.maxDepth ?? 3)`), the LSP `bb/graph` passes `undefined` when the
   client omits it, so the engine applies `DEFAULT_MAX_DEPTH = 5`. The same
   question with no explicit depth is two different graphs by door. Evidence:
   handler line 62 vs `graph-engine.ts` `DEFAULT_MAX_DEPTH`; the twin probe
   section (`probe.ts twin`) records both doors' `summary.maxDepth`.
3. **Validation diverges.** LSP requires an integer `maxDepth` in [1,10],
   `relationshipTypes` an array of non-empty strings, `includeCrossLanguage` a
   boolean. MCP accepts fractional `maxDepth`/`maxEdges` and floors them, and
   (because the boundary catches the rest) rejects the same bad shapes with
   different messages. Not wrong in either door; not one contract.
4. **The LSP door has features the MCP door does not**: member→owner root
   fallback with a file hint and a declared refusal when the hint disagrees
   (`resolveTraversalRoot`), root annotations (author-labelled), and `mode:
   "usages"` (grouped response, file-level `imports`/`part_of` rows the symbol
   JOIN cannot see). All are documented for the editor; the MCP door's
   descriptor claims only the engine + tier rules, which is accurate — but the
   *rooting* differs: a constructor name roots through its class at the editor
   and may root at a member/containment match for the agent.
5. Twin files `src/lsp/graph_request.ts`, `src/lsp/graph_usages.ts` were not
   edited (Lead approval required); no change is proposed in Phase A beyond the
   default-depth question in item 2, which is a handler/engine question, not a
   twin edit.

## 9 · Gate inventory (command → exit code)

Run from the working tree on the split layout. `BB_NO_AUTO_REFRESH=1`
throughout; `BB_DATA_DIR=validation/tools/bb_graph/bbdata` for gates that index
or need a writable data directory (home `~/.bb` is read-only in this sandbox).

| Gate | Runner | Exit | Notes |
|---|---|---|---|
| `script/verify-graph.ts` | `bun` (needs `bun:sqlite`) | **0** | 33 checks, 1.4 s. Engine-level only — no door, no tiers, no cascade. |
| `script/m65/verify-graph-blindspots.ts` | `bun` | **0** | 6 languages, noise/unattributed/cross-language counts through the REAL handler. |
| `script/m65/verify-edge-kind-scoping.ts` | `bun` | **1** | S2 red: documented default ≠ engine list (see §6.1). |
| `script/m65/verify-refresh-resolution.ts` | `bun` | **1** | 5 red, all fleet census (`matlab`/`vba` fixture lanes missing; `csharp`/`kotlin` undeclared file-level) — not graph. |
| `script/m28/verify-union.ts` | `npx tsx` | **0** | A/B door union + drift mutants. |
| `script/m28/verify-mcp-tools.ts` | `npx tsx` | **0** | |
| `script/m28/verify-mcp-surface.ts` | `npx tsx` | **0** | |
| `script/m28/verify-surface-parity.ts` | `npx tsx` | **0** | tier-agreement over every stored row. |
| `script/m48/verify-p4-param-matrix.ts` | `bun` | **0** | parameter matrix. |
| `script/m20/verify-cross-tool-parity.ts` | `npx tsx` | **0** | |
| `script/m55/verify-tiers.ts` | `npx tsx` | **0** | tier owner + 7 mutants. |
| `script/m55/verify-identity.ts` | `npx tsx` | **0** | |
| `script/verify-tool-page-claims.ts` | `bun` | **0** | page against live payload. |
| `script/verify-tool-docs.ts` | `bun` | **0** | check-only (no `--write`). |
| `script/verify-tool-registry.ts` | `bun` | **0** | |
| `script/verify-mcp.ts`, `script/m44/verify-usages-groups.ts`, `script/m24/verify-call-hierarchy.ts`, `script/m62/verify-address.ts`, `script/m62/verify-consumers.ts`, `script/m15/verify-registry-handlers.ts`, `script/verify-public-surface.ts`, `script/m28/verify-closure.ts`, `script/m55/verify-live-surface.ts` | `npx tsx` | see `logs/batch4-summary.log` | run late in Phase A; results appended to the Phase A report message. |

Runner requirements discovered (record, because a green run under the wrong
runner is not evidence):

- `bun` breaks `script/m28/*` and `script/m20/*`: they import `dist/`, whose
  `better-sqlite3` native module does not load under Bun (`ERR_DLOPEN_FAILED`).
  The package's own scripts use `npx tsx` for those gates.
- `script/verify-graph.ts` cannot run under Node: it imports `bun:sqlite` for
  its negative-control mutation.
- `script/m20/verify-cross-tool-parity.ts` and the m65 gates need a writable
  `BB_DATA_DIR`; unset, they write `~/.bb` and fail `EROFS` here.
- The m18/T2 corpus mapping still points at `/Users/sano/…`; no gate in this
  tool's list depends on it (none was blocked by it).

**Can the gates fail?** Each of the green gates above has a negative case or a
mutation suite except `script/verify-graph.ts`, whose fidelity has two concrete
gaps (Phase B fixes): (a) it calls the engine, not the tool, so the handler,
tier derivation, id compaction, defaults and refusals are untested by the
per-tool gate; (b) several of its checks are "recorded observations" (the
TypeScript call-site line is printed, not asserted), and it has no case for
`includeCrossLanguage`, the owner cascade, `edgeLimit`, the unattributed count
or the tier of any edge.

## 10 · Regex inventory (charter §7)

In the tool's own new files:

| File | Regex | Assessment |
|---|---|---|
| `src/mcp/tools/bb_graph/handler.ts` | `/^[0-9a-f]{40}$/` in `compactId` | **Defect under §7**: a 40-character hex check is a plain character-wise test; no allowlist entry exists (`validation/tools/regex-allowlist.json` is not yet installed) and there is no edge-case suite. Phase B: replace with a character loop (no regex), keep the conservative comment. |
| `src/mcp/tools/bb_graph/descriptor.ts` | none | — |
| `src/intelligence/graph/graph-engine.ts` | none | — |
| `src/intelligence/graph/line-address.ts` | none | — |
| `validation/tools/bb_graph/*.ts` (probes) | none (string ops) | gate tooling, not tool code |

Shared handler `src/mcp/tool-handlers.ts` keeps three regexes for the bb_graph
section's neighbours (`/not a traversable root\|owning-declaration/i`,
`/not found/i`) — Lead-owned file, not this tool's, reported for the Lead's
inventory.

## 11 · Banned comments / authorship (charter §8, §9)

| File | Header | Banned narration present |
|---|---|---|
| `src/mcp/tools/bb_graph/handler.ts` | §8 header ✓ | `M28.T1 (issue #624)`, `M59.A12 (#888)`, `M55.T5 / §15.1`, `M62.A2 (issue #876)`, `M26.W2`, `D5`, `D6`, `D10`; a 40-line unused-import block left by the split |
| `src/mcp/tools/bb_graph/descriptor.ts` | §8 header ✓ | `M28.T1 (issue #624)`, `M28 decision D-1/D-2` |
| `src/intelligence/graph/graph-engine.ts` | **none** | `M59.A12 (#888)`, `M42.H3`, `M62.A2 (issue #876)`, `M48.C1 (#699)`, `#885` |
| `src/intelligence/graph/line-address.ts` | **none** | `M62.A1 (issue #875)`, `M62.A2` |
| `docs/GRAPH_ENGINE.md` | **none** (markdown §8 required) | title `(M9.06)` |
| `script/tool-docs/curation/bb_graph.ts` | §8 header ✓ | `(M62.A2)`, `Before M59.A12 (#888)`, `Before D5` |
| `docs/tools/bb_graph.md` (generated) | §8 header ✓ | inherited from descriptor/curation (same items) |
| `src/lsp/evidence_tier.ts` | **none** | Lead-owned: `M55.T5 (issue #774)`, `M29.R5`, `W4` (request change, do not edit) |
| `src/lsp/graph_request.ts`, `src/lsp/graph_usages.ts` | **none** | twin, approval required: `M26.W2 (issue #510)`, `M44.U1 (issue #688)`, `M55.T1/T3`, `M42.H5` |

§9 keeps technical "owner" meanings (owner cascade, owner-family, owner index),
which are used correctly throughout the engine.

## 12 · Mutants that must go red (Phase B design)

Each is a defect planted into the working tree, run through the named gate, and
required to fail; the green run afterwards is only evidence if the red run
happened.

| # | Mutant | Gate that must go red | Why it can |
|---|---|---|---|
| M1 | In `evidence_tier.ts`, delete the 0.7 floor (`return "structural"` for structural kinds at any confidence) | `script/m28/verify-surface-parity.ts` + `script/m55/verify-tiers.ts` + new door-level tier check | The parity gate streams every stored row through the owner and compares to the same rule read from the core mirror; the m55 T5 suite has the floor mutant already |
| M2 | In `handler.ts`, restore the pre-T5 copy of the derivation (4 structural kinds, no usage branch) | `script/m28/verify-surface-parity.ts` (U2) | 63.2%-disagreement corpus regression |
| M3 | In `evidence_tier.ts`, report a stored `indexed` label as the tier (legacy bucket) | `script/m55/verify-tiers.ts` R2/R5 | the unclaimed-label case is pinned |
| M4 | In `graph-engine.ts`, return the old 4-kind `DEFAULT_REL_TYPES` | `script/m65/verify-edge-kind-scoping.ts` S2 + new plan/timing gate | S2 compares the default to the documented list |
| M5 | In `handler.ts`, stop applying the kind filter to the traversal (`relationshipTypes` read but not passed) | `script/verify-graph.ts` D5 + new door matrix | D5 asserts filterNarrowed/edges |
| M6 | In `graph-engine.ts`, revert the cascade `JOIN (cascade)` to `target_symbol_id IN (cascade)` (D1 blind spot returns) | `script/m65/verify-graph-blindspots.ts` | it seeds an unattributed row per language and asserts the count through the door |
| M7 | In `graph-engine.ts`, remove the `includeCrossLanguage: false` branch | `script/m65/verify-graph-blindspots.ts` D4b | asserts `crossLanguageExcluded ≥ 1` through the door |
| M8 | In `graph-engine.ts`, stop counting `noiseFiltered` (drop the counter) | `script/m65/verify-graph-blindspots.ts` D4a + `a-filter-is-not-a-bound` | asserts non-zero count and `truncated: false` |
| M9 | In `graph-engine.ts`, make `maxEdges` a no-op (`Math.max(edgeLimit, requested)`) | `script/verify-graph.ts` D6 | `{maxEdges:1}` must return 1 edge |
| M10 | In `graph-engine.ts`, put the time-budget default back to 2,000 ms | `script/verify-graph.ts` D7 | asserts `summary.timeBudgetMs === 0` on a default call |
| M11 | **Tier rule**: in `evidence_tier.ts`, make the 0.7 floor inclusive-wrong (`> 0.7`) so confidence 0.7 flips | new door-level tier assertion on a seeded fixture (confidence exactly 0.7) + m55 | boundary case is authored into the fixture, not a real corpus |
| M12 | **Edge-kind scoping**: in `graph-engine.ts`, make the caller arm ignore `relTypes` (always all 14) while echoing the filtered list in `relationshipTypesUsed` | new edge-kind assertion: every returned edge's kind ∈ `summary.scope.relationshipTypes` | the scope echo is a claim about what was searched; this mutant makes the claim false |
| M13 | **Blind spots**: in `graph-engine.ts`, return `unattributed: 0` instead of counting | `script/m65/verify-graph-blindspots.ts` | the count is asserted against a seeded row |
| M14 | **D-06 plan regression**: revert the cascade/arm SQL to the co-routine form | new `script/m65/verify-graph-plan.ts` plan-shape assertion (below) | deterministic: the plan text changes |
| M15 | In `handler.ts`, drop `rowId` from the edge projection | `script/m65/verify-graph-blindspots.ts`? no — new door-level assertion that every edge carries a rowId that resolves to a stored row | the migration to per-tool modules removed the old check |

For D-06 the regression gate is **plan-shape, not wall-clock**: a pure function
`assertPlanShape(plan: string[]) → findings` that (a) requires the cascade
subquery to be a seek on `brain_symbol_owner_idx` (or the composite index once
the Lead adds it), (b) requires the caller/callee arms to use
`brain_rel_proj_type_target_idx`, (c) requires the unattributed counts to seek
`brain_rel_proj_source_idx` for `source_symbol_id IS NULL`, and (d) rejects the
current text (`CO-ROUTINE casc` + `brain_symbol_gravity_idx`). The gate's
negative control feeds it the OLD plan captured in
`validation/tools/bb_graph/results/plans-live.json` and asserts it FAILS — so
the gate can go red on exactly the regression it exists for, deterministically,
on a fixture. A generous fixture-level wall-clock bound (p95 under 2 s on T1,
where the same call is ~0.36 s with the current code and the plan fix is
expected to lower the statement count) is recorded beside it as a secondary
signal, not the primary assertion, because a timing gate on a shared host mints
flakes.

## 13 · Defect list (severity, evidence, fix)

| # | Severity | Defect | Evidence | Phase B fix / owner |
|---|---|---|---|---|
| D-06 | **High** | T2 default call 131 s p50 (leaf) / >10 min (mid, default depth); statements 5–19 s; cascade scans the gravity index, arms scan per-kind, unattributed counts scan; walk ceiling cannot bound a statement | §7, `results/plans-live.json`, `results/latency-t2.json`, bb_analyze §D-06 | engine SQL rewrite (cascade members fetched once with an indexed owner-range seek; arms seek `(project_id, type, target)`; unattributed counts seek the source index), guarded `INDEXED BY` like the existing external-arm pattern, plan-shape gate + mutants. Owner: this lane. Proposed `ANALYZE_GRAPH_WALK_CEILING_MS` note to Lead (§14). |
| A-01 | **High** | The campaign's T2 budget (5 s) and the 30 s client timeout are breached for a leaf; no doc states the T2 number; curation carries a 2.8–4.8 s claim from a different corpus | §7 | after D-06: re-measure, publish the measured number and its conditions in curation + descriptor + `LATENCY.json`. Owner: this lane. |
| A-02 | Medium | Blank `symbol` not refused; not-found costs 5–10 s; error echo unbounded | §2 | handler: trim and refuse blank as missing; document the not-found cost. Owner: this lane. |
| A-03 | Medium | `docs/GRAPH_ENGINE.md` stale (10 of 14 kinds, missing options/fields/summary, false MCP-route statement, milestone title, no §8 header) and `script/m65/verify-edge-kind-scoping.ts` S2 RED and unable to go green (hardcoded `kinds.length === 10` + comment-parsing regex) | §6.1, gate run | rewrite `docs/GRAPH_ENGINE.md`; fix the gate's parser (strip comments, derive the expected count from the array, assert the doc names every kind) and its S2 expectation. Owner: this lane. |
| A-04 | Medium | Descriptor (→ generated page, public-tools data) claims a `relationshipTypes` filter is recorded in `truncationReason`; false since D5 | §6.2 | descriptor prose: `filterNarrowed`/`filterReason`; also name all 14 kinds. Owner: this lane; regenerate page with `--only bb_graph`. |
| A-05 | Medium | MCP default depth 3 vs LSP default depth 5 for the same engine and the same omitted option; validation also diverges (fractional floors) | §8.2–8.3 | decide with Lead: either the handler passes `undefined` and the engine default is documented as 3 for both doors, or the tool keeps 3 and the descriptor states it. Owner: this lane (handler/engine), Lead for the contract call. |
| A-06 | Medium | The answer cannot be audited for WHY a tier is what it is: `metadata.evidenceClass` dropped; caller edges never carry `targetBasis` | §3 | publish `tierBasis` (the stored class when it decided, else `derived:<kind>@<conf>`) and select `r.target_basis` in the caller arm; add to curation. Owner: this lane (engine + handler). |
| A-07 | Medium | §9 violations and missing §8 headers across the tool's files; 40-line unused-import block in `handler.ts` | §11 | rewrite comments as the author's technical statements, add headers, remove unused imports. Owner: this lane for `handler.ts`/`descriptor.ts`/`graph-engine.ts`/`line-address.ts`/`GRAPH_ENGINE.md`/curation; Lead for `contracts.ts` and `evidence_tier.ts`; approval for twins. |
| A-08 | Low-medium | Fractional `maxDepth`/`maxEdges` accepted and silently floored | §2 | handler: require whole numbers (same rule `edgeLimit` already gets at the boundary). Owner: this lane. |
| A-09 | Low-medium | Caller site-key uses the traced id where the row's resolved target is the member, so two distinct member-target rows at one source site collapse as "spelling variants" | `graph-engine.ts` caller siteKey | add a fixture with two same-line calls to two members of one class and assert two edges; fix the key to use `matchedId`. Owner: this lane, Phase B. |
| A-10 | Low | Regex `/^[0-9a-f]{40}$/` in `compactId` (§7) | §10 | replace with a character-wise check. Owner: this lane. |
| A-11 | Low | `contracts.ts` documents `timeBudgetMs` default 2,000 (actual 0) | §6.4 | Lead-owned: proposed edit in the report. |
| A-12 | Low | Per-tool gate `script/verify-graph.ts` tests the engine only; no door/tier/cascade/edgeLimit/cross-language case; some checks record rather than assert | §9 | extend the gate (owner: this lane) or add the door matrix gate. |
| A-13 | Process | T2 reads through the door move the shared index's WAL and run open-path migrations/healers; the 18.7 s open is part of every first call | §0, §7 | Lead decision: whether T2 measurement protocol should use a read-only open path, and whether the open-path healers should be gated. Not a bb_graph code change. |
| A-14 | Gate (not mine) | `script/m65/verify-refresh-resolution.ts` red: 50 analyzers vs 48 fixture lanes (`matlab`, `vba` missing); `csharp`/`kotlin` file-level lanes undeclared | gate run | blocked for this lane; report to Lead (fleet census, not graph). |

## 14 · Blocked legs

| Leg | Exact command | Output |
|---|---|---|
| T2 default-depth `invariants`/`bounds`/`cascade`/`twin` matrices | `BB_DATA_DIR=$PWD/.bb-data BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_graph/probe.ts invariants` | no result inside a 10-minute window (killed); a single default call on a leaf is 131 s p50, so a 5-target × default-depth matrix is not runnable under the fleet load. Replaced by T0/T1 runs of the same sections + the T2 leaf latency measurement. |
| `script/m65/verify-refresh-resolution.ts` | `bun run script/m65/verify-refresh-resolution.ts` | exit 1, 5 checks: `fleet-lane-has-a-fixture: matlab`, `: vba`, `lane-set-is-exactly-the-fleet` (50 analyzers, 48 lanes), `file-level-set-is-current: csharp`, `: kotlin`. Outside bb_graph's scope. |
| `script/m28/*` under `bun` | `bun run script/m28/verify-union.ts` | `ERR_DLOPEN_FAILED` — `'better-sqlite3' is not yet supported in Bun`. Re-run under `npx tsx` (green). |
| `script/verify-graph.ts` under Node | `npx tsx script/verify-graph.ts` | would fail on `import("bun:sqlite")` — the gate is bun-only by construction; recorded, not a defect of the gate. |
| Home data dir | any gate with `BB_DATA_DIR` unset | `EROFS: read-only file system, rm '/home/ishaq2321/.bb/…'` — the sandbox home is read-only; every gate needs an explicit writable `BB_DATA_DIR`. |

## 15 · Phase B plan (in order)

1. **D-06 engine rewrite** in `src/intelligence/graph/graph-engine.ts`, with the
   public edge semantics unchanged: compute the cascade member ids once per
   traced symbol through an indexed owner-range query (guarded `INDEXED BY`, the
   same guard pattern the external arm already uses), pass them as a bounded
   `IN` list to both arms and both unattributed counts, and seek the arms on
   `(project_id, relationship_type, target_symbol_id)`; keep every declaration
   byte-identical. Verify against m28 T1/U1/V1 + m55 tiers + verify-graph D5/D6/D7/D10.
2. **Plan-shape gate** `script/m65/verify-graph-plan.ts` (deterministic, with
   the pre-fix plan as its built-in negative control) + mutants M14/M4.
3. **Handler fixes**: blank symbol refusal, whole-number `maxDepth`/`maxEdges`,
   `tierBasis`/`targetBasis` in the payload, no-regex `compactId`, unused
   imports, §8/§9 header + comment rewrite, descriptor prose truth.
4. **Docs**: `docs/GRAPH_ENGINE.md` rewrite (14 kinds, all options, all edge and
   summary fields, measured D-06 finding, no milestone framing), curation
   updated with the measured T2 numbers, `--only bb_graph` page regeneration.
5. **Gates**: extend `script/verify-graph.ts` with door-level cases; fix
   `verify-edge-kind-scoping` S2; mutants M1–M15 each shown red then green;
   evidence files under `validation/tools/bb_graph/`.
6. **Re-measure T2** and update `LATENCY.json`; report before/after.

## 16 · Phase B — D-06 rewrite, measured before/after

The rewrite is in `src/intelligence/graph/graph-engine.ts`: the owner cascade is
resolved once per traced symbol through an indexed owner-range query (composite
`brain_symbol_project_owner_idx` preferred, owner-only index as fallback, range
JOIN only past `CASCADE_INLINE_MAX` members), both arms and both unattributed
counts receive that bounded id list, exact root resolution seeks
`brain_sym_proj_name_idx`, and the engine opens the index read-only.

| Measurement (T2, warm) | Before | After |
| --- | --- | --- |
| Read-only open of the index | 18,714 ms (read-write open, migrations) | 19.6 ms |
| Cascade id fetch | 976 ms (`brain_symbol_gravity_idx` scan) | 0.83 ms (`brain_symbol_project_owner_idx` seek) |
| Caller arm | 4,985 ms per-kind scan | 9.0 ms (`brain_rel_proj_type_target_idx` seek) |
| Unattributed caller count | 10,698 ms | 0.49 ms |
| Exact root resolution | 945 ms gravity scan | 1.2 ms name-index seek |
| **One default call, leaf `likeContains`** | **p50 131,230 / p95 168,335 ms** | **p50 22 / p95 30 ms** |
| One default call, mid `traverseGraph` (307 edges) | did not return in 10 min | p50 161 / p95 355 ms |
| One default call, hub `getProjectId` (672 callers) | did not return in 10 min | p50 90 / p95 125 ms |

Row-set equivalence is measured, not asserted by inspection
(`validation/tools/bb_graph/semantics-equivalence.ts`): for a leaf, three
classes with 3–6 members, a 143-callee mid symbol and a 672-caller hub, the
pre-fix range form and the post-fix id-list form return byte-identical rowId
sets for the caller arm, both callee arms and both unattributed counts
(`allEqual: true`).

Gates after the rewrite (all exit 0 unless named): `verify-graph` PASS,
`m65/graph-plan` PASS (with the pre-fix plan as a negative control that fails
every assertion), `m65/graph-blindspots` PASS, `m65/edge-kind-scoping` PASS
(its S2 doc check repaired and `docs/GRAPH_ENGINE.md` rewritten),
`m28/union` PASS, `m28/surface-parity` PASS, `m28/mcp-surface` PASS,
`m55/tiers` PASS. Command and exit code for each are in
`validation/tools/bb_graph/logs/after-*.log` and the gate batch summaries.
`m28/verify-mcp-tools` reports `T1: KNOWN-GAP (23/24, 1/2 mutants)` because its
mutant anchor for `src/lsp/impact.ts` no longer matches the file as another lane
is editing it — not a graph assertion and not this engine's behaviour.

The edge semantics are unchanged by construction and by measurement: the id
list is the same set of ids the range selected, `casc.id` still names the id
that matched (so `targetMatch`/`sourceMatch` and `matchedMember` are computed
from the same value), and the arms' rowId sets are equal.

### Phase B final numbers (after the handler/descriptor/docs pass)

| Measurement (T2, warm, 5 runs, defaults maxDepth 5 / direction both) | p50 | p95 | Edges |
| --- | --- | --- | --- |
| leaf `likeContains` | 16 ms | 19 ms | 19 |
| mid `traverseGraph` | 162 ms | 246 ms | 264 |
| hub `getProjectId` | 57 ms | 145 ms | 108 |
| `relationshipTypes: ["calls"]` on the mid symbol | 76 ms | 109 ms | — |
| `edgeLimit: 1` on the hub | 6 ms | 7 ms | 1 |

All are inside the campaign's 5 s p95 budget with 20–263× margin. The door
refusals that used to reach the engine now cost microseconds: a blank symbol is
refused in 2 ms (was 10,051 ms and a full containment scan), a fractional
`maxDepth`/`maxEdges` is refused rather than floored, and an unknown symbol is
the only remaining scan (5.3 s is the documented containment fallback cost).

Mutation battery (`validation/tools/bb_graph/mutants.sh`,
`results/mutants.json`): 5/5 CAUGHT — M1 tier derivation ignores the stored
`evidenceClass` (`m28/surface-parity` red), M2 cascade falls back to the pre-fix
range JOIN (`m65/verify-graph-plan` red), M3 `maxEdges` silently raised
(`verify-graph` D6 red), M4 default kind set narrowed to four
(`m65/edge-kind-scoping` red), M5 unattributed counts hardcoded
(`m65/graph-blindspots` red). Files were restored byte-identically and the green
control re-ran.

### Phase B — same-site collapse identity (A-09) fixed

The caller/callee dedupe keys identified a "site" by the TRACED symbol, so one
source line calling two members of the traced class looked like one stored row
under two spellings and collapsed. Measured on the authored fixture
(`results/dedupe-probe.json`): `Multi` class, one caller line
`return m.a() + m.b()` answered **1** caller edge naming `a` with
`spellingVariantsCollapsed: 1`. The keys now use the id the stored row actually
matched (`row.matchedId`), so the same fixture answers **2** edges naming `a`
and `b` with `spellingVariantsCollapsed: 0`. `script/verify-graph.ts` asserts
this through the real door (descriptor → validator → handler), so the collapse
cannot come back silently.

### Phase B — final gate table (working tree after the fixes)

| Gate | Runner | Exit | Result line |
| --- | --- | --- | --- |
| `script/verify-graph.ts` | bun | 0 | `GRAPH: PASS` (engine + door sections, incl. the same-site case) |
| `script/m65/verify-graph-plan.ts` | tsx | 0 | plan shapes asserted, pre-fix plan caught by the built-in negative control |
| `script/m65/verify-graph-blindspots.ts` | bun | 0 | filters counted, JOIN blind spot counted, neither claimed as a bound |
| `script/m65/verify-edge-kind-scoping.ts` | bun | 0 | every named-kind consumer scoped; documented default = engine list |
| `script/m28/verify-union.ts` | tsx | 0 | `U1: VERIFIED (30/30, 6/6 mutants)` |
| `script/m28/verify-mcp-tools.ts` | tsx | 0 | `T1: VERIFIED (24/24, 2/2 mutants)` |
| `script/m28/verify-surface-parity.ts` | tsx | 0 | `U2: VERIFIED (39/39, 5/5 mutants observed)` |
| `script/m55/verify-tiers.ts` | tsx | 0 | `T5 RESULT: VERIFIED — 72/72, 7/7 mutants` |
| `npx tsx script/verify-tool-docs.ts --only bb_graph` | tsx | 0 | `TOOL DOCS: PASS` |
| `npx tsc --noEmit` | tsc | 0 | clean |
| mutation battery (`mutants.sh`) | bun/tsx | — | 5/5 mutants CAUGHT, files restored byte-identically, green control PASS |

Runner requirements and the one cross-lane red still observed at audit time
(`m65/refresh-resolution` fleet census, `verify-tool-page-claims` naming
`bb_doc`) are recorded in §9 and §14; neither involves bb_graph.

## TypeScript same-line call follow-up (2026-11-12)

The compiler-backed 12-site fixture in
`validation/m14/verify-typescript-call-sites.mts` exposed two independent losses.
The store retained seven rows because call identity ended at line number. After
adding syntax offsets to storage, the graph still returned five of seven Alpha
calls because its spelling deduplication also used line alone. Both directions
now include validated `callSiteStartIndex` metadata in site identity, and the
bb_graph handler exposes the offset beside its existing line address.

Direct and real-worker storage retain all 12 full source/line/offset/owner tuples;
caller queries for both owners and a repeated-call callee query retain the exact
expected offsets. Duplicate delivery is idempotent. Incremental leading-comment
edits and restoration move offsets without leaving obsolete rows. Six invalid
offset metadata shapes are omitted rather than surfaced as exact positions.
Five source mutations independently restore storage collapse, incorrect offsets,
caller collapse, callee collapse and acceptance of invalid offsets; all fail.

`BB_DATA_DIR=/tmp/bb-ts-sites-graph-suite-data bun script/verify-graph.ts` passes
through real workers. The first sandbox attempt failed to access its default
external data directory; it is not counted as a passing run. The legacy
`script/m59/verify-rel-multiplicity.ts` failure was reproduced with the unchanged
store and graph loaded from HEAD: ambiguous `target` selection and an obsolete
assumption that every non-call edge was `contains`. The repaired gate selects
each file explicitly, requests calls, asserts exactly four Java and four
TypeScript call sites through storage and the graph, and retains its collapsed
negative control. All seven checks pass.

This does not certify arbitrary graph completeness or other analyzers' site
precision. Rows without valid exact offsets retain legacy line-based deduplication.
