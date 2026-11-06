// REAL JULIA ANALYZER — the production AST analyzer for .jl files.
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS. tree-sitter-julia in, UniversalSymbols + UniversalRelationships out, pure AST extraction,
// no regex fallback. It covers ten relationship types by name: calls, uses, contains, imports, references,
// exports, extends, overrides, instantiates and part_of (`include("…")`, R3).
// WHERE ITS CONTRACT LIVES: docs/analyzers/julia.md (long form); machine-readable classification
// in script/m14/spec/julia-completeness.json; fixtures in validation/m14/fixtures/julia/; measured
// clause/ambiguity records under validation/m14/verification/ (FOUR-CLAUSE-julia.md and the calls-ambiguity
// split).
// GRAMMAR: tree-sitter-julia, and MEASURED, IT IS THE ONLY ONE THIS ANALYZER LOADS —
// wasm/tree-sitter-julia.wasm. A fleet brief of 2026-10-17 said this lane pins a companion wasm; that is not
// true at this revision: LANG_CONFIGS.julia declares no `companionWasm`, the analyzer loads one grammar, and
// no julia companion wasm exists in wasm/. Section A's union rule (`cfg.wasm` + every `companionWasm`) is a
// single grammar here — if a companion is ever added, declare it in the config and classify its node types.
// CO-EDIT WHEN THIS FILE CHANGES: script/m14/spec/julia-completeness.json (new node types and emitted kinds),
// validation/m14/fixtures/julia/ (expectation files pin the endpoints), docs/analyzers/julia.md,
// and the lane's records in validation/m14/verification/. The shared arbiter script/m14/incoming-rule.ts is
// Lead-owned: propose, never edit it from a lane.

import { readFileSync } from "node:fs"
import * as path from "node:path"
import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"
import { BINDING_SEP } from "./types"

/**
 * THE PACKAGE MODULE — the binding a julia package's file-scope declarations actually belong to.
 *
 * `include("src/a.jl")` evaluates a file INSIDE the including module, and a package's entry point
 * includes its `src/` files into the module named by the package's `Project.toml`. So two file-scope
 * `f` declarations in two files of one package are two methods of ONE generic function, while two
 * file-scope `f` declarations in two unrelated projects are two functions that merely share a
 * spelling. A per-file analyzer cannot see the difference, which is why this rule is scoped by the
 * FILE's own facts and the package name only:
 *
 *   - the declaration must have NO owner (file scope, not inside a `module` block in this file), and
 *   - the file must declare NO `module` block anywhere, and
 *   - the package name must come from `<projectRoot>/Project.toml`.
 *
 * All three are needed. The first two are what makes the claim "this file's file-scope code is
 * evaluated in the package module" true; the third is what NAMES it. When any is missing the symbol
 * is published exactly as before, so a repo without a `Project.toml` — the julia language repo itself,
 * for instance — is untouched rather than guessed at.
 *
 * Measured before this was written: of the 21,168 one-region edges, 6,493 have a candidate file that
 * DOES open a `module` block (and 965 of those declare DIFFERENT modules), and those are exactly the
 * edges this rule must not touch. Per-file conditions reproduce that split without a project pass.
 */
const JULIA_PACKAGE_CACHE = new Map<string, string>()

/**
 * The TOP-LEVEL `name` of a Project.toml, read as lines — NO REGEX.
 *
 * The owner's rule is absolute and the fleet census counted this one regex literal in the whole
 * tree, in this function. The value is a simple TOML string: a `name` key before the first table,
 * quoted with `"` or `'`, optionally followed by a comment. A table header switches the reader out
 * of the top level, because TOML has no way back to it; a key after `[deps]` is not the package
 * name even when it is spelled `name`. Malformed input yields "" — the same outcome the regex's
 * `catch` produced, and the caller already treats "" as "no package module to publish".
 */
function projectTomlName(text: string): string {
  let inTable = false
  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    if (t.startsWith("[")) { inTable = true; continue }
    if (inTable) continue
    const eq = t.indexOf("=")
    if (eq < 0 || t.slice(0, eq).trim() !== "name") continue
    let value = t.slice(eq + 1).trim()
    if (!value) return ""
    const quote = value[0]
    if (quote === '"' || quote === "'") {
      const close = value.indexOf(quote, 1)
      return close > 0 ? value.slice(1, close).trim() : ""
    }
    const hash = value.indexOf("#")
    if (hash >= 0) value = value.slice(0, hash)
    return value.trim()
  }
  return ""
}

function juliaPackageName(projectRoot: string | undefined): string {
  if (!projectRoot) return ""
  const hit = JULIA_PACKAGE_CACHE.get(projectRoot)
  if (hit !== undefined) return hit
  let name = ""
  try {
    name = projectTomlName(readFileSync(path.join(projectRoot, "Project.toml"), "utf8"))
  } catch { /* no Project.toml at the project root: no package module to publish */ }
  JULIA_PACKAGE_CACHE.set(projectRoot, name)
  return name
}

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
 * not hidden; `overridesEmit` below and `docs/analyzers/julia.md` carry the numbers.
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
 * The macros whose expansion evaluates its block in the scope the block is WRITTEN in.
 *
 * Julia decides whether a macro's arguments become declarations in the enclosing module, and for
 * these five the language defines the answer: `Base.@eval` evaluates in the containing module's
 * global scope, `Base.@static` is a compile-time branch, and `Base.@sync` / `Base.@async` /
 * `Base.@time` are wrappers around a block. Every OTHER macro is free to introduce a scope, and most
 * of the ones in this corpus do: `@testset` expands its body under a `let`, so a function written
 * inside a test set is a LOCAL function and not a member of the module the test file declares.
 *
 * Nothing here is inferred from the analyzer's own output — the list is julia's semantics, and the
 * `contains` oracle applies the same five names from the other side.
 */
const SCOPE_TRANSPARENT_MACROS: ReadonlySet<string> = new Set(["eval", "static", "sync", "async", "time"])

/**
 * The node types that introduce a NEW lexical scope, so a binding written inside one is not a member
 * of the enclosing module.
 *
 * Julia's own list of scope-introducing constructs, and nothing inferred: a function, a macro, a
 * `let`, a loop, a `do` block, a quote, and a type body each own their bindings. `if` is NOT here
 * because julia's scoping rules say it introduces no scope, and `try` is not here for the same
 * reason this analyzer puts a top-level `try`'s declarations in the module — the corpus has no
 * binding shape that would make the difference observable, and a barrier it does not need would
 * hide one it does.
 */
