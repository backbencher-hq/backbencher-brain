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

## 5. Pre-existing known gaps outside the launch evidence chain

These are later-phase or older lanes whose evidence the launch chain
(M24-M29, M42, M44, M53, M55) does not cite. `npm run verify:fast` runs their gates, so
they are named here with the measured reason and status:

- **M45 — Demo Media Truth: CLOSED.** It was known-gap because its capture manifest
  pinned a corpus index identity from bb 0.3.0 (31 relationships) that the analyzer
  edge-precision work moved to 30. Fixed, not waived: the index identity is now
  revalidated explicitly by `capture-harness.ts --revalidate-index "<reason>"`
  (reason/time/previous hash recorded in the manifest, the editor capture's own commit
  kept as a historical ancestor), the expected counts are read from the manifest instead
  of a constant, and the site-embed gate was ported from the deleted terminal hero to
  the shipped atlas hero. C1 53/53 · D1 46/46 · T1 19/19 · G1 50/50 · X1 29/29, ledger
  closed.
- **M61 — verifier machinery: UNFINISHED, and it blocks the last gate of
  `verify:fast`.** M62's closure requires the M61 bar, whose ledger is open with five
  red records. Measured defects (all in older lane scripts, not in the launch chain):
  `script/m24/verify-hover-latency.ts` writes `validation/m24/results/L6.json` as a bare
  write outside the sealing path, owns no lane record, is wired into no execution tier
  and dynamic-imports a lane module; `script/m24/verify-hover-docs.ts` runs checks but
  owns no record and is not declared a non-gate; `script/m28/verify-surface-parity.ts`
  reads an undeclared `BB_U2_FULL_SHAPE_MATRIX`; the published claims rows for
  `m25-issues` and `m44-x1` no longer match their ledgers; and three extinction mutants
  (tdz-dynamic-import, concurrent-clobber, on-demand-gate-rot) cannot be proven extinct
  while those records are red. Closing M61 is a bounded piece of work, not a launch
  blocker: it is verifier tooling, not product behaviour.
- **M13/M15/M16/M20/M40/M43/M48 — pre-lane raw evidence** is present in the private
  working tree but was not re-sealed in this workstream; no launch claim cites it.

## Not limitations, by design

- **Languages outside the launch set** answer every LSP request with a declared
  absence naming the launch set — they are indexed (53 registry languages) but not
  editor-verified, and the hover text says so rather than pretending.
- **Indexing is not claiming.** A language can be indexed without being editor-verified;
  the precision ledger (`docs/m29/PRECISION-LEDGER.md`) publishes the per-language claim
  and the evidence path behind it.
