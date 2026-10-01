# real-python-analyzer.md

## Language

- Analyzer file: `src/ast/real-python-analyzer.ts`
- Parser: `tree-sitter-python` **0.25.0** (npm, latest — upgraded from the stale
  pre-0.25.0 pin in M12.27; WASM at `wasm/tree-sitter-python.wasm`, loaded by
  `engine.ts` via `resolveWasm`)
- Grammar **pinned** (`PY-2`): sha256 `16108b50df4e…`, 457,883 B, with the full enumerable
  surface recorded. The registry copy at `~/.bb/wasm/tree-sitter-python.wasm` (476,105 B, a
  different sha) is recorded as **`differs`** — an attributed fact, not a silent divergence.
  It matters because the two builds disagree about the *language*: the registry build fails to
  parse PEP 678 `except*`, produces an ERROR node on valid Python 3.11, and drops a handler
  from the tree, where the repo build parses it cleanly (the exercising file,
  `cython/tests/run/test_except_star.py` with 66 sites, is one of python's own named corpora).
  Which build loads was decided by a path list rather than a hash — the M49 W16 incident
  rather than a near miss of it. 137 of 267 shared types sit at different ids; the analyzer
  makes **0** numeric node-id comparisons, so extraction is unaffected by the shift.
- Language detection: extensions `.py` / `.pyi` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealPythonAnalyzer`

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `function_definition` → `name` identifier; `class_definition` → `name` identifier; `decorated_definition` unwraps to the inner definition (range includes the decorators, matching the JS family); methods → method name; `assignment` in class body → assigned identifier (Property); enum members → `enum_member` via constant-value assignment; `import`-derived re-export aliases |
| kind | ✅ | class → Class; enum subclass (`class X(Enum)`) → Enum, constant assignments → EnumMember; def → Function; method in class body → Method; class-body assignment → Property; module-scope `T = TypeVar(...)` → Variable; `__all__` exports |
| qualified/container name | ✅ | `ownerName`/`ownerKind` from the nearest enclosing class scope; module-level symbols are ownerless (Python has no module declaration — JS-family contract) |
| range (start/end line + column) | ✅ | `node.startPosition`/`endPosition` via `nodeToRange`; decorated definitions span decorator → body end |
| parameters | ✅ | `parameters` → `identifier` / `typed_parameter` / `default_parameter` (name only; never symbols) / `list_splat_pattern` / `dictionary_splat_pattern`; async functions use `function_definition` with the anonymous `async` token (grammar emits no `async_function_definition`) |
| returnType / type | — | Python annotations are recorded in metadata only when trivially available; not a contract field |
| documentation/comments | ✅ | preceding `comment` nodes (`#` and docstrings) via pure-String helpers |
| complexity metrics | ✅ | branching nodes counted iteratively on the single-pass walk |
| syntax errors | ✅ | ERROR/missing nodes surfaced by the engine pipeline; reported as `parseErrors` in the differential |
| decorators/attributes | ✅ | `decorator` nodes captured as metadata (`@logged`); decorator calls are metadata, NEVER call edges |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ | `call` → callee leaf (member expressions reduce to leaf: `self.store.get()` → `get`); source = enclosing function/method leaf name; builtins filtered (full `PYTHON_BUILTINS` set), dunders (`__x__`) filtered; `super()` filtered; nested functions (e.g. `wrapper` inside `logged`) and function locals (`store`, `service`) never change the call source. **PY-11:** an UPPERCASE callee not declared in this file is a `calls` edge, not a dropped one — measured 889 of 1,152 such callees (77.2%, 368 of them explicitly imported) produced NO relationship before the fix, and `module = AnsibleModule(...)` is the shape, once per file, across a corpus | 0.9 |
| extends | ✅ | `class_definition` → base-class argument list (`Repository[User]` → leaf `Repository`); `Generic[T]` → `Generic`; dotted `a.b` → `b`; `Enum` bases detected for kind | 1.0 |
| instantiates | ✅ | uppercase-head call with the target in the O(1) `declaredTypes` set (in-file class/enum only — imported classes like `TypeVar` are external, no in-file target); Python has no `new` keyword | 0.9 |
| imports | ✅ | `import_statement` / `import_from_statement` → module leaf → `${modulePath}:${item}`; relative imports (`from .models import User`) → module leaf | 1.0 |
| exports | ✅ | `__all__` assigned a `list` **or** `tuple` literal → each string item; module-level names. **PY-14:** tuple-only reading left 3 of 16 corpus `__all__` assignments (19%) publishing nothing. Each edge and each `exports` entry records the **declaring form** (`dunderAllForm` / `form`) — provenance, since `list` and `tuple` are one declaration to `from mod import *`. A `NAME` in the literal, a concatenation, and `.extend()` are declared boundaries (pinned as forbids) | 1.0 |
| overrides | ✅ | resolved against the class's **DECLARATION** (`name@startLine`), never its name — two `class C` declarations in one file are unrelated, and a name-keyed lookup gave a base-less class its namesake's bases. A base spelling the class's own name is excluded from both this derivation and `extends` (#299), so a rebind class overrides nothing and never overrides itself; method whose name is found walking the **real MRO**, not the leftmost base — **PY-8**: `Requirement.__new__` pointed at a mixin that does not define `__new__`. `object.__init__` is a verified universal fact (0.95). The **first-parent guess is 0.5**, not 0.95: it is a cross-lane family contract (php/ruby/python/js/perl/java/swift) pinned by `python/external-override`, and python does not remove it unilaterally. Measured over 400 corpus files it fired 1,163 times and was confirmed **0** times — the companion-index tier above it is never populated (**PY-7**) | 0.95 verified / 0.5 guessed |
| contains | ✅ | computed from `ownerName` on symbols (single pass) — class members, enum members, record fields. Three boundaries, one rule read three ways, all confirmed against CPython's `vars()`: a class in a **class body** gets `ownerName` and IS a member (`Outer.Inner` resolves); a class in a **method or function body** does not (`Outer.Local` does not resolve); and a name bound inside a **lambda or comprehension** is that function's local, never a member | 1.0 |
| uses | ✅ | member **read** `self.x` → leaf, marked `isMemberRead`; assignment targets, call callees (`self.ping()` — the attribute IS the call) and call receivers (`self.svc.ping()` — `self.svc` is traversal) are excluded, so a read is only ever a read | 0.9 |
| references | — | not emitted; name identity is carried by imports/exports/calls, and a second edge for the same fact doubles the graph without adding information | — |
| depends | — | not emitted (covered by imports) | — |

## Supported constructs

- Modules: `import x`, `from x import y`, relative imports (`from .models import ...`) — `__init__.py`
- Classes: bases (incl. generic subscripts `Repository[User]`), class-body assignments → Property, enum subclasses → Enum + EnumMember, `__init__` → method — `models.py`, `Service.py`
- Functions: def, async def, nested functions (never symbols), decorators (metadata only) — `service.py`
- Inheritance: multi-base extends + **MRO-ordered** overrides — `Service.py` (`UserService(BaseService, Repository)`)
- Exports: `__all__` — `__init__.py`
- Comprehension helpers: synthetic `_comprehension_helper` module functions are real AST artifacts (tree-sitter synthetic), kept as functions

## Grammar & corpus

- **Grammar upgraded in M12.27** from the stale pre-0.25.0 pin to npm
  `tree-sitter-python` 0.25.0. The corrected wasm comparison (fresh
  subprocess per scan — the old in-process swap was silently invalid because
  `_autoLoadWasm` caches registry bytes at module init, so both scans read
  the pinned grammar) proves the upgrade: **9 → 7 error files** on the cython
  corpus (fixes `test_tstring.py` + `test_templatelib.py`, Cython fused-type
  template-string prefixes; **0 regressions**), and recovers the correct
  `overrides` edge on generic-subscript bases (`Repository[User]`) that the
  pinned grammar silently missed.
- Shape-safe: **51/51** analyzer node-type refs live in the grammar's emitted
  types (4 remaining refs are anonymous keyword tokens `and`/`async`/`import`/
  `or`, confirmed via the anonymous-child scan).
- Corpus: `cython@51a460b7` (243 tracked `.py` files ≥ 1 KB), 7 grammar-error
  files (2.9%), 0 crashes — all Cython-specific extensions recorded honestly
  (memoryview slice annotations `double[:]`, `Bar[:, :, :]`; `Optional[cython.int]`
  fused-type syntax; template-string prefixes; pattern-matching edge cases),
  none are defects on real Python.
- Complexity: 15,558 symbols / 30,901 relationships on the 243-file corpus;
  **64 parser error nodes across 7 error files**, zero O(n²) — the
  instantiates check uses the O(1) `declaredTypes` set (was a per-uppercase-call
  `symbols.some()` scan), and override/extends lookups use maps. The tracked
  production measurement is versioned at
  `validation/m12/results/python-corpus-complexity.json`.

## Module scope

`metadata`-free statements are attributed to the **module scope**, which is the filename stem
normalised to a legal Python identifier. Two defects lived here:

- **PY-4** — the scope was the literal string `"global"`, a *keyword* used as a name. Not
  navigable, absent from the indexer's `GENERIC_SOURCE_NAMES` (the list of names the store
  knows are synthetic scopes), and contradicting the same analyzer's own `imports` edges, which
  already used the module stem.
