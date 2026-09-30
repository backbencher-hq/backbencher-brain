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

## What was wrong with the first three versions, and with the premise

**Version 1** moved the tab out of the internal token set and made the external token
the only prefix. The corpus A/B rejected it with 36 error nodes across
`boundary/Makefile`, `nomad/GNUmakefile` and `tf-aws-components/Makefile`, on the
four-line shape

```make
a:
	echo hi
# note
	echo bye
```

A comment between two recipe lines ends the `repeat` that continues a recipe, and with
the tab gone from the internal set the line after the comment had nowhere to go.

**Version 2** put the tab back as an internal token and added the external one as an
alternative — which fixed that, and then let a declared prefix lead a rule through
`optional($._recipeprefix)`. That gave one character two readings, and introduced the
`[$.concatenation, $._line_text]` conflict. Same 36 errors.

**Version 3** kept the two token paths apart (the tab internal; the scanner declines the
external token whenever the tracked prefix is the default) and still let the prefix lead
a rule. It passed the corpus, and it was wrong about the LANGUAGE.

### The premise was wrong, and only `make` could say so

Versions 2 and 3 assumed a declared prefix leads a **rule** as well as a recipe. GNU
Make 4.3, asked directly:

```console
$ printf '.RECIPEPREFIX = >\n>build:\n>\techo hi\n' | make -f -
recipe commences before first target.  Stop.
```

With `>` as the recipe prefix, `>build:` **is** a recipe line, and a recipe may not come
before the first target. The correct spelling leaves the rule unprefixed:

```make
.RECIPEPREFIX = >
build:
>	@echo hi
```

So the rule-prefixed branch was a **fabricated construct** — the grammar accepted input
make rejects. Deleting it fixed that, and fixed the one ambiguity it caused as well:
with the prefix legal both as a recipe continuation and as a rule, a comment between two
prefixed lines was ambiguous, the greedy recipe `repeat` won, and the following rule was
swallowed into the previous recipe.

### Two scanner traps, both of which failed silently

**Leading whitespace.** tree-sitter calls an external scanner *before* `extras` are
skipped. A comment is a real token, so after one the scanner sits on a newline with the
prefix one byte further along, and a naive `lookahead == prefix` declines. Every
prefixed rule after any comment anywhere in the file became an ERROR.

**The wrong whitespace predicate.** The fix is to skip whitespace first — but reusing the
value-arm test `is_space`, which **deliberately excludes `
` and ``** because a
newline terminates an assignment value, means the loop skips nothing at all. It compiled,
it ran, and it changed no behaviour. The predicate had to be split into `is_space` (value
terminator) and `is_line_space` (line boundary).

Neither defect is visible in the corpus: 0 of the 100 files set `.RECIPEPREFIX`, and none
puts a comment between two recipe lines. Both were found by synthetic repros — which is
the concatenated-name lesson for the third time on this lane.

## What is shipped, and what is still open

Shipped: the prefix on recipe lines, with `_ordinary_rule` byte-for-byte upstream's.
`ab/grammar.patch` cannot express P3 alone — a new source file is not an edit — so
`src/scanner.c` ships beside it, and `.gitignore` excludes `grammars/tree-sitter-*/src/*`,
so the scanner is force-added.

Open: **MAKE-G5**, a recipe line at EOF with no trailing newline is an ERROR and is lost.
Pre-existing upstream behaviour, invisible to the corpus, and not fixed here because
`optional(NL)` fails generation outright ("Specify a left or right associativity in
`_prefixed_recipe_line`") and deserves its own measured change. See the spec entry.

## Reproducing

```sh
cd grammars/tree-sitter-make
node <tree-sitter-cli>/cli.js generate
node <tree-sitter-cli>/cli.js build --wasm --output tree-sitter-make.wasm
```

`tree-sitter.json` is required and is vendored: without it the CLI falls back to
ABI 14 and emits a parser that differs from the wired one, which is how the first
build of this patch came to differ from the one that was actually tested.
