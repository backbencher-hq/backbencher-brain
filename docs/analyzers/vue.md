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
- Template expressions (`{{ count }}`, `@click`, `:label`, `v-model`) emit no
  Uses/references to script members (gap V2 — pending wave)
- `defineProps<{...}>()` / `defineEmits<{...}>()` generic type-literal forms
  emit no prop/event symbols (gap V1 — only the object/array form works)
- Style blocks are skipped entirely (CSS belongs to the dedicated css analyzer)

## Verification
- Fixtures: 8+ (`validation/m14/fixtures/vue/`)
