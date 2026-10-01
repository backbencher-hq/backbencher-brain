# tree-sitter-make — grammar pin

**This grammar is a LOCAL BUILD FROM PATCHED UPSTREAM SOURCE.** The pristine
upstream build is retained, permanently, for A/B. Nothing here is a claim about
upstream's bytes.

| | |
| --- | --- |
| Upstream | `tree-sitter-grammars/tree-sitter-make` |
| Upstream revision | `70613f3d812cbabbd7f38d104d60a409c4008b43` ("chore: regenerate parser and bindings with 0.26.6") |
| Upstream package | `tree-sitter-make` 1.1.1 (MIT) |
| Wired wasm | `wasm/tree-sitter-make.wasm`, sha256 `0f6f4ed85e92274344430277430f39278e33036f414d1cc8f602e8f379ea0ce9`, 173,520 bytes — **a local build of the patched source below** |
| Pristine build (retained) | `ab/pristine-make.wasm`, sha256 `e85bd50b8182497c311fd72c4441b530ff437421176b64114faf532641534fff`, 148,909 bytes |
| Patches | `ab/grammar.patch` (in-repo) — 4 patches, all measured (§ "The patches") |
| External scanner | `src/scanner.c` — required by patches P3 and P4; **not** carried by `ab/grammar.patch`, which cannot express a new source file |
| Gate | `bun run script/m14/verify-grammar-pins.ts` (lane `make`) |

## Why this is a patch and not a swap

Upstream is current — `1.1.1` is the HEAD of the only maintained
`tree-sitter-make` in the grammars org, and there is nothing to move to. So the
question is not "which grammar is better" but "does the one we have model the
language". Measured over the lane's 99-file pinned corpus, the pristine build
produces **11 ERROR nodes across 3 files**, and every one of them is a construct
GNU Make documents:

- `target: export VAR = value` — *target-specific variable*, GNU Make 7.7.
  8 of the 11 nodes, and 9 variable names the analyzer could not see at all.
- `$$($(GO_CMD) list … | grep -v vendor/)` — 1 node, and `MAIN_PACKAGES` lost.

Both were recorded as open gaps (`MAKE-G3`, `MAKE-G4`) with the decision to *not*
patch, on the grounds that a clean source↔wasm identity proof was worth more than
9 declarations. That trade was then measured rather than assumed, and it does not
hold: the patches below **add no node type and no field at all** (44 named / 24
fields before and after, zero added, zero removed), so there is nothing for the
proof to lose. The proof is re-established for the patched source in the next
section, and the pristine build is kept so the comparison stays re-runnable
forever.

## The patches

All three are in `grammars/tree-sitter-make/ab/grammar.patch`, and each carries its own
reasoning in the grammar's comments. P3 additionally needs `src/scanner.c`, which the
patch cannot express because it is a new file rather than an edit.

**P3 — `.RECIPEPREFIX`, with an external scanner.** Upstream hardcoded the recipe
prefix to a tab and left `// TODO external parser for .RECIPEPREFIX` where the value
belonged, so a Makefile that set it lost every recipe line — a correctness defect, and
0 of the 100 corpus files set it. The prefix applies to **RECIPE lines only**:
GNU Make 4.3 rejects a prefixed RULE outright (`recipe commences before first
target`), so `_ordinary_rule` is byte-for-byte upstream's and P3 can only ever *add* a
recipe prefix. The scanner learns the prefix from the assignment's value, declines
everything it cannot vouch for, serializes its state so an incremental reparse cannot
resume with a default tab, and skips **line** whitespace before comparing — tree-sitter
calls an external scanner before `extras` are skipped, so after a comment the prefix
sits behind an unconsumed newline. Two of those are easy to get wrong and both were:
reusing the value-arm whitespace test (which excludes newlines by design) compiled,
ran, and skipped nothing; and letting the prefix lead a rule made a comment between
two prefixed lines ambiguous, so the greedy recipe `repeat` swallowed the next rule.

`grammars/tree-sitter-make/recipeprefix/README.md` records the three rejected
versions. Note that `ab/grammar.patch` cannot express P3 alone: a new source file is
not an edit, so `src/scanner.c` ships beside the patch.

**P4 — the recipe line that ends the file.** Upstream ends every recipe line with a mandatory
newline token that does double duty: it ends the line *and* terminates the enclosing `repeat`.
So a recipe line which is the last thing in a file, with no newline after it, was an ERROR node
and was lost — and GNU Make 4.3 runs such a file. `_recipeprefix_tab` is `token.immediate`, so the
newline can never be left to `extras`: an immediate token refuses to match across skipped
whitespace. That is why the terminator is mandatory, and why making it optional collapses
`recipe_lines` to 0 across the corpus. The fix moves the decision to the only component that can
observe end of input: `RECIPE_EOL` is a third external token emitted **zero-width** by the scanner
at `lookahead == 0`. A newline still lexes as the internal `NL`, so it can never match a real
character. Closed for a **declared** prefix only — tree-sitter does not consult the external
scanner after an internal `token.immediate` prefix, so a tab-prefixed final line is still open.
Both cases are pinned by their own fixture.

