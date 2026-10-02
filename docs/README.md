# Documentation index

`bb`'s documentation lives in the repository. This page is a map; the
[public tool reference](./data/public-tools.json) is the machine-readable
version of the per-tool docs, and `man bb` ships with the npm package.

## Start here

| If you want to… | Read |
| --- | --- |
| index a project, or understand what each flag actually does | [`indexing/README.md`](indexing/README.md) |
| recover an interrupted index run | [`indexing/resume.md`](indexing/resume.md) |
| understand why indexing is slow | [`indexing/performance.md`](indexing/performance.md) |
| fix "the workers don't start" | [`indexing/troubleshooting.md`](indexing/troubleshooting.md) |
| configure embeddings, `bb setup`, `bb doctor` | [`indexing/embeddings.md`](indexing/embeddings.md), [EMBEDDINGS.md](./EMBEDDINGS.md) |

## Indexing

`bb index` is the deepest surface here, and the one most likely to be wrong in a
way that costs you time rather than failing loudly. It has its own directory:

- [`indexing/README.md`](indexing/README.md) — the eight legal flag
  combinations, and how to read a run's own report on itself
- [`indexing/resume.md`](indexing/resume.md) — what survives Ctrl-C, and the
  `skipped-unchanged` trap that makes a "successful" resume leave stale edges
- [`indexing/performance.md`](indexing/performance.md) — measured timings, each
  citing an evidence file, plus an explicit list of what has *not* been measured
- [`indexing/troubleshooting.md`](indexing/troubleshooting.md) — the worker pool:
  six causes, the env vars that govern it, and which of them are test-only
- [`indexing/embeddings.md`](indexing/embeddings.md) — precedence, every
  `BB_EMBEDDING_*` variable, and who retries what
- [`indexing/PERFORMANCE-FINDINGS.md`](indexing/PERFORMANCE-FINDINGS.md) — local
  measurements with **no evidence file**; read its provenance warning first

These pages are gated against the code. `script/verify-docs-indexing.ts`
asserts that every env var, flag, default and quoted output line they contain
exists in `src/`, and with `--live` that the behavioural claims hold when
`bb index` is actually run:

```bash
npx tsx script/verify-docs-indexing.ts           # static claims
npx tsx script/verify-docs-indexing.ts --live    # + run bb index on a fixture
```

## Per-tool references

The 16 public tools are documented individually, and generated from the tool
registry so the two cannot drift:

- [`bb_search`](./BB_SEARCH.md) · [`bb_ask`](./BB_ASK.md) ·
  [`bb_doc`](./BB_DOC.md) · [`bb_health`](./BB_HEALTH.md) ·
  [`bb_patterns`](./BB_PATTERNS.md) · [`bb_security`](./BB_SECURITY.md)
- [`bb_visualize`](./BB_VISUALIZE.md) · [`bb_migrate`](./BB_MIGRATE.md) ·
  [`bb_analyze`](./BB_ANALYZE.md) · [`bb_test_intel`](./BB_TEST_INTEL.md) ·
  [`bb_test_quality`](./BB_TEST_QUALITY.md) · [`bb_edit`](./BB_EDIT.md)

Machine-readable: [`data/public-tools.json`](./data/public-tools.json).

## Embeddings and retrieval semantics

- [`EMBEDDINGS.md`](./EMBEDDINGS.md) — vector spaces, coverage semantics,
  retrieval measurements, and what embeddings explicitly do not do
- [`GRAPH_ENGINE.md`](./GRAPH_ENGINE.md) — the relationship graph
- [`indexing/embeddings.md`](indexing/embeddings.md) — configuration and
  precedence, for when you want to change a provider

## Architecture and programs

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — module layout
- [`IDE-HONESTY-CONTRACT.md`](./IDE-HONESTY-CONTRACT.md) — what the IDE
  integration promises and does not
- [`CONSOLIDATION-2026-10-02.md`](./CONSOLIDATION-2026-10-02.md) — current
  consolidation state
- The `M*` documents are milestone records and audits. They are evidence of what
  was checked when, not current behaviour; prefer the per-topic pages above.

## Verifying a doc

If a doc tells you something and you have reason to doubt it, check rather than
trust:

```bash
npx tsx script/verify-docs-indexing.ts   # the indexing pages, against src/
npx tsx script/verify-doc.ts             # doc/CLI surface claims
```

Docs that assert behaviour the code does not implement are worse than no docs:
they cost you time while looking authoritative.