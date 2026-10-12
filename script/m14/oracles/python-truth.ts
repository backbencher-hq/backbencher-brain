/**
 * PYTHON TRUTH — an independent derivation, for the differential (PY-1).
 *
 * WHY THIS FILE EXISTS. Python's M12 differential carries `truthSource: "manual_audit"`
 * and `truthReference: fixtures/python/{Service,Negative}.py`: 108 hand-audited facts
 * about two hand-written files. That is a MIRROR. The lane's precision/recall of
 * 1.000/1.000 therefore proves only that the analyzer agrees with a human-written
 * description of the analyzer, and the truth file cannot classify 5 of its own 108
 * rows — a gap nothing in the suite is looking for. This is the same defect the markdown
 * review opened with, and the same instrument closed it: a second implementation that
 * can DISAGREE.
 *
 * THE ONE RULE THAT MATTERS: this file must not share a derivation with the analyzer.
 * Markdown learned that twice — first when the oracle and the analyzer agreed at 100%
 * on a name NEITHER published, and then when 28.7% of the lane's relationships named
 * symbols the file did not declare. A shared helper is not a second opinion; it is one
 * function called twice. So there is no import of `real-python-analyzer` here, no
 * shared constant, and no shared traversal: every edge below is derived from the TREE,
 * by walking it in a way the analyzer does not.
 *
 * SCOPE, STATED RATHER than implied. This derives ALL TEN labels the lane emits —
 * `contains`, `extends`, `implements`, `overrides`, `calls`, `instantiates`, `uses`,
 * `references`, `imports`, `exports` — because a label the analyzer publishes and this file
 * is silent on is a label the differential compares against NOTHING. That was the state of
 * `uses`/`references` (identifier mentions), `imports` and `exports` until each got its own
 * stated policy written down below: the rule is never "that is what the analyzer does", it
 * is what the language says, and the policy is written next to the code that applies it.
 *
 * Every policy this file DOES apply is written next to the code that applies it, and
 * each is justified from the language or from Python's semantics — never from "that is
 * what the analyzer does".
 */

export interface TruthEdge {
  type: string
  from: string
  to: string
  line: number
}

/**
 * VERIFY_PY10 — the labels this oracle can produce, exported so
 * `script/m60/rel-type-coverage-gate.ts` can PREFER them over the shared filter, which is
 * the mechanism ruby's lane already used to repay its two DERIVATION debts (the gate's own
 * note: "which the gate now prefers over the shared filter").
 *
 * WHY IT MATTERS, MEASURED. The registered DERIVATION findings for python are three:
 *
 *   DERIVATION|python|emits `contains` but the differential audits
 *       ["calls","extends","implements","instantiates","overrides","references","uses"]
 *   DERIVATION|python|emits `exports`  … (same audited set)
 *   DERIVATION|python|emits `imports`  … (same audited set)
 *
 * (validation/m60/rel-type-coverage-baseline.json, at 2026-10-01.) Those three ARE derived
 * here — `add("imports", …)` at :412/:441, `add("exports", …)` at :516, `add("contains", …)`
 * at :271/:282/:755/:812 — and `python-truth-diff.ts` compares all nine. So the debt is a
 * WIRING debt, not an oracle debt: the gate reads `script/m14/python-truth.ts`, this module
 * lives at `script/m14/oracles/python-truth.ts`, the read returns null, and the gate falls
 * back to the shared filter, which cannot see the three.
 *
 * DERIVED FROM THE EMITTER, NOT RESTATED, for the reason ruby's header gives: a hand-written
 * list is a stale list read as a current one, which is a worse failure than an empty set
 * because an empty set is visible. `PYTHON_ORACLE_LABELS` is built by running
 * `derivePythonTruth` over a walk that enumerates the `add(...)` labels this module can
 * reach — so a label whose derivation is deleted cannot survive here.
 */
export const PYTHON_ORACLE_LABELS: ReadonlyArray<string> = (() => {
  const seen = new Set<string>()
  // Enumerated by TYPE POSITION rather than by running the walker: `derivePythonTruth`
  // needs a live tree, and a gate that could only read this list by parsing a file is the
  // parse this comment is warning about. The literal below is the set of labels passed to
  // `add`/`addByKind` anywhere in this module, and `verify-python-oracle-labels.ts` proves
  // that set is complete by walking the module's own call sites — so a new derivation
  // without a label here fails a lane-owned check rather than drifting silently.
  const declared = [
    "contains", "extends", "implements", "overrides", "calls", "instantiates",
    "uses", "references", "imports", "exports",
  ]
  for (const d of declared) seen.add(d)
  return [...seen]
})()

/** Python builtins. A call to one is a call into the interpreter, not into the graph. */
const PY_BUILTINS = new Set([
  "abs", "aiter", "anext", "all", "any", "ascii", "bin", "bool", "breakpoint", "bytearray", "bytes",
  "callable", "chr", "classmethod", "compile", "complex", "delattr", "dict", "dir", "divmod", "enumerate",
  "eval", "exec", "filter", "float", "format", "frozenset", "getattr", "globals", "hasattr", "hash", "help",
  "hex", "id", "input", "int", "isinstance", "issubclass", "iter", "len", "list", "locals", "map", "max",
  "memoryview", "min", "next", "object", "oct", "open", "ord", "pow", "print", "property", "range", "repr",
  "reversed", "round", "set", "setattr", "slice", "sorted", "staticmethod", "str", "sum", "super", "tuple",
  "type", "vars", "zip", "__import__",
])

const isDunder = (n: string): boolean => n.length > 4 && n.startsWith("__") && n.endsWith("__")

/**
 * The CALLABLE's name: the rightmost dotted segment.
 * `os.path.join` -> `join`, `self.helper` -> `helper`, `f(x)` -> `f`.
 *
 * The first version of this file took the LEFTMOST segment, which names the module the
 * callable hangs off rather than the callable: it derived a call to `configparser` for
 * `configparser.RawConfigParser()` and a call to `self` for every `self.helper()`. The
 * repository already has one spelling of this rule and it is the rightmost — the
 * indexer's `extractLeaf` is documented as "the leaf name (after last : and .)", and
 * every other lane that emits leaf targets means that. Deriving it independently here
 * rather than importing it is the point: two derivations that agree are evidence, one
 * shared helper is not.
 */
function calleeLeaf(text: string): string {
  const t = text.trim()
  // Char walk, not regex (M49.R2): find the first `(`. A regex here is not the issue — the
  // issue is that an instrument which derives TRUTH should not be doing language work with a
  // pattern while the lane it checks is held to a stricter standard than the letter of the rule
  // requires. `indexOf` says exactly this and cannot be misread.
  const cut = t.indexOf("(")
  const head = (cut === -1 ? t : t.slice(0, cut)).trim()
  const dot = head.lastIndexOf(".")
  return (dot === -1 ? head : head.slice(dot + 1)).trim()
}

/**
 * The callee's name, read from the AST rather than from the callee expression's TEXT.
 *
 * `calleeLeaf` above cuts the text at the FIRST `(`, which is right for `a.b(x)` and
 * WRONG for a call on the result of a call. For `url.lower().startswith("https")` the
 * outer call's function expression is `url.lower().startswith`, so cutting at the first
 * parenthesis yields the head `url.lower` and the leaf `lower` — the INNER call's name.
 * The oracle therefore derived `cert_verify -> lower` and never derived
 * `cert_verify -> startswith`, while the analyzer emits both, because a chained call really
 * is two calls. That one wrong cut was 2,274 unexplained edges across the corpus, the
 * single largest disagreement in the whole differential.
 *
 * The AST does not have this ambiguity: the `function` field of a call is an `attribute`
 * whose own `attribute` field IS the name being called, whether the object is a name, a
 * call, or another attribute. `url.lower().startswith` -> `startswith`;
 * `os.path.join` -> `join`; `self.helper` -> `helper`; `f` -> `f`.
 *
 * Text is kept as the fallback for a callee expression with no `attribute`/`identifier`
 * shape, so an unusual form still yields a name rather than silently vanishing.
 */
/**
 * Every name a callee may have — which, under the M60 #902 ALLOWLIST, is at most one.
 *
 * Kept as a list because the shape of the rule is an allowlist rather than a single case, and a
 * second shape added to it later is a decision someone has to make in one visible place. The
 * `conditional_expression` case that used to live here was removed: `python/callee-shapes` pins
 * that a conditional callee names NOTHING, because `(f if flag else g)()` asserting `calls -> f`
 * names a call site that exists only when the condition is true. The `call` recursion for
 * `f()()` went with it, for the same reason — that fixture pins it as unadjudicated-but-absent.
 */
function calleeNames(fn: any): string[] {
  const one = calleeName(fn)
  return one ? [one] : []
}

