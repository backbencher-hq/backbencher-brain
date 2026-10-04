# Ontology Workstream — laptop B (23 languages)

Companion to `docs/M14-HONESTY-CONTRACT.md`. Read both before writing code.

Two laptops split the analyzer set. This document covers laptop B only.

## Scope

| Language | Module |
|---|---|
| Bash | `src/ast/real-bash-analyzer.ts` |
| F# | `src/ast/real-fsharp-analyzer.ts` |
| Zig | `src/ast/real-zig-analyzer.ts` |
| Lua | `src/ast/real-lua-analyzer.ts` |
| Julia | `src/ast/real-julia-analyzer.ts` |
| Nim | `src/ast/real-nim-analyzer.ts` |
| PHP | `src/ast/real-php-analyzer.ts` |
| PowerShell | `src/ast/real-powershell-analyzer.ts` |
| R | `src/ast/real-r-analyzer.ts` |
| Dart | `src/ast/real-dart-analyzer.ts` |
| SQL | `src/ast/real-sql-analyzer.ts` |
| GraphQL | `src/ast/real-graphql-analyzer.ts` |
| Protobuf | `src/ast/real-protobuf-analyzer.ts` |
| JSON | `src/ast/real-json-analyzer.ts` |
| YAML | `src/ast/real-yaml-analyzer.ts` |
| CSS | `src/ast/real-css-analyzer.ts` |
| SCSS | `src/ast/real-scss-analyzer.ts` |
| HCL | `src/ast/real-hcl-analyzer.ts` |
| Make | `src/ast/real-makefile-analyzer.ts` |
| TOML | `src/ast/real-toml-analyzer.ts` |
| XML | `src/ast/real-xml-analyzer.ts` |
| Markdown | `src/ast/real-markdown-analyzer.ts` |
| Clean | `src/ast/real-clean-analyzer.ts` |

## The three verdicts

For each of the 10 relationship types — `calls`, `uses`, `contains`, `imports`,
`references`, `exports`, `extends`, `implements`, `overrides`, `instantiates` —
exactly one verdict:

- **EMITTED** — production `parseFile` (from `src/ast/pool-worker.ts`, NOT
  `analyze()`) produced it on real corpus files. Carries a count and file names.
- **RULED** — a written reason AND a corpus measurement showing the construct
  the type would need does not occur. The ruling is falsifiable: a probe finding
  a non-zero count overturns it.
- **GAP** — the language has the construct and the analyzer does not read it.
  Then implement it.

`script/m14/ontology-coverage-gate.ts <lang>` is the arbiter. It reports
`EMITTED` / `RULED-SOUND` / `FALSIFIED` / `RULED-UNJUSTIFIED`.

## Why absence is never acceptable without a measurement

The lane's differential once reported high agreement and zero unexplained edges
across a large edge count, and that was true — and it hid a missing
relationship type for an entire wave. The reason is structural. The analyzer and
the oracle are two separate walkers over one grammar, so they disagree when
either is wrong. But when a type is absent from BOTH, because the implementer
ruled it inapplicable and the oracle was written after that ruling, there is
nothing to disagree about. Both say nothing, and nothing agrees with nothing.

Measuring the LANGUAGE found it. Only a measurement can.

## The two instruments

A text regex is the wrong instrument for "does this language have this
construct". The gate's first version returned two false positives this way: a
probe for `extends` matched the words `class voice` inside a telnet IAC word list
in a string literal; a probe for `instantiates` matched `new Map(` in a bash
file carrying embedded JavaScript inside a heredoc.

So:

- **A: grammar-inventory** — for a type needing a node type the language does
  not have. Enumerate every node type the grammar actually produces across the
  corpus. Bash yields 164 and none expresses a type declaration. That is
  positive evidence of absence.
- **B: parse-tree semantic count** — for a type the language CAN express. A
  second declaration of a name is perfectly good bash, so no grammar inventory
  finds it; it must be counted on the tree, where a string or a heredoc cannot
  fake it.

## The six questions for a type that is already emitted

These fail independently, and passing one says nothing about the others.

1. **Exists** — the analyzer can construct it.
2. **Fires** — it produces edges on a real corpus. A type reachable only from a
   branch that never matches is dead code; source derivation cannot see this.