const SCOPE_INTRODUCING_NODES: ReadonlySet<string> = new Set([
  "function_definition", "macro_definition", "let_statement", "for_statement",
  "while_statement", "do_clause", "quote_expression", "quote_statement",
  "struct_definition", "abstract_definition", "primitive_definition",
  "arrow_function_expression", "comprehension_expression",
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
 * DOES THIS TEXT CARRY SOURCE LAYOUT — whitespace or a comment marker — rather than being a
 * SPELLING?
 *
 * This is the lane's key-publication defect stated as one test. A published key is a NAME: a
 * Julia identifier, or a dotted path of them, or an operator. A string containing a newline, an
 * interior run of spaces, or a `#` is not a name — it is a SOURCE SPAN that was read as one, and
 * it cannot be matched, cannot be a target, and poisons every name-based lookup.
 *
 * MEASURED, whole corpus (941 files, `validation/m14/fixtures/julia/key-shape-census.ts`, before
 * this guard): 50 published symbol names, 51 relationship targets and 1 relationship source
 * carried layout, across 37 files. Every symbol one was kind `constant`; the largest was 16,207
 * characters of `Compiler/src/abstractinterpretation.jl` — a whole struct body with its comments
 * and inner constructors. The mechanism is ERROR RECOVERY: `const x::T` with no `=` is legal
 * Julia (a const field in a `mutable struct`) and this grammar cannot parse it, so the parser
 * welds several fields into one `binary_expression` and `lhs.text` becomes the whole run.
 *
 * Whitespace is tested per CHARACTER (`ch.trim() === ""`), the same predicate `collapseSpace`
 * uses, so a Unicode space is layout here too. `#` is included because a Julia identifier cannot
 * contain it, so its presence in a candidate key is proof the text is source rather than a name.
 */
function hasLayout(text: string): boolean {
  for (const ch of text) if (ch.trim() === "" || ch === "#") return true
  return false
}

/**
 * THE MACRO'S NAME, when error recovery has welded the call's ARGUMENTS into the
 * `macro_identifier` node.
 *
 * Measured, whole corpus (941 `.jl` files, `validation/m14/fixtures/julia/key-shape-census.ts`):
 * after the symbol-name half of this defect was fixed (0 span symbol names), TWO published `calls`
 * targets were still source spans with the macro's arguments welded onto the name —
 * `"atomic anynonpass::UInt8\n\n    results_lock::ReentrantLock\n    results::Vector"`
 * (stdlib/Test/src/Test.jl:1523, really `@atomic`) and `"eval begin\n    B57267"`
 * (test/syntax.jl:4301, really `@eval`). A macro identifier is ONE token, so whitespace inside
 * that node is proof of error recovery, and the macro's real name is its FIRST token — the text
 * still opens with the token the source spelled.
 *
 * WHY PROJECT THE FIRST TOKEN RATHER THAN REFUSE THE KEY: a target carrying a newline is dropped
 * downstream by `pool-worker.ts`'s garbage-target filter, so refusing here would DELETE a call the
 * source really makes — the LUA-13 defect class, where a payload masquerading as a name silently
 * removes an edge from the graph. Reading the first token keeps the call and names it with the
 * only token that is a name. The guard still refuses when the recovered first token is itself
 * un-name-like (`#`, or a sigil-only remnant), because then there is no name to keep.
 *
 * Zero regex, like every predicate in this file: the scan is char-code whitespace, and `hasLayout`
 * is the same per-character predicate the rest of the lane's key-publication rule uses.
 */
function macroNameOf(text: string): string {
  const t = stripSigil(text, "@")
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    if (c === 10 /* \n */ || c === 13 /* \r */ || c === 9 /* \t */ || c === 32 /* space */) {
      const first = t.slice(0, i)
      return hasLayout(first) ? "" : first
    }
  }
  return hasLayout(t) ? "" : t
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
   * see `docs/analyzers/julia.md` for the counts and the probe that produces them.
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

  /**
   * THE FOURTH PARAMETER IS NEW, AND ITS ABSENCE WAS A WIRING GAP OF EXACTLY THE KIND THIS PROGRAMME
   * HAS NOW FOUND THREE TIMES: `engine.ts` passes an `AnalyzeContext` to every analyzer, python's once
   * stopped at three parameters so the companion "never reached it at all", and this analyzer did the
   * same — the context was available at every call site and dropped here. It is ADDITIVE: a caller that
   * passes nothing gets the previous behaviour byte for byte, which is what the five fixtures assert.
   */
  analyze(rootNode: Node, content: string, filePath: string, context?: ASTEngine.AnalyzeContext): ASTEngine.ParseResult {
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
      // A DECLARATION THAT LIVES IN A SCOPE HAS A QUALIFIED NAME AS WELL AS A BARE ONE, and until
      // 2026-10-09 it published only the bare one. That is the measured cause of the biggest pure
      // KEY-SHAPE residual in this lane: every `contains` edge targets its member by bare name, so
      // a member name that occurs anywhere else in the project (`value`, `name`, `x`, `f`) leaves
      // the edge ambiguous BY CONSTRUCTION even though the edge's own SOURCE names the owner and
      // the analyzer has the owner in hand. The incoming gate's resolution model matches a target
      // against the project's key space of `name + qualifiedName`; with no alias published, there
      // was no key that could name one member (measured: 0 qualifiedName aliases indexed, and
      // `contains` 7,162 of 14,329 edges ambiguous).
      //
      // The alias is `ownerName.name` — the SAME string the `contains` edge now targets, because an
      // edge whose target is not a published key resolves to nothing. It is additive: the gate
      // counts a symbol's alias as THE SAME declaration, never a second one, so no bare-name count
      // moves.
      if (s.ownerName && !s.qualifiedName) s.qualifiedName = `${s.ownerName}.${s.name}`
      // THE PACKAGE MODULE, for a DECLARATION AT FILE SCOPE in a file that opens no `module` block.
      // Additive in the same sense as the owner alias above: the gate counts a symbol's qualifiedName
      // as the SAME declaration, so no bare-name count moves — and the binding it names is one this
      // lane previously left unnamed, which is why a call to it read as ambiguous against a name
      // coincidence instead of resolving to the package's generic function.
      else if (!s.ownerName && !fileDeclaresModule && packageName) s.qualifiedName = `${packageName}.${s.name}`
      symbols.push(s)
      this.declaredSymbolKinds.set(s.name, s.kind)
    }
    /**
     * The key a `contains` edge targets. It MUST equal the symbol's own `qualifiedName` above, or
     * the edge names nothing at all — which is worse than the ambiguity it replaces. A member with
     * no owner keeps the bare name, which is also what its symbol publishes.
     */
    const memberKey = (owner: string, name: string): string => (owner ? `${owner}.${name}` : name)
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
    // The MODULES this file declares, for the same reason: a QUALIFIED constructor call is a
    // construction of a same-file type only when its qualifier is a module of this file.
    // `atinvokelatest.Xs(...)` in `julia/test/misc.jl` builds this file's `Xs`; `Dates.DateTime(...)`
    // in `base/toml/parser.jl` builds DATES' DateTime and merely shares a leaf with the internal
    // `struct DateTime` declared 13 lines earlier. Matching on the leaf alone confuses the two: the
    // first read as `calls` and the second as `instantiates`, and both directions were measured as
    // wrong by the direct oracle on a 200-file draw.
    const declaredModules = new Set<string>()
    {
      const collect = (n: Node) => {
        if (TYPE_DECLARATIONS.has(n.type)) {
          const head = this.firstNamedChildOfType(n, "type_head")
          const name = head ? this.typeHeadName(head) : ""
          if (name) declaredTypes.add(name)
        }
        if (n.type === "module_definition") {
          const nm = n.childForFieldName("name")
          const m = nm ? nm.text.trim() : ""
          if (m) declaredModules.add(m)
        }
        for (const c of this.namedChildren(n)) collect(c)
      }
      collect(rootNode)
    }

    // The LOCAL BINDINGS of this file — parameters, loop, let and catch variables — collected in a
    // pre-pass for the same reason `declaredTypes` is: the decision is made about edges emitted
    // earlier in the walk, and a binding introduced later in the file still binds.
    //
    // WHY THIS EXISTS. A call or reference whose target is a binding names a VALUE, not a
    // declaration: `f(x) = f(x)` where `f` is a parameter is a call through the argument, and no
    // name-keyed graph can resolve it — measured on this corpus, 8,779 of the lane's unresolved
    // edges are exactly this shape. The family already has the fix and this lane adopts it rather
    // than inventing one: `BINDING_SEP` (`src/ast/types.ts:190`) with `metadata.localBinding`, which
    // `real-php-analyzer.ts:3131` and `real-dart-analyzer.ts:2781` both landed. The separator makes
    // the target UNSPEAKABLE as a declaration, which is what turns "I could not resolve this" into
    // a statement a consumer can act on — and the gate arms the falsifier on the spelling: a marked
    // edge whose target carries NO separator is `bindingRefuted`, counted in `bindFAIL`.
    //
    // THE SLICE IS DELIBERATELY NARROW, and the first version was NOT narrow enough: a FILE-WIDE
    // binding set marked 5,959 edges, of which 1,660 had been RESOLVED — because a parameter of one
    // function shadowed the same spelling in another. Parameters are therefore keyed BY THEIR
    // FUNCTION, which is julia's own scoping rule, and only `calls` and `references` with a BARE
    // target are touched. `uses` is excluded because its target is a MEMBER name, and a dotted
    // target because a qualified path is not a local binding.
    // THIS FILE'S OWN FACTS for the package-module rule (see `juliaPackageName`): does it declare a
    // `module` block anywhere, and what is the package it belongs to. Both are read BEFORE the walk
    // because `pushSym` runs during it and a `module` declared LATER in the file would otherwise be
    // invisible to a declaration that precedes it.
    let fileDeclaresModule = false
    {
      const scan = (n: Node) => {
        if (n.type === "module_definition") fileDeclaresModule = true
        for (const c of this.namedChildren(n)) if (!fileDeclaresModule) scan(c)
      }
      scan(rootNode)
    }
    const packageName = juliaPackageName((context as any)?.projectRoot)

    const bindingsByScope = new Map<string, Set<string>>()
    {
      const bindName = (b: Node | null | undefined): string => {
        if (!b) return ""
        if (b.type === "identifier") return b.text.trim()
        if (b.type === "typed_expression" || b.type === "unary_typed_expression") {
          // `::Ctx` is an ANONYMOUS argument: its only child is the TYPE, so reading child 0 as a
          // binding publishes a parameter named `Ctx` and then retargets every reference to the
          // type into `overdub\0Ctx`. A declaration needs TWO children: the name and its type.
          const ks = this.namedChildren(b)
          if (ks.length < 2) return ""
          return bindName(ks[0])
        }
        // A KEYWORD PARAMETER IS A `named_argument`, NOT A `parameters` WRAPPER. F1
        // (grammar audit) reported `parameters` as an unregistered node-type literal:
        // this grammar has no such node — it is another grammar family's vocabulary.
        // The construct the branch was reaching for IS real and the grammar spells it
        // `named_argument`: `f(a; x=1, y::Int=2)` parses as
        // `argument_list(identifier, named_argument(identifier, operator, …),
        // named_argument(typed_expression(identifier, identifier), operator, …))`
        // (dumped from the wired wasm), whose first child is the binding target.
        // Naming the real construct is the fix, not deleting the branch: without it a
        // keyword parameter is not collected as a local binding, so a bare reference
        // to it in the body is not claimed as a local. Pinned by
        // `validation/m14/fixtures/julia/dispatch-and-hierarchy`.
        if (b.type === "splat_expression" || b.type === "named_argument") {
          const inner = this.pos(b, 0)
          return inner ? bindName(inner) : ""
        }
        if (b.type === "juxtaposition_expression" || b.type === "parenthesized_expression") {
          const inner = this.pos(b, 0)
          return inner ? bindName(inner) : ""
        }
        return ""
      }
      const add = (scope: string, n: string): void => {
        if (!scope || !n) return
        const set = bindingsByScope.get(scope) ?? new Set<string>()
        set.add(n)
        bindingsByScope.set(scope, set)
      }
      const addParams = (call: Node | null, scope: string): void => {
        if (!call || !scope) return
        const args = this.namedChildren(call).find((c) => c.type === "argument_list")
        if (!args) return
        for (const a of this.namedChildren(args)) add(scope, bindName(a))
      }
      /**
       * THE SCOPE A DECLARATION OPENS, mirrored from the walk's own `activeScope` rules: a module,
       * a type, a function/macro, or the short-form `f(x) = …` assignment. The parameter set is
       * keyed by that name, because julia scoping is what makes the claim true: a parameter binds
       * inside ITS function, and a call elsewhere in the file to the same spelling is a different
       * question.
       */
      const scopeOf = (n: Node): string => {
        if (n.type === "module_definition") {
          const nn = n.childForFieldName("name")
          return nn ? nn.text.trim() : ""
        }
        if (n.type === "struct_definition" || n.type === "abstract_definition" || n.type === "primitive_definition") {
          const head = this.firstNamedChildOfType(n, "type_head")
          return head ? this.typeHeadName(head) : ""
        }
        if (n.type === "function_definition" || n.type === "macro_definition") {
          const sig = this.firstNamedChildOfType(n, "signature")
          return sig ? this.signatureName(sig) : ""
        }
        if (n.type === "assignment") {
          const lhs = this.pos(n, 0)
          if (!lhs) return ""
          const u = this.unwrapWhere(lhs)
          return u.type === "call_expression" ? (this.calleeName(u) ?? "") : ""
        }
        return ""
      }
      const collect = (n: Node, scope: string): void => {
        const inner = scopeOf(n) || scope
        if (n.type === "signature") {
          // A `signature` does not always hold the callable directly: `function f(x)` gives
          // `signature > call_expression`, while `Object{K,V}() where {K,V}` gives
          // `signature > where_expression > call_expression` — the census measured that trap and
          // reading the shape positionally found 14 signatures in one file and 0 parameters in it.
          let cur: Node | null = n
          for (let i = 0; i < 4 && cur && cur.type !== "call_expression"; i++) {
            cur = this.namedChildren(cur).find(
              (c) => c.type === "call_expression" || c.type === "where_expression" || c.type === "parenthesized_expression",
            ) ?? null
          }
          addParams(cur && cur.type === "call_expression" ? cur : null, inner)
        }
        if (n.type === "assignment") {
          const lhs = this.pos(n, 0)
          if (lhs) {
            const u = this.unwrapWhere(lhs)
            addParams(u.type === "call_expression" ? u : null, inner)
          }
        }
        for (const c of this.namedChildren(n)) collect(c, inner)
      }
      collect(rootNode, "")
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
    // Whether `activeScope` names a CONTAINER (module or type) or a BODY (function/macro/closure).
    // A body's locals are bindings, not members: the fleet's standing rule (C# M12.07
    // LocalsAreNotSymbols, and Swift's SWIFT4b `contains Type -> local` sweep) is that a
    // declaration whose lexical owner is a body is local and carries no `contains` edge. The
    // first implementation advanced `activeScope` for functions but left the containment guard on
    // `if (scope)`, so every local function and local variable inside a method became a member of
    // that method. Measured on the 40-file whole-population draw: 27 unexplained `contains` rows,
    // e.g. `expand_versions -> vnum` and `write_html -> size_threshold_msg`.
    let containerScope = true
    let depth = 0

    const walkStack: { node: Node; activeScope: string; containerScope: boolean; inMacroBody: boolean; isExit: boolean }[] = [{ node: rootNode, activeScope: "", containerScope: true, inMacroBody: false, isExit: false }]

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
        containerScope = frame.containerScope
        this.inMacroBody = frame.inMacroBody
        continue
      }
      const scope = frame.activeScope
      // THE FRAME'S OWN VALUE, not the variable's. A stack-walked visitor needs the per-node value
      // on the FRAME or a per-child difference cannot be expressed at all: every child pushed with a
      // different `containerScope` was silently read back as the parent's, so `@testset` bodies kept
      // their membership edges for two rounds of edits that looked correct. `activeScope` needs no
      // such line because it is only ever read through the exit-frame restore below.
      containerScope = frame.containerScope
      // The exit frame must restore the scope this node was ENTERED with, not the one its handler
      // may have advanced to. Capturing both here is what makes a function's `containerScope=false`
      // end at the function body instead of leaking to every later sibling in the module.
      const parentContainerScope = containerScope
      // `inMacroBody` needs the same treatment as the scope: the exit frame must restore the value
      // this node was ENTERED with. It was pushed after the handler had already set the flag for a
      // macro definition, so exiting a macro restored `true` and every later sibling in the file was
      // analysed as if it were quoted macro code — which silently skipped `global`/`local`
      // declarations. Measured on `Compiler.jl`: 23 symbols and a missing `BuildSettings.MAX_METHODS`.
      const parentInMacroBody = this.inMacroBody

      switch (node.type) {
        // ---------------------------------------------------------------- modules
        case "module_definition": {
          // `module` and `baremodule` are the same node with a different first token. The `name`
          // field is the ONLY field in this grammar's module rule, so it is read by field and
          // everything else in the file is positional.
          const nameNode = node.childForFieldName("name")
          // A SPLICED MODULE NAME IS NOT A NAME. `@eval module $(Symbol(name)) … end` puts an
          // `interpolation_expression` in the `name` FIELD, and reading the field's TEXT published
          // the splice itself as a module symbol — the direct oracle read
          // `contains $(Symbol(name)) -> var"@K_str"` in `julia/JuliaLowering/test/utils.jl`, an
          // owner whose name is a source expression. `nameOf` refuses a node that names nothing,
          // which is the same rule the type-head and callee guards already apply.
          const name = nameNode ? this.nameOf(nameNode) : ""
          if (name) {
            pushSym({
              name,
              kind: ASTEngine.SymbolKind.Module,
              range: this.range(node),
            complexity: this.complexity(node),
              ownerName: scope || undefined,
              metadata: { juliaSpecific: true, isBareModule: this.firstNamedChildType(node) === "baremodule" },
            })
            if (scope && containerScope) relationships.push(this.rel(scope, ASTEngine.RelationshipType.Contains, memberKey(scope, name), node, 1.0))
            activeScope = name
            containerScope = true
          }
          break
        }

        // ---------------------------------------------------------------- type declarations
        case "abstract_definition":
        case "primitive_definition":
        case "struct_definition": {
          const nameNode = this.firstNamedChildOfType(node, "type_head")
          // `@eval struct $T … end` DECLARES NO NAME THE TREE CAN SPELL. The head is an
          // `interpolation_expression` whose only child is the loop variable, so reading through it
          // published a type named `T` (Dates) or `typ` (LibGit2) — five real structs collapsed onto
          // one fabricated owner, their fields hung off it, and the real names (`Year`, `git_time`)…
          // absent. The same refusal the supertype path already applies, at the declaration site: a
          // name the tree cannot spell is a name to REFUSE, not a name to guess.
          const headInner = nameNode ? this.pos(nameNode, 0) : null
          if (headInner && headInner.type === "interpolation_expression") break
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
          if (scope && containerScope) relationships.push(this.rel(scope, ASTEngine.RelationshipType.Contains, memberKey(scope, name), node, 1.0))

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
          containerScope = true

          // The SUBTYPE edge, and it is the only inheritance Julia has. `struct S <: A` puts a
          // `where`-less `binary_expression` (or a `comparison_operator` chain) between the type
          // head and the supertypes; `abstract type` uses the same shape.
          for (const sup of this.supertypesOf(node)) {
            // A SELF-SUPERTYPE IS NOT A RELATION, IT IS A REFUSAL. `struct Foo <: Foo` is a
            // declaration julia rejects at definition time — `a type cannot subtype itself` — and
            // the edge it published said only that Foo is Foo. MEASURED: 2 corpus sites, both in
            // julia's own tests of that error (`test/errorshow.jl:1533`, `test/typegroup.jl:721`),
            // and the direct oracle refuses `f === t` by construction, so every one of them was an
            // unexplained edge on a worksheet.
            if (sup === name) continue
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
            relationships.push(this.rel(name, ASTEngine.RelationshipType.Contains, memberKey(name, field.name), field.node, 1.0))
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
              //
              // THE CALLEE, NOT THE WHOLE CALL. Registering the `call_expression` put every
              // PARAMETER ANNOTATION under the guard too, because the argument list is the call's
              // child: `f(dfs::Union{AbstractVector{X}, Tuple{Y, Vararg{Z}}})` published `Union` and
              // dropped `AbstractVector`, `Tuple` and `Vararg` — 4 rows in one `DataFrames.jl`
              // signature on a 200-file draw. The 5-hop ancestor budget hid it: the annotations sit
              // five levels below the call, exactly one hop past the limit, so the suppression looked
              // like it only ever applied to the signature's own name.
              const callee = this.pos(callable, 0)
              this.typeHeadSites.add(callee ? callee.id : callable.id)
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
          if (scope && containerScope) relationships.push(this.rel(scope, ASTEngine.RelationshipType.Contains, memberKey(scope, name), node, 1.0))
          activeScope = name
          containerScope = false
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
          // `Dims{N} = NTuple{N,Int}` — A PARAMETRIC ALIAS DECLARES A TYPE NAME, and it is neither a
          // call (a short-form method) nor a plain binding, so this case skipped it: `Base.Dims`,
          // `Base.AbstractVecOrTuple`, `Flux._ParallelONE` and `StaticArrays.SizedMatrix` published
          // no symbol and no `contains` row, while the truth oracle derived all of them. MEASURED: 43
          // sites over the whole population, every one this shape (`grep -E '^Name{…} = '`), and
          // every one a member the direct oracle read as MISSING. The base is the NAME; the `{…}` is
          // a parameter list, the same split `nameOf` already makes for `const X{T} = …`.
          if (lhs.type === "parametrized_type_expression") {
            // THE WRAPPER IS THE DECLARATION. `const RestrictedBasis{B} = …` is a `const_statement`
            // whose inner assignment this walk also reaches, and the const case already published
            // its Constant — publishing a second, Class symbol for the same name made the name
            // NON-UNIQUE in the file, which silently disabled the own-key retarget: every bare
            // reference inside `module I31703` stayed bare while the truth oracle qualified it
            // (`I31703.RestrictedBasis`), 8 unexplained + 8 missing rows on one file. Same rule as
            // the plain-binding branch below.
            const wrapper = node.parent ? node.parent.type : ""
            if (wrapper === "const_statement" || wrapper === "global_statement" || wrapper === "local_statement") break
            const base = this.pos(lhs, 0)
            const alias = base && base.type === "identifier" ? base.text.trim() : ""
            if (!alias || IMPLICIT_OR_CONSTANT.has(alias)) break
            if (!containerScope) break
            pushSym({
              name: alias,
              kind: ASTEngine.SymbolKind.Class,
              range: this.range(node),
              complexity: this.complexity(node),
              ownerName: scope || undefined,
              metadata: { juliaSpecific: true, declarationForm: "parametric_alias" },
            })
            if (scope) relationships.push(this.rel(scope, ASTEngine.RelationshipType.Contains, memberKey(scope, alias), node, 1.0))
            break
          }
          if (lhs.type !== "call_expression") {
            // A PLAIN MODULE-LEVEL BINDING. `suite = BenchmarkGroup()` at a module's top level
            // creates `Mod.suite` exactly as `const suite = …` would — Julia gives a top-level
            // assignment a global binding in its module, with or without `const` — and this case
            // handled only the CALL-headed short form, so those bindings were invisible.
            // MEASURED: 43 missing `contains` rows on the 200-file direct draw, and every one of
            // them this shape: `TestJoin -> name/job/outer/right/left/inner/semi/anti`
            // (`DataFrames.jl/test/join.jl:13-29`), `ResolveTest -> vlst` (`Pkg.jl/test/resolve.jl:21`),
            // `BenchmarkMatMul -> suite/mul_wrappers` (`StaticArrays.jl/benchmark/bench_mat_mul.jl:8-10`)
            // and `TestUndocumentedNames -> results` (`Aqua.jl/test/test_undocumented_names.jl:10`).
            //
            // THE SCOPE TEST IS LEXICAL, not `containerScope`: a `let`, a loop body or a
            // short-form function body does not reset that flag, and a binding written in one is
            // LOCAL. `inModuleBindingScope` walks the ancestors instead. `containerScope` is asked
            // as well because a macro's arguments are opaque by construction.
            // A BINDING WRAPPED IN A `const`/`global`/`local` STATEMENT IS THAT STATEMENT'S
            // DECLARATION, and it is already published by the case above. Publishing it again here
            // would give one binding TWO symbols of different kinds (`Constant` and `Variable`),
            // which makes the name non-unique and silently disables the reference retarget —
            // measured: 9 references to module `const`s stopped being qualified and read as
            // unexplained rows. The wrapper IS the declaration; this branch is for the bare form.
            const wrapper = node.parent ? node.parent.type : ""
            if (wrapper === "const_statement" || wrapper === "global_statement" || wrapper === "local_statement") break
            if (!containerScope) break
            const binding = this.plainModuleBinding(node)
            if (!binding || IMPLICIT_OR_CONSTANT.has(binding)) break
            pushSym({
              name: binding,
              kind: ASTEngine.SymbolKind.Variable,
              range: this.range(node),
              complexity: this.complexity(node),
              ownerName: scope || undefined,
              metadata: { juliaSpecific: true, declarationForm: "module_assignment" },
            })
            if (scope) relationships.push(this.rel(scope, ASTEngine.RelationshipType.Contains, memberKey(scope, binding), node, 1.0))
            break
          }
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
          if (scope && containerScope) relationships.push(this.rel(scope, ASTEngine.RelationshipType.Contains, memberKey(scope, name), node, 1.0))
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
          containerScope = false
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
          //
          // THAT FIX WAS NOT ENOUGH, and the census is what showed it. It unwrapped exactly one
          // node type, so every OTHER shape whose `.text` is not a name kept publishing a span —
          // 50 symbol names carrying whitespace or a comment across 33 files, the largest 16,207
          // characters. `nameOf` below resolves the binding position to the declaration's OWN
          // NAME through every wrapper the grammar can put there, and returns "" for a node that
          // does not name anything, which is a REFUSAL rather than a fabricated key.
          const name = this.nameOf(lhs)
          if (!name || IMPLICIT_OR_CONSTANT.has(name)) break
          // `global x` DECLARES A MODULE BINDING AT ANY NESTING, which is the whole meaning of the
          // keyword: `struct _UNDEF; global const UNDEF = _UNDEF.instance; end` declares `Compiler`'s
          // `UNDEF`, not a member of `_UNDEF`. The owner was the nearest container, so the type
          // published a constant it does not have. MEASURED: `julia/base/rounding.jl`'s nine
          // `global const JL_FE_*`, `julia/test/syntax.jl`'s `x2`/`x4`/`x5`/`x6`, and `_UNDEF` — 14
          // of the whole-population draw's unexplained `contains` rows, all one keyword.
          // A `global` WITH NO ENCLOSING MODULE BELONGS TO THE UNIT'S TOP-LEVEL SCOPE, NOT TO THE
          // BODY IT IS WRITTEN IN. The fallback was `|| scope`, which named the enclosing FUNCTION:
          // `@eval m begin function foo(); global var = 1; end end`
          // (`julia/stdlib/REPL/test/replcompletions.jl:2086`) published `contains foo -> var`, and
          // `var` is not a member of `foo` — a `global` declaration can never be. When the tree
          // does not spell the module (the `m` here is a runtime `Module()` value), the honest owner
          // is the file's top-level scope, which is where this analyzer already puts a bare
            // top-level declaration. Found by the direct oracle: the one unexplained `contains` row
          // on the 200-file draw.
          const isGlobal = node.type === "global_statement" || this.hasToken(node, "global")
          const owner = isGlobal ? this.enclosingModuleName(node) : scope
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
            ownerName: owner || undefined,
            metadata: { juliaSpecific: true, binding: node.type.replace("_statement", "") },
          })
          // A `global` declaration is a member of its MODULE even when it is written inside a type
          // body or a macro argument, so the containment guard's `containerScope` does not apply to
          // it: the keyword is what puts the binding in the module.
          if (owner && (isGlobal || containerScope)) relationships.push(this.rel(owner, ASTEngine.RelationshipType.Contains, memberKey(owner, name), node, 1.0))
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
            // The `imports` RELATIONSHIP, which this lane previously declined and then RULED.
            //
            // The ruling's stated overturn condition was "a julia `imports` relationship row that is
            // not an import-site artifact — a row whose source is the importing declaration rather
            // than the literal `root`". That shape is not hypothetical: it is what
            // `src/ast/real-python-analyzer.ts:979` already emits for `import a.b`, and what the
            // Lua, YAML, Nim and TypeScript lanes emit. `RelationshipType.Imports` serializing to
            // `"brain_import"` (`src/ast/types.ts:69`) constrains no lane at all — every one of
            // them writes through the same string. So the argument for declining was a convention
            // mistaken for a constraint, and the corpus had the answer all along:
            // 1,675 `import_statement`/`using_statement` nodes across 504 of the 971 admitted files.
            //
            // SOURCE is the declaration doing the importing (`scope`), because `using X` inside
            // `module M` binds `X` in `M` and in no other scope — that is a parse fact, not a guess.
            // A top-level `using` in a file with no enclosing module falls back to the file's own
            // synthetic scope, which is the same scope the `References` row above already uses.
            relationships.push(
              this.rel(scope || "root", ASTEngine.RelationshipType.Imports, t.name, node, 1.0, {
                juliaSpecific: true, importForm: node.type, isExternal: !t.name.startsWith("."),
                importRenamed: t.renamed === true,
              }),
            )
          }
          break
        }

        case "export_statement":
        case "public_statement": {
          // `public` and `export` are CONTEXTUAL KEYWORDS in julia: they are keywords only when a
          // name list follows. `public = expr` declares a local variable named `public`, and the
          // production grammar gives it a `public_statement` node anyway — measured over the whole
          // admitted corpus, 49 of the 3,570 import/export statements carry an ERROR descendant, and
          // these two are the ones where the STATEMENT NODE ITSELF is wrong rather than one part of
          // it:
          //
          //   Documenter.jl/src/expander_pipeline.jl:632  `public = get(fields, :Public, true)`
          //   julia/stdlib/REPL/src/docview.jl:408         `public = Base.ispublic(binding.mod, …)`
          //
          // Both published `exports` edges for names the file never exports — `fields`, `private` and
          // a bare `:` in the first (a function-local variable and a slice marker), and a FUNCTION
          // PARAMETER named `binding` in the second. A fabricated edge is the most expensive thing an
          // analyzer can produce: it is counted `unexplained` by every oracle and it becomes wrong
          // refactoring advice in `bb_impact`, where a fake export is a fake dependency.
          //
          // THE DISCRIMINATOR, and why it is not "contains an ERROR": both trees begin with an ERROR
          // node whose first anonymous child is the `=` token, because the parser found no name list
          // to attach. The two GENUINE `public` statements that also carry an ERROR descendant both
          // begin with a real `identifier` — `public Test_y, Text_x, …` in
          // `julia/stdlib/REPL/test/replcompletions.jl:21` (~55 real exported names) and
          // `@compat(public, (Losses, Train, …))` in `Flux.jl/src/Flux.jl:55` (~60 more). So
          //
          //   "the first NAMED child of an export/public statement is an ERROR" ⇒ there is no name
          //   list ⇒ this is a binding assignment, not an export.
          //
          // Refuses exactly 2 statements corpus-wide and keeps the ~115 names the two genuine ones
          // carry. The 45 ERROR-bearing IMPORT statements are a different case and are NOT refused —
          // those are legitimate julia the grammar cannot fully parse (`import .Base.Math.@horner`,
          // in julia's own stdlib), the module path around the unparsed part still parses, and
          // refusing them would trade 45 real edges for 2 fabricated ones.
          if (this.namedChildren(node)[0]?.type === "ERROR") break
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
            // The `exports` RELATIONSHIP, which this lane previously declined and then RULED.
            //
            // The ruling's overturn condition was "an `exports` relationship count above the
            // `ExportInfo` count for the same corpus". Emitting one row per `ExportInfo` entry
            // cannot exceed it, so that condition was unfalsifiable in the direction that mattered
            // — it could only be satisfied by an edge that was WRONG. The real objection in the
            // ruling survives and is honoured here: `export X` declares nothing, so this edge
            // asserts no kind. It runs `owning module -> exported binding name`, which is
            // `src/ast/real-python-analyzer.ts:1166` emitting `ctx.exports.push(...)` and
            // `pushRel(ctx.moduleName, exportName, Exports, 1.0)` from the same `__all__` walk.
            //
            // It is emitted unconditionally rather than gated on the name already being in
            // `symbols`, because Julia allows `export X` to PRECEDE the declaration of `X` and this
            // walk is single-pass — a gate here would drop every export that precedes its
            // declaration, which is the majority form in a module that groups its exports at the
            // top. The target name is the same string the declaration will publish, so the edge
            // resolves against the file's FINAL symbol table; the census measures the real rate.
            relationships.push(
              this.rel(scope || "root", ASTEngine.RelationshipType.Exports, name, node, 1.0, {
                juliaSpecific: true, exportForm: node.type, declaresNothing: true,
              }),
            )
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
          // `include("path")` is Julia's FILE INCLUSION, not a call to a project function.
          //
          // The contract (`src/ast/types.ts`, PartOf): a library unit includes a part file; the
          // part shares the including unit's single scope and has no module identity of its own.
          // Julia's `include` is exactly that — it evaluates the file INSIDE the including module
          // — and the lane's own closure arm already measures the population (1,034 include sites,
          // 1,014 targets resolved over 1,985 files). It was published as `calls -> include`, a
          // call to a builtin that names no dependency, so the file relation was absent.
          //
          // R3, NOT R2: the served grammar already carries the construct (`call_expression` with a
          // `string_literal` argument), so no published build is missing it and no patch would add
          // a fact the tree does not already hold. A literal path publishes `part_of`; an
          // expression path (a variable, `joinpath(...)`) names no part and stays a CALL, marked
          // `isDynamicInclude`, because the graph must not invent a file the source does not name.
          if (callee === "include") {
            const part = this.includePart(node)
            if (part) {
              relationships.push(this.rel(scope || GLOBAL_SCOPE, ASTEngine.RelationshipType.PartOf, part.target, node, 1.0, {
                partRole: "library",
                partPath: part.path,
                partSymbol: part.target,
                isJuliaInclude: true,
              }))
              break
            }
            relationships.push(this.rel(scope || GLOBAL_SCOPE, ASTEngine.RelationshipType.Calls, callee, node, 1.0, {
              juliaSpecific: true,
              isInclude: true,
              isDynamicInclude: true,
            }))
            break
          }
          // A CONSTRUCTOR CALLED THROUGH A NAMESPACE still constructs the type this file declares:
          // `atinvokelatest.Xs(Any[...])` in `julia/test/misc.jl` builds `Xs`, declared three lines
          // into the module above it. The bare-name test missed it and published a `calls` edge for a
          // construction, which the `instantiates` oracle reads as a MISSING row. The LEAF is also the
          // target when it is a same-file type: that is the spelling the type's own symbol carries,
          // and a qualified target whose module is not part of the declared name is the same binding
          // written twice.
          const dot = callee.indexOf(".")
          const qualifier = dot > 0 ? callee.slice(0, dot) : ""
          const ctorLeaf = dot > 0 ? callee.slice(callee.lastIndexOf(".") + 1) : callee
          const sameFileCtor = dot > 0 && declaredModules.has(qualifier) && declaredTypes.has(ctorLeaf)
          const isCtor = declaredTypes.has(callee) || sameFileCtor || TYPE_DECLARATIONS.has(callee)
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
              sameFileCtor ? ctorLeaf : callee,
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
          // `macroNameOf`, not `stripSigil(nameNode.text, "@")`: the node's text is a NAME only
          // while the grammar kept the callee a single token. See its docstring — two corpus
          // macros recovered as a welded span and published the whole argument region as a target.
          const name = nameNode ? macroNameOf(nameNode.text) : ""

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
          // A MACRO APPLIED TO A DECLARATION IS `decorates`, NOT A CALL. Julia's macros run at
          // expansion time and are applied to the syntax they wrap: `@inline function f`, `@kwdef
          // struct S`, `@doc "…" function g`, `@inline h(x) = x`. The direction is the contract's
          // (`src/ast/types.ts`, Decorates): source = the DECORATED DECLARATION, target = the
          // DECORATOR. The macro name is often imported (`Base.@kwdef`), so a target that does not
          // resolve is a wall for the arm, not a reason to reverse the edge. A macro whose
          // arguments contain no declaration is a real macro CALL and stays `calls`.
          const decorated = this.decoratedDeclarations(node)
          if (decorated.length > 0) {
            for (const d of decorated) {
              relationships.push(this.rel(d.name, ASTEngine.RelationshipType.Decorates, name, node, 1.0, {
                decoratorName: name,
                decoratedKind: d.kind,
                isMacroDecorator: true,
              }))
            }
            break
          }
          relationships.push(this.rel(scope || GLOBAL_SCOPE, ASTEngine.RelationshipType.Calls, name, node, 1.0, { juliaSpecific: true, isMacroCall: true }))
          break
        }

        // ---------------------------------------------------------------- type annotations
        case "unary_typed_expression":
        case "typed_expression": {
          // `x::Int` — POSITIONAL: child 0 is the name, child 1 the type. The TYPE is the
          // reference; the left side is a binding or a read, and a struct body's bare `x::T` was
          // already published as a field above and must not also become a read here.
          // THE TEXT IS THE DISCRIMINATOR for an anonymous annotation. `x::T` has two children
          // (name, type); `::T` has one. But `::Type{<:Strider{T}}` parses as a two-child node whose
          // FIRST child is the base name `Type` and whose second is the curly tail `{<:…}` — with
          // no name before the `::`. Reading child 1 named the type after its PARAMETER (`Strider`)
          // and lost `Type`. An annotation whose text begins `::` has no left-hand name, so child 0
          // is the type base.
          const typedKids = this.namedChildren(node)
          // `unary_typed_expression` is the grammar's node for `::T` — the ordinary spelling of an
          // anonymous typed argument. The typed case had no label for it, so `::Type{<:Strider{T}}`
          // emitted neither `Type` nor `Strider` from the annotation; the only Strider row came from
          // the child parametrized case, which is why the missing target was always the base.
          const anonymous = node.type === "unary_typed_expression" || node.text.trimStart().startsWith("::")
          const typeNode = anonymous ? typedKids[0] : typedKids.length >= 2 ? typedKids[1] : typedKids[0]
          const typeName = typeNode ? this.typeRefName(typeNode) : ""
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
              for (const link of this.subtypeChainLinks(b)) {
                relationships.push(this.rel(link.from, ASTEngine.RelationshipType.Extends, link.to, link.at, 1.0,
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
          const whereKids = this.namedChildren(node)
          const lastWhereKid = whereKids[whereKids.length - 1]
          for (const child of whereKids) {
            if (child.type === "curly_expression") {
              for (const inner of this.namedChildren(child)) {
                for (const link of this.subtypeChainLinks(inner)) {
                  relationships.push(this.rel(link.from, ASTEngine.RelationshipType.Extends, link.to, link.at, 1.0, { juliaSpecific: true, isSubtype: true, isWhereBound: true }))
                }
              }
              continue
            }
            if (child.type !== "binary_expression") continue
            // A `where` WRAPPED AROUND A COMPARISON IS NOT A BOUND. The pinned grammar makes the
            // `where` the OUTERMOST node and puts the type variable after the expression, for both
            // a real bound and a comparison that the grammar cannot tell apart by shape alone:
            //
            //   f(x::T) where T<:Real            -> (where_expression (call) (binary T<:Real))
            //   @test typeintersect(A,B) <: T{X} where T
            //                                    -> (where_expression (binary …) (identifier T))
            //
            // The distinguishing POSITION is the binary's: a real bound is the where's LAST named
            // child, a comparison is its FIRST, with the variable after it. Before this, the
            // analyzer published `typeintersect extends Tuple` (`julia/test/subtype.jl:2769`) — a
            // subtype relation read off a test assertion's comparison.
            //
            // THE EXCEPTION IS A PARAMETER LIST, and it is stated as a position too: a chain whose
            // OWN `where` scopes only its braces — `Pair{N, S} where {N, NTuple{N,Int}<:S<:NTuple{M,Int}
            // where {M}}` (`subtype.jl:2939`) — is a BOUND chain inside an outer curly, with the
            // chain FIRST and its braces last. It is a member of a parameter list, so its links are
            // bounds; the same shape at statement or macro-argument level is a UnionAll VALUE whose
            // chain is a comparison, and publishes nothing.
            if (child !== lastWhereKid && node.parent?.type !== "curly_expression") continue
            // `>` is not a bound operator; `>:` is. The test said `">"`, so an UPPER bound written
            // `T>:Int` was skipped — a real Julia form, and the oracle derives it.
            // NO `scope` guard here, and its absence was a defect: this edge's SOURCE is the
            // type parameter — not the enclosing scope. The guard was copy-pasted from the
            // `contains` cases, where the scope IS the source and the check is the point. So it
            // suppressed a valid edge whenever the bound appeared at FILE SCOPE, which is 71.9% of
            // Julia files. Found by the F5 `extends` oracle: `base/rational.jl` publishes
            // `T extends AbstractFloat` and `base/hashing.jl` `UTF8Units extends AbstractString`,
            // both at file scope, and the analyzer had neither.
            for (const link of this.subtypeChainLinks(child)) {
              relationships.push(this.rel(link.from, ASTEngine.RelationshipType.Extends, link.to, link.at, 1.0, { juliaSpecific: true, isSubtype: true, isWhereBound: true }))
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
          // Both spellings of a quoted operator member (`x.:(==)`, `x.:<`) go through ONE resolver,
          // which unwraps the `:`/parens to the operator name. The earlier inline version read the
          // quote's first child, so `:(==)` published `(==)` while `:+` published `+` — three
          // spellings of one binding across the read path, the definition path and the call path.
          const memberName = member.type === "quote_expression" ? this.quotedName(member) : member.text.trim()
          if (!memberName) break
          relationships.push(this.rel(scope || GLOBAL_SCOPE, ASTEngine.RelationshipType.Uses, memberName, node, 0.9,
            { juliaSpecific: true, isFieldRead: true, isOperatorMember: member.type !== "identifier" }))
          break
        }
      }

      // Recurse with the (possibly advanced) scope, and push an exit frame so `depth` tracks
      // nesting. The scope is advanced for the CHILDREN of the node that advanced it, which is
      // what makes `contains` ownership correct for a module or a function body.
      walkStack.push({ node, activeScope: scope, containerScope: parentContainerScope, inMacroBody: parentInMacroBody, isExit: true })
      const childScope = activeScope
      // A MACRO DECIDES THE SCOPE OF ITS OWN ARGUMENTS, so membership does not pass through one.
      // `@testset "…" begin f(x) = … end` expands its body under a local scope, and the analyzer
      // attributed every declaration written there to the enclosing module — 31 of the 200-file
      // draw's unexplained `contains` rows, the largest class by far (`TestJoin -> simple_df`,
      // `PipeLineTests -> build_doc`, `ResolveTest -> idx`, `T59244 -> asdf`). The same walk claimed
      // `@test_throws`, `@testitem`, `@view` and every user macro, none of which this file can see
      // the expansion of. The exceptions are the scope-transparent macros above, and a declaration
      // the macro is applied DIRECTLY to — `@kwdef struct S`, `@inline f(x) = x` — which is written
      // in source and whose `decorates` edge already records the application.
      let opaqueArgs: Set<number> | null = null
      // TWO LEVELS, because an argument can sit in either one: a block argument
      // (`@testset "…" begin … end`) is a `compound_statement` inside the macrocall's
      // `macro_argument_list`, so marking the arguments at the macrocall alone is one level too high
      // — the list is pushed as a child, and its children would inherit the module scope again.
      const opaqueArgsOf = (parent: Node): Set<number> => {
        const set = new Set<number>()
        for (const c of this.namedChildren(parent)) {
          if (c.type === "macro_identifier" || c.type === "macro_argument_list") continue
          if (!this.directDeclarationArg(c)) set.add(c.id)
        }
        return set
      }
      if (node.type === "macrocall_expression" && !this.macroIsScopeTransparent(node)) {
        opaqueArgs = opaqueArgsOf(node)
      }
      if (node.type === "macro_argument_list" && node.parent &&
          node.parent.type === "macrocall_expression" && !this.macroIsScopeTransparent(node.parent)) {
        opaqueArgs = opaqueArgsOf(node)
      }
      depth++
      // 
      // A TYPE'S HEAD IS AN EXPRESSION, NOT A BODY, and a declaration written in one is nobody's
      // member. `struct S <: (global g; g(::S) = 1; Any)` (`julia/test/typegroup.jl:652`, julia's own
      // test of the error that construct raises) published `contains S -> g`: the method's lexical
      // owner became the type because the head inherits the type's scope. The same inheritance
      // applies to a FIELD's type expression — `x::(struct Inner; y::Outer; end; Inner)`
      // (`typegroup.jl:626`) published `contains Outer -> Inner` — because a struct body is a
      // container and every descendant inherited that.
      //
      // MEASURED: a declaration in a type position is 3 sites in the whole 1,985-file population
      // (last count: 1 in a type head, 2 in a struct field's type), and all three are in julia's own
      // tests of invalid code. So the rule costs nothing and removes a `contains` edge that says a
      // member exists where the language has no member.
      //
      // The declaration is still PUBLISHED (its symbol and its own edges stand — the source states
      // it, and its scope is the enclosing one); only MEMBERSHIP is refused. A nested container
      // resets the flag for its own children, which is why `contains Inner -> y` still publishes.
      const fieldTypeChild = node.type === "typed_expression" && node.parent &&
        (node.parent.type === "struct_definition") ? this.pos(node, 1) : null
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const c = node.namedChild(i)
        if (!c) continue
        const typePositionChild =
          ((node.type === "struct_definition" || node.type === "abstract_definition" ||
            node.type === "primitive_definition") && c.type === "type_head") ||
          (fieldTypeChild ? c.id === fieldTypeChild.id : false)
        walkStack.push({ node: c, activeScope: childScope, containerScope: (typePositionChild || opaqueArgs?.has(c.id)) ? false : containerScope, inMacroBody: this.inMacroBody, isExit: false })
      }
    }

    // ---------------------------------------------------------------- dedup
    // Law 3: O(1) map deduplication. Symbols key on `kind:owner:name`; relationships key on
    // `type|source->target` so that a `calls` and an `instantiates` for the same pair are two
    // different facts and never collapse into one row.
    const symbolMap = new Map<string, ASTEngine.UniversalSymbol>()
    for (const s of symbols) symbolMap.set(`${s.kind}:${s.ownerName || ""}:${s.name}`, s)
    const uniqueSymbols = [...symbolMap.values()]

    /**
     * A BARE `references` TARGET WHOSE NAME THIS FILE DECLARES EXACTLY ONCE IS RETARGETED TO THAT
     * DECLARATION'S QUALIFIED KEY — and this is a REFERENCE, not a guess, because the alias belongs
     * to the same symbol.
     *
     * MEASURED FIRST (census.ts §THE references SPLIT, whole 1,985-file population, raw
     * validation/m14/fixtures/julia/measurements/census-references-split-2026-10-10.txt):
     * `references` is 50,149 edges, 17,428 ambiguous and 17,686 unresolved; the php-shaped
     * scope-key rule that the fleet repeats reaches 161 of them (1.0%), and the dotted-leaf rule
     * reaches 1,988 but would RE-POINT 68 already-resolved edges at a DIFFERENT symbol — dropped
     * for that reason. The own-key rule is different in kind: the file's own declaration publishes
     * `owner.name` as an alias OF ITSELF, so `Circle` and `Geom.Circle` are two keys for one
     * declaration. Ceiling: 2,046 ambiguous edges.
     *
     * MONOTONE, WHICH IS THE ARGUMENT FOR TAKING IT. If the bare name resolves to exactly one
     * declaration in the project, then the alias of that same declaration also resolves to exactly
     * one — the edge cannot move out of `resolved`, it can only resolve to the same symbol through
     * a second key. If the bare name is ambiguous, the alias either picks out the file's own
     * declaration or is itself ambiguous, in which case the edge is no worse than before. So the
     * rule can move edges ambiguous -> resolved and nothing else, which is the one direction the
     * residual bar counts.
     *
     * THE GUARDS, each of them a way the inference could be wrong:
     *   - the name must be declared EXACTLY ONCE in this file. Two declarations of one name (a
     *     top-level one and a nested one) means the file itself cannot say which the reference
     *     names, and the rule stands down.
     *   - that single declaration must carry a qualified name. A file-scope declaration has no
     *     owner to qualify it with, and its bare name is already the answer.
     *   - dotted targets are untouched. `A.B.C` is a different question — the leaf rule that would
     *     reach those is the one measured to re-point 68 resolved edges, and it is not taken here.
     *   - `references` only. The same rule for `calls` and `uses` is a separate measurement: a call
     *     to a name this file declares may still be a local binding or a dispatched method.
     *
     * Placed BEFORE the dedup below, so a retarget that collides with an existing edge collapses
     * into it instead of publishing the same fact twice.
     */
    const declsByName = new Map<string, ASTEngine.UniversalSymbol[]>()
    for (const s of uniqueSymbols) {
      const list = declsByName.get(s.name) ?? []
      list.push(s)
      declsByName.set(s.name, list)
    }

    /**
     * THE BINDING SPELLING, applied BEFORE the reference retarget and therefore before the dedup.
     *
     * ORDER IS NOT COSMETIC HERE: a parameter of the enclosing function SHADOWS a file-scope
     * declaration of the same spelling (julia's own scoping rule), so a local binding must be
     * claimed FIRST. Measured: with the own-key retarget running first, the target was renamed to
     * its qualified spelling and 8 `isTypeReference + localBinding` edges lost their binding claim
     * (bindOK 875 -> 867) — they became resolutions to the WRONG thing instead of claims about the
     * right one.
     *
     * Only `calls` and `references`, only a BARE target, and only a binding THIS FILE introduces:
     * `localBindings` above holds this file's parameters, loop, let and catch variables and nothing
     * else, so "this target is a value, not a declaration" is a claim the analyzer can prove from
     * the file it was handed. A dotted target is left alone (a qualified path is not a local
     * binding — and the census's same-file examples are full of dotted paths whose LEAF merely
     * coincides with a parameter name, which is exactly the shape this restriction excludes), and
     * `uses` is left alone because its target is a MEMBER name.
     */
    if (bindingsByScope.size > 0) {
      for (const r of relationships) {
        if (r.type !== ASTEngine.RelationshipType.Calls && r.type !== ASTEngine.RelationshipType.References) continue
        const tgt = String(r.target ?? "")
        if (!tgt || tgt.includes(".") || tgt.includes(BINDING_SEP)) continue
        if (!bindingsByScope.get(String(r.source ?? ""))?.has(tgt)) continue
        r.target = `${r.source}${BINDING_SEP}${tgt}`
        r.metadata = { ...(r.metadata ?? {}), localBinding: true }
      }
    }

    for (const r of relationships) {
      if (r.type !== ASTEngine.RelationshipType.References) continue
      const tgt = String(r.target ?? "")
      if (!tgt || tgt.includes(".")) continue
      const decls = declsByName.get(tgt)
      if (!decls || decls.length !== 1) continue
      const q = decls[0]!.qualifiedName
      if (typeof q === "string" && q) r.target = q
    }

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
    /**
     * THE EXTERNAL CLAIM ON AN IMPORT MUST BE FALSIFIABLE, and for a DOTTED target it is not — so
     * this lane stops making it there.
     *
     * `isExternal` is attached in the import case as `!t.name.startsWith(".")`: a claim about the
     * PROJECT read off one target's spelling, by an analyzer that sees one file. The gate reads it
     * only where the target names nothing in the project, and then refutes it when the target's
     * OWNER is a project declaration. MEASURED on the whole 1,985-file population (census.ts §THE
     * imports EXTERNAL CLAIMS, cross-checked against the gate): of 347 dotted claims, 239 are
     * REFUTED (205 extFAIL + 3 unverifiable) and 108 are verified — the claim is FALSE 69% of the
     * time. Every one of the lane's refuted edges is dotted; a bare target's claim is read only
     * where the target is already absent, so it can never be refuted at all.
     *
     * Neither shape can be grounded from one file: the root of `using Graphs.SimpleGraphs` is
     * declared in ANOTHER file of the Graphs project, and no per-file fact distinguishes that from
     * `using Changelog.CommonMark` in a project that does not contain Changelog. So the dotted claim
     * is dropped rather than asserted, and the edge reads `unresolved` — an open gap, which is what
     * it is. The cost is measured and stated: 108 verified dotted claims become unresolved, and the
     * must-be-zero extFAIL column goes to 0. A claim that is wrong 69% of the time and cannot be
     * checked by its own author is not evidence, and dropping it is not the same as hiding it.
     *
     * BARE claims are KEPT, and the reason is recorded rather than assumed: they are read only where
     * the target is absent, so this gate cannot falsify them either — but they are now read at fleet
     * level as "the analyzer said so", not as project confirmation (a fleet ruling of 2026-10-10),
     * and dropping julia's 2,411 of them would move edges for no correctness gain in THIS gate.
     * Julia's version of a checkable basis is its stdlib surface; that belongs with the gate's
     * `claimBasis` check, not before it.
     *
     * A same-file guard is kept as well: a file that DECLARES the root of an import (`module Graphs`
     * in the same file as `using Graphs.SimpleGraphs`) cannot call it external, and that is a basis
     * the gate can check independently. It reached 4 edges on its own — recorded because a rule that
     * was tried and measured small is a measurement, not a failure.
     */
    // A FILE THAT DECLARES `include` SHADOWS THE BUILTIN: the rows above are then calls to that
    // declaration, not file inclusions. This is a conservative whole-file test (a symbol named
    // `include` anywhere in the file), and it is the safe direction: a false positive turns a real
    // inclusion into a call, while the opposite publishes a `part_of` for a file the source never
    // named. The fixture `julia/part-of-include` carries a planted shadow and a forbid row, so the
    // guard is shown firing rather than assumed to be unreachable.
    const includeOwners = new Set(
      uniqueSymbols
        .filter((s) => s.name === "include" && s.kind !== ASTEngine.SymbolKind.Module)
        .map((s) => s.ownerName ?? ""),
    )
    if (includeOwners.size > 0) {
      for (const r of uniqueRelationships) {
        const md = r.metadata as Record<string, unknown> | undefined
        if (!md || md.isJuliaInclude !== true) continue
        // SCOPED, NOT FILE-WIDE: a module that declares `include` shadows the builtin for ITS
        // OWN code, not for the file around it. The first version used a whole-file test and the
        // fixture caught it — the nested `Shadowed.include` turned the module's two real
        // inclusions into calls. The owner chain is the scope test: an empty owner is a file-scope
        // declaration and shadows everything; otherwise the call's source must be that owner or
        // one of its descendants.
        const src = String(r.source ?? "")
        const shadowed = [...includeOwners].some((owner) => owner === "" || src === owner || src.startsWith(owner + "."))
        if (!shadowed) continue
        r.type = ASTEngine.RelationshipType.Calls
        r.target = "include"
        r.metadata = { juliaSpecific: true, isInclude: true, isShadowedInclude: true }
      }
    }
    const declaredNames = new Set(uniqueSymbols.map((s) => s.name))
    for (const r of uniqueRelationships) {
      if (r.type !== ASTEngine.RelationshipType.Imports) continue
      const md = r.metadata as Record<string, unknown> | undefined
      if (!md || md.isExternal !== true) continue
      const tgt = String(r.target ?? "")
      const dot = tgt.indexOf(".")
      const dotted = dot > 0
      const root = dotted ? tgt.slice(0, dot) : tgt
      if (dotted || declaredNames.has(root)) md.isExternal = false
    }
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

  /**
   * Is this macro ARGUMENT itself a declaration — the form a decorator applies to?
   *
   * The same shapes `decoratedDeclarations` admits, asked from the other side: a long-form
   * definition, or a short-form `f(x) = …` assignment whose left-hand side unwraps to a call. Used
   * to keep `@kwdef struct S` a module member while everything inside `@testset begin … end` is not.
   */
  /** Is this macro one whose arguments are evaluated in the scope they are written in? */
  private macroIsScopeTransparent(macrocall: Node): boolean {
    const m = this.firstNamedChildOfType(macrocall, "macro_identifier")
    return SCOPE_TRANSPARENT_MACROS.has(m ? macroNameOf(m.text) : "")
  }

  private directDeclarationArg(arg: Node): boolean {
    if (arg.type === "function_definition" || arg.type === "macro_definition" ||
        arg.type === "struct_definition" || arg.type === "abstract_definition" ||
        arg.type === "primitive_definition" || arg.type === "module_definition") return true
    if (arg.type !== "assignment") return false
    const lhs = this.pos(arg, 0)
    const u = lhs ? this.unwrapWhere(lhs) : null
    return !!u && u.type === "call_expression"
  }

  /**
   * The declarations a macro is APPLIED TO, read from its own `macro_argument_list`.
   *
   * `@doc "…" function g` puts the declaration after a string; `@kwdef mutable struct S` puts it
   * first; `@inline h(x) = x` is the short form, whose declaration is the ASSIGNMENT's left-hand
   * call. The scan is over the argument list, not the first child, because a macro that decorates a
   * declaration can also carry a docstring or a configuration expression before it. A macro with no
   * declaration argument returns [] and stays a `calls` edge — `@time f()` runs a call, it does not
   * decorate a declaration.
   */
  private decoratedDeclarations(call: Node): { name: string; kind: string }[] {
    const args = this.namedChildren(call).find((c) => c.type === "macro_argument_list")
    if (!args) return []
    // A RECOVERED SPAN IS NOT AN ARGUMENT LIST, and harvesting one published hundreds of false
    // `decorates` rows. MEASURED on `julia/Compiler/test/irpasses.jl`: a `@nospecialize(T)` inside a
    // function signature came back as a macrocall spanning 1,660 lines with **309 direct children**,
    // so every declaration in the rest of the file was read as decorated by `@nospecialize` (the
    // whole `Foo30594`/`Bar29983`/`Base.:(+)` block included). A decorator macro takes a handful of
    // arguments — a docstring plus a declaration, a configuration expression plus a block — and the
    // corpus's real ones read 1-3 here. `@eval begin … end` is one child, `@doc "…" function f` two.
    // Above this bound the node is the parser's recovery of a broken region, and the honest reading
    // is "no argument list", which leaves the macro as the CALL it is.
    if (this.namedChildren(args).length > 4) return []
    const out: { name: string; kind: string }[] = []
    const seen = new Set<string>()
    const add = (name: string, kind: string): void => {
      const n = name.trim()
      if (!n || seen.has(n)) return
      seen.add(n)
      out.push({ name: n, kind })
    }
    for (const arg of this.namedChildren(args)) {
      if (arg.type === "function_definition" || arg.type === "macro_definition") {
        const sig = this.firstNamedChildOfType(arg, "signature")
        add(sig ? this.signatureName(sig) : "", arg.type)
      } else if (arg.type === "struct_definition" || arg.type === "abstract_definition" || arg.type === "primitive_definition") {
        const head = this.firstNamedChildOfType(arg, "type_head")
        add(head ? this.typeHeadName(head) : "", arg.type)
      } else if (arg.type === "module_definition") {
        const nameNode = arg.childForFieldName("name")
        add(nameNode ? nameNode.text : "", arg.type)
      } else if (arg.type === "assignment") {
        // Short-form declaration `h(x) = x`; the LHS is a call_expression, and the function's name
        // is its callee. A plain `x = 1` is a binding, not a declaration a decorator applies to.
        const lhs = this.pos(arg, 0)
        const u = lhs ? this.unwrapWhere(lhs) : null
        if (u && u.type === "call_expression") add(this.calleeName(u) ?? "", "short_function")
      }
    }
    return out
  }

  /**
   * The PART an `include("path")` names, or null when the argument is not one literal string.
   *
   * THE TARGET IS THE BASENAME WITH ITS EXTENSION (`b.jl`), the spelling bash's BD2 module symbol
   * uses, and the path as written is kept in `metadata.partPath`. A path is not a symbol name; the
   * arbiter resolves target STRINGS against symbols, so the basename is the only spelling a file's
   * own module symbol could carry. The written path is evidence, never a silent replacement.
   *
   * REJECTED, each because it does not name a part: a string with an interpolation or an escape
   * sequence (the bytes are not the path), a path ending at a separator (no basename), `.`/`..`, and
   * every non-`string_literal` argument (`joinpath(...)`, a variable, a `raw"…"`). A rejected
   * literal is a DYNAMIC include and stays a call with `isDynamicInclude` — a different, true fact.
   */
  private includePart(call: Node): { path: string; target: string } | null {
    const args = this.namedChildren(call).find((c) => c.type === "argument_list")
    if (!args) return null
    const first = this.namedChildren(args)[0]
    if (!first || first.type !== "string_literal") return null
    if (this.namedChildren(first).some((c) => c.type === "string_interpolation" || c.type === "escape_sequence")) return null
    const text = first.text
    let body = ""
    if (text.startsWith('"""') && text.endsWith('"""') && text.length >= 6) body = text.slice(3, -3)
    else if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) body = text.slice(1, -1)
    else return null
    if (!body || body.endsWith("/") || body.endsWith("\\")) return null
    const cut = Math.max(body.lastIndexOf("/"), body.lastIndexOf("\\"))
    const target = body.slice(cut + 1)
    if (!target || target === "." || target === "..") return null
    return { path: body, target }
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
   * A `<:` / `>:` CHAIN states one subtype fact per ADJACENT PAIR, and both ends must be NAMES.
   *
   * `A where LB <: X <: UB` parses as `(binary (binary LB <: X) <: UB)`. The previous code read
   * `left.text` for the source, so it published an `extends` edge whose SOURCE was `LB <: X` — a
   * source fragment is not a symbol, and the edge can resolve to nothing. MEASURED on the whole
   * 1,985-file population by `direct-oracle-check.ts`: 25 of the 25 unexplained `extends` rows carry
   * either a fragment source (`LB <: X`, `X <: f()`, `S <: V`) or a doubled target (`UB.UB`), and
   * every one of the first ten is in `julia/JuliaLowering/test/typedefs_ir.jl` — a file of deliberate
   * lowering-error probes whose `where` chains the grammar recovers around. The same defect occurs
   * in a WELL-FORMED chain, which is the reason it is fixed rather than filed as an ERROR-shape
   * artefact: a fragment source is a lie the graph tells on any file that writes the chain.
   *
   * The rule, stated rather than inferred: flatten the chain left to right, emit `a -> b` and
   * `b -> c`, take each source with `typeHeadName` (never `.text`), and take each target through
   * `boundTypeName`, which REFUSES a call/literal bound — `X <: f() <: Z` is a lowering error, and
   * naming `f` as a type would invent a relation the source says is invalid.
   */
  private subtypeChainLinks(node: Node): { from: string; to: string; at: Node }[] {
    const out: { from: string; to: string; at: Node }[] = []
    const link = (left: Node | null, right: Node | null, at: Node) => {
      // BOTH ENDS GO THROUGH THE BOUND RESOLVER. `typeHeadName` accepts a CALL through its
      // first-identifier fallback, which is right for a declaration head and wrong for a chain
      // operand: `A where X <: f() <: Z` (`julia/JuliaLowering/test/typedefs_ir.jl:92`, a file of
      // deliberate lowering-error probes) makes the middle operand a call, and the fallback
      // published `f extends Z` — a type relation built from a function call. The direct oracle
      // refused it (`calleePath` has no call case) and only this side had the row, which is what
      // MEASURED it as one of the 25 unexplained `extends` rows on the whole population.
      const from = left ? this.boundTypeName(left) : ""
      const to = right ? this.boundTypeName(right) : ""
      if (from && to && from !== to) out.push({ from, to, at })
    }
    const walk = (n: Node) => {
      if (n.type !== "binary_expression") return
      const { op, left, right } = this.binOperands(n)
      if (op !== "<:" && op !== ">:") return
      let fromNode = left
      if (left && left.type === "binary_expression") {
        const inner = this.binOperands(left)
        if (inner.op === "<:" || inner.op === ">:") {
          // The nested chain's own links come first; this link starts at its LAST operand, not at
          // the whole nested expression.
          walk(left)
          fromNode = inner.right
        }
      }
      link(fromNode, right, n)
    }
    walk(node)
    return out
  }

  /**
   * The name a subtype BOUND states, or "" when the tree states none.
   *
   * `typeHeadName` accepts a call expression through its first-identifier fallback, which is right
   * for a declaration head (`f(x) = …`) and wrong for a bound: `A where X <: f() <: Z` is a
   * lowering error, and publishing `f` as the supertype would invent a type relation the source
   * explicitly rejects. A bound is an identifier, a dotted path, or a parameterised/wrapped form of
   * one — anything else is refused.
   */
  private boundTypeName(node: Node | null): string {
    if (!node) return ""
    if (node.type === "identifier" || node.type === "operator") return node.text.trim()
    if (node.type === "macro_identifier") return macroNameOf(node.text)
    if (node.type === "field_expression") return this.fieldPath(node)
    if (node.type === "parametrized_type_expression" || node.type === "where_expression" ||
        node.type === "parenthesized_expression" || node.type === "curly_expression" ||
        node.type === "type_head") {
      return this.boundTypeName(this.pos(node, 0))
    }
    return ""
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
  private typeRefName(node: Node): string {
    // `$T` IN A TYPE POSITION names the interpolated BINDING. The splice is a runtime value, so the
    // type itself cannot be known — but the name inside it is the only static fact the source
    // states, and it is a real dependency (`rows_inds::$T1` inside `for T1 in (:AbstractVector, …)`
    // really does refer to whatever `T1` holds). The analyzer published nothing for it, so every
    // generated annotation read as a missing `references` row (5 on the 200-file draw: `T`, `T1`,
    // `T2`, `uname`, `sname`).
    //
    // This is a TYPE-REFERENCE rule and lives at the reference site rather than inside
    // `typeHeadName`: in a DECLARED position `struct $(T)` the same interpolation names nothing the
    // tree can spell, and reading `T` there would publish a type called after the loop variable.
    if (node.type === "interpolation_expression") {
      const inner = this.pos(node, 0)
      return inner ? this.fieldPath(inner) : ""
    }
    return this.typeHeadName(node)
  }

  private typeHeadName(node: Node): string {
    // AN INTERPOLATED NAME IS NOT A NAME, AND A DECLARED POSITION MUST NOT SPELL IT. `@eval struct
    // $T <: DatePeriod` (`julia/stdlib/Dates/src/types.jl:53`), `struct $n <: B33370`
    // (`julia/test/core.jl:3025`) and `struct $InterpName <: …` (`Compiler/test/newinterp.jl:31`)
    // all put an `interpolation_expression` where a name belongs; the splice is a runtime value and
    // the only static fact is the LOOP VARIABLE's spelling. The declaration case refuses a head
    // whose DIRECT child is an interpolation, but a head with a supertype is a `binary_expression`
    // whose left operand is the interpolation, so that guard missed it and the fallback below read
    // the loop variable as the type's name — publishing `T extends DatePeriod`, `n extends B33370`
    // and `InterpName extends AbstractInterpreter`, three relations from types the tree cannot
    // name. MEASURED on the whole population: 4 of the last unexplained `extends` rows.
    //
    // `typeRefName` intercepts interpolation BEFORE delegating here, which is why a reference
    // position (`rows_inds::$T1`) still publishes its dependency; only the DECLARED position and
    // the subtype operands refuse.
    if (node.type === "interpolation_expression") return ""
    // BASE CASE. A supertype is very often a bare `identifier`, and this function looks for
    // CHILDREN — so handed an identifier it found none and returned "". The effect was that
    // `struct Circle <: Shape` published no `extends` edge at all, on a file with zero ERROR
    // nodes, which is the quietest possible failure. The node being asked about may BE the name.
    if (node.type === "identifier") return node.text.trim()
    if (node.type === "macro_identifier") return macroNameOf(node.text)
    if (node.type === "operator") return node.text.trim()
    // A subtype/where chain: the declared name is on the LEFT, the bound on the right.
    if (node.type === "binary_expression") {
      const { left } = this.binOperands(node)
      // THE DECLARED NAME IS THE LEFT OPERAND AND NOTHING ELSE — no fallback to a sibling. The
      // identifier scans below look at THIS node's children, and for a binary expression the only
      // bare identifier among them is the SUPERTYPE: `struct $(T) <: AbstractPlatform` puts an
      // `interpolation_expression` on the left, so the fallback found `AbstractPlatform` and
      // `Pkg.jl/src/BinaryPlatformsCompat.jl` published a `class:AbstractPlatform` colliding with the
      // abstract type it extends, an `AbstractPlatform extends AbstractPlatform` self-row, and a
      // `references` retarget that qualified every real mention of the type to the fabricated member.
      // Found by the direct oracle as a self-`extends` row the truth side refuses; a name the tree
      // cannot spell is a name to REFUSE, which is the same key-publication rule as `quotedName`.
      return left ? this.typeHeadName(left) : ""
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
    // A DYNAMIC HEAD IS NOT A NAME, even when an identifier sits further in. `@eval struct
    // $(Symbol(:T58129, k)){T} end` puts an `interpolation_expression` at the base of a
    // `parametrized_type_expression`, and the identifier scan below found the TYPE PARAMETER `T` —
    // publishing `decorates T -> eval`, a declaration named after a parameter of a type the tree
    // cannot name. MEASURED: `julia/test/subtype.jl:2962`, the last unexplained `decorates` row on
    // the 300-file draw. Refuse rather than spell a splice.
    if (first && first.type === "interpolation_expression") return ""
    const direct = this.firstNamedChildOfType(node, "identifier")
    if (direct) return direct.text.trim()
    // `Vector{T}` — the base name is the first identifier under the curly expression. A base that is
    // a QUALIFIED path (`struct S <: TerminalMenus._ConfiguredMenu{TerminalMenus.Config}`) is a
    // `field_expression` there, not an identifier — and this loop's type list did not include it, so
    // the struct published NO `extends` edge at all for a qualified parametric supertype, while its
    // symbol and every other edge were present. Found by the direct oracle as the only missing
    // `extends` row on the 200-file draw.
    for (const c of this.namedChildren(node)) {
      if (c.type === "curly_expression" || c.type === "parametrized_type_expression" ||
          c.type === "binary_expression" || c.type === "field_expression") {
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

  /**
   * The nearest enclosing `module … end`, by name. Used by the `global` rule: the keyword declares a
   * MODULE binding at any nesting, so the owner is this module and not the nearest container.
   */
  private enclosingModuleName(node: Node): string {
    let cur: Node | null = node.parent ?? null
    while (cur) {
      if (cur.type === "module_definition") {
        const nm = cur.childForFieldName("name")
        return nm ? nm.text.trim() : ""
      }
      cur = cur.parent ?? null
    }
    return ""
  }

  /**
   * The binding name a PLAIN module-scope assignment declares, or "" when this is not one.
   *
   * Julia admits a top-level assignment with no `const` (`x = 1`) and it creates a global binding in
   * the module, which is what `contains` is for. Three things disqualify a node here, and each is a
   * different fact:
   *
   *   - it is not written in a module's own scope (a `let`, a loop, a short-form body, a type body);
   *   - its left side is not a NAME: `A.x = 1` assigns a field of another module, `a, b = 1, 2`
   *     destructures (the grammar's tuple LHS), and a call/`where` head is a method definition;
   *   - the name is a constant Julia implies (`nothing`, `missing`, …) rather than a binding.
   *
   * A `typed_expression` left side (`x::Int = 0`) is read through to its first child, the same rule
   * the `const` case applies: the annotation is a reference, not part of the name.
   */
  private plainModuleBinding(node: Node): string {
    if (!this.inModuleBindingScope(node)) return ""
    const lhs = this.pos(node, 0)
    if (!lhs) return ""
    const head = lhs.type === "typed_expression" ? this.pos(lhs, 0) : lhs
    if (!head) return ""
    if (head.type === "identifier" || head.type === "operator" || head.type === "prefixed_string_literal") {
      return head.text.trim()
    }
    return ""
  }

  /**
   * Is this node written in a MODULE's own scope — not inside a body, loop, `let` or quote?
   *
   * The scope-introducing constructs are Julia's own list, not a heuristic: a binding written inside
   * any of them is local to it. `begin`, `if` and `try` are transparent here (`if` is documented as
   * introducing no scope; a top-level `begin` is the module body continuing). A SHORT-FORM FUNCTION
   * is an `assignment` whose left side is a call, so the ancestor test has to recognise that shape
   * as a body — otherwise `f(x) = (y = 1; y)` would publish `y` as a member of the module.
   */
  private inModuleBindingScope(node: Node): boolean {
    let cur: Node | null = node.parent ?? null
    while (cur) {
      // `baremodule` is the SAME node, not a second one: the grammar has a single
      // `module_definition` rule whose first token is `choice('module', 'baremodule')`
      // (`grammars/tree-sitter-julia/grammar.js`), so a `baremodule_definition`
      // comparison could never match. It was the F1 finding "unregistered node-type
      // literal `baremodule_definition`" and is DELETED rather than replaced: the
      // `module_definition` branch above already answers for both spellings.
      if (cur.type === "module_definition") return true
      if (SCOPE_INTRODUCING_NODES.has(cur.type)) return false
      if (cur.type === "assignment") {
        const head = this.unwrapWhere(this.pos(cur, 0) ?? cur)
        const inner = head.type === "typed_expression" ? this.pos(head, 0) : head
        if (inner && inner.type === "call_expression") return false
      }
      cur = cur.parent ?? null
    }
    return false
  }

  /** The `call_expression` at a definition's head, through the wrappers a head can carry. */
  private definitionCall(head: Node): Node | null {
    let cur: Node | null = head
    for (let i = 0; i < 8 && cur; i++) {
      if (cur.type === "call_expression") return cur
      if (cur.type === "where_expression") cur = this.unwrapWhere(cur)
      else if (cur.type === "signature" || cur.type === "typed_expression" ||
               cur.type === "parenthesized_expression" || cur.type === "macro_argument_list") cur = this.pos(cur, 0)
      else return null
    }
    return null
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
    // `function @main(args::Vector{String})::Cint` — julia's ENTRY POINT spelling. The grammar puts
    // a `macrocall_expression` where the callable goes (the return type wrapped it in a
    // `typed_expression`), and no case below matches one, so `CompileMinInit` published NO `main`
    // symbol and no membership edge for the function the file exists to define. The name is the
    // macro's name: `@main` is julia's marker and the binding it declares is `main`, which is the
    // spelling `macroNameOf` already produces for every other macro name in this file.
    if (sig.type === "macrocall_expression") {
      const m = this.firstNamedChildOfType(sig, "macro_identifier")
      return m ? macroNameOf(m.text) : ""
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
    // UNBOUNDED TO THE DEFINITION BOUNDARY. The earlier version walked five ancestors, and depth is
    // a property of the SHAPE: `struct Fill{T, N, S<:NTuple{N,Integer}} <: AbstractArray{T,N}` puts a
    // bound's parameterised type six levels below the head, so `NTuple` was published as a
    // `references` row for a mention the head already carries as `S extends NTuple` — a duplicate
    // spell of one fact under two labels. A hop budget cannot answer "is this inside the head"; the
    // walk ends at the enclosing definition instead, and a `type_head` is always below it.
    while (cur) {
      if (this.typeHeadSites.has(cur.id)) return true
      if (cur.type === "function_definition" || cur.type === "macro_definition" ||
          cur.type === "module_definition" || cur.type === "source_file") return false
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
      // EACH ELEMENT'S OWN TEXT, not its first child. `(:malloc, :libc)` spells both as quotes, but
      // the LIBRARY is very often a bare BINDING — `ccall((:git_error_last, libgit2), …)`, which is
      // how every LibGit2 binding in julia's stdlib is written. An identifier has no children, so
      // the child-read returned "" for the library, the two-element test failed, and NO foreign edge
      // was published for the whole of `stdlib/LibGit2/src` — 5 of the direct oracle's 6 missing
      // `calls` rows on a 200-file draw. `:libc` and `libc` name the same library; stripping a
      // leading `:` when the element IS a quote keeps both spellings on one name.
      const elem = (q: any): string => {
        if (!q) return ""
        if (q.type === "quote_expression") {
          const inner = this.pos(q, 0)
          return inner ? stripSigil(inner.text.trim(), ":") : ""
        }
        return q.text.trim()
      }
      const parts = this.namedChildren(first).map(elem)
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
  /**
   * THE NAME A NODE DECLARES, or "" when the node names nothing.
   *
   * One resolver for every position that must publish a NAME — a binding's left-hand side, a
   * `where` bound's parameter — because the alternative is what this lane shipped: a `.text.trim()`
   * at each site, each of which is correct for the shapes its author had in mind and a source SPAN
   * for every other shape. The defect is not that any one site was careless; it is that "take the
   * node's text" is a rule that has no answer to "what if the node is not a name".
   *
   * The walk descends the LEFT-most positional child through every wrapper this grammar can place
   * around a declared name, and STOPS at a node it can spell:
   *
   *   typed_expression   `x::Int`        -> `x`      (child 1 is the type, a reference)
   *   binary_expression  `T<:Real`       -> `T`      (left operand; the right is a bound)
   *   parametrized_type  `Foo{T}`        -> `Foo`    (the base name, NOT the parameter list)
   *   field_expression   `A.B`           -> `A.B`    (the whole path is the identity)
   *   parenthesized/wrapped forms        -> their first child
   *
   * and returns "" for anything else — an `ERROR` node from a broken parse, a `tuple_expression`
   * (which declares SEVERAL names and is therefore not one name), a literal, a comment. A refusal
   * costs a symbol the grammar could not spell; publishing the node's text instead costs a key
   * that no lookup can ever match, which is strictly worse.
   *
   * MEASURED on the whole corpus by `validation/m14/fixtures/julia/key-shape-census.ts`.
   */
  private nameOf(node: Node, depth = 0): string {
    if (depth > 8) return ""
    switch (node.type) {
      case "identifier":
      case "operator":
        return node.text.trim()
      case "macro_identifier":
        return stripSigil(node.text, "@")
      case "scoped_identifier":
      case "field_expression":
      case "prefixed_string_literal":
        // `var"#_internal_julia_parse"` is a NAME in Julia, not a string expression. Without this
        // case `nameOf` fell through to a child identifier and published the function as `var`.
        return node.type === "prefixed_string_literal" ? node.text.trim() : this.fieldPath(node)
      case "quote_expression":
        return this.quotedName(node)
      case "typed_expression":
      case "unary_typed_expression":
      case "binary_expression":
      case "parenthesized_expression":
      case "where_expression":
      case "parametrized_type_expression":
      case "curly_expression": {
        const first = this.pos(node, 0)
        return first ? this.nameOf(first, depth + 1) : ""
      }
      default:
        return ""
    }
  }

  /**
   * The name a `quote_expression` spells — the OPERATOR for a quoted operator (`:(==)` → `==`), the
   * quoted symbol itself for a Symbol value (`:foo`), or "" when the node's text is a SPAN rather
   * than a spelling.
   *
   * The span rule is the whole point of the guard below. A `quote_expression` recovered over a
   * broken region spans the reparsed remainder of the file —
   * `julia/base/broadcast.jl`'s `:.>:` followed by the next line's `Expr(...)` came out as
   * `":.>:\n        Expr"` and was published as a FUNCTION's name, with seven relationships
   * sourced from it. A node whose text carries layout is not a name at all, so this refuses: the
   * inner symbol is not read either, because when the wrapper spans a region the parser did not
   * understand, the "inner operator" is whatever token it recovered on and spelling it would be a
   * fabricated name rather than a missing one.
   */
  private quotedName(node: Node): string {
    const t = node.text.trim()
    if (hasLayout(t)) return ""
    // A QUOTED OPERATOR NAMES THE OPERATOR, and the `:`/parens are syntax rather than the name.
    // `Base.:(==)` and `Base.:+` name the same two bindings as the call sites `==(a, b)` and
    // `a + b`, and the graph keys a binding by ONE spelling; keeping the wrapper published a second
    // name for one function — `M.Base.:(==)` beside every `==` edge — that nothing resolves to. It is
    // also UNREPRESENTABLE downstream: the universal target filter refuses a leaf carrying `(`, so
    // `contains M -> M.Base.:(<=)` was silently dropped while the symbol was still published, and the
    // direct oracle read that as a missing edge (3 rows in `julia/test/ranges.jl` alone).
    //
    // The unwrapped name is the OPERATOR CHILD, not a text edit: `:(==)` wraps a
    // `parenthesized_expression` around an `operator`, `:+` wraps the `operator` directly, and both
    // resolve to the same token. A quote that wraps an IDENTIFIER is unwrapped for the same reason:
    // in a NAME position `x.:(foo)` reads the member `foo`, and this resolver is only reached from
    // name positions. The layout guard above still refuses a span, and a quote whose inner is
    // neither a name nor an operator (a quoted EXPRESSION, `:(a + b)`) keeps its own text.
    const inner = this.pos(node, 0)
    const plain = (n: Node | null): string =>
      n && (n.type === "operator" || n.type === "identifier") && !hasLayout(n.text) ? n.text.trim() : ""
    if (inner) {
      const direct = plain(inner)
      if (direct) return direct
      if (inner.type === "parenthesized_expression") {
        const op = plain(this.pos(inner, 0))
        if (op) return op
      }
    }
    return t
  }

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
    // THE SPAN TRAP, and it is the one this function published: `node.text` is a name only while
    // the quote wraps a symbol. When error recovery puts a whole region inside the quote, the text
    // is a source span (`":.>:\n        Expr"`, 17 characters across two lines) and `quotedName`
    // refuses it rather than publishing a key no lookup can match.
    if (node.type === "quote_expression") return this.quotedName(node)
    if (node.type === "macro_identifier") return macroNameOf(node.text)
    // `var"…"` is a binding name, not a string expression.
    if (node.type === "prefixed_string_literal") return node.text.trim()
    if (node.type === "operator") return node.text.trim()
    // A TYPED RECEIVER keeps its BINDING name: `(ft::UnionAll).var.ub` is a path whose first link is
    // the local `ft`, and the absence of this case dropped the whole head — the path then published
    // as `var.ub`, a name that resolves to nothing and reads as a field of a variable that is not
    // there. Found by the direct oracle as an unexplained `references` row beside a missing one.
    if (node.type === "typed_expression" || node.type === "unary_typed_expression") {
      const inner = this.pos(node, 0)
      return inner ? this.fieldPath(inner) : ""
    }
    if (node.type === "where_expression" || node.type === "parenthesized_expression") {
      const inner = this.pos(node, 0)
      return inner ? this.fieldPath(inner) : ""
    }
    if (node.type === "field_expression") {
      const kids = this.namedChildren(node)
      const receiver = kids[0]
      const member = kids[kids.length - 1]
      // A `field_expression` with no children, or one recovered over a broken region, has no path
      // to spell. Refusing is the same rule as the quote case above: a span is not a name.
      if (!receiver || !member) return ""
      const head = this.fieldPath(receiver)
      const tail = this.fieldPath(member)
      return head && tail ? `${head}.${tail}` : head || tail || ""
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
      // A CALLABLE OBJECT IS NOT NAMED HERE. `function (pass::EnclosingParenHighlightPass)(input, ast,
      // context)` and `(::RegionHighlightPass)(…)` put a parenthesised EXPRESSION where the callee
      // goes; the expression evaluates to a value, and reading through it published the ARGUMENT
      // `pass` as a declared function and as a module member — one fabricated name, one fabricated
      // symbol, one fabricated `contains` row, and a second symbol that blocked the `references`
      // retarget for the type's real name. Only a plain name inside the parens is a declaration's
      // name: `(f)(x) = …` still declares `f`.
      if (calleeNode.type === "parenthesized_expression") {
        const inner = this.pos(calleeNode, 0)
        // Only a VALUE is refused: `(pass::X)`, `(::X)`, `($f)`. A parenthesised NAME or OPERATOR is
        // a name — `(f)(x) = …` declares `f`, and `(:)(1, 2)` calls the colon function (and
        // `(/)(a, b)` the slash), which is how julia invokes an operator whose spelling cannot be a
        // bare callee. Refusing every parenthesised callee dropped those three calls.
        // `(T::Type{Wrap1{X}} where X)(x)` puts a `where_expression` around the typed value, so the
        // refusal has to look through it. Without the unwrap the where-form fell through to
        // `fieldPath`, which found the type VARIABLE and published `contains Wrap1 -> T` — the same
        // fabricated declaration the plain form had already been fixed for.
        // THE UNWRAP MUST STOP AT THE TYPED PATTERN, and `unwrapWhere` does not: it walks through
        // `typed_expression` as one more wrapper, so `(t::Type{Model} where X)(x) = …` unwrapped
        // past the pattern to the BINDING `t` and the guard below never saw a typed node. Measured:
        // that spelling published `function t` and a `contains M -> M.t` row the direct oracle read
        // as unexplained. Only the `where`/`parenthesized` wrappers are walked here, because the
        // question is "what does the paren wrap", and a typed pattern is the answer, not a wrapper.
        let base = inner
        for (let i = 0; i < 4 && base &&
             (base.type === "where_expression" || base.type === "parenthesized_expression"); i++) {
          base = this.pos(base, 0)
        }
        if (base && (base.type === "typed_expression" || base.type === "unary_typed_expression" ||
            base.type === "interpolation_expression")) return null
        // A SPLICED MEMBER IS DYNAMIC TOO. `(Base.$fJ)(x::Rational{BigInt}, …) = …` in
        // `julia/base/gmp.jl` names the overloaded function through a loop variable, and the paren
        // guard above saw a `field_expression` (not an interpolation) and let `fieldPath` read the
        // RECEIVER — publishing `contains MPQ -> Base`, a module named as a member of another one,
        // beside a truth row that correctly derived nothing. Any splice in the callee makes the
        // declared name unknowable from the source, which is this file's standing rule for quote
        // spans and interpolated heads.
        if (base && this.subtreeHasInterpolation(base)) return null
      }
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

  /**
   * Does this subtree splice a runtime value (`$x`) into a NAME?
   *
   * A splice is not a spelling: `(Base.$fJ)(… ) = …` declares whichever binding the loop variable
   * holds, and the source never names it. Walking the subtree rather than testing the top node is
   * the point — the splice sits under a `field_expression` member, one level below the paren that
   * `calleeName` inspects.
   */
  private subtreeHasInterpolation(node: Node): boolean {
    if (node.type === "interpolation_expression") return true
    for (const c of this.namedChildren(node)) if (this.subtreeHasInterpolation(c)) return true
    return false
  }

  /**
   * The supertype a type head STATES — the head's own `<:`, and never a comparison inside it.
   *
   * THE HEAD IS A WALL, NOT A ROAD, and this function used to descend it looking for `<:` at any
   * depth. Two facts made every one of those edges wrong in a different way:
   *
   *   - a `<:` inside a supertype EXPRESSION is a COMPARISON, not a subtype of the declared type.
   *     `struct S <: (S <: Real ? Any : Real)` published `S extends Real` — the CONDITION's right
   *     operand read as the supertype, `1 of 1` corpus sites in `julia/test/typegroup.jl:665`.
   *   - a `<:` chain inside a `where` clause bounds a PARAMETER (`(AbstractArray{T, N} where T <:
   *     Integer where N)`), which the `where_expression` case below publishes with `T` as the
   *     source; descending here also published `Foo extends N` and `Foo extends Integer`.
   *
   * Both were found by the direct oracle (`validation/m14/fixtures/julia/direct-oracle-check.ts`),
   * whose own rule has been "the head's top-level binary, and the operand must NAME a type" since
   * it was written — a second derivation of the same fact that disagreed, which is the only reason
   * a reader could see it.
   *
   * A PARAMETER's bound is still published, by the `parametrized_type_expression`/
   * `where_expression` cases, with the parameter as the source. That is a fact about `T`, not about
   * the type, and it is a different edge.
   */
  private supertypesOf(node: Node): string[] {
    const head = this.firstNamedChildOfType(node, "type_head")
    if (!head) return []
    const bin = this.firstNamedChildOfType(head, "binary_expression")
    if (!bin) return []
    const { op, right } = this.binOperands(bin)
    if ((op !== "<:" && op !== ">:") || !right) return []
    const name = this.supertypeName(right)
    return name ? [name] : []
  }

  /**
   * The NAME a supertype operand spells, or "" when the operand is a computed VALUE.
   *
   * MEASURED over the whole 1,985-file population (validation/m14/measurements/julia-supertype-
   * shapes.json): 1,313 of the 1,324 `<:` sites in a type head are a NAME — identifier 891,
   * `parametrized_type_expression` 346 (`AbstractVector{T}`), `field_expression` 76
   * (`Base.AbstractSet`) — and the remaining 11 are the shapes below, every one of which this
   * function REFUSES rather than guesses:
   *
   *   - `$typ <: $sup` (3, `julia/stdlib/LibGit2/src/types.jl:1084`): a runtime VALUE. The old
   *     fallback published the interpolation's own identifier, `typ extends sup` — 3 edges saying a
   *     type is a subtype of a loop variable.
   *   - a statement BLOCK `(global g; g(::S) = 1; Any)` (2, `julia/test/typegroup.jl:652`): the
   *     value is its last statement, `Any`, which happens to be a type — but the operand as written
   *     states no name, and the block also DEFINES a method, which the walker published as
   *     `contains S -> g`.
   *   - `typeof(Core.apply_type)` (1), `0x01` (1), `@NamedTuple{x::Int}` (1), a TERNARY (1), and a
   *     `where` chain (2) — a call, a literal, a macro call, a conditional and a UnionAll. The old
   *     fallback read the call's CALLEE as the supertype (`Foo extends typeof`,
   *     `julia/test/errorshow.jl:1540`) and the first bare identifier it could find inside the
   *     others.
   *
   * A parenthesised NAME is still a name (`struct S <: (Any)`), and a `where`/`parametrized` wrapper
   * is unwrapped to the type it is built from (`Tuple{T} where T` names `Tuple`, which is what the
   * oracle derives and what a reader can follow). What is inside a CURLY parameter list is never
   * read as the supertype: those are the type's ARGUMENTS.
   */
  private supertypeName(node: Node): string {
    switch (node.type) {
      case "identifier":
      case "operator":
        return node.text.trim()
      case "field_expression":
        return this.fieldPath(node) || ""
      case "parametrized_type_expression":
      case "curly_expression":
      case "parenthesized_expression":
      case "where_expression": {
        const inner = this.pos(node, 0)
        return inner ? this.supertypeName(inner) : ""
      }
      default:
        return ""
    }
  }

  /** A struct body's `x::T` entries. The grammar has no dedicated field node for them. */
  private structFields(node: Node): { name: string; node: Node }[] {
    const out: { name: string; node: Node }[] = []
    /** A field's name from a declaration-shaped node, or "" when the node declares no field. */
    const fieldName = (c: Node): string => {
      // `x::T` — a typed field. `typed_expression` is POSITIONAL: child 0 is the name, child 1 the
      // type. It is also the node that carries a PARAMETER's type in a signature, so this is only
      // called on a struct body where a bare `x::T` really is a field.
      if (c.type === "typed_expression") return this.pos(c, 0)?.text.trim() ?? ""
      // `x::Ref{S} where S<:T` — the field's declaration WRAPPED in a where clause. `TG_BoundWhere`
      // and `TG_BoundBody` in `julia/test/typegroup.jl` write exactly this, and the wrapper was not
      // one of the shapes read here, so both structs published no `x` field at all. The typed
      // expression is the where clause's first child, the same position the other wrappers use.
      if (c.type === "where_expression") {
        const inner = this.pos(c, 0)
        return inner ? fieldName(inner) : ""
      }
      // `x` — a field with no annotation, which Julia admits and which was SILENT here. The same
      // omission covered the two DEFAULT forms: `x::T = default` and `const x::T = default` parse
      // as an `assignment`/`const_statement` whose LEFT side is a typed expression (or a bare
      // identifier), and the old loop accepted only a direct `typed_expression`, so
      // `Base.@kwdef struct SyntaxCompatContext; toplevel::Bool=true; end` published no
      // `contains SyntaxCompatContext -> toplevel` at all. Found by the whole-population direct
      // oracle: `contains` was the label with the second-largest MISSING count (861 of 12,593
      // truth rows) and this shape is one of its named classes.
      if (c.type === "identifier") return c.text.trim()
      // `@atomic str::Union{String,Nothing}` — a macro-annotated field. The macro is not a field;
      // the declaration inside its argument list is. The oracle derived `LazyString -> str` and the
      // analyzer had no row, which is a MISSING edge rather than a disagreement about scope.
      if (c.type === "macrocall_expression") {
        const args = this.namedChildren(c).find((n) => n.type === "macro_argument_list")
        if (!args) return ""
        for (const a of this.namedChildren(args)) {
          const nm = fieldName(a)
          if (nm) return nm
        }
        return ""
      }
      // `date::Date &(json=(dateformat=…,),)` — a FIELD ANNOTATED BY A MACRO. The `&` binds looser
      // than `::`, so the field is a `binary_expression` whose LEFT is the typed declaration and
      // whose right is the annotation; this reader knew only the bare typed shape, so every
      // StructUtils-annotated struct published no fields at all (`json_jl/test/parse.jl`'s
      // `ThreeDates` lost `date`, `datetime` and `time`). MEASURED: 7 missing `contains` rows, all
      // this shape. Only a TYPED left is accepted — `x = 1` is an assignment, not a field.
      if (c.type === "binary_expression") {
        const { left } = this.binOperands(c)
        if (left && left.type === "typed_expression") return this.pos(left, 0)?.text.trim() ?? ""
        return ""
      }
      if (c.type === "const_statement") {
        // Three shapes are valid: `const x::T = default` (an assignment child), `const x::T` (a
        // typed_expression child, P6's const field) and `const x` (a bare identifier). The first
        // version looked only for an assignment, so P6's parsed const field still published no
        // `contains` edge — the tree was fixed and the reader was not.
        const inner = this.namedChildren(c).find((n) =>
          n.type === "assignment" || n.type === "typed_expression" || n.type === "identifier")
        return inner ? fieldName(inner) : ""
      }
      if (c.type === "assignment") {
        const lhs = this.pos(c, 0)
        if (!lhs) return ""
        if (lhs.type === "typed_expression") return this.pos(lhs, 0)?.text.trim() ?? ""
        // A short-form INNER CONSTRUCTOR is an assignment whose left side is a call: its parameters
        // are bindings, not fields. `IdDict{K,V}(d::IdDict{K,V}) = new(...)` must not publish `d`.
        if (lhs.type === "identifier") return lhs.text.trim()
      }
      return ""
    }
    for (const c of this.namedChildren(node)) {
      const name = fieldName(c)
      if (name) out.push({ name, node: c })
    }
    return out
  }

  /**
   * `import A: b, c` / `using A, B` — the module and the names brought in.
   *
   * ## WHY THIS IS NOW STATELESS, and what it cost to leave it stateful
   *
   * The previous version walked the statement's named children IN ORDER carrying a `pending`
   * variable, and one of its branches read: *"a bare identifier when something is already pending,
   * with no items yet, and a different name — that is an ITEM of the pending target."*
   *
   * That branch cannot tell a second MODULE from an item of the first. `using A, B` names two
   * modules, and the corpus's second most common multi-path import shape by volume is exactly that:
   * 32 two-path and 12 three-path statements in a 400-file draw (`validation/m14/fixtures/julia/
   * import-export-shapes.ts`, which enumerates every observed shape with counts). The consequence was
   * silent and total for the tail of a long list — `DataFrames.jl/src/DataFrames.jl:3-19` is one
   * `using` statement naming **17 modules** and this function published ONE of them, calling the
   * other sixteen "items" of `Base.Sort`.
   *
   * Measured over the whole admitted corpus by the oracle this change was written against
   * (`script/m14/oracles/julia-imports.ts`, an independent derivation sharing no rule with this one):
   * **167 of 440 `imports` edges were missing on a 200-file draw — 38% of the type.** Every one of
   * the `imports` RELATIONSHIPS, every `ImportInfo[]` row and every `references` row carrying
   * `isImport: true` lost the same dependencies, because all three are written from this one walk.
   *
   * The previous instrument could not have found it. `census.ts`'s construct-versus-edge
   * reconciliation counts FILES containing the construct against files whose edge fired, and a file
   * whose FIRST module produced an edge passed — the per-file granularity cannot see a missing second
   * target. A differential against an independent derivation can, and did.
   *
   * ## THE RULE, WHICH IS ABOUT THE CHILD AND NOT ITS SIBLINGS
   *
   * Every named child is classified on its own, and the question asked of each is "is this child a
   * module path, or is it a name inside a path's list?" — answerable from the child's own position in
   * ITS parent, with no knowledge of what came before. Two siblings of the same type therefore cannot
   * be confused for one another, which is the whole defect class.
   *
   * Shapes, all measured over the corpus rather than read out of `grammar.js`:
   *
   *   `using A` / `import A.B.C`   bare path      → `identifier` | `scoped_identifier` | `import_path`
   *   `using A, B`                 two bare paths → two of the above as SIBLINGS — the fixed case
   *   `using A: x, y`              path + names   → `selected_import`, module is its child 0
   *   `import A as B`              renamed import → `import_alias`, module is its child 0
   *
   * The last one was dropped entirely before: the `import_alias` branch required `pending`, and a
   * statement whose ONLY named child is an `import_alias` never had one, so `import ChainRulesCore as
   * CRC` (`StaticArrays.jl/ext/StaticArraysChainRulesCoreExt.jl`) published nothing at all.
   *
   * `import_path` and `scoped_identifier` are taken WHOLE, leading dots and all: the dots are what
   * distinguishes `using .Foo` from `using ..Foo`, and a dotted path's last segment is not the module
   * a statement imports (`using Base.GMP.MPZ` imports `Base.GMP.MPZ`, not `MPZ`).
   *
   * ## What this function still does not do
   *
   * 45 of the corpus's 3,570 import/export statements carry an ERROR descendant, and almost all of
   * them are legitimate julia the grammar cannot fully parse — `import .Base.Math.@horner`
   * (`julia/base/special/log.jl:12`, in julia's own stdlib), `import ..test_mod.@old_hyg` (32
   * statements in `julia/JuliaLowering/test/scopes.jl`), `import B.@mac as @mac2`. The module path
   * around the unparsed part still parses, so taking the child's whole text records the dependency
   * that exists. **Refusing these would trade 45 real edges for 2 fabricated ones, which is why the
   * ERROR rule is applied to `export`/`public` only and for a different reason** — see the
   * `export_statement` case, where the statement node ITSELF is wrong rather than one part of it.
   */
  private importTargets(node: Node): { name: string; items: string[]; renamed?: boolean }[] {
    const out: { name: string; items: string[]; renamed?: boolean }[] = []
    for (const c of this.namedChildren(node)) {
      if (c.type === "selected_import" || c.type === "import_alias") {
        // `using Base: isexpr, length` and `import StructUtils: @noarg, lower` — julia's SELECTIVE
        // import form, the single most common shape in the corpus by a wide margin: 113 of 596
        // statements in a 400-file draw have `selected_import` as their ONLY named child. Before the
        // `selected_import` branch existed this function matched neither `import_path` nor a bare
        // `identifier` there and returned an EMPTY list for every one, losing the dependency on `Base`
        // at `julia/Compiler/src/Compiler.jl:40`. It is invisible three ways, which is why it survived:
        // the statement parses without an ERROR node, `parseFile` throws nothing, and the file still
        // publishes hundreds of symbols from its other declarations.
        //
        // SHAPE, measured by walking a real tree (`using ..Compiler: >, getindex`):
        //
        //   selected_import
        //     import_path "..Compiler"      <- named child 0: the MODULE
        //     :                             <- anonymous, so never reached by namedChildren
        //     operator ">"
        //     ,                             <- anonymous
        //     identifier "getindex"
        //
        // So the module is the FIRST named child whatever its own type (`identifier` for `Base`,
        // `import_path` for `..Compiler`) and the names are the named children after it. The `:` and
        // `,` are anonymous, which is what makes child order sufficient here.
        //
        // `import_alias` (`import A as B`) has the same shape and the same reading: child 0 is the
        // module being imported, child 1 the local name it is bound to. The edge asserts the MODULE,
        // because `as` renames the binding and does not change what is depended on.
        const inner = this.namedChildren(c)
        if (!inner.length) continue
        const modName = inner[0]!.text.trim()
        if (!modName) continue
        // `selected_import` (`using A: x, y`) brings NAMES out of A, so its trailing children are the
        // imported items. `import_alias` (`import A as B`) does NOT: it imports the whole module and
        // `as` only renames the LOCAL binding, so its trailing child is `B` — a name this file
        // declares, not one it imports. Putting `B` in `items` asserts a dependency on a binding
        // named `B` inside a module that need not have one, and the corpus's own
        // `StaticArrays.jl/ext/StaticArraysChainRulesCoreExt.jl` writes `import ChainRulesCore as CRC`.
        const items = c.type === "selected_import"
          ? inner.slice(1).map((x) => x.text.trim()).filter((x) => x.length > 0)
          : []
        // `renamed` is a PARSE FACT and it is on the edge because the two forms are different
        // facts about the same dependency: `using A: x` names an item out of A, `import A as B`
        // renames the local binding and imports the whole module. Without it the two are
        // indistinguishable on the wire, and the lane-owned mutant that reinstates the pre-fix drop
        // of the aliased form has nothing to match on — it survived its first run for exactly that
        // reason, which is recorded in `script/m60/julia-mutants.ts`.
        out.push({ name: modName, items, renamed: c.type === "import_alias" || undefined })
        continue
      }
      // A bare path with no colon list: `using LinearAlgebra`, `using ..Dep1`, `using Base.GMP.MPZ`,
      // and every additional module in a comma-separated list. Unconditional and independent of what
      // came before it — that independence is the fix.
      if (c.type === "import_path" || c.type === "identifier" || c.type === "scoped_identifier") {
        const name = c.text.trim()
        if (name) out.push({ name, items: [] })
      }
      // Anything else — a `line_comment`, an `ERROR` — names no module. The shape census counts
      // `line_comment` as a NAMED child of these statements (66 across a 400-file draw), so this
      // branch is the reason a comment is not a dependency.
    }
    // The previous version ended with `if (!out.length && paths.length) out.push(paths[0])`, a
    // fallback for "no entry matched". It is unreachable and is REMOVED rather than left as the kind
    // of branch that reads as coverage: `paths` was filtered to exactly the three node types the loop
    // above now handles unconditionally, so any child that made `paths` non-empty also makes `out`
    // non-empty. A dead branch here would have been indistinguishable from a real fallback.
    return out
  }

  private exportableName(node: Node): string {
    if (node.type === "identifier") return node.text.trim()
    if (node.type === "operator") return node.text.trim()
    if (node.type === "scoped_identifier") {
      const segs = this.namedChildren(node).filter((x) => x.type === "identifier")
      return segs.length ? segs[segs.length - 1]!.text.trim() : node.text.trim()
    }
    if (node.type === "macro_identifier") return macroNameOf(node.text)
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
        // THE OPERATOR IS A NAMED CHILD, NOT A FIELD. The grammar's
        // `binary_expression` rule is `seq($._expression, alias(op, $.operator),
        // $._expression)`, and the grammar's six field names are name, value,
        // condition, alternative, prefix and suffix — there is no `operator` field.
        // So `childForFieldName("operator")` returned null on every binary
        // expression and `&&`/`||` contributed nothing: a ten-guard predicate
        // measured 1. F1 named the field literal as unregistered; the correct read
        // is the named child at index 1 (an `operator` node), and the fixture
        // `validation/m14/fixtures/julia/dispatch-and-hierarchy` pins a `&&` body
        // at complexity 2 — it read 1 before this fix.
        const opNode = this.pos(n, 1)
        const op = opNode && opNode.type === "operator" ? opNode.text.trim() : ""
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
