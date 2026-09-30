/**
 * script/m14/verify-grammar-pins.ts
 *
 * THE GRAMMAR PIN INSTRUMENT for the functional family (clean, clojure, elixir,
 * erlang, fsharp, haskell) plus any lane that registers itself below — hcl
 * joined on 2026-09-26 with the M60 data/config wave.
 *
 * The lane sweep (§7c) found that for four of the six lanes the question "are we
 * on the best tree-sitter, and which build is it?" could not be answered from the
 * repo at all: `wasm/tree-sitter-<lang>.wasm` was an unversioned blob. This
 * instrument makes the answer a measured record, and keeps it true.
 *
 * What a pin IS (all measured, none asserted):
 *
 *   1. wired bytes      — sha256 + byte length of `wasm/<file>`, recomputed here.
 *   2. surface          — the grammar's enumerable surface through web-tree-sitter.
 *                         Its id space mixes three vocabularies, and the record
 *                         names them rather than blurring them:
 *                           ids             = nodeTypeCount (all symbols: named node
 *                                             types, anonymous tokens, hidden rules)
 *                           namedUnique     = distinct names among ids whose
 *                                             nodeTypeIsNamed flag is set (this is the
 *                                             vocabulary `src/node-types.json`
 *                                             documents)
 *                           anonUnique      = distinct names among the anonymous ids
 *                                         (keywords, punctuation, hidden `_rules`)
 *                         plus three digests — id ORDER (a `tree-sitter generate`
 *                         fingerprint: two builds of the same source agree even when
 *                         their bytes differ), the (name,named) type SET, and the
 *                         field set.
 *   3. local copies     — which copies of those exact bytes exist on this machine
 *                         (mirror, npm tarballs, third-party prebuilt collections),
 *                         each with a provenance label. Byte identity only.
 *   4. vendored source  — when the grammar's source is in-tree (`grammars/...`),
 *                         every vendored file's sha256, so the source cannot drift
 *                         unnoticed.
 *   5. provenance       — the authored decision record (upstream repo/tag/rev,
 *                         redistributing package, and the evidence artifacts).
 *   6. source↔wasm      — when the vendored tree carries generated `src/node-types.json`
 *                         and `src/grammar.json`, then every name the source declares
 *                         (named types AND supertypes — supertypes are declared but
 *                         hidden by design, so they are looked up in the wasm's WHOLE
 *                         id space, not just its named ids) must exist in the wired
 *                         wasm, and every wasm-named type must be declared by the
 *                         source. That is the offline proof that the wired bytes ARE
 *                         a build of the vendored source; byte-identity to a published
 *                         wasm is stronger, and is recorded separately where it holds.
 *                         (`error_sentinel` is tree-sitter's own internal symbol and
 *                         is the one allowed wasm-side extra.)
 *
 * Modes:
 *   bun script/m14/verify-grammar-pins.ts             # measure, gate, print
 *   bun script/m14/verify-grammar-pins.ts --write      # re-emit the registry
 *   bun script/m14/verify-grammar-pins.ts --self-test  # prove the gate can fail
 *
 * Exit 0 iff every pinned lane matches its record (and the self-test is green
 * when requested). Writes only `validation/m14/grammar-pins.json`, and only in
 * `--write` mode.
 */
import * as fs from "fs"
import * as path from "path"
import { createHash } from "crypto"
import { execSync } from "child_process"

const ROOT = path.resolve(import.meta.dir ?? path.dirname(Bun.main), "..", "..")
const HOME = process.env.HOME ?? ""
const CACHE = path.join(HOME, ".bun/install/cache")
const MIRROR = path.join(HOME, ".bb/wasm")
const REGISTRY = path.join(ROOT, "validation/m14/grammar-pins.json")

const sha256 = (buf: Uint8Array) => createHash("sha256").update(buf).digest("hex")
const sha256Text = (s: string) => createHash("sha256").update(s).digest("hex")

/** tree-sitter's own internal symbol; not a grammar type, allowed as a wasm-side extra. */
const BUILTIN_WASM_SYMBOLS = new Set(["error_sentinel"])

// ---------------------------------------------------------------------------
// The authored half: per-lane provenance and the decision. Every claim here is
// either corroborated by a measured field in the emitted record or carries the
// artifact that shows it; the sweep's §7c table is the reader-facing summary.
// ---------------------------------------------------------------------------
export interface LaneDecision {
  wired: string
  provenance:
    | { kind: "byte-identical-to-npm-tarball"; package: string; version: string }
    | { kind: "byte-identical-to-third-party-package"; package: string; version: string; upstream: { repo: string; version: string; rev: string; builtWith?: string } }
    | { kind: "local-rebuild-from-vendored-source"; base: { repo: string; version: string }; patches: string[]; patchEvidence: string }
    | { kind: "local-rebuild-from-upstream-source"; base: { repo: string; version: string }; patches: string[]; patchEvidence: string; chain: string }
    | { kind: "unnamed-build-sha-only"; chain: string }
  source:
    | { state: "vendored"; dir: string; note: string; srcSubdir?: string }
    | { state: "not-obtainable-offline"; note: string }
  decision: string
  alternatives: Array<{ option: string; measured: string; artifact: string }>
  evidence: string[]
  copies: Array<{ label: string; path: string }>
  notVendored?: Array<{ path: string; why: string }>
}

