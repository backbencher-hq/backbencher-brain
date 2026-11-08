# Wave lane C — native, typed & infra languages (12)

Task: `task-9` (wave onboarding C). Pipeline read: `docs/m29/WAVE-PROTOCOL.md`,
`script/m29/wave-protocol.ts`, `script/m29/wave-execute.ts`,
`script/m29/verify-wave-execution.ts`, plus the sealed shape of
`validation/m29/results/wave-java.json`.

Method: for each language one fixture pack was authored at
`script/m29/wave-fixtures/<lang>/` (`main.<ext>` + `expectations.json`) and the
real execution engine was run:

```
npx tsx script/m29/wave-execute.ts --languages <lang>
```

Every leg below was produced by that command against the REAL compiled indexer
(`dist/index.js`) and the REAL `bb_lsp` server over stdio, sealed at commit
`fced0a148b06053fce72d82c8fdeae030bfdb192`. `expectations.json` line numbers and
symbol names were taken from the measured `brain_symbol` rows and the measured
document-symbol roots, never guessed.

One expectation was corrected after a real run and is recorded here rather than
hidden: solidity's first leg failed only `L4: documentSymbols include the class`
because the expectation named the nested class while the provider's root is the
file module (`["main.sol"]`); the expectation was changed to the measured root
and the leg re-run to `verified`. Source fixtures were never reshaped to force a
check — that is why matlab and the call-hierarchy caveat below are reported as
they measured.

Verdict vocabulary used here:

- **PASS** — the S5 leg sealed `verified`, 0 failed checks.
- **BLOCKED** — the S5 leg sealed `failed`; the failing checks are named.
- **NOT-LSP-APPROPRIATE** — a leg assertion is semantically wrong for the
  language even though the leg is mechanically green.

## Verdicts

| language | verdict | fixture | failing check | next action |
|---|---|---|---|---|
| swift | PASS — S5 verified (12/12) | `script/m29/wave-fixtures/swift/main.swift` | — | S1/S6 below; re-run after fixtures are committed |
| dart | PASS — S5 verified (12/12) | `script/m29/wave-fixtures/dart/main.dart` | — | same |
| csharp | PASS — S5 verified (12/12) | `script/m29/wave-fixtures/csharp/main.cs` | — | same |
| fsharp | PASS — S5 verified (12/12) | `script/m29/wave-fixtures/fsharp/main.fs` | — | same |
| nim | PASS — S5 verified (12/12) | `script/m29/wave-fixtures/nim/main.nim` | — | S1 ledger entry missing (below) |
| vb | PASS — S5 verified (12/12) | `script/m29/wave-fixtures/vb/main.vb` | — | S1 ledger entry missing |
| vba | PASS — S5 verified (12/12) | `script/m29/wave-fixtures/vba/main.bas` | — | S1 ledger entry missing |
| clean | PASS — S5 verified (12/12) | `script/m29/wave-fixtures/clean/main.icl` | — | S1 ledger entry missing |
| solidity | PASS — S5 verified (12/12) | `script/m29/wave-fixtures/solidity/main.sol` | — | same as swift |
| matlab | **BLOCKED** — S5 failed (6/12) | `script/m29/wave-fixtures/matlab/main.m` | `.m` is not in the LSP path map → hover/definition/references/documentSymbols/callHierarchy all resolve `null` | Lead decision on `.m` disambiguation (below) |
| hcl | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 mechanically verified (12/12) | `script/m29/wave-fixtures/hcl/main.hcl` | L5 accepts a config attribute as a `CallHierarchyItem` | declare call-hierarchy absent for non-callable kinds, or exclude L5 for config languages |
| terraform | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 mechanically verified (12/12) | `script/m29/wave-fixtures/terraform/main.tf` | same (L5 item kind `variable`) | same |

Counts: **9 PASS**, **2 NOT-LSP-APPROPRIATE (call hierarchy)**, **1 BLOCKED**.

