# python

The **lane contract** for python: what a consumer may rely on, what is deliberately not
claimed, and where the evidence for each claim lives. For how the extraction actually works,
see [`real-python-analyzer.md`](./real-python-analyzer.md). For the measurements and the
defects behind them, see [`reviews/python/master-review.md`](../../reviews/python/master-review.md).

## At a glance

| | |
| --- | --- |
| Analyzer | `src/ast/real-python-analyzer.ts` (`RealPythonAnalyzer`) |
| Extensions | `.py`, `.pyi` |
| Grammar | `tree-sitter-python` 0.25.0, `wasm/tree-sitter-python.wasm`, **pinned by sha256** |
| Fixtures | **52**, all passing (`bun script/m14/run-fixtures.ts --lang python`, exit 0) |
| Mutants | **59, none surviving** (`python3 script/m14/python-implements-mutants.py`: 59 caught · 0 survived · 0 not applied) |
| Completeness | **127 named node types classified** — 71 handled-verified, 56 internal-silent, **0 gaps**, **30 design decisions** (`script/m14/spec/python-completeness.json`, re-read by `npx tsx script/m14/completeness-inventory.ts --lang python` → sections A–H **8/8**; the file is ASCII-only) |
| Regex | **0 executable regex literals**, 0 `new RegExp(`, 0 `RegExp` — verified by stripping comments and strings first. **Caveat:** `clean-completeness-gate.ts` §4a hardcodes the `clean` lane and does not check this one, and the committed M12 census record is stale for python (`STALE … :589:/^@/`, a regex since removed) — see `reviews/regex-policy.md` |
| Corpus | **11,488 files, 206,953 symbols, 1,290,653 relationships, 0 parse failures** — `validation/m14/fixtures/python/resolution-verdict.current.json`, re-measured 2026-10-12 (round 15). **42 rows still live in files CPython itself rejects** (ASN.1 documents and a py2 build script carrying a `.py` extension, a highlighter fragment) and are declared as a file-level residual rather than counted as damage |
| Independent oracle | **Ten labels emitted, all ten under an independent derivation**, and the differential's two lanes read `covered=100% MISSING=0 unexplained=0` (cython rotation + the fixed 37-file `requests` corpus). Incoming `UNEXPLAINED` over the whole population is **5, all in `exports`** — 4 SUBMODULE rows and 1 stale `__all__` row, each named below — and **0** for the other nine labels; outgoing (source) unresolved is **0** for all ten |

Every figure in this table is an instrument reading taken on **2026-10-12** (round 14). Rows added
before this round quote an earlier, smaller population (3,271 files, 45,560 symbols) and are marked
where they appear.

## What a consumer may rely on

**Ten relationship types are emitted, and each carries a stated confidence.** Counts are the
population's, from `resolution-verdict.current.json`.

| Type | Confidence | Count | Claim |
| --- | --- | --- | --- |
| `contains` | 1.0 | 135,652 | Derived from `ownerName`, so it is a statement about the parse, not an inference. |
| `extends` | 1.0 | 20,954 | Bases are read from the class's own argument list. |
| `imports` | 1.0 | 97,112 | Read from `import_statement` / `import_from_statement`. |
| `exports` | 1.0 | 3,043 | Read from `__all__` assigned a **list**, **tuple** or **set** literal — and, since round 14, an entry is **resolvable** when the file's own module-level `__getattr__` spells the name (PY-D28). |
| `calls` | 0.9 | 535,006 | A name in call position, including an **imported** class — the commonest call shape in the language. |
| `uses` | 0.9 | 389,972 | A member **read** (`self.x`), marked `isMemberRead`. Excludes assignment targets, call callees, and call receivers. |
| `instantiates` | 0.9 | 13,134 | A class **declared in this file** called with `New()`. Never an imported class. |
| `references` | 0.95 | 61,955 | A name used in a **type or annotation position**, carrying a `reasonCode` for which position (`annotation-type`, `instanceof-check`, …). |
| `implements` | 1.0 structural / 0.9 contextual | 333 | An `ABC`/`Protocol` base the file declares; the 0.9 tier is the 3 `.register(...)` sites that are proven rather than spelled. |
| `overrides` | **0.95 verified / 0.5 guessed** | 33,492 (3,176 / 30,316) | See the resolution contract below — the two confidences mean two different things. |

**All ten emitted types are under independent verification**, each label compared against its own
derivation rather than against a shared helper — `contains` `extends` `overrides` `calls`
`instantiates` `uses` `references` `imports` `exports` `implements`. `depends` is not emitted: name
identity is carried by `imports`, `exports` and `calls`, and emitting a second edge for the same fact
would double the graph without adding information.

