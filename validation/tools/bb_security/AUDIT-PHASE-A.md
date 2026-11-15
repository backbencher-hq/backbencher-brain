<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the Phase A audit of bb_security: descriptor vs handler vs
engine, every mode/option, evidence honesty, payload bounds, gates, docs truth,
latency on three tiers, regex and comment discipline, and the real MCP stdio door.
WHO IT IS FOR — the campaign Lead and the permanent owner of bb_security.
EDIT TOGETHER WHEN THIS CHANGES — code changes that move a finding in this register,
and validation/tools/bb_security/REPORT.json (the machine-readable twin).
-->

# bb_security — PHASE A AUDIT

Tool: `bb_security` (read, requiresIndex true, one executable mode `findings`,
planned `flow`/`summary`/`hotspots`). Owner: tool-security. Phase A is read-only
for `src/`; every observation below cites a command run from the working tree and
an evidence file under `validation/tools/bb_security/`.

Runtime facts at audit time: node v22.22.1, bun 1.3.14, load average 22–27 on 8
CPUs (the shared fleet is active). T2 index as measured **inside the latency
probe**: 6,452 files / 310,423 symbols / 820,040 relationships / 14,701 taint
rows; `brain.db` 3,639,963,648 bytes, mtime `2026-11-02T04:14:52Z`; WAL 4,120,032
bytes concurrently written by the fleet. No other sample's population is quoted
as if it were this sample's.

## 1 · State

Phase A complete. 6 of the 13 existing security verifiers are RED on this tree
(all 13 were red before the environment fix, see §5); two read-path defects and
two history-policy defects are new and critical/high. Phase B is authorised by
the Lead's resume message; the REAL-CORPUS leg is recorded in
`validation/tools/bb_security/REAL-CORPUS.json`.

## 2 · Commands this audit ran

```
./validation/tools/bb_security/gates/run-all.sh                     # 13 gates, exits recorded
BB_DATA_DIR=$PWD/validation/tools/bb_security/bbdata npx tsx \
  validation/tools/bb_security/work/probe-index-fixtures.ts         # T0/T1/security fixtures
BB_DATA_DIR=… npx tsx validation/tools/bb_security/work/probe-readpath.ts
BB_DATA_DIR=… npx tsx validation/tools/bb_security/work/probe-write-attribution.ts
BB_DATA_DIR=… npx tsx validation/tools/bb_security/work/probe-annotation-write.ts
BB_DATA_DIR=… npx tsx validation/tools/bb_security/work/probe-schema-writer.ts
BB_DATA_DIR=… npx tsx validation/tools/bb_security/work/probe-history-policy.ts
BB_DATA_DIR=… npx tsx validation/tools/bb_security/work/probe-cap.ts
BB_DATA_DIR=… npx tsx validation/tools/bb_security/work/probe-matrix.ts
BB_DATA_DIR=… npx tsx validation/tools/bb_security/work/probe-latency.ts
BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_security/work/probe-real-corpus.ts
npx tsx script/tools/verify-regex-policy.ts                         # PASS
npx tsx script/verify-tool-docs.ts --only bb_security               # PASS
```

All MCP-door observations use the SOURCE door
`node_modules/.bin/tsx src/cli/index.ts mcp --dir <project>` with an explicit
`BB_DATA_DIR` (never the shared index except the T2 latency sample, which is the
shared index by definition and is labelled as such).

## 3 · Defect register

### CRITICAL

**C1 · The declared-read path is a write path, and it writes on every call.**
`handler.ts:85` and `src/intelligence/security/taint.ts:103` call
`BrainDatabase.getRawInstance(projectId)` — the read-write default — instead of
`{ readonly: true }`.

* Measured (controlled fixture, own data dir, no other process):
  a fresh-process read-write open that runs two SELECTs commits a write
  transaction — `brain.db` change counter 2→3, `PRAGMA schema_version` 157→161,
  page 1 rewritten; the read-only control leaves the file byte-identical
  (`audit/write-attribution.json`, observations `W-readwrite-open` vs
  `R-readonly-open`).
* A real MCP `bb_security {}` call does the same: `schema_version` 157→165,
  `brain.db` sha256 changed (`audit/readpath.json` probe `A-t0-default-mcp`).
