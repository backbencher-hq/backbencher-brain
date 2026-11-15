## The class

The cpp sibling of #917 (which the c lane closed): a **CALL-shaped macro standing as the whole heading of a block** —

```cpp
TEST(format_test, enum) { EXPECT_EQ(fmt::format("{}", foo), "0"); }
TEST_CASE("thing") { SECTION("a") { … } }
MATCHER(IsFalse, "…") { … }
```

The grammar reads the heading as an `expression_statement` whose terminator is MISSING, and the block as a **sibling** `compound_statement`. So the macro-generated definition does not exist, its body is not inside any function scope, and its reads are attributed to `global`.

## Census (pinned cpp grammar, fmt + nlohmann-json, 400-file draw)

Every site whose statement carries a MISSING `;` — **411 sites / 67 files** — split by what follows it and by what the statement's first child is:

| first child | sites | | next non-space token | sites |
| --- | --- | --- | --- | --- |
| `call_expression` | 362 | | `{` (a block: the macro-declared body) | **186** |
| `identifier` (zero-arg macro) | 40 | | `#` (a preprocessor line follows) | 39 |
| other | 9 | | newline / EOF | 38 / 37 |
| | | | `}` (a body's last statement) | **9** |

This is the single largest MISSING-token class in both cpp corpora after three landed #743 waves (the ERROR-node census reads as a long tail, 32 signatures / 35 fmt files; this class is invisible there because it is recovery, not an ERROR node).

**The block-tail narrowing is measured worthless**: admitting the shape only as a body's last statement covers **9 of 411** sites, which is why it is not the lever and is recorded here rather than tried.

The dominant spelling — macro call + block — is **193 sites in 14 files**: `SECTION` ×169 (vendored `doctest.h`), `TEST_CASE` ×7, `TEST` ×5, `MATCHER`/`Matcher` ×7, plus singletons. Enclosing scope for the wider set: 224 inside a `compound_statement`, **84 at `translation_unit` (file scope)**, 54 in a `declaration_list`.

## The cost, measured through the production entry (`parseFile`)

For a file-scope heading, the analyzer publishes the body's reads with no owner:

| site | relationships starting in the body | sourced at `global` | symbols declared in-body |
| --- | --- | --- | --- |
| `fmt/test/format-test.cc:2104` | 40 | **36** | 0 |
| `fmt/test/ostream-test.cc:213` | 42 | **34** | 0 |

So the body's reads (`format`, `foo`, `EXPECT_EQ`, locals like `buffer`, `size`, `result`) hang off `global` instead of the macro-generated function — the same defect #917 fixed on the C side, where the fix recovered **6–7 real symbols per file** and re-attributed 67 relationships.

## The grammar route is refused, with evidence

The obvious relaxation — let a bare macro invocation be a whole statement — was **built and measured** (candidate wasm, both spellings) and refused:

- the alias spelling re-shaped **119 of 361 already-clean cpp files** (71 of 200 in c) while *improving* every damage count (112 → 103 damaged files, 9 fixed, 0 newly broken, the 411-site class → 65): it wraps `(expression_statement (call_expression))` in a second `expression_statement`;
- the tree-preserving spelling (the alternative *is* the rule, placed in the shared C base) reads **0 clean-tree differences** at the same counts, and still loses on the analyzer's own output: **cpp/fmt 101 vanished symbols, 15 owner-qualifier changes, 83 lost pairs**; **c/sqlite 21 vanished — exactly the set #917 recovered**;
- so the two are coupled: a grammar relaxation removes the damaged shape the analyzer's recovery keys on.

Both candidates are decided by `script/m14/verify-grammar-leaves.ts` (**M14.0.F11**, G1 damage / G2 clean-tree identity / G3 analyzer non-regression), which reads the candidate `INADMISSIBLE`. See `reviews/m60-743c-grammar-leaf-gate.md`.

## Definition of done

1. **Analyzer-side recovery** (the #916/#917 precedent): a call-shaped heading whose next sibling is a `compound_statement` opens a scope for that body, and the body's reads/relationships are attributed to it instead of `global`. Gated on the same evidence shape as #917: a control beside each arm, and no real symbol or edge may be lost.
2. **The oracle must learn the same rule in the same commit** — #916's lesson: F5 walks the same tree, so leaving truth behind converts the recovered reads into `unexplained` (measured there: 0 → 4, two of them the fix's own).
3. **A pin with teeth** (fixture measured pre/post) plus a **mutant** for the re-attribution.
4. `M14.0.F11` admissible for any grammar change that rides along; F3/F4/F5/F10 re-run.

## Open design decision (product-facing)

What is published as the *name* of a macro-generated definition is not decidable from the tree: gtest's `TEST(format_test, enum)` generates `format_test_enum_Test::TestBody()`, and the written heading contains no such identifier. The options are (a) the written heading text as a quoted, metadata-flagged scope (`TEST(format_test, enum)`, `expandedFrom: macro-heading`) — never an invented identifier; (b) recover the scope only, publishing no new symbol name; (c) register this class as a measured residue and stop. The #915 ruling ("cannot misfire; never name something that does not exist in the source") is what makes (a) vs (c) a real decision rather than a formality.