- **PY-13** — the stem was used verbatim, so `my-module.py` published the scope `my-module`:
  not a valid identifier, not a name a symbol could carry. Now normalised, with a leading digit
  prefixed so the result is legal rather than legal-looking.

## Frameworks

`metadata.framework` is a **single primary pick**, so the table admits frameworks only — never
libraries. Detection is by **import root read from the parsed AST**, never by text, and the
table is one root per line so a marker that stops matching is a visible deletion.

**Measured, and the reason the table grew (PY-15).** Over 3,271 corpus files carrying 160
distinct non-stdlib import roots, **7 of the 9 declared roots fired zero times** — `celery`,
`django`, `fastapi`, `flask`, `sqlalchemy`, `starlette`, `tornado` — and only `pytest` (1,010
sites) and `aiohttp` (1) matched anything. The original census had established *reachability* by
parsing a minimal Django model and a minimal Flask app; reachability was reported as coverage,
and a table whose rows fire looks identical to a table whose rows do not. `ansible` — the
corpus's dominant framework at 3,452 sites across 322 directories — was absent, leaving 1,059
files with no primary framework. Four roots added: `ansible`, `setuptools`, `sphinx`, and
`unittest`, the last being the **standard library's** own test framework (132 corpus files)
while `pytest` was already present. Testing frameworks sort **last**, so the primary pick is the
application framework in a file that imports both.

