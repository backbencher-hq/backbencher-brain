// Pure-AST F# analyzer — Author: Muhammad Ishaq Khan  What this file is: the pure-AST analyzer for F# (`.fs`/`.fsi`/`.fsx`, routed by src/ast/language-detection.ts)
// — the M12 per-analyzer contract mirroring the C# family: pure AST, no regex on source text, override/default/
// member keywords read from tree-sitter token nodes, console output / Object leaf methods filtered like C#.
// Symbols: namespace, module, class, interface, enum, enum_member, property, method, function, constructor
// (named "constructor"). NO locals, NO lambda params, NO synthetic members.
// Relationship types covered — ALL TEN the ontology declares: contains, exports, extends, implements, overrides,
// instantiates, calls, uses, references, imports. MEASURED this round over the 13 expectation-paired fixture
// sources (the gate's own discovery rule): contains 175, exports 93, calls 42, references 36, uses 11,
// imports 11, overrides 10, implements 8, extends 7, instantiates 1. CORRECTION RECORDED, NOT APPENDED: this
// header said "NO uses (C# family emits none)" and listed SEVEN kinds until the exports/uses wave — true when
// the lane mirrored the C# family, false from the moment the wave landed; the counts above are re-measured.
// Where docs, spec, fixtures and validations live: docs/analyzers/real-fsharp-analyzer.md and
// docs/analyzers/fsharp.md (surface table) · script/m14/spec/fsharp-completeness.json ·
// validation/m14/fixtures/fsharp/** · `bun run script/m14/run-fixtures.ts --lang fsharp`.
// CO-EDIT WHEN THIS FILE CHANGES: the spec's node-type buckets · the fixtures pinning a changed edge · both
// docs · script/m14/differential.ts (`deriveFsharpEdges` — the TRUTH side; an emission the oracle does not
// derive lands as MISSING/UNEXPLAINED) · script/m14/completeness-inventory.ts (`fsharp` LANG_CONFIG, perfKey
// "fsharp:csharp") · src/ast/engine.ts (getAnalyzer + wasm) · src/ast/language-detection.ts (`.fs`/`.fsi`/
// `.fsx`) · the C# sibling src/ast/real-csharp-analyzer.ts.
// Grammar: tree-sitter-fsharp (wasm/tree-sitter-fsharp.wasm; engine.ts resolves node_modules/tree-sitter-fsharp).

import type { Node } from "web-tree-sitter"
import * as path from "node:path"
import { existsSync } from "node:fs"
import { ASTEngine } from "./engine"

/** THE PROJECT ROOT OF A FILE, DISCOVERED BY WALKING UP TO THE NEAREST `.git` — the DART
 *  SIBLING'S RULE (src/ast/real-dart-analyzer.ts:531-554), used for the same reason and with
 *  the same cache. IT EXISTS FOR ONE REASON: A `part_of` TARGET IS A PROJECT-RELATIVE PATH,
 *  and the caller that can say WHICH PROJECT a file is in is the one that knows the root.
 *  PRODUCTION SAYS IT (pool-worker.ts:2041-2072 hands every analyzer `{ projectRoot }`); a
 *  FIXTURE DOES NOT, and without the walk the fixture could not exercise the rule at all.
 *  The walk is a filesystem READ of a directory marker, never of source text — the analyzer's
 *  purity claim ("pure AST, no regex on source text") is untouched. */
