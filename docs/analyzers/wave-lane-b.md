# Wave lane B — scripting, functional and build languages (13 languages)

Scope: M29 wave-3 onboarding of `perl, ruby, php, lua, elixir, erlang, haskell,
clojure, julia, r, bash, powershell, make`. Each language gets a real fixture pack
and a real S5 server leg; the verdict is whatever the machine produced, not a
target.

Pipeline (read-only inputs, owned elsewhere): `script/m29/wave-protocol.ts`
(registry, approval reader, sealed disposition record), `script/m29/wave-execute.ts`
(S4 real index + S5 stdio server leg), `script/m29/verify-wave-execution.ts`
(R1 approval, R2 S5, R3 S6, R4 mutants), `docs/m29/WAVE-PROTOCOL.md`.

Command (one leg per language, sealed records written by the executor):

```
npx tsx script/m29/wave-execute.ts --languages <lang>
```

All 13 leg seals below are at commit `cdb44c27950d` (the commit that added the
packs and the launch-set extension), produced against the rebuilt `dist/`
(compiled indexer + compiled bb_lsp server, build 13:59 local, which includes
lane C's callable-kind gate). Their first seal was at `fced0a148`; the re-run was
required because committing the packs advances HEAD and every leg's own pack is a
freshness input.

## Result: 13 PASS, 0 BLOCKED, 0 NOT-LSP-APPROPRIATE

| Language | Verdict | Fixture | Failing check | Next action |
|---|---|---|---|---|
| perl | PASS (S5 verified, 12/12) | `script/m29/wave-fixtures/perl/main.pl` | — | none; `validation/m29/results/wave-perl.json` |
| ruby | PASS (S5 verified, 12/12) | `script/m29/wave-fixtures/ruby/main.rb` | — | none; `wave-ruby.json` |
| php | PASS (S5 verified, 12/12) | `script/m29/wave-fixtures/php/main.php` | — | none; `wave-php.json` |
| lua | PASS (S5 verified, 12/12) | `script/m29/wave-fixtures/lua/main.lua` | — | none; `wave-lua.json` |
| elixir | PASS (S5 verified, 12/12) | `script/m29/wave-fixtures/elixir/main.ex` | — | none; `wave-elixir.json` |
| erlang | PASS (S5 verified, 12/12) | `script/m29/wave-fixtures/erlang/main.erl` | — | none; `wave-erlang.json` |
| haskell | PASS (S5 verified, 12/12) | `script/m29/wave-fixtures/haskell/main.hs` | — | none; `wave-haskell.json` |
| clojure | PASS (S5 verified, 12/12) | `script/m29/wave-fixtures/clojure/main.clj` | — | none; `wave-clojure.json` |
| julia | PASS (S5 verified, 12/12) | `script/m29/wave-fixtures/julia/main.jl` | — | none; `wave-julia.json` |
| r | PASS (S5 verified, 12/12) | `script/m29/wave-fixtures/r/main.r` | — | none; `wave-r.json` |
| bash | PASS (S5 verified, 12/12) | `script/m29/wave-fixtures/bash/main.sh` | — | none; `wave-bash.json` |
| powershell | PASS (S5 verified, 12/12) | `script/m29/wave-fixtures/powershell/main.ps1` | — | none; `wave-powershell.json` |
| make | PASS (S5 verified, 12/12) | `script/m29/wave-fixtures/make/main.mk` | — | none; `wave-make.json` |

A PASS here is the S5 leg seal only: real index (non-empty file/symbol counts),
real bb_lsp over stdio, all 12 checks green, §3 warm-p95 budgets clean. It is the
I2 input to `wave-protocol.ts`; the I3 editor leg (R3) is a separate run.

## What the legs prove

Every leg asserts the same 12 checks on the pack's own index:
`S4-real-index`, `L1 capabilities`, `fixture: hover position derivable`,
`L2 hover renders the symbol`, `L2 hover carries the evidence tier`,
`L3 definition resolves`, `L3 references non-empty`, `L4 documentSymbols include
the class`, `L4 workspace symbol finds it`, `L4 absence is declared`,
`L5 call hierarchy only for a callable symbol (item, or declared absence naming
the kind)`, `§3 warm p95 within budgets`. Index counts and expectation shapes
from the seals:

| Language | index files/symbols/relationships | hover target (0-based line) | documentSymbol root(s) |
|---|---|---|---|
| perl | 2 / 23 / 41 | `greet` @15 | `Greeter` |
| ruby | 2 / 22 / 42 | `greet` @12 | `Greeter` |
| php | 2 / 23 / 44 | `greet` @16 | `Greeter` |
| lua | 2 / 23 / 50 | `greet` @13 | `Greeter` |
| elixir | 2 / 22 / 41 | `greet` @7 | `Greeter` |
| erlang | 2 / 22 / 44 | `greet` @8 | `greeter` |
| haskell | 2 / 23 / 42 | `greet` @12 | `Greeter` |
| clojure | 2 / 22 / 41 | `greet` @8 | `greeter` |
| julia | 2 / 22 / 44 | `greet` @8 | `Greeter` |
| r | 2 / 22 / 46 | `greet` @10 | `Greeter` |
| bash | 2 / 23 / 43 | `greet` @9 | `main.sh` |
| powershell | 2 / 23 / 45 | `Greet` @6 | `main.ps1` |
| make | 2 / 22 / 40 | `greet` @4 | `main.mk` |

Each pack is `main.<ext>` + `expectations.json` (the schema in
`wave-execute.ts`: `language`, `hover{symbol,contains,evidenceClassRequired}`,
`hoverLine`, `definition{symbol,minLocations}`, `definitionLine`,
`references{symbol,minCount}`, `documentSymbols[]`,
`declaredAbsence{symbol,note}`). The directory is what the leg indexes, so the
`files=2` in every seal is `main.<ext>` + `expectations.json` — the same shape and
the same count as the existing wave-1 `java` pack (2 / 23 / 53). Fixtures are
written in the language's real syntax: a declaration to hover, a definition,
call/reference sites, a named constant, and the declared absence
`nonexistent_symbol_xyz` (queried through `workspace/symbol`, asserted empty).

Two fixture shapes are worth naming because they are the analyzer's real model,
not a workaround:

- **bash / powershell**: the script is the module (`BD2` in
  `docs/analyzers/bash.md`); functions are children of the file symbol, so the
  document-symbol *root* is `main.sh` / `main.ps1`. `documentSymbols` declares
  that root. The hovered units (`greet`, `Greet`) are real callable functions
  with real call/reference rows — the L5 call-hierarchy check prepares them.
- **haskell**: the type signature and the definition are separate lines; the
  analyzer stores `greet` on the *definition* line, so `hoverLine` is 12
  (0-based), the `greet (Greeter items) = …` line, not the `greet ::` signature.
  Hovering the signature line returns no symbol and is the failure mode recorded
  during authoring (first leg run: 4 failed checks); it is not a fixture defect.

## make — PASS after removing a fixture ambiguity

The first make pack hovered the `greet:` **rule target** (0-based line 7) and the
leg failed one check:
`callable target 'greet' (function) must prepare an item`, because the server's
position resolver found the *variable* `GREETING` at that line (the make analyzer
stores `GREETING`'s span as lines 5–7, so the variable's range end lands on the
target's line) while the leg's index lookup found the target as kind `function`.
That was a fixture ambiguity, not a semantic objection: the callable unit of a
makefile is a macro invoked with `$(call NAME,…)`, and the make analyzer emits a
`calls` edge for exactly that (measured: `calls all → greet` from
`@$(call greet,make)`).

The pack now declares a macro (`define greet … endef`) and invokes it; the hover
is the `define greet` declaration (0-based line 4), where no other symbol's
stored span can shadow it. Re-run result: **`verified`, 12/12** — hover renders
`global function greet(…)`, definition resolves to the macro declaration,
references are non-empty (the `$(call greet,make)` call row), documentSymbols
include the root `main.mk`, and L5 prepares the function-kind item. make needs no
disposition: it is a PASS with real call-hierarchy evidence.

## Terminal dispositions — the honesty mechanism, needed for two languages

Two approved languages are honestly not verifiable today: `sass` (no
tree-sitter-sass grammar; the CSS analyzer cannot represent indented syntax) and
`matlab` (`.m` is shared with Objective-C; the LSP path map refuses to guess).
Their S5 legs are genuine failures, so `verify-wave-execution.ts` R2/R3 used to
demand `status === "verified"` for them and turn a legitimate blocked-with-reason
into a red gate.

**Record** (`script/m29/wave-protocol.ts`, exported as `WaveDisposition`):
`validation/m29/results/wave-<lang>-disposition.json`, written only through
`writeDisposition()` → `writeSealed()` (sealed; the reader is `readDisposition()`
and refuses unsealed/tampered records):

```json
{
  "language": "sass",
  "disposition": "blocked" | "not-lsp-appropriate",
  "reason": "one sentence naming the concrete limit",
  "failingChecks": ["<exact failed step names from wave-<lang>.json>"],
  "evidence": "validation/m29/results/wave-<lang>.json",
  "declaredAt": "2026-11-08T…Z",
  "declaredBy": "<who sealed it>"
}
```

`writeDisposition()` refuses a record with no language, no reason, no failing
checks, no evidence path, unknown disposition or no declarer — a waiver granted
without evidence has no teeth.

**Acceptance** (`acceptDisposition()` in the protocol module, applied by
`verify-wave-execution.ts` R2/R3): a language whose leg is `verified` passes as
today (a disposition is not consulted). A language whose leg is not `verified`
is accepted as a TERMINAL state only when ALL hold:

1. the sealed record names THIS language;
2. `disposition` is `blocked` or `not-lsp-appropriate`, and `reason` is non-empty;
3. `failingChecks` is non-empty and EVERY named check is one the leg actually
   failed (a check the leg passed is rejected — the waiver-without-teeth case);
4. `evidence` resolves to an existing record; and if it is a `wave-*.json` /
   `wave-editor-*.json` it belongs to THIS language (never another language's leg).

Accepted terminals are printed with the reason and recorded as such: R2 emits
`S5 terminal <disposition> (sealed disposition)`, R3 SKIPS the in-editor run and
records `terminal-<disposition>` (never counted as verified, never conflated with
a missing editor leg), and `R2.json` gains a `terminalDispositions[]` list. A
mismatched disposition emits an explicit FAIL check; a missing leg is still a
failure whether or not a disposition exists.

**Mutant added** (inside the gate's own mutant set): a disposition naming a check
the leg did not fail must be caught — plus rejection of missing evidence,
another language's evidence, and a disposition filed under another language; a
positive control proves a genuinely matching disposition is still ACCEPTED (a
gate that can only reject is not a rule). Mutant total 5 → 9.

**Current failed-step strings the Lead must cite when sealing** (copied from the
sealed leg records at `cdb44c279`):

- `sass` (`validation/m29/results/wave-sass.json`, re-run at `cdb44c279`, 3 fails)
  - `L2: hover renders the symbol`
  - `L4: workspace symbol finds it`
  - `L5: call hierarchy only for a callable symbol (item, or declared absence naming the kind)`
- `matlab` (`validation/m29/results/wave-matlab.json`, current at `cdb44c279`, 6 fails)
  - `L2: hover renders the symbol`
  - `L2: hover carries the evidence tier`
  - `L3: definition resolves`
  - `L3: references non-empty`
  - `L4: documentSymbols include the class`
  - `L5: call hierarchy only for a callable symbol (item, or declared absence naming the kind)`

Seal with `writeDisposition({...})` from `script/m29/wave-protocol.ts`
(repo-relative `evidence`), then run `npx tsx script/m29/verify-wave-execution.ts`.
No disposition is needed for make (above) or the other 11 verified languages.

**Protocol doc regeneration — measured answer: NOT needed for the drift gate.**
`docs/m29/WAVE-PROTOCOL.md` is generated by `script/m29/generate-wave-doc.ts`,
which emits fixed tables and does not read the new type or the module doc
comment; after these changes the on-disk doc is byte-identical to
`generateWaveDoc()` (checked directly, so `verify-wave-protocol.ts` R4 stays
green). If the disposition mechanism should appear in that public document, the
generator needs a new section and a regeneration — `generate-wave-doc.ts` is
outside this lane's write scope, so the Lead owns that call
(`npx tsx script/m29/generate-wave-doc.ts`).

## Freshness path list — fixed (staleRelevantPaths)

`script/m29/wave-execute.ts`'s `staleRelevantPaths(language)` now maps each
language to ITS real analyzer inputs instead of assuming
`src/ast/real-<language>-analyzer.ts`. One contiguous hunk, path list only:

- `make` → `src/ast/real-makefile-analyzer.ts` (the named
  `real-make-analyzer.ts` does not exist);
- `tsx` → `src/ast/real-typescript-analyzer.ts`; `sass` →
  `src/ast/real-css-analyzer.ts`; `terraform` → `src/ast/real-hcl-analyzer.ts`
  (engine.ts `getAnalyzer` is the authority for each);
- language-specific inputs added: `julia` + `src/ast/julia-binding-collapse.ts`,
  `php` + `src/ast/php-internal-symbols.ts`, `javascript` +
  `src/ast/js-builtin-prototypes.ts` + `src/ast/js-runtime-globals.ts`,
  `solidity` + `src/ast/solidity-reserved-tokens.ts`;
- `src/lsp/call_hierarchy.ts` added to the shared LSP surface inputs — the L5
  check reads that file's `prepareCallHierarchy`, so a change there must stale
  every leg instead of silently altering L5 verdicts.

`staleRelevantPaths("java")` is unchanged (generic-name fallback, M4 mutant still
green). Consequence for integration: the fix is itself an input of every leg
(`script/m29/wave-execute.ts` is first in the list), so the final sequence is
code commit → rebuild `dist` → re-run legs → seal evidence.

## What the Lead must integrate (updated sequence)

1. **Land code first, then evidence.** Any change to `script/m29/wave-execute.ts`
   or `src/lsp/call_hierarchy.ts` stales every leg (they are inputs of every
   language). Order: commit the code (this lane's `wave-execute.ts` path-list
   hunk, `wave-protocol.ts` disposition record, `verify-wave-execution.ts`
   acceptance, plus lane C's L5 gate) → `npm run build` → re-run all approved
   languages' S5 legs → seal the two dispositions → run
   `verify-wave-execution.ts` → commit evidence. The 13 PASS legs in this report
   are current at `cdb44c279` for the tree as it stands; they go stale when the
   code above is committed.
2. **The make fix is an uncommitted pack revision.** `main.mk` +
   `expectations.json` changed after `cdb44c279` (the macro fixture), and
   `wave-make.json` is the verified re-run against it. Commit the pack, then
   re-run `--languages make` in the final sweep like every other language.
3. **Seal the two terminal dispositions** (`sass`, `matlab`: `blocked`) with the
   exact failed-step strings above. Do not seal one for make.
4. **S6/R3**: all 13 fixtures are driveable by `wave-editor-driver.lua` (it uses
   `hoverLine`/hover symbol/documentSymbol root, all declared here); the two
   disposed languages are skipped by the new R3 acceptance and recorded as
   terminal with their reason.
5. **`staleRelevantPaths` is fixed and mutant-covered** (above). No approval,
   launch-set or registry edit was made from this lane.

## Verification performed for the changes this report describes

- `npx tsc --noEmit -p tsconfig.scripts.json` → exit 0 (no errors).
- `acceptDisposition()` unit checks: matching record accepted; invented check,
  missing evidence, foreign-language evidence, wrong language, empty
  `failingChecks`, unknown disposition and empty reason all rejected;
  `writeDisposition()` refuses each invalid record shape.
- Simulated the two real dispositions against the sealed legs (`sass` 3 failed
  steps, `matlab` 6) — both accepted; a record adding a check the leg passed is
  rejected.
- make re-run after the fixture fix → `verified` 12/12
  (`validation/m29/results/wave-make.json`); sass re-run at `cdb44c279` → the 3
  failed steps listed above (`wave-sass.json`); matlab confirmed current at
  `cdb44c279` with the 6 failed steps listed.
- The full `verify-wave-execution.ts` was deliberately NOT run from this lane:
  it drives the in-editor leg for all 38 approved languages and writes
  `wave-editor-*.json` / `R2.json` (Lead-owned evidence), and the two dispositions
  must be sealed first for the terminal branch to exercise. The Lead's final run
  after sealing is the real gate run.

## Files created / changed

- `script/m29/wave-fixtures/{perl,ruby,php,lua,elixir,erlang,haskell,clojure,julia,r,bash,powershell,make}/` — 13 × (`main.<ext>` + `expectations.json`); make's pack now declares the `define greet` macro and invokes it with `$(call greet,make)`
- `validation/m29/results/wave-{perl,ruby,php,lua,elixir,erlang,haskell,clojure,julia,r,bash,powershell,make}.json` — 13 sealed `verified` S5 legs (at `cdb44c279`; make's sealed against the macro fixture)
- `validation/m29/results/wave-sass.json` — re-run at `cdb44c279` (3 failed steps, current names) so its disposition can cite them
- `script/m29/wave-execute.ts` — `staleRelevantPaths` path-list fix (one hunk)
- `script/m29/wave-protocol.ts` — `WaveDisposition` record, `writeDisposition`/`readDisposition`, `acceptDisposition` rule, module doc comment
- `script/m29/verify-wave-execution.ts` — R2/R3 terminal acceptance + 4 disposition mutants + positive control
- `docs/analyzers/wave-lane-b.md` — this report
