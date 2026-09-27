# real-bash-analyzer

Pure Tree-sitter Bash extraction, verified by milestone **M14 / M60** under issue
**#277**. Routing: `*.sh`, `*.bash`, `.bashrc`, `.bash_profile`, and — since the
M60 routing change — **any extensionless file whose shebang is a shell**, which
is how `nvm`, `libexec/rbenv` and 385 other entry-point scripts became visible
at all.

> This file previously described a pre-`#277` analyzer. Six contract rows were
> actively wrong (most importantly, it stated the edge source could be `global`,
> which is the phantom endpoint the lane removed, and that case-branch commands
> are noise, which the lane reversed). A stale doc that misdescribes the
> analyzer is worse than no doc, so the table below is regenerated from
> measurement rather than edited.

## Contract

| Concern | Contract |
| --- | --- |
| Module identity | **The script is the module** (`BD2`), named for its own basename. A top-level declaration is owned by it. The literal string `global` is never emitted as a source or an owner — it is an endpoint no symbol can resolve to, and it was 622 edges on the pinned corpus. |
| Symbol identity | `function_definition` → `function`; `variable_assignment` and `local`/`declare`/`typeset` → `variable`; `export`/`readonly` → `constant`; `alias` → `function` (`isAlias`) |
| Declared names | A declared name must be a shell identifier `[A-Za-z_][A-Za-z0-9_]*` (`BD8c`). `export A=$PWD/x:$PWD/y` truncates in the grammar at the first colon and leaves the tail as a bare `word` sibling, which the export handler used to read as a second exported name — inventing `PWD/collection_root_sys` and losing the real declaration's edge. The rule is scoped to **declarations**: 157 module symbols contain spaces and are correct, because nvm's test fixtures are files literally named `'nvm alias' should ignore leading blank lines in the file`. |
| Declarations | Reassignments deduplicate per scope. Declarations and `exports` edges dedupe **separately** — the pre-fix shape returned early on an already-declared name and silently swallowed the edge, so `CFLAGS=…` later `export CFLAGS` produced the variable and no `exports` edge. |
| Parameters | Positional `$1..$9` and `$@`/`$*` populate `parameters`; `$0` is excluded. `$@ $* $? $$ $# $! $_` punctuation is shell bookkeeping and is not emitted. |
| Uses | `$VAR`, `${VAR}`, `${VAR:-x}`, `${arr[i]}` emit `uses` (subscript base name only). Targets are trimmed, and `metadata.isAssignedInFile` is set when the file assigns the name **under any owner** (`BD11`) — 19,417 reads classified corpus-wide, 74.9% assigned here, the rest either declared in another file or environment-supplied. |
| Calls | Non-builtin commands emit `calls` with the line the command **name** is on. A computed command is a `uses`, never a fabricated `calls` (`BD4`). **Case-arm commands are calls** (`BD8`) — the pre-existing doc claimed they were noise. A command name must be a `word` and not a bare number or an escape (`BD5`). A trap **signal is not a caller** (`BD3`); the handler body is a real call attributed to the installing function. |
| `contains` | Every declaration is contained by its owning scope at the declaration's line. |
| `imports` / `references` | `source` / `.` emit both, and the path is kept **as written** (`BD9`). An earlier version "improved" it by resolving against the sourcing file's directory, which was wrong: bash resolves a relative `source` against `$PWD` at run time. Dynamic paths are labelled, not presented as resolved. |
| `exports` | `export VAR`, `export VAR=value`, `declare -x` and `export -f fn` each emit an `exports` edge from the owning scope at the export line (`BD7`). This type was absent for the whole pre-`#277` history and its absence was a **defect, not a language limitation** — seven peer lanes already emitted it. |
| `overrides` | A re-declared function emits `overrides` from the later declaration to the earlier one, with `metadata.overridesLine` naming the prior line (`BD8b`). 57 redefinitions across 38 of 2,747 admitted files. |
| Patterns | `set -e`/`set -o errexit`, `curl \| bash`, `rm -rf /`, `chmod 777`, `eval`, `sudo`, container/cloud/build tooling — all from AST structure, never source text. |
| Errors | Syntax errors are engine-owned (`engine.ts` merges `treeErrors`). Nothing is emitted from a damaged region, in **both** directions — an ERROR/MISSING node between the name and its enclosing statement, or an ancestor of the command. |
| Regex | **zero** regex usages (census 12 → 0), and the M12 contract probe enforces it |

