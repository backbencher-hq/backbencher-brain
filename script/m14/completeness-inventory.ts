/**
 * M14.0.SPEC — Grammar-derived completeness inventory (#419)
 *
 * The completeness half of the honesty system: gates verify what EXISTS;
 * this verifies that EVERYTHING THE GRAMMAR DECLARES is classified — nothing
 * may be silently absent. Every public named node type in the pinned
 * language wasm must appear in exactly one bucket of
 * script/m14/spec/<lang>-completeness.json:
 *
 *   - handled_verified : the analyzer emits correctly (probe/fixture-confirmed)
 *   - internal_silent  : container/literal/keyword correctly emitting nothing
 *   - gap              : confirmed missing emission, numbered G1.. (work items)
 *   - design_decision  : owner ruling pending, never silent absence
 *
 * Gate rules (silence is guilt):
 *   1. A node type in NO bucket = failure (the inventory is incomplete).
 *   2. A node type the wasm no longer produces = stale row, reported.
 *   3. An open gap is a tracked work item, NOT a gate failure — the gate
 *      fails when a gap exists but is not declared in the classification.
 *
 * Per the ledger's "#419 section definition", a language closes #419 only
 * when ALL eight mandatory judgments are machine-verified on committed
 * artifacts. This script verifies each section per language and emits the
 * per-section checks into M14.0.SPEC evidence:
 *
 *   A. Structural completeness  — every grammar node type classified
 *   B. Every relationship kind  — all kinds the language's taxonomy requires
 *      pinned by >=1 fixture (kinds the language never produces are declared
 *      decisions, e.g. groovy exports/permits)
 *   C. Payload matrix           — required Matrix 1b rows pinned
 *   D. Evidence tiers           — >=2 distinct evidenceClass values pinned
 *   E. Corpus differential      — <lang> check in M14.0.F5.json at its floor
 *   F. Perf budget              — avgMsPerFile recorded in
 *      differential-baseline.json (F9 gate enforces it, this records it)
 *   G. Docs truthful            — the canonical docs/analyzers/<lang>.md exists
 *      (one file per analyzer; the old real-<lang>-analyzer.md name was retired 2026-11-01)
 *   H. Cross-language           — M14.CC1.json evidence exists, all checks pass
 *
 * CLI:
 *   bun run script/m14/completeness-inventory.ts                # verify all GATED langs
 *   bun run script/m14/completeness-inventory.ts --lang groovy  # verify one lang
 *   bun run script/m14/completeness-inventory.ts --list --lang groovy  # gap list only
 */
import fs from "fs"
import path from "path"

const ROOT = process.cwd()
const RESULTS = path.join(ROOT, "validation", "m14", "results")
const BASELINE = path.join(ROOT, "validation", "m14", "differential-baseline.json")

interface LangConfig {
  id: string
  wasm: string
  /** THE ANALYZER FILE, when it does not follow `real-<id>-analyzer.ts`.
   *  THE objective-c LANE IS THE CASE: its config id is `objc` and its analyzer is
   *  `src/ast/real-objective-c-analyzer.ts`, so a hardcoded `real-objc-analyzer.ts` made
   *  section G report "analyzer file absent" and NO header could ever satisfy it. The file
   *  must not be renamed -- engine.ts imports it and the docs and spec name it. */
  analyzerFile?: string
  // A SECOND grammar the lane also loads (markdown: block + inline). Declared
  // because the markdown entry carries it, and left OPTIONAL because most lanes
  // have none. FINDING, recorded rather than papered over: nothing in this file
  // reads this field, so section A classifies the named node types of `wasm`
  // ALONE while the markdown entry's own comment says "section A's classification
  // is the union of both". The union is not implemented; the field keeps the
  // claim visible instead of deleting it to quiet the compiler.
  companionWasm?: string[]
  classification: string
  fixturesDir: string
  docs: string[]
  // The name of the lane's differential check in M14.0.F5.json (section E reads
  // `perfKey` against differential-baseline.json instead, and no code anywhere
  // reads this field — measured repo-wide). OPTIONAL because the committed F5
  // snapshot does not carry a check for every lane: it has `differential-toml`
  // and no yaml id at all. A lane whose check is not in the snapshot leaves this
  // undeclared; inventing a name to satisfy the type would be a claim nothing
  // could check.
  differentialCheck?: string
  perfKey: string
  // Optional documented differential floor (C-D4): a language whose honest
  // floor carries RULED residuals (macro-expansion boundary — C cannot
  // claim 0/0 on any meaningful corpus) records them here, pinned to the
  // differential-baseline row so drift is caught. Absent => the clean
  // 0/0 floor milestone is required (all other gated languages).
  floorResidual?: { missing: number; unexplained: number; ruling: string }
  requiredKinds: string[]
  payloads: Record<string, { key: string; pin: string }>
  title: string
}

