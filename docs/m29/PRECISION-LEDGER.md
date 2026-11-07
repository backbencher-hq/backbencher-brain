# Precision ledger — bb_lsp per-language, per-feature truth (M29.R4)

Inputs hash `726318d7d1ebf35db528184717304c8caaa17116` (deterministic: byte-identical regeneration is the drift gate. The hash covers the evidence's semantic content; declared volatile run metadata — commit, generation time, seal — is excluded, so an upstream re-run does not report a false "stale". Run record with commit + timestamp lives in validation/m29/results/R4.json).

> This document is **generated** from evidence files. A hand edit breaks the drift gate (`script/m29/verify-precision-ledger.ts`). Claim levels are computed by the R1 binding from recorded evidence — they cannot be edited up. Staleness policy: any input-evidence change makes this stale until regenerated.

| language | claim | conformance | hover | tier | def | refs | docSym | wsSym | absence | callHier | budget | diff missing/unexplained | ms/file | tiers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| java | I3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 10.9 | 2 |
| python | I3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 45.7 | 5 |
| typescript | I3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 113.1 | 3 |
| javascript | I3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 279.4 | 3 |
| kotlin | I3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 41.8 | 4 |
| scala | I3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 3.8 | 3 |

**Giant scale (R3):** hover p95 22.39ms over 59000 files (revision 7f29ef266ea621a9); in-editor 10.22ms; cold median 1988ms; evidence-tier inferred ratio 41.2% -> 0% (R5 fix, mutant-gated). Evidence: validation/m29/results/R3.json.

## Limitations (declared)

- Differential floors are M14's committed baselines (named repo per language), not the full ecosystem — the numbers are floors, not upper bounds.
- Per-language warm p95 is measured over the wave fixture pack (real index, real server), not over giant-scale workspaces; the scale row (R3) covers the giant regime separately.
- Wave-1 covers the six owner-approved languages; all other analyzers onboard in later waves after M37/M14 (owner decision recorded).

## Evidence paths

- java: S5 validation/m29/results/wave-java.json, S6 absent (declared)
- python: S5 validation/m29/results/wave-python.json, S6 absent (declared)
- typescript: S5 validation/m29/results/wave-typescript.json, S6 absent (declared)
- javascript: S5 validation/m29/results/wave-javascript.json, S6 absent (declared)
- kotlin: S5 validation/m29/results/wave-kotlin.json, S6 absent (declared)
- scala: S5 validation/m29/results/wave-scala.json, S6 absent (declared)

