# real-svelte-analyzer.md

## Language

- Analyzer file: `src/ast/real-svelte-analyzer.ts`
- Parser: `tree-sitter-svelte` (SFC pass over the `.svelte` file) + the real
  JavaScript analyzer (`RealJavaScriptAnalyzer`) for `<script>` content —
  **always JS**, whether or not `lang="ts"` is set (family-consistent
  scoping, mirrors the M12.12 Vue decision; verified the JS analyzer handles
  Svelte script patterns — `$props()` destructure, `$state`, `$derived`,
  `export let` — with `rootHasError: false`)
- Script pre-parse wiring: `engine.ts` parses each `<script>` block content
  (exact `raw_text` byte offsets from the SFC tree, pure AST — no regex
  extraction; multiple blocks supported: instance + `context="module"`) and
  passes the trees via `AnalyzeContext` generic SFC keys
  (`sfcScriptTrees`/`sfcScriptLines`/`sfcScriptCols`, shared with Vue); the
  analyzer never touches `embeddedScriptContent` (avoids the engine's
  polyglot-injection path double-counting symbols)
- Language detection: `.svelte` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealSvelteAnalyzer`

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | SFC component → file stem → class; script top-level `variable_declarator` → name identifier (const → Constant, let/var → Variable), `function_declaration` → name; `export let`/`export function` → same, owned by the component (public API) |
| kind | ✅ | component → Class; const → Constant; let/var → Variable; function → Function |
| qualified/container name | ✅ | `ownerName` = component name for exported symbols (`export let`/`export function`); non-exported script top-levels are module-scope (owner empty, mirrors JS family) |
| range (start/end line + column) | ✅ | script-content nodes offset to SFC line numbers via the script block's start position |
| parameters | ✅ | from the JS analyzer (recorded, never symbols) |
| returnType / type | — | Svelte SFCs are not type-analyzed (script always parsed as JS — documented decision above) |
| documentation/comments | ✅ | via the JS analyzer (JSDoc / `//` comments on script symbols) |
| complexity metrics | ✅ | via the JS analyzer |
| syntax errors | ✅ | ERROR/missing nodes surfaced; `parseErrors` counted in the differential |
| decorators/attributes | — | n/a |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ | script calls via JS analyzer leaf identities; `on:` event directives → call to the handler leaf (`on:click={inc}` → `inc`; `on:click={() => bump()}` → `bump`; `on:greet={greet}` → `greet`); `$emit`-style `$`-prefixed targets are legal (pool-worker `$` denylist removed in M12.12) | 0.85 (on:) / 0.9 (script) |
| instantiates | ✅ | template pass: every non-builtin element tag → leaf tag name as written (`<Button />` → Button); builtin HTML tags (div/button/p/…) and Svelte builtins (svelte:component/svelte:element/svelte:self/svelte:window/svelte:head/…) filtered | 0.95 |
| extends | — | Svelte has no class heritage in SFCs (inheritance is composition) | — |
| imports | ✅ | script `import` directives → `${modulePath}:${item}` (`svelte/store:derived`, `./Card.svelte:Card`) | 1.0 |
| exports | ✅ | `export let`/`export function` → component public API (`exports`), mirroring Vue props | 1.0 |
| overrides | — | n/a for SFCs | — |
| contains | ✅ | exported symbols owned by the component (from `ownerName`); template component usages contained by the component | 1.0 |
| uses | — | not emitted for property access (family contract) | — |
| references | — | covered by imports/calls leaf identities | — |
| depends | — | not emitted (covered by imports) | — |

## Supported constructs

- SFC decomposition: `<template>` + `<script>` + `<style>` blocks located via
  the tree-sitter-svelte `element`/`script_element`/`style_element` tree;
  template pass and script pass are independent, no source-text scanning
- `<script>` (JS + TS, instance + `context="module"`): imports, top-level
  const/let/var, function declarations, `export let` props — `Button.svelte`,
  `UserList.svelte`, `App.svelte`, `Negative.svelte`
- Runes (`$state`, `$derived`, `$props()`, `$effect`, …) are compiler
  keywords — never symbols; destructured `$props()` locals are params, not
  symbols (JS family contract)
- Template components: non-builtin element tags → instantiates (leaf tag as
  written) — `App.svelte` (`<Button/>`, `<Card/>`)
- Events: `on:` directives → calls to the handler leaf — `Button.svelte`
  (`on:click`), `App.svelte` (`on:greet`), `UserList.svelte` (`on:select`)
- Negative fixtures: `bind:`/`class:`/`transition:`/`use:` directives never
  emit; `on:input={(e) => e.target.value}` (arrow with param + property
  access, no call target, no bare identifier) emits nothing; template
  expressions (`{count}`, `{#each}` bodies) are not symbols or calls;
  builtin HTML tags never instantiate; locals/params (`e`, `local`,
  `stateVal`) never become symbols — `Negative.svelte`
- Legacy props: `export let query = ''` → component public API (exports +
  contains) — `UserList.svelte`

## Unsupported / explicit-unknown constructs

