# Wave lane A — web, data & query languages (13)

Task: `task-7` (wave onboarding A). Pipeline read: `docs/m29/WAVE-PROTOCOL.md`,
`script/m29/wave-protocol.ts`, `script/m29/wave-execute.ts`,
`script/m29/verify-wave-execution.ts`, plus the sealed shape of
`validation/m29/results/wave-java.json` and `wave-editor-java.json`, and the
sibling lane report `docs/analyzers/wave-lane-c.md`.

Languages: tsx, html, css, scss, sass, json, yaml, toml, markdown, xml,
graphql, protobuf, sql.

Method: for each language one fixture pack was authored at
`script/m29/wave-fixtures/<lang>/` (`main.<ext>` + `expectations.json`) and the
real execution engine was run:

```
npx tsx script/m29/wave-execute.ts --languages <lang>
```

Every leg below was produced by that command against the REAL compiled indexer
(`dist/index.js`) and the REAL `bb_lsp` server over stdio, sealed at commit
`fced0a148b06053fce72d82c8fdeae030bfdb192`. `expectations.json` symbol names,
hover lines and document-symbol roots were taken from the measured
`brain_symbol` rows (real index build) before the run — not guessed. No
expectation had to be corrected after a run; no source fixture was reshaped to
force a check. The one failing language (sass) is reported as it measured.

Verdict vocabulary used here (same as lane C, so the two reports compare):

- **PASS** — the S5 leg sealed `verified`, 0 failed checks, and the assertions
  are semantically appropriate for the hovered declaration.
- **BLOCKED** — the S5 leg sealed `failed`; the failing checks are named with the
  evidence path.
- **NOT-LSP-APPROPRIATE** — the S5 leg is mechanically green but a leg assertion
  is semantically wrong for the language; the reason and the exact assertion are
  stated.

## Verdicts

| language | verdict | fixture | failing check | next action |
|---|---|---|---|---|
| tsx | **PASS** — S5 verified (12/12) | `script/m29/wave-fixtures/tsx/main.tsx` | — | S1 ledger entry missing (below); re-run after commit |
| html | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/html/main.html` | none failed; `L5` returned a `CallHierarchyItem` for a non-callable element id (`email`) | make `prepareCallHierarchy` declare absence for non-callable kinds (Lead / lsp-graph), then make L5 kind-aware |
| css | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/css/main.css` | `L5` item is `variable --brand-color` (a declaration, has no calls) | same shared `call_hierarchy.ts` fix |
| scss | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/scss/main.scss` | `L5` item is `variable $brand-color` | same |
| sass | **BLOCKED** — S5 failed (9/12) | `script/m29/wave-fixtures/sass/main.sass` | `L2: hover renders the symbol`; `L4: workspace symbol finds it`; `L5: call hierarchy prepares` — measured record `validation/m29/results/wave-sass.json` | vendor a tree-sitter-sass grammar + analyzer and route `.sass` to it, then re-run (below) |
| json | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/json/main.json` | `L5` item is `class User` (JSON-Schema definition, not callable). References are real: 2 `$ref` rows target `User` | shared `call_hierarchy.ts` fix |
| yaml | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/yaml/main.yaml` | `L5` item is `constant service` (anchor declaration). References are real: 2 `extends` merge rows target it | shared `call_hierarchy.ts` fix |
| toml | **NOT-LSP-APPROPRIATE** for call hierarchy **and references** — S5 verified (12/12) | `script/m29/wave-fixtures/toml/main.toml` | `L5` item is `namespace versions`; `L3: references non-empty` measured **got 1 = the declaration only** (no usage row targets a hoverable TOML symbol — below) | shared fix + a references assertion that excludes the declaration, if a references claim is wanted |
| markdown | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/markdown/main.md` | `L5` item is `type Configure` (a heading). References are real: the internal anchor link produces 1 `references` row | shared `call_hierarchy.ts` fix |
| xml | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/xml/main.xml` | `L5` item is `class catalog` (XSD element). References are real: the `ref="wave:catalog"` attribute produces 1 `references` row | shared `call_hierarchy.ts` fix |
| graphql | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/graphql/main.graphql` | `L5` item is `class User`; the analyzer rules `calls` grammar-absence (documented in `docs/analyzers/graphql.md`). References are real: declared-type edges (3 usage rows) | shared `call_hierarchy.ts` fix |
| protobuf | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/protobuf/main.proto` | `L5` item is `class User` (message). References are real: field/rpc type edges (2 usage rows) | shared `call_hierarchy.ts` fix |
| sql | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/sql/main.sql` | `L5` item is `class users` (table). References are real: the foreign key produces 1 `references` row | shared `call_hierarchy.ts` fix |

