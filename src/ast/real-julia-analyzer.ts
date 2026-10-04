import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * Julia — analyzer.
 *
 * WRITTEN AGAINST A MEASURED GRAMMAR, WHICH IS THE POINT OF THIS FILE'S EXISTENCE ORDER
 * ------------------------------------------------------------------------------------
 * Most lanes in this repo were written first and measured afterwards, and the measurement is
 * what found the defects: objective-c carried two reviews and a CLOSED marker over a corpus
 * instrument reading 7 of the 329 files the router admits, and its `grammarErrorFiles: 0` came
 * from an artifact recording 49 crashes counted as 49 clean parses. This lane was inverted. Before
 * this file existed, `script/m60/julia-census.ts` had measured the grammar over 966 corpus files
 * and `script/m12/julia-differential.ts` had compared it against **Julia 1.11.3's own parser**
 * over 949 of them, finding **185 files of valid Julia the grammar could not read**. Four named
 * constructs were patched before a line of analyzer was written, which is why this analyzer is
 * starting from a defect inventory instead of from a blank page.
 *
 * The remaining 177 defect files are NOT hidden. They are in the census and the differential,
 * and a construct in one of them is published as far as the tree allows.
 *
 * WHAT JULIA'S SEMANTICS ACTUALLY ARE, because two of the 10 relationship types are declined
 * rather than faked and one of them was declined WRONGLY before this header said so
 * ----------------------------------------------------------------------------------------------
 * `implements` is **declined**. Julia has no interfaces to implement: `abstract type` participates
 * in a TYPE hierarchy (`<:`), not in a protocol-conformance relation. Publishing "S implements I"
 * for `struct S <: I` would be the managed-OO ontology applied to a language that does not have it.
 * MEASURED: `wasm/tree-sitter-julia.wasm` produces 149 distinct node types over the 971 admitted
 * corpus files (4,948,278 nodes) and NONE of the 12 node-type names that would express a protocol
 * or conformance clause occurs; the nearest corpus construct — a supertype clause naming an
 * `abstract type` declared in the same file — occurs 325 times across 60 files and every one is a
 * SUBTYPE relation already published as `extends`. See `validation/m14/fixtures/julia/census.ts`
 * instrument A and instrument B.
 *
 * `overrides` WAS **declined** here, on the grounds that "Julia has multiple dispatch, not
 * overriding", and the argument was **sound for the case it names and silent about the case julia
 * has**. Two methods with the same name and different signatures are DIFFERENT METHODS, both live,
 * neither replacing the other — true, and irrelevant to the method table. Julia's method table holds
 * exactly ONE entry per `(name, signature)` pair, so a second declaration of the SAME pair replaces
 * the first, and julia says so itself: under `--warn-overwrite=yes` it prints
 * `WARNING: Method definition f(Int) in module Main at line 12 overwritten at line 40`. `overrides`
 * is emitted, behind four guards, and the guards were each put there by a measurement that removed
 * edges: 417 redefinition pairs in the corpus, 237 unconditional, 200 not a local binding, 163 in a
 * genuinely different scope, 44 inside a DECLARED module — and 3 edges. The refusals are counted,
 * not hidden; `overridesEmit` below and `docs/analyzers/real-julia-analyzer.md` carry the numbers.
 *
 * `extends` is emitted ONLY for `<: Supertype` on an `abstract type` or a `struct`. That is the
 * real subtype edge and nothing else is.
 *
 * `instantiates` is emitted when a bare type name is CALLED — `Point(1, 2)` constructs a Point.
 * Julia has no `new()`; calling the type is the constructor, so a call whose callee is a
 * capitalized identifier bound to a type declaration is an instantiation. It is marked
 * `isTypeConstruction` rather than inferred from capitalization alone, because capitalization is
 * a convention and the corpus is the arbiter.
 */

// A Julia identifier that is a CONVENTIONALLY capitalized name is not evidence of anything on
// its own, so this set is only consulted for a call whose callee is a bare identifier, and only
// alongside the question "did this file declare a type with this name?".
const TYPE_DECLARATIONS: ReadonlySet<string> = new Set(["abstract_definition", "primitive_definition", "struct_definition"])

// Julia's own implicit and constant names. None of them is a dependency edge, and emitting one
// would be a fabricated relationship: `nothing`/`missing` are the language's sentinel values, the
// `ARGS`/`ENV` globals are the interpreter's own bindings, and a bare `true`/`false` is a literal
// (the grammar's `boolean_literal` already covers that, so this set is about the names that
// appear as plain identifiers).
/**
 * Relationship source for code that is not inside any declaration.
 *
 * MEASURED, and it was the single largest source of missing edges in this analyzer. Julia files
 * do not have to open a `module`: measured over 295 corpus files, **71.9% have no module block
 * at all**. Julia scripts, REPL transcripts, `include`d fragments and whole stdlib test files all
 * run at file scope, and top-level code there is ordinary executable code — `const C = f(x)`,
 * bare `f(x)`, calls between statements.
 *
 * Because the call edge required a non-empty scope, all of it vanished: 46 module-less files
 * emitted ZERO call edges despite holding 8,478 `call_expression`s between them. Worse than
 * incomplete — a script that calls a dozen functions indexed as a file containing nothing.
 *
 * The name and the rule are this repo's own, not an invention: `real-c-analyzer.ts:892`
 * documents `getRelationshipSource()` as "the enclosing FUNCTION name … or `global`" for
 * file-scope relationships, precisely because an invented scope name like `core_init.block_211`
 * is a dangling identity that resolves to no symbol.
 *
 * `contains` deliberately KEEPS its `if (scope)` guard, for the reason recorded next to the same
 * C rule: `global contains core_init` is a dangling edge to a container that does not exist, and
 * ownership is a claim about a real container. Top-level declarations get `ownerName: undefined`
 * instead, which says "this is not owned by anything" rather than inventing an owner.
 */
const GLOBAL_SCOPE = "global"

const IMPLICIT_OR_CONSTANT: ReadonlySet<string> = new Set([
  "nothing", "missing", "undef", "ARGS", "ENV", "C_NULL", "stdout", "stderr", "stdin",
])

/**
 * Text normalisation, three shapes, and NOT one regex each.
 *
 * `script/m12/verify-regex-census.ts` reported nine regex literals in this file, all of the form
 * `node.text.replace(/…/)`, and the committed census
 * (`validation/m12/results/regex-census.json`) carries **no julia row at all** — the analyzer was
 * written after the census was established, so the whole file arrived as unrecorded debt. A census
 * row is a results artifact written by a verifier script (honesty contract §5.1), so it is not
 * editable here even to declare the debt honestly. The only honest move is to DELETE the regexes,
 * which is what these three functions do.
 *
 * Each replacement is a PREFIX or CHARACTER test rather than a pattern, which is the actual
 * property the regex was standing in for: the grammar attaches these sigils deterministically at
 * the start or end of a token, so "does this text start with `@`" is the whole question and
 * `/^@/` is a nine-times-larger spelling of it.
 */

/** Drop a sigil the grammar puts at the FRONT of a token: `macro_identifier`'s `@`, a quote's `:`. */
function stripSigil(text: string, sigil: string): string {
  const t = text.trim()
  return t.startsWith(sigil) ? t.slice(sigil.length) : t
}

/**
 * The quoted-OPERATOR member of a field read: `x.:(==)` and `s.:<` put the member in a
 * `quote_expression`, whose text is `:(==)` — five characters around a two-character name. The
 * former spelling was `/^:\(|\)$/g`, which strips a leading `:(` and a trailing `)` in either order;
 * this strips the same two characters and nothing else, so it cannot also eat a `)` or `(` that is
 * part of an operator name.
 */
function unquoteOperatorMember(text: string): string {
  let t = text.trim()
  if (t.startsWith(":")) t = t.slice(1)
  if (t.startsWith("(") && t.endsWith(")")) t = t.slice(1, -1)
  return t.trim()
}

/**
 * Every run of whitespace collapsed to one space, with the ends trimmed.
 *
 * This is the `overrides` method-signature key's layout normalisation: `f( x )` and `f(x)` are the
 * SAME method to julia, so the key has to be indifferent to spacing inside the argument list, and
 * the fixture `method-redefinition-overrides` pins the resulting string exactly. Whitespace is
 * tested per CHARACTER (`ch.trim() === ""`), which is what `/s+/` means and, unlike an ASCII
 * allowlist, keeps the Unicode space characters julia source can carry.
 */
function collapseSpace(text: string): string {
  const words: string[] = []
  let word = ""
  for (const ch of text) {
    if (ch.trim() === "") {
      if (word) { words.push(word); word = "" }
    } else {
      word += ch
    }
  }
  if (word) words.push(word)
  return words.join(" ")
}

/**
 * Node types inside which a declaration is CONDITIONAL, or is text julia GENERATED rather than
 * text this file declares. An `overrides` edge is only a parse fact in an unconditional position,
 * so this set is the whole test.
 *
 * EVERY MEMBER IS A MEASURED NODE TYPE, not a recollection: `validation/m14/fixtures/julia/census.ts`
 * enumerates the 142 distinct node types `wasm/tree-sitter-julia.wasm` produces across the admitted
 * corpus, and these are drawn from that inventory (`instrumentA.nodeTypes` in its JSON output). A
 * name that does not appear there cannot be reached, which is a smaller rule than it looks: it means
 * a typo fails closed rather than silently admitting a conditional position.
 *
 * The MEMBERSHIP is measured rather than guessed, by the same instrument. These three files each
 * declare a method TWICE with an identical signature, and every one of the three is inside an
 * `if`/`else` — a version guard, which is the idiom this set exists to exclude:
 *
 *   json_jl/src/write.jl:626-629   `if isdefined(Base, :StringVector) … else … end`
 *   json_jl/src/lazy.jl:437-442    `if VERSION < v"1.11" … else … end`
 *
 * Exactly one branch runs and the other method is never defined, so the pair is not a replacement.
 * Counting them would have been the fabrication the ontology workstream's rule exists to prevent,
 * on the two files a reader is most likely to look at.
 *
 * The GENERATED half is `macrocall_expression` and the two quote forms, because their content is not
 * julia source in this file: `@eval f(x) = …` and `quote f(x) = … end` carry code julia writes at
 * expansion, and the tree holds the generated text rather than the declaration.
 */
const CONDITIONAL_OR_GENERATED: ReadonlySet<string> = new Set([
  // conditional
  "if_statement", "else_clause", "elseif_clause",
  "while_statement", "for_statement",
  "try_statement", "catch_clause", "finally_clause",
  "ternary_expression",
  "macrocall_expression",
  // generated, not declared here
  "quote_expression", "quote_statement",
])

/**
 * Node types inside which a declaration is a LOCAL BINDING rather than a method-table entry.
 *
 * This is the second half of the `overrides` rule and it is the half that separates a real edge from
 * a fabricated one, because Julia's nesting is where the method table stops.
 *
 * Inside a function body, `f(x) = …` binds a LOCAL variable holding a closure. It does not add a
 * method, and it displaces nothing: the next time the enclosing function runs, the same closure is
 * built again. The same holds for a `do` block, a `let`, and a `->` anonymous function's body. An
 * edge published there would say "this definition replaced an earlier one" about two bindings that
 * never met.
 *
 * MEASURED over the 971 admitted corpus files, and every member of the set fires — which is what
 * keeps this from being a dead predicate (honesty contract §2's L2 requires zero of those):
 *
 *   41  `let_statement`         29  `function_definition`    3  `macro_definition`    3  `do_clause`
 *
 * Two corpus shapes, both fabricated edges in an earlier revision of this lane that produced 14 of
 * the 63 `overrides` edges it published:
 *
 *   julia/JuliaLowering/src/desugaring.jl:153 and :324 — `wrap(asgn) = …` inside TWO DIFFERENT
 *     function bodies. The pre-pass keyed on (name, signature) alone, so the two closures collided
 *     and it published `_destructure -overrides-> wrap`, a replacement between two functions that
 *     have no relationship at all.
 *
 *   julia/base/range.jl:488 and :496 — `throwbool(r) = …` inside two different inner constructors
 *     of `OneTo`, same collision, published as `OneTo -overrides-> throwbool`.
 *
 * `compound_statement` is DELIBERATELY absent, and the measurement is why: it is the node for both
 * a function body AND a top-level `begin … end` inside a module, and the second is a legitimate
 * method-table position. Verified on both spellings —
 *
 *     module M; begin; f(x) = 1; f(x) = 2; end; end      ->  (module_definition (compound_statement …))
 *     module M; function g(); h(x) = 1; end; end         ->  (function_definition (compound_statement …))
 *
 * The function case is already covered by `function_definition` in this set, so listing
 * `compound_statement` would refuse the legitimate half to catch the case that is caught anyway.
 *
 * `comprehension_expression` and `generator` are absent because they hold 0 of the 417 redefinition
 * declarations in the corpus, not because they are irrelevant.
 */