> The `hcl`/`terraform` rows above record the state BEFORE the call-hierarchy
> defect was fixed. The addendum at the end of this file records the defect, the
> fix, the before/after L5 behaviour and the re-run evidence at
> `validation/m29/results/wave-*.json`.

## Measured S5 legs

Every leg also passed `§3: warm p95 within budgets` (0 budget violations).

| language | status | index counts (files/symbols/relationships) | leg record |
|---|---|---|---|
| swift | verified | 2 / 23 / 44 | `validation/m29/results/wave-swift.json` |
| dart | verified | 2 / 24 / 47 | `validation/m29/results/wave-dart.json` |
| csharp | verified | 2 / 25 / 53 | `validation/m29/results/wave-csharp.json` |
| fsharp | verified | 2 / 24 / 52 | `validation/m29/results/wave-fsharp.json` |
| nim | verified | 2 / 24 / 44 | `validation/m29/results/wave-nim.json` |
| vb | verified | 2 / 24 / 53 | `validation/m29/results/wave-vb.json` |
| vba | verified | 2 / 23 / 55 | `validation/m29/results/wave-vba.json` |
| clean | verified | 2 / 24 / 55 | `validation/m29/results/wave-clean.json` |
| solidity | verified | 2 / 24 / 43 | `validation/m29/results/wave-solidity.json` |
| hcl | verified (see L5 caveat) | 2 / 25 / 49 | `validation/m29/results/wave-hcl.json` |
| terraform | verified (see L5 caveat) | 2 / 28 / 55 | `validation/m29/results/wave-terraform.json` |
| matlab | failed (6 checks) | 2 / 22 / 46 | `validation/m29/results/wave-matlab.json` |

`files=2` in every row is `main.<ext>` plus `expectations.json` (the pack
directory is the project; the expectations record is itself indexed as JSON).
Per-language hover/definition/references `detail` payloads are in the sealed
records.

## matlab — BLOCKED, with the exact evidence

`validation/m29/results/wave-matlab.json`, `status: "failed"`, failed steps:

```
L2: hover renders the symbol                 — (empty)
L2: hover carries the evidence tier          — (empty)
L3: definition resolves                      — null
L3: references non-empty                     — got 0
L4: documentSymbols include the class        — []
L5: call hierarchy prepares                  — null
```

`L1: capabilities advertised` and `S4-real-index` pass in the same record — so
this is not a server or index failure. Root cause is one gate:

- the indexer stored `main.m` as language **matlab**: measured
  `SELECT relative_path, language FROM brain_file` → `main.m → matlab`; the
  fixture is real MATLAB and the S4 stage indexed 22 symbols / 46 relationships;
- `src/lsp/launch_languages.ts:120-121` deliberately does **not** map `.m`:
  *"Deliberately ABSENT: \".m\" (objc and matlab share it, so it resolves to
  neither until content sniffing lands — a declared absence, not a guess)"*;
- every LSP surface calls `languageForPath()` first and returns declared
  absence for a `null` language, which is exactly the six failures above.

This is index/LSP drift: the analyzer route knows `.m → matlab`, the LSP path
map refuses it. The fixture was not renamed to route around it. `objc` is also
in `WAVE_LANGUAGES` with extension `m`, so mapping `.m → matlab` unconditionally
would mis-route Objective-C: the fix is content sniffing in
`languageForPath()` (or removing both `.m` languages from the wave set until
sniffing lands) — a Lead decision, not a fixture edit.

## hcl & terraform — NOT-LSP-APPROPRIATE for call hierarchy

Everything else in both legs is real: hover renders the declaration
(`public property app_name` / `public variable app_name`), definition resolves
to the declaration range, references returned 3 locations, documentSymbols and
workspaceSymbol answer. The problem is one assertion:

`wave-hcl.json` → `L5: call hierarchy prepares` PASSES with
`{"name":"app_name","kind":10,...}`; `wave-terraform.json` → same with
`kind:13`. `kind 10/13` are `KIND_MAP` entries for `property`/`variable`
(`src/lsp/call_hierarchy.ts:215-235`) — non-callable config symbols. LSP call
hierarchy is defined over callables; an editor will offer callers/callees for a
Terraform variable and get a hollow tree. The hover itself already says
*"not a callable symbol; no return type exists to report"* — the call-hierarchy
surface does not apply the same rule.

