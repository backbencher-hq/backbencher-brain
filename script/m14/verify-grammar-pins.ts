/**
 * script/m14/verify-grammar-pins.ts
 *
 * THE GRAMMAR PIN INSTRUMENT for the functional family (clean, clojure, elixir,
 * erlang, fsharp, haskell).
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
    | { state: "vendored"; dir: string; note: string }
    | { state: "not-obtainable-offline"; note: string }
  decision: string
  alternatives: Array<{ option: string; measured: string; artifact: string }>
  evidence: string[]
  copies: Array<{ label: string; path: string }>
  notVendored?: Array<{ path: string; why: string }>
}

export const LANES: Record<string, LaneDecision> = {
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

  // YAML is the first LANE in this file whose candidate set turned out to have
  // exactly ONE admissible member, and establishing that was cheap enough to do
  // exhaustively rather than by survey (reviews/yaml/research-and-plan.md §2.1):
  //
  //   @tree-sitter-grammars/tree-sitter-yaml  0.7.1  2025-05-22  ships a wasm  <- ADMISSIBLE
  //   tree-sitter-yaml (ikatyang)              0.5.0  2021-04-18  ships NO wasm (src/parser.c only)
  //   @lezer/yaml                              1.0.4  2026-01-29  Lezer/CodeMirror, not tree-sitter
  //   tree-sitter-yaml-language-server / @yhirose/tree-sitter-yaml /
  //   yaml-tree-sitter / tree-sitter-yaml-ng                        all 404 on npm
  //
  // So the version is not a preference: it is the newest published release of the
  // only maintained fork, and the wired bytes are its published file exactly.
  //
  // THE ONE THING THIS LANE'S SOURCE PROVES THAT THE OTHERS CANNOT. yaml 0.7.1 is
  // the only vendored grammar here whose scanner selects between ALTERNATIVE
  // backends at build time (src/scanner.c:7-11):
  //
  //     #ifndef YAML_SCHEMA
  //     #define YAML_SCHEMA core
  //     #endif
  //     #include _file(YAML_SCHEMA)      // -> src/schema.{core,json,legacy}.c
  //
  // and the three backends are not variants of one behaviour -- they are the YAML
  // 1.2 core schema, the JSON schema, and the YAML 1.1 legacy schema, with
  // different scalar-resolution tables (`.` resolves to STR in core and FLOAT in
  // legacy; `0` to INT 37 vs 75; `~` to NULL only in core) and `HAS_TIMESTAMP 0`
  // vs `1`. The published wasm is the `core` build, which is why `timestamp_scalar`
  // is in the grammar's symbol table and in the wired wasm's 36 named types and
  // yet is never PRODUCED by either build's scanner under `core` -- both timestamp
  // forms parse as plain_scalar(string_scalar). So this vendored source is what
  // turns "timestamp_scalar looks unreachable" from a mystery into a named build
  // variant, and it is also a limitation the lane must DECLARE: a file that opens
  // `%YAML 1.1` is resolved here with 1.2 scalar rules.
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

  // PowerShell is the lane where the pin's WORTH was measured rather than
  // assumed. Every other lane here was asked "what are these bytes?"; this one
  // was asked "can I patch this grammar at all?", and the answer turned out to
  // be no — not because the bytes are unidentifiable, but because the source
  // sitting in the npm cache was NOT the source of the wired bytes. Both facts
  // had to be established before a single grammar hunk could be attributed.
  powershell: {
    wired: "wasm/tree-sitter-powershell.wasm",
    provenance: {
      kind: "local-rebuild-from-vendored-source",
      base: { repo: "airbus-cert/tree-sitter-powershell", version: "0.26.4" },
      patches: [
        "G5a/b: PowerShell 7 null-coalescing `??` and ternary `? :`, as two HIDDEN precedence levels",
        "G5c: PowerShell 7 null-conditional `?.` and `?[`, added inside the rules that already define `.` and `[` so they inherit their associativity and precedence",
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
      "Pin the patched local rebuild, and record both decisions that got here, because both were measured and one of them was a correction. (1) The BASE was identified by fetching all four published versions and hash-matching: the wired bytes were tree-sitter-powershell@0.25.10 (sha 1d30b5a2…, 983,236 B), not the 0.26.4 sitting in the npm cache. The only thing that said so was the full id enumeration — 415 ids vs 419, id-order digests differing, and a source diff naming `_string_literal_immediate`, the here-string fix. The NAMED vocabularies are identical (152), so a pin comparing named types alone would have passed two revisions as one, and the first grammar hunk would have been written against a grammar the product does not load. (2) The 0.25.10 → 0.26.4 upgrade was measured before it was taken: 0 files fixed, 0 broken over 73 production corpus files, identical 152 named types and 14 fields, 2 fewer ERROR nodes in ansible. (3) The PATCH is G5, and its provenance is stronger than any other lane's because the base was PROVEN before it was patched: the unpatched 0.26.4 source rebuilds to the published prebuild BYTE-FOR-BYTE (same 1,088,467 B, same sha), so the patch is a delta against a known artifact rather than against whatever the source happened to be. A rebuild's sha is not a function of its source across toolchain versions (M49 W19), so the patch's own sha is a local build and the ID-ORDER digest is the part that can be required to match — 419 ids / ff141f18453a becomes 423 ids / 50274a750a87 with G5a/b and 425 ids / 2edf2378eb2c with G5c, and the 152 NAMED types are unchanged at every step, which is the property that keeps an analyzer written against the old shapes from being silently re-pointed. (4) BOTH patches are strictly additive to the rules they extend. G5a/b inserts two hidden precedence levels and edits no existing rule. G5c adds one `choice` arm to `member_access`, one to `element_access` and one to `invokation_expression`, changing no precedence number and no existing arm; the operators are `token.immediate` for the same reason the `.` in `member_access` is, so `?.` is not recognised across whitespace and `$c ? .5 : 1.5` cannot be stolen. The one form whose meaning changes is `$c?[1,2] : $y` written tight, which this grammar now reads as null-conditional indexing — which is what PowerShell itself does, so the ambiguity is resolved the way the language resolves it rather than invented here. F11 on the G5c candidate: G1 damage 137 → 135 files and MISSING 177 → 139 with 0 newly damaged, G2 identity 263 clean files with 0 tree differences, and G3 losing exactly ONE (label,target) pair — whose target F11 prints in full as a seven-line ERROR block — against +126 pairs added. That single pair is the same false-negative class as G5b's 135, and the census confirms it: NullConditional.Tests.ps1 falls 69 → 16 ERROR nodes, NativeCommandPathUpdate.Tests.ps1 goes hasError=true → false, and the three corpus files that do not use `?.` are BIT-IDENTICAL between the two grammars.",
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
    copies: [
      { label: "npm tree-sitter-powershell@0.26.4 (the UNPATCHED base these bytes are a patch of)", path: path.join(CACHE, "tree-sitter-powershell@0.26.4@@@1/tree-sitter-powershell.wasm") },
      { label: "the pre-patch local build, preserved for bisect (sha 796124137f05…)", path: "/tmp/opencode/ps-lane/wired-0.26.4-unpatched.wasm" },
    ],
    notVendored: [
      { path: "src/parser.c", why: "generated from grammar.js; 4.5 MB; `tree-sitter generate` rebuilds it" },
      { path: "src/grammar.json, src/node-types.json", why: "generated from grammar.js; the source↔wasm check runs on these after regenerating them" },
      { path: "bindings/, binding.gyp, prebuilds/", why: "native bindings, not parser source" },
      { path: "queries/highlights.scm", why: "editor queries; the engine does not load them" },
      { path: "tree-sitter-powershell.wasm", why: "the wired bytes; they live at wasm/ and are pinned by sha here" },
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

function measureCopies(lane: LaneDecision, wiredSha: string): MeasuredLane["copies"] {
  return lane.copies.map((c) => {
    if (!fs.existsSync(c.path)) return { label: c.label, path: c.path.replace(HOME, "~"), sha256: null, byteIdentical: false, absent: true }
    const sha = sha256(fs.readFileSync(c.path))
    return { label: c.label, path: c.path.replace(HOME, "~"), sha256: sha, byteIdentical: sha === wiredSha }
  })
}

function measureVendored(root: string, lane: LaneDecision): MeasuredLane["vendored"] {
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
  const nt = path.join(dir, "src/node-types.json")
  const gj = path.join(dir, "src/grammar.json")
  if (!fs.existsSync(nt) || !fs.existsSync(gj)) {
    return {
      nodeTypesJson: null,
      note:
        "the vendored tree carries no generated src/node-types.json + src/grammar.json pair, so the source↔wasm check cannot run for this lane; the recorded substitute is the measured surface delta against the base release's own wasm (see the decision's alternatives)",
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
    const record: any = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      commit: execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(),
      scope: "the six functional-family lanes (clean, clojure, elixir, erlang, fsharp, haskell); the shape extends to any lane with an entry in script/m14/verify-grammar-pins.ts",
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
