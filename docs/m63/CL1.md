# CL1 — `bb_cross_language`: what was broken, what changed, and how it is known

**Status** — CL1 VERIFIED (159/159 checks, 6/6 mutants) · CL1-T1 VERIFIED (19/19)
**Evidence** — `validation/m63/results/CL1.json`, `validation/m63/results/CL1-T1.json`
**Verifiers** — `npx tsx script/m63/verify-cl1-cross-language.ts` (needs a real
polyglot index: `BB_CL1_CORPUS=<repo>` to build one, or `BB_CL1_DB` +
`BB_CL1_PROJECT` to reuse), `npx tsx script/m63/verify-cl1-corpus-predicate.ts`
(no index needed)

---

## 1. The finding

`bb_cross_language` is the editor's hover projection
(`src/lsp/cross_language_hover.ts`) copied wholesale into the MCP door, and the
copy is what broke it. A hover card already shows which file the reader is in
and which symbol they hovered, so the card's fact can collapse to a language
pair. An agent has neither, so the same fact is unanswerable.

Measured on `jvm-interop` — clojure/CLJ `src/`, 230 files, 9,201 symbols,
51,316 relationships, **1,545 stored cross-language rows** across three real
pairs (`clojure→java` 1,123, `java→clojure` 417, `clojure→xml` 5). Real pipeline
(`indexProjectParallel`), real handler, confirmed through the real server
(`node bin/bb mcp` over stdio).

| # | defect | measured |
|---|---|---|
| A | **no identity** — the fact names a language pair, never the other symbol | asked about `stream-to-bytes`; the stored edge goes to `toByteArray` in `src/jvm/clojure/asm/ClassWriter.java`; the answer named neither |
| B | **false absence** — a copy choice reported as a fact about the index | `invoke`: 21 stored rows across 227 copies → **0 facts, `declaredAbsent: true`**. `next`: 2 rows → 0, declared absent |
| C | **unbounded, undeduplicated** | `f`: 106 stored rows → 106 identical facts, 20,904 bytes, no limit, no truncation field |
| D | **cross-project leak** — the row's project was never filtered | a row owned by project B pointing at A's symbol was returned as one of A's own facts |

### Why B is the worst of the four

The tool's own answer carries
`"absenceNote": "no stored cross-language rows for this symbol — absence declared, never guessed"`,
and its registry description promises *"this tool never infers, guesses, or
aspires"*. For `invoke` the index held 21 stored cross-language rows. The note
was a **false statement about the index**, produced by which copy SQLite
returned first — not by a fact, and not by an inference. An agent that trusts it
concludes a symbol is not cross-language when the index says it is.

`script/m28/verify-union.ts` could not see this: it derives the "IDE side"
expectation with the *same* `.get()` on the *same* `(project_id, name)`
predicate, then asserts the two answers are identical. Two doors, one bug.

### Why the recorded corpus evidence said "verified"

`validation/m48/results/C1-bb_cross_language.json` — `"status": "verified"`,
`"passed": 5, "failed": 0`, `"negativeCases": 5`. The predicate behind all five
passes (`script/m48/c1-repo-worker.ts:185`):

```js
pass: !r.isError && (JSON.stringify(r.parsed ?? "").includes(sym.name)
                      || (r.parsed as any)?.declaredAbsent === true)
```

The handler echoed the requested name back as the `symbol` field, so the first
clause held for every non-error answer whatever its facts were; the second held
for every declared-absent answer. Fed the defects above, it accepts **6 of 6**
(`CL1-T1`). Its five "negative cases" are a different probe
(`bb_graph` on an unknown symbol, `c1-repo-worker.ts:201`) that never touches
this tool's answer.

## 2. What changed

One owner, as before — `src/lsp/cross_language_hover.ts` gains a second entry
point rather than a second module. The hover's own projection is **unchanged**
(`script/m26/verify-cross-language-hover.ts` still VERIFIED 21/21, 5/5 mutants).

- **A** every fact carries `self` (the copy of the requested name: symbol, file,
  language, line) and `other` (the counterparty: same fields) plus the stored
  `rowId` — the shape `bb_graph` already returns.
- **B** the facts are the **union over every copy** of the name.
  `copies` lists all of them with each one's cross-row count, `ambiguous` /
  `ambiguityNote` say so, and absence is declared only when *no* copy holds a
  row. `language` is `null` when the copies disagree, with `languages` carrying
  the truth — not the language of whichever copy came back first.
- **C** a declared `limit` (default 200, max 1000, refused outside that range
  rather than clamped), with `truncated`, `truncationReason` and
  `totalCountIfKnown`, exactly as `bb_impact` reports its budget. Facts are
  deduplicated by stored row id; `unpairableRowCount` and `collapsedRowCount`
  report rows that could not name a pair and rows matched from both directions.
- **D** the row query filters `r.project_id = ?` and takes the project id as a
  required argument. The hover door keeps the id-keyed signature, which is sound
  for it — a hover symbol id is project-scoped and names one row's world.

### What did *not* change, on purpose