const LANG_CONFIGS: Record<string, LangConfig> = {
  // M14 #277: bash joins the SPEC gate. The lane had a completeness-shaped
  // artifact that was not one — the node-type "safety" file whose referenced
  // list was hardcoded and which never computed observed\referenced — and no
  // spec at all, so F6 (every handled type exercised, no dead analyzer
  // literal), F7 (hygiene) and F8 (every corpus type classified) could not be
  // asked the question for the lane. The classification now lives in
  // script/m14/spec/bash-completeness.json and is READ by the F8 census, which
  // fails a gap with no written ruling and a ruling for a type that is no
  // longer a gap.
  bash: {
    id: "bash",
    wasm: "tree-sitter-bash.wasm",
    classification: "bash-completeness.json",
    fixturesDir: "validation/m14/fixtures/bash",
    docs: ["docs/analyzers/bash.md"],
    differentialCheck: "differential-bash",
    perfKey: "otp:bash",
    // The six types bash's semantics allow. `extends`/`implements`/`overrides`
    // (no declaration form creates a type hierarchy) and `instantiates` (no
    // constructors) are ruled N/A in BD7 of the spec, so they are not required
    // here — the exclusion is written down rather than left as a silence.
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check.
    // It runs the lane over the lane's OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it -- published output no contract row accounted for.
    // Every kind added here is ALREADY pinned by this lane's expectation files, so the
    // forward check (required => pinned) stays green; only the missing names are added.
    // BD16 (lane ruling): `source`/`.` is textual inclusion into the calling shell's scope, so the
    // relationship is `part_of`, not `imports`. The analyzer emits no `imports` edge and the row must
    // not name one; `part_of` is pinned by validation/m14/fixtures/bash/part-of-source-inclusion.
    requiredKinds: ["calls", "uses", "contains", "references", "exports", "overrides", "part_of"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "bash/payload-and-complexity" },
    },
    title: "bash shell wave (M14 #277, BD1-BD10)",
  },
  cpp: {
    id: "cpp",
    wasm: "tree-sitter-cpp.wasm",
    classification: "cpp-completeness.json",
    fixturesDir: "validation/m14/fixtures/cpp",
    docs: ["docs/analyzers/cpp.md"],
    differentialCheck: "differential-cpp",
    perfKey: "fmt:cpp",
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check.
    // It runs the lane over the lane's OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it -- published output no contract row accounted for.
    // Every kind added here is ALREADY pinned by this lane's expectation files, so the
    // forward check (required => pinned) stays green; only the missing names are added.
    requiredKinds: ["uses", "references", "calls", "instantiates", "extends", "overrides", "imports", "contains", "exports", "implements", "part_of"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "cpp/payload-and-complexity" },
      qualified_calls: { key: "expectQualifiedCalls", pin: "cpp/payload-and-complexity" },
    },
    title: "cpp systems wave (#419)",
  },
  c: {
    id: "c",
    wasm: "tree-sitter-c.wasm",
    classification: "c-completeness.json",
    fixturesDir: "validation/m14/fixtures/c",
    docs: ["docs/analyzers/c.md"],
    differentialCheck: "differential-c",
    perfKey: "jq:c",
    // C-D4 (Holy C wave, 2026-09-05, pinned @60/lang) recorded the residual its
    // wave could not reach: jq:c 4 missing / 28 unexplained, sqlite:c 9/105, all
    // of it in the four GENERATED amalgamation files (jimsh0.c, libcmpp.c,
    // sqlite3-jni.c, sqlite3-wasm.c) behind the C-D2 no-macro-expansion
    // boundary. THAT RESIDUAL IS NOW CLOSED and the ruling is re-pinned
    // (2026-09-23) to the clean milestone, which is what section E enforces:
    // both pinned rows read 0 missing / 0 unexplained (validation/m14/
    // differential-baseline.json — jq:c sampleSetHash 2b743b65d0eac283, sqlite:c
    // ef6794727cd236d8), independently confirmed the same day by the M14.0.F5 lane
    // probes through the production entry (jq:c 45 files tree-truth 2930/2930
    // MISSING=0 unexplained=0 heuristic=0; sqlite:c 60 files 5863/5863, both 0).
    // The waves that closed it are named in C-D4's own record. Re-pinning is the
    // gate's documented path — "a future fix that lowers the residual must update
    // both, the ledger stays truthful" — and it makes the floor STRICTER, not
    // looser: any regression now fails instead of fitting under a documented
    // allowance that no longer describes the code.
    floorResidual: { missing: 0, unexplained: 0, ruling: "C-D4" },
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check.
    // It runs the lane over the lane's OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it -- published output no contract row accounted for.
    // Every kind added here is ALREADY pinned by this lane's expectation files, so the
    // forward check (required => pinned) stays green; only the missing names are added.
    requiredKinds: ["uses", "references", "exports", "imports", "calls", "contains", "instantiates", "overrides", "part_of"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "c/complexity-and-payloads" },
    },
    title: "c systems wave (#419)",
  },
  rust: {
    id: "rust",
    wasm: "tree-sitter-rust.wasm",
    classification: "rust-completeness.json",
    fixturesDir: "validation/m14/fixtures/rust",
    docs: ["docs/analyzers/rust.md"],
    differentialCheck: "differential-rust",
    perfKey: "ripgrep:rust",
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check.
    // It runs the lane over the lane's OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it -- published output no contract row accounted for.
    // Every kind added here is ALREADY pinned by this lane's expectation files, so the
    // forward check (required => pinned) stays green; only the missing names are added.
    requiredKinds: ["uses", "references", "exports", "contains", "calls", "extends", "implements", "instantiates", "imports", "overrides", "decorates", "mixes_in", "part_of", "renders"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "rust/payload-parity" },
      qualified_calls: { key: "expectQualifiedCalls", pin: "rust/payload-parity" },
    },
    title: "rust systems wave (#261)",
  },
  go: {
    id: "go",
    wasm: "tree-sitter-go.wasm",
    classification: "go-completeness.json",
    fixturesDir: "validation/m14/fixtures/go",
    docs: ["docs/analyzers/history/go-lane-notes.md", "docs/analyzers/go.md"],
    differentialCheck: "differential-go",
    perfKey: "go-tools:go",
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check.
    // It runs the lane over the lane's OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it -- published output no contract row accounted for.
    // Every kind added here is ALREADY pinned by this lane's expectation files, so the
    // forward check (required => pinned) stays green; only the missing names are added.
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "imports", "exports", "overrides", "mixes_in", "renders"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "go/complexity-parity" },
      qualified_calls: { key: "expectQualifiedCalls", pin: "go/qualified-calls-payload" },
    },
    title: "go systems wave (#262)",
  },
  zig: {
    id: "zig",
    wasm: "tree-sitter-zig.wasm",
    classification: "zig-completeness.json",
    fixturesDir: "validation/m14/fixtures/zig",
    docs: ["docs/analyzers/zig.md"],
    differentialCheck: "differential-zig",
    perfKey: "zig:zig",
    // Zig emits these relationship kinds by design — no inheritance /
    // interfaces / overrides (zig-completeness.json ZIG.D.1), and no `exports`
    // GRAPH edge (pub/export facts live in the exports array + visibility
    // metadata; an `exports -> <symbol>` edge has no resolvable foreign
    // boundary target and would be a phantom, exactly the class the family
    // contract forbids). imports is pinned via the references edge whose
    // meta.isImport is true. (M60/#910 moved c to the first-class `imports`
    // kind; the isImport marker still pins zig, whose lane has not come up
    // yet, and remains the c family's evidence that an unresolved edge IS a
    // dependency. When zig's lane is ruled, its emission moves with it.)
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check.
    // It runs the lane over the lane's OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it -- published output no contract row accounted for.
    // Every kind added here is ALREADY pinned by this lane's expectation files, so the
    // forward check (required => pinned) stays green; only the missing names are added.
    requiredKinds: ["calls", "uses", "contains", "references", "imports", "exports", "instantiates", "mixes_in"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "zig/calls-uses-complexity (symbol complexity)" },
      parameters: { key: "expectParameters", pin: "zig/calls-uses-complexity (parameters payload)" },
      visibility: { key: "expectVisibility", pin: "zig/calls-uses-complexity (pub visibility)" },
    },
    title: "zig systems wave (#262)",
  },
  csharp: {
    id: "csharp",
    wasm: "tree-sitter-c_sharp.wasm",
    classification: "csharp-completeness.json",
    fixturesDir: "validation/m14/fixtures/csharp",
    docs: ["docs/analyzers/csharp.md"],
    differentialCheck: "differential-csharp",
    perfKey: "powershell:csharp",
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check.
    // It runs the lane over the lane's OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it -- published output no contract row accounted for.
    // Every kind added here is ALREADY pinned by this lane's expectation files, so the
    // forward check (required => pinned) stays green; only the missing names are added.
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides", "imports", "exports", "renders"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "csharp/payload-and-complexity" },
      parameters: { key: "expectParameters", pin: "csharp/payload-and-complexity" },
      visibility: { key: "expectVisibility", pin: "csharp/payload-and-complexity" },
    },
    title: "csharp managed-OO wave (#264)",
  },
  dart: {
    id: "dart",
    wasm: "tree-sitter-dart.wasm",
    classification: "dart-completeness.json",
    fixturesDir: "validation/m14/fixtures/dart",
    docs: ["docs/analyzers/dart.md"],
    differentialCheck: "differential-dart",
    perfKey: "proxicall:dart",
    // `references` and `exports` are ADDED 2026-10-12, and the omission was a contract-row defect
    // rather than a policy. Dart publishes references 73,561 edges (44,181 ambiguous by declaration,
    // 0 unresolved) and exports 2,030; the lane's own `coverage.implemented` already names BOTH; and
    // its fixtures already pin both (14 `references` pins in type-references.expectation.json alone,
    // measured). So section B's reverse check — "EMITTED but absent from requiredKinds" — was
    // convicting a row that disagreed with the lane's coverage block AND with its own fixtures, and
    // the 44,181 ambiguous `references` rows were outside every lever table this programme kept,
    // including the receiver-cause pricing that sized the dart residual.
    // swift's row (below) names `references`; the two rows are now consistent.
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "contains", "overrides", "imports", "references", "exports", "mixes_in", "part_of", "renders"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "dart/payload-and-complexity" },
      parameters: { key: "expectParameters", pin: "dart/payload-and-complexity" },
      visibility: { key: "expectVisibility", pin: "dart/payload-and-complexity" },
    },
    title: "dart managed-OO wave (#264)",
  },
  // sql ENTERS THE INVENTORY: 596 named node types enumerated from the pinned wasm, 82 handled,
  // 478 silent, 17 gaps, 25 decisions -- and section A reads 0 unclassified / 0 stale. Its owner refused
  // to fabricate a section-B row for a kind the lane does not emit (the `exports` failure was the gate's
  // reader parsing a `.ts` oracle beside the fixtures, now fixed), which is the standard this file wants.
  // E IS UNMEASURABLE FOR THIS LANE AND NAMED AS SUCH: differential.ts carries 68 per-language derive
  // functions and none is SQL's, so a scoped SQL differential derives ZERO truth edges. The perfKey is
  // declared so section E fails with a PRECISE reason -- SQL-G14 -- instead of hiding the lane. DO NOT
  // read the floor as met.
  // json JOINS THE INVENTORY: 14 types (12 public named + ERROR/MISSING), 5 handled, 9 silent each with its
  // construct named, 0 gaps, 0 node-type decisions. Its owner found that the historic spec filed all 12 named
  // types as handled while two said in their own prose they were SILENT -- a bucket contradicting its own row,
  // which is the parking-space defect -- and re-bucketed rather than deleting the prose.
  // E IS BLOCKED ON A REAL DEFECT: terraform:json measures missing=6206 unexplained=0, and a lane carrying its
  // own `missing` is never pinned -- a floor row records a RESIDUAL, never a defect. The samples are `contains`
  // edges over Terraform embedded in YAML testdata. That is the lane's next question, not a corpus gap.
  json: {
    id: "json",
    wasm: "tree-sitter-json.wasm",
    classification: "json-completeness.json",
    fixturesDir: "validation/m14/fixtures/json",
    docs: ["docs/analyzers/history/json-lane-notes.md", "docs/analyzers/json.md"],
    perfKey: "terraform:json",
    requiredKinds: ["calls", "contains", "exports", "extends", "implements", "imports", "overrides", "references", "uses"],
    payloads: {},
    title: "JSON / JSONC / JSON-Schema wave (M14 #419, BD-ontology)",
  },
  sql: {
    id: "sql",
    wasm: "tree-sitter-sql.wasm",
    classification: "sql-completeness.json",
    fixturesDir: "validation/m14/fixtures/sql",
    docs: ["docs/analyzers/history/sql-lane-notes.md", "docs/analyzers/sql.md"],
    perfKey: "duckdb:sql",
    requiredKinds: ["contains", "uses", "references", "calls", "imports", "overrides", "instantiates"],
    payloads: {},
    title: "sql schema wave (#419 sections A, C, D, G, H; B blocked on the gate's reverse check; E/F await an oracle)",
  },
  // clojure ENTERS THE INVENTORY AT 8/8: 73 node-type slots = 35 named + 38 anonymous; the gate adds the
  // implicit ERROR/MISSING pair -> 37 to classify, and the split is 16 handled / 21 silent / 0 gaps /
  // 31 decisions with 0 unclassified and 0 stale. Its E/F need NO sweep -- clj-kondo:clojure is already
  // pinned (missing 0, unexplained 0, 4.4 ms/file), which makes this the first lane where a config
  // application alone buys conformance.
  // lua JOINS THE INVENTORY: 137 wasm slots = 54 named = 46 unique named + 80 ANONYMOUS keyword/punctuation
  // tokens; the gate adds ERROR/MISSING -> 48 section-A types. THE 80 ANONYMOUS ARE NOT ROWS -- classifying
  // them would manufacture the false-drift reports haskell just cleaned up. Final split: 16 handled /
  // 32 silent / 0 unclassified / 0 stale.
  // THE 46KB SPEC WAS NEVER A CLASSIFICATION: handled_verified and internal_silent were EMPTY and the
  // gap/decision records' `node_type` fields held PROSE ("(incoming resolution -- sample reach)",
  // "function_call (callee shape)") which the gate comma-splits into nothing, so 46 of 48 types sat in no
  // bucket. Re-cut from the wasm with all 16 finding records preserved.
  // E/F await a sweep-owned row; the perfKey is declared so they fail with a precise reason.
  lua: {
    id: "lua",
    wasm: "tree-sitter-lua.wasm",
    classification: "lua-completeness.json",
    fixturesDir: "validation/m14/fixtures/lua",
    docs: ["docs/analyzers/lua.md"],
    perfKey: "lua",
    requiredKinds: ["calls", "uses", "contains", "imports", "references", "exports", "extends", "overrides", "instantiates"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "lua/loop-bindings (fileEquals 6 = 1 + four loop decision points + one or)" },
    },
    title: "lua wave (#419 sections A-D, G, H; E/F await a pinned corpus row)",
  },
  clojure: {
    id: "clojure",
    wasm: "tree-sitter-clojure.wasm",
    classification: "clojure-completeness.json",
    fixturesDir: "validation/m14/fixtures/clojure",
    docs: ["docs/analyzers/clojure.md"],
    differentialCheck: "differential-clojure",
    perfKey: "clj-kondo:clojure",
    requiredKinds: ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates", "renders"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "clojure/payload-and-complexity" },
      parameters: { key: "expectParameters", pin: "clojure/payload-and-complexity" },
    },
    title: "clojure wave (#419 sections A-H)",
  },
  // erlang ENTERS AT 8/8: 134 types (132 distinct named grammar types + the universal ERROR/MISSING pair;
  // the wasm registers 137 entries and four names repeat) -> 104 handled / 30 silent / 0 gap / 41 decisions.
  // TWO failures its owner found and fixed were the "record was right, consumer disagrees" shape:
  // (1) the spec deliberately excluded ERROR/MISSING with a grammar-true, gate-WRONG reason -- the gate adds
  //     the F1 universal pair, so they were reported in NO bucket;
  // (2) the analyzer stamped NO evidenceClass at all, so no tier could be pinned. Both corrected, fixtures 29/0.
  // E/F need no sweep: rebar3:erlang is already pinned (missing 0, unexplained 0, 8 ms/file).
  erlang: {
    id: "erlang",
    wasm: "tree-sitter-erlang.wasm",
    classification: "erlang-completeness.json",
    fixturesDir: "validation/m14/fixtures/erlang",
    docs: ["docs/analyzers/erlang.md"],
    differentialCheck: "differential-erlang",
    perfKey: "rebar3:erlang",
    requiredKinds: ["calls", "contains", "exports", "implements", "imports", "instantiates", "references", "uses", "part_of"],
    payloads: { complexity: { key: "expectComplexity", pin: "erlang (function-clause/branch count per declaration; 4 fixtures pin it)" } },
    title: "erlang pass (#419)",
  },
  // fsharp ENTERS AT 8/8 sections apart from the head comment, which this round's ceremony check newly
  // enforces (the lane is one of the 40 that never had one -- it is on the owner's list). Its inventory found
  // three real spec defects: `handled_verified.types` was a list of OBJECTS where the gate reads string[], so
  // all 48 handled rows were invisible; 115 of 198 types sat in no bucket; and four stale rows named types this
  // wasm never produces. Classified from a 120-file shape census rather than prose. Its E/F already pass --
  // perfKey "fsharp:csharp" is the PINNED row (fsharp:fsharp names a row no artifact answers).
  fsharp: {
    id: "fsharp",
    wasm: "tree-sitter-fsharp.wasm",
    classification: "fsharp-completeness.json",
    fixturesDir: "validation/m14/fixtures/fsharp",
    docs: ["docs/analyzers/fsharp.md"],
    differentialCheck: "differential-fsharp",
    perfKey: "fsharp:csharp",
    requiredKinds: ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates", "part_of"],
    payloads: {},
    title: "fsharp wave (#419; E/F green on fsharp:csharp)",
  },
  // graphql ENTERS AT 6/8 (E/F await a corpus row): 76 section-A types = 74 grammar-named + ERROR/MISSING,
  // 0 unclassified and 0 stale after a REBUILD. The spec was a prose/working-list record the gate could not
  // read -- `internal_silent` stored no `types` array and the gap records' `node_type` fields held sentences --
  // so 21 of 76 types sat in no bucket. The five `*TypeExtension` kinds are folded through the analyzer's
  // EXTENSION_TO_DEFINITION map and InlineFragment emits a `uses` edge for its type condition, so all six moved
  // to handled_verified; the value literals, ObjectField, the Selection wrappers, comma, comment, source_file
  // and the universal pair are silent with their construct named.
  // AND ITS GQ-G5 "THIS LANE HAS NO COMMITTED FIXTURES" WAS FALSE -- five committed fixture/expectation pairs
  // exist. The stale claim is kept as the RECORD OF THE FALSIFICATION rather than deleted.
  graphql: {
    id: "graphql",
    wasm: "tree-sitter-graphql.wasm",
    classification: "graphql-completeness.json",
    fixturesDir: "validation/m14/fixtures/graphql",
    docs: ["docs/analyzers/graphql.md"],
    perfKey: "gql-graphql-platform:graphql",
    requiredKinds: ["contains", "references", "uses", "implements", "exports", "imports", "extends", "overrides"],
    payloads: {
      parameters: { key: "expectParameters", pin: "graphql/payload-and-complexity" },
      docstrings: { key: "expectDocstring", pin: "graphql/payload-and-complexity" },
    },
    title: "graphql wave (#419 sections A-D, G, H; E/F await a corpus row)",
  },
  // elixir ENTERS AT 8/8. Its oracle (`deriveElixirEdges`) exists and is WIRED, and the baseline already carries
  // elixir:elixir 0/0 at 31.4 ms -- so E/F were green before the config existed. The lane's real work was that its
  // FIXTURE SUITE WAS RED: 71 pass / 11 fail on committed expectations WHILE THE ANALYZER WAS RIGHT. All eleven
  // pinned a contract the lane had already retired (the analyzer header's 2026-10-10 owner ruling replaced the
  // per-construct evidence classes with the corpus tier set -- 30 rows), or that two committed fixtures disagreed
  // about (one forbade a nested-module export another REQUIRED; the docs broke the tie). Re-baselined with a
  // `rebaselineNote` naming the ruling and date on every file, no analyzer change, fixtures 71/11 -> 82/0.
  elixir: {
    id: "elixir",
    wasm: "tree-sitter-elixir.wasm",
    classification: "elixir-completeness.json",
    fixturesDir: "validation/m14/fixtures/elixir",
    docs: ["docs/analyzers/elixir.md"],
    differentialCheck: "differential-elixir",
    perfKey: "elixir:elixir",
    // `mixes_in` (ELX-M14, 2026-10-24): `use Mod` is a mixin application and the analyzer publishes it as
    // `mixes_in`, a 1:1 relabel of the former `uses{isMixin:true}` row. Section B runs the lane over its own
    // fixtures and requires every emitted kind to be named here; the fixture pins already carry mixes_in.
    requiredKinds: ["calls","contains","exports","implements","imports","instantiates","mixes_in","overrides","references","uses"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "elixir (branch/arm count; 5 fixtures pin it)" },
      parameters: { key: "expectParameters", pin: "elixir (parameter list + defaults; 2 fixtures pin it)" },
    },
    title: "elixir pass (#419)",
  },
  // protobuf ENTERS AT 6/8 (E/F await a corpus row): 132 slots = 50 named + 82 anonymous, 52 with the universal
  // pair -> 35 handled / 11 silent / 2 gaps / 22 decisions, 0 unclassified and 0 stale.
  // THE BLOCKER WAS THE SCHEMA, not the classification: the spec was in the PRE-GATE shape (kind names and prose
  // where loadSpec reads type strings), so it read as an EMPTY classification and every named type would have been
  // unclassified. Converted with every prose record preserved as data.
  // AND ITS HEAD COMMENT WAS STALE -- it claimed references/calls/extends/implements; the analyzer emits only
  // imports/exports/uses/overrides/contains and the spec rules the rest grammar-absence.
  protobuf: {
    id: "protobuf",
    wasm: "tree-sitter-protobuf.wasm",
    classification: "protobuf-completeness.json",
    fixturesDir: "validation/m14/fixtures/protobuf",
    docs: ["docs/analyzers/protobuf.md"],
    perfKey: "pb-googleapis:protobuf",
    requiredKinds: ["contains", "exports", "imports", "overrides", "uses"],
    payloads: {
      imports: { key: "expectImports", pin: "protobuf/payload-and-ranges" },
      symbolRanges: { key: "expectSymbolRanges", pin: "protobuf/payload-and-ranges" },
    },
    title: "protobuf wave (#419 sections A-D, G, H; E/F await a corpus row)",
  },
  // clean ENTERS AT 6/8 (E/F await a corpus row): 143 slots (141 unique named + the universal pair) ->
  // 102 handled / 32 silent / 1 gap (CL-G1 index_access, 307 corpus sites) / 6 decisions, 0 unclassified, 0 stale.
  // ITS SELF-INVENTORY SAID THE PARTITION WAS COMPLETE -- `_population_check` read 141/141 -- and it was complete
  // over the 141 UNIQUE NAMES and incomplete over the gate's 143: ERROR and MISSING were in NO bucket. That is
  // the blind spot a self-written inventory has by construction.
  // AND `instantiates` was DECLARED in coverage while NO fixture exercised the construct -- the "declared but
  // unpinned" class. A new pin (constructor-instantiation.icl) exercises it: a constructor declared in this file
  // and applied in BODY position instantiates, in PATTERN position it is a match and emits uses, and another
  // module's constructor is declined and counted.
  clean: {
    id: "clean",
    wasm: "tree-sitter-clean.wasm",
    classification: "clean-completeness.json",
    fixturesDir: "validation/m14/fixtures/clean",
    docs: ["docs/analyzers/history/clean-lane-notes.md", "docs/analyzers/clean.md"],
    differentialCheck: "differential-clean",
    perfKey: "Clyde:clean",
    // `extends` IS ABSENT AND `implements` IS PRESENT, because that is what the lane publishes: the
    // served grammar has no inheritance production (0 of 143 named types; `clean-ruled.ts`), and Clean
    // composition is class/instance, published as `implements`. The row previously listed `extends`
    // and omitted `implements`, so section B failed on the CONFIG rather than on the lane — the exact
    // two-field defect `proposals/clean-lang-config.md` §6 measured. The complexity pin also reads
    // `expectMetadata`, where the lane pins `cyclomaticComplexity` (FILE metadata, the CLJ1
    // precedent), not `expectComplexity` (a per-SYMBOL number the lane does not publish).
    requiredKinds: ["calls","uses","contains","imports","references","exports","implements","overrides","instantiates"],
    payloads: {
      exports: { key: "expectExports", pin: "clean/exports-surface" },
      imports: { key: "expectImports", pin: "clean/imports-surface" },
      parameters: { key: "expectParameters", pin: "clean/expression-shapes" },
      complexity: { key: "expectMetadata", pin: "clean/expression-shapes (cyclomaticComplexity 18)" },
    },
    title: "clean wave (#419 sections A-D, G, H; E/F await a corpus row)",
  },
  swift: {
    id: "swift",
    wasm: "tree-sitter-swift.wasm",
    classification: "swift-completeness.json",
    fixturesDir: "validation/m14/fixtures/swift",
    docs: ["docs/analyzers/swift.md"],
    differentialCheck: "differential-swift",
    perfKey: "swift-nio:swift",
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check.
    // It runs the lane over the lane's OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it -- published output no contract row accounted for.
    // Every kind added here is ALREADY pinned by this lane's expectation files, so the
    // forward check (required => pinned) stays green; only the missing names are added.
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides", "exports", "imports", "renders"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "swift/payload-and-complexity" },
      visibility: { key: "expectVisibility", pin: "swift/payload-and-complexity" },
    },
    title: "swift managed-OO wave (#266)",
  },
  ruby: {
    id: "ruby",
    wasm: "tree-sitter-ruby.wasm",
    classification: "ruby-completeness.json",
    fixturesDir: "validation/m14/fixtures/ruby",
    docs: ["docs/analyzers/ruby.md"],
    differentialCheck: "differential-ruby",
    perfKey: "rake:ruby",
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check.
    // It runs the lane over the lane's OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it -- published output no contract row accounted for.
    // Every kind added here is ALREADY pinned by this lane's expectation files, so the
    // forward check (required => pinned) stays green; only the missing names are added.
    // RUBY-D1 (ALL-OUT-OF-ALL phase 2, 2026-10-19): the contract row follows the emitted set after the
    // mixin relabel — `implements` is DROPPED (the pinned grammar has no interface/conformance
    // production; include/prepend/extend are MODULE MIXIN COMPOSITION, not conformance) and `mixes_in`
    // is ADDED (source = composing class/module, target = mixin, metadata.mixinType = include|prepend|
    // extend; pinned RED by validation/m14/fixtures/ruby/mixes-in-modules). Section B's reverse check
    // caught this row still carrying the superseded label: the analyzer emitted mixes_in while the row
    // did not name it, which is exactly the drift this check exists to fail.
    requiredKinds: ["calls", "extends", "mixes_in", "instantiates", "uses", "contains", "exports", "imports", "overrides", "references"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "ruby/payload-and-complexity" },
    },
    title: "ruby managed-OO wave",
  },
  python: {
    id: "python",
    wasm: "tree-sitter-python.wasm",
    classification: "python-completeness.json",
    fixturesDir: "validation/m14/fixtures/python",
    docs: ["docs/analyzers/python.md"],
    differentialCheck: "differential-python",
    perfKey: "cython:python",
    // PY-12. `overrides` and `exports` were MISSING from this list while the analyzer
    // emitted both (measured over 150 ansible files: calls 8,797, uses 5,813, contains
    // 1,720, imports 1,211, references 630, overrides 428, extends 188, instantiates 78,
    // exports 9). Section B checks that every REQUIRED kind is pinned by a fixture, so a
    // kind that is emitted but not required cannot fail — which is the gate-blind zone
    // this whole review is about, and it is not hypothetical: `overrides` is the relation
    // PY-6, PY-7 and PY-8 all concern, and while it sat outside the required list the
    // gate had nothing to say about any of them. `exports` was worse: emitted, unpinned
    // by ANY fixture, and unrequired, so nothing in the repository could see it at all.
    //
    // ROUND 10 found the THIRD instance of the same omission with the same instrument:
    // `implements` was emitted (333 edges over the 11,488-file population — the PY-D3/
    // PY-26 wave's whole subject) while this row did not name it, so the inventory could
    // report only "EMITTED but absent from requiredKinds". Named here for the same reason
    // as the other two: a kind outside the required list cannot fail. The lane's
    // implements fixtures (`interface-implements`, `interface-qualified-subscript-head`,
    // and the store-heritage seam) already pin both directions, so the row is satisfiable
    // rather than aspirational.
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "contains", "imports", "references", "overrides", "exports", "decorates"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "python/payload-and-complexity" },
    },
    title: "python managed-OO wave (PYD1)",
  },
  haskell: {
    id: "haskell",
    wasm: "tree-sitter-haskell.wasm",
    classification: "haskell-completeness.json",
    fixturesDir: "validation/m14/fixtures/haskell",
    docs: ["docs/analyzers/haskell.md"],
    differentialCheck: "differential-haskell",
    perfKey: "cabal:haskell",
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check.
    // It runs the lane over the lane's OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it -- published output no contract row accounted for.
    // Every kind added here is ALREADY pinned by this lane's expectation files, so the
    // forward check (required => pinned) stays green; only the missing names are added.
    requiredKinds: ["calls", "extends", "instantiates", "contains", "references", "implements", "exports", "imports", "overrides", "uses", "decorates", "part_of"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "haskell/payload-and-complexity" },
    },
    title: "haskell FP wave (HSD1-5)",
  },
  perl: {
    id: "perl",
    wasm: "tree-sitter-perl.wasm",
    classification: "perl-completeness.json",
    fixturesDir: "validation/m14/fixtures/perl",
    docs: ["docs/analyzers/perl.md"],
    differentialCheck: "differential-perl",
    // mojo IS the M12 pinned perl corpus (corpus-manifest perl.corpusTarget),
    // so the canonical sweep's perf row for this lane is mojo:perl. plack is
    // the lane's SECOND corpus (a different dialect profile) and has no perf
    // row of its own.
    perfKey: "mojo:perl",
    // Exactly the six kinds the perl analyzer emits as relationships, and all
    // six are pinned by fixtures. NOT listed, each ruled in
    // script/m14/spec/perl-completeness.json rather than left as silent
    // absence: `uses`/`references` (PERLD12 — perl's dependency surface is the
    // `imports` payload plus the Module Includes pattern, and a bareword call
    // is resolvable only within a file), `imports`/`exports` as RELATIONSHIPS
    // (ImportInfo/ExportInfo are payload rows the indexer stores, not edges),
    // and `overrides` beyond the guessed first-parent chain (PERLD13).
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check.
    // It runs the lane over the lane's OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it -- published output no contract row accounted for.
    // Every kind added here is ALREADY pinned by this lane's expectation files, so the
    // forward check (required => pinned) stays green; only the missing names are added.
    requiredKinds: ["calls", "contains", "extends", "implements", "instantiates", "overrides", "imports", "references", "uses", "exports", "mixes_in"],
    // Matrix 1b rows perl actually pins. `complexity` is a FILE-metadata row
    // (expectMetadata/cyclomaticComplexity), not expectComplexity: perl
    // complexity is a whole-file decision count, so a per-symbol value would
    // be a fabricated number rather than a measured one.
    payloads: {
      complexity: { key: "expectMetadata", pin: "perl/builtins-and-branches cyclomaticComplexity" },
      parameters: { key: "expectParameters", pin: "perl/signatures-and-attributes signature field" },
      decorators: { key: "expectDecorators", pin: "perl/signatures-and-attributes attrlist" },
      imports: { key: "expectImports", pin: "perl/imports-and-exports use/require" },
      exports: { key: "expectExports", pin: "perl/imports-and-exports Exporter surface" },
    },
    title: "perl wave (#419 sections A-D, G; E/F await the canonical sweep)",
  },
  // M60 XML wave (2026-09-27). xml had NO entry here while its analyzer emitted
  // 228,194 relationships and while two of its declaration classes had no branch
  // at all, so the authoritative per-language record the ledger names was silent
  // on the lane that had just had two UPSTREAM grammar defects and a
  // declared-name recall of 0.045.
  //
  // The ontology is settled BY MEASUREMENT (reviews/xml/master-review.md; every
  // number over 7,975 files / 5.90M nodes / 6 pinned repos):
  //
  //   contains    structural containment read off the tree. Every contains TARGET
  //               is a PUBLISHED SYMBOL in the same file — enforced structurally,
  //               not by convention, and pinned by xml/dtd-declarations.
  //   references  a NAME, never a written value. 11,117 resolvable QName
  //               references; the target is the LOCAL NAME and the prefix rides in
  //               metadata, because a prefix in a target is a value where a name
  //               belongs. 1,319 values that resolve to nothing are REFUSED.
  //   imports     a FILE PATH, the one case where a value is the right target:
  //               630 distinct schemaLocation targets, 238 DOCTYPE external IDs,
  //               78 entity/notation external IDs, 18 stylesheet hrefs — 0 of
  //               them emitted before the fix.
  //
  // NOT APPLICABLE, each on a measurement: calls / extends / implements /
  // overrides / instantiates / exports (XML declares no procedure and has no type
  // system — a complexType REFERENCES another by `base`, it is not a subclass of
  // it), and standalone `.dtd` documents (routed, but the xml grammar's `document`
  // rule requires a document element, so a standalone DTD's root is ERROR under
  // every build while upstream's separate `dtd` grammar parses them with 0).
  xml: {
    id: "xml",
    wasm: "tree-sitter-xml.wasm",
    classification: "xml-completeness.json",
    fixturesDir: "validation/m14/fixtures/xml",
    docs: ["docs/analyzers/xml.md"],
    differentialCheck: "differential-xml",
    perfKey: "grails-core:xml",
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check.
    // It runs the lane over the lane's OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it -- published output no contract row accounted for.
    // Every kind added here is ALREADY pinned by this lane's expectation files, so the
    // forward check (required => pinned) stays green; only the missing names are added.
    requiredKinds: ["contains", "references", "imports", "calls", "extends", "overrides", "uses", "mixes_in", "part_of"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "xml/type-graph" },
    },
    title: "xml data/config wave (M60, 2026-09-27)",
  },
  nim: {
    id: "nim",
    wasm: "tree-sitter-nim.wasm",
    classification: "nim-completeness.json",
    fixturesDir: "validation/m14/fixtures/nim",
    docs: ["docs/analyzers/nim.md"],
    differentialCheck: "differential-nim",
    perfKey: "nim:nim",
    // Exactly the eight kinds the nim analyzer emits, and all eight are pinned
    // by validation/m14/fixtures/nim (calls 3, contains 3, extends 1, imports 3,
    // instantiates 1, overrides 1, references 3, uses 2). `implements` is NOT
    // listed because it is structurally N/A — a Nim concept is satisfied by
    // implicit structural dispatch and the source never names a nominal
    // subtype, so there is nothing to point at. That is ruling NIMD3 in
    // script/m14/spec/nim-completeness.json, not a silent absence.
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check,
    // which runs this lane over its OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it. Every kind below is ALREADY pinned by this lane's
    // expectation files, so the forward check (required => pinned) stays green.
    requiredKinds: ["calls", "contains", "decorates", "extends", "imports", "instantiates", "part_of", "overrides", "references", "uses", "exports", "implements"],
    // Matrix 1b rows nim actually pins. `complexity` is a per-SYMBOL value
    // (expectComplexity), unlike perl's whole-file decision count.
    payloads: {
      complexity: { key: "expectComplexity", pin: "nim/contract per-symbol cyclomatic complexity" },
      imports: { key: "expectImports", pin: "nim/contract the three import path shapes" },
    },
    title: "nim wave (#419 sections A-D, G; E/F await the canonical sweep)",
  },
  php: {
    id: "php",
    wasm: "tree-sitter-php.wasm",
    classification: "php-completeness.json",
    fixturesDir: "validation/m14/fixtures/php",
    docs: ["docs/analyzers/php.md"],
    differentialCheck: "differential-php",
    perfKey: "phpunit:php",
    // M60 php F2 (2026-09-30): `imports` was MISSING here, and the row is the thing
    // that certifies the relationship contract — so the contract was published at 8
    // kinds while the analyzer published 9. `RealPhpAnalyzer` has emitted `imports`
    // since M12.PHP-IMPORTS from two sites (`emitUseClause`, `emitInclude`) and it is
    // the lane's 3rd-largest label by volume: 25,104 edges over the two pinned corpora
    // (23,820 `use` clauses + 163 include/require paths on the full git-tracked
    // universe). It is also the kind `src/lsp/graph_request.ts:256` keys its
    // file-level reader on, so the omission was not cosmetic: the row that certifies
    // the contract did not name the contract's own module-dependency edge.
    //
    // The row said the opposite in writing. `reviews/php/m60-closure.md` residual
    // disclosure #6 claimed `imports` "is deliberately not a php relationship label
    // (PHPD3)", that "`references` is reserved for include paths", and that `imports`
    // is "absent from that row, as it is for no other OO lane". All three were false:
    // the label exists and is large, include paths moved OFF `references` onto
    // `imports` in the same commit that added the differential allowlist entry, and
    // python, csharp and dart all name `imports` in their own rows. PHPD3 is a
    // pre-M12.PHP-IMPORTS ruling being read as current.
    //
    // The omission was invisible because section B was one-way — it asked whether
    // every kind in THIS row is pinned by a fixture and never whether the analyzer
    // emits a kind the row omits. That is fixed in `verifySectionB` (same round), and
    // it is what now catches this class instead of a human noticing.
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check.
    // It runs the lane over the lane's OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it -- published output no contract row accounted for.
    // Every kind added here is ALREADY pinned by this lane's expectation files, so the
    // forward check (required => pinned) stays green; only the missing names are added.
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides", "imports", "exports", "mixes_in", "part_of"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "php/payload-and-complexity" },
    },
    title: "php managed-OO wave (#268); canonical namespace/type binding verified with native and worker controls",
  },
  objc: {
    analyzerFile: "src/ast/real-objective-c-analyzer.ts",
    id: "objc",
    wasm: "tree-sitter-objc.wasm",
    classification: "objc-completeness.json",
    fixturesDir: "validation/m14/fixtures/objc",
    docs: ["docs/analyzers/objective-c.md"],
    differentialCheck: "differential-objc",
    perfKey: "sdwebimage:objc",
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "exports", "imports", "overrides", "part_of"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "objc/payload-and-complexity" },
    },
    title: "objc managed-OO wave (#267)",
  },
  java: {
    id: "java",
    wasm: "tree-sitter-java.wasm",
    classification: "java-completeness.json",
    fixturesDir: "validation/m14/fixtures/java",
    docs: ["docs/analyzers/history/java-lane-notes.md", "docs/analyzers/java.md"],
    differentialCheck: "differential-java",
    perfKey: "grails-core:java",
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides", "exports", "imports", "permits"],
    payloads: {
      qualified_calls: { key: "expectQualifiedCalls", pin: "java/qualified-call-path" },
      docstrings: { key: "expectComments", pin: "java/javadoc-payload" },
      complexity: { key: "expectComplexity", pin: "java/method-complexity-payload" },
      typeParameters: { key: "expectTypeParameters", pin: "java/generic-parameters-payload" },
      visibility: { key: "expectVisibility", pin: "java/generic-visibility-payload" },
      apiContract: { key: "expectApiContractPaths", pin: "java/fq-api-endpoint" },
      parameters: { key: "expectParameters", pin: "java/parameters-payload" },
    },
    title: "java pilot (#419)",
  },
  groovy: {
    id: "groovy",
    wasm: "tree-sitter-groovy.wasm",
    classification: "groovy-completeness.json",
    fixturesDir: "validation/m14/fixtures/groovy",
    docs: ["docs/analyzers/history/groovy-lane-notes.md", "docs/analyzers/groovy.md"],
    differentialCheck: "differential-groovy",
    perfKey: "grails-core:groovy",
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check.
    // It runs the lane over the lane's OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it -- published output no contract row accounted for.
    // Every kind added here is ALREADY pinned by this lane's expectation files, so the
    // forward check (required => pinned) stays green; only the missing names are added.
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides", "imports", "exports", "decorates"],
    payloads: {
      qualified_calls: { key: "expectQualifiedCalls", pin: "groovy/qualified-call-path" },
      docstrings: { key: "expectComments", pin: "groovy/groovydoc-payload" },
      complexity: { key: "expectComplexity", pin: "groovy/complexity-parity" },
      typeParameters: { key: "expectTypeParameters", pin: "groovy/generic-visibility-payload" },
      visibility: { key: "expectVisibility", pin: "groovy/generic-visibility-payload" },
      parameters: { key: "expectParameters", pin: "groovy/parameters-payload" },
    },
    title: "groovy pass (#419)",
  },
  kotlin: {
    id: "kotlin",
    wasm: "tree-sitter-kotlin.wasm",
    classification: "kotlin-completeness.json",
    fixturesDir: "validation/m14/fixtures/kotlin",
    docs: ["docs/analyzers/history/kotlin-lane-notes.md", "docs/analyzers/kotlin.md"],
    differentialCheck: "differential-kotlin",
    perfKey: "Exposed:kotlin",
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check.
    // It runs the lane over the lane's OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it -- published output no contract row accounted for.
    // Every kind added here is ALREADY pinned by this lane's expectation files, so the
    // forward check (required => pinned) stays green; only the missing names are added.
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides", "imports", "exports", "renders"],
    payloads: {
      qualified_calls: { key: "expectQualifiedCalls", pin: "kotlin/qualified-calls-builtin-names" },
      docstrings: { key: "expectComments", pin: "kotlin/kdoc-extraction" },
      complexity: { key: "expectComplexity", pin: "kotlin/complexity-parity" },
      typeParameters: { key: "expectTypeParameters", pin: "kotlin/generic-parameters" },
      visibility: { key: "expectVisibility", pin: "kotlin/visibility-payload" },
      apiContract: { key: "expectApiContractPaths", pin: "kotlin/api-contract-routes" },
      parameters: { key: "expectParameters", pin: "kotlin/parameters-payload" },
    },
    title: "kotlin pass (#419)",
  },
  scala: {
    id: "scala",
    wasm: "tree-sitter-scala.wasm",
    classification: "scala-completeness.json",
    fixturesDir: "validation/m14/fixtures/scala",
    docs: ["docs/analyzers/history/scala-lane-notes.md", "docs/analyzers/scala.md"],
    differentialCheck: "differential-scala",
    perfKey: "scala3:scala",
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check.
    // It runs the lane over the lane's OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it -- published output no contract row accounted for.
    // Every kind added here is ALREADY pinned by this lane's expectation files, so the
    // forward check (required => pinned) stays green; only the missing names are added.
    // SCALA fleet-phase ruling (§21.4): with-clause traits publish mixes_in. THE `implements` CLAUSE IS
    // GONE, AND IT IS GONE BECAUSE IT WAS MEASURED, NOT BECAUSE IT WAS SUPERSEDED BY POLICY: the
    // ruling said "implements is RULED NOT-APPLICABLE", and the fleet MIXIN RULING (2026-10-19, option
    // (b)) that carried it named the falsifier — "a Scala construct that declares conformance WITH NO
    // COMPOSITION semantics" — AND NAMED THE SELF-TYPE `this: T =>` IN THE SAME SENTENCE, with the
    // parenthetical "none measured". THAT PARENTHETICAL WAS THE DEFECT: the ruling had already
    // identified the construct and never measured it.
    //
    // MEASURED over the ADMITTED population (19,347 files, 4 repos, 0 parse failures): 1,017 `self_type`
    // sites in 636 files, of which 669 in 398 files carry a REQUIRED TYPE after the `:` (the other 348
    // bind a self NAME and require nothing). `self_type` IS a named node type of the pinned build
    // (registry sha256 = file sha256 = 393cc91ba940440f598a2102cddd6fee92217096cedaef7f793392598f0c9917,
    // 189 named of 455 node types) — so this is rung R3, NO grammar change is taken, and `implements`
    // WAS A GAP, NOT A RULING.
    requiredKinds: ["calls", "extends", "mixes_in", "implements", "instantiates", "uses", "references", "contains", "overrides", "imports", "exports"],
    payloads: {
      qualified_calls: { key: "expectQualifiedCalls", pin: "scala/qualified-calls-payload" },
      docstrings: { key: "expectComments", pin: "scala/scaladoc-payload" },
      complexity: { key: "expectComplexity", pin: "scala/complexity-parity" },
      typeParameters: { key: "expectTypeParameters", pin: "scala/generic-parameters-payload" },
      visibility: { key: "expectVisibility", pin: "scala/visibility pin (wave)" },
      parameters: { key: "expectParameters", pin: "scala/parameters pin (wave)" },
    },
    title: "scala pass (#419)",
  },
  typescript: {
    id: "typescript",
    wasm: "tree-sitter-typescript.wasm",
    classification: "typescript-completeness.json",
    fixturesDir: "validation/m14/fixtures/typescript",
    docs: ["docs/analyzers/history/typescript-lane-notes.md", "docs/analyzers/typescript.md"],
    differentialCheck: "differential-typescript",
    perfKey: "vue-core:typescript",
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides", "exports", "imports", "renders", "decorates", "mixes_in", "part_of"],
    payloads: {
      qualified_calls: { key: "expectQualifiedCalls", pin: "typescript/qualified-call-path" },
      docstrings: { key: "expectComments", pin: "typescript/payload-docs (js) / comment pins" },
      complexity: { key: "expectComplexity", pin: "typescript/complexity-parity" },
      typeParameters: { key: "expectTypeParameters", pin: "typescript/generic-constraints" },
      visibility: { key: "expectVisibility", pin: "typescript/visibility pin (wave)" },
      apiContract: { key: "expectApiContractPaths", pin: "typescript/api-contract-bare-path" },
      parameters: { key: "expectParameters", pin: "typescript/parameters pin (wave)" },
    },
    title: "typescript pass (#419)",
  },
  javascript: {
    id: "javascript",
    wasm: "tree-sitter-javascript.wasm",
    classification: "javascript-completeness.json",
    fixturesDir: "validation/m14/fixtures/javascript",
    docs: ["docs/analyzers/history/javascript-lane-notes.md", "docs/analyzers/javascript.md"],
    differentialCheck: "differential-javascript",
    perfKey: "lodash:javascript",
    // CANONICAL VOCABULARY 2026-10-18: the analyzer publishes `renders` (JSX component elements)
    // and `decorates` (decorator application) — both are pinned by expectation files
    // (javascript/jsx-usage, decorator-declaration-lines-861, decorator-arguments-not-decorates), so
    // section B's forward check stays green and its reverse check now names the labels instead of
    // failing on the analyzer publishing more than the contract row admitted.
    // ★ `mixes_in` IS NAMED HERE, AND IT IS NAMED BECAUSE THE LANE MEASURED A CONSTRUCT — NOT BECAUSE
    // A RULING WAS RELAXED. The javascript `mixes_in` was ruled `grammar-absence` on the ground that
    // "no rule can tell `Route.extend(M)` from `_.extend(obj, props)` without a naming convention,
    // which C2 forbids". That was HALF the truth, and the half that decided it was wrong: the
    // discriminator is not the callee's NAME but that THE CALL IS THE HERITAGE. A call in heritage
    // position is class-producing BY CONSTRUCTION — the language requires the heritage to evaluate to
    // a constructor — and a call in argument position is not. POSITION, NOT A NAME ⇒ C2 IS NOT
    // VIOLATED. MEASURED over the whole admitted population (12,374 files): 76 call-shaped heritage
    // clauses (74 member-form, 2 identifier-form), 0 found before the remedy, 76 `extends` + 83
    // `mixes_in` published after it, 11 computed-only near misses refused.
    requiredKinds: ["calls", "extends", "mixes_in", "instantiates", "uses", "references", "contains", "overrides", "exports", "imports", "renders", "decorates"],
    payloads: {
      qualified_calls: { key: "expectQualifiedCalls", pin: "javascript/payload-pins" },
      docstrings: { key: "expectComments", pin: "javascript/payload-docs" },
      complexity: { key: "expectComplexity", pin: "javascript/complexity-parity" },
      visibility: { key: "expectVisibility", pin: "javascript/private-methods" },
      parameters: { key: "expectParameters", pin: "javascript/parameters pin (wave)" },
    },
    title: "javascript pass (#419)",
  },
  vue: {
    id: "vue",
    wasm: "tree-sitter-vue.wasm",
    classification: "vue-completeness.json",
    fixturesDir: "validation/m14/fixtures/vue",
    docs: ["docs/analyzers/history/vue-lane-notes.md", "docs/analyzers/vue.md"],
    differentialCheck: "differential-vue",
    perfKey: "vue-core:vue",
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check.
    // It runs the lane over the lane's OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it -- published output no contract row accounted for.
    // Every kind added here is ALREADY pinned by this lane's expectation files, so the
    // forward check (required => pinned) stays green; only the missing names are added.
    // RELABEL 2026-10-24 (Lead-ruled, svelte precedent): the SFC template component-tag emission is
    // `renders`, not `instantiates` (the host renderer mounts the component; no `new` exists in the
    // source). `instantiates` is therefore not emitted by this lane and the row must not name it.
    requiredKinds: ["calls", "extends", "uses", "references", "contains", "overrides", "exports", "imports", "implements", "decorates", "renders"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "vue/template-decision-complexity" },
      parameters: { key: "expectParameters", pin: "vue/script-sub-analyzer parameters" },
      visibility: { key: "expectVisibility", pin: "vue/component visibility" },
    },
    title: "vue pass (#419)",
  },
  // M14 (#288): html enters the inventory as INVENTORY-DONE, deliberately NOT
  // in GATED_LANGS yet. The status ladder is NOT-STARTED / INVENTORY-DONE /
  // GAPS-CLOSED / CONFORMANT, and a language joins GATED_LANGS when it reaches
  // CONFORMANT — which means all eight sections are green. html's section A is
  // complete (19/19 named node types classified in script/m14/spec/
  // html-completeness.json, with one OPEN GAP), B and D are carried by the eight
  // fixtures, and E/F/G/H are not yet satisfiable: the differential floors are
  // measured but unpinned, `docs/analyzers/history/html-lane-notes.md` does not exist, and CC1 has no
  // html block. Adding html to GATED_LANGS now would turn `npm run verify` red
  // for three gates that have not been built yet, which is a different statement
  // from "html is not ready" — the ladder exists precisely so the difference is
  // visible. Run it directly with `--lang html` in the meantime.
  //
  // `requiredKinds` is `uses` + `contains` and nothing else, because that is what
  // html HAS: the schema's other types describe OO heritage, and html has no
  // heritage clause. `parameters` is deliberately absent from `payloads` — an
  // element is not a callable and there is no honest value to pin, so claiming the
  // Matrix 1b row would be a fabrication dressed as coverage.
  html: {
    id: "html",
    wasm: "tree-sitter-html.wasm",
    classification: "html-completeness.json",
    fixturesDir: "validation/m14/fixtures/html",
    docs: ["docs/analyzers/history/html-lane-notes.md", "docs/analyzers/html.md"],
    differentialCheck: "differential-html",
    perfKey: "otp:html",
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check,
    // which runs this lane over its OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it. Every kind below is ALREADY pinned by this lane's
    // expectation files, so the forward check (required => pinned) stays green.
    // `exports` ARRIVES THROUGH THE EMBEDDED-SCRIPT DELEGATION, not from HTML itself. Section B runs the
    // lane over its own fixture sources and sees the kind, because an embedded <script> is parsed by the
    // JS analyzer and its edges are the html lane's output for that document. A PURE-HTML export is still
    // forbidden and three fixtures enforce that with forbidRelationships -- the two statements are not in
    // conflict, they describe different LAYERS of one file. Naming it here is the contract catching up with
    // what the analyzer publishes, which is exactly what the reverse check exists to force.
    requiredKinds: ["uses", "contains", "calls", "extends", "imports", "instantiates", "overrides", "references", "exports", "decorates", "implements", "mixes_in", "renders"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "html/framework-and-scores (addressable-subtree size per symbol)" },
      visibility: { key: "expectVisibility", pin: "html/framework-and-scores (document scope — html has no private/package)" },
    },
    title: "html pass (#419, #288)",
  },
  // M14 F3: css enters the inventory as INVENTORY-DONE, deliberately NOT in
  // GATED_LANGS yet, on the same reasoning as html above — but for a different set
  // of sections, and the difference is the point.
  //
  // What is DONE for css, all measured:
  //   A  129 unique node types across 151 wasm ids classified, 0 gap, every entry
  //      carrying its reason (script/m14/spec/css-completeness.json), with nine
  //      rulings CSS-D1..D9 covering the four that looked like dead grammar.
  //   E  the differential reads 100% truth coverage, MISSING=0 and unexplained=0
  //      on BOTH corpora (svelte:css 67/67, grails-core:css 480/480) — the first
  //      lane to reach 0/0 in both directions.
  //   F  the F8 corpus census passes with 0 blind spots over 46 corpus types.
  //   G  the grammar lane is pinned with a source↔wasm proof (all 64 declared
  //      names present, 64 wasm-named types declared, 0 built-in extras).
  //   H  the M59 line oracle runs in the SHARED instrument as a first-class lane
  //      (84/84 consistent, 0 INCONSISTENT, 0 notCheckable) and independently in
  //      the lane's own (7,647 edges, 0 inconsistent, 96 honest synthesized
  //      names).
  //
  // What is NOT done, and why GATED_LANGS stays closed:
  //   B/D  there is no `validation/m14/fixtures/css` directory. The fixture and
  //        mutant harnesses are being edited concurrently, so the fixtures cannot
  //        be registered without colliding, and a fixture that is written but not
  //        registered protects nothing.
  //   CC1  NOT a css gap, and worth saying why rather than listing it as one.
  //        CC1 checks languages that must AGREE with each other — ts/js structural
  //        parity, the systems families, the OO families, vue/svelte builtin-tag
  //        parity. css has no partner in any of those sets, so there is no
  //        cross-language claim for it to make. The RISK CC1 exists to catch is a
  //        set drifting between two places that must match, and css's version of
  //        that is the analyzer and the F10 oracle disagreeing about what a
  //        construct is — which is measured directly (100% coverage, MISSING=0,
  //        unexplained=0 on both corpora) and is a stronger guard than a
  //        cross-language tag-set diff would have been for this lane.
  //
  // `requiredKinds` is the four kinds css ACTUALLY emits — contains, uses,
  // references, imports — and not the schema's full list: the others describe OO
  // heritage and call surfaces, and css has neither. Claiming `calls` for a
  // language with no call expression would be a fabrication dressed as coverage.
  //
  // `payloads` carries ONLY complexity, which is the one Matrix 1b row css can
  // honestly fill: a selector chain, a functional pseudo-class and a nesting level
  // are all real review cost. `parameters` is absent because a css rule is not a
  // callable, and `visibility` is absent because css has no private/package axis
  // at all — an element selector is not an access level.
  css: {
    id: "css",
    wasm: "tree-sitter-css.wasm",
    classification: "css-completeness.json",
    fixturesDir: "validation/m14/fixtures/css",
    docs: ["docs/analyzers/css.md"],
    differentialCheck: "differential-css",
    perfKey: "svelte:css",
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check,
    // which runs this lane over its OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it. Every kind below is ALREADY pinned by this lane's
    // expectation files, so the forward check (required => pinned) stays green.
    requiredKinds: ["uses", "references", "contains", "imports", "overrides", "calls", "exports", "part_of"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "css (selector combinators, functional pseudos, attributes, nesting depth)" },
    },
    title: "css pass (#419)",
  },
  svelte: {
    id: "svelte",
    wasm: "tree-sitter-svelte.wasm",
    classification: "svelte-completeness.json",
    fixturesDir: "validation/m14/fixtures/svelte",
    docs: ["docs/analyzers/history/svelte-lane-notes.md", "docs/analyzers/svelte.md"],
    differentialCheck: "differential-svelte",
    perfKey: "svelte:svelte",
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check.
    // It runs the lane over the lane's OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it -- published output no contract row accounted for.
    // Every kind added here is ALREADY pinned by this lane's expectation files, so the
    // forward check (required => pinned) stays green; only the missing names are added.
    requiredKinds: ["calls", "extends", "instantiates", "uses", "references", "contains", "overrides", "exports", "imports", "implements", "decorates", "renders"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "svelte/payload-pins (script complexity)" },
      parameters: { key: "expectParameters", pin: "svelte/script-sub-analyzer parameters" },
      visibility: { key: "expectVisibility", pin: "svelte/component visibility" },
    },
    title: "svelte pass (#419)",
  },
  // M60 Make wave (2026-09-27). The analyzer was advertised by the website
  // through SUPPORTED_LANGUAGES and wired into engine.ts while being named by
  // NO gate — the "looks absent rather than broken" shape. 44/44 grammar types
  // classified in disjoint buckets, 5 fixtures, 17 mutants, and a corpus
  // differential at 100 % / 0 missing / 0 unexplained on both corpora.
  make: {
    analyzerFile: "src/ast/real-makefile-analyzer.ts",
    id: "make",
    wasm: "tree-sitter-make.wasm",
    classification: "make-completeness.json",
      fixturesDir: "validation/m14/fixtures/make",
      // The DOC is named for the LANGUAGE (`real-make-analyzer.md`), not for the
      // analyzer module (`real-makefile-analyzer.ts`). Those are different things
      // and only the analyzer file is aliased: `verify-m12-final-audit.ts` resolves
      // `real-${lang}-analyzer.md` for `lang=make`, so this is the file the
      // milestone audit actually reads. The lane had briefly written a SECOND doc
      // named after the module, and `script/m60/grammar-lanes-source.ts` derives
      // lane names from doc filenames, so that second file fabricated a lane called
      // `makefile` beside the real `make` — and the two documents then drifted, with
      // the stale one carrying pre-rebuild numbers that no gate read.
      docs: ["docs/analyzers/make.md"],
    differentialCheck: "differential-make",
    // The perf/floor key is the corpus the differential ACTUALLY sweeps for this lane:
    // `LANG_REPOS.make === "redis"` (script/m14/differential.ts) and `redis:make` is the row the
    // baseline carries (missing 0 / unexplained 0, avgMsPerFile measured). The previous alias
    // `tf-aws-components:make` names a checkout that is NOT on this host, so sections E/F read
    // "no floor row" for a lane whose real corpus and real measurement both exist.
    perfKey: "redis:make",
    requiredKinds: ["contains", "references", "uses", "imports", "exports", "calls", "overrides", "part_of"],
    payloads: {},
    title: "make build wave (M60, 2026-09-27)",
  },
  // RESTORED, not added. `hcl` was in GATED_LANGS from 2026-09-26 but its
  // LANG_CONFIGS entry was NEVER COMMITTED — it lived only in a dirty worktree,
  // and a concurrent `git checkout` of this file deleted it. The symptom was
  // silent and total: `--lang hcl` began throwing `unknown language hcl` at
  // line 788, so the lane the whole HCL wave had just closed could not be
  // checked at all. This is recorded as a restoration because the alternative
  // reading — "the entry never existed" — is not what the evidence says:
  // `git log -S hcl-completeness -- script/m14/completeness-inventory.ts`
  // returns nothing while the lane's spec, fixtures and 8/8 result all shipped.
  // The values are reconstructed from that lane's own committed artifacts
  // (script/m14/spec/hcl-completeness.json, validation/m14/fixtures/hcl/,
  // docs/analyzers/hcl.md, and the `terraform:hcl` /
  // `tf-aws-components:hcl` rows this file's section E reads), and the hcl lane
  // should confirm them.
  julia: {
    id: "julia",
    wasm: "tree-sitter-julia.wasm",
    classification: "julia-completeness.json",
    fixturesDir: "validation/m14/fixtures/julia",
    docs: ["docs/analyzers/julia.md"],
    differentialCheck: "differential-julia",
    perfKey: "julia:julia",
    // The six kinds the analyzer actually emits, measured: calls 85,174 · references 34,898 ·
    // uses 25,766 · contains 10,215 · instantiates 2,720 · extends 1,785 — which sum to 160,558,
    // the exact reported total, so there is no seventh kind in existence. `overrides` and
    // `implements` are RULED (JUL-D1/D2) rather than required, for the same reason HCL omits
    // `calls`: requiring a kind the language deliberately never emits would demand a fixture
    // assert an edge the lane is right to decline. That the fixtures FORBID those two is the
    // stronger statement — it fails a gate if a change starts emitting them.
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check,
    // which runs this lane over its OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it. Every kind below is ALREADY pinned by this lane's
    // expectation files, so the forward check (required => pinned) stays green.
    requiredKinds: ["contains", "extends", "calls", "uses", "references", "instantiates", "exports", "imports", "overrides", "decorates", "part_of"],
    // Documented-residual floor, the C-D4 mechanism. The residual is ADJUDICATED, not untriaged: the
    // `unexplained` rows are dominated by the oracles' own declared scope limits — they deliberately
    // decline to resolve a callee across files, because a `calls` edge whose target is a name in
    // another module cannot be verified from one tree and guessing would make a wrong truth row, which
    // is worse than an absent one. The remaining `missing` rows are `@eval module` bodies, quoted-block
    // declarations and type annotations reached through a namespace path.
    //
    // So the counts are PINNED rather than required to be zero, and the ruling that explains them is
    // named here so a future fix that lowers the residual has to update the config and the baseline
    // together — which is the point of the mechanism. `covered` is 98-99.3% across probes.
    floorResidual: { ruling: "JUL-D1..D6 (script/m14/spec/julia-completeness.json)", missing: 83, unexplained: 434 },
    payloads: {},
    title: "julia wave (M60, 2026-10-01; dynamic multiple-dispatch, no managed-OO vocabulary)",
  },
  hcl: {
    id: "hcl",
    wasm: "tree-sitter-hcl.wasm",
    classification: "hcl-completeness.json",
    fixturesDir: "validation/m14/fixtures/hcl",
    docs: ["docs/analyzers/hcl.md"],
    differentialCheck: "differential-hcl",
    // THE ROW EXISTS UNDER THE REPO THAT MEASURED IT. The oracle run produced `tf-aws-components:hcl`
    // `{missing: 0, unexplained: 0, perf.avgMsPerFile: 5}` -- and `terraform:hcl` names a row no artifact
    // answers, so section E read "no baseline floor row" while the measurement was on disk the whole time.
    perfKey: "tf-aws-components:hcl",
    // NO `calls`: hcl RULES that kind not applicable on measurement (0 of its 64
    // node types declare a function, and 0 of 12,977 corpus function_call nodes
    // resolve to a declared symbol), so requiring it pinned would demand a
    // fixture assert an edge the lane deliberately never emits. The restored
    // entry listed it and section B failed on exactly that — recorded here
    // because the failure is the reason the value is right.
    // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check.
    // It runs the lane over the lane's OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it -- published output no contract row accounted for.
    // Every kind added here is ALREADY pinned by this lane's expectation files, so the
    // forward check (required => pinned) stays green; only the missing names are added.
    requiredKinds: ["contains", "references", "uses", "imports", "exports", "calls", "extends", "overrides", "instantiates", "part_of"],
    payloads: {},
    title: "hcl/terraform data-config wave (M60, 2026-09-26; config entry restored 2026-09-27)",
  },
  markdown: {
  id: "markdown",
  // TWO grammars. `wasm` names the block grammar because that is the one the
  // analyzer is LOADED with; the companion is pinned in the same record under
  // `companions`, and section A's classification is the union of both.
  wasm: "tree-sitter-markdown.wasm",
  companionWasm: ["tree-sitter-markdown_inline.wasm"],
  classification: "markdown-completeness.json",
  fixturesDir: "validation/m14/fixtures/markdown",
  docs: ["docs/analyzers/history/markdown-lane-notes.md", "docs/analyzers/markdown.md"],
  differentialCheck: "differential-markdown",
  perfKey: "scala3:markdown",
  // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check,
    // which runs this lane over its OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it. Every kind below is ALREADY pinned by this lane's
    // expectation files, so the forward check (required => pinned) stays green.
    requiredKinds: ["contains", "uses", "imports", "references", "part_of"],
  payloads: {
    // Only channels the fixture runner actually implements. The first draft of
    // this entry named `expectSymbolRange` and `expectSymbolOwner`, neither of
    // which exists — section C checks that SOME expectation file carries a
    // non-empty array at the named key, so an invented key reads as "not yet
    // pinned" forever instead of "wrong key", and a reader has no way to tell
    // those apart from the gate. Both are pinned through `expectSymbols`, whose
    // entries are matched field-by-field by `matchConstraints`, so `startLine`
    // and `ownerName` on an entry ARE the assertions.
    range: { key: "expectSymbolRanges", pin: "markdown/payload-lines-evidence (expectSymbolRanges: 1-based startLine/endLine, and the store's (file, name, line_start) key is what makes two sites of one construct distinct rows)" },
    visibility: { key: "expectVisibility", pin: "markdown/payload-lines-evidence (a document has no private or package scope, so the field is constant rather than absent — pinned so its ABSENCE would fail)" },
    ownerName: { key: "expectSymbols", pin: "markdown/code-block-site-identity + heading-identity (ownerName on the entry; the case that broke it was a repeated heading's children attaching to the wrong occurrence)" },
  },
  title: "markdown pass (#290) — two-grammar lane; the companion is pinned under `companions` in validation/m14/grammar-pins.json",
},
  powershell: {
  id: "powershell",
  wasm: "tree-sitter-powershell.wasm",
  classification: "powershell-completeness.json",
  fixturesDir: "validation/m14/fixtures/powershell",
  docs: ["docs/analyzers/powershell.md"],
  differentialCheck: "differential-powershell",
  perfKey: "powershell:powershell",
  // The ten the universal ontology declares. All ten are implemented and gated;
  // `imports` is deliberately modelled as an import-annotated `references` edge
  // (PSD/`addImport`), so it is not listed as required here — the exclusion is
  // written down rather than left as a silence, and the annotation is pinned by
  // module-surface-psb9's `expectImports` rows.
  // THE ROW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check,
    // which runs this lane over its OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it. Every kind below is ALREADY pinned by this lane's
    // expectation files, so the forward check (required => pinned) stays green.
    // `part_of` JOINED THE LIST WITH THE DOT-SOURCE RELABEL (PSD12, 38 edges over 37
    // files): the row had not been updated since, so section B reported the lane as
    // publishing a kind its contract omitted — a drift the gate caught and this line
    // closes. The pin is part-of-dot-source-psb19 (4 `part_of` rows + the forbids).
    requiredKinds: ["calls", "uses", "contains", "references", "instantiates", "exports", "extends", "implements", "overrides", "imports", "part_of"],
  payloads: {
    complexity: { key: "expectComplexity", pin: "powershell/reserved-words-psb4" },
  },
  title: "powershell wave (M14 #277, PS-G1..PS-G8, PSD1..PSD6)",
},
  // M60 Solidity lane. `requiredKinds` are the nine the ontology declares and this
  // lane EMITS as edges; `imports` is deliberately modelled as an import-annotated
  // `references` edge (`metadata.import: true`), the settled convention for this repo
  // and the same reason PowerShell's list omits it — so it is checked through that
  // annotation and through `expectImports` rather than as its own kind.
  //
  // `floorResidual` is the HONEST F5 floor rather than a clean 0/0, and it is the
  // reason the section carries one at all. Measured on the 60-file draw: 99.9%
  // coverage, 2 MISSING, 18 unexplained. Both residues are itemised into classes
  // with reasons in validation/m60/results/solidity-unexplained-adjudication.json —
  // the 8 MISSING rows are all one class (a `type(IFoo).interfaceId` mention of an
  // interface declared in ANOTHER file, which a per-file analyzer cannot see), and
  // the unexplained rows are `uses` naming a member of a built-in type, which
  // Solidity offers no syntax to separate from a project member. Both are SCOPE
  // limits with a named class each, not fabrications rounded away — and a 0/0 floor
  // here would have been a claim, not a measurement.
  solidity: {
  id: "solidity",
  wasm: "tree-sitter-solidity.wasm",
  classification: "solidity-completeness.json",
  fixturesDir: "validation/m14/fixtures/solidity",
  docs: ["docs/analyzers/solidity.md"],
  differentialCheck: "differential-solidity",
  perfKey: "solidity:solidity",
  floorResidual: {
    // RE-PINNED 2026-11-03 (launch pass) TO THE CANONICAL 50/50 SWEEP'S OWN ROW, WHICH IS 0/0.
    //
    // The 2/21 ruling below was measured on an EARLIER 60-file draw (SOL-15 moved it up from
    // 18, and its reasoning is kept verbatim below because it is the record of why the number
    // was allowed to move in the direction that usually means a regression). It is no longer the
    // row the gate reads: commit 9c0cc0b14 ("DIFFERENTIAL AT 50/50: CANONICAL SWEEP …") added
    // `counts["solidity:solidity"] = {missing 0, unexplained 0, sampleSetHash e9708e750546e983}`
    // from the canonical sweep, and a pinned row of 0/0 with a 2/21 ruling is exactly the shape
    // this gate was written to refuse ("a lower-than-documented floor is acceptable ONLY after
    // the ruling is re-pinned"). The ruling is therefore re-pinned to the row, and the 2/21
    // reading stays in this comment as history rather than as a claim.
    //
    // DRAW VARIANCE IS RECORDED, NOT ABSORBED. A scoped probe on a LATER rotated draw
    // (hash b7bb9c3a028f84c7) read 60 files / tree-truth 3177 / covered 3162 (99.5%) /
    // MISSING=15 / unexplained=0 — the same class of cross-file residue the 2/21 reading
    // itemised, appearing because the 60-file draw rotates. Both readings are 60-file draws and
    // neither is the whole population; the PIN is the canonical sweep's draw, and a future sweep
    // that draws a file carrying the residual will re-pin it and must update this ruling with it.
    missing: 0,
    // SOL-15 moved this floor UP from 18, which is the direction that normally means
    // a regression, so the reason lives with the number in
    // validation/m14/differential-baseline.json `floorMoves["solidity:solidity"]` and
    // not here. In short: the `revert_statement` case had never fired in EITHER the
    // analyzer or the oracle (both tested `namedChild(0).type === "identifier"`; the
    // grammar puts an `expression` wrapper there), so 453 custom-error call edges did
    // not exist and the two dead instruments agreed at zero. Two dead instruments
    // that agree are not corroboration. Repairing both, and hashing the oracles into
    // `sweepStateKey` so an oracle edit can no longer resume a cached verdict, left a
    // residual of 3 custom-error calls to errors declared in another file — 0
    // unclassifiable.
    unexplained: 0,
    ruling: "SOL-SCOPE (re-pinned 2026-11-03 to the canonical 50/50 pin; see the note above)",
  },
  // `decorates` JOINED THE CONTRACT ROW WITH THE SOL-17/SOL-R3 RELABEL (144 rows at index
  // scope, 31 per file): the modifier invocation is published as its own kind now, and the
  // row had not been updated since, so section B reported the lane as emitting a kind its
  // contract omitted. Pinned by validation/m14/fixtures/solidity/modifier-decorates-relabel
  // (the in-file band fires, and the base-constructor impostor is forbidden both ways).
  requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides", "exports", "imports", "decorates"],
  payloads: {
    complexity: { key: "expectComplexity", pin: "solidity/branches-sol (every branch construct in the language, so a branch set that loses one drops the number below 12 and fails)" },
  },
  title: "solidity wave (M60, SOL-1..SOL-14) — grammar pinned byte-identical to npm tree-sitter-solidity@1.2.13, zero local patches",
},
  scss: {
  id: "scss",
  wasm: "tree-sitter-scss.wasm",
  classification: "scss-completeness.json",
  fixturesDir: "validation/m14/fixtures/scss",
  docs: ["docs/analyzers/scss.md"],
  differentialCheck: "differential-scss",
  perfKey: "element-plus:scss",
  // 2026-09-29: 58/4 -> 56/3, re-pinned with grammar patches 4 and 5 (map literals
  // and `@include` argument whitespace), which took the 244-file corpus from 149 to
  // 164 clean files with 15 fixed and 0 regressed. Worth recording that a large PARSE
  // improvement is not automatically a GRAPH improvement: the floor moved by 2, not 15,
  // and only measuring the two separately makes that visible.
  floorResidual: {
    missing: 56,
    unexplained: 3,
    ruling: "SCSS-D1",
  },
  requiredKinds: ["uses", "references", "contains", "imports", "calls", "exports", "extends", "overrides", "mixes_in", "part_of"],
  payloads: {
    complexity: { key: "expectComplexity", pin: "scss (mixin/function parameters, control-flow conditions, variable expressions)" },
    parameters: { key: "expectParameters", pin: "scss/module-system-and-mixins, functions-return-and-undeclared-uses" },
  },
  title: "scss pass (M14 F3 walk)",
},
  toml: {
  id: "toml",
  wasm: "tree-sitter-toml.wasm",
  classification: "toml-completeness.json",
  fixturesDir: "validation/m14/fixtures/toml",
  docs: ["docs/analyzers/toml.md"],
  // Measured in validation/m14/results/M14.0.F5.json: `differential-toml`
  // (pass, 60 files, coverage 100%, unexplained 0%). The entry was missing the
  // name it is gated by; the name is read off the artifact, not guessed.
  differentialCheck: "differential-toml",
  perfKey: "cargo:toml",
  // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check,
    // which runs this lane over its OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it. Every kind below is ALREADY pinned by this lane's
    // expectation files, so the forward check (required => pinned) stays green.
    requiredKinds: ["contains", "exports", "imports", "references"],
  payloads: {
    complexity: { key: "expectComplexity", pin: "toml/arrays-and-values (structural depth = the deepest key path, not a node count)" },
  },
  title: "toml pass (#419, #289)",
},
  yaml: {
  id: "yaml",
  wasm: "tree-sitter-yaml.wasm",
  classification: "yaml-completeness.json",
  fixturesDir: "validation/m14/fixtures/yaml",
  docs: ["docs/analyzers/yaml.md"],
  // NO `differentialCheck`, and that absence is the measured state, not an
  // omission: the committed M14.0.F5.json carries no `differential-yaml` row and
  // no `differential-kubernetes:yaml` row either (its 61 differential ids were
  // enumerated to check). What this lane DOES have is the F9 floor, pinned as
  // `kubernetes:yaml` below and verified by section E against
  // differential-baseline.json.
  perfKey: "kubernetes:yaml",
  // THE ROW NOW NAMES WHAT THE ANALYZER PUBLISHES, closing section B's reverse check,
    // which runs this lane over its OWN fixture sources and fails a kind that is emitted
    // while the contract row omits it. Every kind below is ALREADY pinned by this lane's
    // expectation files, so the forward check (required => pinned) stays green.
    requiredKinds: ["contains", "extends", "imports", "references", "calls", "exports", "overrides", "uses"],
  payloads: {
    complexity: { key: "expectComplexity", pin: "yaml/payload-complexity (addressable-subtree size per symbol, the family's complexity definition)" },
    docstring: { key: "expectDocstring", pin: "yaml/comment-attribution (a comment is documentation; attribution is positional — same or shallower column, immediately preceding)" },
    qualifiedCalls: { key: "expectQualifiedCalls", pin: "yaml/merge-sequence, yaml/json-pointer-resolve, yaml/tag-declared-type" },
  },
  title: "yaml pass (#286)",
},
}

