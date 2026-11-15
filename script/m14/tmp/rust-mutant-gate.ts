/**
 * RUST-lane F4 mutant run, extracted from the shared registry's COMMITTED text.
 *
 * WHY THIS TOOL EXISTS (2026-09-29, rust master review). The shared
 * `script/m14/mutate-analyzer.ts` is structurally broken in HEAD: the xml
 * co-agent's entry swallowed the MUTANTS array's closing bracket, so the file
 * does not parse and no lane can run F4 from a clean checkout. The 34 rust
 * mutant definitions are themselves intact TEXT, so this harness lifts them out
 * (string-aware, brace-balanced, one entry at a time) and runs exactly the
 * shared harness's check: for each mutant, the fixture suite must get strictly
 * worse. Same runLang, same caught test, same baseline file.
 *
 * It is a MEASUREMENT TOOL, not a replacement gate: canonical F4 is a full
 * unscoped run of the shared harness, which cannot happen until the registry
 * parses again. Nothing here writes canonical evidence.
 *
 * CLI: npx tsx script/m14/tmp/rust-mutant-gate.ts
 */
import * as fs from "fs"
import * as path from "path"
import { runLang, LANGS } from "../run-fixtures"

const ROOT = "/home/sano/ishaq/backbencher-brain"
function dropAllLineNumbers(r: any) {
  const rels: any[] = r.relationships ?? []
  if (!rels.some((x) => x && "line_number" in x)) return r
  return {
    ...r,
    relationships: rels.map((x: any) => {
      if (!x || !("line_number" in x)) return x
      const { line_number: _drop, ...rest } = x
      return rest
    }),
  }
}

function dropDeclarationFlag(r: any) {
  const syms: any[] = r.symbols ?? []
  if (!syms.some((s: any) => s?.metadata?.isDeclaration === true)) return r
  return {
    ...r,
    symbols: syms.map((s: any) => {
      if (s?.metadata?.isDeclaration !== true) return s
      const metadata = { ...s.metadata }
      delete metadata.isDeclaration
      return { ...s, metadata }
    }),
  }
}

function markEveryFunctionAsDeclaration(r: any) {
  const syms: any[] = r.symbols ?? []
  const isFn = (s: any) => {
    const k = s?.kind ?? s?.type
    return k === "function" || k === "method"
  }
  if (!syms.some(isFn)) return r
  return {
    ...r,
    symbols: syms.map((s: any) =>
      isFn(s) ? { ...s, metadata: { ...(s.metadata ?? {}), isDeclaration: true } } : s,
    ),
  }
}

function normRel(r: any) { return { ...r, type: r.type ?? r.relationshipType } }

