# Analyzer documentation

One canonical page per analyzer. Every supported language has exactly one file here —
`docs/analyzers/<language>.md` — and it is the page the documentation gate measures
(`script/m14/verify-analyzer-docs.ts`): it must carry the eight measured sections of
[`TEMPLATE.md`](./TEMPLATE.md) with content (the template's three further headings are recommended,
not gated), and its relationship-ontology table must leave no cell unexplained.

The pre-2026-11-01 split (`real-<language>-analyzer.md` for the structured page plus a
second `<language>.md` verdict/journal page) is gone: the structured page took the
natural `<language>.md` name, and the old investigation journals are kept, clearly
separated, under [`history/`](./history/) because tracked code and validation evidence
cite them by path. The [session log](./ANALYZER-SESSION-LOG.md) is the campaign's work
record; it is history, not a contract.

## Counting the analyzers — one number, five denominators

The exact number of language analyzers is **50**, and it is one number because an analyzer *is*
a lane: 50 `src/ast/real-*-analyzer.ts` implementations, each with one canonical page here, one
fleet/instrument lane, and one grammar-conformance row. Every other figure you may see in gate
output (47, 48, 49, 53…) is a *different denominator*, not a different count — and the block
below is machine-checked by `script/m14/verify-analyzer-docs.ts` on every gate run, so the current
statement cannot drift from the tree again.

<!-- ANALYZER-COUNTS:START -->
{"analyzers":50,"analyzerPages":50,"lanes":50,"grammarAuditRows":50,"routerLanguages":53,"relationshipTypes":14,"pageSections":8}
<!-- ANALYZER-COUNTS:END -->

| quantity | value | what it counts |
| --- | --- | --- |
| analyzers | 50 | `src/ast/real-*-analyzer.ts` files — the implementations |
| analyzer pages | 50 | `docs/analyzers/<lane>.md`, one canonical page per analyzer (this directory) |
| lanes | 50 | fleet/instrument lanes, one per analyzer (`makefile` is the file name, `make` the lane name) |
| grammar-audit rows | 50 | F1 conformance rows. **It was 47 until 2026-11-05**: `julia`, `nim` and `solidity` were absent from the F1 table, so F1 measured nothing for them and some outputs read "47/47 languages". The missing rows are added and their literals adjudicated. |
| router languages | 53 | languages the detector can return = the 50 lanes + 3 route folds that hand a format to an existing analyzer: `tsx`→typescript, `sass`→css, `terraform`→hcl |
| relationship types | 14 | the canonical ontology (`src/ast/types.ts` `RelationshipType`) |
| page sections | 8 | measured sections a canonical page must carry with content (`TEMPLATE.md`) |

Older artifacts, the `history/` pages, and the narrative inside individual lane pages legitimately
quote 43/44/45/46/47/48/49: those were the count at the revision the sentence describes, recorded as
such (e.g. "the census scanned all 48 analyzers" is a measurement of that revision, not a claim about
today). The contract above applies to CURRENT statements — this page, the repository README
(`50 language analyzers`), and the gates' own output — and the three equalities the campaign depends
on (analyzer = canonical page = fleet lane = F1 grammar-audit row = 50) are asserted by
`script/m14/verify-analyzer-docs.ts` on every run.

## The 50 analyzers

| Language | Documentation | Analyzer source |
| --- | --- | --- |