**PY-17 — there are two python framework tables and the field is their union.**
`enhanceWithFrameworkIntelligence` merges `FrameworkDetector.detectPythonFrameworks` into the
same metadata, so neither table alone explains what a consumer reads: `pandas`, `numpy`,
`tensorflow` and `pytorch` come only from the shared detector; `starlette`, `sqlalchemy`,
`aiohttp`, `celery`, `ansible`, `setuptools`, `sphinx` and `unittest` only from this lane; and
`django`, `flask`, `fastapi`, `tornado` and `pytest` are in **both** and free to drift.

**PY-16 — Cython is not recorded here.** It is the corpus's second-largest root (260
lower-case + 169 capitalised sites) and it is a *dialect*, and no lane in this repository
publishes a `dialect` field, so the only way to record it would be as a framework. Pinned by
exhaustion: `python/framework-marker-coverage` asserts `detectedFrameworks` as an exact ordered
list, so adding a Cython marker fails on purpose.

## Complexity envelope

Zero O(n²) on the measured corpus. The `instantiates` check is an O(1) `declaredTypes` set
lookup (it was a per-uppercase-call `symbols.some()` scan); override and extends resolution go
through maps; the MRO walk is bounded by the base list; the relationship dedup key is a `Set`.

Measured over the pinned corpus: **3,271 files, 23,911 symbols, 99,743 relationships in 66.7s
via `ASTEngine.parseFile`, 0 parse errors.** The dedup key includes the edge's **site line**
(**PY-6**): keying on `(type, source, target)` is strictly coarser than the store's own
`(source, type, target, line)` key, and python makes that bite because the canonical property
is a getter/setter pair — both `def`s are real symbols, and one `contains` edge was emitted, so
the setter was unreachable from its class. 6 missing `contains` over 120 files before the fix,
0 after.

## Differential ground truth

`validation/m12/results/python-differential.json` is a **mirror** (`truthSource:
"manual_audit"`, 108 facts, 5 `unknown`, two synthetic fixtures), so it cannot falsify the
analyzer — it was written by reading the same source the analyzer reads.

An **independent** oracle derives truth from the tree without importing the analyzer:
`script/m14/oracles/python-truth.ts`, with a runnable comparator in `python-truth-diff.ts` on
two axes — **membership** (is the edge present) and **multiplicity** (is it present the same
*number* of times, which a set comparison cannot see and which is where PY-6's defect class
lives).

**It derives all nine types this analyzer emits**, on two axes, over 3,271 corpus files:

| Type | Agreed | Missing | Unexplained |
| --- | --- | --- | --- |
| `calls` | 59,211 | **0** | **0** |
| `uses` | 39,085 | **0** | **0** |
| `contains` | 28,232 | 1 | **0** |
| `imports` | 15,160 | **0** | **0** |
| `references` | 12,280 | **0** | **0** |
| `extends` | 3,505 | **0** | **0** |
| `instantiates` | 1,645 | **0** | **0** |
| `overrides` | 1,883 | **0** | **0** |
| `exports` | 93 | **0** | **0** |

