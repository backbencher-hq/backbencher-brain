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
| references | ✅ | `references` is sourced to whoever WROTE the annotation, not to whoever is mentioned — python keeps type information in annotations, so `x: T` inside a function belongs to that function. `assignment` / `typed_parameter` / `typed_default_parameter` → `declared_type`; `function_definition` → `return_type`; `isinstance(x, T)` / `issubclass(a, B)` → `instanceof_check`. Dedupes per `(source, target, kind)`. Builtin scalars (`str int float complex bool bytes object None Any self cls`) excluded. Measured 21,028 edges over 5,365 corpus files. **This row previously read "— not emitted"; that was wrong and is corrected here** — the code emits it at `extractDeclaredTypeRefs`, the differential has audited it since it was written, and the same file's differential table below already credited 12,280 agreed edges to it | 0.95 |
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

Measured over the pinned corpus: **3,271 files, 45,560 symbols, 230,420 relationships in 66.7s
via `ASTEngine.parseFile`.** 821 syntax-error nodes land in 44 files, 776 of them in 29 files
that are not Python — `otp`'s `asn1_SUITE_data/*.py` holds **ASN.1 notation**
(`Int DEFINITIONS ::=`) under a `.py` extension — so the remainder is 15 real files (14 cython,
1 hledger). An earlier version of this sentence said `0 parse errors`; that was measured before
those files entered the corpus and is no longer true. The dedup key includes the edge's **site line**
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
The four types added last (`uses`, `references`, `imports`, `exports`) agreed with the oracle on their
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

**The harness also reports, permanently:** 4,690 declared guesses confirmed by the tree **0**
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

## Relationship ontology — verdicts with numbers (branch `analyzer/PY_INSTRUMENTS`, 2026-10-05)

Every one of the ten types carries a measured verdict. The instrument is
`script/m14/python-ontology-census.ts`, which runs the analyzer through the PRODUCTION
entry (`parseFile` from `src/ast/pool-worker.ts`) over the **whole** pinned population:
**5,365 tracked `.py`/`.pyi` in 5 git checkouts under `fixtures/repositories/python-corpus/`**
(ansible 1,857 · django 2,933 · flask 83 · pydantic 455 · requests 37), plus the
**unpinned `python-corpus/cpython-stdlib`** (621 files) measured on separate counters and
never merged. 5,365/5,365 parsed, 0 parse failures, 0 degraded, 108,689 symbols,
566,728 relationships, 3 error nodes in 2 files.

`imports[]` is reported on its own channel throughout: `ParseResult` carries it separately
and `parallel-indexer` writes it to the `brain_import` **table**, never to
`brain_relationship` rows.

| type | verdict | edges | files | resolving (declared / imported / neither) |
| --- | --- | --- | --- | --- |
| calls | EMITTED | 243,619 | 3,992 | 11.2% / see below / 88.8% |
| uses | EMITTED | 140,435 | 2,909 | 32.9% / see below / 67.1% |
| contains | EMITTED | 72,371 | 3,030 | **100%** / — / 0% |
| imports | EMITTED (relationship channel) | 37,832 | 4,212 | 0% / — / 100% by design |
| references | EMITTED | 21,028 | 1,285 | 16.9% / see below / 83.1% |
| exports | EMITTED | 1,564 | 143 | 51.7% / — / 48.3% |
| extends | EMITTED | 15,887 | 2,654 | 23.3% / — / 76.7% |
| overrides | EMITTED | 26,397 | 1,986 | 5.6% / — / 94.4% |
| instantiates | EMITTED | 7,595 | 909 | 89.9% |
| **implements** | **RULED** | 0 | 0 | — see below |

### `implements` — RULED, with the falsification written out

The one type this analyzer does not emit. Ruled on **instrument A** (grammar inventory)
with **instrument B** published alongside, so the choice is the supervisor's:

- **A.** The pinned grammar produces **196 distinct node types** over the pinned
  population (198 across both) and **0 of 17** node-type names that would express a
  conformance clause is among them.
- **B.** Python's interface system is real and the corpus uses it: **14 ABC bases and 57
  Protocol bases over 16,377 base-list entries (0.43%)**, plus 134 `@abstractmethod`
  methods. All 71 base entries are already published as `extends`, because
  `class C(X)` means the same thing whatever X is — `issubclass(C, X)` is True for a
  concrete base, an `abc.ABC` and a `typing.Protocol` alike, and X is in `C.__mro__` in
  all three.
- **The deciding count.** Python *does* have conformance without inheritance:
  `SomeABC.register(SomeConcrete)`, true for `issubclass` with no base-list entry.
  Measured tight it reads **0 occurrences in 0 files over 5,986 files**, against 365
  loose `.register(` calls in 75 files that are object and plugin registration.