- `lang="ts"` scripts are parsed with the **JS** analyzer, not the TS one —
  deliberate family-consistency decision (mirrors Vue M12.12). Type
  annotations are ignored, not synthesized.
- Svelte 5.2+ template syntax that the tree-sitter grammar cannot express is
  handled by documented fallbacks where the construct is reachable
  (`on:` handler leaf extracted with pure-String scanning of the opaque
  `svelte_raw_text`/`raw_text_expr` leaf — the grammar exposes template
  expressions as an opaque leaf, so no AST structure exists to walk; this is
  the documented regex-free fallback for grammar-opaque constructs).
- `{#snippet}`, `{@render}`, `{#each}` blocks do not emit symbols — snippets
  are template-local fragments, each-blocks are iteration statements (family
  contract; no locals from block scopes).
- Slotted/dynamic `<svelte:component this={...}>` targets are not resolved
  (dynamic target, family contract).

## Regex inventory

From `validation/m12/results/regex-census.json`: the Svelte analyzer has **0
regex usages** (2 in the legacy analyzer eliminated; census 123 → 121). The
engine's SFC script pre-parse uses byte-offset `raw_text` slicing, not the
polyglot regex path. The `on:` handler leaf extraction uses pure-String
scanning (`isIdentifier`, char-class loops) — never regex.

## Complexity envelope

From `validation/m12/results/svelte-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 5 | 29 | 35 | 481.2 | 60 | 73 | 204.2 MB |
| corpus_subset | 396 | 913 | 655 | 2,292.3 | 398 | 286 | 271.2 MB |

Declared budgets: fixtures < 2 s (met: 0.48 s); 400-file corpus < 60 s
(met: 2.3 s).

Hot-path audit: SFC tree walked once (explicit stack, `script_element`/
`style_element` subtrees skipped); script subtrees delegated to the JS
analyzer (single iterative traversal, scope per-frame snapshots); template
instantiates resolved with O(1) builtin-tag set lookups; `on:` handler leaf
extraction is a single linear scan of the small expression text; containment
from `ownerName` in one pass. No O(n²) or per-symbol O(n) scans.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/svelte.json`
  (authority: `manual_audit` — every fact verified against fixture source and
  the TS/JS family contract; 63 facts)
- Result: `validation/m12/results/svelte-differential.json`
- Precision 1.000 / recall 1.000 / FP 0 / FN 0 / unknown 0, `passed: true`,
  `earliestFailingLayer: none`, `parseErrors: 0`

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` →
  `svelte@26786e92` (clean; the svelte repo's own `.svelte` test suite —
  4,462 files across runtime-legacy/runtime-runes/parser-modern/validator/
  snapshot/print/… categories, the canonical Svelte source corpus)
- Sample: 396 tracked `.svelte` files (deterministic stratified sample across
  20 test categories; sample file
  `validation/m12/results/svelte-corpus-sample.txt`, reproducible from
  `git ls-files`; 4 deliberately-broken `loose-invalid-*`/`loose-unclosed-*`
  parser error-recovery fixtures excluded — they are invalid by design, not
  corpus source)
- Symbols 913 / relationships 655 / wall 2.3 s / **0 crashes / 0 timeouts**
  — fresh parser per file, mirrors production pipeline (scan script
  `script/m12/svelte-corpus-errors.ts`)
- **Grammar upgrade (like M12.11 Dart):** the previously pinned npm
  `tree-sitter-svelte` wasm (2023) errored on 30/400 (7.5%) — it predates
  Svelte 5 snippets and `{@render}`. Rebuilt from the maintained
  `tree-sitter-grammars/tree-sitter-svelte` fork (2025-06, Svelte 5):
  **12/396 (3.0%)** residual error files, all using Svelte 5.2+ syntax that
  **no tree-sitter grammar supports** — `{@attach}` attachments, generic
  snippets (`{#snippet generic<T>}`), `{#each}` shorthand without `as`,
  comments inside tags, self-closing `<script/>`, `{@const}` division.
  Verified identical gaps on the newer `PRRPCHT/tree-sitter-svelte-next`
  fork (2026-02): same 16 files, same 82 error nodes — the maintained fork
  is the best available grammar. Recorded honestly as
  `grammarErrorFiles: 12` in the manifest (precedent: kotlin 51, fsharp 108,
  typescript 5 — nonzero counts are recorded with root-cause notes, never
  hidden). The old 30/400 measurement was discarded, not recorded.
- Fixture shapes re-verified against the new grammar before commit: attribute
  expression value moved from `expr_attribute_value > raw_text_expr` to
  `expression > svelte_raw_text` (handled in `onHandlerLeaf`); snippet/
  render/each block shapes probed and confirmed compatible.

## Evidence pointers

- Fixtures: `validation/m12/fixtures/svelte/`
- Ground truth: `validation/m12/ground-truth/svelte.json`
- Differential: `validation/m12/results/svelte-differential.json`
- Complexity: `validation/m12/results/svelte-complexity.json`
- Corpus sample: `validation/m12/results/svelte-corpus-sample.txt`
- Regex census: `validation/m12/results/regex-census.json` (0 for this analyzer)
- Docs: this file

## Issue

Closes M12.13 (GitHub issue #152).
