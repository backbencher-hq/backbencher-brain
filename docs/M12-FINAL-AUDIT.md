# M12 Final Per-Analyzer Audit And Release-Readiness Decision

Issue: [#182](https://github.com/backbencher-hq/backbencher-brain/issues/182)

Date: 2026-08-21

Milestone status: **complete** — GitHub milestone #12 is closed with 47 closed issues and 0 open issues.

Release decision: **ready** for version `0.3.0`

Advertised-language decision: **41 analyzers** — every wired analyzer passes the
full per-analyzer audit; no analyzer is unverifiable or hidden.

## Issue And Dependency Audit

M12 was executed in dependency order. M12.01 through M12.47 are closed.
The core analyzer track and all four integration-track issues are complete;
this document records the final per-analyzer release decision.

| Order | Issue | Commit | Result |
| --- | --- | --- | --- |
| M12.01 | #140 | `1f6fdd1` | Closed; harness, regex census, governance |
| M12.02 | #141 | `b5e2f07` | Closed; Java 1.000/1.000 |
| M12.03 | #142 | `5ca1c9c` | Closed; Kotlin regex-free |
| M12.04 | #143 | `34972a8` | Closed; Clojure grammar upgrade |
| M12.05 | #144 | `2882e79` | Closed; Scala grammar v0.26.2 |
| M12.06 | #145 | `bafcce7` | Closed; Groovy patched grammar |
| M12.07 | #146 | `2ddafe7` | Closed; C# grammar v0.23.5 |
| M12.08 | #147 | `5dc0111` | Closed; F# patched grammar |
| M12.09 | #148 | `d3543e6` | Closed; TypeScript 1.000/1.000 |
| M12.10 | #149 | `0ac8cea` | Closed; JavaScript 1.000/1.000 |
| M12.11 | #150 | `0468b25` | Closed; Dart 1.000/1.000 |
| M12.12 | #151 | `c22217b` | Closed; Vue verified |
| M12.13 | #152 | `adf069d` | Closed; Svelte verified |
| M12.14 | #153 | `382f921` | Closed; HTML verified |
| M12.15 | #154 | `fff2280` | Closed; CSS verified |
| M12.16 | #155 | `8730332` | Closed; C verified |
| M12.17 | #156 | `b0e1451` | Closed; C++ verified |
| M12.18 | #157 | `36223d5` | Closed; Rust verified |
| M12.19 | #158 | `3a5a912` | Closed; Objective-C verified |
| M12.20 | #159 | `80e3e8b` | Closed; Zig verified |
| M12.21 | #160 | `91e7717` | Closed; Swift verified |
| M12.22 | #161 | `46ce070` | Closed; Go verified |
| M12.23 | #162 | `22908d7` | Closed; Elixir verified |
| M12.24 | #163 | `3abdaad` | Closed; Erlang verified |
| M12.25 | #164 | `343611a` | Closed; Haskell verified |
| M12.26 | #165 | `d47e01d` | Closed; Clean verified |
| M12.27 | #166 | `33d0797` | Closed; Python 1.000/1.000 |
| M12.28 | #167 | `c878dea` | Closed; Ruby 1.000/1.000 |
| M12.29 | #168 | `2e75cfb` | Closed; PHP 1.000/1.000 |
| M12.30 | #169 | `680fdd6` | Closed; Perl 1.000/1.000 |
| M12.31 | #170 | `61cd882` | Closed; R with AST evidence |
| M12.32 | #171 | `d1666a0` | Closed; Lua with grammar evidence |
| M12.33 | #172 | `5046409` | Closed; SQL with grammar evidence |
| M12.34 | #173 | `73d7e27` | Closed; JSON with AST evidence |
| M12.35 | #174 | `82da74d` | Closed; XML with AST evidence |
| M12.36 | #175 | `2e54a82` | Closed; YAML with AST evidence |
| M12.37 | #176 | `1af6509` | Closed; HCL with AST evidence |
| M12.38 | #177 | `3392163` | Closed; GraphQL with AST evidence |
| M12.39 | #178 | `301cb4a` | Closed; Bash with AST evidence |
| M12.40 | #179 | `bec08c9` | Closed; PowerShell with AST evidence |
| M12.41 | #180 | `3c52ece` | Closed; Make with AST evidence |
| M12.42 | #181 | `ca349a3` | Closed; Markdown with AST evidence |
| M12.43 | #182 | audit commit | Closed; final per-analyzer audit and release readiness |
| M12.44 | #183 | `5792259` | Closed; full analyzer pipeline wiring |
| M12.45 | #184 | `3521b23` | Closed; tools consume all 41 analyzer surfaces |
| M12.46 | #185 | `c8f711f` | Closed; framework intelligence across all languages |
| M12.47 | #186 | `30324d8` | Closed; MCP/CLI coverage across all 41 languages |

No dependency was bypassed. Each issue was closed only after its predecessor
was complete and its issue-specific verifier passed.

## Artifact Matrix

| Evidence | Location | Coverage |
| --- | --- | --- |
| Fixtures | `validation/m12/fixtures/<lang>/` | 41 languages |
| Ground truth | `validation/m12/ground-truth/<lang>.json` | 41 languages |
| Differentials | `validation/m12/results/<lang>-differential.json` | 41 languages |
| Complexity envelopes | `validation/m12/results/<lang>(-corpus)-complexity.json` | 41 languages |
| Contract probes | `validation/m12/results/<lang>-contract.json` + `script/m12/<lang>-contract-probe.ts` | late-track languages |
| Shape audits | `validation/m12/results/<lang>-corpus-shapes.json` + `<lang>-node-types-compare.ts` | late-track languages |
| Corpus error surveys | `validation/m12/results/<lang>-corpus-errors.json` | 10 languages |
| Corpus manifest | `validation/m12/corpus-manifest.json` | pinned revisions + policies |
| Regex census | `validation/m12/results/regex-census.json` | 41 analyzers |
| Analyzer docs | `docs/analyzers/real-<lang>-analyzer.md` | 41 analyzers |
| MCP/CLI surface | `validation/m12/results/mcp-cli-surface.json` | 41 languages × 9 capabilities |

The machine-readable artifact (`docs/data/m12-final-audit.json`) contains the
complete per-issue inventory and is validated by
`script/verify-m12-final-audit.ts`.

## Per-Analyzer Differential Audit

All **41 analyzers** pass their differential against independent hand-audited
ground truth:

- **3,258 total fixture facts** across 41 languages.
- **0 false positives, 0 false negatives, 0 unknown symbols** — every
  differential records precision = 1 and recall = 1.
- Differential identity contract: symbol facts keyed by
  `file:line:kind:name`; relationship facts keyed by
  `file:type:sourceId:targetId` with `attributes={type}` only, so the
  comparison measures extraction correctness rather than naming noise.

## Regex Census

The milestone's founding requirement was a regex census with **zero
unclassified** usages. The final census records **0 regex usages across all 41
analyzers** — the last two (`needs_review` in `real-java-analyzer.ts`,
parameter-text splitting in the ERROR-node recovery path) were replaced with
char-code walking in this audit. The strict gate
(`script/m12/verify-regex-census.ts`) reports:

```
missing from census: 0
stale in census: 0
unclassified: 0
mislocated: 0
regex census gate PASSED
```

## Complexity

Every analyzer has a recorded complexity envelope. The analyzer family uses
single-pass tree-sitter DFS with Map/Set dedupe, O(1) name/containment lookup
structures (built once per file), and no per-symbol O(n) scans. The
parallel-indexer's relationship resolution and contains-pair dedupe were
converted to O(1) lookups during M12. No O(n²) hot path remains.

## Hidden Filters And Claims

- **No hidden project-specific filters.** No analyzer filters by repository
  identity. Path-based architecture inference (e.g. C preprocessor word-size
  hints via `x86_64`/`aarch64` path segments) is language-level inference, not
  repository filtering. Corpus selection is declared in
  `validation/m12/corpus-manifest.json` (`cloned_repositories_only`), and
  every corpus-errors result names its tracked, clean, and excluded counts.
- **No unsupported exact claims.** Every corpus measure uses the production
  pool-worker `parseFile` path. Precision/recall claims are scoped to the
  audited fixtures at pinned revisions, exactly as recorded.

## Failures: Fixed Or Explicitly Classified

| ID | Classification | Detail |
| --- | --- | --- |
| F1 | Environment artifact (fixed for gate run) | `verify-embed` requires direct localhost access; this machine's `http_proxy`/`https_proxy`/`ALL_PROXY` env vars route the mock embedding API through a proxy that rejects `client_connect_invalid_ip` for `127.0.0.1`. With proxy env vars unset, `EMBED VERIFY: ALL PASS`. No code change required. |
| F2 | Flaky gate (accepted) | `verify-contracts` occasionally reports `CONTRACT BASELINE: 1 FAILURES` when run after 45 sequential gates (MCP server spawn timing under load). Standalone and re-run pass. No code change required. |
| F3 | Named grammar limitations (accepted) | Tree-sitter grammar limitations are counted and named per corpus-errors result (PowerShell modern constructs, Markdown list indentation, SQL vendor dialect). Never hidden. |

## Gates

| Gate | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `verify-m11-parser-matrix` | PASS |
| `verify-m11-lifecycle` | PASS |
| `verify-m11-differential-harness` | PASS |
| `verify-m12/verify-regex-census` | PASS |
| `verify-mcp-e2e` | PASS (10 public tools) |
| `M12.47 surface verifier` | PASS (41 languages × 9 capabilities) |
| `npm run verify` (proxy-unset env) | PASS |

## Runtime Evidence

Bun/source evidence: all M12-specific verifiers run with Bun through the
production pool-worker `parseFile` path. Compiled runtime evidence is covered
by the M10 integration-runtime verifier; M12 adds no new runtime surface.

## Limitations And Deferred Work

Accepted residual risks:

- Static analysis cannot prove runtime execution coverage; every corpus
  measure uses the production pool-worker path.
- Grammar ERROR nodes in a small named subset of corpus files are reported as
  warnings with explicit constructs; they are counted, never hidden.
- Cross-file override-target resolution (Java/Kotlin) uses the optional
  `AnalyzeContext` companion index in the harness; production wiring of the
  same context is tracked by M12.44.
- Corpus measurements are revision-local; pinned revisions are recorded in
  `validation/m12/corpus-manifest.json`.
- Markdown inline links require the companion `tree-sitter-markdown-inline`
  WASM; the engine pre-parses inline nodes at index time (vue/svelte SFC
  pattern).

All listed risks are accepted for `0.3.0`. None changes the frozen public
contract or blocks release readiness. The integration track (M12.44+) is
complete and included in the closed M12 milestone.

## Claims Policy

Unsupported claims are not presented as proven. Every per-analyzer
differential, contract, shape, corpus, and complexity result carries explicit
provenance and named limitations.

## Release Decision

**Ready** for `0.3.0` with **41 advertised languages**, each backed by a
differential at P/R 1.000 against independent ground truth, a complexity
envelope, a named corpus policy, and a documented analyzer page. The regex
census is zero across all analyzers. Full local and corpus gates pass.

## Reproduction

1. `npm run typecheck`
2. `npm run verify` (with `http_proxy`/`https_proxy`/`ALL_PROXY` unset on
   proxied machines)
3. `bun run script/m12/verify-regex-census.ts`
4. `bun run script/verify-m11-parser-matrix.ts`
5. `bun run script/verify-m11-lifecycle.ts`
6. `bun run script/verify-m11-differential-harness.ts`
7. `bun run script/verify-m12-final-audit.ts`

## Worktree And Commit Evidence

The M12 audit and integration evidence are committed through M12.47,
including the refreshed differentials, regex census, pipeline/tool/framework
verification, and MCP/CLI surface evidence. GitHub milestone #12 is closed.