`PYTHON_RULED_INSTRUMENT_B` is exported from `script/m14/python-ruled.ts`; registering it
makes the gate report FALSIFIED with **71 occurrences across 33 files**, and those figures
are re-verified by `validation/m14/fixtures/python/ruled-probe-check.ts` on every run.
Probe: `validation/m14/fixtures/python/implements-probe.ts` (calibrated; `--self-test`
asserts exact counts and a corpus run exits non-zero if calibration fails).

## The six questions, per emitted type

Source derivation answers only question 1. Each of the others has a measurement.

| type | 1 exists | 2 fires | 3 oracle agrees (django, 2,933 files) | 4 labelled | 5 resolved | 6 confident |
| --- | --- | --- | --- | --- | --- | --- |
| calls | ✅ | 243,619 | 102,940 agreed · **4 missing · 5 unexplained** | ✅ | 11.2% in-file | 0.9, no reason code |
| uses | ✅ | 140,435 | 54,259 agreed · 0 · 0 | ✅ | 32.9% in-file | 0.9, no reason code |
| contains | ✅ | 72,371 | 47,995 agreed · **1 missing · 1 unexplained** | ✅ | **100%** | 1.0 structural |
| imports | ✅ | 37,832 | 19,200 agreed · 0 · 0 | ✅ | n/a by design | 1.0 import_based |
| references | ✅ | 21,028 | 1,582 agreed · 0 · 0 | ✅ | 16.9% in-file | 0.95 |
| exports | ✅ | 1,564 | 823 agreed · 0 · 0 | ✅ | 51.7% in-file | 1.0 structural |
| extends | ✅ | 15,887 | 8,395 agreed · 0 · 0 | ✅ | 23.3% in-file | 1.0 structural |
| overrides | ✅ | 26,397 | 943 agreed · 0 · 0 · **21,024 guesses REFUTED, 0 confirmed** | ✅ | 5.6% in-file | **94.3% below 0.7** |
| instantiates | ✅ | 7,595 | 2,077 agreed · 0 · 0 | ✅ | 89.9% in-file | 0.9 |

**238,214 edges agreed over 2,933 files; 5 missing, 6 unexplained.** All eleven
disagreements are in two files and one shape: `django/template/loader_tags.py` is a
module that mixes several classes and the two derivations disagree about which method
owns a call, and `test_forms.py`'s `DateTimeForm -> datetime` is a class whose name is
bound twice. Neither is a count artefact, and both are reported rather than closed
because the ownership question is the same undetermined one the doc records for
`contains MethodRedef -> a` under Known gaps.

1. **Exists** — `ASTEngine.RelationshipType.<X>` appears in the source (derivation only).
2. **Fires** — the census counts above, from `parseFile` on 5,365 real files. No type is
   reachable only from a branch that never matches.
3. **Oracle agrees** — `script/m14/oracles/python-truth.ts` + `python-truth-diff.ts`,
   a separate walker sharing no helper with the analyzer, over django's 2,933 files and
   requests+flask's 120: 238,214 + 10,911 edges agreed, 5 missing, 6 unexplained, 61
   multiplicity disagreements, and — the number that matters — **21,024
   `first-parent-guess` overrides refuted by the tree and 0 confirmed** on django, 204
   refuted and 0 confirmed on requests+flask.
   **Stated limitation, per the workstream: both walk the SAME grammar, so a grammar bug
   shared by the analyzer and the oracle is invisible to this check.** The check bounds
   disagreement between two derivations, not correctness of the grammar both read.
4. **Labelled** — no cross-type mislabelling found. `references` was re-checked because
   this file's own table previously claimed it was not emitted at all.
5. **Resolved** — the three-way split. A target counts as *imported* only if this file's
   own `imports[]` names it, which is what separates ordinary cross-file traffic from a
   name nothing here accounts for. `imports` is 0% by design: its target is
   `module:item`, a foreign-key-shaped name, not a symbol in this file.
6. **Confident** — `evidenceClass` is present on **100%** of edges for every type.
   `overrides` is the outlier and is honestly labelled: **24,879 of 26,397 edges (94.3%)
   sit below the 0.7 threshold** at 0.5 with `reasonCode: first-parent-guess`, plus 35
   `object-init-universal` at 0.95 and 1,483 at 0.95 verified. Mean confidence 0.526.

### Rule R7 and the standing rules

