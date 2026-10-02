# Vue Analyzer

## What it extracts
- **Symbols**: the SFC component itself (Class symbol, `isVueComponent`/`isSfc`),
  Options-API component symbol (`name:` option identity), props (`isProp`),
  events (`isEmit`), data fields, methods, computed, watch handlers,
  lifecycle hooks — plus everything the script sub-analyzer (JS/TS) emits
- **Relationships**: instantiates (non-builtin template component usages),
  contains (component → members), template decision points (v-if/v-for) folded
  into complexity — plus script-side edges (imports, calls, uses, references,
  contains, exports, overrides) merged from the JS/TS sub-analyzer
- **Payloads**: complexity (script cyclomatic + template decision points)

## Architecture
- Every `<script>` block is parsed by the JS or TS sub-analyzer (per `lang`
  attribute) and merged, offset to SFC lines
- Options-API default-export objects are extracted into component-owned
  members (parity with class-based frameworks, #383)
- Template pass: every non-builtin element tag is a component usage →
  `instantiates` (leaf tag name as written)

## Evidence tiers
Central classifier at end of analyze(): every relationship carries
`metadata.evidenceClass`. Same rules as JVM family.

## Known limitations
- **`defineProps<Named>()` and `defineEmits(variable)` — the forms a real
  component library writes — emit no component-owned symbols.** Both now emit a
  `references` edge to the declaring name (`isPropContract` / `isEmitContract`,
  F12) rather than symbols, and the declaration's own members carry the list; a
  same-file binding still resolves to component-owned `Property`/`Event`
  symbols. Before F12 this was 132 of the 232 corpus files that declare a
  contract. The inline type-literal form (the one the original V1 gap was about,
  and the only one the fixture pinned) always worked.
- Style blocks are skipped entirely (CSS belongs to the dedicated css analyzer)
- `<svg:circle />` and a dotted `<Form.Input />` are handled imperfectly in
  component-usage detection (F9, open)
- `references` is audited only for the component-contract family (315 of 3,275
  rows on a 400-file element-plus draw); the other 2,960 are stored and compared
  against nothing. `contains` is audited for its delegated half (216 of 363); the
  147 component-owned rows are not. `uses` (2,225, of which 1,849 are the Vue
  analyzer's own template reads) and `imports` (2,789) are unaudited in full —
  `imports` and `exports` have no oracle anywhere in the instrument, so they are
  unaudited for want of truth rather than for want of scope. The M60
  rel-type-coverage gate reports all of it as debt.

**Not limitations any more** — the previous version of this file listed both of
these as "pending wave", and `vue-completeness.json` has had them `CLOSED` since
2026-08-27:
- ~~gap V1: the `defineProps<{...}>()` generic form emits no prop symbols~~ — CLOSED
- ~~gap V2: template expressions emit no references to script members~~ — CLOSED

## Verification
- Fixtures: **50** (`validation/m14/fixtures/vue/`), **53 mutants, 0 survivors**
- Store round-trip: `script/m60/verify-vue-store-roundtrip.ts` — the only gate in
  this lane that reads the STORE rather than the analyzer, and the only one that
  can catch information the analyzer produces correctly and the store then drops
  (F15). A store round-trip had never been run for this lane before it.
- Differential: 100% / MISSING=0 / unexplained=0 on element-plus at BOTH extents —
  **6,227 audited edges over all 829 files** and 1,571 over the canonical 200-file
  draw — and 891 edges over vue-element-admin's 131 files at both. **Sized to the
  audited labels**, which are `calls`, `extends`, `implements`, `instantiates`,
  `overrides`, the contract-marked `references` and the delegated `contains`.
  The full 829-file draw is the stronger evidence and is what the final review
  measured: three defects (F13, F14 and the `withDefaults` interaction) were
  invisible at 200 files.
- Zero-regex gate: `script/m60/verify-vue-no-regex.ts` — the analyzer holds **0**
  regex literals and the `v-for` replacement is re-proved against the patterns it
  replaced over 788 generated shapes on every run.
- Regex census: **0 rows** for this file, retired from
  `validation/m49/regex-debt-register.json` with a `closedByRemoval` record and
  from the census artifact with a `retired` record.
