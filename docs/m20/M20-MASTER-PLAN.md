# M20: Niche Intelligence Tools Correctness & Trust

Status: `open`
GitHub milestone: `20`
Issue range: `#428`–`#444`

## Purpose

M20 audits `bb_migrate`, `bb_patterns`, `bb_security`, and `bb_doc` as working
products. It does not treat an existing zero exit code, a shaped response, or a
known limitation as proof of correctness. Every capability must end in one of
three honest states:

- `verified`: behavior passed a fail-able check with current persisted evidence.
- `known-gap`: a real check or required corpus failed; the limitation remains open.
- `blocked`: required environment, corpus, or dependency was unavailable.

`planned` is allowed only before an issue has executable evidence. It is never a
release claim.

## Authority order

1. Executable implementation and public handler behavior
2. Versioned machine-readable evidence and the verifier that produced it
3. Registry/schema contracts
4. Per-tool documentation
5. GitHub issue text and human summaries

A lower authority cannot upgrade a higher-authority failure. Documentation may
explain a limitation, but it cannot turn a failed or missing behavioral check
into `verified`.

## Scope

The four tools are audited through their direct engine, handler, CLI, MCP, and
history surfaces where applicable:

- `bb_migrate`: graph ordering, effort methodology, mappings, unsupported cases
- `bb_patterns`: complete candidate scans, orphan semantics, pagination, history
- `bb_security`: source/sink evidence, heuristic boundaries, state/history policy
- `bb_doc`: modes, citations, freshness, budgets, examples, diagrams

Cross-tool gates cover transport parity, corpus reproducibility, mutation
resistance, runtime/resource measurements, documentation truth, and dependency
boundaries with the co-agent's M14 analyzer work.

## Evidence rules

Every M20 verifier must:

- execute production code or a real measured repository operation;
- include at least one behavior-positive and one behavior-negative case;
- fail when an expected result is changed, removed, or made hollow;
- persist exact observed values, source revision/path, command, and timestamp;
- record missing corpus, timeout, skipped branch, syntax errors, and API-bound
  operations as `known-gap` or `blocked`, never as `verified`;
- state whether a claim is AST-derived, index-derived, heuristic, inferred, or
  unknown.

A verifier may prove a narrow contract without proving the whole tool. Its
`scope` and `limitations` must say exactly what was not proved.

## Issue order

`#428` is the governance prerequisite. `#429` establishes corpus identity and
availability. Tool issues may proceed after the relevant governance fields are
present, but no tool issue closes without the cross-tool requirements in `#442`.
The final issues `#443` and `#444` close only after real-repository evidence,
complexity/resource measurements, documentation synchronization, and all
unresolved limitations are attached.

## Closure contract

An issue can be closed only when its ledger entry contains:

- GitHub issue number and stable code;
- implementation paths and verifier command;
- current commit and evidence file;
- positive and negative check counts, with no failed checks;
- corpus paths/revisions or an explicit blocked/known-gap reason;
- measured values where the issue makes a performance/resource claim;
- documented limitations and analyzer dependencies;
- clean rerun from the intended checkout.

The M20 closure gate must reject a missing field, a verified state without
current evidence, a stale evidence timestamp, a hidden skipped case, or a
mutation that no longer fails the gate.

## Current baseline

The preceding M13 probes are baseline observations only. The current review
found these concrete gaps:

- migration ordering is dependency-count sorting, not topological ordering;
- migration methodology must be derived from structured relationship/dependency evidence rather than strategy prose; M20.M2 owns this boundary;
- pattern parameter analysis limits rows before eligibility evaluation;
- orphan detection cannot observe dynamic/reflection/configuration wiring;
- security adversarial checks contain unconditional/tautological assertions;
- security source/sink matching is broad snippet regex and can miss flows or
  report token collisions;
- documentation implementation is narrower than its mode/examples/diagrams
  contract;
- active developer checkouts are not all reproducible evidence sources: three
  revisions mismatch and five declared repositories are dirty. C2 now uses
  versioned, immutable Git-archive snapshots for those affected rows without
  resetting or cleaning active repositories; active checkout state remains
  visible in the registry. C2 is `verified` only when the snapshot manifest,
  sidecars, all pinned revisions, and the relevant project tree are current;
  otherwise it records an honest `KNOWN-GAP` while preserving extra local
  repositories separately.

None of those baseline observations is marked as fixed by this governance
artifact. They are inputs to the corresponding open GitHub issues.