const LOCAL_BINDING_SCOPE: ReadonlySet<string> = new Set([
  "function_definition", "macro_definition", "do_clause", "let_statement", "arrow_function_expression",
])

export class RealJuliaAnalyzer {
  /**
   * Call sites under an `@ccall`, recorded when the macro is visited and consulted when the
   * nested `call_expression` is emitted. Instance state rather than a local because the macro
   * case and the call case are different methods, and CLEARED at the top of every `analyze()` so
   * a reused instance cannot carry one file's C symbols into the next file's graph — which would
   * mark an unrelated call as foreign and is precisely the kind of cross-file bleed a shared
   * analyzer instance invites.
   */
  private foreignMarked = new Set<string>()

  /** Set while the walk is inside a `macro_definition`, whose body is QUOTED code. */
  private inMacroBody = false

  /**
   * `call_expression` nodes that are the LEFT-HAND SIDE of a short-form declaration, i.e.
   * `f(x) = …` rather than an invocation. Julia writes a function definition with the same node
   * type as a call, so without this the declaration reads as the function calling itself.
   * Cleared per `analyze()` for the same reason as `foreignMarked`.
   */
  private declSites = new Set<number>()

  /**
   * `type_head` nodes belonging to a type DECLARATION, so a type is not recorded as referencing
   * itself. Cleared per `analyze()` like the other per-file sets.
   */
  private typeHeadSites = new Set<number>()

  /**
   * Declaration nodes that REPLACE an earlier declaration of the same method, keyed by node id.
   *
   * COLLECTED IN A PRE-PASS for the same reason `declaredTypes` is: the question "has this exact
   * method already been defined in this file?" is only answerable once the whole file has been
   * seen, and answering it during a single walk would classify the FIRST declaration as the
   * override and leave the second — the one that actually replaces it — unrecorded.
   *
   * M60/julia `overrides`. The lane's file header declined this type on the grounds that julia has
   * multiple dispatch rather than overriding, and the argument is sound for the case it names: two
   * methods of the same name with DIFFERENT signatures are different methods, both live, and
   * neither replaces the other. It does not cover the case julia actually has. Julia's method table
   * holds exactly one entry per (name, signature) tuple, so a second declaration of the SAME pair
   * REPLACES the first — julia itself says so, printing `WARNING: Method definition f(Int) in
   * module Main at line 12 overwritten at line 40` under `--warn-overwrite=yes`. That is a
   * replacement, and it is the only sense in which the language has one, which is the same
   * criterion the bash lane's `overrides` ruling used to convict this very omission
   * (`script/m14/ontology-coverage-gate.ts` header, BD8b).
   *
   * MEASURED: filled in from `validation/m14/fixtures/julia/census.ts` over the admitted corpus —
   * see `docs/analyzers/real-julia-analyzer.md` for the counts and the probe that produces them.
   */
  private redefinedAt = new Map<number, { name: string; replacesLine: number; signature: string; scope: string }>()

  /**
   * The kind of every symbol this file declares, by name. Populated at each `symbols.push`, which is
   * the single point every declaration in this analyzer goes through, so the table cannot fall behind
   * the symbol list. Cleared per `analyze()` like the other per-file state.
   *
   * It exists for one question: does this file declare `owner` as a module or a type, and `target` as
   * a method? See `ownsAMethodTable`.
   */
  private declaredSymbolKinds = new Map<string, ASTEngine.SymbolKind>()

  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    this.inMacroBody = false
    this.foreignMarked.clear()
    this.declSites.clear()
    this.typeHeadSites.clear()
    this.redefinedAt.clear()
    this.declaredSymbolKinds.clear()
    const symbols: ASTEngine.UniversalSymbol[] = []
    /**
     * The ONE place a declaration enters the symbol list, so `declaredSymbolKinds` cannot fall
     * behind it. Eight separate `symbols.push` sites existed before this; a table maintained at all
     * but one of them is a table that is wrong, and wrong in the direction that makes `overrides`
     * look better than it is.
     */
    const pushSym = (s: ASTEngine.UniversalSymbol): void => {
      symbols.push(s)
      this.declaredSymbolKinds.set(s.name, s.kind)
    }
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: any[] = []
    const frameworks = new Set<string>()

    // The declared type names in THIS file, needed to decide whether a bare call is a
    // construction. Built during the walk and consulted afterwards, so a type declared later in
    // the file still counts.
    const declaredTypes = new Set<string>()

    // COLLECTED IN A PRE-PASS, not during the walk. The call case asks `declaredTypes.has(callee)`
    // to decide `instantiates` vs `calls`, and during a single walk that question is answered with
    // whatever has been seen SO FAR — so a construction that appears BEFORE its type declaration was
    // classified as a plain call.
    //
    // Found by the F5 `instantiates` oracle, which derives the truth from Julia's own construction
    // rule and shares nothing with this analyzer: `Compiler/test/EAUtils.jl` calls
    // `GetEscapeCache()` on line 52 and declares `struct GetEscapeCache end` on line 90, so the
    // oracle knew `GetEscapeCache` was a type and the analyzer did not. Same shape in
    // `stdlib/REPL/test/replcompletions.jl`, where the declaration is inside a `quote` and the call
    // is 59 lines earlier.
    //
    // The comment on `declaredTypes` already claimed the opposite — "consulted afterwards, so a type
    // declared later in the file still counts" — which is exactly why this survived review: the code
    // said one thing and the comment said another, and the comment was believed. A comment
    // describing a property the code does not have is worse than no comment, because it is an
    // answer to a question nobody thought to ask again.
    {
      const collect = (n: Node) => {
        if (TYPE_DECLARATIONS.has(n.type)) {
          const head = this.firstNamedChildOfType(n, "type_head")
          const name = head ? this.typeHeadName(head) : ""
          if (name) declaredTypes.add(name)
        }
        for (const c of this.namedChildren(n)) collect(c)
      }
      collect(rootNode)
    }

    // The `overrides` pre-pass: which declaration replaces an earlier one. See `redefinedAt` for
    // why this type exists and what julia's own rule is. The POSITION test is the part that makes
    // the edge true rather than merely plausible, and it is stated here because it is the whole
    // difference between a real replacement and a fabricated one:
    //
    //   `if Sys.iswindows(); pathsep() = '\\'; else; pathsep() = '/'; end` declares the same
    //   (name, signature) pair twice in one file and OVERRIDES nothing — exactly one branch runs,
    //   and the other method is never defined. Counting it would be the fabrication the ontology
    //   workstream's own rule exists to prevent, and it would be counted as many as the corpus has
    //   such branches, which is a lot: `if VERSION >= v"1.9"` guards are idiomatic julia.
    //
    // So a declaration is admitted only when NOTHING about its position makes its execution
    // conditional or its text generated. An unconditional declaration directly in a module body or a
    // struct body runs whenever the file is loaded, and a second one with the same signature
    // therefore replaces it. Everything else is refused and the refusal is counted, not hidden — the
    // census prints the admitted and the refused counts side by side.
    //
    // The pre-pass carries its OWN SCOPE, and it carries it for the reason `desugaring.jl` needs it:
    // the key is `scope|name|signature`, not `name|signature`. Keyed on the name alone, `wrap(asgn)`
    // at `desugaring.jl:153` (inside `tuple_to_assignments`) and the same short form at `:324`
    // (inside a different function) are one method as far as the map is concerned, and the lane
    // published a replacement between two closures that have no relationship. The scope in the key is
    // the module or type that owns the method table — the walk's own `activeScope` is not consulted
    // because at pre-pass time it does not exist yet, and a frame-walking pre-pass that recomputes it
    // could disagree with the walk's.
    //
    // `localDepth` is the same idea for the local-binding half: a declaration under a function body,
    // a `do`, a `let` or a `->` binds a closure and never enters the method table (see
    // `LOCAL_BINDING_SCOPE` for the corpus shapes this removed), so it is not even offered to the map.
    {
      const firstDecl = new Map<string, { line: number; safe: boolean }>()
      const scan = (n: Node, scope: string, scopeAt: number, localDepth: number) => {
        let childScope = scope
        let childScopeAt = scopeAt
        let childLocal = localDepth
        if (TYPE_DECLARATIONS.has(n.type)) {
          const head = this.firstNamedChildOfType(n, "type_head")
          const name = head ? this.typeHeadName(head) : ""
          if (name) { childScope = name; childScopeAt = n.startPosition.row + 1 }
        } else if (n.type === "module_definition") {
          const nameNode = n.childForFieldName("name")
          const name = nameNode ? nameNode.text.trim() : ""
          if (name) { childScope = name; childScopeAt = n.startPosition.row + 1 }
        }
        // A function body advances the WALK's scope but not the method table's owner, so the
        // pre-pass keeps `childScope` and only marks the subtree local.
        if (LOCAL_BINDING_SCOPE.has(n.type)) childLocal = localDepth + 1
        const site = this.declarationSiteOf(n)
        if (site && site.name && site.signature && localDepth === 0) {
          // The scope goes into the key as `name@line`, and the LINE is load-bearing: two modules in
          // one file can share a name and are still two modules with two method tables. Measured shape
          // — `julia/test/deprecation_exec.jl` declares `module Src` twice, at line 325 inside
          // `DeprecatedReexportTest` and at line 358 inside `DeprecatedShadowTest`, and each holds a
          // `newg() = 1` at lines 329 and 364. Keyed on the name alone those are one method and the
          // second reads as replacing the first; they share nothing. Keying on the name alone would
          // leave 1 fabricated edge in a 4-edge set, which is a quarter of the type wrong.
          const key = `${childScope}@${childScopeAt}|${site.name}|${site.signature}`
          const prior = firstDecl.get(key)
          const safe = this.isUnconditionalPosition(n)
          if (prior && prior.safe && safe) {
            this.redefinedAt.set(n.id, { name: site.name, replacesLine: prior.line, signature: site.signature, scope: childScope })
          }
          if (!prior) firstDecl.set(key, { line: n.startPosition.row + 1, safe })
        }
        // `childScopeAt` is passed down, and omitting it is a defect this lane shipped for one
        // measurement round: the scope NAME propagated while its LINE reset to 0 at every frame, so
        // every scope key came out `name@0` and the two same-named `module Src` blocks in
        // `julia/test/deprecation_exec.jl` collided exactly as they would have with no line at all.
        // The fix is invisible in a fixture — `Registry` appears once — so the corpus is what found
        // it and a fixture cannot be the only gate.
        for (const c of this.namedChildren(n)) scan(c, childScope, childScopeAt, childLocal)
      }
      scan(rootNode, "", 0, 0)
    }

    let activeScope = ""
    let depth = 0

    const walkStack: { node: Node; activeScope: string; inMacroBody: boolean; isExit: boolean }[] = [{ node: rootNode, activeScope: "", inMacroBody: false, isExit: false }]