Counts: **1 PASS**, **11 NOT-LSP-APPROPRIATE (call hierarchy)**, **1 BLOCKED**.
All 13 languages have a real S5 record; 12 of them sealed `verified`.

The NOT-LSP-APPROPRIATE verdict is scoped to the **call-hierarchy feature
claim**, exactly as lane C scoped hcl/terraform: hover, definition, references,
document symbols and workspace symbols are verified for every one of them, and
the packs exercise real per-format reference semantics (`$ref`, YAML merge,
markdown anchors, XSD `ref`, idrefs, CSS `var()`, Sass variables, GraphQL
declared types, protobuf field types, SQL foreign keys, TS/JSX components). The
single wrong assertion is `L5: call hierarchy prepares`, which only asserts
`item.name === symbol` and therefore accepts a non-callable declaration as a
`CallHierarchyItem`. That is the same surface defect lane C reported.

## Measured S5 legs

Every verified leg also passed `§3: warm p95 within budgets` (0 budget
violations; worst measured p95 was hover 12.7 ms, prepareCallHierarchy 16.5 ms,
against 50 ms / 100 ms budgets).

| language | status | index counts (files/symbols/relationships) | leg record |
|---|---|---|---|
| tsx | verified | 2 / 23 / 49 | `validation/m29/results/wave-tsx.json` |
| html | verified | 2 / 23 / 41 | `validation/m29/results/wave-html.json` |
| css | verified | 2 / 26 / 41 | `validation/m29/results/wave-css.json` |
| scss | verified | 2 / 24 / 42 | `validation/m29/results/wave-scss.json` |
| sass | failed (3 checks) | 2 / 19 / 34 | `validation/m29/results/wave-sass.json` |
| json | verified | 2 / 43 / 85 | `validation/m29/results/wave-json.json` |
| yaml | verified | 2 / 30 / 59 | `validation/m29/results/wave-yaml.json` |
| toml | verified | 2 / 27 / 52 | `validation/m29/results/wave-toml.json` |
| markdown | verified | 2 / 23 / 39 | `validation/m29/results/wave-markdown.json` |
| xml | verified | 2 / 42 / 71 | `validation/m29/results/wave-xml.json` |
| graphql | verified | 2 / 41 / 92 | `validation/m29/results/wave-graphql.json` |
| protobuf | verified | 2 / 39 / 80 | `validation/m29/results/wave-protobuf.json` |
| sql | verified | 2 / 31 / 53 | `validation/m29/results/wave-sql.json` |

`files=2` in every row is `main.<ext>` plus `expectations.json` (the pack
directory is the project; the expectations record is itself indexed as JSON).
Per-language hover/definition/references `detail` payloads are in the sealed
records; the hovered declarations measured were: `function Greeting`
(tsx), `class email` (html), `variable --brand-color` (css), `variable
$brand-color` (scss), `class User` (json), `constant service` (yaml),
`namespace versions` (toml), `type Configure` (markdown), `class catalog`
(xml), `class User` (graphql), `class User` (protobuf), `class users` (sql).

## sass — BLOCKED, with the exact evidence

`validation/m29/results/wave-sass.json`, `status: "failed"`, failed steps:

```
L2: hover renders the symbol          — hover rendered "public module main.sass", not $brand-color
L4: workspace symbol finds it         — []
L5: call hierarchy prepares           — [{"name":"main.sass","kind":2,...}]
```

The other nine checks pass in the same record, including `S4-real-index`
(`files=2 symbols=19 rels=34`), `L1: capabilities advertised` and
`§3: warm p95 within budgets` — so this is not a server or wiring failure.

Root cause, measured:

- the fixture is REAL indented Sass (no braces, `$brand-color`, `=card-surface`
  mixin, `+card-surface(...)` include) — the language's own syntax;