`tree-sitter.json` is vendored and **load-bearing**: without it the CLI falls back to
ABI 14 and silently emits a parser that differs from the wired one.

**P1 — target-scoped export variable.** `variable_assignment` already accepts an
optional leading `list ':'`, so `target: VAR = value` parsed. It did not parse
`target: export VAR = value`, because `export_directive` places the `export`
keyword *before* the assignment and nothing allowed it after the colon. Added as
a second branch of `_ordinary_rule`, which is the only place the colon is consumed
and the assignment has not yet begun.

**P2 — `$$( … )` is a shell command, not a make expansion.** `$$` is Make's
*escaped* dollar: Make does not expand `$$(X)`, it hands `$(X)` to the shell. The
grammar routed `$$` into `variable_reference` / `substitution_reference` /
`automatic_variable` / `function_call`, none of which can parse a shell command
head (spaces, pipes). Added a hidden `_shell_escape` keyed on `$$` only — so
`$(FOO)` is still a variable reference — with the
`variable_reference` / `_paren_text` ambiguity **declared as a conflict** and
resolved by dynamic precedence rather than a static one. A static precedence would
silently discard one reading for *every* input instead of only for the inputs where
it is wrong.

## The measurement that decided it

`fixtures/make/probes/grammar-ab.mts`, over all 99 pinned corpus files.

```
              ids  named  fields | error files  error nodes
pristine       188     44      24 |        6/99          11
patched        189     44      24 |        5/99           0
```

**11 → 0 error nodes, 3 files improved, 0 regressed**, with the named and field
sets identical. The `6 → 5` in "error files" is not an improvement claim: the
remaining 5 are files where `rootNode.hasError` is set by a *hidden* recovery
token with zero traversable ERROR or MISSING nodes, which the engine reports
generically (`engine.ts:1264`) and which the corpus gates classify separately.

**The product-level check, which is the one that matters.** The sql lane recorded
that a headline error-count reduction can be byte-identical output, so the patch
was also measured through `RealMakefileAnalyzer`:

| | symbols | relationships |
|---|---|---|
| pristine | 1,772 | 5,870 |
| patched | **1,781** | **5,880** |

38 facts gained, 19 lost — and **every one of the 19 is either garbage the error
recovery had invented or a fact re-attributed to its correct owner**:

- `uses install -> BOUNDARY_INSTALL_BINARY=1` and `uses docker-build-dev -> GOOS=$(DEV_DOCKER_GOOS)` were the *whole assignment text* used as a name, because the ERROR node hid the structure. Both are now real `constant` symbols with `contains` edges.
- `uses Makefile -> ?` was a `?` as a name.
- `uses auth -> AWS_PROFILE` existed only because `AWS_PROFILE` was not declared, so the reference fell to `uses`. It is now declared, and `references AWS_PROFILE -> ECR_PROFILE` replaces it — attributed to the variable whose value it is read in, rather than to the rule the error recovery guessed.

The 9 newly-visible declarations are `BOUNDARY_INSTALL_BINARY`, `SKIP_PLUGIN_BUILD`,
`UI_CLONE_DIR`, `UI_COMMITISH`, `UI_DEFAULT_BRANCH`, `UI_VERSION_FILE`, `GOOS`,
`GOARCH` and `MAIN_PACKAGES`.

**The analyzer needed no change.** That is the strongest single piece of evidence
that the patch is well-founded: the constructs it repairs were already modelled,
just unreachable. A grammar patch that required analyzer surgery to exploit would
be a sign the patch was wrong.

## Source↔wasm proof

`src/node-types.json` at the patched revision declares **44 named node types and
24 fields**. The wired wasm's own enumerable surface, read through
web-tree-sitter's `Language` API, is **192 ids / 44 named / 133 anonymous / 24
fields** — the identical named set and field set, **in both directions, zero
missing and zero extra**.

The anonymous counts differ (91 declared vs 131 in the wasm) because
`node-types.json` deduplicates identical anonymous tokens that the id table lists
once per id. That difference is recorded rather than hidden, and it is not part of
the proof; the named and field sets are what carry it.

Re-checked on every run of `verify-grammar-pins.ts`, not asserted here.

## Reproducing the build

```sh
git clone https://github.com/tree-sitter-grammars/tree-sitter-make && cd tree-sitter-make
git checkout 70613f3d812cbabbd7f38d104d60a409c4008b43
git apply /path/to/grammars/tree-sitter-make/ab/grammar.patch
node <tree-sitter-cli>/cli.js generate
node <tree-sitter-cli>/cli.js build --wasm --output tree-sitter-make.wasm
```

A control build of the **unpatched** source at the same revision was made with the
same toolchain and is functionally identical to the wired pristine build — same
188 ids, same 44 named, same 24 fields, same 6 error files and 11 error nodes. So
every difference reported above is the patch, not the toolchain.

The generated `src/parser.c` (1,084,442 bytes patched) is vendored so the
proof is re-checkable offline without a toolchain. `grammars/tree-sitter-make/ab/` retains the
pristine source, the pristine build and the patch, which is what makes the
comparison above re-runnable rather than a claim.
