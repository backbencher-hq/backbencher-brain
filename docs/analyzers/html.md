# html

> **Status: INVENTORY-DONE** on the M14 #419 ladder
> (`NOT-STARTED` → `INVENTORY-DONE` → `GAPS-CLOSED` → `CONFORMANT`).
> Section A is complete (19/19 named node types classified), B and D are carried
> by eight fixtures, E and F are measured but **unpinned**, and H has no html
> block in CC1 yet. `script/m14/completeness-inventory.ts --lang html` prints
> the live per-section verdict. **One open gap: `HTML-G1` (inline `<script>` /
> `<style>` bodies).** See "The one open gap" below.

## Language

| | |
|---|---|
| Analyzer | `src/ast/real-html-analyzer.ts` (`RealHtmlAnalyzer`) |
| Grammar | `wasm/tree-sitter-html.wasm` — upstream `tree-sitter/tree-sitter-html`, vendored at `grammars/tree-sitter-html` (Matrix 4 provenance, closes the per-wave `#864` item for this lane) |
| Detection | `.html` / `.htm` → `html` (`src/ast/language-detection.ts`) |
| Wired in | `src/ast/engine.ts` `getAnalyzer` |
| Family | **web** — the last web-family language to enter a gate |
| Tracking | #288 (`Analyzer html: reach L5 SCOPED-VERIFIED`) |

## Why this file exists

html carried an M12 corpus claim, a regex-census row and a passing grammar
audit, and **no fixture, no mutant, no differential oracle and no completeness
spec**. Every M14/M49/M60 cell read `n/a` — the gates could not ask the
question. That is how the defects below survived a green board: they were
measured, written down in prose, and gated by nothing.

## The rulings

### HTML-IDENTITY — an element is a symbol because it is ADDRESSABLE

`real-vue-analyzer.ts:13` and `real-svelte-analyzer.ts:14` both publish
*"Template elements/attributes/directives are NEVER symbols."* html **is** a
template language, so it inherits that rule — and adds the one construct an SFC
template does not have: a document-level address space.

- `id` is the document's unique handle (`getElementById`).
- `name`, when there is no `id`, is the form/anchor handle (`getElementsByName`)
  — and it is the target of `<label for>`.
- **`class` is a shared styling hook, never an identity.** N elements
  legitimately carry it, which is exactly why it cannot name one. It stays
  readable in `metadata.attributes`.
- The **document is the module symbol** (name = file stem, `kind: module`), so
  the containment tree has one root instead of N disconnected ones and a
  document-level resource edge sources from a real, joinable symbol.

**Measured on the pre-ruling analyzer, 139 real corpus documents:**

| | before | after |
|---|---|---|
| symbols | 3,061 | 1,453 |
| symbols with a **unique** name in their own file | 1,228 (40.1%) | **1,453 (100%)** |
| symbol names containing whitespace | 881 (28.8%) | **1** |
| files containing any duplicate name | 25/139 (18.0%) | **0/139** |

The one remaining whitespace name is real: `<a name="Harley Davidsson">` in
`otp/lib/xmerl/doc/assets/result_xs.html`, a legitimate named anchor. It is
attributed to `metadata.identityAttribute: "name"`, so a reader knows why.

### DUPLICATE-IDENTITY — first wins, then a deterministic suffix

A duplicate `id` is invalid HTML. The **first in document order** keeps the plain
name (that is what `getElementById` returns); later ones take a deterministic
`#N` suffix — the rust RSD3 answer to 2,852 same-name ids there — and carry
`metadata.duplicateId`. In-document references resolve to the first and carry
`metadata.ambiguousTarget` when a second exists. No two symbols ever share a
name.

### SCOPE BARRIERS — `<template>` and `<slot>`