3. **Correct** — an independent oracle agrees. The oracle is a separate walker
   over the same grammar, so a grammar bug shared by both is invisible. This is
   the harness's declared limitation.
4. **Labelled** — the edge carries the right type, not a neighbouring one.
5. **Resolved** — both endpoints bind to real symbols. An edge can exist and
   still be unresolvable; CSS `references` resolves at both ends on 66.8% of
   its edges.
6. **Confident** — `evidenceClass` and confidence are right. Anything under 0.7
   counts as heuristic, not fact.

### DERIVATION findings

A DERIVATION finding is a type the analyzer emits that the differential never
audits — stored and compared against nothing. There are 100 of these across 34
lanes. Lanes with zero DERIVATION findings at handover: `bash`, `css`, `fsharp`,
`go`, `html`, `kotlin`, `markdown`, `powershell`, `ruby`, `scss`, `toml`, `zig`.

For laptop B, `bash`, `css`, `fsharp`, `markdown`, `powershell`, `scss`, `toml`
and `zig` start at zero. Pay the DERIVATION debt down elsewhere.

## The fabrication rule

The most expensive mistake available is inventing a relationship edge the
language does not have. A fabricated edge is counted as `unexplained` by the
differential oracle, and it poisons `bb_graph`, `bb_impact` and `bb_migrate` — a
fake caller becomes wrong refactoring advice.

Never manufacture an edge to fill a table. A narrow graph that is true beats a
wide graph that is not.

## Corpus

`$HOME/fixtures/repositories/`, ~6.1 GB across ~90 repositories.
Override with `BB_CORPUS_ROOT`.

A ruling with no corpus is worthless. If your language's corpus is thin, clone
more: `git clone --depth 1 --filter=blob:none https://github.com/OWNER/REPO`.
Delete build artifacts, never source. Check `df -h /` first.

## Standing rules

- No unknown symbols. `SymbolKind` is never empty or `unknown`.
- No empty symbol names.
- No edge endpoint equal to the placeholder literal `unknown`. See rule R7 in
  `validation/m60/ledger.json`.
- Confidence below 0.7 is a heuristic and must be countable as one.
- Claim levels are L0–L5 per the honesty contract §2. Only L5 may be called
  "verified", and only with its scope attached.
- Every Turing-complete analyzer declares a non-empty `limitations` array. A
  blank limitations list is treated as dishonesty, not excellence.

## Budgets

More edges means bigger graphs, and the graph surface is budgeted. `bb_graph`'s
un-narrowed default is measured at 2.5–4.8× a kind-filtered one. If an addition
regresses a budgeted lane, report the regression. Do not quietly re-baseline.

## Branch layout

- Laptop B aggregate: `analyzers/ontology-laptop-b`
- Per language: `analyzer/BASH`, `analyzer/F_SHARP`, `analyzer/ZIG`,
  `analyzer/LUA`, `analyzer/JULIA`, `analyzer/NIM`, `analyzer/PHP`,
  `analyzer/POWERSHELL`, `analyzer/R`, `analyzer/DART`, `analyzer/SQL`,
  `analyzer/GRAPHQL`, `analyzer/PROTOBUF`, `analyzer/JSON`, `analyzer/YAML`,
  `analyzer/CSS`, `analyzer/SCSS`, `analyzer/HCL`, `analyzer/MAKE`,
  `analyzer/TOML`, `analyzer/XML`, `analyzer/MARKDOWN`, `analyzer/CLEAN`

One agent, one analyzer, one branch. Merge each finished language branch into
the aggregate as it lands, so twenty languages never arrive in one commit.

Nothing merges to `main` from this workstream. The owner does that.

## Ownership

Per-language agents own `src/ast/real-<lang>-analyzer.ts`,
`docs/analyzers/real-<lang>-analyzer.md`, and that lane's fixtures under
`test/` and `validation/m14/fixtures/<lang>/`.

The supervisor owns everything shared: `script/m14/differential.ts`,
`script/m14/mutate-analyzer.ts`, `validation/m14/differential-baseline.json`,
`validation/m14/results/*.json`, `validation/m60/ledger.json`,
`script/m14/ontology-coverage-gate.ts`, `src/ast/types.ts`, `src/ast/engine.ts`,
`website/src/data/brain-languages.ts` (derived — regenerated, never
hand-edited), and `package.json`.

An agent that needs a shared file changed reports the need; it does not edit it.