## Relationship ontology — 7 of 10, and the 3 exclusions are enforced

| type | status | evidence |
| --- | --- | --- |
| `calls`, `uses`, `contains`, `imports`, `references`, `exports`, `overrides` | **EMITTED** | counts observed through the production `parseFile` |
| `extends`, `implements`, `instantiates` | **RULED, with corpus evidence** | the grammar yields **164 distinct node types** across the corpus and **none** expresses a type declaration or a constructor |

`overrides` was originally ruled inapplicable alongside those three, on the
reasoning that bash has no inheritance so there is no superclass to point at.
**That ruling was wrong**, and no differential could catch it: the oracle
omitted `overrides` too, and two independent implementations that both say
nothing agree perfectly. `script/m14/ontology-coverage-gate.ts` closes the class
by measuring the **language** rather than diffing the **code** — every type must
be emitted with a count, or ruled with a measurement showing its construct does
not occur. The same ontology is why bash emits 7 and PowerShell emits 9: the
difference is exactly what each language has.

## Complexity envelope and measured performance

One iterative pre-order walk with a constant-time function-scope stack, a Map of
function → parameters, a memoized per-scope declared-name set, and a Set-backed
relationship dedupe: **O(nodes + emitted facts)**, no per-symbol O(n) scans and
no O(n²) passes. Two O(n²) costs were removed rather than documented — the
edge-identity Set was combined with a per-command O(symbols) rescan, and local
function-name collection was a repeated array walk.

Measured through the **production** `parseFile`, which is the path
`parallel-indexer.ts:889` uses:

| sample | files | wall | per file | symbols | relationships |
| --- | --- | --- | --- | --- | --- |
| hash-ordered, representative (median 1 KB) | 300 | 12.2 s | **40.6 ms** | 3,605 | 15,785 |
| the 200 **largest** admitted files (mean 21 KB) | 200 | 46.5 s | **232.5 ms** | 10,449 | 58,730 |

A large fixed cost per file plus a size-dependent cost. **No target budget is
defined**, so these are measurements, not a verdict — the previous doc's
"1,020 ms / 29.4 files per s" came from a 30-file corpus and is not comparable.

## Regex inventory

**None.** All 12 baseline regex usages were replaced with structural AST
handling:

- positional/special parameter detection → `variable_name` / `special_variable_name` children
- `$VAR` / `${VAR}` name extraction → `simple_expansion` / `expansion` / `subscript`
- `curl | bash` → pipeline command-name walk
- `rm -rf /` → `rm` argument words
- alias name → `=` index arithmetic on the `concatenation` word
- trap handler → quote stripping via char-code checks on `raw_string` / `string`
- `set -e` → flag-word character scan (`-o errexit` pair included)
- shell-identifier test for declared names → char-code loop beside `isCommandNameText`

## Supported constructs

Functions (both `name()` and `function name`), function parameters,
`local`/`declare`/`typeset`/`readonly`/`export`, arrays (`ARR=(…)`, `declare -a`),
`if`/`elif`/`case`, `for`/`while`/`until`/`select`, command substitution `$(…)`,
subshells, pipelines, process substitution, `trap`, `alias`, `source`/`.`,
arithmetic expansion, string interpolation, `${var:-default}`, `${arr[i]}`, and
nested function definitions.

## Verified limitations (named, never hidden)

Measured directly against the pinned grammar, one construct per case, rather than
inferred from a corpus probe:

| construct bash HAS | parses? |
| --- | --- |
| `${var:offset:len}`, `${arr[@]:offset:len}`, `${var:offset}` | **yes** |
| `${var:-default}` | **yes** |
| process substitution `<( )` / `>( )` | **yes** |
| extglob `!( )` in a `case` arm | **yes** |
| extglob `+( )` inside `[[ == ]]` | **yes** |
| `printf %q`, `declare -n`, `**` globstar | **yes** |
| **`@()` in a `case` arm** | **NO — 2 error nodes** |
| **nested extglob `*\( \-@(...) )*` inside `[[ == ]]`** | **NO — 3 error nodes** |
| **backslash line continuation inside `[ ]`** | **NO — 1 error node** |

