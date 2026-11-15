# `bb_security` evidence pack

Everything a reviewer needs to check this tool's claims without trusting the
prose: the gates, the planted-mutant proof, the read-path proof, the latency
table, and the real-corpus run. All of it is regenerable from the working tree.

```
validation/tools/bb_security/
├── REPORT.json            state, closed/open defect register, evidence index
├── AUDIT-PHASE-A.md       the read-only audit this phase started from
├── PHASE-B.md             the Phase B red→green report (defect → fix → proof)
├── REAL-CORPUS.json       5 real repositories through the real MCP stdio door
├── LATENCY.json           T0/T1/T2 in-process + door latency against budgets
├── gates/
│   ├── run-all.sh         all 15 security verifier scripts (13 verdicts + 2 support)
│   ├── final-chain.sh     gate suite → mutants → read-path → attribution → latency → corpus
│   ├── final-probes.sh    steps 3-6 on their own
│   ├── EXITS.tsv          command → exit code → wall time for the last run
│   └── script_*.out       full output of every gate in that run
├── audit/
│   ├── mutants.json       8 planted mutants: gate RED with the mutant, GREEN restored
│   ├── readpath.json      MCP/CLI/library doors: did a read change the index?
│   ├── write-attribution.json  which open path commits a write (SQLite header diff)
│   ├── latency-A.json     raw latency samples (LATENCY.json is the table)
│   ├── t2-default-budget.json  default live scan before/after the T2 fix,
│   │                      release protocol + 8-run node/bun + planner evidence
│   ├── fixtures.json, matrix.json, cap.json, ...   Phase A audit probes
├── work/                  the probe scripts that produce the evidence
└── bbdata/                isolated indexes (gitignored)
```

## Reproduce

```bash
export BB_DATA_DIR="$PWD/validation/tools/bb_security/bbdata"
export BB_NO_AUTO_REFRESH=1

./validation/tools/bb_security/gates/run-all.sh          # 15 gate scripts
npx tsx validation/tools/bb_security/work/probe-mutants.ts
npx tsx validation/tools/bb_security/work/probe-readpath.ts
npx tsx validation/tools/bb_security/work/probe-write-attribution.ts
npx tsx validation/tools/bb_security/work/probe-latency.ts
npx tsx validation/tools/bb_security/work/probe-real-corpus.ts
WARMUP_RUNS=1 MEASURED_RUNS=3 npx tsx validation/tools/bb_security/work/probe-t2-budget.ts   # release protocol
npx tsx validation/tools/bb_security/work/probe-resolve-plan.ts                              # planner evidence
```

Corpus fixtures are read from `BB_SECURITY_CORPUS_ROOT`, then
`/home/ishaq2321/bb_tests/repositories`, then `$HOME/bb_tests/repositories`; an
absent corpus is recorded as `skipped`, never as a pass.

## What the evidence is allowed to claim

- **Reads do not write.** `readpath.json` A/A2 (findings/history over the MCP
  door) and C (the 3.64 GB live index) show `brain.db` and `brain.db-wal`
  byte-identical before/after; only `-shm` is touched, which is shared-memory
  bookkeeping that any connection open (read-only included) may touch.
  `write-attribution.json` shows the same at the SQLite header level
  (`changeCounter`, `schemaVersion`, changed page set): no write commits. The
  controlled read-write open control is recorded for contrast. The one declared
  write is `recordRun`, and it does move bytes (WAL grows) — that is its job.
- **An unindexed project is refused, not answered clean.** All three doors
  refuse by name and create zero files (`readpath.json` D).
- **Bounds are declared, not implied.** A >cap fixture (510 findings) renders
  the explicit `CAPPED at 500; … 10 were not examined` sentence on the live
  read; `recordRun` persists the census-sized set; the history page caps at 200
  and names `findingsTotal`, `findingsShown`, `findingsTruncated`.
- **Two findings at one sink persist as two.** The recorded identity includes
  the flow state, so a confirmed and a mitigated flow on the same sink are both
  recorded (`mutants.json` `history-fingerprint-drops-state` goes red without it).
- **The T2 default scan is inside budget.** `audit/t2-default-budget.json`
  records the release battery's 5,515/5,546 ms p95 before the endpoint-resolution
  fix and 560/648 ms after with the same protocol (8-run node 475/504, bun
  297/331), the planner shapes that explain both, and the identical per-corpus
  counts that show the fix changed the plan rather than the answer.
- **The gates are falsifiable.** `mutants.json` plants one mutation per claim,
  runs the gate, restores the bytes (verified by hash) and runs it again:
  8/8 RED→GREEN, every file restored.

## Known cross-scope items

- The compiled CLI door (`bin/bb` → `dist/`) is an integration artifact; m17's
  corpus/history verifiers use it and are green only when that build is current.
- `validation/tools/**/bbdata/` and other `*.db*` files are gitignored: the
  evidence is the JSON, the fixtures are rebuilt by the probes.
