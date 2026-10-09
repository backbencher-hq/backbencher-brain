# bash lane — the five silent types, and the incoming side

This file records the measurements behind the bash lane's silent-type verdicts and its
incoming-side marker. The analyzer's own long-form record is
[real-bash-analyzer.md](real-bash-analyzer.md); this file exists because the numbers below were
produced by instruments that must be re-runnable, and every claim here names the command that
produced it. The structured form of the same record is
`script/m14/spec/bash-completeness.json` (`_silent_types_measurement`, `_incoming_side`, BD11,
BD12).

## Why a SILENT type is not automatically a defect

`bun script/m14/firing-check.mjs BASH` runs the production path (`getParser` -> `parse` ->
`analyze`) over real corpus files and reports which of the ten relationship types come out. A
type it reports as SILENT has two possible causes and the tally cannot tell them apart:

1. the analyzer cannot express the construct — the construct occurs and no edge comes out (a
   defect);
2. the construct does not occur in the population the instrument read (measured non-occurrence —
   a ruling with a number).

So both sides were counted on the same population: **numerator** = edges emitted through the
production path; **denominator** = sites counted on the PARSE TREE, never on raw text, because a
comment, a heredoc and a `case` arm's pattern are not sites. That last distinction is not
hypothetical: `bash-completion/completions-core/cvs.bash:100` reads `export | ex | exp)` and is a
case arm, and a text scan counts it as an export.

## The instruments

```bash
bun script/m14/firing-check.mjs BASH              # the programme's firing instrument
NFILES=400 bun script/m14/firing-check.mjs BASH   # widest population it can reach
bun validation/m14/fixtures/bash/probe-bash-silent-types.mts --corpus   # 2,962 .sh/.bash files: edges AND tree sites
bun validation/m14/fixtures/bash/probe-bash-export-site-diff.mts        # every export site matched to its edge
bun validation/m14/fixtures/bash/probe-bash-source-path-shapes.mts --nf 60
npx tsx script/m14/incoming-gate.ts bash sh 60
npx tsx validation/m14/fixtures/bash/probe-bash-incoming-split.mts --ext sh --nf 60 --repo-wide
```

## Verdicts

### exports — IMPLEMENTED AND FIRING; the instrument's zero was a sampling number

| measurement | value |
|---|---|
| corpus-wide edges (2,962 files) | **1,598** in 502 files |
| export sites on the tree | 1,548 declaration sites; **1,540 matched by an edge at their line** |
| unmatched sites | **8 — all computed names** (`export "$name=$val"`, `export "_${ucname}_COMPLETE=…"`) |

`firing-check.mjs` reported `exports` silent at `NFILES=120` and `NFILES=300`. Two separate
reasons, both of them the instrument's population rather than the analyzer's emission:

* the pre-fix walk took a DIRECTORY-ORDER prefix, and in `bash-completion` the first
  export-bearing file sits at **walk index 391** (`probe-bash-silent-types.mts` prints the index
  of every construct-bearing file) with the cap at 400;
* after the programme's stride fix, `NFILES=400` fires `exports:3`.

The eight unmatched sites are not a defect. A name assembled from an expansion is not a name —
no symbol can answer to `_${ucname}_COMPLETE` — so those sites emit nothing and are recorded as
the `Computed Export Name` pattern, while the expansion's own `uses` edge carries the
dependency. This is BD4's rule for a computed command word, applied to the declaration
position.

### exports: the quoted-assignment shape (BD11)

`export "NAME=value"` arrives from the grammar as ONE `string` node with no
`variable_assignment` and no `variable_name` beneath it, and the declaration extractor read only
those two shapes — so the quoted form produced no symbol, no `exports` edge and no diagnostic.
That is a latent shape gap, closed in `analyze()`'s declaration path: the literal run before the
first `=` is read from `string_content`/`word`/`raw_string` children (quotes stripped) and must
satisfy `isShellIdentifierName`; a name decided by an expansion returns `null` and emits nothing.
The helper is fail-closed — an unrecognised child shape ends the literal run rather than
contributing to it — so a grammar change makes it quieter instead of wrong.

The fix does **not** change the corpus edge count (1,598 before and after), because no static
quoted site occurs in this corpus; the pinned corpus's two sites of that shape are both
computed. It is pinned by fixture `bash/export-quoted-shape-bd11`, which requires the two static
edges, forbids any target containing the computed name, and requires the `uses` read of the
deciding variable to survive.

### overrides — IMPLEMENTED AND FIRING, 1:1 with its construct

19 redefinition events across 12 files corpus-wide produce **19 edges** (`dark/install.sh` 2,
`kong/scripts/release-lib.sh` 4, `otp/make/test_target_script.sh` 3, `yq/acceptance_tests/basic.sh`
2, …). The instrument reads zero for the same population reason: the first corpus-wide
redefinition sits at walk index 1,271.

### extends / implements / instantiates — RULED INAPPLICABLE, with a mechanical falsifier

| probe | value |
|---|---|
| pinned grammar node types (`Language.load(wasm/tree-sitter-bash.wasm).nodeTypeForId`) | **280**, and NONE of the 20 probed type-declaration/supertype/constructor types occurs in it |
| candidate nodes on 2,962 parse trees | **0** |
| construction keywords in command position | **0** |
| residual: dynamic doors | `eval` 146, `${!name}` 52, `bash -c`/`sh -c` 5 |

