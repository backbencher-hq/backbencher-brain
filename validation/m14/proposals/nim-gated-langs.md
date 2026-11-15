# PROPOSAL — add `nim` to `GATED_LANGS` after the E/F sweep

**TO THE LEAD. `completeness-inventory.ts` is yours.**

## WHY nim IS READY

At this HEAD `bun run script/m14/completeness-inventory.ts --lang nim` reads **6 pass / 2 fail**, and the two fails
are E and F — **your central `--update-baseline` sweep**:
```
FAIL  E  section-e-differential   no baseline floor row for nim:nim
FAIL  F  section-f-perf-budget    no avgMsPerFile for nim:nim
```
**Every lane-side section passes:** A (129 types, 96 handled, 32 silent, 0 gaps, 5 decisions — including the
universal pair `ERROR`→handled_verified and `MISSING`→internal_silent, both classified with their rationale notes in
the same commit) · B · C · D (4 tiers) · G (`docs/analyzers/nim.md + head comment present`) · H.

## THE LINE

After E/F are pinned, nim is 8/8 CONFORMANT. The change is **one entry** in the `GATED_LANGS` set in
`script/m14/completeness-inventory.ts` (currently 37 of 48 gated; nim would be one of the last block).

## WHAT GATING DOES AND DOES NOT MEAN

**It means nim's SECTIONS are honest — not that nim's edges resolve.** The lane's residual/ambiguity work is
separate and is not claimed by this proposal. The lane's coverage block, its five design decisions and its
universal-pair classification are the things this round made true; the gate's E/F rows will make the differential
and perf claims true.
