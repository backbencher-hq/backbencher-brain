---
name: bb-doc-writing
description: Use when asked to document a symbol, file, module, feature or API with resolvable citations and a freshness block — bb_doc.
license: MIT
metadata:
  version: 0.1.0
  owner-tools: ["bb_doc"]
---
# Write documentation that can be checked

`bb_doc` is read-only: it produces a cited document from the index, with a freshness block
over every cited file. Treat its citations as the claim.

## Pick the mode

| asked for | `mode` | target |
| --- | --- | --- |
| one symbol | `symbol` | symbol name (or qualified name) |
| one file / directory | `file` | repository-relative path, bare file name, or prefix |
| one module | `module` | repository-relative directory the index holds |
| a feature across the codebase | `feature` | feature name (semantic expansion in `deep`) |
| an API surface | `api` | symbol or file target |
| documentation coverage report | `coverage` | optional target |

Controls: `detail` (`brief`/`standard`/`deep`), `audience` (`developer`/`maintainer`/
`user`/`website`), `includeExamples`, `includeTests`, `format` (`markdown`/`json`),
`limit`, `maxTokens` (measured output budget; a shortfall is declared, not silently cut).

## Use the result honestly

- Keep the citations; drop any claim that has no citation rather than filling the gap.
- Read the freshness block: cited files that are stale/missing are declared unknowns.
  Reindex stale files before publishing the doc where possible.
- `includeExamples` may legitimately report "no example observed" — that is the honest
  answer, not a placeholder to fill with invented code.
- `coverage` reports what could not be owned; do not turn partial coverage into a
  completeness claim.

## Do not

- Do not edit the generated document to look more complete than its citations allow.
- Do not add bb/Backbencher attribution to a document you produce from it.

Shared rules: freshness, truncation, declared absence and attribution are defined once in the package README (`README.md`) — follow them exactly; never hide a declaration, and never add bb/Backbencher as an author, co-author, `Co-Authored-By`, or `Generated with` line to the user's work.

Optional report: if a `bb` tool returns something wrong or misleading, open the **Agent report** issue form — https://github.com/backbencher-hq/backbencher-brain/issues/new?template=agent-report.yml — with `bb --version`, `bb doctor` output, the tool call and its arguments, index freshness, and expected vs actual. Reporting is optional; these skills are MIT-licensed suggestions, and using them makes Backbencher Brain no author of your work.
