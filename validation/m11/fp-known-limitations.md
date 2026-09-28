# Functional-Language Fixture Limitations (Elixir, Erlang, Haskell, Clean)

This fixture validates declaration extraction for Elixir, Erlang, Haskell, and
Clean through the shared indexing pipeline. The symbol truth is manually audited
from the fixture source and stored in `validation/m11/ground-truth/fp-symbols.json`.

The fixture exercises modules, structs/records, data types, type aliases
(`@type` / `-type`), protocols/type-classes, implementations (`defimpl` /
`instance`), class method signatures, interface methods, macro definitions
(`defmacro`), ADT constructors, record fields, guards, `where`/`do`/`let` local
bindings, and module-level functions. All 4 languages resolve at 1.000
precision / 1.000 recall against ground truth (`validation/m11/probe-fp.ts`).

## Universal contract mapping (M11.11)

- **Modules**: `defmodule` / `-module` / `module` → `module`.
- **Types**: `data`/`newtype` declarations → `type`; `@type` aliases → `type`;
  Clean `:: Type = ...` → `type`.
- **Structs/records**: Erlang `-record` → `struct`; Elixir `defstruct` →
  `struct`. Record/struct fields → `property` owned by the struct (matching the
  C/Rust/Zig struct-field contract).
- **Interfaces**: Elixir `defprotocol` → `interface`; Haskell `class` → `interface`;
  Clean `class` → `interface`. Interface method signatures → `method`.
- **Classes/impls**: Elixir `defimpl` → `class` **named by the target type**
  (e.g. `defimpl Serializable, for: OrderBook` → `class:OrderBook`); Haskell
  `instance Mergeable (Stream a)` → `class:Stream` (named by target type);
  Clean `instance Summarize Vec` → `class:Vec`. Implementation methods → `method`.
- **Constructors**: Haskell `data` constructors (`Stream`, `Leaf`, `Node`) →
  `constructor`; Clean ADT constructors → `constructor`.
- **Macros**: Elixir `defmacro` → `macro` (not `function`).
- **Locals**: Haskell `where`/`do`/`let` bindings and Clean case alternatives
  are scoped noise, not module symbols.

## Real-corpus observations (fp-corpus-observed.json)

| Repo | Language(s) | Files | Symbols | Relationships | Wall | Peak RSS | Errors |
|---|---|---|---|---|---|---|---|
| elixir | Elixir + Erlang | 616 | 11,189 | 78,569 | 192.4s | 175 MB | 0 |
| rebar3 | Erlang | 269 | 5,753 | 8,780 | 62.6s | ~185 MB | 0 |
| cabal | Haskell | 2,140 | 19,137 | 89,620 | 141.0s | 219 MB | 0 |

- **elixir** (the Elixir language repo itself) is the large Elixir corpus; its
  tracked `.erl`/`.hrl` files also contribute real Erlang evidence.
- **rebar3** is a pure Erlang corpus (261 `.erl` + 8 `.hrl`).
- **cabal** (2,140 Haskell files) is the large Haskell corpus: 19,137 symbols,
  89,620 relationships, 0 errors — 15.2 files/sec.
- All files indexed in every repo; zero parse errors and zero timeouts across
  the three corpora.

## Coverage gaps

- **Clean corpus (resolved in M12.26)**: `clean_stdlib` — the official Clean
  system standard library (cloned from the Clean compiler GitLab,
  `gitlab.science.ru.nl/clean-compiler-and-rts/stdenv`, pinned at
  `6971a8af`, 41 files ≥1KB) — is now the language-representative corpus;
  the manifest's clean entry previously pointed at the grammar repo.
  Corpus robustness: 4/41 grammar-error files (9.8%) — `_SystemArray`
  (inline `code { ... }` machine-code blocks) and `_SystemDynamic` (exotic
  record-pattern/update-comprehension constructs) — all classified honestly,
  0 crashes. Grammar upgraded to tree-sitter-clean v1.2.4 during M12.26.
- **Clean grammar capability**: the `tree-sitter-clean` grammar is limited —
  it fails on dotted imports, multi-arg type signatures, and some record
  patterns. The fixture is scoped to the grammar's supported subset (records,
  classes, instances, single-arg signatures, applications); `instance` bodies
  and guards are covered, but more complex Clean modules may hit parser ERROR
  nodes that are reported as warnings rather than crashes.
- **Haskell record selectors**: record fields are extracted as `property`
  (selector functions are not double-counted as functions). Exported-selector
  lists (`module (Stream, run, ...)`) are tracked as exports, not symbols.
- **Elixir `defstruct` list form**: `defstruct [:a, :b]` (atom-list form) has no
  keyword pairs, so no field `property` symbols are emitted for that form;
  keyword form (`defstruct a: nil, b: nil`) extracts fields fully.
- **Elixir behaviour/callback declarations**: `@callback` and `@behaviour`
  attributes produce Implements/pattern edges only; callbacks are not emitted
  as standalone symbols (the `def` heads inside `defprotocol` are the method
  declarations).
- **Erlang `-type`/`-spec`**: `-type` emits a `type` symbol; `-spec` is a pure
  annotation and never a symbol (the function clause carries the declaration).
- **Erlang records with default values** (`#state{queue = []}` typed fields)
  are covered; record expressions (`#job{...}`) are tracked as Instantiates
  edges rather than symbols.
