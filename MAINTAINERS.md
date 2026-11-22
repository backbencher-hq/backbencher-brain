<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — who owns which language analyzer, what that ownership obliges, and how
a new owner is added. The file that turns 50 language analyzers into a set of named people.
WHO IT IS FOR — anyone considering taking a language, and any reviewer routing a pull request.
EDIT TOGETHER WHEN THIS CHANGES — CODEOWNERS (review routing), docs/analyzers/<language>.md
(that language's evidence), CONTRIBUTING.md (the contribution rules this file assumes).
-->

# Maintainers

Backbencher Brain is 50 language analyzers over one index. Each language is meant to have a
named maintainer who knows that language's grammar and resolver, and who decides what a correct
relationship looks like for it.

This file is that roster. `CONTRIBUTING.md` says how to contribute; this file says **who owns
what**, and how to become one of them.

## The roster

Every language currently reads `interim`, which means the project maintainer is the fallback
reviewer. A language leaves `interim` when a named person takes it.

| Language | Analyzer doc | Owner | Since |
| --- | --- | --- | --- |
| TypeScript | [`docs/analyzers/typescript.md`](docs/analyzers/typescript.md) | **open — wave 1** | — |
| Rust | [`docs/analyzers/rust.md`](docs/analyzers/rust.md) | **open — wave 1** | — |
| Python | [`docs/analyzers/python.md`](docs/analyzers/python.md) | **open — wave 1** | — |
| Java | [`docs/analyzers/java.md`](docs/analyzers/java.md) | interim | — |
| Go | [`docs/analyzers/go.md`](docs/analyzers/go.md) | interim | — |
| C++ | [`docs/analyzers/cpp.md`](docs/analyzers/cpp.md) | interim | — |
| C# | [`docs/analyzers/csharp.md`](docs/analyzers/csharp.md) | interim | — |
| Ruby | [`docs/analyzers/ruby.md`](docs/analyzers/ruby.md) | interim | — |
| PHP | [`docs/analyzers/php.md`](docs/analyzers/php.md) | interim | — |
| Kotlin | [`docs/analyzers/kotlin.md`](docs/analyzers/kotlin.md) | interim | — |
| Swift | [`docs/analyzers/swift.md`](docs/analyzers/swift.md) | interim | — |
| Scala | [`docs/analyzers/scala.md`](docs/analyzers/scala.md) | interim | — |
| Dart | [`docs/analyzers/dart.md`](docs/analyzers/dart.md) | interim | — |
| Elixir | [`docs/analyzers/elixir.md`](docs/analyzers/elixir.md) | interim | — |
| Erlang | [`docs/analyzers/erlang.md`](docs/analyzers/erlang.md) | interim | — |
| Clojure | [`docs/analyzers/clojure.md`](docs/analyzers/clojure.md) | interim | — |
| Haskell | [`docs/analyzers/haskell.md`](docs/analyzers/haskell.md) | interim | — |
| F# | [`docs/analyzers/fsharp.md`](docs/analyzers/fsharp.md) | interim | — |
| Objective-C | [`docs/analyzers/objective-c.md`](docs/analyzers/objective-c.md) | interim | — |
| Solidity | [`docs/analyzers/solidity.md`](docs/analyzers/solidity.md) | interim | — |
| Groovy | [`docs/analyzers/groovy.md`](docs/analyzers/groovy.md) | interim | — |
| Perl | [`docs/analyzers/perl.md`](docs/analyzers/perl.md) | interim | — |
| Lua | [`docs/analyzers/lua.md`](docs/analyzers/lua.md) | interim | — |
| Julia | [`docs/analyzers/julia.md`](docs/analyzers/julia.md) | interim | — |
| R | [`docs/analyzers/r.md`](docs/analyzers/r.md) | interim | — |
| Zig | [`docs/analyzers/zig.md`](docs/analyzers/zig.md) | interim | — |
| Nim | [`docs/analyzers/nim.md`](docs/analyzers/nim.md) | interim | — |
| HCL / Terraform | [`docs/analyzers/hcl.md`](docs/analyzers/hcl.md) | interim | — |
| others (see `docs/analyzers/`) | [`docs/analyzers/`](docs/analyzers/) | interim | — |

The full list is `docs/analyzers/` — one document per analyzer, each carrying its parser digest,
its current relationship numbers, and its open gaps. If your language is not in the table above,
it is still in that directory, and this file is the wrong place to look for it.

## What a language maintainer owns

Bounded on purpose. You do not inherit a codebase; you inherit one language.

- **Its analyzer.** `src/ast/real-<language>-analyzer.ts` and any resolver or resolution helper
  specific to it.
- **Its document.** `docs/analyzers/<language>.md` — including the numbers it publishes, so they
  stay true.
- **Its gates.** The checks under `script/` that assert this language's relationships, plus the
  fixtures they run against. Adding a fixture for a construct your community cares about is
  first-class work, not a side quest.
- **The last word** on what a correct relationship means in that language. That is the part
  nobody else can supply.

## What you get

- A named line in this file and in `CODEOWNERS`, so review is routed to you automatically on
  your analyzer's files and its tests.
- A GitHub team for the language, with write access scoped to it.
- Your community's grammar, wired and digest-verified in-tree, maintained to a standard you can
  point at.

## What it does not mean

- You do not review the whole project.
- You are not on call. This project is maintained, not staffed: answer when you can.
- You do not need to fix another language to land a fix in yours.

## Taking a language

1. Open an issue titled `maintainer: <language>` using the `good first issue` template, or
   comment on an existing one. Say what you already know about the grammar and which gaps you
   would close first.
2. Run the fast loop once so your first message can include a green result:

   ```bash
   npm ci && npm run build && npm run verify:fast
   ```

3. Open one small, real change in your language — a resolver fix, a missing relationship, a new
   fixture. That change is the application. A name in this file is cheap; a green gate on your
   own grammar is the proof.
4. On merge, your name and handle replace `open`/`interim` here, and a `CODEOWNERS` line lands
   with it.

## Waves

Ownership is opened in waves, not all at once. A language community is asked only when someone
from it has already shown up, and each new maintainer is invited to bring the next.

| Wave | Languages |
| --- | --- |
| 1 (open now) | TypeScript, Rust, Python |
| 2 | Java, Go, C++, C# |
| 3+ | remaining languages, as owners appear |

## Interim

Until a language has a named owner, the project maintainer is the reviewer of last resort for
it. That is a bus-factor statement, not a promise of promptness — and it is the reason this file
exists.
