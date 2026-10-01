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

interface PythonScope {
  node: Node
  name: string
  kind: ASTEngine.SymbolKind
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
  seenRels: Set<string>
  // (class\u001fattr) — one Property per instance attribute per class (PYD1)
  instanceAttrs: Set<string>
  currentModule: string | undefined
  currentClass: string | undefined
  currentFunction: string | undefined
  moduleName: string
}

// Python builtins — never legitimate in-file call targets.
// Exported: the differential oracle imports this EXACT set (never a
// hand-duplicated copy — a drift would fabricate or hide call edges).
export const PYTHON_BUILTINS = new Set([
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

const DENYLISTED_SYMBOL_NAMES = new Set([
  "self", "cls", "this", "super", "None", "True", "False",
])

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
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
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
      seenRels: new Set(),
      instanceAttrs: new Set(),
      currentModule: moduleName,
      currentClass: undefined,
      currentFunction: undefined,
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
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) preScan(c)
      }
    }
    preScan(rootNode)

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
    }[] = [{ node: rootNode }]

    while (stack.length > 0) {
      const { node, isExit, setClass, setFunc } = stack.pop()!

      if (isExit) {
        ctx.currentClass = setClass
        ctx.currentFunction = setFunc
        continue
      }

      if (node.isMissing) continue

      // The shadowed earlier definition: unreachable by construction (see
      // collectPhantomDefs). Its subtree is not walked, so it contributes no
      // symbol, no outbound edge, and no cyclomatic decision point.
      if (phantomDefs.has(this.phantomKey(node))) continue

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
          if (nameNode && nameNode.text && !DENYLISTED_SYMBOL_NAMES.has(nameNode.text)) {
            this.extractClass(node, ctx)
            const prevClass = ctx.currentClass
            const prevFunc = ctx.currentFunction
            ctx.currentClass = nameNode.text
            ctx.currentFunction = undefined
            stack.push({
              node,
              isExit: true,
              setClass: prevClass,
              setFunc: prevFunc,
            })
          }
          break
        }
        case "function_definition": {
          // NOTE: this grammar emits `function_definition` for async defs too
          // (an anonymous `async` token is child 0) — `async_function_definition`
          // never appears. Async-ness is detected via the token scan below.
          const nameNode = this.findChildByType(node, "identifier")
          if (nameNode && nameNode.text && !DENYLISTED_SYMBOL_NAMES.has(nameNode.text)) {
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
            ctx.currentFunction = nameNode.text
            stack.push({
              node,
              isExit: true,
              setClass: ctx.currentClass,
              setFunc: prevFunc,
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

    // Post-loop: contains for class → member ownership (module-level symbols
    // are ownerless — Python has no module declaration, JS-family contract).
    for (const s of ctx.symbols) {
      const owner = s.ownerName
      if (owner && owner !== s.name) {
        this.pushRel(ctx, owner, s.name, ASTEngine.RelationshipType.Contains, 1.0, {}, s.range?.startLine)
      }
    }

    // Overrides: Derived.method -> Base.method when the base declares the
    // same-name method (in-file or via the cross-file companion index).
    this.extractOverrideRelationships(ctx)

    // PYD1 family contract: member READS emit `uses` (csharp/dart/php/ruby/
    // swift/objc all do — python was the only managedoo analyzer with none).
    // classifyEvidenceTier runs LAST so every edge — including declared-type
    // refs and member uses created above — leaves with an evidenceClass.
    this.extractDeclaredTypeRefs(rootNode, ctx.relationships, phantomDefs, ctx.moduleName)
    this.extractMemberUses(rootNode, ctx, phantomDefs)
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
          this.pushRel(ctx, className, baseLeaf, ASTEngine.RelationshipType.Extends, 1.0, {
            pythonSpecific: true,
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
        isEnum,
        ...(enclosingClass ? { isNestedClass: true } : {}),
      },
    })
    ctx.functionSymbolIndex[`::${className}`] = ctx.symbols.length - 1
    ctx.declaredTypes.add(className)

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
          // Constant-value members. PYD4: `call` is included — `RED =
          // enum.auto()` is the canonical python Enum idiom (functional API:
          // `Color = Enum("Color", ["RED"])` aside, auto() members are in
          // every stdlib enum), and its member NAME is real vocabulary even
          // when the VALUE is a runtime call. Function-valued (`f = some_fn`)
          // is already covered by `identifier`; excluded remain only the
          // multi-target tuple forms.
          if (right && (right.type === "string" || right.type === "integer" ||
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
      const itemNodes: Array<{ name: string; node: Node | null }> = []
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (!c) continue
        if (c.type === "dotted_name" || c.type === "identifier") {
          if (c.text !== moduleName) { items.push(c.text); itemNodes.push({ name: c.text, node: c }) }
        } else if (c.type === "aliased_import") {
          const itemNameNode = c.childForFieldName("name") || c.namedChild(0)
          if (itemNameNode) { items.push(itemNameNode.text); itemNodes.push({ name: itemNameNode.text, node: itemNameNode }) }
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
          this.pushRel(ctx, ctx.moduleName, `${moduleName}:${item.name === "*" ? "*" : item.name}`, ASTEngine.RelationshipType.Imports, 1.0, {
            pythonSpecific: true,
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

  private extractAssignment(node: Node, ctx: PythonContext) {
    const left = node.namedChild(0)
    if (!left) return

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

    if (left.type !== "identifier") return
    const name = left.text

    // __all__ → the explicit export contract.
    if (name === "__all__") {
      // PY-14. Only a `list` was read, so `__all__ = ("a", "b")` published nothing —
      // and the tuple spelling is ordinary older python. Measured over 400 pinned corpus
      // files: 16 `__all__` assignments, 13 lists, **3 tuples that produced no edge at
      // all**, so 19% of the module's declared public surface was invisible for a reason
      // that has nothing to do with the author. A list and a tuple are the same
      // declaration to every tool that reads `__all__`, including `from mod import *`.
      const right = node.childForFieldName("right") ?? node.namedChild(node.namedChildCount - 1)
      if (right && (right.type === "list" || right.type === "tuple")) {
        for (let i = 0; i < right.namedChildCount; i++) {
          const child = right.namedChild(i)
          if (child && child.type === "string") {
            const exportName = this.unquote(child)
            if (exportName) {
              // `form` records WHICH `__all__` spelling declared this name, alongside the
              // same fact on the relationship edge. `list` and `tuple` are one declaration
              // to `from mod import *`, so this is provenance rather than meaning — and it
              // is what lets PY-14's revert be expressed as a shape instead of as a list
              // of fixture strings.
              ctx.exports.push({ name: exportName, type: "list_item", form: right.type })
              this.pushRel(ctx, ctx.moduleName, exportName, ASTEngine.RelationshipType.Exports, 1.0, {
                pythonSpecific: true,
                // WHICH SPELLING declared the export. `list` and `tuple` are the same
                // declaration to `from mod import *`, so the edge is the same either way —
                // but a reader triaging a surface wants to know that a module declares it
                // twice in two forms, and it gives the mutant harness a way to express
                // PY-14's revert generically instead of by naming fixture strings.
                dunderAllForm: right.type,
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
      ctx.symbols.push({
        name,
        kind: ASTEngine.SymbolKind.Property,
        range: this.nodeToRange(left),
        ownerName: ctx.currentClass,
        ownerKind: ASTEngine.SymbolKind.Class,
        // PYD3: underscore-prefix visibility is a PYTHON semantic, not a
        // class-body-only one — `_cache` at class scope is exactly as
        // protected as `_cache` at module scope (both now pythonVisibility()).
        // The old hard-coded "public" made class variables the ONE symbol
        // kind where the convention silently didn't apply.
        visibility: this.pythonVisibility(name),
        metadata: { pythonSpecific: true, isClassVariable: true },
      })
      return
    }

    // Module-level assignment → Variable.
    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Variable,
      range: this.nodeToRange(left),
      visibility: this.pythonVisibility(name),
      metadata: { pythonSpecific: true, isModuleVariable: true },
    })
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
    if (!caller || caller === "module") return

    // Decorator calls (@dataclass(...)) are metadata on the decorated
    // symbol, not runtime call edges.
    let p = node.parent
    while (p) {
      if (p.type === "decorator") return
      if (p.type === "function_definition" || p.type === "class_definition" || p.type === "module") break
      p = p.parent
    }

    const funcChild = node.namedChild(0)
    if (!funcChild) return

    const fullCallee = funcChild.text
    const targetName = this.callLeafName(funcChild)
    // M59.A7 (#825): the edge NAMES the callee leaf (callLeafName's node twin),
    // so the line is the leaf's own — never the receiver the construct starts
    // at (`items` on 17 while `.upper` is written on 19).
    const calleeLeaf = this.callLeafNode(funcChild)
    if (!targetName) return
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
      }, this.nodeLine(calleeLeaf))
      return
    }

    this.pushRel(ctx, caller, targetName, ASTEngine.RelationshipType.Calls, 0.9, {
      pythonSpecific: true,
      qualified: fullCallee,
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
    const walk = (n: Node, inFn: string | undefined, parent: Node | null): void => {
      const t = n.type
      // #748: a shadowed definition's body is never walked — its member reads
      // belong to a body the runtime has already rebound away.
      if (phantoms.has(this.phantomKey(n))) return
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
          const gp = parent.parent
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
            this.pushRel(ctx, inFn, leaf.text, ASTEngine.RelationshipType.Uses, 0.9, {
              pythonSpecific: true, isMemberRead: true,
            }, this.nodeLine(leaf))
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c, nextFn, n)
      }
    }
    walk(rootNode, undefined, null)
  }

  /**
   * M14 — declared-type reference graph. Python type hints: annotated
   * assignments (`x: T`), typed parameters, and return annotations all carry
   * a `type` field node. isinstance(x, T) is the runtime type check. Builtin
   * scalar types (str/int/float/bool/bytes) are excluded from names; unions
   * (T | U), optionals, and generics descend via their children.
   */
  private extractDeclaredTypeRefs(rootNode: Node, relationships: ASTEngine.UniversalRelationship[], phantoms: Set<string>, moduleName: string): void {
    const emitted = new Set<string>()
    const PRIMITIVES = new Set(["str", "int", "float", "complex", "bool", "bytes", "object", "None", "Any", "self", "cls"])

    // M59.A7 (#825): nodes, not just names — the edge's line is where the
    // type NAME is written (a wrapped annotation's own line), so the node must
    // survive the collection.
    const collectTypeNodes = (n: Node, out: Node[]): void => {
      if (n.type === "identifier") {
        if (!PRIMITIVES.has(n.text) && !out.some((x) => x.text === n.text)) out.push(n)
        return
      }
      if (n.type === "none" || n.type === "string" || n.type === "concatenated_string") return
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) collectTypeNodes(c, out)
      }
    }

    const resolveSource = (start: Node): string => {
      // Include the start node itself: a function's return annotation
      // resolves to the function, not its enclosing scope.
      let p: Node | null =
        start.type === "function_definition" || start.type === "class_definition" ? start : start.parent
      while (p) {
        if (p.type === "function_definition" || p.type === "class_definition") {
          for (let i = 0; i < p.namedChildCount; i++) {
            const c = p.namedChild(i)
            if (!c) continue
            if (c.type === "identifier") return c.text
          }
        }
        p = p.parent
      }
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
          relationships.push({
            source,
            target: t,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.95,
            ...(this.nodeLine(tn) ? { line_number: this.nodeLine(tn)! } : {}),
            metadata: { relationshipType: relType },
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
      if (phantoms.has(this.phantomKey(n))) return
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

  private extractOverrideRelationships(ctx: PythonContext) {
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
    const overrideCompanion = (ctx as any)._overrideCompanion as Map<string, Set<string>> | undefined
    const baseDeclares = (base: string, method: string): boolean => {
      const inFile = byName.get(method)?.some((bm) => bm.ownerName === base) ?? false
      if (inFile) return true
      const companion = overrideCompanion?.get(base)
      return !!companion && companion.has(method)
    }
    for (const s of ctx.symbols) {
      if (s.kind === ASTEngine.SymbolKind.Method && s.ownerName) {
        const bases = basesByClass.get(s.ownerName)
        if (!bases || bases.length === 0) continue
        // MRO order: the first base that DECLARES this name owns the override.
        const declaring = bases.find((b) => {
          const inFile = byName.get(s.name)?.some((bm) => bm.ownerName === b) ?? false
          return inFile || !!overrideCompanion?.get(b)?.has(s.name)
        })
        if (declaring) {
          this.pushRel(ctx, `${s.ownerName}.${s.name}`, `${declaring}.${s.name}`, ASTEngine.RelationshipType.Overrides, 0.95, {}, s.range?.startLine)
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
        const firstUnread = bases.find((b) => !declaredClasses.has(b))
        if (firstUnread !== undefined && !overrideCompanion?.has(firstUnread)) {
          this.pushRel(ctx, `${s.ownerName}.${s.name}`, `${firstUnread}.${s.name}`, ASTEngine.RelationshipType.Overrides, 0.5, { reasonCode: "first-parent-guess" }, s.range?.startLine)
        }
      }
    }
  }

  // ========================================================================
  // CORE UTILITIES (regex-free)
  // ========================================================================

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
  private baseClassLeaf(node: Node): string | undefined {
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
  private callLeafName(node: Node): string | undefined {
    if (node.type === "identifier") return node.text
    if (node.type === "attribute") {
      const last = node.namedChild(node.namedChildCount - 1)
      return last ? last.text : undefined
    }
    if (node.type === "parenthesized_expression") {
      const inner = node.namedChild(0)
      return inner ? this.callLeafName(inner) : undefined
    }
    return undefined
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