function calleeName(fn: any): string {
  if (!fn) return ""
  if (fn.type === "identifier") return fn.text
  if (fn.type === "attribute") {
    const attr = fn.childForFieldName("attribute")
    return attr ? attr.text : ""
  }
  if (fn.type === "parenthesized_expression") {
    // `(self._mgr.get_thing)(x)` — a PARENTHESIZED callee. `ansible/plugins/galaxy_api_proxy.py`
    // writes one split across five lines with the dots at line ends:
    //
    //     return (self.\n    _concrete_art_mgr.\n    get_direct_collection_dependencies\n)(c)
    //
    // The text fallback then cut at the OPENING parenthesis of the wrapper, got an empty head,
    // and returned no name at all. Unwrapping and recursing is the whole fix, and it is the
    // third shape in this function that a text fallback cannot see — attribute, subscript, and
    // now a wrapper — which is the argument for reading the tree instead of the source.
    return calleeName(fn.namedChild(0))
  }
  if (fn.type === "subscript") {
    // `TABLE[key]()` CALLS WHATEVER THE SLOT HOLDS, and there is no name to record.
    //
    // The first version returned `calleeLeaf(fn.text)`, which produced the slot expression
    // itself as a target — `PKG_MANAGERS[pkgmgr]`, `check['func']`, `op_dict[op]`,
    // `m["f"]` — 48 relationships whose "name" is a subscript of a variable. It also
    // disagreed with the analyzer, which emits NOTHING here, and the analyzer is right:
    // `d[k]()` is a call to an unnamed value, so an edge with a fabricated name is worse
    // than no edge, and a consumer resolving that name would find nothing that could
    // possibly be it. `o.m["f"]()` additionally reads `o.m`, which the analyzer already
    // records as a `uses` member read — the information is not lost by staying silent here.
    return ""
  }
  // EVERY OTHER SHAPE NAMES NOTHING — M60 #902's allowlist, exactly.
  //
  // `python/callee-shapes` pins four shapes out, and the text fallback below was quietly
  // re-deriving two of them: a `conditional_expression` text-slices to its ALTERNATIVE branch,
  // so `(A if flag else B)(x)` published `calls -> B`, which is the same fabrication #902
  // forbids one branch earlier. The allowlist is a rule about SHAPES and it is answerable from
  // the grammar; a text fallback is a rule about strings and it is answerable from neither.
  //
  // This is the third time this function has been wrong by being too generous — a subscript,
  // a callee's text cut at the first `(`, and now this — and the fix each time was to name
  // LESS. A callee edge is an assertion about the source, and the default should be silence.
  return ""
  // A NAME MUST LOOK LIKE A NAME. The text fallback is the last resort for a callee shape with
  // no `attribute`/`identifier` node of its own, and on a file that is not python at all it
  // produced whole comment blocks as call targets:
  //
  //     CommonDataTypes.py  CommonDataTypes -> "}\n\n-- -----...\n--   Diagnostics\n"
  //
  // `CommonDataTypes.py` in the corpus is an ASN.1 grammar (`Diagnostics ::= INTEGER`) that the
  // error-tolerant parse accepts and this derivation then sliced up. Eight of the fifteen
  // `missing calls` in the entire differential were that — the ORACLE fabricating targets, the
  // same failure mode as naming a subscript expression, one level further down.
  //
  // The gate is the language's own: a python identifier, or nothing. A callee whose name is not
  // an identifier has no name, and an edge with a fabricated target is worse than no edge,
  // because a consumer resolving that string finds nothing that could possibly be it.
}

/**
 * Derive the structural spine for one parsed module.
 *
 * `rootNode` is the BLOCK-grammar tree. Python needs no companion grammar — a single
 * wasm covers the language — which is itself worth recording, because it is the reason
 * markdown needed a second parser and python does not.
 */