**161,094 edges agreed by two derivations that share no helper; 1 disagreement, 99.9994%.**
The four types added last (`uses`, `references`, `imports`, `exports`) came back perfect on their
first full run — 66,621 edges that had been verified by nothing until then.

The run started at 90 disagreements and ended at 1. Nine were real analyzer defects and are
listed in `docs/analyzers/python.md`; the rest were oracle bugs, which is the ordinary order of
things — an oracle written alongside the code it checks inherits the same assumptions, and each
one it got wrong produced a round of *false* rows pointing at code that was fine. Fixing those
made the number fall, and every drop was checked against CPython rather than against the count.

Three details in those derivations are why they came back clean, and each was wrong first:

- **`uses` excludes four shapes**, each because something else already carries the fact: an
  assignment LHS is a *write* (`extractAssignment` emits it), a call's function child is a *call*,
  a member-call receiver is *traversal*, and an augmented-assignment LHS is also a write.
- **`references` is sourced to whoever WROTE the annotation**, not to whoever is mentioned —
  python keeps type information in annotations, so `x: T` inside a function belongs to that
  function. It dedupes per `(source, target, kind)`, so one identifier serving as both a
  parameter annotation and a return annotation publishes two edges naming the same node; keying
  the derivation on the LINE collapses them, which is why `addByKind` exists.
- **`exports` reads a `string` node's CONTENT**, not its text — `.text` is `"User"` *with the
  quotes* — and handles `augmented_assignment`, since `__all__ += [...]` is how a module extends
  its own surface.

**The 1 that remains** is not claimed to be correct in either direction: `contains MethodRedef
-> a`, in `cython/tests/run/class_scope.py`, where `def a` is declared at L10 and again at L13.
The lane publishes one edge at the **last** declaration (M60 #748: a genuine rebinding
collapses); the oracle publishes both, per site. Which is right is genuinely undetermined — see
"Known gaps" in `reviews/python/master-review.md` — and it is reported rather than closed
because both readings were tried against the corpus and each broke a larger set of true
declaration-chain edges (`HTTPBasicAuth.__init__` twice, `Prop.prop` four times) in the other
direction. A residual that resists two honest attempts is a decision to escalate, not a bug to
paper over.

**The harness also reports, permanently:** 6,787 declared guesses confirmed by the tree **0**
times, and 1 file truncated at the 1 MiB parse limit whose unread tail is a PY-19 coverage
concern rather than an analyzer error — now **disclosed on the result** rather than in a log
line, as an `errors` entry carrying both byte counts and the percentage, plus a structured
`metadata.truncated` so the oracle mirrors the parse without copying the limit constant.
Multiplicity disagreement is **5**, all the
line-continuation shape (PY-22): the store keys a `calls` edge on `(source, type, target,
line)`, so two calls of one name on one line collapse and the same two on two lines do not.

### Three defects the differential found in this analyzer

| Defect | Kind | Effect |
| --- | --- | --- |
| A class nested in a **class body** had no `ownerName`, so no `contains` | loss | 60 edges recovered |
| A name bound in a **lambda or comprehension** was published as a class member | fabrication | 20 edges removed |
| Override bases keyed by class **name**, merging same-named classes | misattribution | 32 edges corrected |
| A class **variable** satisfied the "base declares this name" test | fabrication, marked **verified** | 22 fabricated edges at 0.95 |

Each was settled by asking **CPython** — `vars()` and `ast.walk` — rather than by argument. The
third is the one worth remembering: it neither added nor removed an edge, it pointed a
*correct-looking* edge at the wrong class, which is the failure mode neither a count nor a set
comparison can see. That is the whole argument for having built the instrument: a reviewer reading
`basesByClass.get(s.ownerName)` would have seen a Map lookup and called it correct.

## Evidence pointers

| Claim | Artefact |
| --- | --- |
| grammar bytes, sha256, both-direction drift | `validation/m14/grammar-pins.json` (lane `python`) |
| 19 fixtures | `validation/m14/fixtures/python/` |
| 30 mutants, all caught | `script/m14/mutate-analyzer.ts`, ids prefixed `python/` |
| node-type classification, 0 unclassified | `script/m14/spec/python-completeness.json` |
| independent truth + comparator | `script/m14/oracles/python-truth.ts`, `python-truth-diff.ts` |
| the measurements and the defects | `reviews/python/master-review.md` |
| lane contract | `docs/analyzers/python.md` |

## Census

- Baseline (M12 issue #166): 5 census regex entries in `real-python-analyzer.ts`
  (decorator `@` strip, quote strips, module-name extension strip).
- After M12.27: **0** (all replaced with pure char scans / AST token reads).
  Project census: 69 → 64.
