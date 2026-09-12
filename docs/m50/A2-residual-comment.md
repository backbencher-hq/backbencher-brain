# Comment posted to M50.A2 (#764) — A2 residual

Status: **posted** — `gh issue comment 764 --body-file` succeeded and the
comment is live at
https://github.com/backbencher-hq/backbencher-brain/issues/764#issuecomment-5647016254
(the first attempt via `--body` failed with `proxyconnect tcp: no route to
host`, then the proxy let it through).

Still blocked: the **push**. The environment routes git through
`http://…@REDACTED-PROXY`, which answers `no route to host` for every
attempt (and port 443/22 direct are unreachable too), so commit `c7948b19`
remains local-only. The comment text is kept here verbatim as the receipt of
record until the push lands.


---

## A2 residual closed — the three A1 convictions still above the 1s line

A1 left four probes in the REJECT/TIMEOUT class; A2 cleared bb_graph and bb_ask
but three read tools stayed SLOW. All three turned out to have the same defect
shape: **the engine materialized far more than it could ever return.**

| probe (production shape: `node bin/bb mcp`, real index) | A1 | A2c | speedup |
|---|---|---|---|
| `bb_analyze complexity` (project scope) | 2,895ms | **272ms** | 10.6x |
| `bb_security` | 1,032ms | **164ms** | 6.3x |
| `bb_patterns scope=all` | >90s (timeout) | **1,345ms** | 66.9x |

`A2c-latency-compare.json` (same harness as A1, 20 cases x 3 launches x
(warm-up + 3 measured)) now reports **zero** rows in the REJECT/TIMEOUT class.

### What each fix was

1. **`bb_analyze complexity`** — project scope fetched every joined symbol row
   (168,629) to average one column and keep 20. The aggregate is computable in
   SQL and the breakdown is `LIMIT 20`. `probe-complexity-phases.ts` proves the
   old and new algorithms return identical metrics and the same top-20 on the
   real index (1,423ms -> 228/235ms in-process).
2. **`bb_security`** — resolution loaded every symbol (168,629 rows / 508ms of a
   ~568ms engine call) into a Map to answer lookups for the 2,692 ids the taint
   rows actually reference. Flow paths are now parsed once, the distinct ids
   fetched in 500-id chunks. `probe-security-phases.ts` proves the bounded map
   equals the full map for **every** referenced id (0 missing / 0 mismatched /
   0 extra) and the report digest is **byte-identical** to the pre-fix run
   (engine 568ms -> 94ms).
3. **`bb_patterns`** — it built and sorted all ~28,602 orphan findings before
   slicing to `maxResults` (100 for the handler), and called the pure path
   predicates once per symbol. Candidates are now lightweight sort keys, finding
   objects are built only for the returned page, and the predicates are memoized
   per file. `probe-pattern-phases.ts` proves the scan's finding digest is
   byte-identical to the pre-fix run.

### Verification

- New permanent gate **`script/m50/verify-a2-bounded-work.ts`** (12 checks,
  hermetic fixture): 700 seeded taint flows spanning the 500-id chunk boundary
  each resolve to what an independent JOIN reports; state classification is
  exact; an unknown flow-path id recovers its name from the id tail; the legacy
  adapter and strict engine agree; project complexity equals an independent SQL
  derivation; orphan pagination is a prefix of the full scan under the
  documented comparator; truncation is reported honestly. Three falsifiability
  negatives prove each comparison can fail.
- Wired into `verify:m50`, the full `npm run verify` chain,
  `script/m50/gates.json`, the closure gate and the mutation self-test —
  **G2 PASS 22/22** (control passes, mutation fails, restore byte-identical),
  **X1 closure PASS 37/37**, governance **66/66**, `tsc --noEmit` clean.
- Evidence: `A2-residual.json` (derived from the receipts, `status: verified`,
  4/4), `A2-bounded-work.json`, the three probe receipts, and all 20 A2c case
  files.

### Honest residue (declared, not excused)

- `bb_analyze test_gaps` 1,235ms and `bb_patterns scope=all` 1,345ms remain
  SLOW-borderline; `bb_annotate` stays an ERROR by design (the A1 case was an
  invalid-args probe; the write tool is deliberately not fired at the real
  index).
- **Not pushed yet**: the git remote is unreachable from this machine, so commit
  `c7948b19` is local-only. Reported here rather than stale.
