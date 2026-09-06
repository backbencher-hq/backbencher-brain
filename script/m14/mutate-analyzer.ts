/**
 * M14.0.F4 — Mutation-Testing Harness
 *
 * Proves the verification gates CAN fail. For each mutant (a deliberately
 * defective analyzer), the fixture suite MUST go red. A surviving mutant
 * fails THE SUITE, not the mutant — suites that stay green no matter what
 * are decoration, and decoration is what let M13 claim dishonest things.
 *
 * Mutants wrap the real analyzer and transform its output — a faithful
 * simulation of an analyzer carrying the defect, without fragile source
 * surgery. Every mutant is documented with its defect class.
 *
 * Gate: every mutant must increase its language's failure count above the
 * recorded baseline (validation/m14/fixture-baseline.json). Exit 0 iff all
 * mutants are caught. Also emits evidence via the F2 harness.
 *
 * CLI: bun run script/m14/mutate-analyzer.ts
 */
import * as fs from "fs"
import * as path from "path"
import { runLang, LANGS } from "./run-fixtures"

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")

interface Mutant {
  id: string
  language: string
  defectClass: string
  description: string
  transform: (result: any) => any
}

function normRel(r: any) { return { ...r, type: r.type ?? r.relationshipType } }

const MUTANTS: Mutant[] = [
  {
    id: "c/drop-field-access-uses",
    language: "c",
    defectClass: "relationship-loss",
    description: "drops C field-access Uses edges",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "field_access") }),
  },
  {
    id: "c/drop-include-references",
    language: "c",
    defectClass: "relationship-loss",
    description: "drops C include dependency References edges",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "include_dependency") }),
  },
  {
    id: "c/drop-complexity",
    language: "c",
    defectClass: "payload-loss",
    description: "removes C cyclomatic complexity from function symbols",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "c/emit-write-as-read",
    language: "c",
    defectClass: "relationship-fabrication",
    description: "SCD1 regression: removes the field_expression assignment-LHS write gate — re-injects the pre-fix edge probe-verified on q->value = v / q->value += 1 (set_value->value uses) — c set_value forbid catches it",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "uses", source: "set_value", target: "value", isExternal: true, weight: 1, confidence: 0.9, metadata: { relationshipType: "field_access", accessedFrom: "q" },
      }],
    }),
  },
  {
    id: "c/cgd31-callee-field-leaf-uses",
    language: "c",
    defectClass: "relationship-duplication",
    description: "CGD31 regression: re-emits the redundant `uses` for a field_identifier LEAF under a callee field_expression (method-table call) — the calls edge already carries it; cgd31-37 fixture forbids read_kv->read_impl uses",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "read_kv", target: "read_impl", confidence: 1, metadata: { relationshipType: "identifier_usage" } }] }),
  },
  {
    id: "c/cgd33-type-only-uses",
    language: "c",
    defectClass: "relationship-fabrication",
    description: "CGD33/34 regression: re-emits `uses Mem3Like` for the macro-qualified struct's phantom function_definition name (SQLITE_WSD shape) — a plain identifier resolving ONLY as a type cannot be a value read; cgd31-37 fixture forbids it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "touch_mem3", target: "Mem3Like", confidence: 1, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } }] }),
  },
  {
    id: "c/cgd37-designator-name-uses",
    language: "c",
    defectClass: "relationship-fabrication",
    description: "CGD37 regression: re-emits `uses read_impl` for the `.read_impl = kvrecordRead` designated-initializer NAME (a write target, not a read); cgd31-37 fixture forbids global->read_impl uses",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "global", target: "read_impl", confidence: 1, metadata: { relationshipType: "identifier_usage", nodeType: "field_identifier" } }] }),
  },
  {
    id: "c/cgd35-drop-typedef-references",
    language: "c",
    defectClass: "relationship-loss",
    description: "CGD35 regression: drops `references` edges to typedef aliases over builtin bases (i64/u8 — showwal.c shape) by restoring the type_identifier-is-declaring suppression; cgd31-37 fixture expects references i64 and u8",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(String(x.type) === "references" && (x.target === "i64" || x.target === "u8"))) }),
  },
  {
    id: "c/cgd36-drop-fn-value-before-def",
    language: "c",
    defectClass: "relationship-loss",
    description: "CGD36 regression: drops order-independent `uses` for a function read as a VALUE before its definition (later_defined read in use_later and the CALLBACKS table); cgd31-37 fixture expects uses later_defined",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(String(x.type) === "uses" && x.target === "later_defined")) }),
  },
  {
    id: "c/cgd38-phantom-function-symbol",
    language: "c",
    defectClass: "symbol-fabrication",
    description: "CGD38 regression: re-adds the phantom Function symbol Mem3Like fabricated from the SQLITE_WSD-style macro-qualified struct recovery (bare-identifier declarator treated as a callable); cgd31-37 fixture forbids the symbol",
    transform: r => ({ ...r, symbols: [...(r.symbols ?? []), { name: "Mem3Like", kind: "function", scope: "global", visibility: "public" }] }),
  },
  {
    id: "cpp/drop-virtual-overrides",
    language: "cpp",
    defectClass: "relationship-loss",
    description: "drops C++ virtual override edges (isVirtualOverride)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isVirtualOverride) }),
  },
  {
    id: "cpp/drop-extends-edges",
    language: "cpp",
    defectClass: "relationship-loss",
    description: "drops C++ class inheritance (extends) edges",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.type !== "extends") }),
  },
  {
    id: "cpp/drop-qualified-calls",
    language: "cpp",
    defectClass: "payload-loss",
    description: "removes C++ qualified_calls payloads from method symbols",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, qualified_calls: undefined })) }),
  },
  {
    id: "cpp/drop-global-scope-new",
    language: "cpp",
    defectClass: "relationship-loss",
    description: "CPPD8 regression: drops instantiates whose constructed type has a leading global-scope `::` (the pre-fix leaf extraction unwrapped only one qualified_identifier level, so `new ::std::stringstream` died on the clean-leaf regex while `new ::Foo` worked)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.type === "instantiates" && typeof x.toSymbol === "string" && x.toSymbol.startsWith("::"))) }),
  },
  {
    id: "cpp/ctor-calls-to-class-name",
    language: "cpp",
    defectClass: "payload-corruption",
    description: "CPPD9 regression: re-attributes constructor-body calls to the raw CLASS name (source=Engine) instead of the normalized constructor symbol, and moves the qc payload onto the class symbol — the pre-fix state where the call graph pointed at the Class and constructor.qualified_calls stayed empty",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? [])
        .filter(x => !(x.type === "calls" && x.source === "constructor" && (x.target === "start" || x.target === "warm")))
        .concat([
          { source: "Engine", target: "start", type: "calls", fromSymbol: "Engine", toSymbol: "start" },
          { source: "Engine", target: "warm", type: "calls", fromSymbol: "Engine", toSymbol: "warm" },
        ]),
      symbols: (r.symbols ?? []).map(s => s.name === "Engine" ? { ...s, qualified_calls: ["start", "warm"] } : s),
    }),
  },
  {
    id: "cpp/qc-cross-class-pollution",
    language: "cpp",
    defectClass: "payload-corruption",
    description: "CPPD10 regression: merges qualified_calls by bare method name so Alpha.run and Beta.run both carry [aFn, bFn] (the pre-fix post-loop name-keyed merge)",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map(s => (s.name === "run" ? { ...s, qualified_calls: ["aFn", "bFn"] } : s)),
    }),
  },
  {
    id: "cpp/last-sig-wins-overrides",
    language: "cpp",
    defectClass: "relationship-loss",
    description: "CPPD11 regression: virtual registry keeps one signature per method name (last-declared wins), so an override of the FIRST-declared base overload f(int) is silently dropped when the base also declares f(double)",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).filter(x => !(x.type === "overrides" && (x as any).metadata?.reasonCode === "signature-match" && String(x.source).startsWith("Derived.f"))),
    }),
  },
  {
    id: "cpp/legacy-using-import-shape",
    language: "cpp",
    defectClass: "payload-corruption",
    description: "CPPD12 regression: converts using-declaration imports back to the legacy {source, imported} shape with no module — the pre-fix state where `using namespace std` / `using std::pair` were silently DROPPED by the persister (same class as the C #include fix)",
    transform: r => ({
      ...r,
      imports: (r.imports ?? [])
        .filter((i: any) => !((i.metadata ?? {}).isUsingDeclaration))
        .concat((r.imports ?? []).filter((i: any) => (i.metadata ?? {}).isUsingDeclaration).map((i: any) => ({ source: i.module, imported: [], isTypeOnly: false }))),
    }),
  },
  {
    id: "cpp/template-arg-call-targets",
    language: "cpp",
    defectClass: "payload-corruption",
    description: "CPPD13 regression: re-adds template arguments to call targets (`func<int>`, `apply<double>` — the pre-fix state where callee leaves leaked template args, 855 across fmt), and restores functor-temp/ptr-to-member junk callee text as targets",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? [])
        .filter(x => !(x.type === "calls" && (x.target === "func" || x.target === "apply")))
        .concat([
          { source: "drive", target: "func<int>", type: "calls", fromSymbol: "drive", toSymbol: "ns::func<int>" },
          { source: "drive", target: "apply<double>", type: "calls", fromSymbol: "drive", toSymbol: "g.apply<double>" },
        ]),
    }),
  },
  {
    id: "rust/drop-scoped-struct-literal-leaf",
    language: "rust",
    defectClass: "relationship-loss",
    description: "drops enum-variant struct-literal instantiates whose target is the variant leaf (MatchStrategy::Suffix -> Suffix): the pre-fix analyzer required a plain type_identifier and silently dropped scoped names",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !((x.metadata ?? {}).relationshipType === "struct_literal" && x.target === "Suffix") && !((x.metadata ?? {}).relationshipType === "struct_literal" && x.target === "Literal")) }),
  },
  {
    id: "rust/turbofish-whole-text-target",
    language: "rust",
    defectClass: "relationship-loss",
    description: "targets turbofish calls (x.parse::<u32>()) by whole base text instead of the callee leaf: restores the pre-fix bug where generic_function used baseNode.text",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => (x.type === "calls" && x.target === "parse" ? { ...x, target: "cap.parse" } : x)) }),
  },
  {
    id: "rust/parenthesized-closure-callee",
    language: "rust",
    defectClass: "relationship-loss",
    description: "re-emits calls edges for parenthesized closure callees ((self.0)(n)): the pre-fix else branch took functionNode.text verbatim and fabricated a (self.0) target",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "run", target: "(self.0)", type: "calls", confidence: 1, metadata: {} }] }),
  },
  {
    id: "rust/drop-union-symbols",
    language: "rust",
    defectClass: "symbol-loss",
    description: "drops union_item declaration sites (Pixel): the pre-fix analyzer had no union_item branch, so Rust unions emitted NO symbol",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !(s.name === "Pixel" && s.kind === "struct")) }),
  },
  {
    id: "rust/drop-trait-associated-types",
    language: "rust",
    defectClass: "symbol-loss",
    description: "drops trait-level associated_type symbols (Container.Item): the pre-fix analyzer only handled impl-level type_item, so trait bodies' `type Item;` were invisible",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !(s.name === "Item" && s.ownerName === "Container")) }),
  },
  {
    id: "rust/duplicate-awaited-call-edge",
    language: "rust",
    defectClass: "relationship-duplication",
    description: "re-emits the raw await edge in ADDITION to the canonical call edge (the pre-fix await_expression branch pushed a second calls edge with the full function text as target): one awaited call site must produce exactly ONE calls edge",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "connect", target: "do_connect", type: "calls", confidence: 1, metadata: { rustSpecific: true, isAwait: true } }] }),
  },
  {
    id: "rust/raw-use-list-import",
    language: "rust",
    defectClass: "import-contract",
    description: "stores the whole use-declaration raw text as the import module (pre-fix: `use std::io::{Read, Write as W}` became module='std::io::{Read, Write as W}' with comma-split items): restores the family-contract violation",
    transform: r => ({ ...r, imports: (r.imports ?? []).map((i: any) => (i.module === "std::io" ? { ...i, module: "std::io::{Read, Write as W}", items: ["std::io::{Read", "Write as W}"] } : i)) }),
  },
  {
    id: "rust/merge-qc-by-bare-name",
    language: "rust",
    defectClass: "payload-pollution",
    description: "RSD1 regression: re-keys qualified_calls by BARE method name (the pre-fix qcByFunction map) so same-named methods across types share one union payload — qualified-calls-ownership fixture's per-owner notIncludes pins catch it (Alpha.run must not carry beta_only)",
    transform: r => {
      const byName = new Map<string, string[]>()
      for (const s of r.symbols ?? []) {
        if (!(s.kind === "function" || s.kind === "method") || !s.qualified_calls?.length) continue
        const cur = byName.get(s.name) ?? []
        byName.set(s.name, [...cur, ...s.qualified_calls])
      }
      return {
        ...r,
        symbols: (r.symbols ?? []).map((s: any) => {
          if ((s.kind === "function" || s.kind === "method") && byName.has(s.name)) {
            return { ...s, qualified_calls: [...new Set(byName.get(s.name)!)] }
          }
          return s
        }),
      }
    },
  },
  {
    id: "rust/wipe-qc-on-error-files",
    language: "rust",
    defectClass: "payload-loss",
    description: "RSD2 regression: clears every function's qualified_calls when the file contains ANY parse error (the pre-fix whole-file `!metadata.errors` guard) — error-file-payload fixture's clean_caller pin catches it",
    transform: r => (r.metadata?.errors?.length ? {
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => {
        if (s.kind === "function" || s.kind === "method") return { ...s, qualified_calls: undefined }
        return s
      }),
    } : r),
  },
  {
    id: "rust/duplicate-impl-ids",
    language: "rust",
    defectClass: "symbol-identity",
    description: "RSD3 regression: strips the uniqueId '#N' suffix so `struct Alpha` and both `impl Alpha` blocks collapse to the SAME symbol id 'Alpha' (pre-fix state, 2,852 duplicate ids in the corpus) — qualified-calls-ownership fixture's expectUniqueIds + expectSymbols id pins catch it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, id: (s.id ?? "").replace(/#[0-9]+$/, "") })) }),
  },
  {
    id: "rust/drop-macro-payload",
    language: "rust",
    defectClass: "payload-loss",
    description: "RSD4 regression: strips macro: entries from qualified_calls (pre-fix: handleMacroInvocation never attached a payload, so format!()-only methods were invisible) — qualified-calls-ownership fixture's second/macro:format pin catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => {
      if (!s.qualified_calls?.length) return s
      const qc = s.qualified_calls.filter((c: string) => !c.startsWith("macro:"))
      return qc.length === s.qualified_calls.length ? s : { ...s, qualified_calls: qc }
    }) }),
  },
  {
    id: "rust/reemit-write-field-uses",
    language: "rust",
    defectClass: "relationship-noise",
    description: "RSD5 regression: re-emits `uses` for assignment-LHS field WRITES (the pre-fix field_expression branch had no write-gate — 1,076 bogus uses across cargo+ripgrep; the oracle derives no uses truth so only fixtures catch it) — qualified-calls-ownership fixture's set_name/bump_count forbid pins catch it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "set_name", target: "name", type: "uses", confidence: 0.9, metadata: { relationshipType: "field_access", accessedFrom: "self" } }, { source: "bump_count", target: "count", type: "uses", confidence: 0.9, metadata: { relationshipType: "field_access", accessedFrom: "self" } }] }),
  },
  {
    id: "rust/drop-nested-group-import-items",
    language: "rust",
    defectClass: "import-loss",
    description: "RSD6a regression: drops nested-group leaves from import items (pre-fix `use std::{env, io, path::{Path, PathBuf}}` bound only env/io — Path/PathBuf silently lost, 65 declarations across cargo+ripgrep) — use-list-imports fixture's std-row pin catches it",
    transform: r => ({ ...r, imports: (r.imports ?? []).map((i: any) => (i.module === "std" ? { ...i, items: (i.items ?? []).filter((x: string) => x !== "Path" && x !== "PathBuf") } : i)) }),
  },
  {
    id: "rust/join-top-group-imports",
    language: "rust",
    defectClass: "import-contract",
    description: "RSD6b regression: collapses a top-level group import into ONE row whose module is the joined item names (pre-fix `use {std::sync::Arc, ...}` fabricated module 'Arc, Duration'; 28 declarations across cargo+ripgrep) — use-list-imports fixture's per-binding row pins catch it",
    transform: r => ({
      ...r,
      imports: [...(r.imports ?? []).filter((i: any) => i.module !== "std::sync::Arc" && i.module !== "std::time::Duration"), { module: "Arc, Duration", items: ["Arc", "Duration"], metadata: { rustSpecific: true, isPublic: false } }],
    }),
  },
  {
    id: "rust/drop-attr-framework-detection",
    language: "rust",
    defectClass: "framework-loss",
    description: "RSD7 regression: clears serde/tokio/thiserror/tracing/clap/axum/rocket from detectedFrameworks, keeping only actix route macros (pre-fix: handleAttribute caught only #[get]/#[post] — serde derives and tokio::main on a real file yielded detectedFrameworks=[]) — relationship-kinds fixture's expectFrameworks [serde, tokio] pins catch it",
    transform: r => {
      const fw: string[] = r.metadata?.detectedFrameworks ?? []
      const kept = fw.filter((f: string) => f === "actix_web")
      return { ...r, metadata: { ...(r.metadata ?? {}), detectedFrameworks: kept } }
    },
  },
  {
    id: "go/whole-text-stdlib-callee",
    language: "go",
    defectClass: "relationship-loss",
    description: "targets package-qualified stdlib calls by whole text instead of the leaf (fmt.Sprintf -> fmt.Sprintf target): restores the pre-fix buildGoCallExpression behavior the oracle flagged",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => (x.type === "calls" && x.target === "Sprintf" ? { ...x, target: "fmt.Sprintf" } : x)) }),
  },
  {
    id: "go/drop-package-scope-call",
    language: "go",
    defectClass: "relationship-loss",
    description: "drops package-scope call edges (go_package_scope_call): the pre-fix analyzer never emitted NewShape() at package level",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "go_package_scope_call") }),
  },
  {
    id: "go/closure-var-goroutine-defer",
    language: "go",
    defectClass: "relationship-fabrication",
    description: "re-emits calls edges for anonymous func-literal goroutine/defer bodies (target 'anonymous_closure'): restores the pre-fix extractGoRoutineFunction/extractDeferredFunction behavior",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "startWork", target: "anonymous_closure", type: "calls", confidence: 0.8, metadata: { relationshipType: "go_goroutine" } }, { source: "startWork", target: "anonymous_closure", type: "calls", confidence: 0.8, metadata: { relationshipType: "go_defer" } }] }),
  },
  {
    id: "go/type-conversion-as-call",
    language: "go",
    defectClass: "relationship-fabrication",
    description: "emits calls edges for builtin type-conversion expressions (float64(...)): the pre-fix oracle-mismatch class where bare builtin calls leaked as call truth",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "startWork", target: "float64", type: "calls", confidence: 0.8, metadata: { relationshipType: "go_function_call", callExpression: "float64" } }] }),
  },
  {
    id: "go/drop-implements-edge",
    language: "go",
    defectClass: "relationship-loss",
    description: "drops implicit interface implements edges (go_interface_implementation): a regression that removes duck-typing satisfaction detection",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "go_interface_implementation") }),
  },
  {
    id: "go/double-count-switch-arms",
    language: "go",
    defectClass: "payload-corruption",
    description: "SCD10 regression: re-adds switch-wrapper double-counting (the pre-fix counter counted expression/type/select wrappers AND arms) — pump pin equals:4 catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => s.name === "pump" ? { ...s, complexity: s.complexity + 1 } : s) }),
  },
  {
    id: "go/reemit-write-selector-uses",
    language: "go",
    defectClass: "relationship-noise",
    description: "GOD4 regression: re-emits `uses` for assignment-LHS field WRITES and inc/dec operands (the pre-fix analyzeGoSelectorUses had no write-gate — measured 5,202 write-only (fn, field) bogus uses edges across go-tools+terraform; cpp/c/php/ruby/python/groovy/objc/ts all gate it) — relationship-and-payloads fixture's persist->writeOnly forbid pin catches it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "persist", target: "writeOnly", type: "uses", confidence: 0.7, metadata: { relationshipType: "go_selector_use", selectorExpression: "persist.writeOnly" } }] }),
  },
  {
    id: "go/drop-interface-embedding-extends",
    language: "go",
    defectClass: "relationship-loss",
    description: "GOD4 regression: drops interface-embedding extends edges (`interface { Reader; io.Closer }` previously emitted only a member-symbol contains — no inheritance edge; java interface-extends / rust trait-supertype family parity; 156 embedding sites measured across go-tools+terraform) — implements-params fixture's ReadCloser->Reader go_interface_embedding pin catches it",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => (x.metadata ?? {}).relationshipType !== "go_interface_embedding") }),
  },
  {
    id: "go/drop-composite-literal-construction",
    language: "go",
    defectClass: "relationship-loss",
    description: "GOD6 regression: drops composite-literal construction instantiates (`Foo{}`/`&Foo{}` previously emitted NOTHING — instantiates only fired for NewXxx calls; 65,843 composite literals across go-tools+terraform with zero construction edges; rust emits struct-literal instantiates, csharp for new — family parity) — relationship-and-payloads fixture pins caught by work->Worker/NewShape->Shape composite pins",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => (x.metadata ?? {}).relationshipType !== "go_composite_literal_construction") }),
  },
  {
    id: "go/func-type-implementors-dropped",
    language: "go",
    defectClass: "relationship-loss",
    description: "GOD5 regression: drops implements edges from non-struct defined types (the pre-fix analyzer checked only isStruct implementors — `type HandlerFunc func(...)` + methods never satisfied interfaces; go-tools jsonrpc2 HandlerFunc/PreempterFunc + gopls subcommands slice type all missed) — implements-params fixture's RunnerFn->Runner2 pin catches it",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "implements" && x.source === "RunnerFn")) }),
  },
  {
    id: "go/named-result-signature-mismatch",
    language: "go",
    defectClass: "relationship-loss",
    description: "GOD5 regression: drops implements when the interface names its results but the impl does not (`(result any, err error)` vs `(any, error)` — the pre-fix raw-text signature compare treated them as different; go-tools defaultHandler vs jsonrpc2 Handler/Preempter dropped) — implements-params fixture's HandlerImpl->NamedResulter pin catches it",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "implements" && x.source === "HandlerImpl")) }),
  },
  {
    id: "go/generic-implements-fabricated",
    language: "go",
    defectClass: "relationship-fabrication",
    description: "GOD5 regression: emits implements for generic instantiation pairs (Box[T]->GenericIface[T] — satisfaction needs type unification neither side can do; the name-only oracle previously over-claimed it) — implements-params fixture's Box->GenericIface forbid pin catches it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "Box", target: "GenericIface", type: "implements", confidence: 1, metadata: { relationshipType: "go_interface_implementation", isImplicit: true } }] }),
  },
  {
    id: "go/drop-promoted-struct-implements",
    language: "go",
    defectClass: "relationship-loss",
    description: "drops implements edges that arise from EMBEDDED-STRUCT method promotion (Worker impl Runner via *Shape.Run, no own methods): the pre-promotion analyzer (and oracle) silently lost these, so a struct implementing an interface through an embedded type was missed",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.type === "implements" && x.source === "Worker" && x.target === "Runner2")) }),
  },
  {
    id: "go/false-implements-embedded-only",
    language: "go",
    defectClass: "relationship-fabrication",
    description: "restores the pre-fix embedded-interface blind spot: emits FileBad->ReadCloser (a struct with ONLY Close()) as if it satisfied the embedding ReadCloser { Reader; Close() } — the false positive that existed because promoted Reader.Read was never folded into ReadCloser's method set",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "FileBad", target: "ReadCloser", type: "implements", confidence: 1, metadata: { relationshipType: "go_interface_implementation", isImplicit: true, matchedMethods: ["Close"], implementationType: "duck_typing", receiverSet: "pointer" } }] }),
  },
  {
    id: "go/drop-symbol-complexity",
    language: "go",
    defectClass: "payload-loss",
    description: "removes per-symbol cyclomatic complexity (the go wave added it; rust/c/cpp already had it)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "go/drop-framework-detection",
    language: "go",
    defectClass: "payload-loss",
    description: "GOD7 regression: empties detectedFrameworks (framework truth is differential-invisible — deriveGoEdges derives no framework truth, so ONLY the fixture can catch it; rust wave-6 RSD7 learned this exact lesson) — framework-detection fixture's expectFrameworks [gin, net_http, gorilla_mux, grpc] pin catches it",
    transform: r => ({ ...r, metadata: { ...(r.metadata ?? {}), detectedFrameworks: [] } }),
  },
  {
    id: "go/duplicate-qualified-calls",
    language: "go",
    defectClass: "payload-corruption",
    description: "GOD9 regression: re-adds per-call-site qualified_calls (the pre-fix findGoFunctionCalls had no dedup — a function calling fmt.Println at 5 sites pushed 5 identical entries; 29,463 excess rows across go-tools+terraform on 4,719 symbols). The rust #383 lesson: qualified_calls is a UNIQUE set of callee paths per symbol. relationship-and-payloads fixture's startWork countEquals s.startWork:1 pin catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => s.name === "startWork" ? { ...s, qualified_calls: [...(s.qualified_calls ?? []), ...(s.qualified_calls ?? []).filter((c: string) => c === "s.startWork")] } : s) }),
  },
  {
    id: "go/reemit-dotted-channel-uses",
    language: "go",
    defectClass: "relationship-noise",
    description: "GOD8 regression: re-emits channel-op uses with the RAW operand text and no dedup (the pre-fix analyzeGoSpecificPatterns pushed `h.jobs <- v` as dotted `h.jobs`, `<-ctx.Done()` as `ctx.Done()`, bare locals as their name — 327 garbage targets + 79 duplicate rows across go-tools+terraform; uses is NOT in go's differential-compared label set, so ONLY the fixture catches it) — type-usage-graph fixture's worker->jobs/doneAll channel pins + pump->ch/done/h.jobs forbids catch it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "worker", target: "h.jobs", type: "uses", confidence: 0.8, metadata: { relationshipType: "go_channel_operation", operationType: "send", pattern: "channel_communication" } }] }),
  },
  {
    id: "zig/drop-calls",
    language: "zig",
    defectClass: "relationship-loss",
    description: "drops every zig_function_call edge: the pre-wave analyzer emitted ZERO calls on real Zig source (56 call sites in one 30KB std file produced nothing), so the fixture pins the callee-leaf call surface",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "zig_function_call") }),
  },
  {
    id: "zig/drop-uses",
    language: "zig",
    defectClass: "relationship-loss",
    description: "drops every zig_field_access (uses) edge: restores the pre-wave state where field-access dependency edges were never emitted",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "zig_field_access") }),
  },
  {
    id: "zig/emit-write-as-read",
    language: "zig",
    defectClass: "relationship-fabrication",
    description: "ZGD1 regression: reverts the assignment-LHS write gate — re-injects the exact pre-fix edges probe-verified on `self.n = 5` / `self.n += 1` (set->n, bump->n uses) — zig fixture forbids catch them",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "set", target: "n", confidence: 0.75, metadata: { relationshipType: "zig_field_access", evidenceClass: "usage_contextual" } }, { type: "uses", source: "bump", target: "n", confidence: 0.75, metadata: { relationshipType: "zig_field_access", evidenceClass: "usage_contextual" } }] }),
  },
  {
    id: "zig/leak-test-locals",
    language: "zig",
    defectClass: "symbol-fabrication",
    description: "ZGD3 regression: reverts the test/comptime executable-scope gate — re-injects the pre-fix file-scope Variable symbols the walk leaked from test bodies (local_only, compile_time_local) — fixture forbidSymbols catch them",
    transform: r => ({ ...r, symbols: [...(r.symbols ?? []), { name: "local_only", kind: "variable", visibility: "private", range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, metadata: {} }, { name: "compile_time_local", kind: "variable", visibility: "private", range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, metadata: {} }] }),
  },
  {
    id: "zig/fabricate-usingnamespace-call",
    language: "zig",
    defectClass: "relationship-fabrication",
    description: "ZGD4 regression: re-adds the bogus `calls -> usingnamespace` edge the grammar error-recovery could fabricate, and drops the usingnamespace import records — fixture forbid + expectImports catch both",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []).filter(x => !((x.metadata ?? {}).usingnamespace)), { type: "calls", source: "(global)", target: "usingnamespace", confidence: 0.85, metadata: { relationshipType: "zig_function_call" } }], imports: (r.imports ?? []).filter((i: any) => !(i.metadata ?? {}).usingnamespace) }),
  },
  {
    id: "zig/emit-type-position-uses",
    language: "zig",
    defectClass: "relationship-fabrication",
    description: "ZGD5b regression: reverts the type-position suppression — re-injects `uses qualifiedReturn->Writer` from the `w: io.Writer` annotation (probe-verified pre-fix edge) — fixture forbid catches it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "qualifiedReturn", target: "Writer", confidence: 0.75, metadata: { relationshipType: "zig_field_access", evidenceClass: "usage_contextual" } }] }),
  },
  {
    id: "zig/drop-import-reference",
    language: "zig",
    defectClass: "relationship-loss",
    description: "drops the @import references edge (zig_import, meta.isImport): the fixture pins that imports are first-class graph facts, not just entries in the imports array",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "zig_import") }),
  },
  {
    id: "zig/drop-symbol-complexity",
    language: "zig",
    defectClass: "payload-loss",
    description: "removes per-symbol cyclomatic complexity (the zig wave added it; go/rust/c/cpp already had it)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "java/mislabel-inheritance",
    language: "java",
    defectClass: "relationship-mislabel",
    description: "relabels every extends edge as implements (the exact multi-interface bug class reported by the owner)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => normRel(x).type === "extends" ? { ...x, type: "implements" } : x) }),
  },
  {
    id: "java/drop-method-symbols",
    language: "java",
    defectClass: "symbol-loss",
    description: "drops every method symbol",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => s.kind !== "method") }),
  },
  {
    id: "java/fqn-edge-drop",
    language: "java",
    defectClass: "edge-drop",
    description: "drops edges whose target contains a dot (FQN handling regression)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(normRel(x).target ?? "").includes(".")) }),
  },
  {
    id: "groovy/confidence-tamper",
    language: "groovy",
    defectClass: "confidence-dishonesty",
    description: "sets confidence 1.0 on every relationship (silent heuristic inflation, contract §4 violation)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => ({ ...x, confidence: 1 })) }),
  },
  {
    id: "groovy/segment-garbage",
    language: "groovy",
    defectClass: "relationship-garbage",
    description: "adds a bogus implements edge to package segment 'java' for every class",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), ...(r.symbols ?? []).filter(s => s.kind === "class").map(s => ({ type: "implements", source: s.name, target: "java", confidence: 1, metadata: {} }))] }),
  },
  {
    id: "javascript/drop-field-access",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "strips isFieldAccess uses edges (the collector-added feature)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isFieldAccess) }),
  },
  {
    id: "javascript/hide-jsdoc",
    language: "javascript",
    defectClass: "docstring-loss",
    description: "clears comments arrays (docstring-loss family)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, comments: [] })) }),
  },
  {
    id: "scala/write-as-read-leak",
    language: "scala",
    defectClass: "relationship-noise",
    description: "injects the SCD1 regression class: assignment LHS leaks as a uses edge (field-uses forbid pin: bump's pure += write must emit nothing)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "bump", target: "h", type: "uses", confidence: 0.9, metadata: { relationshipType: "expression_use", evidenceClass: "usage_contextual" } }] }),
  },
  {
    id: "scala/throw-target-garbage",
    language: "scala",
    defectClass: "relationship-noise",
    description: "injects the SCD4 regression class: throw references embed raw construction text with the message argument (throw-targets forbid pin)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "load", target: "new IllegalArgumentException(\"negative: \" + x)", type: "references", confidence: 0.9, metadata: { isThrow: true } }] }),
  },
  {
    id: "scala/abstract-members-loss",
    language: "scala",
    defectClass: "symbol-loss",
    description: "injects the SCD9 regression class: abstract trait fields (val_declaration/var_declaration) silently dropped — abstract-members expect pins must catch it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !(s.metadata?.isAbstract && (s.kind === "constant" || s.kind === "variable"))) }),
  },
  {
    id: "scala/enum-params-loss",
    language: "scala",
    defectClass: "symbol-loss",
    description: "injects the SCD6 regression class: enum constructor/property symbols dropped (enum-params expect pins)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !(s.kind === "constructor" && s.ownerName === "Planet")) }),
  },
  {
    id: "scala/enum-param-type-root-attribution",
    language: "scala",
    defectClass: "relationship-noise",
    description: "injects the SCD6 KAD6-twin: enum param type refs attributed to the root placeholder instead of the enum (enum-params forbid pin)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "root", target: "Double", type: "references", confidence: 0.95, metadata: { relationshipType: "declared_type", declaredOn: "class_parameter" } }] }),
  },
  {
    id: "scala/drop-given-refs",
    language: "scala",
    defectClass: "relationship-loss",
    description: "injects the SCD12 regression class: given definitions emit no type references (given_type edges dropped)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "given_type") }),
  },
  {
    id: "scala/text-substring-pattern-fabrication",
    language: "scala",
    defectClass: "metadata-fabrication",
    description: "injects the SCD5 regression class: text.includes substring pattern flags fabricated from unrelated identifiers (annotation-flags expectPatterns must catch the leak of the trap shape)",
    transform: r => {
      const md: any = { ...(r.metadata ?? {}), patterns: [...((r.metadata as any)?.patterns ?? []), "Annotations"] }
      return { ...r, metadata: md }
    },
  },
  {
    id: "scala/complexity-arm-double-count",
    language: "scala",
    defectClass: "metric-drift",
    description: "injects the SCD10 wrapper-double-count regression class: match/try/catch wrappers counted on top of arms (complexity-parity + f6-coverage-wave pins)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => (s.name === "f" || s.name === "raise" ? { ...s, complexity: (s.complexity ?? 1) + 1 } : s)) }),
  },
  {
    id: "scala/curried-qualified-calls-dup",
    language: "scala",
    defectClass: "payload-noise",
    description: "injects the SCD7 regression class: curried application wrappers double-push the qualified_calls path (SCD7 probe showed List.fill/self.add doubled pre-fix)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ((s as any).qualified_calls ? { ...s, qualified_calls: [...(s as any).qualified_calls, ...(s as any).qualified_calls] } : s)) }),
  },
  {
    id: "scala/drop-typeParameters",
    language: "scala",
    defectClass: "symbol-payload-loss",
    description: "strips genericParameters from every symbol (the #383c bug class)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => {
        const clean = { ...s, genericParameters: undefined }
        if (clean.metadata) { delete clean.metadata.typeParameters }
        return clean
      }) }),
  },
  {
    id: "scala/callee-method-value-leak",
    language: "scala",
    defectClass: "relationship-noise",
    description: "injects the M37 TSD6-sweep regression class: a dead call-position skip (n.parent.childForFieldName === n, never true for wrappers) leaks call callees as bogus method_value references — method-value-refs forbid pin must catch it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), ...(r.relationships ?? []).filter((x: any) => x.type === "calls").map((x: any) => ({ ...x, type: "references", metadata: { ...(x.metadata ?? {}), relationshipType: "method_value" } }))] }),
  },
  {
    id: "scala/drop-decorators",
    language: "scala",
    defectClass: "annotation-loss",
    description: "clears decorators from every symbol (annotation-driven detection regression)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, decorators: [] })) }),
  },
  {
    id: "scala/drop-docstrings",
    language: "scala",
    defectClass: "docstring-loss",
    description: "clears comments arrays (KDoc/ScalaDoc loss family)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, comments: [] })) }),
  },
  {
    id: "java/drop-declared-types",
    language: "java",
    defectClass: "relationship-loss",
    description: "drops all declared_type references (the silent type-usage-graph bug class fixed in M14)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "declared_type") }),
  },
  {
    id: "java/drop-initializer-calls",
    language: "java",
    defectClass: "relationship-loss",
    description: "drops Calls edges attributed to initializer/field-init/enum-body scopes (#419 G4 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).inInitializer) }),
  },
  {
    id: "java/drop-array-access",
    language: "java",
    defectClass: "relationship-loss",
    description: "drops Uses edges for array reads/writes (#419 G1 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isArrayAccess) }),
  },
  {
    id: "java/drop-ctor-delegation",
    language: "java",
    defectClass: "relationship-loss",
    description: "drops Calls edges for super()/this() constructor delegation (#419 G2 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "constructor_invocation") }),
  },
  {
    id: "java/drop-record-patterns",
    language: "java",
    defectClass: "relationship-loss",
    description: "drops References edges for record patterns (#419 G3 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "record_pattern") }),
  },
  {
    id: "java/emit-write-as-read",
    language: "java",
    defectClass: "fabrication",
    description: "regresses JAD1: assignment-LHS field/array writes emit uses edges (this.x = v -> uses x) — the write-as-read bug class",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "uses", source: "ArrayAccessUses", target: "xs", fromSymbol: "ArrayAccessUses", toSymbol: "xs", confidence: 0.6, metadata: { isFieldAccess: true },
      }],
    }),
  },
  {
    id: "java/type-sourced-member-reads",
    language: "java",
    defectClass: "relationship-loss",
    description: "regresses JAD2: member reads re-owned by the enclosing TYPE instead of the method (two walks, two owners) — f->xs pin dies",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map(x =>
        (x.metadata ?? {}).isArrayAccess && x.source === "f" ? { ...x, source: "ArrayAccessUses" } : x),
    }),
  },
  {
    id: "java/interface-methods-unexported",
    language: "java",
    defectClass: "symbol-loss",
    description: "regresses JAD3: implicit-public interface members excluded from exports (pre-fix visibility=undefined) — fetch must stay exported",
    transform: r => ({
      ...r,
      exports: (r.exports ?? []).filter((e: any) => !(e.name === "fetch" && e.kind === "method")),
    }),
  },
  {
    id: "java/drop-import-edges",
    language: "java",
    defectClass: "relationship-loss",
    description: "drops the imports dependency edges (isJavaImport references) — #419 section B imports pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isJavaImport) }),
  },
  {
    id: "java/drop-parameters",
    language: "java",
    defectClass: "payload-loss",
    description: "drops the parameters payload from method symbols — #383 Matrix 1b parameters pin (java cell PENDING -> #383)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "java/reclassify-import-tier",
    language: "java",
    defectClass: "evidence-mislabel",
    description: "reclassifies import edges from import_based back to reference_qualified (the JVM-family tier bug: classifier ignored isJavaImport)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.metadata ?? {}).isJavaImport ? { ...x, metadata: { ...x.metadata, evidenceClass: "reference_qualified" } } : x) }),
  },
  {
    id: "kotlin/drop-declared-types",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops declared_type/return_type/as/check references (silent type-usage-graph bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["declared_type", "return_type", "as_expression", "check_expression"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "kotlin/drop-expression-uses",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops expression-level Uses (the K1 indexing + K4 string-template bug class: xs[i] and \"hi $name\" reads were invisible before the #419 pass)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "expression_use")) }),
  },
  {
    id: "kotlin/drop-ctor-delegation",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops constructor_delegation_call edges (the K2 bug class: super(...)/this(...) delegation emitted no Calls)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "constructor_invocation")) }),
  },
  {
    id: "kotlin/drop-callable-refs",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops callable_reference type references (the K3 bug class: Foo::bar emitted no reference to Foo)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "callable_reference")) }),
  },
  {
    id: "kotlin/drop-type-alias-refs",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops type_alias RHS references (the K5 bug class: typealias Fn = (Int) -> String referenced nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "type_alias")) }),
  },
  {
    id: "kotlin/drop-type-alias-symbols",
    language: "kotlin",
    defectClass: "symbol-loss",
    description: "drops type_alias symbols (the K5 bug class: typealias declarations were completely invisible)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !s.metadata?.isTypeAlias) }),
  },
  {
    id: "kotlin/drop-anonymous-objects",
    language: "kotlin",
    defectClass: "symbol-loss",
    description: "drops anonymous object symbols (the K6 bug class: object : Runner { } had no symbol and misattributed go() to the enclosing class)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !s.metadata?.isAnonymousObject) }),
  },
  {
    id: "kotlin/drop-object-literal-refs",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops object_literal supertype references (the K6 bug class: anonymous objects referenced their implemented type nowhere)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "object_literal")) }),
  },
  {
    id: "kotlin/global-attribution",
    language: "kotlin",
    defectClass: "relationship-mislabel",
    description: "reverts class-level call attribution to the bogus Global placeholder (the K7 bug class: init blocks and property initializers attributed to Global)",
    transform: r => {
      const classNames = new Set((r.symbols ?? []).filter((s: any) => (s.kind === "class" || s.kind === "interface") && !s.ownerName).map((s: any) => s.name))
      return { ...r, relationships: (r.relationships ?? []).map((x: any) => (x.metadata ?? {}).kotlinSpecific && classNames.has(x.source) ? { ...x, source: "Global" } : x) }
    },
  },
  {
    id: "kotlin/reclassify-import-tier",
    language: "kotlin",
    defectClass: "evidence-mislabel",
    description: "reclassifies import edges from import_based back to reference_qualified (the K8 JVM-family tier bug: classifier ignored isImportDep)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.metadata ?? {}).isImportDep ? { ...x, metadata: { ...x.metadata, evidenceClass: "reference_qualified" } } : x) }),
  },
  {
    id: "kotlin/drop-instantiates",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops Instantiates edges (pins the Matrix 1b instantiates cell — kotlin has no 'new' keyword; Widget() is the construction heuristic)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => String(x.type ?? x.relationshipType) !== "instantiates") }),
  },
  {
    id: "kotlin/strip-parameters",
    language: "kotlin",
    defectClass: "symbol-payload-loss",
    description: "strips the parameters payload from every symbol (pins the Matrix 1b parameters cell for kotlin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "kotlin/strip-visibility",
    language: "kotlin",
    defectClass: "symbol-payload-loss",
    description: "flattens every symbol to public visibility (pins the Matrix 1b visibility cell for kotlin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, visibility: "public" })) }),
  },
  {
    id: "kotlin/clear-comments",
    language: "kotlin",
    defectClass: "docstring-loss",
    description: "clears comments arrays (pins the Matrix 1b docstrings cell for kotlin — the M14.1 KDoc fix)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, comments: [] })) }),
  },
  {
    id: "kotlin/write-as-read-uses",
    language: "kotlin",
    defectClass: "relationship-noise",
    description: "injects the KAD1 regression class: assignment-LHS indexing leaks a uses edge for the receiver (pre-fix `xs[i] = 42` emitted uses; oracle derives no kotlin uses truth so F5 is blind)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), ...(r.relationships ?? []).filter((x: any) => x.metadata?.relationshipType === "expression_use").map((x: any) => ({ ...x, source: "write" }))] }),
  },
  {
    id: "kotlin/kdoc-contamination",
    language: "kotlin",
    defectClass: "docstring-misattribution",
    description: "injects the KAD2 regression class: the first doc leaks onto every subsequent doc-less declaration (dead `sibling === node` forward scan)",
    transform: r => {
      const firstDoc = (r.symbols ?? []).find((s: any) => (s.comments ?? []).length > 0)?.comments?.[0]
      if (!firstDoc) return r
      return { ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, comments: [firstDoc] })) }
    },
  },
  {
    id: "kotlin/accessor-text-fallback",
    language: "kotlin",
    defectClass: "payload-fabrication",
    description: "injects the KAD4 regression class: text-based metadata flags (get()/set(/by substring) fabricate hasCustomGetter/hasCustomSetter/hasDelegate)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => s.kind === "property" ? { ...s, metadata: { ...(s.metadata ?? {}), hasCustomGetter: true, hasCustomSetter: true, hasDelegate: true } } : s) }),
  },
  {
    id: "kotlin/receiver-ref-loss",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "injects the KAD3 regression class: extension-receiver types emit no reference (the user_type-only walk was dead against receiver_type wrappers)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.source === "shout" && x.target === "String" && x.metadata?.relationshipType === "declared_type")) }),
  },
  {
    id: "kotlin/return-type-global",
    language: "kotlin",
    defectClass: "relationship-mislabel",
    description: "injects the KAD6 regression class: declaration-position references sourced to the Global placeholder (pre-fix top-level return types)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => x.source === "m" && x.metadata?.relationshipType === "return_type" ? { ...x, source: "Global" } : x) }),
  },
  {
    id: "java/javadoc-leak",
    language: "java",
    defectClass: "docstring-misattribution",
    description: "injects the KAD2-sweep regression class: the first javadoc leaks onto every subsequent declaration (dead `sibling === node` forward scan)",
    transform: r => {
      const firstDoc = (r.symbols ?? []).find((s: any) => (s.comments ?? []).length > 0)?.comments?.[0]
      if (!firstDoc) return r
      return { ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, comments: [firstDoc] })) }
    },
  },
  {
    id: "groovy/groovydoc-leak",
    language: "groovy",
    defectClass: "docstring-misattribution",
    description: "injects the KAD2-sweep regression class: first-GroovyDoc leak onto doc-less declarations",
    transform: r => {
      const firstDoc = (r.symbols ?? []).find((s: any) => (s.comments ?? []).length > 0)?.comments?.[0]
      if (!firstDoc) return r
      return { ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, comments: [firstDoc] })) }
    },
  },
  {
    id: "scala/scaladoc-leak",
    language: "scala",
    defectClass: "docstring-misattribution",
    description: "injects the KAD2-sweep regression class: first-ScalaDoc leak onto doc-less declarations",
    transform: r => {
      const firstDoc = (r.symbols ?? []).find((s: any) => (s.comments ?? []).length > 0)?.comments?.[0]
      if (!firstDoc) return r
      return { ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, comments: [firstDoc] })) }
    },
  },
  {
    id: "groovy/read-attribution-to-receiver",
    language: "groovy",
    defectClass: "attribution-corruption",
    description: "GAD1 regression: reverts JAD2 method-scope attribution — field reads source to the receiver variable (cfg.limit -> uses cfg) — groovy field-read attribution pins catch it",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "uses", source: "cfg", target: "limit", isExternal: true, weight: 1, confidence: 0.6, metadata: { isFieldAccess: true },
      }],
    }),
  },
  {
    id: "groovy/script-sentinel-split",
    language: "groovy",
    defectClass: "attribution-corruption",
    description: "GAD2 regression: re-splits script sentinels — instantiates under global/ root instead of (script) — script-methods pins catch it",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "instantiates", source: "global", target: "Deployer", isExternal: true, weight: 1, confidence: 0.95, metadata: { relationshipType: "instantiates", isNew: true },
      }],
    }),
  },
  {
    id: "groovy/text-visibility-fabrication",
    language: "groovy",
    defectClass: "payload-corruption",
    description: "GAD3 regression: re-adds raw-text substring visibility (leak() fabricates private from a string literal) — visibility pin catches it",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map(s => s.name === "leak" ? { ...s, visibility: "private" } : s),
    }),
  },
  {
    id: "groovy/keyword-modifiers-blind",
    language: "groovy",
    defectClass: "payload-loss",
    description: "GAD6 regression: modifiers node iterates named children only — keyword-only declarations lose isStatic/isConstant/private (hidden() flips public) — visibility pins catch it",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map(s => s.name === "hidden" ? { ...s, visibility: "public" } : s),
    }),
  },
  {
    id: "groovy/modifier-return-type-loss",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "GAD5 regression: return-type collection breaks on modifiers — public String greet() loses its return_type ref — script-methods/type-usage pin catches it",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).filter(x => !((x.metadata ?? {}).relationshipType === "return_type" && x.source === "greet")),
    }),
  },
  {
    id: "groovy/array-write-uses",
    language: "groovy",
    defectClass: "relationship-noise",
    description: "injects the KAD1-sweep regression class: assignment-LHS array_access leaks a uses edge (the pre-fix emission the old fixture pinned as Groovy semantics)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), ...(r.relationships ?? []).filter((x: any) => x.metadata?.isArrayAccess).map((x: any) => ({ ...x, source: "store" }))] }),
  },
  {
    id: "groovy/return-type-mislabel",
    language: "groovy",
    defectClass: "relationship-mislabel",
    description: "injects the KAD6-sweep regression class: return-type refs revert to declared_type and re-source to the enclosing class",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => x.metadata?.relationshipType === "return_type" ? { ...x, source: "TypeGraph", metadata: { ...x.metadata, relationshipType: "declared_type" } } : x) }),
  },
  {
    id: "groovy/drop-declared-types",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops declared_type/throws_type references (silent type-usage-graph bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["declared_type", "throws_type", "instanceof_expression"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "scala/drop-declared-types",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops declared_type/throws/cast/check references (silent type-usage-graph bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["declared_type", "return_type", "throws_type", "cast_target", "instanceof_check"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "scala/reclassify-import-tier",
    language: "scala",
    defectClass: "tier-misclassification",
    description: "reverts import edges to the old reference_qualified tier (the JVM-family isImportDep bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => x.metadata?.isImportDep ? { ...x, metadata: { ...x.metadata, isImportDep: undefined, evidenceClass: "reference_qualified" } } : x) }),
  },
  {
    id: "scala/drop-import-source-rewrite",
    language: "scala",
    defectClass: "relationship-loss",
    description: "reverts the import source rewrite to the root placeholder (G1 half 2)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => x.metadata?.isImportDep && x.source !== "root" ? { ...x, source: "root" } : x) }),
  },
  {
    id: "scala/drop-pattern-refs",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops typed_pattern/case_class_pattern references (pattern-match type-usage gap)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "pattern_type") }),
  },
  {
    id: "scala/drop-method-value-refs",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops method_value references (Foo.bar loses its Foo ref)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "method_value") }),
  },
  {
    id: "scala/drop-expression-uses",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops uses edges (interpolation + field-access Uses gap)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.type !== "uses") }),
  },
  {
    id: "scala/drop-tuple-refs",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops return_type refs whose function returns a tuple_type (G5)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "return_type" && x.metadata?.declaredOn === "function_definition" && ["pair", "both"].includes(String(x.source)))) }),
  },
  {
    id: "scala/drop-derives-refs",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops derives_type references (derives Show/Hashing gap)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "derives_type") }),
  },
  {
    id: "scala/drop-type-alias-refs",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops type_alias references (type X = ... RHS types gap)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "type_alias") }),
  },
  {
    id: "scala/drop-self-type-ref",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops self_type references (self: Service => gap)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "self_type") }),
  },
  {
    id: "scala/drop-parameters",
    language: "scala",
    defectClass: "payload-loss",
    description: "drops the parameters payload from method symbols — #383 Matrix 1b parameters pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "typescript/drop-declared-types",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops declared_type/return_type/cast/check references (silent type-usage-graph bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["declared_type", "return_type", "cast_target", "instanceof_check"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "javascript/drop-instanceof-refs",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops instanceof_check references (JS's only unambiguous named-type usage)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "instanceof_check") }),
  },
  {
    id: "javascript/reintroduce-receiver-source",
    language: "javascript",
    defectClass: "relationship-garbage",
    description: "reverts JSD2: member reads source to the receiver variable again (cfg.limit -> cfg, a non-symbol the graph/LSP can never connect; the JAD2 class from the java wave)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "svc", target: "fetch", confidence: 0.6, metadata: { isFieldAccess: true } }] }),
  },
  {
    id: "javascript/reintroduce-module-write-uses",
    language: "javascript",
    defectClass: "relationship-garbage",
    description: "reverts JSD1: CJS deep-export writes emit uses again (module.exports.tag = 1 -> uses module -> exports/uses module -> tag)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "module", target: "exports", confidence: 0.6, metadata: { isFieldAccess: true } }, { type: "uses", source: "module", target: "tag", confidence: 0.6, metadata: { isFieldAccess: true } }] }),
  },
  {
    id: "python/drop-declared-types",
    language: "python",
    defectClass: "relationship-loss",
    description: "drops declared_type/return_type/isinstance references (silent type-usage-graph bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["declared_type", "return_type", "instanceof_check"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "go/drop-declared-types",
    language: "go",
    defectClass: "relationship-loss",
    description: "drops declared_type/return_type references (silent type-usage-graph bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["declared_type", "return_type"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "typescript/double-emit-type-args",
    language: "typescript",
    defectClass: "relationship-fabrication",
    description: "SCD7 regression: removes the type_annotation guard on type_arguments so Map<String, Foo> re-emits String/Foo as type_argument — local->String count equals:1 catches it",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "references", source: "local", target: "String", isExternal: true, weight: 0.8, confidence: 1.0, metadata: { relationshipType: "type_argument", evidenceClass: "reference_qualified" },
      }, {
        type: "references", source: "local", target: "Foo", isExternal: true, weight: 0.8, confidence: 1.0, metadata: { relationshipType: "type_argument", evidenceClass: "reference_qualified" },
      }],
    }),
  },
  {
    id: "typescript/drop-qualified-calls",
    language: "typescript",
    defectClass: "symbol-payload-loss",
    description: "strips qualified_calls from every symbol (the isKotlinBuiltin bug class)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, qualified_calls: [] })) }),
  },
  {
    id: "typescript/hide-jsdoc",
    language: "typescript",
    defectClass: "docstring-loss",
    description: "clears comments arrays (kotlin KDoc bug class)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, comments: [] })) }),
  },
  {
    id: "typescript/swap-heritage-labels",
    language: "typescript",
    defectClass: "relationship-mislabel",
    description: "swaps extends <-> implements labels on heritage edges",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => {
      const t = x.type ?? x.relationshipType;
      if (t === "extends") return { ...x, type: "implements" };
      if (t === "implements") return { ...x, type: "extends" };
      return x;
    }) }),
  },
  {
    id: "typescript/reclassify-import-tier",
    language: "typescript",
    defectClass: "evidence-mislabel",
    description: "reclassifies the imports kind from import_based back to usage_contextual (the T1 bug class: classifier's isImport branch never fired for the dedicated imports kind)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => String(x.type ?? x.relationshipType) === "imports" ? { ...x, metadata: { ...(x.metadata ?? {}), evidenceClass: "usage_contextual" } } : x) }),
  },
  {
    id: "typescript/drop-import-edges",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops the imports dependency edges entirely (the T7 bug class: dynamic import('./lazy') landed in the imports array but emitted no edge)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => String(x.type ?? x.relationshipType) !== "imports") }),
  },
  {
    id: "typescript/drop-type-alias-refs",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops type_alias RHS references (the T2 bug class: type Fn = (a: Id) => Id referenced nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "type_alias") }),
  },
  {
    id: "typescript/drop-expression-uses",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops expression-level Uses (the T3 template-interpolation + T4 field-access bug classes: `got ${x}` and this.h.value reads emitted no Uses)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.isTemplateInterpolation || x.metadata?.isFieldAccess)) }),
  },
  {
    id: "typescript/drop-satisfies-refs",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops satisfies_target references (the T5 bug class: cfg satisfies Config referenced nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "satisfies_target") }),
  },
  {
    id: "typescript/reintroduce-shadowed-false-refs",
    language: "typescript",
    defectClass: "relationship-garbage",
    description: "re-adds the scope-blind false reference from functions to property symbols (the T6 bug class: const { name } = u emitted main -> User.name)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), ...(r.symbols ?? []).filter((s: any) => s.kind === "function").flatMap((s: any) => (r.symbols ?? []).filter((t: any) => !!t.ownerName && t.kind !== "function" && t.kind !== "class" && t.kind !== "interface").map((t: any) => ({ type: "references", source: s.name, target: t.name, confidence: 1, metadata: {} })))] }),
  },
  {
    id: "typescript/drop-cast-assertion-refs",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops cast_target references from angle-bracket type_assertions only (the T8 bug class: <Foo>x referenced nothing while as Foo worked)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "cast_target" && (x.source ?? "") !== (x.target ?? ""))) }),
  },
  {
    id: "typescript/drop-type-argument-refs",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops type_argument references (the T9 bug class: f<Baz>(x) referenced nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "type_argument") }),
  },
  {
    id: "typescript/drop-override-edges",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops overrides edges (section B overrides pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => String(x.type ?? x.relationshipType) !== "overrides") }),
  },
  {
    id: "typescript/drop-exports-edges",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops exports edges (section B exports pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => String(x.type ?? x.relationshipType) !== "exports") }),
  },
  {
    id: "typescript/drop-visibility",
    language: "typescript",
    defectClass: "payload-loss",
    description: "drops the visibility payload from symbols (section C visibility pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, visibility: undefined })) }),
  },
  {
    id: "typescript/drop-parameters",
    language: "typescript",
    defectClass: "payload-loss",
    description: "drops the parameters payload from method symbols (section C parameters pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "typescript/drop-type-parameters",
    language: "typescript",
    defectClass: "payload-loss",
    description: "drops the typeParameters payload from symbols (section C typeParameters pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, genericParameters: undefined })) }),
  },
  {
    id: "typescript/reintroduce-write-as-read",
    language: "typescript",
    defectClass: "relationship-garbage",
    description: "reverts the TSD1 write gate: assignment-LHS member writes emit uses again (this.count = 0 -> uses count; the JAD1 class from the java wave)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "write", target: "value", confidence: 0.85, metadata: { isFieldAccess: true } }] }),
  },
  {
    id: "typescript/reintroduce-script-placeholder",
    language: "typescript",
    defectClass: "relationship-garbage",
    description: "reverts TSD4: top-level calls source to the '(script)' placeholder again (no consumer can resolve it; the module leaf is the contract)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.type === "calls" && x.source === "instantiation-refs" && x.target === "wrap") ? { ...x, source: "(script)" } : x) }),
  },
  {
    id: "typescript/reintroduce-qualified-new",
    language: "typescript",
    defectClass: "relationship-garbage",
    description: "reverts TSD3: new ns.Thing() emits the full 'ns.Thing' target instead of the leaf (violates the leaf-identity contract; JS parity reduces to Thing)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "instantiates", source: "make", target: "ns.Thing", confidence: 1, metadata: {} }] }),
  },
  {
    id: "javascript/reclassify-import-tier",
    language: "javascript",
    defectClass: "evidence-mislabel",
    description: "reclassifies the imports kind from import_based back to usage_contextual (the J1 bug class: classifier had no 'imports' branch)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => String(x.type ?? x.relationshipType) === "imports" ? { ...x, metadata: { ...(x.metadata ?? {}), evidenceClass: "usage_contextual" } } : x) }),
  },
  {
    id: "javascript/drop-import-edges",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops ALL imports dependency edges (the J1/J2 bug class: ES6, require, and dynamic import() dependencies)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => String(x.type ?? x.relationshipType) !== "imports") }),
  },
  {
    id: "javascript/drop-template-uses",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops template-interpolation Uses (the J3 bug class: `hi ${name}` reads were invisible)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isTemplateInterpolation) }),
  },
  {
    id: "javascript/reintroduce-callee-uses",
    language: "javascript",
    defectClass: "relationship-garbage",
    description: "re-adds the call-callee double-emission: uses edges for every member call (the J4 bug class: svc.fetch() emitted calls AND uses)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), ...(r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) === "calls" && typeof (x.metadata ?? {}).calleeExpression === "string" && (x.metadata.calleeExpression).includes(".")).map((x: any) => { const parts = (x.metadata.calleeExpression).split("."); return { type: "uses", source: parts[0], target: parts[parts.length - 1], confidence: 0.6, metadata: { isFieldAccess: true } } })] }),
  },
  {
    id: "javascript/drop-static-calls",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops calls attributed to class scope (the J5 bug class: static-block and field-initializer calls)",
    transform: r => {
      const classNames = new Set((r.symbols ?? []).filter((s: any) => s.kind === "class" && !s.ownerName).map((s: any) => s.name))
      return { ...r, relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type ?? x.relationshipType) === "calls" && classNames.has(x.source))) }
    },
  },
  {
    id: "javascript/global-instanceof-source",
    language: "javascript",
    defectClass: "relationship-mislabel",
    description: "reverts instanceof reference sources to the global placeholder (the J6 bug class: top-level consts attributed to global)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.metadata ?? {}).relationshipType === "instanceof_check" ? { ...x, source: "global" } : x) }),
  },
  {
    id: "javascript/drop-destructure-symbols",
    language: "javascript",
    defectClass: "symbol-loss",
    description: "drops module-level destructured binding symbols (the J7 bug class: const { a } = obj emitted nothing)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !(s.metadata ?? {}).isDestructured) }),
  },
  {
    id: "javascript/drop-jsx-uses",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops JSX component Uses edges (the J8 bug class: <Button/> emitted nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.metadata ?? {}).jsxElement) }),
  },
  {
    id: "javascript/drop-override-edges",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops overrides edges (section B overrides pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "overrides") }),
  },
  {
    id: "javascript/drop-instantiates-edges",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops instantiates edges (section B instantiates pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "instantiates") }),
  },
  {
    id: "javascript/drop-visibility",
    language: "javascript",
    defectClass: "payload-loss",
    description: "drops the visibility payload from symbols (section C visibility pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, visibility: undefined })) }),
  },
  {
    id: "javascript/drop-parameters",
    language: "javascript",
    defectClass: "payload-loss",
    description: "drops the parameters payload from function/method symbols (section C parameters pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "vue/drop-generic-macro-symbols",
    language: "vue",
    defectClass: "symbol-loss",
    description: "drops prop/event symbols from the type-literal generic macro form (the V1 bug class: defineProps<{ id: string }>() emitted nothing)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !((s.metadata ?? {}).isProp || (s.metadata ?? {}).isEmit)) }),
  },
  {
    id: "vue/drop-template-member-uses",
    language: "vue",
    defectClass: "relationship-loss",
    description: "drops template-expression Uses edges (the V2 bug class: {{ count }}, :label, @click emitted nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.metadata ?? {}).isTemplateExpression) }),
  },
  {
    id: "vue/reduplicate-contains",
    language: "vue",
    defectClass: "relationship-duplication",
    description: "re-adds duplicate contains edges for script-side class members (the V3 bug class: sub-analyzer contains + vue pass = 2x)",
    transform: r => {
      const rels = r.relationships ?? []
      const dupes = rels.filter((x: any) => String(x.type ?? x.relationshipType) === "contains" && (x.metadata ?? {}).evidenceClass === "structural")
      return { ...r, relationships: [...rels, ...dupes] }
    },
  },
  {
    id: "vue/drop-contains-edges",
    language: "vue",
    defectClass: "relationship-loss",
    description: "drops all contains edges (section B contains pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "contains") }),
  },
  {
    id: "vue/drop-import-edges",
    language: "vue",
    defectClass: "relationship-loss",
    description: "drops imports edges (section B imports pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "imports") }),
  },
  {
    id: "vue/drop-complexity",
    language: "vue",
    defectClass: "payload-loss",
    description: "zeroes the complexity payload on script functions (section C complexity pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "vue/drop-visibility",
    language: "vue",
    defectClass: "payload-loss",
    description: "drops the visibility payload from symbols (section C visibility pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, visibility: undefined })) }),
  },
  {
    id: "vue/drop-parameters",
    language: "vue",
    defectClass: "payload-loss",
    description: "drops the parameters payload from function symbols (section C parameters pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "vue/reemit-shadowed-uses",
    language: "vue",
    defectClass: "scope-blindness",
    description: "re-emits Uses for template-LOCAL identifiers that shadow members (the V4 bug class: v-for loop vars and slot props produced false uses)",
    transform: r => {
      const rels = r.relationships ?? []
      const comp = rels.find((x: any) => x.type === "instantiates" || x.type === "uses")?.source
      const source = typeof comp === "string" ? comp : "template-scope-shadow"
      const extra = ["item", "row"].map(name => ({
        source, target: name, type: "uses", confidence: 0.95,
        metadata: { isTemplateExpression: true },
      }))
      return { ...r, relationships: [...rels, ...extra] }
    },
  },
  {
    id: "vue/drop-union-emit-names",
    language: "vue",
    defectClass: "symbol-loss",
    description: "drops non-first union emit names (the V1b bug class: (e: 'save' | 'close') kept only save)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !((s.metadata ?? {}).isEmit && s.name === "close")) }),
  },
  {
    id: "svelte/drop-template-member-uses",
    language: "svelte",
    defectClass: "relationship-loss",
    description: "drops template-expression Uses edges (the S1 bug class: {count}, label={label}, {#each items} emitted nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.metadata ?? {}).isTemplateExpression) }),
  },
  {
    id: "svelte/reemit-shadowed-uses",
    language: "svelte",
    defectClass: "scope-blindness",
    description: "re-emits Uses for template-LOCAL identifiers (the vue V4 bug class: each loop vars and await then/catch vars produced false uses)",
    transform: r => {
      const rels = r.relationships ?? []
      const source = (rels.find((x: any) => x.type === "instantiates" || x.type === "uses")?.source) || "template-member-uses"
      const extra = ["row", "i", "value", "err"].map(name => ({
        source, target: name, type: "uses", confidence: 0.95,
        metadata: { isTemplateExpression: true },
      }))
      return { ...r, relationships: [...rels, ...extra] }
    },
  },
  {
    id: "svelte/reduplicate-rune-props",
    language: "svelte",
    defectClass: "symbol-duplication",
    description: "re-adds the JS sub-analyzer's destructured Variables for $props() bindings (the S2 bug class: let { a } = $props() declared a twice)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (s.metadata ?? {}).isSvelteProp ? { ...s, name: undefined } : s).filter((s: any) => s.name !== undefined).concat((r.symbols ?? []).filter((s: any) => (s.metadata ?? {}).isSvelteProp).map((s: any) => ({ ...s, name: s.name + "", kind: "variable", ownerName: undefined, metadata: { ...s.metadata, isSvelteProp: undefined, fromRunes: undefined, isDestructured: true } }))) }),
  },
  {
    id: "svelte/drop-overrides-edges",
    language: "svelte",
    defectClass: "relationship-loss",
    description: "drops overrides edges (section B overrides pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "overrides") }),
  },
  {
    id: "svelte/drop-references-edges",
    language: "svelte",
    defectClass: "relationship-loss",
    description: "drops references edges (section B references pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "references") }),
  },
  {
    id: "svelte/drop-uses-edges",
    language: "svelte",
    defectClass: "relationship-loss",
    description: "drops uses edges incl. template-expression uses (section B uses pin + S1)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "uses") }),
  },
  {
    id: "svelte/drop-parameters",
    language: "svelte",
    defectClass: "payload-loss",
    description: "drops the parameters payload from function symbols (section C parameters pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "svelte/drop-visibility",
    language: "svelte",
    defectClass: "payload-loss",
    description: "drops the visibility payload from symbols (section C visibility pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, visibility: undefined })) }),
  },
  {
    id: "svelte/reemit-shadowed-member-uses",
    language: "svelte",
    defectClass: "scope-blindness",
    description: "re-emits Uses for each-loop / {@const} bindings that collide with a SAME-NAMED MEMBER (the S5 bug class: {#each rows as row} or {@const total = r.id} leaked fake uses -> member row/item/total)",
    transform: r => {
      const rels = r.relationships || []
      const source = (rels.find((x: any) => x.type === "instantiates" || x.type === "uses")?.source) || "each-shadow-collision"
      const extra = ["row", "item", "total"].map(name => ({
        source, target: name, type: "uses", confidence: 0.95,
        metadata: { isTemplateExpression: true },
      }))
      return { ...r, relationships: [...rels, ...extra] }
    },
  },
  {
    id: "svelte/reduplicate-reactive-targets",
    language: "svelte",
    defectClass: "symbol-duplication",
    description: "re-adds duplicate symbols for $: reactive targets (the S6 bug class: the same variable assigned from multiple $: blocks declared once PER BLOCK)",
    transform: r => ({
      ...r,
      symbols: [
        ...(r.symbols ?? []),
        ...(r.symbols ?? []).filter((s: any) => (s.metadata ?? {}).isReactiveDeclaration).map((s: any) => ({ ...s })),
      ],
    }),
  },
  {
    id: "groovy/drop-class-symbols",
    language: "groovy",
    defectClass: "symbol-loss",
    description: "drops every class symbol",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => s.kind !== "class") }),
  },
  {
    id: "groovy/drop-array-access",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops Uses edges for array reads/writes (#419 groovy G1 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isArrayAccess) }),
  },
  {
    id: "groovy/drop-ctor-delegation",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops Calls edges for super()/this() constructor delegation (#419 groovy G2 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "constructor_invocation") }),
  },
  {
    id: "groovy/drop-pattern-refs",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops pattern type references (instanceof + switch case) (#419 groovy G3 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["instanceof_expression", "case_pattern"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "groovy/drop-method-refs",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops method_reference type edges (Foo::bar) (#419 groovy G4 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "method_reference") }),
  },
  {
    id: "groovy/drop-cast-types",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops cast_expression type edges ((String) o) (#419 groovy G5 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "cast_type") }),
  },
  {
    id: "groovy/drop-record-symbols",
    language: "groovy",
    defectClass: "symbol-loss",
    description: "drops record class symbols and record components (#419 groovy G6 bug class)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !((s.metadata ?? {}).isRecord || (s.metadata ?? {}).nodeType === "record_component")) }),
  },
  {
    id: "groovy/drop-annotation-types",
    language: "groovy",
    defectClass: "symbol-loss",
    description: "drops annotation_type_declaration symbols (#419 groovy G7 bug class)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => (s.metadata ?? {}).nodeType !== "annotation_type_declaration") }),
  },
  {
    id: "groovy/drop-import-edges",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops the imports dependency edges (isGroovyImport references) — #419 groovy G8 imports pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isGroovyImport) }),
  },
  {
    id: "groovy/drop-wildcard-flag",
    language: "groovy",
    defectClass: "metadata-loss",
    description: "clears isWildcard on import edges (wildcard imports lose the flag — groovy G8 companion bug)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.metadata ?? {}).isGroovyImport ? { ...x, metadata: { ...x.metadata, isWildcard: false } } : x) }),
  },
  {
    id: "groovy/drop-parameters",
    language: "groovy",
    defectClass: "payload-loss",
    description: "drops the parameters payload from method symbols — #383 Matrix 1b parameters pin (groovy cell PENDING -> #383)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "groovy/drop-varargs-type",
    language: "groovy",
    defectClass: "payload-loss",
    description: "drops the [] erasure suffix and name fix on varargs parameters (String... parts back to anonymous/String)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: (s.parameters ?? []).map((p: any) => ({ ...p, name: p.name === "parts" ? "anonymous" : p.name, type: p.type === "String[]" ? "String" : p.type })) })) }),
  },
  {
    id: "groovy/drop-contains-edges",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops contains edges for type/member/field containment — #419 groovy section B contains pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.type !== "contains") }),
  },
  {
    id: "csharp/drop-field-access-uses",
    language: "csharp",
    defectClass: "relationship-loss",
    description: "drops csharp field-access Uses edges — #264 section B uses pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => (x.metadata ?? {}).relationshipType !== "csharp_field_access") }),
  },
  {
    id: "csharp/emit-write-as-read",
    language: "csharp",
    defectClass: "relationship-fabrication",
    description: "SCD1 regression: removes the field-access assignment-LHS write gate — re-injects the exact pre-fix edges probe-verified on pure/compound writes to this.Name (Reset->Name uses) — csharp Reset forbid catches it",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "uses", source: "Reset", target: "Name", isExternal: true, weight: 1, confidence: 0.7, metadata: { relationshipType: "csharp_field_access" },
      }],
    }),
  },
  {
    id: "csharp/drop-symbol-complexity",
    language: "csharp",
    defectClass: "payload-loss",
    description: "drops csharp per-symbol complexity — #264 section C complexity pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "csharp/drop-implements-edge",
    language: "csharp",
    defectClass: "relationship-loss",
    description: "drops csharp implements edges (Shape->IShape) — #264 section B implements pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "implements") }),
  },
  {
    id: "csharp/callee-field-access-leak",
    language: "csharp",
    defectClass: "relationship-noise",
    description: "injects the M37 TSD6-sweep regression class: a dead callee-identity skip (fn === node, never true for web-tree-sitter wrappers) leaks call-position member_access as bogus csharp_field_access uses — payload-and-complexity forbid pins must catch it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), ...(r.relationships ?? []).filter((x: any) => x.type === "calls").map((x: any) => ({ ...x, type: "uses", metadata: { ...(x.metadata ?? {}), relationshipType: "csharp_field_access" } }))] }),
  },
  {
    id: "csharp/ctor-initializer-loss",
    language: "csharp",
    defectClass: "relationship-loss",
    description: "drops CSD8 constructor-initializer calls — re-review pin calls:constructor->this",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isConstructorInitializer)) }),
  },
  {
    id: "csharp/operator-name-collapse",
    language: "csharp",
    defectClass: "payload-loss",
    description: "injects the CSD3 regression class: operator overloads collapse to the literal name 'operator' — fixture pins operator + and operator int symbols",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (s.metadata ?? {}).isOperatorOverload ? { ...s, name: "operator" } : s) }),
  },
  {
    id: "csharp/drop-accessor-events",
    language: "csharp",
    defectClass: "symbol-loss",
    description: "drops CSD5 accessor-form event symbols (F6Overflow) — re-review symbol pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !((s.metadata ?? {}).isAccessorForm)) }),
  },
  {
    id: "csharp/switch-arm-complexity-loss",
    language: "csharp",
    defectClass: "payload-loss",
    description: "injects the CSD2 regression class: switch-expression arms no longer count (Pick drops from 4 to 1) — fixture complexity pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => s.name === "Pick" ? { ...s, complexity: 1 } : s) }),
  },
  {
    id: "csharp/filescoped-fqn-loss",
    language: "csharp",
    defectClass: "fabrication",
    description: "injects the CSD1/CSD9 regression class: file-scoped namespace qualification lost AND primary-base argument lists leak as implements targets — fixture forbids implements:F6Derived->(\"seed\", 1)",
    transform: r => ({ ...r, relationships: [
      ...(r.relationships ?? []).map((x: any) => x.type === "implements" && x.target === "IShape" ? { ...x, source: "Shape" } : x),
      { type: "implements", source: "F6Derived", target: "(\"seed\", 1)", fromSymbol: "F6Derived", toSymbol: "(\"seed\", 1)", confidence: 1.0, metadata: { isImplements: true } },
    ] }),
  },
  {
    id: "csharp/implicit-new-assignment-loss",
    language: "csharp",
    defectClass: "relationship-loss",
    description: "injects the CSD11 regression class: assignment-form target-typed new() drops its instantiates (the constructor->Dictionary edge vanishes) — fixture instantiates pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isImplicit && x.source === "constructor")) }),
  },
  {
    id: "csharp/iface-base-extends-fabrication",
    language: "csharp",
    defectClass: "fabrication",
    description: "injects the CSD12 regression class: interface-only external base lists fabricate extends again (F6Tank/F6Handle -> IDisposable become extends) — fixture forbids extends:F6Tank->IDisposable",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => x.type === "implements" && x.target === "IDisposable" ? { ...x, type: "extends", metadata: { ...x.metadata, isImplements: false } } : x) }),
  },
  {
    id: "dart/drop-implements-edge",
    language: "dart",
    defectClass: "relationship-loss",
    description: "drops dart implements edges (OrderRepositoryImpl->OrderRepository) — dart section B implements pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "implements") }),
  },
  {
    id: "dart/drop-mixin-uses-edge",
    language: "dart",
    defectClass: "relationship-loss",
    description: "drops dart mixin uses edges (with RepositoryLogger) — dart section B uses pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isMixin && x.type === "uses")) }),
  },
  {
    id: "dart/drop-constructor-instantiates",
    language: "dart",
    defectClass: "relationship-loss",
    description: "drops dart constructor-invocation instantiates edges (OrderLoading etc.) — dart section B instantiates pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "instantiates") }),
  },
  {
    id: "dart/heritage-alias-not-resolved",
    language: "dart",
    defectClass: "misattribution",
    description: "reverts DAD1: emits the import-alias prefix (_iDart) as the extends target instead of the resolved leaf (FakeBase) — fixture pins extends:F6MockClient->FakeBase and forbids extends->_iDart",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => x.type === "extends" && x.target === "FakeBase" ? { ...x, target: "_iDart" } : x) }),
  },
  {
    id: "dart/implements-alias-leak",
    language: "dart",
    defectClass: "fabrication",
    description: "reverts DAD2: leaks the import-alias containers (_iIo/_iAsync) as implements targets alongside the resolved names — fixture forbids implements->_iIo and implements->_iAsync",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).concat([
      { source: "F6MockClient", target: "_iIo", type: "implements", confidence: 1.0, metadata: { isImplements: true } },
      { source: "F6MockClient", target: "_iAsync", type: "implements", confidence: 1.0, metadata: { isImplements: true } },
    ]) }),
  },
  {
    id: "dart/dup-rows-reintroduced",
    language: "dart",
    defectClass: "payload-noise",
    description: "reverts DARTD7: per-site call/instantiates emission with no dedup (each calls/instantiates row doubled) — dedup-and-attribution expectRelationshipCount equals:1 pins (instantiates IconSet->IconData, calls build->make)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).concat((r.relationships ?? []).filter((x: any) => x.type === "calls" || x.type === "instantiates")) }),
  },
  {
    id: "dart/field-init-module-source",
    language: "dart",
    defectClass: "misattribution",
    description: "reverts DARTD9: class-member initializers attribute instantiates to the module (dedup-and-attribution) instead of the owning class — fixture forbids instantiates:dedup-and-attribution->IconData and expects IconSet->IconData",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => x.type === "instantiates" && (x.source === "IconSet" || x.source === "build") && x.target === "IconData" ? { ...x, source: "dedup-and-attribution" } : x) }),
  },
  {
    id: "dart/local-fn-symbols-reintroduced",
    language: "dart",
    defectClass: "symbol-pollution",
    description: "reverts DARTD8 symbol side: local functions leak as top-level Function symbols again — fixture forbids symbol localHelper",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).concat([{ name: "localHelper", kind: "function", scope: "", visibility: "private" }]) }),
  },
  {
    id: "dart/local-fn-call-context-reintroduced",
    language: "dart",
    defectClass: "misattribution",
    description: "reverts DARTD8 call side: calls inside a local function attribute to the local name (localHelper->helperCall) instead of folding into the enclosing function — fixture expects calls topFn->helperCall and forbids calls from localHelper",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => x.type === "calls" && x.source === "topFn" && x.target === "helperCall" ? { ...x, source: "localHelper" } : x) }),
  },
  {
    id: "dart/top-level-accessors-dropped",
    language: "dart",
    defectClass: "symbol-loss",
    description: "reverts DARTD10: top-level getter/setter signatures fall through all dispatch branches and vanish — fixture expects symbol activeKeys property meta.isTopLevelAccessor:true",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((x: any) => !(x.name === "activeKeys" && x.metadata?.isTopLevelAccessor)) }),
  },
  {
    id: "dart/accessor-pair-collapsed",
    language: "dart",
    defectClass: "symbol-loss",
    description: "reverts DARTD12: getter/setter pairs dedup to one symbol (owner:name key without kind) — expectSymbolCount value/property/Counter equals:2 fails",
    transform: r => {
      let dropped = false
      const symbols = (r.symbols ?? []).filter((x: any) => {
        if (!dropped && x.name === "value" && x.ownerName === "Counter" && x.metadata?.isSetter) { dropped = true; return false }
        return true
      })
      return { ...r, symbols }
    },
  },
  {
    id: "dart/param-types-degraded",
    language: "dart",
    defectClass: "payload-corruption",
    description: "reverts DARTD13: every parameter type degrades to dynamic (the old childForFieldName('type') miss) — expectParameters pins total:double, nv:int, sides:int fail",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({
      ...s,
      parameters: (s.parameters ?? []).map((p: any) => ({ ...p, type: "dynamic" })),
    })) }),
  },
  {
    id: "dart/mixin-on-heritage-dropped",
    language: "dart",
    defectClass: "relationship-loss",
    description: "reverts DARTD14: mixin on-clause base never emits extends — expectRelationships extends Flow->Base meta.isMixinOn:true fails",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "extends" && x.source === "Flow" && x.metadata?.isMixinOn)) }),
  },
  {
    id: "dart/enum-heritage-dropped",
    language: "dart",
    defectClass: "relationship-loss",
    description: "reverts DARTD15: enhanced enum implements edges never emit — expectRelationships implements Poly->Shape fails",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "implements" && x.source === "Poly" && x.target === "Shape")) }),
  },
  {
    id: "dart/external-override-dropped",
    language: "dart",
    defectClass: "relationship-loss",
    description: "reverts DARTD16: cross-file @override methods emit no overrides edge (the 34k-class corpus loss) — expectRelationships overrides Banner.toString->StatelessWidget.toString fails",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "overrides" || !String(x.source).startsWith("Banner")) }),
  },
  {
    id: "dart/field-override-fabricated",
    language: "dart",
    defectClass: "relationship-fabrication",
    description: "re-introduces the DARTD16 un-gated fallback: fields fake external overrides (Poly.sides->Shape.sides) — fixture forbids that exact row",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).concat([
      { source: "Poly.sides", target: "Shape.sides", type: "overrides", confidence: 0.8, metadata: { isOverride: true, isExternalBase: true } },
    ]) }),
  },
  {
    id: "swift/drop-implements-edge",
    language: "swift",
    defectClass: "relationship-loss",
    description: "drops swift implements edges (OrderRepositoryImpl->OrderRepository, Order->Equatable) — swift section B implements pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "implements") }),
  },
  {
    id: "swift/drop-self-uses-edge",
    language: "swift",
    defectClass: "relationship-loss",
    description: "drops swift self. member-read uses edges — swift edges-and-patterns uses pin (Calculator->history)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isFieldAccess && x.type === "uses")) }),
  },
  {
    id: "swift/emit-write-as-read",
    language: "swift",
    defectClass: "relationship-fabrication",
    description: "SCD1 regression: removes the assignment-LHS write gate — re-injects the exact pre-fix edges probe-verified on `self.count = 0`/`self.label = \"z\"` (Counter->count, Counter->label uses) — swift/write-gate forbids catch them",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "Counter", target: "count", isExternal: true, weight: 0.8, confidence: 1.0, metadata: { isFieldAccess: true, evidenceClass: "usage_contextual" } }, { type: "uses", source: "Counter", target: "label", isExternal: true, weight: 0.8, confidence: 1.0, metadata: { isFieldAccess: true, evidenceClass: "usage_contextual" } }] }),
  },
  {
    id: "swift/drop-glued-receiver-reads",
    language: "swift",
    defectClass: "relationship-loss",
    description: "SWD1 regression: reverts hasSelfReceiver to the pre-fix receiver chain, dropping glued-shape reads (inout `&self.ctx`, additive `base + self.count`) — swift/write-gate expectUses Counter->ctx pin fails when the edge vanishes",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((rel: any) => !(rel.type === "uses" && rel.source === "Counter" && rel.target === "ctx")) }),
  },
  {
    id: "swift/drop-operator-symbol",
    language: "swift",
    defectClass: "symbol-loss",
    description: "drops swift operator overload symbols (operator + / == on Vector) — swift edges-and-patterns symbol pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !(s.name && s.name.startsWith("operator ")) ) }),
  },
  {
    id: "swift/drop-symbol-complexity",
    language: "swift",
    defectClass: "payload-loss",
    description: "drops swift per-symbol complexity (parse classify guard/if/switch count) — swift section C complexity pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "swift/emit-subscript-call",
    language: "swift",
    defectClass: "relationship-loss",
    description: "re-adds the bogus subscript-read calls edge (entries[key] as a call) — swift edges-and-patterns forbid pin",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "calls", source: "Registry", target: "entries", isExternal: true, weight: 1, confidence: 0.95, metadata: {},
      }],
    }),
  },
  {
    id: "swift/emit-defer-call",
    language: "swift",
    defectClass: "relationship-loss",
    description: "re-adds the bogus defer keyword-call edge (defer {} as calls->defer) — swift edges-and-patterns forbid pin",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "calls", source: "parse", target: "defer", isExternal: true, weight: 1, confidence: 0.95, metadata: {},
      }],
    }),
  },
  {
    id: "swift/class-protocol-first-as-extends",
    language: "swift",
    defectClass: "relationship-loss",
    description: "regresses the SWIFTD1 rule: treats a class's first-base protocol as extends (Circle->Shape) — swift edges-and-patterns implements/forbid pins",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "implements" && x.source === "Circle" && x.target === "Shape"
          ? { ...x, type: "extends", metadata: { ...(x.metadata ?? {}), isImplements: false } }
          : x,
      ),
    }),
  },
  {
    id: "objc/drop-implements-edge",
    language: "objc",
    defectClass: "relationship-loss",
    description: "drops objc implements edges (PaymentService->PaymentGateway, CustomView->Renderable) — objc section B implements pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "implements") }),
  },
  {
    id: "objc/drop-extends-edge",
    language: "objc",
    defectClass: "relationship-loss",
    description: "drops objc extends edges (BaseService->NSObject, PaymentService->BaseService) — objc payload extends pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "extends") }),
  },
  {
    id: "objc/drop-instantiates-edge",
    language: "objc",
    defectClass: "relationship-loss",
    description: "drops objc instantiates edges (sharedService->PaymentService via alloc/new) — objc instantiates pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "instantiates") }),
  },
  {
    id: "objc/drop-category-extension",
    language: "objc",
    defectClass: "symbol-loss",
    description: "drops objc category Extension symbols (PaymentService (Audit), UIView (RoundedCorner)) — objc category pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !((s.metadata ?? {}).isCategory)) }),
  },
  {
    id: "objc/drop-symbol-complexity",
    language: "objc",
    defectClass: "payload-loss",
    description: "drops objc per-symbol complexity (authorizeAmount if/for/&&/ternary count) — objc section C complexity pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "objc/emit-receiver-call",
    language: "objc",
    defectClass: "relationship-loss",
    description: "re-adds the bogus receiver-as-call edge (calls->PaymentService from [PaymentService sharedService]) — objc forbid pin",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "calls", source: "auditTrail", target: "PaymentService", isExternal: true, weight: 1, confidence: 0.95, metadata: {},
      }],
    }),
  },
  {
    id: "objc/duplicate-interface-impl",
    language: "objc",
    defectClass: "symbol-loss",
    description: "regresses the interface+implementation dedup: emits the same class/method/property twice — objc unique-symbol pins",
    transform: r => ({
      ...r,
      // Genuinely duplicate every symbol: the @interface/@implementation
      // dedup regression makes each class/method/property appear twice.
      symbols: [...(r.symbols ?? []), ...(r.symbols ?? [])],
    }),
  },
  {
    id: "objc/drop-member-read-uses",
    language: "objc",
    defectClass: "relationship-loss",
    description: "drops objc dot-syntax member-read uses edges (self.superview, superview.hidden, self.layer) — objc section B uses pin (managed-OO family contract)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isFieldRead && x.type === "uses")) }),
  },
  {
    id: "objc/drop-protocol-inheritance",
    language: "objc",
    defectClass: "relationship-loss",
    description: "drops objc protocol-inheritance extends edges (Animatable->Renderable) — objc protocol_reference_list extends pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isProtocolInheritance)) }),
  },
  {
    id: "objc/drop-category-protocol",
    language: "objc",
    defectClass: "relationship-loss",
    description: "drops objc category-declared protocol conformance (UIView->Animatable) — objc category implements pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isCategoryProtocol)) }),
  },
  {
    id: "objc/emit-write-as-uses",
    language: "objc",
    defectClass: "relationship-loss",
    description: "regresses the read/write gate: emits uses for assignment LHS writes (self.clipsToBounds = YES as a read) — objc forbid pin",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "uses", source: "animate", target: "clipsToBounds", isExternal: true, weight: 1, confidence: 0.9, metadata: { isFieldRead: true },
      }],
    }),
  },
  {
    id: "php/drop-implements-edge",
    language: "php",
    defectClass: "relationship-loss",
    description: "drops php implements edges (PaymentService->Authorizer/Refundable) — php section B implements pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "implements") }),
  },
  {
    id: "php/drop-extends-edge",
    language: "php",
    defectClass: "relationship-loss",
    description: "drops php extends edges (PaymentService->BaseService) — php extends pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "extends") }),
  },
  {
    id: "php/drop-instantiates-edge",
    language: "php",
    defectClass: "relationship-loss",
    description: "drops php instantiates edges (new PaymentService / new StripeGateway) — php instantiates pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "instantiates") }),
  },
  {
    id: "php/drop-trait-use",
    language: "php",
    defectClass: "relationship-loss",
    description: "drops php trait-composition uses edges (OrderService->Loggable) — php trait pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isTraitUse)) }),
  },
  {
    id: "php/drop-member-read-uses",
    language: "php",
    defectClass: "relationship-loss",
    description: "drops php member-read uses edges ($this->balance reads) — php section B uses pin (managed-OO family contract)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isMemberRead && x.type === "uses")) }),
  },
  {
    id: "php/emit-rmw-write-as-uses",
    language: "php",
    defectClass: "relationship-fabrication",
    description: "SCD1 regression: re-opens the augmented_assignment gate so compound-assign LHS ($this->balance -= / +=) re-emits uses — refund forbid pin catches it",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "uses", source: "refund", target: "balance", isExternal: true, weight: 1, confidence: 0.9, metadata: { isMemberRead: true },
      }],
    }),
  },
  {
    id: "php/wrapper-complexity-count",
    language: "php",
    defectClass: "payload-corruption",
    description: "SCD10 regression: re-adds switch_statement/try_statement wrapper counting (the pre-fix counter) — f6_global_helper pin equals:10 catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => s.name === "f6_global_helper" ? { ...s, complexity: s.complexity + 2 } : s) }),
  },
  {
    id: "php/emit-write-as-uses",
    language: "php",
    defectClass: "relationship-loss",
    description: "regresses the read/write gate: emits uses for assignment-LHS writes ($this->balance = ... as a read) — php forbid pin",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "uses", source: "__construct", target: "gateway", isExternal: true, weight: 1, confidence: 0.9, metadata: { phpSpecific: true, isMemberRead: true },
      }],
    }),
  },
  {
    id: "php/drop-symbol-complexity",
    language: "php",
    defectClass: "payload-loss",
    description: "drops php per-symbol complexity (authorize if/for/while/switch/ternary/&& count) — php section C complexity pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "php/drop-override-edge",
    language: "php",
    defectClass: "relationship-loss",
    description: "drops php override edges (PaymentService.__construct -> BaseService.__construct) — php overrides pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "overrides") }),
  },
  {
    id: "ruby/drop-implements-edge",
    language: "ruby",
    defectClass: "relationship-loss",
    description: "drops ruby module-mixin implements edges (Service->Loggable) — ruby include pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "implements") }),
  },
  {
    id: "ruby/drop-member-read-uses",
    language: "ruby",
    defectClass: "relationship-loss",
    description: "drops ruby instance-var member-read uses edges (@balance reads) — ruby section B uses pin (managed-OO family contract)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).memberRead && x.type === "uses")) }),
  },
  {
    id: "ruby/emit-write-as-uses",
    language: "ruby",
    defectClass: "relationship-loss",
    description: "regresses the read/write gate: emits uses for assignment-LHS writes (@total = ... as a read) — ruby forbid pin",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "uses", source: "initialize", target: "@gateway", isExternal: true, weight: 1, confidence: 0.9, metadata: { memberRead: true },
      }],
    }),
  },
  {
    id: "ruby/split-script-sentinel",
    language: "ruby",
    defectClass: "payload-corruption",
    description: "GAD2 twin regression: reverts the require references source to the old hardcoded 'root' sentinel while calls/uses keep 'Global' — ruby payload-and-complexity references Global->rake/tasklib pin catches the split",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((rel: any) => (rel.type === "references" && rel.target === "rake/tasklib" ? { ...rel, source: "root" } : rel)) }),
  },
  {
    id: "ruby/emit-rmw-write-as-uses",
    language: "ruby",
    defectClass: "relationship-fabrication",
    description: "SCD1 regression: re-opens the operator_assignment gate so compound-assign LHS (@balance -= / +=) re-emits uses — refund forbid pin + authorize count equals:2 catch it",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "uses", source: "refund", target: "@balance", isExternal: true, weight: 1, confidence: 0.9, metadata: { memberRead: true },
      }],
    }),
  },
  {
    id: "ruby/drop-instantiates-edge",
    language: "ruby",
    defectClass: "relationship-loss",
    description: "drops ruby instantiates edges (Service.new / Gateway.new) — ruby instantiates pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "instantiates") }),
  },
  {
    id: "ruby/drop-symbol-complexity",
    language: "ruby",
    defectClass: "payload-loss",
    description: "drops ruby per-symbol complexity (authorize if/while/&& count) — ruby section C complexity pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "ruby/pattern-bindings-leak-as-calls",
    language: "ruby",
    defectClass: "fabrication",
    description: "injects the RUBYG1 bug class: pattern-match bindings (in [a, b] / in {amount:} / Integer => n) leak as bare calls — fixture forbid pins calls:a/b/amount/code/msg",
    transform: r => ({ ...r, relationships: [
      ...(r.relationships ?? []),
      { type: "calls", source: "unpack", target: "a", fromSymbol: "unpack", toSymbol: "a", confidence: 0.9, metadata: { bareCall: true } },
      { type: "calls", source: "unpack", target: "b", fromSymbol: "unpack", toSymbol: "b", confidence: 0.9, metadata: { bareCall: true } },
      { type: "calls", source: "amount_of", target: "amount", fromSymbol: "amount_of", toSymbol: "amount", confidence: 0.9, metadata: { bareCall: true } },
      { type: "calls", source: "amount_of", target: "code", fromSymbol: "amount_of", toSymbol: "code", confidence: 0.9, metadata: { bareCall: true } },
      { type: "calls", source: "amount_of", target: "msg", fromSymbol: "amount_of", toSymbol: "msg", confidence: 0.9, metadata: { bareCall: true } },
    ] }),
  },
  {
    id: "python/drop-instance-attribute-properties",
    language: "python",
    defectClass: "symbol-loss",
    description: "regresses PYD1: self.x = ... writes emit NO Property symbols (the pre-fix dead-LHS-gate bug class) — python fixture property pins",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !((s.metadata ?? {}).isInstanceAttribute)) }),
  },
  {
    id: "python/drop-member-read-uses",
    language: "python",
    defectClass: "relationship-loss",
    description: "drops python member-read uses edges (self.label reads) — python section B uses pin (managed-OO family contract)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isMemberRead && x.type === "uses")) }),
  },
  {
    id: "python/emit-self-shadow-extends",
    language: "python",
    defectClass: "fabrication",
    description: "injects the #299 bug class: class Looped(Looped) self-shadowing emits a fabricated extends self-loop — fixture forbid pin",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "extends", source: "Looped", target: "Looped", fromSymbol: "Looped", toSymbol: "Looped", confidence: 1.0, metadata: { pythonSpecific: true },
      }],
    }),
  },
  {
    id: "python/drop-symbol-complexity",
    language: "python",
    defectClass: "payload-loss",
    description: "drops python per-symbol complexity (total_for for/if/while count) — python section C complexity pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "python/class-var-public-visibility",
    language: "python",
    defectClass: "payload-loss",
    description: "regresses PYD3: underscore class variables hard-coded public (the pre-fix asymmetry) — python _memo protected pin",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        (s.metadata ?? {}).isClassVariable ? { ...s, visibility: "public" } : s),
    }),
  },
  {
    id: "python/drop-enum-auto-members",
    language: "python",
    defectClass: "symbol-loss",
    description: "regresses PYD4: auto()-valued enum members dropped (RED = enum.auto() silent) — python Colors/RED pins",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => s.name !== "RED") }),
  },
  {
    id: "python/nested-def-reowner",
    language: "python",
    defectClass: "relationship-loss",
    description: "regresses PYD5: member reads inside nested defs re-owned by the nested (non-symbol) name — run->base_name pin dies",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && x.source === "run" && x.target === "base_name")) }),
  },
  {
    id: "haskell/drop-derived-implements",
    language: "haskell",
    defectClass: "relationship-loss",
    description: "drops haskell deriving-clause implements edges (User->Show/Eq, UserId->Show) — haskell derived pins",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).derived && x.type === "implements")) }),
  },
  {
    id: "haskell/drop-qualified-calls",
    language: "haskell",
    defectClass: "relationship-loss",
    description: "drops haskell qualified calls (M.lookup) — haskell isQualifiedCall pin (HSD-qualified contract)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isQualifiedCall && x.type === "calls")) }),
  },
  {
    id: "haskell/drop-record-construction",
    language: "haskell",
    defectClass: "relationship-loss",
    description: "drops haskell record-construction instantiates (mkUser->Person, choose->Bot) — HSD5 record pins",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isRecordConstruction && x.type === "instantiates")) }),
  },
  {
    id: "haskell/drop-symbol-complexity",
    language: "haskell",
    defectClass: "payload-loss",
    description: "drops haskell per-symbol complexity (describe=3, signed=3) — haskell section C complexity pins",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "haskell/pattern-bindings-leak-as-calls",
    language: "haskell",
    defectClass: "fabrication",
    description: "injects the pattern-binding fabrication class: case/lambda pattern variables (a, b) leak as bare calls — haskell forbid pins calls:merged->a/b",
    transform: r => ({ ...r, relationships: [
      ...(r.relationships ?? []),
      { type: "calls", source: "merged", target: "a", fromSymbol: "merged", toSymbol: "a", confidence: 0.9, metadata: { haskellSpecific: true, context: "local function call" } },
      { type: "calls", source: "merged", target: "b", fromSymbol: "merged", toSymbol: "b", confidence: 0.9, metadata: { haskellSpecific: true, context: "local function call" } },
    ] }),
  },
  {
    id: "haskell/drop-standalone-deriving",
    language: "haskell",
    defectClass: "relationship-loss",
    description: "drops standalone deriving implements (Ticket->Show/Csv.ToNamedRecord/ToJSON) — HSD12/HSD18 pins (bare, qualified, parens class heads)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isStandaloneDeriving)) }),
  },
  {
    id: "haskell/qualified-ctor-as-calls",
    language: "haskell",
    defectClass: "fabrication",
    description: "injects the HSD16 regression class: qualified constructor application (M.Just) emitted as calls instead of instantiates — fixture pins instantiates:maybeOne->M.Just",
    transform: r => ({ ...r, relationships: [
      ...(r.relationships ?? []).filter((x: any) => !(x.source === "maybeOne" && x.target === "M.Just")),
      { type: "calls", source: "maybeOne", target: "M.Just", fromSymbol: "maybeOne", toSymbol: "M.Just", confidence: 0.9, metadata: { haskellSpecific: true, isQualifiedCall: true } },
    ] }),
  },
  {
    id: "haskell/pattern-position-instantiates",
    language: "haskell",
    defectClass: "fabrication",
    description: "injects the HSD14 regression class: case-alternative + record-pattern heads fabricate instantiates — fixture forbids whoIs->Person/Bot/Plain, nOf->Ticket, guardPick->Person",
    transform: r => ({ ...r, relationships: [
      ...(r.relationships ?? []),
      { type: "instantiates", source: "whoIs", target: "Person", fromSymbol: "whoIs", toSymbol: "Person", confidence: 0.9, metadata: { haskellSpecific: true, isConstructorApplication: true } },
      { type: "instantiates", source: "nOf", target: "Ticket", fromSymbol: "nOf", toSymbol: "Ticket", confidence: 0.9, metadata: { haskellSpecific: true, isRecordConstruction: true } },
    ] }),
  },
  {
    id: "haskell/head-self-call",
    language: "haskell",
    defectClass: "fabrication",
    description: "injects the HSD19 regression class: backtick infix definition head emits a self-call — fixture forbids calls:combine->combine",
    transform: r => ({ ...r, relationships: [
      ...(r.relationships ?? []),
      { type: "calls", source: "combine", target: "combine", fromSymbol: "combine", toSymbol: "combine", confidence: 0.9, metadata: { haskellSpecific: true } },
    ] }),
  },
]

