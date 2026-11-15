<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the Phase B record for bb_annotations: what was fixed, the
red-then-green evidence for each fix, and the before/after measurements that show
the fixes took effect.
WHO IT IS FOR — the campaign integration pass, and anyone later auditing why the
read door opens the store the way it does.
EDIT TOGETHER WHEN THIS CHANGES — audit.json, LATENCY.json,
gates/GATE-TABLE.json, results/GATE-read-door*.json, raw/** and the tool's own
files under src/mcp/tools/bb_annotations/.
-->

# bb_annotations — Phase B

State: **verified**. Phase A audit: [AUDIT-PHASE-A.md](./AUDIT-PHASE-A.md)
(`audit-phaseA.json`, commit `7d7a2ed86`). Machine summary: `audit.json`.

## 1 · What changed

| File | Change |
|---|---|
| `src/mcp/tools/bb_annotations/handler.ts` | Rewritten. Byte-read-only open; a missing store or a missing annotation table is a declared absence (`storeAbsent`) and the read creates nothing; the symbol filter resolves to `{name, qualified_name}` of every symbol the request names; adaptive truncation reason; `includeNameLevel` echoes the accepted flag and `nameLevelIncluded` reports the filter applied; `symbolIndexed` reports whether the spelling named an indexed symbol; every unused monolith-split import removed; §8/§9 authorship header. |
| `src/mcp/tools/bb_annotations/descriptor.ts` | Rewritten. Description states the real matching law (both name forms, the hover's pair), the path/flag law and the read-only absence; `limit` publishes `default: 50`, `minimum: 1`, `maximum: 200`; §8/§9 header. |
| `script/tool-docs/curation/bb_annotations.ts` | Rewritten. Returns cover the new fields; safety states the measured read-only boundary; performance states the measured plan per filter shape; limitations state the path-scope law and the mode vocabulary; §8/§9 header. |
| `docs/tools/bb_annotations.md` | Regenerated: `npx tsx script/verify-tool-docs.ts --only bb_annotations --write`. |
| `validation/tools/bb_annotations/verify-read-door.ts` | New falsifiable gate (40 checks, 5 seeded mutants) — it calls the tool through the same argument validation the MCP server uses. |
| `validation/tools/bb_annotations/**` | Phase A records kept (`raw/phaseA-*`, `audit-phaseA.json`, `exit-codes-phaseA.txt`); post-fix records added beside them. |

Artifact hashes (sha256, from `audit.json.artifactHashes`):

```
handler.ts              f84be6773f7969854db0c478004a29013580df4262292f61d8c5768862657e55
descriptor.ts           ab16fa381d388de0b4d6428ed306b43425172d26575cba84d9f3633c547426cd
curation/bb_annotations 89c2e2f93bca2dd5655e0fec219ce20733556ecd028553f60e5effe37cbfbb57
docs/tools/bb_annotations.md  d73e7669890f8b59658481e852ac0e46c7e7961b1782965d2fcd2f826f5ab23f
verify-read-door.ts     ca8f830c4f113ffc2bb3b3e83327c12800eb8d5388af9a9c682381286914e31e
```

## 2 · Red → green per defect

| Defect | Red (Phase A, committed at `7d7a2ed86`) | Green (this phase) |
|---|---|---|
| D1 qualified-name filter | `raw/phaseA-door-annotations.json`: R3/R4 failed (0 rows); `raw/phaseA-probe-store.json`: hover 1 row vs door 0 | `raw/door-annotations.json`: 45/45 checks incl. R3/R4; `raw/probe-store.json`: `doorAgreesWithHover: true`; `REAL-CORPUS.json` qualified read returns the qualified-name row (`utils.git@<null>`, `Rake::NameSpace@<null>`) |
| D2 read path writes | `raw/phaseA-read-immutability.json`: I2 created `projects/<pid>/brain.db`, I3 `tableRecreatedByRead: true`, I1 moved the WAL | `raw/read-immutability.json`: I2 `createdEntries: []`, I3 `tableRecreatedByRead: false` and brain.db hash unchanged, I1 only `brain.db-shm` changes |
| D3 T2 cold call | `raw/phaseA-latency-T2.json`: cold **17,644.6 ms** | `raw/latency-T2.json`: cold **7.158 ms**, warm p50 **0.447** / p95 **0.633 ms** |
| D7 cap truncation reason | `raw/audit-store-more.json` `capRead`: "Raise limit (max 200)" at limit 200 | `results/GATE-read-door.json` D checks; planted-source-mutant run `results/GATE-read-door-RED-truncation.json` (39/40, the cap check failed) |
| D6 §9 narration | `raw/section9-scan.txt`: 9 banned lines | `raw/section9-scan-postfix.txt`: 0 banned lines |
| gate can fail | — | planted name-set mutant: `results/GATE-read-door-RED-names.json` (37/40, three E checks failed); planted cap-reason mutant: `results/GATE-read-door-RED-truncation.json` (39/40). Both restored, then **40/40, 5/5 seeded mutants** in `results/GATE-read-door.json` |

The two planted source mutants were applied to this lane's own `handler.ts`,
observed red, and restored (restore verified by `diff -q`); the red result files
are kept. The five seeded mutants in the gate need no source edit at all.

## 3 · Measurements after the fix

### Latency (warm, 5 runs, `BB_NO_AUTO_REFRESH=1`)

| Tier | Subject | Cold first call | Default p50 / p95 | Budget |
|---|---|---|---|---|
| T0 | `test/fixtures/polyglot` (isolated index) | 7.614 ms | 0.506 / 0.674 ms | < 250 ms — pass |
| T1 | `.perf-fixtures/bb-scale/n100` | 9.171 ms | 0.351 / 0.528 ms | < 1 s — pass |
| T2 | reference index copy (6,452 files / 310,423 symbols / 820,040 relationships) | 7.158 ms (was 17,644.6 ms) | 0.447 / 0.633 ms | < 5 s — pass |

Load during the final measurement: 9.3–10.3 (1 min). T2 is a read-only SQLite
backup of `.bb-data` (`raw/t2-copy.json`, equal=true, source sha256 + mtime
recorded); the live store is never opened by a measurement.

### Real corpus through the real MCP stdio door (`REAL-CORPUS.json`)

| Corpus | Files / symbols | Qualified-name read (after) | Before | Default call p50 / p95 |
|---|---|---|---|---|
| graphql-js | 564 / 13,620 | 2 rows → `git@resources/utils.ts`, `utils.git@<null>` | 1 row (qualified-name note missing) | 25.2 / 27.9 ms |
| rake | 109 / 1,593 | 2 rows → `NameSpace@lib/rake/name_space.rb`, `Rake::NameSpace@<null>` | 1 row | 26.3 / 37.5 ms |
| rebar3 | 303 / 7,012 | not applicable — indexer publishes no distinct qualified name (declared) | — | 25.8 / 26.9 ms |

Absence is declared for project/symbol/path before any write on all three
corpora, and `limit:1` reports `1/N` with `truncated:true` on all three.

## 4 · Gate table (post-fix exit codes)

`gates/GATE-TABLE.json`, `gates/exit-codes.txt`, logs in `gates/logs/`.

| Gate | Exit | Note |
|---|---|---|
| m28-annotation-store | 0 | 50/50, 7/7 mutants (shared with the bb_annotate owner; ran as it stands) |
| m28-annotation-ui | 0 | 23/23, 6/6 mutants, 0 blocked |
| m28-mcp-tools | 0 | 26/26, 2/2 |
| m28-mcp-surface | 0 | 13/13, 2/2 |
| m28-union | 0 | 30/30, 6/6 |
| verify-tool-docs --only bb_annotations | 0 | page matches descriptor+curation |
| m15-registry-handlers | 0 | 23/23 with 7 controls |
| verify-tool-registry / verify-public-surface | 0 | PASS |
| regex-policy | 0 | 0 new uses; no allowlist row names this tool |
| verify-tool-page-claims | 0 | 34 passed / 0 failed / 15 negatives |
| m48-p2-honesty | 0 | 21/0/7 — the absence builder's bound fields are now dynamic |
| m48-c2-edge-mutations | 0 | 73/0/3 |
| m50-param-aliases | **1** | red outside this tool: single failure is bb_graph's `direction` refusal |
| m48-d1-doc-truth | **1** | red on stale shared artifacts (public-tools.json + website data; Lead integration) |

Read-door gate: `BB_NO_AUTO_REFRESH=1 npx tsx
validation/tools/bb_annotations/verify-read-door.ts` → **verified, 40/40 checks,
5/5 mutants caught** (`results/GATE-read-door.json`).

## 5 · Routed to the Lead (not editable from this lane)

1. The generated Staleness section still advises re-indexing for a stored-annotation
   read — generator-owned (`script/verify-tool-docs.ts`).
2. The generated `Modes: annotate` line still reads as a mode option; the page's
   Limitations section now states the tool takes no `mode` option. A truthful line
   needs either `modes: []` (renders blank) or a generator change.
3. The visualization badge (`src/intelligence/visualization/visualization-engine.ts:868`)
   matches annotations by name only, so it misses the qualified-name notes the
   hover now shows. This door and the hover agree; the badge does not.
4. `m48-d1-doc-truth` and `m50-param-aliases` reds are shared/cross-lane, named above.

## 6 · Blocked legs

- T2 against the live `.bb-data` store: the shared store must not be a measurement
  subject; measured on a read-only backup instead.
- Compiled door (`node bin/bb mcp`): `dist/` is stale (Lead ruling — source door
  only until the central rebuild).
- Qualified-name read-back on rebar3: declared not applicable (measured
  `secondNameFormRows = 0`).

## 7 · Reproduce

```
BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/verify-read-door.ts
BB_NO_AUTO_REFRESH=1 node validation/tools/bb_annotations/work/mcp-door.mjs
BB_NO_AUTO_REFRESH=1 node validation/tools/bb_annotations/work/read-immutability.mjs
BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/probe-store.mts
BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/audit-store-more.mts
BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/latency.mts --tier T0|T1|T2
BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/real-corpus-index.mts
BB_NO_AUTO_REFRESH=1 node validation/tools/bb_annotations/work/real-corpus-door.mjs
node validation/tools/bb_annotations/work/build-evidence.mjs
```
