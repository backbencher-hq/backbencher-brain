# `bb_migrate` Reference

`bb_migrate` is a read-only migration planner. It accepts `symbolNames` for
batch planning and retains `symbolName` as a single-symbol compatibility alias.

## Output

The normalized result includes:

- one plan per supported symbol
- `dependencyOrder`, sorted dependency-first by observed plan dependencies
- source-to-target library mappings with confidence and notes
- effort, complexity, risk factors, and strategy steps
- `unsupported` symbols with explicit reasons
- methodology totals: base setup hours, relationship hours, and missing-mapping hours
- explicit request/response truncation metadata

JSON is machine-readable; text preserves the legacy readable plan style while
adding ordering, methodology, unsupported cases, and truncation.

## Methodology

- 4 base hours per supported component
- 2 hours per observed cross-boundary relationship
- 6 hours per unsupported library mapping
- dependency-first ordering is deterministic for equal inputs

Unknown library equivalents are never presented as supported mappings. Same-
language, missing-symbol, and unsupported cases appear in `unsupported`.

```json
{"symbolNames":["authenticate","authorize"],"targetLanguage":"go","format":"json"}
```
