# JavaScript lane — the remaining work, and what is now DONE

**STATUS 2026-11-25 (later): all five items below are closed. See "Closed" at the end.**

**Author: Muhammad Ishaq Khan.** Written 2026-11-25 after the receiver-owner work landed.
Everything here is a MEASUREMENT with a reproducer, not a recollection. Nothing in this file is
blocked on another lane.

## The state that is DONE (do not re-open)

- 14/14 vocabulary labels emitted or language-ruled; `part_of` ruled on the language with a named
  falsifier; `implements` from two channels.
- Receiver owner channel: `new_expression`, wrapper strip, cast-as-owner, and withdrawal for untyped
  receivers. Held by the `receiver-owner-rival` fixture, which is **mutation-tested** — disabling the
  `new_expression` branch or the wrapper strip makes it FAIL.
- Zero regex in the analyzer. tsc 0. JS fixtures 100/0. Differential svelte+lodash 100% / MISSING 0 /
  unexplained 0 at `1aa48514c0dab17a` / `494e1b94766e8ade`.
- Symbol completeness: 0 missed on the declaration axis across 19 corpora.

## 1. The withdrawal channel has NO gate  ← the one I would fix first

`javascriptUnresolvedReceiver` is what stops an untyped receiver falling to the name model. It is
implemented and measured (preact 92.5%, nomad 90.1% of member calls withdrawn), but **no fixture
asserts it**: mutation-testing proved that deleting it leaves the whole suite green, because the
property is cross-file (`import {shared} from "./x"; shared.run()`) and this harness's fixtures are
single files.

**What it needs:** a store-level census that builds a two-file project, runs the real resolution pass,
and asserts that a `shared.run()` row ends up with `target_symbol_id = NULL` rather than bound to a
same-named member in a third file. That is the gate; a fixture cannot express it.

## 2. Store-level effect of the owner channel is UNMEASURED

I measured what the analyzer EMITS (owner 6.7% preact / 4.3% nomad, withdrawal 92.5% / 90.1%). I have
**not** measured how many store bindings changed from wrong to NULL/right. That is the number that
proves the defect is gone rather than that the metadata is present. Same census as item 1 answers both.

## 3. Unparseable JS: 323 of 3,894 React files (8.3%), by construct

Full classification, `bothGrammarsFail` = fails under javascript AND typescript AND tsx grammar:

| construct | files | route |
|---|---|---|
| unclassified | 160 | mostly compiler test fixtures (`error.todo-*`), malformed by design |
| `opaque type X` | 52 | Flow-only; no TS equivalent |
| `component X()` | 35 | React Compiler's Flow component syntax |
| `declare ...` | 22 | Flow-only |
| `match (...)` | 3 | Flow-only |
| `hook X()` | 2 | Flow-only |
| exact object `{\| \|}` | 2 | Flow-only |

Separately, **71 files have NO `@flow` pragma and still fail** — 22 of those parse clean under the
TypeScript grammar and 29 more under TSX. That is a **cheap, self-contained win**: the Flow fallback is
pragma-gated, so a pragma-less file with Flow annotations (`eventType: string,` in a `.js` file — this
is what breaks `ReactInternalTestUtils.js`) never gets a second parse attempt.

**Decision needed:** relax the pragma gate to "retry when the primary parse failed", bounded by the
existing rule that the fallback only wins on a CLEAN parse. Measured upside 51 files; risk is that a
genuinely-broken JS file gets parsed as TypeScript and yields a different tree than the same file would
in a JS-only tool. No `tree-sitter-flow` exists on npm (404 verified), so the 114 Flow-only files are a
real dialect boundary, not a patch we are avoiding.

## 4. Tagged-template invalid escapes — measured, not yet done

`String.raw`-style templates with escapes the grammar rejects (`\u{` truncated). One instance in
prettier's own source. **Whole-corpus prevalence not measured**; do that before deciding.

## 5. `@typedef` symbols now exist; consumers not re-checked

`@typedef`/`@callback`/`@interface`/`@enum` publish as symbols. Any consumer that looks a type up by
name from stored facts has not been re-run against that change.

## Explicitly NOT mine

`script/bench/**` (three files still carry the hook's semicolon reformat — see
`docs/HOOK-POLLUTION-2026-11-25.md`), and the store-side decisions that are all-lane: the name-ranking
bind and a `mixes_in` resolution rule.


---

# CLOSED — what was done, and the measurement that proves it

## 1 + 2. The store census exists, and both channels are proven end to end

`validation/m14/fixtures/javascript/store-resolution-census.mts` builds a REAL store through
`storeResults` and reads what the store actually bound — the layer no fixture can reach. It runs a
deterministic three-file repro (the reported defect) plus a corpus pass, and it asserts:

| assertion | preact (196 files, 27,683 rows) | nomad (250 files, 7,941 rows) |
|---|---|---|
| unresolved-receiver rows STILL name-bound | **0** (of 6,429) | **0** (of 1,732) |
| owner-carrying rows landed ELSEWHERE than the stated owner | **0** (45 landed in owner) | **0** (1,092 landed in owner) |
| rows bound by the insert-time ranking BEFORE the owner pass, and misbound | **0** (of 8) | **0** (of 162) |
| row count after clearing + re-resolving | **unchanged** | **unchanged** |

The three-file repro PASSES: `new Widget().run()` resolves inside `Widget`, `shared.run()` is NULL,
and `Other.run` — declared in another file, never imported — is not picked.

**Two corrections made while building this instrument, both worth recording because both were the
instrument lying about the analyzer:**