So the language is LSP-appropriate for hover/definition/references/document
symbols (verified above) and **not** appropriate for call hierarchy. The S5 leg
cannot distinguish this because its L5 check only asserts `item.name === symbol`.

## What the Lead must integrate

1. **`.m` policy (blocks matlab).** Decide `.m` disambiguation in
   `src/lsp/launch_languages.ts` (content sniffing, or one of matlab/objc out of
   the launch set). Until then keep `wave-matlab.json` as the honest failed
   record; re-run `--languages matlab` after the change.
2. **Call hierarchy for non-callable symbols (hcl, terraform).**
   `prepareCallHierarchy` should return a declared absence for symbol kinds that
   are not callable instead of a `CallHierarchyItem`. That change belongs to
   `src/lsp/call_hierarchy.ts` (lsp-graph lane / Lead), after which the L5 check
   must be made language-aware or the two config languages must be classified
   NOT-LSP-APPROPRIATE in the launch record.
3. **#419 SPEC ledger entries (caps 6 languages at I0).** `S1-analyzer-conformance`
   reads `validation/m14/results/M14.0.SPEC.json`; these approved languages have
   no entry, so S1 fails regardless of the verified S5 leg:

   | language | S1 today |
   |---|---|
   | nim, vb, vba, matlab, clean, terraform | absent from the ledger |
   | swift, dart, csharp, fsharp, solidity, hcl | 8/8 sections pass |

   The ledger is committed M14 evidence — it must record these analyzers (or the
   protocol must declare the absence acceptable) before any I1+ claim.
4. **Re-run the 12 legs after committing.** A leg is fresh only while
   `git diff <leg.commit> HEAD -- <its inputs>` is empty and
   `script/m29/wave-fixtures/<lang>` is an input (`staleRelevantPaths` in
   `script/m29/wave-execute.ts`). The packs are currently untracked; the commit
   that adds them advances HEAD and staling every leg — re-run
   `npx tsx script/m29/wave-execute.ts --languages <the 12>` afterwards.
5. **S6 (I3) is not produced by this lane.** No `wave-editor-<lang>.json` exists
   for these 12. Reaching I2 is possible from the S5 records above (once S1 is
   satisfied); I3 needs the in-editor leg the Lead owns.
6. **S2/S3 gates were not run by this lane**; they are spawned by
   `script/m29/wave-protocol.ts` and are not part of the S5 producer. No claim
   about them is made here.

## Note for other wave lanes

`textDocument/documentSymbol` returns a **tree** (roots + `children`,
`src/lsp/symbols.ts:502-551`) while the S5 check reads only root `name`s. A pack
whose analyzer wraps the file in a module/namespace symbol (solidity `main.sol`,
hcl/terraform `main`, clean `main`, fsharp `WaveTest`, csharp `WaveTest`) must put
the ROOT name in `documentSymbols`, not the nested class — otherwise L4 fails on
a correct LSP answer. This lane's `expectations.json` files do that; the class is
the child of the declared root.

## Addendum — the call-hierarchy defect and its fix

### The defect

`prepareCallHierarchy` placed a `CallHierarchyItem` for ANY indexed symbol that
covered the position, callable or not, and the wave L5 check only asserted
`item?.name === symbol`. Measured before the fix at commit `cdb44c279`:

| evidence | L5 detail | what kind 10/13 is |
|---|---|---|
| `git show cdb44c279:validation/m29/results/wave-hcl.json` | `[{"name":"app_name","kind":10,...}]` | `KIND_MAP.property` (`src/lsp/call_hierarchy.ts:215+`) |
| `git show cdb44c279:validation/m29/results/wave-terraform.json` | `[{"name":"app_name","kind":13,...}]` | `KIND_MAP.variable` |