- `src/ast/engine.ts:2366-2368` routes language `sass` to `RealCssAnalyzer`
  (`case "css": case "sass":`), and `src/ast/language-detection.ts:66-78`
  records the consequence: there is no tree-sitter-sass here, the CSS grammar
  cannot represent indented syntax, so a real `.sass` file parses with ERROR
  nodes;
- measured on `main.sass` alone (real index build): **1 symbol — the file
  module `main.sass` — and 0 relationships**. The pack's `symbols=19` in the
  S4 step is the pack's `expectations.json` counted as JSON; it does NOT show
  that Sass was analyzed. `$brand-color` is not in the index at all.

So the three failures are all the same fact: the Sass declaration is not a
symbol, and the only indexed symbol in the file is the module, which is what
hover/workspace-symbol/call-hierarchy answer. This is an **analyzer/grammar
gap**, not a semantics question: Sass has variables and mixins, so hover /
definition / references / document symbols are the right features for it.

The fixture was not rewritten in CSS-compatible syntax to route around the
grammar — that would exercise CSS, not Sass. Until a Sass grammar is vendored:

- keep `wave-sass.json` as the honest failed record;
- keep `sass` out of the launch claim (the R2 verifier's per-language check
  `R2: sass S5 status verified` will otherwise be red), or remove it from the
  wave-3 approval record + `LAUNCH_LANGUAGES` + the `.sass` path map for this
  wave.

## toml — the one non-green-looking assertion that still sealed

