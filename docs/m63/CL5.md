# CL5 — `bb_cross_language`: the response was unbounded, the absence over-claimed, and the gate was counting its own import errors

**Status** — CL1 VERIFIED (344/344, 16/16 mutants) on BOTH corpora · CL1 wiring
VERIFIED (29/29, 16/16 anchors live, in `verify:fast`) · M26 W3 VERIFIED 21/21,
5/5 mutants · CL1-T1 VERIFIED 19/19 · production path (`node bin/bb mcp` over
stdio, from `dist/`) VERIFIED on both corpora · tool docs PASS (16 tools, 18
artifacts) · typecheck clean
**Supersedes** — the mutant counts in `docs/m63/CL1.md`, `CL2.md`, `CL3.md` and
`CL4.md`. Those documents report 9/9, 13/13 and 14/14. **Those numbers were wrong**,
and §4 explains why they were counting import errors rather than observed defects.
Every other claim in them stands.
**Evidence** — `validation/m63/results/CL1.json`, `CL1-wiring.json`,
`copies-bound.json`, `nesting-*.json`, `graph-disagreement-*.json`,
`absence-scope.json`, `m2-observability.json`, `m8-observability.json`,
`residue-*.json`
**Verifiers** — `npm run verify:m63`, `npm run verify:m63-wiring`

---

## 1. Why this round exists

CL4 closed with a question outstanding: is the tool finished? The way to answer that
was not to review the work but to ask what the gate's check list did not contain.

Three things came back. Two are defects in the tool. The third is in the gate, and it
is the one that matters most, because it means the first two rounds' evidence was
partly hollow.

## 2. Defect: `limit` bounded the facts, and nothing bounded the response

`ALL_COPIES_SQL` had no `LIMIT`. The copy list was therefore as long as the index
said the name is ambiguous, and `limit` — which governs only facts — did nothing for
it. Measured, with 5,000 copies of one name and a single cross-language row:

| | before |
|---|---|
| `limit: 1` | **844,059 bytes** |
| `limit: 200` | **844,061 bytes** — the 2-byte difference *is* the `limit` value |
| `copies` returned | 5,000, every one |
| `truncated` | `false` |
| gate check F8 (`bytes < 400_000`) | **would have failed** |

A caller holding `limit: 1`, asking for the smallest answer the tool produces, paid
for all 5,000 copies — and the one field that would have told them so said nothing
was dropped. This is CL1's third defect again, one array over: a declared bound that
did not bound what the caller receives.

**The naive fix is a trap, and three numbers break at once.** `copyCount`,
`ambiguous` and `languages` were all derived from the returned array, so a bare
`LIMIT` would have turned three honest numbers into three lies: `copyCount` becomes
the cap, a 227-copy name capped at 1 reports itself **unambiguous**, and every
language whose only copy fell past the cap disappears. Each got its own query, and
the check asserts all three — because a byte-count check cannot see any of them.

The fix also applies the cap twice, and the reason is the useful part:

- the SQL `LIMIT` is a **fetch optimisation** — it avoids loading copies nobody sees;
- the final `slice` is the **correctness bound** — because the row scan adds a copy
  for every row whose source symbol fell past the SQL cap, which is every copy
  holding a cross row. A SQL-only cap would have passed the fixture and failed on any
  name whose copies mostly have edges.

Neither is redundant, and removing either alone leaves the other standing. That
asymmetry is why M16 targets the slice.

**After: 34,692 bytes** (24× smaller), `copiesTruncated: true`, `copyCount` still
5,000, `ambiguous` still true. The cap costs a list entry, never an edge — every copy
holding a cross row is added by the row scan whatever the cap, which is asserted
rather than assumed.

## 3. Defect: an absence that over-claimed while descendants held rows

The member cascade follows `owner_symbol_id`, so it is one level deep. Cross-language
rows live deeper:

| corpus | max nesting depth | rows on grandchildren | owners affected |
|---|---|---|---|
| jvm-interop | 4 | **141** | 19 |
| elixir | 6 | **27** | 4 |

For eight probed JVM owners holding 79 such rows, the tool answered
`ownFactCount: 0, memberFactCount: 0, declaredAbsent: true`. By CL2's own standard
that is a false absence: the index is full of edges about the symbol and the answer
declares none.

**One expectation corrected by measuring.** `bb_graph`'s cascade is a lexical
id-prefix range, which ought to reach every descendant, so the two tools were
expected to contradict each other. Measured: `bbGraph_edgeCount: 0` for all eight.
**Both tools report nothing.** This is a shared blind spot, not the CL2 cross-tool
contradiction, and calling it one would have been wrong.

**Why the rows are counted and not cascaded.** CL2 ruled that a member's edges are
reported as the *member's*, never absorbed into the owner's, so that `bb_graph`'s
larger cascaded count stays visible instead of being reconciled away. Emitting a
grandchild's row as the owner's fact is exactly the laundering mutant M7 exists to
catch. So the answer gains `deeperDescendantRowCount` — 168 rows across the two
corpora, published in every answer — and `declaredAbsent` stays `true`, because it
remains exactly what CL2 made it mean: the name and its **direct** members hold no
stored row. What changes is that the note no longer reads as though the index holds
nothing, and gives the number that separates the two cases.

