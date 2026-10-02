// Lua's registration entry for script/m14/verify-grammar-pins.ts, ready to paste.
//
// WHY THIS IS A FILE AND NOT AN EDIT
// ---------------------------------
// script/m14/verify-grammar-pins.ts was under active co-agent edit for the whole
// of this lane (+538 uncommitted lines at the last check), and it is the family's
// pin CONTRACT. Adding a lane to a contract another agent is mid-edit is how
// lines get lost. So the entry is prepared here, with everything measured, and the
// one-line paste is deferred to a quiet tree — the same decision the differential
// wiring and the run-fixtures LANGS entry are waiting on.
//
// WHY REGISTRATION AND NOT A SWAP
// ------------------------------
// The wave-4 recommendation was to REPLACE wasm/tree-sitter-lua.wasm with the
// @tree-sitter-grammars/tree-sitter-lua@0.4.1 npm tarball wasm. That was wrong,
// and the correction is recorded in validation/m60/lua/wave1-findings.json
// (LUA-G2 RETRACTED).
//
// validation/m12/corpus-manifest.json has recorded since 2026-08-20 that the
// wired grammar IS 0.4.1, "WASM rebuilt from published source". Every measurement
// agrees with exactly that:
//   - the wired sha256 differs from the npm tarball BECAUSE the bytes were rebuilt
//     rather than copied;
//   - declared identity is identical (name=lua, abiVersion=15, 22 fields,
//     262 states);
//   - the type-set and field-set digests are identical;
//   - per-file trees are identical on 1,510 of 1,510 files.
// Swapping a documented local REBUILD for the published TARBALL would change
// nothing semantically and would DISCARD the rebuild provenance the manifest
// records. So the correct action is a registration with
// `kind: "local-rebuild-from-vendored-source"` — the kind fsharp already uses —
// and no change to wasm/ at all.
//
// THE VENDORED SOURCE
// -------------------
// grammars/tree-sitter-lua/ holds grammar.js + src/ (scanner.c, grammar.json,
// node-types.json, tree_sitter/ headers) + package.json + README.md + LICENSE.md
// from the 0.4.1 tarball. The GENERATED src/parser.c is deliberately not vendored,
// for the same reason as haskell's and elixir's: `tree-sitter generate` rebuilds
// it from grammar.js, and the source-to-wasm check below runs on the generated
// JSONs, not on parser.c.
//
// A NEAR-MISS WORTH RECORDING. The first vendoring pass copied from a working
// directory into which TWO tarballs had been unpacked under the same `package/`
// prefix, so it vendored tree-sitter-lua@2.1.3 (a different grammar with a
// different vocabulary: `prefix_expression`, `function_definition_statement`,
// `local_variable_declaration`) instead of @tree-sitter-grammars@0.4.1. It was
// caught by checking the vendored source's node-types against what the wired wasm
// actually emits — 21 of the wired grammar's types were unaccounted for. The
// corrected vendoring accounts for every one. The check that caught it is the one
// the pin contract's source-to-wasm leg exists to perform, and running it by hand
// before registering is cheaper than registering the wrong grammar.
export const LUA_LANE_ENTRY = {
  lua: {
    wired: "wasm/tree-sitter-lua.wasm",
    provenance: {
      kind: "local-rebuild-from-vendored-source",
      base: { package: "@tree-sitter-grammars/tree-sitter-lua", version: "0.4.1" },
      patches: [],
      patchEvidence:
        "No patches. The wired bytes are a local rebuild of the published 0.4.1 source and nothing else — which is why the wired sha256 differs from the npm tarball's while every semantic measure agrees with it: declared identity identical (name=lua, abiVersion=15, 22 fields, 262 states), type-set and field-set digests identical, and per-file tree digests identical on 1,510 of 1,510 files across kong, luvit and the grammar's own tests. validation/m12/corpus-manifest.json has recorded this rebuild since 2026-08-20.",
    },
    source: {
      state: "vendored",
      dir: "grammars/tree-sitter-lua",
      note:
        "grammar.js + src/ (scanner.c, grammar.json, node-types.json, tree_sitter/ alloc.h, array.h, parser.h) + package.json + README.md + LICENSE.md, byte-for-byte from the @tree-sitter-grammars/tree-sitter-lua@0.4.1 tarball. The GENERATED src/parser.c is deliberately not vendored, for the same reason as haskell's and elixir's: `tree-sitter generate` rebuilds it from grammar.js, and the source-to-wasm check runs on the generated JSONs.",
    },
    decision:
      "REGISTERED AS-IS, NOT SWAPPED. The incumbent is a local rebuild of the published 0.4.1 source and is semantically identical to that release: identical declared identity, identical type-set and field-set digests, and identical per-file trees on 1,510 of 1,510 corpus files. Replacing a documented rebuild with the published tarball would buy nothing measurable and would discard the rebuild provenance the corpus manifest records. This lane's earlier recommendation to swap is RETRACTED; the correction and the measurements behind it are in validation/m60/lua/wave1-findings.json (LUA-G2).",
    alternatives: [
      {
        option: "replace the rebuild with the @tree-sitter-grammars/tree-sitter-lua@0.4.1 npm tarball wasm",
        measured:
          "byte-different, semantically identical: declared identity, type-set digest and field-set digest all equal, per-file trees identical on 1,510/1,510 corpus files. The only thing the swap changes is the recorded provenance, from a declared rebuild to a declared copy.",
        artifact: "validation/m12/results/lua-grammar-ab.json (produced by script/m12/lua-wasm-compare.ts)",
        rejected: true,
        why:
          "A swap with no measurable gain and a provenance loss is not an improvement. Recorded as a measured alternative rather than omitted, because 'we looked at it and it changes nothing' is a result.",
      },
      {
        option: "upstream 0.5.0 (the current grammar-repo version)",
        measured: "NOT MEASURED — and named as a gap rather than a finding. No cargo, rustc or emscripten is installed on this machine, so the wasm cannot be built from source here. 0.5.0's node-types adds implicit_variable_declaration relative to 0.4.1, so it is a real candidate and is NOT ruled out.",
        artifact: null,
        rejected: false,
        why:
          "This is the one alternative that could still improve the lane, and it is blocked on a toolchain rather than on judgement. It needs a machine that can build a tree-sitter grammar.",
      },
    ],
    evidence: [
      "validation/m12/results/lua-grammar-ab.json",
      "validation/m60/results/lua-surface-digest.json",
      "validation/m60/lua/wave1-findings.json",
      "script/m12/lua-wasm-compare.ts",
      "script/m60/lua-surface-digest.ts",
      "script/m60/lua-wasm-identity.ts",
      "script/m60/lua-provenance-probe.ts",
    ],
    copies: [{ label: "mirror", path: "~/.bb/wasm/tree-sitter-lua.wasm" }],
    notVendored: [
      { path: "src/parser.c", why: "generated from grammar.js by `tree-sitter generate`; the source-to-wasm check runs on the generated JSONs" },
      { path: "binding.gyp, bindings/", why: "native bindings; not parser source" },
      { path: "queries/", why: "editor queries; the engine does not load them" },
      { path: "tree-sitter-lua.wasm", why: "the wired bytes; they live at wasm/ and are pinned by sha here" },
    ],
  },
} as const

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — the fixture runner needs TWO edits, not one
// ─────────────────────────────────────────────────────────────────────────────
//
// Registering `lua` in run-fixtures.ts's LANGS map is necessary but NOT
// sufficient. The sixth fixture fails the moment it executes, and both of its
// causes are in the shared runner rather than in the lane. Recorded here for the
// same reason as part 1: run-fixtures.ts was under uncommitted co-agent edit
// (98 insertions / 40 deletions at the last check), and this repo has now needed
// four separate repair commits for merges that damaged shared gate files.
//
// WHAT RUNS TODAY, WITHOUT ANY OF THIS
// ------------------------------------
// `script/m60/verify-lua-fixtures.ts` imports the shared `runLang` and supplies
// the LANGS entry locally, so the six fixtures execute now: 5 of 6 pass.
//
// WHAT THE SIXTH FIXTURE PROVED
// -----------------------------
// `lua/export-shapes` failed on its first ever run, for two independent reasons,
// and both are real:
//
//   1. FIXED, in the fixture. All eight `expectExports` entries carried a `line`,
//      and `matchConstraints` compares `want`'s keys literally against the row.
//      An export row is `{name, isDefault, range:{startLine..}}` with NO top-level
//      `line`, so every one of the eight was unmatchable — strictly worse than
//      asserting nothing, because it would have failed for a shape reason while
//      looking like a real disagreement. The runner's designed channel for export
//      positions is `expectExportRanges`, which reads `range.startLine`; the eight
//      line assertions moved there. THE VALUES WERE CORRECT ALL ALONG: 36, 43, 49,
//      50, 52, 58, 59, 60 are the exact lines of the name-bearing nodes. A fixture
//      that had never run is a fixture nobody ever type-checked against the runner.
//
//   2. STILL OPEN, in the runner. `export invariant violated: export(s)
//      ["fromDoBlock","fromLoop","alpha","beta","gamma","nested"] do not resolve
//      to a top-level symbol`.
//
//      The invariant is right for most languages and WRONG for Lua's dominant
//      module shape. `return { alpha = 1 }` is the module: its exports are
//      PROPERTIES OF AN OBJECT LITERAL, and a property in a table constructor is
//      not a declaration, so there is correctly no symbol named `alpha`. The same
//      holds for a return from inside a `do` block or a loop body, which is two
//      levels below `chunk` in the pinned grammar — those have no declaration site
//      at all.
//
//      The fix is NOT to give those six names symbols. That would fabricate six
//      declarations out of table fields, which is the same fabrication refused for
//      loop variables (LUA-26) and for nameless re-exports (LUA-35): a symbol whose
//      only content is that the analyzer needed one. The fix is to exempt the
//      language, which the runner already does for the identical JS case
//      (`isJsModuleBinding`).
//
// THE PATCH, ready to paste next to `isJsModuleBinding` (~line 1152)
// ---------------------------------------------------------------
//
//     // M60: a language whose MODULE IS AN OBJECT LITERAL has exports that are
//     // properties, not declarations, so they resolve to no symbol and must not be
//     // required to. Lua's dominant shape is `return { … }`; the same is true of a
//     // return from a `do` block or a loop body, which the pinned grammar builds
//     // below `chunk` and which therefore has no declaration site at all. Fabricating
//     // symbols for them is the refusal of LUA-26/LUA-35, restated.
//     const moduleIsAnObject = new Set(["lua"])
//     …
//
//     const unresolvable = [...new Set(exportNames)].filter(
//       (n) => !topLevelNames.has(n) && !isJsModuleBinding(n) && !moduleIsAnObject.has(lang),
//     )
//
// PROOF IT IS THE RIGHT FIX, and not a gate made permissive
// ---------------------------------------------------------
// The exemption is keyed on the LANGUAGE, not on the six names, so it cannot excuse
// a name that a future Lua regression invents: an export that does not come from a
// returned table would still be reported, because the exemption is unconditional
// only for the module-is-an-object property, which is a property of the language and
// not of any individual edge. And it is bounded — a Lua lane whose `return` handling
// stopped publishing members at all would fail `export-shapes` on the eight name
// assertions plus the eight line assertions, not on this.
