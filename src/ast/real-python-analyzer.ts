// Real Python Intelligence Engine
// AST analysis for Python — pure Tree-sitter extraction, no regex fallbacks.
// M12.27 rewrite: scripting-family contract (JS/TS precedent) — module-level
// symbols ownerless (Python has no module declaration), class → member
// contains, leaf-target calls with a Python builtin filter, uppercase-head
// calls → instantiates, extends from the base-class argument list, imports
// as `imports module -> path:item`, exports from __all__, overrides via the
// harness companion index.

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * `replace(/^@/, "")` as a prefix check (M49.R2 wave 2026-09-25: the AST census counted
 * the literal as the python lane's only regex, and a single-character prefix needs no
 * engine).
 *
 * Equivalence proof: `/^@/` is an anchored single-character match with no `g`, so
 * `replace` removes the `@` iff the string starts with one and removes nothing
 * otherwise — `"@@a"` loses exactly one `@` under both rules, `"a@"` is untouched by
 * both. `startsWith` + `slice(1)` is that function; unlike `$`, `^` has no
 * before-final-newline special case, so there is no edge-case gap to disclose.
 * The javascript lane ruled the identical shape (`stripLeadingAt`, M49 R2 closure) and
 * this mirrors it rather than inventing a second spelling for the same predicate.
 */
function stripLeadingAt(text: string): string {
  return text.startsWith("@") ? text.slice(1) : text
}

/**
 * Names the STORE has reserved, so a bare endpoint equal to one is indistinguishable from a
 * synthetic scope. Derived from the indexer's own list rather than restated, because a
 * second hand-maintained copy is exactly what standing rule R7 was written about: a copied
 * list is correct on the day it is written and silently wrong the day the indexer grows.
 *
 * The list cannot be imported — `parallel-indexer.ts` is a downstream consumer, not a
 * dependency of an analyzer, and importing it would invert the layering. So the names are
 * declared here as the documented contract and `RESERVED_ENDPOINT_NAMES` is the single
 * place to extend, with the source line named beside it. If the indexer's set grows, this
 * one must grow with it; that is a stated obligation, not an accident.
 *
 * Measured over the whole derived population (5,984 python files, production parseFile):
 * 7 emitted edges had a reserved endpoint, all from `SafeUUID.unknown`.
 * @see src/ast/parallel-indexer.ts:3519 — `GENERIC_SOURCE_NAMES`
 * @see validation/m60/ledger.json — rule R7
 */
const RESERVED_ENDPOINT_NAMES: ReadonlySet<string> = new Set([
  "unknown",
  "SCSS_FILE_SCOPE",
  "window",
  "exports",
  "default",
  "GlobalScope",
])

/**
 * `dir(object)` — the CLOSED root's member set: 23 names on CPython 3.10.12.
 *
 * Why this lane needs the list written down. The override resolution below has a third
 * tier: when NO base declares the name, it guesses the first base this file never read.
 * For every other external base that guess is genuinely open — the question is what an
 * unread module contains, and nothing here can answer it. `object` is different in kind:
 * it is the closed root of the python hierarchy, every class inherits its members whether
 * or not the base list writes it, and its contents are a fact about the interpreter rather
 * than an assumption about unread code.
 *
 * So a guess naming `object` is CHECKABLE, and for a method `object` does not declare it is
 * a false statement carrying a 0.5 label. MEASURED (script/m14/python-guess-accuracy.ts,
 * which imports each guessed base and asks `hasattr(base, method)` on the interpreter):
 * over 184 corpus files the tier emitted 41 guessed edges, TRUE 1 / FALSE 23 / UNKNOWN 17,
 * and seventeen of the twenty-three FALSE were `object.<method>` — one per method of a
 * `unittest.TestCase` subclass whose only written base is `object`. The lane's own
 * differential cannot see this class of defect: its verdict on a guess is vacuous for a
 * base the file never read, because the oracle's tree does not contain the base either, so
 * it calls the edge refuted whether it is true or false. The verdict came from CPython.
 *
 * The refusal is deliberately narrow — PY-33, pinned by
 * `validation/m14/fixtures/python/object-base-guess-refused`, whose three classes fix both
 * boundaries: a `object` guess for a name object DOES declare survives at 0.5 (it is still
 * a guess, not promoted), and a guess naming any OTHER unreadable base is untouched, so
 * this is not a removal of the family's third tier (M37.10 pins the tier for
 * php/ruby/python/js/perl/java/swift, and one lane cannot delete its copy unilaterally).
 */
const OBJECT_MEMBERS: ReadonlySet<string> = new Set([
  "__class__",
  "__delattr__",
  "__dir__",
  "__doc__",
  "__eq__",
  "__format__",
  "__ge__",
  "__getattribute__",
  "__gt__",
  "__hash__",
  "__init__",
  "__init_subclass__",
  "__le__",
  "__lt__",
  "__ne__",
  "__new__",
  "__reduce__",
  "__reduce_ex__",
  "__repr__",
  "__setattr__",
  "__sizeof__",
  "__str__",
  "__subclasshook__",
])

/**
 * Publish a member name so it can never BE a reserved bare word.
 *
 * `exports` is the sharpest of the six after `unknown`: an `__all__` entry legitimately
 * named `exports` is a real export, and an unqualified `exports` target is what the store
 * treats as a synthetic scope. `default` is the same shape (`from mod import default` is
 * legal Python).
 *
 * A name that is not reserved is returned UNCHANGED — this is not a blanket qualifier. The
 * 88,535 `contains` edges this analyzer emits are published as bare members and resolve at
 * 100.0%; qualifying all of them would have changed every one of them for no reason and
 * broken the resolution the store already does by leaf name.
 */
function qualifyReservedEndpoint(name: string, owner: string): string {
  return RESERVED_ENDPOINT_NAMES.has(name) ? `${owner}.${name}` : name
}

interface PythonScope {
  node: Node
  name: string
  kind: ASTEngine.SymbolKind
}

/**
 * What this file PROVES about the names it uses, gathered before the walk so that a class
 * declared ABOVE the import which proves its base still resolves. See
 * `collectInterfaceBindings` for why the proof is the import and not the spelling.
 */
interface InterfaceBindings {
  /** `from abc import ABC` / `ABCMeta` — an abstract base class declaration. */
  abcNames: Set<string>
  /** `from typing`/`typing_extensions import Protocol` — a structural interface. */
  protocolNames: Set<string>
  /** `from collections.abc import X` — the stdlib interface catalogue; all 25 exported
   *  names are ABCs (measured against CPython's own `_collections_abc.py`: 7 declare
   *  `metaclass=ABCMeta`, 18 inherit it from a base that does, and the one non-ABC class in
   *  that module, `_CallableGenericAlias`, is not exported). */
  collectionsAbcNames: Set<string>
  /** dotted roots this file imports, so `abc.ABC` is self-proving once `abc` is bound. */
  importRoots: Set<string>
  /**
   * The LINE each stdlib marker name was BOUND on, by bound name.
   *
   * PY-29 — a bare base name has to be read POSITIONALLY, because python evaluates the base
   * expression against the module globals as they stand on that line. `class ABC:` in the
   * middle of a file REBINDS a name an `from abc import ABC` above it had bound, so a
   * subclass declared after the rebinding inherits the LOCAL class whatever the import says;
   * one declared before it inherits the stdlib one. `python/interface-implements` pins both
   * sides by name (`AboveTheRebind` / `BelowTheRebind`), and reading the binding without its
   * line was the whole defect: the pre-pass asked "is `ABC` an interface anywhere in this
   * file?", which is a different question from "what does `ABC` name HERE?" — and the second
   * is the one python answers.
   */
  markerLines: Map<string, number>
  /**
   * Every class THIS FILE declares, with its line and its base list as BOUND DATA.
   *
   * This is what makes tier 1 (`in-file-interface-base`) expressible at all: `class
   * SubAbcBase(AbcBase)` is an interface implementation when `AbcBase`'s own header declares
   * an interface, and that is a fact about ANOTHER declaration, its bases and their order.
   * The bases are recorded as strings rather than nodes because this pass runs to completion
   * before the verdict pass, and a web-tree-sitter wrapper is per-access — a stored node is
   * a handle whose reads belong to the walk that produced it.
   */
  classDecls: PyClassDecl[]
  /** classes THIS file declares an interface — `X.register(Y)` on one of them is a
   *  conformance declaration with no inheritance behind it, and a subclass of one is an
   *  interface implementation by tier 1. */
  localAbstractClasses: Set<string>
}

/** One base in one class's header, as the pass records it: enough to decide a marker. */
interface PyBaseRef {
  /** the base's LEAF name — `abc.ABC` -> `ABC`, `pa.Table[T]` -> `Table`. */
  leaf: string
  /** the full dotted spelling when the source wrote one (`abc.ABC`, `typing.Protocol`),
   *  else null. A subscript records its HEAD's spelling (`typing.Protocol[T]` ->
   *  `typing.Protocol`), which is PY-29: the head is the qualified name, and reading the
   *  subscript as a bare name is what made the positional test answer for a spelling the
   *  source never wrote. */
  dotted: string | null
}

/** One class declaration in the file: its line and the header evidence tier 1 needs. */
interface PyClassDecl {
  name: string
  /** 1-based line the class is declared on. */
  line: number
  /** `metaclass=ABCMeta` (or `metaclass=abc.ABCMeta`) is on the header. */
  namesAbcMeta: boolean
  bases: PyBaseRef[]
}

interface PythonContext {
  content: string
  filePath: string
  symbols: ASTEngine.UniversalSymbol[]
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  errors: ASTEngine.ParseError[]
  frameworks: Record<string, boolean>
  patterns: Record<string, boolean>
  // O(1) call-source/declaration lookups
  functionSymbolIndex: Record<string, number>
  // O(1) instantiates check: names of in-file declared classes/enums
  declaredTypes: Set<string>
  /**
   * INCOMING_PY: the ROOT module of every import this file declares.
   *
   * Seeded by the SAME pre-pass that seeds `declaredTypes`, so it costs no additional
   * walk — `preScan` already visits every node in the file and this is one `split` per
   * import statement. It exists so `calls` can tell an EXTERNAL member apart from a
   * dispatch through a receiver it cannot follow: `os.path.join` names `os.path`, a
   * module attribute chain this file imported, and a consumer holding the imports can
   * reach `join` through it; `recv.join` names a local whose type is written down
   * nowhere. Both publish a leaf named `join`, and without this set the reason code
   * cannot tell them apart — which would make the code assert "no static target" about
   * the one shape that HAS one.
   */
  importRoots: Set<string>
  seenRels: Set<string>
  // (class\u001fattr) — one Property per instance attribute per class (PYD1)
  instanceAttrs: Set<string>
  /** Set before the main walk; read by `extractClass` to decide implements-vs-extends. */
  interfaceBindings?: InterfaceBindings
  currentModule: string | undefined
  currentClass: string | undefined
  /** PERL-MR15: the cross-file companion. Read from `AnalyzeContext.overrideCompanion`,
   *  which is the channel `engine.ts` populates and `pool-worker` forwards. */
  overrideCompanion?: Map<string, Set<string>>
  currentFunction: string | undefined
  /**
   * PY-D14 (round 7): each `function_definition` NODE -> the bare names bound in THAT function's
   * own scope (parameters, nested def/class names, local assignment/for/with/except/walrus
   * targets). Filled by `collectFunctionLocals` before the walk, and read at a call site by
   * walking the call's own ancestors — so no scope state has to be threaded, and the nested `def`
   * the main walk deliberately does not open a scope for needs no special case.
   */
  functionLocals: Map<string, Set<string>>
  moduleName: string
  /**
   * The current class DECLARATION, not its name — `${name}@${startLine}`.
   *
   * Two `class C` declarations in one file are two different classes that happen to share a
   * name, and every lookup that keys on the name alone merges them. This is the third genuine
   * analyzer defect the independent oracle found, and it is a MISATTRIBUTION rather than a
   * loss: `basesByClass` was keyed by class name, so a `class C` that extends NOTHING inherited
   * the bases of an unrelated `class C(Base)` declared elsewhere in the file and published
   * overrides to them. CPython is the referee and it disagrees —
   *
   *     L7   class C(Base)      # CPython: bases ['Base']
   *     L11  class C            # CPython: bases None
   *
   * and the lane emitted `C.m -> Base.m` at the line of BOTH `m` definitions, so a class
   * extending nothing claims to override something.
   */
  currentClassKey: string | undefined
  /** base leaves -> the class DECLARATION that has them, keyed by `currentClassKey`'s form */
  basesByClassKey: Map<string, string[]>
  /** base leaves the source spelled QUALIFIED, per class declaration — those are external */
  qualifiedBasesByClassKey: Map<string, string[]>
}

// Python builtins — never legitimate in-file call targets.
// Exported: the differential oracle imports this EXACT set (never a
// hand-duplicated copy — a drift would fabricate or hide call edges).
export const PYTHON_BUILTINS = new Set([
  // `aiter`/`anext` are the ASYNC-ITERATOR builtins added in python 3.10, and they were
  // missing while `next` and `iter` were present — the filter is otherwise complete for its
  // own rule, which is that a builtin is a call into the interpreter and not a graph node.
  // The independent oracle found it by deriving from `sys.stdlib_module_names`-equivalent
  // knowledge rather than from this list: it filtered both names, so `anext(x)` appeared as a
  // relationship the tree did not support. Two edges in the corpus, and the interesting part is
  // the direction — the oracle was right and the lane was wrong, which is the opposite of most
  // of the disagreements in this review.
  "aiter", "anext",
  "abs", "all", "any", "ascii", "bin", "bool", "breakpoint", "bytearray", "bytes",
  "callable", "chr", "classmethod", "compile", "complex", "delattr", "dict",
  "dir", "divmod", "enumerate", "eval", "exec", "filter", "float", "format",
  "frozenset", "getattr", "globals", "hasattr", "hash", "help", "hex", "id",
  "input", "int", "isinstance", "issubclass", "iter", "len", "list", "locals",
  "map", "max", "memoryview", "min", "next", "object", "oct", "open", "ord",
  "pow", "print", "property", "range", "repr", "reversed", "round", "set",
  "setattr", "slice", "sorted", "staticmethod", "str", "sum", "super", "tuple",
  "type", "vars", "zip", "__import__",
])

/**
 * VERIFY_PY10 — REMOVED, with the measurement that removed it.
 *
 * This set gated the name on a `class_definition` and a `function_definition`, which is
 * the one place it could not do any good: if the grammar produced a `def X` or a
 * `class X` node, then `X` IS a declaration. The list reads as if it were written to keep
 * synthetic scope names out of the symbol table, and it does that job elsewhere — but
 * here it was filtering DECLARATIONS by name, and one of its four entries is a legal
 * method name that a real framework ships.
 *
 *     django/template/loader_tags.py:71     def super(self):
 *
 * `super` is a builtin FUNCTION, so the gate skipped the whole `function_definition`
 * branch — not just the symbol, but `ctx.currentFunction = "super"` and the exit frame
 * that restores it. The walk then descended into that method's body with
 * `currentFunction === undefined` and `currentClass === "BlockNode"`, which is the shape
 * of a class body. Measured consequences, all in that one file, all from this one line:
 *
 *   LOSS        1 symbol (`BlockNode.super`) and its `contains` edge. `super` is not a
 *               scratch name in django — `{{ block.super }}` is the documented template
 *               API for it.
 *   FABRICATION 1 symbol (`BlockNode.render_context`, a method LOCAL at L77) published as
 *               a class member, because a local assignment inside a mis-scoped method
 *               reaches the class-body Property branch.
 *   DANGLING    7 `uses` edges with source `super` — `extractMemberUses` is a SECOND
 *               walk with no denylist, so it bound the owner the main walk refused to
 *               bind. The graph therefore carried edges naming a symbol that did not
 *               exist, which is the "stored and compared against nothing" shape.
 *   MISATTRIB   4 `calls` edges sourced to the CLASS instead of the method.
 *
 * The independent oracle found this as 4 `missing calls` + 5 `unexplained calls` + 1
 * `missing contains` + 1 `unexplained contains` on django — 11 rows, 10 of them this one
 * gate.
 *
 * BLAST RADIUS, measured before removing anything: every `def`/`class` declaration in all
 * 5,364 code-bearing corpus files whose name is in this set. Exactly ONE — the `super`
 * above. Zero named `self`, `cls`, `this`, `None`, `True` or `False`. (`None`, `True` and
 * `False` are keywords, so they can never be a declaration name at all; `self`, `cls` and
 * `this` are ordinary identifiers and simply do not occur in this corpus.) So the change
 * is zero-delta on 5,363 of 5,364 files and fixes the 5,364th.
 */

/**
 * INCOMING_PY / M14 §4 — the reason a `references` edge is at 0.95 rather than 1.0,
 * keyed by the annotation POSITION the name was written in.
 *
 * Declared as a table rather than inlined at the push site because the position is
 * already an input to that call and a table is the only spelling that cannot drift
 * from the field it mirrors: `metadata.relationshipType` and `metadata.reasonCode`
 * are both derived from `relType`, one lookup apart.
 */
const PY_REFERENCE_REASON: Record<string, string> = {
  declared_type: "annotation-type",
  return_type: "return-annotation",
  instanceof_check: "instanceof-check",
}

/**
 * PY-D15 / PY-D16 (round 8) — THE TWO WAYS A TYPE-HOLDING NAME BINDS LOCALLY, and why each is a
 * different fact rather than two spellings of one.
 *
 * A `references` edge names a type. When the name is bound in the reference's OWN ENCLOSING
 * FUNCTION, no project-wide declaration exists for it and none can be invented — but WHICH local
 * scope bound it changes what a consumer should do, so the code says which one:
 *
 *   local-binding-target    a parameter, a walrus target, an assignment / `for` / `with` / `except`
 *                           target, or a nested `def`/`class` name. The name holds a VALUE at
 *                           runtime — `isinstance(obj, type_or_tuple)` where `type_or_tuple` comes
 *                           from a dict lookup, `class Row(dump_cls)` where the base was chosen by
 *                           an `if`. Nothing in this file decides its type; a reader of the edge
 *                           must not treat the leaf as a class name.
 *   inline-type-parameter   a PEP-695 `def f[T]` / `class C[T]` / `type A[T]` type parameter,
 *                           declared by the reference's own def. This is NOT shadowing and NOT a
 *                           value: the name is a TYPE, introduced by the signature being annotated.
 *                           It stays unresolved at project scope for a reason worth stating — the
 *                           parameter is bound in the def's own lexical scope, python exposes it
 *                           nowhere else, so publishing a file-scope symbol for it would be a lie
 *                           about scope (and two `def get[TValue]` in one file would publish two
 *                           symbols of one name, which the store can only call ambiguous).
 *
 * Both are DECLARED, not defects: the analyzer is stating a fact about python's LEGB rule, exactly
 * as `local-callee` does for a call. The local check runs FIRST of the two, so a def whose body
 * rebinds a type-parameter name is reported by the binding that actually holds at runtime.
 */
// (The two codes are emitted by `dynamicTypeBindingReason`; they are read back by the resolution
// verdict's `DECLARED_LOCAL` axis, which is where the mapping from a code to an axis lives.)

/**
 * The python framework trigger surface (#747).
 *
 * The context carried a `frameworks: Record<string, boolean>` field that NOTHING ever
 * wrote, while the emitter published `hasFrameworkIntelligence: true` on every file — a
 * capability claimed over a surface that could never fire. Measured before the fix: a
 * minimal Django model and a minimal Flask app both detected `[]`, 0 of 187 real corpus
 * files ever detected anything, and the R8 census reported the surface as DEAD.
 *
 * The markers are IMPORT ROOTS taken from the parsed AST, never text scanning, and the
 * table is declared the way csharp's CS_FRAMEWORK_MARKERS is (CONV-CS-2, java sibling)
 * rather than inferred from a corpus. One root per line, so a marker that stops matching
 * is a visible deletion here and not a silent loss of detection.
 *
 * MEASURED, and the reason the table grew: 3,271 corpus `.py` files carrying 160 distinct
 * non-stdlib import roots (stdlib list from `sys.stdlib_module_names`, not guessed). Of the
 * nine roots this table declared, SEVEN NEVER FIRE — `celery`, `django`, `fastapi`, `flask`,
 * `sqlalchemy`, `starlette` and `tornado` occur zero times. Only `pytest` (1,010 sites) and
 * `aiohttp` (1) matched anything at all. A marker that fires nowhere is not coverage, it is
 * a line in a table, and the original census had no way to tell the two apart because the
 * only evidence it gathered was that the surface was reachable.
 *
 * The four roots added below are the corpus's own, and each is a FRAMEWORK rather than a
 * library — the distinction matters because `metadata.framework` is a single primary pick,
 * so admitting `requests` or `numpy` here would make thousands of files report a library as
 * their framework. `ansible` is the corpus's dominant framework by an order of magnitude
 * (3,452 sites across 322 directories) and was entirely absent. `unittest` is the STANDARD
 * LIBRARY's own test framework, detected in 132 corpus files, while `pytest` was already
 * present: the table could name the third-party test runner and not the one that ships with
 * the language. `setuptools` (20) and `sphinx` (19) are the build and documentation
 * frameworks.
 *
 * Cython is deliberately NOT here. It is the corpus's second-largest root by a wide margin
 * (260 lower-case + 169 capitalised import sites) and it is a DIALECT, not a framework — and
 * no lane in this repository publishes a `dialect` field, so a Cython marker here would have
 * to be recorded as a framework in order to be recorded at all. That is a cross-lane concept
 * worth having and not one to invent inside a single analyzer; it is filed in the review as
 * PY-16 rather than smuggled in under `framework`.
 *
 * A SECOND, INDEPENDENT python framework table exists — `FrameworkDetector.detectPythonFrameworks`
 * in `src/ast/framework-intelligence.ts` — and `enhanceWithFrameworkIntelligence` MERGES its
 * output into this metadata, so the field a consumer reads is the union of the two and neither
 * table alone explains it. Measured on the corpus, the union is 10 frameworks and the split is
 * not the one this table's shape suggests: `pandas`, `numpy`, `tensorflow` and `pytorch` come
 * ONLY from the shared detector and appear nowhere here, while `starlette`, `sqlalchemy`,
 * `aiohttp`, `celery`, `ansible`, `setuptools`, `sphinx` and `unittest` come ONLY from here.
 * Five entries — `django`, `flask`, `fastapi`, `tornado`, `pytest` — are declared in BOTH, and
 * those five are free to drift apart with nothing to notice. That duplication is PY-17 and it is
 * the more interesting half of this finding: the seven dead markers above are mostly markers the
 * shared detector already covers, so the table was not providing coverage the product lacked so
 * much as a second source of truth for a field it already had. The four roots added here are
 * precisely the ones the shared detector does NOT carry, which is why they are the four worth
 * having.
 */
const PY_FRAMEWORK_MARKERS: Record<string, { framework: string; pattern: string }> = {
  django: { framework: "Django", pattern: "orm" },
  flask: { framework: "Flask", pattern: "wsgi_app" },
  fastapi: { framework: "FastAPI", pattern: "asgi_app" },
  starlette: { framework: "Starlette", pattern: "asgi_app" },
  sqlalchemy: { framework: "SQLAlchemy", pattern: "orm" },
  tornado: { framework: "Tornado", pattern: "async_web" },
  aiohttp: { framework: "aiohttp", pattern: "async_http" },
  celery: { framework: "Celery", pattern: "task_queue" },
  ansible: { framework: "ansible", pattern: "automation" },
  setuptools: { framework: "setuptools", pattern: "build" },
  sphinx: { framework: "sphinx", pattern: "documentation" },
  // Testing frameworks stay LAST, so `framework` (the primary pick, taken from the first
  // entry) reports the application framework in a file that imports both — the same rule
  // and the same reason as the table's original ordering.
  pytest: { framework: "pytest", pattern: "testing" },
  unittest: { framework: "unittest", pattern: "testing" },
}

/** framework name -> its declared pattern kind, so the emitted array stays aligned. */
const PY_FRAMEWORK_PATTERN: Record<string, string> = Object.fromEntries(
  Object.values(PY_FRAMEWORK_MARKERS).map((m) => [m.framework, m.pattern]),
)

/**
 * The emitted ORDER, and therefore the primary pick: the table's own declaration order,
 * which is application frameworks first and test frameworks last — the same rule and the
 * same reason as csharp's CS_FRAMEWORK_ORDER (CONV-CS-2), so a file that imports pytest
 * BEFORE django still reports Django as its framework. Import order would make the pick
 * depend on how the imports happen to be sorted, which is not a property of the code.
 */
const PY_FRAMEWORK_ORDER: string[] = Object.values(PY_FRAMEWORK_MARKERS).map((m) => m.framework)

