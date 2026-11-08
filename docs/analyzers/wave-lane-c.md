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