* On the shared T2 index the first door call moved the WAL from 0 to 131,872
  bytes and the second from 131,872 to 230,752 (`audit/readpath.json` probe
  `C-t2-shared-default-mcp`); the fleet also writes that file, so the controlled
  fixture is the proof and T2 is corroboration.
* Root cause of the churn inside the write path (shared engine, Lead-owned):
  `ensureAnnotationTable` (`src/brain/schema-ddl.ts`) compares the single
  installed INSERT trigger (204 normalised chars) against a constant that holds
  BOTH triggers (499 chars), so `guardIsStale` is always true and every
  read-write open drops and recreates two triggers: `schema_version` +4 per open,
  each open (`audit/annotation-write.json`; the lengths are in that file's
  `trigger comparison` step). Every read tool that opens read-write pays this.
* `{history:true}` reaches the same write path through `getAnalysisHistory`, but
  in the measured fixture it added no write of its own once the open had run
  (`A2-t0-history-mcp`); the M2 control in write-attribution.json is clean.

Severity: critical (mutability contract violation; moves the shared index's WAL).
Fix in this lane: read via `getRawInstance(…, { readonly: true })` in the handler
and the taint engine. Shared `ensureAnnotationTable` defect: Lead.

**C2 · The CLI/library door creates an index and answers a false “clean”.**
On a project with no index, the MCP door refuses (`No index found …`, isError
true) because the server has its own gate, but the CLI door
(`bb tool bb_security --dir <unindexed>`) and the library door
(`createToolHandlers().bb_security`) create
`projects/<id>/brain.db` through the same read-write open and exit 0 printing
`security: 0 critical / … 0 unvalidated sources` — a complete, fresh-looking
clean report for a project that was never scanned. Measured:
`audit/readpath.json` probe `D-unindexed-project` (`cliDoor.createdFiles` and the
stdout are recorded verbatim).
Severity: critical (false success on a read tool; contradicts the documented
`Unavailable index` error and closes a wrong-answer path, not just a write).
Fix: the handler itself must refuse when the project is not indexed (open
read-only first; the loud error already exists in
`BrainDatabase.getRawInstance(projectId, {readonly:true})`).

**C3 · History silently drops a distinct finding, and its recorded count is
overstated.** The persisted fingerprint is
`taint:<type>:<sinkType>:<file>:<line>` (`handler.ts:133`) and OMITS the flow
state, while `completeAnalysisRun` de-duplicates by fingerprint
(`src/intelligence/analysis/run-history.ts:158-161`). A confirmed flow and a
mitigated flow at the same sink are two findings in the report (the engine's
dedup key includes state) but one persisted row.
Measured (`audit/history-policy.json`): the response said
`4 findings recorded`, the run recorded `findingCount 3`, and 3 rows exist; the
mitigated twin was dropped with no warning.
Severity: critical (silent data loss in the tool's own persisted evidence).
Fix: include the state in the fingerprint (and keep the documented re-grade
stability: severity is still excluded).

### HIGH

**H1 · Documented history invariant is not enforced.**
`docs/BB_SECURITY.md` says history must never contain
`severity="unknown"`. The handler forwards `finding.severity` verbatim for any
confirmed/mitigated flow; an injected resolved+mitigated flow with stored
severity `info` normalises to `unknown` and IS persisted
(`audit/history-policy.json`: `historyContainsUnknownSeverity: true`, persisted
row at `src/api.ts:11 state=mitigated`). The invariant holds today only because
the current analyzer happens not to emit a resolved unknown-grade flow.
Fix: either enforce the policy in the recorder (drop/re-grade and declare it) or
stop documenting the invariant. A declared rule must be executed by the code.

**H2 · The generated page and the tool's own staleness footer promise a control
that does not exist.** `docs/tools/bb_security.md` §Staleness says “reads
auto-refresh stale files within budget when enabled — disable with
`BB_NO_AUTO_REFRESH=1` or `refresh=false`”. `bb_security` has no `refresh`
option (schema: `history`, `recordRun`, `limit`) and never calls
`maybeAutoRefresh`/`autoRefreshFile`.
Measured (`audit/matrix.json` staleness block): a touched finding file produces
`[stale]` markers and the footer above, and the answer is **byte-identical**
with `BB_NO_AUTO_REFRESH` set and unset (`identicalDespiteAutoRefresh: true`) —
the tool never refreshes; and the same false sentence is emitted by
`derivedStaleness` inside the response.
Cross-scope: the sentence comes from `FRESHNESS_REMEDIATION.dir` in
`src/brain/freshness.ts`, used by `derivedStaleness` in `src/mcp/tools/shared.ts`
and by `script/verify-tool-docs.ts`'s default branch — all Lead-owned.
Fix: a per-tool “does not auto-refresh” remediation string (the generator
already does this for bb_visualize/bb_ask/bb_health), and a manual-remediation
variant for `derivedStaleness`.

**H3 · Six of the thirteen existing gates are red on the current tree; most reds
are stale anchors from the per-tool split, not product failures.** See §5.
m13-contract 20/24, m13-handler 14/17, m13-adversarial 26/28, m13-docs 18/23,
m15-deep X6 31/37, m17 corpus/history. The m13/m15 gates still read
`src/mcp/tool-handlers.ts` and `src/mcp/tool-registry.ts` for the handler body
and the registry entry, and the pages now live in
`src/mcp/tools/bb_security/{handler,descriptor}.ts`; the doc gates compare
`docLines[2]` after the §8 author header was prepended.

**H4 · The m13 adversarial MCP leg does not forward `BB_DATA_DIR` to the child
server.** `script/m13/verify-security-adversarial.ts` builds a
`StdioClientTransport` without `env`, so the child falls back to `$HOME/.bb`,
cannot see the fixture index, and the leg fails with the server's
`No index found` refusal even though the fixture was indexed. That is exactly
what the two red rows say. (The shared `script/verify-mcp.ts` already learned
this lesson — LEAD-FINDINGS A.) Fix: forward `...process.env`.

**H5 · Cold T2 through a fresh MCP session exceeds the 30 s client timeout.**
First gated call on the shared index: 32,876 ms (`audit/readpath.json` probe
`C-t2-shared-default-mcp`); the in-process cold (first, non-warm) call is
22,380 ms and the warm p95 is 1,512 ms (`audit/latency-A.json`). The cost is the
read-write open path (FK-heal join over 820,040 relationships + annotation
trigger churn + migrations), not the taint scan. Fixing C1 removes it; Phase B
re-measures.

**H6 · `history` is an unbounded response and `limit` does not bound it.**
600 persisted findings produce a 590,549-byte response; `{history:true,limit:1}`
produces the identical 590,549 bytes because `limit` bounds runs only, while
`findings` is the whole persisted set (`audit/cap.json`). The page says “history
run limit" (accurate) but declares no payload bound, and the descriptor's
“Every response states the census” is false for the JSON history shape (no
census at all).
Fix: a declared findings bound with `totalCountIfKnown`/`truncated`, and a
truthful census sentence scoped to the answer that has one.

### MEDIUM

**M1 · Live-scan cap declaration is computed and then dropped.** The handler
builds `capNote` (`handler.ts:90-92`) but only the `recordRun` return uses it;
the ordinary read path returns `countLine` only, whose cap disclosure is the
short `(N beyond the cap)` parenthetical. Measured on a 600-finding fixture:
`[scan: 1200 taint flow(s) indexed → 600 finding(s) (100 beyond the cap)]` and
no `CAPPED at …` sentence (`audit/cap.json`). Either use it or delete the dead
variable.

**M2 · Options accepted while irrelevant.** `limit` without `history:true` is
validated and then ignored; `history:true` plus `recordRun:true` silently prefers
history. Campaign rule (M50.A2) is to refuse an irrelevant option with the
accepted set named, or to document the precedence. Measured in
`audit/matrix.json` (`limit-without-history`, `history-plus-recordrun`).

**M3 · Evidence fingerprint no longer covers the tool's code.**
`src/intelligence/security/evidence.ts` hashes `src/mcp/tool-handlers.ts` and
`src/mcp/tool-registry.ts` (now assemblers) and does not hash
`src/mcp/tools/bb_security/handler.ts`/`descriptor.ts`. m20/m15 fingerprints
therefore do not move when the handler changes. In-lane fix.

**M4 · m20 S2's “auto-pass audit” advertises a denominator it does not use.**
The comment and the file claim “EVERY security verifier” (11 listed) while 13
verifier scripts exist; `script/m15/verify-security-precision.ts`,
`script/m17/verify-sec-corpus.ts` and `script/m17/verify-sec-history.ts` are not
scanned, and `script/m15/security-harness.ts` (not a verifier) is. In-lane fix.

**M5 · m13 Sec1's description check is a substring trap.** It fails on
`description.includes("flow")` because the description begins “Taint-flow …”,
i.e. it flags prose, not a capability claim. In-lane fix: assert the mode lists
(two other checks already do) and delete the prose check.

**M6 · Generated docs page vs curation vs real response on confidence.**
Curation `returns[0]` promises “calibrated confidence” among the text findings,
but the text line renders severity/label/symbol/file/source→sink/mitigated/stale
and not confidence; only the history JSON carries it. Either render the
confidence (and prove it in a gate) or correct the curation bullet.

**M7 · Curation safety claim is untrue until C1 is fixed.** “Source is read-only.
recordRun writes only analysis-history records in the brain database.” Both
halves are contradicted by C1 (every call writes schema via the rw open) and by
the recordRun path's rw open (migrations + trigger churn). Correct the text to
match the fixed behaviour.

**M8 · Evidence sealing claim is false for six verifiers.**
`docs/BB_SECURITY.md` says every bb_security verifier writes through
`writeSealed`. Measured: m15 + m20 verifiers do; m13 Sec1–Sec4 (through
`script/m13/harness.ts`) and both m17 Sec verifiers write with bare
`writeFileSync`, and their committed records carry no `bbSeal`
(`validation/m13/results/sec1.json` and `validation/m17/results/S1.json`: 0
occurrences; m15/x1.json and m20/S1.json: 1). Cross-scope for the shared m13
harness; in-lane for the doc claim.

**M9 · 50 000-cap auto-resolve risk is declared but not prevented.** If a project
deduplicates into more than `SECURITY_RECORD_RUN_CENSUS_CAP` findings, the
recording scan still drops the excess from the persisted set and
`completeAnalysisRun` auto-resolves prior findings absent from it. The response
declares the cap, so a reader is told; the persistence semantics still resolve
unexamined findings. Not reproduced (would need >50k distinct findings); recorded
as a code-path observation, not a measured failure.

**M10 · Two gates depend on Bun-only `import.meta.dir`.** Under `npx tsx`
(Node) they crash with `ERR_INVALID_ARG_TYPE… Received undefined` before any
assertion: `script/m13/verify-security-contract.ts:35` and
`script/m13/verify-security-docs.ts:33` (others in the suite import the same).
Exit code is 1, so the shell result is red, but it is an environment crash, not
a product verdict. Fix by deriving the root from `fileURLToPath(import.meta.url)`.

### LOW

- **L1** `handler.ts` imports ~40 modules it never calls (the whole pre-split
  monolith header: `parallel-indexer`, `edit-engine`, `visualization-engine`,
  `migration-engine`, `wipeProjectData`, …). Dead imports couple the tool to
  every engine and hide which modules it actually uses.
- **L2** §8 headers: `handler.ts`/`descriptor.ts` have no
  `WHY IT IS SHAPED THIS WAY` line, and `src/intelligence/security/taint.ts`,
  `src/intelligence/security/evidence.ts`,
  `src/security/cross-language-security.ts` have no author header at all.
- **L3** §9 process-attribution inventory (must be removed in Phase B), see §7.
- **L4** `VULN_ALIASES` maps `pii → pii_leak` and `VULN_LABELS` has a
  `pii_leak` label, but no doc mentions PII; if the indexer ever writes a `pii`
  row the tool surfaces a type its own “not detected” list does not discuss.
  Documentation completeness, not a lie.
- **L5** m13 Sec1 still asserts the legacy `script/verify-security.ts` wiring
  text (“M13 will extend later”) — a milestone narrative check, not a contract.
- **L6** `derivedStaleness` footer says “N stale, M missing of K findings' files”
  while it is given the observations' files too; the word “findings” is the
  wrong collective noun there.
- **L7** `bb_security` has no LSP twin (charter table: “—”) and no m55 leg
  references it; confirmed by grep, so there is no twin-parity leg to run.

## 4 · Contract vs behaviour (descriptor, handler, engine)

| Declared | Reality |
|---|---|
| mutability `read` | Every findings call opens read-write and commits schema writes (C1). |
| requiresIndex `true` | MCP door enforces it; CLI/library doors create the index and answer clean (C2). |
| modes `["findings"]` | One dispatch; `history:true` returns a different JSON shape and no census. |
| plannedModes flow/summary/hotspots | Correctly labelled roadmap only; no `mode` input exists. |
| defaults `{history:false, recordRun:false, limit:20}` | True; but `limit` is ignored unless `history` (M2). |
| “Every response states the census” | False for the history response (H6). |
| “one-sided flows reported separately as unvalidated observations” | True: adapter splits `state ∈ {source_only, unresolved}` into `suspiciousSources`; the engine assigns `confirmed` only when both endpoints resolve a file (verified through the door, `audit/matrix.json`). |
| “Findings … carry a staleness marker” | True for `stale`; a `missing` file is counted in the footer but carries no per-row marker. |
| “Not detected: hardcoded secrets; genuine cross-language taint; standalone weak crypto” | True in code: no secret rule writes taint rows; `crossLanguage` is `cross_language_boundaries > 0` set to 1 by any cross-symbol join; `weak_crypto` is a sink only. |
| calibration 0.7 / 0.4 / 0.3 | Enforced in `taint.ts`; history preserves it (m20 S3 green). |
| severity normalised to 5 buckets | Enforced; sums reconcile (`script/verify-security.ts` green). |

## 5 · Gate table (command → exit, env corrected)

First sweep with no `BB_DATA_DIR`: **13/13 exit 1**, every fixture gate dying on
`EROFS: read-only file system, mkdir '/home/ishaq2321/.bb/projects/…'` — the
gates are not self-contained about their data dir (they inherit `$HOME`).
With `BB_DATA_DIR=<lane>/bbdata BB_NO_AUTO_REFRESH=1`:

| Gate | Exit | Verdict on this tree |
|---|---|---|
| `script/m13/verify-security-contract.ts` | 1 | KNOWN-GAP 20/24 — stale handler-file anchor, stale doc-description anchor, full-generator leg |
| `script/m13/verify-security-handler.ts` | 1 | KNOWN-GAP 14/17 — stale `tool-handlers.ts` anchors (3) |
| `script/m13/verify-security-adversarial.ts` | 1 | KNOWN-GAP 26/28 — MCP child env not forwarded (2) |
| `script/m13/verify-security-docs.ts` | 1 | KNOWN-GAP 18/23 — `docLines[2]` stale after header, full-generator leg, sec1–3 known-gap cascade |
| `script/m15/verify-security-regressions.ts` | 0 | PASS |
| `script/m15/verify-security-precision.ts` | 0 | PASS |
| `script/m15/verify-security-deep.ts` | 1 | KNOWN-GAP — X6 registry/handler anchors stale (6) |
| `script/verify-security.ts` | 0 | PASS |
| `script/m20/verify-security-flow-boundary.ts` | 0 | PASS |
| `script/m20/verify-security-adversarial.ts` | 0 | PASS |
| `script/m20/verify-security-history.ts` | 0 | PASS |
| `script/m17/verify-sec-corpus.ts` | 1 | KNOWN-GAP — history contains `severity=unknown` rows on the rake corpus (3) |
| `script/m17/verify-sec-history.ts` | 1 | KNOWN-GAP — same 3 rows through the shared regression gate |

`script/tools/verify-regex-policy.ts` → 0 (PASS, 87 uses, none in bb_security
tool sources). `npx tsx script/verify-tool-docs.ts --only bb_security` → 0.

m17's two reds are the CLI door (`node bin/bb`, i.e. gitignored `dist/`) being
rebuilt concurrently during the sweep; the source door persists no observation
rows (m15 X6 and m20 S3 green, `audit/history-policy.json` shows only
confirmed/mitigated rows). Classified as a **blocked leg pending the Lead's dist
rebuild**, not a product defect — see §8.

## 6 · Latency (warm, 5 runs; `audit/latency-A.json`)

| Tier | Method | p50 | p95 | Budget | Verdict |
|---|---|---|---|---|---|
| T0 polyglot (5 files/13 sym/0 flows) | in-process handler | 20 ms | 23 ms | 250 ms | PASS |
| T0 | fresh MCP session | 13,569 ms | 14,948 ms | — | source-door startup, not product |
| T1 n100 (97 files/3,512 sym/353 flows) | in-process handler | 111 ms | 145 ms | 1,000 ms | PASS |
| T1 | fresh MCP session | 8,526 ms | 9,383 ms | — | source-door startup |
| T2 reference (6,452/310,423/820,040, 14,701 flows) | in-process handler | 1,137 ms | 1,512 ms | 5,000 ms | PASS warm; cold first call 22,380 ms |
| T2 | fresh MCP session | 7,237 ms | 27,759 ms | — | exceeds 30 s in the worst sample only when cold |

The cold cost is C1's read-write open (FK-heal over 820k relationships plus the
annotation-trigger churn); the taint scan itself is ~1.1 s warm. Phase B
re-measures on the fixed tree and writes the final `LATENCY.json`.

## 7 · Regex and comment discipline

Regex in owned tool sources (`handler.ts`, `descriptor.ts`, `taint.ts`,
`evidence.ts`, `cross-language-security.ts`, curation file): **0** regex
literals or `new RegExp`. The verifier scripts contain 9–61 each (assertions over
output, allowed; not tool-source). Regex policy gate: PASS.

§9 banned process-attribution comments (Phase B removal list):
`handler.ts` lines 38/40/43/77 (`M28.T1 (issue #624)`, `M48.P1 (#696)`,
`M55.T5 / §15.1`, `M35.S2`); `taint.ts:129` (`M50.A2 residual`);
`cross-language-security.ts:130` (`M9.09`); `docs/BB_SECURITY.md:1` title
(`M9.09`), `:178` (“This lane was not covered by the M61.V1 sealed-write
adoption”), `:264` (`M20.X2`); `script/m13/verify-security-*.ts` headers
(`M13.40/41/42/43`, “Before M13.01”); `script/m15/verify-security-deep.ts`
(`M15.X1–X8`, “this lane was never adopted”); `script/m20/verify-security-*.ts`
(`M20.S1/S2/S3`, `M20.X2`). Milestone IDs inside evidence metadata fields
(`issue: "M13.40"`) are machine identity, not narrative, and are kept.

## 8 · Blocked legs

1. **m17 Sec-corpus / Sec-history** — red only through the compiled door
   (`node bin/bb` → gitignored `dist/`), while the source door shows the
   persisted set is clean. Re-run after the Lead rebuilds `dist/`; recorded as
   blocked-on-build, with the source-door evidence named.
2. **`--write` regeneration of the generated page** — blocked by H2: the
   generator's default branch emits the false auto-refresh sentence for this
   tool; regenerating now would cement a false statement. Needs the Lead's
   per-tool branch first (§9).
3. **m48 corpus/param gates** — `script/m48/verify-c1-corpus.ts` and
   `verify-p4-param-matrix.ts` enumerate all sixteen tools; run in Phase B's
   battery and reported there.

## 9 · Cross-scope needs (Lead-owned files)

1. `src/brain/schema-ddl.ts` — `ensureAnnotationTable` compares one trigger's
   SQL with a two-trigger constant; every read-write open drops/recreates two
   triggers (+4 schema_version per open). Fixing it makes every read-write
   opening tool stop writing schema just by being served.
2. `src/brain/freshness.ts` + `src/mcp/tools/shared.ts` — a manual-remediation
   variant of `FRESHNESS_REMEDIATION` for `derivedStaleness` (bb_security and
   bb_patterns never auto-refresh).
3. `script/verify-tool-docs.ts` — a `bb_security` branch like bb_visualize's:
   “does not auto-refresh; no `refresh` option exists; manual remediation only”.
4. `src/mcp/tool-validation.ts` — if the Lead wants the cross-tool rule enforced
   platform-wide, the “option irrelevant to the chosen mode is refused” rule
   could cover `limit` without `history` (M2). The lane can also reject it in the
   handler; platform-wide is cleaner.

## 10 · Files written by this audit

`validation/tools/bb_security/AUDIT-PHASE-A.md` (this file),
`REPORT.json`, `REAL-CORPUS.json`, `LATENCY.json` (Phase B final), `gates/`
(every gate's stdout + `EXITS.tsv`), `work/` (probe scripts and fixtures),
`audit/` (raw observation JSON), `bbdata/` (gitignored indexes).