The same shape was measured in lanes A/B (a make variable, a json property). LSP
call hierarchy is defined over CALLABLE symbols: an editor offered a caller /
callee tree for a config attribute. That is a false semantic claim, and L5
"passed for the wrong reason" (`item.name === symbol` held for a property).

### The fix (2 files)

1. `src/lsp/call_hierarchy.ts` — a symbol must be callable before an item is
   placed. `CALLABLE_SYMBOL_TYPES` (mirrors `signature.ts`'s private
   `CALLABLE_TYPES`: function, method, constructor, procedure, subroutine,
   getter, setter) is applied right after the position resolves. Any other kind
   returns the file's existing declared-absence path:
   `{ item: null, notIndexed: true, absence: absenceWith("no_stored_calls",
   "symbol kind '<kind>' is not callable — call hierarchy does not apply …
   (this is NOT 'no callers')", filePath), staleness }`. The file header's
   guarantee, evidence line and "contracts it must not break" were updated.
2. `script/m29/wave-execute.ts` — L5 is now two-sided and never a blind pass:
   - an item passes only when `name === hoverSymbol` AND its LSP kind is
     callable (Method 6 / Constructor 9 / Function 12);
   - NO item passes only when the same real index the S4 stage built stores the
     target symbol on the hover line with a NON-callable kind. The step detail
     and the leg's new `featureNotes[]` carry
     `call hierarchy declared absent: kind '<kind>' is not callable — no item placed`;
   - no item for a callable target — or a target the index cannot place — FAILS;
   - if a server forwards its declared absence on the response, the leg quotes
     its `code`/`message` instead of the index-backed kind.

### Before / after, per language (sealed legs)

| language | L5 before (`cdb44c279`) | L5 after (working tree) | leg status after |
|---|---|---|---|
| swift | item name `greet`, kind 6 | item name `greet`, kind 6 | verified |
| dart | item name `greet`, kind 6 | item name `greet`, kind 6 | verified |
| csharp | item name `Greet`, kind 6 | item name `Greet`, kind 6 | verified |
| fsharp | item name `Greet`, kind 6 | item name `Greet`, kind 6 | verified |
| nim | item name `greet`, kind 12 | item name `greet`, kind 12 | verified |
| vb | item name `Greet`, kind 6 | item name `Greet`, kind 6 | verified |
| vba | item name `Greet`, kind 12 | item name `Greet`, kind 12 | verified |
| clean | item name `greet`, kind 12 | item name `greet`, kind 12 | verified |
| solidity | item name `greet`, kind 6 | item name `greet`, kind 6 | verified |
| hcl | item name `app_name`, kind 10 (property) | declared absent — kind `property` is not callable | verified + `featureNotes` |
| terraform | item name `app_name`, kind 13 (variable) | declared absent — kind `variable` is not callable | verified + `featureNotes` |
| matlab | no item (`null`) | no item for a CALLABLE target → L5 fails | failed (`.m` path, unchanged) |

Re-run command (all 12): `npx tsx script/m29/wave-execute.ts --languages
swift,dart,csharp,fsharp,nim,vb,vba,clean,solidity,hcl,terraform,matlab` →
11 verified, matlab failed on the `.m` blocker only. Evidence:
`validation/m29/results/wave-<lang>.json` for each, sealed at
`cdb44c279` with the fixed `dist/`.

### Component-level positive AND negative probe

`prepareCallHierarchy` driven directly over a real index (same component the
server runs):

| target | expected | measured |
|---|---|---|
| hcl `app_name` (property) | absent | `absence.code=no_stored_calls`, `"symbol kind 'property' is not callable …"` |
| terraform `app_name` (variable) | absent | `"symbol kind 'variable' is not callable …"` |
| swift `Greeter` (CLASS position) | absent | `"symbol kind 'class' is not callable …"` — a class, previously an item |
| swift `greet` (method) | item | `item.name=greet kind=6 detail="method greet(…) → String"` |
| csharp `Greet` (method) | item | `item.name=Greet kind=6` |
| solidity `greet` (method) | item | `item.name=greet kind=6` |
| clean `greet` (function) | item | `item.name=greet kind=12` |

