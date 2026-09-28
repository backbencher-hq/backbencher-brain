# `bb_doc` Reference

This page is the checked-in dogfood artifact for the `bb_doc` implementation.
It is generated from the same evidence model described in `docs/BB_DOC.md` and
uses only source-backed claims.

## Modes

- `symbol`: exact signature, source bounds, documentation, relationships, and tests.
- `file`: file inventory, symbols, imports/exports, syntax state, and freshness.
- `module`: module files, public surface, and dependency relationships.
- `feature`: lexical/semantic discovery followed by concrete cited symbols.
- `api`: indexed API contract paths and route-like symbols; undocumented behavior remains unknown.
- `project`: project inventory, entry points, health, and architecture evidence.
- `coverage`: documented, undocumented, stale, and unavailable evidence counts.

## Evidence Policy

Every factual section carries citation IDs resolved to indexed source spans or
brain relationship rows. Semantic retrieval discovers feature candidates but is
never the sole basis for a factual claim. Stale source is labeled and current
behavior is downgraded to an explicit unknown until refresh.

## Read-Only Guarantee

Documentation generation does not write source files, refresh the index, create
tests, or alter repository state. Use `bb_edit` for any repository mutation.

## Quality

The result includes factuality, citation/reference, completeness, freshness, and
output-budget gates plus section-level unknowns and warnings. JSON preserves the
same evidence and stable website metadata as Markdown.

Dogfood verification: `script/verify-doc.ts`.
