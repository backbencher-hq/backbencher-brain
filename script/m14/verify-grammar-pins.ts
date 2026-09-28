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
      kind: "unnamed-build-sha-only",
      chain:
        "commit 34972a88 records the swap to @yogthos/tree-sitter-clojure 0.0.14 (a rewrite: list_lit/sym_lit/sym_name/sym_ns/vec_lit/kwd_lit/anon_fn_lit vocabulary, no interop nodes), after the canonical sogaiu 0.4.0 grammar failed 128/141 files of the clojure compiler's own source. No local package or source for the yogthos fork exists, so the spoken provenance cannot be re-derived here; the surface fingerprint below is the identity that CAN be checked.",
    },
    source: {
      state: "not-obtainable-offline",
      note:
        "the canonical sogaiu tree-sitter-clojure@0.4.0 source IS in the bun cache, but it is a DIFFERENT grammar from the wired wasm (the wired build's vocabulary is the fork's), so vendoring it would put a mismatched source in-tree next to the wired bytes — worse than no source. No yogthos source exists locally.",
    },
    decision:
      "Pin bytes + surface fingerprint + the commit that swapped them, and record the alternative that was measured and rejected: canonical sogaiu 0.4.0 failed 128/141 corpus files (34972a88), while the wired fork leaves 2 of 585 files damaged. A maintained fork (tree-sitter-clojure-orchard v0.2.8) is the obvious upgrade candidate but is unobtainable offline, so no claim is made about it.",
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
      kind: "unnamed-build-sha-only",
      chain:
        "pinned v1.2.7 by commit 2bc64693 (wasm sha 9ea8525d, replacing 2b805890 of v1.2.4); that round verified the tracked source tree byte-identical to `git archive v1.2.7` through the production engine, with G1/G2 adjudication in reviews/m60-clean-grammar-127-adjudication.md. The SOURCE was not vendored then, and these bytes exist in no local copy, so this pin records the sha + surface + the adjudication that adopted it.",
    },
    source: {
      state: "not-obtainable-offline",
      note:
        "the bun cache holds only tree-sitter-clean@1.2.0 (an older release whose tarball ships no wasm); nothing on this machine carries v1.2.7's source or bytes. The version claim rests on 2bc64693's own instruments (the differential table's sha, the adjudication doc, spec/clean-completeness.json).",
    },
    decision:
      "Keep v1.2.7 (already pin-verified by the clean round) and fold it into this registry so the family has one place that answers the question; for clean the answer is a sha + surface + a named adjudication rather than a vendored source.",
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
    copies: [{"label": "upstream pristine 0.3.11 (kept for A/B, NOT wired)", "path": "$HOME/fixtures/sql/grammar/pristine-sql.wasm"}, {"label": "V3 candidate (built, measured, REJECTED)", "path": "$HOME/fixtures/sql/grammar/patched-sql-v3.wasm"}, {"label": "V1 candidate (earlier, superseded by V2)", "path": "$HOME/fixtures/sql/grammar/patched-sql.wasm"}],
    notVendored: [{"path": "src/parser.c", "why": "generated by `tree-sitter generate`; 43 MB, and per the xml/hcl lanes a tracked 43 MB generated file is not vendored"}, {"path": "src/grammar.json, src/node-types.json", "why": "generated; the offline source<->wasm proof is not applicable for this lane (see sourceVsWasm)"}, {"path": "bindings/, binding.gyp, Makefile, CMakeLists.txt, Cargo.toml, go.mod, pyproject.toml, setup.py, Package.swift, queries/, test/", "why": "native/package-manager bindings, editor queries and upstream's test corpus; the engine wires none of them"}],
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