Wire check over stdio: `textDocument/prepareCallHierarchy` now returns `null`
for hcl and `[{"name":"greet","kind":6,...}]` for swift — so the negative was
exercised on the same surface the editor uses, not only the component.

### Wire limitation — the declared reason does not travel (Lead action)

The component now DECLARES the absence, but the wire carries only the protocol's
empty shape: `src/lsp/server.ts:1333` does
`return r.item === null ? null : [r.item]`, dropping `r.absence`, and the prepare
handler (`src/lsp/server.ts:1313`) is not registered `{ absentable: true }` — unlike
the read handlers, whose `bb/absence` notice is the declared-absence carrier.
Consequence: L5's hcl/terraform pass currently rests on the `null` plus the kind
read from the same index (recorded in the leg). To put the reason on the wire:

1. `src/lsp/server.ts` (Lead-owned): when `r.item === null && r.absence !== null`,
   `throw new DeclaredAbsenceThrow({ method: "textDocument/prepareCallHierarchy",
   reason: <"language_not_launched" for file_type_unknown/language_outside_launch_set,
   else "not_indexed">, language: r.absence.language, detail: r.absence.message,
   evidenceTier: null, searchedIndex: <false for the launch-set codes, else true>,
   totalCount: null })`, and register the method `{ absentable: true }`. A dedicated
   `not_callable` reason in `AbsenceReason` would keep `not_indexed` from being
   overloaded.
2. `script/m25/feature-assertions.ts` (Lead-owned): the stdio transport's `onData`
   discards every message without an `id`, so a `bb/absence` notice is invisible to
   a wave leg; asserting the notice needs a captured-notifications accessor. Until
   then the executor's index-backed kind is the only observable, and it is a fact
   from the same index — never a blind pass.

### Gates run, and one finding that is NOT this fix

- `npx tsx script/m55/verify-call-hierarchy.ts` → **T2: VERIFIED** (64/64 passed,
  9/9 mutants caught, 0 not judged). `validation/m55/results/T2.json` refreshed.
- `npx tsx script/m24/verify-call-hierarchy.ts` → **KNOWN-GAP 88/97**
  (`validation/m24/results/L5.json` refreshed). The 9 failures are NOT caused by
  this fix: the gate was run twice, once with the HEAD component and once with the
  fixed component — both 88/97 with the same 9 failures. Cause: the gate's
  "non-launch" fixture is `fixture.rb`, and **ruby entered the launch set** in
  `cdb44c279` (52 languages), so its G7/G8 negatives ("a non-launch file returns NO
  item", "the absence names the launch set", `launchLanguages.length === 14`) now
  assert that a launch language is unserved. Lead action: the gate fixture needs a
  genuinely unrouted file type, and the `14` literal must come from the launch-set
  owner.
- `npm run build` succeeded after the source change; `dist/` is current.

### Required follow-ups for the other lanes

- **`npm run build` is REQUIRED** for any lane that re-runs `wave-execute`: the
  leg's server subprocess is `dist/lsp/server.js`, which embeds the component.
- **`script/m29/wave-execute.ts` is a shared input of every leg**
  (`staleRelevantPaths`). Committing this fix stales all 52 languages' legs, and
  every leg re-run under the old engine still carries the old "L5 passed for an
  item" evidence. All three lanes must re-run their legs after the commit.
- The precision-ledger generator keys `callHierarchy` on the `"L5:"` step prefix,
  which the renamed step still matches — so a regenerated ledger would still
  render `pass` for hcl/terraform. The not-applicable fact lives in the leg's
  `featureNotes`; the generator (script owner) should render `n/a` (or
  `declared-absent`) when `featureNotes` names call hierarchy.
- Other lanes' packs: the new L5 can FAIL where the old one passed — a `null`
  prepare whose target the index cannot place by name on the hover line. Fixture
  `hover.symbol` must equal the indexed symbol name at `hoverLine` (this lane's
  do; verified by the 11 green legs above).