Their content is an inert fragment / light-DOM fallback and is **not rendered
where it is written**, so it is not a child of what encloses it in the source. An
**addressable** barrier owns its own fragment; a **bare** one does not — its named
descendants belong to the nearest live ancestor, carrying
`metadata.inTemplateBarrier`. The pre-fix analyzer claimed
`template contains inner` for markup that never enters the document, and a
`<template id="x">` collided with its live-DOM twin as two identically-named
symbols.

### RESOURCE MODEL — a table, not a branch chain

`RESOURCE_RULES` is data, so it can be **enumerated** — by a reader, by the F6
dead-literal check, by the F8 census — and adding a carrier is one row. The
pre-fix analyzer was an `if/else if` chain over ten tag names, and a carrier
nobody thought of in that chain simply did not exist. **Eight produced nothing**,
each verified one document at a time:

| carrier | pre-fix |
|---|---|
| `<object data>` | no `object` branch at all |
| `<embed src>` | no `embed` branch at all |
| `<track src>` | no `track` branch — every video's captions invisible |
| `<input type=image src>` | `input` was read only through its form table |
| `<iframe src>` | the branch counted a missing `loading` and never read `src` |
| `<source srcset>` | only `src` was read |
| SVG `use`/`image` `href` + `xlink:href` | no `use`/`image`/`svg` string in the file |
| `<base href>` | no `base` branch — and it fetches nothing, so it is a **document metric**, not an edge |

`<source>`'s pre-fix gate also required the **immediate** parent to be
picture/audio/video, so one wrapper element lost the resource — and a `<picture>`
inside a grid cell is not a rarity.

### SCHEME CONTRACT — a hyperlink is not a code dependency

Absolute URLs, protocol-relative URLs and the `mailto:`/`tel:`/`javascript:`/
`data:` schemes produce **no edge** and are counted as `documentMetrics`. The
pre-fix analyzer emitted a `uses` edge for every one it did not filter, so a
page linking to fifty external sites published fifty graph edges that the
enrichment pass then scored for architectural criticality — measured at **237**
such edges across 51 real documents.

Its filter was a bare `startsWith("javascript:")`, so it was case-sensitive,
whitespace-sensitive, and present **only in the `<a>` branch**. Decoding now
runs **before** the scheme test, which is what catches `javascript:alert(1)`,
` javascript:alert(2)`, `&#106;avascript:alert(3)` and
`&#0000106;avascript:alert(4)` — the last two being the forms an HTML parser
sees as identical to `javascript:`.

A **form endpoint** is a real dependency and is a `uses` edge with
`isFormEndpoint`, **not** a `calls` edge: `Calls` claims *this symbol invokes
that symbol*, which is false for a URL. Since `uses`/`contains` were the only
other types the pre-fix analyzer emitted, **the html lane's entire call graph was
URLs**.

## Symbol contract

| Field | Supported? | How |
|---|---|---|
| `name` | ✅ | the element's `id`, else its `name`; a duplicate takes a deterministic `#N` suffix |
| `kind` | ✅ | `module` for the document, `class` for an addressable element |
| `ownerName` | ✅ | nearest addressable ancestor, else the document module |
| `range` | ✅ | 1-based, the whole element node (CC1) |
| `complexity` | ✅ | the addressable **subtree size** — the DOM analogue of a declaration's statement count; computed in the same O(n) pass by a single reverse walk |
| `visibility` | ✅ | always `public`: html has one scope, and a private/package value would be a fabrication |
| `parameters` / `returnType` | — | n/a — an element is not a callable. Deliberately **not** claimed in the completeness spec's payload matrix. |
| `docstrings` | — | n/a |

## Relationship contract

| Label | Emitted | Confidence | Tier |
|---|---|---|---|
| `contains` | DOM containment between addressable nodes, module → top-level included | 1.0 | `structural` |
| `uses` | fetched resources, in-project navigation, form endpoints, resolved in-document references | 1.0 fetch / 1.0 reference / 0.9 navigation | `import_based` / `structural` / `usage_contextual` |
| `calls` | **never** | — | — |
| every edge | carries `line_number` — **1-based, the call site, never a fabricated `0`** (M59.O2 / R6) | | |

