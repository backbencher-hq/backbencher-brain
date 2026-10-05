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
| Declarations | Reassignments deduplicate per scope, on `${owner}\u0000${name}` — so `COMPREPLY=(a b)` at module scope and `COMPREPLY[i]=…` inside a function are **two** declarations of one name, which is what bash does. Declarations and `exports` edges dedupe **separately** — the pre-fix shape returned early on an already-declared name and silently swallowed the edge, so `CFLAGS=…` later `export CFLAGS` produced the variable and no `exports` edge. **`arr[i]=value` declares `arr`** (round 12): the assignment creates the array when it does not exist, the grammar holds that LHS as `subscript > variable_name` one level deeper than the bare case, and the handler read only a direct `variable_name` child — so **5,474 of 40,170 assignment LHS shapes (13.6%, 123 files)** published nothing until round 12. |
| Parameters | Positional `$1..$9` and `$@`/`$*` populate `parameters`; `$0` is excluded. `$@ $* $? $$ $# $! $_` punctuation is shell bookkeeping and is not emitted. |
| Uses | `$VAR`, `${VAR}`, `${VAR:-x}`, `${arr[i]}` emit `uses` (subscript base name only). Targets are trimmed, and `metadata.isAssignedInFile` is set when the file assigns the name **under any owner** (`BD11`) — **64,514 of 81,534 reads corpus-wide (79.1%)**, the rest either declared in another file, supplied by the environment, or a name only a function declares. **The predicate is evaluated in a post-walk pass, not during the walk**: evaluated in the walk it could only see the declarations already passed, so the answer depended on where the read sat — 37 (file, target) pairs in 25 of 400 files carried both answers, and the corpus-wide self-contradiction count is now **0**. Round 12; see [Round 12](#round-12-the-assignment-that-binds-a-name-and-the-flag-whose-answer-was-a-line-number). |
| Calls | Non-builtin commands emit `calls` with the line the command **name** is on. A computed command is a `uses`, never a fabricated `calls` (`BD4`). **Case-arm commands are calls** (`BD8`) — the pre-existing doc claimed they were noise. A command name must be a `word`, not a bare number, not an escape, and **not a shell reserved word** (`BD5`, `M60`). A trap **signal is not a caller** (`BD3`); the handler body is a real call attributed to the installing function. |
| `contains` | Every declaration is contained by its owning scope at the declaration's line. |
| `imports` / `references` | `source` / `.` emit both, and the path is kept **as written** (`BD9`). An earlier version "improved" it by resolving against the sourcing file's directory, which was wrong: bash resolves a relative `source` against `$PWD` at run time. Dynamic paths are labelled, not presented as resolved. |
| `exports` | `export VAR`, `export VAR=value`, `declare -x` and `export -f fn` each emit an `exports` edge from the owning scope at the export line (`BD7`). This type was absent for the whole pre-`#277` history and its absence was a **defect, not a language limitation** — seven peer lanes already emitted it. |
| `overrides` | A re-declared function emits `overrides` from the later declaration to the earlier one, with `metadata.overridesLine` naming the prior line (`BD8b`). 57 redefinitions across 38 of 2,747 admitted files. |
| Patterns | `set -e`/`set -o errexit`, `curl \| bash`, `rm -rf /`, `chmod 777`, `eval`, `sudo`, container/cloud/build tooling — all from AST structure, never source text. |
| Errors | Syntax errors are engine-owned (`engine.ts` merges `treeErrors`). **No blanket refusal of a damaged region** — the guard that would have done that was measured and deleted; see [What the corpus refused](#what-the-corpus-refused). The refusals that remain are all structural and none keys on the file: a name that is not a plain `word`, a name that is a **reserved word**, an **arithmetic operand** in command position, and a **`case` arm pattern** — the last two added in rounds 2 and 3, each with its own A/B. |
| Regex | **zero** regex usages, and the M12 contract probe enforces it. Round 2 broke this and round 3 restored it; see [Regex inventory](#regex-inventory) |

## Relationship ontology — verdict per type, with the number behind it

Two measurements, two denominators, both reproducible. The **census** sample is
400 files taken in **hash order** (ascending sha256 of `repo/relpath`, admitted
by the production router `detectLanguageFromPath`), 48 repositories, out of
4,012 admitted files from 441,259 tracked files in 141 repositories. The
**gate** sample is every admitted file — 4,012 of them.

**Every number below was re-measured on 2026-10-03 (round 2), again in round 3,
again in round 4, and again in round 5 — and round 5 moved four of them for a
reason that is not a change to this analyzer.** The pass-1 revision of this table
was written against 3,174 admitted files from 374,996 tracked files in 111
repositories. Round 5 reads **4,130 admitted files from 458,446 tracked files in
54 contributing repositories** (7.4 GB). The census column is a 400-file sample in
**hash order** (ascending sha256 of `repo/relpath`, admitted by the production
router `detectLanguageFromPath`), 48 repositories. **A hash-ordered sample is
reproducible against a PINNED corpus and not against a growing one**, and that is
exactly what happened: round 5's sample is a *different* 400 files out of a
corpus 118 admitted files larger, so a difference between the round-3 and round-5
census columns is not evidence about this analyzer at all.

**What IS evidence about this analyzer is the pair of runs that share a sample.**
Round 4 measured before-and-after on one unchanged 400-file sample and recorded
`uses` **7,802 before and after — UNCHANGED**, which is the signature that
distinguishes "the edges were already there and named a real binding" from "the
analyzer invented edges". Round 5's census reads `uses` **7,802**, reproducing
round 4 exactly on a *different* sample of the same corpus, and round 4's
`binding sites 234 / 96 distinct files / undeclared 1,563 / explained by a binding
site 0` all reproduce too (`probe-bash-binding-sites.mts`, re-run in round 5). So
the round-4 conclusion is reproducible; the round-3 column is simply the older
sample.

Round 3's own delta, edge for edge, from `census-bash-ontology.ts` before and
after the change in [Round 3](#round-3-what-the-census-was-already-printing):

| type | round 2 | round 3 | delta | attributable to |
| --- | --- | --- | --- | --- |
| `calls` | 5,150 | **5,147** | **−3** | the case-arm-pattern guard, 3 arm-pattern names |
| `imports` | 45 | **44** | **−1** | the same guard, a fabricated dependency edge |
| `references` | 45 | **44** | **−1** | the same guard, the twin edge |
| `uses`, `contains`, `exports`, `overrides` | 7,947 / 3,697 / 210 / 28 | 7,947 / 3,697 / 210 / 28 | 0 | — |
| **total relationships** | 17,122 | **17,117** | **−5** | matches the A/B's 5 exactly |

**Round 5's column, and the honest way to read the difference between the two.**
Round 5's sample is not round 3's sample — the corpus grew from 4,012 to 4,130
admitted files, and a hash-ordered sample of a larger corpus is a different set of
files. So `calls` 5,147 → 5,099, `uses` 7,947 → 7,802 and `contains` 3,697 →
3,782 are **three different samples agreeing within 1%, and none of them is a
defect count**. The per-type total moved by −108 while the sample grew by 118
admitted files; that is arithmetic, not a finding. The `uses` column is the one
that cannot be explained away, because it reproduced exactly (7,802) across two
different samples of the same corpus — and it is also the number round 4 held
fixed across its own before/after on one fixed sample.

| type | round 3 sample | round 5 sample | attribution |
| --- | --- | --- | --- |
| `calls` | 5,147 | **5,099** | different sample; −0.9% |
| `uses` | 7,947 | **7,802** | different sample, and **identical to round 4's before/after pair** |
| `contains` | 3,697 | **3,782** | different sample; +2.3% |
| `imports` / `references` | 44 / 44 | **44 / 44** | unchanged |
| `exports` / `overrides` | 210 / 28 | **210 / 28** | unchanged |
| **total** | 17,117 | **17,009** | different sample |
| files / repos / symbols / parse failures | 400 / 48 / 4,186 / 0 | **400 / 48 / 4,186 / 0** | identical |

The `gate` column is every admitted file. **It is not a reproducible count, and
round 3 measured how far from reproducible it is.** Two runs of
`ontology-coverage-gate.ts bash` on this commit against this corpus:

| type | gate run A | gate run B | spread |
| --- | --- | --- | --- |
| `calls` | 53,443 | 53,481 | **38** |
| `uses` | 78,404 | 78,425 | **21** |
| `contains` | 35,743 | 35,769 | **26** |
| `imports` | 637 | 636 | 1 |
| `references` | 637 | 636 | 1 |
| `exports` | 1,912 | 1,913 | 1 |
| `overrides` | 133 | 134 | 1 |

The cause is named, not guessed: the pinned wasm aborts with `memory access out of
bounds` on whichever files it reaches, and which files those are differs between
runs — run A reported `json_xs.bash`, `k3b.bash`, `set_default_linux_apps.sh`,
`nvm_print_default_alias`, `completion.zsh`; run B reported `jsonschema.bash`,
`native_test_win32.sh`, `prepare_tool.sh`, `verify-openapi-spec.sh` and then
`[BB-HANG] parser stuck 120s` on `jsonschema.bash` and exited. **No two of those
ten paths is the same.** So the gate's denominator is "however many files the wasm
survived", which is a different number each run, and every per-type total inherits
that wobble. Both runs agree on the thing the gate exists to decide —
`emitted 7/10 ruled-sound 3 FALSIFIED 0 ruled-without-justification 0`, and 164
distinct node types — because a type being emitted at all does not depend on which
40 files aborted.

**Round 9 corrects the attribution of that mechanism.** The wobble is real and
repeated, but round 8 explained it as the pinned wasm breaking down progressively
within one process, on the strength of a probe that borrowed the engine's shared
parser. The whole-corpus `--all` run puts only **2 files of 4,133** past the
grammar, so the wasm is not what makes the gate wobble; a probe or gate that
interleaves two owners of one parser handle is. The wobble is therefore still an
instrument property and **still not fixed** — it is now known to be a different
instrument property than the one this file named, and the gate is shared machinery
(§8) so the fix is reported, not applied.

The **census** column has no such problem and is the number to quote: it goes
through `parseFile`, reported **0 parse failures** on the same 400 files, and
round 3 reproduced round 2's denominators exactly (400 files / 48 repositories /
4,012 admitted / 441,259 tracked). The gate column is quoted as a range for that
reason and not as a single figure.

| type | emitted? | **WHOLE CORPUS: 4,133 admitted, production `parseFile` (round 12)** | census: 400 files (round 12) | **edges that resolve to ONE declaration** | evidence |
| --- | --- | --- | --- | --- | --- |
| `calls` | **EMITTED** | **55,241** | 5,097 | 231 of 236 ambiguous; **0 dangling** | `census-bash-ontology.ts --all`, gate row, `probe-bash-published-resolvability.mts --all` |
| `uses` | **EMITTED** | **81,534** | 7,856 | 11,205 of 12,165 ambiguous; 960 decline; **0 dangling** | same |
| `contains` | **EMITTED** | **38,327** | 3,775 | **6,202 of 6,202 (100%)** — the edge's own line | same |
| `imports` | **EMITTED** | **679** | 44 | n/a — the target is a path, 0 present | same |
| `references` | **EMITTED** | **679** | 44 | n/a — the twin edge, 0 present | same |
| `exports` | **EMITTED** | **1,929** | 210 | **96 of 96 (100%)** | same |
| `overrides` | **EMITTED** | **138** | 28 | **138 of 138 (100%)** — definitional | same |
| `extends` | **RULED — never emitted** | 0 | 0 | n/a | instrument A + B below |
| `implements` | **RULED — never emitted** | 0 | 0 | n/a | instrument A + B below |
| `instantiates` | **RULED — never emitted** | 0 | 0 | n/a | instrument A + B below |

**Totals, in prose because the gate grades this table:** the seven emitted types sum
to **178,527 relationships over 42,469 symbols**, from 4,133 admitted files, 0 parse
failures, and **4,133 grammar-read / 0 answered by `extractFallback`** (round 11 read
178,388/42,420 with 1 fallback; rounds 9 and 10 read 178,463/42,418 and
178,396/42,403 on the same admitted set). **Round 12's +139 relationships and +49
symbols are NOT all the round's change, and the difference is attributed rather than
absorbed**: the A/B on the whole corpus measures the change at **+45 symbols and +47
`contains` edges**, and the remaining ~+94 across `calls` and `uses` is the documented
instrument wobble. See
[Round 12](#round-12-the-assignment-that-binds-a-name-and-the-flag-whose-answer-was-a-line-number).
The **last column** answers "can the graph walk to a declaration": over **18,837
name-ambiguous edges, 0 leave zero candidates in any type.** (A
`total` row is not a row in this table: `verify-doc-truth-emissions.ts` parses every
data row as a relationship type and reports a summary line as
`NON_ENGINE_KIND [bash] total`, which this lane introduced once and removed.)

**The whole-corpus column exists because round 9 established that it can be
taken**, and until then this file's numbers were a 400-file sample (9.7% of
admitted files) beside a gate column that is not reproducible run to run. Round 8
asserted the opposite — see [Round 9](#round-9-the-whole-corpus-measurement-round-8-said-cannot-be-taken)
— and the assertion was a defect in a lane probe, not a property of the corpus.
`--all` runs 4m20s in one process, reads **4,131 of 4,133** files with the
tree-sitter grammar, answers **2** with `extractFallback`, and takes **0
relationships** from those 2 — so no per-type total above is contaminated by a file
the grammar could not read. The census now prints that count on every run, because
a census that cannot tell "the analyzer found nothing" from "the analyzer never
ran" cannot support a whole-corpus claim.

**The census column moved in round 8 and the reason is not the analyzer's behaviour.**
The corpus grew from 4,130 to **4,133** admitted files, and this column is a
hash-ordered draw, so round 7's 400 files and round 8's 400 files are different sets —
limitation 14 is the same property stated as a rule. Round 8's own numbers on its own
sample: 400 files / 55 repositories / 4,133 admitted / 4,179 symbols / 17,054
relationships / **0 parse failures**, against round 7's 4,186 symbols and 17,009
relationships on a smaller corpus. **The only evidence about the round-8 change is the
A/B pair**, which shares one sample and one corpus: `uses` **7,786 → 7,856**, every
other type and the symbol count identical. See
[Round 8](#round-8-the-arithmetic-command-whose-operands-were-invisible-and-what-the-arbiters-say).

**The gate column was re-run for round 7 and is still not a reproducible count**, which
is the property the round-3 A/B pair measured and the reason it is quoted as a single
run with its date rather than as a figure. The 2026-10-04 run printed
`emitted 7/10  ruled-sound 3  FALSIFIED 0  ruled-without-justification 0`, then hit
`[BB-HANG] parser stuck 120s` and exited, so its per-type totals are truncated by
whichever files the wasm reached before it died — compare round 3's pair, where run A
and run B differ by 38 `calls` edges on the same commit, and compare this run's
`exports` 1,927 against the 1,929 the whole-corpus evidence census reports. Both
differences are the wasm, not the analyzer. **The census column is the number to
quote**: it goes through `parseFile`, reports **0 parse failures**, and round 7
reproduced round 5's figures exactly on the same pinned sample.

**The gate's own run-to-run spread is measured, and it is why the gate column carries a
date.** Two runs of `ontology-coverage-gate.ts bash` on one commit against one corpus
differed by 38 `calls` edges (53,443 / 53,481) and 21 `uses` edges (78,404 / 78,425),
and the two runs named **no file in common** among the ten the wasm aborted on.

**The whole-corpus figures this paragraph used to quote are SUPERSEDED, and they were
wrong for the same reason round 8's were.** `probe-bash-missing-evidence.mts`
reported `calls` 55,220, `uses` 80,851, `contains` 38,273, `imports` 679,
`references` 679, `exports` 1,929, `overrides` 138 — total **137,770 edges, 0 with
no `evidenceClass`** — and presented them as the numbers with "a denominator that
does not wobble". Round 9 shows that census also walked the borrowed parser and so
covered ~499 files while calling itself whole-corpus. The figures to quote are now
`census-bash-ontology.ts --all`: **178,463 edges** on 4,131 grammar-read files, with
`imports`/`references` 679 and `overrides` 138 — the three types whose whole-corpus
count the old census got right, because they are rare enough that 499 files happened
to contain all of them. That is the trap worth naming: the types that survived a
truncated census are the ones with the fewest edges, so a partial walk looks
*most* correct exactly where it matters least.

**Coverage is reported as APPLICABLE, not as a flat 7/10.** Three of the ten types
are RULED with a corpus measurement, so the denominator that remains is 7 and all
7 fire: **7/7 applicable, 3 measured-absent, 0 unaccounted.** Reporting 7/10 would
describe finished work as broken work.

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
FALSIFIED 0  ruled-without-justification 0`. The 2026-10-03 runs printed five
`[BB-PARSE-ERR] … memory access out of bounds` rows and, on one of them, a
`[BB-HANG] parser stuck 120s`. Those are parser-robustness findings in the pinned
wasm, not lane verdicts. They are recorded here because they are also the reason
the gate column above is not a reproducible count, and because a gate that hangs
is a gate that reports a smaller corpus than it claims — the 4,012 denominator
includes the files it could not finish.

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
by hand. **Every one of the 12 rows is a `#` comment line**, across **7 distinct
sites** (`implements` and `extends` overlap on 4 of them) —
`bash-completion/completions-core/java.bash:99` (`# remove class extension`),
`bash-completion/startup-core/000_bash_completion_compat.bash:238` and `:241`,
`flutter-packages/.ci/scripts/validate.sh:9`, `vault/.release/docker/
ubi-docker-entrypoint.sh:11`, `phpmyadmin/bin/
transformations_generator_main_class.sh:3`, `bash-completion/completions-core/
svcadm.bash:11`. (The previous revision of this document said "all 11"; the probe
prints 12 rows over 7 sites, and the sentence did not add up. Round 3 re-ran it
and restated the measured figures rather than leaving the arithmetic.) A lexical hit
is reported as a candidate and never as a hit, because a string literal or an
embedded language can fake one — which is the same trap that produced two false
positives in the gate's first version, and the trap that would have produced a
fabricated edge here had the probe treated a comment as a declaration.

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

## Round 3: what the census was already printing

Round 1 measured how many edges there were. Round 2 asked which `calls` edges were
WRONG and found two. Round 3's question was deliberately different and less
flattering: **the shipped census output already contained a fabrication, in a
section nobody read.** `census-bash-ontology.ts` prints up to six example edges per
type, and among the `imports` examples on the 400-file sample was

```
kubernetes/third_party/gimme/gimme: gimme -[imports]-> _try_existing
```

`_try_existing` is a **shell function**, defined at `kubernetes/third_party/gimme/
gimme:414`. It is not a file. `gimme` does not import it, does not depend on it,
and no `source` of any such path exists. The analyzer published a module dependency
on a function, plus the `references` twin of it, at confidence **1.0** with
`evidenceClass: "import_based"` — presented as a parse fact.

### The cause, and why it survived two rounds

The pinned wasm cannot close a `case` in the `!` position of an `if`
(`kubernetes/third_party/gimme/gimme:935`), so an arm arrives as

```
command @936 "binary) _try_existing binary"
  command_name → word "binary"      ← the arm's PATTERN, not a command
  ERROR → ")"                       ← the arm terminator, misplaced
  word "_try_existing"
```

Round 1 found this region and wrote it down: it is why BD8's stated evidence is
falsified, and it is where the four `calls` residuals come from. Round 2 named
those four and closed none of them, on the measurement — recorded in the previous
revision of this document as limitation 10 — that *"every structural guard that
would remove them costs more real calls than it saves."*

**That measurement was true about guards B and E and wrong about the space they
left.** Round 3 measured a sixth candidate, and the cost is zero:

| guard | predicate | removes on 400 files | of which real | verdict |
| --- | --- | --- | --- | --- |
| **E** (= F3 here) | any direct `ERROR`/missing child | 20 | **15** real `kube::log::status` calls | rejected, pass 1 |
| **F1** | any direct `ERROR`/missing child whose text is `)` | 5 | **1+** — see below | **rejected by soundness** |
| **F2** | the child **immediately after `command_name`** is `ERROR`/missing and begins with `)` | 5 | **0** | **implemented** |

`guard-f-bash-imports.mts` measures all three, on the same hash-ordered sample, and
prints the whole removal set for hand adjudication rather than a count. F2 removes
the same 5 edges on **1,200 files / 76 repositories** that it removes on 400, so
the zero-real-call cost is not a small-sample accident.

**F1 was rejected on a counterexample, and that counterexample is the reason F2
exists.** `guard-f-soundness.mts` asks both predicates about 39 node shapes
directly rather than counting corpus edges. F1 fires on

```
awk one two ) three      →  command_name[awk] word[one] word[two] ERROR[)] word[three]
```

which is valid bash in which `)` is an ordinary word argument, so F1 would delete a
real `calls: -> awk`. **F2 fires on 0 of the 39** and on both of the defect's
commands. The POSIX fact underneath it: **a `)` can never immediately follow a
command NAME in valid bash.** `(cmd)` puts the `)` on the subshell as a sibling of
the whole command; `echo )` puts it after an argument or on its own as a `word`.
Only a terminator the grammar could not place lands between the name and the first
argument.

The wider reading also reproduces pass 1's rejection of guard E from the other
direction: on the current corpus F3 removes 20 edges of which **15 are real**
`kube::log::status` calls in `kubernetes/test/e2e_node/gubernator.sh`, because
`V=2 kube::log::status "…"` puts a `variable_assignment` in the command's own slot
and the grammar puts an `ERROR` beside it. The cost of narrowing is therefore a
measurement and not an argument.

### What round 3 removed, and what it deliberately kept

| edge | before | after | why |
| --- | --- | --- | --- |
| `calls → binary` @gimme:936 | kept | **removed** | the arm's pattern, not a command |
| `calls → git` @gimme:938 | kept | **removed** | same |
| `calls → auto` @gimme:939 | kept | **removed** | same |
| `imports → _try_existing` @gimme:937 | kept | **removed** | a function is not a module |
| `references → _try_existing` @gimme:937 | kept | **removed** | the twin edge |
| `calls → *` @gimme:940 | kept | **kept** | see below |

`calls → *` survives and is still named rather than closed, and round 3 checked
rather than assumed why. It arrives as `(command (command_name (word)))` with **no
damage on it anywhere**, so no positional or damage-shaped guard can reach it. The
only test that would catch it is a blacklist on the literal character `*`, and
that is not a POSIX fact — a file named `*` is legal. Round 2's reasoning for
carrying it holds exactly.

### A resolution rate that was measuring a fabrication

Round 2 reported `imports` and `references` resolving at both ends on **1 of 45**
edges (2.2%) and treated the other 44 as a language property: the target is a path
in another file, which a single-file analyzer cannot bind. Removing the
fabrication moved the rate to **0 of 44**, because the one edge that resolved was
`_try_existing` — a name that resolved because it is a symbol *in the same file*.
**The 2.2% was the fabricated edge, not a real dependency.** No instrument in
rounds 1 or 2 could have said so: they counted edges, and this edge was a
perfectly ordinary member of the count.

### Two further defects round 3 found in the lane's own text

**The Regex inventory was false.** `docs/analyzers/real-bash-analyzer.md` claimed,
in two places, that the analyzer contains **zero** regex literals. Round 2 added
three, in `isArithmeticOperandCommand`: `/^\(\(/`, `/\)\)$/` and `/^\$\(\(/`.
`script/m12/verify-regex-census.ts` reported all three as `MISSING` against the
committed blobs — a **live gate failure attributable to this lane** that neither
round 2 nor the doc mentioned. Round 3 rewrote them as character checks
(`opensWithDoubleParen`, `opensWithArithmeticExpansion`, `endsWithDoubleParen`) in
the style `isShellIdentifierName` already uses, and the AST-driven census core now
reads **bash 0**. That is the whole point of `isShellIdentifierName` being a char
loop — it cites the M12 probe as its reason — and a second function in the same
file citing a different convention is the kind of drift a census exists to catch.

**`INTERPRETED_COMMANDS` was dead code.** The set
`{source, ., export, alias, trap, set}` was consulted at exactly one site,
`real-bash-analyzer.ts:1426`, as the second disjunct of the gate immediately before
the `calls` edge. Every one of its six members returns earlier in `extractCommand`
— `source`/`.` at the dependency branch, `export`, `alias`, `trap`, `set` each at
their own branch — so the disjunct could never be the reason an edge was withheld.
Round 3 counted it rather than reading it: **580** `command` nodes in command
position on the 400-file sample are named by that set (`alias` 140, `set` 364,
`source` 48, `trap` 23, `.` 5; `export` 0, because the grammar always gives it as
a `declaration_command`), and **0** reach line 1426. The set and its use are
deleted. The census delta of exactly −5 attributes **0** of the change to this
deletion, which is what makes it provably dead rather than merely unused. Note
what pass 1's dead-code sweep missed and why: it removed four functions with *no
callers*, and this is the same defect wearing a call site — the call site exists,
it just cannot be reached.

## The six questions, per emitted type

Measured through the **production** `parseFile` from `src/ast/pool-worker.ts`,
not `analyze()` — `analyze()` is a per-file unit that skips the pool-worker
pipeline stages, so a count taken through it is a count of something the product
does not run. Sample as stated above: 400 files, 48 repositories, 4,186 symbols,
**17,009 relationships, 0 parse failures** (round 5, `census-bash-ontology.ts`).

| type | 1 exists | 2 fires | 3 correct | 4 labelled | 5 resolved (both ends) | 6 confident (<0.7) |
| --- | --- | --- | --- | --- | --- | --- |
| `calls` | yes | 5,099 | oracle: 1,657/1,657 covered, 0 unexplained | 907 function-call / 4,192 external-command, split verified both ways; 0 unclassified | **961 / 5,099 = 18.8%** | 0 / 5,099 |
| `uses` | yes | 7,802 | same run | 0 positional targets; 0 targets named a declaration the analyzer never published | **6,239 / 7,802 = 80.0%** | 0 / 7,802 |
| `contains` | yes | 3,782 | same run | 3,782/3,782 targets are symbols in their file | **3,782 / 3,782 = 100%** | 0 / 3,782 |
| `imports` | yes | 44 | same run | 44/44 keys identical to a `references` key | **0 / 44 = 0.0%** | 0 / 44 |
| `references` | yes | 44 | same run | 44/44 keys identical to an `imports` key | **0 / 44 = 0.0%** | 0 / 44 |
| `exports` | yes | 210 | same run | 210/210 targets carry `isExported`, **on both paths** — see §Q6 | **210 / 210 = 100%** | 0 / 210 |
| `overrides` | yes | 28 | same run | 28/28 targets are `function` symbols with an earlier same-name definition | **28 / 28 = 100%** | 0 / 28 |

The two columns that moved between round 3 and round 5 are `calls` resolution
(19.10% → 18.8%) and `uses` resolution (75.17% → 80.0%), and **only the second is a
change to this analyzer.** `calls` moved because the sample moved. `uses` moved
because round 4 published the declarations its own edges were already naming: 357
edges stopped resolving to nothing not because an edge was withdrawn — the `uses`
total is unchanged at 7,802 — but because the target now exists. Both readings
were re-measured in round 5 and both reproduce.

**Q1 Exists** — derived from source, not from a doc: each of the seven has a
construction site in `src/ast/real-bash-analyzer.ts`.

**Q2 Fires** — every one of the seven produces edges on the sample; the counts
above are the measurement. A type reachable only from a branch that never matches
is invisible to source derivation, which is why this column is measured rather
than read. The three RULED types read 0 on every admitted file (**178,463** edges,
0 of them of those three types — the round-9 `--all` figure, which supersedes the
137,770 the truncated evidence census reported), which is what makes them ruled
rather than merely absent from a sample.

**Q3 Correct** — `bun run script/m14/differential.ts --lang bash`, on the `otp`
pin, 60 files: **tree-truth 1,657, covered 1,657, MISSING 0, analyzer-edges 1,608,
unexplained 0, heuristic 0**. Pass 2 recorded 1,597 / 1,597 / 1,548. Both sides
rose by exactly 60, which is **not** attributable to round 3's guard: the guard's
corpus sites are all in `kubernetes`, and the `otp` pin draws 60 of its admitted
files. The meaningful readings are unchanged — every oracle edge covered, zero
unexplained edges. The scoped run also prints, and this is worth reading, that it
did **not** write the F5 artifact: *"a scoped run is for inspecting lanes, and
writing it here would replace that claim with a smaller one."*

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
adversarially on 2026-10-03, re-measured again in round 7 with the CLAIM on one axis
of a 2×2 and the MEASUREMENT on the other, and this is the question that found the
lane's real defects:

- `calls` is split by the analyzer's own mutually-exclusive flags, and the split
  is what makes the flag checkable rather than decorative:
  `isFunctionCall=true` — **907 edges, 907 resolve to a `function` symbol in the
  same file (907/907)**; `isExternalCommand=true` — **4,192 edges, 54 of which
  (1.3%) happen to name a symbol**. A local call that failed to resolve, or an
  external call that resolved to one, would make the flag a lie. Neither happens.
  **Round 7 measured this over all 55,218 corpus `calls` edges rather than the
  sample, and the corpus is where the flag was incomplete: 223 edges carried
  neither flag, 123 of them naming a function their own file declares.** See
  [Round 7](#round-7-the-flag-that-was-missing-and-the-edges-no-name-resolution-can-reach).
- `exports` — 210 of 210 targets carry `metadata.isExported`, **on both paths**.
  §Q6 below measures this per symbol over every file carrying an `exports` edge:
  144 of 144 keep the affirmative through `parseFile`, 0 are dropped. The earlier
  caveat on this row — that the fact does not reach the store — described the
  worker before four keys were forwarded and has been corrected above rather than
  left in place.
- `overrides` — 28 of 28 targets are `function` symbols, and **28 of 28 have an
  earlier definition of the same name in the same file**. Round 3 asked the
  stronger question pass 2 did not: **are the two definitions UNCONDITIONAL?**
  `if A; then f(){}; else f(){}; fi` declares a name twice in two mutually
  exclusive branches and neither replaces the other, so `overrides` would be the
  wrong label there. Walking the enclosing construct of both declarations of every
  edge: **28 of 28 have both declarations at top level, 0 with one conditional and
  0 with both.** The strongest objection to the label is therefore not present in
  this sample; the `overrides` discussion in the limitations is about the meaning
  of the word, not about a site where the edge lies.
- `contains` — 3,782 of 3,782 targets are symbols in the same file. The single
  miss reported by pass 1 (`esock_ttest-server-gs -> program`, 1 edge of 3,664) is
  not in this sample; the type now resolves at 100% on the corpus it was measured
  against, and the rate is reported per sample rather than smoothed.
- `uses` — 0 of 7,802 targets is a bare positional parameter, and **0 of 7,802
  names a declaration this analyzer never published.** The second half is round 4's
  whole result: the undeclared residue fell from 1,920 to **1,563** on an
  unchanged sample, and `probe-bash-binding-sites.mts` closes the class — of the
  1,563 undeclared targets, **0** are now explained by a binding site and the
  class went 357 → 0. The remaining 1,563 are attributed in
  [what the corpus refused](#what-the-corpus-refused), not to a missing collector.
- **`imports` and `references` are the standing labelling finding.** On this sample
  both types produce **44 edges, and the key sets are identical in both
  directions — 44 of 44 `imports` keys appear as a `references` key and 44 of 44
  `references` keys appear as an `imports` key, 0 differences either way.** So
  `references` carries nothing `imports` does not, in bash, for the
  `source`/`.` construct: the two types are one measurement published twice. That
  is not a fabrication — both edges are real edges to a real sourced file — but a
  consumer paying for two types is getting one fact, and the graph is 44 edges
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

### Q6 — what a published fact costs to reach the store

The six questions ask whether an edge is right. They do not ask whether the
**evidence** the edge is labelled with is readable by anything downstream. In bash
the answer differs by which object the fact is attached to, and **an earlier
revision of this section got it wrong**, which is why the split is stated first.

**RELATIONSHIP metadata survives. SYMBOL metadata does not.** Measured on
`kubernetes/third_party/gimme/gimme` and `ohmyzsh/lib/clipboard.zsh`, both through
production `parseFile`:

| object | carries metadata | of which the store can read |
| --- | --- | --- |
| relationships (`gimme`) | 1 of 1 `overrides` edges | **1**, `overridesLine: 125` |
| relationships (`clipboard.zsh`) | 23 of 23 `overrides` edges | **23**, `overridesLine: 55` |
| symbols (`gimme`) | 0 of 126 | **0** |
| symbols (`clipboard.zsh`) | 0 of 28 | **0** |

The mechanism is visible in the source and matches the measurement exactly.
`src/ast/pool-worker.ts:1094` forwards relationships whole —
`filterNoiseRelationships(parsed.relationships, …)` — so `evidenceClass`,
`isVariableReference`, `isAssignedInFile`, `isShellDefined`, `overridesLine` and the
round-5 `targetLine`/`targetKind`/`targetResolution` all reach the store. The
symbol map at `src/ast/pool-worker.ts:960-1012` instead rebuilds `metadata` from a
hardcoded allowlist that today carries CSS keys and markdown keys.

**The seam was real, it was reported, and it has since been closed for the four keys a
reader consumes. This section is corrected against the merged tree, because the
revision above was written when all 13 keys died and 4 of them no longer do.**

`pool-worker.ts:1093-1095` now forwards exactly the four keys round 5 recommended, on
exactly the reasoning round 5 gave — carry what a reader consumes, not what a producer
produces:

```ts
if (m.isExported === true) out.isExported = m.isExported
if (m.isImplicitBinding === true) out.isImplicitBinding = m.isImplicitBinding
if (typeof m.bindingSite === "string") out.bindingSite = m.bindingSite
if (typeof m.isArray === "boolean") out.isArray = m.isArray
```

Measured on the same 105-file sub-sample, and **the census now reports key-presence
and key-truth as two columns**, because they are two questions (see Round 7 for why the
earlier version conflated them and what it cost):

| key | key present in | survives | …published `true` in | survives |
| --- | --- | --- | --- | --- |
| `isArray` | 72 files | 72 (100%) | 10 | **10 (100%)** |
| `isImplicitBinding` | 25 | 25 (100%) | 25 | **25 (100%)** |
| `bindingSite` (a string) | 25 | 25 (100%) | — | — |
| `isExported` | 15 | 13 (86.7%) | 13 | **13 (100%)** |
| `bashSpecific`, `isScript`, `isTopLevel`, `isScriptFunction`, `isLocal`, `isDeclared`, `isReadonly`, `isAlias` | 105/105/53/52/32/32/15/4 | **0 (0.0%)** each | — | — |

`isExported`'s presence column reads 86.7% and its truth column reads 100%, and the
difference is the whole of a measurement error this lane made and has corrected:
`readonly x=1` publishes `isExported: false` — a correct negative, since a readonly
constant is not exported — and `=== true` declines to forward it.

**So the `exports` row of the six-questions table no longer needs its "on the
`analyze()` path" caveat, and that is a per-SYMBOL claim over the whole population, not
a 105-file rate.** `probe-bash-exported-symbol-survival.mts`, every admitted file with
at least one `exports` edge:

| | count |
| --- | --- |
| files with ≥1 `exports` edge | 242 |
| `exports` edges over them | 786 |
| distinct targets compared | 148 |
| `isExported` in **both** paths | **144** (every one a `constant`) |
| `isExported` in neither | 4 |
| published and **dropped by the worker** | **0** |

`isArray`'s asymmetry is deliberate and is the one place a negative IS carried:
`typeof m.isArray === "boolean"` forwards `false`, because a consumer must be able to
tell an array from a scalar. It does not need to be told a constant is not exported.
The eight keys still at 0% are produced and unread; widening the channel for them would
make it larger without making it more true.

## One edge, N declarations: the incoming-edge half, measured, partly closed in round 5, and finished in round 11

> **ROUND 11 HEADLINE.** Applying the fields an edge PUBLISHES to the file's real
> symbol table, over the **whole corpus**: **18,765 name-ambiguous edges, 17,801 resolve
> to exactly one declaration, 959 decline explicitly, 5 are external binaries whose name
> collides with a local variable, and 0 leave zero candidates in any type.** Before this
> round, round 9 counted 6,491 of them open by name alone, 29 of those dangling and 109
> publishing nothing. The section below is kept as written in rounds 5 and 9 with its two
> retractions inline, because the shape of the two mistakes — a count copied forward a
> round without a re-run, and a rule the instrument never contradicts — is the part a
> reader of any lane's numbers needs. See
> [Round 11](#round-11-the-open-population-was-counted-by-name-and-the-probe-was-wrong-twice).

### Round 9: which classes carry enough to disambiguate, and which do not

The task's incoming-edge requirement is that an edge either carries enough to
disambiguate its target or does not claim a single one. Round 6 built that for
`uses`; this round measured **which other classes have it**, per type, rather than
asserting that the mechanism exists.

`incoming-check.ts` over 6 corpus files — 275 symbols, 0 degraded parses, 0 parse
failures — names 3 targets that resolve to more than one published symbol
(`fail -> function, variable`, `x -> function, variable`,
`DARK_CONFIG_RUNDIR -> variable, constant`), and `overrides` fires with 27 edges
over 6 distinct declarations, **0 ambiguous and 0 unresolved**. Reading the metadata
on each ambiguous edge directly:

| type | edges whose target has >1 declaration in the same file | disambiguated | carries nothing |
| --- | --- | --- | --- |
| `uses` | 118 | **118** — `targetResolution` (`innermostScope`/`outerScope`) + `targetLine` + `targetKind` | **0** |
| `overrides` | 27 | **27** — `overridesLine` (e.g. 76) + `redefinition: true` | **0** |
| `calls` | 44 | 0 | **44** |
| `contains` | 86 | 0 | **86** |
| `exports` | 1 | 0 | **1** |

`overrides` is worth a second look because its 100%-ambiguous rate at whole-corpus
scale (138 of 138) looks alarming and is not: a redefinition's target is **by
construction** a name declared at least twice, so ambiguity is the shape of the
construct, and `overridesLine` names the prior declaration exactly. It is the one
type where the ambiguity is definitional rather than a resolution failure.

**The open population is therefore `calls`, `contains` and `exports`**, and at
whole-corpus scale (`census --all`, target present and matching more than one
published symbol) that is **236 + 6,159 + 96 = 6,491 edges**. `contains` is 95% of it.
`resolveDeclaration` is lane-owned and its scope-chain rule would apply unchanged —
a `contains` edge from owner *O* naming *N* is asking which declaration of *N* *O*
contains, which is the same question `uses` asks. **This is not fixed and no edge
is claimed to be fixed.** It is stated as the next actionable item with its size,
because the honest options were to ship an un-A/B'd change to the largest
structural type at the end of a session or to name the number. `contains` sits at
100% endpoint resolution with 0 `neither`, so nothing is dangling; what is missing
is *which* of several same-named symbols, and a consumer reading a `contains` edge
today must still pick by a rule nobody chose.

> **RETRACTED IN ROUND 11, all three numbers, and the reason is worth more than the
> numbers.** This counted how many published symbols share an edge's target **NAME**,
> which is the condition `bb_impact` faces when it has nothing else — and a consumer
> has the edge row too. Applying the fields the edge PUBLISHES to the real symbol
> table: `contains` resolves **6,159 of 6,159** from the edge's own line, because a
> `contains` line *is* the child's name line (`nameLineOf`, M60 #921) — so it was
> never open, and the paragraph above saying so and this one saying it was unfixed
> were both in the same section. `exports` was worse than counted: 29 of its 96
> ambiguous edges left **zero** candidates, because the edge carries the `export`
> STATEMENT's line rather than the declaration's, and the 400-file sample saw 2
> ambiguous `exports` edges in which those were the same line. And the `uses` residual
> quoted further down as "395 = 33.3% carry nothing" is round 5's figure, re-stated
> without a re-run after round 6 had fixed the mechanism it blamed; reproduced, it is
> **4**, of which 3 are now closed. See
> [Round 11](#round-11-the-open-population-was-counted-by-name-and-the-probe-was-wrong-twice).

The two `x` cases are a different fact and are named so they are not pooled with the
above: `x` is declared **once per file** and the collision is **across** the 6 files
`incoming-check` was given, which is a corpus-level name collision rather than an
in-file ambiguity. A single-file analyzer cannot see it, exactly like the 256
`calls` edges in limitation 3.

`src/lsp/impact.ts` obtains its reverse edges by scanning outgoing edges and
matching targets, so no inbound edge is stored anywhere. Two consequences follow,
and both are this lane's problem rather than the traversal code's. The incoming
resolution layer itself is laptop C's and is not duplicated here; what is done here
is that the lane's own edges carry enough to be resolvable, and that the ones which
cannot be are counted rather than described.

**Measured** (`probe-bash-ambiguity.mts`, production `parseFile`, 400 files hash
order, 4,130 admitted / 458,446 scanned — the same denominators as the census,
which required copying its 512 KB cap and its content-form
`detectLanguageFromPath`; without the content form the probe admits 3,308 files
instead of 4,130, because the content form is what admits an extensionless file by
its shebang):

| type | target present | ambiguous | candidates at DISTINCT lines |
| --- | --- | --- | --- |
| `calls` | 961 (18.8%) | 6 (0.6%) | 6 of 6 = 100% |
| `uses` | 6,239 (80.0%) | **1,185 (19.0%)** | 1,185 = 100% |
| `contains` | 3,782 (100%) | 658 (17.4%) | 658 = 100% |
| `exports` | 210 (100%) | 2 (1.0%) | 2 = 100% |
| `overrides` | 28 (100%) | 28 (100%) | 28 = 100% |

**1,879 ambiguous edges. 0 of them are irreducible by line** — every candidate set
sits on distinct `startLine`s, so no consumer is ever choosing between two
declarations on the same row.

**Three of the five types were already disambiguated, and a count cannot tell you
that.** `contains` puts the child's *name* line on the edge (`nameLineOf`, M60
#921), `exports` puts the declaration's line on it, and `overrides` carries
`overridesLine` — verified to survive the worker on `gimme` and `clipboard.zsh`.
`overrides` reads 100% ambiguous and 100% disambiguated at the same time, which is
the right shape for it: a redefinition has two declarations *by definition*, and
`overridesLine` says which is which. `uses` and `calls` put the **use site's** line
on the edge, which is a different line from the declaration, so the declaration was
unrecoverable from the row. That is the gap round 5 closed.

### What was added, and what it does not reach

`uses` edges whose target is ambiguous in their file now carry `targetLine`,
`targetKind` and `targetResolution`. The rule is a lexical-scope chain walked
**outward**: in the first scope holding a declaration of the name at or before the
use site, the nearest such line is the answer, and the walk stops. `innermostScope`
and `outerScope` are published separately because the difference between them is
the bug.

**The rule was wrong first and the fixture caught it**, which is the part worth
recording. The first version had no scope chain at all — it took every declaration
of the name in the file and took the nearest preceding one. So `echo "$SHARED"` on
line 45 inside `read_early`, whose own assignment to `SHARED` is on line 46,
resolved to line 37: a declaration inside `read_other`, a function with nothing to
do with that read. bash has no mechanism by which one function's assignment
shadows another's, and the edge asserted one. That is not a hypothetical — it is
what the code did before the fixture existed.

**Edge counts did not move.** `calls` 5,099, `uses` 7,802, `contains` 3,782,
`imports` 44, `references` 44, `exports` 210, `overrides` 28 — identical before and
after, on the same 400 files. That is the property that separates disambiguating
from fabricating: this attributes an existing claim, it does not add one.

**Coverage, stated as what it is rather than as what it could be:**

| of the 1,185 ambiguous `uses` edges | count |
| --- | --- |
| now carry `targetLine` (`innermostScope` 674, `outerScope` 99) | **773 = 65.2%** |
| decline explicitly (`targetResolution: "ambiguousInFile"`, no line) | 17 = 1.4% |
| carry nothing | **395 = 33.3%** |

> **RETRACTED IN ROUND 11.** These three rows are round 5's, re-stated here without a
> re-run: `git log -S'65.2%'` puts the figure in `e7774ed40`, and round 6 had already
> closed the mechanism this table blames by re-asking `resolveDeclaration` against the
> finished index after the walk. Measured on the same 400 files: **1,183 of 1,187 = 99.7%**
> carry a `targetResolution` and **4 = 0.3%** carry nothing, of which 3 were closed in
> round 11 (`readCannotBeAFunction`) and 1 is the `declaredAfterUse` case. The mechanism
> named below is real and was real in round 5; the number was simply never re-taken, and
> a count copied forward a round without a re-run is not a measurement.

The 395 are the **walk's own order**, not a failure of the rule. `declSites` is
filled as the walk proceeds, so a use emitted above a later declaration of the same
name cannot see it, and at emit time the name has one declaration and is therefore
not yet ambiguous. The offline probe, which sees the *final* symbol set, resolves
97.4% of ambiguous edges — the gap between 65.2% and 97.4% is exactly this
ordering effect. Closing it needs a declaration pre-pass in the shape of the
existing `collectFunctionNames`, and that has a blast radius wider than this
change: `isAssignedInFile` and `isDeclaredGlobal` read the same order-dependent
index, so making declarations known earlier changes those two flags and can move
the lane against its own oracle. Reported as the size of the gap rather than
attempted blind.

**Metadata is added to 15.2% of `uses` edges, not to all of them, and the absence is
asserted rather than hoped for.** `bash/ambiguity-published-on-every-edge` drops the
`cands.length < 2` guard, changes no value at all, and is caught only by two
`forbid` rows on a name declared exactly once. That mutant exists because the task's
payload budget is a real constraint: 80,851 `uses` edges on the whole corpus would
each grow up to three keys to state what the edge's target already states, and the
key's *presence* has to remain the signal that the target was ambiguous.

**One mutant survived the first version of this work, and the reason is structural.**
`bash/ambiguity-publishes-a-line-when-it-cannot-pick` takes the nearest candidate in
the branch that is supposed to decline. With the correct rule in place, **no edge in
the fixture reached that branch at all**, so the fabricator passed through it — the
same "instrument cannot see the class it was built for" failure the lane's mutant
file exists to prevent. The fixture could not manufacture the branch's real input,
because two declarations in one scope are impossible (a second assignment is a
reassignment, not a declaration), so an `alpha`/`beta`/`gamma` block was added whose
read is declared by neither its own scope nor the file. That block is in the
fixture's own source with the limitation written next to it.

**`calls` was left alone, with the reason measured.** 6 ambiguous edges out of 961
resolved targets is 0.6%, and the same mechanism would apply; it was not applied
because a second untested edge type is a new claim rather than a closed gap, and
the 6 are counted here instead.

## Round 6: the attribution was a function of where the read sat in the file

Round 5 published `targetLine` on a `uses` edge so a consumer could tell WHICH
declaration an edge naming a common variable meant. Round 6 found that the answer
was only being computed for some of the edges it was supposed to cover, and that
which ones was decided by the traversal rather than by the file.

### What the defect was

`resolveDeclaration` asks one question: *is this name declared more than once in
this file?* It was being asked **from inside the walk that emits the edges**.
`declSites` — the index that question reads — is filled by `noteDeclaration`
during that same traversal, so an edge was compared only against the declarations
the walk had **already passed**:

- `emitVariableUses` reads `declSites` (`src/ast/real-bash-analyzer.ts:524`)
- `noteDeclaration` fills it, at `:528`, `:531`, `:534`

A read near the end of a file is therefore judged against a nearly-built index
and gets an attribution. A read on the first lines of the same name is judged
against an almost empty one, is reported as unambiguous, and is published bare.
The published answer depended on **where in the file the read sat** instead of on
what the file declares.

Measured over all 4,130 admitted files through production `parseFile`:

| | before | after |
| --- | --- | --- |
| `uses` edges naming a target with **2+ declarations in their own file** and publishing **no** `targetResolution` | **4,220** (400 files) | **37** (14 files) |
| `uses` edges carrying an attribution | 7,780 | **11,967** |
| `uses` edges whose target is genuinely unique in the file, correctly silent | 68,843 | 68,791 |

### Why 39 mutants, 22 fixtures and a differential all missed it

Every one of this lane's mutants removes, inverts or over-reaches a **rule**. This
defect was a rule that was **never asked the question**, so no mutation of the
rule's own body reaches it — deleting the `cands.length < 2` guard, reversing the
walk and publishing a line when it cannot pick all leave a first pass that
behaves identically on the inputs they exercise.

It is also an **omission and not a fabrication**: nothing incorrect was asserted,
so it cannot surface as an unexplained edge, and a differential cannot see it
because the oracle never published target metadata in the first place. That is
the general shape worth naming: *a missing measurement is invisible to a tool
that measures presence.*

### The fix

A post-walk pass re-asks the question against the finished index, calling the
**same** `resolveDeclaration` so there is one rule and not two, and only for edges
that published nothing — so a name that really is unique in its file still gains
no keys. `validation/m14/fixtures/bash/order-independent-attribution.sh` asserts
**both** directions, because a fix that published `ambiguousInFile` everywhere
would pass the declined row and fail the resolved one:

| row | read at | declarations | asserted |
| --- | --- | --- | --- |
| declined | line 32 | 35, 36 — both **after** the read | `targetResolution: ambiguousInFile`, **no line** |
| resolved | line 45 | 44 in its own scope, 48 in another | `targetLine: 44`, `targetResolution: innermostScope` |
| absence | line 57 | one only | **no** target metadata at all |

The fixture **FAILS against the pre-fix analyzer** (22 pass / 1 fail) and passes
after it, so it pins the defect and not the fix. Three mutants were added with it
(`order-dependent-attribution-second-pass-removed`,
`…-blanket-refusal`, `…-drops-the-line`); the lane file is **19/19 caught**.

### The residual 37 are not this defect

They are `uses` edges whose target name is also the name of a **function** in the
same file — e.g. `consul/build-support/functions/10-util.sh` has function
`ui_version` at line 597 and variable `ui_version` at line 612. **bash keeps
functions and variables in separate namespaces**, so a `$name` read cannot denote
the function, and `declSites` — which records variable declarations — is the
correct universe for a variable read. The count of 37 comes from a probe that
counts published symbols of *any* kind by name and therefore conflates the two
namespaces. This is stated here rather than "fixed", because the fix would be to
attribute a variable read to a function.

### The instrument that hid it, and what it was hiding

`census-bash-ontology.ts` printed the ambiguity table's line column from
`s.line_number ?? s.range?.start?.line`. **`parseFile` publishes neither** — it
reshapes every symbol to `startLine`/`endLine` — so every candidate printed as
line `0`:

```
- 43 symbols named HOSTPORT at lines 0,0,0,0 kinds variable
+ 43 symbols named HOSTPORT at lines 57,93,105,125 (first 4 of 43) kinds variable
```

The same mistake was already found and fixed once, in
`probe-bash-ambiguity.mts`, whose header documents it (lines 22-23); the census
kept it. Two consequences. First, the census's ambiguity table **could not
support** the separability claim built on it — it printed zeros where lines
should be, so a reader had no way to check. Second, the broken column was not
cosmetic: with the field corrected, the same corpus exposed the 4,220. A probe
that reports a constant in a column that is supposed to vary is not a probe.

### Payload, measured on one unchanged 400-file sample

| | before | after | delta |
| --- | --- | --- | --- |
| attributed `uses` edges | 790 (10.1%) | 1,181 (15.1%) | +391 |
| `uses` metadata bytes | 853,836 | 881,042 | **+27,206 (+3.2%)** |
| bytes per `uses` edge | 109.44 | 112.93 | +3.49 |
| **edges / nodes added** | — | — | **0 / 0** |

**No graph-size regression**: the fix adds metadata to edges that already existed
and creates no edge and no symbol, so `bb_graph`'s node and link counts are
untouched and the payload/latency budget is unaffected. The whole cost is 3.49
bytes on 15.1% of `uses` edges. The A/B was taken by writing the parent commit's
analyzer over the file and restoring — and the first attempt at it was invalid,
because `git stash push` on an already-committed tree is a no-op and the "before"
run silently measured the fixed analyzer; see limitation 16.

## Round 7: the flag that was missing, and the edges no name resolution can reach

Round 6 ended on metadata. Round 7 asks the two questions that metadata made
askable, both over **every admitted file** rather than the 400-file sample, because
both classes turned out to be small and a sample reports a rate for a class of size ten.

### The labelling defect: 223 `calls` edges with no classification at all

Six questions Q4 asks whether an edge carries the type it claims. For `calls` the
type is carried in two booleans, and the previous check compared the analyzer's own
`isFunctionCall` count against the sample's resolution rate — both read off the SAME
side of the comparison, so a flag that was simply **absent** was invisible to it.

Putting the claim on one axis and the measurement on the other
(`probe-bash-unresolved-targets.mts` section B2, 55,218 `calls` edges over 4,130
admitted files):

| claim ↓ / measured reachability → | resolves in own file | declared by a literal sourced file | external | no flag |
| --- | --- | --- | --- | --- |
| `isFunctionCall` | **13,934 (100%)** | 0 | 0 | 0 |
| `isExternalCommand` | 1 | **256** | **40,808** | 0 |
| **no flag** | **123** | 0 | **100** | **223** |

The two diagonal cells are the check that the flags are not decorative: every edge
claiming to be local resolves locally, and no edge claiming to be external resolves
locally except one. **223 edges asserted a call and said nothing about it**, and 123
of those name a function their own file declares — `ansible/test/integration/targets/
ansible-test-git/collection-tests/git-common.bash:27` calling `uninstall_git`,
`ansible-test-sanity-import/runme.sh:33` calling `cleanup`.

**Cause: there are two `calls` emission sites and only one of them classified.**
`real-bash-analyzer.ts:1889` (the main command site) sets `isFunctionCall`,
`isExternalCommand` and `resolvedWithinFile` on all 54,995 corpus edges.
`real-bash-analyzer.ts:2030` (the trap handler) set `isTrapHandler`, `viaTrap`,
`signals` and `bashSpecific` — and no classification, because the handler's command
name comes from splitting a string rather than from a `command` node, and the
classification was written at the site that had a `command` node.

**The fix applies the same rule from the same pre-pass.** Whether a callee leaves the
file is a property of the callee's NAME, not of how the name was extracted, so the
fact is exactly as sound at the second site; `handleTrap`'s `ctx` type gained
`localFunctions` and the three keys are set from it.

A/B on the 400-file hash-order sample, same sample both sides
(`census-bash-ontology.ts`):

| | before | after |
| --- | --- | --- |
| `isFunctionCall=true` | 899, resolving 899 (100%) | **907, resolving 907 (100%)** |
| `isExternalCommand=true` | 4,200, 62 coinciding (1.5%) | **4,192, 54 coinciding (1.3%)** |
| `calls` / all seven types / total | 5,099 / — / 17,009 | **5,099 / unchanged / 17,009** |
| edges added / symbols added | — | **0 / 0** |

The 100% resolution property of `isFunctionCall` is the number that matters: the fix
moved 8 edges between two classes without moving either, and `bb_graph`'s node and
link counts are untouched.

`validation/m14/fixtures/bash/trap-handler-call-classification.sh` asserts both
directions — `cleanup`/`sync_now` local, `rm` external — because a fix that hard-coded
either value satisfies one half. **It FAILS against the pre-fix analyzer (23 pass /
1 fail) and passes after**, so it pins the defect rather than the fix. Three mutants
with it (`…-inverted`, `…-hardcoded-local`, `…-removed`); the lane file is **22
mutants, 22 caught, 0 survived**.

**Re-measured over the whole corpus after the fix, the NO FLAG column is empty** —
the table above was the measurement that found the defect and it is reproduced with the
defect closed:

| claim ↓ / measured reachability → | resolves in own file | declared by a literal sourced file | external | no flag |
| --- | --- | --- | --- | --- |
| `isFunctionCall` | **14,011 (100%)** | 0 | 0 | **0** |
| `isExternalCommand` | 1 | 256 | 40,878 | **0** |
| **no flag** | **0** | 0 | **0** | **0** |

The two runs are not the same file set — 55,218 `calls` edges before, 55,146 after,
because the pinned wasm reaches a different set of files each run (the same wobble the
gate column above records) — so the honest statement is the one the table supports:
**the two NO FLAG cells that held 123 and 100 edges are empty, and `isFunctionCall`
still resolves at 100% of its edges.** Section A of the same probe reproduced its seven
shapes to the edge on both runs (455 / 133 / 36 / 29 / 25 / 1 / 0 of 679), which is the
evidence that the two runs are comparable where the numbers are small.

**The one remaining diagonal disagreement is not a defect, and saying so is the
point.** `ohmyzsh/plugins/mvn/mvn.plugin.zsh:30` calls `mvn`, the analyzer says
external, and the file publishes a symbol named `mvn` — `alias mvn="mvn-or-mvnw"` at
line **44**. The analyzer is right: a shell alias does not expand retroactively, so at
line 30 `mvn` is still the external binary, and the analyzer reaches that answer
without a rule about aliases at all — `collectFunctionNames` is a pre-pass over
`function_definition` nodes, so aliases are added during the walk, and line 30 is
visited before line 44. Right answer, incidental reason. It is recorded because the
reason is not a rule, and an alias declared *above* its use is classified by a
different mechanism than one declared below it.

### The residue: `imports`/`references` at 0% is now a shape table, not a rate

679 `imports` edges (679 identical `references` keys), whole corpus, every admitted
file. The earlier probe answered "does not resolve: 679 of 679". This one asks **what
the target is**, which is the question a rate hides:

| target shape | edges | share |
| --- | --- | --- |
| `unexpanded` — the script computes the path (`${KUBE_ROOT}/hack/lib/init.sh`) | **455** | 67.0% |
| `resolves to an ADMITTED file** | **133** | 19.6% |
| `does-not-resolve` (`source virtualenv.sh`, no such file here) | 36 | 5.3% |
| **resolves to a file the ROUTER declined** | **29** | 4.3% |
| resolves outside every corpus repo (`/etc/os-release`) | 25 | 3.7% |
| `~`-prefixed | 1 | 0.1% |
| absolute-external | 0 | 0.0% |

Of the 133 that name a real admitted file, **133 resolve by name** (the target's
basename is that file's module symbol) — so those edges are walkable today.

**The 29 are a routing finding, and it is small.** They point at **9 distinct files**
that exist inside a corpus repository, are tracked, and were not admitted. Running the
**production parser** over each — not reading it and deciding — gives:

| | count |
| --- | --- |
| distinct files a `source` edge names that the router declined | **9** |
| …of which the pinned bash grammar publishes ≥1 symbol | **1** |
| `source` edges pointing at them | 29 |

The one is `hasura-engine/scripts/containers/citus`, 1,717 bytes, 3 symbols, and its
first line is `### This file is not meant to be run directly, but to be sourced from`.
It has no shebang, so `detectLanguageFromPath` declines it — and the file says in its
own first line what it is. **Reported, not edited** (§8): `src/ast/language-detection.ts`
is shared machinery. The change is one clause: an extensionless file with no shebang
that is the target of a `source`/`.` edge from an admitted bash file is admitted on
that evidence. The honest size of the prize is 1 file in this corpus, and it is worth
saying so rather than quoting the 29 edges as 29 missing files.

### What no name resolution can reach: 256 walkable cross-file `calls`

`calls` resolves at both ends 18.8% and 74.1% of its corpus edges name a command that
is genuinely outside the indexed corpus. In between there is a class that is neither:

| reachability of a `calls` target | edges | share |
| --- | --- | --- |
| resolves to a `function` in its own file | 14,058 | 25.5% |
| **declared by a file this script `source`s by a LITERAL path** | **256** | 0.5% |
| external | 40,904 | 74.1% |
| files with ≥1 literal `source` that resolved to a file | **161 of 4,130** | 3.9% |

`consul/test/integration/connect/envoy/run-tests.sh:400` calls `is_set`, which is
declared in `consul/helpers.bash` — a file `run-tests.sh` sources by a literal path.
bash's dependency model *is* `source`: the sourced file's functions are defined in the
sourcing shell, so this call names a real declaration the corpus holds, and the edge is
walkable today with a cross-file index and not before. All 256 are currently published
with `isExternalCommand: true`, which is **wrong** for them — 0.5% of `calls` edges
mislabel a cross-file function as an external binary.

**This cannot be fixed inside the analyzer and the reason is structural**: `analyze()`
is a per-file unit that never sees another file, and `parseFile` is per-file too. A
cross-file resolution layer is laptop C's work and duplicating it here would be the
wrong fix. What the lane owes that layer is the SIZE and the SHAPE of the class, which
is the table above. The 161-file denominator is stated so the 256 is never read as a
rate over the corpus: it is 1.6% of the files that have a resolvable literal `source`
at all.

### The ruling table, and a citation that did not resolve

`script/m14/bash-ruled.ts` did not exist, and the arbiter printed
`Written ruling: script/m14/bash-ruled.ts (RULED_BY_LANG.bash)` on all three RULED
rows. A citation to a path that is not on disk is not a weak claim; it is a false one,
and it was the gate's own output.

The table now exists with the **three** live entries. The gate's inline literal had a
fourth — `overrides`, instrument B, with a `countOnTree` probe — and it is **dead**:
the row loop `continue`s the moment a type is observed emitting, and `overrides` is
EMITTED at 138 corpus edges, so that entry is consulted zero times while reading as
evidence that `overrides` is inapplicable.

`validation/m14/fixtures/bash/ruled-gate.ts` proves the table instead of asserting it:
it copies the gate to `/tmp`, applies the three lines the supervisor's permanent fix
needs, and runs the copy —

```
extends       RULED-SOUND  NOT EMITTED; 164 distinct node types, NONE expresses it
implements    RULED-SOUND  NOT EMITTED; 164 distinct node types, NONE expresses it
instantiates  RULED-SOUND  NOT EMITTED; 164 distinct node types, NONE expresses it
overrides     EMITTED      138 edges in 4+ files
emitted 7/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 0
```

— and it was **falsified on purpose before being trusted**. Adding `function_definition`
to the `extends` entry, a node type the grammar does produce, turns the row
`FALSIFIED`, the summary to `ruled-sound 2  FALSIFIED 1`, and the runner exits 1
printing `>>> THIS GATE FAILS. extends is claimed inapplicable but is demonstrably
derivable from real code.`

Two properties of the instruments the runner has to handle rather than trip over:

- **164 is a per-run population, not a constant.** The wasm aborts with `memory access
  out of bounds` on whichever files it reaches and that differs between runs, so the
  `extends` detail string's node-type count moves. Byte-equality between two gate runs
  is not a property this gate has, so the runner asserts statuses and counts instead.
- **`[BB-HANG]` exits 1 from `engine.ts:1442`** on a parser bomb, so the exit code is 1
  even on a passing summary. Asserting the exit code alone would report a hung run as a
  failed ruling table; the runner reads the summary and names the hang.

**A ruling is only as strong as the population it was measured over, and this lane's
own sample would have been too small.** `probe-bash-grammar-inventory.mts` reports **144**
distinct node types on the 400-file hash-order sample. The gate's whole-corpus count is
**164**. So a ruling proved on this lane's usual sample is proved against 144 of the
grammar's node types and the other 3,730 files hold 20 more — which is why instrument A
is run over every admitted file, and why the RULED verdicts in the table at the top of
this file quote the whole-corpus number.

### One correction to this lane's own instrument

`isExported` read `published in 15 files, survives in 13 (86.7%)` for several rounds,
and the obvious reading — the worker drops the flag — was wrong. `census-bash-ontology.ts`
collected metadata key NAMES, and `readonly x=1` publishes `isExported: false`, a
correct negative (`real-bash-analyzer.ts:1552` sets `isExported: isExport`). The worker
forwards `if (m.isExported === true)`, so the key is absent downstream by design;
counting presence counted a negative as a publication and then reported the worker's
correct refusal as a loss.

The census now reports presence and truth as two columns, and the corrected numbers are
in [§Q6](#q6--what-a-published-fact-costs-to-reach-the-store). The general shape is
worth naming because it is not bash-specific: **for a boolean flag whose consumer tests
`=== true`, "the key is present" and "the fact is present" are different questions, and
only the second is the one a consumer can act on.** `isArray` is the deliberate counter-case
in the same table — its negative IS forwarded, because a consumer must be able to tell
an array from a scalar.

## Round 8: the arithmetic command whose operands were invisible, and what the arbiters say

Limitation 7 was the lane's largest known GAP and it is closed. Round 8 also re-ran
the two arbiters the task names, at three sample sizes, because they disagree with
each other and the disagreement is arithmetic rather than a defect.

### The gap, stated as the dispatch it was

`emitVariableUses` is reached from five node types: `simple_expansion`,
`expansion`, `arithmetic_expansion` (`$(( … ))`), `postfix_expression` (`((i++))`)
and `c_style_for_statement` (`for (( … ))`). The pinned grammar holds a **bare**
`(( … ))` in a `compound_statement` wrapping a `binary_expression` /
`unary_expression` / bare `variable_name`, and `compound_statement` was not in the
list. So:

| written | arrives as | operand node | read published? |
| --- | --- | --- | --- |
| `$(( count + 1 ))` | `arithmetic_expansion` → `binary_expression` | `variable_name` | yes |
| `for (( i = 0; i < n; i++ ))` | `c_style_for_statement` | `variable_name` | yes |
| `(( count++ ))` | `compound_statement` → **`postfix_expression`** | `variable_name` | yes — by accident |
| `(( count < limit ))` | `compound_statement` → `binary_expression` | `variable_name` | **no** |
| `(( --count ))` | `compound_statement` → `unary_expression` | `variable_name` | **no** |
| `(( arr[0] = count ))` | `compound_statement` → `binary_expression` | `subscript`, `variable_name` | **no** |
| `(( ${count} + limit ))` | `compound_statement` → `expansion`, `binary_expression` | `variable_name` ×2 | `count` only |

`(( count++ ))` published a read **because its operand happened to be a
`postfix_expression`** — one of the five dispatched types — while `(( count < limit ))`
on the line above published nothing. The asymmetry was a grammar-shape accident, not
a fact about bash, which is the whole of what limitation 7 claimed and it is now
measured rather than asserted.

### The delta was derived BEFORE the analyzer was touched

`probe-bash-arithmetic-operands.mts` (new) walks the parse tree, collects every
arithmetic `compound_statement`'s operand names with the same rule the analyzer uses,
and differences them against the edges production `parseFile` already published. It
is an independent prediction rather than an after-the-fact census read, so the
after-run can be **checked** instead of believed. 400-file hash-order sample of
**4,133** admitted files in 55 repositories:

| | count |
| --- | --- |
| files with at least one arithmetic `compound_statement` | **32** |
| arithmetic `compound_statements` | **89** |
| operand name nodes under them | **126** |
| distinct `(target, line)` pairs | **115** |
| …already published through the five dispatched types | **45** |
| …**predicted new `uses` edges** | **70** (54 of them, 77%, naming a variable the same file declares) |
| `compound_statements` the predicate **excludes** | **792**, of which **0** open `((` |

Then the A/B, parent commit's analyzer written over the file and restored
(`git show HEAD:src/ast/real-bash-analyzer.ts`, never `git stash` — see limitation
17), same corpus, same hash order, same 400 files:

| | before | after | delta |
| --- | --- | --- | --- |
| `uses` | **7,786** | **7,856** | **+70** |
| total relationships | **16,984** | **17,054** | **+70** |
| `uses` resolving at both ends | 6,225 (80.0%) | 6,279 (79.9%) | **+54** |
| `calls` / `contains` / `imports` / `references` / `exports` / `overrides` | 5,097 / 3,775 / 44 / 44 / 210 / 28 | identical | **0** |
| symbols | 4,179 | 4,179 | **0** |

**The prediction was wrong first, and the census was right.** The probe's first run
said 72 against a measured 70. The probe deduplicated operands per *statement*, while
`addRel`'s key is `${source} ${type} ${target} ${line}` and carries no statement
identity — so `(( i++ )); (( i-- ))` on one line was counted twice. It now dedupes
per file and predicts 70. Recorded because the alternative reading — "the census is
noisy, the probe is exact" — was available and wrong: the census reproduced 7,856 on
two consecutive runs, and the two-edge gap had a cause that named itself.

**Payload.** 70 edges on 7,856 `uses` is +0.89% of the type and +0.41% of the file's
17,054 relationships; **0 symbols added**, so `bb_graph`'s node count is untouched and
only link count moves. The new edges carry the same four metadata keys every other
`uses` edge carries (`evidenceClass: usage_contextual`, `isVariableReference`,
`bashSpecific`, and `isAssignedInFile` on the 77% whose target this file assigns), so
the per-edge cost is the same as the class's existing cost rather than a new shape.
Whole-repository cross-check on the one repository dense in the construct —
bash-completion's 566 admitted files: `uses` **5,123 → 5,344 (+221)**, every other
type and the 5,821 symbols unchanged.

### What the fixture pins, and what it fails against

`validation/m14/fixtures/bash/arithmetic-command-operands.sh` pins all five operand
shapes (binary, postfix, unary, subscript, `${…}`), the two-line `then`-block case, and
two properties a fix could get wrong the other way:

- `(( count++ )); (( count++ ))` on **one** line is **one** edge — the property the
  lane's own probe violated.
- the `then` block is a `compound_statement` that is **not** arithmetic, and it must
  contribute nothing: `uses -> count` appears on lines 45, 46, 47, 48, 49, 52, 54 and
  55 and nowhere else. Without the arithmetic test the block would publish its own
  `echo "$count"` read a second time under a different node type, and the count row of
  8 is what would catch it.
- `forbid`: no `calls` edge naming any operand (`((count++))` is not a command — the
  round-2 fabrication), and no `uses` edge naming `arr[0]`.

**It FAILS against the pre-fix analyzer (23 pass / 2 fail) and passes after**, so it
pins the gap rather than the fix. The second failure is
`arithmetic-reads-gap-closure`, whose expectation had pinned the gap **as if it were
closed**: it asserted `uses -> count` exactly twice when line 8's
`while (( count < limit ))` published neither name. That expectation is corrected, with
the reason in its `authoredFrom` — a fixture written to close a gap is itself evidence
about when the gap closed.

Three mutants, and the lane file is **25 mutants, 25 caught, 0 survived**:
`…-branch-removed` (the exact defect, costs all 70 corpus edges),
`…-predicate-inverted` (blocks read as arithmetic **and** real arithmetic unread — the
pair is why the fixture pins both directions), and `…-line-off-by-one`, which is the
one a census cannot see: the edge exists, names the right variable, and sits at a line
where no `(( … ))` was written.

**One condition has no mutant, and the reason is measured.** The predicate is
`opensWithDoubleParen(text) && endsWithDoubleParen(text)`. Its closing half guards a
shape this grammar does not produce: **0 of the 792** `compound_statements` the
predicate excludes open `((` at all, and a malformed `(( a < 2` arrives as an `ERROR`
node, not a `compound_statement` (verified on the tree). So a mutant dropping
`endsWithDoubleParen` would survive, and this file's rule is that a survivor is a
failure. The condition is kept — `( (date) )` is a subshell and `((x))` is arithmetic,
and `isArithmeticOperandCommand` asks the same question of a `subshell` — and declared
here and at the call site rather than covered by a mutant that cannot fail.

### Is the new class audited? — 97 of 121, and that is the honest number

`deriveBashEdges` is exported from `script/m14/differential.ts:24815`, so the oracle
can be asked the narrow question without editing shared machinery and without the
rotation problem (its cold-pool counter advances per run, so `differential.ts --lang
bash` twice is not two comparable runs — round 5 established that, and pinning the
rotation means mutating state this lane does not own).
`probe-bash-arithmetic-oracle.mts` compares, per file, the analyzer's `uses` edges on
arithmetic operand lines against the oracle's rows for the same tree:

| | 400-file hash-order sample |
| --- | --- |
| files contributing arithmetic operand lines | 32 |
| arithmetic operand lines located | 83 |
| analyzer `uses` edges on those lines | **121** |
| …the oracle publishes the same `(source, uses, target)` row | **97 (80.2%)** |
| …the oracle does **not** publish it | **24 (19.8%)** |

So the new class is audited for four edges in five and unaudited for one in five, and
the unaudited rows are named in the probe's output (`uses -> commands`,
`-> cword`, `-> COMP_CWORD`, `-> probe_named`). **The oracle's `uses` derivation does
not walk bare arithmetic operands either**, so for those edges agreement with the
differential is unavailable as evidence. What stands in its place is a parse fact — the
operand is a `variable_name` node under a `(( … ))` `compound_statement` — and bash's
semantics, which make `((count < limit))` a read of both. That is a weaker form of
evidence than a second walker and it is stated as such rather than folded into the
coverage percentage.

### The two arbiters, at three sample sizes, and why they disagree

`script/m14/firing-check.ts` (production `parseFile`) on this lane:

| `--files` | files parsed | **fired** | relationships | the 7th type |
| --- | --- | --- | --- | --- |
| 120 | 106/120 | **6/10** | 4,286 | absent |
| 400 | 356/400 | **6/10** | 14,782 | absent |
| 2,400 | 2,382/2,400 | **7/10** | 104,105 | `overrides` |
| 5,000 (all 3,705 admitted) | 3,311 | **7/10** | 145,425 | `overrides` |

**A reader who runs the arbiter at its documented `--files 120` sees 6/10 and should
know why.** `overrides` needs a function redefinition, and the census measures those
at **28 edges in 4 files of 4,133** — 0.097% of admitted files. A 400-file draw
therefore expects **0.39** such files, and reading zero is the *expected* outcome, not
a defect. The same file set measured the other way settles it without arithmetic:
`incoming-check.ts` over 6 corpus files reports `overrides` **fired, 24 edges, 3
distinct declarations, 0 unresolved**.

`script/m14/incoming-check.ts` on those 6 files (588 symbols, 0 degraded parses,
0 parse failures) — the incoming side, which no outgoing count can speak to:

| type | fired | edges | distinct declarations named | **ambiguous** | unresolved |
| --- | --- | --- | --- | --- | --- |
| `calls` | yes | 446 | 66 | **0** | 310 |
| `uses` | yes | 1,010 | 197 | **0** | 103 |
| `contains` | yes | 582 | 356 | **0** | 0 |
| `imports` | yes | 4 | 0 | 0 | 4 |
| `references` | yes | 4 | 0 | 0 | 4 |
| `exports` | yes | 10 | 9 | **0** | 0 |
| `overrides` | yes | 24 | 3 | **0** | 0 |

**0 ambiguous targets on every type**, and 6 orphan declarations of 588 (1.0%). The
zero is a **six-file** measurement and is not a lane-wide claim: the census's
ambiguity table reads 1,187 ambiguous `uses` targets over its 400 files, because a
`local` in two functions is two declarations of one name and this file set does not
contain that shape twice. What the six files do establish is that where a target names
exactly one published symbol, the reverse walk is not choosing — which is the
ambiguity half of the incoming problem, and the resolvable half of it is `overrides`
at 3 distinct targets and 0 unresolved.

### Whole-corpus attempt, and what it measured instead — RETRACTED IN ROUND 9

**Every row of this table is wrong and the section is kept only so the correction is
traceable.** It reported:

| whole corpus, one process, direct `parser.parse()` | count |
| --- | --- |
| admitted files | 4,133 |
| **files the pinned wasm could not parse** | **3,634 (87.9%)** |
| files actually walked | **499** |

Round 9 established that the probe was borrowing `ASTEngine.getParser("bash")` — the
engine's shared parser handle — and interleaving two users of it, so it read exactly
**499 files regardless of corpus size** (at `--sample 900` it reported 401 unparsed;
900 − 401 = 499, and 4,133 − 3,634 = 499). The corpus and the pinned wasm were never
the problem. Re-run whole-corpus with a private parser:

| whole corpus, one process, private parser | count |
| --- | --- |
| admitted files | 4,133 |
| **files that could not be parsed** | **0** |
| files with an arithmetic `compound_statement` | **351** (this table said 41) |
| arithmetic `compound_statements` / operand name nodes / distinct pairs | **834 / 1,139** / — (this table said 104 / 150 / 137) |
| …already published (post-change) | **995 — 0 predicted new** (this table said 137, same 0) |
| `compound_statements` the predicate excludes, of which open `((` | **7,495**, of which **5** (this table said 948, of which 0) |

The "87.9% is a finding, not a footnote" conclusion was wrong in the way this file's
§27 describes: the absolute count did not move when the corpus changed, and a
quantity that does not move is not measuring the corpus. See
[Round 9](#round-9-the-whole-corpus-measurement-round-8-said-cannot-be-taken).

### Coverage, restated as applicable

Unchanged in **kind**, and the arithmetic fix moves no verdict: **7/7 applicable,
3 measured-absent (`extends`, `implements`, `instantiates`, each with instrument A
over all 164 node types plus instrument B), 0 unaccounted.** What round 8 changes is
the size of `uses` and the size of the sample the numbers come from — the corpus grew
from 4,130 to **4,133** admitted files, so round 7's census column and this one are
different 400-file draws and their difference is not evidence about the analyzer. The
evidence about the change is the A/B pair above, which shares one sample.

## Round 9: the whole-corpus measurement round 8 said cannot be taken

Round 8 closed this lane's largest known GAP and then, in the same commit, published
a limitation that was **false**, built on a measurement that was not the one it
claimed to be. Both halves are corrected here, and the correction is the round's
substance: **every per-type number in this file now has a 100% denominator instead
of a 400-file sample.**

### What round 8 claimed

> "the pinned wasm aborts with `memory access out of bounds` on whichever files it
> reaches" … "**files the pinned wasm could not parse: 3,634 (87.9%)** … files
> actually walked **499**" … "**a whole-corpus bash measurement cannot be taken in
> one process, and the production path reports that as success**" (limitation 25).

The claim had a consequence the lane would have carried for a long time: it made a
400-file sample the best available denominator forever, and it attributed the
shortfall to the grammar rather than to the lane's own instrument.

### The number that falsifies it is a CONSTANT, and a constant is not a corpus

`probe-bash-arithmetic-operands.mts` obtained its parser from
`ASTEngine.getParser("bash")` — the **engine's shared handle** — and then
interleaved two users of that one handle: production `parseFile` parsing and
deleting its own trees through it, while the probe parsed directly and kept its
trees. Run at two corpus sizes:

| `--sample` | admitted walked | "could not parse" | actually parsed |
| --- | --- | --- | --- |
| 900 | 900 | 401 | **499** |
| 4,400 | 4,133 | 3,634 | **499** |

`900 − 401` and `4,133 − 3,634` are both **499**. Round 8 read that constant as a
corpus property. It is a fixed capacity in the probe: whatever the corpus size, it
reads 499 files and stops, and every file after the 499th is counted as a file the
grammar could not read.

The fix is one line — a private parser, built the way
`probe-bash-grammar-inventory.mts` already builds one — and the probe now reports
**0 unparsed over every admitted file**, in 2m58s.

### Three instruments, and they agree the corpus is readable

| instrument | admitted | read with the grammar | failed |
| --- | --- | --- | --- |
| production `parseFile`, one process (`census --all`) | 4,133 | **4,131** | **2** answered by `extractFallback` |
| instrument A, private parser + `delete()` (`probe-bash-grammar-inventory.mts`) | 4,133 | **4,133** | **0** |
| private parser, no `delete()` at all, 2,500 files (`probe-bash-wasm-tree-lifetime.mts`) | 2,500 | **2,500** | **0**, rss flat at 239 MB |

**The 2 fallback files contributed 0 relationships**, so no per-type total in this
document is contaminated by a file the grammar could not read. The census now
prints `grammar-read` and `FALLBACK` on every run for exactly this reason: `parse
fail: 0` was previously the only line, and it counted files `parseFile` *rejected*
while saying nothing about files it *answered without the grammar*.

### The hypothesis I proposed first was wrong, and it is recorded because it was wrong

The obvious mechanism for "a tree per file with no `delete()`" is a growing wasm
heap, and the file did omit `delete()` on every iteration. I fixed it and predicted
that this was the cause. **It is not.** A private parser that never calls
`delete()` reads **2,500 of 2,500** files with zero throws and an rss that rises to
~240 MB and then plateaus, so the trees are being collected without an explicit
`delete()` and heap exhaustion does not occur at this scale. The `delete()` omission
was a real defect and is fixed; the cause is the shared handle. Recorded because
the leak story was plausible, fit the "breaks down after roughly 500 files"
observation, and was wrong — and the reason it fit is the same reason round 8's
error was plausible: a constant in the instrument looked like a threshold in the
corpus.

### What the whole corpus says, per type

`npx tsx validation/m14/fixtures/bash/census-bash-ontology.ts --all`, 4m20s:

| type | edges | resolve at both ends | src-only | neither | ambiguous targets | `<0.7` conf |
| --- | --- | --- | --- | --- | --- | --- |
| `calls` | 55,231 | 14,759 **26.7%** | 73.3% | **0** | 236 of 14,759 (1.6%) | 0 |
| `uses` | 81,529 | 64,532 **79.2%** | 20.8% | **0** | 12,136 of 64,532 (18.8%) | 0 |
| `contains` | 38,278 | 38,277 **100.0%** | 0.0% (1) | **0** | 6,159 of 38,277 (16.1%) | 0 |
| `imports` | 679 | **0.0%** | 100% | **0** | — | 0 |
| `references` | 679 | **0.0%** | 100% | **0** | — | 0 |
| `exports` | 1,929 | 1,927 **99.9%** | 0.1% | **0** | 96 of 1,927 (5.0%) | 0 |
| `overrides` | 138 | 138 **100.0%** | 0 | **0** | 138 of 138 (100%) | 0 |
| `extends` / `implements` / `instantiates` | 0 | n/a | n/a | n/a | — | n/a |
| **total** | **178,463** | | | | | **0** |

42,418 symbols. Hygiene at corpus scale: **0** empty names, **0** empty/unknown
kinds, **0** `unknown` endpoints, **0** empty endpoints, **0** edges below 0.7
confidence in any type, and **0** relationships from a fallback file.
`SymbolKind` values observed: `module` 4,131, `function` 9,226, `variable` 27,364,
`constant` 1,697.

Three of these columns are new at this denominator and each settles a question the
sample could only gesture at:

- **`neither` is 0 on every type.** An edge whose *source* is not a published symbol
  would be a graph edge asserting something no symbol says; there are none across
  178,463 edges.
- **`overrides` resolves 138 of 138 and is 100% ambiguous** — every one of the 138
  targets names more than one published symbol, because a redefinition's target is
  by construction a name declared at least twice. This type is fully resolvable and
  fully ambiguous at the same time, which is the sharpest form of the incoming-edge
  problem in this lane (a `local` in two functions is two declarations of one name).
- **`calls` ambiguity is 1.6%, not 0.6%** as the 400-file sample read, and `uses`
  ambiguity is 18.8% against the sample's 19.0%. The sample was close; the whole
  corpus is what should be quoted.

### The arithmetic gap closure, re-derived from 7.6× its original population

Round 8 predicted +70 `uses` edges from 126 operand nodes and closed the gap. Those
numbers came from the 499-file measurement. Re-run over the whole corpus:

| | round 8 (labelled whole corpus, was 499 files) | **round 9 (whole corpus)** |
| --- | --- | --- |
| files the wasm could not parse | 3,634 | **0** |
| files with an arithmetic `compound_statement` | 41 | **351** |
| arithmetic `compound_statements` | 104 | **834** |
| operand name nodes | 150 | **1,139** |
| distinct `(target, line)` pairs | 137 | — |
| already published as `uses` | 137 | **995** |
| **predicted new `uses` edges** | 70 | **0** |
| `compound_statements` the predicate excludes | 948 | **7,495** |

So the round-8 verdict survives a population 7.6× larger: **995 of 995** arithmetic
operand reads are already published, and the gap is closed at corpus scale, not
sample scale. The A/B pair (7,786 → 7,856 on one fixed 400-file sample) is
unaffected and remains the evidence that the *change* added exactly 70 edges.

### Limitation 24's population is 5, not 0 — and the closing test is still correct

Limitation 24 said the `endsWithDoubleParen` half of `isArithmeticCompoundText` has
an **empty** measured population (0 of 792 excluded `compound_statements` open
`((`), and therefore that no mutant could cover it. The zero was a 400-file
artifact. Over the whole corpus the population is **5**:

| | count |
| --- | --- |
| `compound_statements` the predicate excludes | 7,495 |
| …of those, opening `((` but not closing `))` | **5** |
| …of those, containing an `ERROR` or `MISSING` node | **5 of 5** |
| …of those, containing **no operand node at all** | **3 of 5** |
| …of those, whose `variable_name` comes from the arithmetic prefix | **0 of 5** |

The five are `(( $+commands[brew] )) && dir=$(brew --prefix …)` (nodenv, pyenv,
rbenv), `(( $+commands[brew] )); then` (cask) and
`(( ! ${+ZSH_AUTOSUGGEST_ORIGINAL_WIDGET_PREFIX} )) &&` (zsh-autosuggestions).
`$+commands[…]` and `${+VAR}` are **zsh** forms the pinned **bash** grammar cannot
read, so the operand arrives as a bare `word` inside an `ERROR` and the closing
`))` is a synthesized `[MISSING]` node. The two that do contain a `variable_name`
get it from the `&&`/`;` **tail** — `comp_files` at `cask.plugin.zsh:20`,
`typeset` / `ZSH_AUTOSUGGEST_COMPLETIONS_PTY_NAME` at `config.zsh:95` — both of
which the main walk already reads as the declaration or command they are.

**So this is not a GAP and no edge is owed.** The closing test refuses precisely the
damaged shapes, and dropping it would read a damaged tail as arithmetic. A mutant
for it was written, **survived** the battery, and was deleted with the measurement
recorded in the header of `mutants-bash-lane.mts`, following the file's existing
`printf -v` precedent: a mutation with no correct output to change cannot be caught,
and leaving it would mean a permanently red gate or a fiction. The probe now tallies
all three counters above on every run, so the next corpus that adds a *readable*
unterminated `(( … ))` will make the mutant writable instead of requiring someone to
rediscover this.

### Coverage, restated as applicable

Unchanged: **7/7 applicable, 3 measured-absent (`extends`, `implements`,
`instantiates`, each with instrument A over all 164 node types plus instrument B),
0 unaccounted.** What round 9 changes is the denominator every one of the seven is
measured against: from 400 of 4,133 files (9.7%) to **4,133 of 4,133 (100%)**, with
the two ungrammatical files named and their 0 relationships stated.

`script/m14/differential.ts --lang bash` reports, on its 60-file `otp` sample
(`rot 21`, hash `b0549e4c8d9e5e6a`): truth **1,597**, covered **1,597 (100%)**,
MISSING 0, analyzer-edges 1,561, **unexplained 5 (0.3%)**, heuristic 0. Round 3
read unexplained 0. Five unexplained edges is the kind of number that gets
attributed to whatever change happens to be in the tree, so this section
establishes which of the two it is before saying anything about it.

**Not round 5.** `ab-round5-targetline.ts` parses the same 115 pinned `otp` files
through the analyzer before and after the target-resolution work and differences
the relationship sets as sets of `(source, type, target, line)`:

| | value |
| --- | --- |
| edges, pre-change (`b2b6ee090~1`) | **7,813** |
| edges, post-change (`b2b6ee090`) | **7,813** |
| edges ADDED | **0** |
| edges REMOVED | **0** |
| edges with metadata changed | 84, additive only (`targetLine` 84, `targetKind` 84, `targetResolution` 84) |

The differential could not have answered this itself. Its cold-pool rotation draws
`rot N` and increments on every run, so two consecutive runs are not comparable;
and its lane journal lives in a shared `/tmp` file that six other agents are also
writing. Resetting the rotation to reproduce the exact 60 files would have meant
mutating state this lane does not own. The A/B is therefore a separate instrument
with a pinned file set, which is what the claim needed.

**Not a fabrication either — an oracle that cannot see the construct.** All five
were located from the F5 lane journal, and every one carries
`metadata.isImplicitBinding: true`:

| file:line | edge | site |
| --- | --- | --- |
| `otp/make/fixup_doc_links.sh:29` | `contains` `fixup_doc_links.sh` → `app` | `for` |
| `otp/erts/etc/win32/nsis/find_redist.sh:74` | `contains` `add_path_element` → `x` | `for` |
| `otp/erts/etc/win32/nsis/find_redist.sh:174` | `contains` `find_redist.sh` → `verdir` | `for` |
| `otp/lib/edoc/test/test_libs.sh:19` | `contains` `test_libs.sh` → `i` | `for` |
| `otp/erts/emulator/ryu/update.sh:57` | `contains` `update.sh` → `yn` | `read` |

The cause is one condition in the oracle. `deriveBashEdges` (exported at
`script/m14/differential.ts:24815`) branches on

```ts
if (n.type === "variable_assignment" || n.type === "declaration_command")
```

which are exactly the two node types the analyzer's declaration collectors read
**before round 4**. The oracle was never taught `for NAME in …`, `read NAME`,
`mapfile` or `printf -v`, so it publishes no declaration and no `contains` edge for
any of them, and every symbol round 4 added is unexplained *by construction*. This
is the same failure the lane has already recorded once, from the other side: the
`overrides` type was omitted by the oracle too, and two implementations that both
say nothing agree perfectly.

**Size of the class** (`probe-bash-derivation-debt.ts`, 400 files hash order,
4,130 admitted):

| | count |
| --- | --- |
| implicit-binding symbols published | **175** (`for` 127 in 71 files, `read` 48 in 25) |
| `contains` edges naming one | **179** — all unexplained by construction |
| `uses` edges naming one | **400** — all resolve; this was round 4's fix |
| `mapfile`, `printf -v` | **0** on this sample, and the reason is measured below |

So the DERIVATION debt in this lane is **one class over two constructs**, not a
general divergence: 179 `contains` edges on a 400-file sample, from `for` and
`read`. The `uses` side needs nothing, because an edge whose target resolves is
right whether or not the oracle happens to have heard of it — which is also why
round 4's 357-target improvement never showed up here.

**Reported, not edited** (§8): `script/m14/differential.ts` is shared machinery.
The change needed is, in `deriveBashEdges`: read the bare `variable_name` child of
`for_statement`; and for `read`/`mapfile`/`readarray`, apply the option table
(`READ_VALUE_OPT_LETTERS`) plus the last-position bundle rule — the same table
round 4b spent a surviving mutant on, so it is known to be the subtle half. Without
both, a partial port would leave the lane at unexplained > 0 with no way to tell
"the oracle is still incomplete" from "the analyzer fabricates".

### A correction against round 4's own headline number

Round 4 reported "binding sites 234". That is a count of **tree sites** and it
answers "does the construct occur"; it must not be read as 234 declarations
published. Measured on the same sample: of the **173** `for` sites, **21 (12.1%)
are correctly declined** because the name is already declared in the same scope by
a `NAME=` or a declaration construct, and the analyzer publishes **175**
implicit-binding symbols. The two `mapfile`/`printf -v` sites round 4 listed were
checked individually and are both reassignments:

- `bash-completion/completions-core/cvs.bash` declares `cvsroots` at line 43 with
  `cvsroots=("$CVSROOT")` and only re-targets it at line 46 with
  `mapfile -tO "${#cvsroots[@]}" cvsroots <CVS/Root`
- `bash-completion/completions-core/ip.bash` declares `local namespace` at line 30
  and only re-targets it at line 31 with `printf -v namespace '%q' "$ns"`

Declining those is first-declaration-wins working, not a gap, and the symbols they
produce carry the earlier site's metadata rather than `bindingSite`. Round 4's
number was not wrong about anything it claimed to measure; the reading is, so it is
corrected here rather than left to be over-read.

## Round 10: the column that was a count and was not, and what a 120-file sample can decide

Round 9 answered "what fires" at 100% of the corpus. It left one number in the census
output that was not a number, and that number is the one a reader uses to decide
whether a rare type is real.

### The `files` column was a display cap wearing a count's header

`census-bash-ontology.ts` keeps a capped per-type example set — `noteFile` adds a label
only `if (s.size < 6)` — and the report printed that set's size under a column headed
`files`, with a `+` appended whenever the type had any edges at all:

```
overrides     138       6+      138 100.0%  0  0.0%    0  0.0%    0  0.0%     structural:138
```

Every type with more than six example files printed `6+`. `overrides` — 138 edges, the
rarest type the analyzer emits — printed `6+`, which reads as "six or more files" and
was in fact "the cap, reached". The same shape is in `script/m14/firing-check.ts`, for
a different reason and with a worse outcome; see [reported to the supervisor](#reported-not-edited-two-defects-in-shared-instruments).

Fixed in the census: a second set, `relFileCount`, is never capped, and the report
prints `files` (exact) beside `ex` (the capped list, labelled as not a count). Same
whole-corpus run, 4,133 admitted files:

| type | edges | **files (exact)** | share of admitted | both-ends | ambiguous |
| --- | --- | --- | --- | --- | --- |
| `calls` | 55,222 | **3,733** | 90.3% | 14,752 26.7% | 1.6% |
| `uses` | 81,485 | **3,261** | 78.9% | 64,494 79.1% | 18.8% |
| `contains` | 38,264 | **3,352** | 81.1% | 38,263 100.0% | 16.1% |
| `imports` | 679 | **489** | 11.8% | 0 0.0% | — |
| `references` | 679 | **489** | 11.8% | 0 0.0% | — |
| `exports` | 1,929 | **647** | 15.7% | 1,927 99.9% | 5.0% |
| `overrides` | 138 | **48** | **1.16%** | 138 100.0% | 100.0% |

Nothing about the analyzer changed — the analyzer is untouched in this round, and the
per-type edge counts reproduce round 9 within 0.04% (178,396 against 178,463). The
defect was in this lane's own reporting, and it was the reporting that decided whether
the rarest type looked real.

### `overrides` reads 0 at 120 files, and that is arithmetic

`script/m14/firing-check.ts --files 120 bash` — the arbiter the workstream names —
reports:

```
bash       106/120     6/10    4,293       0    stable   calls,uses,contains,imports,references,exports
```

Six of ten. `overrides` is one of the four zeros, alongside the three RULED types. The
census says `overrides` fires in 48 of 4,133 admitted files. So the sample and the
census disagree about a type the analyzer emits 138 times, and the sample is not wrong
— it is small relative to the type's prevalence:

| type | prevalence | expected in 120 files | P(sample reads 0) |
| --- | --- | --- | --- |
| `calls` / `uses` / `contains` | 78.9–90.3% | 94.7–108.4 | **0.0%** |
| `exports` | 15.7% | 18.8 | **0.0%** |
| `imports` / `references` | 11.8% | 14.2 | **0.0%** |
| **`overrides`** | **1.16%** | **1.39** | **24.6%** |

**Reading 0 for `overrides` at 120 files is the single most likely outcome**, and it is
what happened. Six consecutive runs of the same command after the first read six again.
The type is EMITTED at 138 edges in 48 files, 138 of 138 resolving at both ends, and
its 0 at 120 files is a property of the sample size, not of the analyzer.

This matters beyond this lane, because the arbiter is run at `--files 120` for every
language: **any lane whose rarest emitted type has prevalence below ~4% will read it at
0 and be invited to declare a GAP or a RULED verdict it has not earned.** The threshold
is P(0) = (1−p)^120 > 0.10 at p ≈ 1.9%. Only `overrides` is exposed here, and only
because bash's redefinition rate is low — a shell function is rarely declared twice.
The measurement that settles it is the per-type file count, which is why the column
that was a cap is now a count.

### Round 9 reproduces, and the residual delta is NOT the fallback file

Same analyzer, same corpus, same 4,133 admitted files, two whole-corpus runs on
different days:

| | round 9 | round 10 | delta |
| --- | --- | --- | --- |
| relationships | 178,463 | **178,396** | −67 (−0.04%) |
| symbols | 42,418 | **42,403** | −15 |
| `imports` / `references` / `exports` / `overrides` | 679 / 679 / 1,929 / 138 | **679 / 679 / 1,929 / 138** | **0** |
| `calls` / `uses` / `contains` | 55,231 / 81,529 / 38,278 | 55,222 / 81,485 / 38,264 | −9 / −44 / −14 |
| grammar-read / FALLBACK | 4,131 / 2 | 4,130 / 3 | +1 fell back |

The obvious explanation is that the one extra file past the wasm is worth exactly 67
relationships. **It is not.** `probe-bash-one-file-rels.mts` reads what the grammar
gives each of this run's three fallback files through `parseFile`:

| fallback file | symbols | relationships |
| --- | --- | --- |
| `terragrunt/.github/scripts/ci/set-go-memory-limits.sh` | 1 | **2** (uses) |
| `vault/enos/modules/vault_verify_performance_replication/scripts/verify-replication-status.sh` | 14 | **62** (calls 16 · contains 13 · uses 33) |
| `sqlite/ext/wasm/split-speedtest1-script.sh` | 6 | **22** (calls 3 · contains 5 · uses 14) |

2, 62 and 22 — none is 67, and all three together are 86. Round 9's two fallbacks were
different files again. So the tidy story is wrong, and this round does not replace it
with another one: **the mechanism that moves a whole-corpus count by tens of edges
between two runs of an unchanged analyzer on an unchanged admitted file set is not
settled here.** What is measured is the size of the wobble (0.04% corpus-wide) and that
it does not touch the four rarest types at all.

### What IS reproducible, measured rather than asserted

Eight runs of the census on one fixed 800-file sample, same analyzer, same files:

| run | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| relationships | 31,992 | **32,317** | **32,317** | **32,317** | 32,289 | **32,317** | **32,317** | **32,317** |
| fallback files | — | 0 | 0 | 0 | — | 0 | 0 | 0 |

**Six of eight read exactly 32,317, and two read low by 325 and 28 edges.** The
shortfall is not the cached-wasm copy: `/tmp/bb-ts-core.wasm` was deleted between runs
4 and 5 and run 5 still read low (32,289) while run 6 read 32,317, so the file's
existence on disk does not predict the count. The four runs that read the fixed point
recorded `FALLBACK : 0` and `grammar-read: 800`, so on those runs every sampled file
was parsed by the grammar and the shortfall is absent rather than relocated.

The two short reads did not have their abort rows captured — the instrument printed
`rels` but not `grammar-read`/`FALLBACK` on those invocations — so this round cannot say
whether they lost files to fallback or lost edges inside files that parsed. That is
recorded as open rather than filled in. The consequence for a reader is narrow and
worth stating: **a single census run on this corpus is a lower bound, and the fixed
point is the value to quote.** Every whole-corpus number in this document is quoted
from a run, and the ones this round re-took reproduce round 9 to 0.04%.

### Reported, not edited: two defects in shared instruments

Both are §8 material. Neither was touched.

1. **`script/m14/firing-check.ts` — the per-type `files` column cannot exceed 1.** The
   map is declared *inside* the per-file loop (`const filesByType = new Map<…>()` at
   the loop body's line 325, `for (const file of files)` at 288) and consumed after it
   at line 371: `for (const [type, set] of filesByType) res.types[type].files =
   set.size`. Each iteration therefore sees only the current file's set and
   **overwrites** rather than accumulates. Measured on this lane:
   `calls: {edges: 1119, files: 1}` across 106 parsed files. The fix is to hoist the
   declaration above line 288. Until it is hoisted, the `files` column of that report is
   `1` for every type that fired and `0` for every type that did not, on every lane.

2. **`script/m14/firing-check.ts` — a 120-file stride cannot decide a rare type.** Not
   a code defect but a reporting one, and it is why finding 1 matters more than it
   looks: the arbiter prints `6/10 fired` with no indication that the sample was too
   small to see the seventh. Either raise `--files` for the arbiter, or have it print
   per-type prevalence alongside the verdict. The census's `--all` mode is the
   instrument that answers it, and it runs in 4m20s.

### Coverage, unchanged, and the sample that now measures it

**7/7 applicable, 3 measured-absent** (`extends`, `implements`, `instantiates`, each
with instrument A over all 164 grammar node types plus instrument B on the parse tree),
**0 unaccounted.** Nothing in this round changed a verdict; it changed one reported
column into the measurement that keeps a verdict honest at a sample size the arbiter
actually uses. The `--files 120` arbiter reads **6/10**; the whole corpus reads **7/7
applicable**, and the difference is the `overrides` row, priced above.

### "External" and "never indexed" are separated, at the whole corpus

The brief asks for these apart, because in a count they are one number and in a finding
they are opposites: an external binary is not something any analyzer failed to publish.
The analyzer's own flags partition `calls` exactly — `isFunctionCall` 14,050 +
`isExternalCommand` 41,172 = 55,222, the whole type, no remainder:

| `calls` edge | count | share | both ends resolve | what it is |
| --- | --- | --- | --- | --- |
| `isFunctionCall: true` | **14,050** | 25.4% | **14,050 — 100.0%** | a function this file declares. Every one resolves. |
| `isExternalCommand: true`, target matches a local symbol | **702** | 1.3% | 702 | **the one class that is a naming collision** — an external command whose name a local declaration also carries. The reverse walk would walk to that local symbol. |
| `isExternalCommand: true`, target matches nothing | **40,470** | 73.3% | 0 | an external command: `sed`, `git`, `systemctl`. Outside the indexed corpus. |

The 40,470 are measured as external rather than asserted: an independent tree walk finds
a declaration for **0** of them, and they are 73.3% of the type — which is why `calls`
reads 26.7% resolution and is **not** a recall shortfall at that number. The 702 are the
honest residue and are counted here rather than fixed, because the fix is a
cross-file/layering question (laptop C) and 702 is its size at this denominator.

### Reported to the supervisor

No analyzer change in this round. `src/ast/real-bash-analyzer.ts` is byte-identical to
round 9 (`git diff 98bccd9c0..HEAD -- src/ast/real-bash-analyzer.ts` is empty), and to
round 8's `81f6cbc33` before it.

## Round 11: the open population was counted by name, and the probe was wrong twice

Round 9 closed with a number and a plan: **6,491 ambiguous edges** it called an open
population — 236 `calls`, 6,159 `contains`, 96 `exports` — plus "1,185 ambiguous `uses`
edges, 395 = 33.3% carry nothing". It said `contains` was 95% of the open population,
that `resolveDeclaration`'s scope-chain rule would apply to it unchanged, and that it
was "not fixed and no edge is claimed to be fixed" because the session was ending.

All three numbers were wrong, in three different ways, and each was wrong for a reason
worth writing down. Two of the three were this lane's own instruments.

### The question round 9 asked cannot see the answer

Round 9 counted **how many published symbols in a file share an edge's target name**.
That is the condition `bb_impact`'s name-match faces when it has nothing else — but a
consumer does not have nothing else. It has the edge row and the symbol table, and the
edge row carries fields. `probe-bash-published-resolvability.mts` asks the question
that decides the work: *apply every discriminator the edge PUBLISHES to the file's real
symbol table, and report what each one leaves.* The answers are three, not two:

| outcome | meaning |
| --- | --- |
| **0 candidates** | the edge asserts a declaration the published table does not contain — a dangling claim, and the worst outcome |
| **1 candidate** | resolvable, and the table says **which published field** did it |
| **>1** | genuinely ambiguous: nothing the edge publishes separates them |

On the 400-file hash-order sample, production `parseFile`, admitted 4,133 / scanned
462,809 / 0 parse failures:

| type | edges | target present | ambiguous | → 0 cand | → 1 cand | → >1 cand | decided by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `calls` | 5,097 | 961 (18.9%) | 6 | 6 (100%) | 0 | 0 | **nothing** |
| `uses` | 7,856 | 6,279 (79.9%) | 1,187 | 0 | 1,097 (92.4%) | 90 (7.6%) | `targetKind` |
| `contains` | 3,775 | 3,775 (100%) | 658 | 0 | **658 (100%)** | 0 | `edgeLine` |
| `exports` | 210 | 210 (100%) | 2 | 0 | 2 (100%) | 0 | `edgeLine` |
| `overrides` | 28 | 28 (100%) | 28 | 0 | 28 (100%) | 0 | `overridesLine` |
| `imports` / `references` | 44 / 44 | 0 | — | — | — | — | target is a path |

**Correction 1 — `contains` was never open.** 658 of 658 ambiguous `contains` edges
reduce to exactly one candidate from the edge's own line, because a `contains` edge's
line *is* the child's name line (`nameLineOf`, M60 #921). Round 9's 6,159-edge open
population was 95% counting a name where a line was already published. This file had
said so in prose since round 5 ("`contains` puts the child's *name* line on the edge")
and then, four paragraphs later, counted the same edges as unfixed — both statements
were in the same section, and the count won because a count is easier to check than a
prose claim about a field.

**Correction 2 — the 395 was a round-5 number quoted after round 6 fixed its cause.**
Round 9's table (`1,185 ambiguous`, `773 = 65.2% carry targetLine`, `395 = 33.3% carry
nothing`) is round 5's, carried forward unchanged. `git log -S'65.2%'` puts it in
`e7774ed40`, and round 9 re-stated it without re-measuring. Round 6 had already fixed
the mechanism round 5 blamed: a post-walk second pass re-asks `resolveDeclaration`
against the finished index (`real-bash-analyzer.ts`, the `attribution, second pass`
loop). Reproduced on the same 400 files:

| of the 1,187 name-ambiguous `uses` edges | count |
| --- | --- |
| carry `targetResolution` | **1,183 = 99.7%** |
| carry nothing at all | **4 = 0.3%** |
| of those carrying it: `innermostScope` 995 · `outerScope` 102 · `ambiguousInFile` 86 | |

So the number round 9 called a defect was **4**, not 395, and 3 of those 4 were closed
by this round. The lesson is narrow and repeatable: a count copied forward one round
without a re-run is not a measurement, and the failure is invisible precisely because
the number is plausible.

### `exports` was not closed either, and the reason is a coincidence

The probe's per-type rows disagreed with the prose in the same section, so the
prose was checked against a file by hand. `dark/scripts/testing/_gates-ui`:

```
SYM constant DARK_CONFIG_RUNDIR@31  owner=gate_workbench_scm
SYM constant DARK_CONFIG_RUNDIR@93  owner=gate_workbench_views
SYM constant DARK_CONFIG_RUNDIR@144 owner=gate_lsp_branches
EXP gate_workbench_scm -[exports]-> DARK_CONFIG_RUNDIR @65   (edge line 65)
```

`65` is the **`export` statement's** line. No published symbol carries it. Rounds 5 and
9 both recorded `exports` as already disambiguated because "the edge puts the
declaration's line on it" — it puts the *export's* line, and the two are the same
statement only when the export is the declaration (`export FOO=1`). Whole corpus:

| `exports` edges | ambiguous | edge line leaves **0 candidates** | leaves 1 |
| --- | --- | --- | --- |
| 1,929 | 96 | **29 (30.2%)** | 67 |

`nvm_supports_xz -[exports]-> PATH @37` against `constant@8` and `constant@21`;
`check_ce2ee -[exports]-> ORG_REPO @625` against four candidates;
`gate_workbench_scm -[exports]-> DARK_CONFIG_RUNDIR @65` against `constant@31/93/144`.

**The 400-file sample saw 2 ambiguous `exports` edges and in both the export line and
the declaration line were the same statement.** So the rule agreed with the coincidence
on every case the instrument could see, and a rule the instrument never contradicts is
not a verified rule. Fixed by the existing outward scope walk over `declSites` — an
exported name is a variable or a constant, which is what `declSites` keys; `export -f fn`
targets a function and is left to the function rule. **96 of 96 now resolve.**

### The two gaps that were real, and what closed them

Both were invisible to the 400-file sample and both were found by the same `--all` run.

**`calls` to a redefined function — 6 edges on the sample, 236 corpus-wide.** No
published field answered, and `isFunctionCall: true` could not: it says the target *is* a
function declared in this file, not *which* one, so as a filter it leaves **zero**
candidates on every case. The corpus shape is
`kubernetes/third_party/gimme/gimme`: `_version_sort` defined at 125, redefined at 127,
called at 535, 565, 581. bash functions have no nested scope, so the answer is the
latest definition at or before the call site — and note the direction, because the
`overrides` edge points the *other* way (from a redefinition back to the one it
replaces). Copying the `overrides` reflex into `calls` answers 125 and is wrong.

**`calls` to a name that is a function once and a variable too — 105 edges, corpus-only.**
Among *function* declarations the name is unique, so the rule above declines correctly
and the edge publishes nothing — while the published symbol table holds two
declarations and a consumer matching by target has two candidates.
`swift-nio/scripts/nio-diagnose:398` calls `nio_pids` against `variable@136` and
`function@151`; `mvdan-sh/syntax/typedjson/testdata/roundtrip/file.sh` calls `foo`
against `function@19` and `variable@20`. A **command position cannot denote a variable**
at all, so the single function is the answer, published as `commandNameIsAFunction` with
position deliberately irrelevant — unlike a `uses` edge, which has a "declared after the
use site" case to decline and a command has none.

The symmetric case on the read side was already closed above it: a `$name` read cannot
denote a function, so `readCannotBeAFunction` names the variable. The two are one rule
with a sign error between them, which is why the fixture asserts all three edges on one
name and requires them to resolve to **opposite declarations on adjacent lines**
(`command_name` function@127, variable@128, read at 137 → 128 and called at 131 → 127).

### Whole corpus, after: 0 dangling, 18,765 ambiguous edges accounted for

`census-bash-ontology.ts --all` and `probe-bash-published-resolvability.mts --all`, both
production `parseFile`, 4,133 admitted, **0 parse failures**, 4,132 grammar-read and 1
answered by `extractFallback` contributing **0 relationships**:

| type | edges | files | ambiguous | → 1 candidate | → >1 | said so explicitly | bare | **→ 0 candidates** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `calls` | 55,194 | 3,734 | 236 | **231 (97.9%)** | 5 | 0 | 5 | **0** |
| `uses` | 81,490 | 3,263 | 12,136 | **11,177 (92.1%)** | 959 | 959 | 0 | **0** |
| `contains` | 38,279 | 3,353 | 6,159 | **6,159 (100%)** | 0 | 0 | 0 | **0** |
| `exports` | 1,929 | 647 | 96 | **96 (100%)** | 0 | 0 | 0 | **0** |
| `overrides` | 138 | 48 | 138 | **138 (100%)** | 0 | 0 | 0 | **0** |

**17,801 of 18,765 name-ambiguous edges resolve to exactly one declaration. 959 decline
explicitly. 5 are external. 0 leave zero candidates — in any type, on any of the four
instruments.** Before this round: 6,491 counted open by name alone, **29 of them
dangling**, 109 publishing nothing.

**The 5 that publish nothing are not an attribution gap, and counting them as one would
be the wrong finding.** All five have `isFunctionCall: false` and
`isExternalCommand: true` — `ohmyzsh/plugins/pip/pip.plugin.zsh:107` calls `xargs`,
which that file also uses as a variable at 106 and 114; `Paket/completion/
paket-completion.zsh:1486` calls `key`; `kubernetes/cluster/gce/util.sh:3829` calls
`name`. These are external binaries whose *name* collides with a local variable, which
belongs with the 702 name collisions already counted under
[external vs never indexed](#external-and-never-indexed-are-separated-at-the-whole-corpus).
The flag itself is sound, measured rather than assumed: **`isFunctionCall: true` on
14,057 whole-corpus `calls` edges, and 14,057 of 14,057 have a published function symbol
of that name — 0 exceptions.**

### The probe was wrong twice, and both times the analyzer was right

Worth its own section because the instrument is the thing this lane keeps being wrong
about, and because in both cases the honest move was to check a file by hand rather than
re-tune until the number looked better.

**It ANDed two alternative discriminators.** `targetLine` and `edgeLine` both select on
a line. Applying both is a conjunction that can only delete candidates — so after the
`exports` fix, all 29 edges the analyzer had just repaired were reported as leaving
**zero** candidates, because the export statement's line was ANDed with the
declaration's `targetLine` and no published symbol carries both. The probe was wrong and
the analyzer was right, and the tell was that a fix had made a number get *worse*.
Corrected to model a consumer: apply the discriminators the edge carries, **stop at the
first that answers**. The 29 were confirmed against `_gates-ui` by hand *before* the
claim was rewritten.

**It treated a flag as a discriminator.** `isFunctionCall` was in the narrowing
pipeline and can only discard — never narrow — so it converted 231 correctly-resolved
`calls` edges into dangling claims. It is now measured in the per-rule health table and
**not applied**, with the reason in the probe's own source: *a rule that can only remove
answers must stay out of the narrowing pipeline or it converts a resolved edge into a
dangling claim.* It leaves zero candidates on 231 of 231, which is the measurement that
keeps it out.

That per-rule health table is the falsifiable half of this probe, and it is what makes
both corrections visible rather than arguable:

| rule | applied to an ambiguous edge | → 0 cand | → 1 cand | → >1 cand |
| --- | --- | --- | --- | --- |
| `targetLine` | 11,504 | **0** | 11,504 (100%) | 0 |
| `targetKind` | 11,504 | 0 | 199 (1.7%) | 11,305 |
| `overridesLine` | 138 | **0** | 138 (100%) | 0 |
| `edgeLine` | 6,255 | 29 (0.5%) | 6,226 (99.5%) | 0 |
| `isFunctionCall` (measured, **not applied**) | 231 | 231 (100%) | 0 | 0 |

`edgeLine`'s 29 zeros are the `exports` claim this round retracts; `targetKind`'s 11,305
"many" is why it cannot be the primary discriminator; `isFunctionCall`'s 231 zeros are
why it is not applied at all.

**Round 12 corrects the `isFunctionCall` row above, and with it the REASON it is not
applied.** The 231 zeros were the probe's own bug: the diagnostic filtered candidates
on `c.kind === "Function"`, and `SymbolKind.Function` is `"function"`, so the filter
matched nothing on every edge it touched and 231 correctly-resolved `calls` edges read
as dangling. The same commit that fixed the analyzer's `targetKind` literal fixed the
probe's, and this table was written from the probe's pre-fix reading — a number quoted
across a change to the instrument that produced it, which is the failure this file has
now made three times. Re-measured whole corpus: **`isFunctionCall` applied to 231
ambiguous edges leaves 1 candidate on 231 of 231 and 0 on none**, so with the literal
corrected it is a *narrowing* rule, not a discarding one, and the stated reason ("a
rule that can only remove answers must stay out of the narrowing pipeline") no longer
holds.

It is still not applied, and the reason is now arithmetic rather than structural:
`targetLine` already resolves **100%** of ambiguous edges with **0 dangling** in every
type, so applying `isFunctionCall` would add a key to 231 edges to reach an answer
`targetLine` has already reached. The honest statement is "no consumer needs it", not
"it is unsafe".

### Coverage, unchanged, and a mutant that passed for a structural reason

**7/7 applicable, 3 measured-absent, 0 unaccounted** — this round changed no verdict. It
changed the incoming half from "6,491 edges counted open by name" to "0 dangling", and
it retracted two of this file's own numbers to get there.

The gate re-run is unchanged: `emitted 7/10  ruled-sound 3  FALSIFIED 0
ruled-without-justification 0`, with the same two `[BB-PARSE-ERR]` rows and the same
`[BB-HANG]` exit that rounds 3, 7 and 9 recorded. `firing-check --files 120 bash` still
reads **6/10**, for the arithmetic priced in
[round 10](#overrides-reads-0-at-120-files-and-that-is-arithmetic): `overrides` has 1.16%
prevalence and P(reading 0 in 120 files) = 24.6%.

`bash/exports-resolution-inverted` **survived the battery**, and the reason is worth
recording because it is the second time in this lane that a survivor was structural
rather than careless. The mutant walks the `exports` scope chain from the file inward;
the fixture held the module-scope export (`@159` → `150`) and *claimed* in the mutant's
own description to hold the in-function one. It did not. An implementation that ignored
scope answers `150` for both, so the inversion was invisible. The missing row —
`exports_from_its_own_scope` → `165`, its own declaration — is now asserted, and
**34 of 34 mutants are caught with 0 survivors.** The two rows are `150` and `165`
precisely so that a scope-blind walk cannot produce both.

### Files changed, and the payload

`src/ast/real-bash-analyzer.ts`: **+284 / −0**, all of it in the post-walk attribution
region — the walk, the collectors and every emitter are untouched, which is why the edge
counts are identical before and after. Two indexes (`functionDeclLines` over published
function declaration lines, `namesWithNonFunctionDecl` over names carrying a non-function
declaration) and two methods (`resolveFunctionTarget`, `resolveReadAgainstFunctionSymbol`).
Four `targetResolution` values exist where two did — `latestDefinitionBeforeUse`,
`declaredAfterUse`, `commandNameIsAFunction`, `readCannotBeAFunction` — and each is
published **only on an edge whose target the published symbol table answers to more than
once**:

| | edges | edges carrying ≥1 target key | share |
| --- | --- | --- | --- |
| `calls` | 55,194 | **231** | 0.4% |
| `uses` | 81,490 | **11,177** | 13.7% |
| `exports` | 1,929 | **96** | 5.0% |
| `contains` / `overrides` | 38,279 / 138 | **0** | already carried the line |
| `imports` / `references` | 679 / 679 | **0** | the target is a path |

**11,504 edges of 138,613 = 8.3%** carry an attribution key, measured as the sum of the
probe's `decided by` column, and the four types the round did not touch are untouched for
the same reason round 5 gave: an edge whose target is unique in its file carries no new
information, and attaching keys to all of them would be paying to say what the row already
says. One `targetLine` literal cost a round here — the first version wrote `"Function"`
where `SymbolKind.Function` is `"function"`, so the key existed and matched nothing on
every edge it touched — so the value is now read off the published symbol and a literal
of that shape is a mutant, not a style question. No budget file was re-baselined; no
shared file was edited.

## Round 12: the assignment that binds a name, and the flag whose answer was a line number

Round 11 closed the incoming half. Round 12 went back to **what the analyzer claims**,
and found two defects that no arbiter in this repository could see, because both are
*omissions that make the graph smaller and the claims quieter* — a dropped declaration
and a boolean that is false where the contract says true.

Neither changes a verdict. Both change what a consumer is told, and one of them changes
the answer to a question a consumer will ask.

### Defect 1 — `arr[i]=v` publishes no declaration

`arr[i]=value` **binds `arr`**: if the array does not exist, the assignment creates it.
So it is a declaration in exactly the class this analyzer already recognises — a
`NAME=value` assignment, a `for NAME in` loop variable (125 sites), a `read` target
(48). The pinned grammar holds that LHS one level deeper than the bare case, as
`variable_assignment > subscript > variable_name`, and `extractAssignment` read only a
**direct** `variable_name` child. Two costs, and they are different findings:

1. the declaration published nothing, so the file's own reads of the name had no
   declaration to resolve against — and
2. BD11 classified every one of those reads as environment-supplied, which is the
   specific confusion BD11 was introduced to remove.

Whole corpus, the shape census (`probe-bash-array-element-binding.mts`, both instruments
on one private tree handle, 4,133 admitted / 462,809 scanned / 120 repos):

| every LHS shape `variable_assignment` produces | count |
| --- | --- |
| `variable_name` | 34,696 |
| **`subscript`** | **5,474 — 13.6% of every assignment's LHS**, in 123 files |

The 400-file sample saw **19** of those 5,474, so it understated the population by
288×. `157` distinct `(file, owner, name)` pairs among the sites; **45** of them
published no declaration; `112` were re-assignments of one already published.

The shape census is what makes "the fix covers `subscript`" a checked claim rather than
an assumption: a sibling LHS shape with its own population would print as its own row,
and there is none.

### Defect 2 — `isAssignedInFile` was a function of where the read sat

BD11's published contract is file-level: *"set when the file assigns the name **under
any owner**"*. Nothing in that sentence, and nothing in the field's name, mentions
position. The implementation evaluated the predicate **during** the walk, against
`declaredSymbols`, which the same walk fills — so the answer depended on how much of the
file the walk had already passed. Two lines are the whole demonstration:

```bash
echo "before: $LATE"     # uses -> LATE @1   isAssignedInFile ABSENT
LATE=1
echo "after: $LATE"      # uses -> LATE @3   isAssignedInFile TRUE
```

One file, one name, one declaration, two answers. That is a self-contradiction inside a
single `parseFile` result, so it needs no oracle to be a finding — and a differential
cannot see it, because the oracle never published the field. Checked by hand before the
claim was written: `otp/erts/etc/win32/cygwin_tools/vc/rc.sh` reads `$IFS` at line 32
and assigns `IFS=` at line 33.

This is the **second** time this walk has answered a file-level question against a
half-built index; the first was `resolveDeclaration`, fixed in round 6 by a post-walk
pass. The fix is the same shape and the same reason.

| | 400 files, before | 400 files, after | whole corpus, after |
| --- | --- | --- | --- |
| `uses` reads | 7,856 | 7,856 | 81,534 |
| carrying the flag | 6,036 (76.8%) | 6,285 (80.0%) | 64,514 (79.1%) |
| absent | 1,820 (23.2%) | 1,571 (20.0%) | 17,020 (20.9%) |
| **(file, target) pairs carrying BOTH answers** | **37, in 25 files** | **0** | **0** |
| pairs declared after every read, still wrong | 15 (50 edges) | 0 | 6 (51 edges) — adjudicated below |
| control: name absent from the symbol table | 703 (1,577 edges) | 702 (1,571 edges) | 7,479 (16,969 edges) |
| pairs flagged on every edge | 2,036 | 2,089 | 20,964 |

The four pair-counts close: 2,791 pairs before and after, and 37 contradictory + 15
silent-wrong + 1 control = **53**, which is exactly the 2,089 − 2,036 the last row
gained. Nothing left the population and nothing entered it; 53 pairs moved from
"answered wrongly or ambiguously" to "answered the same way on every edge", and a table
whose rows do not sum is a table of independent numbers rather than a census.

**The whole-corpus residual is 0 defects, and saying so required adjudicating the 6.**
Five are names the file publishes **only as a function**: `$name` cannot denote a
function in bash — the two namespaces are separate — so *absent is correct*, and a probe
that asks "does the file publish this NAME" cannot tell that case from damage. One is
`sqlite/autosetup/autosetup`, a polyglot with a genuine `#!/bin/sh` shim that re-execs
Tcl: its 45 `uses -> autosetup` edges are Tcl `$autosetup(libdir)` reads and the file
assigns no bash variable of that name. Reporting 6 as damage would have been this
file's fourth wrong number, and the split is now counted in the probe rather than
argued in prose.

### The probe was wrong three times before it was right, and each error is the interesting part

This is the third instrument error in this lane's history to be found by **two
instruments disagreeing** rather than by either being inspected. All three are recorded
because the pattern is the lesson.

| what the probe said | why it was wrong | how it was found |
| --- | --- | --- |
| 3 new bindings (400 files) | adjudicated on the bare **name**; `extractAssignment` dedupes on `${owner}\u0000${name}`, so a function-scoped binding read as already-published whenever the module published the same name | the A/B measured 5 and named the two extra |
| "use-before-assign: **correct**", 6 of 7 | BD11 is file-level; a read before the binding is classified wrong, and the split only *names the mechanism* | the second defect above |
| 58 new bindings (whole corpus) | pushed `function_definition` names onto an owner stack and **never popped** them, so "the enclosing function" was "the last function seen" | the A/B measured 45; `ohmyzsh/tools/changelog.sh:145` sits under `program`, not under the `commit:is-revert` function whose body ended at line 131 |

With the pop it predicts **45**, and `--verify` — a mode added so a prediction can be
re-checked against the analyzer as it now stands rather than re-derived by hand —
reports the working tree publishes **45 of 45 and 0 not published**. Three instruments,
one number.

### The prediction, the change, and the A/B

| | predicted from the tree, before the code changed | measured by the A/B |
| --- | --- | --- |
| symbols added | **45** | **45** (removed 0) |
| `contains` added | 47 | **47** |
| `contains` whose line moved | 2 | **2** |
| edges of any other type | 0 | **0** |
| metadata keys lost | 0 | **0** |
| `isAssignedInFile` gained / lost | — / 0 | **2,154 / 0** |

Whole corpus, both analyzers driven over the **same bytes** through one private
`web-tree-sitter` handle, `git show` of `663a7a6d6` materialised as a sibling module
and imported directly (never `git stash`, limitation 17):

```
old symbols 42,425 → new 42,470   ADDED 45   REMOVED 0
old rels   178,547 → new 178,592  ADDED 47 {contains:47}  MOVED 2  REMOVED 0
metadata GAINED  isAssignedInFile 2154 · targetResolution 29 · targetLine 28 · targetKind 28
metadata LOST    0
isAssignedInFile gained on 2,154 edges, LOST on 0
calls / uses / imports / references / exports / overrides   identical
VERDICT: PASS against the predicted +45 symbols, +47 contains, 0 other edges
```

**A MOVED edge and a DROPPED edge share a signature and are opposite findings**, and the
first version of the A/B reported 2 dropped claims that are the fix working:
`ohmyzsh/plugins/gitfast/git-completion.bash` binds `words` by element before its
`words=(…)` form at 3510, and `ohmyzsh/plugins/scd/scd` binds `drank` by element at 367
before `drank=(…)` at 391, so each declaration now sits on the earlier line — which is
where it happens. `addRel` keys on `${source} ${type} ${target} ${line}`, so the test is
now whether the new side published the same `(source, type, target)` at **any** line.

**The +94 that is not the change.** The whole-corpus census reads 178,527 relationships
and 42,469 symbols against round 11's 178,388 and 42,420. The A/B attributes **+139** of
that to the round; the census-to-census difference is +139 too, but the A/B says +45
symbols and +47 `contains` and nothing else, so ~+94 sits on `calls` and `uses`. That
residue is the documented run-to-run instrument wobble (rounds 9/10/11 read 178,463,
178,396, 178,388 on the same admitted set) and it is **not** re-baselined away: the
census column moves because the corpus and the analyzer moved, and the A/B column is
the one that isolates the change. Both are printed.

### Fixtures, mutants, and what fails without the fix

`bash/array-element-binding` — 9 symbols, 9 relationships, 1 forbid. The function-scoped
`COMPREPLY` beside the module-scope one is the row a bare-name dedup drops, and two
adjacent reads of one name are pinned to **opposite** declarations (`outerScope`/33 at
line 36, `innermostScope`/37 at line 37) so a scope-blind walk cannot satisfy both.
Against `663a7a6d6`: **1 symbol row and 6 relationship rows fail**.

`bash/assigned-flag-is-file-level` — 8 symbols, 8 relationships, 1 forbid. The read
**above** the assignment, the read inside a function of a module-scope name, the read of
a `read`-bound implicit target, and the read in a different scope of a name declared
further down — plus two `meta.isAssignedInFile: null` rows, so the fixture cannot be
passed by an analyzer that emits the field unconditionally. Against `663a7a6d6`:
**exactly 3 rows fail, and they are exactly the three reads whose binding comes later in
the text.** The mechanism, stated as a test outcome rather than as a paragraph.

Six mutants, 34 → 40, **40 caught, 0 survived, 0 did not apply**; the shared registry's
bash slice is **23 of 23**. One of the six earns its place for what it breaks:
`bash/bd11-flag-emitted-unconditionally` is the only mutant in this lane that makes a
published edge assert something **false** rather than merely omit something — `$FROM_THE_ENVIRONMENT`
would claim to be a project variable, which is the confusion BD11 exists to remove.

### The arbiters, re-run

| arbiter | result |
| --- | --- |
| `ontology-coverage-gate.ts bash` | **`emitted 7/10  ruled-sound 3  FALSIFIED 0  ruled-without-justification 0`** — one `[BB-PARSE-ERR] memory access out of bounds` and one `[BB-HANG] parser stuck 120s`, both on `docker/hack/make/dynbinary`, so its per-type totals sit under the census: calls 55,240 · uses 81,531 · contains 38,325 · imports 677 · references 677 · exports 1,929 · overrides 138 |
| `firing-check.ts --files 120 bash` | **106/120 files, 6/10 fired, 4,294 edges, 0 degraded, analyzer stable** — round 11 read 4,293. `overrides` still reads 0 at this size, priced in [round 10](#overrides-reads-0-at-120-files-and-that-is-arithmetic) |
| `differential.ts --lang bash` | `otp` pin, 60 files, `rot 29`, hash `c702d451a42ba71a`: truth **1,686**, covered **1,686 (100%)**, MISSING **0**, analyzer-edges 1,650, unexplained **5 (0.3%)** all `contains`, heuristic **0**. The shape is unmoved across three rounds; the absolute counts move because the cold-pool rotation draws different files |
| `mutate-analyzer.ts` (`BB_MUTANT_ONLY="bash/"`) | 1,778 → **23, all 23 caught, 0 survivors** |
| `rel-type-coverage-gate.ts --langs=bash` | CHECK 1 DERIVATION **clean**; `baseline: 104 recorded, 0 NEW, 104 repaid` |
| `verify-regex-census.ts` | **PASSED** — 5 entries, `missing 0, stale 0, unclassified 0, mislocated 0`. This lane's own census: **0 regex literals across 0 of 37 files** |
| `probe-bash-published-resolvability.mts --all` | **18,837 name-ambiguous edges: 17,872 resolve to exactly one declaration, 960 decline explicitly, 5 are external, 0 leave ZERO candidates in any type.** Per type: calls 236 → 231 · uses 12,165 → 11,205 (960 decline) · contains 6,202 → **6,202 (100%)** · exports 96 → **96 (100%)** · overrides 138 → **138 (100%)**. Per-rule: `targetLine` 11,532 → 0 zeros · `overridesLine` 138 → 0 zeros · `edgeLine` 6,298 → 29 zeros (the retracted `exports` claim, unchanged) · `targetKind` 11,532 → 199 one / 11,333 many · `isFunctionCall` 231 → **231 one-candidate** (see the correction above) |
| `incoming-check.ts bash <5 files>` | 259 symbols, 0 degraded. `calls` 326 edges / 54 targets / 0 ambiguous / 190 unresolved · `uses` 547 / 124 / **1** / 68 · `contains` 254 / 207 / **2** / 0 · `exports` 14 / 13 / 0 / 0 · `overrides` 1 / 1 / 0 / 0. 207 declarations named by at least one edge, **5 orphans of 259**. 1 target resolves to >1 published symbol (`ui_version` → function, variable) — a **name-only** count, and the edge itself publishes `readCannotBeAFunction`, which is the point round 11 established: a consumer matching by name alone has two candidates, and one reading the edge row has one |
| `probe-bash-derivation-debt.ts --sample 400` | implicit-binding symbols published **173** (`for` 125 / 70 files, `read` 48 / 25); `contains` edges naming one **177**, unexplained by construction; `uses` edges naming one **396**, all resolving; 0 parse failures |

### Coverage, unchanged

**7/7 applicable, 3 measured-absent, 0 unaccounted.** Round 12 changed no verdict: it
closed a dropped declaration and a flag whose answer depended on a line number, and both
were inside types this lane already emitted. Reported as applicable rather than as a flat
7/10 for the reason the workstream states — the denominator shrank only via RULED
verdicts carrying corpus measurements, and numerator and denominator came from different
instruments.

## Round 13: the property that was false, and the guard that would delete 427 declarations

Round 12's defect was a **depth assumption**, not a missing feature: the handler read
an assignment's LHS as a direct `variable_name` child, and the grammar holds
`subscript > variable_name` for `name[i]=v`, one level deeper. Nothing about that is
visible by reading the handler — it is correct for the shape it names, and the grammar
has a second shape. So the generalization is a question about **every position the
analyzer reads by shape**, and this round's work is the instrument that answers it plus
the finding the instrument produced.

**No verdict changed: 7/7 applicable, 3 measured-absent, 0 unaccounted.** Both findings
are inside types this lane already emitted, and one of them is a correction to this
file rather than a change to the analyzer.

### The shape census, whole corpus

`probe-bash-grammar-position-shapes.mts`. A position is a node type **in a role**,
because round 12 read a `subscript` correctly on the read path (`collectReadNames`
walks every named child, :1596) and by `namedChild(0)` alone on the assignment path
(:1641) — counting node types would average those two into one meaningless row. Every
shape is `node.type`, integer child indices and `startPosition`; **no regex**, and the
probe owns its `web-tree-sitter` handle rather than borrowing the engine's, because two
owners of one parser handle is what makes the coverage gate's per-type totals wobble
(limitation 15).

Whole corpus — 4,133 admitted files, 462,809 tracked, 120 repositories:

| position | nodes | distinct shapes | unread | what the handler requires |
| --- | --- | --- | --- | --- |
| `declaration_command` | 9,718 | 245 | **0** | `child(0).text` ∈ {export, local, declare, typeset, readonly} (:1866) |
| `for_statement` | 1,618 | 797 | **0** | a direct `variable_name` named child (:1737) |
| `variable_assignment` | 40,170 | 810 | **0** | a direct `variable_name`, or `subscript > variable_name` (round 12) |
| `subscript` under `variable_assignment` | **5,474** | **16** | **0** | `namedChild(0)` is `variable_name` (:1641) |
| `function_definition` | 6,773 | 2,737 | **427** | the grammar's own `name:` field (:1430) — see below |

**The fourth row closes round 12's claim at corpus scale.** The doc previously rested it
on "with a `variable_name` base on **19 of 19**" — a 400-file sample against a
whole-corpus population of 5,474, which is limitation 27's error taken twice. It is
**5,474 of 5,474 over 16 distinct base shapes**, in 123 files. `variable_assignment`
reads 40,170 nodes, the same figure this file already carried, which is the control: had
the census and the doc disagreed, the doc would be wrong.

**The fifth row is the finding, and it goes the other way from what the probe expected.**

### "A damaged region publishes no declaration" is false

Limitation 33 asserted that property, and `functionName` (:1424) reads the grammar's
`name:` field with no condition on **where** that field resolves — so the assertion
invites a guard dropping a function whose name sits near a damaged region.
`probe-bash-error-name-field.mts`, whole corpus:

| | count |
| --- | --- |
| `function_definition` nodes | 6,773 |
| `name:` field resolved | **6,773 (100%)**, always a `word` |
| name node inside an ERROR span | **427** (6.3% of definitions, 1.0% of all 42,469 symbols) |
| — ERROR span starts **before** the definition | **421** — the definition is **intact** |
| — ERROR span starts **at** the definition | **6** — the definition is damaged |
| published by production `parseFile` | **427 / 427** |
| distinct files involved | 73 |

**All 427 are real declarations.** Read, not inferred. The smallest plain-bash instance is
`hledger/docker/run.sh:4` (619 bytes, third smallest of the 73 files, and the only one
that is bash rather than zsh): `function usage()` is declared at line 4 and **called**
from a case arm at line 20, so the declaration is load-bearing. The cause is **one
byte** — the arm is written `*)usage; exit 1 ;;` with no space after the `*`, the pinned
grammar drops the whole tail into one ERROR node, and that node's **span** reaches back
over the declarations before it.

`ohmyzsh/lib/clipboard.zsh:55` is the same population in zsh: `function clipcopy() { cat
"${1:-/dev/stdin}" | pbcopy; }` nested in an `if`, which a minimal fixture confirms the
pinned grammar parses **cleanly** (`root.hasError === false`) once the enclosing zsh
`(( ${+commands[…]} ))` condition is removed. All 6 internal cases hand-read as valid
bash (`ohmyzsh/lib/functions.zsh:1` `function zsh_stats() {`, `rg.zsh:15` `_rg() {`,
`perms.plugin.zsh:9` `function set644 {`, and three more).

**So "inside an ERROR node" is a statement about a node's SPAN, not a claim that the
analyzer recovered a name from wreckage.** Limitation 33 is right about **commands** — a
damaged region publishes no command and the analyzer invents none — and wrong about
**declarations**, which is the half that moves symbol counts. A guard built on the
property as written would delete **427 correct symbols corpus-wide** while reading as
care.

### Two things this round got wrong, both recorded rather than quietly fixed

**The probe's own first conclusion was wrong.** It printed "427 declarations exist ONLY
inside error recovery", from reading `alsoDeclaredCleanly=no` as a verdict. That column
is not a verdict column: a nested `function clipcopy()` inside an `if` is the *only*
definition of `clipcopy` in its file, so `no` is the expected answer and says nothing
about whether the declaration is real. The column is annotated in the file so the next
reader does not repeat it, and the probe now prints the span distinction that actually
decides the question.

**The first mutant was a no-op that passed for the wrong reason.** Adding the
ERROR-ancestor test to the `name:` field read does not remove anything, because
`functionName`'s **positional fallback** then reads the same name off the preceding
`word` sibling. The guard now refuses outright, which is what the property actually
invites — and a guard its own fallback defeats is not a guard.

**The first fixture could not be caught by either.** Built from zsh
`(( ${+commands[…]} ))` constructs with content after them, it **SURVIVED, 40/41**.
Measured why: the span forms only when the damaged region sits near the **end** of the
parse, so trailing content prevents it. The fixture is now the verbatim corpus construct,
and `function-declared-in-damaged-span` pins four functions inside **one** ERROR node
spanning rows 76-129 — `untouched_one` @76, `untouched_two` @80, `spaced_usage` @89,
`usage` @106 — all four published, plus `calls usage` from the arm that causes the
damage.

### Declared limitation of this round's own fixture

The trigger is **unstable under reduction**, and the fixture says so. Measured on the
pinned wasm: three preceding arms do not span, four arms plus a trailing command do, five
arms do; dropping **any** trailing line from the 29-line corpus original stops it. So the
fixture pins behaviour **on this pinned grammar**, and a future wasm that recovered better
would make it **vacuous rather than wrong**. The corpus measurement in
`probe-bash-error-name-field.mts` is the instrument that does not depend on the recovery
continuing to behave this way, and it is the number to quote.

### Coverage, unchanged

**7/7 applicable, 3 measured-absent, 0 unaccounted.**

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
path in another file**, which a single-file analyzer cannot bind to a symbol — and,
after round 3 removed the one edge that resolved for the wrong reason, on 0 of 44.

**A pooled 19.10% cannot be read as a recall number, so it was decomposed.**
`adversarial-probes.ts` asks, for every unresolved target, whether an independent
parse-tree walk finds a declaration of that name in the same file. If it does, the
analyzer MISSED a symbol and the low rate is measuring its own recall. Measured:

| type | total | resolved | **declared in file but never emitted** | undeclared by any file |
| --- | --- | --- | --- | --- |
| `calls` | 5,147 | 983 (19.10%) | **0** | 4,164 |
| `uses` | 7,947 | 5,974 (75.17%) | **0** | 1,973 |

**Zero on both.** Every unresolved target is a name the file does not declare:
`grep`, `git`, `kubectl`, `awk` and 1,845 other well-known programs, plus 2,322
other undeclared command names for `calls`; and for `uses`, environment and
shell-defined variables read from outside the file — `PATH`, `BASH_SOURCE`,
`SHELLOPTS`, `SECONDS`, parameters of the enclosing script. So the low rates are a
property of how bash names things, not a symbol-extraction shortfall, and the
decomposition is what makes that claim checkable instead of asserted.

**The same decomposition says the reverse about `imports`/`references`: 0 of 44
resolve at both ends.** Round 2 reported 1 of 45 and read the shortfall as "a path in
another file, which a single-file analyzer cannot bind". Removing the fabrication
took it to 0 of 44, which means the single resolving edge was `_try_existing` — it
resolved *because it is a symbol in the same file*, which is precisely why it was
not a dependency. **There is no recall component in this 0% at all**, and that is
the opposite of the `calls` finding above, so neither rate can be pooled into one
number.

One more check falls out of the same table and is worth stating because a leak
would be invisible in a count: **0 of 5,147 `calls` edges names a bash builtin**,
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
| `calls` | `1.0` × 5,129, **`0.7` × 18** |
| `uses` | **`0.8` × 7,947** |
| `contains`, `imports`, `references`, `exports`, `overrides` | `1.0` × all |

So the honest statement is two-part, and the second half is the one that matters:
**no edge is below 0.7, and 18 edges sit exactly on the line — 0.35% of `calls`
and 0% of everything else.** Separately, **`uses` is uniformly 0.8**: all 7,947
`uses` edges are `usage_contextual`, which is a name-match reading of a variable
rather than a parse fact. `uses` is the largest type in the lane and the only one
that is entirely a heuristic class; it clears the contract's threshold by 0.1
because that is where the analyzer put it, not because 0.8 was measured against
anything. A reader who takes "0 of 17,117 edges are heuristics" from the sub-0.7
band alone would be reading a threshold artifact.

Round 3 removed 5 edges, all of them at confidence **1.0** with
`evidenceClass: "structural"` / `"import_based"`. **Confidence carried no signal
about them at all**, which is the same observation pass 2 recorded for its two
fabrications and is now measured twice: in this lane the dangerous edges are the
ones the pipeline is most confident about.

**DERIVATION debt: 0, read from the shared evidence rather than asserted.** Two
routes agree. `npx tsx script/m60/rel-type-coverage-gate.ts --langs=bash` prints
CHECK 1 DERIVATION **clean** with `baseline: 104 recorded, 0 NEW, 104 repaid`;
and `validation/m60/results/rel-type-coverage.json` itself carries **0 findings
naming bash** and **0 baseline rows naming bash**. A DERIVATION finding is a type
the analyzer emits that the differential never audits. `deriveBashEdges` pushes
exactly seven labels — `calls`, `contains`, `exports`, `imports`, `overrides`,
`references`, `uses` — and the gate prefers that per-lane export over the shared
compared-label allowlist, so all seven are audited.

**Round 3 corrects the previous revision of this section.** It stated that the
recorded baseline "still lists 5 DERIVATION findings for bash" and that the entry
was stale. The baseline has since been regenerated and **bash no longer appears in
it at all**, so the count is 0 on both readings and the stale-entry discussion no
longer describes the file. Kept as a correction rather than quietly dropped,
because a note that says "0, measured" and a note that says "0, inherited" are
different claims.

**A warning about the command that produced the number.**
`script/m60/rel-type-coverage-gate.ts --langs=bash` **overwrites
`validation/m60/results/rel-type-coverage.json` with a one-lane version**, deleting
the other 45 lanes' rows (1,413 lines removed, 46 lanes → 1). It has no output-path
flag and no guard against a scoped run. Round 3 hit this, restored the file from
`HEAD`, and re-derived the number from the restored evidence. Reported, not fixed
(§8): that script and that artifact are shared machinery.

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

**The residual that no structural guard can see — and round 3 confirmed it rather
than repeating it.** `calls -> *` @ gimme:940 arrives as
`(command (command_name (word)))` with no damage anywhere on it, so no positional or
damage-shaped predicate can reach it. The only test that would catch it is a
blacklist on the literal name `*`, and that is not a POSIX fact — a file named `*`
is legal. It is carried as **1 edge on the 400-file sample**, named, rather than
closed with an invented rule. This is the one residual of the four that survives
round 3's guard; the other three are removed, together with two dependency edges
the earlier rounds never saw. See [Round 3](#round-3-what-the-census-was-already-printing).

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
| `bash/reserved-word-guard-over-refuses-builtins` (guard widened to every builtin) | `bash/call-identity-bd10`, `bash/source-path-resolution-bd9`, `bash/trap-handler-bd3`, `bash/case-arm-pattern-not-a-command` |

The third exists to prove the fixture pins **both** directions — the guard must
remove fabrications *without* removing real calls — and it is the mutant that
fails if the fixture only ever asserted the forbids. The second exists because a
line-removal cannot produce it, and a hand-maintained word list decaying to empty
is exactly the shape a table takes.

**Round 3 added a fourth guard with three mutants of its own**, in the same style
and for the same reason:

| mutant | caught by |
| --- | --- |
| `bash/case-arm-guard-removed` | `bash/case-arm-pattern-not-a-command` |
| `bash/case-arm-guard-widened-to-any-damage` (widened to guard E) | `bash/case-arm-pattern-not-a-command` |
| `bash/case-arm-guard-keyed-on-command-name` (keyed on `source`/`.` instead) | `bash/case-arm-pattern-not-a-command`, `bash/source-path-resolution-bd9` |

The third is the one the corpus A/B could not have caught. On the census sample the
only `source`-named damaged command **is** the defect, so replacing the structural
test with a name test removes nothing measurable while silently deleting every real
`source ./lib.sh` dependency edge in the other 47 repositories. A fixture is what
sees it; `bash/source-path-resolution-bd9` catches it too, which is the reassuring
part.

**One mutant anchor had to be repaired, and the reason is the regex fix.**
`bash/arithmetic-guard-over-refuses-cmd-substitution` keys on the literal source
line `if (cur.type === "command_substitution") return /^\$\(\(/.test(cur.text)`.
Round 3 replaced that expression with `opensWithArithmeticExpansion(cur.text)`, so
the anchor no longer matched and the mutant runner reported it as
`ERROR … the anchor text is not present … the mutant does not apply to this source`.
**A mutant whose anchor is a regex cannot survive the removal of that regex**, which
means a lane can silently lose mutation coverage by fixing a style violation. The
anchor is now the post-fix source text and the mutant is caught again — 8 of 8.

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

1. **Symbol metadata survives for 4 of the 13 keys this lane publishes; the other 9
   arrive at 0%.** Measured on a 105-file sub-sample, each file parsed twice and the
   key sets differenced. `pool-worker.ts:1093-1095` now forwards `isExported`,
   `isImplicitBinding`, `bindingSite` and `isArray`, and each of those four survives
   its published population (the `isExported` **affirmative** at 13 of 13 files, over
   144 of 144 symbols in the per-symbol measurement). The nine still at 0% are
   `bashSpecific`, `isScript`, `scriptPath`, `isTopLevel`, `isScriptFunction`,
   `isLocal`, `isDeclared`, `isReadonly` and `isAlias`: published by `analyze()`,
   read by nothing, and deliberately not forwarded — the allowlist's own comment
   states the rule is to carry what a reader consumes. **Consequence that remains: a
   fixture in this lane can pass while reading a fact the store never sees**, which is
   the M14 #290 failure mode and is invisible to the fixture suite by construction.
   §Q6 has the per-key table; Round 7 records the correction to this item, which
   previously read "0 of 11 keys" and was written before the four keys were wired.
2. **A single-file analyzer cannot resolve a `source` target to a symbol**, which
   is why `imports`/`references` resolve at both ends on **0 of 44** edges — and
   round 7 replaces the bare 0% with the shape of the 679 corpus edges, because
   "does not resolve" is two opposite findings: **455 (67.0%)** carry a path the
   script computes and no name fix reaches, **133 (19.6%)** name an admitted file
   and resolve by basename today, 36 name a file that is not there, 29 name a file
   the router declined, 25 are genuinely outside the corpus, 1 is `~`-prefixed.
   The binding does not exist at this scope and no single-file analyzer can invent
   it. **Round 3 corrects the reading of the number rather than the number**: the
   previous revision reported 1 of 45 and attributed the shortfall to the
   unbindable targets. Removing the `_try_existing` fabrication took it to 0 of 44,
   which means the one edge that used to resolve resolved *because it was a symbol
   in the same file* — so there is no recall component in this 0% at all. A reader
   pooling this 0% with `calls`' 18.8% would be pooling two opposites.
3. **`calls` resolves at both ends on 18.8% of its edges**, and round 7 splits the
   other 81.2% into three populations that a single rate was hiding — over all 55,218
   corpus edges, not the sample:

   | | edges | share |
   | --- | --- | --- |
   | resolves to a `function` in its own file | 14,058 | 25.5% |
   | **declared by a file this script `source`s by a literal path** | **256** | 0.5% |
   | external — outside the indexed corpus, unresolvable by any analyzer | 40,904 | 74.1% |

   The external 74.1% is not a recall shortfall and is measured as such: an independent
   tree walk finds a declaration for **0** of it. The **256 middle rows are the honest
   residue** — real declarations this corpus holds, currently published with
   `isExternalCommand: true`, and unreachable from a per-file analyzer because
   `analyze()` never sees another file. They are counted here rather than fixed
   because the fix is a cross-file resolution layer (laptop C), and 256 is its size.
   The `isFunctionCall`/`isExternalCommand` split is what makes the class legible
   (13,934/13,934 resolve; 40,808 external do not, bar the one alias case Round 7
   names) rather than a defect in the flag.
4. **`references` duplicates `imports` on the measured sample** — 44 of 44 keys
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
7. **CLOSED in round 8 — the `(( … ))` arithmetic operands now emit `uses`, and what
   remains is the oracle's blindness, not the analyzer's silence.** This entry read
   "roughly 68 of the `(( … ))` arithmetic operands emit no `uses` edge, and the
   dispatch routes `expansion`, `postfix_expression`, `arithmetic_expansion`,
   `simple_expansion` and `c_style_for_statement` to `emitVariableUses` while
   `compound_statement` is not among them". The dispatch now also takes a
   `compound_statement` **whose own text opens `((` and closes `))`**: **+70 `uses`
   edges** on the 400-file sample (`uses` 7,786 → 7,856), **+221** across
   bash-completion's 566 admitted files, **0** symbols, **0** edges of any other type.
   The delta was predicted from the tree before the change and matched exactly, after
   the prediction probe was corrected for a per-statement dedupe that `addRel`'s key
   does not share.
   **What is left, measured:** `deriveBashEdges` does not walk bare arithmetic
   operands either, so **97 of the 121** `uses` edges on those lines are corroborated
   by the oracle and **24 are not** (`probe-bash-arithmetic-oracle.mts`). For those,
   agreement is unavailable as evidence and the justification is a parse fact plus
   bash's semantics. The `((x))`-as-`command` fabrication this entry also names stays
   removed: `isArithmeticOperandCommand` is unchanged, and the new fixture's `forbid`
   rows pin that an arithmetic operand never publishes a `calls` edge.
8. **`overrides` is the weakest label in the lane, and the strongest argument
   against it is that bash has no superclass.** What the measurement settles: all
   **28 of 28** edges point from a later definition to an earlier definition of
   the same name in the same file, and round 3 added the stronger half — **28 of 28
   have both declarations at top level, 0 with one or both inside an `if`/`elif`/
   `case` arm**, which is the shape where "redefinition" and "mutually exclusive
   alternatives" would differ. All 28 targets are `function` symbols. What it does
   not settle: bash has no inheritance, so "override" is a *replacement* in the
   same scope, not a polymorphic dispatch against a base type. A reader wanting
   "which function shadows which" is served; a reader expecting override semantics
   is not, and the edge does not claim to be that.
9. **`exports` points at shell variables, not module exports.** By symbol kind on
   the measured sample: `constant` 183, `variable` 26, `function` 1 — so **209 of
   210 `exports` edges publish a variable into the environment of child
   processes**, which is what bash's `export` does, and one publishes a function
   (`export -f`). That is not the same act as a JavaScript `export`, and the edge
   is honest about the language but the label is a shared-ontology approximation.
   The oracle corroborates the same rule, so this is a convention question rather
   than a lane defect.
10. **1 `calls` edge names no runnable command** and is carried deliberately:
    `*` @gimme:940. **This entry was 4 edges last round and the correction is the
    result, not a re-observation.** The previous revision said "every structural
    guard that would remove them costs more real calls than it saves", which was
    measured for guards B and E and generalised past them. Round 3 measured a sixth
    candidate keyed on the POSITION of the damage rather than its presence, and its
    cost is **0 real calls on 400 files and on 1,200**, so 3 of the 4 are removed.
    The 4th survives because it carries no damage to key on.
11. **24 of 400 sampled files contain at least one damaged command region, and 89
    `calls` edges come from one.** This is a pinned-grammar limit, not an analyzer
    limit: bash-completion's generated `completions-core/*.bash` nest extglob
    inside `[[ == ]]` patterns, and `dart-sdk` files abort the wasm parser with
    `memory access out of bounds`.
12. **The differential cannot see a shared grammar bug.** `deriveBashEdges` walks
     the same pinned wasm. Coverage of 1,657 of 1,657 oracle edges with 0
     unexplained is agreement about the tree, not about bash. Three separate
     fabrications in this lane — the two arithmetic operands round 2 removed and
     the dependency edges round 3 removed — were all the grammar misparsing, and
     the oracle either agreed or was silent, so none of them could have been
     caught. All three were caught by asking what the edge TARGETS were, and the
     third by reading the census's own example rows.
13. **Both measurements are samples, and one is a hash-ordered sample of 400 of
    4,012 admitted files.** Hash order is deterministic and does not favour any
    repository's naming, but it is not a uniform draw of tokens or of bytes, and a
    repository with many small scripts is represented more than a repository with a
    few large ones. The gate's 4,012-file figures are quoted alongside every census
    figure for that reason.
14. **The census sample is reproducible only against a pinned corpus.** Round 2's
    numbers moved when the shared corpus grew from 3,174 to 4,012 admitted files,
    and two of them moved in opposite directions, because adding files changes
    which files sort into the first 400 of a hash order. Round 3 re-ran the census
    on the current corpus and **reproduced round 2's denominators and its
    per-type counts exactly** (400 / 48 repos / 4,012 / 441,259, and calls 5,150 /
    uses 7,947 / contains 3,697 / imports 45 / references 45 / exports 210 /
    overrides 28 before this round's own −5), which is what a pinned-corpus claim
    should look like. A reader re-running it against a different corpus should
    expect different numbers and should not read that as a regression.
15. **The ontology coverage gate's per-type totals are NOT reproducible run to
    run, on an unchanged commit and an unchanged corpus.** Two runs of
    `npx tsx script/m14/ontology-coverage-gate.ts bash` gave `calls` 53,443 vs
    53,481, `uses` 78,404 vs 78,425, `contains` 35,743 vs 35,769. The pinned wasm
    aborts with `memory access out of bounds` on whichever files it reaches, the
    set of files differs between runs, and one run ended in `[BB-HANG] parser
    stuck 120s` and exited early. **No two of the ten error paths the two runs
    reported are the same.** Every per-type gate figure is therefore a range, and
    the census figures are the ones to quote — `census-bash-ontology.ts` goes
    through `parseFile`, reported 0 parse failures on the same 400 files, and
    reproduced exactly. This is a limitation of the instrument, stated here rather
    than hidden by quoting whichever run was more convenient. **Reported, not
    fixed** (§8): the gate is shared machinery.
16. **10 `contains` edges and 10 symbols have an owner equal to their own name**,
    and round 3 traced every one rather than guarding against the shape. The
    census's self-edge tally finds 73 self-edges on the 400-file sample — `calls`
    54, `overrides` 8, `contains` 10, `uses` 1 — and only the `contains` ten are a
    problem, because a symbol cannot lexically contain itself. Two distinct causes,
    both verified on the tree with `probe-bash-owner-stack.mts` and an
    ancestor-chain dump:
    - **8 are a grammar artifact.** `ohmyzsh/lib/clipboard.zsh` has an
      `if`/`elif` chain defining `clipcopy` in every branch, and the pinned wasm
      cannot parse it: it nests
      `function_definition clipcopy @67-67` INSIDE
      `function_definition clipcopy @64-108`, so the inner one is attributed to the
      outer. The function stack itself is balanced (26 pushes, 26 pops, 0 nameless
      definitions, depth 0 at end), so this is not the desync it looks like.
    - **2 are real bash shadowing.** `consul/build-support/functions/10-util.sh`
      has `function ui_version` at 597-615 and a `local ui_version="$(…)"` at 612.
      A function that shadows its own name is ordinary bash, and the edge is true.
    A guard refusing `owner === name` would delete the two true edges and still
    leave 8 false ones, because the grammar would keep nesting them. **No guard
    was added**: the defect belongs to the pinned wasm, and the residual is
    reported here instead. What it costs a consumer is stated plainly — a
    `contains` self-loop is not answerable, and 8 of the 10 exist only because of a
    parse the analyzer did not choose.
17. **A measurement of my own making was invalid before it was fixed, and the way it
    was invalid is worth recording.** The round-6 A/B was to be taken by stashing
    the analyzer change, measuring, and popping. The tree was already committed at
    that point, so `git stash push` was a **no-op** — and the "before" run silently
    re-measured the *fixed* analyzer and returned numbers **byte-identical** to the
    "after" run. The re-run used `git show <parent>:src/ast/real-bash-analyzer.ts`
    instead. Two things follow. First, an A/B whose two arms return identical
    numbers is not a null result, it is a measurement that did not run, and only
    the suspicion that 4,187 attributed edges could not appear from nothing caught
    it. Second, the `git stash pop` in the same command **popped a different
    lane's stash** — `On analyzer/PROTOBUF: protobuf-lane: pre-merge, files I do
    not own` — because a worktree's stash list is the repository's, not the
    branch's, and six lanes share one object store. It conflicted on
    `docs/DOC-TRUTH-EMISSIONS.md` and left three `validation/m14/results/*.json`
    files staged. Those were restored from `HEAD` and the stash entry was left
    intact; nothing was lost and nothing of another lane's was committed, but
    **a bare `git stash pop` in this worktree is not safe** and the recovery is
    recorded here so the next agent does not have to rediscover it.
18. **The round-6 fix cannot be verified by the differential**, and it is worth
    being exact about why rather than reporting the differential's green as if it
    covered the change. `deriveBashEdges` publishes no `targetResolution` on any
    edge, so a second pass that adds `targetResolution` to 4,187 edges is
    invisible to it by construction — the coverage numbers before and after are
    identical because the oracle has no opinion to disagree with. The evidence
    that the fix is correct is the fixture (fails pre-fix, passes post-fix), the
    three mutants, and the before/after corpus counts in
    [Round 6](#round-6-the-attribution-was-a-function-of-where-the-read-sat-in-the-file),
    not the gate.
19. **The round-7 classification fix is also invisible to the differential**, for the
    same structural reason and it is worth stating as its own item rather than
    assuming the reader will connect it to item 18. `deriveBashEdges` publishes no
    `isFunctionCall` and no `isExternalCommand` on any edge, so adding those keys to
    223 edges cannot move a coverage number: the edge set is byte-identical before
    and after, which is exactly what makes the defect dangerous — a tool that
    compares edge SETS sees nothing. The evidence is the fixture (fails pre-fix at
    23 pass / 1 fail), the three mutants, and the before/after census row.
20. **An alias's classification rests on walk order rather than on a rule**, and
    round 7 found this by looking for a disagreement rather than by reading the code.
    `collectFunctionNames` is a pre-pass over `function_definition` nodes, so a
    function is classified correctly wherever it is declared; an **alias** is added to
    `localFunctions` during the walk (`:1847`), so an alias declared *above* its use is
    classified by the pre-pass-plus-walk and one declared *below* its use is classified
    by whichever has been seen so far. In the one corpus case
    (`ohmyzsh/plugins/mvn/mvn.plugin.zsh`, `alias mvn` at line 44, call at line 30)
    both mechanisms give the right answer — a shell alias does not expand
    retroactively — so the class has no measured defect. It is declared because the
    correctness is incidental, and an alias whose expansion *did* apply retroactively
    would be misclassified with nothing to catch it.
21. **The metadata-survival instrument in this lane's own census was wrong for several
    rounds, and the error ran in the direction that made the lane look worse.** It
    counted a metadata key's PRESENCE as publication; `readonly x=1` publishes
    `isExported: false`, a correct negative, so `isExported` read 86.7% when its
    affirmative survives at 100%. Two consequences worth carrying: an instrument that
    reports a defect where there is none costs credibility as surely as one that hides
    a real one, and for a boolean flag whose consumer tests `=== true` the two
    questions have to be asked separately. The census now reports both columns and
    `probe-bash-exported-symbol-survival.mts` measures per symbol rather than per file.
22. **A ruling in this lane is only as strong as the population instrument A ran on,
    and this lane's usual sample is too small for it.** The 400-file hash-order sample
    yields **144** distinct node types; the whole corpus yields **164**. The three RULED
verdicts are therefore quoted against 164 and the difference is stated rather than
   averaged away. A future corpus that adds a node type expressing a supertype would
   falsify all three at once, which is the correct behaviour and the reason the gate
   computes the inventory over every admitted file.
23. **The arbiter's headline number depends on its sample size, and at the sample size
    its own usage line suggests, this lane reads 6/10.** `firing-check.ts --files 120
    bash` reports `6/10 fired` with `overrides` absent; `--files 400` agrees; at
    `--files 2400` and at the whole corpus it reports **7/10** with `overrides` firing.
    The cause is arithmetic, not a defect: `overrides` requires a function
    redefinition and the census measures those at **28 edges in 4 files of 4,133**
    admitted (0.097%), so a 400-file draw expects **0.39** such files and reading zero
    is the expected outcome. Recorded because a reader who runs the arbiter at 120
    files and compares it with this file's "7/7 applicable" has two correct numbers
    and no way to reconcile them, and the reconciliation is three lines of arithmetic.
    The independent confirmation is `incoming-check.ts` over 6 corpus files, where
    `overrides` fires with 24 edges and 3 distinct declarations.
24. **The closing half of the round-8 arithmetic predicate has a population of 5, not
    the 0 this entry used to claim, and all 5 are grammar damage.** The previous
    revision said "the predicate excludes 792 `compound_statements` and **0** of them
    open `((`, so no mutant covers it". The zero was a 400-file artifact: over every
    admitted file the predicate excludes **7,495** `compound_statements` and **5** open
    `((` without closing `))`. That is enough population to write the mutant, so the
    mutant was written — and **survived**, because the correct answer and the mutated
    answer are the same on all five. The reason is measured per node rather than
    argued: **5 of 5** contain an `ERROR` or `MISSING` node with the `(( … ))` operand
    text inside it, **3 of 5** contain no operand node at all, and **0 of 5** take a
    `variable_name` from the arithmetic prefix (the two that hold one take it from the
    `&&`/`;` tail — `comp_files` at `cask.plugin.zsh:20`, `typeset` /
    `ZSH_AUTOSUGGEST_COMPLETIONS_PTY_NAME` at `config.zsh:95`). The shapes are zsh's
    `$+commands[…]` and `${+VAR}`, which the pinned **bash** grammar cannot read. The
    closing test is therefore KEPT — it refuses exactly the damaged shapes — and the
    mutant is deleted with the measurement recorded in `mutants-bash-lane.mts`'s
    header, per that file's existing `printf -v` precedent. Three counters
    (`opensOnlyWithOperand`, `opensOnlyWithoutOperand`, `opensOnlyDamaged`) are printed
    on every run of `probe-bash-arithmetic-operands.mts`, so a future corpus with a
    *readable* unterminated `(( … ))` makes the mutant writable instead of leaving the
    next agent to rediscover this.
25. **RETRACTED in round 9 — this entry said a whole-corpus bash measurement cannot
    be taken in one process, and it can.** It is kept because the correction is the
    evidence, and because the shape of the error is the reusable part. The entry
    read: over all 4,133 admitted files, a probe calling the pinned parser directly
    could not parse 3,634 (87.9%), the breakdown was "progressive within one
    process", and `parseFile` catching the same error and substituting a degraded
    result was why the census printed `parse fail: 0` — "it describes the files the
    wasm reached, and the count of files it did not reach is not printed next to it".
    **None of that holds.** The probe was borrowing `ASTEngine.getParser("bash")`,
    the engine's shared handle, and interleaving two users of it; it reads exactly
    **499 files whatever the corpus size** (900 → 401 unparsed, 4,133 → 3,634
    unparsed), which is a fixed capacity in the instrument, not a threshold in the
    corpus. With a private parser, production `parseFile` over every admitted file
    reads **4,131 of 4,133** with the grammar, answers **2** by fallback, and takes
    **0 relationships** from those two; instrument A reads **4,133 of 4,133** with
    0 throws. The census now prints `grammar-read` and `FALLBACK` on every run so the
    "not printed next to it" defect cannot recur. **Method note worth keeping: the
    plausible mechanism I proposed first — a wasm heap leaked by a missing
    `tree.delete()` — was also wrong**, and `probe-bash-wasm-tree-lifetime.mts`
    measures it: a private parser with no `delete()` reads 2,500 of 2,500 files with
    0 throws and rss flat at 239 MB. Both stories fit "breaks down after roughly 500
    files", and both were about the instrument. **A constant in a probe is not a
    threshold in a corpus**, and the way to tell them apart is to run the probe at
    two corpus sizes and check whether the absolute number moves.
26. **19.8% of the `uses` edges on arithmetic lines have no oracle counterpart**, so
    the differential cannot vouch for round 8's class
    (`probe-bash-arithmetic-oracle.mts`, 121 edges on 83 operand lines across 32
    corpus files: 97 corroborated, 24 not). `deriveBashEdges` does not walk bare
    arithmetic operands either, so this is DERIVATION debt inside a type that is
    otherwise audited, and it is the same shape as the `for`/`read` implicit-binding
    debt below: two implementations agree on what they both read and are both silent
    about what neither read. The justification for those 70 edges is a parse fact — a
    `variable_name` under a `(( … ))` `compound_statement` — and bash's semantics, not
    a second walker.
27. **A number in this file was wrong because a 400-file sample was labelled as a
    whole-corpus count, and only a second run at a different size exposed it.** The
    `compound_statements` the predicate excludes read 948 in a section headed
    "whole corpus"; it is 7,495, because that run had reached 499 files. The
    arithmetic-operand table in the same section read 104 compounds and 150 operand
    nodes against a true 834 and 1,139. A sample is a legitimate denominator when it
    is labelled one; the failure was a label, and it survived eight rounds of review
    because every number in the table was individually plausible. The defence that
    worked was arithmetic, not inspection: 900 − 401 and 4,133 − 3,634 are both 499,
    and a quantity that does not change when the corpus doubles is not measuring the
    corpus. **Round 9 re-ran every headline number at `--all` for this reason, and
    the sample-based column is now labelled as the sample it is.**

28. **Round 11: a 400-file sample hid two defects and a rule the sample agreed with
    was never a verified rule.** The two were opposite in kind. `calls` to a name
    declared as a function once and a variable as well — **105 whole-corpus edges** —
    has an expected count in 120 files of 0.13, so P(seeing one) is **12.3%** and the
    sample read 0 by arithmetic, not by luck; `exports` pointing at a declaration that
    does not exist at the row it names — **29 of 96 ambiguous edges** — had an expected
    count of 1.8 in 120 files, so P(seeing one) is **83.3%** and the sample saw 2
    ambiguous `exports` edges in which the export statement and the declaration were
    the *same statement*, so the rule and the coincidence agreed every time the
    instrument could look. A rule an instrument never contradicts is not a verified
    rule; it is a rule with no negative case. The generalisation is the one worth
    keeping: **prevalence bounds how badly a sample will mislead, and P(0) in n files
    is (1−p)^n** — so a defect's sample-visibility is a property of the defect, and a
    defect that is invisible at 400 files is invisible at 4,000 for the same reason.
    What caught both was running the same instrument at 4,133, and what caught the
    `exports` retraction was checking one file by hand before writing the number down.

29. **The 959 `uses` edges that decline are a correct answer and are not a defect,
    but a consumer that only reads `targetLine` will read them as unresolved.** They
    publish `targetResolution: "ambiguousInFile"` and no line, because the name is
    declared several times in the file and none of the declarations is in effect where
    the edge points — `consul/test/integration/connect/envoy/helpers.bash:60` reads
    `status`, declared at 910 and 954, from line 60. Publishing the nearer of the two
    would be an invented attribution, so the row says what it saw instead. **A
    reverse walk that requires a line cannot distinguish "declined" from "never
    looked",** and nothing in this lane's published data makes that distinction for it
    beyond the presence of the key. Fixing that is a consumer-side change (laptop C's
    resolution layer), not a schema change, and it is named here rather than left as a
    footnote because 959 is a number a reader will otherwise have to discover.

30. **5 whole-corpus `calls` edges still publish nothing, and they are external — but
    the count is not zero by construction and a future corpus could make it non-zero
    for a different reason.** All five have `isFunctionCall: false` and
    `isExternalCommand: true` and name a binary whose name a local variable also
    carries (`xargs` in `ohmyzsh/plugins/pip/pip.plugin.zsh`, `key` in
    `Paket/completion/paket-completion.zsh`, `name` in
    `kubernetes/cluster/gce/util.sh`). `isFunctionCall` itself is sound on this corpus:
    **14,057 of 14,057** `isFunctionCall: true` edges have a published `function` symbol
    of that name. The limitation is that this lane's only defence against the *other*
    case — a name that is a local function yet published as no function symbol — is the
    published symbol table itself, and that table is produced by the same analyzer the
    flag is about. A grammar that stopped emitting a `function_definition` node would
    make the flag and the table agree on a wrong answer, and nothing in the flag would
    report it.

31. **Round 12: three of this file's numbers were wrong because a prediction and a
    measurement were each read off an instrument that was itself wrong, and in two
    cases the instrument had never been contradicted.** The array-element probe
    adjudicated on the bare name where the analyzer keys on `(owner, name)`
    (predicted 3, measured 5); it then printed "use-before-assign: correct" for reads
    BD11's file-level contract classifies wrongly; then it never popped its owner
    stack (predicted 58 whole-corpus, measured 45). The first and third were caught by
    arithmetic — two instruments disagreeing — and the second by reading the field's
    own documented contract before believing the adjudication. **The generalisable
    statement: an instrument that has never disagreed with a measurement has not been
    tested**, and the way this lane's instruments got tested was building a second one
    and watching the two numbers differ. The probe now carries `--base` and `--verify`,
    so a prediction can be re-checked against the analyzer as it now stands, and
    `ab-round12-array-and-bd11.ts` classifies a MOVED edge separately from a DROPPED
    one, because `addRel` keys on the line and those two share a signature.

32. **The array-element population is 13.6% of every assignment's LHS, and the shape
    census is the only reason that is known.** 5,474 of 40,170 `variable_assignment`
    nodes carry a `subscript` LHS, in 123 files — so this is the largest single class
    of missed declaration this lane has found, and it was found by asking what shape
    an LHS can take rather than by looking for the symptom. The census enumerates LHS
    shapes rather than assuming one, so a sibling shape with its own population would
    appear as its own row: **the pinned grammar produces exactly two LHS shapes for an
    assignment, `variable_name` (34,696) and `subscript` (5,474)**, which is what makes
    "the fix covers `subscript`" a closed claim rather than an assumption. What the
    census cannot see is a construct the grammar produces no node for at all — the same
    blind spot instrument A carries for the three RULED types, and the reason those
    rulings also carry instrument B.

33. **421 of 4,133 admitted files (10.2%) carry 2,294 tree-sitter ERROR nodes — a
    successful parse of a damaged region, which is a different instrument from the
    census's 0 parse failures.** Both numbers are in this file and the two are
    routinely conflated. For the population this round touched specifically the effect
    is bounded and measured: 19 of the 123 files holding an element assignment are
    zsh-syntax files (`ohmyzsh`, `nvim-treesitter/tests/query/highlights/zsh`) whose
    trees are damaged enough that `${(P)key}` and `commit:type` do not parse as bash.
    **The sentence this entry used to end with — "a damaged region publishes no
    declaration" — is FALSE, and round 13 measured the counterexample: 427 of the
    6,773 whole-corpus `function_definition` nodes (6.3%) have their name node inside
    a tree-sitter ERROR span, production `parseFile` publishes 427 of them, and all
    427 are real declarations.** The property is right about COMMANDS — a damaged
    region publishes no command, and the analyzer does not invent the ones the grammar
    withheld — and wrong about DECLARATIONS, which is the half that matters for
    symbol counts. See [Round 13](#round-13-the-property-that-was-false-and-the-guard-that-would-delete-427-declarations). So
    **a future grammar that recovered better would raise the symbol count and lower
    the ambiguity count**, and the A/B is the instrument that tells those two apart.

34. **One whole-corpus `contains` edge names a declaration the production pipeline
    deletes, and the deletion is in shared machinery this lane does not own.**
    `vault/.github/scripts/install-cob.sh` declares `this=$1` inside `usage` at line 7;
    `analyze()` publishes 86 symbols on that file including `this`, and `parseFile`
    publishes 85 without it. `keepSymbol` in `src/ast/pool-worker.ts` drops it because
    `this` is on that function's `UNIVERSAL` denylist — and bash does not reserve
    `this`, it is an ordinary identifier (`this=$1` is how this very file names its own
    script). The result is a `contains usage -> this` edge whose target is not a symbol
    in its file, which is the one row the whole-corpus census's label check reports.
    **The same comment in the same file records moving `this` OUT of the denylist**
    because lua declares `local this`, so the two halves of that comment now contradict
    each other. Reported, not edited (§8): the cost measured on this corpus is 1 symbol
    and 1 dangling edge; the generalisation is a name that is a keyword in one parsed
    language and an ordinary identifier in another, and the denylist's own
    justification ("no lane has produced a counterexample") is now falsified by one.

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
| hash-ordered sample used for the ontology census above | 400 | see `census-bash-ontology.ts` | — | **4,101** | **17,117** |

A large fixed cost per file plus a size-dependent cost. **No target budget is
defined**, so these are measurements, not a verdict — the previous doc's
"1,020 ms / 29.4 files per s" came from a 30-file corpus and is not comparable.

**Payload budget.** The reserved-word guard is a net **reduction** in emitted
edges: the gate's `calls` count moved 44,986 → 44,704 while the admitted corpus
grew 3,161 → 3,174 files, so the guard removed more than the corpus added. No
lane's graph grows because of this change, and no shared budget file was touched.

## Regex inventory

**Zero, and it was not zero for one round.** All 12 baseline regex usages were
replaced with structural AST handling:

- positional/special parameter detection → `variable_name` / `special_variable_name` children
- `$VAR` / `${VAR}` name extraction → `simple_expansion` / `expansion` / `subscript`
- `curl | bash` → pipeline command-name walk
- `rm -rf /` → `rm` argument words
- alias name → `=` index arithmetic on the `concatenation` word
- trap handler → quote stripping via char-code checks on `raw_string` / `string`
- `set -e` → flag-word character scan (`-o errexit` pair included)
- shell-identifier test for declared names → char-code loop beside `isCommandNameText`

Round 2 then added three regex literals and this section kept saying "None":
`/^\(\(/` and `/\)\)$/` and `/^\$\(\(/`, all in `isArithmeticOperandCommand`.
`script/m12/verify-regex-census.ts` reported all three as `MISSING` against the
committed blobs — a gate failure attributable to this lane, present in the shipped
`analyzer/BASH`, and recorded nowhere in this document. Round 3 replaced them with
`opensWithDoubleParen`, `opensWithArithmeticExpansion` and `endsWithDoubleParen`,
and `scanAnalyzers("src/ast")` now reads **bash 0**.

Two things are worth keeping from that. First, `isShellIdentifierName` states in
its own doc comment that it is a char loop *because* "the M12 contract probe asserts
the analyzer source contains NO regex literals" — so a second function in the same
file citing a different convention is not a neutral style choice, it is a
contradiction of a stated reason. Second, the gate that was supposed to prevent
this did not prevent it: it reported the three rows as `MISSING` and the lane still
merged with a doc asserting zero. A gate nobody reads is the same as no gate,
which is why the count is now quoted from the instrument
(`scanAnalyzers`) rather than from this prose.

## Supported constructs

Functions (both `name()` and `function name`), function parameters,
`local`/`declare`/`typeset`/`readonly`/`export`, arrays (`ARR=(…)`, `declare -a`,
**and `ARR[i]=value`, which declares the array — round 12**),
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
| Ontology census, **WHOLE CORPUS** | `npx tsx validation/m14/fixtures/bash/census-bash-ontology.ts --all` | **ROUND 10: 4,133 admitted / 462,809 scanned / 120 repos; 7 types emitted, 178,396 relationships, 42,403 symbols, 0 parse failures, `grammar-read 4,130`, `FALLBACK 3` contributing 0 relationships.** Per type: calls 55,222 · uses 81,485 · contains 38,264 · imports 679 · references 679 · exports 1,929 · overrides 138. Resolution: contains 100.0% · overrides 100.0% · exports 99.9% · uses 79.1% · calls 26.7% · imports/references 0.0%. **`neither` 0 on every type**; 0 empty names, 0 unknown kinds, 0 `unknown`/empty endpoints, 0 edges below 0.7 conf. **Per-type FILES (exact, round 10): calls 3,733 · uses 3,261 · contains 3,352 · imports 489 · references 489 · exports 647 · overrides 48** — round 9's run of the same command read 178,463 rels / 42,418 symbols, i.e. this row reproduces round 9 to 0.04% |
| Determinism, 8 runs on one fixed 800-file sample | `npx tsx validation/m14/fixtures/bash/census-bash-ontology.ts --sample 800` ×8 | **6 of 8 read exactly 32,317 relationships; 2 read low by 325 and 28** (31,992 / 32,289). Not the cached wasm copy — `/tmp/bb-ts-core.wasm` deleted between runs 4 and 5, run 5 still low, run 6 back to 32,317. The 4 fixed-point runs recorded `FALLBACK 0`, `grammar-read 800`. A single run is a **lower bound**; the fixed point is the value to quote. Round 10 does not settle the mechanism — see round 10 |
| Per-file relationship count | `npx tsx validation/m14/fixtures/bash/probe-bash-one-file-rels.mts <file>…` | round 10's three FALLBACK files through `parseFile`: `set-go-memory-limits.sh` 1 symbol / **2** rels · `verify-replication-status.sh` 14 / **62** · `split-speedtest1-script.sh` 6 / **22**. Neither 2, 62 nor 22 is the 67-edge corpus delta, so "one extra fallback file" does not explain it |
| Firing arbiter, the workstream's sample size | `npx tsx script/m14/firing-check.ts --files 120 bash` | **`106/120 files parsed, 6/10 fired, 4,294 edges, 0 degraded, analyzer stable`** (round 11: 4,293), fired: `calls` 1,119 · `uses` 2,100 · `contains` 991 · `imports` 19 · `references` 19 · `exports` 45. `overrides` reads **0** at this size against 138 edges in 48 files corpus-wide — priced at P(0)=24.6% in round 10. 0 empty names, 0 empty/unknown kinds, 0 `unknown` endpoints, 0 edges below 0.7 conf on every type |
| Incoming arbiter, 5 named corpus files | `npx tsx script/m14/incoming-check.ts bash <5 files>` | 189 symbols. `calls` 194 edges / 22 distinct targets / 0 ambiguous / 151 unresolved · `uses` 278 / 73 / 0 / 26 · `contains` 184 / 137 / **2** / 0 · `imports`,`references`,`exports`,`overrides` 0 on these five. **1** target resolving to >1 published symbol (`have` → function, variable). 137 declarations named by at least one edge, **5 orphans of 189** |
| Ontology census, 400 hash-ordered files | `npx tsx validation/m14/fixtures/bash/census-bash-ontology.ts --sample 400` | **ROUND 5**: 4,130 admitted / 458,446 scanned / 48 repos in sample; 7 types emitted, **17,009 relationships**, 4,186 symbols, 0 parse failures, 0 empty names, 0 `unknown` endpoints, 0 empty endpoints, 0 unknown kinds. Per type: calls 5,099 · uses 7,802 · contains 3,782 · imports 44 · references 44 · exports 210 · overrides 28. **Superseded for every headline figure by the `--all` row above**; retained because it is the sample the A/B pairs share |
| Whole-corpus arithmetic operands (round 9 re-derivation) | `npx tsx validation/m14/fixtures/bash/probe-bash-arithmetic-operands.mts --sample 4400` | **0 unparsed** (was 3,634); 351 files with an arithmetic `compound_statement` (was 41), **834** `compound_statements` (was 104), **1,139** operand name nodes (was 150), **995 already published** (was 137), **0 predicted new edges**; 7,495 excluded (was 948) of which **5** open `((` unclosed, **5 of 5** ERROR/MISSING, **3 of 5** no operand node, **0 of 5** operand from the arithmetic prefix |
| Tree-lifetime A/B (the mechanism) | `npx tsx validation/m14/fixtures/bash/probe-bash-wasm-tree-lifetime.mts --files 2500` | **0 threw, rss flat at 239 MB with no `delete()` at all** — falsifies the leaked-heap hypothesis and localises the fault to the shared parser handle. With `--delete` and `BASELINE_THREW`, adjudicates explicitly and exits non-zero if `delete()` does not improve on the baseline |
| Round-3 adversarial probes | `npx tsx validation/m14/fixtures/bash/adversarial-probes3.ts --sample 400` | duplicate symbols **10**, all `function`, in 5 files, all real re-declarations; self-edges **73** (`calls` 54 / `overrides` 8 / `contains` 10 / `uses` 1); `exports`→symbol 210/210, 0 orphans, `exportForm` function 1 resolving to a function; `overrides` both-declarations-top-level **28/28**; reserved-word leak **0**; `calls`→own-variable **3**, the same 3 pass 2 adjudicated as correct; `INTERPRETED_COMMANDS` command nodes in command position **580**, reaching its gate **0** |
| Guard F A/B — the defect's cost | `npx tsx validation/m14/fixtures/bash/guard-f-bash-imports.mts --sample 400` and `--sample 1200` | F2 removes **5 edges in 1 file with 0 real calls**, identically at 400 files / 48 repos and 1,200 files / 76 repos; F1 removes 5 but fires on valid bash; F3 removes 20 of which **15 are real** `kube::log::status` calls in gubernator.sh |
| Guard F soundness — 39 node shapes | `npx tsx validation/m14/fixtures/bash/guard-f-soundness.mts` | F2 fires on **0** valid-parse command nodes; F1 fires on **1** (`awk one two ) three`) and is rejected. Exit code 0 |
| Owner-attribution stack | `npx tsx validation/m14/fixtures/bash/probe-bash-owner-stack.mts <file>` | pushes == pops, **0** nameless `function_definition`, stack depth 0 at end — the self-owned declarations are genuine tree nesting, not a stack desync |
| Parse-tree dump | `npx tsx validation/m14/fixtures/bash/probe-bash-tree3.mts <file> <from> <to>` | the instrument every `)`-adjacency claim above was read off, printed with node types and columns |
| Grammar inventory (instrument A) | `npx tsx validation/m14/fixtures/bash/probe-bash-grammar-inventory.mts --sample 400` | **144 distinct node types**; `extends`/`implements`/`instantiates` → NONE |
| RULED-construct probes (instrument B) | `npx tsx validation/m14/fixtures/bash/probe-bash-ruled-constructs.mts --sample 400` | parse-tree **0/0/0**; lexical 7/5/0 = **12 rows over 7 sites, every row a `#` comment line**; dynamic doors 42/11/8 |
| Guard A/B | `npx tsx validation/m14/fixtures/bash/guard-ab-bash-calls.ts --sample 400` | A 30→0 implemented; B 108 rejected; C 0; D 0; E 18 rejected. **Pass-1 denominators; not re-run in round 3** |
| Fixtures | `bun run script/m14/run-fixtures.ts --lang bash` | **ROUND 10 re-run: 25 pass, 0 fail** (round 6 read 23; `bash/order-independent-attribution` is new — and it **FAILS against the pre-fix analyzer**, 22 pass / 1 fail, so it pins the defect rather than the fix) |
| Pass-2 adversarial probes | `npx tsx validation/m14/fixtures/bash/adversarial-probes.ts --sample 400` | unresolved-target decomposition: **0 missed declarations** on `calls` and on `uses`; 0 bash builtins named by a call; `imports`/`references` overlap **44/44 both ways**; `overrides` **28/28** have an earlier definition; `exports` targets by kind constant 183 / variable 26 / function 1; confidence `calls` {1.0: 5129, 0.7: 18}, `uses` {0.8: 7947} |
| Lane source mutants | `npx tsx validation/m14/fixtures/bash/mutants-bash-lane.mts` | **ROUND 10 re-run: 25 mutants, 25 caught, 0 survived, 0 did not apply** (round 6 read 19/19) |
| Shared mutant registry, bash slice | `BB_MUTANT_ONLY="bash/" bun run script/m14/mutate-analyzer.ts` | filtered 1,723 → **23, all 23 caught, 0 survivors** |
| Ontology coverage gate | `npx tsx script/m14/ontology-coverage-gate.ts bash` | **7/10 emitted, 3 RULED-SOUND, 0 FALSIFIED, 0 ruled-without-justification** — round 12. calls 55,240 · uses 81,531 · contains 38,325 · imports 677 · references 677 · exports 1,929 · overrides 138; all three RULED rows cite 164 grammar node types and `script/m14/bash-ruled.ts`. One `[BB-PARSE-ERR] … memory access out of bounds` and one `[BB-HANG] parser stuck 120s`, **both on `docker/hack/make/dynbinary`**, then exit — rounds 3, 7, 9 and 11 each recorded the same class on a different file, which is the instrument property rather than a lane verdict — so its per-type totals sit slightly under the census on the same corpus (55,212 vs 55,222). See limitation 15 |
| Differential, bash only | `bun run script/m14/differential.ts --lang bash` | **ROUND 12, RE-MEASURED**: `otp` pin, 60 files, `rot 29`, hash `c702d451a42ba71a`: truth **1,686**, covered **1,686 (100%)**, MISSING **0**, analyzer-edges 1,650, unexplained **5 (0.3%), all labelled `contains`**, heuristic **0**. Round 11 read truth 1,688 / covered 1,688 / unexplained 5 on `rot 28`; round 6 read 1,673 / 1,673 / 5 on `rot 22`. The absolute counts move with the cold-pool rotation and **the shape has not moved in three rounds**: coverage 100%, MISSING 0, unexplained 5, all of them the DERIVATION debt below and none of them a fabrication. **The differential cannot see either round-12 defect** — a dropped declaration and a metadata boolean are both absences the oracle never published — which is why both were found by a shape census and a self-contradiction census instead. The run states it did **not** write the F5 artifact, "a scoped run is for inspecting lanes, and writing it here would replace that claim with a smaller one" |
| Round-5 A/B — did the change alter an edge? | `BB_AB_BASE=b2b6ee090 npx tsx validation/m14/fixtures/bash/ab-round5-targetline.ts --sample 200` | `otp`, 115 pinned files: old 7,813 edges, new 7,813 edges, **ADDED 0, REMOVED 0**, 84 metadata-only changes (`targetLine`/`targetKind`/`targetResolution` × 84 each). **PASS**. Written because the differential could not answer it: its cold-pool rotation drew `rot 21`, two consecutive runs are not comparable, and its lane journal is a shared `/tmp` file this lane does not own |
| **ARRAY-ELEMENT ASSIGNMENT — census + prediction + verification** | `npx tsx validation/m14/fixtures/bash/probe-bash-array-element-binding.mts --all [--base <commit> --verify]` | **ROUND 12, whole corpus 4,133 admitted / 462,809 scanned / 120 repos, production `parseFile` for edges and symbols, a PRIVATE tree handle for shape, never shared.** Every LHS shape `variable_assignment` produces: **`variable_name` 34,696 · `subscript` 5,474 (13.6%)**. Sites 5,474 in 123 files; 157 distinct `(file, owner, name)`; **45 unpublished** (32 files), 112 already published. Against `663a7a6d6`: 45 predicted, and **`--verify` reports the working tree publishes 45 of 45, 0 not published** — which is the same 45 the A/B measures as symbols added. Reads of an element-bound name: 150 already classified, **70 misclassified** (44 before the file's first binding of the name, 26 at or after it). Against the working tree the same probe reads **0 unpublished and 0 misclassified**. **The 400-file sample saw 19 of the 5,474 sites and 5 of the 45 declarations — it understated the population by 288×**, which is why this row is the `--all` one. The probe corrected itself three times, each time by disagreeing with a second instrument: bare-name adjudication (predicted 3, measured 5), "use-before-assign: correct" for reads BD11's file-level contract calls wrong, and an owner stack that was pushed and never popped (predicted 58, measured 45) |
| **BD11's `isAssignedInFile` — self-contradiction census** | `npx tsx validation/m14/fixtures/bash/probe-bash-assigned-flag-order.mts [--sample 400 | --all]` | **ROUND 12, production `parseFile`, whole corpus 4,133 admitted / 462,809 scanned / 120 repos, 0 degraded.** `uses` reads **81,534** — flagged **64,514 (79.1%)**, absent **17,020 (20.9%)**; 28,449 distinct `(file, target)` pairs. **SELF-CONTRADICTORY pairs 0** (was 37 in 25 of 400 files). SILENT-WRONG 6 pairs / 51 edges, adjudicated: **5 published only as a function** (absent is CORRECT — `$name` cannot denote a function) and **1 a `#!/bin/sh` polyglot re-execing Tcl** (`sqlite/autosetup/autosetup`, whose 45 `uses -> autosetup` are Tcl reads) — so the residual is **0 wrong answers**. Control: 7,479 correctly-false pairs / 16,969 edges. Flagged on every edge: 20,964. On the 400-file sample the same probe reads 6,285 flagged / 1,571 absent, 0 contradictory, 0 silent-wrong, and the four pair-counts CLOSE: 37 + 15 + 1 = 53 = 2,089 − 2,036. Also reported, and a different instrument from the census's `parse fail`: **421 of 4,133 files carry 2,294 tree-sitter ERROR nodes** |
| **ROUND-12 A/B — did the change alter an edge** | `BB_AB_BASE=663a7a6d6 npx tsx validation/m14/fixtures/bash/ab-round12-array-and-bd11.ts --sample 5000 --expect-symbols 45 --expect-contains 47` | **WHOLE CORPUS, 4,133 files, both analyzers over the SAME bytes through one private tree handle, the old one materialised as a SIBLING module from `git show` (never `git stash`, limitation 17).** symbols 42,425 → 42,470, **ADDED 45, REMOVED 0**. relationships 178,547 → 178,592, **ADDED 47 {contains:47}, MOVED 2, REMOVED 0**. metadata GAINED `isAssignedInFile` 2,154 · `targetResolution` 29 · `targetLine` 28 · `targetKind` 28, **LOST 0**. `isAssignedInFile` gained on 2,154 edges and **LOST on 0** — the post-walk pass can only add it. `calls`/`uses`/`imports`/`references`/`exports`/`overrides` **identical**. **VERDICT PASS against the tree-predicted +45 symbols, +47 `contains`, 0 edges of any other type.** The 2 MOVED edges are the fix working: `ohmyzsh/plugins/gitfast/git-completion.bash` binds `words` by element before `words=(…)` at 3510 and `ohmyzsh/plugins/scd/scd` binds `drank` by element at 367 before `drank=(…)` at 391, so each declaration now sits on the earlier line — which is where it happens. On the 400-file sample the same command reads +5 symbols, +5 `contains`, 0 moved, `isAssignedInFile` gained 249 / lost 0, also PASS |
| **PUBLISHED RESOLVABILITY — whole corpus (round 12)** | `npx tsx validation/m14/fixtures/bash/probe-bash-published-resolvability.mts --all` | **ROUND 12: 4,133 admitted / 462,809 scanned / 0 parse failures.** Applies the fields an edge PUBLISHES to the file's real symbol table. Over **18,837 name-ambiguous edges**: **17,872 resolve to exactly one declaration, 960 decline explicitly, 5 are external, and 0 leave ZERO candidates in any type.** Per type: calls 236 ambiguous → 231 resolve / 5 external / 0 dangling · uses 12,165 → 11,205 / 960 declined / 0 · contains 6,202 → **6,202 (100%)** via the edge's own line · exports 96 → **96 (100%)** · overrides 138 → **138 (100%)**. Round 11 read 18,765 / 17,801 / 959; the +72 ambiguous are names the round-12 declaration fix gave a second declaration to. Per-rule health: `targetLine` 11,532 → 1 candidate 100%, 0 zeros · `overridesLine` 138 → 100% · `edgeLine` 6,298 → **29 zeros** (the retracted `exports` claim, unchanged) · `targetKind` 11,532 → 199 one / 11,333 many · `isFunctionCall` 231 → **231 one-candidate** — round 11's `231 zeros` was the probe's own `"Function"` vs `"function"` literal, and the corrected reading is a NARROWING rule, not a discarding one |
| `isFunctionCall` soundness (round 11) | `npx tsx <whole-corpus walk over production parseFile>` | **`isFunctionCall: true` on 14,057 whole-corpus `calls` edges; 14,057 of 14,057 have a published `function` symbol of that name — 0 exceptions.** This is what separates the 5 residual publishing-nothing `calls` edges (external binaries colliding with a local variable name) from an attribution gap |
| Ontology census, whole corpus, round 12 | `npx tsx validation/m14/fixtures/bash/census-bash-ontology.ts --all` | **178,527 relationships / 42,469 symbols / 0 parse failures / `grammar-read 4,133` / `FALLBACK 0`.** Per type: calls 55,241 · uses 81,534 · contains 38,327 · imports 679 · references 679 · exports 1,929 · overrides 138. Per-type FILES (exact): calls 3,735 · uses 3,264 · contains 3,360 · imports 489 · references 489 · exports 647 · overrides 48. Both-ends resolution: contains 100.0% · overrides 100.0% · exports 99.9% · uses 79.2% · calls 26.7% · imports/references 0.0%. `neither` **0** on every type; **0** edges below 0.7 confidence; 0 empty names, 0 empty/unknown kinds, 0 `unknown`/empty endpoints. Hygiene: module 4,133 · variable 27,413 · function 9,226 · constant 1,697. Round 11 read 178,388/42,420, round 10 178,396/42,403, round 9 178,463/42,418. **The census-to-census delta of +139 is NOT all the round's change and is not quoted as if it were** — `ab-round12-array-and-bd11.ts` isolates the change at **+45 symbols and +47 `contains`**, and the ~+94 residue on `calls`/`uses` is the documented instrument wobble. The 400-file sample reproduces exactly across the round-12 analyzer change — calls 5,097 · uses 7,856 · contains 3,775 · imports 44 · references 44 · exports 210 · overrides 28, total 17,054 on 4,179 symbols, identical before and after |
| Round-12 fixture + mutants | `bun run script/m14/run-fixtures.ts --lang bash` and `npx tsx validation/m14/fixtures/bash/mutants-bash-lane.mts` | **28/28 fixtures pass. 40/40 mutants caught, 0 survived, 0 did not apply** — 6 added this round, covering the dropped `subscript` arm, the owner-blind dedup, `isArray` going false, the flag moving back into the walk, the owner-suffix strip going missing, and the flag being emitted unconditionally (the only mutant here that makes a published edge assert something FALSE rather than omit something). **Both new fixtures FAIL against `663a7a6d6`**, so each pins the defect and not merely the current behaviour: `array-element-binding` on 1 symbol row + 6 relationship rows, `assigned-flag-is-file-level` on exactly 3 rows — the three reads whose binding comes later in the text. Round 11 read 26/26 fixtures and 34/34 mutants, and `bash/exports-resolution-inverted` had SURVIVED its first version there because the fixture asserted one `exports` row while the mutant's own description claimed two |
| Ambiguity — one edge, N declarations | `npx tsx validation/m14/fixtures/bash/probe-bash-ambiguity.mts --sample 400` | **1,879** ambiguous targets across 5 types; **0 irreducible by line** (100% of candidate sets on distinct `startLine`s); nearest-preceding picks exactly one in **1,830 = 97.4%**, 49 tie. Per type: uses 1,185 (19.0% of 6,239 resolved) · contains 658 (17.4%) · overrides 28 (100%) · calls 6 (0.6%) · exports 2 (1.0%). Denominators match the census exactly, which required copying its 512 KB cap and content-form `detectLanguageFromPath` |
| DERIVATION debt — class size | `npx tsx validation/m14/fixtures/bash/probe-bash-derivation-debt.ts --sample 400` | **ROUND 12, RE-MEASURED and UNCHANGED**: implicit-binding symbols published **173** (`for` 125 symbols / 70 files, `read` 48 / 25); `contains` edges naming one **177**, all unexplained by construction; `uses` edges naming one **396**, all resolving; 0 parse failures. Round 5 read 175 / 179 / 400 on a smaller corpus. The oracle in `script/m14/differential.ts` branches on `variable_assignment || declaration_command` only, so it publishes no declaration and no `contains` edge for a `for` loop variable or a `read` target — the fix is one node type plus one option table in shared machinery, reported not edited (§8) |
| Evidence census, every admitted file | `npx tsx validation/m14/fixtures/bash/probe-bash-missing-evidence.mts` | **SUPERSEDED — do not quote.** Its reading was 4,130 admitted, **137,770 edges, 0 with no `evidenceClass`** (calls 55,220 · uses 80,851 · contains 38,273 · exports 1,929 · imports 679 · references 679 · overrides 138). Round 9 shows this probe also walked the borrowed parser and covered ~499 files, so its "every admitted file" label was false. Use the `--all` row. Its *invariant* — **0 edges with no `evidenceClass`, and 0 below 0.7 confidence** — is re-confirmed at 100% by the `--all` run and is the part worth keeping |
| Lane regex census | `npx tsx validation/m14/fixtures/bash/probe-bash-no-regex.mts` | **0 regex literals across 0 of 37 lane files** (analyzer + 31 probes/fixtures/mutants, round 10 — the 32nd is `probe-bash-one-file-rels.mts`). Round 5 fixed the probe's own coverage gap: it had been checking **16** of the lane's 25 files and the 9 it missed now read 0 as well |
| DERIVATION debt | `npx tsx script/m60/rel-type-coverage-gate.ts --langs=bash` — **read the warning in Q6 first** | CHECK 1 DERIVATION **clean**; `baseline: 104 recorded, 0 NEW, 104 repaid`; and the committed `validation/m60/results/rel-type-coverage.json` carries **0 findings and 0 baseline rows naming bash** |
| Regex census (project gate) | `npx tsx script/m12/verify-regex-census.ts` | **Re-run round 9: `regex census gate PASSED`** — 5 entries, HEAD and working-tree scans agree at 5, `missing 0, stale 0, unclassified 0, mislocated 0`. The previous revision of this row said "still `FAILED`, with ZERO rows naming bash" and attributed the 30 MISSING/STALE rows to css, julia, clean, fsharp, javascript, python, svelte and typescript; those are gone from the census and `real-bash-analyzer.ts` is still not among its 5. **This lane's own direct measurement is unchanged and is the one to quote: 0 regex literals across 0 of 31 lane files.** The gate passing is not this lane's work — the lane did not touch the shared census baseline |
| Doc-truth emissions | `bun run script/m14/verify-doc-truth-emissions.ts` | **ROUND 12: `UNDOCUMENTED [bash] calls (relationship)`, reported at `docs/analyzers/real-bash-analyzer.md:142`** — the `parseClaimTable` off-by-one documented below, unchanged and still costing this lane exactly one row. Repository totals `FALSE_NEGATIVE=7 FALSE_POSITIVE=0 UNDOCUMENTED=43 MISSING_DOC=1 NO_CLAIM_TABLE=15 -> FAIL`; **not one of the 7 FALSE_NEGATIVEs is bash**, and the defect cannot produce a wrong verdict, only an under-count |

Supporting artifacts:

- **Grammar node types** — 164 observed over the full corpus, 143 on the 400-file
  sample, 0 dead branches
- **Regex census** — 0 bash usages
- **Spec** — `script/m14/spec/bash-completeness.json` (BD1–BD10, BD8b, BD8c,
  BD11 and per-decision gaps). **BD8's stated evidence is falsified by this
  round's census; its decision is unaffected.** Reported, not edited (§8).
- **Full record** — `reviews/bash/m60-closure.md` (§1–§19a),
  `reviews/bash/resolution.md` (21 claim dispositions, deliberately not `CLOSED`)

**On the honesty gate's 26 failures.** The command is
`npx tsx script/m14/verify-honesty.ts` — **not** `script/verify-honesty.ts`, which
the previous revision of this document cited and which does not exist; the file is
`script/m14/verify-honesty.ts`, and the wrong path fails with
`ERR_MODULE_NOT_FOUND` before a single check runs, which is the shape of error that
looks like a broken gate rather than a broken citation.

Re-run in round 12: **26 failures**, unchanged from round 9's 26 and against 22 in
round 3 — and **not one of the 26 names a bash file as a banned term or a hygiene
failure**, re-confirmed by grepping the whole output for `real-bash-analyzer` and
`fixtures/bash`: zero hits. The two lines a reader would otherwise assume this lane's
evidence rests on both pass, unchanged:
`ok banned-vocabulary lint over validation/m14 + M14 docs` and
`ok M14.0.F8 all-green (24 checks)`. Nine of the 26 are evidence-freshness
("N declared input(s) changed since <commit>"), and two of those declared-input lists
name this lane's files — `script/m14/bash-ruled.ts` under F2 and
`script/m14/spec/bash-completeness.json` under F8 — **because F2 and F8 declare
`script/m14/` and `validation/m14/` wholesale rather than per lane**, so any lane that
commits a probe or a ruling makes both stale for the whole repository. The artifacts
live in `validation/m14/results/*.json`, which §8 puts outside this lane. Reported, not
attempted. Round 9's breakdown follows and its shape is unchanged:

<details><summary>Round 9 breakdown (26 failures, unchanged in count and shape)</summary>

Re-run in round 9: **26 failures**, against 22 in round 3 — and **not one of the 26
names a bash file as a banned term or a hygiene failure.** The breakdown, so a reader
does not have to re-derive it:

| count | what | names bash? |
| --- | --- | --- |
| 14 | banned-term hits in `validation/m14/fixtures/{c,clean,csharp,html,sql}/…`, `validation/m14/grammar-pins.json`, `validation/m14/results/M14.0.{F5,F11.fsharp,JS-CENSUS}.json`, `fsharp-shape-census.json` | **no** |
| 1 | `M14.0.F7` non-passing checks `analyzer-hygiene-cpp`, `analyzer-hygiene-elixir` | **no** |
| 9 | evidence-freshness for F1–F9: "N declared input(s) changed since <commit>" | **structurally yes** |
| 1 | the derived "freshness rule flags every artifact" — a consequence of the 9 above | no |

The freshness row is the one that needs the qualification, and it is not a bash
defect. `M14.0.F2` declares its inputs as `["script/m14/", "validation/m14/fixtures/"]`
— **every lane's fixtures**, not this lane's — so any lane that commits a probe makes
F2 stale for the whole repository. The nine artifacts live in
`validation/m14/results/*.json`, which §8 puts outside this lane, and regenerating
them is shared work. Reported, not attempted. The two lines of this gate that a reader
would otherwise assume this lane's evidence rests on both pass:
`ok banned-vocabulary lint over validation/m14 + M14 docs` and
`ok M14.0.F8 all-green (24 checks)`.

The gate's own lines worth quoting, because they are the ones a reader would
otherwise assume this lane's evidence depends on:
`ok banned-vocabulary lint over validation/m14 + M14 docs` and
`ok M14.0.F8 all-green (24 checks)`.

The `f5_tree_oracle` truth replaced a hand-authored 55-fact file in which every
fact was `authority: manual_audit` and twelve pinned the `global` phantom as
*expected*. A lane whose truth cannot disagree with its analyzer has no
differential; it has a mirror.

</details>