| `bash` | [`bash.md`](./bash.md) | `src/ast/real-bash-analyzer.ts` |
| `c` | [`c.md`](./c.md) | `src/ast/real-c-analyzer.ts` |
| `clean` | [`clean.md`](./clean.md) | `src/ast/real-clean-analyzer.ts` |
| `clojure` | [`clojure.md`](./clojure.md) | `src/ast/real-clojure-analyzer.ts` |
| `cpp` | [`cpp.md`](./cpp.md) | `src/ast/real-cpp-analyzer.ts` |
| `csharp` | [`csharp.md`](./csharp.md) | `src/ast/real-csharp-analyzer.ts` |
| `css` | [`css.md`](./css.md) | `src/ast/real-css-analyzer.ts` |
| `dart` | [`dart.md`](./dart.md) | `src/ast/real-dart-analyzer.ts` |
| `elixir` | [`elixir.md`](./elixir.md) | `src/ast/real-elixir-analyzer.ts` |
| `erlang` | [`erlang.md`](./erlang.md) | `src/ast/real-erlang-analyzer.ts` |
| `fsharp` | [`fsharp.md`](./fsharp.md) | `src/ast/real-fsharp-analyzer.ts` |
| `go` | [`go.md`](./go.md) | `src/ast/real-go-analyzer.ts` |
| `graphql` | [`graphql.md`](./graphql.md) | `src/ast/real-graphql-analyzer.ts` |
| `groovy` | [`groovy.md`](./groovy.md) | `src/ast/real-groovy-analyzer.ts` |
| `haskell` | [`haskell.md`](./haskell.md) | `src/ast/real-haskell-analyzer.ts` |
| `hcl` | [`hcl.md`](./hcl.md) | `src/ast/real-hcl-analyzer.ts` |
| `html` | [`html.md`](./html.md) | `src/ast/real-html-analyzer.ts` |
| `java` | [`java.md`](./java.md) | `src/ast/real-java-analyzer.ts` |
| `javascript` | [`javascript.md`](./javascript.md) | `src/ast/real-javascript-analyzer.ts` |
| `json` | [`json.md`](./json.md) | `src/ast/real-json-analyzer.ts` |
| `julia` | [`julia.md`](./julia.md) | `src/ast/real-julia-analyzer.ts` |
| `kotlin` | [`kotlin.md`](./kotlin.md) | `src/ast/real-kotlin-analyzer.ts` |
| `lua` | [`lua.md`](./lua.md) | `src/ast/real-lua-analyzer.ts` |
| `make` | [`make.md`](./make.md) | `src/ast/real-makefile-analyzer.ts` |
| `markdown` | [`markdown.md`](./markdown.md) | `src/ast/real-markdown-analyzer.ts` |
| `matlab` | [`matlab.md`](./matlab.md) | `src/ast/real-matlab-analyzer.ts` |
| `nim` | [`nim.md`](./nim.md) | `src/ast/real-nim-analyzer.ts` |
| `objective-c` | [`objective-c.md`](./objective-c.md) | `src/ast/real-objective-c-analyzer.ts` |
| `perl` | [`perl.md`](./perl.md) | `src/ast/real-perl-analyzer.ts` |
| `php` | [`php.md`](./php.md) | `src/ast/real-php-analyzer.ts` |
| `powershell` | [`powershell.md`](./powershell.md) | `src/ast/real-powershell-analyzer.ts` |
| `protobuf` | [`protobuf.md`](./protobuf.md) | `src/ast/real-protobuf-analyzer.ts` |
| `python` | [`python.md`](./python.md) | `src/ast/real-python-analyzer.ts` |
| `r` | [`r.md`](./r.md) | `src/ast/real-r-analyzer.ts` |
| `ruby` | [`ruby.md`](./ruby.md) | `src/ast/real-ruby-analyzer.ts` |
| `rust` | [`rust.md`](./rust.md) | `src/ast/real-rust-analyzer.ts` |
| `scala` | [`scala.md`](./scala.md) | `src/ast/real-scala-analyzer.ts` |
| `scss` | [`scss.md`](./scss.md) | `src/ast/real-scss-analyzer.ts` |
| `solidity` | [`solidity.md`](./solidity.md) | `src/ast/real-solidity-analyzer.ts` |
| `sql` | [`sql.md`](./sql.md) | `src/ast/real-sql-analyzer.ts` |
| `svelte` | [`svelte.md`](./svelte.md) | `src/ast/real-svelte-analyzer.ts` |
| `swift` | [`swift.md`](./swift.md) | `src/ast/real-swift-analyzer.ts` |
| `toml` | [`toml.md`](./toml.md) | `src/ast/real-toml-analyzer.ts` |
| `typescript` | [`typescript.md`](./typescript.md) | `src/ast/real-typescript-analyzer.ts` |
| `vb` | [`vb.md`](./vb.md) | `src/ast/real-vb-analyzer.ts` |
| `vba` | [`vba.md`](./vba.md) | `src/ast/real-vba-analyzer.ts` |
| `vue` | [`vue.md`](./vue.md) | `src/ast/real-vue-analyzer.ts` |
| `xml` | [`xml.md`](./xml.md) | `src/ast/real-xml-analyzer.ts` |
| `yaml` | [`yaml.md`](./yaml.md) | `src/ast/real-yaml-analyzer.ts` |
| `zig` | [`zig.md`](./zig.md) | `src/ast/real-zig-analyzer.ts` |

## Documentation completeness (measured)

`validation/m14/results/analyzer-docs.json` records the last gate run; regenerate it by running the gate,
do not hand-edit it. The gate requires these **eight measured sections** with content — `Language`,
`Symbol contract`, `Relationship ontology`, `Supported constructs`, `Regex inventory`, `Complexity envelope`,
`Differential ground truth`, `Corpus validation` — plus an explained relationship-ontology table. The template
also carries `Unsupported / explicit-unknown constructs`, `Evidence pointers` and `Issue`; those are recommended,
not gated. A page already short when the gate was written is recorded as baseline and allowed to stay short;
losing a section fails.