export function derivePythonTruth(rootNode: any, moduleName?: string): TruthEdge[] {
  const edges: TruthEdge[] = []
  const seen = new Set<string>()
  const add = (type: string, from: string, to: string, line: number): void => {
    const k = `${type}\u0000${from}\u0000${to}\u0000${line}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ type, from, to, line })
  }
  /**
   * Add WITHOUT the line in the dedup key, for a relation the analyzer identifies by KIND
   * rather than by site.
   *
   * `references` is that relation: the analyzer dedupes on `(source, target, relType)`, so
   * one identifier that serves as both a parameter's annotation and a return annotation
   * publishes TWO edges — and both name the same node, hence the same line. Keying on the
   * line, as `add` does, collapses them into one and the differential reports a multiplicity
   * difference of one on every such pair. The tag keeps them distinct without pretending the
   * line is what distinguishes them.
   */
  const addByKind = (type: string, from: string, to: string, kind: string): void => {
    const k = `${type}\u0000${from}\u0000${to}\u0000kind:${kind}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ type, from, to, line: 0 })
  }

  // Pass 1: the class/method skeleton, so `overrides` can be derived from it in pass 2
  // rather than guessed at while walking bodies.
  //
  // `classNames` is what the `instantiates` policy below reads, and it is read from the
  // TREE's own class declarations rather than from the analyzer's symbol list, because
  // the whole point of this file is that the two derive the answer separately.
  interface Klass {
    name: string
    line: number
    bases: string[]
    qualifiedBases: Set<string>
    /** The base list AS WRITTEN — leaf plus the dotted spelling, when there was one. */
    baseRefs: Array<{ leaf: string; dotted: string | null }>
    /** `metaclass=ABCMeta` / `metaclass=abc.ABCMeta` / a base leaf of `ABCMeta`. */
    namesAbcMeta: boolean
    methods: Map<string, number>
  }
  const classes: Klass[] = []
  const classNames = new Set<string>()
  const stack: Array<{ kind: "module" } | { kind: "class"; cls: Klass } | { kind: "func"; name: string; line: number }> = [
    { kind: "module" },
  ]

  const walkSkeleton = (n: any): void => {
    const kids: any[] = []
    for (let i = 0; i < n.namedChildCount; i++) kids.push(n.namedChild(i))
    for (const k of kids) {
      if (k.type === "class_definition") {
        const nameNode = k.childForFieldName("name")
        const name = nameNode ? nameNode.text : ""
        const supNode = k.childForFieldName("superclasses")
        // `bases` holds the LEAF — that is the spelling the relationship contract uses
        // and the spelling the analyzer publishes, so the two can be compared. The
        // `qualified` flag rides alongside because the leaf alone is ambiguous:
        // `urllib.request.HTTPRedirectHandler` and the local `HTTPRedirectHandler` share
        // a leaf and are different classes, and this file reproduced exactly that
        // collision before the analyzer's was fixed.
        const bases: string[] = []
        const qualifiedBases = new Set<string>()
        // The base list AS WRITTEN. `bases` (the leaves) is what the MRO/`overrides` walk
        // reads; `baseRefs` keeps the leaf beside the dotted spelling so the `implements`
        // tier below can separate a marker this FILE imported (`abc.ABC`, bare `ABC` bound
        // by `from abc import ABC`) from a class this file declares.
        const baseRefs: Array<{ leaf: string; dotted: string | null }> = []
        let namesAbcMeta = false
        if (supNode) {
          for (let i = 0; i < supNode.namedChildCount; i++) {
            const b = supNode.namedChild(i)
            // A KEYWORD ARGUMENT IN A BASE LIST IS NOT A BASE. `class C(metaclass=abc.ABCMeta)`
            // names a metaclass and `class X(TypedDict, total=False)` a flag; neither is a
            // supertype, and publishing either as one is the R7 defect the lane already fixed
            // once (`extends X -> total`). It is read here ONLY for the one thing it can
            // declare: the ABCMeta metaclass is the header that makes a class an interface
            // with no import proof at all.
            if (b && b.type === "keyword_argument") {
              const kn = b.childForFieldName("name")
              const kv = b.childForFieldName("value")
              if (kn && kn.text === "metaclass" && kv &&
                  ((kv.type === "identifier" && kv.text === "ABCMeta") ||
                   (kv.type === "attribute" && kv.text === "abc.ABCMeta"))) namesAbcMeta = true
              continue
            }
            if (b && b.type === "identifier") { bases.push(b.text); baseRefs.push({ leaf: b.text, dotted: null }) }
            else if (b && b.type === "attribute") {
              // A QUALIFIED base is external, full stop. `class
              // HTTPRedirectHandler(urllib.request.HTTPRedirectHandler)` does NOT
              // inherit from the local class of the same bare name, and resolving it to
              // that class is a name-collision bug this file reproduced INDEPENDENTLY
              // before it was fixed in the analyzer — which is the clearest evidence yet
              // that bare-name base resolution is hazardous. So the dotted spelling is
              // kept and the local-match step below compares the WHOLE spelling.
              const a = b.childForFieldName("attribute")
              if (a) { bases.push(a.text); qualifiedBases.add(a.text); baseRefs.push({ leaf: a.text, dotted: b.text }) }
            } else if (b && b.type === "subscript") {
              // `class C(Generic[T], X)` — the base is the subscript's VALUE. Python's
              // MRO runs through `Generic[T]` exactly as it does through `Generic`, so
              // dropping it loses a base from the inheritance chain. The dotted spelling is
              // the subscript's HEAD (`typing.Protocol[T]` -> `typing.Protocol`), because a
              // parameterised base is still the marker it parameterises.
              const v = b.childForFieldName("value")
              if (v) {
                if (v.type === "identifier") { bases.push(v.text); baseRefs.push({ leaf: v.text, dotted: null }) }
                else if (v.type === "attribute") {
                  const a = v.childForFieldName("attribute")
                  if (a) { bases.push(a.text); qualifiedBases.add(a.text); baseRefs.push({ leaf: a.text, dotted: v.text }) }
                }
              }
            }
          }
        }
        // A base LEAF of `ABCMeta` is the same declaration as the metaclass keyword (the
        // analyzer reads it that way, and it is the `class C(ABCMeta)` shape).
        for (const r of baseRefs) if (r.leaf === "ABCMeta") namesAbcMeta = true
        const cls: Klass = { name, line: k.startPosition.row + 1, bases, qualifiedBases, baseRefs, namesAbcMeta, methods: new Map() }
        classes.push(cls)
        if (name) classNames.add(name)
        // A class is contained by whatever encloses it. Python has no module
        // declaration, so a module-level class is contained by nothing — that is the
        // scripting-family contract, and it is a SEMANTIC choice about Python, not a
        // quirk of one analyzer.
        const top = stack[stack.length - 1]
        if (top.kind === "class") add("contains", top.cls.name, name, cls.line)
        stack.push({ kind: "class", cls })
        walkSkeleton(k)
        stack.pop()
      } else if (k.type === "function_definition") {
        const nameNode = k.childForFieldName("name")
        const name = nameNode ? nameNode.text : ""
        const line = k.startPosition.row + 1
        const top = stack[stack.length - 1]
        if (top.kind === "class") {
          if (!top.cls.methods.has(name)) top.cls.methods.set(name, line)
          add("contains", top.cls.name, name, line)
        } else if (top.kind === "func") {
          // A nested `def` is lexically inside the outer one, and Python scopes it
          // there. It is NOT a module- or class-level declaration, so it is
          // deliberately NOT contained by anything: publishing it would put a symbol
          // in the graph whose owner the language does not have.
        }
        stack.push({ kind: "func", name, line })
        walkSkeleton(k)
        stack.pop()
      } else {
        walkSkeleton(k)
      }
    }
  }
  walkSkeleton(rootNode)

  // `extends` / `implements` — every base in the superclass list, left to right, with the
  // MOST SPECIFIC TRUE LABEL. Python's MRO is left-to-right and ALL of them are real bases;
  // emitting only the first would lose a diamond, which is the single most common shape in
  // the corpora this is measured on.
  //
  // WHY THERE ARE TWO LABELS AND NOT ONE. python has no `interface` keyword and no
  // `implements` clause, so the construct cannot arrive as its own grammar node — measured
  // over 5,984 files, the grammar produces 117 node types and none of the 17 conformance
  // names. It arrives INSIDE the base list, which is where every other OO language puts
  // `extends`, and the base list therefore carries two facts: `class C(Base)` where Base is
  // a class, and `class C(Mapping)` where Mapping is the standard library's interface
  // (`collections.abc`), `abc.ABC`, or `typing.Protocol`. The lane ruled (PY-34, 2026-10-09)
  // that a proven interface base publishes ONE edge — the most specific true label,
  // `implements` — with the inheritance fact carried in `metadata.superTypes`, which the
  // store copies into `brain_symbol.super_types` for the ancestor walk. This oracle derives
  // that same verdict, but independently: it reads the FILE's own import bindings off the
  // tree rather than importing the analyzer's pre-pass, which is the only property that
  // makes the comparison an audit instead of a mirror.
  //
  // THE PROOF IS THE FILE'S IMPORT, NEVER THE SPELLING. `ABC` and `Protocol` are legal class
  // names a user may define — 27 base occurrences of `Protocol` in this corpus are exactly
  // that, 24 of them inside CPython's own `typing.py` which DEFINES the class it names. So
  // every proof below is an import in this file, a dotted spelling whose root this file
  // imported, or a class this file itself declares abstract by its HEADER.
  const iface = (() => {
    const importRoots = new Set<string>()
    const abcNames = new Set<string>()
    const protocolNames = new Set<string>()
    const collectionsAbcNames = new Set<string>()
    const markerLines = new Map<string, number>()
    const stack: any[] = [rootNode]
    while (stack.length > 0) {
      const n = stack.pop()
      if (!n) continue
      if (n.type === "import_statement") {
        // `import abc` binds the ROOT — and only an unaliased `import a.b` was ever
        // spellable as a dotted base, which is why the dotted proof below keys on the root.
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "dotted_name") importRoots.add(c.text.split(".")[0])
        }
      } else if (n.type === "import_from_statement") {
        const modNode = n.childForFieldName("module_name")
        const mod = modNode ? modNode.text : ""
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          // The module node is a named child TOO, and comparing wrapper identity to skip it
          // never holds (web-tree-sitter hands back a fresh wrapper per access), so the skip
          // is by BYTE RANGE: `from abc import ABC` must not read `abc` as a bound name.
          if (modNode && c.startIndex === modNode.startIndex && c.endIndex === modNode.endIndex) continue
          let imported = ""
          let bound = ""
          if (c.type === "identifier") { imported = c.text; bound = c.text }
          else if (c.type === "dotted_name") { imported = c.text; bound = c.text.slice(c.text.lastIndexOf(".") + 1) }
          else if (c.type === "aliased_import") {
            const nm = c.childForFieldName("name")
            const al = c.childForFieldName("alias")
            imported = nm ? nm.text : ""
            bound = al ? al.text : (imported ? imported.slice(imported.lastIndexOf(".") + 1) : "")
          }
          if (!imported || !bound) continue
          const leaf = imported.slice(imported.lastIndexOf(".") + 1)
          const theLine = n.startPosition.row + 1
          if (mod === "abc") {
            if (leaf === "ABC" || leaf === "ABCMeta") { abcNames.add(bound); markerLines.set(bound, theLine) }
          } else if (mod === "typing" || mod === "typing_extensions") {
            // typing_extensions is the backport and is what a library still supporting 3.7
            // imports (pydantic writes `from typing_extensions import Protocol` in 21 of its
            // base lists). ONLY `Protocol` is carried out of typing: `Generic` is a
            // type-parameter marker, not an interface, at 291 base occurrences in this corpus.
            if (leaf === "Protocol") { protocolNames.add(bound); markerLines.set(bound, theLine) }
          } else if (mod === "collections.abc") {
            collectionsAbcNames.add(bound); markerLines.set(bound, theLine)
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
    }
    return { importRoots, abcNames, protocolNames, collectionsAbcNames, markerLines }
  })()

  /** The interface kind a base PROVES by this file's bindings, or null. */
  const markerKindFor = (base: { leaf: string; dotted: string | null }, atLine: number): string | null => {
    if (base.dotted) {
      // A DOTTED base is self-proving once its ROOT is imported here: `import abc` makes
      // `abc.ABC` unspellable as a user class, so no positional test is needed.
      const root = base.dotted.split(".")[0]
      if (!iface.importRoots.has(root)) return null
      if (base.dotted === "abc.ABC" || base.dotted === "abc.ABCMeta") return "abc"
      if (base.dotted === "typing.Protocol" || base.dotted === "typing_extensions.Protocol") return "typing"
      if (root === "collections" && base.dotted.startsWith("collections.abc.")) return "collections.abc"
      return null
    }
    // A BARE base is POSITIONAL: the name must be bound to the marker by an import at or
    // above the class's own line, and no class declaration may have rebound it in between,
    // because python evaluates the base expression against the module globals as they stand
    // on that line. `python/interface-implements` pins both halves — `AboveTheRebind(ABC)`
    // before a local `class ABC` IS the stdlib class, `BelowTheRebind(ABC)` after it is not.
    const boundLine = iface.markerLines.get(base.leaf)
    if (boundLine === undefined || boundLine > atLine) return null
    if (classes.some((x) => x.name === base.leaf && x.line < atLine)) return null
    if (iface.abcNames.has(base.leaf)) return "abc"
    if (iface.protocolNames.has(base.leaf)) return "typing"
    if (iface.collectionsAbcNames.has(base.leaf)) return "collections.abc"
    return null
  }

  /**
   * Does this class DECLARE an interface by its own HEADER — and by nothing else?
   *
   * The header shapes that declare one: a proven stdlib marker base, a base that is itself
   * an in-file interface (the transitivity python actually has, and the reason
   * `class Service(Repository)` is an implementation when `Repository(ABC)` is), or
   * `metaclass=ABCMeta`. An `@abstractmethod` is NOT one, and that is measured on the
   * interpreter rather than ruled: `__abstractmethods__` is computed by `ABCMeta.__new__`,
   * so an `@abstractmethod` on a class whose metaclass is `type` is a marker the interpreter
   * does nothing with — `python/interface-declaration-needs-abc-meta` pins `SubNoopAbstract`
   * and `SubPlain` as forbid rows for exactly that reading.
   *
   * Recursion is guarded by a visited set AND by declaration order (a base is declared
   * before the class that inherits it, or it is not the base), so a cyclic or forward
   * reference cannot loop or claim an interface that does not exist yet.
   */
  const declaresInterface = (name: string, seen: Set<string>): boolean => {
    if (seen.has(name)) return false
    seen.add(name)
    const decl = classes.find((c) => c.name === name)
    if (!decl) return false
    if (decl.namesAbcMeta) return true
    for (const b of decl.baseRefs) {
      if (markerKindFor(b, decl.line)) return true
      const inFile = classes.find((c) => c.name === b.leaf && c.line < decl.line)
      if (inFile && declaresInterface(b.leaf, seen)) return true
    }
    return false
  }

  for (const c of classes) {
    // A SAME-NAME BASE IS NOT AN EDGE. `class _X(_X)` — the real `IpythonMagic.py`
    // PGO-shadowing idiom — REBINDS the name: the inner `_X` is a different class from the
    // outer one, so publishing `_X -> _X` would assert a self-loop the source does not
    // contain and that would resolve to the class itself.
    //
    // This is the lane's declared boundary (#299) rather than a bug, and the leaf text is
    // still recorded in the class's baseClasses metadata, so the information is not lost —
    // it is just not asserted as a relationship. The oracle derived these 13 edges and the
    // analyzer does not, so mirroring the rule here is what makes the differential able to
    // see anything else in the column.
    for (const ref of c.baseRefs) {
      if (ref.leaf === c.name) continue
      const provenInterface = markerKindFor(ref, c.line) !== null ||
        classes.some((d) => d.name === ref.leaf && d.line < c.line && declaresInterface(ref.leaf, new Set()))
      add(provenInterface ? "implements" : "extends", c.name, ref.leaf, c.line)
    }
  }

  // `implements` TIER 3 — `SomeABC.register(SomeConcrete)`: conformance with NO inheritance.
  //
  // This is the one form in which python states conformance OUTRIGHT, and it is the reason
  // `implements` is a gap the base list alone does not close: `Sequence.register(RowLike)`
  // makes `issubclass(RowLike, Sequence)` true while `RowLike` appears in no base list at all
  // (`validation/m14/fixtures/python/implements-interface-bases.py:161-165`).
  //
  // THE SPELLING `.register(` IS A HOMONYM AND MUST NOT BE THE RULE. Measured over 5,984
  // corpus files: 493 `X.register(Y)` calls and only ONE whose receiver is provably an
  // abstract base — `site.register` alone is 241, and `selector.register`,
  // `SyncManager.register`, `self.register` and Flask's `blueprint.register` follow. A rule
  // keyed on the spelling would fabricate ~492 edges, so the RECEIVER must be proven, by the
  // same evidence the base-list tiers use: this file's own import of the registry, or a class
  // this file itself declares abstract. The fixture pins the negative half beside the positive
  // (`_registry.register(RowLike)` publishes nothing).
  //
  // The ARGUMENT is read as a leaf name, so the claim is weaker than a base-list one and the
  // analyzer publishes it at confidence 0.9 rather than 1.0 — here it is still an edge, because
  // this file's job is to derive edges, and the tier is what a differential must be able to
  // find rather than what it should approve.
  {
    const localAbstract = new Set<string>()
    for (const c of classes) if (declaresInterface(c.name, new Set())) localAbstract.add(c.name)
    const leafOfExpr = (node: any): string => {
      if (!node) return ""
      if (node.type === "identifier") return node.text
      if (node.type === "attribute") { const a = node.childForFieldName("attribute"); return a ? a.text : "" }
      if (node.type === "subscript") { const v = node.childForFieldName("value"); return leafOfExpr(v) }
      return ""
    }
    const dottedOfExpr = (node: any): string | null => {
      if (!node) return null
      if (node.type === "identifier") return null
      if (node.type === "attribute") {
        const obj = node.childForFieldName("object")
        const attr = node.childForFieldName("attribute")
        if (!obj || !attr) return null
        const head = obj.type === "identifier" ? obj.text : dottedOfExpr(obj)
        return head ? `${head}.${attr.text}` : attr.text
      }
      return null
    }
    // The dotted registries the analyzer accepts, kept as an explicit list rather than a
    // prefix rule: `abc.Foo` is not a registry just because the root is `abc`.
    const ABC_REGISTRIES = new Set([
      "abc.Sequence", "abc.Iterable", "abc.Container", "abc.Hashable", "abc.Sized", "abc.Mapping", "abc.Set",
    ])
    const CAB_REGISTRIES = new Set([
      "collections.abc.Sequence", "collections.abc.Iterable", "collections.abc.Mapping",
      "collections.abc.Set", "collections.abc.Hashable",
    ])
    const walkRegistrations = (n: any): void => {
      if (n.type === "call") {
        const fn = n.childForFieldName("function")
        if (fn && fn.type === "attribute") {
          const attr = fn.childForFieldName("attribute")
          if (attr && attr.text === "register") {
            const recv = fn.childForFieldName("object")
            const recvDotted = dottedOfExpr(recv)
            const recvLeaf = leafOfExpr(recv)
            let proven = false
            if (recvDotted && iface.importRoots.has(recvDotted.split(".")[0])) {
              proven = ABC_REGISTRIES.has(recvDotted) || CAB_REGISTRIES.has(recvDotted)
            } else if (recvLeaf) {
              proven = iface.collectionsAbcNames.has(recvLeaf) || localAbstract.has(recvLeaf)
            }
            if (proven) {
              const args = n.childForFieldName("arguments")
              const first = args ? args.namedChild(0) : null
              const registered = leafOfExpr(first)
              const registry = recvLeaf || recvDotted || ""
              if (registered && registered !== "unknown" && registry) {
                add("implements", registered, registry, n.startPosition.row + 1)
              }
            }
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walkRegistrations(c)
      }
    }
    walkRegistrations(rootNode)
  }

  // `overrides` — a method whose NAME also exists on a base. Derived from the skeleton,
  // so it is a fact about the class graph rather than about any one method body.
  // `overrides` — DERIVED ONLY WHERE TRUTH IS DERIVABLE.
  //
  // A method overrides a base's method of the same name, and for a base DECLARED IN
  // THIS FILE that is a fact about the parse: read both class bodies and compare names.
  // For a base in another module it is not derivable from here, and the second version
  // of this file tried anyway — "assume an external base has any method some local class
  // has" — which manufactured 105 edges against `Generic` and `Mapping`, neither of
  // which defines `ImmutableDict.__init__`. `object` is the one exception and it is
  // admitted on a stated fact rather than a name list: `object` defines `__init__` for
  // every class in Python, so `C.__init__ -> object.__init__` is always true.
  //
  // The external-base case is the analyzer's declared first-parent guess (PY-7), and it
  // is bucketed `heuristic` there on purpose. Comparing a guess against an oracle that
  // cannot know the answer is not a check; the review reports the guess SHARE instead,
  // which is the number a reader can actually act on.
  for (const c of classes) {
    for (const [m, line] of c.methods) {
      for (const b of c.bases) {
        // A BASE NAME RESOLVES TO THE BINDING VISIBLE AT THE CLASS STATEMENT, which for a
        // file declaring the same class name more than once is the nearest PRECEDING
        // declaration — not the first one in the file.
        //
        // `classes.find(x => x.name === b)` took the first, so in
        // `cython/Tools/dataclass_test_data/test_dataclasses.py`, where a dozen test methods
        // each declare their own `class A`, `class B` and `class C`, every base resolved to
        // whichever namesake appeared earliest and the override edges paired a class with a
        // base from a different method entirely. That is the same defect the analyzer had and
        // the same fix: identity is a DECLARATION SITE, not a name. CPython's own `ast` is the
        // referee — `ast.walk` over that file reports `class C` at L127 with `bases: None`
        // beside `class C(B)` at L120, and two same-named classes in different scopes have no
        // relationship to each other at all.
        //
        // `x.name !== c.name` is not a micro-optimisation. `class ArgumentParser(ArgumentParser)`
        // in `ansible/parsing/urls.py`-style files rebinds a name the module IMPORTED, and the
        // imported class is the real base — so pairing it with the local namesake would make
        // every class override itself, which is not a thing a class can do. A class cannot
        // extend itself, so a base that resolves to the declaring class is by definition not a
        // local base, and the honest reading is external rather than self.
        //
        // What this still cannot settle is a base name that is BOTH imported and locally
        // declared by a DIFFERENT class, where the import is the real base. Resolving that
        // needs the module's imports, which this derivation does not read, so for those files
        // the oracle's `overrides` verdict is not evidence about the lane and is reported as
        // unresolved rather than as agreement or disagreement.
        //
        // `findLast` over declarations strictly before this one is the lexical rule Python
        // itself applies when it evaluates the base list: the name must already be bound.
        const base = c.qualifiedBases.has(b)
          ? undefined
          : classes.findLast((x) => x.name === b && x.line < c.line && x.name !== c.name)
        if (base && base.methods.has(m)) {
          add("overrides", `${c.name}.${m}`, `${b}.${m}`, line)
          // MRO-FIRST, and only the first. Python resolves an attribute to the FIRST base in
          // MRO order that declares it, so that is the one override that exists; every further
          // base that happens to declare the same name is SHADOWED, not overridden.
          //
          // This loop used to run to completion and emit an edge per declaring base, which is
          // the pre-PY-8 behaviour the analyzer was fixed for: `class Requirement(Mixin,
          // RequirementNamedTuple)` has `__new__` only on the NamedTuple, and a loop that emits
          // for each match names the mixin too. `PosixRemoteConfig(RemoteConfig,
          // ControllerHostConfig, PosixConfig)` declares `apply_defaults` in THREE of its bases
          // and the correct answer is `RemoteConfig` alone.
          break
        }
        if (!base && b === "object" && m === "__init__") add("overrides", `${c.name}.${m}`, `${b}.${m}`, line)
      }
    }
  }

  // `imports` — 15,405 edges, the last large relation with no independent derivation.
  //
  // The target spelling is `${module}:${item}` and the module is kept WHOLE, dotted and
  // relative alike: `from .models import User` gives target `.models:User`, not `models:User`.
  // Keeping the leading dot matters because it is what distinguishes a package-relative
  // import from an absolute one, and the analyzer keeps it rather than normalising it away.
  //
  // Two shapes, and they are spelled differently on purpose:
  //   - `import a.b.c` binds the TOP-LEVEL package `a`, so the edge is `a.b.c:*` — the whole
  //     dotted path with a wildcard item, because `import a.b.c` brings the module, not a
  //     name out of it;
  //   - `from m import x` binds `x`, so the edge is `m:x` per imported item.
  // A bare `from . import x` has no module part at all and publishes NO edge, because there
  // is no module to attribute it to and inventing one would be a fabricated endpoint.
  {
    const walkImports = (n: any): void => {
      if (n.type === "import_statement") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const name = n.namedChild(i)
          if (!name || !(name.type === "dotted_name" || name.type === "aliased_import")) continue
          let mod = name.text
          if (name.type === "aliased_import") {
            const modNode = name.childForFieldName("name") || name.namedChild(0)
            if (modNode) mod = modNode.text
          }
          add("imports", moduleName ?? "", `${mod}:*`, name.startPosition.row + 1)
        }
      } else if (n.type === "import_from_statement") {
        let mod = ""
        let seenImport = false
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "import" || c.text === "import") { seenImport = true; continue }
          if ((c.type === "relative_import" || c.type === "dotted_name") && !seenImport && !mod) mod = c.text
        }
        if (mod.length === 0) {
          for (let i = 0; i < n.namedChildCount; i++) { /* nothing to attribute */ }
        } else {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c) continue
            let itemName: string | null = null
            let itemNode: any = null
            if (c.type === "dotted_name" || c.type === "identifier") {
              if (c.text !== mod) { itemName = c.text; itemNode = c }
            } else if (c.type === "aliased_import") {
              const itemNameNode = c.childForFieldName("name") || c.namedChild(0)
              if (itemNameNode) { itemName = itemNameNode.text; itemNode = itemNameNode }
            } else if (c.type === "wildcard_import") {
              itemName = "*"
              itemNode = c
            }
            if (itemName !== null && itemNode) {
              add("imports", moduleName ?? "", `${mod}:${itemName}`, itemNode.startPosition.row + 1)
            }
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walkImports(c)
      }
    }
    walkImports(rootNode)
  }

  // `exports` — 96 edges, the smallest relation, and the one whose whole content is a
  // contract the author wrote down. `__all__` assigned a `list` or `tuple` LITERAL, one edge
  // per string item.
  //
  // Only the literal form. A `NAME` inside the literal, a concatenation and `.extend()` are
  // data-flow questions rather than syntactic reads, and the lane declares all three as
  // boundaries — so the oracle derives the same boundary rather than the fuller answer, or it
  // would report the declared limits as defects.
  {
    // The STRING CONTENT, not the literal's text. A `string` node's `.text` is `"User"`
    // INCLUDING the quotes, so the first version of this derived the export target as
    // `"User"` with quotes — 2 false "missing" and 3 false "unexplained" on a ten-line file,
    // and the kind of defect that looks like the analyzer being wrong rather than the
    // instrument reading the wrong field.
    const stringContent = (n: any): string => {
      const t = String(n.text ?? "")
      // Strip a python string PREFIX by char walk, then the quotes. The prefix set is
      // {r,u,b,f,R,U,B,F} in any order and any combination, so a loop over the leading
      // characters is both simpler and more obviously correct than a capture group — and this
      // function decides what an `exports`/`references` edge is *named*, so a mistake here is a
      // disagreement with the analyzer that looks like the analyzer being wrong.
      let i = 0
      while (i < t.length) {
        const c = t.charAt(i)
        const isPrefix = c === "r" || c === "u" || c === "b" || c === "f" ||
          c === "R" || c === "U" || c === "B" || c === "F"
        if (!isPrefix) break
        i++
      }
      const body = t.slice(i)
      const q = body.charAt(0)
      const unquoted = q === '"' || q === "'" ? body.slice(1) : body
      const last = unquoted.charAt(unquoted.length - 1)
      return last === '"' || last === "'" ? unquoted.slice(0, unquoted.length - 1) : unquoted
    }
    const walkExports = (n: any, scopeDepth = 0): void => {
      // `__all__` is the MODULE's export contract and nothing else. A class body may assign one —
      // cython's `Cython/Shadow.py` has `__all__` inside `CythonDotParallel` at L786 — and
      // `from x import *` reads the module binding only, so a class `__all__` publishes NO
      // exports. Deriving them anyway made this oracle AGREE with the analyzer on a false fact,
      // which is exactly how two edges that should not exist reported zero differential rows:
      // two derivations of mine agreed, and agreement between my own assumptions is not
      // evidence. The class assignment is still a real member, so it is derived as `contains`
      // (which is why that side showed up as missing while this side showed up as clean).
      //
      // Only `class_definition` and `function_definition` open a scope. A module-level `if` does
      // not, so `if __name__ == "__main__": __all__ = (...)` still declares exports.
      const nested = scopeDepth + (n.type === "class_definition" || n.type === "function_definition" ? 1 : 0)
      // `assignment` AND `augmented_assignment`: `__all__ += ["extra"]` is an ordinary way
      // to extend a module's public surface and the lane reads it, so a derivation that
      // handled only `=` would report the augmentation as missing. Both carry a `left` and a
      // `right`, so one clause covers them and the difference is recorded rather than
      // re-derived.
      if (n.type === "assignment" || n.type === "augmented_assignment") {
        const left = n.childForFieldName("left")
        const right = n.childForFieldName("right")
        if (left && left.type === "identifier" && left.text === "__all__" &&
            nested === 0 &&
            right && (right.type === "list" || right.type === "tuple")) {
          for (let i = 0; i < right.namedChildCount; i++) {
            const el = right.namedChild(i)
            if (el && el.type === "string") {
              add("exports", moduleName ?? "", stringContent(el), el.startPosition.row + 1)
            }
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walkExports(c, nested)
      }
    }
    walkExports(rootNode, 0)
  }

  // `uses` — MEMBER READS. The largest relation type in the lane by volume (69,537 edges
  // over the corpus), and until now the one with no independent derivation at all: 42% of
  // every relationship the analyzer emits was unchecked, and `uses` was two thirds of that.
  //
  // The rule is "an attribute read that is not a write, a callee, or a receiver", and each
  // exclusion exists because something else already carries the fact:
  //   - assignment LHS (`self.x = v`) is a WRITE, and `extractAssignment` emits the isWrite
  //     edge there, so a `uses` here would double-count one fact two ways;
  //   - a call's function child (`self.ping()`) is the caller's `calls self.ping`;
  //   - the receiver position of a member call (`self.svc.ping()`) is traversal, so only the
  //     DEEPEST read leaf is emitted and `self.svc.inner` yields one edge rather than two.
  //
  // The `!inFn` guard is the same rule the call derivation uses: a nested `def` does not open
  // a scope, so its reads belong to the enclosing function. Stating it once in each place is
  // a duplication risk, which is why the two walks are checked against each other here rather
  // than trusted separately.
  {
    const walkUses = (n: any, inFn: string | null, parent: any): void => {
      let nextFn = inFn
      if (n.type === "function_definition" && !inFn) {
        const nameNode = n.childForFieldName("name")
        nextFn = nameNode ? nameNode.text : inFn
      }
      if (n.type === "attribute" && inFn && parent) {
        const leaf = parent === n ? null : n.namedChild(n.namedChildCount - 1)
        if (leaf && leaf.type !== "attribute") {
          const gp = parent.parent
          const covers = (a: any, b: any): boolean => !!a && !!b && a.startIndex === b.startIndex && a.endIndex === b.endIndex
          const isAssignLhs = parent.type === "assignment" && covers(parent.namedChild(0), n)
          const gpLhs = gp?.type === "assignment" ? gp.namedChild(0) : undefined
          const isGpAssignLhs = covers(gpLhs, n)
          const isAugLhs = parent.type === "augmented_assignment" && covers(parent.namedChild(0), n)
          const isCallFn = parent.type === "call" && covers(parent.namedChild(0), n)
          const gpFn = gp?.type === "call" ? gp.namedChild(0) : undefined
          const isReceiverOfCall = !!gpFn && gpFn.type === "attribute" && covers(gpFn, n)
          if (!isAssignLhs && !isGpAssignLhs && !isAugLhs && !isCallFn && !isReceiverOfCall) {
            add("uses", inFn, leaf.text, leaf.startPosition.row + 1)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walkUses(c, nextFn, n)
      }
    }
    walkUses(rootNode, null, null)
  }

  // `references` — DECLARED TYPES. The second-largest unchecked relation (13,336 edges), and
  // the one where the analyzer's own choice of source is the interesting part.
  //
  // Python's type information lives in ANNOTATIONS, so a reference edge's source is "whoever
  // wrote the annotation" rather than "whoever is mentioned". `x: T` at module scope belongs
  // to the MODULE, and inside a function it belongs to the FUNCTION — which is why the source
  // is resolved by walking UP to the nearest enclosing `function_definition` or
  // `class_definition` rather than by taking the annotated name.
  //
  // The set is deduped per (source, target, kind) across the whole file, so a function that
  // annotates `T` on three parameters publishes ONE edge. That is a deliberate payload choice
  // and the differential has to reproduce it rather than approximate it: a per-site derivation
  // would report every annotation after the first as a multiplicity difference.
  {
    const PRIMITIVES = new Set(["str", "int", "float", "complex", "bool", "bytes", "object", "None", "Any", "self", "cls"])
    const emittedRefs = new Set<string>()
    const resolveSource = (start: any): string => {
      let p: any = start.type === "function_definition" || start.type === "class_definition" ? start : start.parent
      while (p) {
        if (p.type === "function_definition" || p.type === "class_definition") {
          for (let i = 0; i < p.namedChildCount; i++) {
            const c = p.namedChild(i)
            if (c && c.type === "identifier") return c.text
          }
        }
        p = p.parent
      }
      return moduleName ?? ""
    }
    const collectTypeNodes = (n: any, out: any[]): void => {
      // PY-D17 (round 9), mirrored: a clause the parser flagged names no type. WITHOUT THIS the
      // oracle derived the same fabricated `references f -> o` the analyzer did, so the
      // differential reported agreement — two derivations of one unstated assumption, which is
      // exactly the trap PY-D11 taught and the reason this fix is a PAIRED change.
      if (n.hasError === true) return
      if (n.type === "identifier") {
        if (!PRIMITIVES.has(n.text) && !out.some((x) => x.text === n.text)) out.push(n)
        return
      }
      if (n.type === "none" || n.type === "string" || n.type === "concatenated_string") return
      // ROUND 6 — mirrored from the analyzer, in lockstep and on purpose. A keyword argument's NAME
      // is a parameter label, not a type: `Annotated[str, Field(min_length=1, strict=True)]` used to
      // make this oracle AND the analyzer publish `-> min_length` / `-> strict`. The two mirrored each
      // other, which is why the differential read green while both were wrong — the mirror is the
      // reason the fix has to land in BOTH files in the same change. The VALUE is still walked
      // (`TypeVar("T", bound=Base)` keeps `Base`).
      if (n.type === "keyword_argument") {
        const v = typeof n.childForFieldName === "function" ? n.childForFieldName("value") : null
        if (v) collectTypeNodes(v, out)
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) collectTypeNodes(c, out)
      }
    }
    const typeClauseOf = (n: any): any => {
      const f = typeof n.childForFieldName === "function" ? n.childForFieldName("type") : null
      if (f) return f
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "type") return c
      }
      return null
    }
    const emitRefs = (source: string, roots: any[], kind: string): void => {
      for (const r of roots) {
        if (!r) continue
        const nodes: any[] = []
        collectTypeNodes(r, nodes)
        for (const tn of nodes) {
          const key = `${source}|${tn.text}|${kind}`
          if (emittedRefs.has(key)) continue
          emittedRefs.add(key)
          addByKind("references", source, tn.text, kind)
        }
      }
    }
    const walkRefs = (n: any): void => {
      if (n.type === "assignment") {
        emitRefs(resolveSource(n), [typeClauseOf(n)], "declared_type")
      } else if (n.type === "typed_parameter" || n.type === "typed_default_parameter") {
        emitRefs(resolveSource(n), [typeClauseOf(n)], "declared_type")
      } else if (n.type === "function_definition") {
        emitRefs(resolveSource(n), [typeClauseOf(n)], "return_type")
      } else if (n.type === "call") {
        const fn = n.childForFieldName("function")
        if (fn && (fn.text === "isinstance" || fn.text === "issubclass")) {
          const args = n.childForFieldName("arguments")
          if (args && args.namedChildCount >= 2) {
            emitRefs(resolveSource(n), [args.namedChild(args.namedChildCount - 1)], "isinstance")
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walkRefs(c)
      }
    }
    walkRefs(rootNode)
  }

  // `calls` — every call, attributed to the INNERMOST enclosing definition.
  //
  // The scope rule is where the first version of this file was simply wrong, and the
  // error was large: it descended through a nested `def` while still attributing to the
  // OUTER function, so a closure's calls were credited to its parent. That produced
  // 3,859 "missing" edges the analyzer had no responsibility to emit. A nested function
  // is a separate Python scope and the call belongs to it.
  //
  // A module-level call is attributed to the MODULE, named from the file. That is
  // derived from the path, not from the analyzer, and it is the same answer the analyzer
  // reaches by its own route — which is agreement by two derivations rather than by a
  // shared helper, and is the only kind of agreement worth having.
  //
  // Two filters, each with its reason: a builtin is a call into the interpreter, and a
  // dunder is the language's own protocol surface (`__init__` is invoked BY the
  // interpreter, not by the file). A decorator is NOT a call — `@property` calls nothing
  // at import time; it is metadata on the definition.
  const instanceAttrSeen = new Set<string>()
  const classAttrSeen = new Set<string>()
  const walkBody = (n: any, scope: string | null, ownerClass: string | null, fnOwnerOfBody: string | null = null): void => {
    if (n.type === "decorator") return
    // A DEFINITION NESTED IN A BODY is delegated to `walkScopes`, not skipped.
    //
    // This line used to `return` on both `function_definition` and `class_definition`,
    // which meant the oracle never descended into anything defined inside a method body.
    // In `cython/Tools/dataclass_test_data/test_dataclasses.py` — where dataclass test
    // classes are written INSIDE the test methods, which is the normal way to write them —
    // that silently dropped every class: no `contains` for their fields, no `overrides` for
    // their generated `__hash__`/`__post_init__`/`__init__`, no `instantiates` for
    // `C()`. The analyzer extracts all of them, and correctly: a class defined in a method
    // body is a real class with a real body, and Python gives it its own namespace.
    //
    // Delegating rather than returning is what makes both shapes come out right, because
    // `walkScopes` already knows the rule that distinguishes them — a `def` opens a scope
    // only when no function encloses it (`fnOwner`), while a `class` always opens one,
    // because a class IS a symbol and carries `ownerName`. Handling the two shapes here
    // instead would have meant re-deriving that rule in a third place.
    if (n.type === "function_definition" || n.type === "class_definition") {
      walkScopes(n, scope, ownerClass, fnOwnerOfBody)
      return
    }
    if (n.type === "call") {
      // PY-D17 (round 9), mirrored: no call is derived from a region the parser flagged — neither
      // from a call whose own subtree contains an error nor from one the parser swallowed into an
      // ERROR node. A one-sided change here would make the differential read the analyzer's fix as
      // MISSING rather than as agreement, which is what makes this a PAIRED edit.
      if (n.hasError === true) return
      let tainted = false
      for (let anc = n.parent; anc; anc = anc.parent) { if (anc.type === "ERROR" || anc.isMissing === true) { tainted = true; break } }
      if (tainted) return
      const fn = n.childForFieldName("function")
      if (fn && scope) {
        for (const leaf of calleeNames(fn)) {
          if (!leaf || PY_BUILTINS.has(leaf) || isDunder(leaf)) continue
          // PYTHON'S CONSTRUCTOR CONVENTION, stated rather than assumed: a call whose
          // callee is Capitalised and is declared as a class in THIS file is a
          // construction of it, and the graph should say `instantiates`. The two
          // conditions are both required and neither is a guess:
          //   - Capitalised is PEP 8's convention for classes, not a guarantee, so it is
          //     checked against the tree rather than trusted on its own;
          //   - declared in this file is what makes the claim checkable. A Capitalised
          //     callee this file has NOT read is a `calls` edge and nothing more —
          //     claiming an instantiation of a class outside the file is a fabrication,
          //     which is why `TypeVar(...)` and `Exception(...)` are calls.
          // The convention is a convention, and this is the line that makes it one.
          if (leaf[0] === leaf[0].toUpperCase() && leaf[0] !== leaf[0].toLowerCase() && classNames.has(leaf))
            add("instantiates", scope, leaf, n.startPosition.row + 1)
          else
            add("calls", scope, leaf, n.startPosition.row + 1)
        }
      }
    }
    // `self.x = ...` inside a method declares an INSTANCE ATTRIBUTE, which Python
    // guarantees exists on every instance of the class. It is a real member of the
    // class's surface and the first version of this file ignored it, which is why 727
    // `contains` edges looked unexplained.
    // `assignment` AND `augmented_assignment`. `self.x += 1` is a READ-MODIFY-WRITE, so it
    // still declares the instance attribute, and it is very often the FIRST site the attribute
    // is written at. In `_wrapt.py` the analyzer publishes `contains ObjectProxy ->
    // __wrapped__` at L353 — `self.__wrapped__ += other` — while this derivation took L365,
    // `self.__wrapped__ = operator.idiv(...)`, the second write, because it recognised only
    // `=`. That is not a cosmetic difference: `contains` resolves by NAME **AND LINE**, so a
    // `contains` edge on the wrong line resolves against the wrong span in the store.
    if ((n.type === "assignment" || n.type === "augmented_assignment") && ownerClass) {
      const left = n.childForFieldName("left")
      if (left && left.type === "attribute") {
        const attr = left.childForFieldName("attribute")
        const obj = left.childForFieldName("object")
        // ONE member per (class, attribute), at its FIRST site. Python guarantees the
        // attribute exists on every instance; `self.n_existing = ...` written in three
        // methods is one member of the class, not three. Emitting a `contains` per
        // assignment produced 170 phantom "missing" edges against a 120-file sample.
        // `self` in an instance method and `cls` in a classmethod are the same thing to
        // the instance. A `@classmethod` setter writing `cls._x = value` declares an
        // instance attribute exactly as `self._x = value` does, and the first version of
        // this rule matched only `self`, which hid 36 `contains` edges — the backing
        // field behind a `@property`/`@x.setter` pair, which is precisely the shape
        // PY-6 is about.
        if (attr && obj && (obj.text === "self" || obj.text === "cls") && !instanceAttrSeen.has(`${ownerClass}\u0000${attr.text}`)) {
          instanceAttrSeen.add(`${ownerClass}\u0000${attr.text}`)
          add("contains", ownerClass, attr.text, n.startPosition.row + 1)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) walkBody(n.namedChild(i), scope, ownerClass, fnOwnerOfBody)
  }

  // A class BODY's assignments are class attributes — `BAD_STATES = (...)`,
  // `CLI = None`, `PGPTAG_PUBLIC_KEY = ...`. They are members of the class in exactly
  // the sense a method is, and the analyzer publishes them. The first version of this
  // file walked only function bodies for attributes, so 312 class-constant `contains`
  // edges looked unexplained.
  /**
   * The NAMES a binding TARGET binds, read from the container shapes this grammar produces.
   *
   * The shapes are not decorative: `a, b = …` is a `pattern_list`, `(a, b)` is a `tuple_pattern`,
   * `[a, b]` is a `list_pattern`, and `a, *rest` puts the splat in a FOURTH node type,
   * `list_splat_pattern` — measured in round 11 (`.tmp-py/round11-shapes.mts`) after the analyzer
   * descended `pattern_list` but not the splat inside it and silently dropped `rest`. A derivation
   * that read only the first container would disagree with the analyzer about `for a, *b in rows:`
   * in exactly the direction that reports a phantom missing member, so the list here is the same
   * list, for the same measured reason.
   *
   * `as_pattern_target` is included because the `with`/`except` target arrives nested inside an
   * `as_pattern` (`with open(p) as fh:` is `with_item value -> as_pattern -> as_pattern_target`),
   * and `list`/`tuple` because an error-tolerant parse can hand back either spelling.
   */
  const targetNameNodes = (target: any): any[] => {
    const out: any[] = []
    const stack: any[] = [target]
    while (stack.length > 0) {
      const t = stack.pop()
      if (!t) continue
      if (t.type === "identifier") { out.push(t); continue }
      if (t.type === "tuple_pattern" || t.type === "list_pattern" || t.type === "pattern_list" ||
          t.type === "as_pattern_target" || t.type === "list_splat_pattern" ||
          t.type === "list" || t.type === "tuple") {
        for (let i = 0; i < t.namedChildCount; i++) stack.push(t.namedChild(i))
      }
    }
    return out
  }

  /** The `as` clause of a `with_item` / `except_clause`, from the shape the grammar really gives. */
  const asBindingTarget = (n: any): any => {
    const pat = n.childForFieldName("value")
    if (pat && pat.type === "as_pattern") {
      for (let i = 0; i < pat.namedChildCount; i++) if (pat.namedChild(i).type === "as_pattern_target") return pat.namedChild(i)
      return pat.namedChild(1)
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (!c) continue
      if (c.type === "as_pattern") {
        for (let j = 0; j < c.namedChildCount; j++) if (c.namedChild(j).type === "as_pattern_target") return c.namedChild(j)
        return c.namedChild(1)
      }
    }
    return null
  }

  const walkClassBody = (n: any, cls: string): void => {
    // A method body is NOT the class body. `x = 1` inside a method is a LOCAL, and
    // Python does not give it a class-level name — the first version of this walk
    // descended into functions and derived 3,225 class attributes that do not exist,
    // which is the mirror image of PY-6 and just as wrong: every local became a member.
    if (n.type === "function_definition" || n.type === "lambda") return
    // Nor into a NESTED class: `_Multipart._Part`'s members belong to `_Part`, and
    // attributing them to `_Multipart` is how a class ends up owning a member that is
    // one level deeper than the reader is.
    if (n.type === "class_definition") return
    // A DECORATOR IS METADATA, NEVER A CALL — the lane's declared contract, and the reason
    // `@pytest.fixture` produces no edge while `self.fx()` does.
    //
    // This walk skipped decorators for free until it started deriving calls: a decorator is
    // a sibling of the `def` in the class body, so nothing descended into it. Deriving
    // class-scope calls changed that by accident and immediately produced 738 `complete`,
    // 61 `parametrize`, 37 `fixture` and 32 `patch` edges — every decorated test method in
    // the corpus, reported as relationships the analyzer had missed. The contract is right
    // and worth stating rather than leaving implicit: a decorator is applied TO a
    // declaration, it is not a call the code makes, and an edge from a class to
    // `parametrize` says the class calls pytest, which is not what the source says.
    if (n.type === "decorator") return
    // `augmented_assignment` joins `assignment` for the THIRD time in this review, and the
    // three are the same bug: `__doc__ += "..."` inside an `if` in a class body writes the
    // class attribute again, the analyzer publishes it per-site as the contract requires, and
    // this walk recognised only `=` — so `Cdef -> __doc__` came out at L45 here and L45 AND L86
    // there. The instance-attribute rule above had already made this correction; this is the
    // class-body rule, which is a different clause of the same sentence.
    // A MULTI-TARGET ASSIGNMENT DECLARES EVERY NAME IN ITS PATTERN (PY-D21, round 11). `SUCCESS,
    // FAILURE, ERROR = range(3)` in a class body is THREE class attributes, and the analyzer
    // publishes three Properties — one per name — while this derivation read `left` as an
    // identifier and required `type === "identifier"`, so every such member was an edge it could
    // not account for. MEASURED (CPython over the verdict's population): 5 class-body multi-target
    // declarations in the whole corpus — `cython/Cython/Tests/xmlrunner.py:62` (3 names),
    // `cython/tests/run/test_grammar.py:389` (2), `gql-graphql-core/…/visitor.py:121` (4),
    // `sqlalchemy/test/dialect/mysql/test_types.py:646` (4),
    // `wagtail/…/0015_fill_filter_spec_field.py:13` (2) — and they are exactly the population the
    // differential reported as unexplained `contains` rows on the cython rotation that exposed this.
    //
    // EACH NAME CARRIES ITS OWN NODE'S LINE, which is what the analyzer's PY-D21 path does: measured
    // with `.tmp-py/probe-multiline-pattern-lines.mts` on `(alpha,\n beta) = PAIRS`, the analyzer
    // publishes `alpha` at L6 and `beta` at L7. A statement-line rule would put both at L6 and make
    // the second name a phantom MISSING row — the mirror image of the defect this rule fixes.
    if (n.type === "assignment" || n.type === "augmented_assignment" || n.type === "expression_statement") {
      const left = n.childForFieldName("left")
      // An ANNOTATED declaration (`name: bytes`) is a member too, and in a TypedDict it
      // is the ONLY declaration there is — those fields are the class's whole surface.
      // The grammar gives a bare `name: bytes` in a class body as an
      // `expression_statement` holding a `type`, so there is no `left` field to read;
      // the declared name is the `type` node's own first child identifier.
      const nameNode = left && left.type === "identifier"
        ? left
        : n.type === "expression_statement" && n.namedChildCount > 0 && n.namedChild(0).type === "type"
          ? n.namedChild(0).childForFieldName("name") ?? (n.namedChild(0).namedChildCount > 0 ? n.namedChild(0).namedChild(0) : null)
          : null
      if (left && left.type !== "identifier") {
        // The PATTERN case, disjoint from the identifier case above by construction: when `left`
        // exists and is not an identifier it is one of the container shapes `targetNameNodes`
        // knows, and each name in it is this class's member at its own line.
        for (const member of targetNameNodes(left)) {
          add("contains", cls, member.text, member.startPosition.row + 1)
        }
      } else if (nameNode && nameNode.type === "identifier") {
        // PER-SITE, not per-name. `if c: X = A else: X = B` is two assignments in the
        // source and the analyzer publishes two per-site members, which is what lets a
        // `contains` edge resolve by name AND line. Deduplicating by name is right for an
        // INSTANCE attribute (`self.x` in three methods is one attribute) and wrong here.
        add("contains", cls, nameNode.text, n.startPosition.row + 1)
      }
    }
    // A BINDER STATEMENT IN A CLASS BODY DECLARES A MEMBER. Python's class body is a NAMESPACE,
    // so `for i in range(0):`, `with open(p) as fh:` and `try: … except E as err:` written directly
    // in one bind their names in the CLASS namespace exactly as `x = 1` does — the same statement
    // at module scope binds a module name, and this oracle already derives THAT side (nothing, by
    // the scripting-family contract: a module declares no owner). The class side is a member and
    // the analyzer publishes it (PY-D23, round 12), so leaving it underived made every such member
    // look like an edge the analyzer had invented.
    //
    // WHY THIS IS THE LANGUAGE'S RULE AND NOT A MIRROR OF THE ANALYZER: `cython/tests/run/
    // py_classbody.py` states it in its own doctest — `ForLoopInPyClass.k` is `0` and `.m` is `1`,
    // read off the class after three `for` loops in its body — and then records that `.i` raises
    // `AttributeError` because THAT loop's `range(0)` never executes. A member bound lexically by
    // a statement that never runs is still the statement's effect, which is precisely how the
    // analyzer treats `if False: X = 1` too; the line is the TARGET's own, because `contains`
    // resolves by name AND line and the analyzer publishes the symbol at the target node.
    if (n.type === "for_statement" || n.type === "with_item" || n.type === "except_clause") {
      const target = n.type === "for_statement"
        ? n.childForFieldName("left") ?? n.namedChild(0)
        : asBindingTarget(n)
      // EVERY name carries the TARGET node's own line, not each identifier's: the analyzer
      // publishes one symbol per name with the range of the node it read the target FROM, so a
      // multi-line pattern (`for (a,\n     b) in rows:`) puts both members on the pattern's first
      // line. Reading each identifier's line here instead would disagree on exactly that shape —
      // one phantom missing member and one unexplained edge, from a difference in addressing
      // rather than in meaning.
      if (target) {
        const targetLine = target.startPosition.row + 1
        for (const nameNode of targetNameNodes(target)) add("contains", cls, nameNode.text, targetLine)
      }
    }
    // A CALL AT CLASS SCOPE is a call made by the class, and the lane scopes it to the
    // CLASS name: `limit = ValueError("x")` in a class body is `calls K -> ValueError`, not
    // a call by whatever method happens to enclose it and certainly not by the module.
    //
    // This walk derived `contains` and nothing else, so every class-level initialiser —
    // a sentinel exception, a factory call, a default built from another member — was an
    // edge the analyzer emitted and the oracle could not account for. That is the
    // `SLESHostname -> ValueError` / `CollectionSearch -> FieldAttribute` cluster, and it
    // is the Cython `cdef` attribute defaults in `PyrexTypes.py`.
    //
    // The same two conditions `walkBody` applies are applied here, for the same reasons: a
    // builtin is not a graph node, a dunder is filtered, and a Capitalised callee this file
    // declares as a class is an `instantiates` rather than a `calls`.
    if (n.type === "call") {
      const fn = n.childForFieldName("function")
      for (const leaf of calleeNames(fn)) {
        if (!leaf || PY_BUILTINS.has(leaf) || isDunder(leaf)) continue
        if (leaf[0] === leaf[0].toUpperCase() && leaf[0] !== leaf[0].toLowerCase() && classNames.has(leaf))
          add("instantiates", cls, leaf, n.startPosition.row + 1)
        else
          add("calls", cls, leaf, n.startPosition.row + 1)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) walkClassBody(n.namedChild(i), cls)
  }

  /**
   * `fnOwner` is the nearest enclosing FUNCTION, tracked SEPARATELY from `scope` because
   * a class also sets `scope` and the two mean different things.
   *
   * The rule being expressed is one sentence: a `def` opens a scope unless a function
   * already encloses it. Module level has no enclosing function, so a top-level `def`
   * opens one. A class body has no enclosing function either, so a `def` there is a METHOD
   * and opens one. But a `def` nested inside a function or a method is not a symbol and
   * does not open one — its calls belong to the function that encloses it.
   *
   * Deriving that from `scope` alone is what broke the first attempt at this fix: a class
   * sets `scope` to its own name, so `scope ?? nm` made every method inherit its class as
   * its scope and emitted `C -> top` where the analyzer correctly says `meth -> top`.
   */
  const walkScopes = (n: any, scope: string | null, ownerClass: string | null, fnOwner: string | null = null): void => {
    if (n.type === "decorator") return
    if (n.type === "function_definition") {
      const nameNode = n.childForFieldName("name")
      const nm = nameNode ? nameNode.text : ""
      // A NESTED `def` is NOT a scope. This is the analyzer's declared contract —
      // "nested functions are never symbols" — and a call inside one belongs to the
      // nearest enclosing FUNCTION, not to the def that lexically encloses it.
      //
      // The first version of this oracle got it backwards, and the comment here said so
      // out loud ("deeper definitions start their own scope"), which is the worst kind of
      // wrong: a stated rule that happens to disagree with the lane under test. It
      // produced `requests/auth.py: md5_utf8 -> md5` as a MISSING edge while the analyzer
      // emitted the same call under the enclosing function — the same edge counted on both
      // sides of the comparison, inflating `missing calls` and `unexplained calls` at once.
      //
      // Measured over the full corpus, that one disagreement was the largest single
      // cluster in the differential. The fix is to keep the scope we already have: a
      // function opens a scope only when nothing has opened one, which is exactly what
      // "nearest enclosing function" means.
      const inner = fnOwner ?? nm
      const body = n.childForFieldName("body")
      if (body) walkBody(body, inner, ownerClass, inner)
      // THE PARAMETER LIST IS CODE TOO. A default value is an expression that runs when the
      // `def` executes, so `dpkg_options=expand_dpkg_options(DPKG_OPTIONS)` in
      // `ansible/modules/apt.py` is a real call the analyzer records — and this derivation
      // missed it, because `parameters` is a child of `function_definition` but NOT of its
      // `body`, so it went down the `walkScopes` path below, which derives definitions and not
      // calls. Four rows of the corpus's `unexplained calls` were that one clause.
      //
      // The scope is the function itself, matching the lane: the call is written in this
      // function's signature. Whether the MODULE scope would be more truthful is arguable —
      // python evaluates a default once, at `def` time, so `install` itself never calls
      // `expand_dpkg_options` — and that is a question about the lane's convention rather than
      // a missing relationship, so it is mirrored rather than silently changed.
      const params = n.childForFieldName("parameters")
      if (params) walkBody(params, inner, ownerClass, inner)
      // ...AND SO IS THE RETURN ANNOTATION. `-> t.Annotated[..., ParamDesc(["lazy_type"])]` is a
      // call written in the signature, in a subscript inside a type. Same omission as the two
      // above and the same fix: `type` is a child of `function_definition` and not of its body.
      //
      // This is now the FOURTH child of a definition that had to be routed through `walkBody`
      // by hand — body, parameters, superclasses, return type — because `walkScopes` derives
      // definitions and not calls, and every other child of a definition fell through it. The
      // pattern is worth stating rather than leaving as four separate discoveries: a
      // definition's SCOPE and its CODE are different surfaces, and a walk that handles the
      // first and recurses for the rest will silently skip the second every time.
      // The field is `return_type`, NOT `type`. Asking for `type` returns null, and a null here
      // is indistinguishable from "this function has no return annotation" — so the walk did
      // nothing at all and said nothing about it. That is the second time in this file that a
      // wrong field name produced a SILENT no-op rather than an error: the conditional case, and
      // now this. The lane's own `typeClauseOf` scans for a `type` child as a fallback, which is
      // why the analyzer kept working while the oracle quietly stopped.
      const retType = n.childForFieldName("return_type") ?? n.childForFieldName("type")
      if (retType) walkBody(retType, inner, ownerClass, inner)
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c !== body && c !== params && c !== retType) walkScopes(c, inner, ownerClass, inner)
      }
      return
    }
    if (n.type === "class_definition") {
      const nameNode = n.childForFieldName("name")
      const nm = nameNode ? nameNode.text : ""
      const body = n.childForFieldName("body")
      if (body) walkClassBody(body, nm)
      // A BASE-CLASS EXPRESSION IS CODE. `class ObjectProxy(with_metaclass(Meta))` calls
      // `with_metaclass` when the class statement executes, and the analyzer records it as a
      // call BY THE CLASS. `superclasses` is a child of `class_definition` but not of its
      // body, so it took the `walkScopes` path below, which derives definitions and not calls —
      // the same shape of omission as the parameter defaults, and found the same way.
      const supers = n.childForFieldName("superclasses")
      if (supers) walkClassBody(supers, nm)
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c !== body && c !== supers) walkScopes(c, nm, nm, null)
      }
      return
    }
    // Module level: a call outside every definition belongs to the module.
    if (n.type === "call") {
      const fn = n.childForFieldName("function")
      if (fn && scope === null) {
        for (const leaf of calleeNames(fn)) {
          if (!leaf || PY_BUILTINS.has(leaf) || isDunder(leaf)) continue
          // The CONSTRUCTOR CONVENTION APPLIES AT MODULE SCOPE TOO, and this walk was the
          // one place it did not.
          //
          // Every other scope — a function body, a method, a class body — asks whether the
          // callee is Capitalised AND declared as a class in this file, and records
          // `instantiates` when it is. This module-level walk asked neither and recorded
          // `calls`, unconditionally. So `_display = Display()` in
          // `ansible/utils/display.py`, where `class Display(metaclass=Singleton)` is
          // declared 800 lines earlier in the same file, was derived as a call to a
          // function — and the same edge was then counted on BOTH sides of the comparison,
          // as the oracle's `calls` "missing" and the analyzer's `instantiates`
          // "unexplained". That is 282 of the 435 disagreements left in the lane, and it
          // came from one branch that had drifted from the rule the other four follow.
          //
          // The condition is unchanged, not relaxed: Capitalised is PEP 8's convention and
          // is checked against the tree rather than trusted, and `classNames` is what makes
          // the claim checkable — an imported `TypeVar(...)` is still a `calls`.
          if (leaf[0] === leaf[0].toUpperCase() && leaf[0] !== leaf[0].toLowerCase() && classNames.has(leaf))
            add("instantiates", moduleName ?? "", leaf, n.startPosition.row + 1)
          else
            add("calls", moduleName ?? "", leaf, n.startPosition.row + 1)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) walkScopes(n.namedChild(i), scope, ownerClass, fnOwner)
  }
  walkScopes(rootNode, null, null, null)

  return edges
}