`wave-toml.json` step `L3: references non-empty` reports `got 1`. That one
location is the **declaration** — `textDocument/references` was called with
`includeDeclaration: true` (`script/m29/wave-execute.ts:173`), so a symbol with
zero usage rows still yields 1. The TOML fixture does carry two REAL
`references` edges (Gradle version-catalogue `version.ref = "groovy"` /
`"junit"`), but their targets are the fully-qualified key symbols
`versions.groovy` / `versions.junit`; TOML symbol names are full dotted paths
and never appear literally on one line, so no usage row can target the
hoverable symbol `versions`. The fixture is genuine TOML (a version catalogue is
TOML's one reference construct, and the index stores the edges); only the
assertion is insensitive. A references claim for a config format needs a
usage-row assertion (declaration excluded), not just this check.

## call-hierarchy caveat (shared with lane C)

`L5: call hierarchy prepares` asserts only `item.name === symbol`
(`script/m29/wave-execute.ts:189-191`). `prepareCallHierarchy` returns an item
for ANY symbol, including variables, config attributes, headings, markup
elements and data keys (`src/lsp/call_hierarchy.ts:960-1060`; the item `kind`
map is at `:215-235`). LSP call hierarchy is defined over callables, so for
these languages the check is mechanically green while the claim it appears to
support is semantically void. Lane C reached the same conclusion for hcl and
terraform and proposed the shared fix: `prepareCallHierarchy` should declare
absence for non-callable symbol kinds, after which the L5 check must become
language/kind-aware (or the feature declared absent in the launch record for
these languages). This lane's 11 NOT-LSP-APPROPRIATE verdicts are that same
finding, scoped to the call-hierarchy feature.

Note the languages where a callable target was available and used: none in this
lane. `tsx` hovers `function Greeting` (callable, verified PASS in the strict
sense). Sass mixins are callable (`@include`) but the sass leg is blocked before
that distinction matters.

## S1 (#419 SPEC ledger) status — caps six languages at I0

`S1-analyzer-conformance` reads `validation/m14/results/M14.0.SPEC.json`
(committed M14 evidence, not editable by this lane). Measured today:

| language | S1 today |
|---|---|
| html, css, scss, yaml, toml, markdown, xml | 8/8 sections pass |
| tsx, json, graphql, protobuf, sql | **absent from the ledger** → S1 fail → IDE cap I0 |
| sass | **absent from the ledger** (and the S5 leg failed anyway) |

So the verified S5 legs for tsx, json, graphql, protobuf and sql are not yet
usable for an I1+ claim: `computeCap` returns I0 when S1 fails. That gap is an
M14 ledger entry, not a wave-leg defect.

## What the Lead must integrate

1. **Re-run the 13 legs after the commit that lands these packs.** A leg is
   fresh only while `git diff <leg.commit> HEAD -- <its inputs>` is empty
   (`script/m29/verify-wave-execution.ts:151-160`), and the inputs include
   `script/m29/wave-fixtures/<lang>` plus the shared LSP/server sources
   (`staleRelevantPaths`, `script/m29/wave-execute.ts:235-246`). The packs and
   the integration edits are currently untracked/uncommitted, so the commit
   advances HEAD and stales every leg sealed at `fced0a14`. Correct sequence:
   commit code+fixtures, then `npx tsx script/m29/wave-execute.ts --languages
   tsx,html,css,scss,sass,json,yaml,toml,markdown,xml,graphql,protobuf,sql`,
   then commit the sealed records.
2. **sass decision.** `wave-sass.json` is sealed `failed`; the R2 verifier checks
   `R2: sass S5 status verified` for every approved language. Either remove
   `sass` from `wave-3-approval.json`, `LAUNCH_LANGUAGES` and the `.sass` path
   map for this wave, or keep it and record the failed leg as a declared
   blocker (wave-protocol will cap it at I1, R2 will be red). Fixing it needs a
   Sass parser: vendor a tree-sitter-sass grammar + analyzer and route `.sass`
   to it.
3. **S1 ledger entries.** Add `tsx`, `json`, `graphql`, `protobuf`, `sql` (and
   `sass` if kept) to the #419 SPEC ledger, or accept the I0 cap. This is the
   one item that blocks a real cap above I0 for five verified languages.
4. **Call-hierarchy scoping (shared with lane C).** `prepareCallHierarchy` in
   `src/lsp/call_hierarchy.ts` should return a declared absence for non-callable
   symbol kinds; then make the S5 `L5` check language/kind-aware, or mark the
   feature absent for the 11 formats in the launch record. Until then the
   verified legs prove hover/definition/references/documentSymbols/workspace
   symbols, not call hierarchy, for those formats.
5. **S6 (I3) is not produced by this lane.** No `wave-editor-<lang>.json` exists
   for these 13. The S5 records above can support I2 (once S1 is satisfied); I3
   needs the in-editor leg the Lead / editor lane owns.
6. **S2/S3 and the wave-protocol runner were not run by this lane** — they spawn
   the expensive gates; no claim about them is made here.
7. **Freshness relevance for aliased analyzers** (state as of wave-3 execution):
   `staleRelevantPaths("tsx")` / `("sass")` then named
   `src/ast/real-tsx-analyzer.ts` / `src/ast/real-sass-analyzer.ts`, which do not
   exist — tsx is served by `real-typescript-analyzer.ts`, sass by
   `real-css-analyzer.ts` — so a change to the real analyzer would not stale
   those legs. **Lane B has since closed this in the executor** with
   `LANGUAGE_ANALYZER_INPUTS` (`script/m29/wave-execute.ts:257-269`); the
   relevance gate has not caught up (see the follow-up below).
8. **No fixture edits are needed for the 12 verified languages** — their launch
   set entries can stay as the Lead added them.

## Files created

- `script/m29/wave-fixtures/{tsx,html,css,scss,sass,json,yaml,toml,markdown,xml,graphql,protobuf,sql}/main.<ext>`
  and `expectations.json` (13 packs, 26 files).
- `validation/m29/results/wave-<lang>.json` for all 13 languages (sealed S5
  records; 12 `verified`, `sass` `failed`).
- `docs/analyzers/wave-lane-a.md` (this report).

No shared file was edited by this lane; `script/m29/wave-protocol.ts`,
`src/lsp/launch_languages.ts`, the approval records and other lanes' packs were
left untouched.

# Follow-up — the precision ledger tells the truth about all 52 approved languages

Follow-up request: `docs/m29/PRECISION-LEDGER.md` had six rows while 52
languages were owner-approved (waves 1-3) and 49 S5 legs were verified. The
generator read a single hardcoded record (`wave-1-approval.json`); a reader saw
less than the evidence.

## Generator change (only file hand-edited: `script/m29/generate-precision-ledger.ts`)

- **`approvedLanguages()` now aggregates every sealed approval record.** It
  reads every `validation/m29/results/wave-\d+-approval.json`
  (`readdirSync(...).filter(...).sort()`, the same pattern as
  `script/m29/wave-execute.ts`), parses each with `parseSealedRecord`, unions
  the languages, de-duplicates (first admitting wave wins), and orders rows by
  **wave then language name**. New exports: `approvalRecords()`,
  `approvedLanguages()`; the hardcoded `APPROVAL` constant is gone.
- **Every approved language gets a row, and a language with no S5 leg reads
  I0, never a crash.** The missing-evidence path now runs the same binding
  (`computeCap`) over declared steps: S1 from the SPEC ledger, S2/S3 from P1/P2,
  S4/S5 failed with a declared absence, S6 blocked/failed. No row is omitted.
- **The authority is in the hash.** All approval records joined the declared
  inputs (111 inputs now, up from 17), so an approval change stales the ledger
  instead of leaving the old row set published. `approvalWaves` records
  wave/record/language-count in the JSON.
- **Wave column.** MD/JSON rows carry `wave` (the record that admitted the
  language); the MD column order is `language | claim | wave | …` so the
  existing D3 claim-match regex (`| <lang> | <I-level> |`) still works.
- **Fixed the S6 evidence rendering.** Previously an EXISTING
  `wave-editor-<lang>.json` rendered as "S6 absent (declared)" (the renderer
  tested `.present`, which a present record does not carry) — the old ledger
  said S6 was absent for all six wave-1 languages that actually have editor
  legs. Present records now render `(status verified)`; declared-absent legs
  render "absent" and carry NO path (naming a non-existent path would fail the
  docs gate D4 on a truthful absence).
- **Limitations rewritten for the real row set**: the stale "wave-1 covers the
  six languages" sentence is replaced by the wave-union authority, the
  no-leg⇒I0 rule, and the S1-ledger-gap rule.

`git diff --numstat` (hand-edited files): generator **+168/−49**, ledger MD
**+112/−16**, this report **+158/−7**. The JSON ledger and the three gate
evidence records are machine outputs, not hand edits.

**No-leg path exercised, not just reasoned about.** An isolated copy of the
generator (in a temp tree, against a fake `wave-9-approval.json` naming `alpha`
and with no `wave-alpha.json`) produced exactly one row: `claim I0`,
`evidence.s5 {present:false}`, all feature flags false, the declared limitation
— no crash. The real tree has a leg for all 52 approved languages today, so the
path is not reachable from the committed evidence; it is there for the next
approval wave.

## Row count and claim distribution

| | before | after |
|---|---|---|
| ledger rows | 6 (wave 1 only) | **52** (waves 1-3) |
| declared inputs | 17 | 111 |
| inputs hash | `500f4633…` | `4ad2777e…` |
| claim distribution | I3 × 6 | **I3 × 14, I2 × 22, I1 × 1, I0 × 15** |

Per wave: wave 1 = 6 × I3; wave 2 = 8 × I3; wave 3 = 22 × I2, 1 × I1 (make),
15 × I0. The I0s are honest: 15 approved languages (tsx, sass, json, graphql,
protobuf, sql, lua, r, powershell, nim, vb, vba, matlab, clean, terraform) are
absent from the committed #419 SPEC ledger, so S1 fails and `computeCap` caps
them at I0 even where the S5 leg is verified; `sass` and `matlab` also have
failed S5 legs (recorded). The 22 I2s are verified S5 legs whose in-editor S6
leg has not been recorded yet (only 14 `wave-editor-*.json` exist). No claim was
raised anywhere; 52/52 claims equal a fresh `computeCap` replay over the
recorded evidence (gate G3).

## Exact gate results (run, not inferred)

> **Superseded for gate status by Follow-up 2 below**, which fixes these three
> gate assumptions; the recorded failures here are the state BEFORE those fixes.

1. **`npx tsx script/m29/verify-precision-ledger.ts` → exit 1, KNOWN-GAP
   (17/19 passed, 5/5 negatives caught).** Everything the ledger controls
   passes — G1 byte-identical regeneration for both artifacts, G2 inputs hash +
   volatile-field fixpoint, G3 claim honesty 52/52, G4 giant row, and all five
   mutants (hand-edited claim, hand-edited number, stale hash, bogus path). The
   two failures are the gate's own stale assumptions, NOT weakened:

   ```
   FAIL: G3: ledger covers exactly the owner-approved wave set — 52
   FAIL: G4: every evidence path named by the ledger exists on disk — 104 paths
   ```

   - `script/m29/verify-precision-ledger.ts:178` hardcodes
     `recorded.languages.length === 6` (the wave-1 row count). Fix (Lead owns
     that file): compare against the union of the sealed approval records
     instead of a literal — an equality against the authority, not a relaxed
     bound.
   - `:209-211` requires **every** `row.evidence.s5/s6.path` to exist, while
     `:157-160` dereferences `row.evidence.s6.path` unconditionally. The ledger
     must carry an `s6.path` string for the 38 approved languages with no
     recorded editor leg (otherwise G3 throws), and G4 then demands that path
     exists — the two checks cannot both hold for a truthfully absent leg
     (104 paths = 52 S5 + 52 S6 slots; 38 S6 files do not exist). Fix: treat
     `present:false` as a declared absence (skip it in G4's existence set; read
     `s5`/`s6` null-safely in G3, so a future no-leg language replays I0).
   - Latent, same lines: today all 52 languages have an S5 record, so G3 does
     not crash; the first approved language without a leg would make
     `path.join(ROOT, undefined)` throw instead of reading I0. The generator
     handles that case (above); the gate does not.

2. **`npx tsx script/m29/verify-m29-docs.ts` → exit 1, KNOWN-GAP (12/13
   passed, 3 negatives).** D1 byte-identical regeneration (both artifacts), D2
   vocabulary lint, D3 every published claim equals the machine ledger
   (52/52), D4 all 68 evidence paths named by the MD exist — all pass. One
   failure:

   ```
   ESCAPED: M3: a listing row claiming above the ledger is caught
   ```

   `script/m29/verify-m29-docs.ts:146-155` hardcodes the premise that "groovy
   has NO machine claim (not wave-onboarded)": now that the ledger aggregates
   wave 2, groovy has a machine claim (I3), so the mutant's
   `ledgerClaim === undefined` condition is dead and the mutant escapes. The
   escaped mutant also records **no detail** (`details: []` in `D1-verify.json`)
   because `negative()` was called without a detail string — a §8.3 silence
   beside a red gate. Fix: derive the mutant language from the ledger (e.g. a
   language whose claim is I0, or forge a claim ABOVE that row's claim) and
   pass a detail. The other D1 checks are dynamic (no 6/14 count); the README
   listing check covers the 7 fixed language names of the listing table and
   still passes.

3. **`npx tsx script/m29/verify-analyzer-relevance.ts` → exit 1, KNOWN-GAP
   (209/221).** The 12 failures are one defect and are NOT caused by the ledger
   change — they are a live-vs-copy drift introduced by lane B's
   `staleRelevantPaths` improvement. `script/m29/verify-analyzer-relevance.ts:60-62`
   hardcodes the wave-2 naming convention
   `src/ast/real-<language>-analyzer.ts`, while the LIVE `staleRelevantPaths`
   (`script/m29/wave-execute.ts:257-269`) resolves aliased analyzers through
   `LANGUAGE_ANALYZER_INPUTS`. Four aliased languages fail three checks each:

   ```
   tsx       → real-typescript-analyzer.ts
   sass      → real-css-analyzer.ts
   make      → real-makefile-analyzer.ts
   terraform → real-hcl-analyzer.ts
   ```

   Fix (Lead owns that file): read the same alias map the executor reads
   (export it from `wave-execute.ts`, derive the expected analyzer path from
   it), keeping the "no foreign analyzer" check relative to the mapped list. Do
   not revert lane B's map — it closes the aliased-analyzer freshness hole.

## Files touched by this follow-up

- `script/m29/generate-precision-ledger.ts` (hand-edited; the only source change)
- `docs/m29/PRECISION-LEDGER.md` (regenerated, 6 → 52 rows)
- `validation/m29/results/PRECISION-LEDGER.json` (generated output)
- `validation/m29/results/R4.json`, `R4-verify.json`, `D1-verify.json`,
  `analyzer-relevance.json` (machine-emitted evidence of the three gate runs;
  the last three now record `known-gap` with the exact failures above)
- `docs/analyzers/wave-lane-a.md` (this section)

Nothing was committed. `script/m29/wave-execute.ts` and
`src/lsp/call_hierarchy.ts` (lane B / lane C) were not touched.

# Follow-up 2 — the three gate-assumption fixes (before → after)

Request: make the gates agree with the 52-row world, never by weakening a
check. Fixes applied in the requested order; every number below is a run.

## 1. `script/m29/verify-precision-ledger.ts`

- **Row-set count derived, never hardcoded.** The check now imports
  `approvedLanguages()` from the generator — the SAME aggregation that builds
  the published rows (every sealed `wave-\d+-approval.json`, de-duplicated) —
  and compares length + missing + extra + duplicate sets. The literal `6` is
  gone, so a wave-4 approval extends the ledger without touching the gate.
- **Declared-absence contract (generator + gate).** The generator now emits
  `{ declaredAbsent: true, reason }` for a leg that does not exist yet
  (`S5` on a newly approved language, `S6` for the 38 languages with no
  in-editor leg) instead of a path that merely fails to resolve. G3 reads that
  shape only when the reason is stated AND the record really is absent; a
  present-but-missing path is a **problem**, not an absence. G4 skips
  declared-absent slots (they name no path) and still fails on a
  present-but-missing path. Two new canaries prove both failure modes through
  the same code: a declared absence that hides an existing record is CAUGHT,
  and a present-but-missing path is CAUGHT (not read as declared absence).
- **Latent crash fixed.** The old G3 did `path.join(ROOT, undefined)` for a row
  with no leg. Slots are now inspected and problems collected, so a future
  approved language without a leg replays **I0** instead of throwing.
- The `negatives` count is now `mutants.total` (was the stale literal 5).

| run | state | result |
|---|---|---|
| before | 52-row ledger, old gate | exit 1 — **KNOWN-GAP 17/19**, 2 failures: `G3: ledger covers exactly… — 52`, `G4: every evidence path… — 104 paths` |
| after | 52-row ledger, fixed gate | exit 0 — **VERIFIED 22/22**, 8/8 negatives; `G3 count — ledger=52 approved=52`; `G4 — 66 named paths, 38 declared-absent slots` |

## 2. `script/m29/verify-m29-docs.ts`

- **M3 re-purposed to a premise that is true of today's data.** The old mutant
  asserted "groovy has NO machine claim (not wave-onboarded)" — dead once wave 2
  gave groovy a row (I3), so it escaped. The mutant now derives its needle from
  the ledger: it takes the first row whose claim is the LOWEST published (an I0
  row — `clean` today), reads its real published MD row, mutates the claim
  upward to I2 in-memory, and re-runs the same D3 extraction the claim-match
  check uses — the mutation must be detected. It records a detail on escape
  (§8.3), and it returns false (gate red) if no I0 row exists, so the mutant
  cannot quietly stop testing.

| run | state | result |
|---|---|---|
| before | 52-row ledger | exit 1 — **KNOWN-GAP 12/13**, `ESCAPED: M3` (no detail recorded) |
| after | 52-row ledger | exit 0 — **VERIFIED 13/13**, 3/3 negatives; `CAUGHT: M3 … mutated clean's published claim I0 -> I2 (row derived from the ledger, not hardcoded)` |

## 3. `script/m29/verify-analyzer-relevance.ts`

- **Where the mapping comes from (a declared substitution).** The requested
  single source was `LANGUAGE_ANALYZER_INPUTS` in `wave-execute.ts` — but it is
  a private `const` (line 324, not exported) and that file belongs to another
  lane this round. The gate therefore reads the **authority that map mirrors**
  instead of copying either: it parses `src/ast/engine.ts` `getAnalyzer`'s
  switch and binds grouped `case` labels to their shared lazy import (that is
  literally the alias relation: `typescript`+`tsx` → one analyzer). Registry ids
  are resolved to engine ids through the extension the registry itself declares
  (`objc` + `.m` → detector's `objective-c`), with the direct id tried first —
  required because `matlab` also declares `.m`. No alias table is duplicated;
  the derived `engineAnalyzerRoutes` map is published in the evidence.
  Negative ability is kept by four mutants through the SAME pure rule: a
  directory-wide pack, a foreign analyzer, a missing own analyzer, and a wrong
  analyzer on an ALIASED language are all CAUGHT. If the Lead prefers the
  import, exporting the map is a one-line change in wave-execute and this gate
  can switch to it.
- **Result: 12 failures → 0 for the four aliased languages** (tsx/sass/make/
  terraform now accepted, with a positive control per language). **3 remaining
  checks are a REAL latent defect the old naming masquerade hid, not a gate
  assumption:**

  ```
  R1: objc — the list names the engine-routed analyzer — src/ast/real-objective-c-analyzer.ts
  R1: objc — no foreign pack or analyzer in the list — src/ast/real-objc-analyzer.ts
  R1: objc — the pure rule accepts the live list — …does not name src/ast/real-objective-c-analyzer.ts; foreign analyzer(s): src/ast/real-objc-analyzer.ts
  ```

  `staleRelevantPaths("objc")` falls back to `src/ast/real-objc-analyzer.ts`,
  which does not exist; the engine routes `.m` to `real-objective-c-analyzer.ts`.
  `objc` has no fixture pack and is in no approval record, so no wave leg is
  affected today, and the one-line fix belongs to the executor owner
  (`LANGUAGE_ANALYZER_INPUTS: objc -> src/ast/real-objective-c-analyzer.ts`) or
  to renaming the registry entry. Reported in the evidence's limitations rather
  than hidden.

| run | state | result |
|---|---|---|
| before | pre-fix | exit 1 — **KNOWN-GAP 209/221**, 12 failures (tsx/sass/make/terraform × 3) |
| after | this fix | exit 1 — **KNOWN-GAP 281/284**, 3 failures, all the `objc` list defect above |

## Higher gates

- **`npx tsx script/m29/verify-m29-docs.ts`** (the doc gate) — exit 0,
  VERIFIED 13/13 (above).
- **`npx tsx script/m29/verify-governance.ts`** (the M29 lane governance gate)
  — exit 1, **KNOWN-GAP 73/75**, 2 failures, neither caused by these changes:
  `G1: M28 bar — M28 governance gate exits 0 at HEAD (spawned) — exit=1` (M28's
  own gate is red at this HEAD) and `G1: every non-planned ledger item has
  matching persisted evidence at the current commit — R2:stale-commit,
  V1:stale-commit` (R2/V1 evidence predate HEAD while lanes B/C edit their
  inputs). Governance did heal the lane ledger's R4 entry from the new run
  record (`ledger=19 derived=22`, `negativeCases 5→8`, `mutants 6→8`) and
  projected the G1 entry; its spawned M24–M28 bars refreshed their own evidence
  outputs as a side effect of running it.
- **`npx tsx script/m29/verify-closure.ts` was NOT run**: it executes the whole
  M24–M29 ladder (R2 drives 52 in-editor Neovim legs, V1 up to 30 min) and
  rewrites the evidence lanes B/C are actively editing; a mid-flight run would
  be noise, not a verdict. What matters for it is covered: closure re-runs the
  R4 and D1 legs (both green now) and its pass 1b regenerates the precision
  ledger over refreshed inputs by design, so the ledger fixpoint it asserts is
  maintained; the R2/V1 staleness above is exactly what the Lead's closing
  ladder run refreshes.

## Files touched by follow-up 2

- `script/m29/verify-precision-ledger.ts`, `script/m29/verify-m29-docs.ts`,
  `script/m29/verify-analyzer-relevance.ts`, `script/m29/generate-precision-ledger.ts`
- `docs/m29/PRECISION-LEDGER.md` (regenerated: declared-absence shape)
- `validation/m29/results/PRECISION-LEDGER.json`, `R4.json`, `R4-verify.json`,
  `D1-verify.json`, `analyzer-relevance.json` (machine outputs of the runs)
- lane-governance machine outputs refreshed by the governance run (its own
  evidence + lane ledger + the M24–M28 bars it spawns) — declared, not hand
  edits
- `docs/analyzers/wave-lane-a.md` (this section)

Nothing committed. `script/m29/wave-execute.ts`, `src/lsp/call_hierarchy.ts`
and `script/m29/verify-wave-execution.ts` were not touched. One concurrent-lane
note: `script/m29/wave-protocol.ts` changed at 18:52 while this work ran (a
ledger input), so the ledger was regenerated after it as the gate requires.