const MUTANTS: any[] = [
  {
    id: "rust/drop-scoped-struct-literal-leaf",
    language: "rust",
    defectClass: "relationship-loss",
    description: "drops enum-variant struct-literal instantiates whose target is the variant leaf (MatchStrategy::Suffix -> Suffix): the pre-fix analyzer required a plain type_identifier and silently dropped scoped names",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !((x.metadata ?? {}).relationshipType === "struct_literal" && x.target === "Suffix") && !((x.metadata ?? {}).relationshipType === "struct_literal" && x.target === "Literal")) }),
  },,
  {
    id: "rust/turbofish-whole-text-target",
    language: "rust",
    defectClass: "relationship-loss",
    description: "targets turbofish calls (x.parse::<u32>()) by whole base text instead of the callee leaf: restores the pre-fix bug where generic_function used baseNode.text",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => (x.type === "calls" && x.target === "parse" ? { ...x, target: "cap.parse" } : x)) }),
  },,
  {
    id: "rust/parenthesized-closure-callee",
    language: "rust",
    defectClass: "relationship-loss",
    description: "re-emits calls edges for parenthesized closure callees ((self.0)(n)): the pre-fix else branch took functionNode.text verbatim and fabricated a (self.0) target",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "run", target: "(self.0)", type: "calls", confidence: 1, metadata: {} }] }),
  },,
  {
    id: "rust/drop-union-symbols",
    language: "rust",
    defectClass: "symbol-loss",
    description: "drops union_item declaration sites (Pixel): the pre-fix analyzer had no union_item branch, so Rust unions emitted NO symbol",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !(s.name === "Pixel" && s.kind === "struct")) }),
  },,
  {
    id: "rust/drop-trait-associated-types",
    language: "rust",
    defectClass: "symbol-loss",
    description: "drops trait-level associated_type symbols (Container.Item): the pre-fix analyzer only handled impl-level type_item, so trait bodies' `type Item;` were invisible",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !(s.name === "Item" && s.ownerName === "Container")) }),
  },,
  {
    id: "rust/duplicate-awaited-call-edge",
    language: "rust",
    defectClass: "relationship-duplication",
    description: "re-emits the raw await edge in ADDITION to the canonical call edge (the pre-fix await_expression branch pushed a second calls edge with the full function text as target): one awaited call site must produce exactly ONE calls edge",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "connect", target: "do_connect", type: "calls", confidence: 1, metadata: { rustSpecific: true, isAwait: true } }] }),
  },,
  {
    id: "rust/raw-use-list-import",
    language: "rust",
    defectClass: "import-contract",
    description: "stores the whole use-declaration raw text as the import module (pre-fix: `use std::io::{Read, Write as W}` became module='std::io::{Read, Write as W}' with comma-split items): restores the family-contract violation",
    transform: r => ({ ...r, imports: (r.imports ?? []).map((i: any) => (i.module === "std::io" ? { ...i, module: "std::io::{Read, Write as W}", items: ["std::io::{Read", "Write as W}"] } : i)) }),
  },,
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
  },,
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
  },,
  {
    id: "rust/duplicate-impl-ids",
    language: "rust",
    defectClass: "symbol-identity",
    description: "RSD3 regression: strips the uniqueId '#N' suffix so `struct Alpha` and both `impl Alpha` blocks collapse to the SAME symbol id 'Alpha' (pre-fix state, 2,852 duplicate ids in the corpus) — qualified-calls-ownership fixture's expectUniqueIds + expectSymbols id pins catch it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, id: (s.id ?? "").replace(/#[0-9]+$/, "") })) }),
  },,
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
  },,
  {
    id: "rust/reemit-write-field-uses",
    language: "rust",
    defectClass: "relationship-noise",
    description: "RSD5 regression: re-emits `uses` for assignment-LHS field WRITES (the pre-fix field_expression branch had no write-gate — 1,076 bogus uses across cargo+ripgrep; the oracle derives no uses truth so only fixtures catch it) — qualified-calls-ownership fixture's set_name/bump_count forbid pins catch it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "set_name", target: "name", type: "uses", confidence: 0.9, metadata: { relationshipType: "field_access", accessedFrom: "self" } }, { source: "bump_count", target: "count", type: "uses", confidence: 0.9, metadata: { relationshipType: "field_access", accessedFrom: "self" } }] }),
  },,
  {
    id: "rust/drop-nested-group-import-items",
    language: "rust",
    defectClass: "import-loss",
    description: "RSD6a regression: drops nested-group leaves from import items (pre-fix `use std::{env, io, path::{Path, PathBuf}}` bound only env/io — Path/PathBuf silently lost, 65 declarations across cargo+ripgrep) — use-list-imports fixture's std-row pin catches it",
    transform: r => ({ ...r, imports: (r.imports ?? []).map((i: any) => (i.module === "std" ? { ...i, items: (i.items ?? []).filter((x: string) => x !== "Path" && x !== "PathBuf") } : i)) }),
  },,
  {
    id: "rust/join-top-group-imports",
    language: "rust",
    defectClass: "import-contract",
    description: "RSD6b regression: collapses a top-level group import into ONE row whose module is the joined item names (pre-fix `use {std::sync::Arc, ...}` fabricated module 'Arc, Duration'; 28 declarations across cargo+ripgrep) — use-list-imports fixture's per-binding row pins catch it",
    transform: r => ({
      ...r,
      imports: [...(r.imports ?? []).filter((i: any) => i.module !== "std::sync::Arc" && i.module !== "std::time::Duration"), { module: "Arc, Duration", items: ["Arc", "Duration"], metadata: { rustSpecific: true, isPublic: false } }],
    }),
  },,
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
  },,
  {
    id: "rust/callsite-lines-dropped",
    language: "rust",
    defectClass: "line-attribution",
    description: "M59.A7 (#825) regression: rust's relationships go back to carrying NO line — the exact pre-fix state (measured 0 of 65,390 edges on a 200-file draw of cargo+ripgrep). Caught by rust/callsite-lines-825, which pins the broken call chain at 62, the broken field access at 55/56, the wrapped supertrait bounds at 23/24, the wrapped impl trait reference at 40 and the Self-returning constructor at 49.",
    transform: dropAllLineNumbers,
  },,
  {
    id: "rust/callsite-construct-start-line",
    language: "rust",
    defectClass: "line-attribution",
    description: "M59.A7 (#825) regression: restores the CONSTRUCT-START line instead of the node that names the edge — the callee reports its receiver (`repo` on 61, not the leaf on 62), a wrapped field access reports the value line (54, not 55), wrapped supertrait bounds report the `trait` keyword (22, not 23/24), a wrapped impl header reports `impl` (39, not 40) and a member reports its container (29, not 30). Exactly the pre-fix positions rust/callsite-lines-825 forbids.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map(x => {
        const t = String(x.type ?? "")
        const trapBearing = ["calls", "contains", "extends", "implements", "instantiates", "uses", "references"]
        if (trapBearing.includes(t) && typeof x.line_number === "number") {
          return { ...x, line_number: x.line_number - 1 }
        }
        return x
      }),
    }),
  },,
  {
    id: "rust/declaration-flag-dropped",
    language: "rust",
    defectClass: "payload-seam",
    description:
      "#612 store-phase regression: rust stops publishing the `function_item` vs `function_signature_item` distinction, so an `extern \"C\"` declaration is indistinguishable from the definition implementing it. Caught by rust/declaration-vs-definition-612's meta.isDeclaration entries on `ffi_decl` and `sig_only`.",
    transform: dropDeclarationFlag,
  },,
  {
    id: "rust/declaration-flag-everywhere",
    language: "rust",
    defectClass: "payload-seam",
    description:
      "#612 store-phase regression, REVERSE direction: every rust function/method is published as a declaration. Caught by rust/declaration-vs-definition-612's forbidSymbols entries (`body_fn`, and the trait container `Runnable`).",
    transform: markEveryFunctionAsDeclaration,
  },,
  {
    id: "rust/drop-bare-uses",
    language: "rust",
    defectClass: "relationship-loss",
    description: "R1 #736 regression: reverts bare value reads — const/static/callback/member reads emit nothing (bare-value-reads pins reader->GLOBAL/LIMIT/identity, get_c->C, matcher->Red)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).relationshipType === "identifier_usage")) }),
  },,
  {
    id: "rust/reemit-shadowed-reads",
    language: "rust",
    defectClass: "scope-blindness",
    description: "R1 #736 regression: reverts shadowing suppression — the shadowing param read leaks (bare-value-reads forbids shadowed->GLOBAL)",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { source: "shadowed", target: "GLOBAL", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage" } },
      ],
    }),
  },,
  {
    id: "rust/reemit-where-param-refs",
    language: "rust",
    defectClass: "relationship-fabrication",
    description: "R8 #736 regression: reverts the where-bound param filter — `where T: Clone` leaks references to the bound type parameter (verified absent in bare-value-reads REFS alongside the relationship-kinds String:PartialEq pin)",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { source: "generic", target: "T", type: "references", confidence: 1.0, metadata: { rustSpecific: true, whereBound: true } },
      ],
    }),
  },,
  {
    id: "rust/revert-impl-target-wrapper-name",
    language: "rust",
    defectClass: "name-surface",
    description:
      "R10 regression (#798, M60 standing rule): reverts the impl-target NAME rule — the implemented type's WRAPPER text is republished as the impl symbol's name, as the `implements` edge's source and as the `Self` resolution target (`&mut ProcessBuilder`, `&'static str`, `(T, U)`, `[u8]`), i.e. source TEXT published where the contract wants a name. This is the class the M60 target-spelling census convicted rust for (6 `references` targets over 2 files: `&mut ProcessBuilder` x5, `&mut Execs` x1) and that the differential could not see because its truth derives from the same rule. Caught by impl-target-name-surface-798 (forbids the four wrapper spellings as symbols, as `implements` sources and as `references` targets; the exact pre-fix emissions are printed by script/m14/tmp/rust-798-fixture-dump.ts with BB_PRE_R10=1).",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => {
        if (s.kind !== "impl") return s
        if (s.name === "ProcessBuilder") return { ...s, name: "&mut ProcessBuilder", ownerName: "&mut ProcessBuilder" }
        if (s.name === "str") return { ...s, name: "&'static str", ownerName: "&'static str" }
        if (s.name === "anonymous_impl") {
          const back = String(s.metadata?.implementedType ?? "anonymous_impl")
          const { implementedType, ...rest } = s.metadata ?? {}
          void implementedType
          return { ...s, name: back, ownerName: back, metadata: rest }
        }
        return s
      }),
      relationships: [
        ...(r.relationships ?? [])
          .filter((x: any) => x.type !== "references" || !["ProcessBuilder", "str"].includes(String(x.target)))
          .map((x: any) =>
            x.type === "implements" && ["ProcessBuilder", "str"].includes(String(x.source))
              ? { ...x, source: x.source === "ProcessBuilder" ? "&mut ProcessBuilder" : "&'static str" }
              : x,
          ),
        { source: "env", target: "&mut ProcessBuilder", type: "references", confidence: 0.9, metadata: { relationshipType: "declared_type" } },
        { source: "into_url", target: "&'static str", type: "references", confidence: 0.9, metadata: { relationshipType: "declared_type" } },
        { source: "to_tuple_id", target: "(T, U)", type: "references", confidence: 0.9, metadata: { relationshipType: "declared_type" } },
        { source: "to_slice_id", target: "[u8]", type: "references", confidence: 0.9, metadata: { relationshipType: "declared_type" } },
      ],
    }),
  },,
  {
    id: "rust/reemit-self-callee-target",
    language: "rust",
    defectClass: "name-surface",
    description:
      "R10 regression (#798, M60): republishes the literal `Self` as a `calls` target — `Self(0)` names the enclosing impl type's constructor and the lane resolves `Self` everywhere else (it refuses it as a NAME on the read surface and resolves it for `instantiates` via D2), so the keyword must not survive on the call surface either. Found by the F14 name-surface gate when it was extended to rust (6 cargo rows: `Ok(Self(name))` in cargo-util-schemas/src/manifest/mod.rs, `Self(ProcessEnv)` in build-rs/src/input.rs). Caught by impl-target-name-surface-798, which forbids calls -> Self.",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []).filter((x: any) => !(x.type === "calls" && x.target === "Wrap")),
        { source: "wrap_new", target: "Self", type: "calls", confidence: 1.0, metadata: { qualified: "Self" } },
      ],
    }),
  },,
  {
    id: "rust/revert-where-clause-climb",
    language: "rust",
    defectClass: "relationship-fabrication",
    description: "R16a/R16b regression (#798, cargo full extent): reverts the where-clause climb — a bound naming a TRAIT-method-signature parameter (`function_signature_item` missing from the item list) or an OUTER impl's parameter (the climb stopping at the first enclosing item) leaks references again (where-clause-bounds-798 forbids references->F and references->N; the exact pre-fix emissions are printed by script/m14/tmp/rust-798-wherebounds.ts)",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { source: "try_borrow_with", target: "F", type: "references", confidence: 1.0, metadata: { rustSpecific: true, whereBound: true } },
        { source: "bound", target: "N", type: "references", confidence: 1.0, metadata: { rustSpecific: true, whereBound: true } },
      ],
    }),
  },,
  {
    id: "rust/where-bound-raw-text",
    language: "rust",
    defectClass: "name-surface",
    description: "R16c regression (#798): reverts the bound target's NAME leaf and republishes the pre-fix raw scoped text — `where anyhow::Error: From<E>` targets `anyhow::Error` instead of `Error`, a target no consumer can resolve (where-clause-bounds-798 forbids the raw-text and module spellings; the c/cpp #924 class)",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { source: "parse", target: "anyhow::Error", type: "references", confidence: 1.0, metadata: { rustSpecific: true, whereBound: true } },
      ],
    }),
  },,
  {
    id: "rust/drop-self-construction",
    language: "rust",
    defectClass: "relationship-loss",
    description: "D2 #736 regression: reverts Self resolution — `Self { x }` / `Self::new()` / bare `Self(..)` target the literal Self and are filtered as noise (construction-exports pins instantiates new/origin/clone_it->Point and R14 wrap->Wrap)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type ?? x.relationshipType) === "instantiates" && (x.target === "Point" || x.target === "Wrap"))) }),
  },,
  {
    id: "rust/restore-restricted-exports",
    language: "rust",
    defectClass: "export-fabrication",
    description: "D3 #736 regression: reverts export privacy — pub(crate) items and private-module members re-enter the export list (construction-exports forbids internal/Hidden/std::io::Read/f)",
    transform: r => ({
      ...r,
      exports: [
        ...(r.exports ?? []),
        { name: "internal", type: "function", isType: false },
        { name: "Hidden", type: "struct", isType: true },
      ],
    }),
  },,
  {
    id: "rust/reemit-arm-binding-reads",
    language: "rust",
    defectClass: "shadowing-loss",
    description: "R9 extreme regression: bare match-arm patterns stop binding — the pattern site and body reads of `v` leak as uses (bare-value-reads forbids uses arm_binds->v)",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), { source: "arm_binds", target: "v", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } }],
    }),
  },,
  {
    id: "rust/closure-param-reads",
    language: "rust",
    defectClass: "shadowing-loss",
    description: "R10 extreme regression: closure parameters stop binding — the closure body read of VAL leaks as uses (bare-value-reads forbids uses closure_binds->VAL)",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), { source: "closure_binds", target: "VAL", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } }],
    }),
  },,
  {
    id: "rust/drop-scoped-use-leaf",
    language: "rust",
    defectClass: "relationship-loss",
    description: "R11 extreme regression: scoped single-leaf use paths bind nothing again — value-position reads of plain-path imports go silent (bare-value-reads expects uses capped->MAX)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(normRel(x).type === "uses" && normRel(x).source === "capped" && normRel(x).target === "MAX")) }),
  },,
  {
    id: "rust/blank-symbol",
    language: "rust",
    defectClass: "symbol-noise",
    description: "R12 extreme regression: mints the GO5/Z8-class `_` Variable symbol for `const _ : u32 = 0;` (bare-value-reads forbids any `_` symbol)",
    transform: r => ({
      ...r,
      symbols: [...(r.symbols ?? []), { name: "_", kind: "variable", visibility: "private", range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, startIndex: 0, endIndex: 0 } }],
    }),
  },,
  {
    id: "rust/drop-declared-type-refs",
    language: "rust",
    defectClass: "relationship-loss",
    description: "R13 extreme regression: drops the whole declared-type references graph — param/return/field/alias type mentions emit nothing (declared-type-refs expects 9 declared_type edges)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !((x.metadata ?? {}).relationshipType === "declared_type")) }),
  },,
  {
    id: "rust/drop-tuple-struct-field-types",
    language: "rust",
    defectClass: "relationship-loss",
    description: "R14 regression (#798, ripgrep full extent): reverts the tuple-struct field-type branch — a struct whose fields sit in an `ordered_field_declaration_list` (no `field_declaration` child) references none of its field types again (tuple-struct-field-types pins Wrapped->Inner, Pair->Inner/Vec, Scoped->Inner; measured 13 real missing edges over 10 ripgrep files before the fix)",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).filter(x => {
        const md = x.metadata ?? {}
        if (md.relationshipType !== "declared_type") return true
        // The tuple structs of tuple-struct-field-types.fixture (`Either` is a
        // NAMED-field union and must survive — it pins that the fix did not
        // move the already-handled named-field path).
        return !["Wrapped", "Pair", "Scoped", "Generic"].includes(String(x.source ?? ""))
      }),
    }),
  },
  {
    // RUST-MR: a macro INVOCATION's name is a callee, and the calls branch owns
    // it (RUST-D2). The read sweep's callee guard covered `call_expression`
    // only, so a USE-IMPORTED macro published BOTH `calls -> bail` AND
    // `uses -> bail` for one name at one line — 269 sites over a 550-file slice
    // of five real corpora — while an imported FUNCTION published `calls` only.
    // The F5 `uses` oracle mirrored the same over-reach (its only macro rule
    // skips identifiers under a macro DEFINITION, stopping at
    // `macro_invocation`), so F5 agreed with the fabrication and could not see
    // it. With no `uses` edge to remove, the mutant is undetectable by
    // construction, which is why the fixture carries FORBID rows.
    id: "rust/reemit-macro-callee-uses",
    language: "rust",
    defectClass: "relationship-fabrication",
    description: "RUST-MR: a macro invocation's NAME emits a `uses` edge beside its `calls` edge — one site, two labels, and the read is fabricated (R1 excludes callees)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "go", target: "bail", line_number: 24, confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } }] }),
  },
  {
    // RUST-MR: the same class in the other two container shapes — a trait
    // method DECLARATION (`function_signature_item`, absent from the
    // isItemNamePosition switch, so its own name fell through to the read
    // sweep and produced a SELF-EDGE at
    // cargo-test-support/src/lib.rs:1477), and a fn-pointer TYPE's parameter
    // (no body, therefore no bound-name set to exclude it by).
    id: "rust/reemit-declaration-position-reads",
    language: "rust",
    defectClass: "relationship-fabrication",
    description: "RUST-MR: a declaration position emits a `uses` edge — a trait method signature's own name (a self-edge) and a fn-pointer type's parameter name",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { type: "uses", source: "current_dir", target: "current_dir", line_number: 29, confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } },
        { type: "uses", source: "global", target: "schema", line_number: 34, confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } },
      ],
    }),
  },
  {
    // RUST-MR: a higher-ranked bound (`for<'de> Deserialize<'de>`) wraps its
    // type in a `higher_ranked_trait_bound` node, so the supertrait extraction's
    // direct-child test never saw it and the bound was published by NOBODY —
    // while the F5 oracle read the binder's text and fabricated
    // `extends -> "for"`, so both sides were wrong in opposite directions on one
    // construct. 3 sites in 2 files over 2,598, and the only construct where a
    // supertrait bound is named in source and absent from the graph.
    id: "rust/drop-higher-ranked-bounds",
    language: "rust",
    defectClass: "relationship-loss",
    description: "RUST-MR: a higher-ranked trait bound publishes no `extends` edge — serde's `trait DeserializeOwned: for<'de> Deserialize<'de>` names a supertrait and publishes none",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "extends" && x.source === "DeserializeOwned")),
    }),
  },
  {
    // RUST-MR: the guard that skips declarations inside a function body covered
    // let_declaration, const_item AND static_item, while its own comment claims
    // only `let` is an execution artifact. A function-local const/static names a
    // value with a type, an initializer and a line, and is published everywhere
    // else — 43 + 22 corpus sites at 0% coverage.
    id: "rust/drop-function-local-consts",
    language: "rust",
    defectClass: "symbol-loss",
    description: "RUST-MR: a function-local `const`/`static` publishes no symbol and no `contains` edge — the declaration guard over-applies the `let` rule",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => s.name !== "LOCAL" && s.name !== "CACHED"),
      relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "contains" && (x.target === "LOCAL" || x.target === "CACHED"))),
    }),
  },
  {
    // RUST-MR: a TRAIT method SIGNATURE's parameter declares, and for the same
    // reason a fn-pointer type's does: there is no body, so
    // `collectFunctionBindings` (which collects `function_item` only) leaves no
    // bound-name set to exclude the name by. Found at FULL extent over 2,598
    // files — cargo's src/compiler/mod.rs:142-143 — and not by the 550-file
    // sample, which is why the full-extent run is its own gate rather than a
    // bigger version of the same one.
    id: "rust/reemit-signature-param-reads",
    language: "rust",
    defectClass: "relationship-fabrication",
    description: "RUST-MR: a trait method signature's PARAMETER emits a `uses` edge when its name also resolves (a use-imported leaf of the same name)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "exec", target: "on_stdout_line", line_number: 42, confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } }] }),
  },
]

