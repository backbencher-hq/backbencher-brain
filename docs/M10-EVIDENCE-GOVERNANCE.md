# M10: Intelligence Consolidation And Evidence Governance

M10 is the decision milestone for making Backbencher Brain smaller, more truthful,
more useful, and more reliable. It governs the retained intelligence engines,
legacy facades, Sentinel prototypes, test intelligence, architecture claims,
analysis history, and public tool contracts.

M10 is not a feature-count milestone. A capability is valuable only when it can
produce evidence-backed results, expose its limitations, and survive reproducible
verification. If a capability cannot meet that bar, it must be improved, clearly
quarantined, or removed.

## Objective

Establish one evidence-based decision for every materially intelligent capability:

- `keep`: proven, canonical, tested, and appropriately exposed;
- `migrate`: useful behavior exists, but ownership or output contracts are legacy;
- `improve`: the capability is valuable but its evidence, correctness, or coverage is insufficient;
- `quarantine`: retained only for compatibility or research with an explicit owner and removal criteria;
- `remove`: duplicate, fabricated, stale-schema-bound, unreachable, or not worth repairing.

No decision may be based only on naming, line count, implementation age, or a successful
happy-path response.

## Initial Evidence Inventory

The initial review found the following categories requiring M10 decisions:

| Area | Current evidence | Initial concern | Default disposition to prove or overturn |
| --- | --- | --- | --- |
| Static test mapping/gaps/impact | Current `brain_*` relationships; `verify-test-intel.ts` | No runtime coverage; direct engine unit coverage is limited | Keep and improve |
| Test quality/suggestions | Content and graph evidence; `verify-test-quality.ts` | Regex proxies are not runtime effectiveness | Keep, improve, and expose suggestions deliberately |
| Sentinel patrol/status/report | Legacy `sentinel_*` queries and orchestration | Tables are not canonical; several paths are unverified | Migrate useful behavior or remove |
| Sentinel traps/API/auth/PII/CVE commands | Empty or hard-coded success results | False confidence | Remove unless rebuilt with real evidence |
| Sentinel security patterns | Source regex heuristics | Duplicates strict taint engine and can overclaim | Migrate useful rules with calibrated evidence |
| Broad architecture intelligence | Legacy `src/ast/tools.ts` detectors | Claims exceed evidence; mixed heuristic quality | Improve into canonical pattern rules or remove |
| “Revolutionary”/“WORLD’S FIRST” claims | Source comments and generated summary text | Unverifiable marketing claims | Remove and replace with factual wording |
| Analysis history | `brain_analysis_*` persistence and lifecycle tests | Not all engines record runs consistently | Keep and improve into shared orchestration |
| Security/semantic/pattern adapters | Canonical engines exist but handlers flatten or bypass detail | Contract and evidence drift | Migrate public adapters to canonical results |

This table is an initial hypothesis, not a closure decision. The disposition ledger
created by M10.01 is authoritative after it is verified.

## Evidence Taxonomy

Every claim-producing intelligence result must identify its evidence class:

- `indexed`: directly persisted from source, AST, schema, or relationship data;
- `inferred`: deterministically derived from indexed evidence;
- `semantic_candidate`: retrieved by embeddings or ranking and not proof by itself;
- `static_finding`: analyzer output with confidence and limitations;
- `runtime_artifact`: imported from actual execution, test, coverage, or external scan data;
- `unknown`: unavailable, unsupported, unreadable, or outside the analysis budget;
- `stale`: indexed evidence no longer matches the source on disk.

Rules:

- Static test links are not runtime coverage.
- Security findings are not exploit proofs.
- Semantic matches do not prove behavior or architecture.
- A confidence value must be explainable from evidence and rule behavior.
- Sampling, truncation, limits, and unavailable dimensions must be visible.
- Stale evidence must be labeled, not silently presented as current.
- A hard-coded empty result is not evidence of a clean project.
- An unsupported detector must return `unknown` or an explicit unsupported result.

### Provenance Schema (normative)

Every canonical claim-producing report attaches an `EvidenceProvenance` envelope defined in
`src/intelligence/evidence.ts`:

- `evidenceClass`: one of the seven classes above.
- `engine` and `engineVersion`: which engine produced the result.
- `projectId`: the analyzed project.
- `source`: the indexed table(s) or derivation the result is built from.
- `limitations`: honest, non-empty caveats for interpreting the result.
- `truncated` and `sampled`: whether budgets bounded the result.
- `unknowns`: explicit unavailable or non-applicable states.

