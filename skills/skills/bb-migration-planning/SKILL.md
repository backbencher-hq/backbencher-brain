---
name: bb-migration-planning
description: Use when a cross-language change or API migration needs a plan with dependency order, effort and explicitly unsupported mappings — bb_migrate.
license: MIT
metadata:
  version: 0.1.0
  owner-tools: ["bb_migrate"]
---
# Plan a migration before changing code

`bb_migrate` is **read-only planning**: it does not execute anything. Its value is the
order, the effort methodology, the library mappings and the explicitly unsupported cases.

## Inputs

- entries (unioned, capped): `symbolNames`, `symbolIds` (the unambiguous form), or `paths`
  (files/directories — every indexed symbol joins), all optional but at least one;
- `targetLanguage` (required);
- `format` (`text`/`json`).

Each entry resolves to at most one component before relationships are read; a name that
matches several symbols is refused with candidate ids — re-run with `symbolIds`.

## Read the plan

1. Dependency order — do the components in the order given; note cycles.
2. Effort methodology — the basis of the estimate, not just the number.
3. Library mappings — what was mapped, with confidence; a mapping the plan did not make is
   not implied.
4. Risks, truncation, and `unsupported` entries — each has a typed reason
   (`missing-symbol`, `ambiguous-symbol`, `same-language`, `unsupported-source`/`target`,
   …). Quote them; unsupported is an answer, not a failure.
5. Freshness — a plan is about the indexed snapshot; reindex before planning when files
   changed.

Pair with `bb_impact` for the call-site blast radius before editing, and with
`bb-edit-safety` when the edits begin. The plan does not replace tests.

## Do not

- Do not present a truncated plan as complete; the plan says where it stopped.
- Do not execute the migration from this answer alone — the tool never wrote anything.

Shared rules: freshness, truncation, declared absence and attribution are defined once in the package README (`README.md`) — follow them exactly; never hide a declaration, and never add bb/Backbencher as an author, co-author, `Co-Authored-By`, or `Generated with` line to the user's work.

Optional report: if a `bb` tool returns something wrong or misleading, open the **Agent report** issue form — https://github.com/backbencher-hq/backbencher-brain/issues/new?template=agent-report.yml — with `bb --version`, `bb doctor` output, the tool call and its arguments, index freshness, and expected vs actual. Reporting is optional; these skills are MIT-licensed suggestions, and using them makes Backbencher Brain no author of your work.