**Resolution contract.** The store resolves a relationship's endpoints by name, and by
**name + line** for `contains` only. For every other type, `line_number` is the **site** of the
edge — the line that names it — not a disambiguator. A source or target naming nothing in the
index is not a defect: it resolves to a NULL symbol id with `source_external` / `target_external`
set, which is the store's legal external state and the reason a python file that calls a library
function still records that it did.

**Source identity.** An `overrides` edge names its source `Owner.method`, and that string
resolves exactly because the indexer keys symbols on `${scope || ownerName}.${name}` as well as
`name`. This is load-bearing and pinned: `python/owner-name-stripped` deletes `ownerName` from
every symbol — which the analyzer itself does not notice — and is caught by
`python/external-override`, which asserts the owner on all three of its same-named `handle`
methods.

## `overrides`: the one relationship with two confidences

`overrides` is the only type whose confidence distinguishes *how the edge was found*, and the
distinction is the point rather than an accident of implementation.

1. **0.95 — verified.** The base class is declared in this file and the MRO walk finds the
   declaring class. MRO order is real: a derived class's method points at the base that
   actually declares it, not at the leftmost base that happens to share the name. (PY-8: before
   the fix, `Requirement.__new__` pointed at a mixin that does not define `__new__`.)
2. **0.5 — guessed.** The first base is not readable, and a guess is made from the first parent.
   This tier is a **cross-lane family contract** (php, ruby, python, js, perl, java, swift) and
   is pinned by `python/external-override`. It is not python's to remove unilaterally.
3. **`object.__init__` is a verified universal fact** (0.95), not a guess — every class has it.

**Measured, and recorded as a finding rather than a fix:** over 400 pinned corpus files the
0.5 tier fired **1,163 times and was confirmed 0 times**. The contract's middle tier — a
cross-file companion index consulted before guessing — is never populated, so the guess tier
absorbs cases a companion index was meant to resolve. The tier stays (it is shared); the dead
tier above it is filed as **PY-7**.

## `exports`: what resolves, and the two residuals that remain (round 14)

An `exports` edge is a read of the file's own `__all__` — the module's export contract — and it is
emitted for a `list`, `tuple` or `set` literal. What changed in round 14 is not the edge but whether
the name has a **declaration** to resolve against. A module-level `def __getattr__(name)` (PEP 562)
PROVIDES names: `hasattr(module, "X")` is TRUE for every name it returns and `from module import X`
succeeds, so such a name is public surface whether or not anything binds it. The lane now publishes
the names that function **spells** — the comparison's left side must be the function's own first
parameter name, the operator `==` or `in`, the right side a string literal or a tuple/list/set of
them, and the value a python identifier — at the literal's own line, under
`metadata.boundByBinder: "getattr"`. A comparison whose `if` consequently raises `AttributeError` is
the **inverted** shape: it states what the module refuses, and publishing it would be a fabricated
export.