`imports` mirrors every fetched project-relative module, and an import's `range`
is the **attribute's**, not the element's — the pre-fix element range made a
multi-line start tag produce a wrong import line.

## Regex inventory

**Zero.** The analyzer is pure-String: `asciiLower`, `unquote`, `decodeCharacterReferences`,
`urlScheme`, `isProtocolRelative`, `fragmentTarget`, `srcsetCandidates`,
`firstToken` and `isHtmlSpace` are all index loops. The M12 regex census carries
no html row and M49.R2 is clean for this lane by measurement, not by exemption —
**and it is now load-bearing**: a `String`-helper bug that made `asciiLower` the
identity function on every string containing a capital survived because every
input the lane had ever been measured against was already lowercase, where
identity and lowercase agree.

## Evidence

| Gate | State |
|---|---|
| **F1** grammar audit | ✅ pass — 11/11 node-type literals real, 0 unknown, 0 dead field reads |
| **F3** fixtures | ✅ **8/8** — `identity-addressable`, `attribute-case-and-srcset`, `resource-carriers`, `scheme-and-navigation`, `scope-barriers-and-references`, `framework-and-scores`, `error-budget`, `error-budget-broken` |
| **F4** mutation | ✅ **50/50 caught** (the lane entered with 0 mutants out of 938) |
| **F5** differential | ✅ **100% / MISSING=0 / unexplained=0** on **both** corpora — `otp` (66 hand-written pages) primary, `sqlite` (21/21 full documents) second |
| **F9** probe battery | ✅ contract carried by F3 + the F5 lockstep oracle |
| **SPEC** #419 | ⚠️ INVENTORY-DONE — A/B/C/D pass; E/F await the canonical baseline pin; G awaits this file's sibling; H awaits a CC1 block; **`HTML-G1` open** |

## The one open gap

**`HTML-G1` — `raw_text`.** The body of an inline `<script>` or `<style>` is a
single opaque leaf and **nothing descends into it**. Across the 11 html-bearing
corpus repos, **5,389 of 6,094 files (88.4%)** carry an inline block; on the
51 hand-written-document sample those blocks are 74,637 characters of JavaScript
and 17,266 of CSS producing **zero** symbols, calls and imports.

The cause is a **seam**, not a missing branch: the engine's polyglot path keys on
`metadata.embeddedScriptContent`, which **no analyzer in `src/ast/` has ever set**
(repo-wide: three references, all readers, zero producers), and the SFC sub-parse
seam that does exist is gated `language === "vue" || language === "svelte"`. The
fix is to extend that seam to html with **reused cached parsers** — a fresh
`Parser` per file exhausted the fixed-size wasm heap on the svelte lane at
`--sample 400` (M49 W12) — and to merge the delegate's payload with byte-accurate
line and index offsets, recording the applied offset on every row the way the
`sfcDelegated` / `sfcLineOffset` pair does.

It is deliberately **not** classified as `internal_silent`. Silence is guilt.

## Complexity and performance

Single DFS pass over an explicit stack — no child-array mapping, O(depth) working
set. Attribute extraction is one cursor per element. Identity resolution is an
O(1) map. Deferred in-document references resolve in O(L) after the walk, so a
**forward** reference (a label naming a control declared later) resolves exactly
as a backward one does. `srcset` is one index pass. Subtree complexity is one
reverse walk over the emitted symbols, not an O(depth) walk per node.

## See also

- `docs/analyzers/real-html-analyzer.md` — the per-symbol/per-edge extraction
  contract, the regex inventory and the M12 ground truth
- `script/m14/spec/html-completeness.json` — the 19-type classification,
  `HTML-G1` and ruling `HTML-D1`
- `reviews/html/` — the review record and the ledger row