export const LANES: Record<string, LaneDecision> = {
  "objective-c": {
    wired: "wasm/tree-sitter-objc.wasm",
    provenance: {
      kind: "local-rebuild-from-vendored-source",
      base: { repo: "tree-sitter-grammars/tree-sitter-objc", version: "3.0.2" },
      patches: [
        "P1 (#743, grammar.js): `macro_prefixed_objc_declaration` — a bare macro line above an @interface/@implementation/@protocol is a file-scope macro, not a declaration, and upstream reads it as a lone specifier closed by a MISSING `;`. Carries `prec(-1)`, which is load-bearing: raising it demands arbitration (`type_specifier, macro_prefixed_objc_declaration`), the wall the cpp half hit.",
        "P2 (#743 follow-up, grammar.js): the same rule admitted in `_block_item` as well as `_top_level_item`, and this is the defect that made P1 useless in practice. tree-sitter-c builds a file-scope `preproc_if` body from `_block_item`, NOT `_top_level_item`, so registering P1 in `_top_level_item` alone made it UNREACHABLE inside every conditional. sdwebimage wraps most of its headers in `#if SD_UIKIT || SD_MAC`, so the fallthrough was the norm, and the ERROR node it produced ran 101 lines to the next `@end` — deleting a whole class and replacing its properties with phantoms named after the property ATTRIBUTES (`variable:strong`, `variable:copy`, `variable:assign`, `variable:readonly`) while reporting `properties: 0`.",
        "P3 (M60, grammar.js): `macro_enum_specifier` for `typedef NS_ENUM(Underlying, Name) { ... };`, Apple's universal enum idiom, where the name is inside the macro's arguments and there is NO trailing declarator. Upstream collapses the body into ERROR nodes: 35 declarations, 164 named constants, 152 invisible (7.3% recovery) over the router's 329-file universe. Two properties are load-bearing and both measured. `prec(1)`, not `prec(-1)`: at -1 the rule generates, builds a wasm, and does NOTHING, because `NS_ENUM` is absorbed as a `type_identifier` and `(...)` as a `parenthesized_declarator` by default — a rule that never fires still passes a diff of the grammar file. And deliberately GENERIC (identifier, parenthesised args, brace body) rather than an NS_ENUM|NS_OPTIONS name list, because naming the five macros one corpus happened to use repeats a mistake this project already made in the yaml analyzer's include tags: a closed set built from the constructs someone thought to ask about. Aliased to `enum_specifier` at every admission point so the analyzer's existing C-enum path applies unchanged — which is also why it is a RULE and not a node type.",
        "P4 (M60, grammar.js): `availability_macro_specifier` for Apple's trailing availability annotations, which are macro CALLS with nested parens, commas and string literals (`API_DEPRECATED_WITH_REPLACEMENT(\"use removeImageForKey:\", macos(10.10, X), ios(8.0, X), ...)`). C's `macro_type_specifier` covers `MACRO(type)` — one type argument — and `attribute_specifier` covers `[[...]]`, so neither reached the shape; the annotation trails the last method parameter, the parse cannot continue, and the ERROR node swallows the ENCLOSING @protocol (83 lines; SDImageCacheDefine.h analysed to 0 methods where it has 7). Admitted ONLY via a local `_method_trailing_modifiers` and inside the method selector/parameter loop, and that narrowness is a measurement: admitting it through the shared `_declaration_modifiers` — the right-looking move, since the annotation really does trail a declaration — generated, built, and PASSED its minimal case, then took the corpus from 285 to 14,710 ERROR nodes and dropped 17,642 relationships across 239 of 329 files, because that hidden rule sits in every declaration and parameter position in the grammar and a rule whose arguments include a bare `identifier` outranks ordinary declarations almost everywhere (`UIApplicationMain(argc, argv)` in `main.m` was read as an annotation). Admitting it inside the loop is not optional: the loop offers only another selector or another parameter, and a trailing `AF_API_UNAVAILABLE(macos);` begins with an identifier, so `method_selector` claimed it and the method was published as `setDidFinishEventsForBackgroundURLSessionBlock:AF_API_UNAVAILABLE` — a selector IS identity in Objective-C, so that is a method that does not exist, carrying a `contains` row a consumer would route calls to, while the real selector is the one that vanishes.",
      ],
      patchEvidence:
        "Surface and behaviour A/B over THREE builds, re-runnable via `bun run script/m60/objc-grammar-provenance.ts` (artifact: validation/m60/results/objc-grammar-provenance.json): WIRED (what every number in this lane measures) vs a REBUILD of this committed patched source vs PRISTINE npm tree-sitter-objc@3.0.2's own published wasm. WIRED vs REBUILD: named-type surface IDENTICAL in both directions (421 named types, 0 difference either way) and analyzer output IDENTICAL on all 329 router-routed files (0 differ) — the byte sha256s differ (5,625,076 vs 5,625,079, 3 bytes) as they must, because a wasm build carries its emscripten version, compiler flags and section order; identity is claimed on surface and behaviour, which is what this gate measures. WIRED vs PRISTINE: 8 named types present in WIRED and absent from pristine, and ZERO the other way, which is the statement that the patch is live in the bytes this lane loads and is purely additive at the node-type level. Behaviour over the same 329 files: pristine 622 ERROR nodes / 4,779 symbols / 23,754 relationships against WIRED's 158 / 5,095 / 24,226, differing on 47 files. The added node types are DERIVED FROM THAT DIFF rather than hand-listed, because the first version of this record hand-listed them and named `macro_enum_specifier` — a rule that is aliased to `enum_specifier` at every admission point and therefore correctly has no node type — which made the gate report this pin as NOT HONEST on a type that was never supposed to exist. A list maintained by hand is a claim; the surface diff is the measurement.",
    },
    source: {
      state: "vendored",
      dir: "grammars/tree-sitter-objc",
      note:
        "grammar.js — the PATCHED upstream 3.0.2 grammar carrying this repository's #743 and M60 edits and their measured rationale in comments, not a pristine copy — plus src/grammar.json and src/node-types.json REGENERATED from that patched grammar.js by `tree-sitter generate` (tree-sitter CLI 0.26.9) on 2026-09-29, plus package.json, tree-sitter.json, LICENSE, README.md, queries/ and PIN.md. The generated src/ is the point of the exercise: before it the vendored tree carried no node-types.json/grammar.json pair, so this gate's source<->wasm check could not run for objective-c AT ALL and the lane had no offline proof that its bytes were a build of its own source — the same gap the C record describes for its own lane before the same treatment. src/parser.c is deliberately NOT vendored: `tree-sitter generate` rebuilds it from grammar.js, the check runs on the generated JSONs, and the file is tens of megabytes. This differs from the hcl lane, which DOES vendor parser.c and can rebuild the wasm from the directory alone; the difference is recorded rather than accidental. The build requires UPSTREAM tree-sitter-c@0.24.1 on node_modules, NOT this repository's patched grammars/tree-sitter-c: that copy carries the #743 `macro_prefixed_type_specifier` rule, which is not co-live with objc's `generic_specifier` and fails generation outright with `Unresolved conflict: '^' identifier identifier • '<'`.",
    },
    decision:
      "Pin as a LOCAL REBUILD OF THE PATCHED VENDORED SOURCE, and the reason is that the prior question had to be answered before provenance could be stated at all. Most lanes in this file pin bytes byte-identical to a published package; that kind was unavailable here, because `wasm/tree-sitter-objc.wasm` (5,625,076 B, sha256 39799d7f...) is a rebuild of a patched source and npm's own tree-sitter-objc@3.0.2 wasm is 5,317,155 B. So the real question is whether the WIRED bytes are a build of the PATCHED source or a pristine build predating the patches, and it decides what every measurement in this lane means: the 9-fixture suite, the 5 grammar-wave mutants, the 329-file census, the 622-vs-158 error comparison and the enum-recovery number are all measurements of a parse produced by these bytes. Measured answer: the patches ARE live and the bytes ARE honest — a rebuild of the committed patched source is surface-identical to WIRED in both directions and analyzer-identical on all 329 routed files, while pristine differs by exactly the 8 node types the patches add and is worse on the corpus by 464 ERROR nodes, 316 symbols and 472 relationships. The consequence is the useful one: the incumbent was already a verified build, so no Objective-C measurement needs re-baselining, and had the wired bytes matched pristine, P1–P4 would not have been live and the whole lane would have needed re-measuring. This also retires a hazard that was carried for the entire #743 wave: objective-c was one of 21 lanes in the repository with a PATCHED, in-tree grammar and NO pin at all, which is the worst case for a pin rather than a mild one — the pin exists to catch 'the wired bytes are not a build of the source we think they are', and a patched grammar is exactly where that happens, because someone edits grammar.js, rebuilds, and every downstream number moves with no gate objecting.",
    alternatives: [
      {
        option: "Adopt npm tree-sitter-objc@3.0.2's own published wasm as the wired bytes",
        measured:
          "REJECTED, and this is the load-bearing measurement of the lane: it DELETES capability. Over the router's 329-file universe pristine parses 622 ERROR nodes against WIRED's 158, and yields 4,779 symbols and 23,754 relationships against WIRED's 5,095 and 24,226, differing on 47 files. Concretely it loses 152 of 164 NS_ENUM/NS_OPTIONS member constants (enum recovery 98.8% -> 7.3%), the class-deleting 101-line ERROR span behind the unreachable-in-`#if` macro rule, and the 83-line @protocol span behind availability annotations. It is 8 named types short.",
        artifact: "validation/m60/results/objc-grammar-provenance.json (surface.wiredVsPristine, behaviour.wiredVsPristine)",
      },
      {
        option: "Pin the wired bytes as `unnamed-build-sha-only`",
        measured:
          "REJECTED, because it would record a fact and not a relationship. The bytes are not anonymous: the vendored source is in-tree, a rebuild of it reproduces the parse exactly, and the pristine comparison above is only meaningful BECAUSE the patches are named and enumerable. sha-only would leave `macro_prefixed_objc_declaration`'s live-ness a matter of memory, which is the exact failure the C record describes for its own lane.",
        artifact: "grammars/tree-sitter-objc/PIN.md",
      },
    ],
    evidence: [
      "validation/m60/results/objc-grammar-provenance.json — three-build surface+behaviour A/B over the router's 329 routed files, the patch evidence this record cites",
      "validation/m60/results/objc-wasm-ab.json — per-file analyzer-output diff between builds, which is what makes 'the patches are live' a measurement of the analyzer rather than of a boolean hasError",
      "validation/m60/results/objc-census.json — 329-file census of the wired build: 5,095 symbols, 24,226 relationships, 158 ERROR nodes in 15 of 329 files, 0 unknown-kind symbols, 100% line coverage on all 8 relationship types",
      "validation/m60/results/objc-enum-loss.json — enum member recovery 7.3% -> 98.8% across 35 declarations, the number P3 is for",
      "validation/m60/results/objc-mutant-check.json — 5/5 grammar-wave mutants caught, with the registry's own parse failure recorded",
      "grammars/tree-sitter-objc/PIN.md — the authored provenance and decision record",
    ],
    copies: [],
    notVendored: [
      { path: "grammars/tree-sitter-objc/src/parser.c", why: "tens of megabytes, and `tree-sitter generate` rebuilds it deterministically from the vendored grammar.js; the source<->wasm check runs on the generated src/grammar.json and src/node-types.json instead. The hcl lane DOES vendor parser.c so it can rebuild the wasm from the directory alone — that lane's central claim is the offline rebuild, this lane's is the patch's live-ness, and the two are different claims needing different evidence." },
      { path: "node_modules/tree-sitter-c@0.24.1 (the build dependency)", why: "must be UPSTREAM, not this repository's patched grammars/tree-sitter-c — see the note on `source`. Fetched with `npm pack tree-sitter-c@0.24.1`; the pristine tarball is kept at /tmp/opencode/tsbuild/ so the A/B survives a network copy disappearing." },
    ],
  },
  c: {
    wired: "wasm/tree-sitter-c.wasm",
    provenance: {
      kind: "local-rebuild-from-vendored-source",
      base: { repo: "tree-sitter/tree-sitter-c", version: "0.24.1" },
      patches: [
        "P1 (#743, grammar.js): `macro_prefixed_type_specifier` as a VISIBLE node, with the conflict entries the ordinary reading (`A B;` = a B of type A) needs. Upstream hides the rule, so the analyzer could not name the type position at all; the `#743` note in the vendored file records that two conflict variants became unnecessary once the rule carried `prec(-1)`.",
        "P2 (#743b, grammar.js): a header name in a PREPROCESSOR-ARGUMENT position -- `__has_include(<vector>)`, `__has_include(\"meta\")` and the wrapper form `FMT_HAS_INCLUDE(<string_view>)`. Upstream parses every one of these as an ERROR node, because `<string_view>` is not a preproc expression: `<` would have to be a binary operator with a missing left operand. The shape reaches 16 files across the two cpp corpora, in the guard of every portable header. Scoped to the ARGUMENT position deliberately: `<` cannot BEGIN a `_preproc_expression` (the unary operators are `! ~ - +`), so there is no competing `<` token to lose the tie to at the start of an argument.",
      ],
      patchEvidence:
        "Surface and behaviour A/B over three builds, re-runnable via `bun run script/m14/tmp/c-audit/c-grammar-pin.ts` (artifact: validation/m14/results/c-grammar-pin.json). WIRED vs a REBUILD of this committed patched source: named-type surface IDENTICAL in both directions (128 named types, zero difference either way) -- the byte sha256s differ, as they must, because a wasm build carries its emscripten version, compiler flags and section order; identity is claimed on surface and behaviour, which is what this gate measures. WIRED vs pristine tree-sitter-c@0.24.1's own published wasm: 3 named types present in WIRED and absent from pristine -- `macro_prefixed_type_specifier`, `macro_specifier`, `preproc_header_name` -- and ZERO the other way, which is the statement that the patch is live in the bytes this lane loads and is purely additive at the node-type level. 10-construct behavioural battery, WIRED == REBUILD on all 10, and the 3 `#743b` shapes are `damaged` under pristine and `clean` under both WIRED and REBUILD, while the two comparison shapes the patch could have broken (`#if A < B && C > D`, `#if MAX(A < B, C < D)`) and all 5 controls are `clean` under all three. The pristine and rebuilt wasms are kept at fixtures/c/grammar/ with a SHA256SUMS.txt so the A/B survives any network copy disappearing.",
    },
    source: {
      state: "vendored",
      dir: "grammars/tree-sitter-c",
      note:
        "grammar.js -- the PATCHED upstream 0.24.1 grammar, carrying this repository's own #743/#743b edits and their measured rationale in comments, not a pristine copy -- plus src/grammar.json and src/node-types.json REGENERATED from that patched grammar.js by `tree-sitter generate` (tree-sitter CLI 0.25.10) on 2026-09-29, plus package.json, tree-sitter.json and LICENSE byte-identical to npm tree-sitter-c@0.24.1. The generated src/ is the point of the exercise: before it, the vendored tree carried no node-types.json/grammar.json pair, so this gate's source<->wasm check could not run for C at all and the lane had no offline proof that its bytes were a build of its own source. src/parser.c (3.9 MB) is deliberately NOT vendored -- `tree-sitter generate` rebuilds it from grammar.js, and the check runs on the generated JSONs.",
    },
    decision:
      "Pin as a LOCAL REBUILD OF THE PATCHED VENDORED SOURCE, and the reason is that the prior question had to be answered before provenance could be stated at all. `wasm/tree-sitter-c.wasm` (650,175 B, sha256 f9a2d771...) was recorded in validation/m14/results/wasm-provenance-census.json with NO byte-identical local copy and the verdict \"provenance cannot be re-derived offline\", while grammars/tree-sitter-c/ carried only grammar.js/LICENSE/package.json/tree-sitter.json, so this gate could not compare the source to the bytes either. `byte-identical-to-npm-tarball` -- the kind every other lane in this file uses -- was therefore unavailable: the vendored grammar.js differs from npm tree-sitter-c@0.24.1's by 75 diff lines and carries this repository's #743/#743b markers. So the real question was whether the WIRED bytes are a build of the PATCHED source or a pristine build predating the patch, and it decides what every C measurement means, because the F1 oracle, the 2,498-file census, the clang layout probe and all 28 mutants are all measurements of a parse produced by these bytes. Measured answer: the patch IS live. A rebuild of the committed patched source is surface-identical to WIRED in both directions (128 named types) and behaviourally identical on all 10 constructs, while pristine upstream differs by exactly the 3 node types the patch adds and fails all 3 `#743b` shapes. The consequence is the useful one: the incumbent was already a verified build, so no C measurement needs re-baselining, and had the wired bytes matched pristine the #743b fix would not have been live and the whole lane would have needed re-measuring. This also retires a live hazard recorded in this wave's own review: the #936 defect was a node-type literal (`attributed_type_specifier`) written from memory of a different tree-sitter-c release, which F1 caught only because the vocabulary happened to be checked -- the pin makes the release explicit rather than remembered.",
    alternatives: [
      {
        option: "Adopt npm tree-sitter-c@0.24.1's own published wasm (sha c852c2a8..., 625,918 B) as the wired bytes",
        measured:
          "REJECTED, and this is the load-bearing measurement of the lane: it DELETES capability. It is 3 named types short of the wired bytes -- `macro_prefixed_type_specifier`, `macro_specifier`, `preproc_header_name` -- and it parses all three `#743b` shapes as ERROR nodes where the wired build parses them clean. The first is a node the C analyzer itself names (the `macro_prefixed_type_specifier` note in the vendored grammar.js is a #743 record, and the analyzer's member/enumerator rules key on macro names), and the second is 16 files across the two cpp corpora whose portable-header guards would move from clean to damaged.",
        artifact: "validation/m14/results/c-grammar-pin.json (constructs[], patchAddsNamedTypes[])",
      },
      {
        option: "Pin the wired bytes as `unnamed-build-sha-only`",
        measured:
          "REJECTED as insufficient, not as wrong. It would record the sha256 and stop, which does protect against future drift -- but it leaves the central question open, and the answer turned out to be available and cheap: the patch is live, the source is in-tree, and a rebuild reproduces the bytes' surface and behaviour exactly. A sha-only pin on bytes that are demonstrably a build of committed source understates what is actually known.",
        artifact: "validation/m14/results/c-grammar-pin.json (verdict.patchIsLiveInWiredBytes)",
      },
      {
        option: "Regenerate the wired bytes from the patched source and adopt the rebuild",
        measured:
          "NOT NEEDED, and worth recording as a negative result. The rebuild is 630,720 B against the wired 650,175 B -- a toolchain difference, not a grammar difference -- with identical surface and identical behaviour on all 10 constructs. Swapping would have churned every C measurement for no observable gain, and the pin does not require byte identity: it requires that the committed source and the committed bytes agree, which the gate now re-measures on every run.",
        artifact: "validation/m14/results/c-grammar-pin.json (builds.surfaceDiff.wiredVsRebuiltPatched)",
      },
    ],
    evidence: [
      "validation/m14/results/c-grammar-pin.json",
      "validation/m14/results/wasm-provenance-census.json",
      "grammars/tree-sitter-c/PIN.md",
    ],
    copies: [],
    notVendored: [
      { path: "src/parser.c", why: "generated from grammar.js by `tree-sitter generate`; 3.9 MB; the source<->wasm check runs on the generated JSONs" },
      { path: "src/tree_sitter/*.h", why: "the runtime headers the generated parser includes; shipped by the CLI, not by the grammar" },
      { path: "bindings/, binding.gyp, binding_test.js", why: "node-native bindings; not parser source" },
      { path: "prebuilds/", why: "platform .node binaries; not parser source" },
      { path: "queries/highlights.scm, queries/tags.scm", why: "editor queries; the engine does not load them" },
      { path: "README.md", why: "upstream's readme, not required by any check" },
      { path: "tree-sitter-c.wasm (the 0.24.1 tarball's own)", why: "kept instead at fixtures/c/grammar/pristine-tree-sitter-c-0.24.1.wasm, outside the repository, where the A/B can use it without the repo pinning a build it has decided against" },
    ],
  },

  haskell: {
    wired: "wasm/tree-sitter-haskell.wasm",
    provenance: { kind: "byte-identical-to-npm-tarball", package: "tree-sitter-haskell", version: "0.23.1" },
    source: {
      state: "vendored",
      dir: "grammars/tree-sitter-haskell",
      note:
        "grammar.js + the split grammar modules (grammar/*.js) + src/ (scanner.c, grammar.json, node-types.json, unicode.h, tree_sitter/ headers) + package.json + tree-sitter.json + LICENSE + README.md, byte-for-byte from the npm tarball tree-sitter-haskell@0.23.1. The GENERATED src/parser.c (20 MB here) is deliberately not vendored: `tree-sitter generate` rebuilds it from grammar.js, and the source↔wasm check below runs on the generated JSONs, not on parser.c.",
    },
    decision:
      "Pin as-is: the wired wasm is byte-identical to the wasm published in tree-sitter-haskell@0.23.1, which is the newest release of tree-sitter/tree-sitter-haskell (the grammar is dormant at 0.23.1), and that tarball's source is now vendored in-tree with per-file hashes. No better candidate exists, locally or upstream.",
    alternatives: [],
    evidence: [
      "validation/m14/results/wasm-provenance-census.json",
      "validation/m14/results/family-grammar-fingerprints.json",
    ],
    copies: [
      { label: "mirror", path: path.join(MIRROR, "tree-sitter-haskell.wasm") },
      { label: "npm tree-sitter-haskell@0.23.1", path: path.join(CACHE, "tree-sitter-haskell@0.23.1@@@1/tree-sitter-haskell.wasm") },
    ],
    notVendored: [
      { path: "binding.gyp, bindings/, prebuilds/", why: "native bindings; not parser source" },
      { path: "queries/", why: "editor queries; the engine does not load them" },
      { path: "src/parser.c", why: "generated from grammar.js; 20 MB; `tree-sitter generate` rebuilds it" },
      { path: "tree-sitter-haskell.wasm", why: "the wired bytes; they live at wasm/ and are pinned by sha here" },
    ],
  },

  // CSS is the one lane in this file whose wired bytes are NOT a published
  // prebuilt, and the reason is measured rather than preferred: two grammar
  // defects each broke real files in the corpus, each has a one-line
  // reproduction, and the A/B on 533 files showed the fixes are strictly
  // additive (19 fixed, 0 regressed, 0 node-type and 0 field delta). The record
  // below therefore pins a LOCAL REBUILD and says why, rather than pinning
  // upstream's bytes and leaving 19 files unparsed.
  //
  // A rebuild's sha256 is not a function of its source — the UNMODIFIED upstream
  // source rebuilds to a different sha than upstream's own prebuilt, with
  // identical behaviour on all 533 corpus files (script/m14/tmp/css-grammar-ab.ts).
  // So this lane's proof is the source↔wasm check (every name the vendored source
  // declares exists in the wired wasm and vice versa), NOT a hash comparison.
  css: {
    wired: "wasm/tree-sitter-css.wasm",
    provenance: {
      kind: "local-rebuild-from-vendored-source",
      base: { repo: "tree-sitter/tree-sitter-css", version: "0.25.0" },
      patches: [
        "keyframe_block: add float_value to the step choice — `33.3%` is a float_value, not an integer_value, and float_value already exists in this grammar, so no node type is added (measured 151 -> 151). Repro: @keyframes f { 33.3% { color: yellow } }",
        "plain_value: allow a LEADING `.` — an unquoted relative url() could not lex at all, because the token ended at the first `.` and the `..` became two ERROR nodes; `.` was already legal in the token's BODY, so only the leading repeat lacked it. The required /[a-zA-Z]/ is deliberately RETAINED so a value made only of punctuation still cannot match and the token cannot swallow structure. Repro: .a { background-image: url(../img/x.svg); }",
      ],
      patchEvidence:
        "validation/m14/results/css-grammar-ab-url-float.json (A/B over 533 corpus files across 4 repos: 19 files fixed, 0 regressed, 0 node-count delta on files that already parsed clean, 0 node-type and 0 field change), plus reviews/m49-css-review.md. Both hunks carry their own repro in grammar.js under a `LOCAL PATCH` marker, and the file's header states the rebuild command and the sha-is-not-reproducible measurement so the next editor is not misled by a hash comparison.",
    },
    source: {
      state: "vendored",
      dir: "grammars/tree-sitter-css",
      note:
        "grammar.js (upstream 0.25.0 byte-for-byte except the two marked LOCAL PATCH hunks, 36 changed lines including the patch header) + src/ (scanner.c, grammar.json, node-types.json, tree_sitter/ headers) + package.json + tree-sitter.json + LICENSE + README.md, from the npm tarball tree-sitter-css@0.25.0. The external scanner is REQUIRED, not optional: its TokenType enum is exactly DESCENDANT_OP, PSEUDO_CLASS_SELECTOR_COLON and ERROR_RECOVERY, which back the descendant combinator, `::`, and error recovery. The GENERATED src/parser.c is deliberately not vendored: `tree-sitter generate` rebuilds it from grammar.js, and the source↔wasm check runs on the generated JSONs, not on parser.c.",
    },
    decision:
      "Pin the local patched rebuild, and require the source↔wasm proof rather than a hash. Upstream 0.25.0 is the newest release and its prebuilt is present on this machine in 20+ copies (all sha 8a23977f, 128668 bytes) — but wiring those bytes means 19 real corpus files stay unparsed: 16 of 191 grails-core files on the relative-url class, 2 of 53 scala3, 1 of 185 svelte. The two fixes are additive by measurement, not by argument. The trade is recorded rather than hidden: the wired bytes are ours, so a future `tree-sitter generate && build` will NOT reproduce this sha, and a contributor who changes grammar.js must re-run the A/B before trusting the result.",
    alternatives: [
      {
        option: "wire upstream tree-sitter-css@0.25.0's prebuilt wasm (sha 8a23977f, 128668 bytes)",
        measured:
          "Rejected on measurement: 19 corpus files stay unparsed across 4 repos (grails-core 16, scala3 2, svelte 1). Available in 20+ local copies, so this was the cheap option and it was still the wrong one — the defect class is the largest single parse-failure class in the CSS corpus after `progid:`.",
        artifact: "validation/m14/results/css-grammar-ab-url-float.json",
      },
      {
        option: "the older 98133-byte build shipped in tree-sitter-wasms@0.1.13 (sha 5fc61546), also vendored at backbencher/packages/brain-core/wasm/",
        measured:
          "Rejected: an older grammar surface, and brain-core's vendored copy is the one already wired in that package, so adopting it here would silently regress this lane behind it. Not A/B'd file-by-file because the surface is strictly older and the 0.25.0 prebuilt already fails on 19 files.",
        artifact: "validation/m14/results/wasm-provenance-census.json",
      },
    ],
    evidence: [
      "validation/m14/results/css-grammar-ab-url-float.json",
      "validation/m14/results/wasm-provenance-census.json",
      "validation/m14/results/family-grammar-fingerprints.json",
      "reviews/m49-css-review.md",
    ],
    copies: [
      { label: "npm tree-sitter-css@0.25.0 (upstream prebuilt, the base — NOT these bytes)", path: path.join(CACHE, "tree-sitter-css@0.25.0@@@1/tree-sitter-css.wasm") },
    ],
    notVendored: [
      { path: "prebuilds/, bindings/, binding.gyp", why: "native node bindings for 6 platforms; not parser source, and the engine loads the wasm" },
      { path: "src/parser.c", why: "generated from grammar.js by `tree-sitter generate`; the source↔wasm proof runs on the generated JSONs instead" },
      { path: "tree-sitter-css.wasm", why: "the base upstream prebuilt lives in the npm cache and is recorded above as the base; the WIRED bytes are our patched rebuild at wasm/ and are pinned by sha in the gate's own recomputation" },
    ],
  },

  elixir: {
    wired: "wasm/tree-sitter-elixir.wasm",
    provenance: { kind: "byte-identical-to-npm-tarball", package: "tree-sitter-elixir", version: "0.3.5" },
    source: {
      state: "vendored",
      dir: "grammars/tree-sitter-elixir",
      note:
        "grammar.js + src/ (scanner.c, grammar.json, node-types.json, tree_sitter/ headers) + package.json + README.md + LICENSE, byte-for-byte from the npm tarball tree-sitter-elixir@0.3.5. The GENERATED src/parser.c (13 MB here) is deliberately not vendored, for the same reason as haskell's.",
    },
    decision:
      "REPLACED the incumbent with upstream v0.3.5 (its npm tarball wasm; the sha256 is measured below). The incumbent was a 2024 prebuilt, byte-identical to tree-sitter-wasms@0.1.13's out/tree-sitter-elixir.wasm whose declared upstream dependency is tree-sitter-elixir ^0.1.1, and its only surface difference from upstream v0.3.5 was one anonymous token, `^^`, that upstream's source does not contain. That token was not inert: `x = ^^y` produced an ERROR node under the incumbent and parses cleanly under v0.3.5; both grammars agree on `1 ^^^ 2` and on single-caret pins. On the lane's two corpora the two builds produce identical trees on 773 of 773 files, so the upgrade costs nothing measurable and buys a named release, a vendorable source, and a wasm published by the grammar's own maintainers.",
    alternatives: [
      {
        option: "keep the 2024 prebuilt (tree-sitter-wasms@0.1.13)",
        measured:
          "identical trees on 773/773 corpus files; carries a legacy `^^` token upstream removed, which mis-parses `x = ^^y` into an ERROR node",
        artifact: "validation/m14/results/elixir-grammar-ab.json",
      },
      {
        option: "upstream v0.3.5 (npm tarball wasm)",
        measured: "identical trees on 773/773 corpus files, 0 damaged files under both; cleaner `^^` handling; named release + vendored source",
        artifact: "validation/m14/results/elixir-grammar-ab.json",
      },
    ],
    evidence: [
      "validation/m14/results/elixir-grammar-ab.json",
      "validation/m14/results/family-grammar-fingerprints.json",
      "script/m14/tmp/elixir-grammar-token-probe.ts",
    ],
    copies: [
      { label: "mirror (already upstream 0.3.5)", path: path.join(MIRROR, "tree-sitter-elixir.wasm") },
      { label: "npm tree-sitter-elixir@0.3.5", path: path.join(CACHE, "tree-sitter-elixir@0.3.5@@@1/tree-sitter-elixir.wasm") },
      { label: "tree-sitter-wasms@0.1.13 (the REPLACED incumbent)", path: path.join(CACHE, "tree-sitter-wasms@0.1.13@@@1/out/tree-sitter-elixir.wasm") },
    ],
    notVendored: [
      { path: "binding.gyp, bindings/, prebuilds/", why: "native bindings; not parser source" },
      { path: "queries/", why: "editor queries; the engine does not load them" },
      { path: "src/parser.c", why: "generated from grammar.js; 13 MB; `tree-sitter generate` rebuilds it" },
      { path: "tree-sitter-elixir.wasm", why: "the wired bytes; they live at wasm/ and are pinned by sha here" },
    ],
  },

  fsharp: {
    wired: "wasm/tree-sitter-fsharp.wasm",
    provenance: {
      kind: "local-rebuild-from-vendored-source",
      base: { repo: "ionide/tree-sitter-fsharp", version: "0.3.11" },
      patches: [
        "grammar: adds `module_val_declaration` and `nullable_type` — exactly the two named types the wired wasm has that npm tree-sitter-fsharp@0.3.11's wasm does not",
        "scanner: the manifest records an interface-probe patch with token-type lookahead; its SOURCE IS NOT IN-TREE (`common/scanner.h` is byte-identical to the npm 0.3.11 tarball's), so the patch is not reconstructible from this repo — recorded here rather than papered over",
      "P6 (2026-09-27): psql meta-commands as an EXTRA, not a `program` item. Every PostgreSQL extension install script opens with a backslash-echo usage banner, and that directive was the most common damage shape in the extension corpus by FILE COUNT (301 of 302 damaged files) - ahead of every SQL construct. It is a loss driver, not cosmetic: a backslash-set followed by a CREATE FUNCTION yields create_function = 0, so the declaration is LOST. As an extra the lexer skips the directive wherever it appears and it never enters the LR automaton; that placement was reached by building two worse designs first (a `program` item with a repeat of argument tokens, and a single token inside `program`), which ran the generator for 127 and 66 minutes respectively without emitting a parse table.",
      "P7 (2026-09-27): LANGUAGE with a quoted string value - present in 156 of 387 extension files where the bare-identifier-only rule left a trailing ERROR in every one.",
      "P8 (2026-09-27): a C-language function body `AS 'modulename', 'symbolname'` - the two-literal form, present in 156 extension files where the single-literal alternative left a trailing ERROR.",
      ],
      patchEvidence: "validation/m14/results/family-grammar-fingerprints.json",
    },
    source: {
      state: "vendored",
      dir: "grammars/tree-sitter-fsharp",
      note:
        "fsharp/grammar.js (the patched grammar — the npm tarball ships no grammar.js, so its vintage is fixed by hash here rather than by byte-identity to a tarball) + common/scanner.h (byte-identical to the npm 0.3.11 tarball) + package.json + tree-sitter.json + LICENSE + README.md. The vendored src/ holds only tree_sitter/ headers, which is why the source↔wasm check cannot run for this lane.",
    },
    decision:
      "Pin the local rebuild. Three measured clauses: (1) the wired wasm's surface is upstream 0.3.11 PLUS exactly `module_val_declaration` and `nullable_type` and MINUS nothing; (2) the vendored grammar.js's rule set is 0.3.11's rule set plus exactly those two rules, with nothing dropped (fsharp-pin-evidence.json); (3) on the lane's own 400-file M12 sample the patch REPAIRS 9 files that unpatched 0.3.11 damages (e.g. infos.fs: 41 ERROR + 1 MISSING → 0/0) and damages exactly ONE that unpatched 0.3.11 parses clean (BasicProvider.Runtime.fs: an ERROR around `namespace` on line 5, after a `#if/#endif` block) — so the patch is a net parse win on real code with one recorded regression site. The claimed SCANNER patch still has no in-tree source and no minimal repro: two sample files show the claimed difference class in aggregate (fsharp-grammar-ab.json's sentinel hits), which is not the same as a repro, so it stays recorded-not-proven rather than asserted.",
    alternatives: [
      {
        option: "npm tree-sitter-fsharp@0.3.11 (unpatched)",
        measured: "surface is a strict subset of the wired wasm's: missing module_val_declaration and nullable_type, carrying no type the wired one lacks",
        artifact: "validation/m14/results/family-grammar-fingerprints.json",
      },
      {
        option: "npm tree-sitter-fsharp@0.1.0 (2019 vintage)",
        measured: "21 named types missing vs the wired wasm, 0 extra",
        artifact: "validation/m14/results/family-grammar-fingerprints.json",
      },
    ],
    evidence: [
      "validation/m14/results/family-grammar-fingerprints.json",
      "validation/m14/results/fsharp-pin-evidence.json",
      "validation/m14/results/fsharp-grammar-ab.json",
      "validation/m14/results/fsharp-corpus-census.json",
    ],
    copies: [
      { label: "npm tree-sitter-fsharp@0.3.11 (unpatched)", path: path.join(CACHE, "tree-sitter-fsharp@0.3.11@@@1/tree-sitter-fsharp.wasm") },
      { label: "npm tree-sitter-fsharp@0.1.0", path: path.join(CACHE, "tree-sitter-fsharp@0.1.0@@@1/tree-sitter-fsharp.wasm") },
      { label: "mirror (stale, pre-patch)", path: path.join(MIRROR, "tree-sitter-fsharp.wasm") },
    ],
  },

  erlang: {
    wired: "wasm/tree-sitter-erlang.wasm",
    provenance: {
      kind: "byte-identical-to-third-party-package",
      package: "@lumis-sh/wasm-erlang",
      version: "0.26.0",
      upstream: { repo: "WhatsApp/tree-sitter-erlang", version: "0.15.0", rev: "f21023bbd6cd30cadbc793d80ae4d990d9be86fc", builtWith: "tree-sitter build --wasm v0.26.7 (tree-sitter 0.26)" },
    },
    source: {
      state: "not-obtainable-offline",
      note:
        "no erlang grammar source exists on this machine (the npm name `tree-sitter-erlang` resolves to a security-holder placeholder). The pin is therefore bytes + surface fingerprint + the redistributor's own provenance table, not source.",
    },
    decision:
      "Pin the bytes with the strongest provenance available offline: the wired wasm is byte-identical to @lumis-sh/wasm-erlang@0.26.0, whose package metadata names WhatsApp/tree-sitter-erlang v0.15.0 at rev f21023bb built by tree-sitter CLI 0.26.7. Upstream is further along than v0.15.0, but no newer source or build exists locally, so an upgrade cannot be measured here and is not claimed.",
    alternatives: [],
    evidence: [
      "validation/m14/results/wasm-provenance-census.json",
      "validation/m14/results/family-grammar-fingerprints.json",
    ],
    copies: [
      { label: "mirror", path: path.join(MIRROR, "tree-sitter-erlang.wasm") },
      { label: "@lumis-sh/wasm-erlang@0.26.0", path: path.join(CACHE, "@lumis-sh/wasm-erlang@0.26.0@@@1/tree-sitter-erlang.wasm") },
    ],
  },

  clojure: {
    wired: "wasm/tree-sitter-clojure.wasm",
    provenance: {
      kind: "byte-identical-to-npm-tarball",
      package: "@yogthos/tree-sitter-clojure",
      version: "0.0.14",
      chain:
        "commit 34972a88 records the swap to @yogthos/tree-sitter-clojure 0.0.14 (a rewrite: list_lit/sym_lit/sym_name/sym_ns/vec_lit/kwd_lit/anon_fn_lit vocabulary, no interop nodes), after the canonical sogaiu 0.4.0 grammar failed 128/141 files of the clojure compiler's own source. No local copy of the package exists, so the bytes were matched against the package's PUBLISHED file hash instead: jsDelivr's listing for @yogthos/tree-sitter-clojure@0.0.14 reports tree-sitter-clojure.wasm, 91,957 bytes, sha256 (base64) kPiGa3TQThZD7XPM4lcgxzLfKqo4tF2p3MdzuugYHCc= — which decodes to 90f8866b74d04e1643ed73cce25720c732df2aaa38b45da9dcc773bae8181c27, the wired sha exactly, and the size matches too. External corroboration, not a local re-derivation: the pin records that distinction.",
    },
    source: {
      state: "not-obtainable-offline",
      note:
        "the canonical sogaiu tree-sitter-clojure@0.4.0 source IS in the bun cache, but it is a DIFFERENT grammar from the wired wasm (the wired build's vocabulary is the fork's), so vendoring it would put a mismatched source in-tree next to the wired bytes — worse than no source. No yogthos source exists locally.",
    },
    decision:
      "Pin the bytes to their named release: the wired wasm matches @yogthos/tree-sitter-clojure@0.0.14's published file hash and byte length, so the fork and its version are no longer only a commit message's claim. The alternative that was measured and rejected stays recorded: canonical sogaiu 0.4.0 failed 128/141 corpus files (34972a88) while the wired fork leaves 2 of 585 damaged. A maintained fork (tree-sitter-clojure-orchard v0.2.8) is the obvious upgrade candidate but is unobtainable offline, so no claim is made about it.",
    alternatives: [
      {
        option: "canonical sogaiu tree-sitter-clojure 0.4.0",
        measured: "128/141 corpus files with grammar errors (from 34972a88); the wired fork: 2/585 damaged",
        artifact: "validation/m12/results/clojure-differential.json",
      },
    ],
    evidence: [
      "validation/m14/results/wasm-provenance-census.json",
      "validation/m14/results/family-grammar-fingerprints.json",
    ],
    copies: [{ label: "mirror", path: path.join(MIRROR, "tree-sitter-clojure.wasm") }],
  },

  clean: {
    wired: "wasm/tree-sitter-clean.wasm",
    provenance: {
      kind: "local-rebuild-from-upstream-source",
      base: { repo: "tclem/tree-sitter-clean", version: "1.2.7" },
      patches: [],
      patchEvidence: "reviews/m60-clean-grammar-127-adjudication.md",
      chain:
        "pinned v1.2.7 by commit 2bc64693 (wasm sha 9ea8525d, replacing 2b805890 of v1.2.4); that round verified the tracked source tree byte-identical to `git archive v1.2.7` through the production engine, with G1/G2 adjudication in reviews/m60-clean-grammar-127-adjudication.md. The source tree itself is NOT in this repo and these wasm bytes exist in no local copy, so the pin is sha + surface + that adjudication. External corroboration recorded this round: npm's tree-sitter-clean@1.2.7 does exist, and its published file listing (jsDelivr) carries per-file sha256 for grammar.js, src/scanner.c, src/grammar.json and src/node-types.json — but the package ships NO wasm, so the wired bytes cannot be hash-matched to a published artifact and are not claimed to be.",
    },
    source: {
      state: "not-obtainable-offline",
      note:
        "the bun cache holds only tree-sitter-clean@1.2.0 (an older release whose tarball ships no wasm); nothing on this machine carries v1.2.7's source or bytes. The version claim rests on 2bc64693's own instruments (the differential table's sha, the adjudication doc, spec/clean-completeness.json).",
    },
    decision:
      "Keep v1.2.7 (already pin-verified by the clean round) and fold it into this registry so the family has one place that answers the question. For clean the answer is a sha + surface + a named adjudication: v1.2.7's npm package publishes source but no wasm, and no v1.2.7 source or bytes exist on this machine, so the version identity rests on 2bc64693's instruments (both now externally corroborated as existing) rather than on a vendored tree. Vendoring v1.2.7's source from npm is the natural next act for this lane and is unobtainable offline.",
    alternatives: [
      {
        option: "stay on v1.2.4 (sha 2b805890)",
        measured: "damaged files 67/312, MISSING 148, ERROR lines 6,508 → v1.2.7: 37/312, 9, 2,426, none newly damaged (G1)",
        artifact: "reviews/m60-clean-grammar-127-adjudication.md",
      },
    ],
    evidence: ["reviews/m60-clean-grammar-127-adjudication.md"],
    copies: [],
  },

  // M60 HCL wave (2026-09-26). The survey's own hcl row is what surfaced this:
  // `declared.versionKnown: false` with the version readable only from a prose
  // `Parser:` line, and `upstream.available: false` for the wired chain — the
  // "unversioned blob" shape §7c was written about. hcl is the DATA/Config lane
  // of Terraform, and it had the largest measured correctness gap of any lane at
  // the time (94.2% reference recall, 0/138353 lined relationships), so the one
  // thing that must not be in doubt is which grammar the analyzer is reading.
  hcl: {
    wired: "wasm/tree-sitter-hcl.wasm",
    provenance: {
      kind: "byte-identical-to-third-party-package",
      package: "@tree-sitter-grammars/tree-sitter-hcl",
      version: "1.2.0",
      upstream: {
        repo: "tree-sitter-grammars/tree-sitter-hcl",
        version: "1.2.0",
        rev: "64ad62785d442eb4d45df3a1764962dafd5bc98b",
        builtWith: "tree-sitter build --wasm (rebuildable from grammars/tree-sitter-hcl)",
      },
    },
    source: {
      state: "vendored",
      dir: "grammars/tree-sitter-hcl",
      note:
        "grammar.js + package.json + tree-sitter.json + LICENSE + README.md + CHANGELOG.md + PIN.md + src/ (grammar.json, node-types.json, scanner.c, parser.c, tree_sitter/ headers), byte-for-byte from a checkout of tree-sitter-grammars/tree-sitter-hcl@64ad6278 kept at $HOME/fixtures/hcl/ts-grammars-hcl. Unlike haskell/elixir/fsharp, src/parser.c IS vendored (600 KB, small enough to keep), so the wired wasm is rebuildable from this directory alone with `tree-sitter build --wasm` and the pin is not only a hash.",
    },
    decision:
      "Pin as-is. The wired wasm's enumerable surface, read through web-tree-sitter's Language API, is 121 ids / 64 named / 2 fields (key, val); the vendored src/node-types.json at 64ad6278 declares exactly 64 named types and exactly those 2 fields. The set difference is ZERO in both directions, which is the source-to-wasm proof the gate below re-measures. So the wired bytes ARE a build of this source and the Groovy situation — a vendored wasm that had drifted from upstream and needed manual repair — does NOT apply to HCL. 1.2.0 is also the only release of the only published HCL grammar package, the repository is not archived, and its last commit (2026-01-17) is the one that taught the grammar the `.tofu` extension this engine routes to hcl (language-detection.ts:47). There is nothing better to move to, so the pin's value is provenance and drift detection, not an upgrade.",
    alternatives: [
      {
        option: "hand-repair the wasm the way groovy's was repaired",
        measured:
          "unnecessary and wrong here: the repair exists because a vendored wasm had drifted from its source. HCL's does not — 0 missing and 0 extra node types against upstream, 0 missing and 0 extra fields. Recorded as rejected so the question is not reopened.",
        artifact: "fixtures/hcl/out/grammar-conformance.json",
      },
    ],
    evidence: [
      "validation/m60/grammar-survey.json",
      "fixtures/hcl/out/grammar-conformance.json",
      "grammars/tree-sitter-hcl/PIN.md",
      "reviews/hcl/master-review.md",
    ],
    // `copies` is the byte-identity list and every entry must be a FILE the gate
    // can hash, so the upstream checkout the source was vendored from is named in
    // the source note and the evidence list rather than here.
    copies: [{ label: "mirror", path: path.join(MIRROR, "tree-sitter-hcl.wasm") }],
  },

  // M60 Make wave, REVISED (2026-09-28). The pin started as a plain
  // byte-identical-to-upstream record and is now a LOCAL BUILD FROM PATCHED
  // UPSTREAM SOURCE, which is a different kind of claim and is recorded as one.
  //
  // Why: upstream `tree-sitter-make` 1.1.1 is the HEAD of the only maintained
  // grammar of its kind, so there is nothing to swap to — the question is only
  // whether it models the language. It does not. Over the lane's 99-file pinned
  // corpus the pristine build emits 11 ERROR nodes in 3 files, every one a
  // construct GNU Make documents: the target-scoped form `target: export VAR =
  // value` (8 nodes, 9 invisible variables) and `$$($(VAR) cmd)` (1 node,
  // `MAIN_PACKAGES` lost). Both were first recorded as OPEN gaps with the
  // decision NOT to patch, on the grounds that a clean source<->wasm identity
  // proof was worth more than 9 declarations.
  //
  // That trade was then measured instead of assumed, and it does not hold. The
  // two patches add NO node type and NO field — 44 named / 24 fields before and
  // after, zero added, zero removed — so the proof has nothing to lose, and the
  // proof is re-established below for the PATCHED source. Measured: 11 -> 0
  // error nodes, 3 files improved, 0 regressed, and at the PRODUCT level 1,772
  // -> 1,781 symbols and 5,870 -> 5,880 relationships, with all 19 "lost" facts
  // being garbage the error recovery had invented (a `?` as a name, a whole
  // `VAR=value` as a name) or a reference re-attributed to its correct owner.
  //
  // The analyzer needed no change, which is the strongest evidence the patch is
  // well-founded: the constructs it repairs were already modelled, just
  // unreachable. The pristine build and the patch are retained under
  // grammars/tree-sitter-make/ab/ so the comparison stays re-runnable forever.
  make: {
    wired: "wasm/tree-sitter-make.wasm",
    provenance: {
      kind: "local-rebuild-from-patched-upstream-source",
      package: "tree-sitter-make",
      version: "1.1.1",
      upstream: {
        repo: "tree-sitter-grammars/tree-sitter-make",
        version: "1.1.1",
        rev: "70613f3d812cbabbd7f38d104d60a409c4008b43",
        builtWith: "tree-sitter-cli generate + build --wasm (rebuildable from grammars/tree-sitter-make)",
      },
      patches: [
        "P1 (grammar.js `_ordinary_rule`): a second branch for the TARGET-SCOPED form `target: export VAR = value`. `variable_assignment` already accepts an optional leading `list ':'` so `target: VAR = value` parsed, but `export_directive` places the `export` keyword BEFORE the assignment and nothing allowed it after the colon. Measured: 8 of the corpus's 11 ERROR nodes, and 9 variable names the analyzer could not see (BOUNDARY_INSTALL_BINARY, SKIP_PLUGIN_BUILD, UI_CLONE_DIR, UI_COMMITISH, UI_DEFAULT_BRANCH, UI_VERSION_FILE, GOOS, GOARCH).",
        "P2 (grammar.js `_shell_escape`): `$$( ... )` is Make's ESCAPED dollar — Make does not expand it and hands `$( ... )` to the shell. The grammar routed `$$` into variable_reference / substitution_reference / automatic_variable / function_call, none of which can parse a shell command head (spaces, pipes). A hidden rule keyed on `$$` ONLY, so `$(FOO)` is still a variable reference, with the variable_reference/_paren_text ambiguity DECLARED as a conflict and resolved by dynamic precedence rather than a static one.",
      ],
      patchEvidence: "Surface A/B over all 99 pinned corpus files, plus a PRODUCT-level A/B through RealMakefileAnalyzer: 11 -> 0 error nodes, 3 files improved, 0 regressed; 1,772 -> 1,781 symbols and 5,870 -> 5,880 relationships, with all 19 lost facts being error-recovery garbage or a reference re-attributed to its correct owner. The named node-type set and the field set are IDENTICAL before and after (44 / 24, zero added, zero removed), which is why no analyzer change was required. A control build of the UNPATCHED source with the same toolchain is functionally identical to the wired pristine build (same 188 ids, 44 named, 24 fields, 6 error files, 11 error nodes), so every difference is the patch and not the toolchain. Re-runnable IN-REPO: script/m14/tmp/make/grammar-ab.mts over grammars/tree-sitter-make/ab/pristine-make.wasm.",
      retained: "grammars/tree-sitter-make/ab/{pristine-grammar.js,grammar.patch,pristine-make.wasm} — IN THE REPO, not a scratch dir, so the A/B above can be repeated from a clone rather than believed. The ab dir is 167 KB and is re-checked by grammar-conformance.mts on every run: pristine-grammar.js + grammar.patch must regenerate the wired grammar.js byte for byte, and pristine-make.wasm must be the sha recorded above.",
    },
    source: {
      state: "vendored",
      dir: "grammars/tree-sitter-make",
      note:
        "grammar.js (PATCHED — it is the patched grammar.js that is vendored, because the pin must describe what is actually wired) + package.json + LICENSE + PIN.md + src/ (grammar.json, node-types.json, parser.c, tree_sitter/ headers). src/parser.c IS vendored (1,084,442 bytes) so the source<->wasm proof is re-checkable offline; unlike the xml/sql lanes this lane's central claim IS that proof.",
    },
    decision:
      "ADOPT the patched local build, and keep the pristine one forever. The pristine build is not merely 'not good enough' — it loses 9 declarations the product can see and invents facts like a `?` used as a variable name. The patches add no node type and no field, so the source<->wasm identity proof is fully preserved and re-measured for the patched source: 189 ids / 44 named / 131 anonymous / 24 fields against 44 declared named types and 24 declared fields, zero missing and zero extra in both directions. Adopting an upstream SWAP was never on the table — 1.1.1 is the current HEAD of the only maintained tree-sitter-make, so the pin's value is correctness of the model, not novelty of the version.",
    alternatives: [
      {
        option: "keep the pristine build and the two gaps open",
        measured:
          "REJECTED on measurement, having been the lane's position for a day. 11 ERROR nodes over 99 files, 9 invisible variable declarations, and error-recovery artefacts published as facts (a `?` as a name; `BOUNDARY_INSTALL_BINARY=1` as a name). The argument for it — that patching costs the identity proof — is answered by the patches adding no node type and no field, so the proof costs nothing.",
        artifact: "fixtures/make/out/grammar-ab.json",
      },
      {
        option: "hand-repair the wasm the way groovy's was repaired",
        measured:
          "unnecessary and wrong here: that repair exists because a vendored wasm had drifted from its source. This lane regenerates from source with a recorded toolchain and keeps the pristine build for A/B, so the drift cannot recur unobserved.",
        artifact: "fixtures/make/out/grammar-ab.json",
      },
    ],
    evidence: [
      "fixtures/make/out/grammar-ab.json",
      "fixtures/make/out/grammar-ab-product.json",
      "fixtures/make/out/grammar-conformance.json",
      "grammars/tree-sitter-make/PIN.md",
      "reviews/make/master-review.md",
    ],
    copies: [{ label: "mirror", path: path.join(MIRROR, "tree-sitter-make.wasm") }],
  },

  // M14.6 perl wave (2026-09-26). The perl lane's own review is what put it
  // here: it read the pinned grammar's enumerable surface directly and found
  // that the wired build gives ONE field name to SEVERAL children of a
  // parenthesised construct, so `childForFieldName("right"/"arguments"/
  // "invocant")` returns an empty `(` marker and the payload is unreachable —
  // 39,897 such sites across 41 field pairs on 5,875 corpus files. That is
  // precisely the "unversioned blob" hazard §7c describes: nobody could
  // answer "which build is this, and is a newer one better?" from the repo.
  //
  // Both answers are measured here:
  //   PROVENANCE — a fresh build of tree-sitter-perl@1.2.1 from the vendored
  //     source reproduces the wired idOrderDigest, typeSetDigest and
  //     fieldSetDigest exactly, and produces IDENTICAL trees on 275/275 mojo
  //     files. The wired bytes are a build of 1.2.1's source, established
  //     offline by the source↔wasm check and confirmed at tree level.
  //   UPGRADE — 2.0.0 is published and declares exactly one new type,
  //     `parenthesized_expression`, which is the wrapper that removes the
  //     multi-child field. It cuts the unreachable-payload sites from 39,897 to
  //     1,419 (3,049 -> 564 affected files of 5,875), leaves parse damage
  //     unchanged (4/275), and changes 123 of 275 mojo trees. The analyzer is
  //     already correct under both builds — 5,847 of 5,875 files emit
  //     identical symbols/relationships/imports/exports — so the bump needs no
  //     analyzer work; it is NOT taken here because it would re-baseline the
  //     M12 corpus claims and every other lane's pinned row for a gain that is
  //     already fully captured by the analyzer's fieldNodes() read.
  // C++ — added 2026-09-29 by the cpp deep review. The lane had NO pin at all,
  // and the version string in tree-sitter.json understated what is wired: the
  // bytes are a LOCAL FORK of 0.23.4, not the published release. Every claim below
  // is measured, and the measurements are re-runnable:
  //   bun run script/cpp-review/grammar-provenance.ts wasm/tree-sitter-cpp.wasm <tarball>/package/tree-sitter-cpp.wasm <repo...>
  cpp: {
    wired: "wasm/tree-sitter-cpp.wasm",
    provenance: {
      kind: "local-rebuild-from-vendored-source",
      base: { repo: "tree-sitter/tree-sitter-cpp", version: "0.23.4" },
      patches: [
        "#743 (rebuildability): `require('tree-sitter-c/grammar')` -> `require('../tree-sitter-c/grammar.js')`. Upstream reads the C grammar through a node_modules entry, and node_modules/ is gitignored repo-wide, so the require made this grammar unrebuildable from a fresh checkout. The C grammar is vendored beside it, so the dependency became a relative path; the same parser.c is generated, with no install step.",
        "#743 (C++ port of the C wave, NARROWED for `::`): a new `macro_prefixed_type_specifier` rule = `prec(-1, seq(alias($.identifier, $.macro_specifier), $._macro_decorated_type))`, with `_macro_decorated_type` restricted to the KEYWORD-LED specifiers (struct/union/enum/class/sized_type_specifier/primitive_type/decltype). The C rule it ports uses the FULL type_specifier, and that breadth does not port: in cpp `_scope_resolution` has an OPTIONAL scope, so `A::B` reads as either the qualified type `A::B` or macro `A` decorating `::B`. Ported verbatim, the new derivation demanded a conflict declaration, and declaring it flipped runtime path selection in unrelated code — `fmt::format_to(std::back_inserter(buf), ...)` parsed as a DECLARATION of a function named `::format_to` in a file with zero ERRORs before and after. `A::B` was never a macro decoration, so the fix removes the ambiguity rather than arbitrating it: restricting the decorated type to keyword-led specifiers makes the bad derivation ungrammatical, and no identifier can start any of them, so no conflict is even possible.",
        "#743 (header name): a `preproc_header_name` token, so a header can be an ARGUMENT of a preprocessor conditional (`#if __has_include(<vector>)`). The rule is scoped to the argument position because `<` cannot BEGIN a preprocessor expression (the unary operators are `! ~ - +`), so no competing `<` token exists there and the header token wins purely on match length; adding `<...>` anywhere in `_preproc_expression` instead would read `< B && C >` as a header name and turn every comparison into something else.",
      ],
      patchEvidence:
        "The vendored tree is byte-identical to the tree-sitter-cpp@0.23.4 npm tarball for 4 of its 5 files (src/scanner.c cf60387d, tree-sitter.json ce25741b, LICENSE 2e0110e0, package.json bfde98d5) and DIFFERS in exactly one: grammar.js (upstream d0242291 -> vendored 817fc8a0, +54/-2 lines, which is the three patches above and nothing else). The wired wasm is NOT the published bytes: 3,552,974 vs the tarball's 3,434,931, because it was rebuilt with the patches. The fork adds three named node types and no fields — macro_prefixed_type_specifier, macro_specifier, preproc_header_name — with namedIds 256 -> 259, namedUnique 206 -> 209, and an UNCHANGED fieldSetDigest (891be791). The patches are LOAD-BEARING, not cosmetic: over this lane's own 28 cpp fixtures the fork parses 22 clean against upstream's 20, and the two files that separate them are cpp/preproc-has-include.cpp and cpp/macro-decorated-specifier.cpp — the fixtures that were written FOR those two rules, which do not parse at all without them. On the fmt corpus the two agree on all 47 files, so the fork neither helps nor hurts ordinary library C++.",
    },
    source: {
      state: "vendored",
      dir: "grammars/tree-sitter-cpp",
      note:
        "grammar.js (the FORKED file, see patches) + src/scanner.c + tree-sitter.json + package.json + LICENSE. Four of the five are byte-for-byte from the npm tarball tree-sitter-cpp@0.23.4; grammar.js carries the three #743 patches. The GENERATED src/ (parser.c, grammar.json, node-types.json, tree_sitter/ headers) is NOT vendored, so the offline source<->wasm proof reports `not applicable` for this lane. That is a lane-specific reason, not the generic '41 MB, do not vendor' one the unpatched lanes give: publishing tree-sitter-cpp@0.23.4's own generated JSONs would make the check run and report a PERMANENT three-type delta (macro_prefixed_type_specifier, macro_specifier, preproc_header_name present in the wasm and absent from the source), because the fork's JSONs are what the proof would need and they can only be produced by `tree-sitter generate` from the forked grammar.js. A generated file that must be hand-corrected to make a proof pass is worse than a proof that honestly says it does not apply, so the surface is pinned by the digests below and the fork by the three named types named in the provenance. Rebuild with `tree-sitter generate` then `tree-sitter build --wasm`, from a tree that also has grammars/tree-sitter-c present — grammar.js requires ../tree-sitter-c/grammar.js, so unlike every unpatched lane this one is NOT rebuildable from its own directory alone.",
    },
    decision:
      "Pin as-is, as a local rebuild from vendored source with the patch set recorded. The wired bytes are not the published release and must not be recorded as such: a reader who ran `npm pack tree-sitter-cpp@0.23.4` and compared would find a 118 KB difference and no way to account for it, which is precisely the failure M63.5 (#954, 'bind corpus measurements to a grammar hash') is about. The patch set is small, fully enumerated above, and provably load-bearing, so the honest record is the base version PLUS the patches — not the base version alone, which is what the analyzer's own documentation claimed until this entry existed ('Parser: tree-sitter-cpp 0.23.4 (npm, latest)'). A version-only string cannot express a fork, and tree-sitter.json's own `metadata.version: 0.23.4` does not either.",
    alternatives: [
      {
        option: "keep the wired fork (sha 5a1b78be)",
        measured:
          "28/28 cpp fixtures parse; the differential's fmt:cpp and nlohmann-json:cpp rows are measured against these bytes; 47/47 identical trees to upstream on fmt, and 22 vs 20 clean fixtures overall",
        artifact: "script/cpp-review/grammar-provenance.ts",
      },
      {
        option: "swap to the published tree-sitter-cpp@0.23.4 wasm",
        measured:
          "cpp/preproc-has-include.cpp and cpp/macro-decorated-specifier.cpp stop parsing (2 of 28 fixtures go from clean to errored) and the #743 header-name and macro-decorator rules are lost with them; surface drops to 256 named ids",
        artifact: "script/cpp-review/grammar-provenance.ts",
      },
      {
        option: "drop the fork and re-apply the patches upstream",
        measured:
          "NOT MEASURED — recorded as the obvious successor rather than a claim. The three patches are the kind that belong in tree-sitter-cpp (the C wave already landed the first of them there), but this repo cannot verify an upstream merge, and an unverified successor is worse than a recorded fork.",
        artifact: "n/a — see the note; nothing is claimed",
      },
    ],
    evidence: [
      "validation/m14/results/cpp-defect-register.json",
      "script/cpp-review/grammar-provenance.ts",
      "script/m12/cpp-node-types-compare.ts",
      "script/m12/cpp-wasm-compare.ts",
      "docs/analyzers/real-cpp-analyzer.md",
    ],
    copies: [
      { label: "mirror", path: path.join(MIRROR, "tree-sitter-cpp.wasm") },
    ],
    notVendored: [
      { path: "binding.gyp, bindings/, prebuilds/", why: "native bindings; not parser source" },
      { path: "queries/", why: "editor queries; the engine does not load them" },
      { path: "src/parser.c, src/grammar.json, src/node-types.json, src/tree_sitter/", why: "generated from the FORKED grammar.js; publishing upstream's would make the source-vs-wasm check report a permanent 3-type delta (the fork's own types), so the proof is recorded as not applicable and the surface is pinned by digest instead" },
      { path: "README.md, CHANGELOG.md", why: "upstream docs; the provenance and decision live in this record" },
      { path: "tree-sitter-cpp.wasm", why: "the wired bytes; they live at wasm/ and are pinned by sha here" },
    ],
  },

  perl: {
    wired: "wasm/tree-sitter-perl.wasm",
    provenance: {
      kind: "unnamed-build-sha-only",
      chain:
        "the wired bytes match no published prebuilt (neither tree-sitter-perl@1.2.1 nor @2.0.0 ships a wasm in its npm tarball, and tree-sitter-wasms@0.1.13/out has no tree-sitter-perl.wasm), so the build is recorded by sha + surface. Its SOURCE is now pinned: a fresh emcc build of the vendored tree-sitter-perl@1.2.1 source (emscripten/emsdk:3.1.64, `-shared -O2 -sSIDE_MODULE=1`) reproduces the wired idOrderDigest c954cfdc, typeSetDigest 61033c08 and fieldSetDigest d0e6aa8f exactly, and yields identical trees on 275/275 mojo files — the registry's own rule (two builds of one source agree even when their bytes differ), so the wired bytes ARE a build of 1.2.1's source. validation/m12/corpus-manifest.json already recorded the 1.2.1 upgrade; this entry makes it verifiable rather than asserted.",
    },
    source: {
      state: "vendored",
      dir: "grammars/tree-sitter-perl",
      note:
        "grammar.js + src/ (scanner.c, grammar.json, node-types.json, the tsp_*.h scanner headers, bsearch.h, tree_sitter/ headers) + package.json + LICENSE + README.md, byte-for-byte from the npm tarball tree-sitter-perl@1.2.1. The GENERATED src/parser.c (29 MB here) is deliberately not vendored, for the same reason as haskell's and elixir's: `tree-sitter generate` rebuilds it from grammar.js, and the source↔wasm check below runs on the generated JSONs, not on parser.c.",
    },
    decision:
      "Pin as-is: the wired wasm is a build of tree-sitter-perl@1.2.1 — the newest release at the time this lane was first measured — proven by surface identity against a fresh build AND by 275/275 identical trees on the M12 pinned corpus, and that source is now vendored in-tree with per-file hashes so it cannot drift unnoticed. tree-sitter-perl@2.0.0 is the newer release and it is BETTER on the one axis this lane was weakest on (it removes the multi-child paren field that hid 39,897 payloads), but it is refused for this wave: it changes 123 of 275 trees on the M12 pinned corpus and would invalidate the M12 corpus claims and every other lane's pinned F5 row, and it buys the analyzer nothing it does not already have (identical emissions on 5,847 of 5,875 files). Take it as a scheduled grammar bump with a re-baseline, not as a silent swap.",
    alternatives: [
      {
        option: "keep the wired 1.2.1 build (sha ac0248ed)",
        measured:
          "identical trees on 275/275 mojo files vs a fresh 1.2.1 build; parse damage 4/275 files, 5 error nodes; the analyzer's fieldNodes() read recovers every payload the multi-child field hides, and 5,847 of 5,875 corpus files emit identically under 1.2.1 and 2.0.0",
        artifact: "fixtures/perl/out/grammar-ab.json",
      },
      {
        option: "upstream 2.0.0 (npm source, freshly built)",
        measured:
          "unreachable payload sites 39,897 -> 1,419 and affected files 3,049 -> 564 of 5,875; 36 of the 41 affected field pairs eliminated; parse damage unchanged at 4/275; but 123 of 275 mojo trees differ, and a parenthesised `use Module (...)` argument list carries no field at all in 2.0.0, so a field-driven import read sees nothing until the analyzer descends through the wrapper",
        artifact: "fixtures/perl/out/grammar-ab.json",
      },
    ],
    evidence: [
      "fixtures/perl/out/grammar-ab.json",
      "fixtures/perl/out/grammar-pin-survey.json",
      "fixtures/perl/out/forward-compat-detail.json",
      "reviews/perl/master-review.md",
    ],
    copies: [],
    notVendored: [
      { path: "binding.gyp, bindings/", why: "native node bindings; not parser source" },
      { path: "queries/", why: "editor queries; the engine does not load them" },
      { path: "src/parser.c", why: "generated from grammar.js; 29 MB; `tree-sitter generate` rebuilds it" },
      { path: "tree-sitter-perl.wasm", why: "the wired bytes; they live at wasm/ and are pinned by sha here" },
    ],
  },

  // The GraphQL lane joined 2026-09-27 with the M12.38/#177 analyzer wave, and
  // it is the first lane in this file whose wired bytes are a build of a
  // PATCHED source rather than of an upstream release. Two facts make that
  // necessary rather than convenient, and both are measurements:
  //
  //   1. The previous wasm rejected 10 of 113 specification constructs, and the
  //      two worst were not exotic: `interface I implements J` (spec §3.7, the
  //      interfaces-may-implement-interfaces feature of June 2018) and a
  //      DESCRIPTION ON A `schema` BLOCK. The second is the severe one: a
  //      described schema degraded to a top-level ERROR whose recovery turned
  //      the `schema { query: Query … }` body into an OperationDefinition, so
  //      the analyzer lost the `schema` namespace, both root operation types
  //      and four relationships, and published a phantom
  //      `Anonymous_query_4` method plus two invented `field_selection` edges
  //      whose targets (`Query`, `Mutation`) are real symbol names. Measured on
  //      the corpus: 12 of 47 files errored under the previous wasm, 4 under
  //      this one.
  //   2. Upstream `main` fixes (1) and adds a directive description rule, but
  //      renames every rule to snake_case, which is a NON-START for this
  //      repository: the analyzer dispatches on `node.type === "ObjectType-
  //      Definition"`, so upstream's spelling routes every construct through
  //      the analyzer's default arm. A pure upgrade is therefore not an option
  //      and a pure pin is not an option either.
  //
  // So: upstream is vendored verbatim, `port.py` applies the rename plus four
  // anchored FIXes, and the wasm is built from the result. The patch is code
  // rather than a hand edit so that it is reviewable as a diff and idempotent
  // on re-run.
  protobuf: {
    wired: "wasm/tree-sitter-protobuf.wasm",
    provenance: {
      kind: "local-rebuild-from-patched-vendored-source",
      base: { repo: "amaanq/tree-sitter-proto", version: "0.1.0", rev: "e9f6b43f6844bd2189b50a422d4e2094313f6aa3" },
      acquisition:
        "THE HARD CONSTRAINT ON THIS LANE, recorded because it shapes everything else. `ProtocolBuffers/tree-sitter-proto` and `tree-sitter-grammars/tree-sitter-protobuf` do not exist, and NO protobuf grammar is published on npm at all — `tree-sitter-protobuf`, `tree-sitter-proto` and `tree-sitter-protocolbuffers` are all absent from the registry. So there was no registry route and no canonical vendor: the source had to be cloned, and `tree-sitter.json` had to be WRITTEN, because upstream has none and without it the CLI silently falls back to ABI 14 and `tree-sitter build --wasm` refuses outright. Nine of the sixteen vendored grammars here are registry packages; this one is a local build because it has to be.",
      patches: [
        "FIX 1 `edition` — the 2023-editions file option. Upstream's root was `optional($.syntax)` only, and in an editions file `edition` REPLACES `syntax` rather than being an alternative spelling, so every editions file was 2 ERROR nodes. 52 of the reference implementation's 108 files declare one.",
        "FIX 2 negative field numbers — `field_number` was a bare `int_lit` with no sign. The specification's field-number space is the signed 32-bit range with 19000-19999 reserved, so negative numbers are legal and occur in migrated schemas. The sign is a separate optional token rather than a change to `int_lit`, so a sign cannot appear where the grammar forbids one.",
        "FIX 3 `import option \"...\";` — editions' option-import, the mechanism behind `features`. Upstream's `import` allowed only `weak`/`public`. This was most of `descriptor.proto`'s damage.",
        "FIX 4 an option list on `extensions` — upstream ended at `;`, so `extensions 536000000 [declaration = {…}];` was an ERROR. This is how `descriptor.proto` declares its own extension range, and the aggregate inside it failed too, so one construct took 70 error nodes with it.",
        "FIX 5 proto2 `group` — absent entirely upstream. Structurally a FIELD whose type is the keyword `group` and whose body is a nested message rather than a `;`, so it is a second alternative of `field`; sharing the terminator would need an empty rule, which tree-sitter rejects. 12 of the 108 reference files use it, so ruling it would have left the lane unable to read a quarter of protobuf's own corpus.",
        "FIX 6 a parenthesised `(fullIdent)` as ANY dotted option-name segment — upstream allowed it only as the first element, so `features.(pb.cpp).repeated_type` and `(a.b).(c.d)` were ERRORs. Both appear in the reference implementation's own option tests: 16 nodes in `repeated_field_proxy_test.proto`, 19 in `unittest_custom_options.proto`.",
        "FIX 7 a leading dot on an `extend` target — upstream's `extend` used `full_ident` (no leading dot) while `message_or_enum_type` had one, so `extend .google.protobuf.FieldOptions {…}` was an ERROR. Fully qualified extend targets are the norm in real schemas, not an edge case. The dot stays anonymous, so no node type is added.",
        "FIX 8 the `local` declaration modifier — a 2023-editions top-level modifier on message/enum/service/extend, unknown upstream and used by the reference implementation's own `cpp_file_options.proto`. Anonymous and optional, so a consumer sees the same node either way.",
        "ADDED tree-sitter.json (not a grammar patch): the ABI-15 marker upstream lacks. Without it the CLI generates ABI 14 and `tree-sitter build --wasm` fails with \"please ensure you have one\".",
      ],
      ruled: [
        "`any { … }` — the proto2 MessageSet form inside a group. RULED, with the consequence measured rather than asserted. The specification deprecates MessageSet outright; it appears in 1 file of 108, and that file is `unittest_custom_options.proto`, the reference implementation's deliberate parser-breaking torture test. Consequence: 13 ERROR nodes in that one file. Every OTHER construct in that same file parses correctly in isolation — verified by extracting each and parsing it alone — so the errors reported on lines 338-341 are tree-sitter's RECOVERY misattributing damage from the `any { }` further down, not separate defects. A file using MessageSet loses that construct's fields, not the file.",
      ],
      patchEvidence:
        "Measured on `protocolbuffers/protobuf` @ the pinned revision — the reference implementation's OWN 108 .proto files, 17,213 lines, which is the strongest correctness test available because the language's own descriptor.proto is the file every protobuf tool reads. Error progression on that corpus: upstream as published 62 files / 527 nodes; +FIX 1-2, 28 / 421; +FIX 3-5, 12 / 79; +FIX 6-8, 1 / 13. A 97.5% reduction in error nodes, and the 70-error failure on descriptor.proto is gone entirely. Each patch has its own case in fixtures/protobuf/out/grammar-gaps.json, and each was confirmed NECESSARY by building upstream and watching that construct fail there too. Artifacts: fixtures/protobuf/out/grammar-gaps.json, fixtures/protobuf/out/grammar-ab.json, fixtures/protobuf/out/extraction-ab.json.",
      upstreamClaimVsMeasurement:
        "Upstream's README says \"The grammar should be complete. I've tested the grammar against some really large and nasty proto files and it passes.\" Measured: 62 of 108 files of protobuf's own corpus carried 527 ERROR nodes before patching. The claim is recorded because it was measured false, and because a 0-star, 0-fork repository created and last pushed on the same day is not a foundation to take on trust.",
    },
    source: {
      state: "vendored",
      dir: "grammars/tree-sitter-proto",
      note:
        "grammar.js (the PATCHED grammar, which is what `tree-sitter generate` reads) + src/{grammar.json,node-types.json,parser.c} + tree-sitter.json (written by us: the ABI-15 marker upstream lacks) + package.json + LICENSE (MIT) + README.md (the divergence record, all eight patches with their evidence, the ruled gap with its consequence, and the regeneration sequence) + queries/ (upstream's, carried through untouched) + .upstream-revision. The three generated files are vendored ON PURPOSE: `sourceVsWasmFor` needs the JSON pair for the offline source<->wasm proof, and `measureVendored` hashes EVERY file in the tree, tracked or not, so an untracked parser.c would turn the gate red after any `tree-sitter generate`. 299 KB here — the same call graphql made at 283 KB and hcl at 600 KB, and the opposite of nim at 41 MB. The .gitignore DIRECTORY re-inclusion matters as much as the file negations: git does not descend into an excluded directory, so negating the files alone is silently a no-op.",
    },
    decision:
      "Pin the local rebuild of the PATCHED vendored source. (1) The offline source<->wasm proof runs and is zero in both directions, re-measured by this gate on every run — every name the committed source declares exists in the wired wasm, and every wasm-named type is declared by the source. That is the offline statement that the committed bytes ARE a build of the committed source. (2) The build reads 107 of protobuf's own 108 reference files with ZERO error nodes, against 62 files / 527 nodes for upstream as published, and the one remaining file is a construct the specification itself deprecates. (3) The pre-patch wasm is kept byte-for-byte so the extraction A/B is reproducible rather than remembered, and the direction is uniform: strictly fewer error files and fewer error nodes, with no construct traded away — the eight patches are all ADDITIVE and the one change that narrowed a rule (the `field` terminator) was required because the group alternative cannot share it. (4) The snake_case node surface is preserved exactly, matching nine of the ten vendored grammars here, so no analyzer string literal and no m12/m14/m60 row changes spelling — the one thing an upgrade must not do to this repository.",
    alternatives: [
      {
        option: "remove the protobuf route and the m60 matrix row, and document protobuf as unsupported",
        measured:
          "REJECTED, and the measurement is the point. This was the live alternative while the grammar was missing, and it is a defensible fallback: `.proto` was ROUTED, so a protobuf file threw an unhandled \"parser not yet implemented\" rather than degrading, and protobuf is the only one of 47 routed languages whose failure is that deliberate marker. But protobuf is the most widely deployed IDL in existence — gRPC, Kubernetes, etcd, Envoy/Istio, Consul, Vault, CockroachDB — so removing the claim trades a crash for a missing capability rather than fixing anything. It is the correct answer only if the grammar could not be made to work, and it now reads 107/108 of the language's own corpus.",
        artifact: "reviews/protobuf/master-review.md",
      },
      {
        option: "keep upstream unmodified and document the eight gaps as boundaries",
        measured:
          "REJECTED on capability. 62 of 108 files of protobuf's own corpus carry error nodes before patching, and 70 of those are in descriptor.proto — the file every protobuf tool reads. A documented boundary is the right answer for a gap nobody can fix; a construct that breaks the language's own descriptor is not that. Two of the eight (editions, and `import option`) are not gaps in a rare corner at all: 52 of the 108 files declare an edition, so half the reference corpus is unreadable without FIX 1.",
        artifact: "fixtures/protobuf/out/grammar-ab.json",
      },
    ],
    evidence: [
      "fixtures/protobuf/out/grammar-census.json",
      "fixtures/protobuf/out/grammar-gaps.json",
      "fixtures/protobuf/out/grammar-ab.json",
      "fixtures/protobuf/out/extraction-ab.json",
    ],
    copies: [{ label: "mirror", path: path.join(MIRROR, "tree-sitter-protobuf.wasm") }],
    notVendored: [
      { path: "binding.gyp, bindings/, Cargo.toml, flake.nix, project.nix, shell.nix, .envrc", why: "native bindings and a Nix dev shell; not parser source" },
      { path: "corpus/", why: "upstream's own parse tests; the lane's corpus is the reference implementation plus two independent repositories, tracked in the manifest" },
    ],
  },

  graphql: {
    wired: "wasm/tree-sitter-graphql.wasm",
    provenance: {
      kind: "local-rebuild-from-patched-vendored-source",
      base: { repo: "bkegley/tree-sitter-graphql", version: "0.0.1", rev: "ee5ce96" },
      patches: [
        "FIX 1 (§3.18) `extend schema` gains `repeat1(root_operation_type_definition)` and an optional body, with `prec.right` for the `{` ambiguity — fixes `extend schema { query: Q mutation: M }` and Apollo Federation's bodyless `extend schema @link(...)`",
        "FIX 2 (§3.17) `scalar_type_extension`'s `$.directives` becomes `optional($.directives)` — `extend scalar S` with no directive is valid and was rejected",
        "FIX 3 (§3.3) `field`'s `optional($.directive)` becomes `optional($.directives)` — `{ f @a @b }` is the legal spelling of two directives on one selection",
        "FIX 4 (§2.9.4) both string rules learn their escapes: the short string accepts `\\` + any non-newline, the block string accepts `\"\"\"` and skips `\\` as a unit",
        "RENAME: 71 rule names snake_case -> PascalCase, pinned to the previous wasm's own `language.nodeTypeForId` table, with `source_file`/`comment`/`comma` held lower-case",
        "ADDITIVE (upstream, not ours): `optional($.description)` on `schema_definition` and `optional($.directives)` on `variable_definition`",
      ],
      patchEvidence:
        "Each FIX is one row of a 113-construct battery that names the specification section and states whether the construct is valid, so a failure can be classified as a GRAMMAR GAP (valid, rejected) or a CORRECT REJECTION (invalid, correctly rejected) rather than lumped together. Before/after on that battery: the previous wasm rejected 10 valid constructs, upstream `main` rejects 6, this build rejects 0, and all three reject the same 8 invalid constructs. The four FIXes were each confirmed to be necessary by building upstream and watching that construct fail there too. Artifacts: fixtures/graphql/out/grammar-gaps.json, fixtures/graphql/out/grammar-ab.json, fixtures/graphql/out/extraction-ab.json.",
      localCheckout:
        "The upstream checkout the tree was vendored from is at $HOME/fixtures/graphql/grammar-rebuild (grammar.js + grammar.upstream.js as cloned), and the pristine copy that `port.py` reads is committed at grammars/tree-sitter-graphql/grammar.upstream.js.",
    },
    source: {
      state: "vendored",
      dir: "grammars/tree-sitter-graphql",
      note:
        "grammar.upstream.js (bkegley/tree-sitter-graphql@ee5ce96, VERBATIM — the fixed input, so the port is idempotent) + port.py (the patch AS CODE: the rename table and the four anchored FIX hunks, each refusing to write a half-ported grammar) + grammar.js (the GENERATED patched grammar, which is what `tree-sitter generate` reads) + tree-sitter.json (ABI 15) + package.json (deliberately no `\"type\"` field: the repo root is `\"type\": \"module\"` and grammar.js is CommonJS `module.exports`, so without a local package.json the tree-sitter CLI cannot load it) + LICENSE (MIT) + README.md (the divergence record, the regeneration sequence, and what the patch bought) + src/grammar.json + src/node-types.json. The two generated JSONs are vendored ON PURPOSE: `sourceVsWasmFor` needs the pair to run the offline source<->wasm proof, and without them the check reports `not applicable` and this lane has no such proof at all. src/parser.c IS vendored (284 KB), the same call hcl made at 600 KB and the opposite of nim at 41 MB: `measureVendored` hashes every file in the tree, tracked or not, so an untracked parser.c would turn the gate red after any `tree-sitter generate`. Tracking it makes the wired wasm rebuildable from TRACKED files alone and keeps the recorded digests still across a regeneration that changed nothing else. The exact three-command sequence is in README.md. A `node_modules` symlink points at the tree-sitter CLI during a build and is not tracked.",
    },
    decision:
      "Pin the local rebuild of the PATCHED vendored source. (1) The offline source<->wasm proof runs and is zero in both directions on the declared named types, re-measured by this gate on every run: every name the committed source declares exists in the wired wasm, and every wasm-named type is declared by the source. That is the offline statement that the committed bytes ARE a build of the committed source. (2) The wired build rejects 0 of 113 specification constructs, against 10 for the wasm it replaces and 6 for upstream `main`, while still correctly rejecting all 8 invalid constructs — so the patch is a strict improvement on BOTH the previous build and upstream, and does not trade correctness for permissiveness. (3) The extraction A/B over 47 real files, same analyzer both sides, moves 12 error files to 4, 20 error nodes to 7, and ADDS 4 symbols and 76 relationships; every single delta is enumerated and adjudicated in fixtures/graphql/REVIEW.md §E, and the direction is uniform. (4) The two most consequential upstream gaps (`interface I implements J`; a description on a `schema` block) both produced PUBLISHED PHANTOMS in the previous build, not merely missing facts, so this is a correctness pin and not a completeness one. (5) The PascalCase surface is preserved exactly, so no analyzer string literal, no stored symbol row and no m12/m14/m60 lane changes spelling — the one thing an upgrade must not do to this repository.",
    alternatives: [
      {
        option: "pin the previous wasm as-is and document the two gaps as boundaries (what docs/analyzers/real-graphql-analyzer.md did)",
        measured:
          "REJECTED on evidence: 12 of 47 corpus files carry a grammar error under it, and the losses are not silent — on neo4j-graphql/.../apollo-federation-subgraph-compatibility/schema.graphql a described `extend type User` became ERROR and the analyzer published `anonymous_operation_1566 -> Int`, `-> ID`, `-> @external`, `-> @requires` (four invented references) while losing five real field symbols. A documented boundary is the right answer for a gap nobody can fix; a 12/47 error rate with phantom edges is not that.",
        artifact: "fixtures/graphql/out/extraction-ab.json",
      },
      {
        option: "upgrade to bkegley/tree-sitter-graphql main (ee5ce96) unmodified",
        measured:
          "REJECTED on capability, and this is the load-bearing measurement of the lane: upstream names its rules snake_case (`object_type_definition`). The analyzer, the m12 shape-safety census, the m14 and m60 lanes and every stored symbol row assume `ObjectTypeDefinition`. Building upstream unmodified and running the node-type set difference gives 72 node types gained and 72 lost with identical names apart from casing — i.e. every construct routes through the analyzer's default arm and the file yields nothing. It also leaves 6 of its own gaps (ext-schema-multi, ext-schema-directives-only, ext-scalar, desc-block-escaped-triple, field-two-directives, apollo-link).",
        artifact: "fixtures/graphql/out/grammar-ab.json",
      },
      {
        option: "hand-edit the vendored grammar.js in place, the way groovy's was hand-repaired",
        measured:
          "REJECTED on reviewability, and the difference is not cosmetic. A hand edit leaves no record of what upstream did, is not re-derivable when upstream moves, and cannot be diffed as a patch. port.py keeps the upstream file verbatim, expresses the patch as four anchored hunks plus a rename table, refuses to write a half-ported grammar when an anchor is missing, and re-derives grammar.js byte-identically on every run. Same bytes, reviewable provenance.",
        artifact: "grammars/tree-sitter-graphql/port.py",
      },
      {
        option: "patch the previous wasm's SOURCE, if it is available anywhere",
        measured:
          "It is not, and that is the finding rather than a workaround: the previous wasm predates `optional($.description)` on `schema_definition` and `optional($.directives)` on `variable_definition`, so it was built from a commit bkegley no longer has a tag for and which the GitHub API does not surface. The previous wasm is kept byte-for-byte at fixtures/graphql/grammar-rebuild/tree-sitter-graphql-VENDORED-BEFORE.wasm (sha256 9cd70f691576f0217834e62cd584bac603971d4c1889cbf068a1029ff2855b27) so the A/B against it is reproducible forever.",
        artifact: "fixtures/graphql/grammar-rebuild/tree-sitter-graphql-VENDORED-BEFORE.wasm",
      },
    ],
    evidence: [
      "grammars/tree-sitter-graphql/README.md",
      "grammars/tree-sitter-graphql/port.py",
      "fixtures/graphql/REVIEW.md",
      "fixtures/graphql/probe/grammar-gaps.mts",
      "fixtures/graphql/probe/grammar-ab.mts",
      "fixtures/graphql/probe/extraction-ab.mts",
      "fixtures/graphql/run-all.sh",
      "fixtures/graphql/out/grammar-gaps.json",
      "fixtures/graphql/out/grammar-ab.json",
      "fixtures/graphql/out/extraction-ab.json",
      "docs/analyzers/real-graphql-analyzer.md",
      "validation/m12/results/graphql-corpus-errors.json",
    ],
    copies: [{ label: "mirror", path: path.join(MIRROR, "tree-sitter-graphql.wasm") }],
    notVendored: [
      { path: "node_modules", why: "a symlink to the tree-sitter CLI used only during a build; the CLI is a devDependency, not grammar source" },
      { path: "tree-sitter-graphql.wasm", why: "the wired bytes; they live at wasm/ and are pinned by sha here" },
    ],
  },

  // The Nim lane joined 2026-09-27 with the analyzer wave. It is the first lane
  // whose provenance is a PLAIN upstream build with an EMPTY patch list, and the
  // first to vendor the generated src/{grammar,node-types}.json ON PURPOSE: the
  // source<->wasm proof can only run when those two files are in the tree, and it
  // is the offline statement that the committed bytes are a build of the
  // committed source. That is the opposite of the groovy situation (a vendored
  // wasm that had drifted from upstream and needed manual repair), which is why
  // the decision below is stated as a proof rather than as a hash.
  nim: {
    wired: "wasm/tree-sitter-nim.wasm",
    provenance: {
      kind: "local-rebuild-from-vendored-source",
      base: { repo: "alaviss/tree-sitter-nim", version: "0.6.2" },
      patches: [],
      patchEvidence:
        "NOT APPLICABLE: the wired build is a plain `tree-sitter generate && tree-sitter build --wasm` of the UNMODIFIED vendored grammar.js + scanner.c (a byte-for-byte checkout of alaviss/tree-sitter-nim@ac72ba30d16edf0be021588a9301ede4accd6cf4), so there is no patch clause to evidence. What backs this pin instead is the offline source<->wasm check this instrument re-measures on every run, the grammar's own 72/72 conformance suite (`tree-sitter test` over the vendored test/corpus), and the compiler-validated construct matrix, which the wired build parses with 0 ERROR and 0 MISSING. The upstream revision is pinned by the vendored-source per-file sha256s below plus the generated src/*.json pair those files regenerate to.",
    },
    source: {
      state: "vendored",
      dir: "grammars/tree-sitter-nim",
      note:
        "grammar.js (1,600 lines) + scanner.c (the EXTERNAL SCANNER that owns Nim's layout state - _layout_start / _layout_end / _inhibit_layout_end; without it indentation-sensitive Nim does not parse) + tree-sitter.json + package.json + LICENSE (MPL-2.0) + README.md + queries/highlights.scm + test/corpus/*.txt (the grammar's own 72-case conformance suite, upstream-authored expectations, not generated) + src/grammar.json + src/node-types.json. The two generated JSONs are vendored ON PURPOSE: sourceVsWasmFor needs the pair to run the offline source<->wasm proof, and without them the check reports `not applicable` and this lane has no such proof at all. src/parser.c (41 MB) is deliberately NOT vendored - `tree-sitter generate` rebuilds it from grammar.js + scanner.c - so `tree-sitter build --wasm` alone is not enough from this directory; the exact two-command sequence is in PIN.md. The upstream checkout the tree was vendored from is at $HOME/fixtures/nim/grammars/tree-sitter-nim-alaviss.",
    },
    decision:
      "Pin the local rebuild, and the reason is a PROOF rather than a preference. (1) The vendored src/node-types.json declares exactly the named types the wired wasm materialises, and the wired wasm declares exactly the named types that source declares - zero in both directions, re-measured by this gate on every run. That is the offline statement that the committed bytes ARE a build of the committed source. (2) The wired build parses all 17 compiler-validated construct-matrix files with 0 ERROR and 0 MISSING, and every file in that matrix was first ACCEPTED by the real Nim 2.2.12 compiler (`nim check`), so a construct the compiler rejects could never be counted as evidence. (3) The grammar's own conformance suite passes 72/72 here. (4) The three other published tree-sitter-nim grammars were all cloned, generated and built, and each is rejected on a MEASURED ground: aMOPel cannot be loaded at all by the pinned runtime, haxscramper emits ZERO fields and 283 ERROR / 7 MISSING over the matrix because it transcribes the ABNF tokens of doc/grammar.txt as node types, and reo101 is a 9-line stub. (5) The external scanner makes a shared-parser lifecycle a live question rather than an assumption, so it was MEASURED: a fresh-parser-per-file reference against one shared parser over 47 files in two orders (file order, and a rotated order putting a different layout shape before each file) produced 0 differences in both, so the engine's cached-parser path is safe for nim and needs no lua-style isolation. Full table, the per-candidate numbers and the reproduction commands: grammars/tree-sitter-nim/PIN.md.",
    alternatives: [
      {
        option: "aMOPel/tree-sitter-nim @4900b68 (the second-most-starred nim grammar; 182 declared types)",
        measured:
          "generates and builds, but the resulting wasm CANNOT BE LOADED by the pinned runtime: web-tree-sitter 0.25.9 fails instantiation with `bad export type for 'tree_sitter_nim_external_scanner_create': undefined`. Reproduced in a dedicated process - the other two candidates showed the same message only because web-tree-sitter keys loaded grammars by the name they all share (`nim`), which is why the A/B runs one candidate per process. Wiring it would mean patching its external-scanner export, i.e. inventing the kind of patch the fsharp lane already has to carry.",
        artifact: "fixtures/nim/grammar/ab-run.sh",
      },
      {
        option: "haxscramper/tree-sitter-nim @c29c404",
        measured:
          "loads, but exposes 0 (ZERO) fields, and its 232 ids are named after the raw ABNF tokens of doc/grammar.txt (IND, DED, OP0..OP9, INT_LIT, STR_LIT, ...). 0/17 matrix files clean: 283 ERROR and 7 MISSING. With no fields, no extraction could address a name, a parameter list or a return type by grammar field, so the M12 AST-purity contract would be unreachable by construction rather than by effort.",
        artifact: "fixtures/nim/grammar/ab-run.sh",
      },
      {
        option: "reo101/tree-sitter-nim @d68239f",
        measured: "a 9-line stub whose grammar.js is a one-line `source_file` rule returning the literal hello, above a // TODO marker over the rules; 3 ids, 1 named type, a 1015-byte wasm, 38 ERROR over the matrix. Rejected on capability.",
        artifact: "fixtures/nim/grammar/ab-run.sh",
      },
      {
        option: "hand-patch the grammar the way groovy's was patched",
        measured:
          "unnecessary and wrong here: that repair exists because the vendored groovy wasm had DRIFTED from its source. The nim build is a plain build of the committed source, which the source<->wasm check proves, so there is no drift to repair. Recorded as rejected so the question is not reopened.",
        artifact: "validation/m14/grammar-pins.json (lane nim -> sourceVsWasm)",
      },
    ],
    evidence: [
      "grammars/tree-sitter-nim/PIN.md",
      "docs/analyzers/real-nim-analyzer.md",
      "fixtures/nim/grammar/ab-run.sh",
      "fixtures/nim/matrix/check-matrix.sh",
      "validation/m12/results/nim-corpus-errors.json",
      "validation/m12/results/nim-corpus-complexity.json",
    ],
    copies: [{ label: "mirror", path: path.join(MIRROR, "tree-sitter-nim.wasm") }],
    notVendored: [
      { path: "src/parser.c", why: "generated by `tree-sitter generate`; 41 MB; rebuildable from grammar.js + scanner.c" },
      { path: "src/tree_sitter/", why: "generated headers" },
      { path: "bindings/, binding.gyp, Makefile, CMakeLists.txt, Cargo.toml, go.mod, pyproject.toml, setup.py, Package.swift, mise.toml, REUSE.toml, jsconfig.json", why: "native / package-manager bindings for platforms this product does not build for" },
      { path: "samples/cps, samples/nim", why: "upstream sample programs; not parser input for the product, whose corpus is $HOME/fixtures/repositories/nim" },
      { path: "test/highlight/", why: "the grammar's highlight assertions; they assert editor tokens, not parser structure" },
      { path: "tree-sitter-nim.wasm", why: "the wired bytes; they live at wasm/ and are pinned by sha here" },
    ],
  },

  // M60 VB wave. This lane is the one the pin instrument's own preamble calls
  // "an unversioned blob" in its most extreme form: there was no blob. `.vb` was
  // a ROUTED extension (language-detection.ts:45) and `vb` a declared
  // DetectedLanguage (language-detection.ts:7), but engine.ts routed it to
  // `__generic__`, so the product parsed VB.NET with a regex generic analyzer
  // and no grammar at all, and validation/m60/results/LCM.json listed `vb` under
  // `nonAnalyzerDetected`. There was no upstream VB.NET grammar on npm either
  // (`tree-sitter-vb` and `tree-sitter-visual-basic` are both 404, and the
  // `tree-sitter-wasms@0.1.13` bundle that supplies 39 of this repo's grammars
  // ships no VB at all), so a pin here is a pin of a LOCAL REBUILD of a patched
  // vendored source -- the same kind as graphql's, and for the same reason: the
  // upstream release is not good enough to parse the language.
  vb: {
    wired: "wasm/tree-sitter-vbnet.wasm",
    provenance: {
      kind: "local-rebuild-from-vendored-source",
      base: { repo: "govindbanura/tree-sitter-vbnet", version: "unreleased (no npm package, no release tag)" },
      patches: [
        "file-scoped `Namespace N` (VB 15+), as a second alternative pinned to the file's LAST position rather than an optional `End Namespace`",
        "`repeat` instead of `optional` on `attribute_list` in 14 member positions (consecutive attribute lists)",
        "`&H`/`&O`/`&B` integer literals with per-radix digit classes and the %/&/!/D/F/R/I/L/S/US/UI/UL type characters",
        "`!`/`#`/`@` on `floating_point_literal` (Single and VB6's legacy Double/Decimal suffixes)",
        "`As New T [args] [initializer]` moved into the shared `as_clause`, so a property or field may carry it",
        '`Declare ... Lib "dll" Alias "e" [params] [As T]` -- the P/Invoke member, which had NO rule at all',
        "bare `{...}` array initializer, reachable as a `_literal` so it nests and is legal in an assignment",
        "`:` as a clause-head terminator (`_clause_terminator`) for `Case`/`Case Else`/`Else`",
        "`named_argument` (`b:=`) at invocation precedence, and `array_access_expression` indices built from `$._argument`",
        "Unicode identifiers (\\p{L}/\\p{Nd}) in `_identifier_token`",
        '`character_literal` as ONE token, so `"x"c` beats `string_literal`',
        "class/structure/interface HEADER heritage: `Class C : Inherits B, Implements I` and the keyword-less `Interface I : IDisposable`",
        "`Generic.Name(Of T)` -- a qualified name whose last segment is generic",
        "VB statement lambdas: optional parameter list, `As T` return clause, and a REQUIRED `End Sub`/`End Function` that does not eat the enclosing statement's newline",
        "`Global.` reachable from `_type`",
        "`ReDim` target widened from `identifier` to an expression",
        "`generic_name` admitted to `_name_reference`, so `Implements IComparable(Of C)` parses",
        "four GLR conflicts + right-associativity and dynamic rank on `as_clause`, all named at their declarations",
      ],
      patchEvidence:
        "fixtures/grammar-repro/cases/*.vb -- one minimal repro per defect class, 27/27 green, and " +
        "fixtures/probes/grammar-baseline.ts over four independent corpora with fixtures/validation/grammar-floor.json as the recorded floor. " +
        "The corpus half is the load-bearing one: a change that kept every repro case GREEN and still cost the corpus " +
        "89.79 -> 32.49 % aggregate is exactly why the gate is differential rather than fixture-only. " +
        "fixtures/grammar-repro/grammar-gate.sh runs both halves and fails on a floor drop.",
    },
    source: {
      state: "vendored",
      dir: "grammars/tree-sitter-vbnet",
      note:
        "grammar.js + tree-sitter.json + package.json + LICENSE + README.md, plus the two GENERATED files the pin " +
        "instrument reads for its offline source<->wasm proof (src/grammar.json, src/node-types.json). " +
        "src/parser.c (29 MB) and the local build output stay ignored, the same call the perl lane made; the rebuild " +
        "path is `tree-sitter generate && tree-sitter build --wasm`, and the two tracked JSON files are the " +
        "digest-stable evidence that a regeneration changed nothing that matters. The pristine upstream grammar.js is " +
        "kept at $HOME/fixtures/grammar-eval/tree-sitter-vbnet/grammar.js, so the patch set is diffable " +
        "against its base rather than only readable in place.",
    },
    decision:
      "Pin as a local rebuild of a patched vendored source, and say plainly that this is the weakest pin in the file. " +
      "There is no upstream release to pin: the repository publishes no npm package and no tagged release, and it is a " +
      "2-star project whose last push predates this lane. The wired bytes are therefore NOT byte-identical to anything " +
      "published -- they are a build of a source this repo owns, and the pin's value is drift detection over THAT " +
      "source (a hand edit to grammar.js moves the recorded digest and fails the gate) plus the source<->wasm proof " +
      "that the committed bytes really are a build of the committed grammar. " +
      "What the pin deliberately does NOT claim: that this is the best available VB.NET grammar. It is the best of the " +
      "two that exist and the only one measured to parse real VB.NET at all (the alternative measured 29.50 % clean on " +
      "the same draw), and it is NOT finished -- 90.89 % aggregate clean over 1185 files with 0 crash files, so roughly " +
      "one file in eleven still carries an ERROR. The gate's floor is the number that has to move, and the " +
      "long-tail defect census (fixtures/probes/defect-census.ts) is the work list that has to shrink it.",
    alternatives: [
      {
        option: "leave `.vb` routed to `__generic__` and ship no grammar",
        measured:
          "rejected, and this is the status quo that motivated the lane: a regex generic analyzer over VB.NET. A " +
          "generic pass cannot see a Class, a Function, an Implements clause or a call site, so the lane publishes " +
          "no symbols and no relationships for .vb files at all -- and it does so QUIETLY, because the file is " +
          "detected and 'analysed' rather than refused. That is the failure the M60 routing ruling names: an extension " +
          "routed to a parser that cannot represent its format is reported as covered.",
        artifact: "validation/m60/results/LCM.json (nonAnalyzerDetected), src/ast/engine.ts:211",
      },
      {
        option: "CodeAnt-AI/tree-sitter-vb-dotnet",
        measured:
          "rejected on measurement, not on stars. Both candidates were built to ABI-15 wasm and run over the same " +
          "corpora: 29.50 % clean on the 600-file P3D draw against vbnet's 58.50 % at the time of the bake-off, and " +
          "107 named node types against vbnet's 170. Its grammar also had no `supertypes` and no `word` token, both " +
          "of which the analyzer will want.",
        artifact: "fixtures/probes/grammar-bakeoff.ts (both wasms, same draw, same loader)",
      },
      {
        option: "patch the WASM instead of the source, the way groovy's was patched",
        measured:
          "rejected, and recorded so the question is not reopened. A binary patch is unreviewable, cannot be " +
          "regenerated, and leaves the pin unable to say what the bytes ARE. The graphql lane (#177) took the same " +
          "decision for the same reason: patch grammar.js, keep parser.c regenerable, and let the source<->wasm proof " +
          "carry the claim.",
        artifact: "script/m14/verify-grammar-pins.ts (sourceVsWasmFor)",
      },
      {
        option: "decode UTF-16 sources in the corpus reader and call the encoding loss a grammar gap",
        measured:
          "rejected as a framing, accepted as a REQUIREMENT. 40 of P3D's 1880 .vb files are UTF-16 with a BOM " +
          "(Windows Forms Designer output), and read as UTF-8 they are one whole-file ERROR for ANY grammar. The " +
          "corpus reader strips the BOM (fixtures/probes/vb-source.ts) so the grammar is measured on text, and the " +
          "product's own file reader is recorded as needing the same -- `readFileSync(path, 'utf8')` is not a correct " +
          "VB reader. That is a product gap, not a grammar repair, and conflating the two would have hidden it.",
        artifact: "fixtures/validation/history/reading-02-confirm.json vs reading-03-lambdas.json",
      },
    ],
    evidence: [
      "grammars/tree-sitter-vbnet/PIN.md",
      "reviews/vb/master-review.md",
      "fixtures/validation/grammar-floor.json",
      "fixtures/validation/history/",
      "fixtures/grammar-repro/cases/",
      "fixtures/probes/defect-census.ts",
    ],
    copies: [
      { label: "mirror", path: path.join(MIRROR, "tree-sitter-vbnet.wasm") },
      // The build output, kept beside the vendored source. It is byte-identical
      // to the wired bytes, so it doubles as proof that the copy step in
      // fixtures/grammar-repro/repair-loop.sh is a copy and not a second build.
      { label: "local build output (grammars/tree-sitter-vbnet)", path: path.join(ROOT, "grammars/tree-sitter-vbnet/tree-sitter-vbnet.wasm") },
    ],
    notVendored: [
      { path: "src/parser.c", why: "generated by `tree-sitter generate`; 29 MB; rebuildable from grammar.js" },
      { path: "src/tree_sitter/", why: "generated headers" },
      { path: "tree-sitter-vbnet.wasm", why: "the build output; it is gitignored here and the wired bytes live at wasm/, pinned by sha" },
      { path: "test/, queries/, bindings/, binding.gyp, Makefile, CMakeLists.txt, Cargo.toml, go.mod, pyproject.toml, setup.py, Package.swift, parser.obj, parser.exp, parser.lib, build.py", why: "upstream test corpus, editor queries, and native/package-manager bindings for platforms this product does not build for" },
    ],
  },
  xml: {
    wired: "wasm/tree-sitter-xml.wasm",
    provenance: {
      kind: "local-rebuild-from-patched-vendored-source",
      base: { repo: "tree-sitter-grammars/tree-sitter-xml", version: "0.7.0", rev: "5000ae8f22d11fbe93939b05c1e37cf21117162d" },
      patches: [
        "REPAIR 1 (scanner, `common/scanner.h` `scan_pi_content`): the trailing `advance_if_eq(lexer, '\\n')` became `skip_if_eq`. `advance_if_eq` is defined as `if (!eof && lookahead==chr) advance(lexer); else return false`, so its `else` ABORTS the caller — and the caller had already committed, past `mark_end`, on a lookahead whose value is irrelevant. A processing instruction with content therefore produced no `_pi_content` token, `<?target content?>` could not complete, and the parser wrapped the whole `<?...?>` in an ERROR node. It was not merely a lost declaration: with no XMLDecl present the enclosing `prolog` node disappeared too, taking any DOCTYPE in the same prolog with it. A 19-shape battery isolates it exactly: the construct parses iff the byte after `?>` is `\\n` (fixtures/xml/out/pi-rootcause.json). `check_word` and `scan_comment` keep `advance_if_eq`, where a mismatch correctly means \"not the token I was asked for\".",
        "REPAIR 2 (grammar, `xml/grammar.js` `_intSubset`): the internal subset is now `repeat(choice($._markupdecl, $.conditionalSect, $._DeclSep))` over a named `_intSubsetItem` rule, and `conditionalSect` is declared. Upstream could not reach a conditional section from an internal subset at ANY version measured: 0.5.0-0.6.x declare `conditionalSect` in the `dtd` grammar and inline it, but `_intSubset` referenced `$._markupdecl`, which does not include it; 0.7.0, which the wired wasm matches exactly, does not declare it in the `xml` grammar at all. The failure was destructive, not silent: `<![INCLUDE[...]]>` wrapped the `doctypedecl` in an ERROR and the parser then took a LATER `Name` as the DTD's name, so the analyzer published a Type symbol literally named `INCLUDE`. The named `_intSubsetItem` is because tree-sitter rejects a rule that can match the empty string and XML 1.0 permits an empty internal subset; writing the repeat at each use site keeps the generated `node-types.json` free of a wrapper node.",
      ],
      patchEvidence:
        "Two A/Bs, both over the whole pinned corpus, both re-runnable. (1) CONSTRUCT A/B: 29 shapes across the wired wasm, a build of upstream v0.5.0, a build of upstream HEAD v0.7.0, and this build — the wired wasm and upstream HEAD are byte-IDENTICAL in behaviour on all of them, which is what pins the pre-repair bytes as an unmodified upstream build (fixtures/xml/out/grammar-ab.json). (2) CORPUS A/B: 8,888 files / 33.6 MB / 6.69 M nodes across 6 repos, counting ERROR and MISSING per file: 31 files repaired, 2 files moved the wrong way, 8,855 unchanged, and corpus MISSING nodes 32 -> 10 (fixtures/xml/out/grammar-corpus-ab.json). BOTH regressions are adjudicated by measurement, not argument (fixtures/xml/out/regression-adjudication.json): `libxml2/test/valid/dtds/cond_sect2.dtd` is a STANDALONE DTD, whose root node type is `ERROR` under the wired grammar, under this build, and under every build measured — the `xml` grammar requires a document element and cannot represent a standalone DTD at all, so the file was never in the wired surface; and upstream's separate `dtd` grammar parses it with 0 ERROR nodes, which is filed as its own finding. `libxml2/test/errors/759573-2.xml` is libxml2's own FUZZER-REGRESSION corpus, a file the project keeps precisely because it must NOT parse; both sides reject it (root ERROR) and the repair traded one MISSING node for four more ERROR nodes, and a MISSING node is tree-sitter's recovery invention, the worse of the two signals.",
      localCheckout:
        "The upstream checkouts the tree was vendored from are at $HOME/fixtures/xml/grammar/upstream (0.7.0 @ 5000ae8f, the base) and $HOME/fixtures/xml/grammar/probe-v0.5.0 (the older candidate, kept so the v0.5.0 build in the A/B stays reproducible). The pre-repair wired bytes are kept at $HOME/fixtures/xml/out/tree-sitter-xml.WIRED-BEFORE-REPAIR.wasm (sha256 50ad134273834d5efe37d8fe4f93aa4367b95a91be05dc08a6dc894c7ecdb9c1) so the A/B against them is reproducible forever.",
    },
    source: {
      state: "vendored",
      dir: "grammars/tree-sitter-xml",
      srcSubdir: "xml/src",
      note:
        "Upstream's own multi-grammar layout, kept so the relative import in `xml/grammar.js` (`../common/common.mjs`) resolves and the tree is byte-comparable to a checkout: `xml/grammar.js` + `xml/src/` (grammar.json, node-types.json, parser.c, scanner.c, tree_sitter/ headers), `common/common.mjs` + `common/scanner.h` (the shared rules and the external scanner header, included by `xml/src/scanner.c`), `tree-sitter.json`, `LICENSE` (MIT). The two generated JSONs are vendored ON PURPOSE: `sourceVsWasmFor` needs the pair to run the offline source<->wasm proof, and without them the check reports `not applicable`. `common/scanner.h` is the file REPAIR 1 edits, so tracking it is the difference between a reviewable repair and an invisible one. `xml/src/parser.c` IS vendored (254 KB) — the same call hcl made at 600 KB and graphql at 284 KB, the opposite of nim at 41 MB — because `measureVendored` hashes every file in the tree, tracked or not, so an untracked parser.c would turn this gate red after any `tree-sitter generate`. `xml/src/scanner.c` is vendored for the same reason: it includes the shared header. Rebuild with `tree-sitter build --wasm --output wasm/tree-sitter-xml.wasm grammars/tree-sitter-xml/xml`.",
    },
    decision:
      "Pin the local rebuild of the PATCHED vendored source, and record that the pre-repair bytes needed no provenance work at all. (1) The pre-repair wired wasm is an UNMODIFIED upstream build: its enumerable surface is byte-for-byte the surface of a build of upstream HEAD 0.7.0 (140 node types, 2 fields, zero set difference in either direction) and its behaviour matches that build on all 29 constructs of the A/B battery. So unlike Groovy this was not a stale blob; it was current upstream, and the two defects are UPSTREAM defects that upstream's own test corpus never exercises — `grep -rn 'PITarget' test/corpus/` returns nothing, and the only `PI`-adjacent tests are `StyleSheetPI`/`XmlModelPI`. (2) Because the defects are upstream's, no upgrade fixes them: v0.5.0, v0.6.4 and v0.7.0 all fail both, which is the measurement that makes the repair necessary rather than optional. (3) Upgrading past 0.7.0 would DELETE capability, not add it: 0.7.0 already split DTD into a separate `dtd` grammar, and adopting a split would strand `elementdecl`, `AttlistDecl`, `AttDef`, `GEDecl`, `PEDecl` and `NotationDecl` — the analyzer's entire DTD surface — in a grammar this engine does not wire. (4) The repair is admissible on the corpus A/B above: 31 files repaired against 2 adjudicated out-of-surface/negative-control movements, and corpus MISSING nodes down 32 -> 10. (5) The offline source<->wasm proof runs and is measured on every gate run.",
    alternatives: [
      {
        option: "pin the pre-repair bytes as-is and document the two defects as boundaries (what docs/analyzers/real-xml-analyzer.md does today)",
        measured:
          "REJECTED on capability, and the cost is the whole declaration vocabulary of a DTD. A content-bearing processing instruction is one of the most common constructs in XML, and it does not merely lose a symbol: with no XMLDecl present the enclosing `prolog` node is destroyed, so `<!DOCTYPE …>` in the same prolog is lost with it, and in a conditional section the parser picks a later `Name` as the DTD name and the analyzer publishes a Type symbol called `INCLUDE`. A documented boundary is right for a gap nobody can fix; this one is fixable in two lines and the fix is measured.",
        artifact: "fixtures/xml/out/pi-rootcause.json",
      },
      {
        option: "upgrade to upstream HEAD 0.7.0 unmodified",
        measured:
          "REJECTED, and this is the negative result worth keeping: the pre-repair wired bytes ALREADY ARE 0.7.0. Surface-identical (140 types, 2 fields, zero difference either way) and behaviourally identical on all 29 battery constructs, so the upgrade buys nothing — and it leaves both defects in place, because they are upstream's. Separately, 0.7.0's split of DTD into its own `dtd` grammar means the `xml` grammar alone cannot represent a standalone `.dtd` file at all (root node type ERROR, measured), which is filed as a separate finding rather than solved by a swap.",
        artifact: "fixtures/xml/out/grammar-ab.json",
      },
      {
        option: "hand-edit the vendored grammar in place, the way groovy's was hand-repaired",
        measured:
          "REJECTED on re-derivability, and it matters more here than for Groovy. Both repairs are in files a future `tree-sitter generate` or upstream sync would otherwise be diffed against, and REPAIR 2 changes a GRAMMAR RULE (so `src/parser.c` is regenerated) while REPAIR 1 changes a SCANNER HEADER (so it is not). A hand edit leaves no record of which is which; the patch list above, the PIN.md record and the per-file digests below make the divergence from 0.7.0 auditable in one read, and `common/scanner.h` is 155 lines of upstream source so the delta is three added lines and one changed line.",
        artifact: "grammars/tree-sitter-xml/PIN.md",
      },
      {
        option: "wire upstream's separate `dtd` grammar as a second language for `.dtd`",
        measured:
          "NOT TAKEN, and recorded as owed rather than rejected. It is measurably the right grammar — it parses libxml2's `cond_sect1.dtd` and `cond_sect2.dtd`, which the `xml` grammar cannot represent at all (root ERROR, 11 and 8 ERROR nodes), with 0 ERROR nodes — but it is a new wired language, a new router entry, a new analyzer and a new lane, not a repair. The measurement is kept so the decision is revisit-able with numbers instead of a recollection.",
        artifact: "fixtures/xml/out/regression-adjudication.json",
      },
    ],
    evidence: [
      "fixtures/xml/out/grammar-surface.json",
      "fixtures/xml/out/grammar-conformance.json",
      "fixtures/xml/out/grammar-ab.json",
      "fixtures/xml/out/grammar-corpus-ab.json",
      "fixtures/xml/out/regression-adjudication.json",
      "fixtures/xml/out/pi-rootcause.json",
      "fixtures/xml/out/tree-shapes.txt",
      "validation/m12/results/xml-shape-safety.json",
      "validation/m12/results/xml-corpus-errors.json",
      "reviews/xml/master-review.md",
    ],
    copies: [
      { label: "pre-repair wired bytes", path: "$HOME/fixtures/xml/out/tree-sitter-xml.WIRED-BEFORE-REPAIR.wasm" },
      { label: "upstream 0.7.0 build (the base)", path: "$HOME/fixtures/xml/grammar/v070-xml.wasm" },
      { label: "upstream 0.5.0 build (the older candidate)", path: "$HOME/fixtures/xml/grammar/v050-xml.wasm" },
      { label: "upstream 0.7.0 dtd grammar build (NOT wired)", path: "$HOME/fixtures/xml/grammar/v070-dtd.wasm" },
    ],
  },
  sql: {
    wired: "wasm/tree-sitter-sql.wasm",
    provenance: {"kind": "local-rebuild-from-patched-upstream-source", "base": {"package": "@derekstride/tree-sitter-sql", "version": "0.3.11"}, "patches": ["P1 (grammar/statements/): `CONSTRAINT <name> UNIQUE | FOREIGN KEY | INDEX`. The only rule accepting a leading `CONSTRAINT <name>` accepted just `PRIMARY KEY` and `CHECK`, so the two most common named constraints in a real schema lost their names.", "P2 (grammar/statements/): `DELETE FROM t AS x` and `DELETE FROM t USING o`.", "P3 (grammar/statements/): `grant_statement` / `revoke_statement` as VISIBLE nodes (upstream had the rules hidden, so the analyzer's GRANT/REVOKE arms named node types that no file could produce).", "P4 (grammar/statements/do-drop-policy.js): `do_statement` and `drop_policy`. `keyword_do` existed but was wired only to MySQL's `INSERT ... ON DUPLICATE KEY DO UPDATE`; `keyword_policy` existed (create_policy needs it) but no drop rule used it."], "patchEvidence": "Shape A/B over 6 dialects plus the whole pinned corpus, re-runnable via fixtures/sql/probe/grammar-ab.mts: 9 shapes fixed, 0 regressions. Corpus tree level, pristine -> wired: error files 320 -> 256, error nodes 6533 -> 5544, 0 shape regressions (named UNIQUE, named FOREIGN KEY, DELETE ... USING, DELETE ... AS alias, GRANT on a table, GRANT ALL PRIVILEGES on a schema, REVOKE from a role, GRANT a column list, procedure with a dollar-quoted body). The field-set digest is IDENTICAL to pristine (c63f5b80...), which is the precise statement that the patch is purely additive at the node-type level: +57 node types, +57 unique names, and ZERO new field names.", "localCheckout": "Pristine upstream source at $HOME/fixtures/sql/grammar/pristine-src; the patched tree at $HOME/fixtures/sql/grammar/src; the pristine wasm kept at $HOME/fixtures/sql/grammar/pristine-sql.wasm (sha256 bcb9888ec30d27adf5dccb13e5fd45ee70102927920fcd5245e9812bed577800, 2,440,507 B) so the A/B is reproducible forever."},
    source: {"state": "not-obtainable-offline", "note": "NOT VENDORED, and not merely un-vendored: the exact source revision behind the wired bytes could not be recovered. `tree-sitter generate` on the patched tree at $HOME/fixtures/sql/grammar/src emits a 43,568,124-byte parser.c against the wired build's 43,456,567, so the wired bytes are pinned by sha256 + surface + provenance (the treatment perl gets) and this lane has NO offline source<->wasm proof. Pristine upstream source is kept at fixtures/sql/grammar/pristine-src and the patched tree at fixtures/sql/grammar/src; both are outside the repo, and the tree there is AHEAD of the wired bytes. Building and installing from it without a full A/B would change the lane's grammar unmeasured."},
    decision: "PIN THE PATCHED LOCAL REBUILD. This lane refused every published grammar alternative on G1 damage / G2 identity / G3 output and concluded 'sql needs a patch, not a swap' (reviews/m60-sql-grammar-l1xnan-047-refused.md, sections 7.3 and 8.5), so the grammar was patched from its own upstream source with the pristine build retained for A/B. A THIRD candidate (V3) was built, measured at three levels, and REJECTED: it cuts tree-level error files 320 -> 196 while 49/256 damaged files lose >=25% of their structure (worst -95.8%) and 0 files gain any, and at the PRODUCT level it is byte-identical to the wired bytes over all 441 corpus files (9,448 symbols, 12,447 relationships, 7,506 analyzer errors, 258 error files, identical for both). Full record: validation/m60/sql/v3-rejection.json. The wired bytes therefore stay V2, and the headline error-count win that would have justified shipping is exactly the aggregate measure-grammar-recovery.ts exists to catch.",
    alternatives: [{"option": "ship V3 (opaque `DO $$ ... $$` + the two hidden dollar-body branches removed)", "measured": "REJECTED. Zero product gain, real tree cost. See decision and validation/m60/sql/v3-rejection.json.", "artifact": "validation/m60/sql/v3-rejection.json", "rejected": true, "why": "It reaches 0 errors on `database/migrations/20260309_rls_coms_subtypes.sql` by swallowing 7 DO bodies opaquely, hiding 27 of 37 statements -- the CREATE POLICY declarations that migration exists to create -- while the product output stays identical to V2."}, {"option": "wire an upstream/published tree-sitter-sql build instead of patching 0.3.11", "measured": "REFUSED on measurement, per reviews/m60-sql-grammar-l1xnan-047-refused.md: 2 files newly damaged, 5 clean files changed shape (all 5 GAIN a `having` node the pinned build dropped), and -177 symbols / -441 pairs against the patch's +1813 / +2156, of which 138 of the 177 lost symbols are `property:ENABLE` phantoms the pinned grammar invents from `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.", "artifact": "reviews/m60-sql-grammar-l1xnan-047-refused.md", "rejected": true, "why": "A swap that loses structure and manufactures phantom columns is not an upgrade."}],
    evidence: ["fixtures/sql/REVIEW.md", "validation/m60/sql/v3-rejection.json", "fixtures/sql/probe/grammar-ab.mts", "script/m60/measure-grammar-recovery.ts", "script/m14/spec/sql-completeness.json"],
    copies: [{"label": "upstream pristine 0.3.11 (kept for A/B, NOT wired)", "path": "$HOME/fixtures/sql/grammar/pristine-sql.wasm"}, {"label": "V3 candidate (opaque DO, REJECTED)", "path": "$HOME/fixtures/sql/grammar/patched-sql-v3.wasm"}, {"label": "V8 (WIRED: psql meta-commands as an extra, quoted LANGUAGE, C-language body)", "path": "$HOME/fixtures/sql/grammar/patched-sql-v8.wasm"}, {"label": "V6 (plpgsql scaffolding; the previous wired bytes)", "path": "$HOME/fixtures/sql/grammar/patched-sql-v6.wasm"}],
    notVendored: [{"path": "src/parser.c", "why": "generated by `tree-sitter generate`; 43 MB, and per the xml/hcl lanes a tracked 43 MB generated file is not vendored"}, {"path": "src/grammar.json, src/node-types.json", "why": "generated; the offline source<->wasm proof is not applicable for this lane (see sourceVsWasm)"}, {"path": "bindings/, binding.gyp, Makefile, CMakeLists.txt, Cargo.toml, go.mod, pyproject.toml, setup.py, Package.swift, queries/, test/", "why": "native/package-manager bindings, editor queries and upstream's test corpus; the engine wires none of them"}],
  },
    json: {
    wired: "wasm/tree-sitter-json.wasm",
    provenance: {
      kind: "unnamed-build-sha-only",
      chain:
        "NOT provenanced to a published version, and the lane says so rather than guessing. Two builds of " +
        "`tree-sitter-json` are in circulation on this machine and they are NOT the same artifact: the " +
        "wired bytes are sha256 fdb5219abe058369… / 5,961 B and the ~/.bb registry copy is " +
        "d2119fb98d591271… / 5,596 B. Hash-matching against published tarballs is what the haskell and " +
        "powershell lanes did to identify their bases, and it was NOT possible here: no vendored grammar " +
        "source exists (grammars/ has no tree-sitter-json), and no local distribution copy of a published " +
        "tarball was reachable, so the version numbers are unknown rather than unrecorded. " +
        "WHAT WAS ESTABLISHED INSTEAD, which is the part that decides whether the analyzer is safe: the two " +
        "builds agree on the NAMED vocabulary (12 types, identical sets) and on the field set (2), and they " +
        "differ ONLY in anonymous tokens — the wired build exposes internal helpers " +
        "`string_content_token1` (id 8) and `string_content_repeat1` (id 25) where the registry build has " +
        "`_string_content` (id 21). Because that shifts every named type's ID by exactly one, the id-order " +
        "and type-set digests DIFFER (da249143… vs bcf795b6…, a0c126ed… vs 284c3145…) while the named SET " +
        "matches. A pin comparing named types alone would pass these two builds as one; the id-order digest " +
        "is the only thing that separates them and it is recorded for that reason. " +
        "CONSEQUENCE FOR THIS LANE, measured rather than assumed: the analyzer matches on node type NAMES " +
        "(`pair`, `object`, `array`, `string`, `number`, `document`, `true`, `false`, `null`) and never on a " +
        "numeric node-type id, so it is IMMUNE to the divergence — a dev run and a compiled run see the same " +
        "shapes. An analyzer that cached or compared numeric ids, or that compared an id-order digest as if " +
        "it described the grammar's semantics, would break between the two builds. That property is why the " +
        "pin records both digests and why the named set is the claim the analyzer may rely on. " +
        "`wasm/tree-sitter-json_schema.wasm` is NOT this lane's grammar and is deliberately unwired: it is a " +
        "YAML-family schema backend selected at compile time by -DYAML_SCHEMA (6 node types, no fields), and " +
        "it is listed under notVendored for that reason.",
    },
    source: {
      state: "not-obtainable-offline",
      note:
        "grammars/ has no tree-sitter-json directory, so there is no vendored grammar.js, no node-types.json " +
        "and no scanner to diff against the wired bytes. The source<->wasm check that haskell, elixir and " +
        "yaml run cannot run for this lane, and the pin therefore rests on byte identity plus the enumerable " +
        "surface rather than on a source diff.",
    },
    decision:
      "Pin the wired bytes by sha256 + the full enumerable surface, record the registry copy as DIVERGENT " +
      "rather than as a byte-identical copy, and treat the id-order digest as the discriminator. The " +
      "divergence is not resolved here because it cannot be resolved offline: two versions are in " +
      "circulation and identifying either one needs a published artifact to hash against. Listing the " +
      "registry copy as a matching `copies` entry would make this lane read as fully provenanced when the " +
      "product's own bytes are not the ones a compiled build resolves, which is the opposite of what a pin " +
      "is for. It is listed so the gate can fail on it.",
    alternatives: [
      {
        option: "assert byte-identity against ~/.bb/wasm/tree-sitter-json.wasm",
        measured:
          "REFUSED, and measurably so: fdb5219abe058369… (5,961 B) vs d2119fb98d591271… (5,596 B) are " +
          "different artifacts, not two copies of one.",
        artifact: "sha256 of both files; measureSurface on both",
      },
      {
        option: "pin on the named-type set alone, since that is what the analyzer matches",
        measured:
          "REFUSED as insufficient: the two builds have identical named SETS (12) and would pass as one, " +
          "while differing in anonymous tokens and in every named type's numeric id. A pin that cannot tell " +
          "two builds apart cannot detect a re-point.",
        artifact: "named-set and id-order digests of both builds",
      },
      {
        option: "wire the newer build (the one with fewer leaked helper tokens) to make dev and compiled agree",
        measured:
          "NOT TAKEN, and out of scope for a lane: choosing which published version the product loads is a " +
          "product decision with a blast radius across every consumer of the wasm registry, and this lane's " +
          "correctness does not depend on it because the analyzer is name-matched.",
        artifact: "resolveWasm in src/ast/engine.ts prefers the registry in compiled mode",
      },
    ],
    evidence: [
      "wired sha256 fdb5219abe058369e16897aaa11eecf47ef4f546…" + " (5,961 B)",
      "registry copy sha256 d2119fb98d5912719b13f9458574f8608d2d29df… (5,596 B)",
      "surface (wired): 26 ids, 26 unique names, 12 named, 14 anon, 2 fields",
      "surface (registry): 25 ids, 25 unique names, 12 named, 13 anon, 2 fields",
      "named vocabulary, both builds: array comment document escape_sequence false null number object pair string string_content true",
      "idOrderDigest wired da24914332a93410f5c13ca48f5163ccc3173d2bfe17eccf051be64ac701bc74 vs registry bcf795b62c53db5b5f6873edb4b67b51fcbc4fbcb3703a819efe3eb7b50aad49",
      "named ids are offset by exactly one between builds (wired escape_sequence=9, registry escape_sequence=8)",
    ],
    copies: [{ label: "registry (DIVERGENT — not byte-identical, see decision)", path: "~/.bb/wasm/tree-sitter-json.wasm" }],
  },
    markdown: {
    wired: "wasm/tree-sitter-markdown.wasm",
    companionWasm: ["wasm/tree-sitter-markdown_inline.wasm"],
    provenance: {
      kind: "unnamed-build-sha-only",
      chain:
        "NOT provenanced to a published version from inside this tree, and the lane says so rather than " +
        "guessing. `docs/analyzers/real-markdown-analyzer.md` records that " +
        "`script/m60/find-grammar-provenance.ts` matched the BLOCK wasm by exact sha256 against a published " +
        "artifact of `@tree-sitter-grammars/tree-sitter-markdown@0.5.1` (3e13182f21373634…, 421,534 B), and that " +
        "the match came from a GITHUB RELEASE ASSET rather than an npm tarball because the package's repository " +
        "publishes a prebuilt wasm per release. That claim is INHERITED, not re-derived here: the artifact it " +
        "cites (`validation/m60/results/G-PROVENANCE.json`) has no markdown row, and no local copy of the package " +
        "is reachable offline, so neither the block nor the inline wasm could be re-hashed against a published " +
        "one. INHERITING IT AS IF IT WERE MEASURED IS THE THING THIS RECORD EXISTS TO PREVENT, so it is " +
        "recorded as a chain and the two things that WERE measured are recorded beside it.\n\n" +
        "WHAT WAS ESTABLISHED, and it is the part that decides whether the analyzer is safe:\n" +
        "  1. BOTH wasms are byte-identical to the copies the wasm registry serves " +
        "(~/.bb/wasm/tree-sitter-markdown.wasm and ~/.bb/wasm/tree-sitter-markdown_inline.wasm). Measured by " +
        "sha256 on both sides; recorded under `copies` so the gate fails if either stops matching. A dev run and " +
        "a compiled run therefore see the same grammars.\n" +
        "  2. Neither grammar is vendored (`grammars/` has no tree-sitter-markdown), so there is no grammar.js, " +
        "no src/node-types.json and no scanner to diff against the wired bytes. The source<->wasm proof the " +
        "haskell, elixir, css, fsharp, clojure, clean, yaml and powershell lanes run CANNOT run for this lane, and " +
        "the pin rests on byte identity plus the fully enumerable surface instead.\n" +
        "  3. The ANALYZER matches on node-type NAMES and never on a numeric id, so it is immune to the id-order " +
        "divergence that separates two builds of one grammar source — the json lane documents that hazard at " +
        "length. The id-order digest is recorded for both grammars anyway, because it is the only thing that would " +
        "separate two builds of THIS source.\n\n" +
        "WHAT IS NOT ESTABLISHED: that these bytes are the 0.5.1 release, for EITHER grammar. The block wasm's " +
        "match is inherited from a doc; the inline wasm has no provenance claim at all, anywhere, and the pin makes " +
        "none. Re-deriving both needs network access to the release assets and is owed.",
    },
    source: {
      state: "not-obtainable-offline",
      note:
        "grammars/ has no tree-sitter-markdown directory, so there is no vendored grammar.js, no node-types.json " +
        "and no scanner to diff against either wired wasm. The source<->wasm check cannot run for this lane in " +
        "either direction, and the pin therefore rests on byte identity, the enumerable surface, and the " +
        "name-not-id property of the analyzer. Stated rather than approximated.",
    },
    decision:
      "Pin BOTH grammars by sha256 + full enumerable surface, list the registry copies as byte-identical for each, " +
      "and declare the provenance class `unnamed-build-sha-only` rather than inheriting the doc's 0.5.1 claim as if " +
      "it had been measured in this round. The claim is plausible and cited; it is not established, and the " +
      "difference between those two is the whole subject of this record.",
    alternatives: [
      {
        option: "record `byte-identical-to-npm-tarball` for @tree-sitter-grammars/tree-sitter-markdown@0.5.1, on the strength of the lane doc's existing claim",
        measured:
          "REFUSED as unsupported by this round. The census artifact the claim cites carries no markdown row, and " +
          "the class asserts the bytes ARE the published tarball's, which is stronger than 'a published artifact " +
          "hashes to these bytes' (a release asset is not the tarball). Recording the stronger class on the " +
          "weaker evidence is how a pin becomes a decoration.",
        artifact: "validation/m60/results/G-PROVENANCE.json (no markdown row); sha256 of both wasms vs the registry copies",
      },
      {
        option: "pin only the block grammar, as the other ten lanes do",
        measured:
          "REFUSED, and it is the option this entry was written to close. The inline grammar supplies every `uses` " +
          "edge the lane emits, so pinning the block grammar alone would leave the load-bearing input unpinned — " +
          "and the F1 oracle had already been caught reading only the block grammar, which is how " +
          "`uri_autolink` and `email_autolink` sat in the dead-literal record for 35 days as branches that " +
          "'can never match' when both are live named types of the companion (ids 37, 38).",
        artifact: "audit-analyzer-grammar.ts EXTRA_GRAMMARS; validation/m14/grammar-audit-baseline.json (markdown 2 -> 0, repayment recorded)",
      },
      {
        option: "vendor the grammar source so the source<->wasm proof can run, as eight other lanes do",
        measured:
          "NOT TAKEN in this round, and named as owed rather than dismissed. The source class is a release asset, " +
          "not an npm tarball, so 'vendoring the tarball tree' has no source tree to copy; obtaining the " +
          "repository's grammar.js and regenerating from it would be a build-identity question this round did not " +
          "answer.",
        artifact: "grammars/ (12 lanes vendored, no tree-sitter-markdown)",
      },
    ],
    evidence: [
      "sha256 + size of both wired grammars, and of both registry copies, in this record",
      "the enumerable surface (ids/named/anon/fieldCount + three digests) for both grammars, in this record",
      "validation/m14/grammar-audit-baseline.json — markdown 2 -> 0, with the repayment that the F1 oracle was missing the companion",
      "validation/m60/results/G-PROVENANCE.json — has NO markdown row, which is why the provenance class is unnamed-build",
      "docs/analyzers/real-markdown-analyzer.md — the two-grammar design and the inherited 0.5.1 claim",
    ],
    copies: [
      { label: "wasm registry copy of the block grammar", path: path.join(HOME, ".bb/wasm/tree-sitter-markdown.wasm") },
      { label: "wasm registry copy of the INLINE companion grammar", path: path.join(HOME, ".bb/wasm/tree-sitter-markdown_inline.wasm"), of: "wasm/tree-sitter-markdown_inline.wasm" },
    ],
    notVendored: [
      { path: "grammar.js / src/grammar.json / src/node-types.json", why: "not vendored; the package publishes a prebuilt per-release wasm, so there is no tarball source tree to copy byte-for-byte" },
      { path: "tree-sitter-markdown_inline.wasm", why: "the wired companion bytes; they live at wasm/ and are pinned by sha here via companionWasm" },
    ],
  },
    powershell: {
    wired: "wasm/tree-sitter-powershell.wasm",
    provenance: {
      kind: "local-rebuild-from-vendored-source",
      base: { repo: "airbus-cert/tree-sitter-powershell", version: "0.26.4" },
      patches: [
        "G5a/b: PowerShell 7 null-coalescing `??` and ternary `? :`, as two HIDDEN precedence levels",
        "G5c: PowerShell 7 null-conditional `?.` and `?[`, added inside the rules that already define `.` and `[` so they inherit their associativity and precedence",
        "G1: a script-level `param()` block after any other statement, reached through a statement-level form that deliberately omits the `attribute_list` and is ALIASED back to the `param_block` node name",
        "G6: a command argument list whose values include a BARE WORD — one alternative whose elements are `generic_token`, which is DISJOINT from `array_literal_expression` (whose elements are `unary_expression`) by the deciding token, so it cannot consume a comma that rule owns",
        "G7: a command ARGUMENT that is a sigil-led path (`$PSScriptRoot/x`, `$env:TEMP\\a.txt`), a new token declared ONLY inside `_command_argument` so the state-driven lexer cannot produce it in the assignment right-hand side where `$a/$b` is division and must stay so",
        "G8: `+` as .NET's nested-type separator in `type_name` (mirroring the `.` arm that already exists for the same reason), and `=` admitted to the DOUBLE-DASH branch of `command_parameter` only, because `--flag=value` is one argv token for a native command while PowerShell's own `-Name=value` is not valid",
        "G9: a generic TYPE ARGUMENT may be a bracketed type (`Dictionary[[string],[int]]`), because `generic_type_arguments` could only take a `type_spec` and a `type_spec` can only express the SUFFIX array form `string[]` — the leading `[` of a `type_literal` had no route, so the derivation did not exist and the parser reached for the only one it had and failed",
        "G10: a value GLUED to a double-dash parameter (--flag=..., --flag=$var), added as a PARSER alternative on the existing `command_parameter` and deliberately NOT as a second token — the third design, after two rejections whose causes are recorded in the decision",
      ],
      patchEvidence: "validation/m60/results/powershell-grammar-g5b-ab.json + validation/m14/results/M14.0.F11.powershell.json + validation/m60/results/powershell-g5-g3-adjudication.txt + reviews/powershell/grammar-worklist.md",
    },
    source: {
      state: "vendored",
      dir: "grammars/tree-sitter-powershell",
      note:
        "grammar.js (PATCHED — see provenance.patches) + src/scanner.c + src/tree_sitter/{parser,alloc,array}.h + package.json + tree-sitter.json + LICENSE + README.md. The grammar source is byte-for-byte from the npm tree-sitter-powershell@0.26.4 tarball EXCEPT grammar.js, which carries one additive hunk; `tree-sitter diff` against the tarball's own grammar.js is the record of what changed, and it is three rules and no edit to an existing one. The generated src/parser.c (4.5 MB) is NOT vendored: `tree-sitter generate` rebuilds it, and the source↔wasm check runs on the generated JSONs, never on parser.c. Unlike the css/cpp vendors this lane's src/ holds only the hand-written scanner, so the .gitignore rule that drops `grammars/tree-sitter-*/src/*` — the rule that silently cost cpp its scanner and css its own (see the two negations above) — needed a THIRD negation for this lane, because tree-sitter-powershell's external scanner is also named src/scanner.c. The same trap, a third time, named by filename rather than by role.",
    },
    decision:
"Pin the patched local rebuild, and record both decisions that got here, because both were measured and one of them was a correction. (1) The BASE was identified by fetching all four published versions and hash-matching: the wired bytes were tree-sitter-powershell@0.25.10 (sha 1d30b5a2…, 983,236 B), not the 0.26.4 sitting in the npm cache. The only thing that said so was the full id enumeration — 415 ids vs 419, id-order digests differing, and a source diff naming `_string_literal_immediate`, the here-string fix. The NAMED vocabularies are identical (152), so a pin comparing named types alone would have passed two revisions as one, and the first grammar hunk would have been written against a grammar the product does not load. (2) The 0.25.10 → 0.26.4 upgrade was measured before it was taken: 0 files fixed, 0 broken over 73 production corpus files, identical 152 named types and 14 fields, 2 fewer ERROR nodes in ansible. (3) The PATCH is G5, and its provenance is stronger than any other lane's because the base was PROVEN before it was patched: the unpatched 0.26.4 source rebuilds to the published prebuild BYTE-FOR-BYTE (same 1,088,467 B, same sha), so the patch is a delta against a known artifact rather than against whatever the source happened to be. A rebuild's sha is not a function of its source across toolchain versions (M49 W19), so the patch's own sha is a local build and the ID-ORDER digest is the part that can be required to match — 419 ids / ff141f18453a becomes 423 ids / 50274a750a87 with G5a/b and 425 ids / 2edf2378eb2c with G5c, and the 152 NAMED types are unchanged at every step, which is the property that keeps an analyzer written against the old shapes from being silently re-pointed. (4) BOTH patches are strictly additive to the rules they extend. G5a/b inserts two hidden precedence levels and edits no existing rule. G5c adds one `choice` arm to `member_access`, one to `element_access` and one to `invokation_expression`, changing no precedence number and no existing arm; the operators are `token.immediate` for the same reason the `.` in `member_access` is, so `?.` is not recognised across whitespace and `$c ? .5 : 1.5` cannot be stolen. The one form whose meaning changes is `$c?[1,2] : $y` written tight, which this grammar now reads as null-conditional indexing — which is what PowerShell itself does, so the ambiguity is resolved the way the language resolves it rather than invented here. (5) G1 is the largest of the lane's grammar classes and the only one whose fix NECESSARILY changes a clean file's tree. A script's `param` block must be its first STATEMENT, but `using` statements may precede it, and a .psm1 module is REQUIRED to declare `using module` when it needs types — so `using` + `param(…)` is the ordinary shape for any parameterised script that uses a type. Under the pinned grammar `param($Name)` after a `using` line is not a `param_block` at all but a `command` named `param` whose argument is a parenthesized expression, so the parameter is never declared. The dangerous part is that this class is INVISIBLE to hasError-keyed gates: measured over the repro battery, 7 of 8 cases lose every parameter and 6 of those 7 report hasError=FALSE with zero ERROR and zero MISSING nodes, so F1, F10 and the M12 ERROR-node census all read them clean. 33 corpus files carry the shape (16 powershell, 17 ansible), and the ansible side went from 98 ERROR / 23 MISSING to 35 / 2 with 17 more symbols declared. The patch is one statement alternative, and two alternatives were measured and rejected first. (a) Deleting `program`'s own `optional($.param_block)` and keeping only the statement form would have re-shaped 11 of 35 clean powershell files and 2 of 9 clean ansible files — ~30% of the clean corpus — which F11's G2 gate fails on. (b) Putting `param_block` itself into the statement set fixed all 8 cases and silently REGRESSED a different construct: at statement position a leading `[` then had two uses, and the deterministic resolution took the param-block one, so `[ValidateSet('a','b')]$mode = 'a'` stopped being one pipeline and became an ERROR holding the attribute plus a detached pipeline holding the assignment. It surfaced as a fixture failure, not a corpus number. tree-sitter reported a `[param_block, _statement]` conflict declaration UNNECESSARY on both attempts — the automaton separates those routes on the text, so it can choose, and it chooses wrong; the fix had to remove the competing route rather than reprioritise it, hence the attribute-less `_bare_param_block` ALIASED back to `param_block` so the analyzer's existing `case \"param_block\"` and its descendant-walk lookup both work and the grammar's 152 named types do not grow. The cost of dropping the attribute from the statement form was measured, not assumed: 16 powershell and 17 ansible files have `using` followed by a BARE `param(`, and ZERO have `using` followed by an ATTRIBUTED one, while an attributed `param` block that IS the first statement still parses through the pre-existing program-level rule. What F11 says, and what was done about it: G1 damage passes (135 → 135 files, sites 891 → 882, 0 newly damaged) and G3 output is PERFECT (+1 pair, 0 lost, 0 symbols vanished, 0 re-attributed). G2 identity FAILS on exactly 11 files, and that failure is the cost of the fix rather than damage from it — those 11 are the files whose leading `param` block re-parents from `program` into `statement_list`, and G3 reports that NOT ONE of the 11 changed analyzer output at all. The analyzer is parent-agnostic by construction: it finds `param_block` with `collectChildrenByType`, a descendant walk, and already handles a `param_block` nested under a `script_block`. A tree-shape change the product does not consume is a different claim from one that does not matter, and it is the claim the evidence supports. Two attempts to suppress the 11 with dynamic precedence are recorded in the grammar and both failed — `prec.dynamic(1)` on `program` is inert because `program` is the parent of both parses, and `prec.dynamic(-1)` on the statement route does not change the outcome while re-breaking the attribute-attach shape. (6) G6 is the largest class in the lane and the one whose SHAPE was decided by measurement rather than by taste. In the pinned grammar a comma-separated command argument list works for every value kind EXCEPT a bare word: `'deb', 'rpm'` parses, `$a, $b` parses, `(1), (2)` parses, `1, 2` parses, and `deb, rpm` is 2 ERROR nodes. The reason is that `array_literal_expression` is `prec.left(seq($.unary_expression, repeat(seq(',', $.unary_expression))))` and a bare word is not reachable as a `unary_expression` — so the one value kind that matters most in command position, where an unquoted word is a command name or a bare argument, is the one that cannot form a list. Measured footprint: 245 parameter-form sites across both production corpora plus 2 module-surface bare sites, of which 8 are the `Export-ModuleMember` lines this lane's own `exports` reader is built to read. The first attempt at the patch was a bare `seq(',', tail)` among the `_command_element` alternatives. It scored 135 -> 107 damaged files, MISSING 139 -> 81, +253 pairs with 0 lost and 7 corpus files fixed — and was still wrong, because it stole the comma from INSIDE `array_literal_expression`: a two-element array became a one-element array plus an orphaned literal. G1 could not see it (error count 0 before and 0 after), the analyzer could not see it (byte-identical output on all 34 affected files), and `prec(-1)` on the comma element did not help because it was never a precedence tie. The admitted form is one alternative whose list elements are `generic_token`, which makes it disjoint from the array rule on the FIRST TOKEN of each element rather than merely lower-precedence than it. On the corpus: F11 G1 135 -> 110 damaged files with MISSING 139 -> 81, G2 identity 265 clean files with 0 tree differences, G3 +252 pairs with 0 lost and 0 symbols vanished — ADMISSIBLE — and the same 7 production files fixed with 0 broken that the rejected form fixed, without the shape change. The repro battery's named limits go 9 -> 7. (7) G7 is the LARGEST class in the lane — 1,002 sites in 155 files in `powershell` and 81 in 15 in `ansible`, 1,083 in 170 files — and the deciding token is an asymmetry inside one character class. `generic_token` is `token(/[^\\(\\)\\$\"\'\\-\\{\\}@\\|\\[\\`\\&\\s][^\\&\\s\\(\\)\\}\\|;,]*/)`: the CONTINUATION class allows `/` and `\\`, but the FIRST-character class excludes `$`. So `a/b` lexes as one token and `$a/b` cannot, and in PowerShell `$PSScriptRoot/x` is a single path argument. The battery had named this class `backslash-path`, which is wrong — `\\` and `/` fail identically and `Import-Module $PSScriptRoot` alone parses clean — and two of the battery's own controls were themselves broken, which is why the class was mis-named in the first place. The patch is a new token declared ONLY inside `_command_argument`. That scoping is the whole safety argument and it is structural rather than a matter of tuning: tree-sitter's lexer is driven by parse state, so a token valid only where a command argument is expected cannot be produced on the right-hand side of an assignment, where `$a/$b` is DIVISION and already parses correctly. Widening the shared `generic_token` instead would have changed the token in every position including that one. Four forms were built and three rejected before this one, and every rejection was caught by a different gate: (1) a HIDDEN token reported 0 ERROR nodes while the tree was `command_elements: (command_argument_sep)` — the argument silently GONE, which is worse than an error because an error is visible and a missing node is not, and which the micro-repro read as `ok` until the tree was printed instead of the error count; (2) without `prec(2)` the `variable` token's `reserved` precedence won and only a PREFIX of the path was consumed, so `$a/b` appeared to work while a `..` chain did not; (3) a run whose alternation required a TRAILING separator could not match any real path, since every real path ends in a segment. The fourth form fixed a measured loss rather than a refinement: a directory argument ends in a separator — `$testDataPath\\UserConfigProv\\` — and without an optional trailing separator the token matched only the prefix, leaving the final `\\` orphaned and costing 11 REAL cmdlet calls in one Pester file, verified by running the analyzer under both grammars (40 such calls pinned, 29 under the broken candidate) rather than inferred. Final measurement: F11 G1 damaged files 110 -> 87 with sites 755 -> 603, G2 identity 290 clean files with 0 tree differences, G3 +44 pairs against -121 — and every one of those 121 is a PATH-FRAGMENT FABRICATION: 87 name a file extension (`.txt`, `.psd1`, `.yaml`) and the rest name filename components, checked against the source (`Resolve-Path $TESTDRIVE/this.directory.is.invalid` was publishing `uses -> directory`, `uses -> is` and `uses -> invalid`). The 44 gained are real recovered calls, 18 of them `calls -> It` in Pester blocks that previously did not parse. Production corpora: 9 files fixed, 0 broken. The repro battery's named limits go 7 -> 6, and the powershell production draw's damaged files go 14 -> 10. (8) G8 is two one-character widenings, each mirroring a case the rule already had, and it is the highest-yield patch in the lane per site touched. `type_name` already recursed on `.` for a dotted type, so `+` — .NET's nested-type separator, as in `[System.Environment+SpecialFolder]` — is that same `choice` widened to a separator set, and it cannot interact with anything else because a type name's only other continuation is `.`. `command_parameter`'s class had no `=`, so `--flag=value` split at the `=` and the remainder fell to `assignement_operator`, which is not valid in command-argument position. `=` is admitted to the DOUBLE-DASH branch ONLY: a native command's `--flag=value` really is one argv token, whereas PowerShell's own parameters are `-Name value` or `-Name:value` and `-Name=value` is not valid, so widening the single-dash class would make an INVALID form parse. Measured footprints: 11 sites for the nested type and 26 for the flag, and the residue is recorded below. The yield is out of proportion to the diff because the patch makes whole regions parse. F11 G1 damaged files 87 -> 85 with ERROR LINES 8721 -> 3748, a 57% drop; G2 identity 313 clean files with 0 tree differences; G3 +608 pairs against 4 lost. The powershell production draw's damaged files go 10 -> 9 and its relationships 9,597 -> 10,111. The one symbol the gate reports as VANISHED is a promotion, and it was checked rather than argued. `build.psm1`'s `AddRemoteIfMissing` is a `param()` block parameter; parameters are carried as `parameters` METADATA on the owning function rather than as symbols, which is the lane's design and which `suppression-and-params-psb7` pins on a separate channel. Under the pinned grammar the region did not parse, so the parameter was carried NOWHERE and only the recovery reader named it, as a file-level variable. Under G8 the enclosing function parses and the parameter is carried as `Sync-PSTags -> AddRemoteIfMissing:Switch`, with its type read: 58 functions carrying 172 parameters against 57 and 171. The three remaining lost pairs (`uses -> describe` twice, `uses -> RepoRoot`) are the same recovery-fabrication class G7 removed, from a `git --git-dir=... describe` line. Residue, recorded rather than rounded off: `--flag=$var` with a VARIABLE value is still 1 MISSING, because the value after a glued `=` has no `command_argument_sep` and a bare `variable` is not among the value alternatives. That is 8 corpus sites, and PowerShell's canonical `-Name $var` is unaffected because that form does have the separator. F11 on the G5c candidate: G1 damage 137 → 135 files and MISSING 177 → 139 with 0 newly damaged, G2 identity 263 clean files with 0 tree differences, and G3 losing exactly ONE (label,target) pair — whose target F11 prints in full as a seven-line ERROR block — against +126 pairs added. That single pair is the same false-negative class as G5b's 135, and the census confirms it: NullConditional.Tests.ps1 falls 69 → 16 ERROR nodes, NativeCommandPathUpdate.Tests.ps1 goes hasError=true → false, and the three corpus files that do not use `?.` are BIT-IDENTICAL between the two grammars. (9) G9 is the last of the big classes and the only one whose DIAGNOSIS I got wrong before the measurement forced it. I recorded this class as a genuine LR ambiguity between `array_type_name` and `generic_type_name` — the two are indeed both `seq($.type_name, '[')`, identical prefixes separated only by what follows the bracket — and I expected to fix it by reprioritising. It is not an ambiguity, and the automation said so twice while I was asserting otherwise. `prec(1)` on the generic branch of `type_spec` changed nothing at all, and declaring the conflict `[$.array_type_name, $.generic_type_name]` came back `unnecessary conflicts` from `tree-sitter generate` — which is the informative part: UNNECESSARY means the automaton has no conflict there, because the generic route was never reachable. That is the third time this lane has been told 'unnecessary conflict' (G1's `param_block` and G7's hidden token are the other two) and the lesson is the same each time: it means the competing route does not EXIST, so reprioritising cannot help and the fix has to be to add the missing derivation. The real gap is one token deep: `generic_type_arguments` was `seq($.type_spec, repeat(seq(',', $.type_spec)))`, and a `type_spec` reaches the array form only as `array_type_name` = `type_name` followed by `[` — the SUFFIX. PowerShell and C# both write the PREFIX form, `[string]`, which is a `type_literal`, and no `type_spec` production can begin with a leading `[`. So `[Dictionary[[string],[int]]]` had no derivation at all; the parser took the only route available (`array_type_name` on `Dictionary[`), expected `]`, found `[`, and produced `ERROR(array_type_name(Dictionary[))` with the remainder of the line falling out as a separate expression — which is why the damage looked like an unrelated downstream error. The admitted patch widens `generic_type_arguments`' element to `choice($.type_spec, $.type_literal)`. It is additive, it needs no conflict declaration, and it is disjoint from the existing form on the FIRST TOKEN of the argument, which is the same disjointness argument that made G6 and G7 safe rather than merely lower-precedence. A process finding worth the same record as the patch, because it changed how the work was done: `tree-sitter parse` in the vendored grammar directory compiles natively and answers in about 14 SECONDS, against 19 MINUTES for the emscripten `tree-sitter build -w` that the F11 gate needs. Every A/B for this patch was taken natively first — 691 corpus files, damaged 126 -> 123, ERROR 803 -> 788, MISSING 29 -> 27, with the six control forms checked case by case — and the wasm was built once, only after the native sweep said the patch was a win. The corollary trap cost one cycle: `tree-sitter build --output x.wasm` emits an ELF shared object, not a wasm, unless `-w/--wasm` is passed, and web-tree-sitter rejects it with `need to see wasm magic number` — a `.wasm` extension is not a request for a wasm. F11 on the built candidate: G1 damaged files 85 -> 82 with sites 580 -> 560 and MISSING 85 -> 71, fixed 3, newly damaged 0, worse 0; G2 identity 315 clean files with 0 tree differences; G3 +2 pairs against 2 lost, and the verdict is INADMISSIBLE. Both 'lost' pairs are MOVES, verified from the gate's own added list rather than argued from the source, and they are a NEW instance of this lane's recurring false negative: the first three were a pair attributed to a recovery fabrication, and this one is a pair whose TARGET GOT MORE PRECISE. Generics.Tests.ps1:44 is `$x = [dictionary[[string], [int]]]::New()`; the pinned grammar could not parse the type literal, so the analyzer recovered a method named `int::New` and published `calls -> int::New`, attributing the static call to a type ARGUMENT rather than to the constructed type that is its actual receiver. Under G9 the same line publishes `calls -> dictionary[[string], [int]]::New`. Conversions.Tests.ps1:493 is `[Func[[E], [object]]] $f = $n.GetC`, and the edge moves from `uses -> object` to `uses -> Func[[E], [object]]` — from the innermost bareword to the full type reference that owns the span. Same line, same label, strictly better target, in both cases; F11 compares (label,target) as strings and so cannot tell 'more precise' from 'gone'. Production corpora: the powershell draw's damaged files go 9 -> 8 and its MISSING nodes halve, 12 -> 6, with its relationships flat at 10,111 because both moved pairs live in files outside the 49-file draw.  (10) G10 is the class the lane's own gate nearly forbade, and the reason is the most reusable finding in this record. A value GLUED to a double-dash parameter — `--git-dir=\"$RepoRoot/.git\"`, `--flag=$var`, `--a=1` — published no edge, and the reason was that every value alternative in `_command_argument` begins with `command_argument_sep` and a glued value has none, so `redirection` won the value instead. The failure is not an error but a FABRICATION: the tree becomes a redirection carrying a MISSING `>`, which is invisible to F1, F10 and the M12 ERROR-node census, and the analyzer then publishes the value as a redirected file. Two prior measurements made it worse than invisible — on the first run of the A/B harness, which counted only ERROR, `--git-dir=$R` and `--a=1` were reported as CLEAN. Two designs were built and REJECTED before the third, and both rejections are about the LEXER rather than the parser. Attempt 1 added a `_glued_command_parameter` token requiring a trailing `=`, with `token(prec(1, ...))`, reasoning that lexical precedence would make it win exactly the ties it needed. F11 returned INADMISSIBLE: 274 clean files changed tree shape, 71 symbols changed owner, 19 pairs lost. The cause is that tree-sitter resolves LEXICAL precedence BEFORE LENGTH, so `prec(1)` made the glued token win even when its match was SHORTER — and `--flag=alnum`, which `command_parameter` matches whole and which is CLEAN across the corpus, was split into a parameter plus a value everywhere. Attempt 2 dropped the precedence, reasoning that length would then decide; that is also unworkable, because two tokens matching the SAME text at the SAME length is unresolvable by precedence OR by length, and `--a=1 --b=2` measured 2 ERROR where the pinned grammar had one SILENT MISSING. The third design has NO SECOND TOKEN. It is a PARSER alternative — `command_parameter` followed immediately by a literal or a variable, with no separator — and `command_parameter` itself is left byte-for-byte as it was, which is the entire safety argument: with nothing about the lexer moving, `--flag=alnum` cannot change shape. CORRECTION, and it is the reason this paragraph is longer than the others. The native sweep said 0 clean files changed shape, 7 became clean and 0 became broken, and the 7 was WRONG about the product. F11 runs on web-tree-sitter 0.25.9 and reported G1 fixed 0 and G3 at ZERO changed pairs: on the runtime the product actually loads, this patch is INERT. The 7 were an artefact of the native CLI being 0.26.9, and the same bytes parse differently under the two — the version skew this lane has now been bitten by repeatedly, and the first time it has bitten a patch's BENEFIT rather than its safety. What the native sweep DID establish is the half that matters for admissibility: 0 clean files changed shape, which F11 then confirmed on its own runtime at 0 differences over 318 clean files. F11 then confirmed G2 at 0 tree differences over 318 clean files and G3 at ZERO changed pairs. `generic_token` is deliberately absent from the value choice for the same reason it is absent from attempt 1: `--flag=alnum` is clean today because `command_parameter` matches the whole token, so admitting `generic_token` would split that clean node into two children. The generalisable finding is the one this lane has now paid for three times: when a construct is damaged because a TOKEN cannot reach far enough, adding a token moves the LEXER, and every clean file that relied on the old token's full extent is collateral. The fix belongs in the PARSER unless the token itself is wrong. The id digest is unchanged at 429 ids / 152 named types for exactly this reason — a parser alternative adds no node type, so no analyzer written against the old shapes is re-pointed. F11's own G1 row shows 0 fixed and G3 shows zero changed pairs. The first reading of that was a SAMPLE-CAP explanation — the gate caps at 400 files per corpus and the 7 the full sweep found are outside it. That explanation was checked and is WRONG: re-parsing the failing cases directly through web-tree-sitter 0.25.9 reproduces the errors, so the sample never saw a fix because there was none to see on this runtime. The patch is kept because it is ADMISSIBLE and free — G2 0 differences over 318 clean files, G3 zero changed pairs, id digest unchanged at 429/152 — not because it is known to help. A patch that changes nothing on the product runtime should not be described as a repair, and the grammar's own record now says so. The 38-site and 10-site corpus footprint is spent; what remains in this class is recorded below as unmeasured rather than as a plan.",
    alternatives: [
      {
        option: "G5c as a new precedence level, or `?.[` for element access",
        measured:
          "REJECTED on measurement, and both halves of it came from the corpus rather than from taste. The corpus target disagrees with the documentation on the element-access form: PowerShell's own test/powershell/Language/Operators/NullConditional.Tests.ps1 uses `?[` (6 × `?[0]`, plus `?[tb]`, `?['a']`, `?[-2]`, `?[0..2]`, `?[0,1]`, `?[]`, `?[1234]`) and never `?.[`, so a `?.[` implementation would have satisfied the docs and none of the corpus. And a precedence LEVEL was rejected for the same reason G5a's named levels were: `?.` binds exactly like `.` and `?[` exactly like `[`, so the correct edit is one `choice` arm inside the rule that already defines the twin, inheriting its associativity — which is also what makes the corpus's `${psObj}?.name?.nonExistent` chain and its `(Get-Item $TestDrive)?.EnumerateFiles()?.Name` compose without a new level at all.",
        artifact: "validation/m60/results/powershell-grammar-g5c-ab.json",
      },
      {
        option: "G5 with the two precedence levels left NAMED (the first attempt)",
        measured:
          "REJECTED on measurement, and it is the most instructive rejection in this lane. It scored a clean win on every count the repro battery reports — 2 of 12 named limits fixed, 0 regressions, all 9 controls held — and the collateral gate passed too, 0 files broken. It was still the wrong patch, and only the SHAPE delta caught it: a named level emits its node in the pass-through case as well, so adding two levels wrapped EVERY expression in the language and produced 9,046 `coalesce_expression` and 9,038 `ternary_expression` nodes across 49 corpus files, re-pointing an analyzer written against the old shapes while every other number said 'pure win'. Hiding both levels makes the rules inline, so an expression using neither operator produces exactly the tree it produced before and F11's G2 identity gate passes by construction rather than by luck.",
        artifact: "validation/m60/results/powershell-grammar-g5b-ab.json",
      },
      {
        option: "the previously wired version, tree-sitter-powershell@0.25.10 (sha 1d30b5a21866354aa2eb94845556f1e19126ff00e3335048719a0e6435b1c154, 983,236 bytes)",
        measured:
          "0.25.10 vs 0.26.4 unpatched, production corpora: damaged files 16/49 powershell and 15/24 ansible on BOTH; ERROR nodes 93 → 91 in ansible; named vocabulary IDENTICAL (152) so no analyzer is re-pointed; 0 files broken. The base upgrade buys the here-string fix and nothing else, which is why it is recorded as taken rather than as a repair.",
        artifact: "validation/m60/results/powershell-grammar-upgrade-ab.json",
      },
      {
        option: "patch the source while the wired bytes stay 0.25.10",
        measured:
          "REJECTED, and this is the reason the pin exists. The npm cache held 0.26.4 and the first draft of this lane's review called it the wired grammar's source; it is not. Rebuilding the cache's source gives 419 ids against the wired wasm's 415 and a different id-order digest, so a hunk written against that grammar.js would have been a patch on a DIFFERENT grammar and every A/B number attributed to it would have been unattributable. Found by measuring the surface gap before writing any hunk, not after.",
        artifact: "validation/m60/results/powershell-grammar-upgrade-ab.json",
      },
    ],
    evidence: [
      "validation/m60/results/powershell-grammar-g1-ab.json",
      "validation/m60/results/powershell-grammar-g5c-ab.json",
      "validation/m60/results/powershell-g5c-g3-adjudication.txt",
      "validation/m60/results/powershell-grammar-g5b-ab.json",
      "validation/m60/results/powershell-g5-g3-adjudication.txt",
      "validation/m14/results/M14.0.F11.powershell.json",
      "validation/m60/results/powershell-grammar-upgrade-ab.json",
      "validation/m60/results/powershell-surface.json",
      "reviews/powershell/resolution.md",
      "reviews/powershell/grammar-worklist.md",
    ],
    // A SECOND copy used to be listed here: "the pre-patch local build, preserved for
    // bisect", pointing at /tmp/opencode/ps-lane/wired-0.26.4-unpatched.wasm. It is
    // removed, and the reason is the gate finding it: the pin reported the copy as
    // VANISHED. A /tmp path is scratch by definition, so a durable record naming one
    // fails on the next cleanup, on another machine, or in CI — the pin would be
    // asserting provenance it cannot re-establish. The npm-cache tarball copy above
    // carries the same bytes (sha 796124137f05…, 1,088,467 B) and IS re-derivable, so
    // the bisect capability survives without an artifact that cannot exist tomorrow.
    copies: [
      { label: "npm tree-sitter-powershell@0.26.4 (the UNPATCHED base these bytes are a patch of)", path: path.join(CACHE, "tree-sitter-powershell@0.26.4@@@1/tree-sitter-powershell.wasm") },
    ],
    notVendored: [
      { path: "src/parser.c", why: "generated from grammar.js; 4.5 MB; `tree-sitter generate` rebuilds it" },
      { path: "src/grammar.json, src/node-types.json", why: "generated from grammar.js; the source↔wasm check runs on these after regenerating them" },
      { path: "bindings/, binding.gyp, prebuilds/", why: "native bindings, not parser source" },
      { path: "queries/highlights.scm", why: "editor queries; the engine does not load them" },
      { path: "tree-sitter-powershell.wasm", why: "the wired bytes; they live at wasm/ and are pinned by sha here" },
    ],
  },
    scss: {
    wired: "wasm/tree-sitter-scss.wasm",
    provenance: {
      kind: "local-rebuild-from-npm-dependency",
      base: {
        package: "tree-sitter-scss",
        version: "1.0.0",
        // the package declares `tree-sitter-css: ^0.20.0`, a RANGE. Left as a range,
        // a rebuild is not a rebuild: any 0.20.x would satisfy it and the generated
        // parser would differ. The exact version is pinned here and in the note below
        // precisely so that this is a decision and not an accident of a lockfile
        // nobody reads.
        pinnedExactly: true,
        depOf: { package: "tree-sitter-css", version: "0.20.0" },
      },
      patches: [
        "use_statement / forward_statement: Sass's module system has optional clauses these rules never allowed — `as <namespace>`, `as *`, `with (<config>)`, and `show`/`hide <members>` on @forward. As written each rule was `seq('@use', $._value, ';')`, so every `as` clause was an ERROR: `@use 'sass:map';` parsed and `@use 'sass:map' as map;` — the form Sass documents — did not. Measured over 244 .scss files this was the single largest residual class, the bare token `as` at 277 error spans. Two sub-fixes were needed and the first attempt at each was wrong in an instructive way. (a) `with (<config>)` was first written to allow only `$._value`, so `with ($a: 1)` matched the `$a` and then reported `(UNEXPECTED '1')` — which reads like a value problem and is actually a missing `:` separator, because Sass's clause is a list of `$name: value` PAIRS. (b) the `as` clause was first written with `$._value`, which admits `binary_expression` and collided with the dashed-prefix form. The `as` target is therefore `choice($.identifier, $.variable, $._concatenated_identifier)`, and the whole clause is modelled in the grammar's OWN loose style (the `$._value, repeat(seq(optional(','), $._value))` pattern already at lines 86-87) rather than with a strict grammar for Sass config objects: a strict model is a second research project, and the analyzer reads these clauses by SLICING node.text, never by naming a node type, because slicing text cannot fall behind a grammar change (M60 R10). Repro: @use 'sass:map' as map;",
        "declaration + parameter: Sass's `!default` / `!global` flag. The declaration rule allowed `optional($.important)` and nothing else, so `$a: 1 !default;` — the most common line in a Sass variable file, and the entire point of a configurable default — was an ERROR, at 210 occurrences across the corpus. Applied at BOTH sites: a variable declaration and a mixin/function parameter default, which is where Sass puts it most often (`@mixin button($bg: $grey !default)`). Repro: $x: 1 !default;",
        "list_value + parenthesized_value (LOCAL PATCH 4): MAP LITERALS. `map.merge((...), $default)` did not parse in ANY form -- measured over 12 hand-built cases, every map form failed (single pair, several pairs, trailing comma, `$var` key, `$var` value, bare-identifier key, multi-line, nested) while lists passed, so the rule was the whole of the gap. Patched by EXTENDING TWO EXISTING RULES rather than adding a third, which is the entire content of the patch: `list_value` also accepts a keyed entry `KEY ':' VALUE`, and the inherited CSS `parenthesized_value` is widened from `'(' $._value ')'` to also accept `'(' $._value ':' $._value ')'`. The single-pair form is why it looked arbitrary -- it lost to `parenthesized_value` while two-or-more pairs parsed, because a comma settles the conflict before precedence is consulted, and `prec.dynamic` cannot help because the conflict is resolved when the parser is GENERATED. Three EARLIER attempts at this same gap added a new `map_value` rule and were measured and REVERTED (SCSS-L8): in `_value` at prec 1 it fixed 5 files and regressed none while driving ERROR nodes 3,900 -> 8,056; scoped to call arguments it fixed 4 and REGRESSED 9; with `prec.dynamic` it was worse. A new rule competes in every declaration, selector and interpolation in the language, and where it loses tree-sitter recovers with an error node -- which is why the file-level A/B reported '0 regressed' on a change that made the lane's worst files much worse. Adding no new rule is what makes this one clean: +7 files, 0 regressed, ERROR 3,900 -> 3,340. Measured: 10 of the 12 cases now parse, including the `map.merge` shape the corpus actually uses.",
        "_include_arguments (LOCAL PATCH 5): the `@include` CLOSING delimiter no longer demands immediacy. The rule used `token.immediate` on BOTH parens, and `token.immediate` means zero intervening whitespace, so an `@include` whose argument list was not written with the parens hard against the argument did not parse at all -- `@include f( 1px );` fails on a single SPACE on one line, and the multi-line form (a design-system stylesheet's house style) fails too. A plain call with the same layout always parsed, which localises the fault to this rule's delimiters rather than to Sass or the lexer. It is the FIRST error in 15 of the 63 element-plus files that still failed, across `set-css-var-value` (10) and `css-var-from-global` (5). Only the closing delimiter is relaxed; `token.immediate('(')` stays because Sass genuinely forbids whitespace between a mixin name and its argument list. Measured: +8 files, 0 regressed, ERROR 3,340 -> 3,089.",
        "DECLARED, NOT PATCHED: `@forward 'x' as prefix-*;`, the PREFIX form of the `as` clause. It requires `repeat1(seq('-', …))` after the name, which tree-sitter reports as an unresolved conflict with `binary_expression` (a `$._value` can itself be `a - b`). It occurs ZERO times in 40,521 lines of corpus, where 359 uses are `as *` and 1 is `as common`. The A/B carries it as `forward-as-dashed-prefix` with verdict `unchanged-broken` rather than omitting it, so the unsupported form is named in the evidence instead of absent from it. A grammar conflict taken on for a construct with no evidence is a risk incurred on somebody else's behalf.",
      ],
      patchEvidence:
        "validation/m14/results/scss-grammar-ab.json — an A/B over the 244 non-empty .scss files in 4 corpora (element-plus, phpmyadmin, vue-core, vue-element-admin), instrument script/m14/tmp/scss-grammar-ab.ts. Both patches together: 73 -> 149 files parsing clean (29.9% -> 61.1%), 76 FIXED, 0 REGRESSED, ERROR nodes 5,624 -> 3,900, and all 3 regression controls (`!important`, mixin+include, `#{$p}` interpolation) unchanged-clean; and the byte-reproducibility check that the locally generated parser matches the package's own shipped src/parser.c exactly (73/244 and 5,624 ERROR nodes on both) — which is the measurement that identifies the base dependency version rather than assuming it. Per corpus: element-plus 16 -> 90, phpmyadmin 50 -> 52, vue-core 1 -> 1, vue-element-admin 6 -> 6, which is why the instrument reports per-repo rather than an aggregate — 17.6% average is element-plus at 16/160 and phpmyadmin at 50/74 wearing the same number. This is the FIRST grammar lane whose win is measured on a corpus the grammar was not written for: 0.20.0 is the version the package declares, not one chosen for the corpus.",
      buildRequires: [
        "`npm install --no-save tree-sitter-css@0.20.0` inside grammars/tree-sitter-scss/ before `tree-sitter generate`. grammar.js line 9 is `const CSS = require('tree-sitter-css/grammar')`, so the build is NOT self-contained and fails with `Cannot find module 'tree-sitter-css/grammar'` without it.",
        "tree-sitter.json is REQUIRED for ABI 15 and is NOT in the npm tarball. Without it `tree-sitter generate` warns and silently emits ABI 14. It was authored here, and the wired bytes are ABI 15.",
      ],
    },
    source: {
      state: "vendored",
      dir: "grammars/tree-sitter-scss",
      note:
        "grammar.js (upstream 1.0.0 byte-for-byte except the two marked LOCAL PATCH hunks) + src/scanner.c + package.json + README.md, from the npm tarball tree-sitter-scss@1.0.0, PLUS an authored tree-sitter.json. The external scanner is REQUIRED, not optional: its TokenType enum is exactly CONCAT, which backs `_concatenated_identifier` and therefore SCSS interpolation such as `#{$a}-suffix`. It is the fourth grammar in this repo whose hand-written scanner needed an explicit `.gitignore` negation, because the blanket `grammars/tree-sitter-*/src/*` rule silently untracks it. The GENERATED src/parser.c is deliberately not vendored: `tree-sitter generate` rebuilds it, and the source↔wasm check runs on the generated JSONs. THERE IS NO LICENSE FILE IN THE TARBALL — the only evidence of the licence is package.json's `\"license\": \"MIT\"` field, which is a claim by the publisher rather than a licence text. That is recorded here rather than papered over with a substituted file.",
    },
    decision:
      "Pin the local patched rebuild, and require the source↔wasm proof rather than a hash. The alternative was to leave .scss on the CSS grammar, which is where it was routed: 43 of 244 files parsed clean (17.6%) with 30,767 ERROR nodes, because the CSS grammar has no `$variables`, no `@mixin`/`@include`, no `@use`/`@forward` and no interpolation. The stock SCSS grammar was NOT sufficient on its own and was measured before being adopted: 73/244 (29.9%), i.e. better than CSS but still leaving 171 files failing, which is why two patches were written rather than the package being wired as shipped. The trade is recorded rather than hidden: the wired bytes are ours, they are an ABI 15 build of a dependency-based grammar, and 96 of 244 corpus files still fail and are DECLARED rather than claimed.",
    alternatives: [
      {
        option: "leave .scss routed to the CSS lane and declare the dialect unsupported",
        measured:
          "Rejected on measurement: 43/244 clean (17.6%) and 30,767 ERROR nodes, and the lane would carry a routing claim for a dialect its grammar cannot read. This is the status quo and it is the thing the SCSS lane exists to replace.",
        artifact: "validation/m14/results/scss-grammar-ab.json",
      },
      {
        option: "wire tree-sitter-scss@1.0.0's shipped src/parser.c as-is, unpatched",
        measured:
          "Rejected on measurement: 73/244 clean (29.9%). It is 1.4x better than the CSS grammar and still leaves 171 files failing, dominated by the `as` clause at 277 error spans. Its value was as the BASE — and it did establish something worth keeping, since the locally generated parser reproduces its shipped parser.c exactly (73/244, 5,624 ERROR nodes both), which is how the 0.20.0 dependency was identified rather than assumed.",
        artifact: "validation/m14/results/scss-grammar-ab.json",
      },
      {
        option: "rebuild SCSS on top of this repo's patched tree-sitter-css 0.25.0 instead of the 0.20.0 it declares",
        measured:
          "NOT POSSIBLE as written, and worth recording because it was the more attractive option — it would have inherited all four CSS patches for free. tree-sitter-scss 1.0.0 is CommonJS (`module.exports = grammar(require('tree-sitter-css/grammar'), {...})`) and tree-sitter-css 0.25.0 ships an ES-module grammar.js, so `require` of it fails with `ReferenceError: grammar is not defined` under the CLI's loader. Bridging it needs either a CJS shim that re-exports the ESM grammar or a port of the SCSS extension to ESM, and the port would also have to reconcile rule-name drift between 0.20 and 0.25 across the ~20 rules the extension overrides. That is a real project with a real risk of silent shape change, and it was declined in favour of two measured patches. The cost of declining is that SCSS does not inherit the CSS lane's `url(../)`, float-keyframe, IE-`progid:` or at-rule-ident fixes; measured cost is unquantified, which is itself the honest statement.",
        artifact: "validation/m14/results/scss-grammar-ab.json",
      },
    ],
    evidence: [
      "validation/m14/results/scss-grammar-ab.json",
      "validation/m14/results/wasm-provenance-census.json",
      "reviews/m49-css-review.md",
    ],
    // Deliberately EMPTY, and that is a fact rather than an omission. Every other
    // vendored lane lists a copy of the same wasm elsewhere on this machine so the
    // pin can prove the wired bytes are the ones that were compared. tree-sitter-scss
    // 1.0.0 ships NO prebuilt wasm at all (its `prebuilds/` are native node
    // bindings), so there is nothing to compare against and a path that resolves to
    // nothing would render as `absent` in the census — a row that looks like a
    // finding and is really just a wrong assumption in this file. The equivalent
    // proof is behavioural and lives in the A/B: the locally generated parser
    // reproduces the package's shipped src/parser.c exactly.
    copies: [],
    notVendored: [
      { path: "prebuilds/, bindings/, binding.gyp", why: "native node bindings for 4 platforms; not parser source, and the engine loads the wasm" },
      { path: "src/parser.c, src/grammar.json, src/node-types.json, src/tree_sitter/", why: "generated by `tree-sitter generate`; the source↔wasm proof runs on the generated JSONs instead" },
      { path: "queries/", why: "syntax highlighting queries; no consumer in this repo reads them" },
      { path: "LICENSE", why: "NOT PRESENT IN THE TARBALL. tree-sitter-scss@1.0.0 ships no licence file; package.json declares `license: MIT` and nothing more. Recorded as absent rather than substituted." },
      { path: "node_modules/ (tree-sitter-css@0.20.0)", why: "a build-time dependency, not source. The exact version is recorded in provenance.base.depOf and in buildRequires, because the package's own range is `^0.20.0` and a range is not a pin." },
    ],
  },
    yaml: {
    wired: "wasm/tree-sitter-yaml.wasm",
    provenance: {
      kind: "byte-identical-to-npm-tarball",
      package: "@tree-sitter-grammars/tree-sitter-yaml",
      version: "0.7.1",
    },
    source: {
      state: "vendored",
      dir: "grammars/tree-sitter-yaml",
      note:
        "grammar.js + tree-sitter.json + package.json + README.md + LICENSE + src/ (scanner.c, the three schema backends schema.core.c/schema.json.c/schema.legacy.c, the generated grammar.json and node-types.json, and the tree_sitter/ runtime headers), byte-for-byte from `npm pack @tree-sitter-grammars/tree-sitter-yaml@0.7.1`. The GENERATED src/parser.c (1.29 MB) is deliberately not vendored: `tree-sitter generate` rebuilds it from grammar.js, and the source<->wasm check below runs on node-types.json/grammar.json, not on parser.c. Unlike haskell and elixir, the generated JSONs ARE tracked here -- see the .gitignore entry, which explains that a clone carrying grammar.js but not node-types.json can rebuild a working parser and cannot run the proof.",
    },
    decision:
      "Pin as-is, and vendor the source, with NO wire change. Three independent measurements agree that the wired bytes are the right bytes: (1) `npm pack` of 0.7.1 + sha256 of the extracted tree-sitter-yaml.wasm is e752dc21c3591df9b45692fe417d101f45d1828c28c44d79005f4066dc7e4e91 / 189,255 B, an EXACT match for wasm/tree-sitter-yaml.wasm with no inference from size or date; (2) 0.7.1 is the newest published release (2025-05-22) of the only maintained fork, and its parent ikatyang/tree-sitter-yaml has been dormant since 0.5.0 (2021-04-18) and publishes no wasm at all, so it is not a wire candidate; (3) the source<->wasm check below is green with an EMPTY allowance, i.e. all 36 named types the source declares exist in the wired wasm and every wasm-named type is declared by the source. The pin therefore upgrades an existing DOC-ONLY claim (docs/analyzers/real-yaml-analyzer.md) into a gated contract, and changes nothing the product loads.",
    alternatives: [
      {
        option: "ikatyang tree-sitter-yaml@0.5.0 (the fork parent)",
        measured: "publishes no wasm -- the 0.5.0 tarball contains only src/parser.c, so it cannot be a wire candidate without a local build, and its last release predates the fork by four years",
        artifact: "reviews/yaml/research-and-plan.md §2.1",
      },
      {
        option: "rebuild the wire with -DYAML_SCHEMA=legacy to reach timestamp_scalar",
        measured: "not attempted, and recorded as declined rather than as pending: it would replace the newest published bytes with a local build whose only gain is one scalar type, at the cost of making the lane's scalar typing disagree with every YAML 1.2 consumer that reads the same file. A pin is a claim about what is shipped; changing what is shipped is a different act with its own A/B (script/m14/verify-grammar-leaves.ts).",
        artifact: "reviews/yaml/research-and-plan.md §4 (defect Y12) and §2.1",
      },
    ],
    evidence: [
      "reviews/yaml/research-and-plan.md",
      "script/m14/spec/yaml-completeness.json",
      "validation/m60/grammar-survey.json",
    ],
    copies: [
      { label: "mirror", path: path.join(MIRROR, "tree-sitter-yaml.wasm") },
    ],
    notVendored: [
      { path: "binding.gyp, bindings/, prebuilds/", why: "native bindings and prebuilds; not parser source" },
      { path: "queries/", why: "editor queries; the engine does not load them" },
      { path: "src/parser.c", why: "generated from grammar.js; 1.29 MB; `tree-sitter generate` rebuilds it" },
      { path: "tree-sitter-core_schema.wasm, tree-sitter-json_schema.wasm", why: "the other two schema builds as PREBUILDS; the backend is selected at COMPILE time by -DYAML_SCHEMA, so the choice belongs in the source tree (the three schema.*.c files), not in three wired wasms" },
      { path: "tree-sitter-yaml.wasm", why: "the wired bytes; they live at wasm/ and are pinned by sha here" },
    ],
  },
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------
export interface Surface {
  ids: number
  uniqueNames: number
  namedIds: number
  namedUnique: number
  anonIds: number
  anonUnique: number
  fieldCount: number
  idOrderDigest: string
  typeSetDigest: string
  fieldSetDigest: string
}

export interface MeasuredLane {
  wired: { file: string; sha256: string; bytes: number }
  surface: Surface
  copies: Array<{ label: string; path: string; sha256: string | null; byteIdentical: boolean; absent?: boolean }>
  vendored:
    | { state: "vendored"; dir: string; files: Record<string, { sha256: string; bytes: number }>; digest: string; fileCount: number }
    | { state: "not-obtainable-offline" }
  sourceVsWasm:
    | { nodeTypesJson: string; declaredNamedTypes: number; declaredSupertypes: number; wasmNamedUnique: number; wasmUniqueNames: number; missingInWasm: string[]; allowedWasmExtras: string[]; namedOnlyInWasm: string[] }
    | { nodeTypesJson: null; note: string }
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walkFiles(abs))
    else if (e.isFile()) out.push(abs)
  }
  return out
}

