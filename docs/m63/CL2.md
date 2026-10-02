# CL2 — `bb_cross_language`: the analyzer work created a new class of false absence

> **Superseded in part** — `docs/m63/CL3.md` closes the four items this document
> left open (a second non-JVM corpus, the two never-fired branches, the hover
> door's project leak, and the gate's wiring). Everything in §3 and §7 below
> remains in force and is re-measured there on an index and a corpus neither had
> seen.

**Status** — CL1 VERIFIED (285/285, 9/9 mutants) · CL1-T1 VERIFIED (19/19) ·
M26 W3 (the hover door) VERIFIED 21/21, 5/5 mutants
**Supersedes** — `docs/m63/CL1.md` for the member section; CL1's four defects
remain fixed and are re-measured as fixed on the post-analyzer index
**Evidence** — `validation/m63/results/CL1.json`, `CL1-T1.json`
**Verifiers** — `npx tsx script/m63/verify-cl1-cross-language.ts`,
`npx tsx script/m63/verify-cl1-corpus-predicate.ts`

---

## 1. Why this round exists

The 593-commit merge that landed the analyzer work changed the world this tool
reads. Everything CL1 measured had to be re-measured rather than remembered, and
the re-measurement is what produced this finding.

**What the analyzer work changed** (same corpus, same pipeline, re-indexed):

| | before | after |
|---|---|---|
| files / symbols / relationships | 230 / 9,201 / 51,316 | 230 / 9,329 / 53,676 |
| stored cross-language rows | 1,545 | **1,642** |
| `clojure → java` | 1,123 `uses` | 850 `references` |
| `java → clojure` | 417 `uses` | 775 `references` |
| `java → xml` | — | 12 `calls` |
| distinct bridges | 1 (`name-resolution`, 100%) | **1 (`name-resolution`, 100%)** |

CL1's four defects re-measured on the new index: **all four still fixed**. The
bridge vocabulary was **not** addressed by the analyzer work and remains a
declared limitation (see §6).

## 2. The new defect

**95.4% of stored cross-language rows target a MEMBER, not an owner.** 1,566 of
1,642 rows target a symbol that has an `owner_symbol_id`; 1,565 are sourced from
one. A by-name answer for the *owner* — a class, a namespace — therefore finds
almost nothing while the index is full of edges about it.

The tool was declaring that absence:

| owner | cross rows on itself | on its members | what the tool answered |
|---|---|---|---|
| `clojure.core` | 7 | 432 | 14 facts |
| `Iterate` | **0** | **109** | **`declaredAbsent: true`** |
| `ConstantDynamic` | **0** | **92** | **`declaredAbsent: true`** |
| `clojure.set` | **0** | **35** | **`declaredAbsent: true`** |
| `Numbers` | **0** | **25** | **`declaredAbsent: true`** |
| `PersistentTreeMap` | **0** | **24** | **`declaredAbsent: true`** |
| `LongChunk` | **0** | **19** | **`declaredAbsent: true`** |
| `InstructionAdapter` | **0** | **19** | **`declaredAbsent: true`** |
| `Attribute` | **0** | **18** | **`declaredAbsent: true`** |

This is the same failure mode CL1 found twice — *a false absence produced by a
query shape rather than by a fact* — and it is worse on the most natural
question a caller can ask: "is this class involved in cross-language code?"

### It is a CROSS-TOOL failure, not a private gap

`bb_graph` answers the same question the other way. Its owner-cascade
attributes member edges to the owner, and on **7 of 10** such owners it reported
cross-language edges while this tool declared absence:

```
owner                     onItself onMembers   bb_graphX  bb_cl_pairs  bb_cl_absent
fileSet                          0          1           1            0  True   <== CONTRADICTION
clojure.core.protocols           0          1          12            0  True   <== CONTRADICTION
clojure.java.process             0          1           6            0  True   <== CONTRADICTION
Frame                            0          1           6            0  True   <== CONTRADICTION
Handle                           0          1           1            0  True   <== CONTRADICTION
Label                            0          1          12            0  True   <== CONTRADICTION
APersistentMap                   0          1           1            0  True   <== CONTRADICTION
```

Two tools, opposite answers, same symbol, same index, same moment. An agent that
calls both is misled by whichever it calls second.

## 3. The fix, and why it reports rather than cascades

`bb_graph` solves this by **cascading** member edges onto the owner and marking
them (`match: "owner-cascade"`, `matchedMember`). This tool does not, and the
difference is deliberate:

- `bb_graph`'s cascade is a **lexical id-prefix range** (`graph-engine`
  `cascadeBounds`), and its own documentation calls the result "a superset of
  naive exact-target SQL". It is a heuristic over id strings.
- This tool uses the store's `owner_symbol_id` — the real ownership edge — and
  **reports** the member's rows as the member's rows.

An edge on `Label.newLabel` is not an edge on `Label`. Presenting it as one is
exactly the quiet over-claim this tool exists to prevent. So the member rows go
in their own section, each marked and each naming the member, and the envelope
says how many there are. `bb_graph`'s larger cascaded count is **declared in the
answer** rather than reconciled.

What changed:

- `memberFacts`: the rows on the members, each `match: "owner-cascade"` with
  `matchedMember` (symbol, file, language, line) and `matchedMemberId`. The id
  is on the cascaded facts only — an exact fact is trivially attributable, so an
  id there would be 80 bytes of payload restating what `self` already says.
- `ownFactCount` / `memberFactCount` / `memberCount`, so a symbol that is itself
  connected is distinguishable from one connected only through its members.
- **`declaredAbsent` now means the NAME is silent, not the symbol.** An empty
  answer requires that neither the copies nor their members hold a row. This is
  the change that removes the false absence.
- `silentItselfButNotItsMembers`: the symptom named in the answer, so a caller
  reading only `declaredAbsent: false` does not conclude the symbol itself is
  the connected one.
- One budget over the union, own rows first: the rows that name the symbol
  itself are never crowded out by a member's edges.

## 4. What the gate found in the fix

Three things, all of which the gate reported and I would not have found by
reading the code:

**The loss check was wrong under a limit.** Check B compared `pairCount` (shown,
capped) against the independent total, so `Method` — 242 stored rows, a 200
limit, a correctly truncated answer — was reported as losing 42 rows. A loss
check and a truncation check are different questions; they now are two checks
(B at the ceiling, B2 on the declared total).

**The member-count oracle was wrong in the flattering direction.** It counted
every member of the name, while the tool counts the members that contributed a
*reportable* fact — one whose ends name different languages, and not already an
own row (a class calling its own method is an ordinary internal edge, emitted
once and counted in `collapsedRowCount`). The gate reported `tool=5` against
`truth=86` for `Frame`; the whole difference was rows that correctly have nowhere
to go. The oracle now derives what the contract actually promises.

**Four mutant anchors had gone stale.** Adding the member section renamed
`shown` → `ownShown`, changed `declaredAbsent: shown.length === 0` to
`shownCount`, and moved the pair derivation into `factFromRow` — so M2, M3, M4
and M6 anchored to lines that no longer existed. A stale anchor is reported as
not-caught, and the suite's count assertion caught it: `5/9`. The floor is now
`MUTANT_FLOOR = 9` and `lane/check_anchors.py` checks the property before a run
rather than during one.

## 5. The nine mutants, and which check catches each

| # | planted defect | caught by |
|---|---|---|
| M1 | pick-one-copy (the original `.get()` door, verbatim) | B, A2 |
| M2 | false absence (threshold moved) | C |
| M3 | no identity (counterparty stripped) | D |
| M4 | no bound (limit ignored, truncation undeclared) | F, B2 |
| M5 | cross-project leak (row filter dropped) | D2, E |
| M6 | pair fabrication where the row has no languages | B |
| **M7** | **cascade laundered — member rows absorbed into `facts`** | **K, I** |
| **M8** | **the pre-CL2 absence rule, verbatim** | **C** |
| **M9** | **a cascade reported with no member to check it against** | **I** |

M7/M8/M9 are caught by *different* checks (K/I, C, I), so passing means the
checks are independent rather than one check catching everything.

## 6. Still open, and it is the analyzer's to close

- **`name-resolution` is 100% of the stored bridges** (1,642 of 1,642), unchanged
  by the analyzer work. It is the indexer's placeholder for "we matched two
  identifiers", not a communication mechanism. The tool declares the value and
  the docs say what it means; giving the analyzers a real vocabulary (FFI, JNI,
  protobuf, HTTP) with name-resolution as the explicit fallback is the analyzer
  lanes' call.
- **52% of stored cross-language rows carry no analyzer `evidenceClass`** (855 of
  1,642), so their tier is derived by the shared rule rather than claimed by the
  analyzer. Declared in the docs, not fixed here.
- **`src/ast/cross-language-intelligence-persister.ts` mints ids that are not
  project-prefixed** (`cross_lang_*`, `dataflow_source_*`). CL1 closed the leak
  at the read side; the write side is the persister's owner.
- **The M48.C1 predicate in `script/m48/c1-repo-worker.ts`** should be replaced
  for all sixteen tools, not patched for one. `CL1-T1` shows it accepts 6 of 6
  measured defects.

## 7. Declared limitations of the new behaviour

- **The answer for an owner can be large.** `Iterate` is 94KB, 100% member
  facts. That is the p99.9 tail: over the 909 names that carry a cross-language
  row, the mean answer is **7 facts / 7.5KB** and p90 is **12 facts**, so the
  default `limit` of 200 is not the binding constraint for 90% of names. The
  limit exists for the tail, and `truncated` is declared when it bites. For
  scale, `bb_graph` returns 3–8× more bytes for the same symbols.
- **`bb_graph` is three orders of magnitude slower on these symbols** — 29–79s
  against this tool's 14–53ms — because the cascade walks every member. Not this
  tool's defect, recorded because the comparison is otherwise unfair to `bb_graph`.
- **The cascade relationship is `owner_symbol_id`, not the id-prefix range.** A
  member that the indexer minted without an owner is not reported as a member;
  it is not the store's relationship and inventing one would be a guess.
- **A member that is also a copy of the asked name is excluded** from
  `memberFacts` — its rows are own rows, and counting them twice would inflate
  every number in the envelope. The exclusion is counted in `collapsedRowCount`.
