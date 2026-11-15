# M72 — language ownership ledger (one language, one owner)

53 matrix languages (derived from `src/ast/engine.ts` via `ASTEngine.supportedLanguageNames()`).
Tier comes from `src/intelligence/security/rebuild/registry.ts`; this file records
who owns the security spec + fixtures for each language and is the durable brief
for a restarted owner (standing rule: one language, one lane, forever).

## Tier baseline (Phase 0)

- **scan:** 0 — promotion requires the Phase 2 per-language gate + oracle.
- **leads:** 36 executable code languages (lexical source/sink rules, no data-flow proof).
- **unsupported:** 17 data/markup/schema/config/query languages (answer must say "not scanned").
- Counts are printed by `formatSecurityTierDeclaration()`; the matrix gate reads the same registry.

## Owners

| Language | Tier | Owner | Spec file | Fixtures |
|---|---|---|---|---|
| bash | leads | specs-a | `specs/bash.ts` | `validation/m72/fixtures/bash/` |
| c | leads | specs-a | `specs/c.ts` | `validation/m72/fixtures/c/` |
| clean | leads | specs-a | `specs/clean.ts` | `validation/m72/fixtures/clean/` |
| clojure | leads | specs-a | `specs/clojure.ts` | `validation/m72/fixtures/clojure/` |
| cpp | leads | specs-a | `specs/cpp.ts` | `validation/m72/fixtures/cpp/` |
| csharp | leads | specs-a | `specs/csharp.ts` | `validation/m72/fixtures/csharp/` |
| dart | leads | specs-a | `specs/dart.ts` | `validation/m72/fixtures/dart/` |
| elixir | leads | specs-a | `specs/elixir.ts` | `validation/m72/fixtures/elixir/` |
| erlang | leads | specs-a | `specs/erlang.ts` | `validation/m72/fixtures/erlang/` |
| fsharp | leads | specs-a | `specs/fsharp.ts` | `validation/m72/fixtures/fsharp/` |
| go | leads | specs-a | `specs/go.ts` | `validation/m72/fixtures/go/` |
| groovy | leads | specs-a | `specs/groovy.ts` | `validation/m72/fixtures/groovy/` |
| haskell | leads | specs-a | `specs/haskell.ts` | `validation/m72/fixtures/haskell/` |
| java | leads | specs-a | `specs/java.ts` | `validation/m72/fixtures/java/` |
| javascript | leads | specs-a | `specs/javascript.ts` | `validation/m72/fixtures/javascript/` |
| julia | leads | specs-a | `specs/julia.ts` | `validation/m72/fixtures/julia/` |
| kotlin | leads | specs-a | `specs/kotlin.ts` | `validation/m72/fixtures/kotlin/` |
| lua | leads | specs-a | `specs/lua.ts` | `validation/m72/fixtures/lua/` |
| matlab | leads | specs-b | `specs/matlab.ts` | `validation/m72/fixtures/matlab/` |
| nim | leads | specs-b | `specs/nim.ts` | `validation/m72/fixtures/nim/` |
| objective-c | leads | specs-b | `specs/objective-c.ts` | `validation/m72/fixtures/objective-c/` |
| perl | leads | specs-b | `specs/perl.ts` | `validation/m72/fixtures/perl/` |
| php | leads | specs-b | `specs/php.ts` | `validation/m72/fixtures/php/` |
| powershell | leads | specs-b | `specs/powershell.ts` | `validation/m72/fixtures/powershell/` |
| python | leads | specs-b | `specs/python.ts` | `validation/m72/fixtures/python/` |
| r | leads | specs-b | `specs/r.ts` | `validation/m72/fixtures/r/` |
| ruby | leads | specs-b | `specs/ruby.ts` | `validation/m72/fixtures/ruby/` |
| rust | leads | specs-b | `specs/rust.ts` | `validation/m72/fixtures/rust/` |
| scala | leads | specs-b | `specs/scala.ts` | `validation/m72/fixtures/scala/` |
| solidity | leads | specs-b | `specs/solidity.ts` | `validation/m72/fixtures/solidity/` |
| swift | leads | specs-b | `specs/swift.ts` | `validation/m72/fixtures/swift/` |
| tsx | leads | specs-b | `specs/typescript.ts` (alias) | `validation/m72/fixtures/tsx/` |
| typescript | leads | specs-b | `specs/typescript.ts` | `validation/m72/fixtures/typescript/` |
| vb | leads | specs-b | `specs/vb.ts` | `validation/m72/fixtures/vb/` |
| vba | leads | specs-b | `specs/vba.ts` | `validation/m72/fixtures/vba/` |
| zig | leads | specs-b | `specs/zig.ts` | `validation/m72/fixtures/zig/` |

## Unsupported (registry only; no spec, no fixture)

css, graphql, hcl, html, json, make, markdown, protobuf, sass, scss, sql, svelte,
terraform, toml, vue, xml, yaml — each carries a reason in `registry.ts`. The
matrix must assert their answer says "not scanned", never "0 findings".

## Promotion protocol

A language moves to `scan` only when all hold, recorded in
`validation/m72/promotions/<lang>.json`:
1. spec exists with sources, sinks, sanitizers and lexical syntax;
2. vulnerable/clean/sanitized fixtures produce the expected lead/no-lead;
3. the per-language precision/recall oracle passes the agreed floor;
4. matrix row records the new tier and the gate is red on regression.