Priced before the code existed, and the price is what found two bugs in the first version of the rule:
of 11,245 parsed corpus files, **26** define a module-level `__getattr__`, **6** of them spell literal
names (**20** spell none — they forward to `globals()`, build a dict, or import dynamically), and those
6 hold **14** names. One is already statically bound in its own file, so the rule publishes **13
symbols** — checked by walking exactly those files rather than asserted. (Round 14 read 11 there,
because 2 of the 14 were masked by the publication guard's file-wide import channel; round 15 scoped
that guard to module-scope imports, priced at exactly those 2 names and **zero** binder rows.) Both measured defects are pinned as mutants: the annotated spelling (`def __getattr__(name:
str)`, 6 of the 26 files) was refused outright, and the **set** spelling
(`ansible/module_utils/_text.py`'s `elif importable_name in {"to_bytes", …}`) published nothing.

**Two residuals remain, and neither is publishable from one file's text.**

- **4 SUBMODULE rows** (PY-D29). `sqlalchemy/lib/sqlalchemy/dialects/__init__.py` lists `mssql`,
  `mysql`, `oracle` and `postgresql` in `__all__` and binds none of them — the package **ships**
  `dialects/mssql/__init__.py`, so python's import system supplies the attribute. The analyzer is
  handed one file and cannot see the directory; inventing a position for the name would be the
  fabrication the endpoint rules exist to stop, so this belongs to the resolution layer that has the
  filesystem.
- **1 STALE `__all__` row** (PY-D30). `sqlalchemy/lib/sqlalchemy/ext/declarative/__init__.py` lists
  `instrument_declarative`; the file binds it nowhere, imports it nowhere, ships no submodule of that
  name and names it in no `__getattr__`. The edge **stays** — the file's own export list is the
  statement being read, and a stale entry is a fact about the source that a consumer would most want
  flagged. Corpus-wide, 3,043 `__all__` entries reduce to 6 such rows and 6 submodule rows.

`PY-D31` is the one place this contract was **narrowed after being declared**. The guard that keeps a
published binding from shadowing a declaration read the **file-wide** import channel, so a name a
function-local import binds (`cython/Cython/Build/__init__.py`'s `build_ext`, `_text.py`'s `codecs`)
was not published although a local import binds a *local* and states nothing about the module
namespace. Round 14 declared the pair with its price; round 15 priced the narrowing — exactly those 2
names and **zero** binder rows, which retired the worry that it would move a round-12 number — and
fixed it by recording the lines of the import statements the walk itself pops with no class open. The
whole-population effect is **+2 symbols, every edge count unchanged, and exactly one resolution cell
moved** (`uses`, project scope: RESOLVED 46,922 → 46,923, EXTERNAL 155 → 154 — a row that had no
declaration to bind to now has one). **No `AMBIGUOUS` count moved anywhere**, which is the guard's own
purpose: a name the file already imports at module scope is still refused, and the fixture pins that
direction as a forbid.

## Declared boundaries

These are **pinned as forbids**, so closing one later fails a fixture deliberately instead of
silently changing what the graph claims.

- `__all__` is read **syntactically**. A `NAME` inside the literal, a concatenation, and
  `__all__.extend([...])` each produce no edge — resolving them is data flow, not a syntactic
  read, and an analyzer that guesses a module's public surface reports a surface the author did
  not state.
- `overrides` is **not** guessed for a base that is declared in this file but does not define
  the method. The method does not exist to override.
- **Cython is not a framework.** It is the corpus's second-largest import root (429 sites
  across both spellings) and it is a *dialect* — and no analyzer in this repository publishes a
  `dialect` field, so recording it as a framework would be a false claim. Filed as **PY-16**.

## Frameworks

`metadata.framework` is a **single primary pick**, so only frameworks are admitted — never
libraries, or thousands of files would report a library as their framework. Detection is by
**import root read from the parsed AST**, never by text.

**There are two python framework tables, and the field is their union.** This is worth knowing
before reading either one: `enhanceWithFrameworkIntelligence` merges
`FrameworkDetector.detectPythonFrameworks` (`src/ast/framework-intelligence.ts`) into the same
metadata.

| Source | Frameworks it alone supplies |
| --- | --- |
| shared detector only | `pandas`, `numpy`, `tensorflow`, `pytorch` |
| lane table only | `starlette`, `sqlalchemy`, `aiohttp`, `celery`, `ansible`, `setuptools`, `sphinx`, `unittest` |
| **both** | `django`, `flask`, `fastapi`, `tornado`, `pytest` |

Testing frameworks sort **last**, so a file importing both an application framework and a test
runner reports the application one — the pick must not depend on which import was written
first. Over the corpus, **2,029 of 3,271 files (62.0%)** carry a framework.

## Evidence