1. **A blind assertion.** The first version's contract check ended in `|| true`, so it could never
   fail — a gate reporting PASS while asserting nothing, the exact failure mode the TypeScript lane
   warned about. Removed rather than left as decoration.
2. **An ambiguous owner name called a correct binding wrong.** `metadata.owner` carries the receiver's
   type NAME, and preact declares `App` in many files. Matching the landed member's owner against an
   ARBITRARY declaration of that name reported **7 "WRONG" rows on 250 files**. Matching against any
   symbol carrying that name instead gives **0**. The 7 were the instrument's guess, not the pass's
   error — but it is a real finding about precision: `owner` is file-ambiguous, and a
   file-qualified owner would make the channel sharper. Not a defect; recorded.

## 3. Pragma-less typed `.js` files are now read

`maybeFlowFallback` no longer requires `@flow` in the head. Bounded by the rule that already existed —
**the fallback tree must parse CLEAN**, so an ordinary broken file fails both grammars and keeps its
error-recovery tree.

- Measured on React: **323 → 276 unparseable (8.3% → 7.1%)**, i.e. 47 files recovered.
- A/B control: `BB_JS_PRAGMALESS_FALLBACK=0` restores the old behaviour exactly.
- Pinned by the `pragmaless-flow-syntax` fixture, which **FAILS with the control on and PASSES with it
  off** — verified both directions, so the fixture is not decorative.
- **Zero rows changed** on the two corpora the differential pins
  (`1aa48514c0dab17a` / `494e1b94766e8ade`, byte-identical). The 114 remaining Flow-only files
  (`opaque type`, `component X()`, `declare`, `match`, `hook X()`, `{| |}`) stay unreachable: no
  `tree-sitter-flow` exists on npm (404 verified).

## 4. Tagged-template invalid escapes — measured, and too small to act on

`\u{` outside a valid escape inside a tagged template is legal ES2018. Prevalence measured on
prettier's whole JS surface: **2 of 5,268 files (0.04%)** — one real (`src/language-js/print/identifier.js`)
and one a `tests/format/...invalid` fixture whose whole purpose is malformed input. Not worth a
grammar patch; recorded so it is a number rather than a suspicion.

## 5. `@typedef` consumers — checked, and nothing was at risk

`@typedef`/`@callback`/`@interface`/`@enum` are published as SYMBOLS by the analyzer. Verified by
probe: the JS analyzer consults **no** project index for type names (`typeKinds`/`typeMembers` are
never read in `real-javascript-analyzer.ts`), and `JAVASCRIPT_DECLARATION_SPEC` records only
`class_declaration` as a type node, so a `@typedef` never enters the index either. There is therefore
no consumer to break and none that depends on them — `@typedef` symbols serve the symbol surface only.

## Verification at close

tsc src **0** · JS fixtures **101/0** · TS fixtures **127/0** · fleet **50 lanes, 1,860 pass, 0 fail** ·
differential **100% / MISSING 0 / unexplained 0** with unchanged hashes · js-census **PASS** ·
doc-truth **PASS** · witnesses **PASS** · analyzer regex **0**.

One scripts typecheck error exists and is **not this lane's**: `script/m14/c-k1-loss-probe.ts` embeds
an absolute path that the public-tree scrub (`72703613b`) removed, so it cannot resolve `src/ast/engine`.
Confirmed by `git log` on that file — untouched by me.


---

# THE GATE ITSELF WAS BLIND — and how that was found

Everything above was measured with `store-resolution-census.mts`. It reported PASS, and then I asked
the only question that makes a gate a gate: **does it FAIL when the thing it measures is removed?**

It did not. Deleting the withdrawal from the analyzer entirely left the census GREEN, because the
assertion was `withdrawnBound === 0` — and a population of zero makes that true. Same for
`landedElsewhere === 0`: remove the owner channel and there are no owner rows to land wrongly. Three
checks, all vacuously true on an absent feature.

**This is the same failure mode the TypeScript lane warned about** (its eleven gates that read a retired
envelope and threw before comparing anything), and the same one I hit in the `assertions: [...]` fixture
earlier in this campaign. It is the default outcome of writing a gate against output you have already
seen and liked.

## The repair

Non-vacuity is now ASSERTED, not assumed — a population of zero is a FAILURE:

```
withdrawn === 0        -> FAIL "the withdrawal channel is absent, so 'still bound 0' is vacuous"
owned === 0            -> FAIL "the owner channel is absent"
landedInOwner === 0    -> FAIL "the owner pass landed nothing — vacuous"
```

## Mutation-tested, both directions, exit code taken from `bun` (not from the pipe)

| mutant | census result |
|---|---|
| withdrawal deleted from the analyzer | **EXIT 1** — "no unresolved-receiver rows at all … vacuous" |
| `new_expression` owner branch disabled | **EXIT 1** — "no owner-carrying rows — the owner channel is absent" |
| unmutated | **EXIT 0** on preact (250 files) and nomad (250 files) |

Run twice, byte-identical output — the census is deterministic, not sampling noise. Wired as
`bun run audit:js-store-census`.

## What is therefore established, and what is not

**Established:** on two corpora, with the gate proven to fail when either channel is removed, the store
binds no unresolved-receiver row by name, lands no owner row outside its stated owner, and misbinds no
row the insert-time ranking claims first.

**Not established, and I will not claim it:** `metadata.owner` is a bare type NAME. The check proves
each landed row is a member of *some* symbol with that name, not the one in the calling file. The
three-file repro proves the file-local case exactly; a corpus cannot, because the owner does not carry
its file. A file-qualified owner (or an owner symbol id) would close that, and would also sharpen the
channel — that is the next real increment, not a formality.
