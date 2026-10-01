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
  written); `on:` directives → `calls` to the handler leaf; template
  expressions → member `Uses` with lexical shadow handling for each/await/
  snippet/`{@const}` bindings

## Evidence tiers
Central classifier at end of analyze(): every relationship carries
`metadata.evidenceClass`. Same rules as JVM/Vue family.

## Known limitations
- Template expressions are scanned from opaque `svelte_raw_text` because the
  maintained grammar does not expose a full expression AST; identifier-level
  semantics beyond the scanner's lexical model remain a declared limitation.
- Style blocks are skipped entirely (CSS belongs to the dedicated css analyzer).
- The SFC-level `typeParameters` and `apiContract` payloads are declared N/A;
  script-side TypeScript generics remain delegated to the TS analyzer.

## Closed hardening findings (#419)
- **S1**: template expressions now emit member `Uses` edges.
- **S2**: `$props()` destructured bindings are declared once.
- **S5**: each-loop and declaration-order-aware `{@const}` locals shadow
  same-named members without leaking false Uses; nested scopes are isolated.
- **S6**: repeated `$:` assignments and their sub-analyzer copies are
  deduplicated to one component-owned reactive symbol.

## Verification
- Fixtures: **18/18** (`validation/m14/fixtures/svelte/`)
- Focused S5/S6 mutation checks: both **CAUGHT**
- Full all-language fixture regression: **13 languages, zero fixture failures**