    while (walkStack.length > 0) {
      const frame = walkStack.pop()!
      const node = frame.node
      if (frame.isExit) {
        depth--
        // RESTORE the scope this node was entered with. The frame already carries it and the
        // comment below claimed this was what the frame was for, but the handler only counted
        // depth, so `activeScope` was a value that DRIFTED FORWARD for the whole file: the last
        // declaration to advance it owned every later sibling.
        //
        // It took the product path to see it. On a module-less unit sample every function was
        // declared, so each one re-advanced the scope and the leak was invisible. Through
        // `ASTEngine.parseFile` on a file whose last function is `describe(s::Shape)::String = …`
        // — which this analyzer did not recognise as a declaration at all — the body of
        // `describe` was attributed to `Area`, the PREVIOUS function:
        //
        //     Area -calls-> describe@17
        //     Area -calls-> string@17        <- actually describe's body
        //     Area -calls-> typeof@17
        //
        // So one unrecognized declaration did not merely lose itself, it reassigned the ownership
        // of everything after it. Frames are pushed exit-first with children reversed, so children
        // always pop before their parent's exit frame and restoring here is well-ordered.
        activeScope = frame.activeScope
        this.inMacroBody = frame.inMacroBody
        continue
      }
      const scope = frame.activeScope

      switch (node.type) {
        // ---------------------------------------------------------------- modules
        case "module_definition": {
          // `module` and `baremodule` are the same node with a different first token. The `name`
          // field is the ONLY field in this grammar's module rule, so it is read by field and
          // everything else in the file is positional.
          const nameNode = node.childForFieldName("name")
          const name = nameNode ? nameNode.text.trim() : ""
          if (name) {
            pushSym({
              name,
              kind: ASTEngine.SymbolKind.Module,
              range: this.range(node),
            complexity: this.complexity(node),
              ownerName: scope || undefined,
              metadata: { juliaSpecific: true, isBareModule: this.firstNamedChildType(node) === "baremodule" },
            })
            if (scope) relationships.push(this.rel(scope, ASTEngine.RelationshipType.Contains, name, node, 1.0))
            activeScope = name
          }
          break
        }

        // ---------------------------------------------------------------- type declarations
        case "abstract_definition":
        case "primitive_definition":
        case "struct_definition": {
          const nameNode = this.firstNamedChildOfType(node, "type_head")
          const name = nameNode ? this.typeHeadName(nameNode) : ""
          if (!name) break
          const kind = node.type === "struct_definition"
            ? ASTEngine.SymbolKind.Class
            : ASTEngine.SymbolKind.Interface
          pushSym({
            name,
            kind,
            range: this.range(node),
            complexity: this.complexity(node),
            ownerName: scope || undefined,
            metadata: { juliaSpecific: true, declarationForm: node.type, isMutable: this.hasToken(node, "mutable") },
          })
          declaredTypes.add(name)
          if (scope) relationships.push(this.rel(scope, ASTEngine.RelationshipType.Contains, name, node, 1.0))

          // A type's OWN HEAD is not a reference. `struct Circle{T<:Real} <: Shape` names Circle in
          // its own type head, and the `parametrized_type_expression` case below reads that as a
          // reference — so every struct published a reference to ITSELF (`Shapes -references->
          // Circle@6`), which is a declaration stating itself. Recorded so the reference cases can
          // tell a type head from a type USE; `Vector{T}` in an annotation is still a real one.
          if (nameNode) this.typeHeadSites.add(nameNode.id)

          // A type's BODY belongs to the type, not to the enclosing module: `radius::T` inside
          // `struct Circle{T<:Real}` is a fact about Circle, including the bound on Circle's own
          // type parameter. Without advancing the scope, `Shapes -references-> T` attributed a
          // type parameter to the module that has no such parameter.
          activeScope = name

          // The SUBTYPE edge, and it is the only inheritance Julia has. `struct S <: A` puts a
          // `where`-less `binary_expression` (or a `comparison_operator` chain) between the type
          // head and the supertypes; `abstract type` uses the same shape.
          for (const sup of this.supertypesOf(node)) {
            relationships.push(this.rel(name, ASTEngine.RelationshipType.Extends, sup, node, 1.0, { juliaSpecific: true, isSubtype: true }))
          }

          // A struct's fields. `struct S; x::T; end` puts bare `x::T` in the body, which is a
          // `field_definition`-shaped position; the grammar has no dedicated node, so a
          // `typed_expression` directly inside the struct body is a field.
          for (const field of this.structFields(node)) {
            pushSym({
              name: field.name,
              kind: ASTEngine.SymbolKind.Property,
              range: this.range(field.node),
              complexity: this.complexity(field.node),
              ownerName: name,
              metadata: { juliaSpecific: true, isStructField: true },
            })
            relationships.push(this.rel(name, ASTEngine.RelationshipType.Contains, field.name, field.node, 1.0))
          }
          break
        }

        // ---------------------------------------------------------------- functions
        case "function_definition":
        case "macro_definition": {
          const sig = this.firstNamedChildOfType(node, "signature")
          const name = sig ? this.signatureName(sig) : ""
          if (!name) break
          // Same distinction as the short form, on the signature: `function bump!(c, by)` puts the
          // function's own name and parameters in a `call_expression`, and walking into it emitted
          // `bump! -calls-> bump!`. Only the SHORT form's declaration site was recorded, so the long
          // form kept self-calling; the fixture lane is what found the asymmetry.
          if (sig) {
            let callable: Node | null = this.pos(sig, 0)
            for (let i = 0; i < 4 && callable && callable.type !== "call_expression"; i++) {
              callable = this.pos(callable, 0)
            }
            if (callable && callable.type === "call_expression") {
              this.declSites.add(callable.id)
              // The function's OWN NAME inside its signature is not a reference to itself. For a
              // GENERIC method the name is a `parametrized_type_expression` — `scaled{T<:Real}` — so
              // the reference case fired and `function scaled{T<:Real}(...)` published
              // `references scaled->scaled`. The type HEAD guard covers type declarations; the same
              // guard is applied here, keyed on the callable, so the signature's PARAMETER types
              // (`s::Shape`, `k::T`) still register as the references they are.
              //
              // Found by dumping the fixture's own output to check a mutant, not by the mutant: it
              // asserts the absence of a fabricated edge, and a bare `forbidSymbols` would not have
              // seen a relationship. A self-reference is a weak signal to forbid and an obvious one
              // to look at, which is the argument for reading the output even when it is green.
              this.typeHeadSites.add(callable.id)
            }
          }
          const isMacro = node.type === "macro_definition"
          // Remember whether the scope we are about to advance came from a macro, and restore it on
          // the way out. `activeScope` is restored by the exit frame; this flag rides alongside it.
          const wasInMacro = this.inMacroBody
          if (isMacro) this.inMacroBody = true
          pushSym({
            name,
            kind: isMacro ? ASTEngine.SymbolKind.Macro : ASTEngine.SymbolKind.Function,
            range: this.range(node),
            complexity: this.complexity(node),
            ownerName: scope || undefined,
            metadata: { juliaSpecific: true, isMacro, hasBlockBody: !!this.firstNamedChildOfType(node, "compound_statement") },
          })
          if (scope) relationships.push(this.rel(scope, ASTEngine.RelationshipType.Contains, name, node, 1.0))
          activeScope = name
          // BD8b: a declaration that REPLACES an earlier one with the same (name, signature) — the
          // only sense in which julia has an override. See `overrideEdgeFor` for the edge shape and
          // for why it is refused outside a declared scope.
          const ovr = this.overrideEdgeFor(node, scope)
          if (ovr) relationships.push(ovr)
          break
        }

        // ---------------------------------------------------------------- SHORT-FORM function definition
        //
        // `f(x) = expr` and `A.B(x) = expr` are NOT `function_definition` nodes. The grammar
        // gives `(assignment (call_expression (identifier) (argument_list …)) (operator) rhs)`, so
        // Julia's single most common way of writing a function has no node of its own. Handling
        // only `function … end` found 4 functions in a sample where the file has 7, and — worse —
        // attributed every call INSIDE a short-form body to the enclosing module, because the scope
        // never advanced. Julia's own stdlib writes this way far more often than the long form.
        case "assignment": {
          // `f(x) where {T} = …` wraps the call in a `where_expression`; unwrap before demanding
          // a `call_expression`, or every `where`-form declaration is silently skipped.
          let lhs = this.unwrapWhere(this.pos(node, 0) ?? node)
          // `describe(s::Shape)::String = …` puts the RETURN TYPE on the left, so the assignment's
          // first child is a `typed_expression`, not a `call_expression` — and the declaration was
          // invisible. Measured through the product path: a file declaring `Area` twice and
          // `describe` once published TWO functions, not three, and `describe`'s body was
          // misattributed (see the exit-frame note). `x::Int = 5` is ALSO a `typed_expression`, so
          // the wrapper is unwrapped only when what it wraps is a CALL — that is exactly what
          // separates a function declaration with a return type from a typed variable.
          if (lhs.type === "typed_expression") {
            const inner = this.pos(lhs, 0)
            if (inner && inner.type === "call_expression") lhs = inner
          }
          if (lhs.type !== "call_expression") break
          const name = this.calleeName(lhs)
          if (!name || IMPLICIT_OR_CONSTANT.has(name)) break
          pushSym({
            name,
            kind: ASTEngine.SymbolKind.Function,
            range: this.range(node),
            complexity: this.complexity(node),
            ownerName: scope || undefined,
            metadata: { juliaSpecific: true, declarationForm: "short_form_assignment", hasBlockBody: false },
          })
          // The DECLARATION's own left-hand side is the same `call_expression` node the call case
          // looks for, so walking into it emitted `Area -calls-> Area` — the function calling
          // itself, once per declaration. Julia has no such thing: `f(x) = …` DEFINES f, it does
          // not invoke it. The node is recorded so the call case can tell a declaration site from
          // an invocation, which is a distinction the tree does not make on its own.
          this.declSites.add(lhs.id)
          if (scope) relationships.push(this.rel(scope, ASTEngine.RelationshipType.Contains, name, node, 1.0))
          // The short form is the form the corpus prefers, so the `overrides` pre-pass admits it
          // too: measuring only `function … end` would have missed every `f(x) = …` redefinition,
          // which is most of them. Same edge, same refusal rules — see `overrideEdgeFor`.
          const ovr = this.overrideEdgeFor(node, scope)
          if (ovr) relationships.push(ovr)
          // Parameters are deliberately NOT published as symbols. That is this repo's standing
          // negative contract — `SymbolKind` has no Parameter member at all, and swift/kotlin/
          // csharp all removed theirs under the C# M12.07 ParamsAreNotSymbols /
          // LocalsAreNotSymbols rules. A parameter is a binding, not a declaration, and promoting
          // one to a symbol puts `c` in the graph beside every real declaration in the file. The
          // first version did publish them, produced two symbols of kind `undefined` because the
          // enum member does not exist, and the compiler said so — which is the vocabulary check
          // working, and a reminder that this grammar's 7-field vocabulary is the thing to read.
          // Parameters are still READS (the `uses` pass binds them), which is the fact that matters.
          activeScope = name
          break
        }

        // ---------------------------------------------------------------- const / global / local
        case "const_statement":
        case "global_statement":
        case "local_statement": {
          // `const global x = 1` is one node (see grammar P3); the bound name is the
          // assignment's left-hand side, which is the only place a Julia binding is introduced.
          const assign = this.firstNamedChildOfType(node, "assignment")
          if (!assign) break
          // `assignment` is POSITIONAL: child 0 is the left-hand side, child 1 the operator,
          // child 2 the value. For a short-form function definition the LHS is a `call_expression`,
          // which is a DEFINITION and not a binding — handled by its own case below.
          const lhs = this.pos(assign, 0)
          if (!lhs || lhs.type === "call_expression") break
          // `global x45350::Int = 1` puts a `typed_expression` on the left, so `lhs.text` is the
          // WHOLE left-hand side and the binding published as a symbol named `x45350::Int` — the
          // annotation welded into the name, so nothing could resolve to it. Found by the F5
          // `contains` oracle, which derives `Foo45350 contains x45350` from Julia's containment
          // rule and the analyzer had no edge for it to match. The NAME is the typed expression's
          // first child; its second is the type, which is a reference and not part of the name.
          const nameNode = lhs.type === "typed_expression" ? this.pos(lhs, 0) ?? lhs : lhs
          const name = nameNode.text.trim()
          if (!name || IMPLICIT_OR_CONSTANT.has(name)) break
          // A binding inside a macro's body is part of QUOTED code that expands at the CALL SITE,
          // so it is not a declaration OF the macro. `macro cached(expr) quote local v = …; v end`
          // published `cached contains v`, asserting the macro declares `v` — when `v` is a
          // temporary in generated code and `esc` deliberately reaches the caller's scope instead.
          //
          // Found by the F5 `contains` ORACLE, which derives truth from Julia's own containment rule
          // and shares nothing with this analyzer: it derived 8 of 8 edges for a fixture and its one
          // disagreement was this edge. That is the disagreement an independent instrument is FOR —
          // the fixtures asserted `cached` as a macro and never looked at what it appeared to
          // contain. A `local` in generated code is not a member of anything.
          if (this.inMacroBody && node.type !== "const_statement") break
          pushSym({
            name,
            kind: node.type === "const_statement" ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable,
            range: this.range(node),
            complexity: this.complexity(node),
            ownerName: scope || undefined,
            metadata: { juliaSpecific: true, binding: node.type.replace("_statement", "") },
          })
          if (scope) relationships.push(this.rel(scope, ASTEngine.RelationshipType.Contains, name, node, 1.0))
          break
        }

        // ---------------------------------------------------------------- imports
        case "import_statement":
        case "using_statement": {
          for (const t of this.importTargets(node)) {
            imports.push({
              module: t.name,
              items: t.items,
              importType: node.type === "import_statement" ? "import" : "using",
              lineNumber: node.startPosition.row + 1,
              isExternal: !t.name.startsWith("."),
            })
            relationships.push(this.rel("root", ASTEngine.RelationshipType.References, t.name, node, 1.0, { juliaSpecific: true, isImport: true, importForm: node.type }))
          }
          break
        }

        case "export_statement":
        case "public_statement": {
          for (const child of this.namedChildren(node)) {
            const name = this.exportableName(child)
            if (!name) continue
            // `ExportInfo.kind` is a SymbolKind, not a string — `type` is a free-text field and
            // `kind` is the typed one, and the two are not interchangeable.
            exports.push({
              name,
              // The kind is deliberately NOT asserted. `export X` exports a BINDING whose kind
              // depends on what X turns out to be — a struct in one file, a function in another —
              // and Julia allows the export to precede the declaration. The first version pushed a
              // `SymbolKind.Function` for every `export`, which produced a SECOND `Circle` beside
              // the real `class:Circle`, and the dedup did not merge them because its key is
              // `kind:owner:name` and the kinds differed. So `export` records an export and marks
              // nothing: the declaration is the declaration.
              type: node.type === "export_statement" ? "value" : "type",
              lineNumber: node.startPosition.row + 1,
              metadata: { juliaSpecific: true, exportForm: node.type, declaresNothing: true },
            })
            // If the binding is already declared in this file, record the export ON it.
            for (const sym of symbols) {
              if (sym.name !== name) continue
              sym.metadata = { ...(sym.metadata ?? {}), isExported: true, exportForm: node.type }
            }
          }
          break
        }

        // ---------------------------------------------------------------- two call shapes with no `call_expression`
        //
        // Both were INVISIBLE: the walk recursed into them, found nothing to declare, and returned no
        // edge, so a real invocation in Julia's two most idiomatic forms simply did not appear in the
        // graph. Found by classifying every node type the analyzer names against every node type the
        // grammar produces — 53 produced types the analyzer never mentions, and these two are calls.
        //
        // MEASURED on the corpus: `adjoint_expression` occurs in 22 files and
        // `broadcast_call_expression` in 74.
        case "adjoint_expression": {
          // `A'` is Julia's ADJOINT operator, i.e. a call to `adjoint`. The operand is a nested
          // `parenthesized_expression`/identifier and is NOT a call, so the only fact here is the
          // adjoint itself. `adjoint(x)` written long is an ordinary call and already published, so
          // this is the same fact in the short spelling rather than a new kind of edge.
          if (this.namedChildren(node).length === 1) {
            relationships.push(this.rel(scope || GLOBAL_SCOPE, ASTEngine.RelationshipType.Calls, "adjoint", node, 1.0,
              { juliaSpecific: true, isOperatorApplication: true, spelling: "postfix_prime" }))
          }
          break
        }

        case "broadcast_call_expression": {
          // `sqrt.(v)` is a BROADCAST call: the same invocation as `sqrt(v)`, fused across a
          // collection. It has exactly a callee and an `argument_list`, so the callee resolves the
          // same way, and it is a call to the same name — published as `calls`, not a new relation,
          // because a consumer asking who calls `sqrt` should not have to know about broadcasting.
          const callee = this.calleeName(node)
          if (callee && !IMPLICIT_OR_CONSTANT.has(callee)) {
            relationships.push(this.rel(scope || GLOBAL_SCOPE, ASTEngine.RelationshipType.Calls, callee, node, 1.0,
              { juliaSpecific: true, isBroadcastCall: true }))
          }
          break
        }

        // ---------------------------------------------------------------- calls and construction
        case "call_expression": {
          if (this.declSites.has(node.id)) break
          const callee = this.calleeName(node)
          if (!callee || IMPLICIT_OR_CONSTANT.has(callee)) break
          const isCtor = declaredTypes.has(callee) || TYPE_DECLARATIONS.has(callee)
          // The FUNCTION form of ccall: `ccall(:jl_getpid, Cint, ())` or
          // `ccall((:malloc, :libc), Ptr{Cvoid}, …)`. The callee here really is the Julia function
          // `ccall`, so that edge is emitted normally; the C symbol lives in the FIRST ARGUMENT, as
          // a `quote_expression` or a `tuple_expression` of them. Recorded with its library when
          // the two-tuple form supplies one, because `(:malloc, :libc)` says which library the
          // symbol comes from and discarding that loses a fact the source states.
          const foreign = callee === "ccall" ? this.ccallTarget(node) : null
          const meta: any = isCtor
            ? { juliaSpecific: true, isTypeConstruction: true }
            : foreign
              ? { juliaSpecific: true, isForeignCall: true, foreignSymbol: foreign.symbol, foreignLibrary: foreign.library, via: "ccall" }
              : this.foreignMarked.has(this.textKey(node, callee))
                ? { juliaSpecific: true, isForeignCall: true, via: "@ccall" }
                : { juliaSpecific: true }
          {
            relationships.push(this.rel(
              scope || GLOBAL_SCOPE,
              isCtor ? ASTEngine.RelationshipType.Instantiates : ASTEngine.RelationshipType.Calls,
              callee,
              node,
              isCtor ? 0.9 : 1.0,
              meta,
            ))
          }
          // The C symbol gets its OWN edge rather than only a field on the `ccall` edge.
          //
          // Relationships dedup on `type|source->target` (Law 3), so two `ccall` invocations in one
          // scope are the SAME edge and the second was dropped whole — taking `foreignSymbol` and
          // `foreignLibrary` with it. Measured: `ccall(:jl_getpid, …)` and `ccall((:malloc, :libc), …)`
          // in one file produced ONE edge carrying only the first call's symbol, and the fact that
          // the source says `:libc` was simply gone. An edge to the C symbol is a distinct
          // (source, target) pair per symbol, so it survives dedup and keeps its library, and it
          // matches how `@ccall` already reports its target. The two spellings of one operation now
          // agree, which they did not before.
          if (foreign) {
            relationships.push(this.rel(
              scope || GLOBAL_SCOPE,
              ASTEngine.RelationshipType.Calls,
              foreign.symbol,
              node,
              1.0,
              {
                juliaSpecific: true,
                isForeignCall: true,
                foreignSymbol: foreign.symbol,
                foreignLibrary: foreign.library,
                via: "ccall",
              },
            ))
          }
          break
        }

        // ---------------------------------------------------------------- macro calls
        case "macrocall_expression": {
          const nameNode = this.firstNamedChildOfType(node, "macro_identifier")
          const name = nameNode ? stripSigil(nameNode.text, "@") : ""

          // `@ccall strlen(s::Ptr{UInt8})::Csize_t` names a C SYMBOL, not a Julia binding. Its
          // callee is a plain `call_expression` in the tree, so the walk reaches the ordinary call
          // case and emitted `calls -> strlen` — asserting a Julia call to a binding that does not
          // exist in Julia's namespace. The call is real; the claim that its target is a JULIA
          // FUNCTION is not. The C targets are collected here and marked at the emit site, which
          // keeps the edge (the code does call strlen) while refusing to pretend otherwise. The
          // function form `ccall((:malloc, :libc), …)` states the same fact in a `quote_expression`
          // argument and was recording NOTHING, so the two spellings of one operation disagreed;
          // that form is handled in the call case below, library included.
          if (name === "ccall") this.markForeignCallees(node)
          if (!name) break
          relationships.push(this.rel(scope || GLOBAL_SCOPE, ASTEngine.RelationshipType.Calls, name, node, 1.0, { juliaSpecific: true, isMacroCall: true }))
          break
        }

        // ---------------------------------------------------------------- type annotations
        case "typed_expression": {
          // `x::Int` — POSITIONAL: child 0 is the name, child 1 the type. The TYPE is the
          // reference; the left side is a binding or a read, and a struct body's bare `x::T` was
          // already published as a field above and must not also become a read here.
          const typeNode = this.pos(node, 1)
          const typeName = typeNode ? this.typeHeadName(typeNode) : ""
          if (typeName) relationships.push(this.rel(scope || GLOBAL_SCOPE, ASTEngine.RelationshipType.References, typeName, node, 1.0, { juliaSpecific: true, isTypeReference: true }))
          break
        }

        case "parametrized_type_expression": {
          // A type parameter's BOUND is a subtype edge from the parameter, and the two ways of
          // writing one hide in different places. `f(x) where {T<:Real}` puts it in a curly inside a
          // `where_expression`; `f{T<:Real}(x)` puts it in a curly here, with NO where_expression at
          // all — so the where_expression case never saw it and the common spelling of a bounded
          // generic published no bound. Found by a mutant that survived because the fixture's own
          // bound was invisible to both the analyzer and the assertion.
          for (const inner of this.namedChildren(node)) {
            if (inner.type !== "curly_expression") continue
            for (const b of this.namedChildren(inner)) {
              if (b.type !== "binary_expression") continue
              const bo = this.binOperands(b)
              if (bo.op !== "<:" && bo.op !== ">:") continue
              const bound = bo.right ? this.typeHeadName(bo.right) : ""
              if (bound && bo.left) {
                relationships.push(this.rel(bo.left.text.trim(), ASTEngine.RelationshipType.Extends, bound, b, 1.0,
                  { juliaSpecific: true, isSubtype: true, isWhereBound: true }))
              }
            }
          }
          // `Vector{T}` — the base type is a reference and T is a parameter, not a read.
          if (this.withinTypeHead(node)) break
          // The base goes through `fieldPath`, not an identifier lookup: a QUALIFIED base
          // (`Iterators.Filter{T}`) is a `field_expression`, so there is NO identifier child and the
          // lookup returned null — no edge at all for any parameterised type in a namespace.
          // `Iterators.Zip`, `Iterators.ProductIterator`, `Base.HasShape`, `Core.LLVMPtr` and
          // `Dates.DatePart` were all missing for exactly that reason.
          //
          // THIRD site that read a dotted name by a rule of its own, after `typeHeadName` and the
          // field-read member. All three now go through the one resolver, and that is the only reason
          // the fourth cannot still be waiting for a corpus that happens to exercise it.
          const baseNode = this.pos(node, 0)
          const base = baseNode ? this.fieldPath(baseNode) : ""
          // `scope` IS this edge's source, so unlike the `where`-bound case it belongs in the guard —
          // with the file-scope fallback, or the reference vanishes in a module-less file.
          if (base) relationships.push(this.rel(scope || GLOBAL_SCOPE, ASTEngine.RelationshipType.References, base, node, 1.0, { juliaSpecific: true, isTypeReference: true }))
          break
        }

        case "where_expression": {
          // `f(x::T) where {T<:Real}` — an upper bound inside is a subtype fact, and a
          // constraint name is a binding rather than a read.
          //
          // DESCEND, because the two spellings differ in shape: bare `where T<:Real` puts the
          // binary_expression directly among this node's children, while braced `where {T<:Real}`
          // puts it inside a `curly_expression`. Looking only at direct children found the unbraced
          // form and silently missed the braced one, which is the form people actually write — so
          // `function scaled{T<:Real}(s::Shape, k::T)::Float64` published no `T extends Real` at
          // all. Found by the mutant `julia/where-bound-extends-scope-guarded`, which survived
          // because the fixture's own `where` bound was invisible to BOTH sides: a fixture and an
          // analyzer can agree on nothing and still both be wrong.
          for (const child of this.namedChildren(node)) {
            if (child.type === "curly_expression") {
              for (const inner of this.namedChildren(child)) {
                if (inner.type !== "binary_expression") continue
                const r2 = this.binOperands(inner)
                if (r2.op !== "<:" && r2.op !== ">:") continue
                const b = r2.right ? this.typeHeadName(r2.right) : ""
                if (b && r2.left) {
                  relationships.push(this.rel(r2.left.text.trim(), ASTEngine.RelationshipType.Extends, b, inner, 1.0, { juliaSpecific: true, isSubtype: true, isWhereBound: true }))
                }
              }
              continue
            }
            if (child.type !== "binary_expression") continue
            const { op, left, right } = this.binOperands(child)
            // `>` is not a bound operator; `>:` is. The test said `">"`, so an UPPER bound written
            // `T>:Int` was skipped — a real Julia form, and the oracle derives it.
            if (op !== "<:" && op !== ">:") continue
            const sub = right ? this.typeHeadName(right) : ""
            // NO `scope` guard here, and its absence was a defect: this edge's SOURCE is `left` —
            // the type parameter — not the enclosing scope. The guard was copy-pasted from the
            // `contains` cases, where the scope IS the source and the check is the point. So it
            // suppressed a valid edge whenever the bound appeared at FILE SCOPE, which is 71.9% of
            // Julia files. Found by the F5 `extends` oracle: `base/rational.jl` publishes
            // `T extends AbstractFloat` and `base/hashing.jl` `UTF8Units extends AbstractString`,
            // both at file scope, and the analyzer had neither.
            if (sub && left) {
              relationships.push(this.rel(left.text.trim(), ASTEngine.RelationshipType.Extends, sub, child, 1.0, { juliaSpecific: true, isSubtype: true, isWhereBound: true }))
            }
          }
          break
        }

        // ---------------------------------------------------------------- field access
        case "field_expression": {
          // One of the SEVEN node types in this grammar that actually has a field, so
          // `childForFieldName` is correct here and positional access would be wrong.
          //
          // But `field_expression` is ALSO this grammar's dotted path — `Core.Intrinsics.bitcast`
          // is `field_expression(field_expression(Core, Intrinsics), bitcast)` — and Julia spells
          // namespace access and field access identically, so the node alone cannot say which.
          //
          // The rule used here is syntactic and stated rather than guessed: a NESTED
          // `field_expression` is a qualified reference, so only the OUTERMOST link of the chain
          // emits, and it emits the WHOLE path. Emitting a bare `uses -> bitcast` for the member
          // of `Core.Intrinsics.bitcast` would rebuild by the back door the exact ambiguity
          // `fieldPath` was written to remove — and it would sit there beside the correct
          // `calls -> Core.Intrinsics.bitcast`, looking like an independent read of a variable
          // named `bitcast` that does not exist. A single-level `obj.field` still emits
          // `uses -> field`, which is the ordinary case and the one that is right.
          if (node.parent?.type === "field_expression") break
          const value = node.childForFieldName("value")
          if (!value) break
          if (value.type === "field_expression") {
            const path = this.fieldPath(node)
            if (path) {
              relationships.push(this.rel(scope || GLOBAL_SCOPE, ASTEngine.RelationshipType.References, path, node, 0.95,
                { juliaSpecific: true, isQualifiedReference: true }))
            }
            break
          }
          // The MEMBER is the child that is NOT the receiver. `field_expression` has exactly one
          // field, `value`, which is the RECEIVER — so `a.b` is (identifier a)(identifier b) and the
          // member is the identifier that is not `value`.
          //
          // The first version took the FIRST identifier, which is the RECEIVER, so `c.radius`
          // published `uses -> c` — naming the object instead of the thing read off it, for every
          // field access in the language. Found by the F5 `uses` oracle: on 40 corpus files it
          // derived `uses -> AbstractInterpreter` for `<: Compiler.AbstractInterpreter` and the
          // analyzer had `uses -> Compiler`, with 681 of 732 truth rows unmatched and 268 the other
          // way. The defect inverted the edge rather than dropping it, which is why no count on its
          // own would have shown it — every field read produced a plausible `uses` row.
          // A member can be an OPERATOR NAME, quoted: `x.:(==)`, `s.:<`. The member is then a
          // `quote_expression`, not an `identifier`, so the identifier lookup found nothing and the
          // read vanished. The name is the quoted symbol's text, without the `:( )` wrapper, so
          // `x.:(==)` reads the member `==` rather than the five characters `: ( = )`.
          const member = this.namedChildren(node).find((c) => c.type === "identifier" && c.id !== value.id)
            ?? this.namedChildren(node).find((c) => c.type === "identifier" && c.id !== value.id)
            ?? this.namedChildren(node).find((c) => c.id !== value.id && (c.type === "quote_expression" || c.type === "operator"))
          if (!member) break
          const memberName = member.type === "quote_expression"
            ? (this.pos(member, 0)?.text.trim() ?? unquoteOperatorMember(member.text))
            : member.text.trim()
          if (!memberName) break
          relationships.push(this.rel(scope || GLOBAL_SCOPE, ASTEngine.RelationshipType.Uses, memberName, node, 0.9,
            { juliaSpecific: true, isFieldRead: true, isOperatorMember: member.type !== "identifier" }))
          break
        }
      }

      // Recurse with the (possibly advanced) scope, and push an exit frame so `depth` tracks
      // nesting. The scope is advanced for the CHILDREN of the node that advanced it, which is
      // what makes `contains` ownership correct for a module or a function body.
      walkStack.push({ node, activeScope: scope, inMacroBody: this.inMacroBody, isExit: true })
      const childScope = activeScope
      depth++
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const c = node.namedChild(i)
        if (c) walkStack.push({ node: c, activeScope: childScope, inMacroBody: this.inMacroBody, isExit: false })
      }
    }

    // ---------------------------------------------------------------- dedup
    // Law 3: O(1) map deduplication. Symbols key on `kind:owner:name`; relationships key on
    // `type|source->target` so that a `calls` and an `instantiates` for the same pair are two
    // different facts and never collapse into one row.
    const symbolMap = new Map<string, ASTEngine.UniversalSymbol>()
    for (const s of symbols) symbolMap.set(`${s.kind}:${s.ownerName || ""}:${s.name}`, s)
    const uniqueSymbols = [...symbolMap.values()]

    const relMap = new Map<string, ASTEngine.UniversalRelationship>()
    for (const r of relationships) {
      const key = `${r.type}|${r.source}->${r.target}`
      const prev = relMap.get(key)
      if (prev) {
        // A merged duplicate must not lose the line the other copy carried.
        if ((prev as any).line_number === undefined && (r as any).line_number !== undefined) (prev as any).line_number = (r as any).line_number
      } else relMap.set(key, r)
    }
    const uniqueRelationships = [...relMap.values()]

    this.classifyEvidenceTier(uniqueRelationships)
    // There is deliberately NO loop here computing complexity per symbol. The previous version was
    // `if (s.complexity === undefined) s.complexity = this.complexity(rootNode)` — a FULL TREE WALK
    // ONCE PER SYMBOL, and it was also wrong about WHICH complexity it measured: every symbol
    // received the FILE's cyclomatic complexity rather than its own.
    //
    // Measured on `test/core.jl` (259 KB, 66,915 named nodes): the walk took 202 s, while one whole
    // `complexity()` pass costs 102 ms and the file has 1,827 symbols — 1,827 x 102 ms is the 186 s
    // that went missing, to within the error of the estimate. Bare traversal of the same tree is
    // 165 ms, so the tree was never the problem. Across the 941-file corpus the analyzer took 969 s
    // at 1.0 file/s, with this one file alone at 228 s — a file like that stalls an index run.
    //
    // Complexity is now measured at each `symbols.push` from that symbol's OWN node, which is both
    // the O(n) behaviour and the meaning the managed-OO family uses (`csharp` M12.07 contract,
    // `calculateCyclomaticComplexity(node)` at the declaration site).

    return {
      language: "julia",
      symbols: uniqueSymbols,
      relationships: uniqueRelationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: uniqueSymbols.length,
        linesOfCode: content.split("\n").length,
        declaredTypes: [...declaredTypes],
      },
    }
  }

  // ------------------------------------------------------------------ helpers

  /**
   * The declaration this node carries, as the pair julia's method table keys on: a NAME and a
   * SIGNATURE. Returns null for a node that declares no method.
   *
   * The signature is the WHOLE argument list, normalised for whitespace, plus the `where` clause
   * when the declaration has one — because `f(x) where {T} = …` and `f(x) where {S} = …` are two
   * DIFFERENT methods and `f(x) = …` and `f(x, y) = …` are two different methods, while
   * `f(x) = 1` and `f( x ) = 2` are the same one. Keying on the name alone would conflate every
   * method of a generic function, and a generic function's methods are precisely the ones the
   * `overrides` argument in this file's header says are NOT overrides.
   *
   * Both declaration FORMS are read, because julia has two and the corpus uses both heavily: the
   * long `function f(x) … end` (whose `signature` holds the call) and the short `f(x) = …` (whose
   * assignment's left-hand side is the call, possibly behind a `where`, a return-type annotation
   * and parentheses — the same wrappers `unwrapWhere` already knows about).
   */
  private declarationSiteOf(node: Node): { name: string; signature: string } | null {
    if (node.type === "function_definition" || node.type === "macro_definition") {
      const sig = this.firstNamedChildOfType(node, "signature")
      if (!sig) return null
      const name = this.signatureName(sig)
      return name ? { name, signature: this.methodSignatureKey(sig) } : null
    }
    if (node.type !== "assignment") return null
    // The `where` clause is captured BEFORE the unwrapping below, and that ordering is load-bearing.
    // `f(x) where {T} = …` is `(assignment (where_expression (call_expression …) {T}) (operator) …)`,
    // so the clause hangs off the assignment's LEFT-HAND SIDE and `unwrapWhere` — whose entire job is
    // to reach the callable — discards it on the way down. The first version unwrapped first and keyed
    // on the resulting call, which silently dropped the clause, and two methods of the same generic
    // function with different type-variable bounds collided:
    //
    //     julia/base/checked.jl:138-139
    //       add_with_overflow(x::T, y::T) where {T<:SignedInt}   = …
    //       add_with_overflow(x::T, y::T) where {T<:UnsignedInt} = …
    //     julia/base/math.jl:834 and :838
    //       min(x::T, y::T) where {T<:AbstractFloat} = …
    //       min(x::T, y::T) where {T<:IEEEFloat}      = …
    //     julia/test/testhelpers/Furlongs.jl:21-22
    //       Furlong{p}(x::Furlong{q}) where {p,q}       = …
    //       Furlong{p,T}(x::Furlong{q}) where {T,p,q}   = …
    //
    // All three pairs are DIFFERENT methods that coexist in the method table, and publishing a
    // replacement between them is the same falsehood this file's header declined to tell about
    // `overrides` in the first place. The key is taken from the un-unwrapped left-hand side, which
    // holds both the call and the clause.
    const rawLhs = this.pos(node, 0) ?? node
    let lhs = this.unwrapWhere(rawLhs)
    if (lhs.type === "typed_expression") {
      const inner = this.pos(lhs, 0)
      if (inner && inner.type === "call_expression") lhs = inner
    }
    if (lhs.type !== "call_expression") return null
    const name = this.calleeName(lhs)
    if (!name || IMPLICIT_OR_CONSTANT.has(name)) return null
    return { name, signature: this.methodSignatureKey(rawLhs, lhs) }
  }

  /**
   * The `(name, signature)` half that distinguishes two methods of the same generic function.
   *
   * `root` is the node the declaration's text hangs off — a `signature` for the long form, the
   * assignment's un-unwrapped left-hand side for the short one — and `call` is the callable inside
   * it. Both are needed because they are not the same node: `where` wraps the call in one and the
   * other has no `where` at all, so a single argument could only ever capture one of the two shapes.
   */
  private methodSignatureKey(root: Node, call?: Node): string {
    const callNode = call ?? (root.type === "call_expression" ? root : this.namedChildren(root).find((c) => c.type === "call_expression"))
    if (!callNode) return ""
    const args = this.firstNamedChildOfType(callNode, "argument_list")
    const whereNode = root.type === "where_expression" ? root : this.namedChildren(root).find((c) => c.type === "where_expression")
    if (!args && !whereNode) return ""
    return `${args ? collapseSpace(args.text) : ""}${whereNode ? `|where ${collapseSpace(whereNode.text)}` : ""}`
  }

  /**
   * Is this declaration reached unconditionally, with text julia itself wrote?
   *
   * Walks ANCESTORS rather than the parent, because the conditional node is not always adjacent:
   * a declaration inside `else` sits under `else_clause` and `if_statement`, and a declaration
   * inside `catch` sits under `catch_clause` and `try_statement`, so a parent-only test reads
   * `try_statement` as unconditional. The whole list is what the test is — adding a construct to
   * it makes the edge class narrower, which is the direction that errs toward refusing rather than
   * toward asserting.
   *
   * `macrocall_expression` and the quote forms are in the set because their content is not julia text
   * in this file: `@eval f(x) = …` and `quote f(x) = … end` are code GENERATED at expansion, and the
   * tree shows the generated text, not what the file declares.
   *
   * `&&` and `||` are not in the set — they are `binary_expression` nodes, which are the most common
   * node in julia and cannot be listed wholesale — so the short-circuit case is tested by OPERATOR.
   * In `cond && function f() … end` the right operand runs only when `cond` holds, and a declaration
   * there is as conditional as one inside an `if`. Only the RIGHT operand is conditional; the left
   * one always runs, which is why the test looks at the second OPERAND rather than both.
   *
   * `&&` is the live operator and `||` is not: measured over the 971 admitted corpus files there are
   * 11,549 `&&` binary_expressions and 5,145 `||` ones, and of the `&&` set exactly ONE has a
   * declaration node as its right operand — `julia/JuliaSyntax/src/core/parse_stream.jl:316`,
   *
   *     VERSION < v"1.11.0-DEV.753" && function ParseStream(io::IOBuffer; version=VERSION)
   *
   * which is a version-guarded method definition and is exactly the shape that must not publish an
   * edge. One is not zero, so this is a predicate the grammar can reach rather than a safety net
   * that never fires; `||` is left out because no `||` in the corpus has one, and a branch that
   * cannot match is what honesty contract §2's L2 audit exists to report.
   *
   * THE OPERAND INDEX IS NOT 1. The operator is a NAMED child of `binary_expression` in this
   * grammar, so the operand list is `[left, operator, right]` over named children and the right
   * operand sits at index 2. The first version read index 1, compared it to the declaration's own
   * node id, never matched, and published `overrides` for the one guarded definition in the corpus
   * — found by running the fixture rather than by reading the code, which is the only way a
   * predicate that is wrong in the direction of asserting anything gets caught.
   */
  private isUnconditionalPosition(node: Node): boolean {
    let cur: Node | null = node
    for (let i = 0; i < 24 && cur; i++) {
      if (CONDITIONAL_OR_GENERATED.has(cur.type)) return false
      if (cur.type === "binary_expression" && this.shortCircuitOperator(cur) === "&&") {
        const named = this.namedChildren(cur).filter((c) => c.type !== "operator")
        const right = named.length > 1 ? named[named.length - 1] : null
        if (right && right.id === node.id) return false
      }
      cur = cur.parent ?? null
    }
    return true
  }

  /** The operator token of a `binary_expression`, or "" — in this grammar the operator is a NAMED
   *  child of type `operator`, the same shape `binOp` reads in the census instrument. */
  private shortCircuitOperator(node: Node): string {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "operator") return c.text.trim()
    }
    return ""
  }

  /**
   * The `overrides` edge for a declaration that replaces an earlier one.
   *
   * ## The edge shape, and why it is not `name -> name`
   *
   * A Julia method-table replacement has both of its endpoints at the SAME symbol: the earlier
   * declaration and the later one are both named `f` with the same signature, so the second
   * definition replaces the first IN PLACE — it acquires no supertype, no owner and no new name. A
   * self-loop `f -overrides-> f` is therefore the most literally accurate shape available, and it is
   * exactly the shape this codebase already ruled out three times:
   *
   *   - `src/ast/real-php-analyzer.ts:2496` — "UNRESOLVABLE and emit NO edge (a self-loop is always
   *     fabrication, and a …)"
   *   - `src/lsp/rich_hover.ts:222` — "Degenerate self-loop rows … are not connections and not
   *     usages: skip them."
   *   - `src/intelligence/patterns/orphans.ts:818` — a self-loop `overrides` row is listed under
   *     "REFUSED EVIDENCE", and the rake `listen` regression is the case it cites: a self-loop row
   *     was the only thing standing between a real method and a dead-code report.
   *
   * A corpus full of rows every consumer discards is not coverage; it is volume that makes the
   * signal harder to see. So the SOURCE is the enclosing DECLARED scope — a `module` or a type, a
   * symbol this file really declares — and the TARGET is the method whose entry is replaced.
   * `module M … f(x) = 1; f(x) = 2 … end` gives `M -overrides-> f` with both ends binding to real
   * symbols in the same file, which is the same shape the bash lane settled on for the same
   * construct (`real-bash-analyzer.ts:322-348`, BD8b) and the shape
   * `src/ast/override-retarget.ts` is written to consume.
   *
   * ## Why the module-less case is REFUSED rather than published as `global`
   *
   * 71.9% of Julia corpus files declare no module at all — measured, see this file's `GLOBAL_SCOPE`
   * note — so the refused case is the MAJORITY one and it is worth being explicit that it is a
   * refusal rather than an oversight. Publishing `global -overrides-> f` would give the edge a
   * source that resolves to nothing, which is the same dangling identity this file's `contains` case
   * declines to invent, and `global -calls-> f` is already the largest unresolvable-source bucket in
   * the census. The edge is dropped instead, and the drop is counted by the census rather than left
   * invisible.
   *
   * Confidence 1.0: this is a byte comparison of two declaration signatures in one file, which is a
   * parse fact and not a guess. `evidenceClass` is `structural` for the same reason (see
   * `classifyEvidenceTier`), so the edge is never counted as a heuristic.
   */
  private overrideEdgeFor(node: Node, scope: string): ASTEngine.UniversalRelationship | null {
    const hit = this.redefinedAt.get(node.id)
    if (!hit) return null
    // The SOURCE must be the thing that owns a method table. A module and a type do; a FUNCTION does
    // not — a body holds local closures, which is the whole of `LOCAL_BINDING_SCOPE`, and a
    // definition inside one displaces nothing. Measured: 14 of an earlier revision's 63 `overrides`
    // edges were sourced from a function, e.g. `julia/base/range.jl:496`'s `throwbool(r) = …` inside
    // a second inner constructor of `OneTo` reading as `OneTo -overrides-> throwbool`. Every one is
    // gone under this line.
    //
    // The empty scope is refused for the reason `GLOBAL_SCOPE` documents: 71.9% of julia corpus files
    // declare no module, and `global` is a synthetic name rather than a symbol, so an edge sourced
    // from it resolves to nothing. 71.9% of the corpus is the bucket this refuses, and it is counted
    // by the census rather than left invisible.
    //
    // `scope === hit.name` closes the last self-loop: a module and a method sharing a name would
    // otherwise produce one wearing a different hat.
    if (!scope || scope === hit.name) return null
    if (!this.ownsAMethodTable(scope, hit.name)) return null
    return this.rel(scope, ASTEngine.RelationshipType.Overrides, hit.name, node, 1.0, {
      juliaSpecific: true,
      isMethodRedefinition: true,
      redefinition: true,
      via: "identical_signature_redefinition",
      replacesLine: hit.replacesLine,
      signature: hit.signature.slice(0, 120),
      declaredIn: scope,
    })
  }

  /**
   * Does this file declare `owner` as a module or a type — the two things whose bodies hold a method
   * table?
   *
   * Answered from the symbol table rather than from the walk's `activeScope`, because `activeScope`
   * names FUNCTIONS too and a function is not a method-table owner. The symbol kinds are the
   * analyzer's own: `SymbolKind.Module` for a `module`/`baremodule`, `SymbolKind.Interface` for an
   * `abstract type`/`primitive type` and `SymbolKind.Class` for a `struct`. Cost is a scan of the
   * file's own symbols, once per admitted override edge, over a list that is already in memory.
   */
  private ownsAMethodTable(owner: string, target: string): boolean {
    const syms = this.declaredSymbolKinds
    if (!syms) return false
    const kind = syms.get(owner)
    if (kind !== ASTEngine.SymbolKind.Module && kind !== ASTEngine.SymbolKind.Interface && kind !== ASTEngine.SymbolKind.Class) return false
    // The target must be a declaration of a METHOD or a MACRO. A `property` or a `constant` target
    // means the pre-pass read a field or a binding as a method, and 2 of the earlier 63 edges had
    // exactly that shape (`julia/test/core.jl:4441` -> `foo`, a `constant`; `:5489` -> `bar`, a
    // `property`) — both `function` forms nested in a `let` inside another function.
    const t = syms.get(target)
    return t === ASTEngine.SymbolKind.Function || t === ASTEngine.SymbolKind.Macro
  }

  /**
   * The one place a relationship is constructed.
   *
   * `type` is `ASTEngine.RelationshipType` and NOT `RelationshipType | string`, and that narrowing is
   * the point of this entry rather than a typing preference. The lane used to pass serialized string
   * literals ("contains", "extends"), which type-checked because the parameter accepted `string` — and
   * which `script/m14/verify-doc-truth-emissions.ts` cannot see: its header declares the limit
   * outright, "A serialized kind emitted by assigning a STRING literal would be invisible to this
   * gate", and it derives a lane's emitted surface from `RelationshipType.X` references in code. So
   * every relationship this analyzer published was outside the one gate whose whole job is to catch a
   * doc claiming a channel the analyzer does not fill. Naming the enum member makes the surface
   * readable by that gate and makes a typo in a type label a compile error rather than a row nothing
   * groups.
   *
   * The serialized values are identical to the literals that were here (`RelationshipType.Contains`
   * is `"contains"`, `RelationshipType.Imports` is `"brain_import"`), so this changes the label's
   * provenance and nothing about the bytes stored.
   */
  private rel(
    source: string, type: ASTEngine.RelationshipType, target: string, node: Node, confidence: number,
    metadata?: Record<string, unknown>,
  ): ASTEngine.UniversalRelationship {
    return {
      source, target, type, confidence,
      line_number: node.startPosition.row + 1,
      metadata: { juliaSpecific: true, ...(metadata ?? {}) },
    } as ASTEngine.UniversalRelationship
  }

  private range(node: Node) {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  /**
   * This grammar is almost entirely POSITIONAL.
   *
   * Measured from the vendored `src/node-types.json`: **7 of 151 named node types carry field
   * names** — `module_definition.name`, `field_expression.value`, `if_statement.condition` /
   * `.alternative`, `elseif_clause.condition`, `while_statement.condition`, and the two prefixed
   * string/command literals. Every other node, including `binary_expression`, `typed_expression`,
   * `signature`, `call_expression` and `type_head`, must be navigated by child ORDER.
   *
   * The first version of this analyzer reached for `childForFieldName("right")` and
   * `childForFieldName("name")` throughout, which returns null for a node that has no such
   * field. It did not throw and it did not crash — it silently emitted **zero `extends` edges**
   * and **zero struct fields** for a corpus that has thousands of both, and the symptom was a
   * plausible-looking symbol list. That is the F1 node-type-literal class of defect the C lane's
   * pin record warns about ("written from memory of a different tree-sitter release, which F1
   * caught only because the vocabulary happened to be checked"), and the reason `pos()` exists
   * here rather than another `childForFieldName`.
   */
  private pos(node: Node, index: number): Node | null {
    const c = node.namedChild(index)
    return c ?? null
  }

  /**
   * The two operands of a `binary_expression`.
   *
   * `binary_expression` here is `(left) (operator) (right)` where the OPERATOR IS A NAMED CHILD —
   * measured, not assumed: `isNamed=true`, `type="operator"`, sitting at index 1. So the naive
   * "left is child 0, right is child 1" is wrong twice over: index 1 is the operator, not the
   * right operand, and an operand can itself be an operator token. Right is therefore the LAST
   * named child, and left the first, which holds for every binary shape in the grammar
   * (`a + b`, `a::T`, `a <: B`, `a where {B}`).
   *
   * Both halves of this were wrong in the first version — `tokenText` scanned only ANONYMOUS
   * children for the operator, so it never found it, and `pos(node,1)` handed back the operator
   * where the right operand belonged. The visible effect was **zero `extends` edges** over a
   * corpus where `<:` is everywhere, on a file that parsed with zero ERROR nodes.
   */
  private binOperands(node: Node): { op: string; left: Node | null; right: Node | null } {
    const named = this.namedChildren(node).filter((c) => c.type !== "operator")
    return {
      op: this.tokenText(node, "operator"),
      left: named[0] ?? null,
      right: named.length > 1 ? named[named.length - 1]! : null,
    }
  }

  /**
   * The operator token of a `binary_expression`. It is a NAMED child of type `operator` in this
   * grammar — verified by walking the children of a real `struct Circle{T<:Real} <: Shape` —
   * so a scan restricted to anonymous children finds nothing and the operator reads as empty.
   */
  private tokenText(node: Node, token: string): string {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === token) return c.text.trim()
    }
    return ""
  }

  private namedChildren(node: Node): Node[] {
    const out: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c) out.push(c)
    }
    return out
  }

  private firstNamedChildOfType(node: Node, type: string): Node | null {
    for (const c of this.namedChildren(node)) if (c.type === type) return c
    return null
  }

  private firstNamedChildType(node: Node): string {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.isNamed) return c.type
    }
    return ""
  }

  private hasToken(node: Node, token: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && !c.isNamed && c.type === token) return true
    }
    return false
  }

  /**
   * `type_head` is positional: `Name`, `Name{Params}`, or `Name{T} <: Super`.
   *
   * The `<:` case is the trap. `struct Circle{T<:Real} <: Shape` makes the head
   * `(binary_expression (parametrized_type_expression Circle{T<:Real}) <: (identifier Shape))`, so
   * the first identifier ANYWHERE in that subtree is **Shape** — the supertype — and the first
   * version named every such struct after its supertype: one `class:Shape` with
   * `contains -> radius`, and no `extends` edge, because the name and the supertype had been
   * swapped by the same mistake. A declared name is the subtree's LEFT-most name, so a binary
   * expression contributes its left operand and the supertype is read separately by
   * `supertypesOf`. That is a plausible-looking wrong answer, which is the whole difficulty: the
   * symbol list looked like a valid parse of a valid file.
   */
  private typeHeadName(node: Node): string {
    // BASE CASE. A supertype is very often a bare `identifier`, and this function looks for
    // CHILDREN — so handed an identifier it found none and returned "". The effect was that
    // `struct Circle <: Shape` published no `extends` edge at all, on a file with zero ERROR
    // nodes, which is the quietest possible failure. The node being asked about may BE the name.
    if (node.type === "identifier") return node.text.trim()
    if (node.type === "macro_identifier") return stripSigil(node.text, "@")
    if (node.type === "operator") return node.text.trim()
    // A subtype/where chain: the declared name is on the LEFT, the bound on the right.
    if (node.type === "binary_expression") {
      const { left } = this.binOperands(node)
      if (left) {
        const inner = this.typeHeadName(left)
        if (inner) return inner
      }
    }
    // A QUALIFIED type is a `field_expression` and the WHOLE path is the name. `x::Threads.SpinLock`
    // is (field_expression (identifier Threads) (identifier SpinLock)), and taking pos(0) returned
    // `Threads` — so every annotation naming a type in a namespace published a reference to the
    // NAMESPACE. Same shape as the `type_head` bug this function already had a scar for, one field
    // away: there it named a struct after its supertype, here it names a type after its module.
    // Found by the F5 `references` oracle (`base/task.jl` `Threads.SpinLock`,
    // `base/cpuid.jl` `Threads.Atomic`, `test/cancellation.jl` `Base.GMP.MPZ`).
    if (node.type === "field_expression") {
      const path = this.fieldPath(node)
      if (path) return path
    }
    const first = this.pos(node, 0)
    if (first && first.type === "identifier") return first.text.trim()
    const direct = this.firstNamedChildOfType(node, "identifier")
    if (direct) return direct.text.trim()
    // `Vector{T}` — the base name is the first identifier under the curly expression.
    for (const c of this.namedChildren(node)) {
      if (c.type === "curly_expression" || c.type === "parametrized_type_expression" || c.type === "binary_expression") {
        const inner = this.typeHeadName(c)
        if (inner) return inner
      }
      if (c.type === "where_expression") {
        const inner = this.typeHeadName(c)
        if (inner) return inner
      }
    }
    return ""
  }

  /** `signature` is positional: an identifier, a call, an argument list, a typed expr, or a where-expr. */
  /**
   * Strip a `where` clause to the callable underneath it. The callable is ALWAYS `pos(0)`.
   *
   * `f(x::T) where {T} = body` is `(assignment (where_expression (call_expression …) {T}) …)` and
   * `function f(x::T) where T … end` is `(function_definition (signature (where_expression
   * (call_expression …) T)) …)`. The corpus audit is what found this: `Compiler/test/inline.jl:664`
   * declares `g41299(f::Tf, args::Vararg{Any,N}) where {Tf,N}`, nothing unwrapped the wrapper, so
   * the declaration was never published and the call to it came out UNRESOLVED against a runtime
   * that resolves it perfectly. Worse, the TYPE VARIABLE was read as the function's name.
   *
   * And note the two forms differ: `where {T}` puts a `curly_expression` after the call, but
   * BARE `where T` puts the type variable there as a plain sibling `identifier`. That is why
   * scanning for an identifier is unsound here — for `where T` it finds `T`, the parameter, and
   * returns it as the function's name, fabricating a function called `T`. Positional access is
   * not a workaround for this grammar; it is the only correct navigation.
   */
  private unwrapWhere(node: Node): Node {
    // Descend to the CALLABLE, through every wrapper that can sit between an assignment's
    // left-hand side and the call. The wrappers are not interchangeable: `where T<:Real` puts the
    // bound among the where_expression's DIRECT children, while `where {T<:Real}` puts it inside a
    // `curly_expression` — and a first version that stopped at the curly returned IT rather than the
    // call, so `bounded{T<:Real}(x::T) = x` was not recognised as a declaration at all. Same for the
    // return-type wrapper that made `f(x)::T = …` invisible.
    const WRAPPERS = new Set(["where_expression", "curly_expression", "typed_expression", "parenthesized_expression"])
    let cur = node
    for (let guard = 0; guard < 8 && WRAPPERS.has(cur.type); guard++) {
      const first = this.pos(cur, 0)
      if (!first) break
      cur = first
    }
    return cur
  }

  private signatureName(sig: Node): string {
    // A signature may carry a RETURN TYPE. `function scaled{T<:Real}(s::Shape, k::T)::Float64`
    // makes the signature a `typed_expression` whose siblings are the callable and the return
    // type, so an identifier scan returns `Float64` — the function was published under its RETURN
    // TYPE and `scaled` was lost. Found by the julia fixture lane, authored before the run.
    // A signature is never a typed variable declaration, so unwrapping here is unambiguous.
    if (sig.type === "typed_expression") {
      const callable = this.pos(sig, 0)
      if (callable) return this.signatureName(callable)
    }
    // A call_expression reached here may have a QUALIFIED or PARAMETRIC name —
    // `scaled{T<:Real}(…)` puts the name in a `field_expression`, so there is no direct identifier
    // child and the identifier/call scans below both miss it and the function is never declared.
    // `calleeName` already resolves a `field_expression` path, so delegate rather than duplicate.
    if (sig.type === "call_expression") return this.calleeName(sig) ?? ""
    // `where T` / `where {T}`: the callable is pos(0). Check this BEFORE any identifier scan,
    // because in the unbraced form the type variable IS a sibling identifier and the scan would
    // return `T` — a function symbol named after a parameter.
    if (sig.type === "where_expression") {
      const callable = this.unwrapWhere(sig)
      if (callable.type === "call_expression") return this.calleeName(callable) ?? ""
    }
    const direct = this.firstNamedChildOfType(sig, "identifier")
    if (direct) return direct.text.trim()
    const call = this.firstNamedChildOfType(sig, "call_expression")
    if (call) return this.calleeName(call) ?? ""
    // `f(x::T) where {T}` — recurse through the wrapper rather than reporting nothing.
    for (const c of this.namedChildren(sig)) {
      if (c.type === "where_expression" || c.type === "typed_expression" || c.type === "parenthesized_expression") {
        const inner = this.signatureName(c)
        if (inner) return inner
      }
    }
    return ""
  }

  /**
  /**
   * Is this node inside the `type_head` of a type DECLARATION?
   *
   * Checked by walking ancestors rather than the immediate parent, because the depth varies with
   * the shape of the head: `struct Circle <: Shape` puts the `parametrized_type_expression` two
   * levels down (`type_head > binary_expression > …`) while `struct Circle{T} <: Shape` puts it
   * three, and a parent-only test silently missed the second. A guard that only sometimes fires
   * is worse than none, because it leaves a self-reference edge on exactly the generic types that
   * most need to be right.
   */
  private withinTypeHead(node: Node): boolean {
    let cur: Node | null = node
    for (let i = 0; i < 5 && cur; i++) {
      if (this.typeHeadSites.has(cur.id)) return true
      cur = cur.parent ?? null
    }
    return false
  }

  /** The C symbol a `ccall(...)` call targets, with its library when the two-tuple form gives one. */
  private ccallTarget(call: Node): { symbol: string; library: string | null } | null {
    const args = this.firstNamedChildOfType(call, "argument_list")
    const first = args ? this.pos(args, 0) : null
    if (!first) return null
    if (first.type === "quote_expression") {
      const sym = this.pos(first, 0)
      return sym ? { symbol: stripSigil(sym.text, ":"), library: null } : null
    }
    if (first.type === "tuple_expression") {
      const parts = this.namedChildren(first).map((q) => { const inner = this.pos(q, 0); return inner ? stripSigil(inner.text, ":") : "" })
      if (parts.length >= 2 && parts[0] && parts[1]) return { symbol: parts[0], library: parts[1] }
      if (parts.length === 1 && parts[0]) return { symbol: parts[0], library: null }
    }
    return null
  }

  /** Stable key for a call site, so a `@ccall` target can be recognised again when it is emitted. */
  private textKey(node: Node, callee: string): string {
    return `${node.startIndex}:${callee}`
  }

  /**
   * Record every call site under an `@ccall` as a call to a FOREIGN symbol.
   *
   * `@ccall strlen(s)::Csize_t` puts the C function in an ordinary `call_expression` inside
   * `macro_argument_list`, so without this the emit site cannot tell it from `f(s)` and asserts a
   * Julia binding. Collected by node start index rather than by name, because two different C
   * symbols can share a name and only the call SITE says which one this edge is.
   */
  private markForeignCallees(macroNode: Node): void {
    const args = this.firstNamedChildOfType(macroNode, "macro_argument_list")
    if (!args) return
    const visit = (n: Node) => {
      if (n.type === "call_expression") {
        const callee = this.calleeName(n)
        if (callee) this.foreignMarked.add(this.textKey(n, callee))
      }
      for (const c of this.namedChildren(n)) visit(c)
    }
    visit(args)
  }

  /**
   * The dotted path of a `field_expression` chain — this grammar's qualified access.
   *
   * MEASURED, and the measurement contradicted the code. There is NO `scoped_identifier` node in
   * this grammar: scanning 400 corpus files for `scoped_identifier` under a `call_expression`
   * callee found **0**, while `field_expression` accounted for every qualified callee. `Core
   * .Intrinsics.bitcast` is `field_expression(field_expression(Core, Intrinsics), bitcast)` —
   * left-nested, so the path is built by recursion, not by listing segments.
   *
   * The `scoped_identifier` branch this replaced was dead code written from a different grammar,
   * and because it never matched, `calleeName` returned null and the analyzer emitted **nothing at
   * all** for a file of qualified calls: zero symbols, zero relationships, no error. A silent empty
   * graph is the worst failure shape there is — it reads as "nothing to see here" rather than
   * "this analyzer is blind".
   *
   * The dotted path is kept WHOLE on purpose. Collapsing it to the last segment was measured to
   * invent merges: over 400 files, 1,352 bare segments appear behind a qualified path and **72 of
   * them are reachable by more than one distinct path**. `parse` alone is `Meta.parse`,
   * `Base.parse`, `TOML.parse` and `Dates.parse` — four unrelated functions. `bitcast` is
   * `Base.bitcast`, `Core.bitcast` and `Intrinsics.bitcast`. `isreadable` is
   * `Filesystem.isreadable`, `Base.isreadable` and `Sys.isreadable`. One node per bare name would
   * silently fuse them, and a merged node makes every edge into and out of it a statement about
   * the wrong function. In Julia the qualified path IS the identity of the binding.
   *
   * `Base.:(==)` puts the operator in a `quote_expression`, so the last segment can be either.
   */
  private fieldPath(node: Node): string {
    if (node.type === "identifier") return node.text.trim()
    // A PARAMETRIC name is a `parametrized_type_expression`, not a `field_expression`:
    // `scaled{T<:Real}(s, k)` has callee children `parametrized_type_expression` +
    // `argument_list`, so nothing matched and the function was never declared at all. Found by
    // the julia fixture lane. `fieldPath` is the one place qualified-name resolution lives, so the
    // parametric case belongs here too rather than as a second, divergent name-resolver in
    // `calleeName` — two resolvers for one notion of "name" is how they drift apart.
    if (node.type === "parametrized_type_expression") {
      const base = this.pos(node, 0)
      return base ? this.fieldPath(base) : ""
    }
    if (node.type === "quote_expression") return node.text.trim()
    if (node.type === "macro_identifier") return stripSigil(node.text, "@")
    if (node.type === "operator") return node.text.trim()
    if (node.type === "where_expression" || node.type === "parenthesized_expression") {
      const inner = this.pos(node, 0)
      return inner ? this.fieldPath(inner) : ""
    }
    if (node.type === "field_expression") {
      const kids = this.namedChildren(node)
      const receiver = kids[0]
      const member = kids[kids.length - 1]
      if (!receiver || !member) return node.text.trim()
      const head = this.fieldPath(receiver)
      const tail = this.fieldPath(member)
      return head && tail ? `${head}.${tail}` : head || tail || node.text.trim()
    }
    return ""
  }

  /** The callee of a call: a bare name, or the WHOLE dotted path when it is qualified. */
  private calleeName(call: Node): string | null {
    if (call.type === "where_expression") {
      const callable = this.unwrapWhere(call)
      if (callable !== call) return this.calleeName(callable)
    }
    // Positional: the callee is pos(0), NEVER an argument. Every shape a callee can take —
    // `identifier`, `field_expression` (qualified), `parametrized_type_expression` (parametric),
    // `quote_expression` (`Base.:(==)`), `where_expression`, `parenthesized_expression` — is
    // resolved by `fieldPath`, which is the single place name-resolution lives.
    //
    // These were three separate branches and each covered one shape, so every new shape was a
    // silent miss: `parametrized_type_expression` was the third, and it made
    // `function scaled{T<:Real}(s, k)` vanish entirely — a generic method, the very construct
    // Julia is distinctive for, found by the fixture lane. A list of shapes is a maintenance
    // liability; one resolver with the shapes inside it is not.
    const calleeNode = this.pos(call, 0)
    if (calleeNode) {
      const path = this.fieldPath(calleeNode)
      if (path) return path
    }
    for (const c of this.namedChildren(call)) {
      if (c.type === "where_expression" || c.type === "parenthesized_expression") {
        const inner = this.calleeName(c)
        if (inner) return inner
      }
    }
    return null
  }

  /** `<: A, <: B` on a struct/abstract head, and `<: S` on a type parameter. */
  private supertypesOf(node: Node): string[] {
    const out: string[] = []
    const head = this.firstNamedChildOfType(node, "type_head")
    if (!head) return out
    const visit = (n: Node) => {
      if (n.type === "binary_expression") {
        const { op, right } = this.binOperands(n)
        if ((op === "<:" || op === ">:") && right) {
          const name = this.typeHeadName(right)
          if (name) out.push(name)
        }
      }
      for (const c of this.namedChildren(n)) {
        // A PARAMETER's upper bound is not a supertype of the declared type.
        // `struct Circle{T<:Real} <: Shape` hides `T<:Real` inside the curly expression, and a
        // walk that descends into it reports `Circle <: Real` — a FALSE edge that says Circle is
        // a subtype of Real. It is a bound on Circle's PARAMETER, which is a different fact and
        // belongs in the `where_expression` case below, where the bound is published as
        // `T <: Real` with T as the source. A parameter list is a wall, not a road.
        if (c.type === "curly_expression" || c.type === "parametrized_type_expression") continue
        visit(c)
      }
    }
    visit(head)
    return [...new Set(out)]
  }

  /** A struct body's `x::T` entries. The grammar has no dedicated field node for them. */
  private structFields(node: Node): { name: string; node: Node }[] {
    const out: { name: string; node: Node }[] = []
    for (const c of this.namedChildren(node)) {
      if (c.type !== "typed_expression") continue
      // `typed_expression` is POSITIONAL: child 0 is the name, child 1 the type. It is also the
      // node that carries a PARAMETER's type in a signature, so this is only called on a struct
      // body where a bare `x::T` really is a field.
      const name = this.pos(c, 0)?.text.trim() ?? ""
      if (name) out.push({ name, node: c })
    }
    return out
  }

  /** `import A: b, c` / `using A, B` — the module and the names brought in. */
  private importTargets(node: Node): { name: string; items: string[] }[] {
    const out: { name: string; items: string[] }[] = []
    const paths = this.namedChildren(node).filter((c) => c.type === "import_path" || c.type === "identifier" || c.type === "scoped_identifier")
    let pending: { name: string; items: string[] } | null = null
    for (const c of this.namedChildren(node)) {
      if (c.type === "import_path") {
        pending = { name: c.text.trim(), items: [] }
        out.push(pending)
      } else if (c.type === "import_alias" && pending) {
        // Only `identifier`, and the node-type set is measured rather than remembered: over the 971
        // admitted corpus files the production grammar produces no `import_list`, and an earlier
        // version filtered for one here and then mapped it with a TERNARY whose two branches were both
        // `x.text.trim()`. Two dead branches wearing one: a node the grammar cannot produce, and a
        // conditional that cannot choose. Found by instrument A' in
        // `validation/m14/fixtures/julia/census.ts`, which extracts the analyzer's node-type CLAIMS
        // (the literals in a `.type` comparison, a `firstNamedChildOfType` argument, or a node-type
        // `Set`) and checks each against the node types the grammar actually produced.
        const items = this.namedChildren(c).filter((x) => x.type === "identifier")
        pending.items = items.map((x) => x.text.trim())
      } else if (c.type === "identifier" || c.type === "scoped_identifier") {
        // `using LinearAlgebra` — a bare path with no colon list.
        if (!pending) { pending = { name: c.text.trim(), items: [] }; out.push(pending) }
        else if (pending.items.length === 0 && c.text.trim() !== pending.name) pending.items.push(c.text.trim())
      }
    }
    if (!out.length && paths.length) out.push({ name: paths[0]!.text.trim(), items: [] })
    return out
  }

  private exportableName(node: Node): string {
    if (node.type === "identifier") return node.text.trim()
    if (node.type === "operator") return node.text.trim()
    if (node.type === "scoped_identifier") {
      const segs = this.namedChildren(node).filter((x) => x.type === "identifier")
      return segs.length ? segs[segs.length - 1]!.text.trim() : node.text.trim()
    }
    if (node.type === "macro_identifier") return stripSigil(node.text, "@")
    if (node.type === "call_expression") return this.calleeName(node) ?? ""
    // `list_litteral` WAS HERE, misspelled and unreachable. The grammar produces no such node over
    // the 971 admitted corpus files, and the two spellings that do exist — `tuple_expression` and
    // `parenthesized_expression`, both here — already cover the shapes an export list takes. Kept as
    // a note rather than deleted silently because it is the kind of branch that reads as coverage.
    if (node.type === "tuple_expression" || node.type === "parenthesized_expression") {
      for (const c of this.namedChildren(node)) {
        const n = this.exportableName(c)
        if (n) return n
      }
    }
    return ""
  }

  /**
   * Evidence tier, the same rules as the swift/dart/csharp/objc family.
   */
  private classifyEvidenceTier(rels: ASTEngine.UniversalRelationship[]): void {
    for (const r of rels) {
      const md: any = r.metadata ?? {}
      const t = String(r.type ?? "")
      if (t === "contains") { md.evidenceClass = "structural"; continue }
      if (t === "imports" || t === "exports" || t === "references") { md.evidenceClass = "import_based"; continue }
      // `overrides` is structural for the same reason `contains` is, and the rule is stated rather
      // than derived from the number: a redefinition is two declaration signatures in one file that
      // compare equal, which the tree states outright — there is no inference between the signature
      // and the edge. Keying it off `confidence >= 0.9` instead, as the `extends` line above does,
      // would leave this lane with no tier at all for the type, because an earlier version read the
      // confidence and the branch had no arm for `overrides` — so the six edges published with NO
      // `evidenceClass`, which every consumer that groups by tier then counted as unclassified.
      if (t === "overrides") { md.evidenceClass = "structural"; continue }
      if (t === "calls" || t === "uses" || t === "instantiates") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (t === "extends" || t === "implements") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.9 ? "structural" : "inferred"
        continue
      }
    }
  }

  /**
   * Cyclomatic complexity, counted over the tree.
   *
   * The walk is GUARDED at 200,000 node visits, and that guard is inherited from the other lanes
   * rather than invented — the objective-c review measured its own guard at 3.33% of the cap on
   * the worst corpus file, so the bound is real but never approached there. A truncated value
   * would be indistinguishable from a true one in the artifact, which is why the cap exists at all
   * and why its margin is measured rather than assumed.
   */
  private complexity(root: Node): number {
    let c = 1
    // `case_statement` is NOT here because julia has no `case`. The language spells multi-way branching
    // with `if`/`elseif`, and all three of its spellings are already in this set; `case_statement` was
    // a member from another language's vocabulary, unreachable in every julia file. Instrument A'
    // in `validation/m14/fixtures/julia/census.ts` is what named it: it extracts the node-type claims
    // in this file and checks each against what the production grammar produced over 971 corpus
    // files. It is named here rather than dropped without a trace because a decision point that is
    // silently absent is indistinguishable from one nobody looked for.
    const decisions = new Set(["if_statement", "elseif_clause", "for_statement", "while_statement"])
    const stack: Node[] = [root]
    let guard = 0
    while (stack.length > 0 && guard++ < 200000) {
      const n = stack.pop()!
      if (decisions.has(n.type)) c++
      else if (n.type === "binary_expression") {
        const op = n.childForFieldName("operator")?.text.trim() ?? ""
        if (op === "&&" || op === "||") c++
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const ch = n.namedChild(i)
        if (ch) stack.push(ch)
      }
    }
    return c
  }
}
