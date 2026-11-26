# JavaScript lane — the remaining work, measured

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