The `bridge` value is still the stored `bridge_mechanism` with no re-derivation.
On the measured corpus it is `name-resolution` for **100%** of the 1,545 rows —
the indexer's placeholder for "we matched two identifiers". Rewriting that
vocabulary is the analyzer's call, not the tool's, so the tool does not: it
declares the value and the docs now say what it means
(`docs/tools/bb_cross_language.md` → Limitations). **This is the seam for the
analyzer work**: the honest fix is for the analyzers to store a real bridge
mechanism (FFI, JNI, protobuf, HTTP) and leave `name-resolution` as the
explicit fallback, and it belongs with the analyzer lanes, not here.

### One defect the new gate found in the new fix

Check `CL1 A2: copy count matches the index` failed on its first run for every
ambiguous name. `copies` was built from the matched rows, so it listed only the
symbols that *had* cross rows: a name held by six symbols of which one is
connected read as a name held by one — the same class of error as B, one level
up. Caught by a gate that could fail, which is the whole argument for having
one.

## 3. How it is known

`script/m63/verify-cl1-cross-language.ts` — over a real polyglot index, every
count is compared against SQL **the tool does not execute** (a different query
shape: two statements, no UNION, no direction column, so a shared typo cannot
make both sides agree):

| letter | proven |
|---|---|
| A | a name the index does not hold is a loud error; one it does hold is answered |
| B | `pairCount` equals the independent count of pairable stored rows, for every sampled name — this is the predicate that fails on the old `.get()` door |
| C | `declaredAbsent === true` implies the independent count is 0 — including for every ambiguous name |
| A2 | `copyCount` equals the independent count of symbols carrying the name |
| D | every fact carries a counterparty and a `rowId` that is a stored cross-language row **of this project** |
| E | no foreign row can appear |
| F | the limit is honoured; truncation and the true total are declared; out-of-range limits are refused |
| G | the same call twice gives the same bytes |
| H | for an unambiguous name the agent door and the hover door describe the same stored rows — the M28.U1 union claim, re-derived from the other direction this time |

**Six planted defects, all caught:** M1 pick-one-copy (the old `.get()` door,
verbatim), M2 false absence, M3 no identity, M4 no bound, M5 cross-project leak
(row filter dropped), M6 pair fabrication where the row has no languages.
Evidence: `validation/m63/results/CL1.json` → `mutantRecords`.

`script/m63/verify-cl1-corpus-predicate.ts` — builds the honest answer from the
measured corpus facts and derives every case as a **mutation of it**, then
checks two things per rule: it refuses the defect it owns, **and** it still
passes both honest answers. A detector that refuses everything is as useless as
the one that accepts everything, so the second half is checked too. The
measurement of the old M48 predicate is recorded as *evidence*, not asserted as
a check — a permanently red gate is not a gate, and the first person to fix that
predicate must not be told they broke something.

## 4. Declared limitations

- **The payload grew, and that is the honest direction.** A fact that names its
  counterparty is larger than one that does not, so a hub symbol's answer grew.
  Measured against the siblings on the same five symbols, same index:

  | symbol | stored rows | cross_language | cross@limit 10 | bb_graph@1 | bb_graph@3 | bb_impact |
  |---|---|---|---|---|---|---|
  | `generate-class` | 132 | 93,156 | 7,709 | 215,582 | 285,096 | 657 |
  | `clojure.core` | 116 | 80,875 | 7,675 | 415,076 | 501,162 | 200 |
  | `generate-proxy` | 108 | 76,490 | 7,724 | 203,716 | 399,231 | 934 |
  | `f` | 106 | 71,302 | 8,852 | 119,177 | 294,341 | 191 |
  | `byte` | 84 | 58,573 | 7,677 | 2,637 | 2,637 | 356 |

  `bb_graph` returns 3–8× more for four of the five, so the default is at parity
  with the house standard rather than an outlier; `limit: 10` costs ~7.7KB.
  `byte` is the exception (22× a 2.6KB graph) because it has 84 cross-language
  rows and almost no same-language edges — that is a property of the symbol, and
  the limit is the declared way to bound it.
- **A name is many symbols and the tool answers for all of them.** It does not
  choose one on the agent's behalf. An agent that wants one symbol narrows using
  `copies`; every fact names the copy it came from, so the narrowing is
  mechanical rather than a guess.
- **Coverage is bounded by the analyzers.** The tool reports what was stored.
  A pair the indexer never resolved is invisible here and in the hover alike.
- **`unpairableRowCount` can be non-zero.** A row whose endpoint file has no
  detected language cannot name a pair; those rows are counted, never dressed up
  with a guessed language. (Zero on the measured corpus.)
- The gate builds its own index unless `BB_CL1_DB`/`BB_CL1_PROJECT` are given,
  and it refuses to pass on a corpus with no cross-language rows — a gate over
  zero rows proves nothing.

## 5. What is left, and for whom

| item | why it is not here |
|---|---|
| `name-resolution` → real bridge mechanisms in `brain_relationship.bridge_mechanism` | the analyzer lanes' call; the tool must not re-derive a stored value |
| `src/ast/cross-language-intelligence-persister.ts` mints ids that are not project-prefixed (`cross_lang_*`, `dataflow_source_*`) | CL1.D is closed at the read side; the write side belongs with the persister's owner. One shared index file away from a real bleed |
| the M48.C1 predicate in `script/m48/c1-repo-worker.ts` | shared harness, 16 tools in one worker; it should be replaced for all of them, not patched for one |
| wiring `script/m63/verify-cl1-cross-language.ts` into `package.json`'s verify chain | `package.json` is being edited concurrently; the command above is the contract until it can be added safely |