let _wtsReady: Promise<any> | null = null
async function wts() {
  if (!_wtsReady) {
    _wtsReady = (async () => {
      const wtsMod: any = await import("web-tree-sitter")
      const ParserClass = wtsMod.Parser ?? wtsMod.default ?? wtsMod
      await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
      return { Language: wtsMod.Language ?? wtsMod.default?.Language }
    })()
  }
  return _wtsReady
}

export async function measureSurface(absWasm: string): Promise<{ surface: Surface; namedUnique: string[]; uniqueNames: string[] }> {
  const { Language } = await wts()
  const g = await Language.load(fs.readFileSync(absWasm))
  const ids: string[] = []
  const pairs: string[] = []
  const named: string[] = []
  const anon: string[] = []
  for (let i = 0; i < g.nodeTypeCount; i++) {
    const name = String(g.nodeTypeForId(i) ?? "")
    const isNamed = !!g.nodeTypeIsNamed(i)
    ids.push(`${i}\u0000${name}\u0000${isNamed ? 1 : 0}`)
    pairs.push(`${isNamed ? 1 : 0}\u0000${name}`)
    ;(isNamed ? named : anon).push(name)
  }
  const fields: string[] = []
  for (let i = 1; i <= g.fieldCount; i++) {
    const f = g.fieldNameForId(i)
    if (f) fields.push(f)
  }
  const surface: Surface = {
    ids: g.nodeTypeCount,
    uniqueNames: new Set([...named, ...anon]).size,
    namedIds: named.length,
    namedUnique: new Set(named).size,
    anonIds: anon.length,
    anonUnique: new Set(anon).size,
    fieldCount: g.fieldCount,
    idOrderDigest: sha256Text(ids.join("\n")),
    typeSetDigest: sha256Text(pairs.slice().sort().join("\n")),
    fieldSetDigest: sha256Text(fields.slice().sort().join("\n")),
  }
  g.delete?.()
  return { surface, namedUnique: [...new Set(named)].sort(), uniqueNames: [...new Set([...named, ...anon])].sort() }

}

