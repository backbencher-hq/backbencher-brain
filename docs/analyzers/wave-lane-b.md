# Wave lane B — scripting, functional and build languages (13 languages)

Scope: M29 wave-3 onboarding of `perl, ruby, php, lua, elixir, erlang, haskell,
clojure, julia, r, bash, powershell, make`. Each language gets a real fixture pack
and a real S5 server leg; the verdict is whatever the machine produced, not a
target.

Pipeline (read-only inputs, owned elsewhere): `script/m29/wave-protocol.ts`
(registry + `approvalRecord`), `script/m29/wave-execute.ts` (S4 real index + S5
stdio server leg), `script/m29/verify-wave-execution.ts` (R1 approval, R2 S5, R3
S6), `docs/m29/WAVE-PROTOCOL.md`.

Command (one leg per language, sealed records written by the executor):

```
npx tsx script/m29/wave-execute.ts --languages <lang>
```

All legs below were sealed at commit `fced0a148b06053fce72d82c8fdeae030bfdb192`
against the Lead's rebuilt `dist/` (compiled indexer + compiled bb_lsp server).

## Result: 12 PASS, 0 BLOCKED, 1 NOT-LSP-APPROPRIATE

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
| make | NOT-LSP-APPROPRIATE (S5 leg `failed`, 11/12) | `script/m29/wave-fixtures/make/main.mk` | `L5: call hierarchy prepares` — `validation/m29/results/wave-make.json` | exclude make from the launch set / approval, or declare it I0; see below |

A PASS here is the S5 leg seal only: real index (non-empty file/symbol counts),
real bb_lsp over stdio, all 12 checks green, §3 warm-p95 budgets clean. It is the
I2 input to `wave-protocol.ts`; the I3 editor leg (R3) is a separate run.

## What the legs prove (per language)

Every leg asserts the same 12 checks on the pack's own index:
`S4-real-index`, `L1 capabilities`, `fixture: hover position derivable`,
`L2 hover renders the symbol`, `L2 hover carries the evidence tier`,
`L3 definition resolves`, `L3 references non-empty`, `L4 documentSymbols include
the class`, `L4 workspace symbol finds it`, `L4 absence is declared`,
`L5 call hierarchy prepares`, `§3 warm p95 within budgets`. Index counts and warm
budgets from the seals:

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
| make | 2 / 22 / 41 | `greet` @7 | `main.mk` |

Each pack is `main.<ext>` + `expectations.json` (the schema in
`wave-execute.ts`: `language`, `hover{symbol,contains,evidenceClassRequired}`,
`hoverLine`, `definition{symbol,minLocations}`, `definitionLine`,
`references{symbol,minCount}`, `documentSymbols[]`,
`declaredAbsence{symbol,note}`). The directory is what the leg indexes, so the
`files=2` in every seal is `main.<ext>` + `expectations.json` — the same shape and
the same count as the existing wave-1 `java` pack. Fixtures are written in the
language's real syntax: a declaration to hover, a definition, call/reference
sites, a named constant, and the declared absence `nonexistent_symbol_xyz`
(queried through `workspace/symbol`, asserted empty).

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

## make — NOT-LSP-APPROPRIATE (not BLOCKED, not PASS)

The pack keeps the honest target fixture: hover the `greet:` rule (0-based line
7) that `all: greet` depends on. The sealed leg passes 11/12 and fails only L5.
The measured mechanism, from the live server probe:

- `textDocument/prepareCallHierarchy` at the `greet:` target returns the
  **variable** `GREETING` (`{"name":"GREETING","kind":2,...}`), because the
  analyzer stores `GREETING`'s span as lines 6–8 (1-based), so the variable's
  range end lands on the target's line 8 and wins position resolution.
- L2 passes only incidentally: the rendered card is "global constant GREETING",
  and the name `greet` appears in the card's `connected`/`usages` links as the
  *consumer* target of that variable — not because hover resolved the target.

Mechanically the leg can be made green: a **variable-hover variant**
(`hover.symbol = "GREETING"`, `documentSymbols = ["GREETING"]`) was run against
the same machinery and sealed `verified` 12/12 — `prepareCallHierarchy` then
"prepares" a make variable. That variant was **rejected and reverted**: a make
variable is not callable, and certifying it would assert a call-hierarchy surface
the DSL does not have. The honest sealed state is the target fixture's `failed`
leg (11/12).

Why this is a category mismatch rather than an analyzer gap to fix: the make
relationship contract (`docs/analyzers/make.md`) emits `calls` only for
`$(call M, …)` macro invocation — a prerequisite naming a target is a
`references`/`uses` row, never a call. A rule target has dependencies, not
callers/callees, so the L5 check asks make a question its ontology rules out.
The analyzer range over-extension is a real, separate defect worth fixing (it
also makes hover at the target render the recipe's variable), but fixing it would
only let the protocol certify a semantic claim that is still not true.

## What the Lead must integrate

1. **Commit the packs before the final seal.** All 13 packs are new files
   (`git status` → `??`). `wave-execute.ts`'s `staleRelevantPaths(lang)` includes
   `script/m29/wave-fixtures/<lang>`, so a leg sealed against the uncommitted
   pack becomes stale the moment the pack is committed (`git diff <leg.commit>
   HEAD -- …`). Order: commit the packs → re-run the 13 legs → commit evidence.
2. **make must not enter the launch set or the execution authority as a pass.**
   `wave-3-approval.json` currently lists all 38 languages including make, so
   `verify-wave-execution.ts` R2 will fail on `wave-make.json` status `failed`
   (and R3/S6 will fail on it too). Decide one of: remove make from
   `src/lsp/launch_languages.ts` + the approval record (re-sealed), or add a
   declared `not-lsp-appropriate` disposition the R2 verifier honors. Keep
   `script/m29/wave-fixtures/make/` + `wave-make.json` as the declared evidence.
3. **`staleRelevantPaths("make")` names a file that does not exist**
   (`src/ast/real-make-analyzer.ts`; the analyzer is
   `src/ast/real-makefile-analyzer.ts`). A changed make analyzer would not stale
   the make leg. The other 12 map correctly. Also not in any stale list:
   `src/ast/julia-binding-collapse.ts` and `src/ast/php-internal-symbols.ts` are
   real inputs of the julia/php indexes.
4. **Re-run the legs after any further shared-surface change.** The 12 PASS legs
   are untouched-input seals at `fced0a148`; nothing in my scope changed after
   each seal except the make/`expectations` iteration already re-sealed.
5. **S6/R3**: the headless-Neovim editor leg will run for every approved
   language. The 12 fixtures are driveable by `wave-editor-driver.lua` (it uses
   `hoverLine`/hover symbol/documentSymbol root, all declared here); make remains
   the expected red unless step 2 is taken.
6. **No approval, launch-set or registry edit was made from this lane.** The
   Lead's integration diff (`WAVE_LANGUAGES`, `LAUNCH_LANGUAGES`,
   `languageForPath`) is what these legs executed; the 12 PASS seals are the
   evidence for the 12 languages' I2 input.

## Files created

- `script/m29/wave-fixtures/{perl,ruby,php,lua,elixir,erlang,haskell,clojure,julia,r,bash,powershell,make}/` — 13 × (`main.<ext>` + `expectations.json`)
- `validation/m29/results/wave-{perl,ruby,php,lua,elixir,erlang,haskell,clojure,julia,r,bash,powershell}.json` — 12 sealed `verified` S5 legs
- `validation/m29/results/wave-make.json` — sealed `failed` S5 leg (11/12; the declared NOT-LSP-APPROPRIATE evidence)
- `docs/analyzers/wave-lane-b.md` — this report