// Languages that have reached CONFORMANT and therefore run in npm run verify.
// csharp reached it in the #264 wave: the powershell corpus differential floor
// is pinned at 0 missing / 0 unexplained (completeness sections E/F now pass),
// fixtures + mutation + F1 all green. Declared residual (300-file sweep):
// unsafe C# COM-interop vtable-dispatch calls are captured as `uses` rather
// than `calls` (tree-sitter parses `if(...)` and pointer-slot chaining as
// degenerate invocation_expression subtrees) — bounded to that corpus corner.
const GATED_LANGS = ["bash", "java", "groovy", "kotlin", "scala", "typescript", "javascript", "vue", "svelte", "c", "cpp", "rust", "go", "zig", "csharp", "dart", "swift", "objc", "php", "ruby", "python", "haskell", "hcl", "xml", "make", "perl", "css", "toml", "markdown", "julia", "solidity", "scss", "yaml", "clojure", "erlang", "html", "fsharp", "elixir"]

async function loadNamedNodeTypes(cfg: LangConfig): Promise<string[]> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  // A LANE MAY PIN MORE THAN ONE WASM, and `companionWasm` is how the config says so. THREE DO:
  // markdown loads markdown + markdown_inline, julia and typescript each load a second grammar too.
  // This loader read only `cfg.wasm`, so every node type that lives in the COMPANION grammar was
  // invisible to section A and its correctly-classified row read as "no longer produced by the wasm
  // (grammar drift?)". Measured on markdown: 19 rows accused of drift, ALL 19 real and produced by the
  // inline grammar -- against the union of both pinned wasms the stale count is 0 and the unclassified
  // count is 0. The proper fix is never to delete the correct row; it is to read the grammar the row
  // came from. `companionWasm` was declared on the config at :61 and never consulted.
  const wasms = [cfg.wasm, ...(cfg.companionWasm ?? [])]
  const named: string[] = []
  const seenNamed = new Set<string>()
  for (const w of wasms) {
    const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", w)))
    for (let i = 0; i < g.nodeTypeCount; i++) {
      if (!g.nodeTypeIsNamed(i)) continue
      const n = g.nodeTypeForId(i)
      if (n && !n.startsWith("_") && !seenNamed.has(n)) { seenNamed.add(n); named.push(n) }
    }
  }
  // ERROR and MISSING are produced by every tree-sitter parser but are NOT
  // listed by `nodeTypeForId` in the wasm ABI. F1 handles this with an explicit
  // universal pair (script/m14/audit-analyzer-grammar.ts:93) and the bash F8
  // census reuses that same pair; this gate now reuses it too, because a spec
  // that classifies ERROR — correctly, since the analyzer consults it — was
  // being told its own row was grammar drift. Three instruments, one oracle:
  // when they disagree, one of them is wrong, and the fix is never to delete the
  // correct row.
  for (const u of ["ERROR", "MISSING"]) if (!named.includes(u)) named.push(u)
  return named
}