export async function measureLane(file: string): Promise<MeasuredLane> {
  const abs = path.join(ROOT, file)
  const buf = fs.readFileSync(abs)
  const { surface } = await measureSurface(abs)
  return {
    wired: { file, sha256: sha256(buf), bytes: buf.length },
    surface,
    copies: [],
    vendored: { state: "not-obtainable-offline" },
    sourceVsWasm: { nodeTypesJson: null, note: "not measured" },
  }
}

export function measureCopies(lane: LaneDecision, wiredSha: string): MeasuredLane["copies"] {
  return lane.copies.map((c) => {
    if (!fs.existsSync(c.path)) return { label: c.label, path: c.path.replace(HOME, "~"), sha256: null, byteIdentical: false, absent: true }
    const sha = sha256(fs.readFileSync(c.path))
    return { label: c.label, path: c.path.replace(HOME, "~"), sha256: sha, byteIdentical: sha === wiredSha }
  })
}

export function measureVendored(root: string, lane: LaneDecision): MeasuredLane["vendored"] {
  if (lane.source.state !== "vendored") return { state: "not-obtainable-offline" }
  const dir = path.join(root, lane.source.dir)
  const files: Record<string, { sha256: string; bytes: number }> = {}
  for (const abs of walkFiles(dir)) {
    const buf = fs.readFileSync(abs)
    files[path.relative(dir, abs).split(path.sep).join("/")] = { sha256: sha256(buf), bytes: buf.length }
  }
  const digest = sha256Text(Object.entries(files).map(([p, f]) => `${p}:${f.sha256}`).sort().join("\n"))
  return { state: "vendored", dir: lane.source.dir, files, digest, fileCount: Object.keys(files).length }
}

