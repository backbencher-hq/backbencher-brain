# m45-demo — the demo corpus for M45 capture

The corpus the M45 films are shot on. A real, small TypeScript project whose
symbol graph is film-worthy: `Greeter` (greeter.ts) is instantiated and
called from both `main.ts` and `report.ts`, so hover, usages, call tree,
and graph scenes all have genuine cross-file content.

## Provenance

- Source: the owner's `~/bb-demo-ts` (created for the M44 live demo,
  2026-09-06). Copied byte-identical into the repo on 2026-09-07 so the
  capture manifest can pin a real `corpusCommit` (repo HEAD).
- Editing policy: treat as frozen demo material. Changing a file here
  changes what every M45 film shows and what the manifest pins — a change
  is a deliberate re-shoot decision, not an edit.

## Expected index (verified by C1 harness on every run)

Fresh `bb index` on this directory (data dir under the harness's control)
must produce the analyzer's real output for the three files. The C1 harness
asserts, from the live index:

- Greeter is a `class` with methods `greet`, `add`, `size`, a
  `constructor`, and a `buildGreeter` producer function.
- `main` calls `buildGreeter`/`add`/`greet`/`size`; `makeReport` →
  `describeGreeter` → `greet`; both files `instantiates` Greeter.
- Hover on `Greeter` reports a usage count; `bb/graph` usages mode returns
  grouped callers with declared counts.

## Files

| file | role |
|---|---|
| `src/greeter.ts` | the central `Greeter` class + `buildGreeter` |
| `src/main.ts` | entry; consumes Greeter |
| `src/report.ts` | second consumer; calls `Greeter.greet` via `describeGreeter` |
