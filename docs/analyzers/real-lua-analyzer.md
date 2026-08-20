# real-lua-analyzer.md

## Language and wiring

- Analyzer: `src/ast/real-lua-analyzer.ts`
- Parser: `tree-sitter-lua` WASM at `wasm/tree-sitter-lua.wasm`
- Verified grammar: `@tree-sitter-grammars/tree-sitter-lua` 0.4.1, built from its published grammar source
- Wiring: `ASTEngine.parseFile` → isolated Lua parser/grammar lifecycle → `RealLuaAnalyzer`
- Corpus: clean `luarocks@665f160b4d0b79e85e66c6cc83e442d72eb40868`

The Lua grammar is intentionally loaded from a private byte buffer for each
file. The previous pinned artifact/runtime combination retained external
scanner state across files; parser reuse could turn a valid function
declaration into a malformed variable and produce false syntax errors. The
isolated lifecycle is a correctness requirement, not a fixture-only workaround.
The tree and parser are released after each file; the grammar object is left to
the WASM runtime's garbage collector because this web-tree-sitter binding does
not expose a grammar-delete operation.

## Symbol contract

| Construct | Symbol | AST rule |
| --- | --- | --- |
| `local name = value` | `variable` | `variable_declaration` → `assignment_statement` simple identifier |
| `name = value` | `variable` | module-level `assignment_statement` simple identifier |
| `function name(...)` | `function` | `function_declaration` name field is an identifier |
| `function Table.method(...)` | `method` | function name is `dot_index_expression`; table is the owner |
| `function Table:method(...)` | `method` | function name is `method_index_expression`; table is the owner |
| `local function name(...)` | `function` | same function declaration with an AST `local` token |
| table-valued declaration | `variable` with table metadata | assignment RHS is `table_constructor`; field keys come from AST fields |

Function parameters retain identifier/vararg information. Exact ranges come
from the declaration or identifier nodes. Function-local variables are emitted
as scoped variables; parameters, anonymous function expressions, field/index
mutations, and local reassignments are not declarations. No synthetic Love2D
hooks, anonymous coroutine symbols, or anonymous table classes are generated.

## Relationship ontology

| Relationship | Rule |
| --- | --- |
| `contains` | deduplicated global/module edge or callable-owner edge for emitted symbols |
| `calls` | `function_call` name field, sourced from the enclosing named function/method or `global` |
| `imports` | `require("module")`, `module("module")`, and guarded `pcall`/`xpcall` require calls |
| `instantiates` | `Table:new(...)` only when `Table` is an AST-declared table |
| `extends` | `setmetatable(target, Table)` metatable relation, with table constructors excluded as targets |
| language metadata | coroutine, metatable/OOP, module, and framework patterns are metadata, not phantom symbols |

Relationships are deduplicated in a set keyed by type/source/target. Arbitrary
capitalized calls and external constructors remain syntactic calls but do not
become speculative `instantiates` edges.

## Supported AST shapes and metadata

The analyzer uses the verified grammar vocabulary: `chunk`,
`variable_declaration`, `assignment_statement`, `function_declaration`,
`parameters`, `function_call`, `arguments`, `dot_index_expression`,
`method_index_expression`, `table_constructor`, `if_statement`,
`for_statement`, `while_statement`, `repeat_statement`, and
`return_statement`. Framework detection is based on identifier/call node text
only; it does not parse source text.

Supported semantic metadata includes `require` imports, Love2D, OpenResty,
World of Warcraft, Wireshark, Redis, Corona/Solar2D, Neovim, LÖVR, LuaRocks
core modules, coroutine use, metatables, library OOP, table fields, and module
exports. Syntax errors are surfaced from the production parse result.

## Verification evidence

- Independent fixtures: `validation/m12/fixtures/lua/{Module,Negative}.lua`
- Manual ground truth: `validation/m12/ground-truth/lua.json`
- Differential: **41/41 facts, precision 1.000, recall 1.000, 0 FP, 0 FN**
- Grammar shape safety: **10/10 dispatch references live**, 0 shape-probe parse errors
- Corpus parser scan: **162 tracked Lua/Luau files, 0 grammar-error files, 0 error nodes, 0 crashes**
- Production extraction: **6,746 symbols / 12,032 relationships**, 0 parse errors
- Complexity artifact: `validation/m12/results/lua-corpus-complexity.json`
- Evidence scripts: `script/m12/lua-node-types-compare.ts`,
  `script/m12/lua-corpus-errors.ts`, and `script/m12/lua-corpus-measure.ts`
- Lua analyzer regex census: **0 usages**

## Complexity and limitations

Extraction is one iterative AST walk. Relationship and contains identity use
sets, and declaration/owner decisions use the current frame and AST-declared
table set; there are no per-symbol scans of the symbol or relationship arrays
and no O(n²) resolution path. The isolated grammar load adds fixed per-file
WASM setup overhead; the corpus measurement records that production cost.
Corpus measurements use tracked files only and the production
`pool-worker.parseFile` path.

Lua is dynamically typed and permits metaprogramming. External modules,
dynamic table names, runtime metatable mutation, and arbitrary constructor
conventions cannot be resolved from syntax alone. The analyzer preserves those
as syntactic calls and only emits constructor edges for in-file AST-declared
tables. Anonymous functions and table literals remain expression values unless
bound by a declaration; no identity is invented for them.