function loadSpec(cfg: LangConfig) {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "script", "m14", "spec", cfg.classification), "utf8"))
  // Typed as `Set<string>`, not left to inference off an `any` spec: without the
  // declaration the elements read as `unknown` and the drift check that consumes
  // them (`types.includes(t)`) became a call the compiler could not check.
  const handled = new Set<string>(spec.handled_verified?.types ?? [])
  const silent = new Set<string>(spec.internal_silent?.types ?? [])
  const gapTypes = new Set<string>()
  for (const g of spec.gap?.gaps ?? []) {
    // A spec is DATA. A record with no `node_type` classifies nothing — the same
    // rule the decisions loop below already applies — and must not take the gate
    // down. Before this, go's GO-GAP-1 threw here, which presented as an
    // unrelated TypeError and silently stopped the run after groovy, so 13 of the
    // 23 gated lanes were not being checked at all.
    if (typeof g.node_type !== "string") continue
    for (const t of g.node_type.split(",")) gapTypes.add(t.trim())
  }
  const decisionTypes = new Set<string>()
  for (const d of spec.design_decision.decisions) {
    // Defect-style records (SWIFTD17-19, OBJCD5-8: status FIXED + `issue` field)
    // document a resolved defect, not a grammar node-type ruling — they carry
    // no node_type and must not classify anything. Only RULED-style records
    // with node_type join the classified set.
    if (!d.node_type) continue
    for (const t of d.node_type.split(",")) decisionTypes.add(t.trim())
  }
  return { spec, handled, silent, gapTypes, decisionTypes }
}

