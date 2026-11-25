# Benchmark schemas

Four records, four files. Every field below is required unless marked optional; a
record missing a required field is **invalid**, not partially scored.

Machine-readable JSON Schema for these shapes is generated from this document by
`script/bench/preregister.ts --check` (W0 deliverable). Until that exists, this file
is the contract.

---

## 1 · `project.yml` — one pinned repository

```yaml
id: ts-project1                 # unique inside the wave
language: typescript
remote: https://github.com/<org>/<repo>
revision: <40-hex>              # the commit every run starts from
tarball_sha256: <64-hex>        # sha256 of a `git archive` at that revision
setup:  [ "<cmd>", … ]          # runs offline, from the pinned base image
test:   [ "<cmd>", … ]          # full suite; used for pass-to-pass (regressions)
test_subset: tasks/tests.txt    # the list of tests the golden fix must move
build_image: bench-<lang>:<ver> # the prebuilt image, no installers inside
size_class: small|medium|large  # tracked files, same classes as validation/m11
languages_indexed: [ typescript, javascript ]   # what bb will index
```

Rules: `revision` is a commit, never a tag or branch. `setup` and `test` must succeed
in the image with networking disabled, otherwise the project is not eligible for a
wave.

## 2 · `tasks/<id>.yaml` — one task

```yaml
id: t1-rewind-001
track: rewind                    # rewind | multifile | comprehension | inject
project: ts-project1
language: typescript
origin:
  kind: history                  # history | inject | authored
  base_revision: <40-hex>        # the commit the agent starts from
  fix_revision: <40-hex|null>    # the real fix commit (null for inject/authored)
  inject_seed: <int|null>        # for kind: inject
prompt: tasks/t1-rewind-001.md   # the exact text the agent sees (hashed)
manual_block: std|none           # arms B/C/D get `std`; arm A gets `none`
golden:
  files: [ "src/a.ts", "src/b.ts" ]        # expected edit set
  test_diff: tasks/t1-rewind-001.patch     # derived at run time, `git apply --check`ed
  needle: null                             # comprehension track only
stratification: hot|cold           # pre-registered, per task, from the fix's module
budget:
  max_steps: 80
  max_tokens: 400000
  max_wall_s: 900
grade:
  must_pass:  [ "t1-rewind-001" ]  # test names
  must_not_break: all              # pass-to-pass set = test_subset
```

## 3 · `run-record.json` — one execution of one arm on one task

```json
{
  "schemaVersion": 1,
  "wave": "W1-typescript",
  "preregistration_digest": "sha256:…",
  "task_id": "t1-rewind-001",
  "arm": "C",
  "embedding_arm": "C0",
  "repetition": 1,
  "status": "valid",
  "invalid_reason": null,
  "model": { "provider": "freepi", "model": "deepseek-v4.1-flash",
             "temperature": 0, "context_window": 1000000, "quantization": null },
  "harness": { "kind": "dsh-headless", "version": "0.2.2-rc.5", "commit": null },
  "bb": { "version": "0.2.2", "index_health": "green",
          "index_health_verbatim": "…",
          "embedding_config": "local-word-vectors-v3:50",
          "embedding_endpoint": null },
  "memory": { "ram_total_gb": 15, "ram_available_gb_at_start": 3.8,
              "peak_rss_index_mb": 278, "peak_rss_agent_mb": null },
  "machine": { "platform": "linux", "cores": 8, "ram_gb": 15, "gpu": null },
  "cost": { "wall_s": 0, "tokens_in": 0, "tokens_out": 0,
            "tool_calls": 0, "tool_call_bytes": 0, "tool_call_ms": 0 },
  "discovery": {
    "first_edit_ms": null, "first_edit_tokens": null,
    "first_correct_file_edit_ms": null, "first_correct_file_edit_tokens": null,
    "tools_before_first_edit": 0
  },
  "bb_usage": { "calls": 0, "by_tool": {}, "refusals": 0,
                "fallback_answers": 0, "fallback_rate": 0 },
  "submission": { "diff_path": "runs/…/submission.patch",
                  "files_changed": 0, "lines_added": 0, "lines_removed": 0 },
  "grade": { "grade_path": "runs/…/grade.json", "success": false, "score": 0 }
}
```

**Evidence fields (required for publication):**

```json
"evidence": {
  "trace_path": "runs/…/trace.ndjson",
  "session_path": "runs/…/session.v4.jsonl.zstd",
  "trace_lines": 0,
  "trace_sha256": "…",
  "session_sha256": "…",
  "scrubbed": true,
  "scrape_findings": []
}
```

`scrubbed: true` may only be set after the secret scan passes; `scrape_findings` names
what was normalised. A run without a trace is not publishable, however good its score.

`status` is `valid` | `invalid` | `infra_error`. Only `valid` runs are scored.
`invalid_reason` values include `memory` (OOM), `probe` (arm-is-the-arm failed),
`network` and `install`.
`discovery` fields are `null` when the agent never edited — that is a data point, not
a missing value.

## 4 · `grade.json` — blind grading of one submission

```json
{
  "schemaVersion": 1,
  "task_id": "t1-rewind-001",
  "tests": { "must_pass": { "ran": 1, "passed": 0 },
             "must_not_break": { "ran": 140, "passed": 139 } },
  "golden": { "files_expected": 2, "files_hit": 1,
              "localization": "partial", "patch_applies": true },
  "needle": { "required": false, "found": null },
  "regressions": { "files_outside_golden": 3, "lines_outside_golden": 41 },
  "success": false, "score": 0.0,
  "reason": "must_pass failed: t1-rewind-001"
}
```

`score` is binary success for the primary endpoint (0 or 1). Partial credit exists
only in `golden.localization` and is reported, never averaged into the headline.

---

## 5 · The analysis unit

The unit of analysis is **(task, arm, repetition)**. The reported primary number is
**centered success**:

```
centered(task, arm) = success(task, arm) − max(success(task, A))
```

computed per task over repetitions and then averaged. A task that the baseline solves
every time contributes 0 to every arm's score — which is the point: it stops the
benchmark from paying arms for the model's memorised knowledge.