bash's only definition construct is `function_definition`, which has no supertype clause, so
`extends` and `implements` are the same absence rather than two arguments; there is no
constructor node type at all for `instantiates`. The dynamic doors are printed because a ruling
that hides its own blind spot is a claim, not a measurement: 203 sites corpus-wide could carry a
relationship no static tree contains.

### unset (BA-G1) — the lane's only open gap, now priced

289 `unset_command` nodes across 122 of 2,962 files. No relationship type expresses unbinding.

## The incoming side

`npx tsx script/m14/incoming-gate.ts bash sh 60` — 60-file stride over 2,360 tracked `.sh`
files in 117 repositories:

```
before:  FAIL — 188 ambiguous + 855 unresolved of 2,590   markedExternal 0
after:   FAIL — 188 ambiguous + 845 unresolved of 2,590   markedExternal 10, externalRefuted 0
```

### The marker that was withdrawn

A first, wider rule marked every call in a file containing no `source`/`.` and no `eval`, on the
argument that bash can then only resolve the name through PATH. It took the gate from 855 to
**420** unresolved — 435 edges marked, 0 refuted — and then the marked set was audited against a
whole-project declaration index
(`probe-bash-incoming-split.mts`, which reproduces the gate's population and imports the gate's
own rule; it AGREES with the gate exactly):

```
MARKED-SET AUDIT (435 edges, 79 distinct type+name)
  target is a FUNCTION declared in the same repo : 82 edges  <-- CLAIMS THE CORPUS REFUTES
      kube::test::get_object_assert (kubernetes) x62
      kube::test::if_has_string (kubernetes) x11
      kube::test::describe_resource_chunk_size_assert (kubernetes) x4
```

The argument is false for a LIBRARY file: a file that sources nothing may itself be sourced by a
file that has already defined the name. A marker wrong 18.9% of the time makes the number it
removes meaningless, so the rule was withdrawn rather than tuned.

### The surviving rule (BD12)

`isExternal: true` plus `externalEvidence: "pathInvokedCommand"` on a call whose command word
contains `/` (`/bin/expr`, `./otp_build`). A shell function name cannot contain `/`, so the shell
is being handed a FILE and the target can never be a project declaration. Ten edges on the
gate's population, **zero refuted**. Pinned in both directions by
`bash/incoming-external-marker-bd12`, which requires the marker on the two path-invoked calls
and requires its ABSENCE on `grep`, `sed` and a local function call.

### Structural ceiling, reported rather than worked around

bash's external claims can only ever read `externalUnverified`, never `externalVerified`:
`verifyExternalClaim` (`script/m14/incoming-rule.ts:467`) verifies through
`targetOwner(target)` — everything before the LAST dot — and every bash call target is a bare
name or a path, so the owner is always `null`. That is a fact about the rule's verification
mechanism, and a lane cannot buy `verified` by respelling its targets.

### The residual, split with evidence

| class | edges | names | what it is |
|---|---|---|---|
| `calls`: real program on PATH | 354 | 50 | unqualified calls a single-file analyzer cannot prove external (`grep`, `sed`, `jq`, …) |
| `calls`: declared in the repo | 202 | 27 | the sample did not include the declaring file (`kube::test::*` functions, `kubectl`, `git` as a variable name) |
| `uses`: declared in the repo | 106 | 36 | cross-file variables (`KUBE_TEMP`, `kube_flags`, …) |
| `uses`: declared nowhere in the repo | 100 | 54 | environment/shell-supplied (`BASH_SOURCE`, `RUNNER_TEMP`, `OUTPUT_DIR`, …) |
| `calls`: nothing on this host | 65 | 19 | `ansible-playbook`, `xcrun`, `go`, … — programs this machine does not have |
| `imports` + `references` | 18 | 7 | `source` PATHS |

The 18 path edges are a ruling, not a gap, and the ruling was measured
(`probe-bash-source-path-shapes.mts`): **every one of the 18 targets is path-shaped — 0 are
identifier-shaped.** 12 edges name a dynamic path (expansion + separator), 2 a relative path, 2
an expansion that decides the path, 2 a bare filename with a shell extension. The gate's key
space holds SYMBOLS (`parseFile(...).symbols` keyed by name and qualifiedName), and a path is
not a symbol, so those edges cannot resolve in it by construction. 14 of the 18 carry BD9's
`resolution: "dynamic"`; the other 4 are static paths BD9 publishes verbatim.

The 188 ambiguous are also not an emission defect: the ambiguity metric counts DECLARATIONS per
bare name in the project key space (`fail` is declared 3 times in one project), and the analyzer
already publishes `targetResolution` — declaration line, owner and kind — on the `calls` and
`uses` edges that carry it.

## Reproducing every number in this file

```bash
# firing, both populations
bun script/m14/firing-check.mjs BASH
NFILES=400 bun script/m14/firing-check.mjs BASH

# whole corpus: edges per type, tree sites per construct, grammar inventory
bun validation/m14/fixtures/bash/probe-bash-silent-types.mts --corpus

# export sites vs the edges they should produce
bun validation/m14/fixtures/bash/probe-bash-export-site-diff.mts

# the incoming gate, and the split of what it leaves unresolved
npx tsx script/m14/incoming-gate.ts bash sh 60
npx tsx validation/m14/fixtures/bash/probe-bash-incoming-split.mts --ext sh --nf 60 --repo-wide
npx tsx validation/m14/fixtures/bash/probe-bash-source-path-shapes.mts --nf 60

# the lane's own gates
bun run script/m14/run-fixtures.ts --lang bash          # 34 fixtures
bun validation/m14/fixtures/bash/probe-bash-no-regex.mts # 0 regex literals, 61 files
```