`emptySymbolNames 0` · `emptyOrUnknownKind 0` · **placeholder endpoints 0** · empty
endpoints 0. Two `uses` edges have a target whose VALUE is the literal `unknown`, and both
are real reads — `return obj.unknown` (django) and `SafeUUID.unknown` (pydantic) — so the
census asks the tree before convicting them. A bare value test would have reported a
fabricated defect.

## DERIVATION findings — this lane has three

The gate that reports these is `script/m14/verify-label-coverage.ts`, and it **cannot
measure this lane**: `LANG_REPOS.python = "cython"` (`differential.ts:455`) and
`LANG_REPOS_SECOND.python = "requests"` (`:613`), and neither is a top-level directory
any more — both now live inside `python-corpus/`. Measured 2026-10-05 it prints
`skipped (not a pass): python (no files under cython)`.

`validation/m14/fixtures/python/derivation-audit.ts` stands in for it, EXTRACTING the
compared-label allowlist out of `differential.ts` and evaluating it for `lang="python"`
rather than copying it:

| | edges (400 of 5,365) | files | verdict |
| --- | --- | --- | --- |
| `contains` | 5,054 | 238 | **DERIVATION — compared by nothing** |
| `imports` | 2,855 | 324 | **DERIVATION — compared by nothing** |
| `exports` | 118 | 9 | **DERIVATION — compared by nothing** |

**8,027 of 40,785 emitted edges (19.7%) are audited by nothing.** `imports` is the sharpest:
the analyzer emits 37,832 `imports` *relationship* edges at 1.0 across the full corpus AND
fills `imports[]` with 37,905 rows, and the differential compares neither for python.
Also measured: `implements` is IN the compared-label list while this lane emits zero of it,
because that harness entry is unconditional — python's instance of the `brain_import`
denominator question raised in `REVIEW-2026-10-04` §1.

## Payload

`validation/m14/fixtures/python/payload-measure.ts`, production `parseFile`, 400 of 5,365
files: 40,769 relationships, **10.9 MiB un-narrowed**, of which `calls` 43.9% and `uses`
27.0% of bytes. Narrowing to `calls` alone is 2.3×; to `exports` alone, 379×. python's
un-narrowed payload is dominated by two labels, so a caller narrowing to the kinds it asked
about saves proportionally less than the 2.5–4.8× band the workstream records for lodash and
ripgrep — those graphs were not 71% calls+uses. **No edges were added on this branch**
(`implements` is RULED and the analyzer's only change is a comment), so these are standing
figures, not a before/after pair.

## Which fleet instruments can measure this lane (measured 2026-10-05)

Four of them cannot, and they share ONE root cause: the corpus was reorganised into
`python-corpus/` (an aggregate of five git checkouts plus one unpinned directory) and the
shared pins still point at the old layout.

| instrument | what it does | measured result |
| --- | --- | --- |
| `script/m14/firing-check.mjs` | run the analyzer through production, tally types | `LANES.PYTHON` points at `python-codesql`, absent. Prints `PYTHON 0 types fired / NO CORPUS under python-codesql` and a SILENT list of all ten, **exit 0** |
| `script/m14/firing-check-v2.mjs` | the corrected version | no `PYTHON` entry in `LANES` at all; `PY_INSTRUMENTS` → exit 2, "no lane matches" |
| `script/m14/ontology-coverage-gate.ts` | the ARBITER | admits corpus only from a git-tracked **top-level** dir; prints `corpus: 424 admitted files` and then exits 2, "no RULING SOURCE for python". The 424 are stray `.py` inside other languages' repos (swift-corpus 286, haskell 41, otp 32, ruby 20) — 5,982 vs 424 is a 14× wrong population |
| `script/m14/verify-label-coverage.ts` | the DERIVATION gate | `LANG_REPOS.python = "cython"` (`differential.ts:455`), `LANG_REPOS_SECOND.python = "requests"` (`:613`); neither is top-level any more. Prints `skipped (not a pass): python (no files under cython)` |

An earlier note in this lane's history recorded `firing-check.mjs` as throwing a
TypeError. It does not: it prints a **complete, confident, wrong** report and exits 0.

All four are supervisor-owned. The one-line fixes are in `script/m14/python-ruled.ts`
(the arbiter's import) and are named in this report; none was made here.

## Census

- Baseline (M12 issue #166): 5 census regex entries in `real-python-analyzer.ts`.
- After M12.27: **0**. Project census: 69 → 64. Re-measured 2026-10-05: `real-python-analyzer.ts`
  contributes **0 regex literals**, and the whole-tree census reports 4, all in
  `real-svelte-analyzer.ts`. The analyzer and all five lane instruments on this branch were
  re-checked through the TypeScript AST: **0 regex constructs across 6 files**.
