# Inbound edges: the data model that stops the reverse walk from lying

Status: **design note + first measurements** (this session, round 3). Not implemented yet; the plan at the
end is the work order. Everything below cites the command, the population and the scope.

## 1. The problem, in the store's own words

`script/m14/incoming-check.ts` (header, authoritative) names it: everything the campaign measured is
OUTGOING. `src/lsp/impact.ts` gets reverse edges by **scanning outgoing rows and matching targets**, because
the schema stores none. Three failure modes follow, and none is visible in an outgoing count:

1. a declaration nobody names has no incoming edges — correct, but **indistinguishable** from a declaration
   whose references were never emitted;
2. a **name collision** attributes an incoming edge to the wrong declaration (zig measured 759 such edges
   while its census read "dangling 0.00%", because the census resolves by name and a collision resolves);
3. a **hopeless string** target (external package, path, builtin) looks identical to a target that was
   never indexed.

## 2. What the store actually holds today (measured)

Probe: 2-file project (python + javascript) indexed by the real CLI into an isolated `BB_DATA_DIR`
(`bun src/cli/index.ts index <proj> --no-setup`), then read `brain_relationship` directly.

```
relationships              14
target_symbol_id resolved   7   (exactly half)
target_external non-null   14   (EVERY row carries an external string, resolved or not)
neither                     0
by type            contains 4 resolved / 0 unresolved · extends 2/0 · imports 0/3 · references 0/1 · calls 0/1
```

So the store resolves roughly half of this sample's targets to a `target_symbol_id`, and the rest are
string-only. The graph engine's reverse walk already has **two arms**
(`src/intelligence/graph/graph-engine.ts`):

- **resolved arm**: `JOIN (cascade) casc ON casc.id = r.target_symbol_id` — exact identity, correct.
- **external arm**: `r.target_symbol_id IS NULL AND r.target_external = <name>` — **name equality with no
  identity**. This is where lies 2 and 3 live: any unresolved row naming `Foo` becomes an inbound edge of
  every `Foo` the walk chooses, and a builtin/package/path string is indistinguishable from an unindexed
  declaration.

## 3. What "store inbound edges" must mean

A second copy of every relationship is the wrong answer: rows already carry both identities, and doubling
the write volume to make a join cheaper is the kind of trade this project refuses without a measurement.
The missing thing is not a reverse ROW — it is a stored **resolution basis** per row, so the reader can tell
an identity match from a string match, and can refuse to call a string match an incoming edge.

### The model

1. **`target_basis` column on `brain_relationship`** (migration via the existing
   `migrateSchemaColumns`/`ensureSchema` path), one of:
   - `symbol`       — `target_symbol_id` is set; the edge names a stored declaration by identity.
   - `external`     — the target is a known-external identity (package/path/builtin) that no declaration
                      in this project can be; `target_external` is the name. **Not** an inbound edge.
   - `unresolved`   — neither: the analyzer published a string the store could not resolve. An inbound
                      claim about a declaration is **refused**; hover says "unresolved target", never
                      "no references".
2. **Writers populate it at insert time** (the store's `target_external` already distinguishes the string
   half; the writer knows which branch it took). Backfill for existing DBs: resolved rows → `symbol`,
   non-null external → `external`/`unresolved` by the writer's own rule, neither → `unresolved`.
3. **The engine's external arm requires `target_basis = 'external'`** and is reported as
   *external-dependency usage*, in its own field, never as an inbound edge of a declaration. The resolved
   arm is unchanged (identity).
4. **Hover reads stored reverse edges**: its "referenced by" section uses the resolved arm only; when the
   symbol has none it states which of the two honest cases applies using the basis census (`no stored
   inbound edges because no row targets this identity` vs `N unresolved rows name this string, basis
   unresolved`). That is exactly lie 1's remedy: the absence is named, not inferred.
5. **Per-lane inbound completeness** is already measured by `script/m14/incoming-check.ts`; its per-type
   table becomes a fourth fleet guard read by `verify-fleet.ts` (a lane with a high ambiguous/unresolved
   rate carries a count and a falsifier, not a pass).

### Adoption of the recovered hover cache

`src/lsp/hover_cache.ts` (recovered in `archive/unmerged-pre-merge-2026-11-01/`, 29k+ lines of cache +
`occurrenceAtPoint`) is a **parse/occurrence cache**, not a reverse-edge cache: it closed hover's 50 ms p95
contract by replacing three full-tree walks with a targeted `descendantForPosition` lookup (measured
p50:hover 39.9–2444 ms before per size band; the cache is the fix). Adopting it is orthogonal to the
inbound model and is the natural companion: hover's new reversed-edge queries must not re-introduce a
full-file walk, so the cache lands with the hover half.

## 4. Work order (phased, each phase gated)

| phase | deliverable | gate |
|---|---|---|
| A | `target_basis` column + writer population + backfill; engine external arm requires basis; hover discloses basis | new `script/m26/verify-inbound-basis.ts` (rows: basis counts are a partition; no row with `target_symbol_id` reads `unresolved`; external arm never returns a name-claim without basis) |
| B | hover "referenced by" reads stored reverse edges only; absence is one of two named cases | extend `script/m24/verify-hover.ts` (G-cases per basis; no name-matching path) |
| C | adopt `hover_cache.ts` + `occurrenceAtPoint` (latency contract re-measured on this tree) | `script/m24/verify-hover-latency.ts` (p95 warm under budget, same fixture/bands) |
| D | per-lane inbound census into the fleet guard | `verify-fleet.ts` fourth column, counts + falsifier per lane |

Phases A–D are ordered by dependency, and every one is falsifiable: each gate names the exact rows it
refuses. The engine's reverse walk keeps its current behavior **until** phase A lands, because changing
which arm answers without the basis column would move wrong rows from one lie to another.