const FSHARP_PROJECT_ROOT_CACHE = new Map<string, string | null>()
function fsharpProjectRootOf(filePath: string): string | null {
  const start = path.dirname(path.resolve(filePath))
  const seen: string[] = []
  let dir = start
  for (let i = 0; i < 64; i++) {
    const cached = FSHARP_PROJECT_ROOT_CACHE.get(dir)
    if (cached !== undefined) {
      for (const d of seen) FSHARP_PROJECT_ROOT_CACHE.set(d, cached)
      return cached
    }
    seen.push(dir)
    if (existsSync(path.join(dir, ".git"))) {
      if (FSHARP_PROJECT_ROOT_CACHE.size > 20000) FSHARP_PROJECT_ROOT_CACHE.clear()
      for (const d of seen) FSHARP_PROJECT_ROOT_CACHE.set(d, dir)
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  if (FSHARP_PROJECT_ROOT_CACHE.size > 20000) FSHARP_PROJECT_ROOT_CACHE.clear()
  for (const d of seen) FSHARP_PROJECT_ROOT_CACHE.set(d, null)
  return null
}
// THE BINDING SEPARATOR, IMPORTED RATHER THAN SPELLED. Task-99: this file used a literal `#` in
// the binding spelling while its own comment (below) named `BINDING_SEP` as the convention — and
// `BINDING_SEP` is `"\u0000"` (types.ts:190). `incoming-rule.verifyBindingClaim` refutes a marked
// target with NO separator, so every one of this lane's local-binding edges was REFUTED for its
// SPELLING: fsharp `bindFAIL` 24,448, the fleet's only non-zero must-be-zero column, with
// `bindOK` 0. The dart and php analyzers already spell `` `${source}${BINDING_SEP}${name}` ``
// (real-dart-analyzer.ts:2801,3097 · real-php-analyzer.ts:3131).
import { BINDING_SEP } from "./types"

// F# console output + .NET Console — filtered like C#'s Console.WriteLine.
// NOTE: sprintf/sprintfn are string formatting (analog of string.Format),
// which the C# family KEEPS (e.g. calls:CompareTo:Compare). Only console
// output and Object leaf methods are filtered.
const FSHARP_CONSOLE_BUILTINS = new Set([
  "printfn", "printf", "eprintfn", "eprintf", "fprintfn", "fprintf",
  "Console.WriteLine", "Console.Write", "Console.Error.WriteLine", "Console.Error.Write",
])
const OBJECT_LEAF_METHODS = new Set(["ToString", "GetHashCode", "Equals", "GetType", "ReferenceEquals"])

/**
 * Which side of an F# pipeline operator carries the CALLEE, for the operators that APPLY a
 * function. FS-A6: `x |> f` applies `f`, `f <| x` applies `f`, and the composition
 * operators (`>>` `>>>` `>=>` `<<<`) are absent because they build a function and call
 * neither — measured, not taste: 13 bare `>>` in a 300-file corpus draw, every one of them
 * excluded on that ground.
 *
 * Keys are the `infix_op` TOKEN texts the grammar emits, so this is a lookup on a token and
 * not a pattern over source text.
 */
const PIPELINE_CALLEE_SIDE = new Map<string, "left" | "right">([
  ["|>", "right"],
  ["|>>", "right"],
  [">>=", "right"],
  ["<|", "left"],
  ["<<", "left"],
])

/**
 * The node types that can BE a callee name, used by the pipeline branch.
 *
 * MEASURED 2026-10-10 (FS-D30). The pipeline branch used to take the callee from the
 * `infix_expression`'s DIRECT children that are name-like, and then pick `named[last]` for a
 * right-pipe. That is correct for `xs |> ignore` — the right operand IS a bare name — and wrong for
 * `xs |> f(y)`, where the parser puts an `application_expression` on the callee side:
 *
 *     completions |> Array.exists(fun a -> a)
 *       child[0] long_identifier_or_op  "completions"
 *       child[1] infix_op               "|>"
 *       child[2] application_expression "Array.exists(fun a -> a)"   <- not name-like
 *
 * so `named` held only the LEFT operand and `named[named.length - 1]` emitted `calls -> completions`
 * — an edge naming the pipeline's INPUT as the callee of a call it does not make, contradicting this
 * file's own `PIPELINE_CALLEE_SIDE` map three lines up.
 *
 * Found by the differential, not by reading: the truth arm derives no such edge, so the row surfaced
 * as `unexplained` at `Tests.LanguageService.Completion.fs:215`. Sized on a 400-file even stride:
 * 5,241 pipe nodes, 4,782 with a bare-name callee side (correct today) and **459 with a
 * non-name-like callee side** — `validation/m14/fixtures/fsharp/measurements/pipeline-callee-size.txt`.
 */
const PIPELINE_NAMEY = new Set(["long_identifier", "identifier", "long_identifier_or_op", "dot_expression"])

/**
 * Every grammar node that WRAPS a written type in F#. The name is always inside one of
 * these; the POSITION is decided by the wrapper's parent. Read off the wired grammar
 * (script/m14/tmp/fs001-shape-census.ts over 400 real files) and from
 * `grammars/tree-sitter-fsharp/fsharp/grammar.js` — the list is F1-audited against the
 * wasm, so a grammar rename shows up as an unknown node type rather than as a silent 0.
 */
/** The three node kinds that can own a declaration, as a named test rather than a closure. */
const isCallableOwnerNode = (n: Node): boolean =>
  n.type === "member_defn" || n.type === "function_or_value_defn" || n.type === "additional_constr_defn"

/**
 * FS-P9 — every clause body a `type_definition` can hold. F# writes a mutual type group as
 * ONE `type_definition` whose children are one clause body PER TYPE (`and` is a token, not a
 * node), so this set is the list of node types that can BE a type unit inside a group.
 *
 * `type_declaration` is in it because a bodyless clause is still a declaration: Deedle writes
 * `type Address = int64<address>` + `and [<Measure>] address`, where the second clause is the
 * unit of measure other files annotate with. It is the SAME node type the FS-D8 forward
 * declaration uses, which is why it counts only when the definition holds more than one
 * clause: a lone `type Surface` is a forward declaration of ONE type, not a group.
 */
const TYPE_CLAUSE_TYPES = new Set([
  "type_abbrev_defn",
  "anon_type_defn",
  "record_type_defn",
  "union_type_defn",
  "interface_type_defn",
  "enum_type_defn",
  "delegate_type_defn",
  "type_declaration",
])

const TYPE_WRAPPER_NODES = new Set([
  "simple_type", "postfix_type", "paren_type", "generic_type", "function_type",
  "compound_type", "list_type", "atomic_type", "nullable_type", "struct_type",
  "static_type", "byref_type", "flexible_type", "types",
])

/**
 * FS-P7-1. EVERY TARGET CARRIES THE REASON IT IS SPELLED THE WAY IT IS — on the labels
 * whose spelling rule had never been named.
 *
 * Pass 6 gave `calls`, `uses` and `instantiates` a `targetResolution` class and the
 * discarded qualifier beside it, and the residual became a table instead of a number. The
 * other six labels kept their own residual unexplained: `contains` 17,297 loose targets,
 * `references` 37,064, `imports` 12,730, `extends` 722, `implements` 446, `overrides` 666
 * (3,000-file draw, `.tmp-probe/fs-verdict-state/rows-pass6c-meta.ndjson`). Those are not
 * smaller numbers than pass 6's — they are numbers with no reason recorded next to them,
 * which is the one thing this lane's standard forbids.
 *
 * WHY MARKERS AND NOT CLASSES. The two halves of the question are answered at different
 * times: the KIND of name is known when the edge is emitted, whether THIS FILE declares it
 * is not — a type declared further down the file is still this file's declaration, and a
 * mid-walk membership test would call it external. So the walk marks the kind and the
 * reason is decided once, after the walk, from the complete published set. A marker that
 * survives to the result would be a defect, and a mutant pins exactly that.
 *
 * Module scope rather than inside `analyze()` because `extractDeclaredTypeRefs` is a
 * separate method and reaches the declared-type arm, which is one of the four sites. A
 * first draft declared them inside `analyze()` and the fixtures caught it immediately
 * (`ReferenceError: UNRESOLVED_TYPE is not defined`) — the kind of failure a fixture gate
 * is FOR, recorded here because "it typechecks" would not have caught it either way.
 */
const UNRESOLVED_TYPE = "unresolved-type-name"
const UNRESOLVED_NAMESPACE = "unresolved-namespace"
// `overrides` asks the same question about a different name — the TYPE the overridden member
// belongs to (`Animal` in `Animal.Speak`), not the member, because the member is published by
// this file BY CONSTRUCTION (it is the one being declared) and testing it would answer
// "in-file" for every override in the corpus. Two markers rather than one because the two
// forms are different facts: `interface-member` is the interface the keyword implements,
// `base-member` is an inherited base member.
const UNRESOLVED_BASE = "unresolved-base-name"
const UNRESOLVED_INTERFACE = "unresolved-interface-name"

/**
 * FS-P7-2, THE SECOND CORRECTION, and it was found by auditing a 307-edge gap rather than by
 * reading the rule. A written TYPE may only be spelled as an identity held by a TYPE.
 *
 * The first draft spelled a declared type's target as `fqnOfName.get(leaf)` — the identity of
 * the FIRST symbol the file published under that name, whatever kind it was — and F# files
 * publish DU CASES and members under names that are also type names. Measured on
 * `Deedle/src/Deedle.Parquet/VirtualParquetSource.fs`, whose union `ParquetColumnKind` has the
 * cases `DateTimeOffset` and `DateTime`: `Let ... : DateTimeOffset` and a `DateTime` parameter
 * came out as references to `ParquetColumnKind.DateTimeOffset` and `ParquetColumnKind.DateTime`.
 * That is a DETERMINATE edge naming a declaration that is definitively NOT the type the source
 * wrote — worse than the ambiguous leaf it replaced, because the wrongness is now asserted
 * rather than left open. The store's strategy 2 resolves the leaf by NAME, so the leaf can
 * still land on a case; the fqn form cannot, and the fix is to look the identity up in a map
 * that only types are allowed to fill.
 *
 * Which kinds can BE the type an annotation writes: a class/record/anon type, an interface, a
 * union, an abbreviation/measure/delegate. NOT a namespace or a module (a written type's leaf
 * is a type, never the unit that holds it), and not an `enum_member`/`method`/`property` — the
 * three that produce exactly the mis-join above.
 */
const TYPE_POSITION_KINDS = new Set<string>([
  ASTEngine.SymbolKind.Class,
  ASTEngine.SymbolKind.Interface,
  ASTEngine.SymbolKind.Enum,
  ASTEngine.SymbolKind.Type,
  ASTEngine.SymbolKind.Struct,
  ASTEngine.SymbolKind.Delegate,
])


export class RealFsharpAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []
    /**
     * The names this run has PUBLISHED as symbols, maintained as they are pushed.
     *
     * This is the invariant every relationship's SOURCE must satisfy, and it is the one the
     * structural rules kept getting wrong in both directions. A guard that refuses whenever a
     * declaration is nested refuses `isAttribute -> FSharpEntity`, where the binding is a
     * local inside an active pattern and IS published as a function; a guard that does not
     * refuse publishes `argInfo -> ArgReprInfo`, where the binding is a local and is NOT
     * published. Neither defect is visible downstream, because one edge resolves to a
     * perfectly good symbol and the other resolves to nothing, and a graph consumer has no way
     * to tell those apart from the shape of the edge alone.
     *
     * Membership is exact because a declaration's symbol is pushed when the walk visits the
     * declaration, and the declared-type emission happens while walking its SUBTREE — so by
     * the time a name is tested, the walk has already published it if it publishes it at all.
     */
    const publishedNames = new Set<string>()
    /**
     * FS-P3-1. PUBLISH THE QUALIFIED NAME THE `overrides` EDGE ALREADY USES.
     *
     * `overrides` is the only relationship this lane emits whose SOURCE it deliberately
     * qualifies, because a bare member name is ambiguous and the analyzer knows it:
     *
     *     type Disposable() =
     *         interface System.IDisposable with
     *             override this.Dispose() = ()
     *
     * emits `overrides Disposable.Dispose -> IDisposable.Dispose`, and `Dispose` on its own
     * would bind to whichever `Dispose` the consumer happened to find first.
     *
     * That qualified spelling was, until this rule, a spelling the lane never PUBLISHED.
     * Measured on Grace/src/Grace.Actors/AccessControl.Actor.fs:
     *
     *     stored symbol : name="OnActivateAsync"  qualifiedName="OnActivateAsync"  ownerName="AccessControlActor"
     *     emitted edge  : source="AccessControlActor.OnActivateAsync"
     *
     * The endpoint matches the stored `qualifiedName` at 0 of 63 `overrides` edges in a
     * 400-file stride sample of the 11,809-file fsharp population. `pool-worker.ts:870`
     * derives the stored value as `s.qualifiedName || s.metadata?.fqn || (s.scope ? … : name)`,
     * and this analyzer set none of the three, so `qualified_name` collapsed to the bare name
     * for every owned symbol in the language.
     *
     * Why that is a defect and not a cosmetic difference: `src/ast/parallel-indexer.ts`
     * documents its own resolution strategies as "a bare `name`, a `qualified_name`
     * (`Owner.member`), or — for a dotted target — everything after the first `.`", and
     * `brain_relationship.source_external` is JOINed against `brain_symbol.qualified_name`.
     * An edge whose endpoint the store publishes under a DIFFERENT key than the symbol's own
     * is an edge the reverse walk cannot bind, so `bb_impact` on an F# member that overrides
     * something cannot reach the things that override it, and `src/lsp/impact.ts` — which
     * obtains reverse edges by scanning outgoing edges and matching targets — inherits the
     * miss without any way to report it.
     *
     * `metadata.fqn` is the field that formula already reads, it is what the C# family sets
     * for the same purpose (`real-csharp-analyzer.ts` `fqn: fullName`), and nothing else in
     * this repository reads it for fsharp, so the change is additive. It is minted HERE, in
     * the single funnel every one of the 15 mint sites passes through, so the edge spelling
     * and the published spelling cannot drift apart again — which is the failure mode, not the
     * individual field, that this closes.
     *
     * Minted only when there is an owner: with no owner the store's own fallback already
     * yields `name`, so writing it would add a field that says nothing.
     */
    // FS-P5-1. EVERY EDGE WHOSE SOURCE IS A SCOPE NAMES THAT SCOPE THE WAY THE FILE
    // PUBLISHED IT.
    //
    // FS-P4-1 took the `calls`/`instantiates` sources to the published fqn and measured
    // source-determinacy 52.5% -> 71.6% on a 3,000-file A/B. Six labels were left behind,
    // and their sources are not spellings the walk has to invent: `references`,
    // `imports`, `uses` and the object-expression `implements` source the ENCLOSING SCOPE,
    // while `extends`/`implements` source the TYPE BEING DECLARED — every one of them a
    // symbol this file publishes, whose fqn `publish` mints a few lines above the emission.
    //
    // The lookup mirrors the store's own construction (`parallel-indexer.ts:3238`,
    // `if (!nameToSymbol.has(nm)) nameToSymbol.set(nm, s)`): FIRST-WINS per name, so two
    // same-named declarations in one file resolve the same way here as there. A name with
    // no entry returns itself, which is exactly today's spelling — the change is additive
    // in the same sense FS-P4-1 is.
    //
    // Why the first-wins rule rather than "only when unambiguous": the alternative makes
    // the spelling depend on a property of the whole file (how many declarations share the
    // name) at a point in the walk where only a prefix has been seen. Determinism beats a
    // sharper rule that cannot be evaluated where it is needed, and the store applies the
    // same first-wins choice to the same name.
    const fqnOfName = new Map<string, string>()
    const qualifyScope = (n: string | undefined): string | undefined =>
      n === undefined ? undefined : (fqnOfName.get(n) ?? n)

    // FS-P5-2/3/4. THE TARGET: SPELLED EXACTLY WHEN THIS FILE CAN PROVE WHICH SYMBOL IT
    // NAMES, AND ALWAYS WITH A MACHINE-READABLE REASON WHEN IT CANNOT.
    //
    // FS-P4 moved the SOURCE side and measured 52.5% -> 71.6% determinate; FS-P5-1 moved the
    // scope-sourced sources and took it to 76.8%. The TARGET side is the larger mass and it
    // was untouched, so a consumer asking "which declaration does this edge name?" got a leaf
    // and nothing else — the qualifier the source code WROTE was read and discarded at the
    // emission site.
    //
    // Two changes, and the split between them is the whole point:
    //
    //   1. When the file can PROVE the identity, the target IS that identity. A name this
    //      file published resolves through `fqnOfName`, whose spelling is what the store
    //      registers as `qualified_name` (pool-worker.ts:1026 reads `metadata.fqn`, minted in
    //      `publish`). `this.M` is provable for the same reason — the enclosing type is a
    //      symbol this file publishes — and `base.M` is provable when the base type is.
    //      Nothing here infers: every branch either reads a published identity or declines.
    //
    //   2. When the file CANNOT prove it, the edge keeps its leaf AND carries the reason: the
    //      discarded qualifier, and a `targetResolution` class. That is what makes the
    //      residual auditable instead of unexplained, and it is the input the resolution
    //      layer needs — `Seq.map` cannot be recovered from `map` by any amount of guessing
    //      downstream, which is why preserving the qualifier is the analyzer's half of the
    //      join rather than the joiner's.
    //
    // THE IDENTITY IS `${IMMEDIATE OWNER NAME}.${NAME}`, NOT THE PARENT'S FULL PATH, and that
    // is the store's own definition rather than a simplification: `publish` mints
    // `metadata.fqn` from `ownerName`, which is the innermost scope segment, so a member of
    // `Full.Name.Space.Shape` is published as `Shape.Describe` (verified on the lane's own
    // fixture dump: `method Describe owner=Shape fqn=Shape.Describe`). That is why `this.M`
    // is spelled with the enclosing type's NAME and not with its fqn — the fqn of the type is
    // a longer path that no member symbol is ever registered under.
    // FS-P6-2. THE IDENTITIES THIS FILE PUBLISHED, as a SET.
    //
    // `fqnOfName` answers "what is the identity of the name `Foo`", which is the question a
    // ONE-segment target asks. The question a DOTTED target asks is the other direction: "is
    // the path I just read an identity this file actually published" — and that is a
    // membership test, not a lookup, so it needs the values as a set. Both maps are filled
    // in the same funnel (`publish`), so the two halves cannot drift.
    const publishedQnames = new Set<string>()
    /**
     * FS-P7-2. THE IDENTITY OF A NAME, RESTRICTED TO THE SYMBOLS A WRITTEN TYPE CAN NAME.
     * Filled in the same funnel as `fqnOfName` (the two cannot drift), but only a
     * class/interface/union/abbreviation/delegate is allowed to answer — see
     * TYPE_POSITION_KINDS for the measured mis-join the unfiltered map produced.
     */
    const typeFqnOfName = new Map<string, string>()
    /**
     * FS-P7-2, the same filter on the REASON side. `publishedNames` holds every name the file
     * published, so "is this type name mine" answered yes for a DU case named `DateTimeOffset`
     * while the file declared no such type — the class said `in-file-declaration` about a
     * declaration that is not a declaration of a type. A name is only this file's TYPE when a
     * TYPE-kind symbol published it.
     */
    const publishedTypeNames = new Set<string>()
    /**
     * FS-P6-1/3. A PATH IS A PATH ONLY IF EVERY SEGMENT IS A NAME.
     *
     * F# writes a fluent call as a `dot_get` whose TEXT is the whole chain:
     * `ArgumentParser.Create<'Template'>().ToParseResults` is one node. The walk read its text
     * as a callee path, split on `.`, and the head (`ArgumentParser`) happened to be a name
     * this file published, so the `in-file-qualified` branch below returned THE ENTIRE CHAIN
     * as an edge target. Measured on the 3,000-file draw: 514 `calls` targets are not names
     * at all — `ArgumentParser.Create<'Template'>().ToParseResults`, `parser.PrintUsage().Contains`,
     * `router.GetRoute(model).TrimStart`, `Existential.FromType(t).Accept` — and a target that
     * is not a name can never be a store identity. The called MEMBER is the last name in the
     * chain, on a receiver whose type the file cannot know, which is the receiver-value class
     * and not a path at all.
     */
    // IS A WRITTEN PATH SEGMENT A NAME? A character walk, not a regex — the lane rule is
    // absolute and `script/m14/no-regex-gate.sh` enforces it mechanically.
    //
    // The four forms, and each one was read off the grammar's own output rather than guessed:
    //   ``…``   a backtick-quoted identifier            `let ``type`` x`
    //   `…`     a single-backtick-quoted identifier     rare, but the grammar produces it
    //   X       a plain identifier                      `[A-Za-z_][A-Za-z0-9_']*`
    //   (op)    an operator NAME in parentheses         `(=)`, `(+)`, `(>>=)`
    //
    // The operator arm is not a detail. F# names an operator FUNCTION by writing it in
    // parentheses — `(=)`, `(+)`, `(-)` — and its grammar hands exactly that to this branch,
    // because the callee node for those is a `long_identifier_or_op`. Without the arm, the
    // 3,000-file draw's 393 operator applications were classified `not-a-name` — the class that
    // exists for a target no store can hold — when `(=)` is a name the store can hold as well
    // as any other. Measured after the arm was added: 393 edges move from `not-a-name` to
    // `bare-external` and the class is empty. Whitespace and parentheses are excluded inside
    // the operator on purpose: `(ctr CancellationToken.None).AsTask` is a call CHAIN whose
    // receiver is an application, not an operator name.
    //
    // WHY A WALK RATHER THAN A NODE-TYPE TEST: this predicate answers a question about a
    // STRING the source wrote, and the four forms are string shapes. Reading them off the tree
    // would need a node type per form and would still have to fall back to the text for the
    // quoted forms — and a node type the grammar does not emit for one of them is a dead
    // branch this lane's own census exists to catch (`handled_verified` in the lane spec lists
    // every node type with the count that proves the rule is LIVE). A character walk has no
    // such failure mode: every branch below is exercised by the corpus, and the behaviour is
    // pinned by `fsharp/call-target-spelling` and `fsharp/name-surface`.
    const isIdentStart = (c: string): boolean =>
      (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_"
    const isIdentPart = (c: string): boolean =>
      isIdentStart(c) || (c >= "0" && c <= "9") || c === "'"
    /** `\s` as the operator arm means it: the ASCII whitespace plus the Unicode spaces. */
    const isSpaceChar = (c: string): boolean => {
      if (c === " " || c === "\t" || c === "\n" || c === "\v" || c === "\f" || c === "\r") return true
      if (c === "\u00a0" || c === "\ufeff" || c === "\u1680" || c === "\u2028" || c === "\u2029" || c === "\u202f" || c === "\u205f" || c === "\u3000") return true
      const cp = c.codePointAt(0) ?? 0
      return cp >= 0x2000 && cp <= 0x200a
    }
    const isName = (s: string): boolean => {
      if (s.length === 0) return false
      // backtick-quoted, the DOUBLE form first: its inner text may not contain a backtick, so
      // it is not reachable through the single form (` ``X`` ` has inner `` `X` `` there).
      if (s.startsWith("`")) {
        const q = s.length >= 4 && s.startsWith("``") ? 2 : 1
        const close = q === 2 ? "``" : "`"
        if (s.length < q * 2 || !s.endsWith(close)) return false
        return !s.slice(q, s.length - q).includes("`")
      }
      // an operator NAME: `(op)`, at least one character inside, no whitespace and no nested
      // parentheses — `(ctr CancellationToken.None).AsTask` is a chain, not an operator.
      if (s.startsWith("(")) {
        if (s.length < 3 || !s.endsWith(")")) return false
        for (let i = 1; i < s.length - 1; i++) {
          const c = s[i]
          if (c === "(" || c === ")" || isSpaceChar(c)) return false
        }
        return true
      }
      // a plain identifier
      if (!isIdentStart(s[0])) return false
      for (let i = 1; i < s.length; i++) if (!isIdentPart(s[i])) return false
      return true
    }
    const localNames = new Set<string>()
    const openedScopes = new Set<string>()
    /**
     * FS-P6-3. THE QUALIFIER THE SOURCE WROTE, WHEN THE SOURCE WROTE ONE.
     *
     * FS-P5 spelled a target exactly when this file could prove the identity by itself, and
     * kept the bare leaf otherwise — and the bare leaf is where 73% of the label's target
     * mass sat: on the 3,000-file draw `calls` targets are determinate for 24.1% of its
     * 210,678 edges, and the two classes that dominate the rest are
     * `external-type-or-module` (68,453 edges, 18.0% determinate) and `bare-external` (65,296,
     * 13.3%). The first of those is not a limitation of the corpus: it is a qualifier the
     * SOURCE WROTE and this analyzer READ AND DISCARDED. `Seq.map`, `Array.fold`,
     * `Unchecked.compare`, `DotNet.exec` were all emitted as `map`, `fold`, `compare`, `exec`.
     *
     * The store resolves `target_external` with three strategies, in order
     * (`src/ast/parallel-indexer.ts` 4282/4305/4357, read from the source rather than assumed):
     *
     *   S1  target_external == qualified_name            (exact, any number of dots)
     *   S2  target_external == name AND name unique      (requires NO dot)
     *   S3  dotted -> name == everything after the FIRST dot, MIN(id) among matches
     *
     * so for a TWO-segment target S3's tail IS the leaf and the candidate set is IDENTICAL to
     * the bare leaf's — while S1 becomes reachable. That is why `${qualifierLeaf}.${leaf}` is
     * provably never worse than the leaf, and it is why this rule is a spelling change rather
     * than a guess: it does not ask the store for anything the leaf could not, it adds the
     * exact-identity hit that only the qualified form can get.
     *
     * MEASURED, on the 3,000-file draw against the full-corpus pool (.tmp-probe/fs-p6-price.py,
     * rows-pass5-meta.ndjson): respelling the discarded qualifier into `${last}.${leaf}` moves
     * `calls`/`instantiates` targets from non-determinate to determinate on **11,709** edges and
     * the other way on **1,821** — and every one of the 11,709 is a `q_cnt == 1` hit, i.e. an
     * identity exactly one symbol in the corpus holds (`build` -> `StringExpr.build`,
     * `fold` -> `Array.fold`, `exec` -> `DotNet.exec`, `compare` -> `Unchecked.compare`).
     * The 1,821 the other way are all the same shape and are NOT a real loss: they are cases
     * where the BARE name coincides with some symbol's `qualified_name` (a module-less script
     * binding named `choose`) while the qualified form names a real identity held by two
     * symbols (`seq.fs` and `seq.fsi` both declare `Seq.choose`, which is what a `.fsi` file
     * IS) — the store still attaches those through S1, and the identity it attaches them to is
     * the one the source wrote.
     *
     * The qualifier is used only when its last segment is MODULE-LIKE (capitalised). That is
     * not a style rule, it is the measured difference between the two classes the same code
     * path produces: applying the same respelling to the `receiver-value` class (a lowercase
     * qualifier, i.e. a value whose member is being called — `parser.PrintUsage`) LOSES 510
     * edges against the 109 it gains, because a value's name is not any symbol's owner and the
     * qualified form can never be an identity. `x.M` is receiver-bound and stays the leaf, with
     * the exact same `targetQualifier` it carries today.
     */
    const moduleLike = (seg: string | undefined): boolean =>
      !!seg && seg.length > 0 && seg[0] >= "A" && seg[0] <= "Z"
    const targetSpelling = (
      written: string,
      enclosingType: string | undefined,
      /**
       * FS-P6-4. WHERE THE NAME IS BEING USED, because the same written path means different
       * things in the two positions and the store keys them differently.
       *
       * `member` — a CALLEE (`calls`). A member of a type or module is stored as
       * `${ownerName}.${name}`, where `ownerName` is the innermost scope segment, so the
       * last two segments of a written path are the shape the store holds. `Fabulous.Imaging.Image.Map`
       * is stored as `Image.Map`, and `Microsoft.FSharp.Collections.Seq.map` as `Seq.map`.
       * `instantiates` does NOT ask for this position even though it is emitted from the same
       * expression shape: `new X()` names a TYPE, and the measurement agrees (`instantiates`
       * rows in fs-p6-price.py: 0 edges bought, 11 lost by the two-segment respelling).
       *
       * `type` — a written TYPE or attribute name. Here the FULL path is the shape the store
       * holds, because a type declared inside a namespace carries the whole namespace as one
       * scope segment: this lane publishes `Bolero.Test.Client.Main.Page` (verified on the
       * corpus: the module symbol's own name is the dotted header, so `Page`'s owner is
       * `Bolero.Test.Client.Main`). Truncating that to `Main.Page` would name nothing, which is
       * why the two positions get different answers instead of one compromise answer.
       */
      position: "member" | "type" = "type",
    ): { target: string; resolution: string; qualifier?: string } => {
      const parts = written.split(".")
      if (!parts.every(isName)) {
        const last = [...parts].reverse().find(isName)
        if (last) {
          // the qualifier is everything before the last name, minus the separator dot that
          // produced it. A trailing-dot test, not a regex: `replace(/\.$/, "")` was the
          // second half of this lane's last regex literal.
          const prefix = written.slice(0, written.lastIndexOf(last))
          const cut = prefix.endsWith(".") ? prefix.slice(0, -1) : prefix
          return { target: last, resolution: "call-chain-receiver", ...(cut ? { qualifier: cut } : {}) }
        }
        return { target: written, resolution: "not-a-name" }
      }
      const leaf = parts[parts.length - 1] || written
      if (parts.length === 1) {
        if (localNames.has(written)) return { target: written, resolution: "local-binding" }
        const fqn = fqnOfName.get(written)
        return fqn ? { target: fqn, resolution: "in-file-declaration" } : { target: written, resolution: "bare-external" }
      }
      const head = parts[0]
      const qualifier = parts.slice(0, -1).join(".")
      if (head === "this") {
        return enclosingType
          ? { target: `${enclosingType}.${leaf}`, resolution: "self-member" }
          : { target: leaf, resolution: "self-member-unknown-type", qualifier }
      }
      if (head === "base") {
        const b = enclosingType ? baseTypes.get(enclosingType) : undefined
        const bLeaf = b ? b.split(".").pop() : undefined
        return bLeaf && fqnOfName.has(bLeaf)
          ? { target: `${bLeaf}.${leaf}`, resolution: "base-member" }
          : { target: leaf, resolution: "base-member-external", qualifier }
      }
      // The identity is PROVABLE when the path as written is one this file published. This is
      // the FS-P5-2 rule with FS-P6-2's correction: FS-P5 asked whether the FIRST SEGMENT was a
      // name this file knew, which is a different question and answers yes for `Foo.member`
      // where only `Foo` is local, and — before FS-P6-1 — for a call chain whose head was local.
      if (publishedQnames.has(written)) return { target: written, resolution: "in-file-qualified", qualifier }
      const penult = parts[parts.length - 2]
      if (position === "member") {
        if (parts.length > 2 && moduleLike(penult)) {
          const two = `${penult}.${leaf}`
          if (publishedQnames.has(two)) return { target: two, resolution: "in-file-qualified", qualifier }
          return { target: two, resolution: "module-member", qualifier }
        }
        if (parts.length === 2 && moduleLike(head)) {
          return {
            target: written,
            resolution: openedScopes.has(head) ? "opened-module" : "external-type-or-module",
            qualifier,
          }
        }
        // A lowercase qualifier is a VALUE, not a type or module: no symbol is ever stored as
        // `value.member`, so the honest target is the member's own name with the receiver
        // recorded beside it. Measured (fs-p6-price.py): respelling these LOSES 4.7 edges for
        // every one it gains.
        return { target: leaf, resolution: "receiver-value", qualifier }
      }
      if (openedScopes.has(head)) return { target: leaf, resolution: "opened-module", qualifier }
      return { target: leaf, resolution: moduleLike(head) ? "external-type-or-module" : "receiver-value", qualifier }
    }

    /**
     * THE BINDING SPELLING — a call whose callee names a LOCAL gets `<callable>#<binding>`.
     *
     * F# publishes no symbol for a `let` inside a body (FSD12), so a callee spelled with a local's
     * name names a BINDING and not a declaration. The convention for saying so is the separator
     * spelling (`BINDING_SEP`, `src/ast/types.ts`), carried by the `localBinding` claim that
     * `incoming-rule.ts` verifies.
     *
     * WHY THE CLAIM CANNOT VOUCH FOR ITSELF, stated here because a reader who sees ~35,559 edges
     * newly claimed will otherwise assume the gate checked them. With the separator the target names
     * no declaration, so `classifyEdge`'s `decls > 0 -> bindingRefuted` branch can never fire and
     * `verifyBindingClaim` sees the separator: the claim checks "is this spelled as a binding?", NOT
     * "is it really one?". The evidence therefore has to come from somewhere else, and it does — the
     * class was spot-checked against source before this landed (`let asIndex` Deedle
     * VirtualFrame.fs:1034 called :1035; `let rec normalize` JsonGenerator.fs:163 called
     * :167/172/179/190; `let asLong` VirtualFrame.fs:88 called :93), and the differential's truth arm
     * derives the same spelling by an INDEPENDENT walk (`script/m14/fsharp-truth-oracle.ts`).
     *
     * The source is the same expression the edge already uses (`callOwnerQualified ?? callOwner`), so
     * the owner in the spelling and the edge's source cannot disagree.
     */
    const bindingSpelled = (
      owner: string | undefined,
      spelled: { target: string; resolution: string; qualifier?: string },
    ): { target: string; resolution: string; qualifier?: string; localBinding?: true } =>
      spelled.resolution === "local-binding" && owner
        ? { ...spelled, target: `${owner}${BINDING_SEP}${spelled.target}`, localBinding: true }
        : spelled

    const publish = (s: ASTEngine.UniversalSymbol): void => {
      if (s?.name) publishedNames.add(s.name)
      const owner = String(s?.ownerName ?? "")
      if (owner.length > 0 && s?.name) {
        const metadata = (s.metadata ?? {}) as Record<string, any>
        if (metadata.fqn === undefined) metadata.fqn = `${owner}.${s.name}`
        s.metadata = metadata
      }
      if (s?.name && !fqnOfName.has(s.name)) {
        const metadata = (s.metadata ?? {}) as Record<string, any>
        const fqn = typeof metadata.fqn === "string" ? metadata.fqn : s.name
        fqnOfName.set(s.name, fqn)
        publishedQnames.add(fqn)
      }
      // FS-P7-2: the TYPE-ONLY map, same first-wins rule and the same funnel, filtered by the
      // kinds a written type can actually name. See TYPE_POSITION_KINDS for the mis-join that
      // the unfiltered map produced on real code.
      if (s?.name && TYPE_POSITION_KINDS.has(String(s.kind ?? ""))) {
        publishedTypeNames.add(s.name)
        if (!typeFqnOfName.has(s.name)) {
          const metadata = (s.metadata ?? {}) as Record<string, any>
          const fqn = typeof metadata.fqn === "string" ? metadata.fqn : s.name
          typeFqnOfName.set(s.name, fqn)
        }
      }
      symbols.push(s)
    }

    // M59.A7 dim 8 (the haskell precedent): every relationship carries the line
    // of the node that BEARS it, dedup-keyed WITH that line so two same-shape
    // sites on different lines are two facts. `line_number` is payload, never
    // identity (M12 identity is file:type:sourceId:targetId).
    const seenRels = new Set<string>()
    const pushRel = (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      confidence: number,
      metadata: Record<string, any> = {},
      line?: number,
    ) => {
      const hasLine = typeof line === "number" && Number.isInteger(line) && line > 0
      const key = `${source}|${type}|${target}|${hasLine ? line : ""}`
      if (seenRels.has(key)) return
      seenRels.add(key)
      relationships.push({
        source,
        target,
        type,
        confidence,
        metadata,
        ...(hasLine ? { line_number: line as number } : {}),
      })
    }
    /** 1-based line of a node, or undefined — never 0 (M59.O2). */
    const lineOf = (node: Node | null | undefined): number | undefined => {
      if (!node) return undefined
      const line = node.startPosition.row + 1
      return line > 0 ? line : undefined
    }

    // Per-type abstract member names — used to dedup abstract+default pairs
    // (F# `abstract member X` + `default _.X()` is ONE logical member).
    const abstractMemberNames = new Set<string>()
    // baseType per type name (from `inherit Base()`) — for qualified overrides.
    const baseTypes = new Map<string, string>()

    // FS-D2: every type name this file DECLARES with a real `type X = …` body — i.e.
    // NOT by `type X with …`. An extension is not a declaration: F#'s `type X with` is
    // the language's only way to add members to a type declared elsewhere, so
    // counting it as a declaration would let two extensions of an undeclared type mint
    // it twice, and would let an extension that PRECEDES its own `type X = …` (4 of
    // the corpus's 68 extensions do) suppress the real declaration. Collected up front
    // so the rule is order-independent.
    const typeNamesDeclaredInFile = this.collectDeclaredTypeNames(rootNode)
    // FS-D17: the scope a FILE declares, read before the walk rather than during it.
    const fileScope = this.collectFileScope(rootNode)
    // FS-D2: which names a `type X with …` has ALREADY published as the file's own
    // declaration. Scoped to extensions on purpose — a general one-symbol-per-name set
    // would collapse an F# SIGNATURE file's forward declaration into its definition,
    // which script/m14/tmp/fs018-compare-dumps.ts reported as 30 dropped symbols
    // across 15 corpus files before the rule shipped.
    const typeExtensionsPublished = new Set<string>()

    // FS-D8: the names the EXPORT rule needs, filled while the walk visits them, so
    // the export pass costs no second traversal. A MODULE's members are importable by
    // `open`; a TYPE's are not — that asymmetry IS the exports-family ruling the
    // fixture runner's invariant states.
    const moduleNames = new Set<string>()
    const namespaceNames = new Set<string>()

    // FS-P4-1. THE EDGE SOURCE IS THE SYMBOL THE ANALYZER PUBLISHED, SPELLED THE WAY
    // THE ANALYZER PUBLISHED IT.
    //
    // `publish` above mints `metadata.fqn = ${ownerName}.${name}` for every owned
    // symbol, and `parallel-indexer.ts` derives the stored `qualified_name` from that
    // same field (pool-worker.ts:1026). The store ALSO registers `${scope}.${name}` as
    // a direct alias in `nameToSymbol` (parallel-indexer.ts:3247), which is the map
    // every edge source is looked up in FIRST — `nameToSymbol.get(sourceName)` —
    // before any fallback runs.
    //
    // So an edge whose source is `Owner.member` is an exact map HIT, while an edge
    // whose source is the bare `member` is a first-wins pick among every same-named
    // symbol in the batch (the map is built with `if (!nameToSymbol.has(nm))`,
    // i.e. whichever declaration the walk happened to emit first). The lane fixed
    // exactly this for `overrides` in pass 3 (FS-P3-1: 0.0% -> 100.0% source binding)
    // and left every other label bare, which is why `calls`, `uses`, `references`,
    // `contains`, `instantiates`, `extends`, `implements` and `imports` all still
    // carry owner names that name a DIFFERENT declaration whenever two declarations
    // in the project share a leaf.
    //
    // Measured on the full corpus (11,799 files, 1,162,163 edges; probe
    // .tmp-probe/fs-spelling-effect.py, which models strategy 1/2/3 from the store's
    // own SQL): source determinate by name 612,083 (52.7%) -> 826,450 (71.1%) when
    // the source is the published fqn, +214,367 edges. It is strictly additive: when
    // the qualified spelling is absent the store's leaf fallback returns exactly the
    // result the bare spelling gives today.
    //
    // It is carried as a SECOND variable rather than overloading `callOwner` because
    // `callOwner` is also read as a semantic test (`callOwner === "constructor"` for
    // constructor chaining) and as the key of `baseTypes`; only the edges' SOURCE
    // spelling changes.
    interface WalkFrame {
      node: Node
      scopePath: string[]
      callOwner: string | undefined // nearest enclosing function/method/constructor
      callOwnerQualified: string | undefined // the same owner, as the fqn `publish` mints
      bodyDepth: number // >0 => inside a function/member body (locals live here)
      /**
       * FS-P9. This frame is ONE CLAUSE of a mutual type group (`type A = … and B = …`)
       * and must be read as a type unit in its own right. See the type_definition
       * branch for the measurement that forced it: the group is ONE node, so reading the
       * declaration from the node named the FIRST clause and attributed every later
       * clause's members to it (157 real type names published nowhere on a 3,000-file
       * draw). The clause is re-dispatched through the same branch rather than through a
       * second copy of it, so the kind classifier, the containment edges, the field and
       * case publishing and the member scoping are the same code for both shapes.
       */
      asTypeUnit?: boolean
      /** FS-P9: the `attributes` siblings the definition writes for this clause — they sit
       *  BETWEEN clauses (`type A = … and [<Measure>] address`), so they are carried on the
       *  clause's frame instead of being walked in the definition's scope. */
      unitAttributes?: Node[]
    }
    const walkStack: WalkFrame[] = [{ node: rootNode, scopePath: [], callOwner: undefined, callOwnerQualified: undefined, bodyDepth: 0 }]

    while (walkStack.length > 0) {
      const { node, scopePath, callOwner, callOwnerQualified, bodyDepth, asTypeUnit, unitAttributes } = walkStack.pop()!
      const type = node.type

      // FS-D15 + FS-D16. A parse-recovery region is a fact about the PARSER, not about
      // the program, and this analyzer was doing two wrong things with one.
      //
      // It mined them. Inside an `ERROR` node the grammar hands back a recovery
      // artifact, and this walk reads that artifact as if it were code: in
      // fsharp/src/Compiler/Interactive/fsi.fsi the recovery for a malformed
      // `type IEventLoop =` produced a chain of `typecast_expression` ending in an
      // `application_expression`, and the analyzer published
      // `calls GetDefaultConfiguration -> abstract`, `-> member` and `-> Sealed` — the
      // language keywords and an attribute name, called by a symbol that appears
      // nowhere near them. Fabrication is the worst class there is, because it is
      // indistinguishable from a real edge to a consumer.
      //
      // And it never said so. `errors` was declared on line 48 and returned on line 937
      // and never pushed to, so the analyzer's own contract — "syntax errors: ERROR/
      // MISSING nodes pushed as warning ParseError (never silently dropped)" — had been
      // a claim in the docs with no code behind it. The region that produced those three
      // fabricated calls was reported NOWHERE.
      //
      // Both are fixed by the same two lines, and they are one decision rather than two:
      // a recovery region is DISCLOSED and not MINED. Disclosing it means the caller can
      // see exactly which spans to distrust, which is strictly more information than the
      // fabricated edges ever were, and it makes the grammar gaps the lane already knows
      // about (`member val`, `not null` — 6/400 files collapsing to a root ERROR)
      // visible in the result instead of only in a probe. Suppressing the edges is the
      // part that costs something, and the cost is measured rather than assumed: see
      // script/m14/tmp/fs031-error-region-delta.ts, which counts what the rule removes
      // before and after.
      //
      // THE COST, MEASURED CORPUS-WIDE (FS-P8, 2026-10-08, over all 11,799 admitted F#
      // files). When the recovery region is the ROOT node the whole file contributes
      // NOTHING, and that is not rare: **604 files (5.1%) publish zero symbols** — 402 `.fs`,
      // 200 `.fsx`, 2 `.fsi` — including mainstream sources such as
      // `fsharp/src/FSharp.Core/seqcore.fs`, `FSharp.Data/src/FSharp.Data.Html.Core/HtmlNode.fs`
      // and `FSharp.Formatting/src/FSharp.Formatting.Markdown/MarkdownParser.fs`. The figure
      // in the paragraph above (6/400 files) was a probe-sized 1.5%; the corpus rate is 5.1%,
      // and the difference is the honest number for anyone deciding whether to fix the grammar
      // gaps (`member val`, `not null`, and whatever `seqcore.fs` line 279 is) or to re-open
      // the mining question. What it does NOT buy: on the 3,000-file draw those invisible
      // declarations account for 123 of 150,114 unresolved incoming edges (0.1%), because the
      // names they carry are mostly not the names other files call. It is a coverage gap in the
      // graph (their declarations are missing from it), not a cause of the incoming residual —
      // and those are different findings that a count of "0 symbols" alone cannot tell apart.
      if (type === "ERROR") {
        errors.push({
          message: "parse recovery region: the tree here is the parser's reconstruction, not the source",
          range: { startLine: node.startPosition.row + 1, startColumn: node.startPosition.column, endLine: node.endPosition.row + 1, endColumn: node.endPosition.column },
          severity: "warning",
        })
        // Do NOT descend. The whole subtree is recovery, and descending would re-derive
        // the same artifact through a different node type.
        continue
      }
      if (node.isMissing) {
        errors.push({
          message: `missing ${node.type} — the parser inserted this token`,
          range: { startLine: node.startPosition.row + 1, startColumn: node.startPosition.column, endLine: node.endPosition.row + 1, endColumn: node.endPosition.column },
          severity: "warning",
        })
        continue
      }

      let currentScope = [...scopePath]
      let childCallOwner = callOwner
      let childCallOwnerQualified = callOwnerQualified
      let childBodyDepth = bodyDepth

      if (type === "namespace" || type === "named_module" || type === "module_defn") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "long_identifier")
        if (nameNode && nameNode.text) {
          const name = nameNode.text
          publish({
            name,
            kind: type === "namespace" ? ASTEngine.SymbolKind.Namespace : ASTEngine.SymbolKind.Module,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: type },
          })
          if (type === "namespace") namespaceNames.add(name)
          else moduleNames.add(name)
          currentScope.push(name)
        }
      } else if (type === "type_definition" || asTypeUnit) {
        // FS-D2: `type X with …` reaches the analyzer as a `type_definition` whose
        // ONLY body child is a `type_extension` — the grammar wraps it
        // (`_type_defn_body`'s `type_extension` arm, under `type_definition`). So the
        // duplicate is not the extension branch alone: the `type_definition` branch
        // mints the symbol, pushes the scope, and then walks INTO the extension, which
        // minted it a second time. Measured: 54 duplicate type symbols per 400 real
        // files (script/m14/tmp/fs012-self-containment.ts), every one a
        // `type_definition` + `type_extension` pair at the SAME line.
        const isExtensionBody = !!this.findChild(node, (n) => n.type === "type_extension")
        // FS-D8: a BARE `type X` (the grammar's `type_declaration`, "no body") is a
        // FORWARD DECLARATION — the surface an F# SIGNATURE file writes before the
        // definition. `type Surface` / `type Surface = member this.Real = 1` is ONE
        // entity, so the export list must name it once; both SYMBOLS stay, because
        // both are real declarations and the surface one carries the .fsi's line.
        const isForwardDeclaration = !!this.findChild(node, (n) => n.type === "type_declaration")

        // FS-P9. A MUTUAL TYPE GROUP IS SEVERAL TYPES IN ONE NODE, and the lane read it as
        // one. F# writes `type A = … and B = …` for types that refer to each other, and the
        // grammar emits ONE `type_definition` holding a clause body per type
        // (`type_abbrev_defn`, `anon_type_defn`, `record_type_defn`, `union_type_defn`,
        // `interface_type_defn`, `enum_type_defn`, `delegate_type_defn`, and the bodyless
        // `type_declaration`):
        //
        //     type_definition  "type Abbrev = Other.Thing and Real() = inherit Base("
        //       type_abbrev_defn  {type_name=identifier "Abbrev"}
        //       anon_type_defn    {type_name=identifier "Real"}
        //
        // Every name read in this branch was `findDescendant(node, …)` — the FIRST
        // `type_name` in the whole definition — so the group was named after its first
        // clause whichever one the source meant. Measured on the 3,000-file draw
        // (.tmp-probe/fs-p10-groups.mts, arm rows-pass13-meta.ndjson): 76 groups in 64
        // files, 177 clauses after a first, and **157 of those names are published
        // NOWHERE** — `Bolero.Html`'s `ElementBuilder`, `ComponentBuilder`,
        // `ComponentWithAttrsBuilder` (their members attributed to `ConcatBuilder`),
        // `Argu`'s `IFunc`/`ITemplateFunc`, `Deedle`'s `address`. The other 20 are names
        // the file publishes for another reason, which is why a name-missing test alone
        // was not enough to size this: the defect that matters is the ATTRIBUTION, and a
        // member owned by the wrong type is a false `contains` edge and a wrong `calls`
        // source, not a missing symbol.
        //
        // The clause is not re-implemented here. Each clause is pushed as a frame carrying
        // `asTypeUnit`, and the branch above admits it, so the kind classifier, the record
        // fields, the DU/enum cases, the interface implementations, the `extends` edges,
        // the member scoping and the containment composition downstream are the SAME code
        // for a clause and for a whole definition. A second copy of this branch is how the
        // two shapes drift apart.
        //
        // The definition's own `attributes` siblings ride the clause frame with it, because
        // the attribute and the clause it applies to are not always adjacent: Deedle writes
        // `type Address = int64<address>` + `and [<Measure>] address`, where the measure
        // marker is a definition-level `attributes` node sitting between the two clauses and
        // belongs to the SECOND one. Attribute attribution is by POSITION — the attributes
        // written before a clause are that clause's, and a trailing group (no clause after
        // it) stays with the definition, which is the first clause.
        if (!asTypeUnit) {
          const clauseNodes = this.filterChildren(
            node,
            (n) => TYPE_CLAUSE_TYPES.has(n.type) && !!this.findChild(n, (c) => c.type === "type_name"),
          )
          if (clauseNodes.length >= 2) {
            // A clause is identified by its SPAN, not by object identity: `namedChild(i)`
            // hands back a fresh wrapper per call and `includes` on those wrappers is false
            // for the same node — which is how a first draft shipped the group detection
            // firing while every clause frame arrived UNMARKED, so the clause names were
            // still published nowhere and the members were still owned by the enclosing
            // module. (Caught by dumping the analyzer's own output on the repro, not by a
            // test: nothing had ever pinned a group's member OWNER.)
            const keyOf = (n: Node) => `${n.startIndex}:${n.endIndex}`
            const clauseKeys = new Set(clauseNodes.map(keyOf))
            const attrsOfClause = new Map<string, Node[]>()
            const pending: Node[] = []
            for (let i = 0; i < node.namedChildCount; i++) {
              const c = node.namedChild(i)
              if (!c) continue
              if (c.type === "attributes") pending.push(c)
              else if (clauseKeys.has(keyOf(c))) attrsOfClause.set(keyOf(c), pending.splice(0, pending.length))
            }
            const firstKey = keyOf(clauseNodes[0]!)
            if (pending.length > 0) {
              attrsOfClause.set(firstKey, [...(attrsOfClause.get(firstKey) ?? []), ...pending])
            }
            for (let i = node.namedChildCount - 1; i >= 0; i--) {
              const child = node.namedChild(i)
              // An `attributes` node is carried by the clause it belongs to, never walked
              // here — walking it in the definition's scope would name it with the wrong
              // clause (and, for `[<Measure>]`, give it the wrong kind).
              if (!child || child.type === "attributes") continue
              const key = keyOf(child)
              const isClause = clauseKeys.has(key)
              walkStack.push({
                node: child,
                scopePath: currentScope,
                callOwner: childCallOwner,
                callOwnerQualified: childCallOwnerQualified,
                bodyDepth: childBodyDepth,
                ...(isClause ? { asTypeUnit: true, unitAttributes: attrsOfClause.get(key) } : {}),
              })
            }
            continue
          }
        }
        // The `attributes` this declaration is classified by and whose usages it emits.
        // A clause frame reads its own carried set PLUS any attributes the grammar nested
        // inside it; a whole definition reads its own children, as it always did.
        const declarationAttributes = asTypeUnit
          ? [...(unitAttributes ?? []), ...this.filterChildren(node, (n) => n.type === "attributes")]
          : this.filterChildren(node, (n) => n.type === "attributes")
        // Pure AST: the clean name is type_name -> long_identifier -> identifier;
        // declared generic params are type_arguments -> type_argument_defn ->
        // type_argument (no source-text regex needed).
        const typeNameNode = this.findDescendant(node, (n) => n.type === "type_name")
        const typeInfo = typeNameNode ? this.typeInfoOf(typeNameNode) : null
        const name = typeInfo?.name ?? null
        // FS-D8: a TYPE's access modifier is written INSIDE its `type_name` (the node's
        // own text is literally `internal Tables<'Token>`), a value's or a member's on
        // the declaration. Read structurally, never from the declaration's text.
        const accessModifier = this.accessModifierOf(node, typeNameNode ?? null)
        if (name) {
          // FS-P9: SELF-INCLUSIVE, because a clause frame's node IS the shape it names —
          // an `anon_type_defn` clause is the anonymous type, a `union_type_defn` clause is
          // the union, and `findDescendants` never returns the node it is called on. For a
          // whole definition (`node.type === "type_definition"`) every self test is false,
          // so these read exactly what they read before.
          const anonNode = node.type === "anon_type_defn" ? node : this.findChild(node, (n) => n.type === "anon_type_defn")
          const hasAnonTypeDefn = !!anonNode
          const hasRecordTypeDefn = node.type === "record_type_defn" || this.findDescendants(node, (n) => n.type === "record_type_defn").length > 0
          const hasUnionTypeDefn = node.type === "union_type_defn" || this.findDescendants(node, (n) => n.type === "union_type_defn").length > 0
          const hasInterfaceTypeDefn = node.type === "interface_type_defn" || this.findDescendants(node, (n) => n.type === "interface_type_defn").length > 0
          const hasEnumTypeDefn = node.type === "enum_type_defn" || this.findDescendants(node, (n) => n.type === "enum_type_defn").length > 0
          const hasDelegateTypeDefn = node.type === "delegate_type_defn" || this.findDescendants(node, (n) => n.type === "delegate_type_defn").length > 0
          const hasTypeAbbrevDefn = node.type === "type_abbrev_defn" || this.findDescendants(node, (n) => n.type === "type_abbrev_defn").length > 0

          let kind = ASTEngine.SymbolKind.Class
          let isInterface = false
          // FS-D27. A UNIT OF MEASURE is a structural fact, not a substring.
          //
          // The test was `n.text.includes("Measure") || n.text.includes("[<Measure")` on any
          // `attribute` descendant — the one text read left in this analyzer, and the only
          // thing here that was not AST-derived. Two defects, and the second is worse than
          // the first:
          //
          //   1. the second clause is dead, being a substring of the first;
          //   2. `[<MeasureAnnotatedAbbreviation>]` is a DIFFERENT and perfectly ordinary F#
          //      attribute — it marks a generic abbreviation — and it CONTAINS the substring.
          //      `fsharp/src/FSharp.Core/prim-types.fs:483` writes
          //      `[<MeasureAnnotatedAbbreviation>] type float<[<Measure>] 'Measure> = float`,
          //      where the real measure marker is on the TYPE PARAMETER and the type itself
          //      is an abbreviation. The substring test cannot tell those apart, and `findDescendant`
          //      returns whichever comes first, so the abbreviation was classified as a measure.
          //
          // The name is read from the tree, and only from the attributes attached to the TYPE:
          //
          //     type_definition
          //       attributes "[<Measure>]"
          //         attribute "Measure"
          //           simple_type "Measure" -> long_identifier "Measure" -> identifier "Measure"
          //
          // An exact name match, on the `attributes` node that is a DIRECT child of the type,
          // is what the language means: `Measure` and its `MeasureAttribute` spelling name the
          // same attribute, and nothing else does. A `Measure` on a type PARAMETER is a
          // different fact about a different node and is not consulted here — the parameter
          // positions are the R9 declared-type graph's business, not the kind classifier's.
          const isMeasure = declarationAttributes.some((attrs) =>
            this.findDescendants(attrs, (n) => n.type === "attribute", 3).some((attr) => {
              const nm =
                this.findDescendant(attr, (n) => n.type === "long_identifier", 3) ??
                this.findDescendant(attr, (n) => n.type === "identifier", 3)
              return nm?.text === "Measure" || nm?.text === "MeasureAttribute"
            }),
          )
          if (isMeasure) kind = ASTEngine.SymbolKind.Type
          if (hasRecordTypeDefn) {
            kind = ASTEngine.SymbolKind.Class
          } else if (hasUnionTypeDefn) {
            kind = ASTEngine.SymbolKind.Enum
          } else if (hasInterfaceTypeDefn) {
            kind = ASTEngine.SymbolKind.Interface
            isInterface = true
          } else if (hasEnumTypeDefn) {
            kind = ASTEngine.SymbolKind.Enum
          } else if (hasDelegateTypeDefn) kind = ASTEngine.SymbolKind.Type
          else if (hasTypeAbbrevDefn) kind = ASTEngine.SymbolKind.Type
          else if (hasAnonTypeDefn) {
            // FS-P9: `anonNode` is hoisted and self-inclusive — a clause frame's node IS the
            // anonymous type, so re-reading it from the node's CHILDREN would find nothing
            // and classify an interface clause as a plain class.
            if (anonNode) {
              const memberSigs = this.findDescendants(anonNode, (n) => n.type === "member_signature")
              const hasMemberSig = memberSigs.length > 0
              const hasInherits = this.findDescendants(anonNode, (n) => n.type === "class_inherits_decl").length > 0
              const hasInterfaceImpl =
                this.findDescendants(anonNode, (n) => n.type === "interface_implementation").length > 0
              const hasConcreteMembers = this.findDescendants(
                anonNode,
                (n) => n.type === "member_defn" && !this.findDescendant(n, (child) => child.type === "member_signature"),
              ).length > 0
              if (hasMemberSig && !hasInherits && !hasInterfaceImpl && !hasConcreteMembers) {
                kind = ASTEngine.SymbolKind.Interface
                isInterface = true
              }
            }
          }

          // FS-D2: the publication rule for a TYPE EXTENSION, and nothing else.
          //
          // `type X with …` is not a declaration of X — it is F#'s only way to add
          // members to a type declared elsewhere. So an extension publishes X only when
          // this file has no real `type X = …` at all (the member-only type F# also
          // allows), and never a second time.
          //
          // DELIBERATELY NOT a general one-symbol-per-name rule. An F# SIGNATURE file
          // forward-declares a type and then defines it, and the definition is the one
          // carrying the members; a blanket dedupe kept the forward declaration and
          // dropped the definition. The rule is scoped to extensions, the one place
          // the duplication is a defect.
          const isExtensionOnly =
            isExtensionBody && !typeNamesDeclaredInFile.has(name) && !typeExtensionsPublished.has(name)
          if (!isExtensionBody || isExtensionOnly) {
            publish({
              name,
              kind,
              range: this.nodeToRange(node),
              ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
              genericParameters: typeInfo?.genericParameters,
              metadata: {
                nodeType: type,
                ...(isExtensionBody ? { isTypeExtension: true } : {}),
                ...(isForwardDeclaration ? { isForwardDeclaration: true } : {}),
                ...(accessModifier ? { accessModifier } : {}),
              },
            })
          }
          if (isExtensionBody) typeExtensionsPublished.add(name)
          // The SCOPE is pushed either way: an extension's members belong to the
          // extended type whether or not this file declares it.
          currentScope.push(name)

          // Base type from `inherit Base()` — needed for qualified override targets.
          const inherits = this.findDescendants(node, (n) => n.type === "class_inherits_decl", 8)
          if (inherits.length > 0) {
            const firstInherit = inherits[0]
            const baseType = this.findDescendant(firstInherit, (n) => n.type === "long_identifier" || n.type === "identifier")
            if (baseType?.text) baseTypes.set(name, baseType.text)
          }

          if (hasRecordTypeDefn) {
            const fields = this.findDescendants(node, (n) => n.type === "record_field")
            for (const field of fields) {
              const fieldName = this.findChild(field, (n) => n.type === "identifier")
              if (!fieldName?.text) continue
              publish({
                name: fieldName.text,
                kind: ASTEngine.SymbolKind.Property,
                range: this.nodeToRange(field),
                ownerName: name,
                ownerKind: kind,
                metadata: { nodeType: "record_field", isRecordField: true },
              })
            }
          }

          // Extract DU cases as EnumMember symbols
          if (kind === ASTEngine.SymbolKind.Enum) {
            const unionDefns = node.type === "union_type_defn" ? [node] : this.findDescendants(node, (n) => n.type === "union_type_defn")
            for (const unionDefn of unionDefns) {
              const cases = this.findDescendants(unionDefn, (n) => n.type === "union_type_case")
              for (const c of cases) {
                const caseNameNode = this.findDescendant(c, (n) => n.type === "identifier")
                if (caseNameNode && caseNameNode.text) {
                  publish({
                    name: caseNameNode.text,
                    kind: ASTEngine.SymbolKind.EnumMember,
                    range: this.nodeToRange(c),
                    ownerName: name,
                    metadata: { nodeType: "union_type_case" },
                  })
                }
              }
            }
          }

          // Extract enum cases
          const enumDefns = node.type === "enum_type_defn" ? [node] : this.findDescendants(node, (n) => n.type === "enum_type_defn")
          for (const enumDefn of enumDefns) {
            const cases = this.findDescendants(enumDefn, (n) => n.type === "enum_type_case")
            for (const c of cases) {
              const caseNameNode = this.findDescendant(c, (n) => n.type === "identifier")
              if (caseNameNode && caseNameNode.text) {
                publish({
                  name: caseNameNode.text,
                  kind: ASTEngine.SymbolKind.EnumMember,
                  range: this.nodeToRange(c),
                  ownerName: name,
                  metadata: { nodeType: "enum_type_case" },
                })
              }
            }
          }

          // Extract interface implementations as relationships (search recursively within type)
          const ifaceImpls = this.findDescendants(node, (n) => n.type === "interface_implementation", 8)
          for (const impl of ifaceImpls) {
            const ifaceType = this.findDescendant(impl, (n) => n.type === "long_identifier" || n.type === "identifier")
            const writtenIface = ifaceType ? ifaceType.text : null
            if (writtenIface) {
              // FS-D9 (R10 spelling) — see the extends arm's note. A qualified interface
              // is written `System.IDisposable` and DECLARES `IDisposable`; the edge
              // carries the leaf so it joins to a symbol, and the qualified spelling
              // stays in `metadata.qualifiedType`.
              const leaf = writtenIface.includes(".") ? (writtenIface.split(".").pop() as string) : writtenIface
              pushRel(
                qualifyScope(name) ?? name,
                leaf,
                ASTEngine.RelationshipType.Implements,
                1.0,
                {
                  // FS-P7-1: the reason, and the spelling that was discarded to get here.
                  // `qualifiedType` below IS that discarded spelling (R10's record, kept
                  // because two fixtures pin it), so this site carries the REASON only and
                  // the census reads `targetWritten ?? qualifiedType`.
                  nodeType: "interface_implementation",
                  targetResolution: UNRESOLVED_TYPE,
                  ...(leaf !== writtenIface ? { qualifiedType: writtenIface } : {}),
                },
                lineOf(ifaceType),
              )
            }
          }

          // Extract class inherits as relationships (search recursively within type)
          for (const inh of inherits) {
            const baseType = this.findDescendant(inh, (n) => n.type === "long_identifier" || n.type === "identifier")
            const writtenName = baseType ? baseType.text : null
            if (writtenName) {
              // FSD3: `inherit` is ALWAYS an extends edge. The retired rule here
              // was "the name starts with I and its second character is
              // uppercase, therefore implements" — a guess that mislabels a base
              // class named `IThing` and labels an interface by luck. F#
              // implements interfaces with `interface ... with` (handled above).
              //
              // FS-D9 (R10 spelling): the edge's TARGET is the LEAF, because that is
              // the name the lane publishes for that type as a symbol, and a consumer
              // joins edges to symbols. `inherit System.Exception()` is written with a
              // namespace and DECLARES `Exception`; the qualified spelling is kept in
              // `metadata.qualifiedType` so nothing is lost. R10 is the family rule
              // applied to ten lanes; this lane was never asked, and the lane's own
              // truth oracle derived the leaf independently, which is how the 3 sites
              // in the corpus were found.
              const leaf = writtenName.includes(".") ? (writtenName.split(".").pop() as string) : writtenName
              pushRel(
                qualifyScope(name) ?? name,
                leaf,
                ASTEngine.RelationshipType.Extends,
                1.0,
                {
                  nodeType: "class_inherits_decl",
                  targetResolution: UNRESOLVED_TYPE,
                  ...(leaf !== writtenName ? { qualifiedType: writtenName } : {}),
                },
                lineOf(baseType),
              )
            }
          }
        }
      } else if (type === "value_declaration" || type === "function_or_value_defn" || type === "member_defn") {
        // Locals (value_declaration/function_or_value_defn nested inside a
        // function body) are NOT symbols — same contract as the C# family.
        if (bodyDepth > 0 && (type === "value_declaration" || type === "function_or_value_defn")) {
          // FS-P5-4: a LOCAL binding is not published, so a callee spelled with its name
          // cannot be an in-file declaration even when a declaration of that name exists
          // elsewhere in the file. Recorded so `targetSpelling` can decline the
          // qualification instead of attaching the call to the wrong symbol.
          // FS-P16. THE LOCAL'S NAME, READ BY THE READER THAT GETS IT RIGHT.
          //
          // This used `nameOfDeclarationLeft(node)` with a straight `findChild(identifier)` fallback,
          // and for F#'s most common local shape — `let k = Kennel()` — BOTH answered the CALLEE.
          // The left-hand `k` is not an `identifier` (the grammar carries the binding name as a
          // pattern, which is why `nameOfDeclarationLeft` searches for an `identifier_pattern`
          // first), so the descendant search fell through to the first identifier in the RHS, and
          // its `< left.endIndex` bound could not exclude anything: `left` is the WHOLE declaration,
          // so the end of the RHS is inside it. Measured with the lane's own analyzer on the
          // minimal shapes (`/tmp/fs-local-dump.mts`):
          //
          //     let k = Kennel()        -> calls Use.Go -> Kennel   res=local-binding
          //     let zzz = Kennel()      -> calls Use.Go -> Kennel   res=local-binding
          //     let k = Other()         -> calls Use.Go -> Other    res=local-binding
          //
          // i.e. the class was the LAST name in the declaration regardless of the local's name, so a
          // call to a project type's CONSTRUCTOR was asserted to be a call to a local binding
          // — a false reason, and one that also hid the edge from the project-index refinement
          // (which refines the classes that mean "not this file", and `local-binding` claims to be
          // this file). `declaredBindingName` reads the `*_declaration_left` FIRST and falls back to
          // the left's own identifier, which is the same correction its own header records for the
          // `let rec … and …` group.
          const localName = this.declaredBindingName(node)
          if (localName) localNames.add(String(localName))
          // Still walk children so calls inside locals attribute to the
          // enclosing function (e.g. `let doubled = items |> List.map ...`).
          childCallOwner = callOwner
          childCallOwnerQualified = callOwnerQualified
          childBodyDepth = bodyDepth
        } else {
          let nameNode = this.findChild(
            node,
            (n) =>
              !!n.text && (n.type === "identifier" || n.type === "long_identifier" || n.type === "identifier_pattern"),
          )
          if (!nameNode) {
            const leftNode = this.findChild(
              node,
              (n) => n.type === "function_declaration_left" || n.type === "value_declaration_left",
            )
            if (leftNode) {
              nameNode = this.findChild(leftNode, (n) => n.type === "identifier" || n.type === "identifier_pattern")
              // FS-D6: when that child is an `identifier_pattern`, its TEXT IS THE WHOLE
              // LEFT-HAND SIDE. For `let f (a: string) : string = …` the
              // `identifier_pattern` reads `f (a: string) : string` — parameters and
              // return annotation included — so taking its text published the signature
              // as the symbol's NAME. Measured: 60 such symbols per 400 real files (37
              // with a curried argument list, 23 with a generic argument in the return
              // type), none joinable by a consumer; script/m14/tmp/fs019-adjudicate-loss
              // counts the removed names by the character that disqualifies them — 57 by
              // a parameter list, 16 by a generic argument, 9 by a space, 8 otherwise.
              //
              // The declared name is the pattern's FIRST
              // `long_identifier_or_op -> long_identifier -> identifier` chain, read
              // structurally. A bare `identifier` child is left alone, which is what
              // keeps `let f a b = …` and `let inline f x = …` naming `f` as before — a
              // first draft that also redirected the `identifier` case regressed both,
              // and the A/B caught it as dropped symbols before it shipped.
              if (nameNode?.type === "identifier_pattern") {
                nameNode = this.patternNameNode(nameNode) ?? nameNode
              }
            }
          }
          // Fallback for member_defn: method_or_prop_defn → property_or_ident → identifiers
          if (!nameNode) {
            const mopNode = this.findChild(node, (n) => n.type === "method_or_prop_defn")
            if (mopNode) {
              const propNode = this.findChild(mopNode, (n) => n.type === "property_or_ident")
              if (propNode) {
                // Get the method/property name (second identifier, e.g. "this.Speak" → "Speak")
                const idents = this.filterChildren(propNode, (n) => n.type === "identifier")
                nameNode = idents.length >= 2 ? idents[idents.length - 1] : idents[0]
              }
            }
          }
          if (nameNode && nameNode.text) {
            const name = nameNode.text
            const isFunc = !!this.findChild(
              node,
              (n) =>
                n.type === "function_declaration_left" ||
                n.type === "argument_patterns" ||
                n.type === "argument_spec" ||
                n.type === "arguments_spec",
            )
            const isMember = type === "member_defn"
            const hasMethodOrProp = !!this.findChild(node, (n) => n.type === "method_or_prop_defn")
            const owner = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined

            // abstract+default dedup: if the owner already has an abstract
            // member_signature with this name, this member_defn is the default
            // implementation of that member — skip the duplicate symbol.
            const isAbstractDefaultImpl = isMember && !!owner && abstractMemberNames.has(`${owner}:${name}`)

            if (!isAbstractDefaultImpl) {
              let kind: ASTEngine.SymbolKind
              let isProperty = false
              if (isMember && hasMethodOrProp) {
                const mopNode = this.findChild(node, (n) => n.type === "method_or_prop_defn")
                // Pure AST classification (FSD7, measured on a 120-file census
                // draw): the grammar's own `args:` FIELD decides. The retired
                // rule read named children and recognised two of the four arg
                // shapes the corpus actually uses — a single curried arg
                // (`member _.TryRangeOf pos = ...`) parses as
                // `args:identifier_pattern`, was classified a PROPERTY, and
                // dropped not just its kind but every call in its body
                // (measured: 73 of 604 members; the F5 row's MISSING class).
                if (mopNode) {
                  const argsNode = (mopNode as any).childForFieldName?.("args") ?? null
                  if (argsNode) {
                    isProperty = false
                  } else {
                    // Fallback for arg shapes the field lookup cannot see: any
                    // pattern-ish node between the name and the body.
                    let afterIdent = false
                    for (let i = 0; i < mopNode.namedChildCount; i++) {
                      const c = mopNode.namedChild(i)
                      if (!c) continue
                      if (c.type === "property_or_ident") {
                        afterIdent = true
                        continue
                      }
                      if (afterIdent) {
                        if (
                          c.type === "paren_pattern" ||
                          c.type === "argument_patterns" ||
                          c.type === "identifier_pattern" ||
                          c.type === "typed_pattern" ||
                          c.type === "wildcard_pattern" ||
                          c.type === "list_pattern" ||
                          c.type === "optional_pattern" ||
                          (c.type === "const" && c.text === "()")
                        ) {
                          isProperty = false
                          break
                        }
                        // A computed property: value expression (no args).
                        isProperty = true
                        break
                      }
                    }
                  }
                }
                kind = isProperty ? ASTEngine.SymbolKind.Property : ASTEngine.SymbolKind.Method
              } else if (isMember) {
                kind = ASTEngine.SymbolKind.Method
              } else {
                kind = isFunc ? ASTEngine.SymbolKind.Function : ASTEngine.SymbolKind.Variable
              }

              const isAsync = !!this.findDescendant(
                node,
                (n) => n.type === "ce_expression" || n.type === "short_comp_expression",
                4,
              )

              // FS-D8: an F# `member` carries its own access modifier
              // (`member private this.Reset()`), and neither `internal` nor `private`
              // is part of the library's importable surface.
              const memberAccess = this.accessModifierOf(node, null)
              publish({
                name,
                kind,
                range: this.nodeToRange(node),
                ownerName: owner,
                isAsync,
                metadata: { nodeType: type, ...(memberAccess ? { accessModifier: memberAccess } : {}) },
              })

              // FS-D29. A MUTUAL RECURSION GROUP IS ONE NODE WITH SEVERAL BINDINGS.
              //
              //     let rec groupFirst (a: GroupDep) : GroupSecond = …
              //     and groupSecond (b: GroupSecondDep) : GroupFirst = …
              //
              // is a single `function_or_value_defn` holding both clauses, and only the first
              // was published. So `groupSecond` did not exist as a symbol at all, and its
              // parameter and return types were attributed to `groupFirst` — which is a real
              // published name, so the edges resolved and nothing downstream could tell. The
              // F# compiler corpus is written almost entirely in this shape.
              //
              // Each `and` clause is a binding in its own right, so each gets a symbol, with
              // the SAME kind and owner as the first: they are siblings, not nested.
              const extraLefts: Node[] = []
              for (let i = 0; i < node.namedChildCount; i++) {
                const c = node.namedChild(i)
                if (c && (c.type === "function_declaration_left" || c.type === "value_declaration_left")) {
                  extraLefts.push(c)
                }
              }
              for (let k = 1; k < extraLefts.length; k++) {
                const andName = this.nameOfDeclarationLeft(extraLefts[k]!)
                if (andName && andName !== name) {
                  publish({
                    name: andName,
                    kind,
                    range: this.nodeToRange(node),
                    ownerName: owner,
                    isAsync,
                    metadata: { nodeType: type, isMutualRecursionClause: true },
                  })
                }
              }

              // Qualified override: source = Owner.method, target = Base.method.
              //
              // FS-A2 (M60 pass 2): the `override` TOKEN is not a statement about a base
              // class, and the token-only rule read it as one. F# has no separate keyword for
              // an interface member — `override` is what implements one, exactly as in C#:
              //
              //     type Disposable() =
              //         interface System.IDisposable with
              //             override this.Dispose() = ()      // implements IDisposable
              //
              // — so `interface I with override this.M() = …` emits
              //
              //     overrides  Disposable.Dispose  ->  Dispose        (no `inherit` anywhere)
              //     overrides  Disposable.Dispose  ->  Base.Dispose   (`inherit Base()` also present)
              //
              // and both are wrong. The first asserts that a member overrides ITSELF, which
              // binds to nothing a consumer can follow and is the shape of a fabricated edge;
              // the second attributes an interface implementation to a base-class member that
              // need not exist. Measured over the whole corpus by
              // validation/m14/fixtures/fsharp/ontology-probe.ts (probe A1/A2).
              //
              // The family's answer is settled and this adopts it: csharp
              // (`resolveInterfaceImplementations`, C923) emits `overrides M -> I.m` with
              // `metadata.relationshipType = "interface_member_implementation"`, and the same
              // shape was measured in java, kotlin, typescript, dart and python. So the edge
              // STAYS `overrides` — the member does satisfy a declaration above it — and the
              // TARGET is read from the interface the tree writes, not from the base list.
              //
              // And with no interface and no base there is NO target to write, so nothing is
              // emitted: the type-level `implements` edge above already carries the fact, and a
              // member-level edge naming nothing would be the fabrication this lane's own
              // workstream forbids.
              if (isMember && this.firstTokenIs(node, "override")) {
                const qualifiedSource = owner ? `${owner}.${name}` : name
                const implementedInterface = this.enclosingInterfaceImplementationLeaf(node)
                if (implementedInterface) {
                  pushRel(
                    qualifiedSource,
                    `${implementedInterface}.${name}`,
                    ASTEngine.RelationshipType.Overrides,
                    1.0,
                    {
                      nodeType: type,
                      isOverride: true,
                      relationshipType: "interface_member_implementation",
                      isInterfaceMemberImplementation: true,
                      targetResolution: UNRESOLVED_INTERFACE,
                    },
                    lineOf(node),
                  )
                } else {
                  const baseName = owner ? baseTypes.get(owner) : undefined
                  if (baseName) {
                    pushRel(
                      qualifiedSource,
                      `${baseName}.${name}`,
                      ASTEngine.RelationshipType.Overrides,
                      1.0,
                      {
                        nodeType: type,
                        isOverride: true,
                        targetResolution: UNRESOLVED_BASE,
                        // The base is stored AS WRITTEN (`baseTypes` takes `baseType.text`), so
                        // `inherit System.Exception()` spells the target
                        // `System.Exception.ToString` — three segments whose store tail
                        // (everything after the FIRST dot) is `Exception.ToString`, which no
                        // symbol is named. The leaf form `Exception.ToString` can reach
                        // strategy 3's tail (`ToString`) instead.
                        //
                        // PRICED AND DECLINED, FS-P7-2's method applied to this site
                        // (`.tmp-probe/fs-p7-base.py`, arm `rows-pass10-meta.ndjson`): the
                        // tempting reading is that 542 `base-member-external` rows are all
                        // three-segment spellings, and they are not — only 6 carry a DOTTED
                        // written base, because `inherit Base()` with a bare name already
                        // spells the leaf. Respelling those 6 moves **+3 determinate / −0**
                        // and converts 3 UNATTACHED edges into ARBITRARY ones
                        // (`none -> ambiguous`: the store now picks MIN(id) among several
                        // symbols named `Invoke`). An arbitrary attachment is not a gain
                        // under this lane's accounting — it is the analyzer saying nothing
                        // while the store says something — so the as-written base stands and
                        // the number lives here rather than in a TODO.
                        ...(baseName.includes(".") ? { targetWritten: baseName } : {}),
                      },
                      lineOf(node),
                    )
                  }
                }
              }

              // Calls inside this member/function attribute to it; computed
              // property getters emit no calls (C# family contract).
              //
              // FS-D10: a top-level `let` owns the calls in its INITIALISER, whatever
              // its kind. The rule was keyed on the kind, so a `let checker = …` (a
              // VARIABLE, because it takes no arguments) did not become an owner, and
              // in an F# SCRIPT — where the top level IS the program and there is no
              // enclosing namespace, module or function — every call in it had no source
              // and was DROPPED. The lane's own truth oracle derives those edges from the
              // binding, and the differential measured the gap: 2,520 MISSING `calls`
              // rows per 200 real files, every one of them a real call.
              //
              // The kind gate remains for the case that motivated it: a computed PROPERTY
              // (`member _.X = expr`) emits no calls, which is the C# family contract and
              // is pinned by the lane's ground truth.
              if (kind === ASTEngine.SymbolKind.Property && !this.hasExplicitSetter(node)) {
                childCallOwner = undefined
                childCallOwnerQualified = undefined
              } else {
                // FS-D13: the "a computed property getter emits no calls" rule is the
                // C# family contract, and in C# an EXPRESSION-bodied property has no
                // second body for code to live in. F#'s `with get, set` DOES:
                //     member _.EventLoop
                //         with get () = evLoop
                //         and set (x: IEventLoop) = evLoop.ScheduleRestart()
                // The accessor is a `property_accessor` node carrying its own `set`
                // keyword token, so the rule is read structurally: a member with an
                // explicit SETTER has a body that executes, and suppressing its calls
                // deletes real code paths. Measured by the lane's own truth oracle.
                childCallOwner = name
                childCallOwnerQualified = owner ? `${owner}.${name}` : name
              }
              childBodyDepth = bodyDepth + 1
            } else {
              // FS-D12: a `default` implementation of an abstract member publishes no
              // SYMBOL — the abstract signature is the canonical one, and the dedup is
              // correct. But its BODY belongs to that same member, so the body must be
              // owned by it.
              //
              // The arm passed the enclosing owner through unchanged, and inside a class
              // the enclosing owner is undefined — so every call in every `default`
              // implementation was DROPPED. F#'s OO surface is written this way
              // (`abstract member Compile : …` + `default x.Compile (pwd, argv) = …`),
              // and the lane's own truth oracle measured the gap: 731 of 817 MISSING
              // `calls` rows per 120 real files were this one shape. The same reasoning
              // as FS-D10, one level down.
              childCallOwner = name
              childCallOwnerQualified = owner ? `${owner}.${name}` : name
              childBodyDepth = bodyDepth + 1
            }
          }
        }
      } else if (type === "additional_constr_defn") {
        const nameNode = this.findDescendant(node, (n) => n.type === "identifier" || n.type === "long_identifier")
        if (nameNode && nameNode.text) {
          const owner = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined
          publish({
            name: "constructor",
            kind: ASTEngine.SymbolKind.Constructor,
            range: this.nodeToRange(node),
            ownerName: owner,
            metadata: { nodeType: "additional_constr_defn" },
          })
          // `new(...) = ...` also declares the type's constructor — the symbol is
          // named "constructor" by contract (C# family); the node's line is kept
          // in its range, so no relationship is owed here.
          childCallOwner = "constructor"
          childCallOwnerQualified = owner ? `${owner}.constructor` : "constructor"
          childBodyDepth = bodyDepth + 1
        }
      } else if (type === "member_signature") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "property_or_ident")
        if (nameNode && nameNode.text) {
          const owner = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined
          publish({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Method,
            range: this.nodeToRange(node),
            ownerName: owner,
            metadata: { nodeType: "member_signature" },
          })
          if (owner) abstractMemberNames.add(`${owner}:${nameNode.text}`)
        }
      } else if (type === "value_declaration" && bodyDepth > 0) {
        // FS-D5: this arm exists to reach the one `value_declaration` shape the walk
        // can arrive at INSIDE a class body — the 77 corpus nodes whose parent is
        // `member_defn` (script/m14/tmp/fs001-shape-census.ts). The arm it replaced read
        // `val_property_defn`, which is an ANONYMOUS node (`_val_property_defn` in the
        // grammar's hidden-rule list): it can never be a named child, so the branch was
        // unreachable, and F1 could not see it — its `isTypeComparison` only accepts a
        // `x.type === "…"` member expression while the analyzer dispatches on the bare
        // local `type` (that gate hole is proven in script/m14/tmp/fs007-f1-gate-hole.ts:
        // 41 of the analyzer's 92 type comparisons are inside F1's validated set).
        //
        // The F# member-property this arm was WRITTEN for — `member val A : int with
        // get, set` — is a live, common construct (890 occurrences in the F# compiler
        // corpus alone) that the pinned grammar does not parse: it arrives as a
        // root-level ERROR, not as a `value_declaration`. So no symbol is emitted here,
        // and the construct is recorded as a GRAMMAR gap rather than papered over with a
        // text rule. What the arm does do is keep the walk's depth accounting correct
        // for the shapes that DO parse, so a `value_declaration` in a body is walked
        // (its subtree's calls attribute to the enclosing member) without being minted.
        childCallOwner = callOwner
        childCallOwnerQualified = callOwnerQualified
        childBodyDepth = bodyDepth
      } else if (type === "object_expression") {
        const iface = this.objectExpressionInterface(node)
        if (iface) {
          const { written, leaf } = iface
          const ownerName = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined
          publish({
            name: "new " + written,
            kind: ASTEngine.SymbolKind.Class,
            range: this.nodeToRange(node),
            ownerName,
            metadata: { nodeType: "object_expression" },
          })
          // FS-D7: the object's own members belong to the object. `{ new IDisposable
          // with member _.Dispose() = … }` published `Dispose` with NO owner at all,
          // because the branch minted a Class symbol and never opened a scope for it —
          // measured on the second corpora, where an F# SCRIPT (no namespace, no
          // module) has an empty enclosing scope and every member of every object
          // expression came out ownerless: suave examples/WebSocket/Program.fs:181,
          // fsharp-data HtmlNode.fs:123,206, elmish
          // docs/docs/subscription.fsx:71,144,803,833. The scope is opened under the
          // SAME name the symbol is published under, so the `contains` edge resolves to
          // a symbol that exists.
          currentScope.push("new " + written)
          if (ownerName) {
            // FS-D9 (R10 spelling), same rule: `{ new System.IDisposable with … }`
            // implements `IDisposable`, which is the name the leaf declares. Measured: 13
            // dotted `implements` targets per 400 real files, all of them this shape.
            pushRel(
              qualifyScope(ownerName) ?? ownerName,
              leaf,
              ASTEngine.RelationshipType.Implements,
              1.0,
              { nodeType: "object_expression", targetResolution: UNRESOLVED_TYPE, ...(leaf !== written ? { qualifiedType: written } : {}) },
              lineOf(node),
            )
          }
        }
      } else if (type === "active_pattern") {
        // One function symbol named by the full active pattern, e.g. (|Even|Odd|)
        publish({
          name: node.text,
          kind: ASTEngine.SymbolKind.Function,
          range: this.nodeToRange(node),
          ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
          metadata: { nodeType: "active_pattern" },
        })
      } else if (type === "exception_definition") {
        // `exception NotFound of string` — NotFound is under long_identifier.
        const nameNode = this.findDescendant(node, (n) => n.type === "identifier")
        if (nameNode && nameNode.text) {
          publish({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Class,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: "exception_definition" },
          })
        }
      } else if (type === "module_val_declaration") {
        // FSD9: a .fsi `val X : T` declares the surface — 203 of them in the
        // lane's 120-file census draw, every one publishing NOTHING until now
        // (the node exists because this lane's own grammar patch added the
        // rule). One Function symbol, owned by the enclosing module/type, marked
        // isDeclaration: a later .fs definition is the SAME entity (the Clean
        // .dcl/.icl merge precedent).
        const nameNode = this.findChild(node, (n) => n.type === "identifier")
        if (nameNode?.text) {
          publish({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Function,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: "module_val_declaration", isDeclaration: true },
          })
        }
      } else if (type === "type_extension") {
        // FS-D2: the enclosing `type_definition` has already decided whether this
        // extension's name is published, and pushed the scope. A REACHED-here
        // `type_extension` is the nested body of such a `type_definition` (the grammar
        // wraps every `type X with` in one), so the correct action is exactly one
        // thing: carry the scope name forward so the members below own the extended
        // type, and publish nothing. Publishing a Class here is what produced the 54
        // duplicate symbols and 57 `contains X -> X` self-edges per 400 real files.
        //
        // The scope name is read through `typeInfoOf` — the SAME extraction the
        // `type_definition` branch uses — and not from the node's raw text. That
        // distinction is load-bearing: `type internal Tables<'Token> with` has a
        // `type_name` whose text is the whole `internal Tables<'Token>`, so pushing
        // its text put every extension member under an owner that matches no symbol
        // anywhere. Caught by the A/B as 510 REAL-LOSS rows for exactly this.
        const typeNameNode = this.findChild(node, (n) => n.type === "type_name")
        const extName = typeNameNode ? this.typeInfoOf(typeNameNode)?.name ?? null : null
        if (extName) currentScope.push(extName)
      } else if (type === "attribute") {
        const attrNameNode = this.findDescendant(node, (n) => n.type === "identifier" || n.type === "long_identifier")
        if (attrNameNode && attrNameNode.text) {
          const attrText = attrNameNode.text
          if (attrText.includes("TypeProvider") || attrText.includes("TypeProviderAssembly")) {
            publish({
              name: attrText,
              kind: ASTEngine.SymbolKind.Class,
              range: this.nodeToRange(node),
              ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
              metadata: { nodeType: "attribute", isTypeProvider: true },
            })
          }
        }
        // M60 fsharp lane: `uses` — AN ATTRIBUTE APPLICATION.
        //
        // `[<Struct>]`, `[<Obsolete("gone")]`, `[<assembly: TypeProviderAssembly>]`.
        // This is the construct a `uses` edge is FOR, and it is the only F# construct
        // that is: it NAMES a type, applies it as a marker, and never invokes it. It is
        // therefore not a `calls` (no application), not an `implements` (no interface
        // declaration), not an `extends` (no base), not an `instantiates` (no
        // construction), and not a `references` (no DECLARED type — nothing here is a
        // signature; the analyzer's declared-type pass reads type WRITERS, and an
        // attribute's type is the type of an object construction, not a written
        // annotation).
        //
        // The census measured 0 `uses` edges over 400 real files while the grammar
        // produces `attribute` nodes throughout them, so the construct was present and
        // unread. What was already here read only the TypeProvider case, which is 2 of
        // the node's spellings and about symbol PUBLICATION rather than about the edge.
        //
        // The name comes from the TYPE of the object construction, read off the tree:
        // `attribute` is `seq(optional(seq(field("target", identifier), ":")), _object_construction)`
        // and `_object_construction` is `seq(_type, optional(_expression))`. The `target`
        // is a FIELD, so it is excluded by field name and not by position, and the
        // attribute's ARGUMENT expression is not read at all — `[<Obsolete("x")>]` names
        // `Obsolete` and nothing in `"x"`, and an argument that happens to contain a
        // type-shaped word is an argument, not a use.
        const attrTarget = node.childForFieldName("target")
        // The `target` is skipped by FIELD NAME, not by object identity. `namedChild(i)`
        // and `childForFieldName("target")` do not return the same JS object for the same
        // tree node — web-tree-sitter builds the wrapper on each accessor call — so
        // `c === attrTarget` is false for the very child it is meant to skip. Measured
        // cost of getting it wrong: 11 `uses` edges in a 200-file draw whose target was
        // the literal string `return`, from `[<return: Struct>]` on a `val`, i.e. the
        // variance annotation read as the dependency. `fieldNameForChild(i)` is the
        // question that is actually well defined.
        let attrTypeNode: Node | null = null
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i)
          if (!c || !c.isNamed) continue
          if (node.fieldNameForChild(i) === "target") continue
          const named = this.typeNameNodeOf(c)
          if (named) { attrTypeNode = named; break }
        }
        const attrName = attrTypeNode ? this.dependencyLeafName(attrTypeNode) : null
        // FS-P5-3: the written attribute TYPE — `[<Struct>]`, `[<Xunit.Fact>]`,
        // `[<MyFile.Local>]` — so the target can be spelled exactly when this file declares
        // it and can carry its qualifier when it does not.
        const attrWritten = attrTypeNode ? String(attrTypeNode.text) : null
        if (attrName) {
          // Source = the declaration the attribute decorates. `attributes` is a CHILD of
          // the declaration, and this walk publishes a declaration's symbol and pushes its
          // scope BEFORE pushing its children — so `currentScope`'s innermost name is
          // already the decorated declaration here, and fileScope/Global covers the
          // file-level spellings (`[<assembly: …>]` above every module).
          const attrOwner = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined
          // FS-P6-4: an attribute is a TYPE, so the full written path is the shape the
          // store holds (`Xunit.Fact`, not `Fact`) — the `type` position.
          const spelledAttr = targetSpelling(attrWritten ?? attrName, attrOwner, "type")
          pushRel(
            qualifyScope(attrOwner) || qualifyScope(fileScope) || "Global",
            spelledAttr.target,
            ASTEngine.RelationshipType.Uses,
            1.0,
            {
              nodeType: type,
              relationshipType: "attribute_application",
              isAttributeUsage: true,
              targetResolution: spelledAttr.resolution,
              ...(spelledAttr.qualifier ? { targetQualifier: spelledAttr.qualifier } : {}),
              ...(attrTarget ? { attributeTarget: attrTarget.text } : {}),
            },
            attrTypeNode ? lineOf(attrTypeNode) : lineOf(node),
          )
        }
      } else if (type === "module_abbrev") {
        // M60 fsharp lane: `imports` — an ALIASED MODULE, `module X = Y`.
        //
        // F#'s second import form and the only one whose target lies OUTSIDE the
        // compilation: `module Diagnostics = FSharp.Compiler.Diagnostic` is how a script
        // or a signature file names an assembly or a namespace it does not define. The
        // dependency is on the RIGHT-HAND path; the left-hand `X` is the local alias the
        // file itself introduces, so naming `X` would make every alias look like a
        // self-dependency — and DID: a first draft reached for the last `identifier` or
        // `long_identifier` DESCENDANT, which is the local name, and emitted
        // `imports Fixture.ImportAndUse -> IO` for `module IO = System.IO`. The grammar
        // is `seq(optional(attributes), "module", identifier, "=", scoped(long_identifier, ...))`,
        // so the alias and the path are DIRECT children and the path's own identifiers are
        // GRANDCHILDREN. Reading direct children is what separates the alias from the thing
        // it aliases.
        const aliasNode = this.filterChildren(node, (n) => n.type === "identifier")[0]
        const pathNode = this.filterChildren(node, (n) => n.type === "long_identifier").pop()
        if (pathNode && pathNode.text) {
          const alias = aliasNode?.text
          imports.push({
            module: pathNode.text,
            items: [],
            isDefault: true,
            alias,
            range: this.nodeToRange(node),
          })
          const abbrevOwner = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined
          pushRel(
            qualifyScope(abbrevOwner) || qualifyScope(fileScope) || "Global",
            pathNode.text,
            ASTEngine.RelationshipType.Imports,
            1.0,
            { nodeType: type, relationshipType: "module_alias", targetResolution: "module-alias-path", ...(alias ? { moduleAlias: alias } : {}) },
            lineOf(pathNode),
          )
        }
      } else if (type === "fsi_directive_decl") {
        // M60 fsharp lane: `imports` — a RESOURCE DIRECTIVE, `#r "…"`, `#load "…"`, `#I "…"`.
        //
        // The strongest import fact F# has: the string LITERALLY names the file or
        // assembly this unit will be compiled against. The grammar's
        // `fsi_directive_decl` covers six keywords and only three of them name a
        // resource — `#time`, `#help` and `#quit` are REPL controls that touch nothing
        // outside the file, and emitting an import for those would be an edge to a
        // resource the language never reads. The keyword is therefore read off the tree
        // (the first unnamed child token) and the other three are refused, rather than
        // the whole node being accepted because it is the right node type.
        //
        // ★★ `#load` IS NOT ONE OF THEM ANY MORE — IT IS A `part_of`, AND THAT IS THE R3 REMEDY
        // (2026-10-22). THE THREE KEYWORDS ARE NOT ONE KIND, AND THE VOCABULARY HAS A NAME FOR
        // THE OTHER ONE.
        //
        //   `#r "assembly"`  — a REFERENCE to an assembly: a separate module this unit is
        //                      compiled AGAINST. That is `imports` ("an import names a module
        //                      and creates binding scope").
        //   `#I "dir"`       — an INCLUDE PATH: a directory searched for references. `imports`.
        //   `#load "x.fs"`   — a TEXTUAL INCLUDE: the named file's source is compiled as
        //                      PART OF THIS COMPILATION UNIT. It is not a module: it shares
        //                      this file's single scope, it imports nothing, and it cannot be
        //                      resolved as a separate module. That is EXACTLY the
        //                      `part_of` contract (src/ast/types.ts:164-190 — "A library unit
        //                      INCLUDES a part file … a part shares the library's single
        //                      scope, imports nothing, and cannot be resolved as a separate
        //                      module"), and it is the DART LANE'S SPELLING of the same fact
        //                      (dart `part 'x.dart'`).
        //
        // ⇒ SO THE `#load` ROW IS RELABELLED `imports` → `part_of`, 1:1, keeping its source,
        // its line, its confidence (1.0) and its evidence class, and CHANGING ONLY THE STORED
        // TYPE — which is the contract's relabel discipline
        // (validation/m14/verification/VOCABULARY-EXTENSION-PROPOSAL.md §2.4). The ImportInfo
        // PAYLOAD stays: it is not a relationship (it is the parsed file's directive list),
        // and `src/ast/parallel-indexer.ts` persists it into the brain_import table, so a
        // consumer reading the directive list loses nothing.
        //
        // ⇒ AND THE DIRECTION IS THE DIRECTIVE'S OWN (types.ts:170-183): the source is the file
        // carrying the directive, the target is what it names, and every row carries
        // `metadata.partRole`. F# has only ONE of Dart's two forms — there is no `part of` in
        // F# — so every F# row is the host that INCLUDES the part: `partRole: "library"`.
        //
        // ⇒ AND A TARGET NO PROJECT KEY CAN ANSWER PUBLISHES NO ROW (types.ts:187-190 and the
        // proposal's MUST NOT). The target is resolved against the INCLUDING FILE'S OWN
        // DIRECTORY and expressed as a PROJECT-RELATIVE path; a specifier that escapes the
        // project, or that names nothing this checkout can place, is refused rather than
        // published as a path that resolves to nothing.
        const resourceKeywords = new Set(["#r", "#I"])
        const partKeywords = new Set(["#load"])
        let directiveKeyword = ""
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i)
          if (c && !c.isNamed) { directiveKeyword = c.text; break }
        }
        const specifiers = this.filterChildren(
          node,
          (n) => n.type === "string" || n.type === "verbatim_string",
        )
        const isPart = partKeywords.has(directiveKeyword)
        if (specifiers.length > 0 && (resourceKeywords.has(directiveKeyword) || isPart)) {
          const dirOwner = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined
          const source = qualifyScope(dirOwner) || qualifyScope(fileScope) || "Global"
          // A `#load` MAY NAME MORE THAN ONE FILE (`#load "a.fs" "b.fs"`), so THE PART IS ONE ROW
          // PER NAMED FILE, not one row per directive. (The wired grammar MIS-LEXES the
          // multi-file form — the second string arrives as a sibling `const` and the directive
          // carries a MISSING node — so the loop is correct for the shape the grammar produces
          // and leaves the mis-lex itself a GRAMMAR fact, recorded in the lane's spec.)
          const named = isPart ? specifiers : specifiers.slice(0, 1)
          for (const specifier of named) {
            const specifierValue = this.stringLiteralValue(specifier)
            if (!specifierValue) continue
            imports.push({
              module: specifierValue,
              items: [],
              isDefault: false,
              isExternal: true,
              path: specifierValue,
              range: this.nodeToRange(node),
              metadata: { fsharpSpecific: true, directive: directiveKeyword },
            })
            if (isPart) {
              // THE `part_of` ROW. A `#load` WITH NO RESOLVABLE TARGET PUBLISHES NO ROW — the
              // contract's declared drop, and the reason a path the checkout cannot place is
              // exactly the shape this label exists to stop publishing.
              const partTarget = this.fsharpPartTargetPath(filePath, context, specifierValue)
              if (partTarget) {
                pushRel(
                  source,
                  partTarget,
                  ASTEngine.RelationshipType.PartOf,
                  1.0,
                  {
                    nodeType: type,
                    relationshipType: "part_directive",
                    directive: directiveKeyword,
                    partRole: "library",
                    targetResolution: "project-relative-path",
                  },
                  lineOf(specifier),
                )
              }
            } else {
              pushRel(
                source,
                specifierValue,
                ASTEngine.RelationshipType.Imports,
                1.0,
                { nodeType: type, relationshipType: "resource_directive", directive: directiveKeyword, targetResolution: "resource-path" },
                lineOf(specifier),
              )
            }
          }
        }
      } else if (type === "import_decl") {
        // FS-A1 (measured dead branches retired): `open_statement`/`open_decl`
        // never occur — 0 of 363,609 nodes in the shape census — `open X` IS
        // this node (558 in the same draw). The branch that read them was a
        // second, unreachable copy of this rule.
        const targetNode = this.findChild(node, (n) => n.type === "long_identifier" || n.type === "identifier")
        if (targetNode && targetNode.text) {
          imports.push({
            module: targetNode.text,
            items: [],
            isDefault: true,
            range: this.nodeToRange(node),
          })
          const owner = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined
          // FS-P5-4: `open X` is what makes a bare name in this file able to mean a member
          // of X, so the opened scopes are the difference between "external" and "opened"
          // when a target is recorded as unexplained.
          const openedHead = String(targetNode.text).split(".")[0]
          if (openedHead) openedScopes.add(openedHead)
          // FSD10: a module-less file sources its file-level edges from
          // `Global`, never from the opened name itself (self-sourcing makes an
          // import unfalsifiable: any target would "reference" itself).
          //
          // FS-D17 adds the file's DECLARED scope between the two, because `owner` is a
          // property of where the walk happens to be and the file's scope is a property
          // of the file. Without it, whether an `open` was attributed to the module or to
          // `Global` depended on whether the `open` appeared above or below the `module`
          // keyword — see this method for the two corpus files that disagree.
          pushRel(
            qualifyScope(owner) || qualifyScope(fileScope) || "Global",
            targetNode.text,
            ASTEngine.RelationshipType.References,
            0.9,
            { nodeType: type, isImport: true, targetResolution: UNRESOLVED_NAMESPACE },
            lineOf(node),
          )
          // M60 fsharp lane: `imports` — the same directive under the label the
          // module-dependency pass actually reads.
          //
          // ER-D41 is the precedent and it is about THIS language's shape:
          // `src/intelligence/analysis/dependencies.ts` reads `imports` relationship
          // edges for file->file module dependencies, relying on them precisely because
          // `brain_import.resolved_symbol_id` is routinely null. F# emitted only
          // `references`, so an `open FSharp.Compiler.Diagnostic` was recorded under a
          // label that reader never looks at — 19 analyzers emit `imports` and this one
          // stored the fact where nothing was reading it.
          //
          // BOTH labels stay, and the asymmetry in confidence is the honest part:
          // `imports` is 1.0 because the directive NAMES the scope — the tree carries a
          // `long_identifier` and nothing is inferred — while the `references` edge
          // above stays at 0.9, which is what it was measured at. Both are parse facts;
          // the 0.9 is the lane's declared confidence for a file-level mention, and
          // raising or lowering it here would move a pinned row on a claim this change
          // has not measured.
          //
          // `open type X` is the SAME node (the grammar is `seq("open", optional("type"),
          // $.long_identifier)`), so the two spellings are distinguished by the token and
          // recorded in metadata rather than by being two node types.
          pushRel(
            qualifyScope(owner) || qualifyScope(fileScope) || "Global",
            targetNode.text,
            ASTEngine.RelationshipType.Imports,
            1.0,
            { nodeType: type, relationshipType: "open_directive", targetResolution: UNRESOLVED_NAMESPACE, ...(this.nodeHasToken(node, "type") ? { opensTypes: true } : {}) },
            lineOf(node),
          )
        }
      } else if (type === "infix_expression") {
        // FS-A6 (M60 pass 2): a BARE PIPELINE — `x |> f` as a WHOLE expression.
        //
        // F#'s pipeline operator is the language's defining idiom, and this lane claimed to
        // read it ("pipe `a |> List.map` -> `map`"). It did not, except by accident. The
        // `application_expression` branch has an `infix_expression` arm, so a pipeline was
        // read only when it happened to sit in CALLEE position — `f (x |> g)` — and the shape
        // F# is actually written in, a `let` whose body IS the pipeline, was dropped whole:
        //
        //     let relevant (diags: FSharpDiagnostic array) =
        //         diags
        //         |> Array.filter (fun d -> …)      // no `calls relevant -> filter` at all
        //
        // Measured on a 300-file draw of the corpus: **1,043** bare `|>` infix nodes, of which
        // **1,037** carry a NAME on the right, against 580 read in callee position. So the
        // label was missing roughly 11% of the calls the corpus writes, and it was missing
        // them in the single most idiomatic F# construct there is.
        //
        // WHY NO ORACLE CAUGHT IT, which is the part worth keeping: `script/m14/fsharp-truth-
        // oracle.ts` reads `application_expression` and `prefixed_expression` and has no
        // `infix_expression` branch either, so both sides said nothing and nothing disagreed.
        // That is exactly the failure the workstream document describes — "when a type is
        // absent from BOTH … both say nothing, and nothing agrees with nothing" — reproduced
        // inside a single label rather than across the ten.
        //
        // THE OPERATOR MAP, and why the composition operators are absent. `|>` `|>>` `>>=`
        // apply the RIGHT operand to the left one; `<|` `<<` apply the LEFT. The side is a
        // property of the operator, not of the expression, so it is read off the `infix_op`
        // TOKEN the grammar emits — there is no text pattern anywhere in this rule.
        // `>>` `>>>` `>=>` `<<<` are DELIBERATELY NOT HERE: they COMPOSE two functions and
        // call neither (`let h = f >> g` builds a closure), so an edge from them would be a
        // fabrication. Measured: 13 bare `>>` in the same 300-file draw, excluded on that
        // ground and not because they were hard to read.
        //
        // LATENCY, measured rather than assumed, and the measurement corrected a claim rather
        // than confirming one. A first A/B on a 120-file sample of the census's own draw read
        // 54.5 ms/file before against 63.2 after — +16%, with non-overlapping ranges, which
        // looked like a real cost for +8.4% more relationships. Re-measured INTERLEAVED on the
        // same files, because four lanes share this box: BEFORE 65.3 and 76.1, AFTER 77.8 and
        // 67.9. The ranges overlap almost completely, so the first reading was the load, not
        // the change, and **no latency claim finer than "inside the run-to-run spread of a
        // shared box" is supported by these numbers.** Stating the +16% would have been a
        // fabricated measurement of a shared machine's noise.
        //
        // What survives the correction is the code: the operator is read by a loop that breaks
        // on the token and allocates nothing, and the second pass over the children runs only
        // for an operator that IS a pipe. The F# compiler corpus is arithmetic-heavy, so
        // `a + b` and `x = y` reach this branch constantly and the cheapest possible test is
        // the right one even when its benefit is below the noise floor.
        let opText = ""
        let opIndex = -1
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i)
          if (c && c.type === "infix_op") { opText = c.text; opIndex = i; break }
        }
        const side = PIPELINE_CALLEE_SIDE.get(opText)
        if (side && callOwner && opIndex >= 0) {
          // FS-D30. THE CALLEE IS A WHOLE OPERAND, AND AN OPERAND CAN BE AN APPLICATION.
          //
          // The old rule read `named` — the DIRECT children that are name-like — and took
          // `named[named.length - 1]` for a right-pipe. `xs |> ignore` works that way because the
          // right operand IS a bare name; `xs |> f(y)` does not, because the parser puts an
          // `application_expression` there and `named` then holds only the LEFT operand, so the edge
          // named the pipeline's INPUT as the callee. Take the operand NODE instead, and read the
          // callee name out of it — descending one level when the operand is an application, which is
          // also what skips a lambda argument without needing the old name filter to do it.
          const operandNode = node.child(side === "right" ? opIndex + 1 : opIndex - 1)
          const calleeNode = this.pipelineCalleeName(operandNode)
          const calleeText = calleeNode?.text ?? ""
          const leaf = calleeText.split(".").pop() || calleeText
          if (calleeText.length > 1 && !this.isFSharpBuiltin(calleeText, leaf)) {
            const callSource = callOwnerQualified ?? callOwner
            const spelled = bindingSpelled(callSource, targetSpelling(calleeText, currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined, "member"))
            pushRel(
              callSource,
              spelled.target,
              ASTEngine.RelationshipType.Calls,
              0.8,
              {
                nodeType: type,
                isPipelineCall: true,
                pipelineOperator: opText,
                targetResolution: spelled.resolution,
                ...(spelled.qualifier ? { targetQualifier: spelled.qualifier } : {}),
                ...(spelled.localBinding ? { localBinding: true } : {}),
              },
              lineOf(calleeNode ?? node),
            )
          }
        }
      } else if (type === "application_expression") {
        // Call/instantiation: source = enclosing function/method/constructor,
        // target = leaf name of the callee (C# family contract).
        let fnName = ""
        const fnNode = node.namedChild(0)
        if (fnNode) {
          if (
            fnNode.type === "long_identifier" ||
            fnNode.type === "identifier" ||
            fnNode.type === "long_identifier_or_op"
          ) {
            fnName = fnNode.text
          } else if (fnNode.type === "infix_expression") {
            // Pipeline `a |> f` — the callee is the RHS operand.
            const rhs = fnNode.namedChild(fnNode.namedChildCount - 1)
            if (rhs && (rhs.type === "long_identifier" || rhs.type === "identifier" || rhs.type === "long_identifier_or_op")) {
              fnName = rhs.text
            }
          } else if (fnNode.type === "dot_expression") {
            fnName = fnNode.text
          }
        }
        // A4 (M60 pass 2): the gate used to be `fnName.length > 1`, which is not a rule
        // about the program. By the time this branch runs, the grammar has already said the
        // callee is a NAME — the node it was read from is a `long_identifier`,
        // `identifier`, `long_identifier_or_op` or `dot_expression` — so the only thing the
        // length test removed was every call to a ONE-LETTER function, and F# is full of
        // them: `let f x = …` composed into `f getLines`, `f argv.[!cursor]`.
        //
        // Measured, not assumed. Instrument B counts **5,313** one-character applications
        // over the 6,619-file corpus, in 735 files
        // (validation/m14/fixtures/fsharp/ontology-probe.ts, probe A4), against a full-extent
        // `calls` count of 246,327 — 2.2% of the label, dropped for no reason. And the
        // dropped population is MORE resolvable than the emitted one, which is the number
        // that decided it: on a 120-file draw of the census's own sample, 32.4% of the
        // one-character callees name a symbol the SAME file publishes, against 22.2% for
        // emitted `calls` edges in-file
        // (validation/m14/fixtures/fsharp/one-char-calls.ts). A gate that removes the
        // better-resolving edges is not a noise filter, it is an unexamined rule.
        //
        // The gate also stood in front of the CONSTRUCTOR-CHAINING `instantiates` below,
        // which is why that label gained an edge on the 400-file draw when this was removed.
        // Nothing here infers: `fnName` is still the callee's written name and `leaf` is
        // still its last segment, and the builtin filter below is unchanged.
        if (fnName && callOwner) {
          const leaf = fnName.split(".").pop() || fnName
          if (!this.isFSharpBuiltin(fnName, leaf)) {
            // Constructor chaining `new() = Point(0, 0)` — instantiation of the
            // enclosing type from the constructor body.
            const enclosingType = currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined
            if (callOwner === "constructor" && leaf === enclosingType) {
              pushRel(
                callOwnerQualified ?? callOwner,
                leaf,
                ASTEngine.RelationshipType.Instantiates,
                0.95,
                { nodeType: type, isConstructorChain: true },
                lineOf(node),
              )
            } else {
              const callSource = callOwnerQualified ?? callOwner
              const spelled = bindingSpelled(callSource, targetSpelling(fnName, enclosingType, "member"))
              pushRel(
                callSource,
                spelled.target,
                ASTEngine.RelationshipType.Calls,
                0.8,
                {
                  nodeType: type,
                  targetResolution: spelled.resolution,
                  ...(spelled.qualifier ? { targetQualifier: spelled.qualifier } : {}),
                  ...(spelled.localBinding ? { localBinding: true } : {}),
                },
                lineOf(node),
              )
            }
          }
        }
      } else if (type === "prefixed_expression") {
        // FSD8(b): an explicit `new Foo(...)` is a CONSTRUCTION. `new` is the
        // only thing that distinguishes one in F# — a bare `Foo(...)` stays a
        // call (a capitalised name is not evidence), which is why this reads the
        // prefix token instead of the callee's spelling. The inner application
        // must not ALSO emit a call: the operand's children go on the stack, the
        // operand node itself does not, so its call branch never runs while
        // calls inside its ARGUMENTS still do.
        if (this.firstTokenIs(node, "new") && callOwner) {
          const operand = node.namedChild(0)
          if (operand && operand.type === "application_expression") {
            const calleeNode = operand.namedChild(0)
            const calleeText = calleeNode ? calleeNode.text : ""
            const leaf = calleeText.split(".").pop() || calleeText
            // A4-DISCLOSED: this gate has the same shape as the one removed from `calls`
            // above and the same lack of a reason — `new` + a name is a construction whatever
            // the type is called — but it was NOT measured, so it stays. Removing an
            // unmeasured gate on the strength of a measured one is the same move this lane
            // criticises elsewhere; the corpus population of a one-letter constructed type is
            // not established either way, and saying so is cheaper than guessing.
            if (calleeText && calleeText.length > 1 && !this.isFSharpBuiltin(calleeText, leaf)) {
              // FS-P6-4: `new X()` names a TYPE and not a member of one, which is why this
              // call site asks for the `type` position. It is also the measured answer on this
              // label: respelling its discarded qualifiers into `${last}.${leaf}` buys 0 edges
              // and loses 11 (.tmp-probe/fs-p6-price.py, `instantiates` rows — 53
              // `external-type-or-module` and 94 `opened-module` edges carry a qualifier at
              // all), because a written type is stored with its WHOLE namespace as its owner
              // (`System.Text.StringBuilder`, not `Text.StringBuilder`).
              const spelled = targetSpelling(calleeText, currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined, "type")
              pushRel(
                callOwnerQualified ?? callOwner,
                spelled.target,
                ASTEngine.RelationshipType.Instantiates,
                0.95,
                {
                  nodeType: type,
                  isNewConstruction: true,
                  targetResolution: spelled.resolution,
                  ...(spelled.qualifier ? { targetQualifier: spelled.qualifier } : {}),
                },
                lineOf(node),
              )
              for (let i = operand.namedChildCount - 1; i >= 0; i--) {
                const argChild = operand.namedChild(i)
                if (argChild) {
                  walkStack.push({ node: argChild, scopePath: currentScope, callOwner: childCallOwner, callOwnerQualified: childCallOwnerQualified, bodyDepth: childBodyDepth })
                }
              }
              continue
            }
          }
        }
      } else if (type === "compiler_directive_decl") {
        const nameNode = this.findDescendant(node, (n) => n.type === "identifier" || n.type === "long_identifier")
        if (nameNode && nameNode.text) {
          publish({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Macro,
            range: this.nodeToRange(node),
            ownerName: currentScope.length > 0 ? currentScope[currentScope.length - 1] : undefined,
            metadata: { nodeType: type },
          })
        }
      }

      // FS-P9: a clause frame carries the definition-level `attributes` written for it, and
      // this is where they enter the walk — INSIDE the clause's scope, so their `uses` edges
      // name the clause. Only the carried ones are pushed: the clause's own nested
      // attributes are its ordinary named children and go on the stack just below.
      if (asTypeUnit) {
        for (const attrs of unitAttributes ?? []) {
          walkStack.push({ node: attrs, scopePath: currentScope, callOwner: childCallOwner, callOwnerQualified: childCallOwnerQualified, bodyDepth: childBodyDepth })
        }
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          walkStack.push({ node: child, scopePath: currentScope, callOwner: childCallOwner, callOwnerQualified: childCallOwnerQualified, bodyDepth: childBodyDepth })
        }
      }
    }

    // Add Contains relationships: scope owner → owned symbols (the line is the
    // symbol's own line — the containment fact is ABOUT that declaration).
    //
    // FS-D3: a self-edge is refused, because a name that contains itself is a
    // statement about the graph's own bookkeeping rather than about the code, and a
    // consumer walking containment would loop. Measured on 400 real files
    // (script/m14/tmp/fs012-self-containment.ts): 368 such edges from three distinct
    // sources — a DU case named after its own type (`type
    // TypeProviderDesignation = TypeProviderDesignation of string`, a real and common
    // F# spelling, 305 of them), a member named after its own type (3 sites: `E.E`,
    // `MatchClause.Pattern`, `Map.Map`), and the `type_extension` of FS-D2.
    //
    // The refusal is at COMPOSITION, covering every tier — the same place the c lane's
    // #917 self-override fix put it — so the alternative (suppressing the label) is not
    // on the table: the DU case genuinely IS contained by its union.
    // FS-P4-2. A CONTAINMENT EDGE NAMES TWO SYMBOLS THIS FILE PUBLISHED, SO IT NAMES
    // THEM BY THE IDENTITY IT PUBLISHED.
    //
    // Both endpoints were already symbols of this file — the parent by `ownerName`,
    // the child by `name` — and both were written as BARE names. The store matches a
    // relationship endpoint against `name`, then `qualified_name`, then a leaf
    // fallback (`parallel-indexer.ts` strategies 1-3), so a bare `Describe` is only
    // determinate while exactly one symbol in the project carries that name, and
    // `Shape.Describe` — the string `publish` already minted into `metadata.fqn` and
    // the store already derives `qualified_name` from — is an exact hit.
    //
    // Measured on the full corpus: `contains` is 205,217 edges and 68,415 of them
    // (33.3%) are determinate today (probe .tmp-probe/fs-spelling-effect.py over
    // validation/m14/measurements/fsharp-incoming-abc-600.json's own draw). Both
    // endpoints of every one of these edges are symbols THIS analyzer published, so
    // both spellings are available at composition time and nothing is inferred.
    //
    // The parent is read back out of the symbol set rather than tracked, because the
    // edge is composed after the walk and the parent may be any ancestor tier
    // (namespace, module, type, member). Where the name is ambiguous within the file
    // the map holds `null` and the BARE spelling is kept — a wrong qualified
    // spelling would be worse than an ambiguous bare one, and this is the same
    // discipline the lane's `contains` source rule already applies through the
    // store's line-based enclosure lookup.
    // FS-P7-1 caught itself here, and the correction is worth recording because the first
    // version was a LIE THAT LOOKED LIKE A CLASS. `fqn` is minted by `publish` only for an
    // OWNED symbol, so a top-level `module Fixture.OverrideTarget` has NO fqn, the map holds
    // null for its name, and the reason recorded on every module-scoped containment edge was
    // `ambiguous-owner-name` — a claim that two declarations share the name, which is false.
    // Measured on `override-target`: EVERY `contains` edge whose parent was the file's module
    // carried it, and on the draw the class would have swallowed the 30% of `contains` that is
    // plain module scoping. The two cases are now told apart, because they are two facts:
    // a unit with no owner IS its own name (`Fixture.OverrideTarget` is the whole identity),
    // while two symbols with one name and different fqns are a genuine ambiguity.
    const parentNameCounts = new Map<string, number>()
    const ownerlessUnitNames = new Set<string>()
    for (const s of symbols) {
      if (!s.name) continue
      if (!s.ownerName) ownerlessUnitNames.add(s.name)
      else parentNameCounts.set(String(s.ownerName), (parentNameCounts.get(String(s.ownerName)) ?? 0) + 1)
    }
    const fqnByName = new Map<string, string | null>()
    for (const s of symbols) {
      if (!s.name) continue
      const fqn = typeof (s.metadata as any)?.fqn === "string" ? ((s.metadata as any).fqn as string) : null
      const prev = fqnByName.get(s.name)
      if (prev === undefined) fqnByName.set(s.name, fqn)
      else if (prev !== fqn) fqnByName.set(s.name, null)
    }
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner && _owner !== s.name) {
        const childFqn =
          typeof (s.metadata as any)?.fqn === "string" ? ((s.metadata as any).fqn as string) : s.name
        const parentFqn = fqnByName.get(String(_owner))
        pushRel(
          parentFqn || String(_owner),
          childFqn,
          ASTEngine.RelationshipType.Contains,
          1.0,
          {
            nodeType: s.metadata?.nodeType || "symbol",
            isContained: true,
            // FS-P7-1. Both ends of a containment edge get a reason, because both ends
            // have one and only the target's was ever written down.
            //
            // The TARGET is always an identity this file minted, so it needs no class
            // beyond that fact: `contains` cannot spell its child any other way — the
            // child IS the symbol, and re-spelling it would attach the edge to a
            // different symbol. What the class does is make the residual auditable: a
            // target that does not resolve is a target the CORPUS duplicates (the `.fs`
            // and `.fsi` halves of one declaration, or two files declaring the same
            // identity), never an analyzer guess.
            targetResolution: "published-identity",
            // The SOURCE is the parent's identity when the file has exactly one symbol of
            // that name, and the bare owner NAME when it has two with different
            // identities (`fqnByName` nulls the ambiguous case) — a real loss of one end,
            // invisible until it is named.
            //
            // THREE classes, not two, because a top-level unit is not an ambiguity: a
            // module with no owner IS its own name, and calling that ambiguous (the first
            // draft did) mislabelled every module-scoped containment in the corpus.
            sourceResolution: parentFqn
              ? "in-file-declaration"
              : ownerlessUnitNames.has(String(_owner))
                ? "ownerless-unit"
                : (parentNameCounts.get(String(_owner)) ?? 0) > 1
                  ? "ambiguous-owner-name"
                  : "in-file-declaration",
          },
          s.range?.startLine,
        )
      }
    }

    // FS-D4: the R9 declared-type reference graph. See extractDeclaredTypeRefs.
    this.extractDeclaredTypeRefs(rootNode, pushRel, publishedNames, fqnOfName, typeFqnOfName)

    // FS-D8: the EXPORT surface — the importable-unit set, and (FS-D13, below the payload
    // push) the `exports` RELATIONSHIP that carries the same set into the graph. F#'s
    // importable units are the ones an `open` can bind:
    //   * a file-scope unit — a namespace, a module, a type (a DU case is reachable
    //     through its type, never on its own);
    //   * a MODULE's own members, because `open M` binds them directly. F# is the
    //     haskell/ocaml shape the fixture-runner's export invariant already names, and
    //     that invariant is what caught the previous behaviour: the lane exported EVERY
    //     non-variable symbol, so a record field, a method and an object expression's
    //     member were published as importable units no `open` can bind. F3 reports it
    //     as `export(s) … do not resolve to a top-level symbol (membership rides
    //     Contains)`.
    //   * a TYPE's members are NOT exported — `open M` binds `M.Type`, and a member is
    //     reached as `M.Type.Member`; membership rides `contains`.
    //
    // VISIBILITY, which this now reads and previously did not: the grammar emits an
    // `access_modifier` node and F# has three levels, so an `internal` or `private`
    // declaration is not exported. The old code wrote `visibility: "public"` for every
    // symbol regardless, and the F# compiler corpus is full of internal types
    // (`type internal Tables<'Token>`, `type internal ByteMemory`).
    //
    // FORWARD DECLARATIONS (an `.fsi` `type X` followed by `type X = …`) are ONE
    // entity: both symbols stay, and the export names the DEFINITION, which is the one
    // carrying the members — the same surface/definition merge the lane already applies
    // to `module_val_declaration` (the Clean .dcl/.icl precedent). The fixture-runner
    // invariant's uniqueness clause is what surfaced this: `duplicate export name(s)
    // ["Surface"]`.
    const exportedNames = new Set<string>()
    const declaredUnits = new Set(
      symbols
        .filter((s) => !s.ownerName && s.metadata?.isForwardDeclaration !== true)
        .map((s) => s.name),
    )
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.Variable) continue
      // a DU case / record field is reachable through its type, not on its own
      if (s.kind === ASTEngine.SymbolKind.EnumMember) continue
      const isForwardDecl = s.metadata?.isForwardDeclaration === true
      if (isForwardDecl && declaredUnits.has(s.name)) continue
      const visibility = this.visibilityOf(s)
      if (visibility === "private" || visibility === "internal") continue
      const isTypeMember =
        !!s.ownerName && !moduleNames.has(s.ownerName) && !namespaceNames.has(s.ownerName)
      if (isTypeMember) continue
      if (!s.ownerName && (s.kind === ASTEngine.SymbolKind.Property || s.kind === ASTEngine.SymbolKind.Method)) continue
      if (exportedNames.has(s.name)) continue
      exportedNames.add(s.name)
      exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: visibility as any })

      // FS-D13, THE EDGE. The payload above is the file's importable-unit set, and until
      // this rule it reached the parse result and nothing else — so an F# symbol had no
      // `exports` row in the graph while Swift's `public`, R's roxygen and Lua's chunk
      // return all had one, and `src/lsp/rich_hover.ts` ("outgoing: exports", "incoming:
      // exported by") answered "exported by" for no F# symbol in the corpus.
      //
      // WHY THE LABEL IS NOT A SECOND NAME FOR `contains`, which is the one objection the
      // old ruling rested on. The two ask different questions over the same symbols:
      // `contains` is MEMBERSHIP (every child of every scope: type members, record fields,
      // DU cases, `private`/`internal` lets) while `exports` is the IMPORTABLE-UNIT SET.
      // The programme's own contract says exactly this, in the fixture runner's M49
      // exports-family invariant (`script/m14/run-fixtures.ts:1471`): "haskell/ocaml-style
      // MODULE-owned symbols (`import Data.User (mkUser)` binds mkUser directly — the
      // module is the namespace, members are importable by name)" are exports, while
      // "NOT type-owned members … membership rides Contains". F# is the haskell/ocaml
      // shape, so this rule emits the module-owned members and the file's own top-level
      // units, and nothing a `contains` row would have to answer for twice.
      //
      // THE TWO ENDPOINTS, both spelled by rules this lane already settled:
      //   * the TARGET is the symbol's PUBLISHED IDENTITY — `metadata.fqn` when the funnel
      //     minted one, the bare name otherwise — which is the same spelling `contains`
      //     (FS-P7-2), the declared-type graph and the store's `qualified_name` use. A
      //     leaf here would put `Speak` in the graph instead of `Dog.Speak` and the edge
      //     would bind to whichever same-named symbol the project declares first.
      //   * the SOURCE is the scope that PUBLISHES it: the enclosing module/namespace's
      //     published identity, which is exactly what `contains` already names as the
      //     parent (one lookup, `fqnByName`, built above for that emission). A file's own
      //     top-level unit (a `module M`/`namespace N` header) has no owner, and for those
      //     the source is `Global` — this lane's established spelling for a file-scope
      //     source (FS-D10: "a module-less file must source its file-level edges from
      //     `Global`, never from the opened name itself"). No symbol is invented from the
      //     filename, which is the fabrication the Lua lane's ruling refuses.
      //
      // WHAT THIS RULE DOES NOT DO: it does not re-read visibility, kinds or the `.fsi`
      // surface/definition merge. Every one of those decisions is the payload's, and this
      // edge is emitted from the SAME entry in the SAME loop, so the payload channel and
      // the graph cannot disagree about what the file publishes — the failure mode
      // (Rust's M60 #910) that a second, parallel filter would reintroduce.
      const exportTarget =
        typeof (s.metadata as any)?.fqn === "string" ? ((s.metadata as any).fqn as string) : s.name
      const exportOwner = s.ownerName || s.scope
      const exportParent = exportOwner ? fqnByName.get(String(exportOwner)) || String(exportOwner) : null
      pushRel(
        exportParent || "Global",
        exportTarget,
        ASTEngine.RelationshipType.Exports,
        1.0,
        {
          nodeType: s.metadata?.nodeType || "symbol",
          // WHICH rule of the FS-D8 surface published this name, so a consumer can tell an
          // export from a containment row without re-deriving the filter.
          exportForm: "module-surface",
          declaredKind: s.kind,
          visibility,
          publishedBy: exportOwner ? "enclosing-scope" : "file-scope",
          // The SAME three-valued source class `contains` writes (FS-P7-1), because the
          // lookup and its two failure modes are the same lookup: a top-level unit is not
          // an ambiguity, an owner the file published twice is, and a source that fell
          // back to the bare owner name says so rather than reading as a declaration.
          sourceResolution: exportParent
            ? "in-file-declaration"
            : ownerlessUnitNames.has(String(exportOwner))
              ? "ownerless-unit"
              : (parentNameCounts.get(String(exportOwner)) ?? 0) > 1
                ? "ambiguous-owner-name"
                : "in-file-declaration",
          targetResolution: "published-identity",
        },
        s.range?.startLine,
      )
    }

    // FS-P7-1, the decision half. The walk marked WHAT KIND of name each target is; this is
    // where the kind becomes the reason, using the COMPLETE published set — which is the
    // only point at which "does this file declare it" is a question about the file rather
    // than about how far the walk has got. Neither marker can survive this loop, and the
    // loop is unconditional rather than keyed on a label list, so a future emission site
    // that reuses a marker is finalized too instead of silently shipping a marker value.
    for (const rel of relationships) {
      const md = rel.metadata as Record<string, any> | undefined
      if (!md) continue
      const marker = md.targetResolution
      // The guard lists EVERY marker. Its first draft listed two of the four and the other
      // two fell through it — the fixture probe printed `res=unresolved-base-name` on
      // `override-target` within a minute of the code existing, which is the only reason
      // this is a fixed bug rather than a shipped marker value on every override edge in
      // the corpus. A gate could not have caught it: nothing pinned these classes yet.
      if (
        marker !== UNRESOLVED_TYPE &&
        marker !== UNRESOLVED_NAMESPACE &&
        marker !== UNRESOLVED_BASE &&
        marker !== UNRESOLVED_INTERFACE
      ) continue
      const target = String(rel.target ?? "")
      const leaf = target.split(".").pop() ?? ""
      // FS-P7-2. THE TWO KINDS OF NAME ASK DIFFERENT QUESTIONS, and the first draft asked one
      // of them twice. A TYPE is this file's when a TYPE-kind symbol published that name (its
      // leaf, because a type inside a module is published as `Module.Type` and an annotation
      // writes either form) or when the whole written path is an identity this file minted. A
      // NAMESPACE/MODULE path is this file's only when the WHOLE path is an identity this file
      // minted — `open Deedle` in a file that declares `type Deedle` is an open of somebody
      // else's module, which the leaf test alone called `in-file-declaration`.
      if (marker === UNRESOLVED_TYPE) {
        const inFile = publishedTypeNames.has(leaf) || publishedQnames.has(target)
        md.targetResolution = inFile ? "in-file-declaration" : "external-type"
        continue
      }
      if (marker === UNRESOLVED_NAMESPACE) {
        md.targetResolution = publishedQnames.has(target) ? "in-file-declaration" : "external-namespace"
        continue
      }
      // The two override forms: the name to test is the TYPE the member belongs to, which
      // is the written base when the site recorded one (a base written with a namespace is
      // the case that needs it) and otherwise the target's own prefix.
      const writtenBase = typeof md.targetWritten === "string" && md.targetWritten
        ? String(md.targetWritten).split(".").pop() ?? ""
        : target.split(".").slice(0, -1).join(".")
      const baseInFile = publishedTypeNames.has(writtenBase)
      md.targetResolution = marker === UNRESOLVED_INTERFACE
        ? (baseInFile ? "interface-member" : "interface-member-external")          : (baseInFile ? "base-member" : "base-member-external")
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FS-P10. THE PROJECT-INDEX REFINEMENT — the classes that say "not this file"
    // become classes that say WHICH "not this file".
    //
    // WHY THIS EXISTS, and why it is the thing the index is FOR. Every class the two
    // passes above can produce for a name this file does not publish is a class about
    // EXTERNALITY, and none of them was answerable by one file:
    //
    //   bare-external           — "no identity for this name here", which the name
    //                             `external` asserts is elsewhere and the class cannot
    //                             support: on the 3,000-file draw this is 65,296 `calls`
    //                             edges, and a slice of them are this file's OWN later
    //                             declarations (the walk fills `fqnOfName` as it goes, so a
    //                             forward reference looks external at emit time).
    //   external-type-or-module — "the owner is module-like and not opened here", 68,453
    //                             `calls` edges, of which the project owning that very name is
    //                             the cross-file case and is indistinguishable from FSharp.Core.
    //   base-member-external, interface-member-external — an override whose base type this
    //                             file does not declare. The base being declared in ANOTHER
    //                             FILE of the project is exactly the population pass 8 counted
    //                             and then had to leave stranded.
    //
    // Priced before it was written, on the same 3,000-file draw and pool the pass-6/8/11/13/15
    // tables use (`.tmp-probe/fs-p16-index-refine.py`, arm rows-pass15-meta.ndjson): the
    // project's own declaration set answers "is this name declared anywhere in this project"
    // for every one of those classes, and the answer splits each of them in two.
    //
    // WHAT IT DOES NOT DO, stated because the omission is a decision. It re-classifies; it
    // does NOT re-spell. Pass 15 measured the sound re-spelling population at 929 edges of
    // 357,591 (0.26%) — the project must publish an owner that ENDS WITH the written one, and
    // a bare "the project has exactly one `map`" rule is UNSOUND (`String.map` would be
    // rewritten to `Seq.map`). 929 edges do not justify changing what the analyzer WRITES; a
    // consumer that joins on the identity can see the project's own symbol table directly, and
    // that is the store's job, not a second guess written into the edge.
    //
    // It also does not refine `external-namespace`, and the reason is a gap in the SHARED
    // index rather than a decision here: `ProjectIndex` carries declared TYPES and MEMBERS
    // (`typeKinds`, `typeMembers`, `symbolNames`), and F# declares a module or a namespace in
    // neither — so `open Deedle` has nothing in the index to be tested against. Adding a
    // namespace channel to the shared type is a contract change across forty-eight lanes and
    // is recorded as such rather than approximated with a test that would mostly answer
    // "nothing is declared" to a question about declarations.
    //
    // Gated on the index being genuinely present: with no index every class is exactly
    // what it was, byte for byte, which is what keeps the fixture runner's flat fixtures and
    // every per-file caller on the pre-index contract.
    const projectIndex: any = (context as any)?.projectIndex
    if (projectIndex && relationships.length > 0) {
      const projectTypes: Map<string, string> | undefined = projectIndex.typeKinds
      const projectNames: Set<string> | undefined = projectIndex.symbolNames
      const projectMemberMap: Map<string, Set<string>> | undefined = projectIndex.typeMembers
      const projectBaseMap: Map<string, string[]> | undefined = projectIndex.typeBases
      const knowsType = (n: string): boolean => n.length > 0 && (projectTypes?.has(n) ?? false)
      const knowsName = (n: string): boolean =>
        n.length > 0 && ((projectNames?.has(n) ?? false) || knowsType(n))
      // The base's member set, INHERITANCE-CLOSED, because F# inherits an interface's members
      // through another interface (`interface IFoo inherit IBar`). Cycle-guarded: a type graph
      // with a cycle must terminate at "nothing known" rather than hang a whole index run.
      const memberClosure = (t: string, seen = new Set<string>()): Set<string> => {
        const direct = projectMemberMap?.get(t)
        if (direct === undefined) return new Set<string>()
        if (seen.has(t)) return new Set<string>()
        seen.add(t)
        const out = new Set<string>(direct)
        for (const b of projectBaseMap?.get(t) ?? []) {
          for (const m of memberClosure(b, seen)) out.add(m)
        }
        return out
      }
      for (const rel of relationships) {
        const md = rel.metadata as Record<string, any> | undefined
        if (!md) continue
        const cls = String(md.targetResolution ?? "")
        const target = String(rel.target ?? "")
        const leaf = target.split(".").pop() ?? ""
        // The owner the SOURCE wrote, in preference order: the qualifier this walk discarded,
        // the written type spelling an emission site preserved, otherwise the target's own
        // path. All three are the same fact recorded by different sites, and the test uses the
        // most specific one that exists rather than pretending they are the same string.
        const writtenOwner = ((): string => {
          const q = typeof md.targetQualifier === "string" ? md.targetQualifier : ""
          const w = typeof md.targetWritten === "string" ? md.targetWritten : ""
          const qt = typeof md.qualifiedType === "string" ? md.qualifiedType : ""
          const own = target.includes(".") ? target.slice(0, target.lastIndexOf(".")) : ""
          return q || w || qt || own
        })()
        const ownerHead = writtenOwner.split(".")[0] ?? ""
        const ownerLeaf = writtenOwner.split(".").pop() ?? ""
        let next = ""
        if (cls === "bare-external") {
          // The name itself, because a bare target has no owner and the question is whether the
          // PROJECT declares that name at all. `in-project-name` is deliberately not spelled
          // `in-project-declaration`: the index records that a declaration EXISTS, not that
          // this edge binds to it, and a class named for the binding would be the confident
          // wrong answer this lane's standard forbids.
          if (knowsName(leaf)) next = "in-project-name"
        } else if (cls === "external-type-or-module") {
          // The OWNER, because that is what the class is about: `Seq.map`'s question is `Seq`.
          //
          // FS-P17 WIDENED THIS FROM `knowsType` TO `knowsName`, because the index now records
          // module and namespace headers as names (`nameOnlyNodes`) and a module owner is the
          // whole point of the class: on the 3,000-file draw **23,995** of this class's edges hang
          // off a module name the project declares, against the 819 a binding channel reaches.
          //
          // The test is the WRITTEN OWNER AS A WHOLE PATH and not its leaf, and the difference is
          // the difference between a claim and a guess: `FSharp.Core.Seq.map`'s owner is
          // `FSharp.Core.Seq`, and a project that declares a `Seq` module does not make THAT path
          // in-project — testing the leaf would refine it, which is the confident wrong answer
          // this lane's standard forbids. The cost is a miss (a multi-segment external path whose
          // last segment is a project name stays external) and misses are recorded, not hidden.
          //
          // THE CLAIM, PRECISELY, because "in-project" would be a bigger one: the project declares
          // a declaration whose name EQUALS the written owner. In F# a dotted member path's owner
          // can only be a type or a module, so the ordinary reading is right — but the index's
          // name set also holds bindings and members, so a binding that happens to share the
          // owner's name would satisfy the test without the owner being material. Measured where
          // it matters: on the Argu corpus the class moved 139 edges and BOTH shadowing owners
          // (`String`, `Seq`) are real modules (`src/Argu/Utils.fs:26,37`), so the imprecision is
          // 0 of 178 refinements there. It is stated instead of fixed because fixing it means a
          // THIRD schema channel for module names (a new `ProjectIndex` field, its serialiser and
          // its version), and shadowing an owner name with a binding is not a shape this corpus
          // has. The store's own attachment rate is the honest reading of the value: 260/260
          // `in-project-type`, 126/126 `in-project-name`, 36/36 `in-project-namespace`, and
          // 49/178 `in-project-type-or-module` — the last one low precisely because F# projects
          // redeclare FSharp.Core module names.
          if (knowsType(writtenOwner) || knowsName(writtenOwner)) next = "in-project-type-or-module"
        } else if (cls === "external-namespace") {
          // FS-P17. An `open`'s target IS the name — `open Fixture.Project.Domain` spells the
          // namespace's whole header, and the index records a namespace or module header as exactly
          // that string (verified against the tree: `namespace Fixture.Project.Domain` is a
          // `namespace` node whose `long_identifier` TEXT is the dotted path, and the analyzer
          // publishes its own module symbol under the same spelling).
          //
          // EXISTENCE, not reachability, and the residual is stated: a nested module is recorded
          // under its own name (`Inner`, whose written form is `Outer.Inner`), and `open System.IO`
          // in a project that declares `namespace System.IO` reads in-project — which is TRUE, the
          // project does declare it, and is the same shadowing ambiguity every `in-project-*` class
          // here carries rather than claiming the resolver bound it.
          if (knowsName(target)) next = "in-project-namespace"
        } else if (cls === "external-type") {
          if (knowsName(leaf)) next = "in-project-type"
        } else if (cls === "base-member-external" || cls === "interface-member-external") {
          const baseLeaf = ownerLeaf
          if (knowsType(baseLeaf)) {
            next = cls === "interface-member-external" ? "interface-member-in-project" : "base-member-in-project"
            // The MEMBER half, and it is the reason this tier is worth having: an override
            // asserted against a base that is a project type and does NOT declare the member is
            // the fabricated-edge defect the python and dart lanes each measured before their
            // companion tier existed. Reported as METADATA rather than by dropping the edge —
            // dropping would be a silent gap, and this lane's standard is a measured reason.
            // "Unknown" is recorded as silence: a base with no indexed members at all (the spec
            // indexes `member_defn`, not fields) has no member set to answer with, and asserting
            // `lacks` from an empty set would invent the very defect this reports.
            if (projectMemberMap?.has(baseLeaf)) {
              const members = memberClosure(baseLeaf)
              if (members.size > 0 && !members.has(leaf)) md.baseInProjectLacksMember = true
            }
          }
        }
        if (next !== "") {
          md.targetResolution = next
          md.projectIndexRefined = true
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════════════════════════
    // FS-P18. THE DECLARED CAUSE — the reason this walk already holds, published on the key
    // the incoming gate's bucket-3 channel reads (`baseBeyondRunScope`, `incoming-rule.ts:274`).
    //
    // WHY THIS EXISTS, and it is a defect about a KEY rather than about a reason. This lane
    // computes a reason for every edge it cannot bind (`metadata.targetResolution`, assigned
    // a few hundred lines up) and the gate's clause 2 was satisfied VACUOUSLY: the gate
    // printed `clause 2 ok … no edge carries a declared cause (residual 26288)`, because the
    // only key it reads for a stated cause was never written. A classification published on a
    // key nobody reads is not a classification; the fleet census names this lane as that
    // instance (`RESIDUAL-CLASSIFICATION-41-LANES.md:23-25`).
    //
    // WHAT IS PUBLISHED. `baseBeyondRunScope` carries the BASE — the gate's own definition of
    // it, everything before the target's last dot — and it says only what a per-file walk can
    // truthfully say: *this run could not reach that base*. It is NOT an external claim, and
    // the difference is the whole reason the channel exists: `isExternal` claims a fact about
    // the PROJECT, which a file cannot check and which this lane measured 17.9%-70.4% TRUE at
    // project scope before retiring it (FS-P8, below); `baseBeyondRunScope` claims a fact about
    // the RUN, which the gate verifies against the edge's own target and never folds into a
    // resolution.
    //
    // THE FIVE CHECKS. Each one is a way the claim would be FALSE or REFUTED rather than a
    // convention, and all five are computed here rather than assumed from the class name:
    //
    //   1. THE CLASS is one whose own meaning is "this file does not publish this path". The
    //      whitelist is explicit and the classes that assert the OPPOSITE are absent from it
    //      on purpose: `self-member` and `base-member` name a base THIS FILE published (the
    //      enclosing type, the resolved base), and `opened-module` names a module this file
    //      OPENED — in all three the base was within the run's reach, so bucket 3's sentence
    //      would be false. Measured on the gate's own 400-file stride: those three classes
    //      hold 188 + 6 + 49 unresolved edges, 201 of them owner-shaped, and every one is
    //      left unclaimed.
    //   2. NOT PROJECT-INDEX-REFINED. FS-P10 renames a class to `in-project-*` when the RUN's
    //      project index answered the name positively — the run could look, and it did, so
    //      "beyond this run's reach" would be a false statement about a base it just found.
    //   3. THE BASE IS ONE IDENTIFIER SEGMENT, which is the gate's own spelling test
    //      (`incoming-rule.ts:1152-1156`) and the only shape where `targetOwner(target)` can
    //      equal the reason. A base with a dot (or a bare target) reads `causeRefuted` — a
    //      clause-4 MUST-BE-ZERO column — so this check is what keeps the change from moving
    //      16,817 edges from `unresolved` into `causeFAIL` instead of into `causeOK`.
    //   4. THE RUN NEITHER PUBLISHED NOR OPENED THE BASE, checked against the COMPLETE published
    //      sets (the walk has finished, which is what makes this decidable here and not at
    //      emit time). This is the check that refuses 1,018 of the 8,129 owner-shaped edges in
    //      these classes on the gate's stride — 617 of them already visible to the replica's
    //      narrower "name or qualifiedName" reach test, whose examples are
    //      `Bolero/tests/Unit.Client/Templating.fs:246 -> File.Nested1` (the file publishes
    //      `File`) and `Deedle/src/Deedle.Parquet/Parquet.fs:466 -> Frame.addCol` (the file
    //      opened `Frame`). The remaining 401 are opened HEAD segments the replica does not
    //      model: `open BenchmarkDotNet.Attributes` puts `BenchmarkDotNet` — the base of that
    //      very `open` edge — into `openedScopes`, so the claim is refused rather than made
    //      about a namespace the file just opened.
    //   5. NO EXTERNAL CLAIM IS ON THE EDGE. Bucket 3 and the external books are mutually
    //      exclusive by contract, and an edge carrying both is `causeRefuted` BEFORE its count
    //      is read — "I could not see it" and "it is outside the population" are two different
    //      statements and a lane that makes both has claimed nothing.
    //
    // WHAT IT CANNOT DO, stated because a reader will otherwise assume more: it cannot raise
    // `resolved` (the gate reads it only where the target names nothing, so it can only
    // re-label a gap), it cannot move `collRes` (nothing about any target changes), and it
    // does not touch `bare-external` — 11,531 unresolved edges, the lane's largest bucket,
    // whose targets have NO owner for the reason to name and are therefore refused by check 3
    // rather than by a decision here.
    const CAUSE_BASE_CLASSES = new Set([
      "external-type-or-module",    // the owner is module-like and NOT opened here (:537, :548)
      "external-namespace",         // the namespace path is not an identity this file minted (:2428)
      "module-member",              // `penult.leaf`, the two-segment form unpublished here (:532)
      "base-member-external",       // the base type is not in this file (:520, :2439)
      "interface-member-external",  // ditto, for the interface form (:2439)
    ])
    const CAUSE_BASE_SHAPE = /^[A-Za-z_$][A-Za-z0-9_$]*$/
    // The external-claim keys, spelled as `incoming-rule.ts` EXTERNAL_KEYS spells them. A copy
    // rather than an import because this analyzer imports nothing from the gate layer, and the
    // cost of divergence is bounded and loud: a key added there and not here would let check 5
    // miss it, and the gate would report the conflict as `causeRefuted` — visible in clause 4
    // rather than silent. Named here so the next reader knows which copy to update.
    const EXTERNAL_CLAIM_KEYS = [
      "zigExternalRef", "nimStdlibModule", "isExternal", "isExternalTarget", "external",
      "externalRef", "isStdlib", "stdlibModule", "moduleNamingEdges", "markAsExternal",
      "isExternalBase", "importOutsideProject",
    ]
    for (const rel of relationships) {
      const md = rel.metadata as Record<string, any> | undefined
      if (!md) continue
      if (!CAUSE_BASE_CLASSES.has(String(md.targetResolution ?? ""))) continue
      if (md.projectIndexRefined === true) continue
      if (EXTERNAL_CLAIM_KEYS.some((k) => md[k] === true || (Array.isArray(md[k]) && md[k].length > 0))) continue
      const target = String(rel.target ?? "")
      const dot = target.lastIndexOf(".")
      if (dot <= 0) continue
      const base = target.slice(0, dot)
      if (!CAUSE_BASE_SHAPE.test(base)) continue
      // THE RUN'S REACH, read off the sets the walk filled: a base this file published, named as
      // a module/namespace header, opened, or bound as a local was NOT out of reach.
      if (
        publishedNames.has(base) || publishedQnames.has(base) || publishedTypeNames.has(base) ||
        moduleNames.has(base) || namespaceNames.has(base) ||
        openedScopes.has(base) || localNames.has(base)
      ) continue
      md.baseBeyondRunScope = base
    }

    // FS-P8 — THE EXTERNAL CLAIM, and it is a claim the incoming gate can REFUTE.
    //
    // `incoming-gate.ts fsharp fs` asked this lane's incoming question for the first time on
    // 2026-10-08 and the answer was: 42,116 edges, 12,208 resolving to exactly one
    // declaration in the file's own PROJECT, 28,862 unresolved, and **zero external claims**
    // — so on this lane a genuinely-external target and a broken edge were
    // indistinguishable, which is the one thing this workstream's standard forbids. The
    // gate's own worklist says it plainly: "A lane that marks nothing and reports a large
    // unresolved should ask whether those targets are external before it asks why they do
    // not resolve."
    //
    // The claim is NOT free and it is not blanket, and the price was measured before a line
    // of it was written (`.tmp-probe/fs-p8-mark.py`, `.tmp-probe/fs-p8-rule.txt`,
    // `.tmp-probe/fs-p8-rule2.txt`, arm `rows-pass12-meta.ndjson`). The gate verifies a
    // marked edge by looking up the target's OWNER (`incoming-rule.ts` `verifyExternalClaim`:
    // everything before the last dot; an owner holding `:`, `/` or whitespace is unverifiable;
    // an owner the PROJECT publishes REFUTES the claim), so a marker is worth exactly what
    // that lookup returns:
    //
    //   any dotted target            62,634 edges → 26,795 verified / 35,839 REFUTED (42.8%)
    //   owner with ≥2 segments        7,140 edges →  6,318 verified /    822 refuted (88.5%)
    //   ... and a FOREIGN root        6,893 edges →  6,409 verified /    484 refuted (93.0%)
    //
    // The first row is why a blanket marker is not shipped: `List.map`, `Seq.map`,
    // `Array.map` are 2-segment targets and the project frequently declares a `List` of its
    // own — 25,362 refuted against 13,663 verified on `calls` alone. `Seq(4447)`, `List(4035)`,
    // `Expect(2540)`, `System(2118)`, `Array(1943)`, `String(1604)` are the top refuting
    // owners, which is to say FSharp.Core-shaped names a project redeclares.
    //
    // The third row WAS the shipped rule, and its root test is the one thing the analyzer can
    // check that the gate cannot: whether the path's ROOT is a segment THIS FILE already
    // declares. That test is what separates a path into somebody else's tree from a path into
    // the file's OWN project (`FSharp.Compiler.Syntax`, `Grace.CLI.Common`, `Fake.Core` —
    // 338 of the 822 refutations, 41%, for 170 verified edges). The remaining 484 refuted
    // claims are, by construction, the CROSS-FILE case: the declaration IS in the project and
    // the analyzer cannot see another file. It counted them in the gate's `extFAIL` column and
    // shipped anyway; the retirement below prices that column at the scope production uses and
    // finds it 30% false, which is why the rule no longer runs.
    //
    // NOT marked, deliberately: `bare-external`, `local-binding`, `receiver-value`,
    // `call-chain-receiver` and `self-member` name a VALUE or this file's own member, so
    // "external" would be a false claim; and a BARE target has no owner at all, so the gate
    // reads it `externalUnverified` and a marker would buy an explanation while still
    // blocking a pass. `resource-path` (`#r`/`#load`/`#I` literals) is a file path or a URI,
    // not a namespace path, and its owners carry `:` or `/` — excluded by the same shape test
    // the gate applies, not by a second rule.
    //
    // ══════════════════════════════════════════════════════════════════════════════════════
    // FS-P8 IS RETIRED (2026-10-09). THE CLAIM IS NO LONGER EMITTED — the reason codes are,
    // and they are all still true; it is the CORPUS-WIDE claim a single file cannot support.
    //
    // The rule above marked an edge external when its `targetResolution` was one of the PATH
    // classes (`external-namespace`, `external-type-or-module`, `module-member`,
    // `opened-module`) or the BASE classes (`base-member-external`, `interface-member-external`)
    // and the owner had ≥2 segments whose ROOT this file does not declare. EVERY ONE of those
    // classes is a statement about THIS FILE ("this file does not publish this path",
    // `targetResolution` is assigned a few hundred lines up), and the marker turned it into a
    // statement about the PROJECT — which is what the incoming gate then adjudicates, and what
    // it refutes. Measured, on the gate's own rule and populations:
    //
    //   the gate's 60-file stride    120 of 124 claims verified (96.8%) — because the key
    //                                space IS 60 files, so an owner absent from the SAMPLE
    //                                reads as absent from the PROJECT
    //   the claim's own PROJECT       `external-namespace`  238 true / 100 false = 70.4%
    //   (a 200-file draw adjudicated  `base-member-external` 15 true /  69 false = 17.9%
    //    against every admitted file  `interface-member-external` 1 true / 0 false
    //    of the claim's repository)   — 423 claims, `.tmp-probe/fsharp-lane/fs-extclaim-probe.mts`
    //
    // The false ones are the ordinary shape of a multi-file F# project, not an exotic case:
    // `Internal.Utilities` (10), `FSharp.Test` (6), `FSharp.Compiler` (6), `Microsoft.FSharp`
    // (4), `Fabulous.Avalonia` (2), `Fabulous.Maui` (2), `LibExecution.Builtin` (2) — every one
    // a namespace name the corpus itself declares, claimed external because a 60-file sample
    // did not contain it. The gate's contract calls that out in as many words ("a gate that
    // accepts it unverified is a gate that can be laundered"), and production resolves at
    // PROJECT scope, which is the scope where 30% of the class is refuted.
    //
    // This lane's bar for a claim rule is the one pass 13 set for `calls`: 28.0% verified was
    // DECLINED with its number recorded rather than shipped. Neither class here clears that bar
    // at project scope. NO PER-FILE DISCRIMINATOR RESCUES THEM, and that was measured too: the
    // best candidate — the file itself names the owner as a dependency — removes all four of the
    // gate's stride refutations only by removing 56 VERIFIED claims as well (56 of the 60
    // owner-naming claims are true), i.e. it trades four false claims for fifty-six true ones.
    //
    // WHAT WOULD BRING THE CLAIM BACK: evidence that is not the file. `context.projectIndex`
    // (pass 14 built the F# DeclarationSpec, pass 15 priced the joiner) can answer "does this
    // project declare this owner" POSITIVELY, and a claim made only where the index says no is
    // provable rather than shaped. Until the analyzer is handed that index, this lane claims
    // nothing: an unmarked external edge is a gap the gate reports honestly, while a marked
    // in-corpus edge is a false statement counted against the lane — and only one of those two
    // errors can be laundered.

    // #419-D, ADDED 2026-10-17 (lane inventory). Every relationship carries the EVIDENCE TIER
    // of the rule that produced it — the fleet convention (real-c-analyzer.ts's
    // classifyEvidenceTier, real-bash-analyzer.ts's evidenceClassFor, xml's EVIDENCE_TIER).
    // Section D of the lane contract asks for >=2 distinct tiers PINNED by fixtures; before
    // this pass the analyzer published NONE, so that section could only fail. The mapping is
    // a property of the RULE, not of the edge: see the method below.
    this.classifyEvidenceTier(relationships)

    return {
      language: "fsharp",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length,
        linesOfCode: content.split("\n").length,
        patterns: [],
        framework: "F#",
        hasFrameworkIntelligence: true,
        hasTypeInference: true,
      },
    }
  }

  /**
   * #419-D — THE EVIDENCE TIER OF EVERY RELATIONSHIP, AS A PROPERTY OF ITS RULE.
   *
   * The tier answers WHY the target spelling can be trusted, which is a different question
   * from whether this run resolved it. The vocabulary and the mapping follow the fleet's two
   * shipped tables (`real-c-analyzer.ts:classifyEvidenceTier`, `real-bash-analyzer.ts`'s
   * `evidenceClassFor`) so the same edge class carries the same tier in every lane:
   *
   *   structural           the parse tree STATES the relation — a declaration body, a heritage
   *                        clause, a `new` construction: contains / exports / extends /
   *                        implements / instantiates.
   *   import_based         the source writes a module/file dependency: `imports` (open
   *                        directives, #r resources) and every `references` row that is an
   *                        `open` rather than a written type.
   *   reference_qualified  the target is a WRITTEN TYPE matched as a name (`references` with
   *                        `relationshipType: declared_type`), or an override whose base member
   *                        is qualified `Owner.member` (`overrides`).
   *   usage_contextual     the target is inferred from how the source USES the name — a call's
   *                        callee, a read: calls / uses.
   *
   * No tier is `inferred`: this analyzer refuses the shapes it cannot classify at the emit site
   * (FS-D11's type queries, FS-A4's dead branches, the withdrawn external claims) rather than
   * publishing an unclassified edge, so the fallback is `usage_contextual` — a true statement
   * about how the name was reached, never a guess about where it resolves.
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = (r.metadata ?? (r.metadata = {})) as Record<string, any>
      if (md.evidenceClass) continue
      const t = String(r.type ?? "")
      if (t === "contains" || t === "exports" || t === "extends" || t === "implements" || t === "instantiates") {
        md.evidenceClass = "structural"
        continue
      }
      if (t === "imports") {
        md.evidenceClass = "import_based"
        continue
      }
      if (t === "part_of") {
        // THE `part_of` TIER IS THE `imports` TIER, AND IT IS NOT A DEFAULT. A `part_of` row is
        // a FILE-COUPLING fact the source WRITES — `#load "x.fs"` names the file it includes —
        // so it is `import_based` (the source writes a module/file dependency), exactly as
        // dart's `part_of` rows are. The default branch would call it `usage_contextual`, which
        // says the target was INFERRED from how the source uses the name — the opposite of
        // the fact, and the tier is a property of the RULE.
        md.evidenceClass = "import_based"
        continue
      }
      if (t === "references") {
        // TWO RULES SHIP THE SAME KIND: an `open` directive names a module path (import-based),
        // a written type names a type (qualified). The rule that produced the row is carried on
        // it as `relationshipType`, so the tier is read from the row rather than assumed.
        md.evidenceClass = md.relationshipType === "declared_type" ? "reference_qualified" : "import_based"
        continue
      }
      if (t === "overrides") {
        md.evidenceClass = "reference_qualified"
        continue
      }
      md.evidenceClass = "usage_contextual"
    }
  }

  /**
   * FS-D11 — is this written type a TYPE QUERY rather than a declared type?
   *
   * `typeof<T>` and `unbox<T>` are EXPRESSIONS that carry a type argument:
   * `typeof<TypeInThisAssembly>.Assembly.Location` depends on a RUNTIME VALUE, and
   * publishing `references loc -> TypeInThisAssembly` as a declared-type dependency
   * says the opposite — that the declaration names the type in its signature.
   *
   * The discriminator walks up through the two shapes the grammar spells the query with,
   * because it spells it differently depending on which one it is:
   *   * `typed_expression` whose `base` is a `long_identifier_or_op` reading `typeof` /
   *     `unbox` — the corpus's own shape (measured by reading the tree: `typeof<Foo>` is
   *     `typed_expression > long_identifier_or_op(typeof) + types > simple_type`);
   *   * a `static_type` wrapper, the other spelling.
   *
   * A first draft tested only the DIRECT parent for the `long_identifier_or_op`, which
   * measured nothing, because the type's parent is the `typed_expression` and the
   * `long_identifier_or_op` is ITS base. The differential's UNEXPLAINED row is what
   * forced the second reading.
   */
  /**
   * FS-D13 — does a member declare an explicit SETTER?
   *
   * F#'s `member _.P with get, set` is ONE member with two `property_accessor` bodies,
   * and the setter's body executes. The property-getter contract ("a computed property
   * emits no calls", inherited from the C# family) is about an EXPRESSION-bodied
   * property, which has no second body to run code in — applying it to the setter
   * deleted the calls in real code.
   *
   * Read from the `property_accessor` node's own keyword token, never from the member's
   * text: `with get () = … and set (x) = …` and `with get, set` are the same shape.
   */
  private hasExplicitSetter(memberDefn: Node): boolean {
    const mop = this.findChild(memberDefn, (n) => n.type === "method_or_prop_defn")
    if (!mop) return false
    for (const acc of this.findDescendants(mop, (n) => n.type === "property_accessor", 6)) {
      for (let i = 0; i < acc.childCount; i++) {
        const c = acc.child(i)
        if (c && !c.isNamed && c.type === "set") return true
      }
    }
    return false
  }

  private isTypeQueryPosition(t: Node): boolean {
    let cur: Node | null = t
    for (let hop = 0; cur && hop < 3; hop++) {
      if (cur.type === "static_type") return true
      // `typed_expression` holds the query operator and the type as SIBLINGS:
      //     (typed_expression (long_identifier_or_op "typeof") (types (simple_type …)))
      // — so the operator is a CHILD, not the parent, and a test that looked for a
      // `typeof` parent measured nothing. The first two attempts each got one of these
      // two facts wrong, and both were caught by the differential's row rather than by
      // reading, which is the argument for running one at all.
      if (cur.type === "typed_expression") {
        for (let i = 0; i < cur.namedChildCount; i++) {
          const c = cur.namedChild(i)
          if (c && c.type === "long_identifier_or_op" && (c.text === "typeof" || c.text === "unbox")) return true
        }
        return false
      }
      const parent: Node | null = cur.parent
      if (!parent) return false
      if (parent.type === "long_identifier_or_op" && (parent.text === "typeof" || parent.text === "unbox")) return true
      if (parent.type === "static_type" || parent.type === "typed_expression") {
        cur = parent
        continue
      }
      return false
    }
    return false
  }

  /** The member's declared name: `method_or_prop_defn -> property_or_ident`, LAST identifier. */
  /**
   * The interface an OBJECT EXPRESSION constructs, as `{ written, leaf }`.
   *
   * FS-D14. The object-expression branch used to take the first `long_identifier`
   * descendant of the node and call that the interface name, which is right exactly
   * when the name is unqualified. A qualified name is NESTED in this grammar —
   *
   *     object_expression
   *       new
   *       typed_expression "System.Collections.Generic.IEqualityComparer<InferedType>"
   *         dot_expression "System.Collections.Generic.IEqualityComparer"
   *           long_identifier_or_op "System.Collections"
   *             long_identifier "System"        <-- what the old code found
   *           . identifier "Collections"
   *           . long_identifier_or_op "Generic.IEqualityComparer"
   *         types "InferedType"
   *
   * — so "first `long_identifier`" is the FIRST SEGMENT, and the published name was
   * `new System` with `implements -> System`, a target that resolves to nothing.
   *
   * The differential found it twice and in the most useful way available: the lane's
   * truth side read the SECOND segment. `{ new System.Collections.Generic.IEqualityComparer
   * with … }` gave the analyzer `System` and the truth `Collections`, which cannot both
   * be the interface and makes it obvious that the name is somewhere else entirely
   * rather than that one of them is off by a rule. Two implementations independently
   * wrong in the same place is the cheapest kind of evidence there is.
   *
   * The written name is therefore read from the `dot_expression` that carries it — a
   * node whose own text IS the full dotted path — and the leaf from the LAST identifier
   * inside it, so R10's spelling rule applies to the same leaf a consumer would join.
   * The tree this is built on is printed by script/m14/tmp/fs030-object-expr-name.ts.
   */
  private objectExpressionInterface(node: Node): { written: string; leaf: string } | undefined {
    // The interface is the object's FIRST DIRECT CHILD, and the fix is to read it there.
    //
    // The subtree search below was written for a DOTTED interface — `{ new System.IDisposable
    // with … }` — and asked for the first `dot_expression` anywhere inside. When the interface
    // is BARE, `{ new IDisposable with … }`, that search finds nothing of its own and keeps
    // descending, into the member bodies. So the first dotted expression in the subtree won,
    // and on fsharp/src/fsi/fsimain.fs:54 that was
    // `Thread.CurrentThread.CurrentUICulture`, giving
    //
    //     implements  Main  ->  CurrentUICulture
    //
    // where truth derives
    //
    //     implements  Main  ->  IDisposable
    //
    // One wrong name, and it cost FIVE rows in that file alone: three MISSING (the real
    // interfaces IDisposable, CtrlBreakService and FsiEvaluationSessionHostConfig, each from
    // an object expression, all displaced by whichever dotted name a member body mentioned)
    // and one UNEXPLAINED fabrication. The name it found is not a near-miss — it is a property
    // assignment inside a `Dispose` method, which is not a type and implements nothing.
    //
    // Reading child 0 is also the cheaper rule. "The name after `new`" is a fact about the
    // first child, so a bounded search for a name in a place it cannot appear is a rule that
    // can only ever be wrong, and wrong in the direction of a member body.
    const first = node.namedChild(0)
    const isNameish = (n: Node | null): n is Node =>
      !!n &&
      (n.type === "dot_expression" ||
        n.type === "typed_expression" ||
        n.type === "long_identifier_or_op" ||
        n.type === "long_identifier")
    const carrier = isNameish(first)
      ? first
      : // Kept for shapes where the name is not the first child, so this is a narrowing of
        // where the name may be READ rather than a claim that it is never elsewhere.
        (this.findDescendant(node, (n) => n.type === "dot_expression", 4) ??
          this.findDescendant(
            node,
            (n) => n.type === "typed_expression" || n.type === "long_identifier_or_op" || n.type === "long_identifier",
            4,
          ))
    if (!carrier) return undefined
    // `typed_expression` text carries the type ARGUMENTS too, and an argument list is
    // not part of the type's name.
    const written = carrier.text.split("<")[0]!.trim()
    if (!written) return undefined
    // The leaf is the LAST identifier IN THE CARRIER — the segment after the final dot.
    //
    // Scoped to the carrier, not to the object expression: an object expression's
    // subtree is the interface name AND every member body, so the last identifier in
    // the whole node is whatever the last member happened to mention. The first version
    // of this fix read the subtree and published `implements -> x` for
    // `member _.Equals(x, y) = …` and `-> failwith` for a body that calls it — a
    // strictly worse answer than `System`, because it now varied with the body. The
    // name is the carrier's business alone.
    //
    // A TYPE ARGUMENT is not part of the type's name, and it arrives as an identifier like any
    // other, so reading the last identifier of a `typed_expression` reads the ARGUMENT:
    // `{ new System.Collections.Generic.IEqualityComparer<Foo> with … }` has carrier text
    // `System.Collections.Generic.IEqualityComparer<Foo>`, whose last identifier is `Foo`, and
    // the row came out `implements Fixture.Names -> Foo` — a type argument presented as the
    // type being implemented. The fixture caught it, which is the second thing in this lane
    // that guard has earned its keep on.
    //
    // `written` already handles this for the full name (`split("<")`); the leaf needs the same
    // correction, and taking the carrier's FIRST CHILD is how the grammar says "the type, not
    // its argument" without re-parsing the text.
    const nameish = carrier.type === "typed_expression" ? (carrier.namedChild(0) ?? carrier) : carrier
    const idents = this.findDescendants(nameish, (n) => n.type === "identifier", 8)
    const leaf = idents.length ? idents[idents.length - 1]!.text : written
    return { written, leaf: leaf || written }
  }

  /**
   * The interface a member IMPLEMENTS, when the member is written inside
   * `interface I with …` — the LEAF of the interface's written name, or undefined.
   *
   * FS-A2. The walk to the nearest `interface_implementation` ancestor is unbounded on
   * purpose: `findAncestor` cannot distinguish "no interface above this" from "further than
   * N levels up", and treating both as the first is how the `overrides` rule ended up naming
   * a base type for a member that implements an interface (see the call site).
   *
   * The name is read the SAME WAY the `implements` branch reads it — the first
   * `long_identifier`/`identifier` descendant of the implementation node, then the leaf of a
   * dotted path, with R10's spelling rule (`System.IDisposable` declares `IDisposable`). Two
   * implementations of one rule is the point: a member-level edge and a type-level edge about
   * the same `interface I with` clause that spell the interface differently would be
   * indistinguishable downstream from two different interfaces.
   *
   * THE OBJECT-EXPRESSION ARM, and it is not a rare shape: `{ new IFoo with override x.M() }`
   * has NO `interface_implementation` node at all — the grammar puts the interface directly on
   * the `object_expression` as its own `long_identifier_or_op` child. So a walk that stops at
   * `interface_implementation` answers "no interface" for every mock in the corpus, and the
   * corpus is full of them: vsintegration/tests/Salsa/VsMocks.fs alone carries 6 such members
   * on 2 object expressions. The interface is therefore read a second way, through the SAME
   * `objectExpressionInterface` the `implements` branch and the symbol publication use, so the
   * three edges about one object expression cannot spell its interface differently.
   */
  private enclosingInterfaceImplementationLeaf(node: Node): string | undefined {
    let cur: Node | null = node.parent
    while (cur) {
      if (cur.type === "interface_implementation") {
        const written = this.findDescendant(cur, (n) => n.type === "long_identifier" || n.type === "identifier", 3)
        if (!written?.text) return undefined
        return written.text.includes(".") ? (written.text.split(".").pop() as string) : written.text
      }
      if (cur.type === "object_expression") return this.objectExpressionInterface(cur)?.leaf
      cur = cur.parent
    }
    return undefined
  }

  private memberNameOf(decl: Node): string | undefined {
    const mop = this.findChild(decl, (n) => n.type === "method_or_prop_defn")
    const prop = mop ? this.findChild(mop, (n) => n.type === "property_or_ident") : undefined
    const idents = prop ? this.filterChildren(prop, (n) => n.type === "identifier") : []
    return idents.length >= 2 ? idents[idents.length - 1]?.text : idents[0]?.text
  }

  /**
   * The name a `function_or_value_defn` / `value_declaration` DECLARES, read
   * structurally and never from an `identifier_pattern`'s text (FS-D6).
   */
  /**
   * The name a `*_declaration_left` node declares.
   *
   * The binding's own left-hand side spans a parameter list and a return annotation, so its
   * `identifier_pattern` text is the WHOLE left side (FS-D6) and cannot be used. The name is
   * the first `long_identifier` inside the pattern, in document order.
   */
  /**
   * The binding a type annotation belongs to, when the declaration node holds several.
   *
   * `let rec f … and g …` is ONE node with two left-hand sides, and each owns its own
   * signature. The name is read from the left whose SPAN contains the annotation, so the
   * answer is a fact about position rather than about order — and this is the same correction
   * the truth oracle needed for a dotted name and for a `let … and …` group, and the analyzer
   * needed twice.
   */
  private declaredNameAt(decl: Node, t: Node): string | undefined {
    let best: Node | undefined
    for (let i = 0; i < decl.namedChildCount; i++) {
      const c = decl.namedChild(i)
      if (!c) continue
      if (c.type !== "function_declaration_left" && c.type !== "value_declaration_left") continue
      if (c.startIndex <= t.startIndex && t.endIndex <= c.endIndex) best = c
    }
    return best ? this.nameOfDeclarationLeft(best) : undefined
  }

  private nameOfDeclarationLeft(left: Node): string | undefined {
    const pat = this.findChild(left, (n) => n.type === "identifier_pattern")
    const carrier =
      (pat ? this.findChild(pat, (n) => n.type === "long_identifier_or_op") ?? this.findChild(pat, (n) => n.type === "long_identifier") : undefined) ??
      left
    const idents = this.findDescendants(carrier, (n) => n.type === "identifier", 3)
      .filter((n) => n.startIndex < (pat?.endIndex ?? left.endIndex))
      .sort((a, b) => a.startIndex - b.startIndex)
    if (idents.length) return idents[0]!.text
    const direct = this.findChild(left, (n) => n.type === "identifier")
    return direct?.text
  }

  private declaredBindingName(decl: Node): string | undefined {
    // The DECLARATION LEFT is read FIRST, and the direct-child shortcut second — the order is
    // the fix, not an accident of preference.
    //
    // `let rec f … and g …` is ONE `function_or_value_defn` holding both clauses, and in that
    // shape the node has a direct `long_identifier` child belonging to the SECOND clause. The
    // shortcut therefore answered `visitVal` for the binding that begins
    //
    //     let rec visitEntity (entity: Entity) : TypedTreeNode = …        // line 2485
    //     and visitVal (v: Val) : TypedTreeNode = …                      // line 2506
    //
    // and every declared type in the FIRST binding's signature was published under the
    // SECOND binding's name — three rows in TypedTreeOps.Attributes.fs, and the same shape
    // throughout the compiler corpus, which is written almost entirely in `let rec … and …`
    // groups. Nothing downstream could tell: `visitVal` is a real published symbol, so the
    // edge resolved.
    // The first `*_declaration_left` in DOCUMENT ORDER across BOTH types — not
    // "function_declaration_left, else value_declaration_left".
    //
    // In a mutual group the group's own name is a `value_declaration_left` at index 0 and the
    // `and` clause's is a `function_declaration_left` at index 2 (printed by
    // script/m14/tmp/fs035-and-group.ts for the same grammar, on Symbols.fs). Asking for the
    // function form first therefore returns the `and` clause. This is the identical fault the
    // truth oracle had, found independently, and the two implementations agreeing on the FIX
    // while each had it separately is the reason a shared rule is worth stating twice.
    let left: Node | undefined
    for (let i = 0; i < decl.namedChildCount; i++) {
      const c = decl.namedChild(i)
      if (c && (c.type === "function_declaration_left" || c.type === "value_declaration_left")) {
        left = c
        break
      }
    }
    if (!left) {
      const direct = this.findChild(decl, (n) => n.type === "identifier" || n.type === "long_identifier")
      if (direct?.text) return direct.text.includes(".") ? (direct.text.split(".").pop() as string) : direct.text
      return undefined
    }
    const pat = this.findChild(left, (n) => n.type === "identifier_pattern")
    const leaf = pat ? this.patternNameNode(pat) : this.findChild(left, (n) => n.type === "identifier")
    if (leaf?.text) return leaf.text
    // The pattern's own text is only a NAME when it is nothing but a name. That was three
    // regexes — `/[()<]/`, `/\s:/` and `/^[A-Za-z_][A-Za-z0-9_']*$/` — and the grammar already
    // says it: a bare name is an `identifier_pattern` whose only content is a
    // `long_identifier`. A pattern that carries a parameter list, a type argument or a return
    // annotation has a CHILD for it, so the test is "does this node have exactly one name
    // child and nothing else", which is about the tree rather than about a string.
    //
    // This was the last of the six regex literals the M12 census found in this file. All six
    // are gone, and `docs/analyzers/real-fsharp-analyzer.md` had claimed the count was 0.
    if (pat) {
      const names = this.filterChildren(pat, (n) => n.type === "long_identifier" || n.type === "long_identifier_or_op")
      const isBareName =
        names.length === 1 && pat.namedChildCount === 1 && !this.findDescendant(pat, (n) => n.type === "argument_patterns", 2)
      if (isBareName) {
        const text = names[0]!.text
        if (text) return text.includes(".") ? (text.split(".").pop() as string) : text
      }
    }
    return undefined
  }

  /**
   * The declared NAME inside an `identifier_pattern` — the FIRST
   * `long_identifier_or_op -> long_identifier -> identifier` chain.
   *
   * Not `pattern.text`: an `identifier_pattern` spans the entire left-hand side,
   * parameters and return annotation included, so its text is a signature, not a name.
   * See FS-D6 at the call site.
   */
  private patternNameNode(pattern: Node): Node | undefined {
    const holder =
      pattern.type === "identifier_pattern"
        ? pattern
        : this.findChild(pattern, (n) => n.type === "identifier_pattern")
    const scope: Node = holder ?? pattern
    return this.findDescendant(
      scope,
      (n) =>
        n.type === "identifier" &&
        !!n.parent &&
        (n.parent.type === "long_identifier" || n.parent.type === "long_identifier_or_op"),
      3,
    )
  }

  /**
   * The nearest ANCESTOR matching the predicate, bounded by `maxDepth` hops.
   *
   * Distinct from `findDescendant` on purpose: the declared-type graph asks "which
   * declaration am I inside?", which is a question about the tree ABOVE the node, and
   * reusing the descendant search for it would mean passing the whole root — an O(n)
   * scan per type node, i.e. O(n²) over a file. Bounded hops keep the walk linear (the
   * lane's own hot-path rule: no per-symbol O(n) scans).
   */
  /**
   * The OUTERMOST callable above `n` — the member a local belongs to — or undefined if
   * there is none, which means `n` is itself top-level and is its own owner.
   *
   * This replaces `findAncestor(decl, isCallable, 8)`, and the bound was the defect. A
   * depth-limited search cannot distinguish "there is no callable above this" from "the
   * callable is further than 8 levels up", and the code treated both as the first. It then
   * fell through to publishing the LOCAL's own name, and a local is not a symbol — the lane's
   * contract, pinned by the `Negative.fs` fixture, says so — so the edge it published had no
   * other end:
   *
   *     references insert -> ConsoleKeyInfo      // `let insert(key: ConsoleKeyInfo) =` in console.fs
   *     references select -> Type                // `let select (methInfo:MethodInfo) =` in the same file
   *
   * Neither `insert` nor `select` is a symbol; the truth oracle independently derived both
   * facts against `ReadLine`, the method that contains them, and the differential reported
   * 125 such rows. `insert` sits inside nested `for`/`do` bindings in a method body, which is
   * more than 8 levels up.
   *
   * Walking to the root and keeping the LAST callable found is both unbounded and simpler to
   * state: a local inside a local inside a member is owned by the member, because a namespace
   * and a module are not callables and so never become the answer. A decl with no callable
   * anywhere above it really is top-level, and its own name is then correct — which is the
   * `annotated : Bar` case in the fixture, and the reason the fallback is kept rather than
   * removed.
   *
   * Cost is O(depth) per annotation and the walk terminates at the root, so the bound that
   * caused this cannot come back.
   */
  /**
   * Owner lookups, memoised PER DECLARATION rather than per annotation.
   *
   * Both of the root walks below are O(depth) and both are asked the same question about the
   * same `decl` once for every type node the declaration carries — so a member with four
   * annotations walked to the root four times to learn the same thing. The pass is therefore
   * O(annotations · depth) over what is really O(declarations · depth).
   *
   * MEASURED on CheckExpressions.fs (702 KB), analyze-only with the parse excluded and the
   * median of 7: 1411 ms before this change, 1510 ms after the walks were introduced — about
   * 7% of the analyzer's own time, from two lines of correct-looking code. It is easy to miss
   * because the end-to-end dump barely moves: parse is 8.6 s on that file, so a 100 ms
   * regression is under 1% of the number a corpus run reports. That is the same shape as the
   * O(n^2) the M12 envelope found on the production path, found there by scaling rather than by
   * reading — so it was found here by measuring the thing the walks sit inside, not the file.
   *
   * Keyed by node in a WeakMap, so it needs no reset between runs and cannot outlive its tree.
   */
  private readonly ownerMemo = new WeakMap<Node, { callable?: Node | null; typeDef?: Node | null }>()

  private outermostCallableAbove(n: Node): Node | undefined {
    const hit = this.ownerMemo.get(n)
    if (hit && "callable" in hit) return hit.callable ?? undefined
    let found: Node | undefined
    let cur: Node | null = n.parent
    while (cur) {
      if (isCallableOwnerNode(cur)) found = cur
      cur = cur.parent
    }
    this.ownerMemo.set(n, { ...(hit ?? {}), callable: found ?? null })
    return found
  }

  /**
   * The type declaration whose body contains `n`, walking to the root.
   *
   * The OUTERMOST one, which for a mutual group is the node that holds every clause in the
   * group — `type A = … and B = …` is one `type_definition` with both bodies inside it. The
   * name of the type that actually owns a declaration is recovered separately, by taking the
   * last `type_name` before the declaration; see the class-field arm in `resolveSource`.
   */
  private outermostTypeDefinitionAbove(n: Node): Node | undefined {
    const hit = this.ownerMemo.get(n)
    if (hit && "typeDef" in hit) return hit.typeDef ?? undefined
    let found: Node | undefined
    let cur: Node | null = n.parent
    while (cur) {
      if (cur.type === "type_definition") found = cur
      cur = cur.parent
    }
    this.ownerMemo.set(n, { ...(hit ?? {}), typeDef: found ?? null })
    return found
  }

  private findAncestor(node: Node, predicate: (n: Node) => boolean, maxDepth: number = 12): Node | undefined {
    let cur: Node | null = node.parent
    for (let i = 0; cur && i < maxDepth; i++) {
      if (predicate(cur)) return cur
      cur = cur.parent
    }
    return undefined
  }

  /**
   * The ACCESS MODIFIER written on a declaration, from the grammar's own
   * `access_modifier` node — never from the declaration's text.
   *
   * Where the modifier sits differs by construct, which is why a declaration node and
   * (for a type) its `type_name` node are both offered:
   *   * a TYPE — `type internal Tables<'Token>` puts it INSIDE the `type_name`, as its
   *     first named child; that node's own text is literally `internal Tables<'Token>`,
   *     which is how the pre-FS-D6 name read published a name with an access modifier
   *     inside it;
   *   * a VALUE or a MEMBER — `let internal f = …`, `member private this.Reset()` — puts
   *     it on the declaration itself;
   *   * an omitted modifier is `public` in F# and the grammar then emits no node, so
   *     the answer is `undefined`, which the caller treats as public. `undefined` is
   *     deliberately NOT "public": a caller can tell "written public" from "written
   *     nothing" without a second pass.
   */
  private accessModifierOf(decl: Node, typeNameNode: Node | null): string | undefined {
    const read = (n: Node | null): string | undefined => {
      if (!n) return undefined
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "access_modifier") return c.text
      }
      return undefined
    }
    const fromTypeName = read(typeNameNode)
    if (fromTypeName) return fromTypeName
    const fromDecl = read(decl)
    if (fromDecl) return fromDecl
    // an `attributes` wrapper can sit between the declaration and the modifier, so one
    // more bounded level is read before giving up. (Only NAMED nodes can appear here:
    // the grammar's `member_modifier` is a hidden rule — `_member_modifier` — so it is
    // inlined and can never be a node type. A first draft tested for it and F1 caught
    // the dead branch, which is the gate working.)
    for (let i = 0; i < decl.namedChildCount; i++) {
      const c = decl.namedChild(i)
      if (!c) continue
      if (c.type === "attributes" || c.type === "type_attributes") {
        const inner = read(c)
        if (inner) return inner
      }
    }
    return undefined
  }

  /** The access modifier a symbol was minted with, defaulting to F#'s implicit public. */
  private visibilityOf(symbol: ASTEngine.UniversalSymbol): "public" | "internal" | "private" {
    const recorded = (symbol.metadata as any)?.accessModifier
    if (recorded === "internal" || recorded === "private" || recorded === "public") return recorded
    return "public"
  }

  /**
   * Every type name this file DECLARES with a real `type X = …` body — i.e. NOT by
   * `type X with …`. Collected before the walk so the publication rule is
   * order-independent.
   */
  /**
   * The module or namespace a FILE declares, or undefined.
   *
   * FS-D17. An `open` is a SIBLING of the file's `module` declaration, not a child, so a
   * scope stack maintained by walking down the tree is empty when the walk reaches one.
   * The analyzer's behaviour was then inconsistent in a way the corpus made obvious:
   *
   *   FscMain.fs         `module … CommandLineMain` (line 3), `open System` (line 5)
   *                      -> the import was sourced to the module, because the walk had
   *                         already entered the module node by the time it got there
   *   AssemblyCheck.fs   `open System` (line 3), `module AssemblyCheck =` (line 10)
   *                      -> the import was sourced to `Global`, because the walk had not
   *                         reached the module yet
   *
   * The file's scope is the same in both cases — in F# the whole file is inside
   * `AssemblyCheck` — so one of the two answers was wrong and the rule that produced them
   * was "wherever the walk happened to be", which is not a rule about the program. The
   * fix is a PRE-PASS, so the answer does not depend on the order of two sibling
   * declarations.
   *
   * A module is preferred over a namespace because a file that declares both nests the
   * module inside the namespace, and a module name is the closer scope of the two.
   *
   * Measured: 128 UNEXPLAINED open-path rows per 120 corpus files before the rule, and
   * the two example files above disagreeing with each other rather than with the truth.
   *
   * ONE top-level declaration, and only one. The first version of this pre-pass took the
   * FIRST module it found, which is right for AssemblyCheck.fs and wrong for
   * `docs/fcs/project.fsx`, and the two are the same shape: an `open` above the `module`
   * keyword. In a single-module file that scope is the file's, wherever the `open` sits. In
   * a SCRIPT with several modules it is not — `project.fsx` opens `System` at line 35 and
   * declares `module Inputs` at line 48, and code above the first module in a script is at
   * the SCRIPT's scope, not inside `Inputs`. "The first module" made 128 rows disagree in
   * the other direction.
   *
   * So the distinction is the count, and it is structural rather than a file extension: a
   * file with more than one top-level module/namespace is a script, and the walk's own scope
   * — which is correct inside a module and correctly empty above the first one — already
   * answers it.
   */
  private collectFileScope(root: Node): string | undefined {
    // TOP-LEVEL declarations only. A `module` nested inside another module does not make
    // the file a script, and counting it would turn an ordinary file into one.
    const topLevel: string[] = []
    let topLevelStartIndex: number | undefined
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "module_defn" || n.type === "named_module" || n.type === "namespace") {
        const nm = this.findChild(n, (c) => c.type === "type_name" || c.type === "long_identifier" || c.type === "identifier")
        if (nm?.text) {
          topLevel.push(nm.text.trim())
          if (topLevelStartIndex === undefined) topLevelStartIndex = n.startIndex
        }
        continue // do not descend: nested modules are not top-level
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    if (topLevel.length !== 1) return undefined

    // ...and only if nothing EXECUTES above it. Two corpus files have one top-level module
    // and an `open` above it, and they need opposite answers:
    //
    //   AssemblyCheck.fs   comments + `open`, then `module AssemblyCheck =`
    //                      -> the module is the file's scope, and the imports belong to it
    //   docs/fcs/project.fsx   `open System` (35), `let checker = …` (42), `module Inputs` (48)
    //                      -> a SCRIPT: the binding at line 42 executes before any module
    //                         exists, so the file is script-scoped and the imports belong
    //                         to the script, not to `Inputs`
    //
    // The discriminator is the top-level BINDING, and it is structural: `module M` and
    // `module N` further down project.fsx look like two more top-level modules and are not
    // — they are inside triple-quoted strings (script/m14/tmp/fs036-top-level.ts), so
    // counting module nodes is not enough on its own. A binding that executes above the
    // module is what makes a file a script, and it is the same fact in both files.
    //
    // Keying on the `.fsx` extension instead would have been shorter and would have been a
    // guess about which files are scripts rather than a statement about the code. It would
    // also have been wrong for a `.fs` file that genuinely is a script.
    const moduleStart = topLevelStartIndex
    if (moduleStart === undefined) return undefined
    const codeWalker: Node[] = [root]
    while (codeWalker.length > 0) {
      const n = codeWalker.pop()!
      if (
        (n.type === "function_or_value_defn" || n.type === "value_declaration" || n.type === "sequential_expression") &&
        n.startIndex < moduleStart
      ) {
        return undefined
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) codeWalker.push(c)
      }
    }
    return topLevel[0]
  }

  private collectDeclaredTypeNames(root: Node): Set<string> {
    const names = new Set<string>()
    const stack: Node[] = [root]
    const readName = (typeNameNode: Node): string | undefined => {
      const li = this.findChild(typeNameNode, (c) => c.type === "long_identifier")
      const id = li ? this.findDescendant(li, (c) => c.type === "identifier", 3) : this.findChild(typeNameNode, (c) => c.type === "identifier")
      return id?.text
    }
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "type_definition" && !this.findChild(n, (c) => c.type === "type_extension")) {
        // FS-P9: a mutual type group declares EVERY clause, not just the first. This set
        // decides whether `type X with …` is the file's own declaration of X, so a group's
        // later clauses were previously treated as types this file does NOT declare.
        const clauses = this.filterChildren(n, (c) => TYPE_CLAUSE_TYPES.has(c.type))
        const typeNameNodes = clauses.length > 0
          ? clauses.map((c) => this.findChild(c, (x) => x.type === "type_name")).filter((x): x is Node => !!x)
          : [this.findDescendant(n, (c) => c.type === "type_name", 3)].filter((x): x is Node => !!x)
        for (const typeNameNode of typeNameNodes) {
          const name = readName(typeNameNode)
          if (name) names.add(name)
        }
        continue
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return names
  }

  /**
   * FS-D4 — the R9 DECLARED-TYPE reference graph: a declaration's WRITTEN type is a
   * dependency, published as a `references` edge marked
   * `metadata.relationshipType === "declared_type"`.
   *
   * WHY THIS LANE NEEDED IT. R9 is a family standard — rust's own R13 header calls it
   * one ("mirrors go/c/zig") and thirteen lanes implement it.
   * `script/m60/declared-type-refs-census.ts` measured fsharp **absent** with the
   * control present: the snippet parses, the holder is walked, and the lane emits no
   * type reference at all. A capability that is absent emits nothing for a per-edge
   * oracle to adjudicate, which is why it survived — the same failure mode R9 was
   * created to find.
   *
   * THE POSITIONS. A written type in F# is a `simple_type` / `postfix_type` /
   * `generic_type` / … wrapper whose NAME is a `long_identifier` (dotted) or a bare
   * `identifier`; the position is decided by the wrapper's PARENT, and the source
   * attribution follows the family rule measured off java/kotlin/python and pinned by
   * csharp's `declared-type-graph` fixture: a MEMBER's written type belongs to the
   * enclosing TYPE, a parameter's / return's / local's to the enclosing CALLABLE.
   *
   *   record field        -> the record type   (a field is a property OF the type)
   *   class-body `let`    -> the class          (F#'s private field — a member)
   *   member parameter    -> the member
   *   member return type  -> the member
   *   DU case payload    -> the union type
   *   module let / local -> the binding or the enclosing function
   *   type abbreviation  -> the abbreviation
   *   class inherit      -> REFUSED: already an `extends` edge
   *   interface impl     -> REFUSED: already an `implements` edge
   *   the ambiguous `type X = SomeType` (which the grammar reads as a one-case union)
   *                     -> REFUSED: the RHS and a DU case are the same text, and
   *                        script/m14/tmp/fs020 measured 114 such sites per 400 files
   *                        that single-file analysis cannot separate. See that probe
   *                        for the ruling.
   *
   * WHAT MUST NOT BECOME A NAME, each measured (script/m14/tmp/fs016):
   *   a bound type PARAMETER (`'T`, `^T`) — inside a declaration's own `type_arguments`
   *   it is a BINDING, not a dependency (rust's R13 rule; csharp's `_genericBound`
   *   control);
   *   an UNDERSCORE (`_`, the anonymous type of `Map<string,_>`) — not a name at all;
   *   an F# PREDEFINED type (`int`, `string`, `unit`, …) — the analogue of go's
   *   BUILTINS set and csharp's `int`/`string` control.
   * Deliberately NOT used: the capitalisation of a name. F# lets a type be named
   * anything, so this lane does not guess a type from its spelling.
   */
  private extractDeclaredTypeRefs(
    rootNode: Node,
    pushRel: (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      confidence: number,
      metadata: Record<string, any>,
      line?: number,
    ) => void,
    /**
     * The names this run has published as symbols. Passed in rather than reached for because
     * this pass is a SEPARATE walk from the one that publishes them — the R9 graph is
     * extracted after the main traversal — so the set is threaded rather than captured, and
     * the ordering that makes membership exact (a declaration's symbol is published before
     * its subtree is walked) is a property of the CALLER, not of this method.
     */
    publishedNames: Set<string>,
    /**
     * FS-P5-1, threaded for the same reason `publishedNames` is: the source of a
     * declared-type row is the declaration the annotation sits in, spelled the way the file
     * published it. See the map's own note in `analyze` for the first-wins rule and why the
     * store applies the same one. A name with no entry returns itself, i.e. unchanged.
     */
    fqnOfName: Map<string, string>,
    /**
     * FS-P7-2: the identity of a name restricted to the kinds a written type can name. The
     * SOURCE side of a declared-type edge is a declaration (any kind) and uses `fqnOfName`;
     * the TARGET side is a type and uses this map, which is why both are threaded rather than
     * one being derived from the other.
     */
    typeFqnOfName: Map<string, string>,
  ): void {
    const PREDEFINED = new Set([
      "int", "uint", "int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64",
      "nativeint", "unativeint", "float", "double", "float32", "single", "decimal", "bool",
      "char", "string", "obj", "unit", "void", "exn", "list", "array", "seq", "option", "ref",
      "byte", "sbyte", "intptr", "uintptr", "bigint",
    ])

    // The name-bearing node inside a type wrapper. Wrappers nest (`postfix_type` holds a
    // `simple_type` for its base and a `long_identifier` for the postfix), so the rule
    // is: descend to the first type-ish child, then take the LAST
    // `long_identifier`/`identifier` at that level — the name the wrapper writes LAST,
    // which is the type the whole expression denotes (`int option` is `option`;
    // `Map<string,int>` is `Map`). This is also the node the edge carries its LINE on
    // (M59.A7), never the wrapper's own start.
    // M60 fsharp lane: the wrapper descent is `typeNameNodeOf` on the class now, shared
    // with the attribute rule. It was a closure here. That is a pure relocation and it is
    // MEASURED rather than asserted: the 400-file census over this analyzer is byte-
    // identical on all seven pre-existing labels before and after (validation/m14/fixtures/
    // fsharp/ontology-census.ts, `references` 2,358 / `declared_type` 1,669 among them).
    // Were it not, the declared-type pass would have been the thing that moved, and this
    // comment would be the place to say so.
    const nameNodeOf = (t: Node): Node | null => this.typeNameNodeOf(t)

    /**
     * Is this node an F# TYPE BINDER — `'T`, `^T` — rather than a named type?
     *
     * The grammar writes a binder as a leading apostrophe token and then an identifier:
     *
     *     type_argument "'T"
     *       '          "'"
     *       identifier "T"
     *
     * so the binder is a TOKEN in the tree and not a spelling to be recognised in a string.
     * That is what replaced the regex `/^['^]/` — the fourth of the six literals the M12
     * census found in this file, all of which this analyzer's doc claimed did not exist.
     */
    const isTypeBinderNode = (node: Node): boolean => {
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i)
        if (c && c.type === "'") return true
      }
      return false
    }

    /**
     * Is this node a NAME — a bare `identifier`, or a dotted chain of them ending at `leaf`?
     *
     * Replaces the regex `/^[A-Za-z_][A-Za-z0-9_']*$/`. The grammar already distinguishes an
     * `identifier` from everything else, and asking the TREE is a stronger statement than
     * asking whether a string looks like a name: a dotted path `System.IDisposable` is a
     * `long_identifier` over identifiers, and both facts are then checkable.
     */
    const isIdentifierNameNode = (node: Node, leaf: string): boolean => {
      if (node.type === "identifier") return node.text === leaf
      if (node.type === "long_identifier" || node.type === "long_identifier_or_op") {
        const last = this.filterChildren(node, (n) => n.type === "identifier").pop()
        return last?.text === leaf
      }
      const inner = this.findDescendant(node, (n) => n.type === "identifier", 3)
      return inner?.text === leaf
    }

  /**
   * The published name for a type-bearing node, or null when it is not a dependency.
   */
    const publishedName = (node: Node): string | null => {
      const text = (node.text ?? "").trim()
      if (!text) return null
      if (text === "_") return null
      const leaf = text.includes(".") ? (text.split(".").pop() as string) : text
      if (!leaf || leaf === "_") return null
      // A TYPE BINDER is not a dependency. `'T` and `^T` are the F# spellings, and the
      // grammar has a node for it: a type_variable / type_binder, whose own text is the
      // apostrophe. Reading the NODE is the whole point — the previous test was the regex
      // `/^['^]/` on the text, which is the sixth of the six regex literals the M12 census
      // found in this file and which the analyzer's own doc claimed did not exist.
      if (isTypeBinderNode(node)) return null
      if (PREDEFINED.has(leaf)) return null
      // A name is an IDENTIFIER or a dotted chain of them, and the grammar has an
      // `identifier` node for the former. The previous test was the regex
      // `/^[A-Za-z_][A-Za-z0-9_']*$/` applied to the leaf's text; walking the node says the
      // same thing without a pattern, and says it about the TREE rather than about a string
      // that happens to look like a name.
      if (!isIdentifierNameNode(node, leaf)) return null
      return leaf
    }

    /**
     * Which of a callable's type positions a written type sits in.
     *
     * F# writes a callable's types in three places and the AST separates all three: a
     * PARAMETER inside an argument list (`paren_pattern` for a curried `(a: T)`,
     * `argument_patterns`/`argument_spec`/`curried_spec` for an unparenthesised `a: T`),
     * a RETURN type after the argument list, and a LOCAL's annotation inside a body. A
     * first draft collapsed the parameter case into "not a return type" and labelled it
     * `local_annotation`, which is a third position; the `fsharp/name-surface` fixture
     * pins the corrected labels on `takesGeneric (payload: ResizeArray<int>) : Map<string,
     * int>` — one line, one parameter and one return type, two different labels.
     */
    const callablePosition = (t: Node, decl: Node): "parameter" | "return_type" | "local_annotation" => {
      const inArgs = this.findAncestor(
        t,
        (n) =>
          n.type === "paren_pattern" ||
          n.type === "argument_patterns" ||
          n.type === "argument_spec" ||
          n.type === "arguments_spec" ||
          n.type === "curried_spec",
        3,
      )
      if (inArgs) return "parameter"
      if (decl.type === "value_declaration") return "local_annotation"
      return "return_type"
    }

    /** The declaration a written type belongs to, per the family attribution rule. */
    const resolveSource = (t: Node): { source: string; declaredOn: string } | null => {
      const parent = t.parent
      if (!parent) return null
      if (parent.type === "class_inherits_decl" || parent.type === "interface_implementation") {
        // REFUSED: already an `extends` / `implements` edge. A second, weaker edge for
        // the same fact is the duplicate R9 exists to prevent.
        return null
      }
      if (
        parent.type === "type_attribute" ||
        parent.type === "type_arguments" ||
        parent.type === "type_argument_defn"
      ) {
        return null
      }
      if (parent.type === "record_field") {
        const rt = this.findAncestor(parent, (n) => n.type === "record_type_defn", 6)
        if (!rt) return null
        // FS-P9: the owner is the RECORD CLAUSE's OWN name. This used to climb to the
        // `type_definition` and take the FIRST `type_name` in it, which in a mutual group
        // is the sibling: `type A = { First: Dep } and B = { Second: Dep2 }` published
        // `A -> Dep` and `A -> Dep2`, and `A` is a name that exists, so the second edge
        // resolved and nothing downstream could tell it named the wrong type. The class-
        // field branch twenty lines below already reads the group correctly (an owner
        // chosen by position); this arm and that one answer the same question and had
        // different answers.
        const tn = this.findChild(rt, (n) => n.type === "type_name")
        const name = tn ? this.typeInfoOf(tn)?.name ?? null : null
        return name ? { source: name, declaredOn: "record_field" } : null
      }
      if (parent.type === "union_type_field") {
        const ud = this.findAncestor(parent, (n) => n.type === "union_type_defn", 4)
        if (!ud) return null
        const tn = this.findDescendant(ud, (n) => n.type === "type_name", 2)
        const name = tn ? this.typeInfoOf(tn)?.name ?? null : null
        return name ? { source: name, declaredOn: "union_case_payload" } : null
      }
      // A type ABBREVIATION's right-hand side is a real dependency: `type Names = Dep
      // list` depends on Dep, which is the fact a reader wants from the graph. The
      // ambiguous `type Names = Dep` shape is deliberately left out (see the header).
      if (parent.type === "type_abbrev_defn") {
        const tn = this.findChild(parent, (n) => n.type === "type_name")
        const name = tn ? this.typeInfoOf(tn)?.name ?? null : null
        return name ? { source: name, declaredOn: "type_abbreviation" } : null
      }
      // Everything else is a parameter / return / local annotation, which belongs to the
      // enclosing CALLABLE. `parent` ITSELF can be that declaration — a class body's
      // `let mutable f : Dep` writes its annotation on a `simple_type` whose parent IS
      // the `function_or_value_defn` — so the direct parent is tested first and only
      // then are ancestors walked.
      const isDecl = (n: Node) =>
        n.type === "member_defn" ||
        n.type === "function_or_value_defn" ||
        n.type === "value_declaration" ||
        n.type === "additional_constr_defn"
      // A LAMBDA parameter is not a declaration and owns nothing.
      //
      //     let sb = fun (sb: StringBuilder) (c: char) -> …
      //
      // The `simple_type`'s nearest declaration ancestor is the `let sb` that HOLDS the
      // lambda, so the walk attributed `StringBuilder` to `sb` — a symbol that exists, so
      // nothing downstream could tell the edge was wrong, and the truth oracle (which
      // refuses lambda parameters independently) derived no such row. The lane's contract
      // says it outright and pins it in the negative fixture: lambda params are NOT
      // symbols. So an annotation on one is a fact about a value that the graph does not
      // publish, and publishing it under the holder's name is worse than publishing
      // nothing: it is a true-shaped edge about the wrong thing.
      //
      // The discriminator is the `fun_expression` between the pattern and the declaration,
      // which is the only thing that makes this a lambda parameter rather than a member's.
      const inLambda = this.findAncestor(
        parent,
        (n) => n.type === "fun_expression",
        6,
      )
      if (inLambda) return null
      const decl = isDecl(parent) ? parent : this.findAncestor(parent, isDecl, 14)
      if (!decl) return null
      const pos = callablePosition(t, decl)
      if (decl.type === "member_defn") {
        const mop = this.findChild(decl, (n) => n.type === "method_or_prop_defn")
        const prop = mop ? this.findChild(mop, (n) => n.type === "property_or_ident") : undefined
        const idents = prop ? this.filterChildren(prop, (n) => n.type === "identifier") : []
        const name = idents.length >= 2 ? idents[idents.length - 1]?.text : idents[0]?.text
        return name ? { source: name, declaredOn: pos } : null
      }
      if (decl.type === "additional_constr_defn") return { source: "constructor", declaredOn: "parameter" }
      // A `let` DIRECTLY in a class body is F#'s private field, so its written type
      // belongs to the TYPE. A `let` INSIDE a body is a LOCAL, and a local's written type
      // belongs to the enclosing CALLABLE — the family attribution rule, and the rule
      // the lane's own truth oracle derives independently.
      //
      // The distinction is "is there a CALLABLE between the declaration and its type",
      // not "is there a type_definition above me": a first draft asked the latter, so
      // `member this.BodyLocal() = let local : Dep = …` attributed the local's type to
      // the CLASS. The truth oracle found it as the single MISSING row on
      // fsharp/declared-type-graph (`BodyLocal -> Dep` against the analyzer's
      // `Holder -> Dep`), which is the second opinion doing the job it exists for.
      const inTypeBody = this.findAncestor(decl, (n) => n.type === "type_extension_elements", 3) !== undefined
      const enclosingCallable = this.outermostCallableAbove(decl)
      if (inTypeBody && enclosingCallable === undefined) {
        // a field of the class: the type owns it.
        //
        // The owning type is the one whose body CONTAINS this declaration, and in a mutual
        // type group the group's node holds several:
        //
        //     type FSharpAssemblyContents(…) =          // <- the group's first type
        //         member val …
        //     and FSharpImplementationFileContents(…) =  // <- the type that owns the field
        //         let mutable Binding : …
        //
        // Two things were wrong here. `findAncestor(decl, type_definition, 6)` is bounded
        // and cannot tell "no type above" from "further than 6 up". And taking the FIRST
        // `type_name` descendant of that node names the group's FIRST type, so a field in
        // the `and` clause was published under its sibling's name — a name that exists, so
        // the edge resolved and nothing downstream could tell it was wrong. Measured in
        // Exprs.fs: `FSharpAssemblyContents -> Binding` against the truth's
        // `FSharpImplementationFileContents -> Binding`.
        //
        // The owner is the LAST type name that begins before the field does, in document
        // order — which is the same correction the truth oracle needed for identifiers in a
        // dotted name, and for the same reason: an array is not a document.
        const td = this.outermostTypeDefinitionAbove(decl)
        if (!td) return null
        const fieldStart = decl.startIndex
        const names = this.findDescendants(td, (n) => n.type === "type_name", 4)
          .filter((n) => n.startIndex < fieldStart)
          .sort((a, b) => a.startIndex - b.startIndex)
        const tn = names.length ? names[names.length - 1] : undefined
        const tName = tn ? this.typeInfoOf(tn)?.name ?? null : null
        if (tName) return { source: tName, declaredOn: "class_field" }
      }
      // A local: the ENCLOSING callable is the source, never the local's own name —
      // `let local : Dep` is a dependency of the function that contains it.
      if (enclosingCallable) {
        if (enclosingCallable.type === "additional_constr_defn") return { source: "constructor", declaredOn: "local_annotation" }
        const cName =
          enclosingCallable.type === "member_defn"
            ? this.memberNameOf(enclosingCallable)
            : this.declaredBindingName(enclosingCallable)
        if (cName) return { source: cName, declaredOn: "local_annotation" }
      }
      // The fallback publishes a name ONLY if this run has already published it as a symbol.
      //
      // A structural guard was tried here first and was wrong in both directions, which is
      // what the membership test exists to settle. Refusing every nested declaration refuses
      // `isAttribute -> FSharpEntity`, where the binding is a local inside an active pattern
      // and IS published as a function; not refusing publishes `argInfo -> ArgReprInfo`,
      // where the binding is a local and is NOT published, and the edge has no other end.
      // Neither defect is visible downstream: one resolves to a perfectly good symbol and the
      // other to nothing, and an edge's shape alone does not distinguish them.
      //
      // `publishedNames` is exact here rather than approximate: a declaration's symbol is
      // pushed when the walk visits the declaration, and this runs while walking its subtree.
      // MEASURED, THEN REVERTED: reading the left-hand side whose SPAN contains the
      // annotation, rather than the first one on the node, is the right idea for a mutual
      // group and it made the corpus much worse — MISSING 8 -> 48, UNEXPLAINED 66 -> 139.
      //
      // The reason is that a left-hand side does not always SPAN the type it owns. In
      // `let rec f (x: int) : R = …` the parameter's type is inside the left, but the RETURN
      // type is a sibling of the pattern rather than a descendant of the left, so no left
      // contains it, the positional lookup answers nothing, and the row is dropped instead of
      // attributed. A position test that is right for half the positions and silent for the
      // other half is the same defect as the bound it replaced, wearing a different hat.
      //
      // The `and`-clause SYMBOL PUBLICATION that came with it is kept, because that part is
      // independently correct and separately measured: before, `groupSecond` did not exist as
      // a symbol at all, which is a fact about the symbol table and not about attribution.
      const name = this.declaredBindingName(decl)
      if (name && publishedNames.has(name)) return { source: name, declaredOn: pos }
      return null
    }

    const emitted = new Set<string>()
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      // FS-D30: this pass is a SECOND WALK, and it had none of the recovery rule the first
      // walk got. `visit` refuses to descend into an `ERROR` node and discloses it instead,
      // because the tree there is the parser's reconstruction rather than the program — but
      // this loop started at the root and took every node it met, so on a file the grammar
      // cannot read it mined the recovery artifact anyway and published its rows.
      //
      // The evidence is a corpus file that is large enough to be worth parsing:
      // CheckExpressions.fs, 702 KB, produced ZERO symbols and 147 relationships, every one
      // of them a `references` row with an EMPTY target — `RecursiveBindingInfo -> `,
      // `CheckedBindingInfo -> `, `ValScheme -> `. An edge with no target is not a wrong
      // answer, it is the absence of one, and 147 of them is what a walk through a
      // reconstruction looks like when it is asked to read meaning out of it.
      //
      // So the rule is now the SAME rule in both walks, which is the only way "a recovery
      // region is disclosed and not mined" can be a property of the analyzer rather than a
      // property of one of its two loops.
      if (n.type === "ERROR" || n.isMissing) continue
      if (TYPE_WRAPPER_NODES.has(n.type)) {
        // only the OUTERMOST wrapper, so a postfix_type inside a list_type is not
        // counted once per layer
        const nestedInType = n.parent != null && TYPE_WRAPPER_NODES.has(n.parent.type)
        // FS-D11: a TYPE QUERY is not a written type. `typeof<T>` and `unbox<T>` are
        // EXPRESSIONS that carry a type argument — `typeof<TypeInThisAssembly>.Assembly
        // .Location` is a dependency on a runtime value, and publishing
        // `references loc -> TypeInThisAssembly` says the opposite.
        //
        // The discriminator is the PARENT, and it is two shapes because the grammar
        // spells the query two ways: a `static_type` wrapper, and a bare
        // `long_identifier_or_op` named `typeof`/`unbox` whose child is the type. A
        // first draft refused only the `static_type` wrapper and measured nothing,
        // because `typeof<Foo>` does not produce one — verified by reading the tree,
        // not by assuming the wrapper.
        if (!this.isTypeQueryPosition(n) && !nestedInType) {
          const nameNode = nameNodeOf(n)
          const writtenLeaf = nameNode ? publishedName(nameNode) : null
          // FS-P7-2. A TYPE THIS FILE DECLARES IS SPELLED AS ITS IDENTITY, NOT AS ITS LEAF.
          //
          // The declared-type arm published the bare leaf (`Dep`) even when the file was the
          // one that declared `Dep`, while `calls`, `instantiates` and `uses` have spelled a
          // name this file published as its identity (`fqnOfName`) since FS-P5 — the same
          // file, two rules for one question. The leaf is not wrong so much as ambiguous: the
          // store resolves it through strategy 2 only while the NAME is unique in the corpus,
          // and `Dep` is a name a hundred files hold. The identity is exact.
          //
          // MEASURED, TWICE, AND THE FIRST MEASUREMENT WAS WRONG IN TWO WAYS THAT ARE PART OF
          // THE RECORD. The first price (`.tmp-probe/fs-p7-fqn.py`, rows-pass7-meta.ndjson,
          // the store's three strategies against the full-corpus pool) read +4,205 to
          // determinate and −110 the other way on 9,555 rows in the `in-file-declaration`
          // class. Both halves of that were defects of the instrument: the population POOLED
          // the `open` rows, which this rule never touches (a `references` row is an `open`, an
          // `open type` or a written type, and only the third is a declared type), and the
          // candidate used the identity of whatever symbol the file published first under that
          // name — ANY KIND — which is the mis-join TYPE_POSITION_KINDS exists to prevent.
          //
          // THE SHIPPED RULE, on the population that runs it (`.tmp-probe/fs-p7-pop.py`
          // equivalent, rows-pass10-meta.ndjson, keyed on the arm's own `relationshipType`):
          // `references` splits 35,102 `declared_type` + 14,817 others; of the declared-type
          // rows 7,076 are `in-file-declaration` and 6,907 of those are respelled, moving the
          // class from 2,613 determinate to **4,865, i.e. +2,252 and ZERO the other way**, and
          // `references` target-determinacy 25.8% -> 30.3%. The `external-type` half (28,026
          // rows) is untouched on purpose: the identity is not this file's to spell.
          //
          // WHAT THE KIND GATE COST, counted: the unfiltered draft reached 35.3% of the whole
          // draw against this rule's 34.8%, and the 1,536 determinate edges that difference is
          // made of were attached to 2,467 identities held by a MODULE (1,430), a MEMBER
          // (816 — a property or method or DU case: `FieldParserInfo.Type`, `Existential.Type`,
          // `ParquetColumnKind.DateTimeOffset`) or a NAMESPACE (221). Every one of those is a
          // determinate edge naming a declaration that is definitively NOT the type the source
          // wrote, which is worse than the ambiguous leaf it replaced. The audit that found
          // them is also the acceptance test: on the shipped arm, **6,907 of 6,907** dotted
          // declared-type targets are held by a type-kind symbol.
          const target = writtenLeaf && typeFqnOfName.has(writtenLeaf)
            ? (typeFqnOfName.get(writtenLeaf) as string)
            : writtenLeaf
          const src = resolveSource(n)
          const key = `${src?.source}|${target}|${n.startIndex}`
          if (target && src && !emitted.has(key)) {
            emitted.add(key)
            // FS-P7-2. THE PATH, NOT ONLY THE LEAF. `typeNameNodeOf` returns the innermost
            // `identifier` on purpose (a name is asked of the NODE), so the written path
            // `System.IO.Stream` reaches this arm as `Stream` and the path itself is only
            // in the `long_identifier` that ENCLOSES it. Reading that ancestor is what makes
            // the two candidate spellings comparable at all: the store holds a namespace-
            // declared type as `<dotted namespace>.<name>` (one scope segment for the whole
            // header), so the path as written is the exact identity when the declaration is
            // in the corpus — and the leaf is the better spelling when it is not. Which of
            // those two populations dominates is a MEASUREMENT, so the path is recorded and
            // nothing is respelled on the strength of the argument.
            const dottedAncestor = (() => {
              let cur: Node | null = nameNode
              for (let guard = 0; guard < 6 && cur; guard++) {
                if (cur.type === "long_identifier") return cur.text
                cur = cur.parent
              }
              return ""
            })()
            const writtenType = dottedAncestor || (nameNode?.text ?? "").trim()
            pushRel(
              fqnOfName.get(src.source) ?? src.source,
              target,
              ASTEngine.RelationshipType.References,
              1.0,
              {
                nodeType: n.type,
                relationshipType: "declared_type",
                declaredOn: src.declaredOn,
                declaredType: target,
                // FS-P7-1: the same two facts every other target carries — the reason,
                // and the spelling this one is a reduction of. `publishedName` takes the
                // LAST segment of a dotted type, so `System.IO.Stream` becomes `Stream`
                // and the path the source wrote is otherwise unrecoverable from the
                // result. Whether that reduction is right is a price, not an opinion.
                targetResolution: UNRESOLVED_TYPE,
                ...(writtenType.includes(".") && writtenType !== target ? { targetWritten: writtenType } : {}),
              },
              nameNode ? nameNode.startPosition.row + 1 : n.startPosition.row + 1,
            )
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  /**
   * Pure-AST name + declared generic-parameter extraction for a type_name
   * node. The clean name is long_identifier -> identifier (generics live in a
   * sibling type_arguments node, never inside the identifier).
   */
  private typeInfoOf(node: Node): { name: string; genericParameters?: string[] } | null {
    const liNode = this.findChild(node, (n) => n.type === "long_identifier")
    const idNode = liNode
      ? this.findDescendant(liNode, (n) => n.type === "identifier")
      : this.findChild(node, (n) => n.type === "identifier")
    if (!idNode?.text) return null
    const genericParameters: string[] = []
    const taNode = this.findChild(node, (n) => n.type === "type_arguments")
    if (taNode) {
      for (let i = 0; i < taNode.namedChildCount; i++) {
        const c = taNode.namedChild(i)
        if (c?.type !== "type_argument_defn") continue
        const argNode = this.findChild(c, (n) => n.type === "type_argument")
        if (argNode?.text) genericParameters.push(argNode.text)
      }
    }
    return {
      name: idNode.text,
      genericParameters: genericParameters.length > 0 ? genericParameters : undefined,
    }
  }

  private isFSharpBuiltin(call: string, leaf: string): boolean {
    if (FSHARP_CONSOLE_BUILTINS.has(call)) return true
    if (OBJECT_LEAF_METHODS.has(leaf)) return true
    if (call === "Console.WriteLine" || call.startsWith("Console.")) return true
    return false
  }

  /**
   * Does this node CARRY an unnamed token equal to `text`, anywhere in its children?
   *
   * Distinct from `firstTokenIs`, which asks about the FIRST non-trivia token and is
   * used for a declaration's keyword (`override`, `new`). `open type X` needs the
   * opposite question — the token is not first, it sits between the keyword and the
   * path — so it asks for the token's presence rather than its position.
   */
  private nodeHasToken(node: Node, text: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && !c.isNamed && c.type === text) return true
    }
    return false
  }

  /**
   * The name-bearing node inside a F# type wrapper, or null.
   *
   * WRAPPERS NEST (`postfix_type` holds a `simple_type` for its base and a
   * `long_identifier` for the postfix), so the rule is: descend to the first type-ish
   * child, then take the LAST `long_identifier`/`identifier` at that level — the name
   * the wrapper writes LAST, which is the type the whole expression denotes (`int option`
   * is `option`, `Map<string,int>` is `Map`). This is the extraction the declared-type
   * pass has always used; it is a METHOD now so the attribute rule reads a wrapper the
   * same way instead of carrying a second copy of the descent that could drift from it.
   * A bound type parameter (`type_argument`) yields null: `'T` is a binder, not a name.
   */
  private typeNameNodeOf(t: Node): Node | null {
    let cur: Node | null = t
    for (let guard = 0; guard < 8 && cur; guard++) {
      if (cur.type === "type_argument") return null
      if (cur.type === "long_identifier") {
        let leaf: Node | null = null
        for (let i = 0; i < cur.namedChildCount; i++) {
          const c = cur.namedChild(i)
          if (c && (c.type === "identifier" || c.type === "long_identifier")) leaf = c
        }
        return leaf ?? cur
      }
      if (cur.type === "identifier") return cur
      let next: Node | null = null
      for (let i = 0; i < cur.namedChildCount; i++) {
        const c = cur.namedChild(i)
        if (
          c &&
          (TYPE_WRAPPER_NODES.has(c.type) ||
            c.type === "type_argument" ||
            c.type === "type_arguments" ||
            c.type === "long_identifier" ||
            c.type === "identifier")
        ) {
          next = c
          break
        }
      }
      if (!next) return null
      cur = next
    }
    return null
  }

  /**
   * The dependency LEAF a name-bearing node denotes: the last segment of a dotted path.
   *
   * `System.Obsolete` is `Obsolete`, which is the spelling a consumer binds by — the
   * index stores one symbol per name, and `System.Obsolete` binds to nothing while
   * `Obsolete` binds to the attribute class.
   *
   * "Is this a name?" is asked of the NODE and never of the string. This lane's doc
   * carries a regex inventory whose first two rows are exactly this decision — the
   * patterns `/^['^]/` and `/^[A-Za-z_][A-Za-z0-9_']*$/` — and both were replaced for
   * the same reason this method has no pattern: the grammar already makes the
   * distinction as a node type. `typeNameNodeOf` returns an `identifier` or a
   * `long_identifier`, so a non-`identifier` node here is not a name, and `_` is
   * refused because the grammar writes it as an `identifier` with that one spelling
   * and it names no declaration.
   */
  private dependencyLeafName(node: Node): string | null {
    if (node.type !== "identifier" && node.type !== "long_identifier") return null
    const raw = (node.text ?? "").trim()
    if (!raw || raw === "_") return null
    // a type binder is a TOKEN in the tree: `type_argument "'T"` has an apostrophe child
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && (c.type === "'" || c.type === "^")) return null
    }
    const leaf = raw.includes(".") ? (raw.split(".").pop() as string) : raw
    return leaf && leaf !== "_" ? leaf : null
  }

  /**
   * The VALUE inside an F# string-literal node, with the delimiters removed.
   *
   * The grammar gives the content no node: `(fsi_directive_decl (string))` — the
   * `string` node's two children are the two `"` tokens and `namedChildCount` is 0.
   * So the delimiters are read off the TREE (their `endIndex`/`startIndex` are the
   * exact byte bounds) and the content is the span between them. Taking `node.text`
   * instead put the quotes IN the dependency: `imports Fixture.ImportAndUse ->
   * "nuget: FSharp.Core"`, a target that binds to nothing, which is the shape of a
   * fabricated edge even though the fact underneath it is real.
   *
   * `verbatim_string` (`@"C:\dir\file.fsx"`) has three delimiter tokens: the opening
   * `@"`, the escape `\`, and the closing `"`. The span between the FIRST and the LAST
   * is the content. Its one disclosed limit: F# escapes a quote inside a verbatim
   * string by doubling it, and this does not un-double it, so a specifier containing
   * `""` keeps both characters. No corpus specifier does (measured over the whole
   * corpus's 193 `fsi_directive_decl` nodes), and a wrong-but-visible path is better
   * than a silently truncated one.
   */
  /**
   * THE FILE A `#load` NAMES, AS A PROJECT-RELATIVE PATH — or null when this checkout cannot
   * place it, in which case NO `part_of` ROW IS PUBLISHED.
   *
   * THE RULES, IN THE ORDER THEY APPLY:
   *
   * 1. A SPECIFIER WITH A SCHEME (`nuget:`, `http:`) names something that is not a path in
   *    this checkout. Refused.
   * 2. A RELATIVE SPECIFIER IS RESOLVED AGAINST THE INCLUDING FILE'S OWN DIRECTORY — F#'s
   *    `#load` is relative to the file that writes it, not to the project root.
   * 3. THE RESULT IS EXPRESSED RELATIVE TO THE PROJECT ROOT, so the spelling does not depend
   *    on where the checkout lives (the same reason the yaml lane's document identity is
   *    project-relative — src/ast/engine.ts:2405-2429).
   * 4. A TARGET THAT ESCAPES THE PROJECT (`..`) IS REFUSED: it is not a file of this project,
   *    and a `part_of` row whose target no project key can answer is exactly the shape this
   *    label exists to stop publishing (types.ts:187-190).
   * 5. WITHOUT A PROJECT ROOT THERE IS NO PROJECT-RELATIVE PATH TO PUBLISH, and the row is
   *    REFUSED. Fail-closed: a `part_of` edge is a fact about two files of one project, and a
   *    caller that cannot say which project the file is in cannot make that fact. The root
   *    comes from `context.projectRoot` (production always supplies it — pool-worker.ts:2041)
   *    and, failing that, from the nearest `.git` above the file (the dart sibling's rule).
   *
   * NO SOURCE TEXT IS READ: this is a pure path computation over the two strings the caller
   * already has, so the resolution cannot differ between two runs of the same file.
   */
  private fsharpPartTargetPath(
    filePath: string,
    context: ASTEngine.AnalyzeContext | undefined,
    specifier: string,
  ): string | null {
    if (specifier.length === 0) return null
    // a scheme names something that is not a path in this checkout
    if (specifier.indexOf(":") >= 0) return null
    const contextRoot = context?.projectRoot
    const projectRoot =
      typeof contextRoot === "string" && contextRoot.length > 0
        ? contextRoot
        : fsharpProjectRootOf(filePath)
    if (projectRoot === null) return null
    const abs = path.resolve(path.dirname(path.resolve(filePath)), specifier)
    const rel = path.relative(path.resolve(projectRoot), abs)
    if (rel.length === 0 || path.isAbsolute(rel)) return null
    if (rel === ".." || rel.startsWith(`..${path.sep}`)) return null
    return rel.split(path.sep).join("/")
  }

  private stringLiteralValue(node: Node): string | null {
    if (node.type !== "string" && node.type !== "verbatim_string") return null
    if (node.childCount === 0) return null
    const first = node.child(0)
    const last = node.child(node.childCount - 1)
    if (!first || !last) return null
    const from = first.endIndex - node.startIndex
    const to = last.startIndex - node.startIndex
    if (!(to > from)) return null
    const value = node.text.slice(from, to)
    return value.length > 0 ? value : null
  }

  private firstTokenIs(node: Node, text: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (!c) continue
      if (c.type === text) return true
      // Skip leading attribute/comment trivia tokens
      if (c.isNamed) break
    }
    return false
  }

  private findChild(node: Node, predicate: (n: Node) => boolean): Node | undefined {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) return child
    }
    return undefined
  }

  private filterChildren(node: Node, predicate: (n: Node) => boolean): Node[] {
    const results: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) results.push(child)
    }
    return results
  }

  /**
   * The callee NAME inside a pipeline operand (FS-D30).
   *
   * An operand is either name-like already (the `xs |> ignore` shape) or an application whose callee
   * is its FIRST name-like child (the `xs |> Array.exists(fun …)` shape), which is what puts an
   * `application_expression` on the callee side and defeated the old direct-children filter. One
   * level of descent is enough for both observed shapes and deliberately not more: descending until
   * something name-like turns up would read an ARGUMENT on the shapes where the callee is absent.
   */
  private pipelineCalleeName(operand: Node | undefined | null): Node | undefined {
    if (!operand) return undefined
    if (PIPELINE_NAMEY.has(operand.type)) return operand
    if (operand.type === "application_expression" || operand.type === "prefixed_expression") {
      for (let i = 0; i < operand.namedChildCount; i++) {
        const c = operand.namedChild(i)
        if (c && PIPELINE_NAMEY.has(c.type)) return c
      }
    }
    return undefined
  }

  private findDescendants(node: Node, predicate: (n: Node) => boolean, maxDepth: number = 5): Node[] {
    const results: Node[] = []
    if (maxDepth <= 0) return results
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) {
        if (predicate(child)) results.push(child)
        results.push(...this.findDescendants(child, predicate, maxDepth - 1))
      }
    }
    return results
  }

  private findDescendant(node: Node, predicate: (n: Node) => boolean, maxDepth: number = 5): Node | undefined {
    if (maxDepth <= 0) return undefined
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) {
        if (predicate(child)) return child
        const found = this.findDescendant(child, predicate, maxDepth - 1)
        if (found) return found
      }
    }
    return undefined
  }

  private nodeToRange(node: Node) {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }
}
