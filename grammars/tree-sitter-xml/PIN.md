# tree-sitter-xml — grammar pin

Vendored so the wired `wasm/tree-sitter-xml.wasm` is not an unversioned blob, and
so the two repairs the XML lane carries are auditable as a diff against a named
upstream revision.

| | |
| --- | --- |
| Upstream | `tree-sitter-grammars/tree-sitter-xml` |
| Revision | `5000ae8f22d11fbe93939b05c1e37cf21117162d` (v0.7.0) |
| Licence | MIT |
| Wired wasm | `wasm/tree-sitter-xml.wasm`, sha256 `2425a26e77dce87d7157f89b2e39920c67436a672263827dea3516210f93b1c8`, 50,255 bytes |
| Pre-repair wasm | sha256 `50ad134273834d5efe37d8fe4f93aa4367b95a91be05dc08a6dc894c7ecdb9c1`, 50,008 bytes |
| Gate | `bun run script/m14/verify-grammar-pins.ts` (lane `xml`) |
| Review | `reviews/xml/master-review.md` |

## The pre-repair bytes needed no provenance work — and that is the finding

The Groovy precedent (a vendored wasm that had drifted from upstream and had to
be repaired by hand) is the first question for every lane, so it was settled
first. **It does not apply, and the negative result is what makes the two
repairs below necessary rather than optional.**

> **This file is inside the hashed tree.** `verify-grammar-pins.ts` records a
> sha256 for *every* file under `grammars/tree-sitter-xml/`, and this file is one
> of them, so editing any prose here makes the pin fail until it is re-recorded
> with `bun script/m14/verify-grammar-pins.ts --lane xml --write`. That converges
> in one step: the re-record rewrites the JSON, not this file.
>
> It is a false alarm in the strict sense — a markdown file is not an input to
> `tree-sitter generate` or to the C compile, so no edit here can change the wasm.
> It is kept inside the tree anyway because the pin's stated rule is that the
> vendored source cannot drift *at all*, and a narrower rule applied to one lane
> would be a special case in shared code. A sibling lane's `README.md` is inside
> its hashed tree for the same reason. If that ever becomes a nuisance the honest
> fix is to narrow `walkFiles` to build inputs for *every* lane at once, not to
> exempt this one file.

The pre-repair wired wasm's enumerable surface, read through web-tree-sitter's
`Language` API, is **143 ids / 51 named / 2 fields (`root`, `content`)** — and a
wasm built from upstream HEAD (v0.7.0, `5000ae8f`) has **exactly the same
surface, with a zero set difference in both directions**. Its behaviour is
identical on all 29 constructs of the A/B battery
(`fixtures/xml/out/grammar-ab.json`). The pre-repair bytes were therefore an
**unmodified, current upstream build**.

So the two defects this lane repairs are **upstream's**, and no upgrade fixes
them. Measured on builds of v0.5.0, v0.6.4 and v0.7.0: all three fail both
(`fixtures/xml/out/grammar-corpus-ab.json`, `fixtures/xml/out/pi-rootcause.json`).

Upstream's own test corpus never exercises either: `grep -rn 'PITarget'
test/corpus/` returns nothing, and the only PI-adjacent tests are
`StyleSheetPI`/`XmlModelPI`. A construct with no test cannot be caught.

## REPAIR 1 — `common/scanner.h`, `scan_pi_content` (the scanner)

`advance_if_eq` is defined as

```c
#define advance_if_eq(lexer, chr) \
    if (!lexer->eof(lexer) && (lexer)->lookahead == (chr)) advance((lexer)); else return false
```

The `else return false` is part of the macro's own `if`, so **every use is a
failing conditional advance**. `scan_pi_content` ended with

```c
    lexer->mark_end(lexer);      // the token ends AT the '?'
    advance(lexer);               // consume '?'
    if (lexer->lookahead == '>') {
        advance(lexer);
        while (lexer->lookahead == ' ') advance(lexer);
        advance_if_eq(lexer, '\n');   // <-- runs PAST mark_end; irrelevant, and it FAILS
        lexer->result_symbol = PI_CONTENT;
        return true;
    }
```

Those trailing statements are pure lookahead — the token already ended at `?` —
so the value of the byte after `?>` is irrelevant, and the macro's `else` aborted
the whole `_pi_content` token whenever that byte was not `\n`.

**Consequence, and it is worse than a lost declaration:** a processing
instruction *with content* could not be lexed, so `<?target content?>` could not
complete and the parser wrapped the whole construct in an `ERROR` node. With no
`XMLDecl` present the enclosing `prolog` node was destroyed as well, taking any
`<!DOCTYPE …>` in the same prolog with it. The 19-shape battery isolates it to
the byte: the construct parses **iff** the byte after `?>` is `\n`
(`fixtures/xml/out/pi-rootcause.json`).

The repair is one new macro and one changed call site:

```c
#define skip_if_eq(lexer, chr) \
    if (!lexer->eof(lexer) && (lexer)->lookahead == (chr)) advance((lexer))
