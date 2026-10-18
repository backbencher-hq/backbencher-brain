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
| **implements** | **EMITTED** | 333 | 97 | 60.4% / 31.2% / 25 ambiguous · **0 unresolved** |

### `implements` — EMITTED, and the ruling it reversed

This section used to open "The one type this analyzer does not emit", ruled on **instrument
A** (grammar inventory) with instrument B published as the falsifier. **That ruling was
reversed on 2026-10-09 (PY-27 → PY-34), and the reversal is kept visible here rather than
quietly overwritten** — the earlier verdict was confidently wrong in exactly the way
`docs/M14-HONESTY-CONTRACT.md` exists to stop, and a reader who met it has to be able to see
where it went.

WHY A WAS THE WRONG INSTRUMENT. A is true and it is the wrong test: the pinned grammar
produces **196 distinct node types** over the pinned population (198 across both) and **0 of
17** conformance-clause node-type names is among them. But in python the conformance relation
does not arrive as its own node — it arrives INSIDE the base list (`class C(Mapping)`), which
is precisely where every other OO language puts `extends`. Instrument B had already measured
the construct as present: **14 ABC bases and 57 Protocol bases over 16,377 base-list entries
(0.43%)**. The lane's earlier reading published all 71 as `extends` on the ground that
`issubclass(C, X)` is True for a concrete base, an `abc.ABC` and a `typing.Protocol` alike;
the reversal accepts that reasoning and then asks the grounding question — **which of the two
facts IS the edge?** PY-34 ruled ONE edge per base, the most specific true label
(`implements`), with the inheritance fact carried where the store WALKS it:
`metadata.superTypes` is published from the FULL base list, the indexer copies it into
`brain_symbol.super_types`, and that column is what `member-owner-resolution` and
`override-retarget` read. The additive reading — both labels for one base — is now a FORBID
row in `python/interface-implements` and `python/interface-qualified-subscript-head`.

WHAT MAKES A BASE PROVEN is the **FILE'S OWN IMPORT**, never the spelling. `ABC` and
`Protocol` are legal class names a user may declare — 27 `Protocol` base occurrences in this
corpus are exactly that, 24 of them inside CPython's own `typing.py`, which DEFINES the class
it then names — so the proof is an import in the file, a dotted spelling whose ROOT the file
imported, or a class this file itself declares abstract by its HEADER (`metaclass=ABCMeta`).
Three measured boundaries:

- `typing.Generic` is EXCLUDED at **291 base occurrences** — more than `ABC` and `Protocol`
  combined — because it is a type-parameter marker, not an interface. Without that exclusion
  `implements` reads 301 edges on the fixture's 200-file frame rather than 10, and is wrong
  about every one of them.
- An `@abstractmethod` is NOT a declaration, and that is measured on the interpreter rather
  than ruled: `__abstractmethods__` is computed by `ABCMeta.__new__`, so a decorator on a
  class whose metaclass is `type` is a marker the interpreter does nothing with
  (`python/interface-declaration-needs-abc-meta` pins `SubNoopAbstract`/`SubPlain` as forbids).
- A bare marker name is POSITIONAL. `python/interface-implements` pins both halves: a class
  declared BEFORE a local `class ABC` inherits the stdlib one (`from abc import ABC` still
  binds it), and one declared AFTER inherits the local class — `__bases__` prints the
  identical `ABC` for both, so only the binding order answers it.

MEASURED, after the change. The population is the whole python surface on this box — the arbiter
admits **11,488 `.py`/`.pyi` files** and walks them COMPLETE (`bun script/m14/ontology-coverage-gate.ts
python --fresh`). Edges from the arbiter's own table; the target-resolution split from
`npx tsx script/m14/python-endpoint-resolution.ts` on the same population:

| | edges | files | resolved | external | ambiguous | UNRESOLVED |
| --- | --- | --- | --- | --- | --- | --- |
| `implements` | 333 | 97 | 201 | 104 | 25 | **0** |

By reasonCode: `in-file-interface-base` 189 (170 resolved + 19 ambiguous),
`stdlib-interface-marker` 141 (31 resolved + 6 ambiguous + 104 external — the target is a stdlib
name this file imports and the corpus does not declare), `virtual-registration` 3 (1 resolved +
2 ambiguous). **Zero unresolved** is the number that matters: an `implements` edge never names a
target the graph cannot hold.

The register tier — conformance with NO base-list entry — IS implemented, and its guard is the
measurement that keeps it small. Measured over 5,984 corpus files there are **493 `X.register(Y)`
calls and ONE whose receiver is provably an abstract base class** (`site.register` alone is 241,
followed by `selector.register`, `SyncManager.register`, `self.register` and Flask's
`blueprint.register`), and the surviving site is real: `collections.abc.Sequence.register(Row)` at
`sqlite3/dbapi2.py:54`. That site lives in the UNPINNED `cpython-stdlib` directory, which is why
the PINNED-population probe (`implements-probe.ts`) reads **0 occurrences in 0 files over the
pinned 5,365**: the two numbers describe two populations, not a contradiction. `implements`
therefore has exactly two source shapes — the base list (tiers 0 and 1) and a PROVEN `ABC.register`
receiver (tier 3) — and the second is derived by the oracle too, so a differential can find it.

Probe: `validation/m14/fixtures/python/implements-probe.ts` (calibrated; `--self-test`
asserts exact counts and a corpus run exits non-zero if calibration fails).
`PYTHON_RULED_INSTRUMENT_B` in `script/m14/python-ruled.ts` is kept as the *measurement* of
instrument B, not as a falsifier this lane is now accountable to.