## 4. The gate was counting its own import errors

Every mutant reported CAUGHT and the gate was green, so nothing was red to
investigate. The audit asked one question of each mutant record: **how does its probe
reach the mutated module?** The chain, in order, because each step hid the next:

1. `abs("")` produced a path with **no trailing slash**, so the catch-all import
   rewrite emitted `from "file:///…/src"brain/annotation-store"`. **Every mutated
   module failed to parse.**
2. The catch block read a failed import as a caught defect — true of a real defect,
   false of a broken harness.
3. So every mutant was "caught" by an import error. **At most six were running.**
4. A `component` mutant's probe calls `m.createToolHandlers()`, but `m` is the
   *component* — so it threw, and step 2 banked that too.
5. One probe never referenced `m` at all, so it measured unmutated code.

**The corrections.** The numbers in CL1, CL2, CL3 and CL4 were 9/9, 13/13 and 14/14.
The true figure was **6 of 16**, and I reported the wrong one twice in commit
messages. Three fixes:

- a third mutant kind, `component-via-handler`: mutate the component, then run it
  through a real handler that imports it — the only sound way to see a component
  defect that is visible solely in the envelope;
- **the harness no longer banks a broken probe as a catch.** A `TypeError` about an
  undefined member is evidence about the probe, not the tool, and is now red. A
  genuine load failure stays a catch;
- `verify-cl1-wiring.ts` now asserts what a green gate never asks: every probe
  *reaches* the mutated module, no probe swallows a missing subject state into a
  silent `return false` (which reads as SURVIVED, not as unverifiable), the
  broken-probe guard exists, and `abs()` still emits a usable directory path. It runs
  in `verify:fast`, costs two seconds, and needs no corpus.

**A fourth thing, found while fixing it.** A fixture project had leaked into *both*
corpora (`cl1m15scopeA`, 2.1MB). M15's probe called its builder — which restores
`BB_DATA_DIR` — and then invoked the handler, so `getRawInstance` created project A
inside the corpus's own data directory. The gate passed; it had never looked. That is
the worst kind of leak, because a second index on disk changes every later
measurement while continuing to report success. The project list is now snapshotted
across the mutant phase and compared, so a new directory is a failure rather than a
note. Both corpora were cleaned.

## 5. Two selectors that made mutants unexercised

With the harness sound, ten mutants were exposed — not because the tool was wrong,
but because their fixtures did not isolate what each mutation needed.

- **M8** (`ownShown.length === 0`) differs from the real rule only for an owner with
  **zero own rows** and members. The selector returned the busiest such owner
  regardless of its own rows, so the mutation was a no-op. It also had no such owner
  on elixir at all (measured: 72 on the JVM corpus, **0** on elixir), so M8 now falls
  back to a seeded owner — a state one corpus cannot produce is what a seeded fixture
  is for.
- **M2** (`shownCount < 3`) differs only for a symbol with one or two facts. The
  selector asked the store for "one stored row", but the store counts a name's **own**
  rows and says nothing about members: `ClassReader` (1 own + 30 member = 32 facts)
  and `IKVReduce` (1 own + 0 members = 1 fact) are indistinguishable to it. It now
  returns candidates and the probe scans them.

Both selectors had fallbacks, and a fallback is how a mutant ends up unexercised with
nothing to show for it: it reports SURVIVED, which reads like a working probe. All
fallbacks are gone; a selector that finds nothing throws `UNVERIFIABLE`.

M1 and M2 briefly shared one selector with **opposite** requirements — tightening it
for M2 silently unexercised M1 without any of its own code changing. They are split.

## 6. The state now

```
CL1            344/344, 16/16 mutants   — BOTH corpora, every mutant genuinely run
CL1 wiring      29/29,  16/16 anchors    — in verify:fast, so CI runs it
M26 W3          21/21,   5/5 mutants
CL1-T1          19/19
typecheck       clean
tool docs       PASS (16 tools, 18 artifacts)
residue         both corpora clean, no fixture project, no temp dirs
```

## 7. Still open, and whose it is

Unchanged (`docs/m63/CL3.md` §7): `name-resolution` is 100% of stored bridges across
two unrelated corpora; 52% of rows carry no analyzer `evidenceClass`; the
cross-language persister is imported and never called; M48.C1's predicate should be
replaced for all 16 tools. All analyzer or governance, none this tool's.

## 8. The lesson, stated once

Every defect in this lane — in the tool and in the gate — was found by asking a
question the evidence could answer. None by reading the code carefully. The last two
were found by asking *how each probe reaches the thing it claims to test*, and the
answer was: six of sixteen did not, and the suite had been reporting their import
errors as catches.

A green gate is not evidence that the thing it measures works. It is evidence that
nothing it checks went red, which is a much smaller claim, and the distance between
the two is where this lane's worst findings have lived.