export class RealPythonAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    // The engine has always passed this fourth argument; Python was the one
    // lane whose signature stopped at three, so `overrideCompanion` was
    // unreachable and the resolver below read a `_overrideCompanion` key that
    // nothing ever set.
    context?: ASTEngine.AnalyzeContext,
  ): ASTEngine.ParseResult {
    // Regex-free module-name derivation: last path segment minus its final
    // extension (pure char scan — the extension is after the LAST dot).
    const base = filePath.split("/").pop() || "module"
    const dotIndex = base.lastIndexOf(".")
    const stem = dotIndex > 0 ? base.slice(0, dotIndex) : base
    // PY-13. The module name was the filename stem verbatim, so a file called
    // `my-module.py` published the scope `my-module` — which is not a valid Python
    // identifier, cannot be a symbol name, and cannot be typed. It was found by writing
    // a fixture: the harness's expected `from` did not match because the analyzer spelled
    // the module with a hyphen in it.
    //
    // Python module names ARE identifiers, so the stem is normalised to one: every
    // character that cannot appear in an identifier becomes `_`, and a leading digit gets
    // an underscore so the result is a legal name rather than a legal-looking one. This
    // changes nothing for the overwhelming majority of files (`__init__` and
    // `service_facts` are already identifiers) and makes the rest honest.
    const moduleName = (() => {
      let out = ""
      for (let i = 0; i < stem.length; i++) {
        const c = stem.charCodeAt(i)
        const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95
        out += ok ? stem[i] : "_"
      }
      if (out.length === 0) return "module"
      const first = out.charCodeAt(0)
      const startsWithDigit = first >= 48 && first <= 57
      return startsWithDigit ? `_${out}` : out
    })()
    const ctx: PythonContext = {
      content,
      filePath,
      symbols: [],
      relationships: [],
      imports: [],
      exports: [],
      errors: [],
      frameworks: {},
      patterns: {},
      functionSymbolIndex: {},
      declaredTypes: new Set(),
      importRoots: new Set(),
      seenRels: new Set(),
      instanceAttrs: new Set(),
      currentModule: moduleName,
      currentClass: undefined,
      // RESOLVED 2026-10-02 (branch consolidation): a UNION.
      //   local  -- seeds the #924 class-key maps so bases resolve per CLASS, not per name.
      //   remote -- seeds `overrideCompanion` from the outer AnalyzeContext.
      currentClassKey: undefined,
      basesByClassKey: new Map(),
      qualifiedBasesByClassKey: new Map(),
      overrideCompanion: context?.overrideCompanion,
      currentFunction: undefined,
      functionLocals: new Map(),
      moduleName,
    }

    let cyclomaticComplexity = 1

    // PYD1 forward-reference pre-pass: collect in-file class/enum names
    // BEFORE the main walk. The walk resolves calls as it visits them, so a
    // class declared LATER in the file than its use site (`self.x =
    // ClosureTempAllocator(scope)` in Code.py L1224, class at L3732) was
    // invisible at call time — no instantiates edge. Python resolves names
    // at runtime, not positionally; the oracle's pre-pass never had this
    // bug (differential proved it: 72 forward-reference instantiates lost).
    const preScan = (n: Node): void => {
      if (n.type === "class_definition") {
        const nameNode = this.findChildByType(n, "identifier")
        if (nameNode?.text) ctx.declaredTypes.add(nameNode.text)
      }
      // INCOMING_PY — the import vocabulary, gathered in the walk that was already
      // happening. `import a.b as c` roots at `a`; `from .m import x` names no package
      // (a leading dot is not a root) and contributes nothing, exactly as
      // `noteFramework` already rules.
      if (n.type === "import_statement" || n.type === "import_from_statement") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "import" || c.text === "import") continue
          if (c.type !== "dotted_name" && c.type !== "relative_import" && c.type !== "aliased_import") continue
          if (c.text.startsWith(".")) continue
          const first = c.type === "aliased_import" ? (c.childForFieldName("name") ?? c.namedChild(0)) : c
          const root = first?.text.split(".")[0]
          if (root) ctx.importRoots.add(root)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) preScan(c)
      }
    }
    preScan(rootNode)

    // Interface bindings, same argument as `preScan` above and for the same reason:
    // `class C(ABC)` can sit ABOVE the `from abc import ABC` that proves the base is not a
    // user class named ABC, and python resolves names at runtime rather than positionally.
    ctx.interfaceBindings = this.collectInterfaceBindings(rootNode)

    // PY-D14 (round 7): the local binding set of every function, computed before the walk for the
    // same reason the two pre-passes above are — a bare-name callee's scope is a fact about the
    // whole function body, not about the position the walk happens to reach it from.
    ctx.functionLocals = this.collectFunctionLocals(rootNode)

    // #748 (M49 dup-key family ruling, Option A — the same rule js/ts/vue
    // pinned): python binds the LAST definition of a name in one container
    // scope, so an EARLIER same-name def is a PHANTOM — the runtime has
    // already rebound that attribute by the time the module finishes
    // executing, and the shadowed body can never run. Computed as a pre-pass
    // because the walk reaches the phantom BEFORE it can know a winner
    // follows; the walk then skips the whole subtree (no symbol, no body
    // edges, no complexity), which is the family contract's "phantom body
    // edges dropped" in the one place python can honour it — at emission.
    const phantomDefs = this.collectPhantomDefs(rootNode)

    // Iterative stack traversal (no recursion, no call-stack explosions).
    // Each frame carries the node plus scope bookkeeping so class/function
    // nesting is tracked exactly (siblings never inherit a parent scope).
    const stack: {
      node: Node
      isExit?: boolean
      // Exit frames ALWAYS restore both scopes (may restore to undefined).
      setClass?: string
      setFunc?: string
      /** the class DECLARATION to restore, which is not the same thing as the class name */
      setClassKey?: string
    }[] = [{ node: rootNode }]

    while (stack.length > 0) {
      const { node, isExit, setClass, setFunc, setClassKey } = stack.pop()!

      if (isExit) {
        ctx.currentClass = setClass
        ctx.currentClassKey = setClassKey
        ctx.currentFunction = setFunc
        continue
      }

      if (node.isMissing) continue

      // The shadowed earlier definition: unreachable by construction (see
      // collectPhantomDefs). Its subtree is not walked, so it contributes no
      // symbol, no outbound edge, and no cyclomatic decision point.
      if (this.isPhantom(node, phantomDefs)) continue

      if (node.hasError) {
        if (node.type === "ERROR") {
          ctx.errors.push({
            message: `Syntax ${node.type} detected. The Brain Engine is bypassing this broken node.`,
            range: this.nodeToRange(node),
            severity: "warning",
          })
        }
      }

      // --- Complexity: the grammar's emitted decision points ---
      if (
        node.type === "if_statement" || node.type === "elif_clause" ||
        node.type === "for_statement" || node.type === "while_statement" ||
        node.type === "match_statement" || node.type === "case_clause" ||
        node.type === "try_statement" || node.type === "except_clause" ||
        node.type === "with_statement" || node.type === "conditional_expression"
      ) {
        cyclomaticComplexity++
      } else if (node.type === "boolean_operator") {
        // `and`/`or` are anonymous operator tokens at child index 1.
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i)
          if (c && (c.type === "and" || c.type === "or")) {
            cyclomaticComplexity++
            break
          }
        }
      }

      // --- Pattern tracking (metadata only, never synthetic symbols) ---
      if (node.type === "list_comprehension" || node.type === "set_comprehension" ||
          node.type === "dictionary_comprehension" || node.type === "generator_expression") {
        ctx.patterns["Comprehensions"] = true
      }
      if (node.type === "lambda") ctx.patterns["Lambdas"] = true
      if (node.type === "yield") ctx.patterns["Generators"] = true
      if (node.type === "await") ctx.patterns["Async"] = true
      if (node.type === "assert_statement") ctx.patterns["Assertions"] = true

      switch (node.type) {
        case "class_definition": {
          const nameNode = this.findChildByType(node, "identifier")
          if (nameNode && nameNode.text) {
            this.extractClass(node, ctx)
            const prevClass = ctx.currentClass
            const prevFunc = ctx.currentFunction
            const prevClassKey = ctx.currentClassKey
            ctx.currentClass = nameNode.text
            ctx.currentClassKey = `${nameNode.text}@${node.startPosition.row + 1}`
            ctx.currentFunction = undefined
            stack.push({
              node,
              isExit: true,
              setClass: prevClass,
              setFunc: prevFunc,
              setClassKey: prevClassKey,
            })
          }
          break
        }
        case "function_definition": {
          // NOTE: this grammar emits `function_definition` for async defs too
          // (an anonymous `async` token is child 0) — `async_function_definition`
          // never appears. Async-ness is detected via the token scan below.
          const nameNode = this.findChildByType(node, "identifier")
          if (nameNode && nameNode.text) {
            // Nested function inside another function body: scoped noise —
            // NOT a symbol, and its body's calls attribute to the enclosing
            // function (JS-family contract: locals/params/lambda-params are
            // not symbols; inner bodies keep the outer call source).
            if (ctx.currentFunction) break
            if (ctx.currentClass) {
              this.extractMethod(node, ctx.currentClass, ctx)
            } else {
              this.extractFunction(node, ctx)
            }
            const prevFunc = ctx.currentFunction
            const prevClassKey = ctx.currentClassKey
            ctx.currentFunction = nameNode.text
            stack.push({
              node,
              isExit: true,
              setClass: ctx.currentClass,
              setFunc: prevFunc,
              // The class DECLARATION must be restored alongside the class NAME, and this exit
              // frame omitted it — so entering ANY method cleared `currentClassKey` on the way
              // out, and only the FIRST method of a class kept its owner's declaration.
              // Measured in `test_dataclasses.py`: of fifteen methods owned by
              // `TestMakeDataclass`, FOURTEEN had no `ownerClassKey`. The override resolution
              // then fell back to the name-keyed base table, which is precisely the path that
              // cannot tell a namesake from a base, and a class inheriting `unittest.TestCase`
              // next to a local `class TestCase` published fabricated overrides again.
              //
              // It is the same mistake as PY-21's defect three, one field wide: two pieces of
              // state that mean the same thing were tracked separately, and only one of them was
              // maintained on every path. The exit frame is the ONLY place a scope is restored,
              // which makes it the place a scope has to be complete.
              setClassKey: prevClassKey,
            })
          }
          break
        }
        case "import_statement":
        case "import_from_statement": {
          this.extractImport(node, ctx)
          break
        }
        case "assignment":
        case "augmented_assignment":
        case "named_expression": {
          this.extractAssignment(node, ctx)
          break
        }
        case "call": {
          this.processCall(node, ctx)
          break
        }
        case "type_alias_statement": {
          this.extractTypeAlias(node, ctx)
          break
        }
        case "decorated_definition": {
          // The decorator nodes are metadata on the wrapped class/function;
          // the class/function node itself is visited as a child normally.
          ctx.patterns["Decorators"] = true
          break
        }
        case "except_clause": {
          // Exception types in except clauses are references to exception
          // classes; keep as a pattern only (no relationship noise).
          ctx.patterns["Exception Handling"] = true
          break
        }
      }

      // Push children in reverse order to maintain document-order traversal.
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child })
      }
    }

    // PY-D18 (round 10): `global X` + a creating write is a MODULE-scope binding, so publish the
    // symbol the write proves — after the walk, so the dedupe sees everything the file declared.
    // The dangling edges that named such a name now resolve to a real declaration in the real
    // scope CPython resolved it to, rather than being excused as unresolvable.
    this.publishGlobalWriteBindings(rootNode, ctx)

    // PY-D23 (round 12): a module-scope or class-scope binding written by a statement that is NOT
    // an assignment — `for x in …`, `with … as x`, `except E as x`. Same post-loop placement for
    // the same reason: the dedupe must see every declaration the file's other paths published.
    this.publishScopeBinderBindings(rootNode, ctx)

    // Post-loop: contains for class → member ownership (module-level symbols
    // are ownerless — Python has no module declaration, JS-family contract).
    for (const s of ctx.symbols) {
      const owner = s.ownerName
      if (owner && owner !== s.name) {
        // PY-23 (R7). The endpoint of this edge is a bare leaf, and a bare leaf can be a
        // name the STORE has already reserved. `SafeUUID` in CPython's `uuid.py` is an Enum
        // with a member literally named `unknown`:
        //
        //     class SafeUUID(Enum):
        //         safe = 0
        //         unsafe = -1
        //         unknown = None
        //
        // which published `contains SafeUUID -> unknown`. `unknown` is the placeholder
        // literal standing rule R7 forbids as an endpoint AND a member of the indexer's
        // own `GENERIC_SOURCE_NAMES` (`src/ast/parallel-indexer.ts:3519`), so a real
        // symbol and a synthetic scope became the same string, and nothing downstream can
        // tell them apart.
        //
        // Measured over the whole derived population (5,984 files) this was 7 edges, all
        // from this one construct: 1 `contains` and 6 `uses`, 4 of them in `uuid.py`
        // itself. Found by the RESOLVED question of the six-questions instrument and by
        // nothing else — no fixture, no mutant, no completeness gate, because the edge is
        // structurally perfect and its endpoint is a real member of a real class.
        //
        // The fix is not to drop the edge: the containment is true and `SafeUUID.unknown`
        // is navigable in Python. The fix is to publish the name the way every other
        // member edge in this analyzer already does — qualified by its owner — so the
        // endpoint is a real symbol path rather than a reserved bare word. Resolution then
        // finds the member instead of the indexer's synthetic-scope list matching first.
        this.pushRel(ctx, owner, qualifyReservedEndpoint(s.name, owner), ASTEngine.RelationshipType.Contains, 1.0, {}, s.range?.startLine)
      }
    }

    // Overrides: Derived.method -> Base.method when the base declares the
    // same-name method (in-file or via the cross-file companion index).
    this.extractOverrideRelationships(ctx, context)

    // PYD1 family contract: member READS emit `uses` (csharp/dart/php/ruby/
    // swift/objc all do — python was the only managedoo analyzer with none).
    // classifyEvidenceTier runs LAST so every edge — including declared-type
    // refs and member uses created above — leaves with an evidenceClass.
    this.extractDeclaredTypeRefs(rootNode, ctx.relationships, phantomDefs, ctx.moduleName, ctx.functionLocals)
    this.extractMemberUses(rootNode, ctx, phantomDefs)
    this.extractVirtualRegistrations(rootNode, ctx)
    this.classifyEvidenceTier(ctx.relationships)

    const detectedFrameworks: string[] = PY_FRAMEWORK_ORDER.filter((f) => ctx.frameworks[f])
    const detectedPatterns: string[] = []
    for (const p in ctx.patterns) detectedPatterns.push(p)

    return {
      language: "python",
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      errors: ctx.errors,
      metadata: {
        complexity: cyclomaticComplexity,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: detectedFrameworks[0],
        patterns: detectedPatterns,
        detectedFrameworks,
        frameworkPatterns: detectedFrameworks.map((f) => ({
          framework: f,
          patterns: [
            {
              type: PY_FRAMEWORK_PATTERN[f] ?? "usage",
              detected: true,
              description: `${f} usage detected`,
            },
          ],
        })),
        hasTypeInference: true,
        hasFrameworkIntelligence: true,
        analysisVersion: "3.1.0-python-m12.27",
      },
    }
  }

  // ========================================================================
  // EXTRACTION METHODS
  // ========================================================================

  /**
   * What this FILE proves about the names it uses — the evidence an `implements` edge
   * needs, gathered before the main walk because a class can precede the import that
   * proves its base (python resolves names at runtime, not positionally; the same reason
   * `preScan` exists above for forward references).
   *
   * WHY AN EDGE IS NEEDED AT ALL. Python has no `interface` keyword and no `implements`
   * clause. Measured over the whole derived corpus (5,984 python files through production
   * `parseFile`), the grammar produces 117 node types and NONE of
   * `interface_declaration` / `protocol_declaration` / `abstract_class_declaration` /
   * `implements_clause` / `trait_declaration`, against 21,008 `class_definition` nodes.
   * So the construct cannot arrive as its own grammar node — it arrives as something INSIDE
   * the base list, which is exactly where every other OO language puts `extends`.
   *
   * The base list therefore carries TWO distinct facts and the analyzer was publishing only
   * one of them as `extends`:
   *
   *   class C(Base)       Base is a class.            -> extends
   *   class C(Mapping)    Mapping is an INTERFACE.    -> implements
   *
   * The second line is not a python quirk. `collections.abc` is the standard library's
   * interface catalogue and `typing.Protocol` is its structural-interface primitive; measured
   * over the corpus, 100 class bases are proven to be one of these, 85 classes declare one
   * with `metaclass=ABCMeta`, and 113 classes declare one by carrying `@abstractmethod`
   * methods. `sqlite3/dbapi2.py:54` goes further and states conformance with NO inheritance
   * at all — `collections.abc.Sequence.register(Row)`.
   *
   * WHY THIS IS A PRE-PASS AND NOT A NAME LOOKUP. The proof is the FILE'S OWN IMPORT, not a
   * name's spelling. `ABC` is a legal class name a user can define, and 27 base occurrences
   * of `Protocol` in this corpus are exactly that (24 of them inside CPython's own
   * `typing.py`, which DEFINES the class it then names, plus asyncio's local `protocols`
   * module). Accepting the spelling would have relabelled 27 `extends` edges that are
   * correct. Every proof below is therefore either an import in this file, a dotted spelling
   * whose root this file imported, or a class this file itself declared abstract.
   */
  private collectInterfaceBindings(rootNode: Node): InterfaceBindings {
    const out: InterfaceBindings = {
      abcNames: new Set(),
      protocolNames: new Set(),
      collectionsAbcNames: new Set(),
      importRoots: new Set(),
      markerLines: new Map(),
      classDecls: [],
      localAbstractClasses: new Set(),
    }
    // ONE ITERATIVE WALK, not two recursive ones.
    //
    // MEASURED, and this is the reason the shape is what it is. The first version did a
    // recursive import scan and then a recursive abstract-class scan, both over the whole
    // tree and both before the main walk. On a derived 400-file sample through the
    // production path that cost +32.04% wall clock (36,426 ms -> 48,096 ms) against the
    // e73c3e58e baseline, for 30 additional edges — +0.00% relationship payload. A 32%
    // latency charge for 30 edges is a bad trade at any volume, and the brief is explicit
    // that an addition regressing a budget is to be reported rather than absorbed.
    //
    // Two things make it cheap now. The walks are MERGED: the abstract-class question needs
    // the import bindings, so a second pass existed only to sequence them, and the
    // dependency is resolved per class AFTER the walk instead — each class records the raw
    // evidence (does it name ABCMeta, which abstract-decorator leaves does its body use) and
    // the verdict is computed once the file's bindings are known. And the traversal is
    // ITERATIVE, matching this file's own stated contract ("Iterative stack traversal (no
    // recursion, no call-stack explosions)") — the recursive version was a latent stack
    // overflow on a deeply nested file, which is a correctness risk a timing number does not
    // show.
    const stack: Node[] = [rootNode]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "import_statement") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c?.type === "dotted_name") out.importRoots.add(c.text.split(".")[0])
        }
      } else if (n.type === "import_from_statement") {
        const modNode = n.childForFieldName("module_name")
        const mod = modNode?.text ?? ""
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          // `.id`, not object identity: web-tree-sitter hands back a FRESH wrapper
          // on every access, so `c === modNode` was never true and the module name
          // of `from X import a` was read as a bound name — the guard this comment
          // describes had been a no-op since the day it was written (hygiene class
          // KAD2/TSD2, caught by script/m14/verify-analyzer-hygiene.ts).
          if (!c || c.id === modNode?.id) continue
          // `from X import a, b` — each named child after the module is a bound name.
          // An aliased import makes TWO names matter and conflating them is a real bug this
          // fixture caught: `from abc import ABC as BaseABC` PROVES the import name `ABC`
          // and BINDS the alias `BaseABC`. Testing the bound name against the literal
          // "ABC" silently failed to prove it, so `class C(BaseABC)` stayed `extends` — the
          // one shape that is unambiguously an abstract base class, mislabelled by an
          // alias.
          let imported: string | undefined
          let bound: string | undefined
          if (c.type === "identifier") { imported = c.text; bound = c.text }
          else if (c.type === "dotted_name") { imported = c.text; bound = c.text.slice(c.text.lastIndexOf(".") + 1) }
          else if (c.type === "aliased_import") {
            const alias = c.childForFieldName("alias")
            const nm = c.childForFieldName("name")
            imported = nm?.text
            bound = alias?.text ?? (imported ? imported.slice(imported.lastIndexOf(".") + 1) : undefined)
          }
          if (!imported || !bound) continue
          const importedLeaf = imported.slice(imported.lastIndexOf(".") + 1)
          // PY-29: every marker binding records the LINE it was made on, for the positional
          // bare-name test. `python/interface-implements` declares a local `class ABC` at L75
          // and a subclass at L80: without the line, `ABC` looks like the stdlib everywhere
          // in the file and that subclass gets a fabricated `implements`.
          const boundLine = n.startPosition.row + 1
          if (mod === "abc") {
            if (importedLeaf === "ABC" || importedLeaf === "ABCMeta") {
              out.abcNames.add(bound)
              out.markerLines.set(bound, boundLine)
            }
          } else if (mod === "typing" || mod === "typing_extensions") {
            // typing_extensions is the backport and is what a library still supporting 3.7
            // imports; measured on this corpus, pydantic writes
            // `from typing_extensions import Protocol` in 21 of its base lists. Accepting
            // only `typing` would have left the corpus's largest source of Protocol
            // declarations relabelled as `extends`.
            if (importedLeaf === "Protocol") {
              out.protocolNames.add(bound)
              out.markerLines.set(bound, boundLine)
            }
          } else if (mod === "collections.abc") {
            out.collectionsAbcNames.add(bound)
            out.markerLines.set(bound, boundLine)
          }
        }
      } else if (n.type === "class_definition") {
        // Record the class's RAW header evidence — the bases AS WRITTEN and whether the
        // header names ABCMeta. The tier verdict waits for the whole file's bindings, which
        // is the only ordering the single walk has to respect.
        const nameNode = this.findChildByType(n, "identifier")
        let namesAbcMeta = false
        const bases: PyBaseRef[] = []
        const args = this.findChildByType(n, "argument_list")
        if (args) {
          for (let i = 0; i < args.namedChildCount; i++) {
            const a = args.namedChild(i)
            if (!a) continue
            if (a.type === "keyword_argument") {
              const kn = a.childForFieldName("name")?.text
              const kv = a.childForFieldName("value")
              if (kn === "metaclass") {
                if (this.baseClassLeaf(kv) === "ABCMeta" || this.dottedTail(kv) === "abc.ABCMeta") namesAbcMeta = true
              }
              continue
            }
            const leaf = this.baseClassLeaf(a)
            if (!leaf) continue
            bases.push({ leaf, dotted: this.baseDottedSpelling(a) })
            if (leaf === "ABCMeta") namesAbcMeta = true
          }
        }
        if (nameNode?.text) {
          out.classDecls.push({
            name: nameNode.text,
            line: n.startPosition.row + 1,
            namesAbcMeta,
            bases,
          })
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }

    // Now that the file's bindings are known, settle each class. O(number of classes), not
    // O(tree).
    //
    // A CLASS DECLARES AN INTERFACE BY ITS HEADER, and by nothing else. The pass this
    // replaced also accepted `@abstractmethod` on a method — and that is a different claim,
    // measured false on the interpreter: `__abstractmethods__` is computed by
    // `ABCMeta.__new__`, so an `@abstractmethod` on a class whose metaclass is `type` is a
    // marker the interpreter does nothing with. `class ProductBuilder(object)` with four
    // such decorators (swift-corpus's `swift_build_support/products/product.py:544`) has an
    // empty `__abstractmethods__` and INSTANTIATES, and the lane was publishing a fabricated
    // `implements` at confidence 1.0 with `evidenceClass: structural` for every subclass of
    // such a class. Both spellings are pinned as forbid rows by
    // `python/interface-declaration-needs-abc-meta` (`SubNoopAbstract`, `SubPlain`), whose
    // positive rows (`SubAbcBase`, `SubMetaclassBase`, `SubProtocolBase`, `SubParameterised`,
    // `SubEmptyAbc`) are the three header shapes that DO declare one, at tier 0 and tier 1
    // alike. The decorator branch that fed it is deleted rather than left dormant: a rule
    // that fires on a spelling the interpreter ignores is not a rule a later edit should be
    // able to switch back on by accident.
    for (const c of out.classDecls) {
      if (this.pythonDeclaresInterface(c.name, out)) out.localAbstractClasses.add(c.name)
    }
    return out
  }

  /**
   * The dotted spelling a base expression was written with, or null for a bare name.
   *
   * PY-29: a SUBSCRIPT base records its HEAD's spelling. `typing.Protocol[RuntimeT]` is a
   * `subscript` whose head is the dotted name `typing.Protocol`, and the pre-pass read
   * "qualified" as `base.type === "attribute"`, so this head was classified as BARE and
   * resolved against whatever the file last bound `Protocol` to. In
   * `python/interface-qualified-subscript-head` that is a LOCAL class three lines below, so
   * both rows the fixture pins went missing; in the neighbouring fixture the same wrong rule
   * happens to reach the right answer, which is exactly why one fixture could not falsify it.
   * `extractClass` already reads that head as qualified for `qualifiedBases` — the same rule,
   * one position over, in the same file — so this is that rule made shareable rather than a
   * second convention.
   */
  private baseDottedSpelling(node: Node | null | undefined): string | null {
    if (!node) return null
    const head = node.type === "subscript" ? node.namedChild(0) : node
    if (!head) return null
    return this.dottedTail(head)
  }

  /**
   * Is this base an interface the file can PROVE, and by which reading?
   *
   * Tier 0 (`stdlib-interface-marker`): the base names a stdlib interface — `abc.ABC` /
   * `abc.ABCMeta`, `typing`/`typing_extensions.Protocol`, or anything out of
   * `collections.abc` — and the proof is this FILE's own binding, never the spelling. A
   * DOTTED base is self-proving once its ROOT is imported here (`import abc` makes `abc.ABC`
   * unspellable as a user class). A BARE base is positional: the name must be bound to the
   * marker by an import at or ABOVE the class's own line, and no class declaration may have
   * rebound it in between, because python evaluates the base expression against the module
   * globals as they stand on that line.
   *
   * Tier 1 (`in-file-interface-base`): the base names a class THIS FILE declares and whose
   * own header declares an interface — the transitivity python actually has, and the reason
   * `class Service(Repository)` is an implementation when `Repository(ABC)` is. Recursion is
   * guarded both by a visited set and by declaration ORDER (a base is declared before the
   * class that inherits it, or it is not the base), so a cyclic or forward reference cannot
   * loop or claim an interface that does not exist yet.
   */
  private pythonDeclaresInterface(name: string, ib: InterfaceBindings, seen: Set<string> = new Set()): boolean {
    if (seen.has(name)) return false
    seen.add(name)
    const decl = ib.classDecls.find((c) => c.name === name)
    if (!decl) return false
    if (decl.namesAbcMeta) return true
    for (const b of decl.bases) {
      if (this.pythonMarkerKindForBase(b, decl.line, ib)) return true
      const inFile = ib.classDecls.find((c) => c.name === b.leaf && c.line < decl.line)
      if (inFile && this.pythonDeclaresInterface(b.leaf, ib, seen)) return true
    }
    return false
  }

  /**
   * Tier 0 only: the stdlib marker a base proves, or null.
   *
   * Split out from `interfaceBaseKind` because the tier-1 verdict asks this question about
   * OTHER classes' bases, where there is no AST node in hand — only the recorded spelling
   * and the line it was written on.
   */
  private pythonMarkerKindForBase(base: PyBaseRef, atLine: number, ib: InterfaceBindings): string | null {
    if (base.dotted) {
      const root = base.dotted.split(".")[0]
      if (!ib.importRoots.has(root)) return null
      if (base.dotted === "abc.ABC" || base.dotted === "abc.ABCMeta") return "abc"
      if (base.dotted === "typing.Protocol" || base.dotted === "typing_extensions.Protocol") return "typing"
      if (root === "collections" && base.dotted.startsWith("collections.abc.")) return "collections.abc"
      return null
    }
    const boundLine = ib.markerLines.get(base.leaf)
    if (boundLine === undefined || boundLine > atLine) return null
    // A class THIS FILE declares with the same name, above this line, rebinds the name and
    // wins: the base expression sees the local class, not the import.
    const shadow = ib.classDecls.find((c) => c.name === base.leaf && c.line < atLine)
    if (shadow) return null
    if (ib.abcNames.has(base.leaf)) return "abc"
    if (ib.protocolNames.has(base.leaf)) return "typing"
    if (ib.collectionsAbcNames.has(base.leaf)) return "collections.abc"
    return null
  }

