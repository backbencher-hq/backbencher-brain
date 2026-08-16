# real-html-analyzer.md

## Language

- Analyzer file: `src/ast/real-html-analyzer.ts`
- Parser: `tree-sitter-html` (`document` → `element`/`script_element`/
  `style_element` tree; `start_tag`/`self_closing_tag` → `tag_name` +
  `attribute`; `quoted_attribute_value` → `attribute_value`)
- Language detection: `.html` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealHtmlAnalyzer`
- Pure AST — no source-text scanning. The only string processing is on
  attribute values already extracted from AST nodes (pure-String helpers,
  no regex).

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | an element becomes a symbol iff it carries an explicit `id` or `class` attribute — named by the `id`, else the `class` value (the M11.12 contract, still 1.000/1.000) |
| kind | ✅ | always `class` (an HTML element with identity is a component-like declaration) |
| qualified/container name | ✅ | `ownerName` = nearest significant ancestor's symbol name (elements nested under anonymous structural tags chain to the closest id/class element) |
| range (start/end line + column) | ✅ | `start_tag` through `end_tag` of the element node |
| parameters | — | n/a (elements are not callables) |
| returnType / type | — | n/a |
| documentation/comments | — | n/a (HTML has no doc comments) |
| complexity metrics | ✅ | per-element metadata: tagName, attributes, isSemantic/isInteractive/isForm, isId/isClass |
| syntax errors | ✅ | ERROR/missing nodes surfaced as warnings; counted in `parseErrors` |
| decorators/attributes | ✅ | all element attributes in `metadata.attributes` (id, class, href, src, aria-*, data-*, framework directives…) |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| contains | ✅ | DOM hierarchy between symbols: nearest significant ancestor → element (single DFS pass; anonymous tags pass their parent's identity through so chains skip noise) | 1.0 |
| uses | ✅ | external resource references: `script src`, `link href`, `img src`, `img srcset` candidates, `audio`/`video src`, `source src` (in picture/audio/video), external `a href` navigation; internal `#anchor` and `label for=` resolved via the id→symbol map (deferred, O(1) lookup) | 1.0 |
| calls | ✅ | `form action` (submission target) | 1.0 |
| imports | ✅ | resource modules mirror the uses: script/link/img/srcset/media/form-action (kept as imports for the pool, matching M11) | 1.0 |
| exports | — | empty — HTML has no export keyword (M12 fix: the legacy analyzer exported every symbol because `metadata.isClass` was never set) | — |
| extends / overrides | — | n/a (no class heritage in HTML) | — |
| references / depends | — | covered by uses/imports | — |

## Supported constructs

- Elements with `id` or `class` → class symbols (`Page.html`: site-header,
  content, order-list, orders-table, sidebar, search-form, query, promo,
  page-footer)
- DOM containment via nearest significant ancestor (`content contains
  order-list`, `order-list contains orders-table`, `search-form contains
  query`)
- Resources: stylesheet link, favicon link, external script, img + srcset
  candidates (480w/1080w → two uses), video src, audio src, picture source
  src, external anchor — all `uses` with module source for head-level
  resources
- Forms: `form action` → calls; `label for=` → uses (resolved to element id)
- Internal anchors: `href="#content"` → uses resolved to the element
- Negative fixture (`Negative.html`): anonymous structural tags (`div`/`span`/
  `ul`/`li`/`tr`/`th`) are NOT symbols; `javascript:` and empty `#` anchors
  emit nothing; empty `src=""` emits nothing; duplicate ids yield one symbol
  per element (honest); `label for`/anchor to a missing id emit nothing
  (unresolved); `a href="#dup-target"` resolves once

## Unsupported / explicit-unknown constructs

- Anonymous structural elements (`<div>`, `<head>`, `<body>`, `<span>`,
  `<ul>`, `<li>`, `<tr>`, `<th>`, `<p>`, …) are intentionally not symbols —
  the M11.12 contract (documented; only id/class elements carry identity).
- Class tokens are not individual symbols — the class attribute names the
  element symbol itself.
- `<template>` contents: shadow-DOM template fragments are not decomposed
  (the template element with an id/class is a symbol, its anonymous children
  follow the same rules).
- `srcset` on `<source>` (picture) is not extracted — only `img srcset`
  candidates are (the M11 resource contract; `<source src>` IS handled).
- Dynamic resources (`src={{expr}}`) are not resolved — attribute values are
  taken verbatim as written.

## Regex inventory

From `validation/m12/results/regex-census.json`: the HTML analyzer has **0
regex usages** (2 in the previous analyzer eliminated; census 121 → 119).
The srcset candidate split is a pure-String `firstToken` whitespace scan; the
quote-strip is gone entirely because the grammar's `attribute_value` node
text is already unquoted (empty values fall back to a pure-String `unquote`
of the quoted text).

## Complexity envelope

From `validation/m12/results/html-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 2 | 11 | 23 | 174.0 | 63 | 132 | 190.8 MB |
| corpus_subset | 230 | 251 | 41 | 344.9 | 728 | 119 | 234.6 MB |

Declared budgets: fixtures < 2 s (met: 0.17 s); 230-file corpus < 60 s
(met: 0.34 s).

Hot-path audit: single-pass DFS stack (no child-array mapping); id→symbol
resolution is an O(1) map built in the same pass; deferred link resolution is
O(L) over labels/anchors; attribute extraction iterates each element's direct
`start_tag` children once. No O(n²) or per-symbol O(n) scans.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/html.json`
  (authority: `manual_audit` — every fact verified against fixture source and
  the M11 HTML contract; 33 facts)
- Result: `validation/m12/results/html-differential.json`
- Precision 1.000 / recall 1.000 / FP 0 / FN 0 / unknown 0, `passed: true`,
  `earliestFailingLayer: none`, `parseErrors: 0`

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `svelte@26786e92`
  (clean; the svelte repo's 246 tracked `.html` files — real HTML: SSR/
  hydration test expected outputs, CSS-test fragments, playground page)
- Sample: 238 tracked `.html` files (deterministic all-tracked sorted; sample
  file `validation/m12/results/html-corpus-sample.txt`, reproducible from
  `git ls-files`). 8 deliberately-malformed XSS/escape/invalid-nesting test
  outputs excluded (`boundary-error-html-comment-*-escape`, `raw-mustaches`,
  `option-body-escaped`, `contenteditable-bindings-escaped`,
  `invalid-nested-svelte-element`, `head-meta-hydrate-duplicate`,
  `raw-repair`) — they contain literal `<script>alert('pwnd')</script>`
  injection and invalid nesting by design (negative fixtures, not corpus
  source; same category as the svelte `loose-*` exclusions)
- Symbols 251 / relationships 41 / wall 0.34 s / **0 crashes / 0 timeouts /
  0 error files** — clean corpus validation (fresh parser per file, mirrors
  production pipeline; scan script `script/m12/html-corpus-errors.ts`)

## Evidence pointers

- Fixtures: `validation/m12/fixtures/html/`
- Ground truth: `validation/m12/ground-truth/html.json`
- Differential: `validation/m12/results/html-differential.json`
- Complexity: `validation/m12/results/html-complexity.json`
- Corpus sample: `validation/m12/results/html-corpus-sample.txt`
- Regex census: `validation/m12/results/regex-census.json` (0 for this analyzer)
- Docs: this file

## Issue

Closes M12.14 (GitHub issue #153).
