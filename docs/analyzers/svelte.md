# Svelte Analyzer

## What it extracts
- **Symbols**: the SFC component (Class symbol, `isSvelteComponent`/`isSfc`),
  Svelte props (`export let` → Property, `$props()` destructure → Property),
  reactive declarations (`$: target = expr` → Variable), snippets
  (`{#snippet name()}` → Method) — plus everything the script sub-analyzer
  (JS/TS) emits
- **Relationships**: instantiates (non-builtin template component usages),
  calls (`on:` event directives → handler leaf; `{@render name(...)}` →
  snippet), contains (component → members), template decision points
  (`{#if}/{:else if}/{#each}/{#await}/{#key}`) folded into complexity — plus
  script-side edges (imports, calls, uses, references, contains, exports,
  extends, overrides) merged from the JS/TS sub-analyzer
- **Payloads**: complexity (script cyclomatic + template decision blocks),
  comments/qualified_calls via the script sub-analyzer

## Architecture
- Every `<script>` block (module + instance) is parsed by the JS or TS
  sub-analyzer (per `lang` attribute) and merged, offset to SFC lines
- `export let`/exported bindings become component-owned Property symbols
  (module-block exports stay module API, not props)
- Template pass: non-builtin element tags → `instantiates` (leaf tag name as
  written); `on:` directives → `calls` to the handler leaf

## Evidence tiers
Central classifier at end of analyze(): every relationship carries
`metadata.evidenceClass`. Same rules as JVM/Vue family.

## Known limitations
- Template expressions (`{count}`, `label={label}`, `{#each items as item}`,
  `{#await promise}`, `{@html raw}`) emit no Uses/references to script
  members (gap S1 — pending wave)
- `let { a, b } = $props()` double-declares bindings — Property + the JS
  sub-analyzer's destructured Variable both survive (gap S2 — pending wave)
- Style blocks are skipped entirely (CSS belongs to the dedicated css analyzer)

## Verification
- Fixtures: 13+ (`validation/m14/fixtures/svelte/`)
