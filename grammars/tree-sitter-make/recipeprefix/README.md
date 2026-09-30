# `.RECIPEPREFIX` (spec gap MAKE-G2) — a working scanner, and why it is not wired

**NOT WIRED. Nothing in this directory is loaded by the product.** It is kept
because the work is correct and the blocker is precise, and both facts are worth
more than a silent `TODO`.

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

## Why it is not wired

Because the *ordinary* way to write the feature is not yet handled, and the two
requirements that would handle it are in direct conflict.

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

## Why not ship the half that works

The recipe-line-only variant (everything except the rule line) does pass the
corpus with zero regressions, and it was built and measured. It is not wired
because it makes the feature *look* supported while still failing on the shape
almost every real Makefile uses — and a lane that half-supports a construct is
worse than one that declares the gap, because the reader has no way to tell which
half works.

## What a next attempt needs

1. Resolve the lex-state conflict without making the prefix reachable where a
   recipe resumes. The most promising direction is a scanner that answers
   differently depending on whether the parser is in a rule-expecting or a
   recipe-continuing state — `valid_symbols` may already distinguish them, and the
   grammar does not currently ask it to.
2. Declare the `concatenation` / `_line_text` conflict the rule-line change
   exposes. It is the same shape as the grammar's existing
   `[$.concatenation, $._paren_text]` entry, and declaring it is what made the
   rule-line variant generate at all.
3. Re-run the corpus A/B first. It is what caught this, twice, and it costs one
   command.
