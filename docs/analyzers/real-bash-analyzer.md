# real-bash-analyzer

Pure Tree-sitter Bash extraction for `*.sh`, `*.bash`, `.bashrc`, and `.zshrc`
sources, verified under milestone **M12.39** (issue #178).

## Contract

| Concern | Contract |
| --- | --- |
| Symbol identity | `function_definition` → `function`; `variable_assignment` and `local`/`declare`/`typeset` → `variable`; `export`/`readonly` → `constant`; `alias` → `function` (`isAlias`) |
| Owners | function-local declarations carry `ownerName` = enclosing function; top-level declarations are unowned (module-level). No synthetic `global` / `script` / `subshell_N` scope symbols are ever emitted |
| Parameters | positional `$1..$9` and `$@`/`$*` referenced in a function body populate its `parameters`; `$0` (script name) is excluded |
| Declarations | reassignments are deduplicated per scope — a name is declared once, subsequent assignments are references |
| Uses | `$VAR`, `${VAR}`, `${VAR:-x}`, `${arr[i]}` emit `uses` edges (subscript base name only); `$@ $* $? $$ $# $! $_` punctuation is shell bookkeeping and is not emitted; `$1..$9` feed parameters |
| Calls | non-builtin commands emit `calls` edges (source = enclosing function or `global`); builtins (`echo`, `printf`, `cd`, `sudo`, …) and case-branch dispatch commands are excluded as noise |
| Imports | `source` / `.` emit `imports` + `references` edges and populate the import table |
| Traps | `trap 'handler' SIGNAL` emits `calls` edges from each signal to the handler |
| Patterns | `set -e`/`set -o errexit`, `curl \| bash`, `rm -rf /`, `chmod 777`, `eval`, `sudo`, container/cloud/build tooling — all detected from AST structure, never source text |
| Errors | syntax errors are engine-owned (engine.ts merges `treeErrors`); the analyzer never duplicates them |
| Regex | **zero** regex usages (census 12 → 0) |

## Complexity envelope

One iterative DFS over the tree with a constant-time function-scope stack, a
Map of function → parameter set, a per-scope declaration-dedupe Set, and a
Set-backed relationship dedupe: **O(nodes + emitted facts)**, no per-symbol
O(n) scans and no O(n²) passes.

Measured on the pinned corpus `fsharp@22a8a5dc` (30 strict-acceptance `.sh`/`.bash`
files, one production `parseFile` pass each):

| Metric | Value |
| --- | --- |
| Wall time | 1,020 ms |
| Files / s | 29.4 |
| Symbols | 674 (660.5 / s) |
| Relationships | 1,311 (1,284.8 / s) |
| Errors / crashes | 0 / 0 |

Before (regex-era analyzer): 32 files, ~681 ms, 1,372 symbols, 5,093
relationships — including phantom `$cmd` command-substitution symbols,
`script`/`subshell_N` owner scopes, `ENV_*` phantoms, and call noise from
builtins and case branches that the rewrite eliminates.

## Regex inventory

**None.** All 12 baseline regex usages were replaced with structural AST
handling:

- positional/special parameter detection → `variable_name` /
  `special_variable_name` children (whose text already excludes `$`)
- `$VAR` / `${VAR}` name extraction → `simple_expansion` / `expansion` /
  `subscript` children
- `curl \| bash` → pipeline command-name walk
- `rm -rf /` → `rm` argument words
- alias name → `=` index arithmetic on the `concatenation` word
- trap handler → quote stripping via char-code checks on the `raw_string` /
  `string` node
- `set -e` → flag-word character scan (`-o errexit` pair included)

## Supported constructs

Functions (both `name()` and `function name` forms), function parameters,
`local`/`declare`/`typeset`/`readonly`/`export` declarations, arrays
(`ARR=(…)`, `declare -a`), `if`/`elif`/`case` conditionals, `for`/`while`
loops, command substitution `$(…)`, subshells `(…)`, pipelines `a | b`,
`trap`, `alias`, `source`/`.` imports, string interpolation, `${var:-default}`,
and `${arr[i]}` subscripting.

## Verified limitations (named, never hidden)

The vendored `tree-sitter-bash` grammar does not model two valid bash edge
constructs found in the real corpus; both files are recorded explicitly in
`validation/m12/results/bash-corpus-errors.json` and excluded from strict
acceptance:

1. `eng/common/init-tools-native.sh:120` — `[[ "$char" =~ [[:space:],:] ]]`
   (regex match against a POSIX character class)
2. `eng/common/pipeline-logging-functions.sh:152` — `value=${value/]/%5D}`
   (parameter expansion whose pattern is a literal `]`)

## Evidence

- Differential: **55/55**, precision/recall **1.000**, 0 FP/FN/unknown
  (`validation/m12/results/bash-differential.json`)
- Contract probe: **36/36** (`validation/m12/results/bash-contract.json`)
- Grammar shape audit: **56 observed node types, 0 dead references**
  (`validation/m12/results/bash-shape-safety.json`)
- Regex census: **0** bash usages
- Corpus audit: **32 tracked / 30 clean / 2 named grammar limits / 0 crashes**
  (`validation/m12/results/bash-corpus-errors.json`)
- Corpus measurement: `validation/m12/results/bash-corpus-complexity.json`,
  `bash-corpus-shapes.json`
- Fixtures: `validation/m12/fixtures/bash/{Common.sh,Deploy.sh,Negative.sh}`
- Ground truth: `validation/m12/ground-truth/bash.json`