async function realAnalyzer(lang: string): Promise<any> {
  const cfg = LANGS[lang]
  const mod: any = await import(`../../src/ast/${cfg.analyzerFile}`)
  return new mod[cfg.className]()
}

async function main() {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, "validation", "m14", "fixture-baseline.json"), "utf8"))
  const mutationLog: { mutant: string; injectedAt: string; caughtBy: string; detail: string }[] = []
  const checks: { id: string; description: string; status: "pass" | "fail"; detail?: string }[] = []
  let survivors = 0

  // cache clean-run results per language once
  const cleanResults = new Map<string, Awaited<ReturnType<typeof runLang>>>()
  async function clean(lang: string) {
    if (!cleanResults.has(lang)) cleanResults.set(lang, await runLang(lang))
    return cleanResults.get(lang)!
  }

  for (const m of MUTANTS) {
    const base = await clean(m.language)
    const real = await realAnalyzer(m.language)
    const mutant = {
      analyze: async (...args: any[]) => m.transform(await real.analyze(...args)),
      // SFC languages (vue/svelte) run through engine parseFile in runLang;
      // runLang applies this transform to the parseFile result so mutants are
      // exercised on the real production path.
      transform: m.transform,
    }
    const mutated = await runLang(m.language, mutant)
    // Caught = more failing fixtures OR more distinct problems inside
    // already-failing fixtures (a defect landing in broken code is still a defect).
    const baseProblems = base.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
    const mutProblems = mutated.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
    const caught = mutated.fail > base.fail || mutProblems > baseProblems
    const caughtBy = mutated.details.filter(d => !d.ok).map((d: any) => d.fixture)
      .filter(f => !base.details.some((bd: any) => !bd.ok && bd.fixture === f))
      .join(", ")
    console.log(`${caught ? "CAUGHT" : "SURVIVED"}  ${m.id}  (${base.fail} -> ${mutated.fail} failures${caughtBy ? "; new failures: " + caughtBy : ""})`)
    checks.push({ id: `mutation-${m.id.replace("/", "-")}`, description: m.description, status: caught ? "pass" : "fail", detail: `${base.fail} -> ${mutated.fail}` })
    mutationLog.push({ mutant: m.id, injectedAt: new Date().toISOString(), caughtBy: caughtBy || "(none)", detail: `${m.defectClass}: ${base.fail} -> ${mutated.fail} fixture failures` })
    if (!caught) survivors++
  }

  const { emitEvidence } = await import("./evidence-harness")
  emitEvidence({
    issueId: "M14.0.F4",
    title: "Mutation-testing harness",
    claimLevel: "L1",
    layers: ["fixtures", "mutation"],
    checks,
    limitations: [
      { description: "mutants wrap analyzer output rather than rewriting analyzer source; equivalent at the suite level but not a compiler-level injection" },
      { description: "mutation coverage currently spans java + groovy (the wave languages); other languages add mutants when their waves start" },
    ],
    mutationLog,
    data: { summary: { mutantsRun: MUTANTS.length, caught: MUTANTS.length - survivors, survived: survivors } },
  })

  if (survivors > 0) {
    console.error(`\n${survivors} SURVIVING MUTANT(S) - the suite cannot detect real defects. Fix the suite before trusting any green.`)
    process.exit(2)
  }
  console.log(`\nall ${MUTANTS.length} mutants caught - the gates can fail`)
}

main().catch(e => { console.error(e); process.exit(1) })