```

`check_word` and `scan_comment` keep `advance_if_eq`, where a mismatch correctly
means "this is not the token I was asked for".

## REPAIR 2 — `xml/grammar.js`, `_intSubset` (the grammar)

A conditional section inside an internal DTD subset could not be reached at ANY
version measured:

- **v0.5.0 – v0.6.x** declare `conditionalSect` in the `dtd` grammar and `inline`
  it, but `_intSubset` referenced `$._markupdecl`, which does not include it.
- **v0.7.0** — the version the wired bytes match exactly — does not declare
  `conditionalSect` in the `xml` grammar at all.

The failure was destructive and produced a **published lie**: `<![INCLUDE[…]]>`
wrapped the `doctypedecl` in an `ERROR`, the parser then took a *later* `Name` as
the DTD's name, and the analyzer published a `Type` symbol literally named
`INCLUDE`. See `fixtures/xml/out/tree-shapes.txt` (`dtdConditional`).

```js
_intSubsetItem: $ => choice($._markupdecl, $.conditionalSect, $._DeclSep),

// doctypedecl:  O(seq('[', repeat($._intSubsetItem), ']', O($._S)))
conditionalSect: $ => seq(
  '<![', O($._S), c.ref($, 'IGNORE', 'INCLUDE'), O($._S), '[',
  repeat($._intSubsetItem), ']]>',
),
```

The repeat is written at each use site over a named **item** rule because
tree-sitter rejects a rule that can match the empty string, and XML 1.0 permits
an empty internal subset (`<!DOCTYPE a []>`). Putting the repeat in a rule would
either fail generation or add a wrapper node to `node-types.json`.

## Corpus evidence for admissibility

8,888 files / 33.6 MB / **6.69 M nodes** across 6 pinned repos, ERROR and MISSING
counted per file (`fixtures/xml/out/grammar-corpus-ab.json`):

| | pre-repair | this build |
| --- | --- | --- |
| files with ERROR/MISSING | 203 | **180** |
| ERROR nodes | 48,934 | **48,877** |
| **MISSING nodes** | 32 | **10** |
| files repaired / moved / unchanged | — | **31 / 2 / 8,855** |

Both movements are adjudicated by measurement, not argument
(`fixtures/xml/out/regression-adjudication.json`):

1. **`libxml2/test/valid/dtds/cond_sect2.dtd`** is a **standalone DTD**. Its root
   node type is `ERROR` under the wired grammar, under this build, and under
   every build measured — the `xml` grammar requires a document element and
   cannot represent a standalone DTD at all, so the file was never in the wired
   surface and cannot regress it. Upstream's **separate `dtd` grammar** parses it
   with **0 ERROR nodes**; that is filed as its own finding (see below), not
   solved here. (The repair also *improved* the sibling `cond_sect1.dtd`,
   11 ERROR → 8.)
2. **`libxml2/test/errors/759573-2.xml`** is libxml2's own **fuzzer-regression
   corpus** — a directory of files the project keeps precisely because they must
   not parse. Both sides reject it (root `ERROR`); the repair traded one `MISSING`
   node for four more `ERROR` nodes, and a `MISSING` node is tree-sitter's
   recovery invention, the worse of the two signals. The repair also fixed the
   file's first line, a content-bearing `<?xmh …?>` PI.

## Not taken, and owed

Upstream v0.7.0 **split DTD into a separate `dtd` grammar**. Adopting a split
would strand `elementdecl`, `AttlistDecl`, `AttDef`, `GEDecl`, `PEDecl` and
`NotationDecl` — the analyzer's entire DTD surface — in a grammar this engine does
not wire, so the upgrade is a **capability deletion**, not a fix. Conversely,
wiring the `dtd` grammar as a second language would be the right answer for
standalone `.dtd` files, and is measured to work (`cond_sect1.dtd` and
`cond_sect2.dtd` → 0 ERROR nodes). That is a new language, a new router entry, a
new analyzer and a new lane — recorded here so the decision is revisit-able with
numbers instead of a recollection.

## Files

Upstream's multi-grammar layout, kept so the relative import in
`xml/grammar.js` (`../common/common.mjs`) resolves and the tree is byte-comparable
to a checkout:

- `xml/grammar.js` — the patched grammar (REPAIR 2)
- `xml/src/grammar.json`, `xml/src/node-types.json` — generated; vendored because
  the pin's offline source↔wasm proof needs the pair
- `xml/src/parser.c` (254 KB), `xml/src/scanner.c`, `xml/src/tree_sitter/*.h`
- `common/common.mjs` — the shared rule set
- `common/scanner.h` — **the external scanner header, and the file REPAIR 1
  edits**; `xml/src/scanner.c` includes it
- `tree-sitter.json`, `LICENSE`

`xml/src/parser.c` is vendored (254 KB) — the same call `hcl` made at 600 KB and
`graphql` at 284 KB, the opposite of `nim` at 41 MB. The pin hashes every file in
the tree, tracked or not, so an untracked `parser.c` would turn the gate red after
any `tree-sitter generate`; tracking it makes the wired wasm rebuildable from
tracked files alone and keeps the digests still across a regeneration that
changed nothing else. `common/scanner.h` and `xml/src/scanner.c` are tracked for
the same reason, and the `.gitignore` negations that make that true name the
**role** (the shared scanner header, the per-grammar scanner) rather than the
filename, which is the mistake the cpp lane already had to fix.

## Rebuild

```sh
npx tree-sitter generate --cwd grammars/tree-sitter-xml/xml
npx tree-sitter build --wasm --output wasm/tree-sitter-xml.wasm grammars/tree-sitter-xml/xml
```

(`--wasm` needs the tree-sitter CLI's containerised backend; a plain
`tree-sitter build` writes a native `.so` and web-tree-sitter will not load it.)
