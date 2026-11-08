# Known issues — 0.1.0

<!-- Author: Muhammad Ishaq Khan -->
<!-- Every entry states what is measured, what a user sees, and what would fix it.
     An entry is not an excuse: the product's rule is that a claim names its own
     limits, and the gates that would catch a regression are named where they
     exist. -->

This file lists the limitations the 0.1.0 release ships with. Each is measured, not
suspected; where a gate covers it, the gate is named.

## 1. TSX: a bare `&` in JSX text or a JSX attribute string is a parse error

**Measured.** Under the vendored `wasm/tree-sitter-tsx.wasm`
(tree-sitter-typescript 0.23.2), these are valid TSX that the grammar rejects:

```tsx
<div className="&">                     {/* ERROR at the `&` */}
<div className="[&_code]:text-[13px]">  {/* Tailwind arbitrary variant */}
<div>a & b</div>                        {/* bare ampersand in JSX text */}
```

Reproduced directly against the grammar (not through the analyzer): parsing
`export function A() { return <div className="&">x</div> }` yields an `ERROR` node, as
does the same `&` in JSX text.

**What a user sees.** The affected files are indexed with `has_syntax_errors = 1`, so
symbols inside those JSX subtrees are partially or fully absent, and `bb health`
reports them (it now names them — see §4). On our own site, two pages are affected:
`website/src/app/languages/page.tsx` and `website/src/app/privacy/page.tsx`.

**Why it is not fixed in this release.** It is an upstream grammar defect, not an
analyzer defect; several projects hit it and it is fixed in a grammar fork
(`fix(grammar): accept a lone '&' in JSX strings and text`). Fixing it here means
patching `tree-sitter-typescript`'s `tsx` grammar and rebuilding
`wasm/tree-sitter-tsx.wasm`, which needs the wasm build toolchain (emscripten or
docker) — neither is available in this checkout, so the fix belongs to the
`backbencher-grammars` repository's CI, which is why that repository exists.

**Impact is bounded and declared.** The index records the parse state per file
(`brain_file.has_syntax_errors` + `error_report`), health surfaces it, and no surface
claims the affected files parsed cleanly.

## 2. MATLAB: `.m` cannot be resolved from a path

`.m` is shared by MATLAB and Objective-C. The indexer resolves it by content sniffing
and stores the file as `matlab`, but the LSP's path→language resolver refuses to guess
an identity from an ambiguous extension, so every LSP surface returns a declared
absence for a `.m` file. Wave 3 records this as a sealed terminal disposition
(`validation/m29/results/wave-matlab-disposition.json`) and the language stays in the
launch set with claim I0 (UNVERIFIED).

**Fix.** Content-aware language resolution in the LSP (read the first lines and use the
same sniffer the indexer uses), which is a real change to path resolution, not a
mapping guess.

## 3. SASS: the indented syntax is not parsed

There is no `tree-sitter-sass` in the vendored grammar set; `.sass` routes to the CSS
analyzer, the indented syntax parses to ERROR, and the index publishes only the file
module (one symbol). Wave 3 records this as a sealed terminal disposition
(`validation/m29/results/wave-sass-disposition.json`), claim I0. `.scss` is unaffected
(it is valid CSS-superset syntax and verified).

**Fix.** Vendor a Sass grammar (or a `sass` dialect) in `backbencher-grammars`, then
run the same wave protocol.

## 4. Fixed in this release

- **`bb health` named the count of syntax-error files but not the files.** It now lists
  them (bounded to eight; the count is always the true count):

  ```
  warning: [SYNTAX_ERRORS] 3 indexed files have syntax errors: public/install.ps1,
           src/app/languages/page.tsx, src/app/privacy/page.tsx
  ```

## Not limitations, by design

- **Languages outside the launch set** answer every LSP request with a declared
  absence naming the launch set — they are indexed (53 registry languages) but not
  editor-verified, and the hover text says so rather than pretending.
- **Indexing is not claiming.** A language can be indexed without being editor-verified;
  the precision ledger (`docs/m29/PRECISION-LEDGER.md`) publishes the per-language claim
  and the evidence path behind it.
