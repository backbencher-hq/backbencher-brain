# real-python-analyzer.md

## Language

- Analyzer file: `src/ast/real-python-analyzer.ts`
- Parser: `tree-sitter-python` **0.25.0** (npm, latest — upgraded from the stale
  pre-0.25.0 pin in M12.27; WASM at `wasm/tree-sitter-python.wasm`, loaded by
  `engine.ts` via `resolveWasm`)
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
| calls | ✅ | `call` → callee leaf (member expressions reduce to leaf: `self.store.get()` → `get`); source = enclosing function/method leaf name; builtins filtered (full `PYTHON_BUILTINS` set), dunders (`__x__`) filtered; `super()` filtered; nested functions (e.g. `wrapper` inside `logged`) and function locals (`store`, `service`) never change the call source | 0.9 |
| extends | ✅ | `class_definition` → base-class argument list (`Repository[User]` → leaf `Repository`); `Generic[T]` → `Generic`; dotted `a.b` → `b`; `Enum` bases detected for kind | 1.0 |
| instantiates | ✅ | uppercase-head call with the target in the O(1) `declaredTypes` set (in-file class/enum only — imported classes like `TypeVar` are external, no in-file target); Python has no `new` keyword | 0.9 |
| imports | ✅ | `import_statement` / `import_from_statement` → module leaf → `${modulePath}:${item}`; relative imports (`from .models import User`) → module leaf | 1.0 |
| exports | ✅ | `__all__` list literal → each string item; module-level names | 1.0 |
| overrides | ✅ | method whose name exists on the FIRST (leftmost) base class (Python MRO) — resolved via extends + cross-file harness companion; `UserService.__init__ → BaseService.__init__` | 0.95 |
| contains | ✅ | computed from `ownerName` on symbols (single pass) — class members, enum members, record fields | 1.0 |
| uses | — | not emitted for `self.x` attribute access (family contract: no field-access uses) | — |
| references | — | covered by imports/exports/calls leaf identities | — |
| depends | — | not emitted (covered by imports) | — |

## Supported constructs

- Modules: `import x`, `from x import y`, relative imports (`from .models import ...`) — `__init__.py`
- Classes: bases (incl. generic subscripts `Repository[User]`), class-body assignments → Property, enum subclasses → Enum + EnumMember, `__init__` → method — `models.py`, `Service.py`
- Functions: def, async def, nested functions (never symbols), decorators (metadata only) — `service.py`
- Inheritance: multi-base extends + first-base overrides — `Service.py` (`UserService(BaseService, Repository)`)
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

## Census

- Baseline (M12 issue #166): 5 census regex entries in `real-python-analyzer.ts`
  (decorator `@` strip, quote strips, module-name extension strip).
- After M12.27: **0** (all replaced with pure char scans / AST token reads).
  Project census: 69 → 64.
