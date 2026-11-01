# Analyzer documentation

One canonical page per analyzer. Every supported language has exactly one file here —
`docs/analyzers/<language>.md` — and it is the page the documentation gate measures
(`script/m14/verify-analyzer-docs.ts`): it must carry the eleven sections of
[`TEMPLATE.md`](./TEMPLATE.md) with content, and its relationship-ontology table must
leave no cell unexplained.

The pre-2026-11-01 split (`real-<language>-analyzer.md` for the structured page plus a
second `<language>.md` verdict/journal page) is gone: the structured page took the
natural `<language>.md` name, and the old investigation journals are kept, clearly
separated, under [`history/`](./history/) because tracked code and validation evidence
cite them by path. The [session log](./ANALYZER-SESSION-LOG.md) is the campaign's work
record; it is history, not a contract.

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

## Verifying a page

```bash
npx tsx script/m14/verify-analyzer-docs.ts          # every page's sections/ontology cells
npx tsx script/m14/verify-analyzer-docs.ts --lang X # one language
```

The gate records `baseline` for languages that were already short of the template when the
gate was written, and fails a language that LOSES a section; it is the measured debt, not a
claim that every page is complete.