| Measured state | Count |
| --- | --- |
| canonical pages present | 50 / 50 |
| complete on all eight measured sections | 18 / 50 |
| missing at least one measured section | 32 |
| unexplained relationship-ontology cells | 20 languages |
| fully complete (sections + no unexplained ontology cell) | 50 / 50 |

### Missing measured sections

None — every one of the 50 canonical pages carries all eight measured sections.

| `julia` | Language, Symbol contract, Relationship ontology, Supported constructs, Regex inventory, Complexity envelope, Differential ground truth, Corpus validation |
| `lua` | Language, Symbol contract, Relationship ontology, Supported constructs, Regex inventory, Complexity envelope, Differential ground truth, Corpus validation |
| `makefile` | Language, Symbol contract, Relationship ontology, Supported constructs, Regex inventory, Complexity envelope, Differential ground truth, Corpus validation |
| `matlab` | Language, Symbol contract, Relationship ontology, Supported constructs, Regex inventory, Complexity envelope, Differential ground truth, Corpus validation |
| `vba` | Language, Symbol contract, Relationship ontology, Supported constructs, Regex inventory, Complexity envelope, Differential ground truth, Corpus validation |
| `json` | Language, Symbol contract, Supported constructs, Regex inventory, Complexity envelope, Differential ground truth, Corpus validation |
| `protobuf` | Language, Relationship ontology, Supported constructs, Regex inventory, Complexity envelope, Differential ground truth, Corpus validation |
| `scss` | Language, Relationship ontology, Supported constructs, Regex inventory, Complexity envelope, Differential ground truth, Corpus validation |
| `zig` | Symbol contract, Relationship ontology, Supported constructs, Regex inventory, Complexity envelope, Differential ground truth, Corpus validation |
| `clean` | Relationship ontology, Supported constructs, Regex inventory, Complexity envelope, Differential ground truth, Corpus validation |
| `powershell` | Language, Symbol contract, Relationship ontology, Supported constructs, Differential ground truth, Corpus validation |
| `vb` | Relationship ontology, Supported constructs, Regex inventory, Complexity envelope, Differential ground truth, Corpus validation |
| `php` | Supported constructs, Regex inventory, Complexity envelope, Differential ground truth, Corpus validation |
| `r` | Supported constructs, Regex inventory, Complexity envelope, Differential ground truth, Corpus validation |
| `ruby` | Supported constructs, Regex inventory, Complexity envelope, Differential ground truth, Corpus validation |
| `solidity` | Language, Symbol contract, Relationship ontology, Differential ground truth, Corpus validation |
| `bash` | Language, Symbol contract, Differential ground truth, Corpus validation |
| `erlang` | Supported constructs, Regex inventory, Complexity envelope, Differential ground truth |
| `graphql` | Supported constructs, Regex inventory, Differential ground truth, Corpus validation |
| `swift` | Supported constructs, Regex inventory, Differential ground truth, Corpus validation |
| `elixir` | Supported constructs, Regex inventory, Differential ground truth |
| `haskell` | Supported constructs, Regex inventory, Differential ground truth |
| `perl` | Supported constructs, Differential ground truth, Corpus validation |
| `cpp` | Complexity envelope, Corpus validation |
| `hcl` | Supported constructs, Corpus validation |
| `markdown` | Differential ground truth, Corpus validation |
| `python` | Regex inventory, Corpus validation |
| `clojure` | Corpus validation |
| `css` | Complexity envelope |
| `html` | Complexity envelope |
| `kotlin` | Corpus validation |
| `sql` | Corpus validation |

### Unexplained relationship-ontology cells

None — every one of the 50 canonical pages has an explained relationship-ontology table with no empty cells.


`bash`, `c`, `clean`, `cpp`, `groovy`, `hcl`, `json`, `julia`, `kotlin`, `lua`, `makefile`, `matlab`, `powershell`, `protobuf`, `r`, `ruby`, `solidity`, `vb`, `vba`, `zig`

The full per-language rows, with the exact missing headings and cell gaps, are in the JSON artifact. Fixing this
debt is editorial work on the pages; the structure and the canonical names are done, and this table is the
measured worklist rather than an assumption.

## Verifying a page

```bash
npx tsx script/m14/verify-analyzer-docs.ts          # every page's sections/ontology cells
npx tsx script/m14/verify-analyzer-docs.ts --lang X # one language
```

The gate records `baseline` for languages that were already short of the template when the
gate was written, and fails a language that LOSES a section; it is the measured debt, not a
claim that every page is complete.