/**
   * Is this class base an INTERFACE rather than a class?
   *
   * Returns the proving module when it is, and null when it is not — the caller then emits
   * `extends`. One base, one edge, and the label is the most specific true label: this is
   * the same decision the C# lane made on the same construct
   * (`src/ast/real-csharp-analyzer.ts:1371-1380`, `isImplements ? Implements : Extends`),
   * and it is why publishing BOTH labels is not done here either — two edges for one
   * syntactic fact double the graph without adding information, which is the argument this
   * lane already used to rule `references` out.
   *
   * `typing.Generic` is measured and EXCLUDED: 291 base occurrences in this corpus, more
   * than `ABC` and `Protocol` combined, and it is a type-parameter marker, not an
   * interface. Accepting it would have made `implements` the largest type in the analyzer
   * and been wrong about every one of those edges.
   *
   * PY-25 — THAT EXCLUSION WAS DEAD CODE, and mutation is what found it. This method
   * originally carried an explicit `leaf === "Generic"` refusal. Mutant M5b deleted the
   * clause outright and **every one of the 21 python fixtures still passed**, because
   * `Generic` is never in `abcNames`, `protocolNames` or `collectionsAbcNames` — only
   * `Protocol` is carried from `typing` — so the clause could never have fired. A dead
   * branch is exactly what the workstream says source derivation cannot see ("a branch that
   * never matches is dead code and derivation cannot see it"), and this is that case found
   * by deliberately breaking the code rather than by reading it.
   *
   * So the clause is deleted, because leaving a guard that guards nothing is worse than
   * not having it: it advertises a protection that a future edit can remove without any
   * test noticing. The real mechanism is one line above in `collectInterfaceBindings` —
   * only `Protocol` is carried out of `typing` — and the measurement that keeps it that
   * way is in the fixture, as a forbid row on `GenericOnly -> Generic` which fails the
   * moment anyone adds `Generic` to the typing set.
   */
  private interfaceBaseKind(base: Node, ib: InterfaceBindings, atLine: number): { kind: string; reasonCode: string } | null {
    const leaf = this.baseClassLeaf(base)
    if (!leaf) return null
    // A DOTTED base is a DIFFERENT BINDING from the bare name, and the bare-name proofs
    // must not be consulted for it.
    //
    // PY-26, found by the fixture row written to kill a different mutant. Given
    //
    //     from typing import Protocol
    //     class Unbound(vendor_base.Protocol): ...
    //
    // the bare route fired first — `Protocol` IS a proven name in this file — and relabelled
    // `vendor_base.Protocol`, which is some third-party module's own class called Protocol,
    // that this analyzer has never read. `typing.Protocol` and `vendor_base.Protocol` share
    // a leaf and nothing else. Every routing decision here has to be made on the SHAPE of
    // the base, and the shape is the whole question: `Protocol` proves `Protocol`,
    // `abc.ABC` proves itself once `abc` is bound, and `vendor_base.Protocol` proves
    // nothing until this file has bound `vendor_base`.
    //
    // PY-29: the shape is read by `baseDottedSpelling`, so a SUBSCRIPT records its head —
    // `typing.Protocol[RuntimeT]` is the qualified spelling, not a bare `Protocol`.
    const written: PyBaseRef = { leaf, dotted: this.baseDottedSpelling(base) }
    const marker = this.pythonMarkerKindForBase(written, atLine, ib)
    if (marker) {
      // `stdlib-interface-marker` is the reason code the fixture set assigns to this tier:
      // the proof is a stdlib import in this file, and the code names THAT fact rather than
      // repeating the confidence. `interfaceKind` still carries which module proved it —
      // `abc`, `typing`, `collections.abc` — because three different proofs with three
      // different measured bases are not one fact.
      return { kind: marker, reasonCode: "stdlib-interface-marker" }
    }
    // TIER 1 — the base is a class THIS FILE declares and ITS header declares an interface.
    // `class Service(Repository)` with `class Repository(ABC)` is an interface
    // implementation, and it is the tier where a header-only rule pays off: the same
    // fixture (`python/interface-declaration-needs-abc-meta`) pins `SubNoopAbstract` and
    // `SubPlain` as forbids, so a class whose only abstractness is an `@abstractmethod`
    // marker is NOT a tier-1 interface and its subclasses stay ordinary inheritance.
    const inFile = ib.classDecls.find((c) => c.name === leaf && c.line < atLine)
    if (inFile && this.pythonDeclaresInterface(leaf, ib)) {
      return { kind: "in-file", reasonCode: "in-file-interface-base" }
    }
    return null
  }

  /** The dotted text of a name expression: `abc.ABC` -> "abc.ABC", `X` -> null. */
  private dottedTail(n: Node | null | undefined): string | null {
    if (!n) return null
    if (n.type === "identifier") return null
    if (n.type === "attribute") {
      const obj = n.childForFieldName("object")
      const attr = n.childForFieldName("attribute")
      if (!obj || !attr) return null
      const head = obj.type === "identifier" ? obj.text : this.dottedTail(obj)
      return head ? `${head}.${attr.text}` : attr.text
    }
    if (n.type === "decorator") {
      const first = n.namedChild(0)
      return first ? this.dottedTail(first) : null
    }
    return null
  }

  /**
   * `SomeABC.register(SomeClass)` — Python's conformance declaration with NO inheritance.
   *
   * This is the one form where the language states conformance outright, and it is why the
   * `implements` verdict is GAP rather than RULED. But the SPELLING `.register(` is a
   * homonym: measured over 5,984 corpus files there are 493 `X.register(Y)` calls and only
   * ONE whose receiver is provably an abstract base class. The rest are `site.register` (241),
   * `selector.register` (21), `SyncManager.register` (17), `self.register` (17) and Flask's
   * `blueprint.register` — emitting from the bare spelling would have fabricated ~492 wrong
   * edges and poisoned bb_graph on any project that uses a plugin registry. So the receiver
   * must be proven, and the surviving site is real:
   *
   *     cpython-stdlib/sqlite3/dbapi2.py:54   collections.abc.Sequence.register(Row)
   *
   * Confidence is 0.9, not 1.0: the receiver is proven but the ARGUMENT is read as a leaf
   * name, and `Row` is a class this analyzer may not have read the declaration of.
   */
  private extractVirtualRegistrations(rootNode: Node, ctx: PythonContext): void {
    const ib = ctx.interfaceBindings
    if (!ib) return
    const walk = (n: Node): void => {
      if (n.type === "call") {
        const fn = n.childForFieldName("function")
        if (fn?.type === "attribute") {
          const attr = fn.childForFieldName("attribute")
          if (attr?.text === "register") {
            const recv = fn.childForFieldName("object")
            let kind: string | null = null
            const recvDotted = this.dottedTail(recv)
            const recvLeaf = this.baseClassLeaf(recv)
            if (recvDotted && ib.importRoots.has(recvDotted.split(".")[0])) {
              if (recvDotted === "abc.Sequence" || recvDotted === "abc.Iterable" ||
                  recvDotted === "abc.Container" || recvDotted === "abc.Hashable" ||
                  recvDotted === "abc.Sized" || recvDotted === "abc.Mapping" ||
                  recvDotted === "abc.Set") kind = "abc"
              else if (recvDotted === "collections.abc.Sequence" || recvDotted === "collections.abc.Iterable" ||
                       recvDotted === "collections.abc.Mapping" || recvDotted === "collections.abc.Set" ||
                       recvDotted === "collections.abc.Hashable") kind = "collections.abc"
            } else if (recvLeaf) {
              if (ib.collectionsAbcNames.has(recvLeaf)) kind = "collections.abc"
              else if (ib.localAbstractClasses.has(recvLeaf)) kind = "declared-abstract-class"
            }
            if (kind) {
              const args = n.childForFieldName("arguments")
              const first = args?.namedChild(0)
              const target = first ? this.baseClassLeaf(first) : null
              if (target && target !== "unknown") {
                const owner = ctx.currentClass ?? ctx.moduleName
                this.pushRel(ctx, target, recvLeaf ?? recvDotted ?? "", ASTEngine.RelationshipType.Implements, 0.9, {
                  pythonSpecific: true,
                  interfaceKind: kind,
                  reasonCode: "virtual-registration",
                  note: "declared conformance via ABC.register, with no inheritance in the base list",
                }, this.nodeLine(n))
                void owner
              }
            }
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    walk(rootNode)
  }

  private extractClass(node: Node, ctx: PythonContext) {
    const nameNode = this.findChildByType(node, "identifier")
    if (!nameNode?.text) return
    const className = nameNode.text

    const docstring = this.extractDocstring(node)
    const baseClasses: string[] = []
    let isEnum = false

    const argsNode = this.findChildByType(node, "argument_list")
    if (argsNode) {
      for (let i = 0; i < argsNode.namedChildCount; i++) {
        const arg = argsNode.namedChild(i)
        if (!arg) continue
        // PYD6 (two-corpus gate finding, requests/_types.py:157): TypedDict
        // declarations carry KEYWORD arguments in the base list —
        // `class X(TypedDict, total=False)` parses the kwarg as a
        // keyword_argument child (`total` name + `False` value), and the
        // blanket descent named `total` as a fabricated base class
        // (extends X -> total). Keywords are NOT base classes; skip them
        // (also skips splat/unpacking forms, which are never class bases).
        if (arg.type === "keyword_argument") continue
        // Base class leaf: `Generic[T]` → `Generic`, dotted `a.b` → `b`.
        const baseLeaf = this.baseClassLeaf(arg)
        if (!baseLeaf) continue
        baseClasses.push(baseLeaf)
        if (baseLeaf === "Enum") isEnum = true
        // Name-collision suppression (#299): `class _X(_X):` (the real
        // IpythonMagic.py PGO shadowing idiom) rebinds the name — the inner
        // class is NOT the outer one, so a same-name extends edge is a
        // fabricated self-loop. Skip it (the leaf text is still recorded in
        // baseClasses metadata for payload honesty).
        if (baseLeaf !== className) {
          // `implements`, not `extends`, when this file proves the base is an interface.
          // RELABEL, not addition: one base, one edge, most specific true label. Publishing
          // both would put two rows for one syntactic fact into `brain_relationship` for
          // every one of these, and the six-questions instrument's pairwise co-occurrence
          // measure would immediately report an `extends|implements` cell that means
          // "this analyzer has not decided". The C# lane made the same call on the same
          // construct (real-csharp-analyzer.ts:1371-1380).
          //
          // Confidence is 1.0 and not a heuristic, and the reason is a measurement rather
          // than a convention: the proof is an IMPORT IN THIS FILE, so the source itself
          // asserts both that the name is the stdlib's and that the class conforms to it.
          // There is no case where the import exists and the claim is false.
          const ifaceKind = ctx.interfaceBindings
            ? this.interfaceBaseKind(arg, ctx.interfaceBindings, node.startPosition.row + 1)
            : null
          // INCOMING_PY — the base's SPELLING, when the source wrote one: `class
          // SiblingCase(unittest.TestCase)` names the leaf `TestCase` and proves `unittest`
          // is the module that carries the lookup, so a consumer can follow the import edge
          // to the real base instead of guessing among every same-named leaf in the project.
          // A base spelled as a bare identifier records NOTHING, because `Bare` written alone
          // has no receiver and `qualified: "Bare"` would be a spelling the source never
          // wrote — pinned as a negative row by `python/qualified-endpoint-spellings`.
          // Subscripts mirror `qualifiedBases` below (`pa.Table[T]` qualifies as `pa.Table`):
          // one rule, two readers, so the exclusion that keeps a qualified base from binding
          // to a local namesake and the metadata a consumer reads can never disagree.
          const baseQualifier = ((): string | undefined => {
            if (arg.type === "attribute") return arg.text
            if (arg.type === "subscript") {
              const head = arg.namedChild(0)
              if (head && head.type === "attribute") return head.text
            }
            return undefined
          })()
          // PY-D15 (round 8) — A BASE THAT IS A VARIABLE, not a class.
          //
          // `class Row(dump_cls)` is real python and real in the corpus: the base is decided at
          // RUNTIME by whichever branch ran (`dump_cls = _py_row.BaseRow` or `_cy_row.BaseRow`)
          // and the class it names does not exist until then. The edge is worth publishing — the
          // source does name a base — but a consumer must be able to tell it from
          // `class SiblingCase(unittest.TestCase)`, which is the same shape and an entirely
          // different claim.
          //
          // MEASURED over the whole-population verdict before this line: 15 UNEXPLAINED
          // `extends` targets, 14 of them a name bound in the ENCLOSING FUNCTION (a test method's
          // local, a parameter) and 1 a file CPython itself cannot parse. Confidence stays 1.0
          // because the SOURCE fact is exact — the class body's base list is literally these names
          // — which is the same reasoning that lets `implements` carry a reason code at 1.0 three
          // lines below. What the code adds is that the TARGET is a value whose type nothing here
          // knows, so a resolution step must not read the leaf as a class name.
          const baseBindingReason = this.dynamicTypeBindingReason(arg, baseLeaf, ctx.functionLocals)
          this.pushRel(ctx, className, baseLeaf, ifaceKind
            ? ASTEngine.RelationshipType.Implements
            : ASTEngine.RelationshipType.Extends, 1.0, {
            pythonSpecific: true,
            ...(baseQualifier ? { qualified: baseQualifier } : {}),
            ...(ifaceKind ? { interfaceKind: ifaceKind.kind, reasonCode: ifaceKind.reasonCode } : {}),
            ...(!ifaceKind && baseBindingReason ? { reasonCode: baseBindingReason } : {}),
          }, this.nodeLine(arg))
        }
      }
    }

    const decorators = this.extractDecorators(node, ctx, className)

    const kind = isEnum ? ASTEngine.SymbolKind.Enum : ASTEngine.SymbolKind.Class
    // A CLASS NESTED IN A CLASS BODY IS A MEMBER OF IT. `Outer.Inner` is reachable from
    // `Outer` in Python without any lookup machinery, so the nesting is a real containment
    // and not a lexical coincidence.
    //
    // This was the first genuine ANALYZER defect the independent oracle found, and it is
    // worth recording how: the differential reported 66 `contains` edges that the tree
    // supports and the analyzer did not emit, across 24 corpus files — `_Multipart._Part`
    // in `urllib/parse.py`, `CryptFacade._CryptData`, and a dozen class-in-class test
    // fixtures. Every earlier disagreement in this review turned out to be the oracle's,
    // which is exactly why an instrument that cannot lie is worth the trouble of building:
    // this one was the analyzer's, and no fixture, mutant or completeness gate had noticed,
    // because `contains` is derived from `ownerName` and a nested class simply had none.
    //
    // The guard is `currentFunction === undefined` and it is load-bearing. `currentClass`
    // alone would also be true for a class declared inside a METHOD — `Outer.om` defines
    // `Deep` — and that `Deep` is a LOCAL of `om`, not a member of `Outer`: it is not
    // reachable as `Outer.Deep` and claiming it is would put a name on the outer class's
    // surface that the source does not give it. Entering a class clears `currentFunction`
    // and entering a function sets it, so "in a class body" and "in a method" are
    // distinguishable here without a second piece of state.
    const enclosingClass = ctx.currentClass && !ctx.currentFunction ? ctx.currentClass : undefined
    ctx.symbols.push({
      name: className,
      kind,
      range: this.nodeToRange(node),
      ...(enclosingClass
        ? { ownerName: enclosingClass, ownerKind: ASTEngine.SymbolKind.Class }
        : {}),
      visibility: "public",
      decorators,
      docstring,
      comments: docstring ? [docstring] : [],
      metadata: {
        pythonSpecific: true,
        baseClasses,
        // PY-35 — THE WALKABLE HERITAGE COLUMN, and it is published from the FULL base list.
        //
        // `metadata.superTypes` is the one field the store copies into
        // `brain_symbol.super_types`, and that column is what the resolution machinery walks
        // (`member-owner-resolution.ts` builds its ancestor frontier from it,
        // `override-retarget.ts` reads it, and the pool worker carries it across the
        // analyzer boundary — the PHPD41 fix, whose allowlist now admits this key). This lane
        // published `baseClasses` and NOT this, so every python class had a NULL heritage
        // column: the ancestor walk had no parents for the whole language, and a member read
        // through a base could not be resolved at all.
        //
        // It carries EVERY base, including the ones whose edge is `implements`. That is the
        // point, and it is the half of PY-34's ruling that keeps `implements` from costing a
        // fact: a proven interface base still publishes ONE relationship (`implements`, the
        // most specific true label — pinned by `python/implements-interface-bases` and
        // `python/interface-qualified-subscript-head`, whose additive `extends` rows this
        // change removes), while the MRO parent stays reachable for every consumer that
        // walks the hierarchy, because the column that exists to be WALKED is not the edge
        // label. A consumer asking "what does this class inherit from" reads the same list
        // the override resolution does, and gets `Mapping` whether the edge is spelled
        // `extends` or `implements`.
        superTypes: baseClasses,
        isEnum,
        ...(enclosingClass ? { isNestedClass: true } : {}),
      },
    })
    ctx.functionSymbolIndex[`::${className}`] = ctx.symbols.length - 1
    ctx.declaredTypes.add(className)
    // Bases are recorded against THIS DECLARATION, not against the class name. Two classes
    // may share a name in one file and have nothing to do with each other, so a name-keyed
    // base table hands a base-less class the bases of an unrelated namesake.
    ctx.basesByClassKey.set(`${className}@${node.startPosition.row + 1}`, baseClasses.slice())
    // ...and separately, which of those bases were written QUALIFIED in the source. A base
    // spelled `unittest.TestCase` NAMES A CLASS THIS FILE HAS NOT READ, whatever a local class
    // happens to be called, and recording that distinction is what stops a leaf collision from
    // becoming an inheritance claim.
    const qualifiedBases: string[] = []
    {
      const argsNode = this.findChildByType(node, "argument_list")
      if (argsNode) {
        for (let i = 0; i < argsNode.namedChildCount; i++) {
          const arg = argsNode.namedChild(i)
          if (!arg || arg.type === "keyword_argument") continue
          if (arg.type === "attribute") {
            const leaf = this.baseClassLeaf(arg)
            if (leaf) qualifiedBases.push(leaf)
          } else if (arg.type === "subscript") {
            const first = arg.namedChild(0)
            if (first && first.type === "attribute") {
              const leaf = this.baseClassLeaf(first)
              if (leaf) qualifiedBases.push(leaf)
            }
          }
        }
      }
    }
    ctx.qualifiedBasesByClassKey.set(`${className}@${node.startPosition.row + 1}`, qualifiedBases)

    // Enum members: assignments with constant values inside the class body.
    if (isEnum) {
      const bodyNode = this.findChildByType(node, "block")
      if (bodyNode) {
        for (let i = 0; i < bodyNode.namedChildCount; i++) {
          const stmt = bodyNode.namedChild(i)
          if (!stmt || stmt.type !== "expression_statement") continue
          const assign = stmt.namedChild(0)
          if (!assign || assign.type !== "assignment") continue
          const left = assign.namedChild(0)
          const right = assign.namedChild(assign.namedChildCount - 1)
          if (!left || left.type !== "identifier") continue
          // PY-27, found by the independent differential rather than by a gate: `-1`
          // parses as a `unary_operator` wrapping an `integer`, not as an `integer`,
          // so `unsafe = -1` failed the constant test and CPython's own
          // `class SafeUUID(Enum)` published no member for it. Measured over the whole
          // derived population: 1 site in 253 enum members (132 enum classes, 5,984
          // files) — small, and a real member missing from the graph in the standard
          // library, which is worse than the count suggests.
          //
          // Only a SIGNED NUMERIC literal qualifies. `~x` and `not x` are also
          // `unary_operator` nodes and neither is constant, so the operand is what
          // decides and the operator is checked rather than assumed — and
          // `python/reserved-endpoint-qualification` pins both spellings as forbids
          // (`inverted = ~1`, `negated = not True`), because accepting any
          // `unary_operator` would invent an enum surface the source does not declare.
          //
          // The operator token is an ANONYMOUS child: `unary_operator` over `-1` has
          // `child(0) = "-"` with `isNamed === false` and `namedChild(0) = "1"`. A scan
          // over named children therefore finds no operator and every signed numeric
          // stayed excluded - which is the same off-by-a-child mistake the census made
          // twice in this session (see script/m14/python-construct-census.mts). Reading
          // the grammar's own child list, named and anonymous, is what fixes it.
          const signedNumeric = ((): boolean => {
            if (!right || right.type !== "unary_operator") return false
            let sign = false
            for (let k = 0; k < right.childCount; k++) {
              const c = right.child(k)
              if (c?.type === "-" || c?.type === "+") sign = true
            }
            if (!sign) return false
            const operand = right.namedChild(right.namedChildCount - 1)
            return !!operand && (operand.type === "integer" || operand.type === "float")
          })()
          // PY-30 — the CONTAINER spellings are literals too, and a filter keyed on the
          // value's node type was losing real members.
          //
          // `pstats.SortKey` is `class SortKey(str, Enum)` with comma-separated values
          // (`CALLS = 'calls', 'ncalls'`), which parses as an `expression_list` — NOT a
          // `tuple`, which is a different node and the whole reason this could not be
          // repaired by adding one more scalar type — so the analyzer published 5 of its 9
          // members and lost 4 `contains` edges CPython supports: `SortKey.__members__`
          // lists all nine and `SortKey.CALLS` resolves. Found by the DERIVATION paydown
          // (the oracle reported them missing), not by a gate, and pinned now by
          // `python/literal-versus-computed`: an `expression_list` (`SHADED = 1, 2`,
          // `BARE = "x", "y"`) and a `list` (`PAIRED = ["a", "b"]`) beside the `string`
          // shape that always worked.
          //
          // The value still has to BE a literal, which is the boundary the two fixtures
          // hold from both sides: the containers above are written in the source, while a
          // value COMPUTED by an operator (`~1`, `not True`, `a + b`) is not a member this
          // branch can read off the tree. That is the same rule the `__all__` branch
          // applied to name sets one construct away.
          const literalContainer = !!right && (right.type === "expression_list" ||
            right.type === "list" || right.type === "tuple" || right.type === "set" ||
            right.type === "dictionary" || right.type === "concatenated_string")
          // The NAME rule CPython's Enum actually applies, and it is the reason the
          // container spelling could not simply be accepted wholesale: a `NAME = value` in
          // an enum body is a member unless ENUM reserves the name. `__dunder__` and
          // `_sunder_` attributes are machinery (`_ignore_`, `_order_`, `__members__`), not
          // members, and `_EnumDict` refuses them for exactly that reason. Before PY-30 the
          // value filter hid this for the container shapes; widening the filter without
          // this line would publish `_order_ = "a b c"` — a string, already accepted today —
          // as an enum member of a class that has three real ones.
          const reservedByEnum =
            (left.text.startsWith("__") && left.text.endsWith("__")) ||
            (left.text.startsWith("_") && left.text.endsWith("_") && left.text.length > 1)
          if (!reservedByEnum && right && (signedNumeric || literalContainer ||
              right.type === "string" || right.type === "integer" ||
              right.type === "float" || right.type === "true" || right.type === "false" ||
              right.type === "none" || right.type === "identifier" || right.type === "call")) {
            ctx.symbols.push({
              name: left.text,
              kind: ASTEngine.SymbolKind.EnumMember,
              range: this.nodeToRange(left),
              ownerName: className,
              ownerKind: ASTEngine.SymbolKind.Enum,
              visibility: "public",
              metadata: { pythonSpecific: true, isEnumMember: true },
            })
          }
        }
      }
    }
  }

  /**
   * #748: the defs a container scope has already rebound away by the time the
   * module finishes executing — every same-name SYMBOL-LEVEL def except the
   * LAST one in its container.
   *
   * Container identity is the scope NODE, not the class NAME: two classes that
   * happen to share a name (redeclared, or in different branches) are different
   * containers, so their members never collide — the W2/J3 identity ruling,
   * applied to python's scope tree. "Symbol-level" is the analyzer's own scope
   * model, mirrored exactly: a `class_definition` opens a container AND clears
   * the function scope (so a method of a class nested in a function is a
   * symbol, exactly as the walk registers it), while a def inside a def is not
   * a symbol at all (PYD5) and therefore cannot be a phantom either.
   *
   * MEASURED before the change (range-keyed, 2026-09-24): 25 duplicate-name
   * scopes across both pinned corpora (cython 475 + requests 37 files) — 21
   * declaration chains and 3 BRANCH ALTERNATIVES (both kept), leaving exactly
   * ONE genuine rebinding in the whole corpus: tests/run/class_scope.py
   * MethodRedef.a, whose own docstring asserts this rule (`MethodRedef().a(5)`
   * is 7 — the SECOND body wins). requests has none. The corpus delta is
   * therefore ZERO edges on both sides, which is why the differential can never
   * score this rule and a fixture has to hold it.
   */
  private collectPhantomDefs(rootNode: Node): Set<string> {
    const phantoms = new Set<string>()
    // Container key -> name -> def keys, in document order. Both maps are keyed
    // by BYTE RANGE, never by node object or class name: web-tree-sitter hands
    // out a fresh wrapper per access (so `Set<Node>` membership silently never
    // holds — the same reason the parent gates above compare startIndex), and
    // container identity must be the scope NODE so two same-named classes stay
    // distinct containers.
    const byContainer = new Map<string, Map<string, { key: string; node: Node }[]>>()
    const containerKey = (n: Node): string => `${n.type}:${n.startIndex}:${n.endIndex}`
    const frames: { n: Node; container: string; inFn: boolean }[] = [
      { n: rootNode, container: containerKey(rootNode), inFn: false },
    ]
    while (frames.length > 0) {
      const { n, container, inFn } = frames.pop()!
      let nextContainer = container
      let nextInFn = inFn
      if (n.type === "class_definition" || n.type === "module") {
        nextContainer = containerKey(n)
        nextInFn = false
      } else if (n.type === "function_definition") {
        if (!inFn) {
          const name = this.findChildByType(n, "identifier")?.text
          if (name) {
            const m = byContainer.get(container) ?? new Map<string, { key: string; node: Node }[]>()
            m.set(name, [...(m.get(name) ?? []), { key: this.phantomKey(n), node: n }])
            byContainer.set(container, m)
          }
        }
        nextInFn = true
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) frames.push({ n: c, container: nextContainer, inFn: nextInFn })
      }
    }
    // ALTERNATIVES ARE NOT SHADOWS. Two same-name defs in different branches
    // (`if cond: def f ... else: def f ...`, `try: ... else: def f ...`) are
    // both live — exactly one of them runs, and which one is a runtime fact the
    // source does not settle — so neither may be dropped. MEASURED: 3 of the 4
    // duplicate-name sites the first (block-blind) version of this rule removed
    // from cython are this shape and NOT rebindings at all (Dependencies.py
    // record_results under `if os.environ.get('XML_RESULTS')`, runtests.py
    // skip_test under `try/except/else`, Pythran.py
    // pythran_is_numpy_func_supported under `if pythran is None`), and dropping
    // them cost 2 real edges. A rebinding is the same statement BLOCK binding a
    // name twice; a branch body is a different block by construction.
    const blockKey = (n: Node): string => {
      for (let p: Node | null = n.parent; p; p = p.parent) {
        if (p.type === "block") return `${p.type}:${p.startIndex}:${p.endIndex}`
      }
      return "" // module-level: the container itself is the block
    }
    for (const m of byContainer.values()) {
      for (const [name, defs] of m) {
        // A DECLARATION CHAIN is not a rebinding: type-checker overload stubs
        // (`@overload`) and property accessors (`@property` / `@x.setter` /
        // `@x.getter` / `@x.deleter`) coexist by design, and the family ruling
        // keeps them (the ts/dupkey rationale: "class-body overloads and
        // get/set pairs untouched"). MEASURED on python's pinned corpora: 21 of
        // the 25 duplicate-name scopes are chains (5 @overload groups in
        // cython's Shadow.py, 9 in requests, 7 accessor chains) — a blanket
        // last-wins would delete real symbols and real setter bodies from both.
        if (this.isDeclarationChain(defs, name)) continue
        for (let i = 0; i < defs.length - 1; i++) {
          const later = defs.slice(i + 1).some((d) => blockKey(d.node) === blockKey(defs[i].node))
          if (later) phantoms.add(defs[i].key)
        }
      }
    }
    return phantoms
  }

  /**
   * #748: does this group of same-name defs in one container form a declaration
   * CHAIN — defs the runtime is meant to keep together — rather than a
   * rebinding that shadows all but the last?
   *
   * Two markers, both read from the def's own decorators:
   *   * a CHAIN LEAF — `overload` (including `typing.overload`), `property`,
   *     `setter`, `getter`, `deleter`. The accessor leaves are enough without
   *     the receiver because the only thing `@x.setter` can decorate is a
   *     same-name def in the same container.
   *   * a SELF-QUALIFIED decorator — `@<name>.<attr>` (`prop.setter`,
   *     `f.register`). The general form of the same fact: the new function is
   *     DERIVED FROM the earlier binding of that name, so the earlier one is
   *     not shadowed at all.
   */
  private isDeclarationChain(defs: { key: string; node: Node }[], name: string): boolean {
    for (const d of defs) {
      const parent = d.node.parent
      if (!parent || parent.type !== "decorated_definition") continue
      for (let i = 0; i < parent.namedChildCount; i++) {
        const c = parent.namedChild(i)
        if (!c || c.type !== "decorator") continue
        const leaf = this.decoratorName(c)
        if (leaf === "overload" || leaf === "property" || leaf === "setter" || leaf === "getter" || leaf === "deleter") return true
        if (stripLeadingAt(c.text).trim().startsWith(`${name}.`)) return true
      }
    }
    return false
  }

  /**
   * The phantom set's identity: a def's byte range. web-tree-sitter wrappers
   * are per-access, so `Set<Node>` membership never holds across two reads of
   * the same node — the range is the only stable handle (php/ruby/erl lines
   * carry the same constraint, and the analyzer's parent gates compare ranges
   * for the same reason).
   */
  private phantomKey(n: Node): string {
    return `${n.startIndex}:${n.endIndex}`
  }

  /**
   * Is `n` a shadowed definition whose body must not be walked? #748.
   *
   * PERF. This runs on EVERY node, in each of the three walks that scan a python file, and
   * `phantomKey` builds a `${startIndex}:${endIndex}` string from two WASM property accesses
   * before hashing it into a Set — so on a file with no phantoms at all it was paying string
   * allocation and a hash lookup per node, per walk, to answer a question whose answer is
   * always `false`.
   *
   * Measured over 600 python files, **96.7% have no phantom definitions at all**: a phantom
   * needs a same-named redefinition in one file, and that is rare. `Set.has` on an empty Set is
   * `false` for every key, so guarding on `phantoms.size` is exactly equivalent — not an
   * approximation, and not a behavioural change on any file. The 3.3% that do have phantoms
   * take the original path unchanged.
   */
  private isPhantom(n: Node, phantoms: Set<string>): boolean {
    return phantoms.size > 0 && phantoms.has(this.phantomKey(n))
  }

  private extractFunction(node: Node, ctx: PythonContext) {
    const nameNode = this.findChildByType(node, "identifier")
    if (!nameNode?.text) return
    const funcName = nameNode.text

    const docstring = this.extractDocstring(node)
    const parameters = this.extractParameters(node)
    const returnType = this.extractReturnType(node)
    const decorators = this.extractDecorators(node, ctx, funcName)
    const isAsync = this.isAsyncFunction(node)

    let hasTypeHints = returnType !== undefined
    if (!hasTypeHints) {
      for (const p of parameters) {
        if (p.type !== undefined) { hasTypeHints = true; break }
      }
    }

    ctx.symbols.push({
      name: funcName,
      kind: ASTEngine.SymbolKind.Function,
      range: this.nodeToRange(node),
      visibility: this.pythonVisibility(funcName),
      isAsync,
      docstring,
      comments: docstring ? [docstring] : [],
      parameters,
      returnType,
      decorators,
      complexity: this.methodComplexity(node),
      metadata: {
        pythonSpecific: true,
        hasDocstring: !!docstring,
        hasTypeHints,
        isAsync,
      },
    })
    ctx.functionSymbolIndex[`${ctx.currentClass || ""}::${funcName}`] = ctx.symbols.length - 1
  }

  private extractMethod(node: Node, className: string, ctx: PythonContext) {
    const nameNode = this.findChildByType(node, "identifier")
    if (!nameNode?.text) return
    const methodName = nameNode.text

    const docstring = this.extractDocstring(node)
    const parameters = this.extractParameters(node)
    const returnType = this.extractReturnType(node)
    const decorators = this.extractDecorators(node, ctx, methodName)
    const isAsync = this.isAsyncFunction(node)

    if (methodName.startsWith("__") && methodName.endsWith("__")) {
      ctx.patterns["Dunder (Magic) Methods"] = true
      if (methodName === "__enter__" || methodName === "__exit__") ctx.patterns["Context Manager"] = true
      if (methodName === "__iter__" || methodName === "__next__") ctx.patterns["Iterator Pattern"] = true
    }

    let hasTypeHints = returnType !== undefined
    if (!hasTypeHints) {
      for (const p of parameters) {
        if (p.type !== undefined) { hasTypeHints = true; break }
      }
    }

    let isStatic = false
    let isClassMethod = false
    let isAbstract = false
    for (const d of decorators) {
      if (d === "staticmethod") isStatic = true
      if (d === "classmethod") isClassMethod = true
      if (d === "abstractmethod") isAbstract = true
    }

    ctx.symbols.push({
      name: methodName,
      kind: ASTEngine.SymbolKind.Method,
      range: this.nodeToRange(node),
      ownerName: className,
      ownerKind: ASTEngine.SymbolKind.Class,
      // Which `class className` DECLARATION owns this method. `ownerName` alone cannot say:
      // two classes may share a name in one file, and an override lookup keyed on the name
      // gives a class the bases of an unrelated namesake — see `basesByClassKey`.
      ownerClassKey: ctx.currentClassKey,
      visibility: this.pythonVisibility(methodName),
      isAsync,
      isStatic,
      isAbstract,
      docstring,
      comments: docstring ? [docstring] : [],
      parameters,
      returnType,
      decorators,
      complexity: this.methodComplexity(node),
      metadata: {
        pythonSpecific: true,
        hasTypeHints,
        isClassMethod,
        isAbstract,
        isAsync,
      },
    })
    ctx.functionSymbolIndex[`${className}::${methodName}`] = ctx.symbols.length - 1
  }

  /**
   * Record a framework from an import's ROOT module. A relative import (`from . import x`)
   * names no package, so it is skipped rather than matched against the root `.`.
   *
   * The accumulator is a Record, so it dedupes by construction — the multiplicity defect
   * the ruby lane had cannot arise here, which is why python's fix is a LIVE surface and
   * not a dedupe.
   */
  private noteFramework(ctx: PythonContext, moduleName: string): void {
    if (!moduleName || moduleName.startsWith(".")) return
    const marker = PY_FRAMEWORK_MARKERS[moduleName.split(".")[0]]
    if (marker) ctx.frameworks[marker.framework] = true
  }

  private extractImport(node: Node, ctx: PythonContext) {
    if (node.type === "import_statement") {
      // `import os, sys` / `import numpy as np` — namespace imports.
      for (let i = 0; i < node.namedChildCount; i++) {
        const name = node.namedChild(i)
        if (!name || !(name.type === "dotted_name" || name.type === "aliased_import")) continue
        let moduleName = name.text
        let alias: string | undefined
        if (name.type === "aliased_import") {
          const modNode = name.childForFieldName("name") || name.namedChild(0)
          const aliasNode = name.childForFieldName("alias") || name.namedChild(1)
          if (modNode) moduleName = modNode.text
          if (aliasNode) alias = aliasNode.text
        }
        ctx.imports.push({
          module: moduleName,
          alias,
          items: ["*"],
          isDefaultImport: false,
          isNamespaceImport: true,
          isNamespace: true,
          range: this.nodeToRange(node),
          metadata: { pythonSpecific: true, isAliased: name.type === "aliased_import" },
        })
        this.noteFramework(ctx, moduleName)
        this.pushRel(ctx, ctx.moduleName, `${moduleName}:*`, ASTEngine.RelationshipType.Imports, 1.0, {
          pythonSpecific: true,
          // PY-D13 (round 7): the BOUND local name. `import typing as t` binds `t`, and `t`
          // is the only word in the file that spells this module in front of a member
          // (`t.Protocol`, `t.Callable`), while the edge's target is the `module:*` pair the
          // store keys on — so without this key the alias rides no relation at all and every
          // `t.X` endpoint reads as a name bound by nothing. Published only when the binding
          // DIFFERS from the imported name: `import typing` binds `typing`, and a key that
          // repeats the module is noise a consumer would have to filter. See `PY-D13` in the
          // lane spec for the half of this that is NOT fixed here (the worker projection
          // drops `alias`, so the STORE still cannot see it).
          ...(alias ? { importedAs: alias } : {}),
        }, this.nodeLine(name))
      }
    } else if (node.type === "import_from_statement") {
      // `from .models import User, Role, format_name as fmt`
      // module = relative_import or dotted_name (first named child before import)
      let moduleName = ""
      let seenImport = false
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (!c) continue
        if (c.type === "import" || c.text === "import") { seenImport = true; continue }
        if (c.type === "relative_import" || c.type === "dotted_name") {
          if (!seenImport && !moduleName) moduleName = c.text
        }
      }

      const items: string[] = []
      // M59.A7 (#825): each item carries its OWN node, because the item's line
      // is where the name is written (`from typing import (` / newline /
      // `Optional,` — the statement starts on the `from` line, the item on its
      // own). The relationship is emitted per item, so the node must survive
      // the string collection.
      const itemNodes: Array<{ name: string; node: Node | null; bound?: string }> = []
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (!c) continue
        if (c.type === "dotted_name" || c.type === "identifier") {
          if (c.text !== moduleName) { items.push(c.text); itemNodes.push({ name: c.text, node: c }) }
        } else if (c.type === "aliased_import") {
          // PY-D13 (round 7) — `from x import Z as W` binds `W`, and this branch recorded only
          // the IMPORTED name `Z`: the alias node was read for nothing, so the name the file
          // actually calls and annotates with (`W`, and `t` in `import typing as t`) appeared
          // on no edge this lane published. The alias is a fact the parse already carries, so
          // it is captured here and published per item below — one import statement can alias
          // some items and not others, which is why the binding rides the ITEM and not the row.
          const itemNameNode = c.childForFieldName("name") || c.namedChild(0)
          const aliasNode = c.childForFieldName("alias") || c.namedChild(1)
          const bound = aliasNode?.text
          if (itemNameNode) {
            items.push(itemNameNode.text)
            itemNodes.push({ name: itemNameNode.text, node: itemNameNode, ...(bound ? { bound } : {}) })
          }
        } else if (c.type === "wildcard_import") {
          items.push("*"); itemNodes.push({ name: "*", node: c })
        }
      }

      // M60.R7 paydown (python lane, 2026-09-22): this published
      // `module: moduleName || "<unknown>"` — a placeholder literal standing in for
      // a module name, which is R7's class (a name-bearing field holding something
      // that is not a name: the pipeline can match, count and display a module
      // called `<unknown>` that no file declares). MEASURED UNREACHABLE before
      // changing it, because an unreachable fallback and a live one are different
      // findings and only the probe can tell them apart
      // (script/m14/tmp/py-module-unknown-probe.ts, 19 shapes): EVERY parse that
      // yields an `import_from_statement` hands this handler a named child for the
      // module — the module itself on well-formed input (`from a.b import c`), the
      // imported ITEM on damaged input (`from import c` -> `c`, the item taken as
      // the module) — and the shapes that would leave `moduleName` empty (`from`,
      // `from . import`, `from (`) produce NO import_from_statement node at all, so
      // the handler never runs. Same class as the php lane's two unreachable
      // markers, and the same treatment: the honest form is ABSENCE.
      //
      // The row is still published when there is no module (the imported NAMES are
      // real names in the source, and dropping the row would lose an observation
      // the file does make), but `module` is then omitted rather than invented, and
      // no relationship is emitted — an import edge's target is `module:item`, so
      // with no module it would name nothing.
      const importRow: ASTEngine.ImportInfo = {
        items,
        isDefaultImport: false,
        isNamespaceImport: false,
        isNamespace: true,
        range: this.nodeToRange(node),
      }
      if (moduleName.length > 0) importRow.module = moduleName
      ctx.imports.push(importRow)
      this.noteFramework(ctx, moduleName)
      if (moduleName.length > 0) {
        for (const item of itemNodes) {
        // THE BARE ITEM NAME, FOR A LOCAL MODULE ONLY. THREE lanes emit `<module>:<item>` — this one,
        // javascript and python — and a
        // colon makes the target path-like to the gate's `pathLikeTarget` AND is refused by
        // `_i13_pick`'s own predicate (`instr(target_external,':') = 0`, parallel-indexer.ts:4484)
        // — two independent refusals, measured: `imports` resolved 0 with 0 ambiguous in every lane.
        // The edge's target is the SYMBOL it refers to; the module is already in `metadata.module`.
        //
        // NOT JAVA, and the count was corrected here after being written wrong: `real-java-analyzer.ts`
        // emits `target: moduleName` with no colon at all (`:600`, `:658`), and `grails-core` measures
        // 0 colon edges across 1,942 java files — java's `imports` zero has a different cause and must
        // not be priced with this change.
        //
        // LOCAL ONLY, and the restriction is the difference between a fix and a defect: measured on
        // the recorded ceiling, 432 (ts) + 276 (js) + 5 (py) EXTERNAL items would resolve to a
        // project-local symbol that merely SHARES THE NAME — a false binding, not a fix. A relative
        // (`./`, `../`) or absolute specifier is local by the grammar of the source itself; anything
        // else keeps its current spelling untouched, which is what makes the external half provably
        // unmoved.
          const pyBareLocalItem = item.name !== "" && item.name !== "*" && (moduleName.startsWith(".") || moduleName.startsWith("/"))
          this.pushRel(ctx, ctx.moduleName, pyBareLocalItem ? item.name : `${moduleName}:${item.name === "*" ? "*" : item.name}`, ASTEngine.RelationshipType.Imports, 1.0, {
            pythonSpecific: true,
            // THE MODULE, NOW THAT IT IS NO LONGER GLUED INTO THE TARGET: for a local module the
            // target is the bare item, and without this the module half would be LOST, not moved.
            module: moduleName,
            // the item's BOUND name, when the source wrote one (`… as W`). Absent for a plain
            // item, because there the bound name IS the imported name the target already spells.
            ...(item.bound ? { importedAs: item.bound } : {}),
            // PY-D19 (round 10) — A WILDCARD IMPORT IS A DIFFERENT BINDING RULE, AND THE TARGET
            // SPELLING CANNOT SAY SO. `from M import *` and `import M` both publish `M:*` (the
            // target is the same import-graph endpoint), and the store's per-item projection
            // (`pool-worker`: `{name, path, type, isExternal, line}`) flattens BOTH to
            // `name: "*", type: "namespace"` — so the one fact that decides whether a bare name
            // in this file can come from M's namespace is dropped one layer below the analyzer.
            // The fact is stated HERE, on the edge the analyzer itself returned, where the
            // resolution verdict reads it: `from M import *` binds M's public namespace into
            // THIS module, `import M` binds only `M`.
            ...(item.name === "*" ? { starImport: true } : {}),
          }, this.nodeLine(item.node))
        }
      }
    }
  }

  /**
   * Is this node inside a BINDING SCOPE that is not the class body — a `lambda` or a
   * comprehension?
   *
   * Both open an implicit function, so a name bound inside one is a local of that function
   * and not a member of whatever class encloses it. The parent chain is the direct way to
   * ask, and it needs no state: a counter threaded through the walk would have to be
   * balanced on entry and exit for every such node, and one missed decrement would leave the
   * guard open for the rest of the file rather than for one node.
   *
   * The comprehension half is not a guess about Python's rules. A named expression in a
   * comprehension binds in the ENCLOSING scope, which in a class body would mean binding
   * into the class — and Python refuses that outright:
   *
   *     class C:
   *         from_comp = [(r := i * 2) for i in range(3)]
   *     SyntaxError: assignment expression within a comprehension cannot be used in a class body
   *
   * So for this shape there is no correct member to publish: the class body does not compile.
   * tree-sitter is error-tolerant and parses it anyway, and the lane was publishing
   * `contains C -> r` for a class that cannot exist. Inside a FUNCTION the same construct is
   * legal and binds in the function, so it is a local there too — which is why the guard
   * covers both rather than special-casing the class body.
   */
  private insideNonClassScope(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      const t = cur.type
      if (t === "lambda" || t === "list_comprehension" || t === "set_comprehension" ||
          t === "dictionary_comprehension" || t === "generator_expression") return true
      cur = cur.parent
    }
    return false
  }

  /**
   * Is this node inside a `lambda` body that no FUNCTION encloses before it?
   *
   * PY-31. `lambda` opens a function scope in python and this analyzer publishes no SYMBOL
   * for one, so an edge sourced from inside it names a scope the graph does not have. That
   * was already this lane's rule for `uses` (a member read inside a lambda was declined, and
   * `python/lambda-body-has-no-call-source` pins that as a forbid so the calls fix cannot
   * quietly widen it). `calls` did not apply it, so a call inside a lambda written directly
   * in a CLASS BODY or at MODULE scope was attributed to that class or to that module:
   * `ShareableList -> decode` is a false statement about a class — a class body does not
   * call anything, and `ShareableList.decode` is not a name a reader of the graph can go
   * and look at. MEASURED over 678 real python files: 113 call nodes and 98 attribute nodes
   * sit inside a lambda body across 43 files, every one attributed to a class or a module.
   *
   * The stop at `function_definition` is what keeps the rule narrow, and it is the half that
   * matters: a lambda INSIDE a def is that def's business — the calls contract has always
   * attributed a nested body's calls to the enclosing function — so `key=lambda k:
   * k.strip()` inside `sorted(...)` in a method still publishes `f -> strip`. Callers pair
   * this with `ctx.currentFunction === undefined` for the same reason and by the same rule:
   * a lambda whose nearest enclosing named scope is a def is not the defect, whichever way
   * the walk discovers it.
   */
  private insideLambdaWithoutEnclosingFunction(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      const t = cur.type
      if (t === "function_definition") return false
      if (t === "lambda") return true
      cur = cur.parent
    }
    return false
  }

  private extractAssignment(node: Node, ctx: PythonContext) {
    const left = node.namedChild(0)
    if (!left) return

    // INCOMING_PY: A TARGET WITH NO NAME IS NOT A SYMBOL.
    //
    // tree-sitter is error-tolerant and hands an `assignment` a named child even when
    // the text before `=` is not an identifier at all. `Int DEFINITIONS ::= BEGIN` —
    // ASN.1 notation, which the `otp` corpus carries under a `.py` extension in 29
    // files — parses as an assignment whose LHS is a zero-width, EMPTY identifier, and
    // both the module-Variable path and the class-Property path published it:
    //
    //     { name: "", kind: "variable", startLine: 27, startIndex: 731, endIndex: 731 }
    //
    // A symbol whose name is the empty string is not a weak symbol, it is a node that
    // joins to nothing and can be counted, displayed and matched by every consumer
    // downstream — and the workstream's completion condition names empty names as a
    // failure alongside unknown symbols. Measured over the 679-file INCOMING_PY
    // corpus, `extractAssignment` published 2 of them, both in
    // `otp/lib/asn1/examples/Int.py`; a guard on the name removes exactly those two
    // and changes nothing else, because the tree carries no other name for them.
    //
    // The honest state is ABSENCE (R7's rule), not `""`.
    if (left.text.length === 0) return

    // Instance attribute write: `self.host = ...` inside a method. The LHS is
    // an `attribute` node (object + attr), NOT an identifier — the pre-M14
    // code required `left.type === "identifier"` and therefore never reached
    // this branch (dead code; the Property contract never fired). PYD1.
    if (left.type === "attribute" && ctx.currentClass && ctx.currentFunction) {
      const obj = left.namedChild(0)
      if (obj && (obj.text === "self" || obj.text === "cls")) {
        // PYD1 family contract: instance attribute WRITE → Property symbol
        // only (the family excludes assignment-LHS writes from uses —
        // ruby/php/objc/swift all gate them out; reads are handled by
        // extractMemberUses). One Property per (class, attribute).
        const attr = left.namedChild(left.namedChildCount - 1)
        if (attr && attr.text) {
          const key = `${ctx.currentClass}\u001f${attr.text}`
          if (!ctx.instanceAttrs.has(key)) {
            ctx.instanceAttrs.add(key)
            ctx.symbols.push({
              name: attr.text,
              kind: ASTEngine.SymbolKind.Property,
              range: this.nodeToRange(attr),
              ownerName: ctx.currentClass,
              ownerKind: ASTEngine.SymbolKind.Class,
              visibility: this.pythonVisibility(attr.text),
              metadata: { pythonSpecific: true, isInstanceAttribute: true },
            })
          }
        }
      }
      return
    }

    // PY-D21 (round 11) — A TARGET IS A TARGET, WHATEVER SHAPE IT IS WRITTEN IN.
    //
    // `left.type !== "identifier"` was the gate, and it refused EVERY multi-target assignment:
    // `a, b = f()`, `[a, b] = f()`, `(a, b) = f()`, `a, *rest = f()` all bind names in the scope
    // they are written in, and all published NOTHING. The measured cost is not a hypothetical: the
    // file this was found in, `pb-grpc/examples/python/auth/async_customized_auth_client.py`, binds
    // `helloworld_pb2, helloworld_pb2_grpc = grpc.protos_and_services("helloworld.proto")` at module
    // scope, and every annotation in the repo's gRPC examples that names `helloworld_pb2` was an
    // UNEXPLAINED reference while the binding sat in the file two lines above it
    // (`.tmp-py/price-tuple-targets.py`: 12 residual rows, all `references`).
    //
    // The names are read with the shared pattern walker, so this reader and the local collector
    // cannot disagree about what a target is — the defect that survived nine rounds in
    // `collectFunctionLocals`'s `with_item` case.
    const name = left.text
    const targetNodes = left.type === "identifier" ? [left] : this.patternTargetNodes(left)
    if (targetNodes.length === 0) return

    // __all__ → the explicit export contract, and ONLY at module scope.
    //
    // A CLASS body can contain `__all__` — cython's `Shadow.py` does exactly that, inside
    // `CythonDotParallel` at L786 — and the assignment there is a plain class attribute, not an
    // export contract. `from shadow import *` reads the MODULE's `__all__` and never looks at a
    // class's, so publishing `exports Shadow -> parallel/prange/threadid` claims a public
    // surface that does not exist. Those edges were in the graph and NEITHER the differential
    // NOR a fixture caught them: my own oracle derived them from the same unstated assumption,
    // so two derivations agreed on the same wrong fact. An agreement between two things I wrote
    // is not evidence, and that is the whole argument for pinning a fixture on the SEMANTICS
    // (`import *` ignores class `__all__`) rather than on the code path.
    //
    // The second half is a MISSING edge, not a false one: `__all__` in a class body really is
    // in that class's `__dict__`, so it is a member like any other and now falls through to the
    // class-member path below instead of being swallowed by this branch.
    if (name === "__all__" && !ctx.currentClass && !ctx.currentFunction) {
      // PY-14. Only a `list` was read, so `__all__ = ("a", "b")` published nothing —
      // and the tuple spelling is ordinary older python. Measured over 400 pinned corpus
      // files: 16 `__all__` assignments, 13 lists, **3 tuples that produced no edge at
      // all**, so 19% of the module's declared public surface was invisible for a reason
      // that has nothing to do with the author. A list and a tuple are the same
      // declaration to every tool that reads `__all__`, including `from mod import *`.
      const right = node.childForFieldName("right") ?? node.namedChild(node.namedChildCount - 1)
      // INCOMING_PY: `expression_list` is the THIRD spelling, and it was the one still
      // missing. PY-14 added `tuple`; the grammar has a separate node for a bare
      // comma-separated RHS with no brackets at all:
      //
      //     __all__ = "a", "b"          -> (expression_list (string) (string))
      //
      // which is a legal module-level export declaration — `from mod import *` honours
      // it identically to the bracketed spellings — and published NOTHING, because the
      // allowlist read `list` or `tuple` and `expression_list` is neither. Measured on
      // CPython 3.10's own stdlib: `__all__` is assigned in 238 files and **9 of them
      // use this spelling** (`asyncio/coroutines.py` line 1 is
      // `__all__ = 'coroutine', 'iscoroutinefunction', 'iscoroutine'`), so 3.8% of the
      // standard library's declared public surfaces were invisible for a reason that
      // has nothing to do with the author. On the pinned fixtures corpus the count is
      // **0** — no `__all__` there uses this shape — and that is reported as 0 rather
      // than folded into the stdlib number, because a measurement from outside the
      // pinned corpus is a different measurement.
      //
      // `__all__ = (a + b + [...])` — a concatenation — stays a declared boundary, as
      // does a comprehension: neither has a statically knowable member list.
      const dunderAllContainer = right
        ? (right.type === "list" || right.type === "tuple" || right.type === "expression_list") ? right : undefined
        : undefined
      if (dunderAllContainer) {
        const form = dunderAllContainer.type
        for (let i = 0; i < dunderAllContainer.namedChildCount; i++) {
          const child = dunderAllContainer.namedChild(i)
          if (child && child.type === "string") {
            const exportName = this.unquote(child)
            if (exportName) {
              // `form` records WHICH `__all__` spelling declared this name, alongside the
              // same fact on the relationship edge. `list`, `tuple` and a bare
              // `expression_list` are one declaration to `from mod import *`, so this is
              // provenance rather than meaning — and it is what lets PY-14's revert be
              // expressed as a shape instead of as a list of fixture strings.
              ctx.exports.push({ name: exportName, type: "list_item", form })
              this.pushRel(ctx, ctx.moduleName, exportName, ASTEngine.RelationshipType.Exports, 1.0, {
                pythonSpecific: true,
                // WHICH SPELLING declared the export. All three are the same declaration
                // to `from mod import *`, so the edge is the same either way — but a
                // reader triaging a surface wants to know that a module declares it
                // twice in two forms, and it gives the mutant harness a way to express
                // PY-14's revert generically instead of by naming fixture strings.
                dunderAllForm: form,
              }, this.nodeLine(child))
            }
          }
        }
      }
      return
    }

    // Inside a function body: locals are NOT symbols (universal
    // scripting-family contract).
    if (ctx.currentFunction) return

    // Inside a class body (not a method): class variable → Property. Enum
    // bodies are skipped — their constant assignments are already emitted as
    // EnumMember symbols by extractClass.
    if (ctx.currentClass) {
      const classSymbol = ctx.symbols[ctx.functionSymbolIndex[`::${ctx.currentClass}`]]
      if (classSymbol?.kind === ASTEngine.SymbolKind.Enum) return
      // A LAMBDA IS A FUNCTION SCOPE, and an assignment inside one is a LOCAL of it.
      //
      // This is the second genuine analyzer defect the independent oracle found, and it is
      // the worse of the two: it FABRICATES a member rather than missing one. In
      // `cython/tests/run/extra_walrus.py`, a class body contains
      // `x1 = (lambda y_global: (y_global := y_global + 1) + y_global)(2) + y_global`, and
      // the walrus target `y_global` — a LAMBDA PARAMETER — was published as a member of
      // the class. `C.y_global` does not resolve in Python; the name belongs to the lambda.
      //
      // The oracle found it, and the ground truth is not a matter of opinion: CPython was
      // asked, and for a class body holding a direct walrus, a lambda call, a walrus inside a
      // lambda, and a method with its own walrus, `vars(C)` returns exactly three names and
      // `q` — the lambda parameter — is not among them. Everything else this branch emits
      // for that file is correct: a walrus directly in a class body genuinely does create a
      // class attribute, so the rule cannot simply be "no walrus in a class body".
      //
      // Which is why the guard is a SCOPE test and not a syntax test. Walking the parent
      // chain is the direct way to ask "is there a function boundary between this node and
      // the class body", and it needs no state threaded through the walk — the alternative,
      // a lambda counter, would have to be incremented on entry and decremented on exit for
      // every lambda in the file, and a single missed decrement would silently re-open this
      // defect for the rest of the walk.
      if (this.insideNonClassScope(node)) return
      for (const t of targetNodes) {
        ctx.symbols.push({
          name: t.text,
          kind: ASTEngine.SymbolKind.Property,
          range: this.nodeToRange(t),
          ownerName: ctx.currentClass,
          ownerKind: ASTEngine.SymbolKind.Class,
          // PYD3: underscore-prefix visibility is a PYTHON semantic, not a
          // class-body-only one — `_cache` at class scope is exactly as
          // protected as `_cache` at module scope (both now pythonVisibility()).
          // The old hard-coded "public" made class variables the ONE symbol
          // kind where the convention silently didn't apply.
          visibility: this.pythonVisibility(t.text),
          metadata: { pythonSpecific: true, isClassVariable: true, ...this.multiTargetForm(left) },
        })
      }
      return
    }

    // Module-level assignment → Variable.
    for (const t of targetNodes) {
      ctx.symbols.push({
        name: t.text,
        kind: ASTEngine.SymbolKind.Variable,
        range: this.nodeToRange(t),
        visibility: this.pythonVisibility(t.text),
        metadata: { pythonSpecific: true, isModuleVariable: true, ...this.multiTargetForm(left) },
      })
    }
  }

  /**
   * PROVENANCE for a symbol published from a MULTI-TARGET assignment: the shape the binding was
   * written in. Empty for the ordinary single-identifier form, so an existing symbol's metadata is
   * byte-identical to what it was — the fact is added, nothing is renamed.
   *
   * It is on the symbol for the reason round 10 put `boundByGlobalWrite` on one: a reader triaging a
   * surface wants to know why a module variable exists when the source line at that position looks
   * like `a, b = ...`, and the mutant harness needs a way to express the revert as a shape rather
   * than as a fixture string.
   */
  private multiTargetForm(left: Node): Record<string, string> {
    return left.type === "identifier" ? {} : { multiTargetForm: left.type }
  }

  private extractTypeAlias(node: Node, ctx: PythonContext) {
    // PEP 695: `type Alias = ...` — left child is the alias name.
    const left = node.namedChild(0)
    if (left) {
      ctx.symbols.push({
        name: left.text,
        kind: ASTEngine.SymbolKind.Type,
        range: this.nodeToRange(node),
        visibility: "public",
        metadata: { pythonSpecific: true, isTypeAlias: true },
      })
    }
  }

  private processCall(node: Node, ctx: PythonContext) {
    const caller = ctx.currentFunction || ctx.currentClass || ctx.moduleName
    // A call with NO enclosing scope belongs to the MODULE, and the module scope is named
    // after the file. The old guard compared that name to the LITERAL string `"module"` to
    // avoid a synthetic placeholder — and `module.py` is one of the most common filenames in
    // the corpus (four here, all ansible test modules), so every module-level call in such a
    // file was silently dropped. The `if __name__ == "__main__": main()` guard at the end of an
    // ansible module is the clearest case: `main()` is a real call made by the module and the
    // graph had no edge for it at all.
    //
    // The right test is "is there an enclosing scope", not "is the scope called module" — the
    // second is a question about a NAME and the module's own name is not ours to reserve. The
    // independent oracle found it: it derives `calls module -> main` and the analyzer had
    // nothing, which is a MISSING relationship and the only direction of this report that means
    // something is absent from the graph rather than over-claimed in it.
    if (!caller) return

    // PY-D17 (round 9) — NO CALL IS DERIVED FROM A REGION THE PARSER FLAGGED.
    //
    // Same rule as the type-clause guard, on the other emitter. An ASN.1 document carrying a `.py`
    // extension (`otp/lib/asn1/test/asn1_SUITE_data/*.py`, 22 files in the population) parses as a
    // tree with hundreds of errors, and the analyzer was reading ASN.1 grammar as python calls —
    // `calls BitStr -> STRING`, `-> SIZE`, `-> sunday` — every one of them a name that appears in
    // the file but at no call position in any language. Two shapes are refused: a call whose own
    // subtree contains an error (the parser failed inside the callee or its arguments), and a call
    // that sits INSIDE an error node (the parser swallowed the statement whole). Both are the
    // parser's verdict, not a guess about the source.
    if ((node as any).hasError === true) return
    for (let anc = node.parent; anc; anc = anc.parent) {
      if (anc.type === "ERROR" || (anc as any).isMissing === true) return
    }

    // Decorator calls (@dataclass(...)) are metadata on the decorated
    // symbol, not runtime call edges.
    let p = node.parent
    while (p) {
      if (p.type === "decorator") return
      if (p.type === "function_definition" || p.type === "class_definition" || p.type === "module") break
      p = p.parent
    }

    // PY-31 — a lambda is a function scope and this analyzer publishes no symbol for one, so
    // a call in its body has no source to attach to. Refused only when NO def encloses it:
    // the source would be a class body or the module, and neither calls anything. See
    // `insideLambdaWithoutEnclosingFunction` for the measurement and for the half of the
    // rule that is deliberate (a lambda inside a def keeps that def as its source).
    if (!ctx.currentFunction && this.insideLambdaWithoutEnclosingFunction(node)) return

    const funcChild = node.namedChild(0)
    if (!funcChild) return

    const fullCallee = funcChild.text
    // EVERY name this callee can have. A conditional expression picks its callee at runtime,
    // so `(A if cond else B)(x)` has TWO real targets, and publishing either one alone drops a
    // relationship the code can produce. See `callLeafNames`.
    const callees = this.callLeafNames(funcChild)
    if (callees.length === 0) return
    for (const callee of callees) {
      this.processOneCall(ctx, caller, fullCallee, callee.name, callee.node)
    }
  }

  /**
   * Emit the one relationship a single callee NAME implies.
   *
   * Split out of `processCall` because a callee can have SEVERAL names and each is a separate
   * edge that goes through the same builtin/dunder filters, the same in-file-class test and the
   * same line rule. Keeping the policy in one place and looping over the names is what stops the
   * second branch from being governed by slightly different rules than the first.
   */
  private processOneCall(
    ctx: PythonContext,
    caller: string,
    fullCallee: string,
    targetName: string,
    calleeLeaf: Node,
  ): void {
    // M59.A7 (#825): the edge NAMES the callee leaf (callLeafName's node twin),
    // so the line is the leaf's own — never the receiver the construct starts
    // at (`items` on 17 while `.upper` is written on 19).
    if (PYTHON_BUILTINS.has(targetName)) return
    if (targetName.startsWith("__") && targetName.endsWith("__")) return // dunder: not a user call

    // Uppercase head → instantiation (Python has no `new` keyword), but only
    // when the target is a class declared in-file (imported classes like
    // TypeVar are external — no in-file target to instantiate).
    const firstChar = targetName[0]
    const isUppercase = firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()
    // PY-11. An uppercase callee became `instantiates` when the class is declared in
    // this file and was DROPPED ENTIRELY otherwise. Both halves of that were wrong.
    //
    // Dropping was the serious half. Measured over 300 pinned corpus files: 1,152
    // uppercase callees in the source, 263 became `instantiates`, and **889 — 77.2% —
    // produced no relationship at all.** 368 of those name a class the file EXPLICITLY
    // IMPORTS, so the most characteristic edge in an Ansible module was missing from the
    // graph: `module = AnsibleModule(...)`, file after file, with nothing to show for
    // it. A call is a call whether or not this analyzer can see the callee's class, and
    // dropping it loses the fact rather than qualifying it.
    //
    // The instinct behind the drop was right and is kept: do not claim an INSTANTIATION
    // of a class you have not read. `TypeVar(...)` and `Exception(...)` are not
    // constructions of project classes and calling them one would be a fabrication. So
    // the claim is narrowed, not the edge dropped:
    //
    //   uppercase callee that IS an in-file class/enum -> `instantiates` (a claim)
    //   every other callee, uppercase or not            -> `calls`      (a fact)
    //
    // The second branch needs no new policy: it is the branch every lowercase callee
    // already took, and a bare `Name(...)` is a call syntactically whatever its
    // capitalisation says about intent.
    if (isUppercase && ctx.declaredTypes.has(targetName)) {
      // O(1): declaredTypes holds exactly the in-file class/enum names.
      this.pushRel(ctx, caller, targetName, ASTEngine.RelationshipType.Instantiates, 0.9, {
        pythonSpecific: true,
        qualified: fullCallee,
        // M14 §4: a sub-1.0 confidence must carry a machine-readable reason code, and
        // for python the reason is worth naming because it is the whole narrowing —
        // the class is one THIS parse declared, so the callee is its constructor and not
        // merely something that happens to be spelled with a capital.
        reasonCode: "in-file-class-constructor",
      }, this.nodeLine(calleeLeaf))
      return
    }

    // INCOMING_PY — WHY THE TARGET IS NOT DISPATCHABLE, in machine-readable form.
    //
    // This is the lane's whole subject. Python resolves a callee at RUNTIME through the
    // receiver's type and the MRO, so `self.m()` names a method whose defining class is
    // a fact about the caller of `m`, not about this file. The lane was already emitting
    // the honest NAME (PY-11: dropping it loses the fact), but it emitted the name with
    // nothing saying WHICH of the three situations produced it, and a consumer reading
    // `calls f -> g` cannot tell a call it can trust from a call it cannot.
    //
    // M14 §4 is the contract that says so: any relationship at confidence < 1.0 must
    // carry a reason code, not just a number. Measured before this line over the
    // 679-file INCOMING_PY corpus: 29,877 `calls` edges at 0.9, **0 of them carrying a
    // reason code**. The partition those codes express, measured on the same corpus:
    //
    //   in-file-callee        the leaf names a symbol this parse declared
    //   dispatch-on-parameter `self.m()` / `cls.m()` — the receiver is the implicit
    //                        first parameter, so the target class is decided by
    //                        whoever constructed the instance. NO static target.
    //   dispatch-on-receiver  `recv.m()` where recv is a local or a parameter — the
    //                        receiver's type is not written down. NO static target.
    //   external-member-call  `os.path.m()` — the receiver is rooted at a module THIS
    //                        file imported, so the member is reachable through the
    //                        import edge even though its definition is not in view.
    //   bare-name-callee      `f(...)` — the name is a value, and may equally be a
    //                        module global, an injected dependency, or `from x import *`.
    //
    // `external-member-call` is separated from `dispatch-on-receiver` because they are
    // opposite facts and merging them makes the code lie in one direction: `os.path.join`
    // HAS a reachable target (the import says so) and calling it unrecoverable would
    // teach a consumer to discard the edges it should follow.
    //
    // The edge is still emitted in every case, because the name IS what the source
    // wrote; what changes is that the uncertainty is now a field rather than an
    // absence, and `bb_graph` can decline to walk an edge it cannot justify.
    const dispatchClass = fullCallee.includes(".")
      ? (fullCallee.startsWith("self.") || fullCallee.startsWith("cls.")
          ? "dispatch-on-parameter"
          : ctx.importRoots.has(fullCallee.split(".")[0]!) ? "external-member-call" : "dispatch-on-receiver")
      : this.isLocalCalleeName(calleeLeaf, fullCallee, ctx.functionLocals)
        ? "local-callee"
        : "bare-name-callee"
    // The relation-level OWNER CHANNEL — published on the SAME narrow shape the reason is
    // (`self.m()` / `cls.m()`, one dot), so the store can resolve the member through the class
    // that declares it. `self.store.save` and `recv.m` carry NO owner: the first's receiver is
    // a VALUE whose type is unknown, the second is not the implicit parameter. See
    // `memberOwnerOf` for why that boundary is load-bearing rather than tidy.
    const dotIdx = fullCallee.indexOf(".")
    const receiverName = dotIdx > 0 && fullCallee.indexOf(".", dotIdx + 1) === -1
      ? fullCallee.slice(0, dotIdx)
      : undefined
    const memberOwner = this.memberOwnerOf(receiverName, ctx.currentClass)
    this.pushRel(ctx, caller, targetName, ASTEngine.RelationshipType.Calls, 0.9, {
      pythonSpecific: true,
      qualified: fullCallee,
      reasonCode: dispatchClass,
      ...(memberOwner ? { owner: memberOwner } : {}),
    }, this.nodeLine(calleeLeaf))
  }

  // ========================================================================
  // OVERRIDES (harness companion contract, mirrors JS analyzer)
  // ========================================================================

  /**
   * PYD1 — member READ uses (managed-OO family contract). `self.host`,
   * `obj.attr`, `self.svc.inner` parse as `attribute`; the leaf name is the
   * last named child. Excluded — each for a documented reason:
   * - assignment LHS (`self.x = v`): a WRITE, not a read (extractAssignment
   *   already emits the isWrite edge there — this walk never sees parents,
   *   so compare byte ranges the php way);
   * - a call's function child (`self.ping()`): that edge is the caller's
   *   `calls self.ping` — a uses edge here would double-count;
   * - the receiver position of a member call (`self.svc.ping()`): `self` and
   *   `svc` are traversal, the read is `ping`'s receiver — emit ONLY the
   *   deepest read leaf (`inner`) so `self.svc.inner` yields one edge.
   * Sources: the enclosing function (method scope), never `global`.
   * Pure AST — parents come from tree-sitter, never source text.
   */
  private extractMemberUses(rootNode: Node, ctx: PythonContext, phantoms: Set<string>): void {
    // PERF. The grandparent is CARRIED, not re-read. These five gates need it, and reading it as
    // `parent.parent` costs one wrapper allocation per attribute node — and this file's own
    // comment records why that is not free: "web-tree-sitter wrappers are per-access, identity
    // never holds". Every `.parent` is a fresh object crossing the WASM boundary. Recursion
    // already has the value in hand, because a node's parent is the `parent` its caller passed.
    const walk = (n: Node, inFn: string | undefined, cls: string | undefined, parent: Node | null, gp: Node | null): void => {
      const t = n.type
      // #748: a shadowed definition's body is never walked — its member reads
      // belong to a body the runtime has already rebound away.
      if (this.isPhantom(n, phantoms)) return
      // PYD5: rebind the owner ONLY when entering a symbol-level def (inFn is
      // still undefined). A def inside a def is NOT a symbol — the calls
      // contract attributes its body to the ENCLOSING function
      // (`if (ctx.currentFunction) break` in the main walk), so its member
      // reads must keep the outer owner too (two walks, one owner; php
      // mirror: inFunction never rebinds for nested bodies).
      let nextFn = inFn
      if (t === "function_definition" && !inFn) {
        const nameNode = this.findChildByType(n, "identifier")
        nextFn = nameNode?.text
      }
      // INCOMING_PY: the enclosing CLASS, carried down for the same reason the enclosing
      // function is — a nested def's `self.` reads still belong to the method's class. A
      // `class_definition` rebinds it; the module scope leaves it undefined, which is what
      // keeps a module-level `def f(self)` from inventing an owner it does not have.
      let nextCls = cls
      if (t === "class_definition") {
        const classNameNode = this.findChildByType(n, "identifier")
        if (classNameNode?.text) nextCls = classNameNode.text
      }
      if (t === "attribute" && inFn && parent) {
        const leaf = n.namedChild(n.namedChildCount - 1)
        // Recursion guard: the deepest attribute's leaf must be a real leaf
        // (identifier), not another nested attribute node.
        if (leaf && leaf.type !== "attribute") {
          // Parent-based gates (byte-range compare — web-tree-sitter wrappers
          // are per-access, identity never holds). PYD6: the old form was a
          // dead ternary — `namedChild(0) === undefined ? false : ...` where
          // the assignment's first named child IS the LHS by grammar, so the
          // condition could never fire true. Plain range compare, php-style.
          const isAssignLhs = parent.type === "assignment" &&
            parent.namedChild(0)?.startIndex === n.startIndex && parent.namedChild(0)?.endIndex === n.endIndex
          const gpIsAssign = gp?.type === "assignment"
          const gpLhs = gpIsAssign ? gp!.namedChild(0) : undefined
          const isGpAssignLhs = gpLhs && gpLhs.startIndex === n.startIndex && gpLhs.endIndex === n.endIndex
          // augmented_assignment: `self.count += 1` — LHS is a write.
          const isAugLhs = parent.type === "augmented_assignment" && parent.namedChild(0)?.startIndex === n.startIndex && parent.namedChild(0)?.endIndex === n.endIndex
          // call function position: `self.ping()` — the attribute IS the call.
          const isCallFn = parent.type === "call" && parent.namedChild(0)?.startIndex === n.startIndex && parent.namedChild(0)?.endIndex === n.endIndex
          // receiver of a member call: `self.svc.ping()` — self.svc is the
          // receiver (traversal), never a read.
          const gpIsCall = gp?.type === "call"
          const gpFn = gpIsCall ? gp!.namedChild(0) : undefined
          const isReceiverOfCall = gpIsCall && !!gpFn && gpFn.type === "attribute" && gpFn.startIndex === n.startIndex && gpFn.endIndex === n.endIndex
          if (!isAssignLhs && !isGpAssignLhs && !isAugLhs && !isCallFn && !isReceiverOfCall) {
            // PY-23 (R7), the same defect as the `contains` fix above and the same
            // construct: `SafeUUID.unknown` in CPython's `uuid.py` is a member read whose
            // LEAF is `unknown`, publishing `uses __init__ -> unknown`. Six such edges
            // across 5,984 corpus files, four of them in `uuid.py`.
            //
            // The qualifier is the receiver when the receiver is a type this file DECLARES,
            // and only then. `SafeUUID.unknown` names a member of a class the analyzer has
            // read, so `SafeUUID.unknown` is the navigable name. `self.unknown` is
            // instance state the analyzer has not seen declared anywhere, and inventing an
            // owner for it would be the fabrication R7 exists to stop — so a reserved leaf
            // under a receiver the analyzer cannot vouch for keeps its bare spelling and is
            // counted by the six-questions instrument instead of being quietly qualified.
            const recv = n.namedChild(0)
            const recvName = recv && recv.type === "identifier" ? recv.text : undefined
            const qualified = recvName && ctx.declaredTypes.has(recvName)
              ? qualifyReservedEndpoint(leaf.text, recvName)
              : leaf.text
            // The relation-level OWNER CHANNEL, published only when the receiver is EXACTLY
            // `self`/`cls` (the identifier form the enclosing class is the value of). The same
            // narrow boundary as `calls`: a receiver the store cannot name (`table.num_rows`,
            // `self.svc.inner`) carries NO owner, so the store leaves the row to the name
            // strategies rather than binding the member to the wrong class. See `memberOwnerOf`.
            const memberOwner = this.memberOwnerOf(recvName, cls)
            // PY-25 / INCOMING_PY — the read's ROUTE, which is the whole subject of a member
            // read in python: `self.stash` and a bare `stash` are the same leaf and two
            // different facts, and the lane was publishing them identically.
            // `qualified` carries the chain the SOURCE wrote — `self.stash`, `os.path`,
            // `pa.Table`, `table.num_rows` — including when the receiver's type is written
            // down nowhere (`table` is a parameter): the field records the spelling and does
            // not claim the type is known. `reasonCode: member-read` names the same reading
            // `calls` names with its dispatch codes, so a consumer filtering by code sees a
            // read it can follow and a read it cannot as two populations rather than one.
            // Pinned by `python/dispatch-reason-codes` (`self.stash`, `os.path`) and
            // `python/qualified-endpoint-spellings` (`pa.Table` through an alias,
            // `table.num_rows` through a parameter, `rows.num_rows` from another function —
            // the leaf collision is why the endpoint needs a route and not just a name).
            this.pushRel(ctx, inFn, qualified, ASTEngine.RelationshipType.Uses, 0.9, {
              pythonSpecific: true, isMemberRead: true,
              qualified: n.text,
              reasonCode: "member-read",
              ...(qualified !== leaf.text ? { qualifiedTarget: true, receiver: recvName } : {}),
              ...(memberOwner ? { owner: memberOwner } : {}),
            }, this.nodeLine(leaf))
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c, nextFn, nextCls, n, parent)
      }
    }
    walk(rootNode, undefined, undefined, null, null)
  }

  /**
   * M14 — declared-type reference graph. Python type hints: annotated
   * assignments (`x: T`), typed parameters, and return annotations all carry
   * a `type` field node. isinstance(x, T) is the runtime type check. Builtin
   * scalar types (str/int/float/bool/bytes) are excluded from names; unions
   * (T | U), optionals, and generics descend via their children.
   */
  private extractDeclaredTypeRefs(rootNode: Node, relationships: ASTEngine.UniversalRelationship[], phantoms: Set<string>, moduleName: string, functionLocals: Map<string, Set<string>>): void {
    const emitted = new Set<string>()
    const PRIMITIVES = new Set(["str", "int", "float", "complex", "bool", "bytes", "object", "None", "Any", "self", "cls"])

    // M59.A7 (#825): nodes, not just names — the edge's line is where the
    // type NAME is written (a wrapped annotation's own line), so the node must
    // survive the collection.
    const collectTypeNodes = (n: Node, out: Node[]): void => {
      // PY-D17 (round 9) — A CLAUSE THE PARSER FLAGGED NAMES NO TYPE.
      //
      // tree-sitter is error-tolerant, and where it fails it still hands back a tree with a
      // plausible SHAPE whose node boundaries do not match the source. Descending that shape
      // publishes names the author never wrote at a type position, and the clearest measured case
      // is a parameter's OWN NAME:
      //
      //     def optional_memoryview(d: double[:], o: Optional[double[:]]): ...
      //     (typed_parameter (identifier "d")
      //        type: (type (generic_type (identifier "double")
      //                     (type_parameter (ERROR)                       <- "[:]"
      //                       (type (constrained_type (type (identifier))  <- "o"  <- THE NEXT PARAM
      //                               (type (generic_type (identifier "Optional") ...))))))))
      //
      // `double[:]` is VALID CPython (an annotation is an arbitrary expression; `double[:]` is a
      // slice) and tree-sitter's python grammar rejects it, so the whole parameter list collapses
      // into ONE `typed_parameter` that swallowed `, o: Optional[...]`. The analyzer read that
      // garbled `constrained_type` and published `references optional_memoryview -> o` — a
      // fabricated edge in which a parameter is claimed to be a type. Reproduced minimally, and it
      // is the same class of defect as PY-D11 (a keyword argument's NAME published as a type) and
      // as the empty-identifier guard above.
      //
      // The rule is uniform and needs no shape enumeration: a type clause that CONTAINS a parser
      // error is not trusted at all. `hasError` is the parser's own verdict on the subtree, so this
      // is a statement about the parse rather than a heuristic about names. The cost is declared:
      // the well-formed-looking `double`/`Optional` inside that same clause are dropped WITH it,
      // because a name read out of a structure the parser got wrong is luck, not reading — and a
      // confidently-wrong edge is worse than an honest NULL.
      if ((n as any).hasError === true) return
      if (n.type === "identifier") {
        // INCOMING_PY: an identifier with NO TEXT names nothing, and an edge endpoint
        // that names nothing is worse than a weak one — it is a row every consumer can
        // count, join and display while pointing at no node. tree-sitter recovers a
        // zero-width identifier wherever the grammar is damaged, and an error-tolerant
        // parse of non-python under a `.py` extension produces those by the hundred:
        // `small SmallInt ::= 17` (ASN.1, `otp/lib/asn1/examples/Int.py`) parses as an
        // assignment AND as a `type` clause holding an empty identifier, which
        // published `references asn2 -> ` — a real relationship row with an empty
        // target. `pushRel`'s `if (!source || !target) return` guard cannot catch it,
        // because this walk builds its rows directly and never goes through it.
        //
        // The honest state is ABSENCE: there is no type name in the source, so there is
        // no reference to publish. Measured over the 679-file INCOMING_PY corpus with
        // the R7 half of `script/m60/python-resolution-census.ts` widened to convict an
        // EMPTY value as well as a placeholder literal.
        if (n.text.length === 0) return
        if (!PRIMITIVES.has(n.text) && !out.some((x) => x.text === n.text)) out.push(n)
        return
      }
      if (n.type === "none" || n.type === "string" || n.type === "concatenated_string") return
      // INCOMING_PY (round 6) — A KEYWORD ARGUMENT'S NAME IS NOT A TYPE.
      //
      // In `read_token: Annotated[str, Field(min_length=1, strict=True, max_length=2048)]` the
      // annotation expression holds a CALL, and this walk used to descend into it and publish
      // `references ... -> min_length`, `-> strict` and `-> max_length` — the keyword NAMES of a
      // validator. Those names are not types and bind to nothing; they were a measured slice of the
      // UNEXPLAINED incoming targets the resolution verdict named (the census's own
      // `unexplainedTargetNames`). The rule that fixes it is the same one `keyword_argument` already
      // teaches everywhere else: the NAME is a parameter label, the VALUE is the expression.
      //
      // The VALUE is still walked, because a real type can live in one — `TypeVar("T", bound=Base)`
      // must keep `Base` — so the fix drops the NAME child and recurses into the value rather than
      // refusing the whole call.
      if (n.type === "keyword_argument") {
        const v = n.childForFieldName("value")
        if (v) collectTypeNodes(v, out)
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) collectTypeNodes(c, out)
      }
    }

    /**
     * INCOMING_PY — the QUALIFIER an annotated type was written with, or nothing.
     *
     * `def f(t: pa.Table)` names the type `Table` and writes the qualifier `pa`. The
     * leaf is the target, which is right; the qualifier is what makes it findable, and
     * it was discarded exactly as `unittest.TestCase` was on `extends` and `pa.Table`
     * was on `uses`. Measured over the 679-file INCOMING_PY corpus before this line,
     * **1,498 `references` edges, 331 (22.1%) resolved in-file, 553 (36.9%) through an
     * import, and 614 (41.0%) to nothing** — the worst in-file ratio of any type the
     * lane emits, and the annotation case is where it is cheapest to fix because the
     * qualifier is a PARENT of the identifier, not a sibling of it.
     *
     * `dotted_name` and `attribute` are the two nodes a qualified type annotation
     * parses as (a parameter annotation gives `attribute`, a `dotted_name` where the
     * grammar emits one), and in both the identifier this collector reaches is the
     * LAST named child — the same leaf convention `callLeafName` and `baseClassLeaf`
     * already use, and for the same reason: `pa.Table` names `Table`. Returns undefined
     * for a bare identifier, which is most annotations and gains nothing by being
     * spelled, and for the RECEIVER identifier of the chain, which is a module alias
     * rather than the type being named.
     */
    const typeQualifier = (n: Node): string | undefined => {
      const p = n.parent
      if (!p || (p.type !== "dotted_name" && p.type !== "attribute")) return undefined
      if (p.namedChildCount === 0) return undefined
      const leaf = p.namedChild(p.namedChildCount - 1)
      if (!leaf || leaf.startIndex !== n.startIndex || leaf.endIndex !== n.endIndex) return undefined
      return p.text
    }

    /**
     * PY-24 — the source is the scope this analyzer's OWN WALK would be in at that node,
     * replayed over the ancestor chain.
     *
     * This used to return the name of the NEAREST enclosing `function_definition`. For a
     * nested def that is a name nothing published: python binds `def inner` inside `def
     * outer` as a LOCAL of `outer`, this analyzer's rule is that a def inside a def is not a
     * symbol, and the main walk therefore attributes a nested body's calls and member reads
     * to the ENCLOSING function. The type-reference walk had its own resolver and did not
     * apply that rule, so the annotation on a nested def's parameter published
     * `references inner -> SomeType` — a source nothing can be traversed from. MEASURED
     * before the fix, through the production path: 18 such edges on python-codesql (2.8% of
     * the type) and 60 on CPython's stdlib (4.8%); the corpus shape is
     * `scripts/regression_test_python.py`, whose `fetch_native`/`fetch_pandas`/`fetch_arrow`
     * are three nested defs inside `test_tpch` all annotating `rel: duckdb.DuckDBPyRelation`.
     * Same defect class as PY-4, which returned the keyword `global` as a scope.
     *
     * The replay is the walk's model, not a new rule: entering a CLASS sets the class and
     * CLEARS the function scope (so a def directly in a class body is a Method of that
     * class, and a def inside a def two levels deep still belongs to the OUTERMOST def on
     * the path); entering a function while one is already open changes nothing.
     * The chain is replayed outermost-first, which is what makes the second rule expressible
     * in one pass. `python/nested-def-reference-source` pins all four shapes — a nested def's
     * parameter, an annotated assignment two defs deep, a module-scope nested def, and a bare
     * module-level annotation — and `python/reference-source-scope-and-reason-codes` pins the
     * two inside a class nested in a function, where the CLASS wins for its own method.
     */
    const resolveSource = (start: Node): string => {
      // Include the start node itself: a function's return annotation
      // resolves to the function, not its enclosing scope.
      const chain: Node[] = []
      let p: Node | null = start
      while (p) { chain.push(p); p = p.parent }
      let fn: string | undefined
      let cls: string | undefined
      for (let i = chain.length - 1; i >= 0; i--) {
        const n = chain[i]
        if (n.type === "class_definition") {
          const nm = this.findChildByType(n, "identifier")?.text
          if (nm) { cls = nm; fn = undefined }
        } else if (n.type === "function_definition") {
          if (fn === undefined) {
            const nm = this.findChildByType(n, "identifier")?.text
            if (nm) fn = nm
          }
        }
      }
      if (fn !== undefined) return fn
      if (cls !== undefined) return cls
      // PY-4. This used to return the LITERAL STRING "global" — a Python KEYWORD used
      // as a scope name — whenever a statement had no enclosing function or class. Three
      // things were wrong with it at once.
      //
      // A name that is not a name: `global` is not a scope, a module, or anything a
      // reader can navigate to. This is the M60 R7 class, the same one markdown hit when
      // an empty ATX heading published a symbol named `#`.
      //
      // Not tolerated by the store: `GENERIC_SOURCE_NAMES` is
      // `["unknown", "SCSS_FILE_SCOPE", "window", "exports", "default", "GlobalScope"]` —
      // the names the indexer knows are synthetic scopes — and `global` is not among
      // them, so Python's synthetic scope took a path no other lane's takes.
      //
      // And INCONSISTENT WITH ITS OWN FILE: `imports` in the same module attributes the
      // import to `ctx.moduleName`, the file's stem. One module, two spellings for one
      // scope, from one analyzer, so neither can be trusted as the module's identity.
      //
      // So it returns the module name — the SAME derivation `imports` already uses, one
      // line away, which is what makes this a consistency fix rather than a new
      // convention. `__init__.py` yields `__init__`, which is a weak module name; that is
      // a property of the file stem, it is the string `imports` has always published, and
      // improving the stem derivation is a separate change with its own blast radius.
      return moduleName
    }

    const emit = (source: string, roots: (Node | null | undefined)[], relType: string): void => {
      for (const r of roots) {
        if (!r) continue
        const nodes: Node[] = []
        collectTypeNodes(r, nodes)
        for (const tn of nodes) {
          const t = tn.text
          const key = `${source}|${t}|${relType}`
          if (emitted.has(key)) continue
          emitted.add(key)
          const qualifier = typeQualifier(tn)
          // PY-D15 / PY-D16 (round 8) — THE POSITION IS NOT ALWAYS THE REASON.
          //
          // `relationshipType` says WHERE the name was written; the code above derived the
          // reason from it and stopped there, so `isinstance(obj, type_or_tuple)` published
          // `references is_safe_attribute -> type_or_tuple` at 0.95 with reasonCode
          // `instanceof-check` — true, and useless: `type_or_tuple` is a WALRUS TARGET of the
          // very condition it appears in, so the runtime type is decided by a dict lookup, and
          // a consumer reading `instanceof-check` has no way to tell it from
          // `isinstance(instance, SomeClass)`. MEASURED over the whole-population verdict before
          // this line: of 389 UNEXPLAINED `references` targets, 232 name a binding of an
          // ENCLOSING FUNCTION (parameters, walrus targets, locals) and 52 name a PEP-695
          // `def f[T]` inline type parameter — 73.0% of the defect axis, one mechanism, and the
          // same fact `calls` already states per edge since PY-D14.
          //
          // The POSITION is not lost: `metadata.relationshipType` still carries it, and it is the
          // field whose whole job that is. The code NARROWS from the position to the binding
          // whenever the binding is the reason the target cannot resolve, which is exactly what
          // M14 §4 asks a reason code to say.
          const bindingReason = this.dynamicTypeBindingReason(tn, t, functionLocals)
          relationships.push({
            source,
            target: t,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.95,
            ...(this.nodeLine(tn) ? { line_number: this.nodeLine(tn)! } : {}),
            // INCOMING_PY / M14 §4: `relationshipType` already said WHICH annotation
            // position the name was written in, and it is exactly the reason the edge is
            // at 0.95 rather than 1.0 — an annotation is a claim by the author about a
            // type, and a claim is not a declaration. Measured over the 679-file corpus
            // before this line: 1,498 `references` edges at 0.95, 0 with a reason code.
            // `reasonCode` mirrors the position so the code is queryable on its own,
            // and the two can never drift because they are set from one variable.
            //
            // `qualified` is the qualifier the annotation was written with (`pa.Table`),
            // when it had one — same field, same meaning and same reason as `extends`'
            // and `uses`'. It goes INSIDE metadata, which is where the other three put
            // it: `calls` has carried `metadata.qualified` since PY-11, and a field
            // that lives at the top level on one type and in metadata on another is two
            // fields with one name, which is a consumer bug waiting to happen.
            metadata: {
              relationshipType: relType,
              reasonCode: bindingReason ?? PY_REFERENCE_REASON[relType] ?? "declared-type",
              ...(qualifier ? { qualified: qualifier } : {}),
            },
          })
        }
      }
    }

    const typeClauseOf = (n: Node): Node | null => {
      // Newer tree-sitter-python wraps annotations in a `type` node; some
      // versions expose it as a field. Handle both shapes.
      const f = n.childForFieldName?.("type")
      if (f) return f
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "type") return c
      }
      return null
    }

    const walk = (n: Node): void => {
      // #748: no type reference is derived from a shadowed definition's body —
      // the oracle's flat walk skips the same subtree, so both sides agree.
      if (this.isPhantom(n, phantoms)) return
      switch (n.type) {
        case "assignment": {
          emit(resolveSource(n), [typeClauseOf(n)], "declared_type")
          break
        }
        case "typed_parameter":
        case "typed_default_parameter": {
          emit(resolveSource(n), [typeClauseOf(n)], "declared_type")
          break
        }
        case "function_definition": {
          emit(resolveSource(n), [typeClauseOf(n)], "return_type")
          break
        }
        case "call": {
          // isinstance(x, T) / issubclass(a, B): second positional argument
          // names a type.
          const fn = n.childForFieldName?.("function")
          if (fn && (fn.text === "isinstance" || fn.text === "issubclass")) {
            const args = n.childForFieldName?.("arguments")
            if (args && args.namedChildCount >= 2) emit(resolveSource(n), [args.namedChild(args.namedChildCount - 1)], "instanceof_check")
          }
          break
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    walk(rootNode)
  }

  private extractOverrideRelationships(ctx: PythonContext, context?: ASTEngine.AnalyzeContext) {
    const byName = new Map<string, ASTEngine.UniversalSymbol[]>()
    for (const s of ctx.symbols) {
      const list = byName.get(s.name) ?? []
      list.push(s)
      byName.set(s.name, list)
    }
    // PY-8. ALL bases, in declaration order — not just the leftmost.
    //
    // Python's rule is "the first base in MRO order that actually DECLARES the name",
    // and keeping only the first base is a different rule. It looks equivalent until a
    // multi-base class inherits a name from a LATER base, which is ordinary Python:
    //
    //     class Requirement(_ComputedReqKindsMixin, RequirementNamedTuple):
    //         def __new__(cls, *args, **kwargs): ...
    //
    // `_ComputedReqKindsMixin` declares `__init__` and no `__new__`;
    // `RequirementNamedTuple` is a NamedTuple and so necessarily has `__new__`. This
    // analyzer emitted `Requirement.__new__ -> _ComputedReqKindsMixin.__new__` at 0.5 —
    // naming a method that class does not have — and never considered the base that
    // does, because it is not leftmost.
    //
    // The distinction that makes the old rule defensible in principle — the leftmost
    // base is the most-derived ancestor — is exactly what makes it wrong here: a more-
    // derived ancestor that does not define the name contributes nothing, and the name
    // is inherited from further left in the MRO than the class itself.
    //
    // So: walk the bases in order, take the first that declares the method, and emit
    // ONE verified edge to it. Guess only when NO base declares it, and then guess the
    // leftmost, because the leftmost is the best candidate for where an unseen method
    // would live.
    const basesByClass = new Map<string, string[]>()
    for (const r of ctx.relationships) {
      if (r.type === ASTEngine.RelationshipType.Extends && r.source && r.target) {
        const list = basesByClass.get(r.source)
        if (list) {
          if (!list.includes(r.target)) list.push(r.target)
        } else {
          basesByClass.set(r.source, [r.target])
        }
      }
    }
    // Every class name declared in this file. A base NOT in here is one this analyzer
    // has never read, which is the distinction the guess below turns on.
    const declaredClasses = new Set<string>()
    for (const s of ctx.symbols) {
      if (s.kind === ASTEngine.SymbolKind.Class && s.name) declaredClasses.add(s.name)
    }
    // PERL-MR15. This read `(ctx as any)._overrideCompanion`, a channel nothing
    // populates: the engine puts the companion on `AnalyzeContext.overrideCompanion`
    // and the pass repopulates it on re-analysis, so the Python rule ran with no
    // companion at all and every cross-file base stayed a guess.
    const overrideCompanion = ctx.overrideCompanion
    const baseDeclares = (base: string, method: string): boolean => {
      // Same kind requirement as the MRO walk above, and for the same reason: a class
      // variable is not a method, so it cannot be overridden.
      const inFile = byName.get(method)?.some(
        (bm) => bm.ownerName === base && bm.kind === ASTEngine.SymbolKind.Method,
      ) ?? false
      if (inFile) return true
      const companion = overrideCompanion?.get(base)
      return !!companion && companion.has(method)
    }
    for (const s of ctx.symbols) {
      if (s.kind === ASTEngine.SymbolKind.Method && s.ownerName) {
        // The bases of THIS class DECLARATION. `basesByClass` is name-keyed and merges every
        // same-named class in the file, which is how a `class C` extending nothing ended up
        // publishing overrides to the bases of an unrelated `class C(Base)` — CPython's own
        // `ast` reports `bases: None` for that class, and the lane claimed it overrode a
        // method it does not inherit. The name-keyed table is kept as the fallback for a
        // method whose owner declaration was not recorded, so the resolution degrades to the
        // old behaviour rather than to nothing.
        const raw =
          (s.ownerClassKey ? ctx.basesByClassKey.get(s.ownerClassKey) : undefined) ??
          basesByClass.get(s.ownerName)
        // A base that spells the class's OWN name is the #299 rebind case — `class
        // ArgumentParser(ArgumentParser)` shadows an IMPORT of the same name — and it must
        // not become an override target either. It was already excluded from the `extends`
        // EDGE (the leaf is still recorded in `baseClasses` metadata, so nothing is lost),
        // and reading overrides from that same metadata without re-applying the exclusion
        // made every such class publish `C.m -> C.m`: a class overriding itself, which is not
        // a thing a class can do. The exclusion belongs to both derivations, not one of them.
        // A base the SOURCE spelled QUALIFIED is a class this file has not read, and it stays
        // one however a local class is named. `class Other(unittest.TestCase)` does not inherit
        // from a local `class TestCase` — both independently inherit `unittest.TestCase` — and
        // binding the override to the local namesake asserts an inheritance that does not
        // exist. The `extends` EDGE still publishes the leaf, because a leaf is the declared
        // spelling of the base; what cannot be right is treating that leaf as proof the file
        // has read the base and knows its methods.
        //
        // This is the fifth defect the independent oracle found, and the smallest repro in the
        // set — six lines, no corpus, no Cython:
        //
        //     import unittest
        //     class TestCase:  def test_init_var(self): ...
        //     class Other(unittest.TestCase):  def test_init_var(self): ...
        //
        // published `overrides Other.test_init_var -> TestCase.test_init_var`. The oracle
        // already refused that binding — `qualifiedBases.has(b)` — which is why it showed up as
        // four unexplained edges concentrated in `test_dataclasses.py`, where a dozen test
        // classes each inherit `unittest.TestCase` beside a local class of that name.
        const declaredQualified = s.ownerClassKey
          ? (ctx.qualifiedBasesByClassKey.get(s.ownerClassKey) ?? [])
          : []
        const bases = raw?.filter((b) => b !== s.ownerName && !declaredQualified.includes(b))
        if (!bases || bases.length === 0) continue
        // MRO order: the first base that DECLARES THIS NAME AS A METHOD owns the override.
        //
        // "AS A METHOD" is the fourth genuine analyzer defect the independent oracle found,
        // and the most damaging shape of the four, because it FABRICATES an edge *and* marks
        // it verified. The check was `some(bm => bm.ownerName === b)` — any symbol with that
        // name and owner — and a class VARIABLE satisfies it:
        //
        //     class Base:
        //         attr = None            # a class variable, not a method
        //     class Derived(Base):
        //         def attr(self): ...    # a method
        //
        // published `overrides Derived.attr -> Base.attr` at **0.95 with no reasonCode**, which
        // reads as a verified fact and is not one: there is no method to override. CPython's
        // own `ast` on that pair reports `attr(var)` for `Base` and `attr(def)` for `Derived`,
        // and the two are different kinds of member — python's `Base.attr` is the value `None`.
        //
        // The corpus makes this common rather than exotic. Cython classes declare their state
        // at class level, so `Cython/Compiler/Nodes.py` has `code_object = None` in
        // `FuncDefNode` at L1996 and a `code_object` property in `CFuncDefNode` — which is how
        // this surfaced, as 20 fabricated verified edges concentrated in one file.
        const declaring = bases.find((b) => {
          const inFile = byName.get(s.name)?.some(
            (bm) => bm.ownerName === b && bm.kind === ASTEngine.SymbolKind.Method,
          ) ?? false
          return inFile || !!overrideCompanion?.get(b)?.has(s.name)
        })
        if (declaring) {
          // INCOMING_PY / M14 §4: 0.95 is below 1.0, so this edge owes a reason code
          // like every other one, and the reason it carries is the strongest claim the
          // lane makes: the target is not a guess about a module it has not read, it is
          // the first base in MRO order that DECLARES this method — a fact about code
          // in front of it. Measured over the 679-file INCOMING_PY corpus before this
          // line: 670 `overrides` edges below 1.0 and 81 of them (the verified tier)
          // carried no reason code, so a consumer could not tell a verified MRO edge
          // from the `first-parent-guess` tier except by reading the confidence.
          this.pushRel(ctx, `${s.ownerName}.${s.name}`, `${declaring}.${s.name}`, ASTEngine.RelationshipType.Overrides, 0.95, { reasonCode: "mro-base-declares-method" }, s.range?.startLine)
          continue
        }
        // `object.__init__` is the one external override that is a FACT and not a
        // guess: every class in Python inherits it, so a class defining `__init__`
        // overrides `object.__init__` whatever its bases say. Emitted at the same
        // confidence as a verified edge because it is the same kind of claim — read from
        // the language, not inferred across a module boundary. It is 27 of the 1,190
        // guesses the oracle confirmed, so it is the part worth keeping.
        if (s.name === "__init__" && bases.includes("object")) {
          this.pushRel(ctx, `${s.ownerName}.__init__`, "object.__init__", ASTEngine.RelationshipType.Overrides, 0.95, { reasonCode: "object-init-universal" }, s.range?.startLine)
        }
        // No base declares it, so this is a guess. Guess the best candidate — and the
        // best candidate is NOT always the leftmost.
        //
        // A base that is declared in THIS file and lacks the name is evidence of
        // absence: we have read it. A base that is external is merely unknown. Guessing
        // a base we have just ruled out names the one class we KNOW does not have the
        // method, which is the worst possible guess — and it is what the leftmost rule
        // did for `class Requirement(_ComputedReqKindsMixin, RequirementNamedTuple)`,
        // where the mixin was read and found to have `__init__` but no `__new__`, and
        // the NamedTuple that necessarily has `__new__` was never named.
        //
        // This is the change that matters most in this method, and the measurement that
        // forced it: the guess was 98% WRONG. Over 400 corpus files the unconditional
        // version emitted 1,313 override edges the tree contradicts against 27 it
        // confirms — and those 1,313 were overwhelmingly bases this analyzer had
        // ALREADY READ and found lacking.
        //
        // A base declared IN THIS FILE that lacks the name is not a candidate at all: we
        // read its body, it does not define the method, so the subclass is not
        // overriding anything. An edge emitted anyway is not honest suspicion — it is a
        // false statement carrying a confidence label, and at 1,313 rows it is 1.3% of
        // this lane's relationships.
        //
        // The rule is therefore: a verified edge to the first base that DECLARES the
        // name; a 0.5 guess ONLY to a base this file never read, where the question is
        // genuinely open; and NO edge when every base is in-file and none declares the
        // name. That last case is not a gap — the tree says the method is new rather
        // than overriding, and emitting nothing is what the tree says.
        //
        // The 0.5 and the reasonCode stay, because where a guess is still permitted it
        // should still be answerable. Making it answerable is not the same as making it
        // right, and this measurement is the difference.
        // PY-7, CORRECTED AFTER BEING MEASURED. An earlier pass in this review removed
        // the first-parent guess outright on the strength of the measurement below, and
        // that was wrong — not about the number, but about whose decision it was.
        //
        // THE MEASUREMENT, which stands:
        //   over 400 pinned corpus files the guess emitted 1,163 override edges the block
        //   grammar CONTRADICTS, against 27 it confirms. 98% wrong.
        //
        // WHY THE REMOVAL WAS REVERTED: this is not a python decision. `external-override`
        // is a CROSS-LANE family contract — javascript, ruby and python each carry the
        // fixture, and the completeness spec states the three tiers together for
        // php/ruby/python/js/perl/java/swift: verified in-file, then companion-index, then
        // a 0.5 first-parent guess marked `inferred` and counted as heuristic. Deleting a
        // family's contract in one lane because that lane measured its bottom tier at 2%
        // is precisely the unilateral move a shared contract exists to prevent. So the
        // measurement is KEPT and the conclusion it supports is about the CONTRACT: tier 2
        // is the one that is missing, and that is the finding.
        //
        //   The fixture this lane pins says the companion index "is never populated in
        //   production". So tier 2 is dead, tier 3 absorbs 100% of external overrides, and
        //   a tier designed as a last resort is doing all the work. The fix is not to
        //   delete tier 3 — it is to implement tier 2 so that tier 3 becomes rare by
        //   construction. That is a real piece of work and it is owed.
        //
        // WHAT SURVIVES from the removed pass, because it is correct under the contract
        // as written: an in-file base that lacks the name is not a candidate at all. We
        // have read its body, so the subclass is not overriding anything — and the
        // contract's tiers put that case nowhere, since it is not an "external base".
        // Measured: 150 refuted edges removed, every one of that shape.
        //
        // So the guess is restored, narrowed to bases this file never read, which is
        // where the question is genuinely open and where the family's 0.5 tier belongs.
        // ONE guess, from the FIRST base this file never read — which is what the
        // family's "first-parent guess" means, and narrowing it from "every base" to
        // "the first unreadable one" is the only change to the tier's scope. A class with
        // three external bases gets one guessed override, not three: the contract's claim
        // is about the MRO's first candidate, and three edges would be three claims.
        // PY-33: the one guess this lane can CHECK is the one it must not make when the
        // answer is already known. `object` is the closed root — `dir(object)` is 23 names
        // and every class inherits them — so guessing `object.<name>` for a name object does
        // not declare is not honest suspicion, it is a false statement at 0.5. See
        // OBJECT_MEMBERS for the measurement and for the two boundaries this refusal keeps:
        // a name object DOES declare still gets its 0.5 guess, and every other unreadable
        // base is untouched.
        const firstUnread = bases.find((b) => !declaredClasses.has(b))
        const objectGuessIsFalse = firstUnread === "object" && !OBJECT_MEMBERS.has(s.name)
        if (firstUnread !== undefined && !overrideCompanion?.has(firstUnread) && !objectGuessIsFalse) {
          this.pushRel(ctx, `${s.ownerName}.${s.name}`, `${firstUnread}.${s.name}`, ASTEngine.RelationshipType.Overrides, 0.5, { reasonCode: "first-parent-guess" }, s.range?.startLine)
        }
        // (The duplicate 60-line rationale that used to follow here, and the
        //  "PY-7, resolved by measurement. The first-parent guess is GONE" block
        //  that contradicted it, were removed 2026-10-05. Two comments in one
        //  method disagreed with each other AND with the three lines of live code
        //  above: one said the guess was restored and narrowed to the first
        //  unreadable base, the other said it was gone and that emitting nothing was
        //  the honest count. The code above is the first-parent guess, still emitted
        //  at 0.5 with reasonCode "first-parent-guess", because it is a CROSS-LANE
        //  family contract (M37.10, pinned for php/ruby/python/js/perl/java/swift)
        //  and python does not remove one lane's copy of it unilaterally. The
        //  reasoning that still holds is kept immediately above; what was removed is
        //  the copy that said the opposite, and a copy of that copy.)
        continue
      }
    }
  }

  // ========================================================================
  // CORE UTILITIES (regex-free)
  // ========================================================================

  /**
   * The relation-level OWNER of a member-position edge, or `undefined`.
   *
   * PHPD42's lever, ported to this lane. The store's `resolveMemberTargetsByOwner`
   * (`src/ast/member-owner-resolution.ts`) resolves a member target THROUGH the class that
   * declares it and that class's `super_types` ancestors, instead of binding the bare member
   * name by the insert-time ranking that picks the alphabetically-first `s.id` among every
   * same-named declaration in the project. That ranking is not a fact about python — `render`
   * is a method on many classes at once — and the owner channel is the one signal that turns
   * "which of N" into "the class the receiver actually is".
   *
   * The key is published ONLY when the receiver is EXACTLY the implicit first parameter, spelled
   * `self` or `cls` — the lane's own convention, and the same spelling its `dispatch-on-parameter`
   * reason code already trusts. The exclusion is the whole point of the helper and it is not
   * cosmetic: `self.store.save` names `save` on the VALUE of `self.store`, whose type this parse
   * does not know, so labelling it with the enclosing class would let the store resolve `save` to
   * a method of the OUTER class — a confident wrong edge, which is the failure the owner channel
   * exists to remove. One dot, receiver `self`/`cls`, or no owner.
   *
   * The key is OMITTED rather than set to `undefined`/`null`, so a consumer can test presence and
   * a fixture's `meta.owner: null` ("this edge must NOT carry an owner") is a real assertion about
   * the absent case rather than a vacuous one — the same contract php's `withMemberOwner` states.
   */
  private memberOwnerOf(receiverName: string | undefined, enclosingClass: string | undefined): string | undefined {
    if (!enclosingClass || !receiverName) return undefined
    return receiverName === "self" || receiverName === "cls" ? enclosingClass : undefined
  }

  /**
   * PY-D14 (round 7) — a bare-name callee is `local-callee` when the name is bound in an
   * ENCLOSING FUNCTION's scope.
   *
   * The verdict named this lane's largest honest hole: 4,837 `calls` edges whose callee binds to
   * nothing the project declares. The top names show one cause, not many — `run_eval` is a NESTED
   * `def` inside `main` (a scope-local name this lane deliberately publishes no symbol for, on the
   * JS-family contract), `django_capture_on_commit_callbacks` is a pytest-INJECTED PARAMETER — and
   * they are the same fact: the callee is bound in an enclosing FUNCTION's scope, so no
   * project-wide declaration exists for the edge to reach, and no amount of store work can invent
   * one. Python's LEGB rule makes it a statement about the language rather than a guess about
   * intent: a name bound in an enclosing function resolves to THAT binding, and a module-level
   * name of the same spelling is shadowed for the whole body — so "local" is the MORE correct
   * answer, not a fallback for a failed lookup.
   *
   * The check walks the CALL SITE'S OWN ANCESTORS and asks the pre-pass map, innermost outward, so
   * it is the call's lexical position that decides and the answer needs no scope bookkeeping. A
   * `global`/`nonlocal` name is subtracted by the pre-pass, because a write to it is not a local
   * binding — the one shape where a naive collector would over-claim. Under-claiming is deliberate
   * and safe: a lambda's or a comprehension's own parameters are not collected, so a call inside
   * one stays `bare-name-callee` and is counted, never mislabelled.
   *
   * PY-D22 (round 11) — THE UNDER-CLAIM IS OVER, and it was never safe, only cheaper.
   *
   * That sentence was the whole argument for skipping comprehension and lambda scopes, and it named
   * the cost as "counted, never mislabelled". The count is what round 10 finally read: a
   * comprehension's `for` target IS a binding of the comprehension's own scope, so a read of it in
   * the body resolves to THAT binding by python's own scoping rules — `[comp(page) for comp in
   * comparison]` calls the comprehension's `comp`, and the graph said the name belonged to no scope
   * in the project. `bare-name-callee` is not a weaker answer there, it is the WRONG one: it claims
   * a project-wide name for a binding written four characters earlier.
   *
   * The check is the SAME shape as the function check beside it — walk the read's own ancestors and
   * ask each scope node for its OWN bindings — so there is no scope bookkeeping and no state to
   * thread. `locals.size === 0` was an early exit that made the helper answer `false` for a whole
   * module-scope comprehension (a file with no `def` in it), so it is gone; the walk is bounded by
   * the read's own depth either way.
   */
  private isLocalCalleeName(calleeLeaf: Node, name: string, locals: Map<string, Set<string>>): boolean {
    if (!name) return false
    let cur: Node | null = calleeLeaf.parent
    while (cur) {
      if (cur.type === "function_definition") {
        const bound = locals.get(this.functionLocalsKey(cur))
        if (bound && bound.has(name)) return true
      } else if (this.scopeOwnBindings(cur).has(name)) {
        return true
      }
      cur = cur.parent
    }
    return false
  }

  /**
   * PY-D22 (round 11) — the names a NON-`def` scope node binds in its OWN scope: a comprehension's
   * `for` targets and a lambda's parameters.
   *
   * MEASURED SHAPES (`.tmp-py/round11-shapes.mts`), because the two are not spelled alike:
   *
   *     [x for x in s]              list_comprehension -> for_in_clause(left: identifier)
   *     [v for k, v in d.items()]   for_in_clause(left: pattern_list) — every target of every clause
   *                                 is a binding of the SAME comprehension scope (measured with
   *                                 three chained `for`s, all three clauses are direct children)
   *     lambda q_, *args, k=1:      lambda -> lambda_parameters (NOT `parameters`)
   *
   * A target goes through the shared pattern walker, so `k, v` binds two names. Anything that is not
   * one of these five node types binds nothing here, so the function returns an empty set and both
   * callers keep their previous answer — the comprehension/lambda skip in `collectFunctionLocals`
   * stays exactly as it was, because a comprehension's bindings are NOT its enclosing function's.
   */
  private scopeOwnBindings(scope: Node): Set<string> {
    const out = new Set<string>()
    switch (scope.type) {
      case "list_comprehension":
      case "set_comprehension":
      case "dictionary_comprehension":
      case "generator_expression":
        for (let i = 0; i < scope.namedChildCount; i++) {
          const c = scope.namedChild(i)
          if (c?.type !== "for_in_clause") continue
          this.addPatternTargets(c.childForFieldName("left") ?? c.namedChild(0), out)
        }
        return out
      case "lambda": {
        const params = scope.childForFieldName("parameters")
        if (params) this.addParameterNames(params, out)
        return out
      }
      default:
        return out
    }
  }

  /**
   * The names a `parameters` / `lambda_parameters` node binds — the ONE reader, shared by PY-D14's
   * function-local collector and PY-D22's scope check.
   *
   * Extracted in round 11 for the reason `addPatternTargets` was extracted in round 10: two readers
   * of the same shape is how a dead case (`with_item`'s `alias`) survived nine rounds in this very
   * file. A parameter binds its NAME only — `default_parameter` / `typed_default_parameter` carry a
   * `name` field, `typed_parameter` leads with the identifier or the splat, and a splat/tuple falls
   * back to identifier children — so `def f(x: SomeType = SOME_DEFAULT)` adds `x` and never
   * `SomeType`, and a lambda's `*args` / `**kw` add `args` / `kw`.
   */
  private addParameterNames(params: Node, into: Set<string>): void {
    const addParam = (p: Node): void => {
      switch (p.type) {
        case "identifier":
          into.add(p.text)
          return
        case "default_parameter":
        case "typed_default_parameter": {
          const nm = p.childForFieldName("name")
          if (nm && nm.type === "identifier") into.add(nm.text)
          return
        }
        case "typed_parameter": {
          const first = p.namedChild(0)
          if (first?.type === "identifier") into.add(first.text)
          else if (first) for (let i = 0; i < first.namedChildCount; i++) {
            const c = first.namedChild(i)
            if (c?.type === "identifier") into.add(c.text)
          }
          return
        }
        default: {
          for (let i = 0; i < p.namedChildCount; i++) {
            const c = p.namedChild(i)
            if (c?.type === "identifier") into.add(c.text)
          }
        }
      }
    }
    for (let i = 0; i < params.namedChildCount; i++) {
      const p = params.namedChild(i)
      if (p) addParam(p)
    }
  }

  /**
   * PY-D15 / PY-D16 (round 8) — the reason a TYPE-HOLDING name has no project-wide declaration:
   * it is bound by the reference's own enclosing scope. Returns the code, or `undefined` when the
   * name is not a local binding (in which case the caller keeps the position-based code).
   *
   * This is the reference-side sibling of `isLocalCalleeName`, and it is deliberately a SEPARATE
   * helper rather than a widening of that one. A CALL's target is a callee and its code is
   * `local-callee`; a REFERENCE's target is a type and its codes are the two above. Merging them
   * would put one vocabulary on two axes — the mistake `external-member-call` is deliberately
   * separated from `dispatch-on-receiver` to avoid.
   *
   * The LOCAL check comes first because it is the binding that actually holds at runtime: python's
   * function scope is one namespace, so a def that both declares `[T]` and assigns `T = 5` binds a
   * local when the body runs, and reporting the type parameter there would name the signature's
   * binding for a name the body rebound. A name that is ONLY a type parameter is in no
   * `functionLocals` set (the pre-pass reads `parameters`, never `type_parameter`), so the second
   * check is reached exactly when the first cannot answer.
   *
   * Both checks walk the LEAF'S ANCESTORS, so the answer comes from the reference's own lexical
   * position and needs no scope bookkeeping — the same property that makes `isLocalCalleeName`
   * correct for a nested def whose enclosing function is three levels up.
   */
  private dynamicTypeBindingReason(leaf: Node | null | undefined, name: string, locals: Map<string, Set<string>>): string | undefined {
    if (!leaf || !name) return undefined
    // PY-D24 (round 12) — A MEMBER READ IS NOT A NAME, and when its receiver is a RUNTIME OBJECT
    // the lane must say so instead of leaving a dangling declaration name.
    //
    // `isinstance(x, self._self_owner)`, `issubclass(source.__class__, field.related_model)`,
    // `isinstance(w.message, passlib_exc.PasslibHashWarning)` — the type argument is an ATTRIBUTE
    // of a local (a parameter, an assignment, a walrus target). The emitter publishes the last
    // identifier as the target and the whole spelling as `metadata.qualified`, so the edge names
    // `_self_owner` / `related_model` / `PasslibHashWarning` as if the file declared them, and the
    // verdict could only call all three UNEXPLAINED (measured: exactly these 3 rows in the round-11
    // residual, plus `gdb.SignalEvent`, whose ROOT is bound by nothing and is covered by the
    // not-bound-in-file axis instead). The statement the source makes is not about a project-wide
    // type; it is a member read on an object whose type nothing in the file states.
    //
    // The gate is the receiver's ROOT, resolved by python's own lexical walk: only a receiver that
    // is a LOCAL of an enclosing function can have no static target here. An import-bound root
    // (`nn.Module`) keeps the qualified-external route, and a class this file declares
    // (`Config.DEFAULTS`) keeps the chance to resolve against the store.
    if (leaf.parent?.type === "attribute") {
      const attr = leaf.parent
      // The MEMBER, not the receiver: the last named child is the attribute's own name, the same
      // test `typeQualifier` uses to build the qualified spelling. Without it the receiver leaf
      // (`field` inside `field.related_model`) fires this rule too, and a reference to a LOCAL
      // binding would be relabelled `member-read` — which the probe showed on the first run, three
      // rows of it, and is the reason this test is here rather than a check on the parent alone.
      const lastNamed = attr.namedChild(attr.namedChildCount - 1)
      if (!lastNamed || lastNamed.startIndex !== leaf.startIndex || lastNamed.endIndex !== leaf.endIndex) {
        // fall through to the binding walk below
      } else {
      const object = attr.childForFieldName?.("object") ?? attr.namedChild(0)
      const root = object ? this.firstIdentifier(object) : undefined
      if (root && object) {
        let up: Node | null = leaf.parent
        while (up) {
          if (up.type === "function_definition") {
            const bound = locals.get(this.functionLocalsKey(up))
            if (bound && bound.has(root)) return "member-read"
          } else if (this.scopeOwnBindings(up).has(root)) {
            return "member-read"
          }
          up = up.parent
        }
      }
      }
    }
    let cur: Node | null = leaf.parent
    while (cur) {
      if (cur.type === "function_definition") {
        const bound = locals.get(this.functionLocalsKey(cur))
        if (bound && bound.has(name)) return "local-binding-target"
      } else if (this.scopeOwnBindings(cur).has(name)) {
        // PY-D22 (round 11) — a comprehension's `for` target and a lambda's parameter are bindings
        // of their own scope, so an annotation naming one is bound by the SCOPE, not by the
        // project. Measured shape: wagtail's `any(...)` guard over
        // `[comp(...) for comp in comparison]` and saleor's `allowed_err` inside a comprehension
        // that binds it were published as `instanceof-check` / `annotation-type`, which claims the
        // name is a project-wide type.
        return "local-binding-target"
      }
      if (cur.type === "function_definition" || cur.type === "class_definition") {
        if (this.typeParameterNames(cur).has(name)) return "inline-type-parameter"
      }
      cur = cur.parent
    }
    return undefined
  }

  /**
   * The names a PEP-695 `type_parameter` clause binds — `def f[T]`, `class C[T: str]`, `type A[U]`.
   *
   * The clause is one node whose named children are `type` nodes, one per parameter, and each
   * parameter's NAME is the FIRST identifier in it: `TValue` is `type -> identifier`, and the
   * bounded form `T: str` is `type -> constrained_type -> type -> identifier` with the bound's
   * `str` following the name. Taking the first identifier therefore reads the name in every shape
   * the grammar produces without enumerating them, and never mistakes a BOUND (`str`) for a name.
   *
   * A def with no clause returns the empty set, so the caller's two checks cost one child scan per
   * enclosing def — bounded by the def's own direct children, not by its body.
   */
  private typeParameterNames(def: Node): Set<string> {
    const out = new Set<string>()
    for (let i = 0; i < def.namedChildCount; i++) {
      const c = def.namedChild(i)
      if (!c || c.type !== "type_parameter") continue
      for (let j = 0; j < c.namedChildCount; j++) {
        const tp = c.namedChild(j)
        if (!tp) continue
        const nm = this.firstIdentifier(tp)
        if (nm) out.add(nm)
      }
    }
    return out
  }

  /** The first `identifier` inside a subtree, in document order — or nothing. */
  private firstIdentifier(n: Node): string | undefined {
    if (n.type === "identifier") return n.text
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (!c) continue
      const found = this.firstIdentifier(c)
      if (found !== undefined) return found
    }
    return undefined
  }

  /**
   * A stable key for a function node, because a `Node` can never be one.
   *
   * The lane already learned this once and says so at `extractMemberUses`: web-tree-sitter hands
   * back a FRESH wrapper on every `.parent` / `.namedChild()` access — "identity never holds, every
   * `.parent` is a fresh object crossing the WASM boundary" — so a `Map<Node, …>` is a map no
   * lookup can hit. The pre-pass stores under the function's own start position instead, which is a
   * plain number pair on the underlying tree and is therefore identical across wrappers. (The first
   * version of this map keyed on the node and read `bare-name-callee` for every call in the file,
   * which the probe showed immediately — the reason codes were all one value.)
   */
  private functionLocalsKey(n: Node): string {
    return `${n.startPosition.row}:${n.startPosition.column}`
  }

  /**
   * Descend a binding TARGET through tuple/list pattern containers only, collecting the
   * `identifier` names it binds.
   *
   * `identifier` binds. A `tuple_pattern` / `list_pattern` / `pattern_list` (the bare `a, b`
   * form) and a `tuple` / `list` literal used as a target are CONTAINERS
   * whose elements bind. An `as_pattern_target` is the same question one level down —
   * `with open(...) as (a, b)` wraps the container in one — so it is descended too. Nothing
   * else is guessed at: a member or an index target (`self.x`, `d[k]`) binds a member or an
   * element rather than a bare name, and an expression is not a target at all.
   *
   * Extracted in round 10 so the `global`-write collector reads a target EXACTLY as PY-D14's
   * local collector does. The two helpers that read this shape separately is how the
   * `with_item` / `except_clause` bug below survived nine rounds.
   *
   * `typed_pattern` WAS IN THIS LIST AND ROUND 10 REMOVED IT, because `verify-fixture-coverage.ts`
   * flagged it as a DEAD LITERAL and the measurement agreed: no python fixture contains such a node,
   * the eight source shapes that could plausibly produce one (`def f(a: int)`, `with ... as (a, b)`,
   * `except E as e`, `match`/`case` with and without `as`, `for (a, b) in x`, a lambda default, a
   * bare `x: int`, `(a): int = 1`) all parse as `typed_parameter` / `as_pattern` / `tuple_pattern`
   * instead (`.tmp-py/typed-pattern-probe.mts`), and a walk of the whole corpus — 11,309 `.py` /
   * `.pyi` files, tree-sitter's own tree — found **0** occurrences
   * (`.tmp-py/typed-pattern-corpus.txt`). A branch that can never fire is a claim with no evidence,
   * which is the lesson round 9 wrote down when it removed the fabricated reference.
   *
   * ROUND 11 ADDED `list_splat_pattern`, and it is the SAME lesson read the other way: `a, *rest = f()`
   * binds `rest`, the probe (`.tmp-py/round11-shapes.mts`) shows the grammar spells that element
   * `list_splat_pattern` (a `pattern_list` child holding one `identifier`), and the walker did not
   * descend it — so `rest` was bound by no symbol and was not a function local either. It is covered
   * by a fixture, which is the condition this docstring sets for keeping a literal. `**kw` in a
   * target is NOT added: no python program binds one, so a `dictionary_splat_pattern` branch here
   * would be exactly the dead literal round 10 deleted.
   *
   * Returns NODES, not names, because a caller that has to publish a symbol needs the identifier's
   * own range (one declaration per name, each at its own position) while a caller that only needs
   * membership needs the set. Both read the SAME walk: one reader, so the two can never disagree
   * about what a binding target is.
   */
  private patternTargetNodes(target: Node | null | undefined): Node[] {
    const out: Node[] = []
    if (!target) return out
    const stack: Node[] = [target]
    while (stack.length > 0) {
      const t = stack.pop()!
      if (t.type === "identifier") { out.push(t); continue }
      if (t.type === "tuple_pattern" || t.type === "list_pattern" || t.type === "pattern_list" ||
          t.type === "as_pattern_target" || t.type === "list_splat_pattern" ||
          t.type === "list" || t.type === "tuple") {
        for (let i = 0; i < t.namedChildCount; i++) {
          const c = t.namedChild(i)
          if (c) stack.push(c)
        }
      }
    }
    return out
  }

  /** The names a binding TARGET binds — the name-only face of `patternTargetNodes`. */
  private addPatternTargets(target: Node | null | undefined, into: Set<string>): void {
    for (const n of this.patternTargetNodes(target)) into.add(n.text)
  }

  /**
   * The TARGET of an `as` binding on a `with_item` / `except_clause`, read from the shape the
   * grammar actually produces — which is NOT the shape this file read for nine rounds.
   *
   * MEASURED (`.tmp-py/global-shape-probe.mts`, round 10) on this grammar:
   *
   *     with open("x") as W:      with_item   value -> as_pattern -> as_pattern_target
   *     except Exception as V:    except_clause value -> as_pattern -> as_pattern_target
   *
   * Round 7's `collectFunctionLocals` read `childForFieldName("alias")` for the `with_item` case
   * and `childForFieldName("name")` for the `except_clause` case. BOTH ARE NULL on every real
   * node, so neither case ever fired: the two spellings were documented as collected while the
   * analyzer collected nothing, which is a claim with no falsifier — the same failure mode round 9
   * removed a fabrication with. A `with`/`except` target therefore stayed in no local set, and
   * every use of one was one reason code away from being read as a project-wide name.
   */
  private asBindingTarget(n: Node): Node | null {
    const pat = n.childForFieldName("value")
    if (pat?.type === "as_pattern") return this.findChildByType(pat, "as_pattern_target") ?? pat.namedChild(1)
    const nested = this.findChildByType(n, "as_pattern")
    if (nested) return this.findChildByType(nested, "as_pattern_target") ?? nested.namedChild(1)
    return null
  }

  /**
   * PY-D18 (round 10) — the names a function's OWN body creates in the MODULE namespace, keyed by
   * the node of the earliest creating write, for the pairs the source STATES: a `global X` in that
   * body plus a write to `X` in that same body that creates the binding.
   *
   * WHY THIS IS A RESOLUTION AND NOT AN EXCUSE. `global X; X = value` binds X in the MODULE
   * namespace — the file's own scope, a place the ontology can hold — so the name is publishable
   * as an ownerless module variable. Excusing it (a reason code that says "not resolvable") would
   * be weaker than the source allows: python named the scope, and the scope is this file.
   *
   * PRICED before it was written (`.tmp-py/price-globals9.py`, CPython's own `ast`): 397 pairs in
   * the corpus, 140 already module-bound, 257 that can carry a residual row, and a blast on the
   * round-9 UNEXPLAINED dump of 98 rows (8 calls + 90 references, every call `bare-name-callee`,
   * every reference `annotation-type`). Real shapes: cython's `Demos/benchmarks/run_benchmarks.py`
   * declares `global run_python` in `init()`, assigns it, and calls it from module level 40 lines
   * later; a sqlalchemy test module declares `global str30` inside a test function, assigns
   * `Annotated[...]`, and a nested class annotates against it.
   *
   * PRECISION, re-measured against CPython rather than assumed:
   *   * a CREATING write needs a VALUE. CPython: `exec("x: int", m.__dict__)` leaves `m.__dict__`
   *     without `x`, so an `assignment` with no `right` field (`X: T`) does NOT count here even
   *     though the price script counted it — the price was an upper bound, this is the rule.
   *   * `X += 1` is a READ-modify-write: it requires the binding to already exist, so
   *     `augmented_assignment` does not count. `del X` removes the binding, so
   *     `delete_statement` does not count.
   *   * OWN BODY ONLY. A nested `def`/`class` body is a different scope with its own `global`
   *     statements, and each nested function is visited by this same sweep as its own node — so
   *     nothing has to be inferred and nothing is inherited. A `lambda` or comprehension opens its
   *     own scope too.
   *   * the binding forms counted are the ones CPython binds a module name with: `X = …`,
   *     `X: T = …`, `for X in …`, `with … as X`, `except E as X`, `(X := …)`, and an `import`
   *     inside the function (which reaches the module namespace only after a `global` — exactly
   *     the gate this helper applies).
   */
  private collectGlobalWriteNames(rootNode: Node): Map<string, Node> {
    const out = new Map<string, Node>()
    const functions: Node[] = []
    const sweep: Node[] = [rootNode]
    while (sweep.length > 0) {
      const n = sweep.pop()!
      if (n.type === "function_definition") functions.push(n)
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) sweep.push(c)
      }
    }
    for (const fn of functions) {
      const declared = new Set<string>()
      const created = new Map<string, Node>()
      const note = (into: Set<string>, node: Node | null | undefined): void => {
        if (!node) return
        for (const nm of into) {
          const prev = created.get(nm)
          if (!prev || node.startIndex < prev.startIndex) created.set(nm, node)
        }
      }
      const stack: Node[] = []
      for (let i = 0; i < fn.namedChildCount; i++) {
        const c = fn.namedChild(i)
        if (!c) continue
        // The function's own NAME and its return annotation are not body statements.
        if (c.type === "identifier" || c.type === "type" || c.type === "parameters") continue
        stack.push(c)
      }
      while (stack.length > 0) {
        const n = stack.pop()!
        const t = n.type
        if (t === "function_definition" || t === "class_definition") continue
        if (t === "lambda" || t === "list_comprehension" || t === "set_comprehension" ||
            t === "dictionary_comprehension" || t === "generator_expression") continue
        switch (t) {
          case "global_statement":
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c?.type === "identifier") declared.add(c.text)
            }
            break
          case "assignment": {
            if (!n.childForFieldName("right")) break
            const left = n.childForFieldName("left") ?? n.namedChild(0)
            const names = new Set<string>()
            this.addPatternTargets(left, names)
            note(names, left)
            break
          }
          case "for_statement": {
            const left = n.childForFieldName("left") ?? n.namedChild(0)
            const names = new Set<string>()
            this.addPatternTargets(left, names)
            note(names, left)
            break
          }
          case "with_item":
          case "except_clause": {
            const target = this.asBindingTarget(n)
            const names = new Set<string>()
            this.addPatternTargets(target, names)
            note(names, target)
            break
          }
          case "named_expression": {
            const target = n.childForFieldName("name") ?? n.namedChild(0)
            const names = new Set<string>()
            this.addPatternTargets(target, names)
            note(names, target)
            break
          }
          case "import_statement":
          case "import_from_statement": {
            const names = new Set<string>()
            this.addImportBoundNames(n, names)
            note(names, n)
            break
          }
          default:
            break
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) stack.push(c)
        }
      }
      for (const nm of declared) {
        const w = created.get(nm)
        if (!w) continue
        const prev = out.get(nm)
        if (!prev || w.startIndex < prev.startIndex) out.set(nm, w)
      }
    }
    return out
  }

  /**
   * The names an import STATEMENT binds in the scope it appears in. `import a.b` binds `a` (the
   * first segment, not the whole dotted path); `import a.b as c` and `from m import S as R` bind
   * the ALIAS; `from m import S` binds `S`; a `from` clause's module half binds nothing; a
   * `wildcard_import` binds no single name (see PY-D19 for where those names are handled).
   *
   * Shared by PY-D18's write collector and its module-scope dedupe, so the two cannot drift on
   * what an import statement binds.
   */
  private addImportBoundNames(node: Node, into: Set<string>): void {
    let seenImport = node.type === "import_statement"
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (!c) continue
      if (c.type === "import") { seenImport = true; continue }
      if (!seenImport) continue
      if (c.type === "dotted_name") {
        const first = c.namedChild(0)
        if (first?.type === "identifier") into.add(first.text)
      } else if (c.type === "identifier") {
        into.add(c.text)
      } else if (c.type === "aliased_import") {
        const alias = c.childForFieldName("alias") ?? c.namedChild(c.namedChildCount - 1)
        if (alias?.type === "identifier") { into.add(alias.text); continue }
        const nm = c.childForFieldName("name") ?? c.namedChild(0)
        const first = nm?.namedChild(0) ?? nm
        if (first?.type === "identifier") into.add(first.text)
      }
    }
  }

  /**
   * PY-D18's SECOND HALF — publish the module-scope symbol for each `global`-created name that has
   * no module-scope declaration already, AFTER the walk so the dedupe sees every symbol the file
   * published (a module `def X`, a class `X`, a module-level `X = …`, an `import X`).
   *
   * The symbol is ownerless (python has no module declaration; the module scope is named after the
   * file — the JS-family contract this lane already follows for module variables) and marked so a
   * reader can tell WHERE the binding came from: the write inside the function, at the write's own
   * line. Nothing else is emitted — no `contains` (there is no owner), no export, no relationship;
   * the edge that was dangling now names a real declaration in the real scope python resolved it
   * to, and the resolver in `python-endpoint-resolution.ts` finds it by name like any other.
   */
  private publishGlobalWriteBindings(rootNode: Node, ctx: PythonContext): void {
    const writes = this.collectGlobalWriteNames(rootNode)
    if (writes.size === 0) return
    const bound = new Set<string>()
    for (const s of ctx.symbols) if (s.name && !s.ownerName) bound.add(s.name)
    for (const im of ctx.imports) {
      if (im.alias) bound.add(im.alias)
      if (im.module && im.isNamespaceImport) bound.add(im.module.split(".")[0]!)
      // A `from` row's items are the names it binds EXCEPT when an item carries an alias (the
      // ImportInfo shape keeps one alias for the row, not per item) — and a `*` binds no single
      // name. Skipping an aliased row entirely is the conservative direction: it can only mean
      // fewer symbols published, never a symbol published over a name the import already binds.
      if (!(im.items ?? []).includes("*")) {
        for (const it of im.items ?? []) if (it !== "*") bound.add(it)
      }
    }
    for (const [name, node] of writes) {
      if (bound.has(name)) continue
      ctx.symbols.push({
        name,
        kind: ASTEngine.SymbolKind.Variable,
        range: this.nodeToRange(node),
        visibility: this.pythonVisibility(name),
        metadata: {
          pythonSpecific: true,
          isModuleVariable: true,
          // WHICH mechanism published it. A reader triaging a module variable whose declaration
          // is not a module-level assignment needs the fact in hand, not a line number to go read.
          boundByGlobalWrite: true,
        },
      })
    }
  }

  /**
   * PY-D23 (round 12) — a MODULE-scope (or CLASS-scope) binding written by a statement that is not
   * an assignment.
   *
   * `for mixin in mixins:` at module scope binds `mixin` in the module namespace; `with … as fh`
   * and `except E as err` bind at the scope they are written in, and so does a class-level
   * `for`. The assignment walker published NONE of them, so a read of one had no declaration to
   * resolve against and the verdict could only call it UNEXPLAINED — measured, one row:
   * `wagtail/wagtail/snippets/api/v3/router.py:76` reads `mixin` inside a module-level `for` loop
   * over `mixins`, published as `references … -> mixin [instanceof-check]` with no binding in the
   * store.
   *
   * PRICED with CPython's own `ast` before this method existed (`.tmp-py/price-module-bindings.py`):
   * 351 module `for` targets, 98 `with … as`, 48 `except … as` and 6 module-scope walrus targets in
   * 283 files, plus 13 `for` targets in class bodies — 516 binder rows. MEASURED on the shipped
   * analyzer (`.tmp-py/probe-binder-row-gap.mts`, `.tmp-py/census-bound-by-binder-failed.mts`): those
   * files publish **480** symbols carrying `metadata.boundByBinder` — every one of them named by a
   * priced row, 0 un-named — the walk dedupes a row whose name the file already declares in that
   * scope (34 `for` + 1 `with` + 6 walrus rows measured naming a symbol without the field), and 56
   * files CPython REJECTS contribute **14** more, for **494**: exactly the corpus-wide symbol delta of
   * this round (206,445 -> 206,939), with every other label unmoved. One residual row depends on them
   * today; the value of publishing them is that the analyzer's statement of the module namespace
   * becomes TRUE of the source, so a future read of any of these names cannot be UNEXPLAINED for a
   * reason the source never wrote.
   *
   * NOTE THE SEAM: `metadata.boundByBinder` is ANALYZER-SIDE only. `src/ast/pool-worker.ts`'s symbol
   * metadata allowlist carries 1 of the 17 keys this analyzer publishes (`superTypes`, carried because
   * the php lane's owner pass reads the ancestor column), so a store-level reader sees NULL — measured
   * at 0% survival by `.tmp-py/seam-metadata-probe.mts` over the priced files. The SYMBOL crosses
   * (which is what the mechanism is for); the provenance FIELD does not. That gap is PY-D26 in
   * `docs/analyzers/LAPTOP-B-STATUS.md`, declared with its numbers rather than fixed here, because the
   * allowlist's own rule is that a key belongs there once a READER consumes it and no store-level
   * reader consumes this one yet.
   *
   * The TARGET is read through the shared walkers (`addPatternTargets` / `asBindingTarget`), so
   * `for k, v in …` binds two names and this reader cannot disagree with `collectFunctionLocals`
   * about what a target is. The WALK follows the scope rule that method states: descend compound
   * statements, never enter a function body (its binders are PY-D14's locals — not symbols), and
   * never enter a lambda or a comprehension (their targets bind their own scope). It is an
   * explicit-stack preorder for the reason the dart lane recorded: a recursive walk dies on deep
   * nesting after the corpus walk has already been paid for.
   */
  private publishScopeBinderBindings(rootNode: Node, ctx: PythonContext): void {
    type Pending = { name: string; node: Node; boundBy: string; className: string | null }
    const pending: Pending[] = []
    // WHICH IMPORT STATEMENTS ARE ABOUT THE MODULE NAMESPACE (round 15, PY-D31's narrowing). The
    // publication guard below reads the file-wide import channel, so a name a FUNCTION-LOCAL import
    // happens to bind blocked a module-scope publication — the guard's own sentence says "a
    // module-scope declaration (or an import-bound name)", and a local import is neither. The walk
    // already knows the answer: it never enters a function body (it `continue`s on one, below) and it
    // sets `currentClass` inside a class body, so any import statement popped HERE with no class open
    // is a module-scope import by construction. PRICED BEFORE THE CHANGE with CPython over the corpus
    // (`.tmp-py/price-guard-narrowing.py`, `guard-narrowing-price.json`): the guard drops exactly 2
    // candidates corpus-wide (`build_ext`, `codecs`), both PROVISIONS and both dropped by a
    // function-local import, while the BINDER half loses ZERO rows — so the narrowing publishes 2
    // symbols and moves no round-12 number, which is what the previous round could not say.
    const moduleScopeImportLines = new Set<number>()
    const stack: Array<{ node: Node; isExit?: boolean; setClass?: string | null }> = [{ node: rootNode }]
    let currentClass: string | null = null
    while (stack.length > 0) {
      const frame = stack.pop()!
      const n = frame.node
      if (frame.isExit) {
        currentClass = frame.setClass ?? null
        continue
      }
      // PY-D28 (round 14) — a MODULE-level `def __getattr__(name)` (PEP 562) PROVIDES names, and
      // the provision is written in the file: `if name == "X": return …` / `if name in (…)`. The
      // walk must read it BEFORE the function-body skip below, and it does not descend into the
      // body for anything else: a module `__getattr__`'s own locals are PY-D14's business.
      if (n.type === "function_definition" && currentClass === null) {
        this.collectModuleGetattrProvisions(n, pending)
      }
      // A function body is another scope (PY-D14 reads its binders); a lambda and a comprehension
      // are scopes of their own. None of their bindings is a module or class attribute.
      if (
        n.type === "function_definition" || n.type === "lambda" ||
        n.type === "list_comprehension" || n.type === "set_comprehension" ||
        n.type === "dictionary_comprehension" || n.type === "generator_expression"
      ) continue
      if (n.type === "class_definition") {
        const nm = this.findChildByType(n, "identifier")
        stack.push({ node: n, isExit: true, setClass: currentClass })
        currentClass = nm && nm.text ? nm.text : null
      } else {
        switch (n.type) {
          case "for_statement": {
            const left = n.childForFieldName("left") ?? n.namedChild(0)
            this.collectBinderNames(left, "for", currentClass, pending)
            break
          }
          case "with_item": {
            this.collectBinderNames(this.asBindingTarget(n), "with", currentClass, pending)
            break
          }
          case "except_clause": {
            this.collectBinderNames(this.asBindingTarget(n), "except", currentClass, pending)
            break
          }
          case "import_statement":
          case "import_from_statement": {
            const importLine = this.nodeLine(n)
            if (currentClass === null && typeof importLine === "number") moduleScopeImportLines.add(importLine)
            break
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push({ node: c })
      }
    }
    if (pending.length === 0) return

    // Dedupe against everything the file already declared, in the SCOPE the binding belongs to:
    // a module-scope binder must not shadow a module-scope declaration (or an import-bound name),
    // and a class-scope one must not duplicate a member of that class.
    const ownerless = new Set<string>()
    const byOwner = new Map<string, Set<string>>()
    for (const s of ctx.symbols) {
      if (!s.name) continue
      if (s.ownerName) {
        const set = byOwner.get(s.ownerName) ?? new Set<string>()
        set.add(s.name)
        byOwner.set(s.ownerName, set)
      } else {
        ownerless.add(s.name)
      }
    }
    // MODULE-SCOPE IMPORTS ONLY, and every shape the two import handlers build is read exactly as
    // they write it: `import a.b` contributes the ROOT (`a`), `import a.b as c` contributes BOTH `c`
    // and `a`, and `from m import a, b` contributes the ITEM names — never a bound alias, because the
    // `as` name rides the item's relationship metadata and not the ImportInfo the channel is built
    // from. That asymmetry is measured rather than assumed: `from os import sep as X` puts `sep` in
    // the channel and not `X`, which is why round 14 had to pin both spellings in the fixture. An
    // import row with no line (never observed in this lane, both handlers set `range`) is kept — a
    // missing position must not silently WIDEN the publication, so it is treated as module scope.
    const imported = new Set<string>()
    for (const im of ctx.imports) {
      const r = im.range as any
      const line: number | null = typeof r?.startLine === "number" ? r.startLine
        : typeof r?.start?.line === "number" ? r.start.line : null
      if (line !== null && !moduleScopeImportLines.has(line)) continue
      if (im.alias) imported.add(im.alias)
      if (im.module && im.isNamespaceImport) imported.add(im.module.split(".")[0]!)
      if (!(im.items ?? []).includes("*")) {
        for (const it of im.items ?? []) if (it !== "*") imported.add(it)
      }
    }
    // PER SITE, NOT PER NAME, FOR THE CLASS HALF — and per NAME for the module half, with the
    // reason for the difference measured rather than assumed (round 13).
    //
    // A class member is addressed by name AND LINE: that is what makes `contains` (and a member
    // read) resolve against the right span, and it is why every other class-member path publishes
    // PER SITE — `Y = 1` twice in a class body publishes two Properties. Round 12's binder walk
    // deduped on `(scope, name)`, so two `for method in (…):` loops in one class body published ONE
    // member, at the first target's line. The differential is what exposed it: the truth oracle
    // derives members from the source per site, and reported `AnsibleUnwantedChecker -> method @L157`
    // as MISSING while the analyzer had published it at L141.
    //
    // PRICED before the fix (CPython over the verdict's population): exactly ONE class-scope binder
    // name in the corpus has more than one site (`ansible/test/.../pylint/plugins/unwanted.py`,
    // `AnsibleUnwantedChecker.method`, L141 and L157), and ZERO binder names are also declared in the
    // same class by an assignment, a method or an import — so the `already a member` guard below is
    // inert today, the fix adds exactly ONE symbol and ONE `contains` edge, and no member is
    // duplicated against the assignment path.
    //
    // The MODULE half stays per NAME, and that is a measured deferral rather than an oversight: a
    // module Variable has no owner and therefore no containment edge, so nothing in the differential,
    // the store's member channel or this lane's gates disagrees with it; and making it per site would
    // add 90 symbols across the 58 names that hold more than one module-scope site — MEASURED this
    // round by `.tmp-py/price-class-binder-sites.py` (11,245 files parsed, name-and-file-keyed; the
    // round-12 estimate of ~100 symbols for 70 names was target-and-kind-keyed, so the two counts
    // differ in metric rather than in corpus) — whose effect on the RESOLVED/AMBIGUOUS split is not
    // yet measured. Recorded with its price so the next round inherits a number instead of a
    // surprise.
    const seenModuleNames = new Set<string>()
    for (const p of pending) {
      if (p.className === null) {
        if (seenModuleNames.has(p.name)) continue
        seenModuleNames.add(p.name)
      }
      if (p.className) {
        if (byOwner.get(p.className)?.has(p.name)) continue
      } else if (ownerless.has(p.name) || imported.has(p.name)) continue
      ctx.symbols.push({
        name: p.name,
        kind: p.className ? ASTEngine.SymbolKind.Property : ASTEngine.SymbolKind.Variable,
        range: this.nodeToRange(p.node),
        ...(p.className
          ? { ownerName: p.className, ownerKind: ASTEngine.SymbolKind.Class }
          : {}),
        visibility: this.pythonVisibility(p.name),
        metadata: {
          pythonSpecific: true,
          ...(p.className ? { isClassVariable: true } : { isModuleVariable: true }),
          // WHICH statement binds it — the module/class counterpart of `boundByGlobalWrite`.
          boundByBinder: p.boundBy,
        },
      })
    }
  }

  /**
   * PY-D28 (round 14) — the names a MODULE-level `__getattr__` PROVIDES, from the file's own text.
   *
   * THE DEFECT THIS CLOSES, measured before the code existed. The verdict's last 7 unexplained rows
   * were all `exports`; TWO of them are `tree_sitter_clean/__init__.py -> HIGHLIGHTS_QUERY` and
   * `-> TAGS_QUERY`, and that file states the provision in its own source: a module-level
   * `def __getattr__(name)` with `if name == "HIGHLIGHTS_QUERY": return _get_query(…)` and the same
   * for `TAGS_QUERY` (both also listed in `__all__`). `hasattr(module, name)` is TRUE for those
   * names at runtime; the analyzer published no declaration, so the module's own export edge could
   * not resolve against its own file.
   *
   * PRICED with CPython's own `ast` over the corpus, TWICE, and the second pass is what the numbers
   * below come from. The first pass (`.tmp-py/price-module-getattr-exports.py`, whose job was
   * classifying the 7 verdict rows) hardcoded the parameter NAME to the word `name` and accepted only
   * the shape it happened to read by hand; the second (`.tmp-py/price-module-getattr-round14.py`,
   * `module-getattr-round14-price.json`) measures THIS rule's shape and is the authority:
   *
   *   - **26 files** define a MODULE-level `__getattr__` (11,245 parsed, 55 CPython rejects);
   *     **6** of them spell any name as a literal, and **20** spell none (they forward to
   *     `globals()`, build a dict, import dynamically) — a measured limit of the rule, not an
   *     accident: this rule reads a provision the file SPELLS.
   *   - those 6 files hold **14 literal names** (7 `== "LITERAL"` comparisons + 3 collection
   *     comparisons: 3 tuples were read by the first pass, and `_text.py`'s
   *     `in {"to_bytes", "to_native", "to_text"}` is a SET, which the first version of this method
   *     refused — 3 names it published nothing for);
   *   - of the 14, **1 is already statically bound in its own file** (cython's `gs`, published at L706)
   *     and 2 more were in the file's import channel — `_text.py`'s `codecs` (the local `import codecs`
   *     written INSIDE the branch that provides it) and `Build/__init__.py`'s `build_ext`. ROUND 15
   *     NARROWED that guard to module-scope imports, which is the rule's own sentence, so those 2 are
   *     published as well and the count is **13 of the 14**;
   *   - **2** of the 14 are the verdict's `__all__` rows (`HIGHLIGHTS_QUERY`, `TAGS_QUERY`).
   *
   * VERIFIED on the shipped analyzer, not asserted: `.tmp-py/census-getattr-provisions.mts` walks
   * EXACTLY the 6 files the price names and prints **13 published, 0 unexplained misses**, with the
   * only drop the one statically-bound name.
   *
   * WHAT IS READ, exactly: the comparison's left side must be the function's OWN parameter name (not
   * the literal word `name` — 18 of the 26 files name their parameter something else, `_text.py`
   * writes `importable_name`, and the first pass would have missed every literal in one of those),
   * the operator must be `==` or `in`, and the right side must be a string literal or a tuple/list/
   * SET of them. The parameter is read through the grammar's wrappers (`typed_parameter`,
   * `default_parameter`, `typed_default_parameter`): 6 of the 26 files annotate their first parameter
   * (`def __getattr__(name: str)`), and the first version of this method refused that spelling
   * outright — which is how the probe, and not the price, is what settled the annotated case. A
   * comparison whose enclosing `if` conSEQUENTLY raises `AttributeError` is the INVERTED shape
   * (`if name in (…): raise`) — it states what is NOT provided, so it is skipped. MEASURED over the
   * 26 files: **0** such rows exist today; the guard is here so a future one cannot publish its own
   * deny-list as declarations. (The first version of the price's detector reported 3 — it counted the
   * `else: raise` arm of the ordinary provide-or-die guard, which also hid `EvaluatorCompiler` from
   * its own tally. The fix in that detector is why the two passes disagree on that name.)
   *
   * The position is the STRING LITERAL's own line, because that is where the file writes the name.
   * `metadata.boundByBinder` carries `"getattr"`, the same key the binder walk uses, with a value
   * naming this mechanism — no new metadata key is introduced, so the worker seam's key count (and
   * PY-D26's 17-published / 1-carried measurement) is unchanged by this round.
   */
  private collectModuleGetattrProvisions(
    fn: Node,
    into: Array<{ name: string; node: Node; boundBy: string; className: string | null }>,
  ): void {
    const nameNode = fn.childForFieldName("name")
    if (!nameNode || nameNode.text !== "__getattr__") return
    const params = fn.childForFieldName("parameters")
    const raw = params && params.namedChildCount > 0 ? params.namedChild(0) : null
    // THE PARAMETER'S NAME, THROUGH THE GRAMMAR'S WRAPPERS. `def __getattr__(name)`, `def
    // __getattr__(name: str)` and `def __getattr__(name: str = "")` all NAME their parameter; only
    // the node type differs (`identifier`, `typed_parameter`, `typed_default_parameter`), and the
    // name is the wrapper's first named child. The refuse-on-wrapper version of this line published
    // SIX fewer provisions than the price said — 2 of the 5 priced files annotate their parameter
    // (`ansible/.../common/json.py` names 5, `sqlalchemy/orm/evaluator.py` names 1) — and the probe
    // (`.tmp-py/debug-getattr-shapes.mts`) is what showed the refusal was about the grammar rather
    // than about the source. A splat (`*args`) and a name-less parameter are still refused: they
    // state no name to compare against, and this rule reads a name the file SPELLS.
    const param =
      raw && (raw.type === "typed_parameter" || raw.type === "default_parameter" || raw.type === "typed_default_parameter")
        ? (raw.childForFieldName("name") ?? raw.namedChild(0))
        : raw
    if (!param || param.type !== "identifier") return
    const paramName = param.text
    const body = fn.childForFieldName("body")
    if (!body) return

    const unquote = (text: string): string | null => {
      const m = /^[A-Za-z]*(["'])([\s\S]*)\1$/.exec(text)
      if (!m) return null
      const value = m[2] ?? ""
      // A name is a python identifier or it is not a name this rule can publish.
      return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : null
    }

    const stack: Node[] = [body]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "comparison_operator" && n.childCount >= 3) {
        const left = n.child(0)
        const op = n.child(1)
        const right = n.child(2)
        if (left && op && right && left.type === "identifier" && left.text === paramName &&
            (op.type === "==" || op.type === "in")) {
          // The INVERTED guard: an `if` whose own branch raises AttributeError names what the
          // module does NOT provide. Skip it rather than publish a deny-list.
          let inverted = false
          let up: Node | null = n.parent
          while (up && up.id !== body.id) {
            if (up.type === "if_statement") {
              const cons = up.childForFieldName("consequence")
              if (cons && cons.text.includes("raise") && cons.text.includes("AttributeError")) inverted = true
              break
            }
            up = up.parent
          }
          if (!inverted) {
            // tuple, list AND set: `if name in {"to_bytes", "to_native", "to_text"}` is the
            // spelling `ansible/module_utils/_text.py` writes (measured — the first version of this
            // rule accepted only tuple/list and published 3 fewer names than the price said, all in
            // that one `elif`). All three are a literal collection of names; a `dict` is not, and
            // `right.type === "string"` below is the single-literal spelling.
            const lower =
              right.type === "tuple" || right.type === "list" || right.type === "set" ? right : null
            const cands: Node[] = []
            if (lower) {
              for (let i = 0; i < lower.namedChildCount; i++) {
                const el = lower.namedChild(i)
                if (el && el.type === "string") cands.push(el)
              }
            } else if (right.type === "string") {
              cands.push(right)
            }
            for (const c of cands) {
              const nm = unquote(c.text)
              if (nm) into.push({ name: nm, node: c, boundBy: "getattr", className: null })
            }
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  /** The names a binder statement's target writes, through the shared target walker. */
  private collectBinderNames(
    target: Node | null | undefined,
    boundBy: string,
    className: string | null,
    into: Array<{ name: string; node: Node; boundBy: string; className: string | null }>,
  ): void {
    if (!target) return
    const names = new Set<string>()
    this.addPatternTargets(target, names)
    for (const nm of names) into.push({ name: nm, node: target, boundBy, className })
  }

  /**
   * PY-D14 — every function's OWN local bindings, keyed on the function NODE.
   *
   * Keyed on the node rather than on the name for the reason `currentClassKey` is: two `def f` in
   * one file are two different scopes, and a name-keyed map would let one answer for the other.
   *
   * WHAT IS COLLECTED: parameters, nested `def`/`class` NAMES, and assignment / for-target / `with
   * as` / `except as` / walrus TARGET names. WHAT IS NOT, and why each exclusion matters:
   * a nested function's or class's BODY (its bindings belong to IT, so the walk stops at the
   * declaration and records only the name); a comprehension's or lambda's targets (their own scope);
   * an `attribute` / `subscript` target (it binds a member or an element, not a bare name); a
   * parameter's DEFAULT VALUE or ANNOTATION expression (only the parameter's own `name` field is
   * read, so `def f(x=RETRY_LIMIT)` does not make `RETRY_LIMIT` a local); and a name a `global` /
   * `nonlocal` statement declares (a write to it targets another scope, so it is subtracted).
   */
  private collectFunctionLocals(rootNode: Node): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>()
    // Descend a binding TARGET through the shared pattern walker. `identifier` binds; a member or
    // an index does not bind a bare name, and an expression is not a target — so neither is
    // guessed at. One walker, so every reader of a target agrees on what a target is.
    const addTargets = (target: Node | null | undefined, into: Set<string>): void =>
      this.addPatternTargets(target, into)
    // A parameter binds its NAME only — the reader is `addParameterNames` (extracted in round 11 so
    // PY-D22's scope check reads the same shapes).
    const functions: Node[] = []
    const queue: Node[] = [rootNode]
    while (queue.length > 0) {
      const n = queue.pop()!
      if (n.type === "function_definition") functions.push(n)
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) queue.push(c)
      }
    }
    for (const fn of functions) {
      const names = new Set<string>()
      const rebinds = new Set<string>()
      const stack: Node[] = []
      for (let i = 0; i < fn.namedChildCount; i++) {
        const c = fn.namedChild(i)
        if (!c) continue
        if (c.type === "parameters") {
          this.addParameterNames(c, names)
          continue
        }
        stack.push(c)
      }
      while (stack.length > 0) {
        const n = stack.pop()!
        const t = n.type
        if (t === "function_definition" || t === "class_definition") {
          const nm = this.findChildByType(n, "identifier")
          if (nm?.text) names.add(nm.text)
          continue // its BODY is its own scope; only its name binds here
        }
        if (t === "lambda" || t === "list_comprehension" || t === "set_comprehension" ||
            t === "dictionary_comprehension" || t === "generator_expression") continue
        switch (t) {
          case "assignment":
          case "augmented_assignment":
            addTargets(n.childForFieldName("left") ?? n.namedChild(0), names)
            break
          case "for_statement":
            addTargets(n.childForFieldName("left") ?? n.namedChild(0), names)
            break
          case "named_expression":
            addTargets(n.childForFieldName("name") ?? n.namedChild(0), names)
            break
          case "with_item":
          case "except_clause":
            // ROUND 10: the alias of BOTH is inside an `as_pattern` (`value -> as_pattern ->
            // as_pattern_target`), and the fields these two cases used to read — `alias` for
            // `with_item`, `name` for `except_clause` — are null on every real node. Both cases
            // were dead code documented as working; see `asBindingTarget` for the probe.
            addTargets(this.asBindingTarget(n), names)
            break
          case "global_statement":
          case "nonlocal_statement":
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c?.type === "identifier") rebinds.add(c.text)
            }
            break
          default:
            break
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) stack.push(c)
        }
      }
      for (const r of rebinds) names.delete(r)
      out.set(this.functionLocalsKey(fn), names)
    }
    return out
  }

  private pushRel(
    ctx: PythonContext,
    source: string,
    target: string,
    type: ASTEngine.RelationshipType,
    confidence: number,
    metadata: Record<string, any>,
    line?: number,
  ) {
    if (!source || !target) return
    // PY-6. The dedup key was (type, source, target) with NO LINE, which is STRICTLY
    // COARSER than the store's own relationship key. The store's primary key is
    // (source, type, target, line) — the M59 #822 rule — so a `contains` edge to each
    // of two same-named members is a DISTINCT row the store is willing to keep, and the
    // analyzer was discarding one of them before it ever got there.
    //
    // Python makes this common rather than exotic, and the shape is a getter/setter
    // pair, which is idiomatic Python:
    //
    //     @property
    //     def collection_finder(cls): ...
    //     @collection_finder.setter
    //     def collection_finder(cls, value): ...
    //
    // Both `def`s are real declarations, both published as symbols (measured:
    // L50 and L54 in ansible's `_collection_config.py`), and ONE `contains` edge was
    // emitted — the second member was unreachable from its class in the graph, so
    // bb_graph's callers and bb_impact could not reach the setter. Same class of defect
    // as markdown's MD-2, and it is the same fix markdown's analyzer already carries:
    // the site's LINE is part of a relationship's identity, not a decoration on it.
    //
    // The line is included only when there is one. A relationship with no line keeps
    // the coarse key, because there is nothing finer to distinguish it by and
    // inventing a 0 would be a fabricated position.
    const key = `${type}\u001f${source}\u001f${target}\u001f${line ?? ""}`
    if (ctx.seenRels.has(key)) return
    ctx.seenRels.add(key)
    ctx.relationships.push({
      source,
      target,
      fromSymbol: source,
      toSymbol: target,
      type,
      relationshipType: type,
      confidence,
      // M59.A7 (#825): the call-site line is the node that NAMES the edge.
      // Absent when there is no node to ask (never a fabricated 0).
      ...(typeof line === "number" ? { line_number: line } : {}),
      metadata,
    })
  }

  /**
   * M59.A7 (#825): the 1-based line of the node that NAMES an edge. Callers
   * pass the node the edge's target is written as — never the construct that
   * contains it. A decorated definition's name is on its `def`/`class` line,
   * an import item's on its own item line, a call's on its callee leaf, a
   * member read's on the read leaf. Returns undefined when there is no node to
   * ask; a missing line is honest, a fabricated 0 is not.
   */
  private nodeLine(node: Node | null | undefined): number | undefined {
    if (!node) return undefined
    return node.startPosition.row + 1
  }

  /** The node that names a call's callee — callLeafName's node twin (same shapes). */
  private callLeafNode(node: Node | null | undefined): Node | null {
    if (!node) return null
    if (node.type === "identifier") return node
    if (node.type === "attribute") {
      return node.namedChild(node.namedChildCount - 1) ?? null
    }
    if (node.type === "parenthesized_expression") {
      return this.callLeafNode(node.namedChild(0))
    }
    // Anything else names nothing, so there is no node to attribute the edge to.
    // A missing line is honest; a line taken from a branch the call does not
    // necessarily take is not (which is why this follows callLeafName exactly).
    return null
  }

  /**
   * The name a base-list entry carries — and NOTHING when it carries none.
   *
   * The same list of static-name shapes as callLeafName, one position over (this
   * is #902's sibling, found by the differential the moment the call walk stopped
   * lying — the python lane's next UNEXPLAINED edge):
   *   identifier   `Base`            → Base
   *   subscript    `Base[T]`         → Base   (the generic HEAD, not its arguments)
   *   attribute    `mod.Base`        → Base   (the leaf, PYD1)
   * and every other shape names NOTHING. The one that matters is a CALL base:
   *   call         `class T(namedtuple('Tbase', 'a')):`
   * inherits from the class that call RETURNS — an anonymous type — so naming
   * `namedtuple` was a category error (a function is not a class, and T does not
   * inherit from it). The differential's oracle names only the three shapes above,
   * so naming the factory was the single edge it could not explain (measured on
   * cython:python: `extends T -> namedtuple`, Tools/dataclass_test_data/
   * test_dataclasses.py:1637). MEASURED on the two pinned corpora (cython +
   * requests, 513 files, 1937 base-list entries), the shapes are identifier 1762,
   * attribute 130, keyword_argument 24 (skipped before this call, PYD6), subscript
   * 20, call 1 — so this list removes exactly ONE fabricated edge corpus-wide and
   * changes nothing else.
   * The previous body's last resort was `namedChild(0)` for any unlisted shape,
   * which is how the call case silently named its callee; the fallback was the
   * defect, exactly as it was in callLeafName.
   */
  private baseClassLeaf(node: Node | null | undefined): string | undefined {
    if (!node) return undefined
    if (node.type === "identifier") return node.text
    if (node.type === "subscript") {
      const first = node.namedChild(0)
      return first ? this.baseClassLeaf(first) : undefined
    }
    if (node.type === "attribute") {
      const last = node.namedChild(node.namedChildCount - 1)
      return last ? last.text : undefined
    }
    return undefined
  }

  /**
   * The name a call's callee carries — and NOTHING when it carries none.
   *
   * The rule is a list of shapes that name their callee statically:
   *   identifier            `f(...)`            → f
   *   attribute             `o.m(...)`          → m (the leaf, PYD1)
   *   parenthesized         `(f)(...)`          → unwrap, judge the inside
   * and every other shape names NOTHING:
   *   subscript             `FACTORIES[k](x)`   (PYD1: the callee is the dict's
   *                                               value, not the dict)
   *   conditional           `(f if c else g)()` — the callee is whichever branch
   *                                               the condition selects; naming the
   *                                               `if` branch was a fabrication and
   *                                               the differential's oracle refuses
   *                                               it, giving one UNEXPLAINED edge on
   *                                               cython:python (#902)
   *   lambda                `(lambda: f)()`     — the callee is the lambda; `f` is
   *                                               its BODY, so naming it fabricated a
   *                                               call that the source never writes
   *   call                  `f()()`             — the callee is the RESULT of `f()`;
   *                                               the inner call emits `calls f` on
   *                                               its own node, so descending here
   *                                               duplicated a true edge onto a false
   *                                               one (same target, wrong site)
   *   string                `"f"(...)`
   * The previous body fell through to `namedChild(0)` for anything unlisted, which
   * silently turned ALL FOUR of the above into a name — the fallback was the defect.
   * Grouping is the one wrapper that is genuinely transparent, so it unwraps.
   */
  /**
   * The name a call may NAME — an ALLOWLIST, and that is the whole design (M60 #902).
   *
   * `identifier` and `attribute` name their callee, `parenthesized_expression` unwraps because
   * grouping is genuinely transparent, and **every other shape names NOTHING**: conditional,
   * lambda, call, subscript, string.
   *
   * I added a `conditional_expression` case here on the reasoning that a conditional picks its
   * callee at runtime so both branches are real targets — and `python/callee-shapes` failed on
   * the next run, because that fixture already adjudicated the question against me and cited
   * the decision. `(f if flag else g)()` publishing `calls -> f` names a call site that exists
   * only when the condition is true, which is a fabricated call site otherwise, and a graph
   * that cannot express the condition should decline the edge rather than assert half of it.
   *
   * The allowlist is also a better rule than my reasoning on its own terms: it says which SHAPES
   * may name a callee, which is answerable from the grammar, rather than which candidates a
   * branch happens to contain, which is a data-flow question this lane does not do.
   */
  private callLeafNames(node: Node | null | undefined): Array<{ name: string; node: Node }> {
    if (!node) return []
    if (node.type === "identifier") return [{ name: node.text, node }]
    if (node.type === "attribute") {
      const last = node.namedChild(node.namedChildCount - 1)
      return last ? [{ name: last.text, node: last }] : []
    }
    if (node.type === "parenthesized_expression") return this.callLeafNames(node.namedChild(0))
    return []
  }

  private callLeafName(node: Node): string | undefined {
    return this.callLeafNames(node)[0]?.name
  }

  private extractDecorators(node: Node, ctx: PythonContext, ownerName: string): string[] {
    const out: string[] = []
    const parent = node.parent
    if (parent && parent.type === "decorated_definition") {
      for (let i = 0; i < parent.namedChildCount; i++) {
        const c = parent.namedChild(i)
        if (c && c.type === "decorator") {
          const name = this.decoratorName(c)
          if (name) {
            out.push(name)
            if (name === "dataclass") ctx.patterns["Dataclasses"] = true
            if (name === "staticmethod" || name === "classmethod") ctx.patterns["Static/Class Methods"] = true
            if (name === "property") ctx.patterns["Properties (Getters/Setters)"] = true
          }
        }
      }
    }
    return out
  }

  private decoratorName(decorator: Node): string | undefined {
    // decorator: "@" + (call | identifier | attribute | subscript)
    const inner = decorator.namedChild(0)
    if (!inner) return undefined
    if (inner.type === "call") {
      const fn = inner.namedChild(0)
      return fn ? this.callLeafName(fn) : undefined
    }
    if (inner.type === "identifier") return inner.text
    if (inner.type === "attribute") {
      const last = inner.namedChild(inner.namedChildCount - 1)
      return last ? last.text : undefined
    }
    return inner.text.split(".")[0].split("(")[0]
  }

  private isAsyncFunction(node: Node): boolean {
    // This grammar emits `function_definition` for async defs too — an
    // anonymous `async` token is the first child.
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "async") return true
    }
    return false
  }

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) return child
    }
    return null
  }

  private extractParameters(node: Node): ASTEngine.Parameter[] {
    const paramsList = this.findChildByType(node, "parameters")
    if (!paramsList) return []
    const params: ASTEngine.Parameter[] = []
    for (let i = 0; i < paramsList.namedChildCount; i++) {
      const p = paramsList.namedChild(i)
      if (!p) continue
      if (p.type === "identifier") {
        params.push({ name: p.text })
      } else if (p.type === "list_splat_pattern") {
        const inner = this.findChildByType(p, "identifier")
        if (inner) params.push({ name: `*${inner.text}`, isVariadic: true })
      } else if (p.type === "dictionary_splat_pattern") {
        const inner = this.findChildByType(p, "identifier")
        if (inner) params.push({ name: `**${inner.text}`, isVariadic: true })
      } else if (p.type === "typed_parameter") {
        const nameNode = this.findChildByType(p, "identifier")
        const typeNode = this.findChildByType(p, "type")
        if (nameNode) params.push({ name: nameNode.text, type: typeNode ? typeNode.text : undefined })
      } else if (p.type === "default_parameter" || p.type === "typed_default_parameter") {
        const nameNode = this.findChildByType(p, "identifier")
        const typeNode = this.findChildByType(p, "type")
        if (nameNode) params.push({ name: nameNode.text, type: typeNode ? typeNode.text : undefined, isOptional: true })
      }
    }
    return params
  }

  private extractReturnType(node: Node): string | undefined {
    const typeNode = this.findChildByType(node, "type")
    return typeNode ? typeNode.text : undefined
  }

  private extractDocstring(node: Node): string | undefined {
    const body = this.findChildByType(node, "block")
    if (body && body.namedChildCount > 0) {
      const firstStmt = body.namedChild(0)
      if (firstStmt && firstStmt.type === "expression_statement") {
        const strNode = firstStmt.namedChild(0)
        if (strNode && strNode.type === "string") {
          return this.unquote(strNode)
        }
      }
    }
    return undefined
  }

  // Regex-free string literal unquoting: prefers the grammar's
  // string_content child; falls back to a first/last-char scan.
  private unquote(node: Node): string {
    const content = this.findChildByType(node, "string_content")
    if (content) return content.text
    const text = node.text.trim()
    if (text.length >= 6) {
      const triple = text.slice(0, 3)
      if ((triple === '"""' || triple === "'''") && text.endsWith(triple)) {
        return text.slice(3, -3).trim()
      }
    }
    if (text.length >= 2) {
      const first = text[0]
      if ((first === '"' || first === "'") && text[text.length - 1] === first) {
        return text.slice(1, -1)
      }
    }
    return text
  }

  private pythonVisibility(name: string): string {
    if (name.startsWith("__") && !name.endsWith("__")) return "private"
    if (name.startsWith("_")) return "protected"
    return "public"
  }

  /**
   * PYD1 — per-symbol cyclomatic complexity (family contract: csharp #264,
   * ruby RUBD6, js/ts methodComplexity). Python decision points: if/elif,
   * for/while, match/case, try/except, with, conditional_expression, and the
   * `and`/`or` boolean_operator nodes. The walker's global counter counts the
   * whole FILE; this per-node walk scopes the count to one function body.
   * Nested defs are skipped — their branches belong to the nested symbol.
   */
  private methodComplexity(node: Node): number {
    let c = 1
    const stack: Node[] = [node]
    while (stack.length) {
      const n = stack.pop()!
      if (
        n.type === "if_statement" || n.type === "elif_clause" ||
        n.type === "for_statement" || n.type === "while_statement" ||
        n.type === "match_statement" || n.type === "case_clause" ||
        n.type === "try_statement" || n.type === "except_clause" ||
        n.type === "with_statement" || n.type === "conditional_expression"
      ) {
        c++
      } else if (n.type === "boolean_operator") {
        for (let i = 0; i < n.childCount; i++) {
          const ch = n.child(i)
          if (ch && (ch.type === "and" || ch.type === "or")) { c++; break }
        }
      }
      // Nested function/class bodies are separate symbols — do not count
      // their decision points into this one.
      if (n !== node && (n.type === "function_definition" || n.type === "class_definition")) continue
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return c
  }

  /**
   * PYD1 — evidence tiers (csharp #419-D family contract). Every edge leaves
   * this analyzer with an evidenceClass: contains/exports structural,
   * imports import_based, references reference_qualified, extends/overrides
   * structural, calls/uses/instantiates usage_contextual. Metadata already
   * set at emission sites is never overwritten.
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? r.relationshipType ?? "")
      if (t === "overrides") {
        // M37.10 family contract: verified overrides are structural; a
        // Pass-3 first-parent guess is only "inferred" (the external base
        // may not even declare the method).
        md.evidenceClass = (r.confidence ?? 0) >= 0.9 ? "structural" : "inferred"
        continue
      }
      if (t === "contains" || t === "exports" || t === "extends") {
        md.evidenceClass = "structural"
        continue
      }
      if (t === "implements") {
        // `implements` gets the same tier as `extends` when it is written in the HEADER —
        // `class Repository(ABC)` is a declaration this parse read, at confidence 1.0, and
        // `python/interface-implements` pins `evidenceClass: structural` on it.
        //
        // NOT for every row of the type, though. The `.register()` form is read from a CALL
        // SITE (`collections.abc.Sequence.register(Row)`), which is a use of the interface
        // rather than a declaration in a header, and it is 0.9 because the argument is a
        // leaf name the analyzer may not have read. Calling that `structural` would put a
        // usage-derived claim in the tier reserved for what the source says outright, so it
        // keeps the default. The split is on the SAME boundary the reason codes draw
        // (`interface-base-proven`-family vs `virtual-registration`), so the two fields
        // cannot drift into disagreeing about which rows are declarations.
        md.evidenceClass = (r.confidence ?? 0) >= 0.95 ? "structural" : "usage_contextual"
        continue
      }
      if (t === "imports") { md.evidenceClass = "import_based"; continue }
      if (t === "references") {
        md.evidenceClass = md.isImport ? "import_based" : "reference_qualified"
        continue
      }
      md.evidenceClass = "usage_contextual"
    }
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    // M59.A7 (#825): a decorated definition ranges at its OWN `def`/`class`
    // line — the line its NAME is written on — never the decorator's. The old
    // form preferred the `decorated_definition` parent, whose start is the `@`
    // line, so `@paramatize("x", [1])` on 23 made `decorated` claim 23 while
    // its name is written on 24 (the requests 30-row class the line fixture
    // pins). Only the start moves: a decorated_definition ENDS where its
    // declaration ends, so endLine/endIndex are unchanged.
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
