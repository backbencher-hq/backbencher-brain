# Lead findings — root causes behind the bettercap report (Lead-owned)

Author: Lead. Created 2026-11-18. Ground truth: repo `/home/ishaq2321/mcp/backbencher-brain`
@ HEAD `be4c0ef25`, `bb` 0.1.6, bettercap index projectId `4c7590f1…` (1972 files / 55,785 symbols).
Read-only queries only (`sqlite3 -readonly` on the bettercap DB path); no bettercap file or index
was modified. Every claim below is measured; raw captures in `evidence/lead/`.

These are the CROSS-CUTTING causes the Lead verified while auditing the 12 report items. They are
not a substitute for the per-issue lane findings — they are the frame the fix plan hangs on.

## L-1 (P0) Unscoped leaf-name target binding: qualified external references are attributed to an
## arbitrary same-named symbol anywhere in the project (across files, packages AND languages)

**Measured.** The Go analyzer records a package-qualified call by its LEAF only, and says so in its
own metadata (`real-go-analyzer.ts` resolveGoFunctionCall ~L6560, `callee_recorded_as_a_leaf_name_
whose_owner_is_not_resolved_per_file`). The post-index resolver then binds that leaf to a project
symbol by name, ranked definition-first → same-file → same-language → lowest id, `LIMIT 1`
(`parallel-indexer.ts` `resolveTargetStmt` ~L3863; the deferred pass repeats the ranking).

Direct DB evidence (bettercap, read-only):

```
row id ...caplets/caplet_test.go:TestCapletEvalError:142:New:calls:157
  target_symbol_id = ...:session/session.go:New:155      target_external = 'New'
  metadata.callExpression = "errors.New", isPackageQualified = true, isStdlib = true,
  reasonCode = callee_recorded_as_a_leaf_name_whose_owner_is_not_resolved_per_file
```
The source line is `errors.New("test error")` (caplet_test.go:157) — a stdlib call, NOT `session.New`.
Same shape for `otto.New()` in `js/data_test.go` (10+ rows); `t.Fatal(err)` binds to
`log/log.go:Fatal`; `os.Remove` binds to a test helper `Remove`. `session.New:155` has **89 incoming
`calls` rows**; 88 of them come from `target_external = 'New'` leaves of qualified calls in files
that never import `session`.

**Blast radius in bettercap (measured):** `calls` rows with `metadata.isPackageQualified = 1`:
8,548; bound to a symbol: 4,940; unbound: 3,608. This mints false caller edges for `bb_analyze
callers`, `bb_graph`, `bb_impact`, orphan detection, test mapping, and LSP hover/call hierarchy.
Issue 5 of the report (test mapping) is **downstream** of this: the mapping tool honestly reports
`direct_call` at 0.85 because the index contains a call edge that never existed.

**Fix direction.** (i) never bind a target whose owner is unresolved when the recorded evidence says
`isPackageQualified`/`isStdlib`/`bindReason` owner-unresolved — keep it unresolved (the analyzer
already declares the limitation); (ii) where a binding is attempted, scope it by the source file's
import/package map for languages that have one (Go module path → dir), and require same-language for
`calls`/`instantiates`; (iii) make the resolver emit a `bindReason`/tier that consumers can trust
(`usage_contextual` is not enough); (iv) gate: bettercap fixture where `errors.New` must not create
`calls → session.New`, and a Go fixture where `pkg.F` binds across packages.

## L-2 (P0) Every cross-language edge in bettercap is a name coincidence; the report's issue-2
## edges are one symptom of L-1, not a separate classifier bug

**Measured.** `select bridge_mechanism,count(*) from brain_relationship where is_cross_language=1
group by 1` → **`name-resolution` = 2,423 rows (100% of cross-language rows)**; 0 rows from any
other bridge. Language pairs: go→javascript 759, javascript→go 632, javascript→yaml 621,
go→make 170, go→yaml 146, javascript→xml 60, javascript→html 17, html→go 6, …

The exact rows the report names are misbound **import rows** produced by L-1:

```
source main.go:main:1, relationship imports, target_external 'os'
  target_symbol_id = .github/workflows/release.yaml : os : 15   is_cross_language=1 bridge=name-resolution conf=0.9
source main.go:main:1, imports, target_external 'fmt' → Makefile:fmt:36  (same shape)
source main.go:main:1, imports, target_external 'io'  → modules/ui/ui/assets/openlayers/ol.js:io:464
```

So there is no "cross-language classifier invents edges": the *import edge itself* is bound to a YAML
key / Makefile target / minified JS identifier by name, and then the cross-language labeler trusts
the binding and stamps 0.9 + `name-resolution`. The tool's own contract should make this
impossible (an import of a Go package cannot be satisfied by a YAML scalar).

**Fix direction.** (i) imports must resolve only by import-path → file mapping (Go module prefix,
relative specifiers), never by bare-name binding; (ii) cross-language classification requires an
explicit bridge (import-path map, FFI/extern declaration, config key read by known API, generated
artifact), otherwise the row is same-language-unknown / inferred and must not be labelled 0.9;
(iii) drop or floor name-resolution cross-language at "candidate, tier inferred, ≤0.3" — never
"imports". Gate: bettercap assertions `cross_language rows where bridge=name-resolution and
relationship_type=imports == 0`, and the YAML/Makefile/JS trio from the report.

## L-3 (P1) Truncation/budget declarations are emitted AFTER the data in four hand-ordered
## envelopes; a host truncation hides the declaration

From the payload-honesty lane (verified independently, full detail in its finding): impact puts
`shownCount/truncated` at 99.7% of the payload, graph puts `summary` after callers+callees at 99.7%,
visualize puts truncation at 99.8%, analyze mode=impact puts `truncated` after `affectedFiles`.
There is no shared envelope. A host that cuts a 1 MB answer at 100 KB delivers data with no bounds.
**Fix direction:** one response envelope (`summary`/`budget`/`truncated`/`freshness` first), enforced
by a serializer-level gate over all tool payloads.

## L-4 (P2) Old-index compatibility: read-only tools die with raw SQLite errors

From payload-honesty: on the 2026-10-17 indexes (`bb_tests/repositories/gql-gqlgen/graphql`),
`bb_impact` and `bb_graph` fail with `no such column: r.target_basis` (read-only open skips the
migration), and `bb_security` says "engine not initialized; run bb index --post". A read-only tool
must either migrate/upgrade-compat on open or refuse with a declared, actionable error — not a raw
SQLite message. Recorded as an UNLOCKED issue.

## L-5 (P2) The resolver contradicts the analyzer's own declared limitation

The analyzer stores `reasonCode`/`bindReason` explaining that the callee owner is unresolved, and
the resolver binds it anyway without recording that it overrode the reason. Either the edge should
stay unresolved (preferred), or the binding must carry its own basis so every consumer can see it is
inferred (`target_basis` is only symbol/external/unresolved — no "inferred-name-bind" state).

## Priority implication for PLAN.md

One root cause (L-1) produces report items 2 and 5, and contaminates graph/impact/orphans/hover;
another (L-3) is a family of declaration bugs across four tools. The safety item (issue 1, refactor)
is independent and critical. Go-import resolution (issue 3) is a *contributing* cause for Go and must
be fixed for its own reported surface, but it is not the only reason the Go graph is wrong: even a
perfect import resolver leaves L-1's qualified-call leaf binding intact.
