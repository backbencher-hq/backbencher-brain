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
| Calls | Non-builtin commands emit `calls` with the line the command **name** is on. A computed command is a `uses`, never a fabricated `calls` (`BD4`). **Case-arm commands are calls** (`BD8`) — the pre-existing doc claimed they were noise. A command name must be a `word`, not a bare number, not an escape, and **not a shell reserved word** (`BD5`, `M60`). A trap **signal is not a caller** (`BD3`); the handler body is a real call attributed to the installing function. |
| `contains` | Every declaration is contained by its owning scope at the declaration's line. |
| `imports` / `references` | `source` / `.` emit both, and the path is kept **as written** (`BD9`). An earlier version "improved" it by resolving against the sourcing file's directory, which was wrong: bash resolves a relative `source` against `$PWD` at run time. Dynamic paths are labelled, not presented as resolved. |
| `exports` | `export VAR`, `export VAR=value`, `declare -x` and `export -f fn` each emit an `exports` edge from the owning scope at the export line (`BD7`). This type was absent for the whole pre-`#277` history and its absence was a **defect, not a language limitation** — seven peer lanes already emitted it. |
| `overrides` | A re-declared function emits `overrides` from the later declaration to the earlier one, with `metadata.overridesLine` naming the prior line (`BD8b`). 57 redefinitions across 38 of 2,747 admitted files. |
| Patterns | `set -e`/`set -o errexit`, `curl \| bash`, `rm -rf /`, `chmod 777`, `eval`, `sudo`, container/cloud/build tooling — all from AST structure, never source text. |
| Errors | Syntax errors are engine-owned (`engine.ts` merges `treeErrors`). **No blanket refusal of a damaged region** — the guard that would have done that was measured and deleted; see [What the corpus refused](#what-the-corpus-refused). The two refusals that remain are both structural and neither keys on the file: a name that is not a plain `word`, and a name that is a **reserved word**. |
| Regex | **zero** regex usages (census 12 → 0), and the M12 contract probe enforces it |

## Relationship ontology — verdict per type, with the number behind it

Two measurements, two denominators, both reproducible. The **census** sample is
400 files taken in **hash order** (ascending sha256 of `repo/relpath`, admitted
by the production router `detectLanguageFromPath`), 48 repositories, out of
4,012 admitted files from 441,259 tracked files in 141 repositories. The
**gate** sample is every admitted file — 4,012 of them.

**Every number below was re-measured on 2026-10-03, and every one of them moved,
because the shared corpus grew.** The pass-1 revision of this table was written
against 3,174 admitted files from 374,996 tracked files in 111 repositories
(141 repositories, 7.3 GB, now). The gate column rose 12–20% per type and the
census column moved in both directions, because adding files to a repository
changes which files sort into the first 400 of a hash order: `imports` and
`references` FELL from 61 to 45 while `exports` ROSE from 179 to 210. **A
hash-ordered sample is reproducible against a PINNED corpus and not against a
growing one.** The corpus state that these numbers describe is therefore part of
the claim: 4,012 admitted / 441,259 tracked / 141 repositories. Re-running
`census-bash-ontology.ts` against a different corpus is expected to produce a
different sample, and that is a property of the method, not a regression.

| type | emitted? | census: 400 files | gate: 4,012 files | evidence |
| --- | --- | --- | --- | --- |
| `calls` | **EMITTED** | 5,150 | 53,456 | `census-bash-ontology.ts`, gate row |
| `uses` | **EMITTED** | 7,947 | 78,298 | same |
| `contains` | **EMITTED** | 3,697 | 35,732 | same |
| `imports` | **EMITTED** | 45 | 638 | same |
| `references` | **EMITTED** | 45 | 638 | same |
| `exports` | **EMITTED** | 210 | 1,912 | same |
| `overrides` | **EMITTED** | 28 | 134 | same |
| `extends` | **RULED — never emitted** | 0 | 0 | instrument A + B below |
| `implements` | **RULED — never emitted** | 0 | 0 | instrument A + B below |
| `instantiates` | **RULED — never emitted** | 0 | 0 | instrument A + B below |

The second column is worded so `script/m14/verify-doc-truth-emissions.ts` can
grade this table instead of skipping it. That gate reads the first
ontology-shaped table in a doc and reported `NO_CLAIM_TABLE [bash]` against the
previous revision of this file, whose header was `| type | status | evidence |` —
"found no table to check" and "checked the table and it was clean" are different
answers, and only the second one is evidence. With the header renamed it grades
9 of the 10 rows in this table.

**The tenth is dropped by the gate, not by this table.** `parseClaimTable` in
`script/m14/verify-doc-truth-emissions.ts` (lines 466-469) reads

```ts
if (isRuleRow(cs)) continue
if (!started) { started = true; continue }
```

so the `---` rule is consumed by the first `continue` and the **first data row is
then consumed by the second one**. The `calls` row is first here, so it is the row
that vanishes, and the gate reports `UNDOCUMENTED [bash] calls (relationship)`.
Verified on a second doc: in `docs/analyzers/real-yaml-analyzer.md` the row at
line 34 (`| calls | no | ... |`) is dropped the same way, and `extends` at line 35
becomes the first parsed row. **The fix is to set `started` on the rule row rather
than on the first data row**, i.e. drop the `!started` guard entirely, since the
rule row has already been skipped. Reported, not edited (§8): that file is shared
machinery, and the defect cannot produce a FALSE_NEGATIVE or FALSE_POSITIVE — it
only under-reports coverage by one row per analyzer — so it is a silent
under-count rather than a wrong verdict.

Census files the edges came from, per type — `calls`: `kubernetes/hack/tools/
instrumentation/test-update.sh`, `otp/erts/etc/win32/cygwin_tools/vc/rc.sh`,
`ohmyzsh/lib/termsupport.zsh`. `uses`: `test-update.sh`, `rc.sh`.
`contains`: `test-update.sh`, `rc.sh`. `imports`/`references`:
`kubernetes/hack/lib/protoc.sh`, `kubernetes/test/e2e_node/gubernator.sh`,
`kubernetes/hack/update-translations.sh`. `exports`: `otp/erts/etc/win32/
msys_tools/vc/emu_cc.sh`, `grails-core/etc/bin/verify-wrapper-distribution.sh`,
`kubernetes/third_party/gimme/gimme`. `overrides`:
`kubernetes/third_party/gimme/gimme` (`_version_sort`), `ohmyzsh/lib/
clipboard.zsh` (`clipcopy`, `clippaste`).

Gate summary line, unchanged by any of this work: `emitted 7/10  ruled-sound 3
FALSIFIED 0  ruled-without-justification 0`. The 2026-10-03 run also printed
three `[BB-PARSE-ERR] … memory access out of bounds` rows
(`bash-completion/completions-core/jsonschema.bash`,
`ohmyzsh/plugins/zsh-autosuggestions/zsh-autosuggestions.plugin.zsh`,
`ohmyzsh/plugins/zsh-interactive-cd/zsh-interactive-cd.plugin.zsh`) and one
`[BB-HANG] parser stuck 120s` on the first of those. Those are parser-robustness
findings in the pinned wasm, not lane verdicts; they are recorded here because a
gate that hangs is a gate that reports a smaller corpus than it claims, and the
4,012 denominator above includes them.

### The three RULED types — instrument, probe, and what would overturn it

bash has no type declaration of any kind, so there is nothing for a supertype, an
interface or a constructor to attach to. That is a claim about the **language**,
and it is carried by two independent instruments rather than by prose. Both are
reproducible from the probe files named.

**Instrument A — grammar inventory.** `probe-bash-grammar-inventory.mts` walks
every parse tree in the sample and tallies every node type the pinned wasm
actually produces. Re-run 2026-10-03 on the current 400-file sample: **144
distinct node types**, against the gate's own full-corpus count of **164 distinct
node types**. (Pass 1 recorded 143 node types over 170,786 nodes walked; the
sample composition moved with the corpus, and the gate's full-corpus figure of 164
is unchanged.) The probe then asks whether any
node type could express each RULED construct, and the answer is **NONE** for all
three.

The probe matches node types on **underscore-separated tokens, never as
substrings**, and that detail is recorded because the first version of this file
got it wrong: a substring rule reported `simple_expansion` as a hit for the
fragment `impl` — the letters are inside the word *simple* — which is a node for
reading `$FOO`, not for declaring a type. A nil result from an instrument that
cannot return nil is worth nothing.

The whole inventory contains exactly **one** definition-shaped construct:
`function_definition` (665 occurrences). bash has functions and nothing else.

**Instrument B — parse-tree count plus a corpus-text count, and the blind spot
instrument A cannot see.** A node-type inventory proves the construct has no node
type; it does not exclude a corpus that reaches the construct through **runtime
indirection**, which never becomes a node at all. So
`probe-bash-ruled-constructs.mts` runs the second probe over the same sample:

| probe | `extends` | `implements` | `instantiates` |
| --- | --- | --- | --- |
| parse-tree count of any node type expressing the construct | **0** | **0** | **0** |
| corpus-text lexical candidates (weakest instrument, adjudicated on the tree) | 7 | 5 | **0** |
| of those, candidates the parse tree confirms as a construct | **0** | **0** | **0** |

The 12 lexical candidates are printed with file and line so they can be checked
by hand, and **all 11 are `#` comment lines** — `bash-completion/
completions-core/java.bash:99` (`# remove class extension`),
`bash-completion/startup-core/000_bash_completion_compat.bash:238` and `:241`,
`flutter-packages/.ci/scripts/validate.sh:9`, `phpmyadmin/bin/
transformations_generator_main_class.sh:3`, `bash-completion/completions-core/
svcadm.bash:11`, `nvm/test/fast/Unit tests/nvm_get_default_packages mawk
compat:5`. A lexical hit is reported as a candidate and never as a hit, because a
string literal or an embedded language can fake one — which is the same trap that
produced two false positives in the gate's first version.

**The residual, sized rather than asserted.** The only routes by which a bash
script could reach a relationship the static tree does not contain:

| door | count on 400 files |
| --- | --- |
| `eval` invocations | 42 |
| `${!name}` deferrals | 11 |
| `bash`/`sh`/`zsh`/`ksh -c` strings | 8 |

These are reported as the measured limit of the ruling. They are not a defect to
be fixed, because bash has no type declaration to defer **to**: even a
runtime-resolved string names a function or a binary, and those two already carry
`calls`.

**What would overturn each ruling**, stated so it can be checked:

- `extends` — any non-zero count for a node type token-matching
  `class`/`inherit`/`extends`/`super`/`interface`/`subclass`/`impl`; or a
  lexical candidate that the parse tree then confirms as a construct.
- `implements` — same, over `implement`/`interface`/`protocol`/`trait`/`satisf`/`impl`.
- `instantiates` — same, over `new`/`instantiat`/`construct`/`allocat`/`ctor`/`factory`.

The probe prints all three counts on every run, so the overturn condition is
readable from its output alone.

**Re-verified 2026-10-03, adversarially.** Pass 1's rulings were re-run against the
grown corpus rather than assumed, because a ruling that was correct against 3,174
admitted files can be wrong against 4,012. Result: instrument A (parse-tree node
count) reads **0 / 0 / 0** for `extends` / `implements` / `instantiates`, on a
sample that now contains **144 distinct node types** across 400 files from 48
repositories. The corpus-text candidate count rose from 11 to **12** — `implements`
went 4 → 5 — and the added candidate is another `#` comment line, so the ruling is
unmoved. Both instruments therefore still read zero, and the rulings stand as
written. This is the check pass 1 could not perform on itself.

This is *not* the Groovy situation, and the difference is the whole point. Groovy
**has** classes, interfaces, inheritance and `new`, and the grammar failed to
model them — so regenerating the wasm raised fidelity. Bash has **none of them**,
so extending the grammar to emit those nodes would manufacture edges about
constructs the language does not contain, which is the opposite of fidelity.

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

`overrides` was originally ruled inapplicable alongside those three, on the
reasoning that bash has no inheritance so there is no superclass to point at.
**That ruling was wrong**, and no differential could catch it: the oracle
omitted `overrides` too, and two independent implementations that both say nothing
agree perfectly. `script/m14/ontology-coverage-gate.ts` closes the class by
measuring the **language** rather than diffing the **code** — every type must be
emitted with a count, or ruled with a measurement showing its construct does not
occur. The same ontology is why bash emits 7 and PowerShell emits 9: the
difference is exactly what each language has.

## The six questions, per emitted type

Measured through the **production** `parseFile` from `src/ast/pool-worker.ts`,
not `analyze()` — `analyze()` is a per-file unit that skips the pool-worker
pipeline stages, so a count taken through it is a count of something the product
does not run. Sample as stated above: 400 files, 48 repositories, 4,101 symbols,
17,122 relationships, **0 parse failures**.

| type | 1 exists | 2 fires | 3 correct | 4 labelled | 5 resolved (both ends) | 6 confident (<0.7) |
| --- | --- | --- | --- | --- | --- | --- |
| `calls` | yes | 5,150 | oracle: 1,597/1,597 covered, 0 unexplained | 0 arithmetic operands (see below) | **983 / 5,150 = 19.09%** | 0 / 5,150 |
| `uses` | yes | 7,947 | same run | 0 positional targets | **5,974 / 7,947 = 75.17%** | 0 / 7,947 |
| `contains` | yes | 3,697 | same run | 3,697/3,697 targets are symbols | **3,697 / 3,697 = 100%** | 0 / 3,697 |
| `imports` | yes | 45 | same run | 45/45 keys identical to a `references` key | **1 / 45 = 2.2%** | 0 / 45 |
| `references` | yes | 45 | same run | 45/45 keys identical to an `imports` key | **1 / 45 = 2.2%** | 0 / 45 |
| `exports` | yes | 210 | same run | 210/210 targets carry `isExported` | **210 / 210 = 100%** | 0 / 210 |
| `overrides` | yes | 28 | same run | 28/28 targets are `function` symbols | **28 / 28 = 100%** | 0 / 28 |

**Q1 Exists** — derived from source, not from a doc: each of the seven has a
construction site in `src/ast/real-bash-analyzer.ts`.

**Q2 Fires** — every one of the seven produces edges on the sample; the counts
above are the measurement. A type reachable only from a branch that never matches
is invisible to source derivation, which is why this column is measured rather
than read.

**Q3 Correct** — `bun run script/m14/differential.ts --lang bash`, on the `otp`
pin, 60 files: **tree-truth 1,597, covered 1,597, MISSING 0, analyzer-edges 1,548,
unexplained 0, heuristic 0**. (Pass 1 recorded 1,596 / 1,596 / 1,547. Both sides
rose by exactly 1, which is **not** attributable to the pass-2 guard: both
fabrication sites are in `kubernetes`, and the `otp` pin draws 60 of 63 admitted
files, so the pin's own selection moves when the shared corpus grows. The
meaningful readings are unchanged — full coverage and zero unexplained edges.)

**The limitation is stated rather than implied**: `deriveBashEdges` is a separate
walker over the **same pinned wasm grammar**, so a grammar bug shared by both
paths is invisible to it. This number shows the analyzer agrees with an
independent reading of the tree; it does not show the tree is a faithful reading
of bash. Pass 2 turned that limitation into a measurement rather than a caveat:
the two fabrications this section cannot see are exactly the class of defect the
grammar itself creates, and both were found instead by asking what an edge's
**target** was rather than by diffing two walkers over the same tree.

**Q4 Labelled** — the label check is per type, because in bash the types resolve
against different universes and a pooled number would hide that. Re-measured
adversarially on 2026-10-03, and this is the question that found the two real
defects in the lane (see the next section):

- `calls` is split by the analyzer's own mutually-exclusive flags, and the split
  is what makes the flag checkable rather than decorative:
  `isFunctionCall=true` — **920 edges, 920 resolve to a `function` symbol in the
  same file (920/920)**; `isExternalCommand=true` — **4,230 edges, 63 of which
  (1.5%) happen to name a symbol**. A local call that failed to resolve, or an
  external call that resolved to one, would make the flag a lie. Neither happens.
- `exports` — 210 of 210 targets carry `metadata.isExported`. What they point at
  is measured in the limitations, because it is the weakest label in the lane.
- `overrides` — 28 of 28 targets are `function` symbols, and **28 of 28 have an
  earlier definition of the same name in the same file**. That second number is
  the answer to the strongest objection to this label, and it is in the
  limitations below.
- `contains` — 3,697 of 3,697 targets are symbols in the same file. The single
  miss reported by pass 1 (`esock_ttest-server-gs -> program`, 1 edge of 3,664) is
  not in this sample; the type now resolves at 100% on the corpus it was measured
  against, and the rate is reported per sample rather than smoothed.
- `uses` — 0 of 7,947 targets is a bare positional parameter.
- **`imports` and `references` are the standing labelling finding.** On this sample
  both types produce **45 edges, and the key sets are identical in both
  directions — 45 of 45 `imports` keys appear as a `references` key and 45 of 45
  `references` keys appear as an `imports` key, 0 differences either way.** So
  `references` carries nothing `imports` does not, in bash, for the
  `source`/`.` construct: the two types are one measurement published twice. That
  is not a fabrication — both edges are real edges to a real sourced file — but a
  consumer paying for two types is getting one fact, and the graph is 45 edges
  larger than the distinct dependency count.

  **This lane did not "fix" it, and the reason is a measurement rather than
  taste.** `deriveBashEdges` in `script/m14/differential.ts` pushes `imports` AND
  `references` for the same construct too, so the differential reports zero
  unexplained edges and cannot see the duplication: both sides agree, and the
  agreement certifies nothing about the labelling. Changing the analyzer alone
  would have moved it into disagreement with its own oracle and turned a shared
  convention into a lane-local divergence. The duplicate emission is therefore a
  **project-level ontology question, reported to the supervisor and not settled
  here**: either `references` is meant to be a distinct fact and bash should emit
  one label for a `source`, or it is a generic dependency bucket and every
  language double-publishing it is overstating its graph by the size of the
  overlap. Either way the answer belongs to the shared machinery and the shared
  oracle together, and no single lane can settle it without editing both.

## The two fabrications pass 2 found, and the guard that removed them

Pass 1 measured how MANY edges there were. Pass 2's job was to find edges that are
WRONG, and `calls` produced two. Both were an **arithmetic operand that the
pinned grammar hands back in command position**, and both carried `confidence:
1.0` with `evidenceClass: "structural"` — a misparse presented as a parse fact,
which is the worst of the two failure modes.

The grammar models `$(( ))` correctly in the ordinary position and misparses it
in exactly two shapes:

| shape | source | parse | corpus sites |
| --- | --- | --- | --- |
| 1 | `last_run="${last_run:-$((attempt + 1))}"` | `expansion` → `command_substitution` → `subshell` → **`command` → `command_name: attempt`** | `kubernetes/cluster/validate-cluster.sh:138` |
| 2 | `! ((force_known_update)) && echo` | `negated_command` → `subshell` → `subshell` → **`command` → `command_name`** | `kubernetes/third_party/gimme/gimme:551` |

`z=$((a + 1))` is parsed correctly (`arithmetic_expansion` → `binary_expression`
→ `variable_name`) and has no `command` node to misread, which is why the defect
was invisible until the adversarial probe looked at what the targets *were*.

**How they were found, twice, independently.** `adversarial-probes.ts`
cross-tabulated the analyzer's own `isExternalCommand` metadata against an
independent parse-tree declaration walk and found **5** disagreements of the shape
"the analyzer says external, the walk found a declaration in this file". A second
and unrelated detector — every `calls` edge whose target is a `variable` of the
same file and not a `function` of it — returned the same **2** fabrications. All
5 disagreements were then adjudicated by hand against the source, and **3 are
correct calls the probe mis-classified**, which is worth recording because the
reason is a language fact rather than a tolerance:

- `$(date +"%B %d, %Y")` in `consul/build-support/functions/10-util.sh:430` and
  `:511` is a call to `/usr/bin/date`, even though that file also has a `local`
  variable named `date`. **bash resolves command position against functions,
  builtins and `PATH`, never against shell variables**, so a variable cannot
  shadow a command. The analyzer is right and the "own variable" detector is
  wrong.
- `_comp_cmd_cd "$@"` at `bash-completion/startup-core/000_bash_completion_compat.bash:278`
  is a real call to a function defined in another file. What the probe saw was
  the `declare -F _comp_cmd_cd` existence test on the line above, which leaves a
  `variable` symbol named `_comp_cmd_cd` behind.

**The fix** is `isArithmeticOperandCommand` in the analyzer: it keys on the
**enclosing node's own text**, never on source scanning, and it stops at the
first `command_substitution` that opens `$(` rather than `$((`. That stop is what
keeps `v=$(( $(wc -l < f) + 1 ))` emitting `calls: -> wc`, because `wc` really is
executed there. A guard that refused everything under `$((` would have deleted a
real edge, and `bash/arithmetic-guard-over-refuses-cmd-substitution` exists to
prove the fixture would have caught that.

**Measured effect, both directions.** `calls` went 5,152 → **5,150** and total
relationships 17,124 → **17,122**, a delta of exactly −2 with `callsLocal` (920),
`uses` (7,947), `contains` (3,697), `imports`/`references` (45), `exports` (210)
and `overrides` (28) all unchanged. Fixture battery 19/19. Mutants 5/5 caught,
including the new `bash/arithmetic-guard-removed` and
`bash/arithmetic-guard-over-refuses-cmd-substitution`.

**A gap this exposes, left open on purpose.** The same inventory that found the
two fabrications shows the arithmetic family is only partly read. Of **91**
`(( … ))` arithmetic commands in the sample, the first named child is
`binary_expression` 58 times, `expansion` 10, `postfix_expression` 6,
`unary_expression` 6, `ERROR` 6, `simple_expansion` 2, `variable_name` 3 — and
the dispatch in the analyzer routes only `expansion`, `postfix_expression`,
`simple_expansion` and `c_style_for_statement` to `emitVariableUses`. **So roughly
68 of 91 arithmetic operands name a variable the analyzer never emits a `uses`
edge for**, consistently: `((x++))` yields `uses`, `((x < 5))` yields nothing at
all, and `((x))` used to yield a `calls` edge. Closing it would ADD edges, which
is a payload change and belongs in its own measurement rather than being folded
into a defect fix. It is recorded here as a GAP with its instrument and its
number, not silently left for a reader to trip over.

**Q5 Resolved** — the per-type rates above are the answer, and the spread is the
finding. `contains`, `exports` and `overrides` resolve at both ends on **every**
edge; `calls` and `uses` resolve on the **source** end only; `imports`/
`references` resolve on the source end only because the target is a **filesystem
path in another file**, which a single-file analyzer cannot bind to a symbol.

**A pooled 19.09% cannot be read as a recall number, so it was decomposed.**
`adversarial-probes.ts` asks, for every unresolved target, whether an independent
parse-tree walk finds a declaration of that name in the same file. If it does, the
analyzer MISSED a symbol and the low rate is measuring its own recall. Measured:

| type | total | resolved | **declared in file but never emitted** | undeclared by any file |
| --- | --- | --- | --- | --- |
| `calls` | 5,150 | 983 (19.09%) | **0** | 4,167 |
| `uses` | 7,947 | 5,974 (75.17%) | **0** | 1,973 |

**Zero on both.** Every unresolved target is a name the file does not declare:
`grep`, `git`, `kubectl`, `awk` and 1,845 other well-known programs, plus 2,322
other undeclared command names for `calls`; and for `uses`, environment and
shell-defined variables read from outside the file — `PATH`, `BASH_SOURCE`,
`SHELLOPTS`, `SECONDS`, parameters of the enclosing script. So the low rates are a
property of how bash names things, not a symbol-extraction shortfall, and the
decomposition is what makes that claim checkable instead of asserted.

One more check falls out of the same table and is worth stating because a leak
would be invisible in a count: **0 of 5,150 `calls` edges names a bash builtin**,
against the analyzer's `SHELL_BUILTINS` refusal. `echo`, `cd`, `printf` and `read`
are refused deliberately (`real-bash-analyzer.ts`, the `SHELL_BUILTINS` guard),
so a non-zero figure there would mean the guard leaked. It has not.

This is the CSS `references` reference point (66.8% of its edges resolving at both
ends) in a stronger form: the low rate is a **property of the language's
namespacing**, and in each case the edge carries metadata that says which it is
(`resolvedWithinFile`, `resolution: "dynamic"`).

**Q6 Confident** — and here pass 1's own instrument was wrong, which is worth
recording because the error made the lane look better than it is.

The census tallied "under 0.7" with `if (c < 0.7)`, and reported **0** for every
type. That count is correct as written and it is the wrong threshold: the analyzer
emits **18 `calls` edges at confidence exactly 0.7**
(`real-bash-analyzer.ts`, the first-token heuristic), and `0.7 < 0.7` is false, so
none of them were counted. Honesty contract §4 requires the heuristic band to be
**countable**; a band that excludes its own boundary is not countable. The full
confidence distribution is now printed per type by `adversarial-probes.ts`:

| type | confidence values on the 400-file sample |
| --- | --- |
| `calls` | `1.0` × 5,132, **`0.7` × 18** |
| `uses` | **`0.8` × 7,947** |
| `contains`, `imports`, `references`, `exports`, `overrides` | `1.0` × all |

So the honest statement is two-part, and the second half is the one that matters:
**no edge is below 0.7, and 18 edges sit exactly on the line — 0.35% of `calls`
and 0% of everything else.** Separately, **`uses` is uniformly 0.8**: all 7,947
`uses` edges are `usage_contextual`, which is a name-match reading of a variable
rather than a parse fact. `uses` is the largest type in the lane and the only one
that is entirely a heuristic class; it clears the contract's threshold by 0.1
because that is where the analyzer put it, not because 0.8 was measured against
anything. A reader who takes "0 of 17,122 edges are heuristics" from the sub-0.7
band alone would be reading a threshold artifact.

**DERIVATION debt: 0, measured on 2026-10-03, not inherited.** Re-run:
`npx tsx script/m60/rel-type-coverage-gate.ts --langs=bash` → CHECK 1 DERIVATION
**clean**, and the gate prints `baseline: 104 recorded, 0 NEW, 104 repaid`.
A DERIVATION finding is a type the analyzer emits that the differential never
audits. `deriveBashEdges` pushes exactly seven labels — `calls`, `contains`,
`exports`, `imports`, `overrides`, `references`, `uses` — and the gate prefers that
per-lane export over the shared compared-label allowlist, so all seven are audited.

**The recorded baseline still lists 5 DERIVATION findings for bash** (`calls`,
`contains`, `imports`, `references`, `uses`, each saying the differential audits
only `["extends","implements","instantiates","overrides"]`), and that entry is now
**stale**: `script/m14/differential.ts:23155` added `bash` to the `calls`
allowlist on 2026-10-02, after the baseline was written on 2026-10-01. The gate
classifies all 5 as repaid, which is the safe direction — a stale baseline
over-reports the debt — but the file is shared machinery (`validation/m60/`), so
the finding is reported rather than corrected here.

## What the corpus refused

A shell **reserved word** is not a command: bash consumes `if`, `then`, `fi`,
`esac`, `case`, `elif`, `do`, `done` itself, so no script can invoke one. When the
grammar loses track of a construct it hands the keyword back as a `command_name`,
and the analyzer was emitting an edge to it. The single refusal is one line in
`isCommandNameText` — the predicate **both** command paths share, the
`command_name` walk and the trap-handler splitter, so one check covers both doors.

Five guard candidates were measured rather than chosen
(`validation/m14/fixtures/bash/guard-ab-bash-calls.ts`). Each row is a count on a
hash-ordered sample, and each removal set is printed so it can be audited by hand
instead of counted. **These denominators are the pass-1 corpus state (3,174
admitted files) and were NOT re-run in pass 2** — the A/B is a historical
measurement of five candidate guards, and pass 2 added a sixth guard
(arithmetic operands, §"the two fabrications") on a different instrument. The
verdicts stand on the rows as measured; the denominators are not current:

| guard | 200 files / 2,945 `calls` | 400 files / 5,232 `calls` | verdict |
| --- | --- | --- | --- |
| **A** reserved-word name | 30 (1.02%) | **0** after the fix | **implemented** |
| **B** any damaged region (subtree or ancestor chain) | 96 (3.26%) | 108 (2.06%) | rejected |
| **C** the name is text of a comment on the same line | 0 | 0 | removes nothing |
| **D** the `command` is the first named child of a `case_item` | 0 | 0 | removes nothing |
| **E** the `command` node has a direct `ERROR`/missing child | — | 18 (0.34%) | rejected |

**Why A was safe and B was not.** A is a POSIX fact rather than a heuristic, so
its cost is zero by construction; all 30 of its removals on the 200-file sample
were `if`/`then`/`fi`/`esac`/`elif`/`else`/`do`/`case` keywords, and 0 were real
commands. (`./fi` is a command, but its name is `./fi`, not `fi`.) B's removal
set is dominated by real work: `::log::status` 15, `print` 8, `autoload` 8,
`zmodload` 5, `add-zsh-hook` 3, `cvs` 3, `zle` 3, `_arguments` 3, `setopt` 2,
`echoti` 2, `emulate` 2, `bashcompinit` 2, `rustup` 2 — a MISSING token anywhere
in a file condemns every command under it, which is the `#907` swallow class the
decision was originally taken to avoid. **B was already documented as rejected in
the source comment; what changed is that the count is now reproducible** instead
of resting on a figure from a 2,747-file corpus that no longer exists.

**A falsified written ruling, found by the census.** `script/m14/spec/
bash-completeness.json` **BD8** states "a `case` arm's PATTERN is a `word` or
`string` node, never a `command`, so no pattern was ever emitted as a call". The
first clause holds — the pattern IS a `word` — and the conclusion drawn from it
does not. `kubernetes/third_party/gimme/gimme` emits four `calls` edges naming no
command bash can run: `-> binary` @936, `-> git` @938, `-> auto` @939, `-> *`
@940. The construct is `if ! case "${GIMME_TYPE}" in` (gimme:935) — a `case` in
the `!` position of an `if`, which the pinned grammar cannot close — so the arms
arrive as bare `command` nodes whose name is a plain `word`, and
`isRecoveredCommandWord` trusts a plain word, correctly by its own rule. BD8's
**decision** (lift the `caseDepth` suppression) stands and is untouched; only its
stated evidence is wrong. The correction is written here and reported as a
§2d item for the spec's owner rather than edited into a shared file.

**Why E was rejected on measurement.** E is the narrowest structural guard
available and it still removes 15 **real** calls to `kube::log::status` in
`kubernetes/test/e2e_node/gubernator.sh`, because `V=2 kube::log::status "..."` is
a `variable_assignment` in the command's own slot and the grammar puts an `ERROR`
beside it — so a real call and a lost `case` arm are the same node shape. 3
fabrications against 15 real calls is not a trade to make silently. E is not
implemented, and the 3 fabrications it would have caught stand as **named
residuals** rather than being hidden inside a guard that costs more than it saves.

**The residual that no structural guard can see.** `calls -> *` @ gimme:940
arrives as `(command (command_name (word)))` with no damage anywhere on it. The
only test that would catch it is a blacklist on the literal name `*`, and that is
not a POSIX fact — a file named `*` is legal. It is carried as **1 edge on the
400-file sample**, named, rather than closed with an invented rule.

**Fixture and mutant coverage for this decision.** Fixture
`bash/reserved-word-not-a-call` pins both directions: a `forbidRelationships` row
for every reserved word the corpus produced, **and** positive `expectRelationships`
rows proving a real command on the *same damaged lines* still produces its edge
(`/usr/bin/true --version` in `reserved-word-not-a-call.sh`). Three mutants in
`validation/m14/fixtures/bash/mutants-bash-lane.mts` are **source** mutations run
through the shared runner's own `runLang("bash", instance)`, because the shared
registry mutates the analyzer's *result object* and so cannot express a defect
that works by **refusing** to emit:

| mutant | caught by |
| --- | --- |
| `bash/reserved-word-guard-removed` (the guard line deleted) | `bash/reserved-word-not-a-call` |
| `bash/reserved-word-table-emptied` (the guard survives, the table goes empty) | `bash/reserved-word-not-a-call` |
| `bash/reserved-word-guard-over-refuses-builtins` (guard widened to every builtin) | `bash/call-identity-bd10`, `bash/source-path-resolution-bd9`, `bash/trap-handler-bd3` |

The third exists to prove the fixture pins **both** directions — the guard must
remove fabrications *without* removing real calls — and it is the mutant that
fails if the fixture only ever asserted the forbids. The second exists because a
line-removal cannot produce it, and a hand-maintained word list decaying to empty
is exactly the shape a table takes.

## Dead code removed, and why the removal is itself a finding

Four functions were deleted rather than documented:

| removed | why |
| --- | --- |
| `normalizeRelative(arg, sourceDir)` | Resolved a relative `source` against the sourcing file's own directory, which **BD9 reversed as wrong** — bash resolves against `$PWD` at run time, so the rewrite turned `source ./eng/common/tools.sh` inside `eng/common/` into the nonexistent `eng/common/eng/common/tools.sh`. It had no callers, and its doc comment still asserted the reversed behaviour, so the file described two different contracts for one construct. |
| `dirnameOf(filePath)` | Existed only to feed `normalizeRelative`, read by nothing. |
| `enclosingStatementIsDamaged(node)` | The damage half of the never-wired BD5 guard. |
| `subtreeIsDamaged(root)` | Same. |

The last two are the load-bearing item. **The analyzer's own BD5 comment claimed a
damage guard that was never implemented, and the two helpers that would have
implemented it were dead code sitting in the file** — so the source asserted a
refusal the code did not perform. The `Errors` row of the contract table above
repeated the same claim, so the doc and the source agreed with each other and both
were wrong. The guard is now measured (guard B above) rather than asserted, and the
`Errors` row states what the code does.

## Declared limitations

For a Turing-complete language a blank limitations list is treated as dishonesty,
not excellence. This lane's are measured, not hedged:

1. **Symbol metadata does not survive the production boundary — 0 of 11 keys, 0%.**
   Measured on a 105-file sub-sample, each file parsed twice and the key sets
   differenced: `bashSpecific`, `isScript`, `scriptPath`, `isArray`,
   `isScriptFunction`, `isTopLevel`, `isLocal`, `isDeclared`, `isExported`,
   `isReadonly` and `isAlias` are all published by `analyze()` and **all 11 arrive
   at 0% through `parseFile`**. `src/ast/pool-worker.ts` re-shapes every symbol
   (`range` → `startLine`/`endLine`) and forwards `metadata` only for an allowlist
   written for CSS, Markdown and generic keys. **Consequence: every fixture in this
   lane passes while reading a fact the store never sees.** This is the M14 #290
   failure mode exactly, it is invisible to the fixture suite by construction, and
   it is why the `exports` labelling check had to be moved to
   `probe-bash-exports.mts` (which reads `analyze()` directly) after the census
   first reported 20 of 20 `exports` targets as missing `isExported` — the
   analyzer was right and the instrument was wrong. **Reported, not fixed**:
   `pool-worker.ts` is shared machinery (§8).
2. **A single-file analyzer cannot resolve a `source` target to a symbol**, which
   is why `imports`/`references` resolve at both ends on 1 of 45 edges. The edge
   is real and its `resolution` metadata says which kind of path it is; the
   binding does not exist at this scope and no single-file analyzer can invent it.
3. **`calls` resolves at both ends on 19.09% of its edges**, and the other 80.91%
   are calls to names this file does not declare — measured, not assumed: an
   independent tree walk finds a declaration for **0** of them, so this is not a
   recall shortfall. The `isFunctionCall`/`isExternalCommand` split is what makes
   it readable (920/920 and 4,230/63) rather than a defect.
4. **`references` duplicates `imports` on the measured sample** — 45 of 45 keys
   identical in both directions, 0 either way. Two ontology types, one distinct
   fact, and the shared oracle does the same, so no differential can see it. See
   the Q4 section for why this lane reports rather than resolves it.
5. **`uses` is entirely a heuristic class.** All 7,947 edges are
   `usage_contextual` at confidence **0.8** — a name-match reading, not a parse
   fact. It is the largest type in the lane and the only one that is wholly
   inferred, and it clears honesty contract §4's threshold by 0.1 for no measured
   reason. `contains` targets were checked for the related confusion (0 bare
   positional parameters, 0 `unknown` endpoints, 0 empty names).
6. **`eval` (42), `${!name}` (11) and `-c` (8) are not followed.** Neither the
   analyzer nor the differential resolves them, so a relationship reachable only
   through them is absent from the graph. That is the residual the three RULED
   types are ruled against, sized rather than asserted.
7. **Roughly 68 of 91 `(( … ))` arithmetic operands emit no `uses` edge.**
   `binary_expression` (58) and `unary_expression` (6) are not routed to
   `emitVariableUses`, so `((i < 5))` names a variable the graph never mentions.
   Known, instrumented, and left open: closing it adds edges, which is a payload
   change owed its own measurement rather than a by-product of a defect fix. This
   is the lane's largest known GAP.
8. **`overrides` is the weakest label in the lane, and the strongest argument
   against it is that bash has no superclass.** What the measurement settles: all
   **28 of 28** edges point from a later definition to an earlier definition of
   the same name in the same file, so there is always a base to override, and all
   28 targets are `function` symbols. What it does not settle: bash has no
   inheritance, so "override" is a *replacement* in the same scope, not a
   polymorphic dispatch against a base type. A reader wanting "which function
   shadows which" is served; a reader expecting override semantics is not, and the
   edge does not claim to be that.
9. **`exports` points at shell variables, not module exports.** By symbol kind on
   the measured sample: `constant` 183, `variable` 26, `function` 1 — so **209 of
   210 `exports` edges publish a variable into the environment of child
   processes**, which is what bash's `export` does, and one publishes a function
   (`export -f`). That is not the same act as a JavaScript `export`, and the edge
   is honest about the language but the label is a shared-ontology approximation.
   The oracle corroborates the same rule, so this is a convention question rather
   than a lane defect.
10. **4 `calls` edges name no runnable command** and are carried deliberately:
   `binary` @gimme:936, `git` @gimme:938, `auto` @gimme:939, `*` @gimme:940. Every
   structural guard that would remove them costs more real calls than it saves
   (guards B and E above), so they are named instead of closed.
11. **24 of 400 sampled files contain at least one damaged command region, and 89
   `calls` edges come from one.** This is a pinned-grammar limit, not an analyzer
   limit: bash-completion's generated `completions-core/*.bash` nest extglob
   inside `[[ == ]]` patterns, and `dart-sdk` files abort the wasm parser with
   `memory access out of bounds`.
12. **The differential cannot see a shared grammar bug.** `deriveBashEdges` walks
    the same pinned wasm. Precision/recall of 1.000 against 1,597 oracle edges is
    agreement about the tree, not about bash. The two fabrications removed in pass
    2 are a concrete instance of the blind spot this describes: both were the
    grammar misparsing, and the oracle either agreed or was silent, so neither
    could have caught them. They were caught by asking what the edge TARGETS were.
13. **Both measurements are samples, and one is a hash-ordered sample of 400 of
    4,012 admitted files.** Hash order is deterministic and does not favour any
    repository's naming, but it is not a uniform draw of tokens or of bytes, and a
    repository with many small scripts is represented more than a repository with a
    few large ones. The gate's 4,012-file figures are quoted alongside every census
    figure for that reason.
14. **The census sample is reproducible only against a pinned corpus.** Every
    number in this document moved when the shared corpus grew from 3,174 to 4,012
    admitted files, and two of them moved in opposite directions
    (`imports`/`references` 61 → 45, `exports` 179 → 210), because adding files
    changes which files sort into the first 400 of a hash order. The corpus state
    is therefore part of every claim here. A reader re-running the census against
    a different corpus should expect different numbers and should not read that as
    a regression in the analyzer.

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
| hash-ordered sample used for the ontology census above | 400 | see `census-bash-ontology.ts` | — | **4,101** | **17,122** |

A large fixed cost per file plus a size-dependent cost. **No target budget is
defined**, so these are measurements, not a verdict — the previous doc's
"1,020 ms / 29.4 files per s" came from a 30-file corpus and is not comparable.

**Payload budget.** The reserved-word guard is a net **reduction** in emitted
edges: the gate's `calls` count moved 44,986 → 44,704 while the admitted corpus
grew 3,161 → 3,174 files, so the guard removed more than the corpus added. No
lane's graph grows because of this change, and no shared budget file was touched.

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

## Verified limitations (grammar, named one construct per case)

Measured directly against the pinned grammar rather than inferred from a corpus
probe:

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
| **`case` in the `!` position of an `if`** | **NO — the `case_item`s are destroyed; see [What the corpus refused](#what-the-corpus-refused)** |

So the grammar gap is **two shapes** for the constructs probed, plus the
`if ! case` shape found by this round's census: *complex/nested extglob*, *a
continuation inside `test`*, and *a `case` under `!`*. The
`${var:offset:len}` and process-substitution rows in an earlier draft of this
section were **wrong** — they were attributed by a context-window probe, the same
instrument that produced two false positives in the ontology gate, and both
constructs parse cleanly in isolation. The correction is recorded here rather than
quietly removed.

Fixing any of these means regenerating the wasm, which is a build task for the
grammar's owner.

## Evidence

Measured over **every file the production router admits to bash across 68
cloned repositories** — 220,494 files scanned, **2,747 admitted**, 51
repositories (the pre-`#277` full-corpus figures, retained because they are the
denominator of the differential):

| measurement | result |
| --- | --- |
| truth edges (independent oracle) | 74,018 |
| covered | 73,930 (**99.9%**) |
| **UNEXPLAINED (fabrications)** | **2 — in 2 files (0.07%)** |
| **unlined edges** | **0** |
| **non-symbol edge sources** | **0** |
| in-scope parse rate (excl. zsh) | 94.4% (2,190 / 2,321 real bash) |

This round's own measurements, each reproducible from a named file in
`validation/m14/fixtures/bash/`:

| check | command | result |
| --- | --- | --- |
| Ontology census, 400 hash-ordered files | `npx tsx validation/m14/fixtures/bash/census-bash-ontology.ts --sample 400` | 7 types emitted, **17,122 relationships**, 0 parse failures, 0 empty names, 0 `unknown` endpoints, 0 empty endpoints, 0 unknown kinds |
| Grammar inventory (instrument A) | `npx tsx validation/m14/fixtures/bash/probe-bash-grammar-inventory.mts --sample 400` | **144 distinct node types**; `extends`/`implements`/`instantiates` → NONE |
| RULED-construct probes (instrument B) | `npx tsx validation/m14/fixtures/bash/probe-bash-ruled-constructs.mts --sample 400` | parse-tree **0/0/0**; lexical 7/5/0, all 12 comment text; dynamic doors 42/11/8 |
| Guard A/B | `npx tsx validation/m14/fixtures/bash/guard-ab-bash-calls.ts --sample 400` | A 30→0 implemented; B 108 rejected; C 0; D 0; E 18 rejected |
| Fixtures | `bun run script/m14/run-fixtures.ts --lang bash` | **19 pass, 0 fail** |
| Pass-2 adversarial probes | `npx tsx validation/m14/fixtures/bash/adversarial-probes.ts --sample 400` | unresolved-target decomposition: **0 missed declarations** on `calls` and on `uses`; 0 bash builtins named by a call; 5 self-report disagreements reduced to 3 by the arithmetic guard; `imports`/`references` overlap **45/45 both ways**; `overrides` **28/28** have an earlier definition; `exports` targets by kind constant 183 / variable 26 / function 1; confidence `calls` {1.0: 5132, 0.7: 18}, `uses` {0.8: 7947} |
| Lane source mutants | `npx tsx validation/m14/fixtures/bash/mutants-bash-lane.mts` | **5 mutants, 5 caught, 0 survived, 0 did not apply** |
| Shared mutant registry, bash slice | `BB_MUTANT_ONLY="bash/" bun run script/m14/mutate-analyzer.ts` | filtered 1,483 → **23, all 23 caught, 0 survivors** |
| Ontology coverage gate | `npx tsx script/m14/ontology-coverage-gate.ts bash` | **7/10 emitted, 3 RULED-SOUND, 0 FALSIFIED, 0 ruled-without-justification**; 1 `[BB-HANG]` on a `dart-sdk` file (wasm `memory access out of bounds`) |
| Differential, bash only | `bun run script/m14/differential.ts --lang bash` | `otp` pin, 60 files: truth **1,597**, covered **1,597**, MISSING 0, analyzer-edges 1,548, **unexplained 0**, heuristic 0 |
| Doc-truth emissions | `bun run script/m14/verify-doc-truth-emissions.ts` | `NO_CLAIM_TABLE [bash]` **resolved** (21 → 20 project-wide); 9 of this table's 10 rows now graded, `calls` dropped by a defect in the gate's own parser (see above) |
| Honesty gate | `npx tsx script/m14/verify-honesty.ts` | **22 failures, none in this lane's files**, and 22 at HEAD without this round's changes — see below |

Supporting artifacts:

- **Grammar node types** — 164 observed over the full corpus, 143 on the 400-file
  sample, 0 dead branches
- **Regex census** — 0 bash usages
- **Spec** — `script/m14/spec/bash-completeness.json` (BD1–BD10, BD8b, BD8c,
  BD11 and per-decision gaps). **BD8's stated evidence is falsified by this
  round's census; its decision is unaffected.** Reported, not edited (§8).
- **Full record** — `reviews/bash/m60-closure.md` (§1–§19a),
  `reviews/bash/resolution.md` (21 claim dispositions, deliberately not `CLOSED`)

**On the honesty gate's 23 failures.** `src/ast/real-bash-analyzer.ts` appears in
**0** of the failing declared-input sets, so this round's analyzer change did not
newly stale any evidence. The failures are: 12 banned-term hits in **other
lanes'** fixtures and results plus shared `validation/m14/grammar-pins.json`; the
`M14.0.F7` check on `analyzer-hygiene-cpp` and `analyzer-hygiene-elixir`; the
`F1`–`F9` evidence-freshness sets, which name hundreds of shared files
(`analysis-exclusions.ts`, `brain-surgical-patcher.ts`, `run-fixtures.ts`,
`differential.ts` and so on) that this lane does not own; and the summary check
"freshness rule flags every artifact". Regenerating those is shared work and is
reported rather than attempted.

The `f5_tree_oracle` truth replaced a hand-authored 55-fact file in which every
fact was `authority: manual_audit` and twelve pinned the `global` phantom as
*expected*. A lane whose truth cannot disagree with its analyzer has no
differential; it has a mirror.