`makeProvenance` constructs the envelope with safe defaults; `assertProvenance` rejects any
malformed envelope. The following canonical reports carry provenance today:
`SemanticSearchResults`, `GraphTraversalResult`, `PatternReport`, `SecurityReport`,
`TestMappingReport`, `TestGapReport`, `TestImpactReport`, and `TestQualityReport`.

`script/verify-evidence-governance.ts` enforces this schema against a real indexed fixture,
including semantic candidate fallback, inferred graph/test paths, static findings, unknown
states, runtime-coverage separation, and on-disk stale detection.

## Non-Negotiable Closure Standard

An M10 issue may close only when all applicable evidence exists:

```markdown
## Evidence

- Changed files:
- Required artifact:
- Fixture(s):
- Verification commands:
- Result:
- Baseline comparison:
- Public contract impact:
- Deletion/reachability review:
- Residual risks:
- Commit/PR:
```

Every implementation issue must include focused verification and the full gates:

```bash
npm run typecheck
npm run build
npm run docs:verify
npm run verify
```

A passing command without the required artifact, fixture, and comparison evidence is
insufficient. A closed issue without this evidence is a process failure and must be
reopened or explicitly superseded.

## Required M10 Sequence

Issues are intentionally ordered:

1. Freeze the baseline and inventory.
2. Define the evidence and provenance contract.
3. Consolidate canonical engine ownership and public adapters.
4. Govern finding identity, analysis runs, and reproducibility.
5. Establish declared correctness and performance regression budgets.
6. Review each deletion or quarantine decision with caller and export evidence.
7. Re-verify the public CLI/MCP contracts and generated documentation.
8. Perform the final milestone audit. Only this issue may close M10.

GitHub assigned issue numbers independently of execution order. The normative order is:

| Order | Issue |
| --- | --- |
| M10.01 | [#116](https://github.com/backbencher-hq/backbencher-brain/issues/116) |
| M10.02 | [#118](https://github.com/backbencher-hq/backbencher-brain/issues/118) |
| M10.03 | [#113](https://github.com/backbencher-hq/backbencher-brain/issues/113) |
| M10.04 | [#117](https://github.com/backbencher-hq/backbencher-brain/issues/117) |
| M10.05 | [#114](https://github.com/backbencher-hq/backbencher-brain/issues/114) |
| M10.06 | [#121](https://github.com/backbencher-hq/backbencher-brain/issues/121) |
| M10.07 | [#120](https://github.com/backbencher-hq/backbencher-brain/issues/120) |
| M10.08 | [#115](https://github.com/backbencher-hq/backbencher-brain/issues/115) |

## Decision Rules

### Keep

Keep a capability only if it has one canonical owner, a documented evidence model,
focused positive and negative fixtures, deterministic bounds, and a public or internal
consumer that needs it.

### Migrate

Migrate useful behavior when a legacy implementation contains signal that the canonical
engine lacks. Preserve the behavior only after comparing it against fixtures and removing
unsupported claims or fabricated confidence.

### Improve

Improve when the capability is valuable but has correctness, evidence, performance,
runtime coverage, parser dependence, or contract gaps. Improvement must name the measurable
quality target before implementation.

### Quarantine

Quarantine only with an explicit compatibility or research reason, an owner, a warning-free
non-public path, and objective removal criteria. Quarantine is not a substitute for a decision.

### Remove

Remove when the capability is duplicate, unreachable, stale-schema-bound, fabricated,
unverifiable, or not worth repairing. Deletion requires caller, import, export, test,
fixture, persistence, and package evidence.

## Claims Policy

Product and source text must not use unverifiable superiority claims such as:

- “WORLD’S FIRST”;
- “revolutionary”;
- “no other tool in the world”;
- “all languages” or “all frameworks” when coverage is partial;
- “perfect,” “complete,” or “fully accurate” without a defined, verified scope.

Replace them with concrete statements that name the supported scope, evidence source,
confidence, limitations, and verification status.

## M10 Completion

M10 is complete only when `docs/M10-FINAL-AUDIT.md` and its machine-readable companion
record every issue, artifact, benchmark, deletion decision, residual risk, and verification
result. All M10-specific verifiers must be included in `npm run verify` and checked by the
quality-gate configuration. The final audit must state what remains intentionally deferred.
