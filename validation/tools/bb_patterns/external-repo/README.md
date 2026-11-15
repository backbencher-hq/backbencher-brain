# Patterns lane — external probe repository (preserved)

This directory preserves the working probe harness and review records from the
patterns lane's separate private repository (`ishaq2321/bb_patterns`), created
during the tool campaign to keep the lane's measurement probes out of the product
tree and to rescue untracked probe work before an environment retirement.

- `probes/` — the lane's measurement probes (framework thresholds, orphan/dedup
  truth, language coverage, latency, confidence/export signals, …).
- `harness/` — the corpus/harness scripts those probes ran under.
- `RE-VERIFICATION.md`, `REVIEW-PLAN.md` — the lane's re-verification record and plan.

It is **evidence, not product code**: nothing in the build, the public tools, the
launch gate or the docs generator imports it. The shipped findings are in
`validation/tools/bb_patterns/` and `docs/BB_PATTERNS.md`; this copy keeps the probe
work reproducible after the external repository is removed.
