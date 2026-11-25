# results/ — published artefacts

Nothing in this directory is written by hand. `script/bench/report.ts` generates it from
the run store, and the run store is the committed per-run evidence.

## Status

**Empty — W0.** No arm has been run against a pinned project, so there is no result to
publish. This directory exists so that the first published number has an obvious home and
so that "there are no results yet" is visible rather than implied.

## What lands here, per wave

```
results/
  OVERALL.md                       Level 3 — cross-language; never an average (§DESIGN 8)
  <language>/RESULTS.md            Level 2 — per-language
  <language>/project1/RESULTS.md   Level 1 — per-project
  <wave>/runs/<run-id>/
      run-record.json              scored record
      grade.json                   blind grade
      trace.ndjson                 full event stream (scrubbed) — the evidence
      session.v4.jsonl.zstd        harness's independent session record
      submission.patch             the agent's diff
      checksums.txt                sha256 of the above
```

## The rules

1. Generated, not authored. A hand-edited report is a lie with a source file.
2. Every table and chart carries the condition header: model, harness, `bb` version,
   **embedder**, machine, date, preregistration digest.
3. Every headline figure is recomputed from the traces, not from a summary.
4. Incomplete projects/languages are published as incomplete **with the gap named**.
5. Superseded reports are kept and linked, never overwritten.
6. If a trace fails the secret/scrub check, the run refuses to publish.
