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
 *   G. Docs truthful            — docs/analyzers/<lang>.md +
 *      real-<lang>-analyzer.md exist
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
  classification: string
  fixturesDir: string
  docs: string[]
  differentialCheck: string
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
    docs: ["docs/analyzers/real-bash-analyzer.md"],
    differentialCheck: "differential-bash",
    perfKey: "otp:bash",
    // The six types bash's semantics allow. `extends`/`implements`/`overrides`
    // (no declaration form creates a type hierarchy) and `instantiates` (no
    // constructors) are ruled N/A in BD7 of the spec, so they are not required
    // here — the exclusion is written down rather than left as a silence.
    requiredKinds: ["calls", "uses", "contains", "imports", "references", "exports"],
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
    docs: ["docs/analyzers/real-cpp-analyzer.md"],
    differentialCheck: "differential-cpp",
    perfKey: "fmt:cpp",
    requiredKinds: ["uses", "references", "calls", "instantiates", "extends", "overrides", "imports"],
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
    docs: ["docs/analyzers/real-c-analyzer.md"],
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
    requiredKinds: ["uses", "references", "exports", "imports"],
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
    docs: ["docs/analyzers/real-rust-analyzer.md"],
    differentialCheck: "differential-rust",
    perfKey: "ripgrep:rust",
    requiredKinds: ["uses", "references", "exports", "contains", "calls", "extends", "implements", "instantiates"],
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
    docs: ["docs/analyzers/go.md", "docs/analyzers/real-go-analyzer.md"],
    differentialCheck: "differential-go",
    perfKey: "go-tools:go",
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "imports"],
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
    docs: ["docs/analyzers/real-zig-analyzer.md"],
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
    requiredKinds: ["calls", "uses", "contains", "references", "imports"],
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
    docs: ["docs/analyzers/real-csharp-analyzer.md"],
    differentialCheck: "differential-csharp",
    perfKey: "powershell:csharp",
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides", "imports"],
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
    docs: ["docs/analyzers/real-dart-analyzer.md"],
    differentialCheck: "differential-dart",
    perfKey: "proxicall:dart",
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "contains", "overrides", "imports"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "dart/payload-and-complexity" },
      parameters: { key: "expectParameters", pin: "dart/payload-and-complexity" },
      visibility: { key: "expectVisibility", pin: "dart/payload-and-complexity" },
    },
    title: "dart managed-OO wave (#264)",
  },
  swift: {
    id: "swift",
    wasm: "tree-sitter-swift.wasm",
    classification: "swift-completeness.json",
    fixturesDir: "validation/m14/fixtures/swift",
    docs: ["docs/analyzers/real-swift-analyzer.md"],
    differentialCheck: "differential-swift",
    perfKey: "swift-nio:swift",
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides"],
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
    docs: ["docs/analyzers/real-ruby-analyzer.md"],
    differentialCheck: "differential-ruby",
    perfKey: "rake:ruby",
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "contains"],
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
    docs: ["docs/analyzers/real-python-analyzer.md"],
    differentialCheck: "differential-python",
    perfKey: "cython:python",
    requiredKinds: ["calls", "extends", "instantiates", "uses", "contains", "imports", "references"],
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
    docs: ["docs/analyzers/real-haskell-analyzer.md"],
    differentialCheck: "differential-haskell",
    perfKey: "cabal:haskell",
    requiredKinds: ["calls", "extends", "instantiates", "contains", "references", "implements"],
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
    docs: ["docs/analyzers/real-perl-analyzer.md"],
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
    requiredKinds: ["calls", "contains", "extends", "implements", "instantiates", "overrides"],
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
    docs: ["docs/analyzers/real-xml-analyzer.md"],
    differentialCheck: "differential-xml",
    perfKey: "grails-core:xml",
    requiredKinds: ["contains", "references", "imports"],
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
    docs: ["docs/analyzers/real-nim-analyzer.md"],
    differentialCheck: "differential-nim",
    perfKey: "nim:nim",
    // Exactly the eight kinds the nim analyzer emits, and all eight are pinned
    // by validation/m14/fixtures/nim (calls 3, contains 3, extends 1, imports 3,
    // instantiates 1, overrides 1, references 3, uses 2). `implements` is NOT
    // listed because it is structurally N/A — a Nim concept is satisfied by
    // implicit structural dispatch and the source never names a nominal
    // subtype, so there is nothing to point at. That is ruling NIMD3 in
    // script/m14/spec/nim-completeness.json, not a silent absence.
    requiredKinds: ["calls", "contains", "extends", "imports", "instantiates", "overrides", "references", "uses"],
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
    docs: ["docs/analyzers/real-php-analyzer.md"],
    differentialCheck: "differential-php",
    perfKey: "phpunit:php",
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "php/payload-and-complexity" },
    },
    title: "php managed-OO wave (#268)",
  },
  objc: {
    id: "objc",
    wasm: "tree-sitter-objc.wasm",
    classification: "objc-completeness.json",
    fixturesDir: "validation/m14/fixtures/objc",
    docs: ["docs/analyzers/real-objective-c-analyzer.md"],
    differentialCheck: "differential-objc",
    perfKey: "sdwebimage:objc",
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains"],
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
    docs: ["docs/analyzers/java.md", "docs/analyzers/real-java-analyzer.md"],
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
    docs: ["docs/analyzers/groovy.md", "docs/analyzers/real-groovy-analyzer.md"],
    differentialCheck: "differential-groovy",
    perfKey: "grails-core:groovy",
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides", "imports"],
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
    docs: ["docs/analyzers/kotlin.md", "docs/analyzers/real-kotlin-analyzer.md"],
    differentialCheck: "differential-kotlin",
    perfKey: "Exposed:kotlin",
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides", "imports"],
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
    docs: ["docs/analyzers/scala.md", "docs/analyzers/real-scala-analyzer.md"],
    differentialCheck: "differential-scala",
    perfKey: "scala3:scala",
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides", "imports"],
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
    docs: ["docs/analyzers/typescript.md", "docs/analyzers/real-typescript-analyzer.md"],
    differentialCheck: "differential-typescript",
    perfKey: "vue-core:typescript",
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides", "exports", "imports"],
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
    docs: ["docs/analyzers/javascript.md", "docs/analyzers/real-javascript-analyzer.md"],
    differentialCheck: "differential-javascript",
    perfKey: "lodash:javascript",
    requiredKinds: ["calls", "extends", "instantiates", "uses", "references", "contains", "overrides", "exports", "imports"],
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
    docs: ["docs/analyzers/vue.md", "docs/analyzers/real-vue-analyzer.md"],
    differentialCheck: "differential-vue",
    perfKey: "vue-core:vue",
    requiredKinds: ["calls", "extends", "instantiates", "uses", "references", "contains", "overrides", "exports", "imports"],
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
  // measured but unpinned, `docs/analyzers/html.md` does not exist, and CC1 has no
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
    docs: ["docs/analyzers/html.md", "docs/analyzers/real-html-analyzer.md"],
    differentialCheck: "differential-html",
    perfKey: "otp:html",
    requiredKinds: ["uses", "contains"],
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
    docs: ["docs/analyzers/real-css-analyzer.md"],
    differentialCheck: "differential-css",
    perfKey: "svelte:css",
    requiredKinds: ["uses", "references", "contains", "imports"],
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
    docs: ["docs/analyzers/svelte.md", "docs/analyzers/real-svelte-analyzer.md"],
    differentialCheck: "differential-svelte",
    perfKey: "svelte:svelte",
    requiredKinds: ["calls", "extends", "instantiates", "uses", "references", "contains", "overrides", "exports", "imports"],
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
      docs: ["docs/analyzers/real-make-analyzer.md"],
    differentialCheck: "differential-make",
    perfKey: "tf-aws-components:make",
    requiredKinds: ["contains", "references", "uses", "imports", "exports", "calls"],
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
  // docs/analyzers/real-hcl-analyzer.md, and the `terraform:hcl` /
  // `tf-aws-components:hcl` rows this file's section E reads), and the hcl lane
  // should confirm them.
  hcl: {
    id: "hcl",
    wasm: "tree-sitter-hcl.wasm",
    classification: "hcl-completeness.json",
    fixturesDir: "validation/m14/fixtures/hcl",
    docs: ["docs/analyzers/real-hcl-analyzer.md"],
    differentialCheck: "differential-hcl",
    perfKey: "terraform:hcl",
    // NO `calls`: hcl RULES that kind not applicable on measurement (0 of its 64
    // node types declare a function, and 0 of 12,977 corpus function_call nodes
    // resolve to a declared symbol), so requiring it pinned would demand a
    // fixture assert an edge the lane deliberately never emits. The restored
    // entry listed it and section B failed on exactly that — recorded here
    // because the failure is the reason the value is right.
    requiredKinds: ["contains", "references", "uses", "imports", "exports"],
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
  docs: ["docs/analyzers/markdown.md", "docs/analyzers/real-markdown-analyzer.md"],
  differentialCheck: "differential-markdown",
  perfKey: "scala3:markdown",
  requiredKinds: ["contains", "uses"],
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
  docs: ["docs/analyzers/real-powershell-analyzer.md"],
  differentialCheck: "differential-powershell",
  perfKey: "powershell:powershell",
  // The ten the universal ontology declares. All ten are implemented and gated;
  // `imports` is deliberately modelled as an import-annotated `references` edge
  // (PSD/`addImport`), so it is not listed as required here — the exclusion is
  // written down rather than left as a silence, and the annotation is pinned by
  // module-surface-psb9's `expectImports` rows.
  requiredKinds: ["calls", "uses", "contains", "references", "instantiates", "exports", "extends", "implements", "overrides"],
  payloads: {
    complexity: { key: "expectComplexity", pin: "powershell/reserved-words-psb4" },
  },
  title: "powershell wave (M14 #277, PS-G1..PS-G8, PSD1..PSD6)",
},
  scss: {
  id: "scss",
  wasm: "tree-sitter-scss.wasm",
  classification: "scss-completeness.json",
  fixturesDir: "validation/m14/fixtures/scss",
  docs: ["docs/analyzers/real-scss-analyzer.md"],
  differentialCheck: "differential-scss",
  perfKey: "element-plus:scss",
  floorResidual: {
    missing: 58,
    unexplained: 4,
    ruling: "SCSS-D1",
  },
  requiredKinds: ["uses", "references", "contains", "imports"],
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
  docs: ["docs/analyzers/real-toml-analyzer.md"],
  perfKey: "cargo:toml",
  requiredKinds: ["contains"],
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
  docs: ["docs/analyzers/real-yaml-analyzer.md"],
  perfKey: "kubernetes:yaml",
  requiredKinds: ["contains", "extends", "imports", "references"],
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
const GATED_LANGS = ["bash", "java", "groovy", "kotlin", "scala", "typescript", "javascript", "vue", "svelte", "c", "cpp", "rust", "go", "zig", "csharp", "dart", "swift", "objc", "php", "ruby", "python", "haskell", "hcl", "xml", "make", "perl"]

async function loadNamedNodeTypes(cfg: LangConfig): Promise<string[]> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
  const named: string[] = []
  for (let i = 0; i < g.nodeTypeCount; i++) {
    if (!g.nodeTypeIsNamed(i)) continue
    const n = g.nodeTypeForId(i)
    if (n && !n.startsWith("_")) named.push(n)
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
  const handled = new Set(spec.handled_verified?.types ?? [])
  const silent = new Set(spec.internal_silent?.types ?? [])
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

function verifySectionB(cfg: LangConfig): SectionCheck {
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
  return {
    id: "section-b-relationship-kinds",
    description: `${cfg.requiredKinds.length} relationship kinds pinned by ${cfg.id} fixtures`,
    status: unpinned.length ? "fail" : "pass",
    detail: unpinned.length ? `unpinned: ${unpinned.join(", ")}` : `pinned: ${[...pinned].sort().join(", ")}`,
  }
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

function verifySectionG(cfg: LangConfig): SectionCheck {
  const missing = cfg.docs.filter((d) => !fs.existsSync(path.join(ROOT, d)))
  return {
    id: "section-g-docs",
    description: `${cfg.id} analyzer docs present and committed`,
    status: missing.length ? "fail" : "pass",
    detail: missing.length ? `missing: ${missing.join(", ")}` : cfg.docs.join(", "),
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
    verifySectionB(cfg),
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
  const summary = `${cfg.id}: ${types.length} types classified; sections A-H: ${checks.length - sectionFails.length}/${checks.length} pass`
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
  const results: any[] = []
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