/**
 * The offline source↔wasm proof. Names, not flags: a supertype is declared in
 * `node-types.json` (with `named: true`) but materialises in the parser as a
 * hidden symbol, so the declared set is looked up in the wasm's WHOLE id space.
 */
export function sourceVsWasmFor(root: string, lane: LaneDecision, namedUnique: string[], uniqueNames: string[]): MeasuredLane["sourceVsWasm"] {
  if (lane.source.state !== "vendored") return { nodeTypesJson: null, note: "no vendored source" }
  const dir = path.join(root, lane.source.dir)
  // A grammar that ships more than one (upstream's XML repo holds `xml/` and
  // `dtd/` side by side) keeps its generated src/ under its OWN subdirectory, so
  // the lane names it rather than the probe guessing.
  const srcDir = path.join(dir, (lane.source as any).srcSubdir ?? "src")
  const nt = path.join(srcDir, "node-types.json")
  const gj = path.join(srcDir, "grammar.json")
  if (!fs.existsSync(nt) || !fs.existsSync(gj)) {
    return {
      nodeTypesJson: null,
      note:
        `the vendored tree carries no generated node-types.json + grammar.json pair under ${path.relative(root, srcDir) || "src"}, so the source↔wasm check cannot run for this lane; the recorded substitute is the measured surface delta against the base release's own wasm (see the decision's alternatives)`,
    }
  }
  const ntEntries = JSON.parse(fs.readFileSync(nt, "utf8")) as Array<{ type: string; named?: boolean }>
  const declaredNamed = new Set<string>()
  for (const e of ntEntries) if (e.named && typeof e.type === "string") declaredNamed.add(e.type)
  const supertypes: string[] = (JSON.parse(fs.readFileSync(gj, "utf8")).supertypes ?? []) as string[]
  const wasmAll = new Set(uniqueNames)
  const wasmNamed = new Set(namedUnique)
  const missingInWasm = [...declaredNamed].filter((t) => !wasmAll.has(t))
  const namedOnlyInWasm = namedUnique.filter((t) => !declaredNamed.has(t))
  return {
    nodeTypesJson: path.relative(root, nt).split(path.sep).join("/"),
    declaredNamedTypes: declaredNamed.size,
    declaredSupertypes: supertypes.length,
    wasmNamedUnique: wasmNamed.size,
    wasmUniqueNames: wasmAll.size,
    missingInWasm,
    allowedWasmExtras: namedOnlyInWasm.filter((t) => BUILTIN_WASM_SYMBOLS.has(t)),
    namedOnlyInWasm: namedOnlyInWasm.filter((t) => !BUILTIN_WASM_SYMBOLS.has(t)),
  }
}