| Claim | Where it is pinned |
| --- | --- |
| grammar bytes | `validation/m14/grammar-pins.json`, lane `python` |
| 52 fixtures | `validation/m14/fixtures/python/` |
| 59 mutants | `script/m14/python-implements-mutants.py` (ids prefixed `round*`/`python/`) |
| node-type classification | `script/m14/spec/python-completeness.json` |
| independent truth | `script/m14/oracles/python-truth.ts` + `python-truth-diff.ts` |
| the whole-population verdict | `validation/m14/fixtures/python/resolution-verdict.current.json` + `resolution-verdict-gate.ts` (the per-label contract, with each residual's cause and ceiling) |
| the round-14 provision rule | `.tmp-py/price-module-getattr-round14.py` (the price) and `.tmp-py/census-getattr-provisions.mts` (the check) |
| the measurements behind all of it | `reviews/python/master-review.md` |

## What the oracle found

An independent tree-derived oracle (`script/m14/oracles/python-truth.ts`) exists to falsify this
lane. Run over the whole corpus, it found **nine real defects**, each settled by asking CPython
rather than by argument:

| Defect | Kind | Effect |
| --- | --- | --- |
| A class nested in a **class body** had no `ownerName`, so no `contains` | loss | 60 edges recovered |
| A name bound in a **lambda or comprehension** was published as a class member | fabrication | 20 edges removed |
| Override bases keyed by class **name**, merging same-named classes | misattribution | 32 edges corrected |
| A class **variable** satisfied the "base declares this name" test | fabrication, marked **verified** | 22 fabricated edges at 0.95 |
| A **qualified** base (`unittest.TestCase`) bound to an unrelated local namesake | misattribution | external base made internal |
| `aiter`/`anext` were missing from the **builtin** filter | loss | builtins presented as undefined |
| Module-scope calls were dropped whenever the file was **named `module.py`** | loss | 2 edges recovered (PY-25) |
| A class-body `__all__` published **module** `exports` | fabrication | 3 false edges removed (PY-24) |
| A class-body `__all__` published **no** `contains`, though it is a real member | loss | last missing edge in the corpus (PY-24) |

The last two are one construct with opposite signs, and the pair is the most useful result here.
`__all__` is the module's export contract — `import *` reads the module binding and looks
nowhere else — so a class body that assigns one publishes nothing. The lane read it wherever it
found it, and then returned before the class-member path, so `CythonDotParallel` in
`cython/Cython/Shadow.py:786` produced three false `exports` edges *and* withheld one true
`contains`. The `contains` half is what the oracle reported. The `exports` half it could not:
the oracle derived them too, from the same unstated assumption, so two derivations agreed on a
false fact and the report came back clean. **A differential finds disagreement; it cannot find a
shared blind spot.** The false edges are now pinned as forbid rows on the *semantics* (`import *
` ignores a class `__all__`), not on the code path that implements them.

The third is the one worth remembering: it neither added nor removed an edge, it pointed a
*correct-looking* edge at the wrong class — which is why neither a count nor a set comparison can
see that failure, and why an oracle had to be built to say so.

A consumer reading this contract should know one consequence of how the store identifies edges:
**a `calls` edge count depends on formatting.** Three chained calls on one line publish one
relationship; the same three across three lines publish three, because the store's dedup key is
`(source, type, target, line)` and cannot express two occurrences of one call on one line (PY-22).

## Known gaps

Filed in the review, not fixed, each with the reason:

- **PY-7** — the companion-index tier of the `overrides` contract is still never populated **in
  production**, so the 0.5 guess tier absorbs every external override. Measured, that tier is not
  merely unverified but **wrong for 57.7% of the guesses whose base is in the corpus** (e.g.
  `RedirectSession.__init__ -> SessionRedirectMixin.__init__`, where the base declares no
  `__init__`). The lane now *can* read the tier — it previously could not accept an
  `AnalyzeContext` at all, read a misspelled field nothing wrote, and relied on
  `[key: string]: any` to hide both — and supplying an index removes **2,704** fabricated edges
  and promotes **855** to verified. Pinned both ways: the flat `external-override` fixture pins
  today's dead-tier behaviour, the sub-directory `companion-index/` fixture pins the tier working.
  Production population is the remaining, cross-lane half.
- **PY-9** — a `calls` target is a **leaf**, never a receiver-qualified name: `self.model.save()`
  becomes `save`. This is a repository-wide convention (typescript, java, ruby, go, csharp and
  php all leaf-ify), and python has the most call edges of any lane, so it has the most to lose
  from it. **54.4% of the lane's 535,006 call edges (291,114) are ambiguous** — more than one
  project symbol shares the target name (re-measured 2026-10-12 over the 11,488-file population: a call
  is ambiguous when its target name is carried by more than one distinct `owner.name` declaration) —
  and the store's name strategy requires uniqueness, so those do not resolve. (The earlier figure here
  was 42.6% of 90,869 over a 3,271-file population; both the population and the ratio have moved.) Much of that collision is coincidental with stdlib method names. A
  caller doing a name-only lookup should know this before trusting the result.
- **PY-16** — no `dialect` field exists in any lane, so Cython cannot be recorded honestly.
- **PY-17** — REFUTED as filed, and one real defect found under it. The census shows **0
  case-variant duplicates** across 3,271 files, so the two tables' differing casing never reaches a
  consumer, and they are **complementary rather than duplicate** (the second supplies all of
  pandas/numpy/tensorflow/pytorch, the first all of ansible/setuptools/sphinx). But
  `FrameworkDetector.hasImport` matches a needle against the **full dotted module path**, and
  `"platform".includes("tf")` is true — so **34 corpus files reported `tensorflow`** on the
  strength of a stdlib import. Fixed by adding a root-exact `hasModule` and using it for the
  python table only (`hasImport` left byte-identical for the ~20 other lanes that read it).
  `tensorflow` 34 → **0**. Gated by asserting *"a framework may only be reported if an import names
  it"* — **no fixture can cover this code**, since `FrameworkIntelligence` runs only inside
  `parseFile` while `run-fixtures.ts` calls `analyzer.analyze()` directly.
