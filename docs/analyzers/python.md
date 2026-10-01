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
| Fixtures | 15 |
| Mutants | 29, none surviving |
| Completeness | 130 node types, 60 handled, 65 silent, **0 unclassified**, 7 explicit decisions |
| Regex | **0** — no `RegExp`, no `/…/` literal |
| Corpus | 3,271 `.py` files, 23,911 symbols, 99,743 relationships, 0 parse errors |
| Independent oracle | **99.9994% — 161,094 edges agreed, 1 disagreement.** Every relationship type the analyzer emits has an independent second derivation (PY-23) |

## What a consumer may rely on

**Nine relationship types are emitted, and each carries a stated confidence.**

| Type | Confidence | Claim |
| --- | --- | --- |
| `contains` | 1.0 | Derived from `ownerName`, so it is a statement about the parse, not an inference. |
| `extends` | 1.0 | Bases are read from the class's own argument list. |
| `imports` | 1.0 | Read from `import_statement` / `import_from_statement`. |
| `exports` | 1.0 | Read from `__all__` assigned a `list` **or** `tuple` literal. |
| `calls` | 0.9 | A name in call position, including an **imported** class — the commonest call shape in the language. |
| `uses` | 0.9 | A member **read** (`self.x`), marked `isMemberRead`. Excludes assignment targets, call callees, and call receivers. |
| `instantiates` | 0.9 | A class **declared in this file** called with `New()`. Never an imported class. |
| `overrides` | **0.95 verified / 0.5 guessed** | See the resolution contract below — the two confidences mean two different things. |

**All nine emitted types are under independent verification.** `contains` `extends` `overrides` `calls` `instantiates` `uses` `references` `imports` `exports` — 161,059 edges agreed by two derivations that never share a helper, 90 disagreements (PY-23).

`references` and `depends` are not emitted: name identity is carried by `imports`, `exports`
and `calls`, and emitting a second edge for the same fact would double the graph without adding
information.

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
first. Over the corpus, **2,036 of 3,271 files (62.2%)** carry a framework.

## Evidence

| Claim | Where it is pinned |
| --- | --- |
| grammar bytes | `validation/m14/grammar-pins.json`, lane `python` |
| 19 fixtures | `validation/m14/fixtures/python/` |
| 30 mutants | `script/m14/mutate-analyzer.ts`, ids prefixed `python/` |
| node-type classification | `script/m14/spec/python-completeness.json` |
| independent truth | `script/m14/oracles/python-truth.ts` + `python-truth-diff.ts` |
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
  from it. **46.0% of the lane's 90,870 call edges (41,777) are ambiguous** — more than one
  project symbol shares the target name — and the store's name strategy requires uniqueness, so
  those do not resolve. Much of that collision is coincidental with stdlib method names. A
  caller doing a name-only lookup should know this before trusting the result.
- **PY-16** — no `dialect` field exists in any lane, so Cython cannot be recorded honestly.
- **PY-17** — two python framework tables with five overlapping entries, free to drift.
- **PY-18** — the perf "budget" gate only checks a recorded number is positive; nothing is
  re-measured or compared. Python's recorded `cython:python` 67.2 ms/file was taken at **load
  average 41.85** and re-measures at ~193 ms/file at load 3.8. The distribution is skewed
  (p50 55 ms, p99 2,497 ms, 8 files = 41% of the time), so the mean describes no file in it.
  Budget on total time and p95 instead.
- **PY-19** — content over **1 MiB** is truncated before parsing. The truncation is now **disclosed on the result** (`errors` entry plus a structured `metadata.truncated`), so a consumer can tell an incomplete parse from a complete one; 1 of 3,271 files is affected (`cython/tests/run/extsubscript.py`, 26% of it unread). The threshold itself is unchanged.
  1 of 3,271 corpus files is affected (`cython/tests/run/extsubscript.py`, 357 KiB / 25% of it
  never parsed). Cross-lane, in `engine.ts`.