interface SectionCheck { id: string; description: string; status: "pass" | "fail"; detail?: string }

function readExpectations(cfg: LangConfig): any[] {
  const dir = path.join(ROOT, cfg.fixturesDir)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".expectation.json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
}

async function verifySectionB(cfg: LangConfig): Promise<SectionCheck> {
  const pinned = new Set<string>()
  for (const exp of readExpectations(cfg)) {
    for (const rel of exp.expectRelationships ?? []) {
      if (typeof rel.type === "string") pinned.add(rel.type)
      if (rel["meta.relationshipType"]) pinned.add(rel["meta.relationshipType"])
      // isImportDep: kotlin/scala import edges carry this flag (the K8
      // JVM-family finding — the gate had the same blind spot the tier
      // classifier had).
      if (rel["meta.isJavaImport"] || rel["meta.isGroovyImport"] || rel["meta.isImport"] || rel["meta.isImportDep"]) pinned.add("imports")
    }
  }
  const unpinned = cfg.requiredKinds.filter((k) => !pinned.has(k))
  // --- the reverse direction, added 2026-09-30 (php F1/F2) -------------------
  //
  // Everything above is ONE-WAY: it asks whether every kind in `requiredKinds`
  // is pinned by a fixture. It never asks whether the lane EMITS anything the
  // row omits — so a kind the analyzer publishes in volume can be missing from
  // `requiredKinds` and this section still reads pass. Two real instances:
  //
  //   php `imports`  25,104 edges over the two pinned corpora (its 3rd-largest
  //                   label), emitted by `emitUseClause` and `emitInclude`, and
  //                   ABSENT from the row. The row is the thing that certifies the
  //                   relationship contract, so the contract was published at 8
  //                   kinds while the analyzer published 9.
  //   php `contains` 24,707 edges (4th largest). This one the row DID name — but
  //                   the row naming a kind is not the same as auditing it, which
  //                   is why `contains` had no oracle and sat outside the
  //                   differential entirely. (That half is fixed in
  //                   script/m14/differential.ts by derivePhpContainsEdges; this
  //                   check is the half that would have caught the ROW being
  //                   wrong.)
  //
  // The same shape the lane's own record names repeatedly: a gate that reads a
  // different object than the consumer certifies a different program. This
  // section was reading the expectation files and certifying the analyzer.
  //
  // The emitted side is measured by RUNNING the lane's own analyzer over the
  // lane's own fixture sources — the same universe the pinned set comes from, so
  // both halves of the section describe the same files. `requiredKinds` may
  // legitimately name a kind no fixture exercises (the unpinned check above
  // covers that); what must not happen is the reverse, because an emitted kind
  // the row omits is published output no contract row accounts for.
  const emitted = await emittedKinds(cfg)
  // A kind the analyzer emits and the row omits is published output no contract row
  // accounts for. There are exactly two honest answers — name the kind in the row,
  // or write down why the row omits it — and this check cannot tell them apart
  // automatically, because the spec's `node_type` field classifies GRAMMAR node
  // types and a relationship kind has none. So it does not guess: it reports, and
  // the remedy is stated in the message. A deliberate exclusion is legitimate; a
  // silent one is the defect, and only the lane can say which it meant.
  const unlisted = [...emitted].filter((k) => !cfg.requiredKinds.includes(k)).sort()
  const fail = unpinned.length > 0 || unlisted.length > 0
  const detail = [
    unpinned.length ? `unpinned: ${unpinned.join(", ")}` : null,
    unlisted.length
      ? `EMITTED but absent from requiredKinds: ${unlisted.join(", ")} — the analyzer publishes these and the contract row does not name them; add the kind, or record why the row omits it`
      : null,
  ].filter(Boolean).join(" | ")
  return {
    id: "section-b-relationship-kinds",
    description: `${cfg.requiredKinds.length} relationship kinds pinned by ${cfg.id} fixtures; ${emitted.size} emitted and all accounted for`,
    status: fail ? "fail" : "pass",
    detail: fail ? detail : `pinned: ${[...pinned].sort().join(", ")}; emitted: ${[...emitted].sort().join(", ")}`,
  }
}