So the grammar gap is **two shapes**, not the four an earlier corpus attribution
claimed: *complex/nested extglob* and *a continuation inside `test`*. The
`${var:offset:len}` and process-substitution rows in an earlier draft of this
section were **wrong** — they were attributed by a context-window probe, the same
instrument that produced two false positives in the ontology gate, and both
constructs parse cleanly in isolation. The correction is recorded here rather
than quietly removed.

Consequence in the corpus: 11 of 43 ERROR nodes across the 13 real-bash files the
universe sweep could not parse, concentrated in bash-completion's **generated**
`completions-core/*.bash`, which nest extglob inside `[[ == ]]` patterns. This is
the one place the Groovy precedent transfers — the language has the syntax and the
pinned grammar does not model it — and fixing it means regenerating the wasm, which
is a build task for the grammar's owner. Until then the analyzer **defers rather
than fabricating**, which is the correct response and is what the 0-unlined /
0-non-symbol-source numbers attest.

### Relationship types that cannot be fixed, and why that is not a gap

`extends`, `implements` and `instantiates` are ruled on **grammar-inventory**
evidence: the grammar yields 164 distinct node types and none expresses a type
declaration or a constructor. This is *not* the Groovy situation. Groovy **has**
classes, interfaces, inheritance and `new`, and the grammar failed to model them —
so regenerating it raised fidelity. Bash has **none of them**, so extending the
grammar to emit those nodes would manufacture edges about constructs the language
does not contain, which is the opposite of fidelity.

The one candidate was checked rather than assumed. bash's object-oriented
*naming convention* is `Class::method`, and if it were common it would matter:

- **`Class::method` functions: 3 files of 2,747 (0.1%)**, 28 methods, 3 prefixes —
  and all three are internal **namespacing** (`codegen::*` x15, `_omz::*` x11,
  `kube::*` x2), not classes.
- **`new Foo` as a constructor: 0 occurrences** across all 2,747 files.

Even at scale `::` would carry no *inheritance*, so `extends`/`implements` still
would not apply; at 3 files of internal namespacing, reading OOP semantics into it
would be over-reading. The analyzer treats `codegen::emit` as one function name,
which is what it is.

## Evidence

Measured over **every file the production router admits to bash across 68
cloned repositories** — 220,494 files scanned, **2,747 admitted**, 51
repositories:

| measurement | result |
| --- | --- |
| truth edges (independent oracle) | 74,018 |
| covered | 73,930 (**99.9%**) |
| **UNEXPLAINED (fabrications)** | **2 — in 2 files (0.07%)** |
| **unlined edges** | **0** |
| **non-symbol edge sources** | **0** |
| in-scope parse rate (excl. zsh) | 94.4% (2,190 / 2,321 real bash) |

- **Ontology gate** — 7/10 emitted, 3 ruled-sound on grammar-inventory evidence,
  **0 falsified** (`script/m14/ontology-coverage-gate.ts`)
- **Differential** — precision/recall **1.000**, 76/76 facts, 0 FP/FN/unknown,
  truth authority `f5_tree_oracle` (`validation/m12/results/bash-differential.json`)
- **Contract probe** — **36/36** (`script/m14/tmp` + `validation/m12/results/bash-contract.json`)
- **Fixtures** — **17**, each pinning both directions of every label
  (`validation/m14/fixtures/bash/`)
- **Mutants** — **23 bash**, all caught; **1,055 project-wide, 0 survivors**
  (`script/m14/mutate-analyzer.ts`)
- **Grammar node types** — 164 observed, 0 dead branches
- **Regex census** — 0 bash usages
- **Spec** — `script/m14/spec/bash-completeness.json` (BD1–BD10, BD8b, BD8c,
  BD11 and per-decision gaps)
- **Full record** — `reviews/bash/m60-closure.md` (§1–§19a),
  `reviews/bash/resolution.md` (21 claim dispositions, deliberately not `CLOSED`)

The `f5_tree_oracle` truth replaced a hand-authored 55-fact file in which every
fact was `authority: manual_audit` and twelve pinned the `global` phantom as
*expected*. A lane whose truth cannot disagree with its analyzer has no
differential; it has a mirror.
