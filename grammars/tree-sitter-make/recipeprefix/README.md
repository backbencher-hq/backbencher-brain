# `.RECIPEPREFIX` (spec gap MAKE-G2) — the attempt, and how it was resolved

**SUPERSEDED. This is now WIRED, as patch P3.** The pinned grammar keeps the
scanner it was developed against at `../src/scanner.c` and the patch that applies
it at `../ab/grammar.patch`; the two are the same content. This directory is kept
because the *sequence* is the most useful part of it: the first version worked, the
second version regressed three real corpus files, and the third version is the one
that ships. The failure modes below are the reason it took three.

`bun run script/m14/tmp/make/recipeprefix-conflict.mts` measures all of this.

## The defect

GNU Make 3.82 added `.RECIPEPREFIX`. The pinned upstream grammar hardcodes the
recipe prefix to a tab and leaves the value in a comment where it belongs:

```js
// TODO external parser for .RECIPEPREFIX
_recipeprefix: _ => '\t',
```

So a Makefile that sets `.RECIPEPREFIX = >` has every recipe line parsed as an
ERROR node, and the analyzer reports a build file that does nothing. There are
**0 such files among the 100 pinned corpus Makefiles**, which is a fact about the
corpus and not about the language — the lane's own review records this as the
lesson of the concatenated-name defect, where 1,000 clean files hid one.

## What is here

| file | what it is |
|---|---|
| `scanner.c` | a complete external scanner: it learns the prefix from the assignment's value, exposes the recipe-prefix token, declines every value it cannot vouch for, and serializes its state for incremental reparse |
| `grammar.with-recipeprefix.js` | the grammar with the patch applied |
| `grammar.patch` | the diff from the wired `grammar.js` |

The scanner is the interesting part and it is finished:

- **the value arm mirrors the internal token's span.** `.RECIPEPREFIX = >` yields a
  `text` node whose text is `" >"`, *including the leading space*. A scanner that
  rejects leading whitespace never matches, the internal token wins the `choice`,
  and the scanner appears to be never called. That cost a build.
- **it declines rather than guesses.** A variable reference, an empty value, or a
  value longer than one character all fall through to the internal
  `_assignment_text` token, which is the unchanged original.
- **state is serialized**, because an incremental reparse that resumed mid-file
  with a default tab would produce a different, wrong tree depending on which edit
  triggered it.
- **the tab stays an internal token** and the external token is the alternative.
  The scanner declines when the tracked prefix is the default, so the two can never
  both match one character. Moving the tab into the external set — the obvious way
  to do this — is what the first three builds did.

Measured with it, on the normal shapes:

```
                    pristine        with the scanner
recipe lines         2 ERROR         0 ERROR, recipe_line
two rules            1 ERROR         0 ERROR, two recipe_lines
inside a conditional 3 ERROR         0 ERROR
`:`= operator        1 ERROR         0 ERROR
variable value       unchanged       unchanged (internal token)
multi-char value     unchanged       unchanged (internal token)
```

Node surface **44 named / 24 fields, nothing added and nothing removed** — the
property the source↔wasm proof depends on. Corpus A/B over all 100 files: **0
error nodes, 0 files regressed**, verdict ADOPT.

## What was wrong with the first two versions

**Version 1** moved the tab out of the internal token set and made the external
token the only prefix. The corpus A/B rejected it with 36 error nodes across
`boundary/Makefile`, `nomad/GNUmakefile` and `tf-aws-components/Makefile`, on the
four-line shape

```make
a:
	echo hi
# note
	echo bye
```

A comment between two recipe lines ends the `repeat` that continues a recipe, and
with the tab gone from the internal set the line after the comment had nowhere to
go.

**Version 2** put the tab back as an internal token and added the external one as an
alternative — which fixed that, and then let a declared prefix lead a rule through
`optional($._recipeprefix)`. That introduced a second reading of one character: in
make a leading tab is a RECIPE, not insignificant whitespace, so the parser took the
tab as a rule with an empty prefix and the recipe was lost. Same 36 errors.

**Version 3, the one that ships**, has two properties neither earlier one had:

- the tab remains an internal token and the scanner **declines the external token
  whenever the tracked prefix is the default**, so the two can never both match one
  character; and
- a declared prefix may lead a rule as a **separate alternative**, never as an
  `optional` head — a nullable head changes the reduce decision after a recipe's
  newline, which is what lost the tab after an ordinary comment.

Neither earlier defect is visible in the corpus: 0 of the 100 pinned files put a
comment between two recipe lines, and none sets `.RECIPEPREFIX`. Both were found by
synthetic repros. That is worth stating plainly, because it is the same lesson the
concatenated-name defect taught — a clean differential is completeness *on the files
you have*.

The earlier framing of this file, kept because it explains the shape of the problem:

Make strips the prefix from a rule line too, so a real file looks like:

```make
>build: deps
>	echo hi
```

That needs the prefix token to be valid **at the start of a rule**, not only inside
a recipe. Adding `optional(choice($._recipeprefix_tab, $._recipeprefix))` to
`_ordinary_rule` fixes it — and immediately breaks the other case:

```make
build:
	echo hi
            # an ordinary comment
	echo bye
```

A comment between two recipe lines ends the `repeat` that continues a recipe, and
with the prefix token now reachable at statement start the parser takes the wrong
branch: the tab line after the comment no longer resumes the recipe. The corpus A/B
rejects it — **3 real Makefiles, 36 new error nodes**:

```
boundary/Makefile                0 -> 12
nomad/GNUmakefile                0 -> 17
tf-aws-components/Makefile       0 -> 10
```

A four-line repro, no corpus file needed:

```make
a:
	echo hi
# note
	echo bye
```

The two requirements pull in opposite directions: the prefix must be lexable where
a rule begins, and it must not be lexable where a recipe resumes. That is a
tree-sitter lex-state problem, not a scanner-logic problem, and it is the whole
reason this is filed rather than shipped.

## The two residuals, and they are narrower than the feature was

Both are already errors before the patch, so neither is a regression, and both are
recorded in the spec rather than left to be discovered:

1. a comment between two **prefixed** rules still yields an ERROR on the second
   rule's prefix — the same lex-state shape version 2 could not fix, now confined to
   prefixed files;
2. an **attached** recipe on a prefixed rule line (`>a: ;cmd`) is not recognised.

Neither appears in the corpus, so closing them needs a synthetic fixture and a
scanner that answers differently depending on whether the parser expects a rule or a
recipe continuation — `valid_symbols` may already distinguish the two, and the
grammar does not currently ask it to.

## Reproducing

```sh
cd grammars/tree-sitter-make
node <tree-sitter-cli>/cli.js generate
node <tree-sitter-cli>/cli.js build --wasm --output tree-sitter-make.wasm
```

`tree-sitter.json` is required and is vendored: without it the CLI falls back to
ABI 14 and emits a parser that differs from the wired one, which is how the first
build of this patch came to differ from the one that was actually tested.
