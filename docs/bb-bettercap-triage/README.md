# Bettercap report triage — campaign index

Status: **VERIFICATION COMPLETE 2026-11-18** · product HEAD `be4c0ef25` / bb `0.1.6` · specimen
`/home/ishaq2321/bettercap` (index `4c7590f1…`, 1972/1973 files, 55,785 symbols; never modified).

An external agent's 12-point "Still broken" report against the Go analyzer, verified adversarially
by 8 lanes. Every item was re-derived from source + index evidence; **none is false**, and every
report needed at least one correction to its stated mechanism or numbers (5 REAL, 4
REAL-BUT-MISDESCRIBED, 1 REAL-composite, 2 PARTIAL). No item is bettercap-specific.

## Read in this order

| file | what it is |
|---|---|
| `LEDGER.md` | final verdict table (12 items), severity, one-line mechanism, cross-cutting causes, outcome |
| `GENERALITY.md` | is it Go-only, tool-wide, or universal? per-issue matrix + root-cause families |
| `PLAN.md` | prioritized hunt plan: per-defect fix legs, gates (pre-fix RED + positive control), verify command, size, owner, anti-fixes |
| `findings/LEAD-FINDINGS.md` | the two P0 root causes behind the report (L-1 unscoped name binding, L-2 name-only cross-language) + L-3…L-5 |
| `findings/ISSUE-01…12-*.md` | per-issue evidence-backed findings (charter template: verdict, repro, root cause file:line, generality, fix, gate) |
| `findings/UNLOCKED.md` | 19 adjacent defects found while verifying (next round) |
| `evidence/` | raw captures per lane (~13 MB): JSON payloads, DB queries, byte-offset analyses, build errors |

## Headline

- **P0-1 refactor is unsafe**: a Go rename of `LoadModules` plans 2 files/2 sites, misses the
  package-qualified caller at `main.go:47`, and reports success; a 2-package replay does not compile.
- **P0-2 name binding**: `errors.New()` becomes a call to `session.New`; `os`/`fmt`/`io` imports become
  edges to a YAML key, a Makefile target and minified JS. 2,423/2,423 cross-language rows are
  name-resolution; 89 incoming calls to `session.New`, 88 false.
- **Go analyzer class bugs**: imports all-external (1,880/1,880 on bettercap; reproduced on 2 more Go
  repos), cross-file function-value `uses` missing (orphan false positives; totals exact).
- **Tool-level**: test-intel model JS-shaped; doc/search scope contracts; embeddings provider switch
  leaves semantic search at 0%; bounds-after-data in 4 envelopes; security/visualize labels.
- **Fix order**: P0 refactor safety + name binding → P1 Go identity/uses, test intel, envelope → P2
  doc/search/embeddings/health/labels/old-index/ops.

## Reproduce the campaign

`CHARTER.md` is the rules of evidence (ground truth, adjudication vocabulary, generality protocol,
sandbox constraints, write scopes). The bettercap index is read-only throughout; use
`node bin/bb tool <tool> --dir /home/ishaq2321/bettercap --args '<json>'`.
