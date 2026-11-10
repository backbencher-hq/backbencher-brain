# Third-party grammar notices

Every directory under `grammars/` (except `_vendored/`) is third-party work redistributed
under its own license. This file records, per grammar: the package the source came from, the
license it declares, the upstream project, where the local-change record lives, and the license
text kept beside the source. The license texts and this notice are shipped in the npm package next
to the wasm binaries.

| grammar | package | license | upstream | local changes | license file |
| --- | --- | --- | --- | --- | --- |
| `tree-sitter-c` | tree-sitter-c 0.24.1 | MIT | https://github.com/tree-sitter/tree-sitter-c | PIN.md | LICENSE |
| `tree-sitter-clojure` | tree-sitter-clojure 0.4.0 | MIT | https://github.com/oakmac/tree-sitter-clojure | PROVENANCE.md | LICENSE.md |
| `tree-sitter-cpp` | tree-sitter-cpp 0.23.4 | MIT | https://github.com/tree-sitter/tree-sitter-cpp | PIN.md | LICENSE |
| `tree-sitter-csharp` | tree-sitter-c-sharp 0.23.5 | MIT | https://github.com/tree-sitter/tree-sitter-c-sharp | PROVENANCE.md | LICENSE |
| `tree-sitter-css` | tree-sitter-css 0.25.0 | MIT | https://github.com/tree-sitter/tree-sitter-css | README.md | LICENSE |
| `tree-sitter-dart` | tree-sitter-dart 1.0.0 | ISC | not declared by the upstream package | PROVENANCE.md | LICENSE |
| `tree-sitter-dart-upstream` | tree-sitter-dart 1.0.0 | ISC | https://github.com/UserNobody14/tree-sitter-dart | PROVENANCE.md | LICENSE |
| `tree-sitter-elixir` | tree-sitter-elixir 0.3.5 | Apache-2.0 | https://github.com/elixir-lang/tree-sitter-elixir | README.md | LICENSE |
| `tree-sitter-fsharp` | tree-sitter-fsharp 0.3.11 | MIT | https://github.com/ionide/tree-sitter-fsharp | README.md | LICENSE |
| `tree-sitter-graphql` | tree-sitter-graphql 0.0.1 | MIT | not declared by the upstream package | README.md | LICENSE |
| `tree-sitter-groovy` | tree-sitter-groovy 0.1.2 | MIT | https://github.com/amaanq/tree-sitter-groovy | README.md | LICENSE |
| `tree-sitter-haskell` | tree-sitter-haskell 0.23.1 | MIT | https://github.com/tree-sitter/tree-sitter-haskell | README.md | LICENSE |
| `tree-sitter-hcl` | @tree-sitter-grammars/tree-sitter-hcl 1.2.0 | Apache-2.0 | https://github.com/tree-sitter-grammars/tree-sitter-hcl | PIN.md | LICENSE |
| `tree-sitter-html` | tree-sitter-html 0.23.2 | MIT | https://github.com/tree-sitter/tree-sitter-html | README.md | LICENSE |
| `tree-sitter-julia` | tree-sitter-julia 0.23.1 | MIT | https://github.com/tree-sitter/tree-sitter-julia | PIN.md | LICENSE |
| `tree-sitter-kotlin` | tree-sitter-kotlin 0.3.8 | MIT | https://github.com/fwcd/tree-sitter-kotlin | PROVENANCE.md | LICENSE |
| `tree-sitter-lua` | @tree-sitter-grammars/tree-sitter-lua 0.4.1 | MIT | https://github.com/tree-sitter-grammars/tree-sitter-lua | README.md | LICENSE.md |
| `tree-sitter-make` | tree-sitter-make 1.1.1 | MIT | https://github.com/tree-sitter-grammars/tree-sitter-make | PIN.md | LICENSE |
| `tree-sitter-matlab` | tree-sitter-matlab | MIT | https://orgmode.org/ | README.md | LICENSE |
| `tree-sitter-nim` | tree-sitter-nim 0.6.2 | MPL-2.0 | not declared by the upstream package | PIN.md | LICENSE |
| `tree-sitter-objc` | tree-sitter-objc 3.0.2 | MIT | https://github.com/tree-sitter-grammars/tree-sitter-objc | PIN.md | LICENSE |
| `tree-sitter-perl` | tree-sitter-perl 1.2.1 | MIT | https://github.com/tree-sitter-perl/tree-sitter-perl | README.md | LICENSE |
| `tree-sitter-powershell` | tree-sitter-powershell 0.26.4 | MIT | https://github.com/airbus-cert/tree-sitter-powershell | README.md | LICENSE |
| `tree-sitter-proto` | tree-sitter-proto 0.1.0 | MIT | not declared by the upstream package | README.md | LICENSE |
| `tree-sitter-r` | @eagleoutice/tree-sitter-r 1.1.2 | MIT | https://github.com/r-lib/tree-sitter-r | README.md | LICENSE |
| `tree-sitter-ruby` | tree-sitter-ruby 0.23.1 | MIT | https://github.com/tree-sitter/tree-sitter-ruby | PROVENANCE.md | LICENSE |
| `tree-sitter-scss` | tree-sitter-scss 1.0.0 | MIT | https://github.com/tree-sitter-grammars/tree-sitter-scss | README.md | LICENSE |
| `tree-sitter-solidity` | tree-sitter-solidity 1.2.13 | MIT | not declared by the upstream package | PROVENANCE.md | LICENSE |
| `tree-sitter-sql` | @derekstride/tree-sitter-sql 0.3.11 | MIT | https://github.com/derekstride/tree-sitter-sql | PIN.md | LICENSE |
| `tree-sitter-typescript` | tree-sitter-typescript 0.23.2 | MIT | https://github.com/tree-sitter/tree-sitter-typescript | PROVENANCE.md | LICENSE |
| `tree-sitter-vba` | tree-sitter-vba | MIT | https://img.shields.io/npm/v/tree-sitter-vba.svg | README.md | LICENSE |
| `tree-sitter-vbnet` | tree-sitter-vbnet 0.1.0 | MIT | not declared by the upstream package | PIN.md | LICENSE |
| `tree-sitter-xml` | tree-sitter-xml | MIT | not declared by the upstream package | PIN.md | LICENSE |
| `tree-sitter-yaml` | @tree-sitter-grammars/tree-sitter-yaml 0.7.1 | MIT | https://github.com/tree-sitter-grammars/tree-sitter-yaml | README.md | LICENSE |

`grammars/_vendored/` is not a grammar: it holds this project's own preserved measurements and
repro materials, described in `_vendored/VENDORED.md`.

If you are a grammar author or maintainer and an attribution or license record here does not match
your intent, open an issue in this repository; correction is the fastest fix we can make.