/**
 * The relationship kinds the lane's analyzer actually emits over its own fixture
 * sources, read by RUNNING the analyzer.
 *
 * Deliberately not read from the expectation files: those are hand-authored
 * claims, and a hand-authored claim is exactly what the reverse check exists to
 * audit. Deliberately not read from a corpus: the row is per-lane config, the
 * fixtures are the lane's own sample, and a corpus walk here would make section
 * B cost a full sweep for a check that is about the ROW, not the corpus.
 *
 * Returns an empty set when the lane cannot be exercised (no wasm, no analyzer
 * file, no fixtures) so an unrelated lane's setup problem cannot manufacture a
 * finding here — an unmeasurable direction reports nothing rather than guessing.
 */
async function emittedKinds(cfg: LangConfig): Promise<Set<string>> {
  const out = new Set<string>()
  const dir = path.join(ROOT, cfg.fixturesDir)
  if (!fs.existsSync(dir)) return out
  if (!fs.existsSync(path.join(ROOT, cfg.analyzerFile ?? path.join("src", "ast", `real-${cfg.id}-analyzer.ts`)))) return out
  // *** THE SOURCE UNIVERSE IS THE ONE THE EXPECTATIONS DESCRIBE, NOT EVERY FILE IN THE DIRECTORY. ***
  //
  // This function used to parse EVERY non-.json file in the fixtures directory. Most lane directories
  // hold committed PROBES and CENSUS SCRIPTS next to their fixtures -- .ts/.mts/.py/.sh tools that
  // produced the lane's own evidence -- and `ASTEngine.parseFile` routes by path, so parsing them ran a
  // DIFFERENT LANGUAGE'S analyzer and attributed its edges to this lane. Measured 2026-10-17: 32 lanes
  // had foreign source in their fixture directory; typescript 102 of 103 files, bash 100 of 101,
  // dart 81 of 116, python 73 of 92, zig 70 of 87.
  //
  // The concrete damage, found by yaml's owner: yaml's four committed .ts probes were parsed, the
  // TYPESCRIPT analyzer emitted 4 `instantiates` edges from them, and section B reported `instantiates`
  // as a kind YAML emits. YAML has no such emission (`grep -c Instantiates` = 0) and its own ruling
  // D11 declares instantiates a grammar absence -- so the gate was asking the lane to name a
  // relationship it cannot produce, in an instrument whose whole purpose is to not do that.
  //
  // The pairing is already on disk: `<name>.expectation.json` describes `<name>.<ext>`, and some
  // expectations name their fixture outright in a `fixture` field. THIS IS THE SAME UNIVERSE `pinned`
  // IS READ FROM -- which this comment always claimed and the code did not do.
  const sources: string[] = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".expectation.json")) continue
    const base = f.slice(0, -".expectation.json".length)
    let declared: string | null = null
    try {
      const exp = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))
      if (typeof exp.fixture === "string") declared = path.basename(exp.fixture)
    } catch { /* an unreadable expectation pins nothing; the forward half reports it */ }
    if (declared && fs.existsSync(path.join(dir, declared))) { sources.push(declared); continue }
    for (const g of fs.readdirSync(dir)) {
      if (!g.startsWith(base + ".") || g.endsWith(".json")) continue
      try { if (fs.statSync(path.join(dir, g)).isFile()) sources.push(g) } catch { /* ignore */ }
    }
  }
  const uniqueSources = [...new Set(sources)]
  if (!uniqueSources.length) return out
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  for (const f of uniqueSources) {
    let src: string
    try { src = fs.readFileSync(path.join(dir, f), "utf8") } catch { continue }
    let res: any
    try { res = await ASTEngine.parseFile(path.join(dir, f), src) } catch { continue }
    for (const r of res?.relationships ?? []) {
      const t = String(r.type ?? r.relationshipType ?? "")
      if (t) out.add(t)
    }
  }
  return out
}