**EXTENDED 2026-10-10 (round 3)** so the arbiter's SPACE attestation has something to point at: the
probe now honours `BB_PY_CORPUS` (the env var `python-construct-census.mts` already used, and the only
reason the instrument could not run on a FLAT corpus layout) and counts this language's
attribute-keys space from the tree — `keywordArgumentNodes`, every `keyword_argument` node in the
corpus (**227,330 across 7,913 files** on the box's 10,839-file flat population), of which 185 sit in
a class header (`classHeaderKeywordArguments`) and 65 declare an interface (`metaclassArg`, the
spelling `real-python-analyzer.ts` keys on at `if (kn === "metaclass")`). Its `--json` output is the
artefact `validation/m14/fixtures/python/construct-census.current.json`, and
`validation/m14/fixtures/python/ruling-attestation.json` points the arbiter at it, so that command now
prints `VERIFIED nodeTypes=203, attributeKeys=227330, implements.constructSites=204` where it printed
`attestation python: none`. The 204 is the regression trap: `abcBase` 22 + `protocolBase` 117 +
`virtualRegister` 0 + `metaclassArg` 65, published as `implementsConstructSites` with its definition
beside it, so a change that stopped the emission would read FALSIFIED with a count rather than
RULED-SOUND. The arbiter's own walk independently counts **227,905** `keyword_argument` nodes over
its 11,488 admitted files — 0.25% from the probe's 227,330, the difference being admission rules
(untracked files, and files above the probe's 512 KiB cap), which is the agreement one wants between
an instrument the lane owns and one it does not.

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

**CLOSED 2026-10-10 — all four of those rows, in one change.** The root cause was not the
oracle but the WIRING: `script/m14/differential.ts` imported only `PYTHON_BUILTINS` from the
analyzer and derived python's truth with a ~440-line in-file function (`derivePythonEdges`)
whose own comment said it MIRRORED `RealPythonAnalyzer` — a mirror is not a second opinion,
which is the rule that file's header is built on. It derived six labels and had no rule for
`contains`, `exports` or `imports`, so the allowlist dropped all three (the DERIVATION
findings), and it had no rule for `implements` either, so that label sat in the compared set
with no truth behind it and the harness printed `COMPARED WITH NO TRUTH`. The lane's own
oracle (`script/m14/oracles/python-truth.ts`) derives **all ten**, and it is now imported and
registered, with the three missing labels added to python's compared set. Measured after:
the two pinned draws read **`covered=100%` / `MISSING=0` / `unexplained=0`** (cython
`tree-truth=16,529`, requests `tree-truth=5,326`; `heuristic` 164 and 55 are the declared
first-parent override guesses at confidence < 0.7, not fabrications), and
`script/m14/verify-label-coverage.ts` now measures this lane at **`4857/4857`, no unaudited
label** — it could not measure python at all when this section was written, because the pin
it read (`cython` under a `python-corpus/` aggregate) did not resolve on that box; on THIS
box `cython` and `requests` are top-level checkouts and the pin resolves.

**The mirror itself is deleted as of 2026-10-10 (round 3).** `derivePythonEdges` — and
`PYTHON_BUILTINS` with it, which had become the import's only consumer — is gone from
`script/m14/differential.ts` (26,015 → 25,562 lines), and the differential was re-run afterwards
precisely so the deletion is a measurement rather than an assertion: `covered=100%` / `MISSING=0` /
`unexplained=0` on both pinned draws, unchanged. Round 1 had left the copy on disk "for one pass"
because the file is shared; the pass is done.

**The ARBITER reports the lane too, for the first time.** `bun script/m14/ontology-coverage-gate.ts
python --fresh` reads `emitted 10/10 · ruled-sound 0 · FALSIFIED 0 · ruled-without-justification 0 ·
ruled-unknown 0` and exits 0, over a walk it certifies COMPLETE (11,488/11,488 files measured by the
analyzer in that run, 0 degraded, 0 abandoned). Before this round the same command printed
`no RULING SOURCE for python` and exited 2, because `python: PYTHON_RULED` had never been added to
`RULED_BY_LANG` — the one import plus one line `script/m14/python-ruled.ts` names as the wiring its
lane cannot make for itself. Two things were needed and both are now in place: that wiring, and a bun
transpile break in `script/m14/zig-ruled.ts` (a local function named `declare`, which bun reads as a
TypeScript ambient declaration and aborts on) that took the gate down for EVERY lane while `tsc` and
`tsx` were both happy with it.

**...and its space attestation verifies as of 2026-10-10 (round 3).** The gate's line is no longer
`attestation python: none`. Over the same COMPLETE 11,488-file walk it now reads
`attestation python: validation/m14/fixtures/python/ruling-attestation.json — spaces node-types,
attribute-keys; artefact validation/m14/fixtures/python/construct-census.current.json; VERIFIED
nodeTypes=203, attributeKeys=227330, implements.constructSites=204`, with
`emitted 10/10 · FALSIFIED 0 · ruled-without-justification 0 · ruled-unknown 0` and exit 0 unchanged.
The population behind the artefact is declared in the attestation and is NOT the one PY-34's 71
base-entry figure was measured on: 10,839 tracked `.py`/`.pyi` files across 49 top-level checkouts on
the flat box versus five pinned checkouts — 204 and 71 count different things over different corpora,
and the file says so.

## Payload

`validation/m14/fixtures/python/payload-measure.ts`, production `parseFile`, 400 of 5,365
files: 40,769 relationships, **10.9 MiB un-narrowed**, of which `calls` 43.9% and `uses`
27.0% of bytes. Narrowing to `calls` alone is 2.3×; to `exports` alone, 379×. python's
un-narrowed payload is dominated by two labels, so a caller narrowing to the kinds it asked
about saves proportionally less than the 2.5–4.8× band the workstream records for lodash and
ripgrep — those graphs were not 71% calls+uses. These are standing figures from before the
2026-10-10 oracle-wiring change (which added no edge to the analyzer), so they are not a
before/after pair; the `implements` label was added by PY-34 on 2026-10-09 and is counted in
the table above.

## Which fleet instruments can measure this lane (2026-10-05, RE-MEASURED 2026-10-10)

The 2026-10-05 reading was taken where python's corpus lived in a `python-corpus/` aggregate and
the shared pins pointed at the older top-level layout. **On the box this lane was re-measured on
2026-10-10 the layout is FLAT** — each checkout is its own top-level directory — so two of the four
instruments now measure python, and the two that were not re-run are reported as NOT RE-VERIFIED
rather than as still broken.

| instrument | 2026-10-05 | 2026-10-10 |
| --- | --- | --- |
| `script/m14/ontology-coverage-gate.ts` | the ARBITER | `corpus: 424 admitted`, then exit 2, `no RULING SOURCE for python` |
| ^ | | **WORKS**: `emitted 10/10 · FALSIFIED 0 · ruled-without-justification 0 · ruled-unknown 0`, exit 0, over an 11,488-file COMPLETE walk. Needed TWO fixes: `python: PYTHON_RULED` added to `RULED_BY_LANG` (the wiring `script/m14/python-ruled.ts` names as the missing line), and a bun transpile break in `zig-ruled.ts` that took the gate down for EVERY lane |
| `script/m14/verify-label-coverage.ts` | the DERIVATION gate | `skipped (not a pass): python (no files under cython)` |
| ^ | | **WORKS**: `| python | cython | 25 | 4857 | 4857 | — | — |` — no unaudited label |
| `script/m14/firing-check.mjs` | run the analyzer through production, tally types | `LANES.PYTHON` → `python-codesql`, absent. Prints `PYTHON 0 types fired / NO CORPUS` and a SILENT list of all ten, **exit 0** | NOT RE-VERIFIED (its own `LANES` pins are untouched) |
| `script/m14/firing-check-v2.mjs` | the corrected version | no `PYTHON` entry in `LANES` at all; exit 2, "no lane matches" | NOT RE-VERIFIED |
| `script/m14/python-ontology-census.ts` | the lane's own ontology census | already unusable here: it appends `python-corpus` to the corpus root, which does not exist on a flat box. Still on the list because a reader who follows the dossier to it gets `no git checkout under …/python-corpus` | NOT RE-VERIFIED; superseded for the emitted-type table by the arbiter's own table |

An earlier note in this lane's history recorded `firing-check.mjs` as throwing a TypeError. It does
not: it prints a **complete, confident, wrong** report and exits 0.

The instruments that DO derive their population from the filesystem are `python-lane-census.mjs`
(which takes an explicit `BB_CORPUS` directory of checkouts), `python-construct-census.mts`
(`BB_PY_CORPUS`) and — since round 3 — `implements-probe.ts`, which reads the same `BB_PY_CORPUS` so
the instrument behind the gate's attestation can run where the gate runs. That matters beyond
convenience: the DENSEST source of abstract-base usage in
python is the UNPINNED `cpython-stdlib` copy, which a `git ls-files` derivation silently drops.

Round 4 added three more, all filesystem-derived and re-runnable: `python/owner-resolution-gate.mts`
(the store pass on five crafted files, three controls), `python/owner-channel-census.mts` (prices the
owner lever on a real repo through the real index; `BB_CORPUS_ROOT`/`BB_PY_REPO`, and it REFUSES with
exit 2 rather than printing zeros when its repo is absent), and the builtin-type-name fixtures paired
with the seam gate's new section D.

Round 6 added the gate over the INCOMING direction's verdict: `python/resolution-verdict-gate.ts`
(re-checks the committed `resolution-verdict.current.json` against pinned per-label ceilings, and
REFUSES exit 2 when the artefact is absent). Round 7 added its companion DIAGNOSTIC: the
`--dump-unexplained` mode of `python-endpoint-resolution.ts`, which writes EVERY unexplained edge
rather than the report's top-40 slice — the file both round-7 levers were priced from by hand before
any analyzer code changed.

Round 8 added `python/import-bound-name-seam.mts`, and it is the first instrument in this folder that
measures BOTH sides of the analyzer/store seam in one process: it generates a small project on disk,
calls `indexProjectParallel` (the production path, worker pool included), and then reads the
analyzer's own output and the store's `brain_import` / `brain_symbol` / `brain_relationship` tables in
the same run. Row B was pinned at the DECLARED gap (PY-D13 store half) rather than asserted absent, so the instrument
goes red and names the flip the moment the shared fix lands — **which is what happened in round 17**: B is
now a positive assertion (`imported_as` = `t` / `PV` / `v`, NULL for the plain import) and a fifth check E
pins the shared projection's two roles for `X as Y` on a TYPESCRIPT import; row C is the control that keeps
B meaningful; row D is the route, and its own history is the reason it is shaped the way it is (see the
round-8 section below). Round 8 also kept the two analyzer-only instruments the round-7 work
left in place: `python/reference-binding-is-not-a-guess.expectation.json` and
`python/inline-type-parameter-is-not-a-class.expectation.json`, both with FORBID rows for the
over-claim direction.

Round 9 added `python/parser-error-region-is-not-a-type.{py,expectation.json}` — the fabrication fixture
(a parameter published as a type, with the declared cost and three clean-clause controls in ONE file) — and
extended the mutant harness to 31 cases with `parser-error/{type-clause-claims-again, no-clause-is-trusted,
call-in-error-region}`. The call-side guard shipped only AFTER its mutant was shown to be caught: the first
version SURVIVED, the fixture gained the module-level call that exercises it, and only then was it allowed
to land. **A guard with no falsifier is a claim with no evidence.**

## Resolution — the incoming direction, whole population (measured 2026-10-10)

`npx tsx script/m14/python-endpoint-resolution.ts` over the arbiter's 11,488-file population:
205,928 symbols, 1,292,311 relationships. `npx tsx script/m14/python-endpoint-defects.ts` names
the classes that census counts:

| class | whole population |
| --- | --- |
| `implements` UNRESOLVED | **0** (201 resolved, 104 external, 25 ambiguous) |
| D1 `contains` into a symbol the production path deletes | 0 |
| D2 `references` into a builtin name FROM A TYPE POSITION — **DECLARED, not a fault** (see below) | **7,687 in 1,732 files** |
| D2b the same reference arriving from a position outside `declared_type`/`return_type`/`instanceof_check` | **0** |
| D3 empty or whitespace-only endpoints | 0 |
| D4a / D4b placeholder-literal endpoints (invented / present in the file) | 0 / 0 |
| D5 `uses` self-loops (target leaf == the reading function's own name) | **750 in 178 files** |
| D6a / D6b empty or placeholder-literal symbol names | 0 / 0 |
| D7 relationships the production path discards after `analyze()` | 0 |

D2 and D5 are the two classes the arbiter does not name, and both are DECLARED here rather than
quietly fixed, with the measurement that decides each:

- **D2 is a DECLARED POSITION, and as of round 3 it is pinned in BOTH directions — the slice no
  fixture claimed is now claimed.** `dict` and `list` were already EXPECTED by
  `validation/m14/fixtures/python/type-usage-graph.expectation.json` (with `str` and `None` FORBID);
  the exception hierarchy — `Exception` 97, `BaseException` 180, plus `type` 383 — was the part no
  fixture pinned, and the question it raised was never "how many" but "from where". Measured on a
  synthetic source containing every candidate position: `def f() -> Exception`,
  `def g(x: BaseException)`, `class C: field: Exception`, `isinstance(x, Exception)` and
  `-> Exception | None` each emit exactly one `references` edge, and `except Exception as ex:` and
  `raise ValueError("x")` emit **none**. So the axis is the POSITION, not the name: a type position
  names a type whether or not the interpreter happens to define it, and only the 11 SCALARS are
  filtered. Two new fixtures hold the rule at both ends —
  `python/builtin-type-name-is-still-a-reference` asserts the four firing rows,
  `python/builtin-type-name-is-not-a-control-flow-edge` FORBIDS the two exception rows — and the
  defect axis moved to `D2b`, the part that can actually be wrong: a builtin reference arriving from
  a position outside the three declared type positions, measured at **0 of the 7,687** over the
  arbiter's 11,488-file population. D2's number is therefore a population size with a named cause
  rather than a fault count, recorded as `PY-D9` in `script/m14/spec/python-completeness.json`. No
  analyzer or oracle change was needed, and that is the point: the analyzer was already consistent
  with the position its own fixture pinned — the instrument that disagreed was the census that
  called the position a defect.
- **D5 is a NAME COINCIDENCE, not a self-dependency.** `uses to_json -> to_json` is emitted inside
  `def to_json` by `if hasattr(self.actual_instance, "to_json") and callable(self.actual_instance.to_json)`
  — a read of ANOTHER object's member that happens to share the reading function's name, and the
  same shape as `ansible`'s `@property def changed` reading `loop_result.changed`. The edge is a
  TRUE statement about the source; the hazard is that a naive name-resolution walk binds the read to
  the reading scope itself. Dropping it would delete a true edge, which is the worse failure, so it
  is reported as a resolution hazard with its count rather than as a defect.

### The owner channel — the member-resolution mechanism (round 4, 2026-10-10)

Everything above measures whether an endpoint BINDS. For a member edge the binding rule the store
actually runs is a ranking: `resolveTargetStmt` picks among every same-named declaration in the
project, same file first, then lexicographic `s.id` compared as TEXT. That is a tie-break, not a
fact about python — `render` is a method on many classes at once. php closed this for its lane with
a relation-level `metadata.owner` (PHPD42) and a pass that walks the receiver's class and its
`super_types` ancestors; until round 4 python published **no owner at all** (0 of every `calls`/`uses`
edge), so the pass had no input on this lane.

`real-python-analyzer.ts` now publishes `metadata.owner` on a member-position edge when the receiver
is EXACTLY the implicit first parameter, spelled `self` or `cls`, with a single dot (`memberOwnerOf`)
— the same spelling the `dispatch-on-parameter` reason code trusts, and the case the store's rule 0
answers by IDENTITY (the source method's own class). **The narrowness is the design:**
`self.store.save` carries NO owner (the receiver is the VALUE of `self.store`, type unknown, and the
enclosing class would bind `save` to a method of the wrong class), as do a local receiver and a
module-level `def f(self)`.

Measured on a real repo through the real index (`python/owner-channel-census.mts`, `requests`): 375
owner-carrying rows of 3,325 member rows (11.3%), **357 resolved (95.2%)** — 350 direct (162 of them
the same-kind duplicate rule below) plus 7 inherited — and 18 declined (14 names the owner's chain
does not declare, 4 genuinely multi-kind). The first measurement, before round 5, was 195 resolved
(52.0%): the gap was 162 rows where the owner's class declares the target name TWICE — the
annotation (`x: T`) + assignment (`self.x = ...`) shape, which the analyzer and the oracle both
publish as two members. Round 5 taught the SHARED pass (`member-owner-resolution.ts`) that a
candidate set sharing the owner's identity, the name and the KIND is ONE member, so it resolves
to the smallest id while a multi-KIND set still declines; the rule is php-neutral by construction
(php cannot declare two members of one name and kind in a class) and was measured so — php's owner
gate and store-resolution census PASS with the new branch firing **zero** times. Recorded as
`PY-D10`. The pass's contract in isolation is `python/owner-resolution-gate.mts` (three-store
controls, now including a DUPLICATE case), and `store-heritage-seam.mts` section D measures it
end-to-end through `indexProjectParallel`, cross-file ancestor walk included.

### The resolution verdict — WHY an incoming target is unresolved (round 6, 2026-10-10)

Everything above measures whether an endpoint BINDS. Round 6 measures why an incoming target does
NOT, because "unresolved" was one bucket covering several different facts, and averaging them
reported a rate that meant none of them. `script/m14/python-endpoint-resolution.ts` now classifies
every UNRESOLVED incoming target by the fact that explains it — preferring the analyzer's own
statement (`reasonCode`, `qualified`) and asking the interpreter (`dir(builtins)`) only where nothing
else answers:

| axis | what it is | defect? |
| --- | --- | --- |
| `declared-dynamic` | the lane says the target is chosen at runtime (`dispatch-on-receiver`/`dispatch-on-parameter`/`member-read`/`first-parent-guess`) | no — python being python |
| `declared-external` | `external-member-call`: the receiver is rooted at a module THIS file imported | no — followable, out of file |
| `qualified-external` | the `qualified` spelling is a dotted chain whose root the file imported or the population declares | no — the route says which module owns it |
| `builtin` | the leaf is a name the interpreter owns (`dir(builtins)`) | no — no file CAN declare it |
| `UNEXPLAINED` | none of the above | **yes — the only axis that names a defect** |

Whole population (11,488 files, 205,928 symbols, 1,290,877 relationships): outgoing UNRESOLVED **0
for all ten labels**; incoming `UNEXPLAINED` **6,283** — calls **4,837**, references **1,332**,
extends **105**, exports **9**, and **0** for uses/contains/imports/implements/overrides/instantiates.
The verdict is a committed artefact (`python/resolution-verdict.current.json`) that
`python/resolution-verdict-gate.ts` re-checks against pinned ceilings — **10/10 emitted**, outgoing
`== 0`, and a per-label `UNEXPLAINED` allowance no higher than round 6's own numbers — REFUSING exit 2
when the artefact is missing rather than passing vacuously.

**Round 6's first use of the instrument convicted the analyzer.** `Annotated[str, Field(min_length=1)]`
holds a CALL inside an annotation, and the type-reference walk descended into it and published the
validator's keyword-argument NAMES as types (`references … -> min_length`, `-> strict`). The walk now
skips the `keyword_argument` name and keeps its value (`TypeVar("T", bound=Base)` must keep `Base`),
which moved **`references` 63,498 → 62,064 (−1,434 edges)** and is pinned by
`python/references-do-not-name-keyword-arguments`. Both `collectTypeNodes` (analyzer and oracle)
carried the same mistake, which is why the differential stayed green through it: **a mirror written
in lockstep is a consistency check, not a truth check.**

The remaining axes are honest holes with named causes, not tidy-ups:

- **calls 4,837** — the callee is bound in the ENCLOSING FUNCTION's scope: a nested `def` (`run_eval`
  inside `main`) is deliberately not published as a symbol, and a pytest-injected parameter
  (`django_capture_on_commit_callbacks`) has no project declaration. A distinct `local-callee` reason
  code the analyzer can state as a fact is the lever; until it exists these stay counted, not waived.
- **references 1,332 / extends 105** — dominated by the ALIAS-BOUND route: `import typing as t` and
  `from torch.nn import Module as NNModule`, where the `qualified` root is a name the file bound by an
  alias the store never received. The analyzer's `ImportInfo` keeps `alias`, but
  `src/ast/pool-worker.ts`'s import projection dropped it and `src/ast/parallel-indexer.ts` read the
  absent field, so the store stored `imported_as: NULL` / `import_type: named`. Shared, master-owned
  surface — **DECLARED as `PY-D13`, measured, not changed unilaterally.** **ROUND 17 CLOSED THE `imported_as`
  HALF** (the projection now emits `alias`, the analyzer publishes the per-item `itemBindings` of a
  from-import, and the store writes it); the `import_type` half stays declared, and the ROUTE is still not
  read by anything on the store side, so the rows ABOVE still sit where they sat — the fix buys data
  fidelity, not resolution.
- **exports 9** — `__all__` names provided lazily (`dialects/__init__.py` via `__getattr__`,
  `celery_app`, `instrument_declarative`).

### The two levers worked, and what the number does when the fixes are honest (round 7, 2026-10-10)

Round 6 named the hole; round 7 works the two causes it named. **The population's edge counts do not
move at all** — 1,290,877 relationships before and after, every label identical to the digit —
because neither change adds, removes or retargets an edge. Each makes the analyzer say what the
source already said.

| lever | what it states | independent measurement (CPython `ast`, over the verdict's dumped edges) |
| --- | --- | --- |
| `local-callee` | the callee is bound in an **enclosing function**'s scope (nested `def`, parameter, local) — so no project declaration exists, and LEGB means the local binding SHADOWS any module-level name of the same spelling | **4,230 of 4,837** calls |
| `metadata.importedAs` | the alias **bound** by `import X as Y` / `from X import Z as W` — the only word in the file that spells the module in front of a member (`t.Protocol`) | **1,035 of 1,446** reference/extends rows |

The implementation is a pre-pass (`collectFunctionLocals`) plus a call-site check that walks the
callee leaf's own ancestors, and `importedAs` on the `imports` edge. Three things about it are
load-bearing rather than incidental:

- **A `Node` can never be a Map key.** The first version keyed the pre-pass on the
  `function_definition` node and every call in the file read `bare-name-callee` — because
  web-tree-sitter returns a FRESH wrapper on every `.parent`/`.namedChild()` access (the lane says so
  at `extractMemberUses`: "identity never holds"). It is keyed on the function's start position now.
- **What is deliberately NOT collected**: a nested function's BODY (its bindings are its own —
  walking in marks a call in `outer` to a name bound only in `inner` as local); lambda and
  comprehension targets; `attribute`/`subscript` targets; a parameter's default/annotation
  expression; and any name a `global`/`nonlocal` statement declares, which is SUBTRACTED.
- **The negative direction is pinned too.** Both fixtures carry forbid rows for the over-claim (a
  module-level `def` must stay resolvable; an un-aliased import must NOT get an `importedAs`), and
  three of the six new mutants fail exactly those rows — the harness includes the fabrication
  directions, not only the loss ones.

The verdict, over the same 11,488 files: UNEXPLAINED **6,283 → 755** (calls 4,837 → 344 with 4,280
now `declared-local`; references 1,332 → 389; extends 105 → 15; exports 9 → 7), outgoing UNRESOLVED
still **0 for all ten**. Two movements are not relabelling at all: **563 `references` rows and ~213
`calls` rows left UNRESOLVED entirely** and now bin EXTERNAL, because the name they target IS one the
file imported — resolution, not a new label. The residual is named rather than smoothed: wildcard
imports (`from dataclasses import *` binds every public name of a module — cython's deliberate test,
duckdb's `from pyspark.sql.types import *`), two corpus files CPython itself cannot parse (where the
analyzer's tree-based check still answers, which is why it moved 4,280 where CPython could see
4,230), bases the source holds in a VARIABLE (`dump_cls`, `mixin_cls`), and lazy `__all__` names. **No
`wildcard-import` axis was invented**: a star import is unbounded, so claiming `make_dataclass` came
from `dataclasses` would be a guess dressed as a fact, and the number stays where the evidence is.

The store-side gap was DECLARED (**PY-D13**) as of round 7: the bound name was on the relation, but
`src/ast/pool-worker.ts`'s projection dropped `alias`, so `brain_import.imported_as` stayed NULL and the store
could not resolve `t.Protocol` itself. **Round 17 (2026-10-12) closed that half** — projection, analyzer and
store now all carry it, `imported_as` is asserted in both directions by the seam gate, and the store's
`imported_name` was corrected in the same round (it held the MODULE, never the item: see PY-D32). What stays
DECLARED is the CLASSIFICATION half (`import_type`), the row model that keeps only the last item of a
multi-item statement, and the ROUTE. The matching spec entries are **PY-D13 (amended: lane side FIXED,
store side FIXED, classification half DECLARED)**, **PY-D32 (new)** and **PY-D14 (FIXED)**.

### The reference side, and a type parameter that is a binding rather than a class (round 8, 2026-10-11)

Round 7's lever was stated for the CALLEE axis. Round 8 asks the identical question of the REFERENCE
axis — a type name in an annotation, a base in a class header — and gets the identical answer plus a
second one. Both were priced with CPython's own parser over the verdict's dumped edges BEFORE any
analyzer code changed, so the change aims at a measured population rather than at an intuition.

| lever | what it states | independent measurement (CPython `ast` over the dumped edges) |
| --- | --- | --- |
| `local-binding-target` | the type name is bound in the **reference's own enclosing scope** — a parameter, a nested `def`/`class` name, an assignment target — so there is no project declaration to find | **232 of 389** references, **14 of 15** extends |
| `inline-type-parameter` (PY-D16) | a PEP-695 `def f[T]` / `class C[T]` / `type A[U]` parameter is a BINDING the signature declares, not a class the project defines; it can neither resolve nor honestly sit unresolved | **52 of 389** references |

`local-binding-target` is emitted by a SEPARATE helper (`dynamicTypeBindingReason`), deliberately not
by widening `isLocalCalleeName`: a call's target is a callee and its code is `local-callee`, a
reference's target is a type and its code is `local-binding-target`. One vocabulary on two axes is the
mistake `external-member-call` is kept apart from `dispatch-on-receiver` to avoid. The check reuses
round 7's `collectFunctionLocals` pre-pass and walks the leaf's ancestors, so it is lexical and needs
no scope state — and it asks the LOCAL binding first, because Python's function scope is one namespace
and a def that both declares `[T]` and assigns `T = 5` binds a local when the body runs.

`inline-type-parameter` reads the `type_parameter` clause and takes the FIRST identifier of each
parameter: `TValue` is `type -> identifier`, and the bounded form `T: str` is
`type -> constrained_type -> type -> identifier` with the BOUND (`str`) following the name. Reading the
first identifier therefore names every grammar shape without enumerating them, and a bound can never
be mistaken for a name — which is exactly what the mutant `inline-type-parameter/bound-read-as-the-name`
forbids.

The `extends` emitter had NO reason code at all before this round, which is why the axis could only
ever read a raw unresolved target; it now asks the same helper, and `extends` incoming UNEXPLAINED
reaches **0** (the 15 are DECLARED as `local-binding-target`, not resolved and not silent).

The verdict, over the same 11,488 files: UNEXPLAINED **755 → 548** (references 389 → 197 with 193 now
`declared-local`; extends 15 → 0; calls 344 unchanged; exports 7 unchanged), outgoing UNRESOLVED still
**0 for all ten**, and every label's edge count identical to the digit (1,290,877 total) — which is the
check that the change states metadata and moves nothing else. The residual is priced rather than
smoothed: 92 references are names a function declares `global` and binds there (a MODULE-scope name
created at run time — a `@testing.fixture` doing `global _GenericPep695` and assigning it, with a
module-level class annotating against it), 64 sit in files CPython cannot parse at all, 26 come from
`from dataclasses import *`, 12 are generated protobuf module handles, 3 are member reads off a dynamic
receiver; on the callee side 164 rows live in files carrying a wildcard import, 135 in files CPython
cannot parse, **13 are the same `global`-in-function shape** (`global run_python` inside cython's
`run_benchmarks.check_gnu_time`, then called from two other functions), and the rest are names bound
nowhere in their file at all. **The `global`-in-function shape is the largest named residual on both
axes and is NOT the local case**: `global X` plus a write is an explicit declaration that `X` lives in
the module namespace, so a project-scope binding is the correct reading and the analyzer currently
records none.

### A fabrication on the reference side, and the parser's verdict as the rule (round 9, 2026-10-11)

Rounds 7 and 8 added metadata and moved no edge. Round 9 REMOVES edges, because what it found was not
an unexplained target but a wrong one: `references f -> o` where `o` is `f`'s own second parameter.

```python
def f(d: double[:], o: Optional[double[:]]):
    pass
```

`double[:]` is VALID CPython (an annotation is an arbitrary expression; `double[:]` is a slice of the name
`double`) and tree-sitter's python grammar rejects a slice in that position, so the whole parameter list
collapses into ONE `typed_parameter` whose `type` clause swallowed `, o: Optional[...]` and presented `o`
inside a synthesised `constrained_type`. The analyzer read that and published a parameter as a type — the
same defect class as PY-D11 (a keyword argument's NAME published as a type) and as the empty-identifier
guard this collector already carried.

| what | rule | where |
| --- | --- | --- |
| `references` | a type clause whose subtree CONTAINS an error (`hasError`) names NO type — the whole clause is refused | `extractDeclaredTypeRefs` → `collectTypeNodes` |
| `calls` | a call whose own subtree was flagged, OR a call the parser swallowed into an `ERROR` node, publishes no callee | `processCall` |

The rule is the PARSER'S OWN VERDICT rather than an enumeration of garbled shapes, which is what makes it
auditable. **The cost is declared:** `double` and `Optional` inside the garbled clause are refused with it,
because a name read out of a structure the parser got wrong is luck, not reading — and the fixture forbids
all three so a later round cannot narrow the guard to just the embarrassing identifier. The
over-correction direction is pinned harder: `def f(d: double[:]) -> None` KEEPS `double`, because there
the clause is `(type (identifier))` and the ERROR is a SIBLING, and the three clean annotations around it
keep `Optional`/`list`/`Mapping`/`dict`.

**The oracle had to change with it, and that is PROVEN rather than argued.**
`script/m14/oracles/python-truth.ts` derives the differential's truth from the same tree, so a one-sided fix
would show up as MISSING — and the unmirrored oracle derived the same fabricated edge, which made the
differential read AGREEMENT (the two-derivations-of-one-unstated-assumption trap PY-D11 named). Measured
directly: with the oracle's guard ALONE removed and the analyzer's left in place, cython reports
**`MISSING=1`**, and that one edge is the fabrication. Restored, both lanes report
`MISSING=0 unexplained=0`.

Two limits on how the differential may be cited, both learned in this round. Its TOTALS are not comparable
across runs, because the cold-pool rotation deliberately draws never-sampled files each wave (its own
comment: *reproducible, but every wave sees fresh files*; the counter moved 14 → 15 → 16 here), so only the
within-run `covered`/`MISSING`/`unexplained` and the result hash mean anything across runs. And a
differential is a DIFFERENTIAL: it can only catch what its own oracle models — the fabrication below was in
both derivations and therefore invisible to it until the oracle was changed, which the `MISSING=1`
falsification now demonstrates.

Measured over the same 11,488 files: edges 1,290,877 → 1,290,620 (**−257**, the first round in this arc
whose count moves) and UNEXPLAINED **548 → 390** (calls 344 → 238, references 197 → 145, extends 0,
exports 7), outgoing UNRESOLVED still **0 for all ten**. The residual is re-priced rather than smoothed:
90 references are names a function declares `global` and binds there, 26 come from
`from dataclasses import *`, 14 sit in files CPython cannot parse, 12 are generated protobuf module
handles, 3 are member reads off a dynamic receiver; on the callee side 196 are wildcard-import or
nowhere-bound names, 29 are in CPython-unparseable files, and 13 are the same `global`-in-function shape.
The ASN.1 documents named `.py` (`otp/lib/asn1/test/asn1_SUITE_data/*.py`, 22 files) keep 14 references and
29 calls whose OWN clauses parse cleanly — they are named here, not claimed clean, because refusing them
would need a file-level "this is not python" verdict that belongs to file classification rather than to this
analyzer.

### The module namespace a `global` write proves, and a wildcard import's route (round 10, 2026-10-11)

Round 9 removed dishonest edges. Round 10 moves the incoming residual 390 → 119 with the EDGE COUNT
UNCHANGED (1,290,620 both sides), because both of its mechanisms declare something the source already
says rather than guessing at something it does not.

| mechanism | what the source states | what the lane now publishes |
| --- | --- | --- |
| `global X` in a function plus a CREATING write in the same body | X is bound in the MODULE namespace — CPython has it in `globals()` afterwards | an ownerless module-scope Variable at the write line (`isModuleVariable` + `boundByGlobalWrite`), so the edge RESOLVES |
| `from M import *` | M's public namespace is bound into this file | `metadata.starImport: true` on the `imports` edge; the verdict's `star-import-external` axis declares the route external when EVERY star module is OUT OF VIEW |
| `with … as X` / `except E as X` | X is a LOCAL of that function | the binding is read from the `as_pattern` the grammar really produces |

**A creating write needs a VALUE**, and that is measured rather than assumed: `exec("x: int",
m.__dict__)` adds no namespace entry, so a valueless annotation does not create; `X += 1` requires the
binding and `del X` removes it; only the function's OWN body counts (a nested `def` has its own `global`
statements, and an outer `global` plus an inner write is not a pair); and a name already declared at
module scope or bound by an import gets no second declaration.

**The wildcard fact needs a home because the store's projection cannot carry it.** `from M import *` and
`import M` publish the same `M:*` endpoint, and `pool-worker`'s per-item projection flattens both to
`{name: "*", type: "namespace"}` — so the difference is stated on the analyzer's own edge, the same
doctrine PY-D13 set for the bound alias. The axis's in-view gate was CONVICTED BY THE CORPUS once: its
first version used file stems, and over the round-9 residual it blocked 169 of the 171 priced rows on
name collisions between unrelated repositories (cython stars the STANDARD LIBRARY `dataclasses`; another
repo happens to have a `dataclasses.py`). The implemented rule is the priced one — the population's
dotted module paths plus package prefixes — and `star-import-axis-gate.mts` pins every direction,
including that collision.

**This round also CORRECTED this lane's own documentation.** Round 7's PY-D14 advertised `with as` and
`except as` targets among its collected bindings, and both cases read field names this grammar does not
have — `childForFieldName("alias")` on `with_item`, `childForFieldName("name")` on `except_clause` — so
neither ever fired. The alias lives in an `as_pattern` (`value → as_pattern → as_pattern_target`),
measured with a probe before the fix; the fixture pins the reason code rather than the endpoints, and a
mutant restores the dead reads. Corpus footprint: `local-callee` 12,989 → 12,998.

The residual is priced, not smoothed. Of the round-9 dump's 390 rows, CPython attributes **98** to the
`global` mechanism, **171** to the wildcard route, **43** to files CPython itself cannot parse, and **78**
to neither — and after the round **0 of the 98** and **0 of the 171** remain. The 119 that are left:
calls 65 (28 in CPython-unparseable ASN.1 documents named `.py`, 37 bare names bound by nothing),
references 47 (14 unparseable, 33 bound by nothing), exports 7 (`__all__` names provided lazily). One
dead literal was removed on the way — `typed_pattern`, flagged by the fixture-coverage gate and confirmed
by the corpus (11,309 files, 0 occurrences) — because a branch that can never fire is a claim with no
evidence.

### Two more bindings the source writes, and the one scope the reader skipped (round 11, 2026-10-11)

Round 11 moves the incoming residual 119 → 96 and changes the graph in exactly ONE place — `contains`
+15 — because one mechanism publishes DECLARATIONS and the other publishes only a REASON CODE.

| mechanism | what the source states | what the lane now publishes |
| --- | --- | --- |
| a MULTI-TARGET assignment (`a, b = f()`, `(a, (b, c)) = f()`, `[a, b] = f()`, `a, *rest = f()`) | each name in the pattern is bound in the scope the statement is written in | one module Variable per name (or one Property per name in a class body), at the name's own position, with `metadata.multiTargetForm` naming the spelling |
| a comprehension's `for` TARGET / a lambda's PARAMETER | the name is bound in the comprehension's or lambda's OWN scope | `local-callee` for a call, `local-binding-target` for a reference — no symbol, because a scope binding is not a declaration |

**`extractAssignment` gated on `left.type === "identifier"` and returned for everything else**, so a
multi-target assignment published nothing at module scope and nothing at class scope. The corpus shape
is not hypothetical: `helloworld_pb2, helloworld_pb2_grpc = grpc.protos_and_services("helloworld.proto")`
at module scope in `pb-grpc`'s examples, with 12 of the round-10 residual's rows being annotations
naming those two names. The target is read with the SHARED walker (`patternTargetNodes`, the
node-returning face of round 10's `addPatternTargets`) so the symbol publisher and PY-D14's local
collector cannot disagree about what a target is — the defect class that survived nine rounds in
`collectFunctionLocals`'s `with_item` case.

**The walker gained `list_splat_pattern` and the coverage gate is the argument for it.** Measured
(`.tmp-py/round11-shapes.mts`): `a, *rest = f()` spells the splat as an element holding one
identifier, and the walker descended `pattern_list` but not the splat inside it — so `rest` bound
nothing AND was not a function local. `typed_pattern` was DELETED in round 10 as a literal no source
produces; this is the mirror case (a literal 28,136 function-body targets contain and the reader did
not handle), kept because a fixture now contains it. `**kw` in a target is deliberately NOT added: no
python program binds one, so a branch for it would be the dead literal round 10 removed.

**A comprehension's `for` target was the last "deliberate under-claim" in the read path.**
`collectFunctionLocals` skips comprehension and lambda nodes — right about SCOPE, and the skip stays —
but `isLocalCalleeName` and `dynamicTypeBindingReason` then found no enclosing scope binding the name
and published `bare-name-callee` / `annotation-type`, which claims the name is a PROJECT-WIDE name for
a binding written four characters to the left (`[comp(page) for comp in comparison]`). The fix is
`scopeOwnBindings(scope)`: the same ancestor walk, asked at each scope node for its OWN bindings. A
comprehension's clauses are all DIRECT children and its target goes through the shared walker (`for k,
v in ...` binds two), and a lambda's parameters live under `lambda_parameters` — NOT `parameters` —
which is why the parameter reader was extracted and shared rather than copied.

**The precision is LEXICAL, and it is what a name-keyed rule would miss.** A read of the same name
AFTER the comprehension is not bound by it (python 3 gives a comprehension its own scope) and stays
`bare-name-callee`; a name the comprehension never binds stays `bare-name-callee` too. The cheap wrong
fix — adding comprehension targets to the enclosing function's local set — passes every positive row
and fails exactly those two, and it is pinned as a mutant. `locals.size === 0` was an early exit that
made the answer `false` for a module-scope comprehension in a file with no `def`, and it is gone.

**Priced before it was written, then re-measured after.** A: the analyzer published 276 symbols
carrying `metadata.multiTargetForm` and **270 of them are CONFIRMED name-by-name against CPython's
`ast`** (`.tmp-py/verify-multitarget-census.py`); the price's own counts on the verdict's population
are **182 module-scope names in 58 files, 15 class-body names in 5 files, and 28,136 function-body
names that are LOCALS and therefore never symbols** (`.tmp-py/price-tuple-targets-round11-rerun.log`,
`.tmp-py/tuple-targets-price.json`). The 6 the check does not confirm are 4 in the nvim fragment
CPython cannot parse and the `(x): int` / `(y): int = 0` spelling question recorded at the end of this
section; the residual rows the mechanism carries are 12 references (10 `helloworld_pb2` +
2 `helloworld_pb2_grpc`). B: 13,247 comprehensions and 3,348 lambda scopes, 24,578 such reads in
2,621 files; 11 residual rows (10 calls + 1 reference) and ZERO on the lambda side — the lambda half
is fixed because it is the same fact with a different spelling, not because a row demanded it. After
the fix: UNEXPLAINED calls 65 → 55, references 47 → 34, exports 7 → 7, total 119 → 96, and the excuse
axis moved with it (`declared-local` 4,280 → 4,290 on calls, 146 → 147 on references). The 42
top-level rows in files CPython cannot parse are now NAMED as three different verdicts (11 of the 13
ASN.1 documents rejected at line 1, one at line 2 and one at line 2085; a Python 2 build script whose
`xrange` is a py2 builtin; a highlighter fragment) rather than excused by one word.

**One finding this section's verification produced and did NOT fix, deliberately.** The per-symbol
check of all 276 `multiTargetForm` symbols found exactly two that CPython reads differently from the
field: `(x): int` and `(y): int = 0` in `cython/tests/run/pep526_variable_annotations.py`.
`.tmp-py/paren-target-probe.mts` pins the shape — tree-sitter spells `(x)` as `tuple_pattern`
wrapping ONE identifier and CPython spells it an annotated `Name`, and the analyzer reads the spelling.
The SCOPE and KIND published are right (both ARE module-scope names, exactly as bare `z: int` is, and
the same probe pins that), so this is a FIELD over-claiming: `multiTargetForm: "tuple_pattern"` says
the source wrote a tuple when it did not. It was found AFTER the round's fresh verdict, arbiter and
gates were green, and a field label does not get changed under a verified run without re-running it —
so it is recorded here and in the status doc's §9 with the two honest fixes (stamp the field only when
the pattern binds more than one name, or document it as tree-sitter's node type rather than the
source's semantics) instead of being quietly patched.

### The names a non-assignment statement writes, and a member read that was called
### a name (round 12, 2026-10-12)

Round 12 moves the incoming residual 96 → **7** and publishes exactly the declarations the source
writes — symbols **+494**, `contains` **+17**, every other label UNMOVED to the digit — because one
mechanism publishes DECLARATIONS and the other turns a declaration-shaped name back into the READ it
always was.

| mechanism | what the source states | what the lane now publishes |
| --- | --- | --- |
| a module-scope or class-scope `for` TARGET, `with … as`, `except … as` | the name is bound in the scope the statement is written in | one module Variable per NAME; one Property per SITE in a class body (round 13), at the name's own position, with `metadata.boundByBinder` naming the statement kind |
| an `isinstance`/`issubclass` type argument written as a MEMBER READ (`self._self_owner`, `field.related_model`, `passlib_exc.PasslibHashWarning`) | the target is a member of an object whose type nothing in the file states | `member-read` → declared-dynamic — NO declaration name, because the file declares none |

**The assignment walker published assignments, so a module-scope `for mixin in mixins:` published
nothing.** The row that proved it is wagtail's
`references format_error -> mixin [instancecheck]` at `snippets/api/v3/router.py:76`: `mixin` is bound
by a module-level `for` two lines above the read, and the store had no declaration for it, so the
verdict could only call the read UNEXPLAINED — the ONE row in the round's price where the analyzer
itself was wrong rather than the source unresolvable. `publishScopeBinderBindings` closes it for
`for`/`async for`, `with … as`/`async with … as` and `except … as`, at module scope AND in class
bodies (where the same statement writes a member).

The TARGET is read through the SHARED walkers (`addPatternTargets` via `collectBinderNames`, and
`asBindingTarget` for the two `as` shapes), so `for k, v in …` binds two names and this reader cannot
disagree with PY-D14's local collector about what a target is — the defect class that survived nine
rounds in `collectFunctionLocals`'s `with_item` case, which is exactly why the alias is read through
the same accessor here. The WALK is an explicit-stack preorder (the dart lane's record: a recursive
walk dies on deep nesting after the corpus walk has already been paid for) that descends compound
statements, NEVER enters a function body (its binders are PY-D14's locals, not symbols), and never
enters a lambda or a comprehension (their targets bind their own scope, PY-D22). A class body is
entered with an exit frame, so a binder inside a class gets that class as owner and the Property kind,
and the `for` in a class body nested in another class cannot lose its owner.

The DEDUPE is per SCOPE and it is what keeps the publication additive: a module-scope binder is
skipped when the file already declares that name at module scope or binds it by import, and a
class-scope one is skipped when that class already has the member. That is why publishing 516 named
binders added **494** symbols and not 516, and why a binder can never shadow a declaration — and the
class-scope guard is INERT today, measured rather than assumed: of the corpus's 18 class-scope binder
rows (17 distinct members), **zero** names are also declared in the same class by an assignment, a
`def` or an import (`.tmp-py/price-class-binder-sites.py` → `.tmp-py/class-binder-sites-price.json`).

THE CLASS HALF IS PER SITE and the module half is per NAME (round 13) — a difference with a reason,
not a style. A class member is addressed by name AND LINE; that is what lets `contains` and a member
read resolve against the right span, and every other class-member path in this analyzer already
publishes per site (two `X = 1` statements in a class body are two Properties). Round 12's binder walk
deduped BOTH scopes on `(scope, name)`, so the second site of a class-body binder published nothing at
its own line — invisible to every gate in the lane, because a fixture calls the analyzer directly and
the only instrument that could see it was the differential's truth side. The price before the fix:
exactly ONE class-scope binder name in the corpus has two sites (`AnsibleUnwantedChecker.method`, L141
and L157, `ansible/test/lib/ansible_test/_util/controller/sanity/pylint/plugins/unwanted.py`), so the
fix adds exactly ONE symbol and ONE `contains` — measured on the re-run verdict: symbols 206,939 →
**206,940** and `contains` 135,651 → **135,652**. The MODULE half stays per NAME with its price stated
instead of assumed: 70 module names have more than one binder site (≈100 symbols), a module Variable
has no owner and therefore no `contains` edge for any consumer to address by line, and the effect of
making it per site on the RESOLVED/AMBIGUOUS split is not yet measured. The count is this round's own:
**58** module names hold more than one binder site, and per-site publication would add **90** symbols
(`.tmp-py/price-class-binder-sites.py`; the comment in the source records 70 names / ≈100 symbols under
the round-12 frame — a difference of METRIC, not of corpus).

**Priced with CPython's own `ast` before the method existed, then measured again on the shipped
analyzer.** `.tmp-py/price-module-bindings.py` walks the module body and every class body of the
verdict's population, descending compounds and never entering a new scope: **351 module `for` targets,
98 `with … as`, 48 `except … as`, 6 module-scope walrus targets in 283 files, plus 13 `for` targets in
class bodies — 516 binder rows**, and exactly ONE residual row depends on them (the wagtail one).
`.tmp-py/probe-binder-row-gap.mts` then ran the SHIPPED analyzer over exactly the priced files and
closed the arithmetic in both directions: **480 symbols carry `metadata.boundByBinder`**, and **every
one of them is named by a priced row — 0 un-named**; the walk DEDUPES a row whose name the file
already declares in that scope, measured as **41 rows naming a symbol without the field**
(34 `for` + 1 `with … as` + the 6 walrus targets, whose names are bound by an assignment already).
The price's 516 is a LOWER BOUND on what the analyzer may publish, because CPython rejects 56 of the
11,488 files and tree-sitter is error-tolerant: `.tmp-py/census-bound-by-binder-failed.mts` reads
those 56 separately and finds **14 more** binder symbols in them (13 `for`, 1 `with` —
`docker/daemon/libnetwork/cmd/ssd/ssd.py` alone contributes 9, plus hledger's regression tool and two
nvim-treesitter fragments). Measured total: **480 + 14 = 494**, which is the corpus-wide symbol delta
of this round (206,445 -> 206,939, 206,939 re-counted by the census itself) to the digit — every symbol
the round added is one of these binders.

**The provenance field does NOT cross the worker boundary, and that is declared rather than papered
over.** `.tmp-py/seam-metadata-probe.mts` runs both entry points over the priced files and compares
metadata KEY SETS: the analyzer publishes **17** symbol-provenance keys and `parseFile` carries **1**
(`superTypes` 505 -> 388, the key the php lane added when its owner pass needed the ancestor column).
`pythonSpecific`, `isModuleVariable`, `hasTypeHints`, `isAsync`, `isClassMethod`, `isAbstract`,
`isClassVariable`, `hasDocstring`, `isInstanceAttribute`, `baseClasses`, `isEnum`, `multiTargetForm`,
`boundByBinder`, `isEnumMember`, `isNestedClass` and `boundByGlobalWrite` all measure **0%** survival,
because `src/ast/pool-worker.ts`'s projection is a per-key allowlist and the allowlist's rule is that
it names keys a READER CONSUMES. A fixture cannot see this — `run-fixtures.ts` calls the analyzer
directly, `engine.parseFile` never crosses the worker — which is MD-5's "unpinnable" shape exactly.
The SYMBOL crosses, which is what this round's mechanism is for; the FIELD is analyzer-side only, and
it is recorded as PY-D26 in `docs/analyzers/LAPTOP-B-STATUS.md` with its numbers instead of being
widened into the allowlist without a consumer.

**PY-D24 — a member read is not a name.** `isinstance(x, self._self_owner)` is not a statement about
a project-wide type called `_self_owner`; it is a read of a member on an object whose type nothing in
the file states. The emitter published the last identifier as the target and the whole spelling as
`metadata.qualified`, so the edge named a name the file never declares, and the verdict could only
call it UNEXPLAINED (measured: exactly 3 rows — `_self_owner`, `related_model`,
`PasslibHashWarning`). `dynamicTypeBindingReason` now answers `member-read` when the leaf is the LAST
named child of an `attribute` (the MEMBER, never the receiver) and the attribute's root is a LOCAL of
an enclosing function. Both guards are load-bearing and both are pinned as mutants: without the
last-named-child test the RECEIVER leaf fires the rule and a reference to a genuine local is
relabelled `member-read` (the probe caught three rows of that before the rule shipped), and without
the receiver guard an import-bound root (`nn.Module`) would lose its `qualified-external` route and a
class this file declares (`Config.DEFAULTS`) would lose its chance to resolve against the store. The
fourth row in that cluster is `gdb.SignalEvent`, whose ROOT is bound by nothing — the rule does NOT
cover it, and it is covered by the verdict's `not-bound-in-file` axis instead (round 12, PY-D25).

### The class half is addressed by name AND line, and the truth extractor is what found it
### (round 13, 2026-10-12)

Round 12 published binder members and the differential's cython lane went from `unexplained=0` to
`unexplained=3`, all `contains`, all in `cython/tests/run/py_classbody.py` (lines 52, 55 and 58
binding `i`, `k` and `m`) — three `for` targets written directly in a class body. Round 13 closed it
on the TRUTH side, where the gap was: the lane's oracle (`script/m14/oracles/python-truth.ts`) derived
class members from `def` and `=`, so it could not state a binding the language writes and that very
file's doctest exercises (`ForLoopInPyClass.k` → `0`, `.m` → `1`). The extractor now derives
`for_statement` / `with_item` / `except_clause` at class scope — and a class-body assignment whose
target is a PATTERN — with each name carrying the TARGET node's own line, because `contains` resolves
by name AND line, and with the `as` shapes read through the same accessor the analyzer uses.

The falsification is the round's evidence, and it is two whole-corpus runs rather than an argument:
with the clause removed the FULL 475-file cython corpus reads `tree-truth=92,210 … unexplained=3
(0%) MISSING=0`, naming exactly those three rows; restored it reads `92,213 … unexplained=0 (0%)
MISSING=0`, with the SAME `analyzer-edges=28,012` and the same run hash — the clause adds exactly the
3 truth edges it explains and moves no analyzer edge (`.tmp-py/round13-falsification-off.log`,
`.tmp-py/round13-falsification-on.log`). Requests (37 files) and the cython canonical rotation both
read `unexplained=0`.

Deriving per site is what exposed the analyzer inconsistency described above — one member published
per NAME where every other class-member path publishes per SITE. The class half is per site now, the
module half per name, and both prices are written down. Fixtures **51/51**, mutants **50/50 caught**
(including `round13/class-binder-per-name-dedupe-restored`), `tsc --noEmit` clean, inventory
`--lang python` sections A–H **8/8**, python's label-coverage row clean, and the spec records the rule
as **PY-D27**.

### A module-level `__getattr__` PROVIDES names, and the file spells them (round 14, 2026-10-12)

The verdict's last 7 UNEXPLAINED incoming rows were all `exports`, and 2 of them were
`tree_sitter_clean/__init__.py -> HIGHLIGHTS_QUERY` and `-> TAGS_QUERY`. That file states both
provisions in its own source — a module-level `def __getattr__(name)` with
`if name == "HIGHLIGHTS_QUERY": return _get_query(...)`, `TAGS_QUERY` the same, and both listed in
`__all__` — so the name is public surface and the module's OWN export edge could not resolve against
its own file.

The rule reads what the file spells: the comparison's left side must be the function's OWN first
parameter name (not the literal word `name`), the operator `==` or `in`, the right side a string
literal or a tuple/list/**set** of them, the value a python identifier, and a comparison whose `if`
consequently raises `AttributeError` is skipped — that shape states what the module REFUSES, and
publishing it would be a fabricated export. Each name is published as a module Variable at the
literal's own line under `metadata.boundByBinder: "getattr"`, the key round 12 introduced, so no new
metadata key enters the worker seam.

**Two pricing passes, and the second one is what found the bugs.** The first
(`.tmp-py/price-module-getattr-exports.py`) classified the 7 verdict rows; it hardcoded the parameter
spelling and never counted files that define a module-level `__getattr__` at all. The second
(`.tmp-py/price-module-getattr-round14.py`) measures this rule over 11,245 parsed files: **26** define
a module-level `__getattr__`, **6** spell literal names while **20** spell none, those 6 hold **14**
names, **1** is already statically bound in its own file (cython's `gs`) and **2** are already in the
file's import channel — so **11 symbols** as round 14 left it (round 15 below prices that second
subtraction and lands on **13**). Measuring the shipped analyzer against that price is what
exposed two defects in the rule's own first version: an **annotated** parameter (`def
__getattr__(name: str)` — 6 of the 26 files) parses as `typed_parameter` and was refused outright,
and `ansible/module_utils/_text.py` spells a branch `in {"to_bytes", "to_native", "to_text"}` — a
**set** — which the first version published nothing for. Both are fixed and both are pinned as
mutants; `.tmp-py/census-getattr-provisions.mts` walks exactly the 6 files the price names and read
**11 published, 0 unexplained misses** when round 14 left it, printing `14 - 1 - 2 = 11` as its own
last line. **Round 15 re-pointed that instrument at the narrowed rule: it now reads 13 published /
0 misses from `14 - 1 = 13`, exit 0** — so the 11 here is round 14's reading, and the section below
is where it changed.

Corpus effect, measured on the whole-population instrument rather than argued: `totalSymbols`
**206,940 → 206,951** (exactly +11) and `exports` incoming UNEXPLAINED **7 → 5**, naming exactly the
rows that remain. The gate's declared ceiling moves **7 → 5** with its cause rewritten to the two
mechanisms that survive: **4 SUBMODULE rows** (PY-D29 — the package ships `dialects/mssql/__init__.py`,
and the analyzer is handed one file, so a position for the name would be invented) and **1 stale
`__all__` row** (PY-D30 — `declarative/__init__.py -> instrument_declarative`, a name the file supplies
by nothing at all; corpus-wide, 3,043 `__all__` entries reduce to 6 stale and 6 submodule rows).

**One declared asymmetry** (PY-D31): the publication guard reads the file-wide import channel, so
`cython/Cython/Build/__init__.py`'s `build_ext` — provided by the very branch that imports it locally —
is not published, while the same situation spelled with `as` is. Round 14 declared it at 2 of the 14
priced names and 0 verdict rows, and deferred the narrowing with the reason stated: narrowing it would
also move round 12's binder-row count, whose sensitivity was unmeasured. **Round 15 priced it and
narrowed it** — see the next section.

### The guard is scoped to module-scope imports, and the price said the binder rows do not move
### (round 15, 2026-10-12)

`.tmp-py/price-guard-narrowing.py` mirrors the SHIPPED channel construction (`import a.b` contributes
its ROOT, `import a.b as c` contributes BOTH, `from m import a, b` contributes the ITEM names and never
a bound alias — the asymmetry round 14 had to pin), computes the candidates the walk would publish at
module scope (the binder targets plus the PY-D28 provisions), and reads over 11,245 parsed files: the
guard drops **exactly 2** candidates corpus-wide (`build_ext`, `codecs`), both provisions and both by a
function-local import, while the **binder half loses zero rows**. That is what retired the round-14
worry — by measurement, not argument.

The fix uses what the walk already knows: it never enters a function body and it sets `currentClass`
inside a class body, so any import statement it pops with no class open is module scope by
construction, and those lines go into `moduleScopeImportLines`, which the guard now consults. An import
row with no line (never observed here — both handlers set `range`) is KEPT, so a missing position
cannot silently widen the publication.

Measured against the committed artefact: `totalSymbols` **206,951 → 206,953** (+2, exactly the priced
names), every edge count unchanged (1,290,653), every label's `unexplained` unchanged (`exports` still
5) and **exactly one resolution cell moved** — `uses` at project scope, `RESOLVED 46,922 → 46,923` and
`EXTERNAL 155 → 154`, because `codecs` is a name nothing declared before and one thing declares now.
No `AMBIGUOUS` count moved anywhere: the 2 publications created no second declaration of any existing
spelling, which is the risk the guard exists against and why the fixture now pins a
module-scope-import row (`path`) as a **forbid**. The fixture's `SHADOWED_BY_LOCAL_IMPORT` row flipped
from `expectSymbolCount: 0` to `1`, and two mutants are CAUGHT — the round-14 file-wide read restored,
and the over-correction that drops the channel check instead of scoping it. Fixtures **52/52**, mutants
**61/61 caught**, `tsc --noEmit` clean, the verdict gate still passing with its `exports` ceiling at 5,
and the round-14 provision count corrected from 11 published to **13**.

**Round 14, as ITS OWN section closed** (kept here with its numbers so they are not read as round
15's): fixtures **52/52**, mutants **59/59 caught** with 0 survivors (9 new, including the restored
annotated refusal, the restored hardcoded `name` spelling, the restored set refusal, the deny-list
publication, the dropped class gate and the dropped module-half per-NAME dedupe), `tsc --noEmit` clean,
inventory `--lang python` sections A–H **8/8**, spec **PY-D28** + **PY-D29/PY-D30/PY-D31**, and the
fixture runner's EXPORT INVARIANT is what forced the fixture rewrite rather than a weakened check — an
`exports` edge whose target is no top-level symbol is a violation, so the stale-`__all__` shape is
declared as a residual instead of pinned as correct. **Round 15 then took that battery to 61/61**, and
round 16 left the analyzer untouched, so 61/61 is the number the shipped analyzer carries.

### The last 5 UNEXPLAINED rows were TWO mechanisms, and BOTH are now named and gated
### (round 16, 2026-10-12)

Round 14 declared the residual and round 15 narrowed the guard under it; the 5 `exports` rows were
still counted on the defect axis, because a declared residual is still a row nobody has explained.
This round splits them into two mechanisms, gives each a PREDICATE, and re-checks every row of both
against CPython's `ast` and the filesystem. The defect axis goes **5 → 0**; the rows themselves are
STILL UNRESOLVED as name-declarations, and saying so is the point — what moved is the defect count,
not the binding.

**Priced before any code, with the instrument's own answers held aside**
(`.tmp-py/price-export-residual-r16.py`: CPython's `ast` + the path layer, per row asking whether the
name is bound anywhere in its file, whether the file's `__all__` states it, whether a module of that
name is shipped BESIDE the file, and how many files of the population mention it): **4
shipped-submodule · 1 stale-export · 0 rows fitting NEITHER predicate.** The zero is the load-bearing
number — a row with no predicate would have been work the round still owed.

- **4 — `shipped-submodule`.** `sqlalchemy/dialects/__init__.py` writes
  `__all__ = ("mssql", "mysql", "oracle", "postgresql", "sqlite")`, binds none of them, and the
  package SHIPS `dialects/mssql/__init__.py`, `mysql/`, `oracle/`, `postgresql/`. Python's import
  system supplies such a name — re-exporting SUBMODULES lazily through `__all__` is the idiom — and a
  MODULE is not a DECLARATION, which is precisely why a name index cannot hold it. The axis claims
  there is no defect in the row; it does NOT claim the name resolves.
- **1 — `stale-export`.** `ext/declarative/__init__.py` lists `instrument_declarative`, binds it
  nowhere, imports it nowhere, ships no submodule of that name, and the name occurs in **exactly one
  file of 11,488 — the `__all__` that names it** (a name SQLAlchemy dropped while leaving it in
  `__all__`). The file's stated public surface names something that exists nowhere: a defect in the
  CORPUS, and the edge the file states is honest to emit. Note the 5th dialect name, `sqlite`, was
  never on this axis: it binds by LEAF to a declaration elsewhere in the population, which is the
  verdict's declared project-scope model rather than a claim that it resolves.

**Both axes read facts the instrument already holds**, never a re-parse: the file's own `exports`
edges ARE its `__all__`, the admission set IS the sibling-path test, and the text the analyzer was
handed IS the mention count. Neither axis reuses `not-bound-in-file`: that axis structurally cannot
apply to an `exports` row (it requires a binding `reasonCode`), and applying it would erase the very
distinction these two rows carry.

`validation/m14/fixtures/python/export-residual-gate.mts` re-derives every clause per row with
CPython — the `__all__` literal, the file's COMPLETE binding set, the sibling path on disk, and a
population-wide identifier scan with word boundaries — reading **AGREE 4 + 1 · UNPARSEABLE 0 ·
DISAGREE 0**, exit 0, over 11,334 files for the stale axis. It was **falsified in three directions
before it was trusted**, each exit 1: a 5th row the artefact does not carry (count mismatch), the
stale-export row re-pointed at a name that IS bound and IS mentioned in 61 other files (DISAGREE), and
a submodule row re-pointed at `no_such_module` (DISAGREE — no `__all__` entry, no module on disk).

**Measured on the whole population, against the committed artefact:** 11,488 files · **206,953**
symbols · **1,290,653** relationships — all three identical; every one of the ten labels' edge counts,
bins and `unexplained` values identical except `exports`, whose `unresolvedClass` now reads
`{shipped-submodule: 4, stale-export: 1}` with `unexplained: 0`; OUTGOING unresolved still **0 on all
ten**. The verdict gate's `exports` ceiling went **5 → 0** with its cause rewritten, and its header now
names nine axes plus UNEXPLAINED. The rows' BINS are unchanged — `exports` still carries 5 UNRESOLVED
project-scope targets (5 EXTERNAL at file scope) — because the ceiling bounds the DEFECT axis, which is
the one thing this round moved.

**One measurement this round could not explain, and reports rather than dresses up.** Two
full-population runs of the same instrument over the same corpus reproduce **every count exactly** —
1,436 scalars compared, 0 differing; every bin, axis total and label count identical — but NOT the
order in which files are walked: **32 of 70 sample lists** (`examples`, `fileSample`,
`ambiguousTargets`, `unresolvedProjectTargets`) differ as MULTISETS, and one top-40 tie boundary
swapped a key (`timedelta` ↔ `nodes`, both count 1). Two back-to-back `--limit 400` runs are
byte-identical INCLUDING the samples, so the effect appears only at full population and its cause is
NOT established here. The strongest evidence is on a COMPLETE list rather than a sample: the run
rewrote `not-bound-in-file.rows.txt` with the SAME 85 rows as the committed one, in a DIFFERENT ORDER
(sorted-equal, order-different). It cannot reach a pinned number: every gate reads counts and those
COMPLETE axis row lists, and a row's axis depends on `(file, target)` plus the project indices, never
on walk order.

Fixtures **52/52** (the analyzer was not touched this round), `tsc --noEmit` exit 0, the axis gate
exit 0, the verdict gate exit 0 with total UNEXPLAINED **0** and outgoing 0 on all ten, inventory
`--lang python` 130 types / sections A–H **8/8**, spec re-parses and stays all-ASCII with **PY-D29**
and **PY-D30** kept `DECLARED` — the rows are still unresolved, so the status is unchanged on
purpose — and each carrying an appended paragraph that records the closure of the defect axis.

### The import surface as a set — every item of every statement, and two item classes that
### never reached a row (round 18, 2026-10-13)

**THREE DEFECTS, ONE QUESTION: can a file's import surface be read as a SET?** The round was declared
as one item (PY-D32's row model, PY-D13's sibling) and came out as three, because the price for the
first was cross-checked by a second instrument and the cross-check disagreed — on four files out of
800, and each disagreement was a defect nobody had named.

**1. The store kept one row per STATEMENT (PY-D32, closed).** Every layer above the store was already
per ITEM: `src/ast/pool-worker.ts` projects `{name, path, alias?, type, isExternal, line}`, one entry
per name the statement binds, and its own comment calls that granularity the thing that "directly
determines audit precision". The indexer then built the row id as
`` `${fileId}:import:${moduleName}:${impLine}` `` — module and line, BOTH of which every item of a
statement shares — and wrote the rows with `INSERT OR REPLACE`, so each item overwrote the one before
it and only the LAST survived. `from m import Sku as SKU, fixture` stored `fixture`; the binding was
gone and the item with it. **Priced through the production projection** (`parseFile`, the same
function the indexer calls through the pool) over **2,000 stride-sampled corpus files** (python 800 /
typescript 600 / javascript 600, every repo, <= 1 MiB): **11,903 item rows projected, 8,903 distinct
ids written — 3,000 rows lost, 785 files affected, +33.70 %**, largest single statement 45 items
(`.tmp-py/probe-import-rows-sample.mts` → `.tmp-py/round18-sample.json`). **The fix is the id:** an
OCCURRENCE COUNTER inside one (module, line) group — not the item name, because a statement may
legally bind the same name twice (`from m import a, a`) and an id that can collide is the defect being
fixed. The first row of each group keeps its historical id byte for byte, so nothing that already
reads an id sees a new value; ids are per file, the loop is per file, and the file's rows are deleted
and rewritten together (`deleteFileImports`), so no stale id survives a reindex.

**2. `from __future__ import x` was invisible to the walk (PY-D33).** tree-sitter-python gives that
construct a **node type of its own** (`future_import_statement`) and hard-codes the module inside the
rule — probed: the node holds ONLY its items, `dotted_name`s, and `__future__` is not a named child.
The walk dispatched `import_statement` and `import_from_statement` only, so the statement produced NO
row and NO edge. **Over the population: 1,286 statements, 1,298 items, every one reaching nothing**
(`.tmp-py/round18-surface-price.log`); the dominant item is `annotations`, a real request that changes
how a module's annotations are evaluated. The spec had this node type classified `internal_silent` in
**PY-D5** — "no legal Python 3 source produces them", a rule that is true of `print_statement` and
`exec_statement` and FALSE of this one — so the fix included correcting the classification in the same
edit that corrected the analyzer. **What was deliberately NOT changed:** a `__future__` import binds NO
NAME, so `addImportBoundNames` and `ctx.importRoots` keep ignoring it; adding it there would publish a
symbol no file can use. The row and the edge carry the DEPENDENCY, which is what the file declares.

**3. An item that spells the module name was dropped (PY-D34).** The item loop skipped the module with
`if (c.text !== moduleName)` — a TEXT comparison, written to skip the module NODE (one of the same
loop's named children). Any ITEM that spells the module name is indistinguishable from the module under
that rule, so `from datetime import UTC, datetime` published `items: ["UTC"]`: the row lost
`datetime`, the edge lost it too, and `datetime.date(...)` in such a file named a name bound by nothing.
**Over the population: 158 such items**, each with file and line in
`.tmp-py/round18-surface-price.log` (`from netrc import netrc` in `requests/src/requests/utils.py:246`,
`from datetime import datetime` in `ansible/lib/ansible/modules/uri.py:442`, …). The fix records the
module NODE and compares **node ids** — `.id`, not `===`, for the reason this file's own PY-D18
collector already records at its own module-vs-item guard (web-tree-sitter hands back a fresh wrapper
per access). `from a.b import b` and `from . import y` already behaved and are unchanged.

**The instrument that found 2 and 3, and why building it was the round's best decision.** The row-model
price is `parseFile` per file (~350 ms), so it can only reach a sample. A second arm was written in
CPython's `ast` (milliseconds, whole population) and **run on the sample's own file list** — 800 python
files, the exact set written out by the projection arm. The two agreed per file on **796 of 800**, and
the four exceptions are the two defects above: three files where `from __future__ import …` produced
nothing, one where the module-named item was dropped (`gql-saleor/saleor/webhook/transport/metrics.py`,
`ast` 7 rows vs projection 6). **A cross-check whose purpose was to validate a price is what found the
round's second and third defects** — the same lesson as round 17's corrected price, one level up: an
instrument that agrees is evidence, and an instrument that disagrees on four rows is a finding list.

**Verified in a detached worktree at HEAD, because this checkout is shared.** Another lane is mid-edit in
`src/ast/parallel-indexer.ts` itself (the r-lane's per-id clause-4 work) and in three analyzers, so the
five source edits were stated as a script (`.tmp-py/apply-round18-edits.py`, apply/revert, every anchor
asserted present exactly once) and applied to `git worktree add --detach /tmp/bb-r18 HEAD`. There:
`npx tsc --noEmit` exit 0 · fixtures **53/0** · `import-bound-name-seam.mts` exit 0 with **A–G** (F and
G are new: F asserts the store holds every item of two multi-item statements built in BOTH orders,
G asserts the `__future__` row and the `clock:clock` edge through `indexProjectParallel`) ·
`resolution-verdict-gate.ts` exit 0 with total incoming UNEXPLAINED **0** · `export-residual-gate.mts`
exit 0 · `typecheck:scripts` exit 0.

**The lane's control was RED at HEAD and is green again, with the discrimination preserved.** Commit
`d2ca95628` respelled the `overrides` target from `Owner.member` to the declared member, which collapsed
`python/companion-index/comp-child`'s forbid row — its forbidden pattern (`Redirect.send -> send`) then
matched the 0.95 TIER-2 promotion it is meant to permit — and that commit left the fixture failing on
purpose, naming the follow-up (carry the owner in metadata and re-anchor there). That fixture is in this
lane's directory and it blocked every mutant run (the harness refuses to report a mutant result against a
red control). **The re-anchor keeps the original claim and moves it to the fact that still separates the
two cases:** the promotion raises the confidence from the 0.5 guess to 0.95, so the row now carries
`confidenceMax: 0.5` — it forbids exactly the unpromoted guess (and would fire if the promotion stopped
happening), while the `expectRelationships` row above keeps requiring the promoted edge at
`confidenceMin: 0.9`. The two-sided pair is intact; only the anchor moved from spelling to confidence.

**One harness change, because a mutant the fixture suite cannot see is not a survivor.** The store's row
model lives in the INDEXER, and every python fixture reads the analyzer's return value — so the row-model
mutant would have been reported SURVIVED for the one reason that makes a survivor meaningless. The
harness now takes `target` (which file to mutate) and `checker` (`fixtures` or `seam-pin`) per mutant,
snapshots and restores every target, and gained `--only <substr>` for iteration while the full run stays
the record. The three new mutants: `round18/row-id-per-statement-restored` (checked by the seam pin),
`round18/module-item-skipped-by-text-restored`, `round18/future-import-dispatch-dropped`.

## INCOMING round 19 — the import-evidence external claim (2026-10-17)

**The defect, in the lane's own words.** `python-endpoint-resolution.ts` has always binned an endpoint
whose name "binds to a name this file IMPORTED and to nothing in the corpus" as `EXTERNAL` — its own
axis, its own docstring. The analyzer published no marker for those edges, so `incoming-gate.ts`
counted every one as `unresolved`: the fleet's finding (a), second instance on this lane. The claim
now published is `metadata.isExternalTarget` (the arbiter's recognised external key) with two audit
fields — `externalReason` and `externalSpecifier` — the spelling `real-java-analyzer.ts:4029-4040`
established for the same job.

**Two shapes, because a python name reaches a module two ways.**

| shape | example | evidence |
|---|---|---|
| TARGET-BOUND | `from pathlib import Path` -> `references f -> Path` | the target IS a name this file's module scope binds by a non-relative import |
| ROUTE-BOUND | `import os` -> `calls f -> getenv`, route `os.getenv` | the target is a member and `metadata.qualified`'s root is such a binding |

`collectModuleImportBindings` reads the bindings (module first segment for `import a.b`, the alias for
`import a.b as c`, the item/alias for `from m import X [as Y]`); relative imports are skipped because
they name this project, and `__future__` imports because they bind no name (PY-D19). `dottedChainRoot`
accepts only a pure dotted identifier chain as route evidence, so `re.sub(...).strip` — whose member
belongs to the CALL RESULT — is refused while `re.sub` itself is certified. `collectFunctionScopes`
answers "is this name a LOCAL at the edge's own line?" positionally (LEGB); a file-wide shadow test
was measured wrong by the lane's own fixture, where one `def f(os)` stripped every other function's
`os.*` claims.

**It is additive and it is neither a resolution nor a type inference.** The target is never rewritten —
the leaf endpoint contract eight fixtures pin stands. The arbiter reads an external claim ONLY where
the target names nothing, so `resolved`, `amb(decl)` and `collRes` cannot move; the claim can only
re-label an edge that was already a gap as a stated, refutable external dependency. The guards are:
claim type ∈ {calls, uses, references, extends, implements} · one claim per edge (the builtin
namespace claim keeps its own) · the file does not DECLARE the target · the reason code does not say
the name is bound in this file · the target/route-root is not a local at the edge line.

**Fixture and mutation.** `validation/m14/fixtures/python/import-evidence-is-an-external-claim`
pins 11 positive rows (six modules, both shapes, the `import numpy as np` alias) and 7 forbid rows
(relative import, declared name, local binding, local receiver, unbound bare callee, expression
receiver, parameter-shadowed module root). Each guard was removed in turn and the fixture failed on
exactly one intended row: relative-import -> `LocalBase`, `declaredHere` -> `uses_declared`, the
pure-chain test -> `expression.strip`, the line-scoped shadow test -> `shadowed_root.getenv`.

**Independent audit.** `validation/m14/fixtures/python/audit-import-claims.py.tool` re-derives the
file-level evidence with CPython's own `ast` (module-level imports and their bound modules, declared
names, def/lambda/comprehension scopes with line ranges) and asks every claim back: is the name
imported, does `externalSpecifier` match CPython's import, is the target declared, is the name a
local at the edge line. On the first 150 admitted files: **10,649 claims checked, 0
name-not-imported, 0 specifier-mismatch, 0 shadowed-at-line**; 9 rows hit the audit's deliberately
generous "declared" set, every one a function-local assignment the analyzer does not publish as a
symbol (`pad = 4`, `match = None`, `path = os.path.join(...)`), and for route-bound claims the name
checked is the route root, not the member leaf.

**Measured, 400-cap gate (same stride population):**

| | edges | resolved | collRes | amb(decl) | unresolved | extOK | ext? | extFAIL |
|---|---|---|---|---|---|---|---|---|
| before | 44,440 | 11,183 | 2,313 | 5,337 | 27,656 | 264 | 0 | 0 |
| after | 44,440 | 11,183 | 2,313 | 5,337 | 20,172 | 7,748 | 0 | 0 |

`calls` +5,224 extOK · `uses` +1,206 · `references` +969 · `extends` +349. Binding intent every row
identical (calls arbitraryTwin 4,182 and nothingAnywhere 11,874, unchanged).

**Measured, whole population (`python py 0`, 11,466 `.py` files, 1,292,855 edges):**

| | resolved | collRes | amb(decl) | unresolved | extOK | residual |
|---|---|---|---|---|---|---|
| before | 439,236 | 95,335 | 547,735 | 297,485 | 8,399 | 845,220 · 65.38% |
| after | 439,236 | 95,335 | 547,735 | 187,889 | 117,995 | 735,624 · 56.90% |

`resolved`, `collRes` and `amb` are byte-identical on 1,292,855 edges — the claim cannot move a name,
so unresolved → collRes is unreachable by construction and the measurement agrees. `arbitraryTwin`
did not move (759,326 both runs); 71,633 claim-carrying ambiguous edges are all `ownFileSilent`
(another file declares the name — reported, not charged). Per type, unresolved before → after:
calls 162,352 → 97,009 · uses 45,370 → 24,307 · references 21,708 → 1,998 · extends 3,387 → 44 ·
implements 140 → 3; `imports` is unchanged at 64,462 (see the proposal).

**THE PROJECT-ABSOLUTE REFINER, AND WHAT IT CHANGED (commit `8def4a5d5`, 2026-10-17).** A per-file
analyzer cannot tell `from grace_generated_openapi_probe.x import Y` (the project's own code, imported
absolutely) from `from pydantic import BaseModel` (outside it). The Lead's refiner reads
`metadata.externalSpecifier` — the field this claim was already publishing — and turns a verified
claim into `externalUnverified` (ext?) when the specifier's root names a module the PROJECT ships (a
directory basename or file stem of the admitted list). It is fail-closed: a claim changes LABEL, never
outcome, so `extFAIL` cannot rise and `resolved`/`collRes`/`amb` cannot move. Re-measured at cap 400:
`extOK 4,003 · ext? 3,744 · extFAIL 0 · unresolved 20,173` — residual 32,993 → 29,254 (−3,739,
−11.3%); the 3,744 are counted exactly as failures, not as wins. The whole-population `extOK 117,995`
above is the PRE-refiner split; the refiner moves part of it to `ext?` (a whole-population re-run is
recorded in PYTHON-STATE.md §5a1). The remaining lever on that class is project knowledge (a
`ProjectIndex.complete`-gated claim, the Java pattern), which is exactly why the claim carries the
specifier rather than a bare boolean.

**What this does NOT claim.** The dynamic class — `self.m()` / `recv.m()`, the target leaf whose
dispatch class is not in the file — keeps NO claim; the receiver's runtime type is in neither the
grammar nor the corpus, and `PYTHON-FIX.md` §3 proved a declared-cause relabel is REFUTED for a bare
leaf (`targetOwner` is null). `imports` targets (`pathlib:Path`, `os:*`) are also NOT claimed: every
claim kind refuses the colon shape, and fixing that needs a rule change in the Lead-owned
`script/m14/incoming-rule.ts` — priced in
`validation/m14/proposals/python-imports-module-namespace-claim.md` (3,554 of 6,661 imports edges on
the first-400 slice name a stdlib module; ≈53,000 at whole population, 17.8% of the residual).

## Census

- Baseline (M12 issue #166): 5 census regex entries in `real-python-analyzer.ts`.
- After M12.27: **0**. Project census: 69 → 64. Re-measured 2026-10-05: `real-python-analyzer.ts`
  contributes **0 regex literals**, and the whole-tree census reports 4, all in
  `real-svelte-analyzer.ts`. The analyzer and all five lane instruments on this branch were
  re-checked through the TypeScript AST: **0 regex constructs across 6 files**.

## PythonStdlib external claim (2026-10-17) — imports

An `import`/`from` edge whose top-level module is in `sys.stdlib_module_names` is emitted with
`metadata.isStdlib: true` and `metadata.externalReason: "pythonStdlib"`. The arbiter
(`script/m14/incoming-rule.ts`) verifies such a claim against the project's admitted files: a project file
carrying the module as a path segment REFUTES it, otherwise it VERIFIES as external.

**The leading dot is part of the rule.** A relative import (`.types`) is LOCAL by the grammar of the source
and is never stdlib. Stripping the dot once claimed `from .types import UUID` as the standard library —
`types` IS a stdlib name — and because a relative import's target is the bare item, the arbiter found no
declaration and *verified* the false claim: **6 false `verified external` edges**, the outcome this
programme treats as a false statement about another repository. Fixed at `isPyStdlibModule` (:772).

**Measured, whole command `bun run script/m14/incoming-gate.ts python py 50`:**

| | resolved | unresolved | extOK | ext? | extFAIL |
|---|---|---|---|---|---|
| before | 0 | 385 | 0 | 0 | 0 |
| after  | 0 | 268 | 96 | 0 | 21 |

The **21 `extFAIL`** are stdlib claims the project refutes: a project file carries that module name, so the
claim is wrong there and the verifier says so. They are owed a classification, not a tuning pass.

**Still unresolved and why (268):** third-party modules (not provable from a single file) and absolute
project-local imports (needs `context.projectIndex`). Retargeting those to their bare item would false-bind
**5 python / 432 typescript / 276 javascript** items by the analyzer's own recorded measurement — the route
is the project index, not a spelling change.
