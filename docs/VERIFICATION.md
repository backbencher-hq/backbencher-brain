# Verification Matrix

The quality gate is reproducible locally and in CI with Node 18+ and Bun. The
compiled distribution is Node-only because it uses `better-sqlite3`; source
verification runs under Bun with `bun:sqlite`. The supported commands are:

```bash
npm run typecheck
npm run build
npm run docs:verify
npm run verify
```

M10 baseline and governance gates run first inside `npm run verify`. They freeze the
runtime MCP registry, CLI options, package exports, legacy-intelligence inventory, and
the evidence-based decision rules before later M10 issues migrate or remove anything.

## Runtime Matrix

| Surface | Node compiled | Bun source | Gate |
|---|---:|---:|---|
| TypeScript typecheck | yes | n/a | `npm run typecheck` |
| Production build | yes | n/a | `npm run build` |
| Core/index/parser/embedding/freshness/schema | yes | yes | `npm run verify` |
| Search, semantic, graph, analysis | yes | yes | `npm run verify` |
| Patterns, security, test intelligence | yes | yes | `npm run verify` |
| Documentation and generated metadata | yes | yes | `docs:verify`, `verify-doc*` |
| Safe edit and rollback fixtures | yes | yes | `verify-edit`, MCP E2E |
| MCP handshake and exact public surface | yes | yes | `verify-mcp`, `verify-mcp-e2e` |
| Shared CLI gateway | yes | yes | `verify-cli-surface` |

## Fixture Coverage

The suite uses isolated temporary projects and databases for index, freshness,
FTS/content retrieval, dense/local-vector fallback, callers/callees/trace,
dependencies/complexity/impact, orphan and architecture findings, taint flows,
test mapping/gaps/quality/suggestions, cited documentation, bounded graph and
migration plans, health/integrity, and all edit modes.

Mutation fixtures explicitly cover project-root containment, sibling-prefix
escapes, symlink escapes, stale AST byte bounds, caller-protected deletion,
atomic writes, syntax validation, rollback, identifier-aware rename, and dry-run
non-mutation. MCP E2E exercises all ten advertised tools. Removed aliases are
checked to return the stable unknown-tool error rather than remaining callable.

## Budgets And Policy

All result-producing engines have explicit limits. Graph output defaults to 200
nodes and 5,000 links; documentation defaults to 20 evidence items and 4,000
tokens; migration requests cap at 100 symbols. Freshness is sampled by default,
with complete and integrity checks opt-in. The quality gate fails on type errors,
build errors, fixture failures, registry/schema drift, missing generated docs, or
MCP surface drift. It does not treat static findings as runtime exploit proofs or
static test links as executed coverage.

## Residual Risks

- Tree-sitter extraction and cross-language relationship resolution remain
  language-grammar dependent.
- Static security analysis can have false positives and false negatives.
- Semantic quality depends on configured embedding model and coverage.
- Static analysis remains evidence for review, not a substitute for runtime tests.

`script/verify-quality-gate.ts` checks this matrix, package scripts, aggregate
verification membership, and canonical artifact presence. It is included in the
aggregate `npm run verify` command.

`script/verify-m10-governance.ts` checks the M10 evidence taxonomy, disposition classes,
ordered issues, closure template, claim policy, and final-audit rule.
`script/verify-m10-baseline.ts` checks the M10 runtime descriptor snapshot, CLI surface,
library exports, handler coverage, legacy inventory markers, and aggregate gate wiring.
`script/verify-evidence-governance.ts` checks that canonical intelligence results carry
evidence provenance (evidence class, engine identity, source, limitations, bounds), that
runtime coverage stays separate from static test evidence, that unknown/stale states are
represented from real fixtures, and that malformed provenance is rejected.