// ---------------------------------------------------------------------------
// The gate, as one pure function so it can be negative-tested without a wasm.
// ---------------------------------------------------------------------------
export interface PinRecord {
  schemaVersion: number
  lanes: Record<string, { wired: { file: string; sha256: string; bytes: number }; surface: Surface; copies: MeasuredLane["copies"]; vendored: any; sourceVsWasm: any }>
  decisions: Record<string, unknown>
}

export interface PinFailure {
  lane: string
  check: string
  recorded: unknown
  actual: unknown
}

export function verifyPins(record: PinRecord, actual: Record<string, MeasuredLane>): PinFailure[] {
  const failures: PinFailure[] = []
  for (const [lang, rec] of Object.entries(record.lanes)) {
    const now = actual[lang]
    if (!now) {
      failures.push({ lane: lang, check: "missing measurement", recorded: rec.wired.file, actual: null })
      continue
    }
    if (now.wired.sha256 !== rec.wired.sha256) failures.push({ lane: lang, check: "wired wasm sha256 drifted", recorded: rec.wired.sha256, actual: now.wired.sha256 })
    if (now.wired.bytes !== rec.wired.bytes) failures.push({ lane: lang, check: "wired wasm byte length drifted", recorded: rec.wired.bytes, actual: now.wired.bytes })
    for (const k of ["ids", "uniqueNames", "namedIds", "namedUnique", "anonIds", "anonUnique", "fieldCount", "idOrderDigest", "typeSetDigest", "fieldSetDigest"] as const) {
      if ((now.surface as any)[k] !== (rec.surface as any)[k]) {
        failures.push({ lane: lang, check: `surface ${k} drifted`, recorded: (rec.surface as any)[k], actual: (now.surface as any)[k] })
      }
    }
    if (JSON.stringify(now.copies) !== JSON.stringify(rec.copies)) {
      failures.push({ lane: lang, check: "local copy list changed (a copy appeared, vanished, or no longer matches)", recorded: rec.copies, actual: now.copies })
    }
    if (rec.vendored?.state === "vendored") {
      if (now.vendored.state !== "vendored") failures.push({ lane: lang, check: "vendored source tree vanished", recorded: rec.vendored.dir, actual: now.vendored.state })
      else {
        if (now.vendored.digest !== rec.vendored.digest) failures.push({ lane: lang, check: "vendored source tree drifted", recorded: rec.vendored.digest, actual: now.vendored.digest })
        for (const f of Object.keys(rec.vendored.files)) {
          if (!now.vendored.files[f]) failures.push({ lane: lang, check: `vendored file removed: ${f}`, recorded: true, actual: false })
          else if (now.vendored.files[f].sha256 !== rec.vendored.files[f].sha256) {
            failures.push({ lane: lang, check: `vendored file drifted: ${f}`, recorded: rec.vendored.files[f].sha256, actual: now.vendored.files[f].sha256 })
          }
        }
        for (const f of Object.keys(now.vendored.files)) {
          if (!rec.vendored.files[f]) failures.push({ lane: lang, check: `vendored file added without a record: ${f}`, recorded: false, actual: true })
        }
      }
    }
    if (rec.sourceVsWasm?.missingInWasm?.length) {
      failures.push({ lane: lang, check: "the record was written with the source↔wasm check already failing", recorded: rec.sourceVsWasm.missingInWasm, actual: null })
    }
    if (rec.sourceVsWasm?.namedOnlyInWasm?.length) {
      failures.push({ lane: lang, check: "the record was written with wasm-named types the source does not declare", recorded: rec.sourceVsWasm.namedOnlyInWasm, actual: null })
    }
    const nowSv: any = now.sourceVsWasm
    if (nowSv?.missingInWasm?.length) {
      failures.push({
        lane: lang,
        check: `${nowSv.missingInWasm.length} name(s) declared by the vendored source do not exist anywhere in the wired wasm's id space — the wired bytes are not a build of this source`,
        recorded: null,
        actual: nowSv.missingInWasm,
      })
    }
    if (nowSv?.namedOnlyInWasm?.length) {
      failures.push({
        lane: lang,
        check: `${nowSv.namedOnlyInWasm.length} wasm-named type(s) are not declared by the vendored source`,
        recorded: null,
        actual: nowSv.namedOnlyInWasm,
      })
    }
  }
  return failures
}

