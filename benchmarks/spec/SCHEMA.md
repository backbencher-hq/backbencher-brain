# Benchmark schemas

Four records, four files. Every field below is required unless marked optional; a
record missing a required field is **invalid**, not partially scored.

Machine-readable JSON Schema for these shapes is generated from this document by
`script/bench/preregister.ts --check` (W0 deliverable). Until that exists, this file
is the contract.

---

## 1 · `project.json` — one pinned repository

> **Format is JSON, not YAML.** The task says YAML in `DESIGN.md`; the implementation uses
> JSON because this repository has no YAML parser dependency and adding one to read three
> fixture files is not a trade this project makes. Committed with the harness, and named
> here so the two cannot drift.

```jsonc
// benchmarks/<language>/<project>/project.json
{
  "id": "ts-project1",              // unique inside the wave
  "language": "typescript",
  "remote": "https://github.com/<org>/<repo>",
  "revision": "<40-hex>",           // the commit every run starts from
  "tarball_sha256": "<64-hex>",     // sha256 of `git archive` at that revision
  "setup":  ["<cmd>"],              // runs offline, from the pinned base image
  "test":   ["<cmd>"],              // full suite; used for pass-to-pass
  "test_subset": "tasks/tests.txt", // tests the golden fix must move
  "build_image": "bench-<lang>:<ver>",
  "size_class": "small|medium|large",
  "languages_indexed": ["typescript", "javascript"]
}
```

Rules: `revision` is a commit, never a tag or branch. `setup` and `test` must succeed
in the image with networking disabled, otherwise the project is not eligible for a
wave.

## 2 · `tasks/<id>.json` — one task

```jsonc
// benchmarks/<language>/<project>/tasks/t1-rewind-001.json
{
  "id": "t1-rewind-001",
  "track": "rewind",                 // rewind | multifile | comprehension | inject
  "project": "ts-project1",
  "language": "typescript",
  "origin": {
    "kind": "history",               // history | inject | authored
    "base_revision": "<40-hex>",     // the commit the agent starts from
    "fix_revision": "<40-hex|null>",  // the real fix commit (null for inject/authored)
    "inject_seed": null
  },
  "prompt": "prompts/t1-rewind-001.md",  // exact text the agent sees (hashed)
  "golden": {
    "files": ["src/a.ts", "src/b.ts"],
    "patch": "golden/t1-rewind-001.patch", // derived at run time, --check'ed
    "needle": null                        // comprehension track only
  },
  "stratification": "hot",           // pre-registered hot|cold
  "budget": { "max_steps": 80, "max_tokens": 400000, "max_wall_s": 900 },
  "grade": {
    "must_pass": ["t1-rewind-001"],
    "must_not_break": ["<pass-to-pass test names>"]
  }
}
```

## 3 · `run-record.json` — everything one run establishes

**Reconciled with the implementation on 2026-11-25.** A `verify-record.ts` gate asserts that
a record does not contradict its own `grade.json` or `trace.ndjson`; a field that claims a
measurement it never made is a gate failure, not a cosmetic issue.