// the shared harness's own construction: the lane's analyzer class from LANGS
async function realAnalyzer(lang: string): Promise<any> {
  const cfg = (LANGS as any)[lang]
  const mod: any = await import(path.join(ROOT, "src/ast", cfg.analyzerFile))
  return new mod[cfg.className]()
}

async function main() {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, "validation", "m14", "fixture-baseline.json"), "utf8"))
  let survivors = 0, ran = 0, skipped = 0
  const cache = new Map<string, any>()
  const clean = async (lang: string) => {
    if (!cache.has(lang)) cache.set(lang, await runLang(lang))
    return cache.get(lang)!
  }
  const real = await realAnalyzer("rust")
  const base = await clean("rust")
  const baseProblems = base.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
  console.log(`clean rust lane: ${base.pass} pass / ${base.fail} fail, ${baseProblems} problems (baseline file records rust: ${JSON.stringify(baseline.rust ?? baseline["rust"] ?? null)})`)
  for (const m of MUTANTS) {
    if (!m || typeof m.transform !== "function") { skipped++; continue }
    ran++
    const mutant = { analyze: async (...args: any[]) => m.transform(await real.analyze(...args), typeof args[1] === "string" ? args[1] : undefined), transform: m.transform }
    let mutated: any
    try {
      mutated = await runLang("rust", mutant as any)
    } catch (e: any) {
      console.log(`ERROR    ${m.id}  (harness threw: ${String(e && e.message).slice(0, 90)})`)
      survivors++
      continue
    }
    const mutProblems = mutated.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
    const caught = mutated.fail > base.fail || mutProblems > baseProblems
    const caughtBy = mutated.details.filter((d: any) => !d.ok).map((d: any) => d.fixture)
      .filter((f: string) => !base.details.some((bd: any) => !bd.ok && bd.fixture === f)).join(", ")
    if (!caught) survivors++
    console.log(`${caught ? "CAUGHT   " : "SURVIVED "} ${m.id}  (${base.fail} -> ${mutated.fail} failures${caughtBy ? "; new: " + caughtBy : ""})`)
  }
  console.log(`\n${ran} rust mutants run, ${ran - survivors} caught, ${survivors} survived${skipped ? `, ${skipped} empty splice slots skipped` : ""}`)
  if (survivors > 0) process.exit(2)
}
main().catch((e) => { console.error(e); process.exit(1) })