function verifySectionC(cfg: LangConfig): SectionCheck {
  const exps = readExpectations(cfg)
  const missing: string[] = []
  for (const [payload, { key, pin }] of Object.entries(cfg.payloads)) {
    if (!exps.some((e) => Array.isArray(e[key]) && e[key].length > 0)) missing.push(`${payload} (${pin})`)
  }
  return {
    id: "section-c-payload-matrix",
    description: `Matrix 1b payload rows pinned for ${cfg.id} (${Object.keys(cfg.payloads).length})`,
    status: missing.length ? "fail" : "pass",
    detail: missing.length ? `missing pins: ${missing.join(", ")}` : Object.keys(cfg.payloads).join(", "),
  }
}

function verifySectionD(cfg: LangConfig): SectionCheck {
  const tiers = new Set<string>()
  for (const exp of readExpectations(cfg)) {
    for (const rel of exp.expectRelationships ?? []) {
      if (rel["meta.evidenceClass"]) tiers.add(rel["meta.evidenceClass"])
    }
  }
  return {
    id: "section-d-evidence-tiers",
    description: ">=2 distinct evidenceClass values pinned by fixtures",
    status: tiers.size >= 2 ? "pass" : "fail",
    detail: `${tiers.size} tier(s) pinned: ${[...tiers].sort().join(", ")}`,
  }
}

function verifySectionE(cfg: LangConfig): SectionCheck {
  // The corpus FLOOR is pinned in differential-baseline.json under the
  // language's floor key (perfKey: grails-core:java / grails-core:groovy /
  // Exposed:kotlin). M14.0.F5.json is a SNAPSHOT of the last single
  // differential run (emitEvidence overwrites per repo), so reading it for
  // the floor would fail any language whose floor repo isn't the last run
  // (kotlin's floor is Exposed; the sweep's audit:differential runs
  // grails-core). The baseline is the pinned truth; the differential's own
  // regression gate enforces current counts never exceed it.
  const p = path.join(ROOT, "validation", "m14", "differential-baseline.json")
  if (!fs.existsSync(p)) return { id: "section-e-differential", description: "corpus floor pinned in differential-baseline.json", status: "fail", detail: "missing differential-baseline.json" }
  const b = JSON.parse(fs.readFileSync(p, "utf8"))
  const row = b?.counts?.[cfg.perfKey]
  if (!row) return { id: "section-e-differential", description: `${cfg.perfKey} floor row present`, status: "fail", detail: `no baseline floor row for ${cfg.perfKey}` }
  // Documented-residual floor (c, C-D4): the ruling pins the exact floor
  // counts in the config; section E verifies the baseline row MATCHES the
  // ruling (a future fix that lowers the residual must update both — the
  // ledger stays truthful). A lower-than-documented floor is still
  // acceptable ONLY after the ruling is re-pinned; equality is the check.
  if (cfg.floorResidual) {
    const f = cfg.floorResidual
    const ok = row.missing === f.missing && row.unexplained === f.unexplained
    return {
      id: "section-e-differential",
      description: `${cfg.perfKey} at documented residual floor (${f.ruling}: missing ${f.missing}, unexplained ${f.unexplained})`,
      status: ok ? "pass" : "fail",
      detail: `floor ${cfg.perfKey}: missing=${row.missing}, unexplained=${row.unexplained} — expected ${f.missing}/${f.unexplained} per ${f.ruling} (differential-baseline.json)`,
    }
  }
  const ok = row.missing === 0 && row.unexplained === 0
  return {
    id: "section-e-differential",
    description: `${cfg.perfKey} at corpus floor (missing 0, unexplained 0)`,
    status: ok ? "pass" : "fail",
    detail: `floor ${cfg.perfKey}: missing=${row.missing}, unexplained=${row.unexplained} (differential-baseline.json)`,
  }
}

function verifySectionF(cfg: LangConfig): SectionCheck {
  if (!fs.existsSync(BASELINE)) return { id: "section-f-perf-budget", description: "perf budget recorded in differential-baseline.json", status: "fail", detail: "missing differential-baseline.json" }
  const b = JSON.parse(fs.readFileSync(BASELINE, "utf8"))
  const avg = b?.counts?.[cfg.perfKey]?.perf?.avgMsPerFile
  return {
    id: "section-f-perf-budget",
    description: `${cfg.id} avgMsPerFile recorded (F9 gate enforces budget)`,
    status: typeof avg === "number" && avg > 0 ? "pass" : "fail",
    detail: typeof avg === "number" && avg > 0 ? `${cfg.perfKey} ${avg} ms/file` : `no avgMsPerFile for ${cfg.perfKey}`,
  }
}

/**
 * THE HEAD COMMENT IS PART OF THE CEREMONY, AND IT WAS NOT A GATE CHECK UNTIL NOW.
 *
 * Owner requirement: every analyzer opens with a 10-20 line comment naming the AUTHOR, what the file is,
 * the relationship types it covers, where its docs/specs/fixtures/validations live, WHICH OTHER FILES TO
 * EDIT when this one changes, and the grammar it depends on -- written for a future contributor.
 *
 * MEASURED 2026-10-17 BEFORE THIS CHECK EXISTED: 48 analyzers, **8 had it, 40 did not.** Sections A-H were
 * all green for many of those 40, which is the whole lesson: a requirement that is only in a brief is a
 * requirement that gets skipped, and every lane will report its own section list as complete while the
 * ceremony is missing. It is checked here so it cannot be skipped silently again.
 *
 * WHAT IS REQUIRED IS SUBSTANCE, NOT BOILERPLATE. A copy-pasted four-line banner that names the author and
 * nothing else fails, deliberately: the author alone is a signature, not a map. The four things a future
 * contributor actually needs are the author, a docs/spec pointer, the relationship kinds this file emits,
 * and the co-edit list -- so those are what is read.
 */
function headCommentOf(lane: string): { ok: boolean; why: string } {
  const cfg = LANG_CONFIGS[lane]
  const p = path.join(ROOT, cfg?.analyzerFile ?? path.join("src", "ast", `real-${lane}-analyzer.ts`))
  if (!fs.existsSync(p)) return { ok: false, why: "analyzer file absent" }
  const src = fs.readFileSync(p, "utf8")
  // The LEADING comment block only: everything before the first import/export statement.
  const cut = src.search(/^(import|export|const|class|function)\b/m)
  const head = cut > 0 ? src.slice(0, cut) : src.slice(0, 3000)
  const has = (re: RegExp) => re.test(head)
  const author = has(/Muhammad Ishaq Khan/)
  const docs = has(/docs\/analyzers|docs\/m14/)
  const kinds = has(/\b(calls?|references?|contains?|imports?|exports?|extends?|implements?|overrides?|instantiates?|uses)\b/)
  // THE SUBSTANCE, NOT A PHRASE. The first version matched a handful of exact spellings;
  // javascript's header says "EDIT THESE TOO", which IS a co-edit list, and the check called it
  // absent. A check that only accepts the wording it was written against punishes every lane
  // that says the same thing differently -- so it now accepts any heading that names what to
  // edit alongside this file.
  const coedit = has(/co-?edit|edit (these|those|them|this|it)|edit .*when|when this file changes|sibling file|other files|files to edit|related files|see also|touches/i)
  const why: string[] = []
  if (!author) why.push("no author")
  if (!docs) why.push("no docs pointer")
  if (!kinds) why.push("no relationship kinds")
  if (!coedit) why.push("no co-edit list")
  return { ok: author && docs && kinds && coedit, why: why.join(", ") }
}