/** Negatives for the gate above — a gate nobody has watched fail is a claim. */
export function selfTestGate(): { passed: number; failures: string[] } {
  const failures: string[] = []
  let passed = 0
  const check = (name: string, cond: boolean) => (cond ? passed++ : failures.push(name))
  const surface: Surface = { ids: 10, uniqueNames: 9, namedIds: 6, namedUnique: 5, anonIds: 4, anonUnique: 4, fieldCount: 2, idOrderDigest: "a", typeSetDigest: "b", fieldSetDigest: "c" }
  const base = (): { record: PinRecord; actual: Record<string, MeasuredLane> } => {
    const m: MeasuredLane = {
      wired: { file: "wasm/x.wasm", sha256: "deadbeef", bytes: 10 },
      surface: { ...surface },
      copies: [{ label: "mirror", path: "~/.bb/wasm/x.wasm", sha256: "deadbeef", byteIdentical: true }],
      vendored: { state: "vendored", dir: "grammars/x", files: { "grammar.js": { sha256: "f00d", bytes: 3 } }, digest: "d", fileCount: 1 },
      sourceVsWasm: {
        nodeTypesJson: "grammars/x/src/node-types.json",
        declaredNamedTypes: 1,
        declaredSupertypes: 0,
        wasmNamedUnique: 5,
        wasmUniqueNames: 9,
        missingInWasm: [],
        allowedWasmExtras: [],
        namedOnlyInWasm: [],
      },
    }
    const record: PinRecord = {
      schemaVersion: 1,
      lanes: {
        x: {
          wired: { ...m.wired },
          surface: { ...surface },
          copies: JSON.parse(JSON.stringify(m.copies)),
          vendored: JSON.parse(JSON.stringify(m.vendored)),
          sourceVsWasm: JSON.parse(JSON.stringify(m.sourceVsWasm)),
        },
      },
      decisions: {},
    }
    return { record, actual: { x: m } }
  }

  // 1. an intact record passes.
  {
    const { record, actual } = base()
    check("intact record passes", verifyPins(record, actual).length === 0)
  }
  // 2. a wasm byte change fails.
  {
    const { record, actual } = base()
    actual.x.wired.sha256 = "beefdead"
    check("wired sha drift fails", verifyPins(record, actual).some((x) => /sha256 drifted/.test(x.check)))
  }
  // 3. a rebuilt grammar with different bytes AND different ids fails on the surface too.
  {
    const { record, actual } = base()
    actual.x.surface.idOrderDigest = "zzz"
    check("surface id-order drift fails", verifyPins(record, actual).some((x) => /idOrderDigest drifted/.test(x.check)))
  }
  // 4. a vendored source edit fails; a new vendored file fails even with the others intact.
  {
    const { record, actual } = base()
    actual.x.vendored.files["grammar.js"].sha256 = "cafe"
    check("vendored file drift fails", verifyPins(record, actual).some((x) => /vendored file drifted/.test(x.check)))
  }
  {
    const { record, actual } = base()
    actual.x.vendored.files["src/scanner.c"] = { sha256: "n3w", bytes: 5 }
    check("vendored file added fails", verifyPins(record, actual).some((x) => /added without a record/.test(x.check)))
  }
  // 5. a vanished local copy fails (the provenance chain moved).
  {
    const { record, actual } = base()
    actual.x.copies[0].absent = true
    check("copy list change fails", verifyPins(record, actual).some((x) => /local copy list changed/.test(x.check)))
  }
  // 6. source↔wasm disagreement fails in BOTH directions.
  {
    const { record, actual } = base()
    actual.x.sourceVsWasm = { ...(actual.x.sourceVsWasm as any), missingInWasm: ["ghost_type"] }
    check("source-declared name missing from the wasm fails", verifyPins(record, actual).some((x) => /not a build of this source/.test(x.check)))
  }
  {
    const { record, actual } = base()
    actual.x.sourceVsWasm = { ...(actual.x.sourceVsWasm as any), namedOnlyInWasm: ["invented_type"] }
    check("wasm-named type the source does not declare fails", verifyPins(record, actual).some((x) => /not declared by the vendored source/.test(x.check)))
  }
  // 7. a record written while the check was already failing is refused.
  {
    const { record, actual } = base()
    ;(record.lanes.x.sourceVsWasm as any).missingInWasm = ["ghost_type"]
    check("record with a failing check is refused", verifyPins(record, actual).some((x) => /already failing/.test(x.check)))
  }
  // 8. a pinned lane the measurement could not produce fails.
  {
    const { record, actual } = base()
    delete actual.x
    check("missing measurement fails", verifyPins(record, actual).some((x) => /missing measurement/.test(x.check)))
  }
  // 9. an extra measured lane is not a failure (the record is the list of pins).
  {
    const { record, actual } = base()
    actual["y"] = JSON.parse(JSON.stringify(actual.x))
    check("an unpinned measured lane does not fail", verifyPins(record, actual).length === 0)
  }
  return { passed, failures }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
  const write = process.argv.includes("--write")
  const selfTest = process.argv.includes("--self-test")
  if (selfTest) {
    const { passed, failures } = selfTestGate()
    for (const f of failures) console.error(`FAILED: ${f}`)
    console.log(`gate self-test: ${passed} passed, ${failures.length} failed`)
    process.exit(failures.length === 0 ? 0 : 1)
  }

  const measured: Record<string, MeasuredLane> = {}
  for (const [lang, lane] of Object.entries(LANES)) {
    const m = await measureLane(lane.wired)
    const { namedUnique, uniqueNames } = await measureSurface(path.join(ROOT, lane.wired))
    m.copies = measureCopies(lane, m.wired.sha256)
    m.vendored = measureVendored(ROOT, lane)
    m.sourceVsWasm = sourceVsWasmFor(ROOT, lane, namedUnique, uniqueNames)
    measured[lang] = m
    const sv: any = m.sourceVsWasm
    const svNote = sv.nodeTypesJson
      ? sv.missingInWasm.length || sv.namedOnlyInWasm.length
        ? `source↔wasm: ${sv.missingInWasm.length} MISSING, ${sv.namedOnlyInWasm.length} undeclared (the wired bytes are NOT this source)`
        : `source↔wasm: all ${sv.declaredNamedTypes} declared names present (${sv.declaredSupertypes} supertypes hidden by design), ${sv.wasmNamedUnique} wasm-named types all declared, ${sv.allowedWasmExtras.length} built-in extra(s)`
      : "source↔wasm: not applicable"
    console.log(
      `${lang.padEnd(8)} ${m.wired.sha256.slice(0, 12)} ${String(m.wired.bytes).padStart(9)} B  ids=${String(m.surface.ids).padStart(4)} named=${String(m.surface.namedUnique).padStart(3)} anon=${String(m.surface.anonUnique).padStart(4)} fields=${String(m.surface.fieldCount).padStart(3)}  copies:${m.copies.map((c) => (c.absent ? `${c.label}=absent` : c.byteIdentical ? `${c.label}=IDENTICAL` : `${c.label}=differs`)).join(" ")}  vendored:${m.vendored.state === "vendored" ? `${m.vendored.fileCount} files` : "none"}\n         ${svNote}`,
    )
  }

  if (write) {
    // `--lane <lang>` records ONE lane and leaves every other lane's recorded
    // block BYTE-IDENTICAL. It exists because a whole-file `--write` silently
    // launders other lanes' drift: it rewrites their recorded copies/vendored
    // hashes from whatever is on disk right now, so a lane that is red for a
    // real reason (a vanished copy, a vendored tree the repo never carried)
    // gets its failure written into the record and the gate turns green over
    // it. A scoped write is the honest way to add a lane while a sibling is red
    // — and the sibling stays red, which is the point.
    const laneArgIdx = process.argv.indexOf("--lane")
    const onlyLane = laneArgIdx >= 0 ? process.argv[laneArgIdx + 1] : undefined
    if (onlyLane && !LANES[onlyLane]) {
      console.error(`--lane ${onlyLane}: no such lane in this file (have: ${Object.keys(LANES).join(", ")})`)
      process.exit(2)
    }
    if (onlyLane) {
      const lane = LANES[onlyLane]
      const m = measured[onlyLane]
      const existing: PinRecord = JSON.parse(fs.readFileSync(REGISTRY, "utf8"))
      const record: any = { ...existing }
      record.lanes = { ...existing.lanes, [onlyLane]: { wired: m.wired, surface: m.surface, copies: m.copies, vendored: m.vendored, sourceVsWasm: m.sourceVsWasm } }
      record.decisions = {
        ...existing.decisions,
        [onlyLane]: {
          provenance: lane.provenance,
          source: lane.source,
          decision: lane.decision,
          alternatives: lane.alternatives,
          evidence: lane.evidence,
          notVendored: lane.notVendored ?? null,
        },
      }
      record.generatedAt = new Date().toISOString()
      record.commit = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim()
      if (typeof record.scope === "string") {
        record.scope = record.scope.replace(/^the six functional-family lanes \([^)]*\)/, (m0) => m0)
      }
      fs.mkdirSync(path.dirname(REGISTRY), { recursive: true })
      fs.writeFileSync(REGISTRY, JSON.stringify(record, null, 2) + "\n")
      console.log(`\nwrote ${path.relative(ROOT, REGISTRY)} (lane ${onlyLane} only; every other lane's recorded block is byte-identical)`)
    } else {
    const record: any = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      commit: execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(),
      scope: "the six functional-family lanes (clean, clojure, elixir, erlang, fsharp, haskell) plus every lane registered in this file (hcl joined 2026-09-26, M60 data/config wave); the shape extends to any lane with an entry here",
      rule:
        "A pinned grammar is its wired bytes (sha256+length), its enumerable surface (id-order, type-set and field-set digests through web-tree-sitter, with the id/named/anonymous vocabularies recorded separately), the local copies those bytes are byte-identical to, the vendored source files (per-file sha256), and the authored provenance/decision record. Verification re-measures all of it and fails on ANY drift — including a vendored source edit, a vanished copy, or a name the vendored source declares that the wired wasm does not have. Regenerating the record is an explicit act (--write), never a silent side effect of verifying.",
      lanes: {},
      decisions: {},
    }
    for (const [lang, lane] of Object.entries(LANES)) {
      const m = measured[lang]
      record.lanes[lang] = { wired: m.wired, surface: m.surface, copies: m.copies, vendored: m.vendored, sourceVsWasm: m.sourceVsWasm }
      record.decisions[lang] = {
        provenance: lane.provenance,
        source: lane.source,
        decision: lane.decision,
        alternatives: lane.alternatives,
        evidence: lane.evidence,
        notVendored: lane.notVendored ?? null,
      }
    }
    fs.mkdirSync(path.dirname(REGISTRY), { recursive: true })
    fs.writeFileSync(REGISTRY, JSON.stringify(record, null, 2) + "\n")
    console.log(`\nwrote ${path.relative(ROOT, REGISTRY)}`)
    }
  }

  const recorded: PinRecord = JSON.parse(fs.readFileSync(REGISTRY, "utf8"))
  const failures = verifyPins(recorded, measured)
  for (const f of failures) console.error(`PIN FAILURE ${f.lane}: ${f.check} (recorded ${JSON.stringify(f.recorded)} → actual ${JSON.stringify(f.actual)})`)
  if (failures.length) {
    console.error(`\ngrammar pins FAILED: ${failures.length} drift(s)`)
    process.exit(3)
  }
  console.log(`\ngrammar pins: ${Object.keys(recorded.lanes).length} lane(s) match their record`)
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