```jsonc
{
  "schemaVersion": 1,
  "wave": "W1",
  "runId": "W1-t1-rewind-48586f4-armC-C0-r1",
  "task_id": "t1-rewind-48586f4",
  "project": "ts-project1",          // maps to a language via benchmarks/manifest.json
  "arm": "A|B|C|D|E",
  "embedding_arm": "C0|C1|C2",
  "repetition": 3,
  "status": "valid|invalid|infra_error",
  "invalid_reason": null,            // REQUIRED non-null when status != valid

  "model":   { "provider": "freepi", "model": "deepseek-v4.1-flash", "temperature": 0 },
  "harness": { "kind": "dsh-headless" },
  "bb": {
    "version": "0.2.2",
    "index_health": "green|degraded",
    "index_health_verbatim": "…",    // the tool's own words, never a summary
    "embedding_config": "local-word-vectors-v3:50",
    "embedding_warmup": true
  },
  "arm_enforcement": {
    "bb_mcp_mounted": true,
    "placebo_mode": "argument-randomised|null",   // REQUIRED for arm E, forbidden otherwise
    "placebo_injected": true,
    "bb_cli_shimmed": false,
    "bb_cli_invocations": 0,                     // >0 in A/B forces status=invalid
    "absolute_path_invocations": 0
  },
  "memory": { "ram_total_gb": 15.5, "ram_available_gb_at_start": 8.4, "peak_rss_index_mb": 87 },
  "concurrency": 1,
  "cost": {
    "wall_s": 658.8,
    "tokens_in": 4296557, "tokens_out": 53878, "tokens_cached": 4174080,
    "tool_calls": 98, "tool_call_bytes": 159211,
    "tool_call_ms": 384, "tool_ms_median": 43, "tool_ms_max": 175,
    "tool_ms_by_tool": { "bash": { "calls": 2, "median": 123, "max": 175 } },
    "usage_complete": true
  },
  "discovery": {
    "static_prefix_tokens": 22919,               // fixed cost of the arm, first step
    "tokens_before_first_edit": 46310,           // PRIMARY measure (no timestamps needed)
    "tokens_before_first_edit_complete": true,
    "first_edit_step": 2,
    "first_edit_ms": 18715,                      // arrival time = UPPER BOUND
    "measured_on": "tokens-primary; ms is runner-arrival (upper bound)",
    "exposed": true, "exposed_at_step": 0, "exposed_at_ms": 11924,
    "exposed_by_tool": "read",
    "edited_golden": true,
    "conversion": true                            // null when never exposed
  },
  "bb_usage": { "calls": 0, "by_tool": {}, "refusals": 0, "fallback_answers": 0, "fallback_rate": 0 },
  "submission": { "diff_path": "submission.patch", "files_changed": 2, "lines_added": 53, "lines_removed": 18 },
  "grade": {
    "grade_path": "grade.json",                   // written by grade.ts, NOT at run time
    "success": true, "score": 1, "reason": "ok",
    "localization": "exact|partial|none",
    "tests_passed": 2, "tests_required": 2, "regressions": 0,
    "graded_at": "2026-11-25T09:34:44Z"
  },
  "evidence": {
    "trace_path": "trace.ndjson",                 // must be INSIDE the run directory
    "session_path": "session.v4.jsonl.zstd",
    "trace_lines": 414, "trace_sha256": "…", "session_sha256": "…",
    "scrubbed": true, "scrape_findings": ["normalised … -> ~"]
  },
  "timing": { "source": "runner-arrival", "resolution_ms": 1 },
  "unrecorded": ["harness.version", "index_build_ms", "…"],   // gaps, declared
  "revision": { "base": "9310cd1ef…", "pinned": "7f272ab5f…" }
}
```

### Rules the gate enforces

| rule | why |
|---|---|
| `status != valid` ⇒ `invalid_reason` non-null | an exclusion without a reason is unpublishable |
| arm A/B ⇒ `bb_mcp_mounted: false` **and** `bb_cli_invocations: 0` | the measured bb-leak |
| arm C/D/E ⇒ `bb_mcp_mounted: true` | a C run with no server measures the wrong thing |
| arm E ⇒ `placebo_mode` set; other arms ⇒ it must be null | an unlabelled placebo is arm C in disguise |
| record `grade.score` == `grade.json.score` | the shipped defect: record said 0, grade said 1 |
| `evidence.trace_path` has no `..` and exists | a citation that 404s after cleanup is not evidence |
| `tokens_cached <= tokens_in` | cached input is part of input |
| `conversion: true` ⇒ `exposed: true` | conversion is undefined without a showing |
| expected-but-unmeasured fields are listed in `unrecorded` | a silent null reads as "not applicable" |

Run it with `npx tsx script/bench/verify-record.ts --wave benchmarks/.work/<wave>`.

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