function verifySectionG(cfg: LangConfig): SectionCheck {
  const missing = cfg.docs.filter((d) => !fs.existsSync(path.join(ROOT, d)))
  const head = headCommentOf(cfg.id)
  const fails: string[] = []
  if (missing.length) fails.push(`missing docs: ${missing.join(", ")}`)
  if (!head.ok) fails.push(`analyzer head comment: ${head.why}`)
  return {
    id: "section-g-docs",
    description: `${cfg.id} analyzer docs present and committed, and its head comment names author + docs + kinds + co-edit list`,
    status: fails.length ? "fail" : "pass",
    detail: fails.length ? fails.join(" | ") : cfg.docs.join(", ") + " + head comment present",
  }
}

function verifySectionH(): SectionCheck {
  const p = path.join(RESULTS, "M14.CC1.json")
  if (!fs.existsSync(p)) return { id: "section-h-cross-language", description: "cross-language consistency evidence (M14.CC1.json) exists", status: "fail", detail: "missing M14.CC1.json" }
  const ev = JSON.parse(fs.readFileSync(p, "utf8"))
  const checks: any[] = ev.checks ?? []
  const bad = checks.filter((c) => c.status !== "pass")
  return {
    id: "section-h-cross-language",
    description: "cross-language consistency checks all pass",
    status: bad.length === 0 && checks.length > 0 ? "pass" : "fail",
    detail: bad.length ? `failing: ${bad.map((c) => c.id).join(", ")}` : `${checks.length} checks pass`,
  }
}

async function runLang(cfg: LangConfig): Promise<{ checks: SectionCheck[]; summary: string; failures: number }> {
  const types = await loadNamedNodeTypes(cfg)
  const { spec, handled, silent, gapTypes, decisionTypes } = loadSpec(cfg)

  const classified = (t: string) => handled.has(t) || silent.has(t) || gapTypes.has(t) || decisionTypes.has(t)
  const unclassified = types.filter((t) => !classified(t))
  const staleRows = [...handled, ...silent].filter((t) => !types.includes(t))

  let failures = 0
  if (unclassified.length > 0) {
    failures++
    console.error(`${cfg.id} COMPLETENESS FAIL: ${unclassified.length} node type(s) in NO bucket: ${unclassified.join(", ")}`)
  }
  if (staleRows.length > 0) {
    failures++
    console.error(`${cfg.id} COMPLETENESS FAIL: ${staleRows.length} classified row(s) no longer produced by the wasm (grammar drift?): ${staleRows.join(", ")}`)
  }

  const checks: SectionCheck[] = [
    {
      id: "section-a-structural",
      description: `every named node type classified (${cfg.id})`,
      status: unclassified.length === 0 ? "pass" : "fail",
      detail: `${types.length} types, ${handled.size} handled, ${silent.size} silent, ${spec.gap.gaps.length} gaps, ${spec.design_decision.decisions.length} decisions`,
    },
    await verifySectionB(cfg),
    verifySectionC(cfg),
    verifySectionD(cfg),
    verifySectionE(cfg),
    verifySectionF(cfg),
    verifySectionG(cfg),
    verifySectionH(),
  ]
  const sectionFails = checks.filter((c) => c.status !== "pass")
  if (sectionFails.length > 0) {
    failures++
    // A language registered but not yet CONFORMANT (perl: E and F await the
    // canonical sweep) needs its passing sections VISIBLE, not just its two
    // failures — "6 of 8" is a different claim from "it failed", and only the
    // first one tells a reviewer which work is left. Same courtesy as
    // differential.ts's scoped-run banner: this prints, it does not write.
    const SCOPED = !!(globalThis as any).__SCOPED_LANG
    if (SCOPED) {
      console.log(`${cfg.id} SECTIONS (scoped run — M14.0.SPEC evidence is NOT written):`)
      for (const c of checks) console.log(`  ${c.status === "pass" ? "pass" : "FAIL"}  ${c.id.padEnd(28)} ${c.detail}`)
    }
    for (const c of sectionFails) console.error(`${cfg.id} SECTION FAIL: ${c.id} — ${c.detail}`)
  }
  // *** THE VERDICT MUST NOT BE READABLE AS "DONE", BECAUSE IT IS NOT "DONE". ***
  //
  // THIS GATE VERIFIES EIGHT THINGS ABOUT A LANE'S COMPLETENESS AS AN INSTRUMENT: every grammar node type
  // classified, every emitted relationship kind named and fixture-pinned, the payload matrix, evidence tiers,
  // a corpus differential floor, a perf budget, truthful docs with the head comment, and cross-language
  // consistency.
  //
  // IT DOES NOT VERIFY THE OWNER'S DEFINITION OF DONE, AND IT WAS BEING READ AS IF IT DID -- which is how a
  // green row got reported as "35 languages done" while the relationship matrix said 183 of 424 applicable
  // cells (43.2%). The two unmeasured parts are named here, in the verdict itself, so that a green row can
  // never again be quoted as finished work:
  //
  //   (b) ACTUALLY EMITTING AT WHOLE POPULATION   -- measured by the firing log, NOT by this gate
  //       (this file contains ZERO references to the firing log)
  //   (c) RESOLVING CORRECTLY (arbitraryTwin...)  -- measured by the incoming gate's binding-intent split,
  //       NOT by this gate (this file contains ZERO references to arbitraryTwin / collRes)
  //
  // AND THE DENOMINATOR IS THE LANE'S DECLARED SET, NOT THE LANGUAGE'S TRUE APPLICABLE SET. The gate can say
  // "every kind we listed is accounted for"; it CANNOT say "every kind this language has is implemented".
  // That is the difference the owner's standard makes, and this verdict refuses to blur it.
  const green = checks.length - sectionFails.length
  const summary = `${cfg.id}: ${types.length} types classified; lane-pass ${green}/${checks.length} ` +
    `(A-H: structural/contract/evidence/perf/docs) — NOT "done": emission at whole population and ` +
    `correct-resolution (arbitraryTwin) are measured elsewhere, and the denominator is the DECLARED kind set, ` +
    `not the language's true applicable set`
  return { checks, summary, failures }
}

async function main() {
  const listOnly = process.argv.includes("--list")
  const langArg = process.argv.includes("--lang") ? process.argv[process.argv.indexOf("--lang") + 1] : undefined
  const ids = langArg ? [langArg] : GATED_LANGS
  // runLang reads this to decide whether a partial section list is worth
  // printing; a --lang run is a diagnostic, a bare run is the milestone gate.
  ;(globalThis as any).__SCOPED_LANG = langArg
  const cfgs = ids.map((id) => {
    if (!LANG_CONFIGS[id]) throw new Error(`unknown language ${id}`)
    return LANG_CONFIGS[id]
  })

  if (listOnly) {
    for (const cfg of cfgs) {
      const { spec } = loadSpec(cfg)
      const types = await loadNamedNodeTypes(cfg)
      console.log(`\n${cfg.id} grammar: ${types.length} public named node types`)
      console.log(`handled_verified: ${spec.handled_verified.types.length} | internal_silent: ${spec.internal_silent.types.length} | gaps: ${spec.gap.gaps.length} | design decisions: ${spec.design_decision.decisions.length}`)
      console.log("=== NUMBERED GAP LIST ===")
      for (const g of spec.gap.gaps) {
        console.log(`  ${g.id}: [${g.severity}] ${g.node_type} — ${g.missing}`)
      }
      console.log("=== PENDING OWNER DECISIONS ===")
      for (const d of spec.design_decision.decisions) {
        console.log(`  ${d.id}: ${d.question.slice(0, 140)}`)
      }
    }
    return
  }

  let anyFailure = false
  // The declared shape is `runLang`'s own return type, so `r.checks` is
  // `SectionCheck[]` at both places it is read below — it was `any[]`, which is
  // why two callbacks had no element type and were flagged as implicit `any`.
  const results: Array<{ checks: SectionCheck[]; summary: string; failures: number }> = []
  for (const cfg of cfgs) {
    const r = await runLang(cfg)
    anyFailure = anyFailure || r.failures > 0
    results.push(r)
  }
  if (anyFailure) process.exit(1)

  // Emit evidence (machine-generated; never hand-edited)
  const { emitEvidence } = await import("./evidence-harness")
  const checks: any[] = []
  const data: any = { languages: {} }
  // A SCOPED RUN MERGES; IT DOES NOT REPLACE. `--lang dart` used to write a
  // ledger containing exactly one language, because `data.languages` started
  // empty and `emitEvidence` overwrites the file. Measured twice: the ledger held
  // 21 languages at 2cc7b150e and one (dart) from 9172fefe7 onward, and
  // script/m29/verify-wave-protocol.ts then died on
  // `languages["java"].sections` — a gate that could not read its own subject. A
  // previous repair (aaa462b84) restated the 20 languages by hand, which treats
  // the symptom. A bare run is still the authority; a scoped run keeps every
  // language it did not measure.
  for (const r of results) {
    const cfg = cfgs.find((c) => r.summary.startsWith(c.id + ":"))!
    const { spec } = loadSpec(cfg)
    const gapList = spec.gap.gaps.map((g: any) => `${g.id}: ${g.missing}`)
    const ruled = spec.design_decision.decisions.filter((d: any) => d.status === "RULED")
    const pending = spec.design_decision.decisions.filter((d: any) => d.status !== "RULED")
    checks.push(
      { id: `inventory-fully-classified`, description: `${cfg.id}: every named node type classified`, status: "pass", language: cfg.id },
      { id: "gap-list-present", description: `${cfg.id}: ${spec.gap.gaps.length} confirmed gaps declared`, status: "pass", language: cfg.id },
      { id: "design-decisions-tracked", description: `${cfg.id}: ${ruled.length} ruled, ${pending.length} pending owner`, status: "pass", language: cfg.id },
      ...r.checks.map((c) => ({ ...c, language: cfg.id })),
    )
    data.languages[cfg.id] = {
      nodeTypeCount: (await loadNamedNodeTypes(cfg)).length,
      gaps: gapList,
      ruledDecisions: ruled.map((d: any) => d.id),
      pendingDecisions: pending.map((d: any) => d.id),
      sections: Object.fromEntries(r.checks.map((c) => [c.id, { status: c.status, detail: c.detail ?? "" }])),
    }
  }
  if (langArg) {
    const ledgerPath = path.join(RESULTS, "M14.0.SPEC.json")
    let prior: { checks?: any[]; data?: { languages?: Record<string, unknown> } } = {}
    try {
      prior = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as typeof prior
    } catch {
      prior = {}
    }
    const touched = new Set(ids)
    const keptLangs = Object.entries(prior.data?.languages ?? {}).filter(([id]) => !touched.has(id))
    const keptChecks = (prior.checks ?? []).filter((c: any) => typeof c?.language === "string" && !touched.has(c.language))
    if (keptLangs.length > 0) {
      const merged: Record<string, unknown> = {}
      for (const [id, row] of keptLangs) merged[id] = row
      for (const [id, row] of Object.entries(data.languages)) merged[id] = row
      data.languages = merged
      // Kept rows lead, so a scoped run never re-numbers the languages it did not
      // measure: the order on disk stays the order a full run produced.
      checks.unshift(...keptChecks)
      console.log(`scoped run (--lang ${ids.join(",")}): kept ${keptLangs.length} other language row(s) from ${path.relative(ROOT, ledgerPath)}`)
    }
  }

  emitEvidence({
    issueId: "M14.0.SPEC",
    title: "Completeness spec (#419) — A–H sections per language",
    claimLevel: "L2",
    layers: ["completeness"],
    checks,
    limitations: [
      { description: "classified against pinned wasm grammars; grammar drift re-validates on every run" },
      { description: "java gaps G1-G4 closed fixture-first (2026-08-26); rulings G5/G6/S1 applied; CONFORMANT" },
      { description: "groovy G1-G8 closed fixture-first 2026-08-27 (34/34 fixtures, 41/41 mutants incl. 13 groovy); S1-S5 ruled: gstring Uses declared limitation (grammar emits no interpolation nodes), JPMS never-reachable, exports/apiContractPath NOT EMITTED, parameters GATED; exports + permits declared not-required for groovy" },
      { description: "c rulings C-D1/D2/D3/D4 (2026-09-05 Holy C wave): no class/interface hierarchy grammar constructs; function pointers + macro expansion + preprocessor control flow not always statically resolvable; completeness scope tied to pinned tree-sitter-c grammar. Macro-mangled ERROR regions in 4 GENERATED amalgamation files leave a documented residual floor (C-D4): sqlite:c 9 missing/105 unexplained, jq:c 4/28 @60/lang — section E validates jq:c against the ruling; 251/251 mutants incl. 10 c; fixture cgd31-37-regressions pins CGD31-38" },
      { description: "cpp rulings CPP-D1/D2/D3 (2026-08-28): GNU asm + extension_expression parsed not modeled; MSVC SEH/declspec/based/call/pointer modifiers parsed not modeled; cross-file resolution + template instantiation across TUs are per-file by contract. 256/256 types classified A-H 8/8; fmt:cpp differential 145/145 0 missing 0 unexplained; 115/115 mutants incl. 3 cpp" },
      { description: "rust rulings RUST-D1/D2/D3 (2026-08-28): trait supertraits -> extends, impl -> implements, no class-based overrides edge; macro_rules! bodies opaque token trees (invocations call the macro NAME only, no expansion); scope tied to pinned tree-sitter-rust. 185/185 types classified A-H 8/8; ripgrep:rust differential 1948/1948 0 missing 0 unexplained; 122/122 mutants incl. 7 rust; union_item + trait associated_type gaps closed fixture-first; use-list import contract pinned (module/items, alias-aware, wildcards, extern crate)" },
    ],
    data,
  })
  for (const r of results) console.log(r.summary)
}

main().catch((e) => { console.error(e); process.exit(1) })
